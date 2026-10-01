const state={events:[],students:[],registrations:[],attendanceSource:null,pollTimer:null,currentQr:null};
const $=id=>document.getElementById(id);
function flash(message,type='success'){const el=$('flash');el.textContent=message;el.className='notice '+type;setTimeout(()=>el.classList.add('hidden'),4500)}
async function api(url,options={}){const res=await fetch(url,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});if(res.status===401||res.status===403){location.href='/index.html';throw new Error('Unauthorized')}if(!res.ok){let msg='Request failed';try{const j=await res.json();msg=j.detail||j.message||j.error||msg}catch{}throw new Error(msg)}const ct=res.headers.get('content-type')||'';return ct.includes('application/json')?res.json():res.text()}
function fmtDate(v){return v?new Date(v+'T00:00:00').toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):''}
function fmtTime(v){return v?new Date(v).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—'}
function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}

document.querySelectorAll('.nav button').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));$(b.dataset.section).classList.add('active');if(b.dataset.section==='attendance')loadAttendance();if(b.dataset.section==='scanners')loadScanners()}));

async function loadDashboard(){const d=await api('/api/manager/dashboard');$('metrics').innerHTML=[['Events',d.events],['Students',d.students],['Registrations',d.registrations],['Attendance Records',d.attendance]].map(([k,v])=>`<div class="metric"><strong>${v}</strong><span>${k}</span></div>`).join('')}
async function loadEvents(){state.events=await api('/api/manager/events');$('eventsBody').innerHTML=state.events.map(e=>`<tr><td>${esc(e.name)}</td><td>${fmtDate(e.eventDate)}</td><td>${esc(e.venue)}</td><td>${e.registered}</td><td>${e.present}</td></tr>`).join('')||'<tr><td colspan="5">No events yet.</td></tr>';populateEventSelects()}
function populateEventSelects(){['registrationEvent','attendanceEvent','scannerEvent'].forEach(id=>{const el=$(id),old=el.value;el.innerHTML=state.events.map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');if(state.events.some(e=>String(e.id)===old))el.value=old});if(state.events.length){loadRegistrations();loadAttendance();loadScanners()}}
async function loadStudents(){state.students=await api('/api/manager/students');$('studentsBody').innerHTML=state.students.map(s=>`<tr><td>${esc(s.studentNumber)}</td><td>${esc(s.fullName)}</td><td>${esc(s.program)}</td></tr>`).join('');$('registrationStudent').innerHTML=state.students.map(s=>`<option value="${s.id}">${esc(s.studentNumber)} — ${esc(s.fullName)}</option>`).join('')}

async function loadRegistrations(){
  const id=$('registrationEvent').value;
  if(!id)return;
  state.registrations=await api(`/api/manager/events/${id}/registrations`);
  $('registrationsBody').innerHTML=state.registrations.map(r=>`<tr>
    <td>${esc(r.studentNumber)}</td>
    <td>${esc(r.fullName)}</td>
    <td>${esc(r.program)}</td>
    <td>${r.present?'<span class="status ok">Present</span>':'<span class="status no">Registered</span>'}</td>
    <td>
      <div class="row-actions">
        <button class="btn secondary small-btn" onclick="showQr(${r.id})">View / Print</button>
        <a class="btn secondary small-btn" href="/api/manager/registrations/${r.id}/qr" download="${esc(r.studentNumber)}-eventproof-qr.png">Download QR</a>
        ${r.present?`<button class="btn secondary small-btn" onclick="unpresentAttendee(${r.id},'${esc(r.fullName)}')">Unpresent</button>`:''}
      </div>
    </td>
  </tr>`).join('')||'<tr><td colspan="5">No registrations.</td></tr>';
}

async function loadAttendance(){
  const id=$('attendanceEvent').value;
  if(!id)return;
  const rows=await api(`/api/manager/events/${id}/attendance`);
  const present=rows.filter(r=>r.present).length;
  $('presentCount').textContent=`Present: ${present} / ${rows.length}`;
  $('presentCount').className='status '+(present?'ok':'no');
  $('attendanceBody').innerHTML=rows.map(r=>{
    let statusBadge='<span class="status no">Not Yet</span>';
    if(r.present){
      if(r.loggedOutAt) statusBadge='<span class="status" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">LOGGED OUT</span>';
      else statusBadge='<span class="status ok">PRESENT</span>';
    }
    const isDualStage=r.attendanceType==='PRESENT_AND_LOGOUT';
    let actions='—';
    if(r.present){
      actions=`<div class="row-actions">
        ${isDualStage && !r.loggedOutAt?`<button class="btn secondary small-btn" style="color:#2563eb; font-weight:600;" onclick="logoutAttendee(${r.id},'${esc(r.fullName)}')">Log Out</button>`:''}
        <button class="btn secondary small-btn" onclick="unpresentAttendee(${r.id},'${esc(r.fullName)}')">Unpresent</button>
      </div>`;
    }
    return `<tr>
      <td>${esc(r.studentNumber)}</td>
      <td>${esc(r.fullName)}</td>
      <td>${esc(r.program)}</td>
      <td>${statusBadge}</td>
      <td>${fmtTime(r.checkedInAt)}</td>
      <td>${fmtTime(r.loggedOutAt)}</td>
      <td>${esc(r.scannerName||'—')}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('')||'<tr><td colspan="8">No participants registered for this event.</td></tr>';
  connectSse(id);
}

function connectSse(eventId){if(state.attendanceSource)state.attendanceSource.close();try{const es=new EventSource(`/api/manager/events/${eventId}/stream`);es.addEventListener('attendance',()=>loadAttendance().catch(()=>{}));state.attendanceSource=es}catch{}if(state.pollTimer)clearInterval(state.pollTimer);state.pollTimer=setInterval(()=>{if($('attendance').classList.contains('active'))loadAttendance().catch(()=>{})},8000)}

async function loadScanners(){
  const id=$('scannerEvent').value;
  if(!id)return;
  const rows=await api(`/api/manager/events/${id}/scanners`);
  $('scannersBody').innerHTML=rows.map(s=>`<tr>
    <td>${esc(s.scannerName)}</td>
    <td>${s.paired?'<span class="status ok">Paired</span>':'<span class="status warn">Waiting</span>'}</td>
    <td>${new Date(s.createdAt).toLocaleString()}</td>
    <td><button class="btn secondary small-btn" onclick="showPair(${s.id})">Show Pairing QR</button></td>
    <td><button class="btn secondary small-btn" style="color:#ef4444; border-color:#fca5a5;" onclick="removeScanner(${s.id},'${esc(s.scannerName)}')">Remove</button></td>
  </tr>`).join('')||'<tr><td colspan="5">No scanners created.</td></tr>';
}

window.removeScanner=async(scannerId,scannerName)=>{
  if(!confirm(`Remove registered scanner "${scannerName}"? The device will be unpaired.`))return;
  const eventId=$('scannerEvent').value;
  try{
    await api(`/api/manager/events/${eventId}/scanners/${scannerId}`,{method:'DELETE'});
    flash(`Scanner "${scannerName}" removed.`);
    await loadScanners();
  }catch(err){flash(err.message,'error')}
};

window.logoutAttendee=async(id,name)=>{
  if(!confirm(`Record departure / logout for ${name||'attendee'}?`))return;
  const eventId=$('attendanceEvent').value;
  try{
    await api(`/api/manager/events/${eventId}/registrations/${id}/logout`,{method:'POST'});
    flash(`Attendee ${name||''} logged out.`);
    await Promise.all([loadAttendance(),loadRegistrations(),loadEvents(),loadDashboard()]);
  }catch(err){flash(err.message,'error')}
};

window.unpresentAttendee=async(id,name)=>{
  if(!confirm(`Mark ${name||'attendee'} as absent (unpresent)? This resets check-in so you can re-scan them in your live demo.`))return;
  const eventId=$('attendanceEvent').value||$('registrationEvent').value;
  try{
    await api(`/api/manager/events/${eventId}/registrations/${id}/unpresent`,{method:'POST'});
    flash(`Attendee ${name||''} marked absent.`);
    await Promise.all([loadAttendance(),loadRegistrations(),loadEvents(),loadDashboard()]);
  }catch(err){flash(err.message,'error')}
};

if($('studentForm'))$('studentForm').addEventListener('submit',async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));try{await api('/api/manager/students',{method:'POST',body:JSON.stringify(f)});e.target.reset();await Promise.all([loadStudents(),loadDashboard()]);flash('Student added.')}catch(err){flash(err.message,'error')}});
$('registerBtn').addEventListener('click',async()=>{const eventId=$('registrationEvent').value,studentId=Number($('registrationStudent').value);if(!eventId||!studentId)return;try{await api(`/api/manager/events/${eventId}/registrations`,{method:'POST',body:JSON.stringify({studentId})});await Promise.all([loadRegistrations(),loadEvents(),loadDashboard()]);flash('Student registered to event.')}catch(err){flash(err.message,'error')}});
$('registrationEvent').addEventListener('change',loadRegistrations);$('attendanceEvent').addEventListener('change',loadAttendance);$('scannerEvent').addEventListener('change',loadScanners);
$('createScanner').addEventListener('click',async()=>{const eventId=$('scannerEvent').value,scannerName=$('scannerName').value.trim();if(!scannerName)return flash('Enter a scanner name.','error');try{const s=await api(`/api/manager/events/${eventId}/scanners`,{method:'POST',body:JSON.stringify({scannerName})});$('scannerName').value='';await loadScanners();flash('Scanner created. Pair the phone using its QR code.');showPair(s.id)}catch(err){flash(err.message,'error')}});

window.showQr=async id=>{const r=state.registrations.find(x=>x.id===id);if(!r)return;const event=state.events.find(e=>e.id===r.eventId);state.currentQr={r,event};$('qrTitle').textContent='Event QR Pass';$('qrDetails').innerHTML=`<b>${esc(r.fullName)}</b><br>${esc(r.studentNumber)} · ${esc(r.program)}<br><span class="muted">${esc(event?.name||'')}</span>`;$('qrImage').src=`/api/manager/registrations/${id}/qr`;$('qrToken').textContent=r.qrToken;$('qrModal').classList.remove('hidden')};
$('closeQr').onclick=()=>$('qrModal').classList.add('hidden');
$('printPass').onclick=()=>{const x=state.currentQr;if(!x)return;const w=window.open('','_blank');w.document.write(`<!doctype html><title>EventProof Pass</title><style>body{font-family:Arial;text-align:center;padding:40px}img{width:320px}.box{border:1px solid #bbb;padding:25px;max-width:520px;margin:auto}</style><div class="box"><h1>EventProof Event Pass</h1><h2>${esc(x.r.fullName)}</h2><p>${esc(x.r.studentNumber)} · ${esc(x.r.program)}</p><p>${esc(x.event?.name||'')}</p><img src="${$('qrImage').src}"><p>Present this QR to authorized scanner staff.</p></div><script>window.onload=()=>window.print()<\/script>`);w.document.close()};
window.showPair = async id => {
  try {
    const info = await api(`/api/manager/scanners/${id}/pairing`);
    $('pairQr').src = `/api/manager/scanners/${id}/pairing-qr`;
    $('pairTokenOnly').value = info.pairingToken || '';
    $('pairUrl').textContent = info.pairingUrl || '';

    // Copy pure code handler
    $('copyPairTokenBtn').onclick = () => {
      const code = $('pairTokenOnly').value;
      if (!code) return;
      navigator.clipboard.writeText(code).then(() => {
        const btn = $('copyPairTokenBtn');
        const oldText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.backgroundColor = '#16a34a';
        setTimeout(() => {
          btn.textContent = oldText;
          btn.style.backgroundColor = '';
        }, 2200);
        flash('Pairing code copied to clipboard!');
      }).catch(() => {
        $('pairTokenOnly').select();
        document.execCommand('copy');
        flash('Pairing code copied!');
      });
    };

    // Copy direct link handler
    $('copyPairUrlBtn').onclick = () => {
      const url = $('pairUrl').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(() => {
        const btn = $('copyPairUrlBtn');
        const oldText = btn.textContent;
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = oldText; }, 2200);
        flash('Direct scanner link copied to clipboard!');
      }).catch(() => {
        flash('Link: ' + url);
      });
    };

    $('pairModal').classList.remove('hidden');
  } catch(err) {
    flash(err.message, 'error');
  }
};
$('closePair').onclick=()=>$('pairModal').classList.add('hidden');

// ==========================================================================
// Embedded 4-Step Institutional Event Maker
// ==========================================================================
let wizStep = 1;
let wizSelectedStudentIds = new Set();
const wizStepsTotal = 4;
const wizStepTitles = [
  'Event Details',
  'Participants & Scope',
  'Attendance & Stations',
  'Review & Publish'
];

function initEventMaker(){
  wizStep = 1;
  if(!$('wizDate').value){
    $('wizDate').value = new Date(Date.now()+86400000).toISOString().split('T')[0];
  }
  populateDeptOptions();
  applyScope('ALL');
  renderWizardStep();
}

function populateDeptOptions(){
  const sel = $('wizDeptSelect');
  if(!sel) return;
  const counts = {};
  state.students.forEach(s=>{ counts[s.program] = (counts[s.program]||0)+1; });
  sel.innerHTML = Object.entries(counts).map(([dept, c])=>`<option value="${esc(dept)}">${esc(dept)} Department (${c} Students)</option>`).join('');
}

function applyScope(scope){
  if(scope === 'ALL'){
    $('deptSelectWrap').classList.add('hidden');
    wizSelectedStudentIds = new Set(state.students.map(s => s.id));
  } else if(scope === 'DEPT'){
    $('deptSelectWrap').classList.remove('hidden');
    const selectedDept = $('wizDeptSelect').value;
    wizSelectedStudentIds = new Set(state.students.filter(s => s.program === selectedDept).map(s => s.id));
  } else if(scope === 'CUSTOM'){
    $('deptSelectWrap').classList.add('hidden');
  }
  document.querySelectorAll('input[name="wizScope"]').forEach(r => {
    const card = r.closest('.scope-card');
    if(card) card.classList.toggle('active', r.value === scope);
  });
  renderWizardRoster($('wizStudentSearch').value);
}

document.querySelectorAll('input[name="wizScope"]').forEach(radio => {
  radio.addEventListener('change', () => applyScope(radio.value));
});

if($('wizDeptSelect')){
  $('wizDeptSelect').addEventListener('change', () => {
    const selectedDept = $('wizDeptSelect').value;
    wizSelectedStudentIds = new Set(state.students.filter(s => s.program === selectedDept).map(s => s.id));
    renderWizardRoster($('wizStudentSearch').value);
  });
}

document.querySelectorAll('input[name="wizAttendanceType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('input[name="wizAttendanceType"]').forEach(r => {
      const card = r.closest('.scope-card');
      if(card) card.classList.toggle('active', r.checked);
    });
  });
});

