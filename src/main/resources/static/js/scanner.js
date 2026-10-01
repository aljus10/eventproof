const $=id=>document.getElementById(id);
let db, deviceId=null, context=null, serverConnected=false, activeParticipant=null, cameraStream=null, detectTimer=null;
const DB_NAME='eventproof-scanner', DB_VERSION=1;

function openDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains('app'))d.createObjectStore('app',{keyPath:'key'});if(!d.objectStoreNames.contains('queue'))d.createObjectStore('queue',{keyPath:'clientTransactionId'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
function tx(store,mode,work){return new Promise((resolve,reject)=>{const t=db.transaction(store,mode),s=t.objectStore(store);let result;try{result=work(s)}catch(e){reject(e);return}t.oncomplete=()=>resolve(result?.result);t.onerror=()=>reject(t.error)})}
const putApp=(key,value)=>tx('app','readwrite',s=>s.put({key,value}));
const getApp=key=>new Promise((resolve,reject)=>{const t=db.transaction('app','readonly'),r=t.objectStore('app').get(key);r.onsuccess=()=>resolve(r.result?.value??null);r.onerror=()=>reject(r.error)});
const queuePut=item=>tx('queue','readwrite',s=>s.put(item));
const queueDelete=id=>tx('queue','readwrite',s=>s.delete(id));
const queueAll=()=>new Promise((resolve,reject)=>{const t=db.transaction('queue','readonly'),r=t.objectStore('queue').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function flash(message,type='success'){const el=$('scannerFlash');el.textContent=message;el.className='notice '+type;setTimeout(()=>el.classList.add('hidden'),4500)}
function time(v){return v?new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'}
function uuid(){return crypto.randomUUID?crypto.randomUUID():'tx-'+Date.now()+'-'+Math.random().toString(16).slice(2)}
async function scannerFetch(url,options={}){const headers={'Content-Type':'application/json',...(options.headers||{})};if(deviceId)headers['X-Scanner-Device']=deviceId;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);try{const r=await fetch(url,{...options,headers,signal:controller.signal});if(r.status===401||r.status===403)throw new Error('Scanner authorization failed. Re-pair this phone.');if(!r.ok){let m='Request failed';try{const j=await r.json();m=j.detail||j.message||j.error||m}catch{}throw new Error(m)}return r.json()}finally{clearTimeout(timer)}}
async function saveContext(c){context=c;await putApp('context',c);renderContext()}
async function saveDevice(id){deviceId=id;await putApp('deviceId',id)}
function setConnection(ok){serverConnected=ok;$('connectionText').textContent=ok?'CONNECTED':'OFFLINE';$('connectionDot').className='dot'+(ok?'':' offline')}
async function updatePending(){const q=await queueAll();$('pendingCount').textContent=q.length;return q}
function renderContext(){if(!context)return;$('pairPanel').classList.add('hidden');$('scannerPanel').classList.remove('hidden');$('eventName').textContent=context.eventName;$('eventVenue').textContent=`${context.eventDate} · ${context.venue}`;$('scannerName').textContent=context.scannerName;$('rosterCount').textContent=context.roster.length}
function showPair(){ $('scannerPanel').classList.add('hidden');$('pairPanel').classList.remove('hidden') }
async function refreshContext(){if(!deviceId)return false;try{const c=await scannerFetch('/api/scanner/context');setConnection(true);await saveContext(c);return true}catch(e){setConnection(false);if(!context)context=await getApp('context');if(context)renderContext();return false}}

function extractPairingToken(input){
  if(!input) return '';
  input = input.trim();
  const m = input.match(/[?&]pair=([^&#\s]+)/);
  if(m && m[1]) return decodeURIComponent(m[1]);
  if(input.includes('://')) {
    const cleaned = input.split('?')[0].replace(/\/+$/, '');
    const segments = cleaned.split('/');
    return segments[segments.length - 1];
  }
  return input;
}

async function pair(token){
  token = extractPairingToken(token);
  if(!token) return flash('Enter a pairing code.','error');
  try{
    const res = await scannerFetch('/api/scanner/pair',{method:'POST',body:JSON.stringify({pairingToken:token})});
    await saveDevice(res.deviceId);
    setConnection(true);
    await saveContext(res.context);
    history.replaceState({},'', '/scanner.html');
    flash('Scanner phone paired successfully.');
    await updatePending();
  }catch(e){flash(e.message,'error')}
}
$('pairBtn').onclick=()=>pair($('pairingToken').value);
$('pairingToken').addEventListener('input', () => {
  const val = $('pairingToken').value;
  const cleaned = extractPairingToken(val);
  if (cleaned !== val) $('pairingToken').value = cleaned;
});

function localByQr(token){return context?.roster.find(r=>r.qrToken===token.trim())||null}
function toParticipant(r){return {registrationId:r.registrationId,studentNumber:r.studentNumber,fullName:r.fullName,program:r.program,registered:true,present:r.present,checkedInAt:r.checkedInAt,loggedOutAt:r.loggedOutAt,scannerName:r.scannerName,attendanceType:context?.attendanceType||'PRESENT_ONLY'}}
async function resolveToken(token){token=(token||'').trim();if(!token)return flash('Paste or scan a QR token first.','error');let p=null;if(serverConnected){try{p=await scannerFetch('/api/scanner/resolve',{method:'POST',body:JSON.stringify({qrToken:token})});setConnection(true)}catch(e){setConnection(false);p=localByQr(token)?toParticipant(localByQr(token)):null;if(!p)return flash(e.message,'error')}}else{const r=localByQr(token);p=r?toParticipant(r):null;if(!p)return flash('QR not found in the prepared offline roster.','error')}showParticipant(p)}
$('resolveManual').onclick=()=>resolveToken($('manualToken').value);

function showParticipant(p){
  activeParticipant=p;
  const el=$('participantPanel');
  el.classList.remove('hidden');
  const isDualStage=(context?.attendanceType==='PRESENT_AND_LOGOUT')||(p.attendanceType==='PRESENT_AND_LOGOUT');

  // Case 1: Already checked in AND already logged out
  if(p.present && p.loggedOutAt){
    el.innerHTML=`<div class="participant">
      <div class="status" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">ATTENDANCE COMPLETED</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p>Time-In: <b>${time(p.checkedInAt)}</b><br>Logout: <b>${time(p.loggedOutAt)}</b><br>Scanner: <b>${esc(p.scannerName||'Gate Scanner')}</b></p>
    </div>`;
    return;
  }

  // Case 2: Already checked in in dual-stage mode (ready for logout!)
  if(p.present && isDualStage){
    el.innerHTML=`<div class="participant">
      <div class="status ok">PRESENT (IN EVENT)</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p>Time-In: <b>${time(p.checkedInAt)}</b><br>Ready to record departure / logout.</p>
    </div>
    <div class="confirm-row">
      <button id="cancelAttendance" class="btn secondary">CANCEL</button>
      <button id="confirmAttendance" class="btn" style="background:#2563eb;">CONFIRM LOGOUT / TIME-OUT</button>
    </div>`;
    $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
    $('confirmAttendance').onclick=confirmAttendance;
    return;
  }

  // Case 3: Already checked in in single check-in mode
  if(p.present){
    el.innerHTML=`<div class="participant">
      <div class="status no">ALREADY CHECKED IN</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p>Time-In: <b>${time(p.checkedInAt)}</b><br>Scanner: <b>${esc(p.scannerName||'Gate Scanner')}</b></p>
    </div>`;
    return;
  }

  // Case 4: Not yet checked in (Time-In)
  el.innerHTML=`<div class="participant">
    <div class="status ok">Participant Found</div>
    <h2>${esc(p.fullName)}</h2>
    <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
    <p><b>Registered</b><br>${isDualStage ? 'Step 1: Check-in / Time-In' : 'Not Yet Checked In'}</p>
    <p class="muted">Please verify the participant.</p>
  </div>
  <div class="confirm-row">
    <button id="cancelAttendance" class="btn secondary">CANCEL</button>
    <button id="confirmAttendance" class="btn">CONFIRM TIME-IN</button>
  </div>`;
  $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
  $('confirmAttendance').onclick=confirmAttendance;
}

async function confirmAttendance(){
  if(!activeParticipant)return;
  const isDualStage=(context?.attendanceType==='PRESENT_AND_LOGOUT')||(activeParticipant.attendanceType==='PRESENT_AND_LOGOUT');
  const isLoggingOut=activeParticipant.present && isDualStage && !activeParticipant.loggedOutAt;
  const capturedAt=new Date().toISOString();
  const item={
    registrationId:activeParticipant.registrationId,
    clientTransactionId:uuid(),
    capturedAt,
    eventId:context.eventId,
    scannerDeviceId:deviceId,
    source:'OFFLINE'
  };
  $('confirmAttendance').disabled=true;
  if(serverConnected){
    try{
      const r=await scannerFetch('/api/scanner/confirm',{method:'POST',body:JSON.stringify({...item,source:'ONLINE'})});
      setConnection(true);
      markRosterAttendance(r.registrationId,r.checkedInAt,r.loggedOutAt,r.scannerName);
      await putApp('context',context);
      showRecorded(r,false,isLoggingOut);
      return;
    }catch(e){
      setConnection(false);
    }
  }
  await queuePut(item);
  markRosterAttendance(item.registrationId,isLoggingOut?activeParticipant.checkedInAt:item.capturedAt,isLoggingOut?item.capturedAt:null,context.scannerName);
  await putApp('context',context);
  await updatePending();
  showRecorded({fullName:activeParticipant.fullName,checkedInAt:isLoggingOut?activeParticipant.checkedInAt:item.capturedAt,loggedOutAt:isLoggingOut?item.capturedAt:null},true,isLoggingOut);
}

function markRosterAttendance(registrationId,checkedInAt,loggedOutAt,scannerName){
  const r=context?.roster.find(x=>x.registrationId===registrationId);
  if(r){
    r.present=true;
    r.checkedInAt=checkedInAt;
    r.loggedOutAt=loggedOutAt;
    r.scannerName=scannerName;
  }
}

function showRecorded(r,offline,isLoggingOut){
  const name=r.fullName||activeParticipant?.fullName||'';
  const title=isLoggingOut?(offline?'LOGOUT SAVED OFFLINE':'LOGGED OUT SUCCESSFULLY'):(offline?'TIME-IN SAVED OFFLINE':'TIME-IN RECORDED');
  const timeInfo=isLoggingOut?`Logged Out: <b>${time(r.loggedOutAt||new Date())}</b>`:`Time-In: <b>${time(r.checkedInAt)}</b>`;
  $('participantPanel').innerHTML=`<div class="participant">
    <div class="status ${offline?'warn':'ok'}">${title}</div>
    <h2>${esc(name)}</h2>
    <p>${timeInfo}</p>
    ${offline?'<p class="muted">Queued and will sync automatically when server connection restores.</p>':''}
  </div>`;
  activeParticipant=null;
}

$('studentSearch').addEventListener('input',()=>{const q=$('studentSearch').value.trim().toLowerCase();if(q.length<2){$('searchResults').innerHTML='';return}const rows=(context?.roster||[]).filter(r=>r.studentNumber.toLowerCase().includes(q)||r.fullName.toLowerCase().includes(q)).slice(0,10);$('searchResults').innerHTML=rows.map(r=>`<div class="search-item" data-id="${r.registrationId}"><b>${esc(r.fullName)}</b><br><span class="small">${esc(r.studentNumber)} · ${esc(r.program)} · ${r.present?(r.loggedOutAt?'Completed':'Present'):'Registered'}</span></div>`).join('')||'<div class="muted small">No registered participant found.</div>';document.querySelectorAll('.search-item').forEach(el=>el.onclick=()=>{const r=context.roster.find(x=>x.registrationId===Number(el.dataset.id));showParticipant(toParticipant(r));$('searchResults').innerHTML='';$('studentSearch').value=''})});

async function syncPending(){if(!deviceId)return;const q=await updatePending();if(!q.length)return;let any=false;for(const item of q){try{const result=await scannerFetch('/api/scanner/sync',{method:'POST',body:JSON.stringify({items:[{registrationId:item.registrationId,clientTransactionId:item.clientTransactionId,capturedAt:item.capturedAt}]})});setConnection(true);await queueDelete(item.clientTransactionId);any=true;if(result[0])markRosterPresent(result[0].registrationId,result[0].checkedInAt,result[0].scannerName)}catch{setConnection(false);break}}await updatePending();if(any){try{await refreshContext()}catch{}flash('Offline attendance synchronized.')}}

async function decodeQr(source){
  if('BarcodeDetector' in window){
    try{
      const detector = new BarcodeDetector({formats:['qr_code']});
      const codes = await detector.detect(source);
      if(codes.length && codes[0].rawValue) return codes[0].rawValue;
    }catch{}
  }
  if(typeof jsQR === 'function'){
    try{
      const canvas = $('qrCanvas') || document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const w = source.videoWidth || source.naturalWidth || source.width;
      const h = source.videoHeight || source.naturalHeight || source.height;
      if(w && h){
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(source, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const res = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'dontInvert' });
        if(res && res.data) return res.data;
        const resInv = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: 'onlyInvert' });
        if(resInv && resInv.data) return resInv.data;
      }
    }catch{}
  }
  return null;
}

function openCameraSnapshot(){
  const input = $('cameraFileInput');
  if(input) input.click();
}

if($('snapPhotoBtn')){
  $('snapPhotoBtn').onclick = openCameraSnapshot;
}

if($('cameraFileInput')){
  $('cameraFileInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if(!file) return;
    flash('Scanning QR photo...','warn');
    try{
      const img = new Image();
      img.onload = async () => {
        try{
          const token = await decodeQr(img);
          if(token){
            $('manualToken').value = token;
            flash('QR code detected!');
            await resolveToken(token);
          }else{
            flash('Could not detect QR code in photo. Please hold phone closer to the QR code and try again.','error');
          }
        }catch(err){
          flash('Failed to read image: ' + err.message, 'error');
        }finally{
          URL.revokeObjectURL(img.src);
          $('cameraFileInput').value = '';
        }
      };
      img.src = URL.createObjectURL(file);
    }catch(err){
      flash('Could not open camera photo: ' + err.message, 'error');
    }
  });
}

async function startCamera(){
  const hasLiveVideo = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if(!hasLiveVideo){
    flash('Opening camera for QR snapshot (no flags required)...');
    openCameraSnapshot();
    return;
  }

  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    $('camera').srcObject = cameraStream;
    $('cameraBox').classList.remove('hidden');

    detectTimer = setInterval(async () => {
      try {
        const token = await decodeQr($('camera'));
        if(token){
          stopCamera();
          $('manualToken').value = token;
          resolveToken(token);
        }
      } catch {}
    }, 380);
  }catch(e){
    flash('Live camera streaming unavailable on this connection. Opening camera snapshot...');
    openCameraSnapshot();
  }
}

function stopCamera(){
  if(detectTimer){ clearInterval(detectTimer); detectTimer=null; }
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  $('cameraBox').classList.add('hidden');
}

$('scanBtn').onclick=startCamera;
$('stopCamera').onclick=stopCamera;

window.addEventListener('online',()=>{refreshContext().then(ok=>{if(ok)syncPending()})});
window.addEventListener('offline',()=>setConnection(false));
if('serviceWorker' in navigator)navigator.serviceWorker.register('/service-worker.js').catch(()=>{});

(async()=>{
  db = await openDb();
  deviceId = await getApp('deviceId');
  context = await getApp('context');
  if(context) renderContext();
  await updatePending();

  // Show HTTPS hint for mobile over HTTP
  if(location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    const hint = $('httpsHint');
    const link = $('httpsLink');
    if(hint && link){
      hint.classList.remove('hidden');
      link.href = 'https://' + location.hostname + ':8443/scanner.html' + location.search;
    }
  }

  const pairToken = new URLSearchParams(location.search).get('pair');
  if(pairToken){
    $('pairingToken').value = extractPairingToken(pairToken);
    await pair(pairToken);
  }else if(deviceId){
    await refreshContext();
    await syncPending();
  }else {
    showPair();
  }

  setInterval(async()=>{
    if(deviceId){
      const ok = await refreshContext();
      if(ok) await syncPending();
    }
  }, 15000);
})();
