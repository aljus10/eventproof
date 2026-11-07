const $=id=>document.getElementById(id);
let db, deviceId=null, context=null, serverConnected=false, activeParticipant=null, cameraStream=null, detectTimer=null, cameraMode='student';
let stationMode = localStorage.getItem('ep_scanner_mode') || 'checkin';
const DB_NAME='eventproof-scanner', DB_VERSION=1;

function feedback(type){
  // Haptic Feedback for smartphones
  try{
    if(navigator.vibrate){
      if(type==='checkin') navigator.vibrate([70]);
      else if(type==='checkout') navigator.vibrate([50, 40, 80]);
      else if(type==='warn') navigator.vibrate([120, 60, 120]);
    }
  }catch{}

  // Audio Feedback via Web Audio API (offline, zero-latency, no network asset needed)
  try{
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx = new AudioCtx();
    if(ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if(type==='checkin'){
      // High crisp rising chime (880Hz -> 1320Hz)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.14);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.start(now);
      osc.stop(now + 0.24);
    }else if(type==='checkout'){
      // Two-tone departure chime (587Hz -> 880Hz)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);
      osc.frequency.setValueAtTime(880, now + 0.09);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.start(now);
      osc.stop(now + 0.32);
    }else if(type==='warn'){
      // Dual low warning buzz (280Hz -> 200Hz)
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, now);
      osc.frequency.setValueAtTime(200, now + 0.11);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
      osc.start(now);
      osc.stop(now + 0.26);
    }
  }catch{}
}

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

async function scannerFetch(url,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(deviceId)headers['X-Scanner-Device']=deviceId;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
  try{
    const r=await fetch(url,{...options,headers,signal:controller.signal});
    if(r.status===401||r.status===403)throw new Error('Scanner authorization failed. Re-pair this phone.');
    if(!r.ok){
      let m='Request failed ('+r.status+')';
      try{
        const j=await r.json();
        m=j.message||j.detail||j.error||m;
      }catch{}
      const err=new Error(m);
      err.status=r.status;
      throw err;
    }
    return r.json();
  }finally{
    clearTimeout(timer);
  }
}

async function saveContext(c){context=c;await putApp('context',c);renderContext()}
async function saveDevice(id){deviceId=id;await putApp('deviceId',id)}
function setConnection(ok){serverConnected=ok;$('connectionText').textContent=ok?'CONNECTED':'OFFLINE';$('connectionDot').className='dot'+(ok?'':' offline')}
async function updatePending(){const q=await queueAll();$('pendingCount').textContent=q.length;return q}