function renderWizardStep(){
  $('makerSubtitle').textContent = `Step ${wizStep} of ${wizStepsTotal}: ${wizStepTitles[wizStep-1]}`;

  for(let i=1; i<=wizStepsTotal; i++){
    const pill = $(`stepPill${i}`);
    const content = $(`wizardStep${i}`);
    if(pill){
      pill.classList.remove('active','completed');
      if(i === wizStep) pill.classList.add('active');
      else if(i < wizStep) pill.classList.add('completed');
    }
    if(content){
      if(i === wizStep) content.classList.remove('hidden');
      else content.classList.add('hidden');
    }
  }

  // Back button
  if(wizStep > 1) $('wizBackBtn').classList.remove('hidden');
  else $('wizBackBtn').classList.add('hidden');

  // Next / Submit button
  const nextBtn = $('wizNextBtn');
  if(wizStep === 1) nextBtn.textContent = 'Next: Participants →';
  else if(wizStep === 2) nextBtn.textContent = 'Next: Attendance →';
  else if(wizStep === 3) nextBtn.textContent = 'Next: Review →';
  else if(wizStep === 4){
    nextBtn.textContent = '🚀 Create & Publish Event';
    populateWizardReview();
  }
}

// Stepper bar clicks
for(let i=1; i<=wizStepsTotal; i++){
  const stepIdx = i;
  $(`stepPill${stepIdx}`).onclick = () => {
    if(stepIdx < wizStep){
      wizStep = stepIdx;
      renderWizardStep();
    }
  };
}