function formatDuration(start, end){
  if(!start) return '—';
  const ms = (end ? new Date(end) : new Date()) - new Date(start);
  if(isNaN(ms) || ms < 0) return 'Just now';
  const mins = Math.floor(ms / 60000);
  if(mins < 1) return 'Just now';
  if(mins < 60) return `${mins} min${mins === 1 ? '' : 's'}`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs} hr${hrs === 1 ? '' : 's'} ${remMins} min${remMins === 1 ? '' : 's'}`;
}

function setStationMode(mode){
  const isDualStage = context?.attendanceType === 'PRESENT_AND_LOGOUT';
  if(!isDualStage && mode === 'checkout'){
    flash('Event is configured for single check-in only (no departure tracking).', 'warn');
    mode = 'checkin';
  }
  stationMode = mode;
  try{ localStorage.setItem('ep_scanner_mode', mode); }catch{}

  ['checkin','checkout','auto'].forEach(m=>{
    const btn = $(m==='checkin'?'modeCheckInBtn':(m==='checkout'?'modeCheckOutBtn':'modeAutoBtn'));
    if(btn){
      if(m===mode) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });

  const badge = $('stationModeBadge');
  const sub = $('stationModeSub');
  const scanText = $('scanBtnText');
  const snapText = $('snapBtnText');
  const scanBtn = $('scanBtn');

  if(mode==='checkin'){
    if(badge){ badge.className = 'station-badge in'; badge.innerHTML = '📥 Arrival Station'; }
    if(sub) sub.textContent = 'Recording participant arrival / time-in';
    if(scanText) scanText.textContent = 'SCAN FOR TIME-IN (ARRIVAL)';
    if(snapText) snapText.textContent = 'SNAP TIME-IN PHOTO';
    if(scanBtn){ scanBtn.className = 'btn big-action'; }
  }else if(mode==='checkout'){
    if(badge){ badge.className = 'station-badge out'; badge.innerHTML = '📤 Departure Station'; }
    if(sub) sub.textContent = 'Recording participant departure / logout';
    if(scanText) scanText.textContent = 'SCAN FOR LOGOUT (DEPARTURE)';
    if(snapText) snapText.textContent = 'SNAP LOGOUT PHOTO';
    if(scanBtn){ scanBtn.className = 'btn big-action mode-checkout'; }
  }else{
    if(badge){ badge.className = 'station-badge auto'; badge.innerHTML = '⚡ Smart Auto Gate'; }
    if(sub) sub.textContent = 'Auto-detecting arrival vs. departure';
    if(scanText) scanText.textContent = 'SCAN STUDENT QR';
    if(snapText) snapText.textContent = 'SNAP QR PHOTO (AUTO)';
    if(scanBtn){ scanBtn.className = 'btn big-action mode-auto'; }
  }

  if(activeParticipant){
    showParticipant(activeParticipant);
  }
}

function renderContext(){
  if(!context)return;
  $('pairPanel').classList.add('hidden');
  $('scannerPanel').classList.remove('hidden');
  $('eventName').textContent=context.eventName;
  $('eventVenue').textContent=`${context.eventDate} · ${context.venue}`;
  $('scannerName').textContent=context.scannerName;
  $('rosterCount').textContent=context.roster.length;

  const isDualStage = context.attendanceType === 'PRESENT_AND_LOGOUT';
  const checkOutBtn = $('modeCheckOutBtn');
  if(checkOutBtn){
    if(!isDualStage){
      checkOutBtn.disabled = true;
      checkOutBtn.title = 'Single Check-in Event: No departure tracking';
      checkOutBtn.querySelector('.station-btn-hint').textContent = 'Single Only';
      if(stationMode === 'checkout') stationMode = 'checkin';
    }else{
      checkOutBtn.disabled = false;
      checkOutBtn.title = '';
      checkOutBtn.querySelector('.station-btn-hint').textContent = 'Departure';
    }
  }
  setStationMode(stationMode);
}

function showPair(){
  stopCamera();
  $('scannerPanel').classList.add('hidden');
  $('pairPanel').classList.remove('hidden');
}

async function refreshContext(){
  if(!deviceId)return false;
  try{
    const c=await scannerFetch('/api/scanner/context');
    setConnection(true);
    await saveContext(c);
    return true;
  }catch(e){
    if(e.name==='AbortError'||/failed to fetch|network/i.test(e.message)){
      setConnection(false);
    }
    if(!context)context=await getApp('context');
    if(context)renderContext();
    return false;
  }
}

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

function isPairingToken(raw){
  if(!raw) return false;
  const s = raw.trim();
  if(s.includes('pair=') || s.includes('/scanner.html')) return true;
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
  return false;
}

async function pair(token){
  token = extractPairingToken(token);
  if(!token) return flash('Enter a pairing code.','error');
  try{
    flash('Pairing scanner phone...','warn');
    const res = await scannerFetch('/api/scanner/pair',{method:'POST',body:JSON.stringify({pairingToken:token})});
    await saveDevice(res.deviceId);
    setConnection(true);
    await saveContext(res.context);
    history.replaceState({},'', '/scanner.html');
    flash('Scanner phone paired successfully.');
    await updatePending();
  }catch(e){
    flash(e.message,'error');
  }
}

$('pairBtn').onclick=()=>pair($('pairingToken').value);
$('pairingToken').addEventListener('input', () => {
  const val = $('pairingToken').value;
  const cleaned = extractPairingToken(val);
  if (cleaned !== val) $('pairingToken').value = cleaned;
});

if($('rePairBtn')){
  $('rePairBtn').onclick = () => showPair();
}

function localByQr(token){
  if(!context?.roster) return null;
  token = (token||'').trim();
  let found = context.roster.find(r=>r.qrToken===token);
  if(found) return found;
  found = context.roster.find(r=>r.studentNumber.toLowerCase()===token.toLowerCase());
  if(found) return found;
  if(token.startsWith('EP1.')){
    const parts = token.split('.');
    if(parts.length>=2){
      found = context.roster.find(r=>r.qrToken && r.qrToken.includes('.'+parts[1]+'.'));
      if(found) return found;
    }
  }
  return null;
}

function toParticipant(r){
  return {
    registrationId:r.registrationId,
    studentNumber:r.studentNumber,
    fullName:r.fullName,
    program:r.program,
    registered:true,
    present:r.present,
    checkedInAt:r.checkedInAt,
    loggedOutAt:r.loggedOutAt,
    scannerName:r.scannerName,
    attendanceType:context?.attendanceType||'PRESENT_ONLY'
  };
}

async function resolveToken(token){
  token=(token||'').trim();
  if(!token)return flash('Paste or scan a QR token first.','error');

  // If a pairing code or URL was scanned, route it to pair()!
  if(isPairingToken(token)){
    const pToken = extractPairingToken(token);
    $('pairingToken').value = pToken;
    flash('Pairing code detected. Pairing phone...');
    return pair(pToken);
  }

  let p=null;
  if(serverConnected){
    try{
      p=await scannerFetch('/api/scanner/resolve',{method:'POST',body:JSON.stringify({qrToken:token})});
      setConnection(true);
    }catch(e){
      // Only mark OFFLINE on actual network disconnection, NOT on 4xx Bad Request or Not Found!
      const isNetworkError = !e.status && (e.name==='AbortError'||/failed to fetch|network|load failed/i.test(e.message));
      if(isNetworkError){
        setConnection(false);
      }
      p=localByQr(token)?toParticipant(localByQr(token)):null;
      if(!p){
        return flash(e.message||'QR could not be resolved.','error');
      }
    }
  }else{
    const r=localByQr(token);
    p=r?toParticipant(r):null;
    if(!p)return flash('QR not found in the prepared offline roster.','error');
  }
  showParticipant(p);
}

$('resolveManual').onclick=()=>resolveToken($('manualToken').value);

function showParticipant(p){
  activeParticipant=p;
  const el=$('participantPanel');
  el.classList.remove('hidden');
  const isDualStage=(context?.attendanceType==='PRESENT_AND_LOGOUT')||(p.attendanceType==='PRESENT_AND_LOGOUT');
  const hasCheckedIn = p.present;
  const hasLoggedOut = !!p.loggedOutAt;

  // Case 1: Attendance Completed (Both Checked In & Logged Out)
  if(hasCheckedIn && hasLoggedOut){
    const duration = formatDuration(p.checkedInAt, p.loggedOutAt);
    el.innerHTML=`<div class="participant completed">
      <div class="status" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">ATTENDANCE COMPLETED</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p style="margin-top:8px;">
        Time-In: <b>${time(p.checkedInAt)}</b><br>
        Logout: <b>${time(p.loggedOutAt)}</b><br>
        Total Duration: <b>${duration}</b><br>
        Scanner Gate: <b>${esc(p.scannerName||'Gate Scanner')}</b>
      </p>
    </div>
    <div style="margin-top:12px;">
      <button id="dismissParticipant" class="btn secondary full">DISMISS</button>
    </div>`;
    feedback('warn');
    $('dismissParticipant').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
    return;
  }

  // Case 2: Departure / Checkout Station Mode
  if(stationMode==='checkout'){
    if(!hasCheckedIn){
      // Warning: student hasn't checked in yet!
      el.innerHTML=`<div class="participant warning">
        <div class="status no">⚠️ NO ARRIVAL RECORDED</div>
        <h2>${esc(p.fullName)}</h2>
        <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
        <p style="margin-top:8px; color:var(--red);">
          This participant has not checked in to this event yet.<br>
          Departure cannot be recorded without an initial arrival record.
        </p>
      </div>
      <div class="confirm-row">
        <button id="cancelAttendance" class="btn secondary">CANCEL</button>
        <button id="forceArrivalBtn" class="btn" style="background:var(--green);">FORCE TIME-IN FIRST</button>
      </div>`;
      feedback('warn');
      $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
      $('forceArrivalBtn').onclick=()=>confirmAttendance(false);
      return;
    }

    // Student is present and ready for departure!
    const durationSoFar = formatDuration(p.checkedInAt, new Date());
    el.innerHTML=`<div class="participant departure">
      <div class="status ok" style="background:#eff6ff; color:#1d4ed8; border-color:#93c5fd;">READY FOR LOGOUT / DEPARTURE</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p style="margin-top:8px;">
        Time-In: <b>${time(p.checkedInAt)}</b> · Stay Duration: <b>${durationSoFar}</b><br>
        <span class="muted small">Confirming logout will record departure and complete attendance requirement.</span>
      </p>
    </div>
    <div class="confirm-row">
      <button id="cancelAttendance" class="btn secondary">CANCEL</button>
      <button id="confirmAttendance" class="btn btn-checkout">CONFIRM LOGOUT (DEPARTURE)</button>
    </div>`;
    $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
    $('confirmAttendance').onclick=()=>confirmAttendance(true);
    return;
  }

  // Case 3: Arrival / Checkin Station Mode
  if(stationMode==='checkin'){
    if(hasCheckedIn){
      // Student is already checked in
      el.innerHTML=`<div class="participant warning">
        <div class="status no">ALREADY CHECKED IN</div>
        <h2>${esc(p.fullName)}</h2>
        <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
        <p style="margin-top:8px;">
          Time-In Recorded: <b>${time(p.checkedInAt)}</b><br>
          Gate: <b>${esc(p.scannerName||'Gate Scanner')}</b>
        </p>
        ${isDualStage ? '<p class="muted small">Participant is already inside. If they are departing now, switch gate to Departure station below:</p>' : ''}
      </div>
      <div class="confirm-row">
        <button id="cancelAttendance" class="btn secondary">DISMISS</button>
        ${isDualStage ? '<button id="switchToLogoutBtn" class="btn btn-checkout">SWITCH &amp; RECORD LOGOUT</button>' : ''}
      </div>`;
      feedback('warn');
      $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
      if(isDualStage && $('switchToLogoutBtn')){
        $('switchToLogoutBtn').onclick=()=>{
          setStationMode('checkout');
          showParticipant(p);
        };
      }
      return;
    }

    // Student ready for Time-In
    el.innerHTML=`<div class="participant">
      <div class="status ok">PARTICIPANT FOUND · READY FOR ARRIVAL</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p style="margin-top:8px;">
        Status: <b>Registered</b><br>
        <span class="muted small">${isDualStage ? 'Stage 1 of 2: Arrival Check-In' : 'Single Check-in Attendance'}</span>
      </p>
    </div>
    <div class="confirm-row">
      <button id="cancelAttendance" class="btn secondary">CANCEL</button>
      <button id="confirmAttendance" class="btn" style="background:var(--green);">CONFIRM TIME-IN (ARRIVAL)</button>
    </div>`;
    $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
    $('confirmAttendance').onclick=()=>confirmAttendance(false);
    return;
  }

  // Case 4: Smart Auto Mode (Detect based on attendee status)
  if(hasCheckedIn && isDualStage){
    const durationSoFar = formatDuration(p.checkedInAt, new Date());
    el.innerHTML=`<div class="participant departure">
      <div class="status ok" style="background:#eff6ff; color:#1d4ed8; border-color:#93c5fd;">AUTO: READY FOR LOGOUT (DEPARTURE)</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p style="margin-top:8px;">
        Time-In: <b>${time(p.checkedInAt)}</b> (Stay: <b>${durationSoFar}</b>)<br>
        <span class="muted small">Detected existing check-in. Ready to record departure.</span>
      </p>
    </div>
    <div class="confirm-row">
      <button id="cancelAttendance" class="btn secondary">CANCEL</button>
      <button id="confirmAttendance" class="btn btn-checkout">CONFIRM LOGOUT / TIME-OUT</button>
    </div>`;
    $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
    $('confirmAttendance').onclick=()=>confirmAttendance(true);
    return;
  }

  if(hasCheckedIn && !isDualStage){
    el.innerHTML=`<div class="participant warning">
      <div class="status no">ALREADY CHECKED IN</div>
      <h2>${esc(p.fullName)}</h2>
      <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
      <p style="margin-top:8px;">Time-In: <b>${time(p.checkedInAt)}</b><br>Gate: <b>${esc(p.scannerName||'Gate Scanner')}</b></p>
    </div>
    <div style="margin-top:12px;">
      <button id="dismissParticipant" class="btn secondary full">DISMISS</button>
    </div>`;
    feedback('warn');
    $('dismissParticipant').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
    return;
  }

  // Not yet checked in in Auto mode
  el.innerHTML=`<div class="participant">
    <div class="status ok">AUTO: READY FOR TIME-IN (ARRIVAL)</div>
    <h2>${esc(p.fullName)}</h2>
    <div>${esc(p.studentNumber)} · ${esc(p.program)}</div>
    <p style="margin-top:8px;">
      Status: <b>Registered</b><br>
      <span class="muted small">${isDualStage ? 'Stage 1 of 2: Arrival Check-In' : 'Single Check-in Attendance'}</span>
    </p>
  </div>
  <div class="confirm-row">
    <button id="cancelAttendance" class="btn secondary">CANCEL</button>
    <button id="confirmAttendance" class="btn" style="background:var(--green);">CONFIRM TIME-IN</button>
  </div>`;
  $('cancelAttendance').onclick=()=>{activeParticipant=null;el.classList.add('hidden')};
  $('confirmAttendance').onclick=()=>confirmAttendance(false);
}

async function confirmAttendance(isLoggingOutExplicit = null){
  if(!activeParticipant)return;
  const isDualStage=(context?.attendanceType==='PRESENT_AND_LOGOUT')||(activeParticipant.attendanceType==='PRESENT_AND_LOGOUT');
  const isLoggingOut = isLoggingOutExplicit !== null ? isLoggingOutExplicit : (activeParticipant.present && isDualStage && !activeParticipant.loggedOutAt);
  const capturedAt=new Date().toISOString();
  const item={
    registrationId:activeParticipant.registrationId,
    clientTransactionId:uuid(),
    capturedAt,
    eventId:context.eventId,
    scannerDeviceId:deviceId,
    source:'OFFLINE'
  };

  const confirmBtn = $('confirmAttendance') || $('forceArrivalBtn');
  if(confirmBtn) confirmBtn.disabled=true;

  if(serverConnected){
    try{
      const r=await scannerFetch('/api/scanner/confirm',{method:'POST',body:JSON.stringify({...item,source:'ONLINE'})});
      setConnection(true);
      markRosterAttendance(r.registrationId,r.checkedInAt,r.loggedOutAt,r.scannerName);
      await putApp('context',context);
      feedback(isLoggingOut ? 'checkout' : 'checkin');
      showRecorded(r,false,isLoggingOut);
      return;
    }catch(e){
      if(!e.status && (e.name==='AbortError'||/failed to fetch|network/i.test(e.message))){
        setConnection(false);
      }
    }
  }

  await queuePut(item);
  markRosterAttendance(item.registrationId,isLoggingOut?activeParticipant.checkedInAt:item.capturedAt,isLoggingOut?item.capturedAt:null,context.scannerName);
  await putApp('context',context);
  await updatePending();
  feedback(isLoggingOut ? 'checkout' : 'checkin');
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
  const badgeClass = offline ? 'warn' : 'ok';
  const partClass = isLoggingOut ? 'participant departure' : 'participant';

  $('participantPanel').innerHTML=`<div class="${partClass}">
    <div class="status ${badgeClass}">${title}</div>
    <h2>${esc(name)}</h2>
    <p style="margin-top:8px;">${timeInfo}</p>
    ${offline?'<p class="muted small" style="margin-top:6px;">Stored locally in offline queue. Will synchronize automatically when server connection restores.</p>':''}
  </div>
  <div style="margin-top:12px;">
    <button id="dismissRecorded" class="btn secondary full">DONE / NEXT SCAN</button>
  </div>`;
  if($('dismissRecorded')){
    $('dismissRecorded').onclick = () => {
      activeParticipant = null;
      $('participantPanel').classList.add('hidden');
    };
  }
  activeParticipant=null;
}

$('studentSearch').addEventListener('input',()=>{
  const q=$('studentSearch').value.trim().toLowerCase();
  if(q.length<2){$('searchResults').innerHTML='';return}
  const rows=(context?.roster||[]).filter(r=>r.studentNumber.toLowerCase().includes(q)||r.fullName.toLowerCase().includes(q)).slice(0,10);
  $('searchResults').innerHTML=rows.map(r=>`<div class="search-item" data-id="${r.registrationId}"><b>${esc(r.fullName)}</b><br><span class="small">${esc(r.studentNumber)} · ${esc(r.program)} · ${r.present?(r.loggedOutAt?'Completed':'Present'):'Registered'}</span></div>`).join('')||'<div class="muted small">No registered participant found.</div>';
  document.querySelectorAll('.search-item').forEach(el=>el.onclick=()=>{
    const r=context.roster.find(x=>x.registrationId===Number(el.dataset.id));
    showParticipant(toParticipant(r));
    $('searchResults').innerHTML='';
    $('studentSearch').value='';
  });
});

async function syncPending(){
  if(!deviceId)return;
  const q=await updatePending();
  if(!q.length)return;
  let any=false;
  for(const item of q){
    try{
      const result=await scannerFetch('/api/scanner/sync',{method:'POST',body:JSON.stringify({items:[{registrationId:item.registrationId,clientTransactionId:item.clientTransactionId,capturedAt:item.capturedAt}]})});
      setConnection(true);
      await queueDelete(item.clientTransactionId);
      any=true;
      if(result[0])markRosterAttendance(result[0].registrationId,result[0].checkedInAt,result[0].loggedOutAt,result[0].scannerName);
    }catch(e){
      if(!e.status) setConnection(false);
      break;
    }
  }
  await updatePending();
  if(any){
    try{await refreshContext()}catch{}
    flash('Offline attendance synchronized.');
  }
}

async function decodeQr(source){
  if('BarcodeDetector' in window){
    try{
      const detector = new BarcodeDetector({formats:['qr_code']});
      const codes = await detector.detect(source);
      if(codes.length && codes[0].rawValue) return codes[0].rawValue;
    }catch{}
  }
  if(typeof jsQR !== 'function') return null;

  const canvas = $('qrCanvas') || document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rawW = source.videoWidth || source.naturalWidth || source.width || 0;
  const rawH = source.videoHeight || source.naturalHeight || source.height || 0;
  if(!rawW || !rawH) return null;

  const tryJsQr = (targetW, targetH, sx, sy, sw, sh) => {
    try{
      canvas.width = targetW;
      canvas.height = targetH;
      if(sw && sh){
        ctx.drawImage(source, sx, sy, sw, sh, 0, 0, targetW, targetH);
      }else{
        ctx.drawImage(source, 0, 0, targetW, targetH);
      }
      const imgData = ctx.getImageData(0, 0, targetW, targetH);
      const res = jsQR(imgData.data, targetW, targetH, { inversionAttempts: 'dontInvert' });
      if(res && res.data) return res.data;
      const resInv = jsQR(imgData.data, targetW, targetH, { inversionAttempts: 'onlyInvert' });
      if(resInv && resInv.data) return resInv.data;
    }catch{}
    return null;
  };

  // Pass 1: Scale down large photos to max dimension 1000px (lightning fast & high accuracy)
  const maxDim = 1000;
  let scale = 1;
  if(rawW > maxDim || rawH > maxDim){
    scale = Math.min(maxDim / rawW, maxDim / rawH);
  }
  const w1 = Math.round(rawW * scale);
  const h1 = Math.round(rawH * scale);
  let result = tryJsQr(w1, h1);
  if(result) return result;

  // Pass 2: Center crop (70% central area for photos where QR code is in middle)
  if(rawW > 700 && rawH > 700){
    const cropW = Math.round(rawW * 0.7);
    const cropH = Math.round(rawH * 0.7);
    const cropX = Math.round((rawW - cropW) / 2);
    const cropY = Math.round((rawH - cropH) / 2);
    const cropScale = Math.min(800 / cropW, 800 / cropH, 1);
    const cw = Math.round(cropW * cropScale);
    const ch = Math.round(cropH * cropScale);
    result = tryJsQr(cw, ch, cropX, cropY, cropW, cropH);
    if(result) return result;
  }

  // Pass 3: 600px scaling (great for dense or noisy camera photos)
  if(rawW > 600 || rawH > 600){
    const scale3 = Math.min(600 / rawW, 600 / rawH);
    const w3 = Math.round(rawW * scale3);
    const h3 = Math.round(rawH * scale3);
    result = tryJsQr(w3, h3);
    if(result) return result;
  }

  return null;
}

function openCameraSnapshot(mode='student'){
  cameraMode = mode;
  const input = $('cameraFileInput');
  if(input) input.click();
}

if($('snapPhotoBtn')){
  $('snapPhotoBtn').onclick = () => openCameraSnapshot('student');
}
if($('pairSnapBtn')){
  $('pairSnapBtn').onclick = () => openCameraSnapshot('pair');
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
            flash('QR code detected!');
            if(cameraMode==='pair' || isPairingToken(token)){
              const pToken = extractPairingToken(token);
              $('pairingToken').value = pToken;
              await pair(pToken);
            }else{
              $('manualToken').value = token;
              await resolveToken(token);
            }
          }else{
            flash('Could not detect QR code in photo. Please hold phone closer to the QR and try again.','error');
          }
        }catch(err){
          flash('Failed to read photo: ' + err.message, 'error');
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

async function startCamera(mode='student'){
  cameraMode = mode;
  const videoEl = mode==='pair' ? $('pairCamera') : $('camera');
  const boxEl = mode==='pair' ? $('pairCameraBox') : $('cameraBox');

  const hasLiveVideo = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if(!hasLiveVideo){
    flash('Opening camera for QR snapshot (no flags required)...');
    openCameraSnapshot(mode);
    return;
  }

  try{
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    if(videoEl) videoEl.srcObject = cameraStream;
    if(boxEl) boxEl.classList.remove('hidden');

    detectTimer = setInterval(async () => {
      try {
        const token = await decodeQr(videoEl);
        if(token){
          stopCamera();
          if(cameraMode==='pair' || isPairingToken(token)){
            const pToken = extractPairingToken(token);
            $('pairingToken').value = pToken;
            flash('Pairing QR code detected!');
            pair(pToken);
          }else{
            $('manualToken').value = token;
            resolveToken(token);
          }
        }
      } catch {}
    }, 380);
  }catch(e){
    flash('Live camera streaming unavailable on this connection. Opening camera snapshot...');
    openCameraSnapshot(mode);
  }
}

function stopCamera(){
  if(detectTimer){ clearInterval(detectTimer); detectTimer=null; }
  if(cameraStream){ cameraStream.getTracks().forEach(t=>t.stop()); cameraStream=null; }
  if($('cameraBox')) $('cameraBox').classList.add('hidden');
  if($('pairCameraBox')) $('pairCameraBox').classList.add('hidden');
}

if($('scanBtn')) $('scanBtn').onclick = () => startCamera('student');
if($('stopCamera')) $('stopCamera').onclick = stopCamera;

if($('pairScanBtn')) $('pairScanBtn').onclick = () => startCamera('pair');
if($('stopPairCamera')) $('stopPairCamera').onclick = stopCamera;

if($('modeCheckInBtn')) $('modeCheckInBtn').onclick = () => setStationMode('checkin');
if($('modeCheckOutBtn')) $('modeCheckOutBtn').onclick = () => setStationMode('checkout');
if($('modeAutoBtn')) $('modeAutoBtn').onclick = () => setStationMode('auto');

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