$('wizBackBtn').onclick = () => {
  if(wizStep > 1){
    wizStep--;
    renderWizardStep();
  }
};

$('wizResetBtn').onclick = () => {
  if(!confirm('Reset the event maker form?')) return;
  $('wizEventName').value = '';
  $('wizOrganizer').value = '';
  $('wizVenue').value = '';
  $('wizDate').value = new Date(Date.now()+86400000).toISOString().split('T')[0];
  $('wizStart').value = '09:00';
  $('wizEnd').value = '17:00';
  $('wizDescription').value = '';
  $('wizScannerName').value = 'Main Entrance Scanner 1';
  document.querySelector('input[name="wizScope"][value="ALL"]').checked = true;
  document.querySelector('input[name="wizAttendanceType"][value="PRESENT_ONLY"]').checked = true;
  document.querySelectorAll('input[name="wizAttendanceType"]').forEach(r => {
    r.closest('.scope-card')?.classList.toggle('active', r.value === 'PRESENT_ONLY');
  });
  applyScope('ALL');
  wizStep = 1;
  renderWizardStep();
};

$('wizNextBtn').onclick = async () => {
  if(wizStep === 1){
    const name = $('wizEventName').value.trim();
    const venue = $('wizVenue').value.trim();
    const date = $('wizDate').value;
    const start = $('wizStart').value;
    const end = $('wizEnd').value;
    if(!name) return flash('Please enter an Event Name.','error');
    if(!venue) return flash('Please enter a Venue.','error');
    if(!date) return flash('Please select an Event Date.','error');
    if(!start || !end) return flash('Please select Start and End times.','error');
    if(end <= start) return flash('End time must be after Start time.','error');
    wizStep = 2;
    renderWizardStep();
  } else if(wizStep === 2){
    if(wizSelectedStudentIds.size === 0){
      if(!confirm('No students are selected. Create event without pre-enrolled attendees?')) return;
    }
    wizStep = 3;
    renderWizardStep();
  } else if(wizStep === 3){
    wizStep = 4;
    renderWizardStep();
  } else if(wizStep === 4){
    await submitWizardEvent();
  }
};

function renderWizardRoster(filterText=''){
  const container = $('wizRosterContainer');
  const q = (filterText||'').toLowerCase().trim();
  const list = state.students.filter(s => !q || s.fullName.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q));

  $('wizRosterCount').textContent = `${wizSelectedStudentIds.size} of ${state.students.length} selected`;

  if(!list.length){
    container.innerHTML = '<div class="muted small" style="padding:20px; text-align:center;">No students matching search.</div>';
    return;
  }

  container.innerHTML = list.map(s => {
    const checked = wizSelectedStudentIds.has(s.id);
    return `
      <div class="wizard-roster-row ${checked?'selected':''}" data-id="${s.id}">
        <input type="checkbox" ${checked?'checked':''} data-id="${s.id}" style="cursor:pointer; width:17px; height:17px;">
        <div style="flex:1;">
          <b style="font-size:0.88rem; display:block;">${esc(s.fullName)}</b>
          <span class="muted small mono">${esc(s.studentNumber)} &bull; ${esc(s.program)}</span>
        </div>
        <span class="status ${checked?'ok':'no'}" style="font-size:0.7rem; padding:2px 8px;">${checked?'ENROLLED':'EXCLUDED'}</span>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.wizard-roster-row').forEach(row => {
    row.onclick = e => {
      if(e.target.tagName === 'INPUT') return;
      const id = Number(row.dataset.id);
      if(wizSelectedStudentIds.has(id)) wizSelectedStudentIds.delete(id);
      else wizSelectedStudentIds.add(id);
      // Switch scope radio to custom if manually toggling individual checkboxes
      const customRadio = document.querySelector('input[name="wizScope"][value="CUSTOM"]');
      if(customRadio) {
        customRadio.checked = true;
        document.querySelectorAll('input[name="wizScope"]').forEach(r => r.closest('.scope-card')?.classList.toggle('active', r.value === 'CUSTOM'));
        $('deptSelectWrap').classList.add('hidden');
      }
      renderWizardRoster($('wizStudentSearch').value);
    };
    const cb = row.querySelector('input[type="checkbox"]');
    if(cb){
      cb.onchange = () => {
        const id = Number(cb.dataset.id);
        if(cb.checked) wizSelectedStudentIds.add(id);
        else wizSelectedStudentIds.delete(id);
        const customRadio = document.querySelector('input[name="wizScope"][value="CUSTOM"]');
        if(customRadio) {
          customRadio.checked = true;
          document.querySelectorAll('input[name="wizScope"]').forEach(r => r.closest('.scope-card')?.classList.toggle('active', r.value === 'CUSTOM'));
          $('deptSelectWrap').classList.add('hidden');
        }
        renderWizardRoster($('wizStudentSearch').value);
      };
    }
  });
}

$('wizStudentSearch').oninput = () => {
  renderWizardRoster($('wizStudentSearch').value);
};

$('wizSelectAllBtn').onclick = () => {
  state.students.forEach(s => wizSelectedStudentIds.add(s.id));
  const allRadio = document.querySelector('input[name="wizScope"][value="ALL"]');
  if(allRadio){
    allRadio.checked = true;
    document.querySelectorAll('input[name="wizScope"]').forEach(r => r.closest('.scope-card')?.classList.toggle('active', r.value === 'ALL'));
    $('deptSelectWrap').classList.add('hidden');
  }
  renderWizardRoster($('wizStudentSearch').value);
};

$('wizClearAllBtn').onclick = () => {
  wizSelectedStudentIds.clear();
  const customRadio = document.querySelector('input[name="wizScope"][value="CUSTOM"]');
  if(customRadio){
    customRadio.checked = true;
    document.querySelectorAll('input[name="wizScope"]').forEach(r => r.closest('.scope-card')?.classList.toggle('active', r.value === 'CUSTOM'));
    $('deptSelectWrap').classList.add('hidden');
  }
  renderWizardRoster($('wizStudentSearch').value);
};

function populateWizardReview(){
  $('revName').textContent = $('wizEventName').value.trim() || '—';
  $('revOrganizer').textContent = $('wizOrganizer').value.trim() || 'College Department';
  $('revVenue').textContent = $('wizVenue').value.trim() || 'Auditorium';
  $('revDate').textContent = fmtDate($('wizDate').value);
  $('revTime').textContent = `${$('wizStart').value} — ${$('wizEnd').value}`;
  
  const attType = document.querySelector('input[name="wizAttendanceType"]:checked')?.value || 'PRESENT_ONLY';
  if(attType === 'PRESENT_AND_LOGOUT'){
    $('revAttType').textContent = 'Present and Logout (Two-Stage)';
    $('revAttTypeDesc').textContent = 'Requires Time-In on arrival & Time-Out on departure';
  } else {
    $('revAttType').textContent = 'Present Only (Single Check-In)';
    $('revAttTypeDesc').textContent = 'Single Time-In check-in upon arrival';
  }

  const scope = document.querySelector('input[name="wizScope"]:checked')?.value || 'ALL';
  $('revAttendees').textContent = `${wizSelectedStudentIds.size} Participants Enrolled`;
  if(scope === 'ALL') $('revScopeDesc').textContent = 'Scope: Open to All Students';
  else if(scope === 'DEPT') $('revScopeDesc').textContent = `Scope: ${$('wizDeptSelect').value} Department`;
  else $('revScopeDesc').textContent = 'Scope: Custom Selection';

  $('revScanner').textContent = $('wizScannerName').value.trim() || 'Main Entrance Scanner 1';
}

async function submitWizardEvent(){
  const btn = $('wizNextBtn');
  btn.disabled = true;
  btn.textContent = 'Publishing Event...';
  const payload = {
    name: $('wizEventName').value.trim(),
    organizer: $('wizOrganizer').value.trim() || null,
    venue: $('wizVenue').value.trim(),
    eventDate: $('wizDate').value,
    startTime: $('wizStart').value,
    endTime: $('wizEnd').value,
    description: $('wizDescription').value.trim() || null,
    attendanceType: document.querySelector('input[name="wizAttendanceType"]:checked')?.value || 'PRESENT_ONLY',
    studentIds: Array.from(wizSelectedStudentIds),
    scannerName: $('wizScannerName').value.trim() || 'Main Entrance Scanner 1'
  };

  try{
    const created = await api('/api/manager/events', {method:'POST', body:JSON.stringify(payload)});
    flash(`Institutional Event "${created.name}" created with ${payload.studentIds.length} enrolled attendees!`);
    await Promise.all([loadEvents(), loadDashboard(), loadStudents()]);
    ['registrationEvent','attendanceEvent','scannerEvent'].forEach(id => {
      $(id).value = created.id;
    });
    await Promise.all([loadRegistrations(), loadAttendance(), loadScanners()]);
    // Reset form for next event
    $('wizResetBtn').click();
  }catch(err){
    flash(err.message, 'error');
  }finally{
    btn.disabled = false;
    btn.textContent = '🚀 Create & Publish Event';
  }
}

(async()=>{
  try{
    await Promise.all([loadDashboard(), loadEvents(), loadStudents()]);
    initEventMaker();
  }catch(err){
    flash(err.message,'error');
  }
})();

