const $=id=>document.getElementById(id);
let events=[], templatesList=[], currentTemplate=null, selectedElementIndex=null, samplePreview=false, historyStack=[];

function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function flash(m,t='success'){const e=$('flash');e.textContent=m;e.className='notice '+t;setTimeout(()=>e.classList.add('hidden'),4000)}

async function api(url,o={}){
  const r=await fetch(url,{headers:{'Content-Type':'application/json',...(o.headers||{})},...o});
  if(r.status===401||r.status===403){location.href='/index.html';throw new Error('Unauthorized')}
  if(!r.ok){
    let m='Request failed';
    try{const j=await r.json();m=j.detail||j.message||j.error||m}catch{}
    throw new Error(m);
  }
  const ct=r.headers.get('content-type')||'';
  return ct.includes('application/json')?r.json():r.text();
}

// Navigation Tabs
document.querySelectorAll('.nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('.nav button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.section').forEach(x=>x.classList.remove('active'));
  $(b.dataset.section).classList.add('active');
  if(b.dataset.section==='templates')loadTemplates();
  if(b.dataset.section==='users')loadUsers();
  if(b.dataset.section==='settings')loadSettings();
});

window.navigateToSection = function(sec, targetEventId) {
  const btn = document.querySelector(`.nav button[data-section="${sec}"]`);
  if (btn) btn.click();
  if (targetEventId) {
    if (sec === 'certificates' && $('certEvent')) {
      $('certEvent').value = targetEventId;
      updateBulkLinks();
      loadEligibility();
    } else if (sec === 'templates' && $('templateEventSelect')) {
      $('templateEventSelect').value = targetEventId;
      const match = templatesList.find(t => String(t.eventId) === String(targetEventId));
      if (match) selectTemplate(match.id);
    }
  }
};

// Dashboard & Events
async function loadEvents(){
  events = await api('/api/admin/events');
  $('certEvent').innerHTML = events.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');

  const reg = events.reduce((a, e) => a + (e.registered || 0), 0);
  const present = events.reduce((a, e) => a + (e.present || 0), 0);
  const issued = events.reduce((a, e) => a + (e.certificatesIssued || 0), 0);
  const attRate = reg > 0 ? Math.round((present / reg) * 100) : 0;
  const certRate = present > 0 ? Math.round((issued / present) * 100) : 0;

  $('adminMetrics').innerHTML = `
    <div class="metric">
      <strong>${events.length}</strong>
      <span>Active Events</span>
      <span class="kpi-sub">Campus Plenaries &amp; Colloquiums</span>
    </div>
    <div class="metric">
      <strong>${reg}</strong>
      <span>Total Registrations</span>
      <span class="kpi-sub">Enrolled student attendees</span>
    </div>
    <div class="metric">
      <strong>${present} <small style="font-size:0.95rem; font-weight:600; color:#10b981;">(${attRate}%)</small></strong>
      <span>Verified Attendance</span>
      <span class="kpi-sub">Marked Present at Station</span>
    </div>
    <div class="metric">
      <strong>${issued} <small style="font-size:0.95rem; font-weight:600; color:#2563eb;">(${certRate}%)</small></strong>
      <span>Certificates Issued</span>
      <span class="kpi-sub">Ed25519 Cryptographically Signed</span>
    </div>
  `;

  // Populate Dashboard Events Breakdown Table
  const tbody = $('dashEventsBody');
  if (tbody) {
    if (!events.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="muted small" style="text-align:center; padding:20px;">No events scheduled in the system yet.</td></tr>';
    } else {
      tbody.innerHTML = events.map(e => {
        const eReg = e.registered || 0;
        const ePres = e.present || 0;
        const eIss = e.certificatesIssued || 0;
        const rate = eReg > 0 ? Math.round((ePres / eReg) * 100) : 0;
        const issRate = ePres > 0 ? Math.round((eIss / ePres) * 100) : 0;
        const isFullAtt = rate >= 100;

        return `
          <tr>
            <td>
              <div style="font-weight:700; color:#0f172a; font-size:0.92rem;">${esc(e.name)}</div>
              <div class="muted small" style="font-size:0.75rem; display:flex; align-items:center; gap:4px; margin-top:2px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#64748b;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                <span>${esc(e.venue || 'Campus Venue')}</span>
              </div>
            </td>
            <td style="white-space:nowrap; font-size:0.85rem; color:#475569;">
              ${esc(e.eventDate || '-')}
            </td>
            <td>
              <span class="mono" style="font-weight:700; font-size:0.88rem;">${eReg}</span>
              <span class="muted small"> students</span>
            </td>
            <td>
              <div class="dash-progress-wrap">
                <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:650;">
                  <span>${ePres} / ${eReg}</span>
                  <span style="color:${rate > 0 ? '#1d4ed8' : '#94a3b8'};">${rate}%</span>
                </div>
                <div class="dash-progress-track">
                  <div class="dash-progress-fill ${isFullAtt ? 'full' : ''}" style="width:${rate}%;"></div>
                </div>
              </div>
            </td>
            <td>
              <span class="status ${eIss > 0 ? 'ok' : 'warn'}" style="font-size:0.72rem; padding:2px 8px;">
                ${eIss} / ${ePres} (${issRate}%)
              </span>
            </td>
            <td style="text-align:right; white-space:nowrap;">
              <button class="btn secondary small-btn" style="padding:4px 9px; font-size:0.75rem; margin-right:4px;" onclick="navigateToSection('certificates', ${e.id})" title="Issue certificates for this event">Certificates</button>
              <button class="btn secondary small-btn" style="padding:4px 9px; font-size:0.75rem;" onclick="navigateToSection('templates', ${e.id})" title="Design template for this event">Design</button>
            </td>
          </tr>
        `;
      }).join('');
    }
  }

  if(events.length){
    updateBulkLinks();
    loadEligibility();
  }
}

function updateBulkLinks(){
  const id=$('certEvent').value;
  if(!id)return;
  $('downloadZipBtn').href=`/api/admin/events/${id}/certificates/zip`;
}
$('certEvent').onchange=()=>{updateBulkLinks();loadEligibility()};

// Eligibility Table & Actions
async function loadEligibility(){
  const id=$('certEvent').value;
  if(!id)return;
  const rows=await api(`/api/admin/events/${id}/eligibility`);
  $('eligibilityBody').innerHTML=rows.map(r=>`
    <tr>
      <td>${esc(r.studentNumber)}</td>
      <td>${esc(r.fullName)}</td>
      <td>${esc(r.program)}</td>
      <td>${r.present?'<span class="status ok">Eligible</span>':'<span class="status no">Absent</span>'}</td>
      <td>${r.certificateId?`
        <div class="row-actions">
          <a class="btn secondary small-btn" href="/api/admin/certificates/${encodeURIComponent(r.certificateId)}/pdf" title="Download signed PDF">Download ${esc(r.certificateId)}</a>
          ${r.certificateStatus==='VALID'?`
            <button class="btn danger small-btn" onclick="revokeCertificate('${esc(r.certificateId)}')">Revoke</button>
          `:`
            <span class="status no">${esc(r.certificateStatus)}</span>
            <button class="btn secondary small-btn" onclick="unrevokeCertificate('${esc(r.certificateId)}')" title="Restore certificate back to VALID">Unrevoke</button>
          `}
        </div>
      `:r.present?`
        <button class="btn small-btn" onclick="generateCertificate(${r.registrationId})">Generate PDF</button>
      `:'—'}</td>
    </tr>
  `).join('')||'<tr><td colspan="5">No participants registered for this event.</td></tr>';
}

// Single Certificate Actions
window.revokeCertificate=async certificateId=>{
  if(!confirm('Are you sure you want to revoke this certificate? Public verification will report it as REVOKED.'))return;
  try{
    await api(`/api/admin/certificates/${encodeURIComponent(certificateId)}/revoke`,{method:'POST',body:'{}'});
    flash('Certificate revoked.');
    await loadEligibility();
  }catch(e){flash(e.message,'error')}
};

window.unrevokeCertificate=async certificateId=>{
  if(!confirm('Restore and unrevoke this certificate back to VALID?'))return;
  try{
    await api(`/api/admin/certificates/${encodeURIComponent(certificateId)}/unrevoke`,{method:'POST',body:'{}'});
    flash('Certificate reinstated to VALID.');
    await loadEligibility();
  }catch(e){flash(e.message,'error')}
};

window.generateCertificate=async registrationId=>{
  try{
    const c=await api('/api/admin/certificates/generate',{method:'POST',body:JSON.stringify({registrationId})});
    flash(`Certificate ${c.certificateId} generated.`);
    await loadEligibility();
    location.href=`/api/admin/certificates/${encodeURIComponent(c.certificateId)}/pdf`;
  }catch(e){flash(e.message,'error')}
};

// Bulk Operations
$('generateAllBtn').onclick=async()=>{
  const id=$('certEvent').value;
  if(!id)return flash('Select an event first.','error');
  if(!confirm('Generate certificates for all present attendees of this event in one operation?'))return;
  try{
    const list=await api(`/api/admin/events/${id}/certificates/generate-all`,{method:'POST',body:'{}'});
    flash(`Bulk generation complete: ${list.length} certificate(s) ready.`);
    await loadEligibility();
  }catch(e){flash(e.message,'error')}
};

// Users
async function loadUsers(){
  const rows=await api('/api/admin/users');
  $('usersBody').innerHTML=rows.map(u=>`
    <tr>
      <td>${esc(u.username)}</td>
      <td>${esc(u.role.replaceAll('_',' '))}</td>
      <td>${u.enabled?'<span class="status ok">Enabled</span>':'<span class="status no">Disabled</span>'}</td>
    </tr>
  `).join('');
}

$('userForm').onsubmit=async e=>{
  e.preventDefault();
  const f=Object.fromEntries(new FormData(e.target));
  try{
    await api('/api/admin/users',{method:'POST',body:JSON.stringify(f)});
    e.target.reset();
    flash('User created.');
    loadUsers();
  }catch(err){flash(err.message,'error')}
};

// Settings & In-Settings Certificate Verification
async function loadSettings(){
  const s=await api('/api/admin/settings');
  $('settingsBody').innerHTML=`
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
      <div>
        <p><b>Application:</b> ${esc(s.application)}</p>
        <p><b>Database Engine:</b> ${esc(s.database)}</p>
      </div>
      <div>
        <p><b>Network Topology:</b> ${esc(s.networkMode)}</p>
        <p><b>Cryptographic Signing:</b> ${esc(s.certificateSigning)}</p>
        <p class="small mono muted"><b>Public Key:</b> ${esc(s.publicKeyPath)}</p>
      </div>
    </div>
  `;
}

$('verifyCertInput').addEventListener('input',()=>{
  const val=$('verifyCertInput').value.trim();
  if(val.includes('id=')){
    try{
      const u=new URL(val.startsWith('http')?val:'http://x/'+val);
      const qId=u.searchParams.get('id'),qToken=u.searchParams.get('token');
      if(qId)$('verifyCertInput').value=qId;
      if(qToken)$('verifyTokenInput').value=qToken;
    }catch{}
  }
});

$('verifyInSettingsBtn').onclick=async()=>{
  const id=$('verifyCertInput').value.trim();
  const token=$('verifyTokenInput').value.trim();
  const box=$('settingsVerifyResult');
  if(!id)return flash('Enter a Certificate ID to verify.','error');
  box.classList.remove('hidden');
  box.innerHTML='<div class="muted">Querying cryptographic ledger...</div>';
  try{
    const r=await api(`/api/verify/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`);
    const isOk=r.status==='VALID';
    box.innerHTML=`
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <span class="status ${isOk?'ok':r.status==='REVOKED'?'no':'warn'}" style="font-size:0.95rem; padding:6px 14px;">
          ${esc(r.status)} CERTIFICATE
        </span>
        <a href="/verify.html?id=${encodeURIComponent(id)}&token=${encodeURIComponent(token)}" target="_blank" class="small">Open Public Verification &rarr;</a>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.9rem;">
        <div><b>Participant:</b> ${esc(r.participant||'—')}</div>
        <div><b>Event:</b> ${esc(r.eventName||'—')}</div>
        <div><b>Issue Date:</b> ${r.issueDate?new Date(r.issueDate).toLocaleDateString():'—'}</div>
        <div><b>Certificate ID:</b> <span class="mono">${esc(r.certificateId||id)}</span></div>
        <div style="grid-column:1/-1; margin-top:8px; padding-top:8px; border-top:1px solid #e2e8f0;" class="small muted">
          <b>Signature Status:</b> ${token?(isOk?'Cryptographically Valid (Ed25519)':'Signature Token Mismatch / Untrusted'):'Unsigned Query (Checked stored record)'}
        </div>
      </div>
    `;
  }catch(e){
    box.innerHTML=`<div class="status no">VERIFICATION FAILED</div><p class="small muted">${esc(e.message)}</p>`;
  }
};

// ==========================================================================
// Certificate Template Designer (Canvas, Drag & Drop, Inspector)
// ==========================================================================

async function loadTemplates(){
  templatesList=await api('/api/admin/templates');
  $('templateSelect').innerHTML=templatesList.map(t=>`
    <option value="${t.id}">${esc(t.name)} ${t.isDefault?'(Default)':''}</option>
  `).join('');
  
  $('templateEventSelect').innerHTML='<option value="">Global Template (Default)</option>' +
    events.map(e=>`<option value="${e.id}">Event: ${esc(e.name)}</option>`).join('');

  if(templatesList.length){
    selectTemplate(templatesList[0].id);
  }
}

$('templateSelect').onchange=()=>selectTemplate($('templateSelect').value);

function selectTemplate(id){
  const t=templatesList.find(x=>String(x.id)===String(id));
  if(!t)return;
  currentTemplate=JSON.parse(JSON.stringify(t));
  if(typeof currentTemplate.layoutJson==='string'){
    try{currentTemplate.layout=JSON.parse(currentTemplate.layoutJson)}catch{currentTemplate.layout={elements:[]}}
  }else{
    currentTemplate.layout=currentTemplate.layoutJson||{elements:[]};
  }
  if(!currentTemplate.layout.elements)currentTemplate.layout.elements=[];
  
  $('templateEventSelect').value=currentTemplate.eventId||'';
  $('templateOrientationBadge').textContent=currentTemplate.orientation||'LANDSCAPE';
  $('templateDimensionsBadge').innerHTML=`${currentTemplate.width||842} &times; ${currentTemplate.height||595} PX`;
  
  historyStack=[JSON.stringify(currentTemplate.layout)];
  selectedElementIndex=null;
  renderCanvas();
  deselectInspector();
}

function pushHistory(){
  if(historyStack.length>20)historyStack.shift();
  historyStack.push(JSON.stringify(currentTemplate.layout));
}

$('templateUndoBtn').onclick=()=>{
  if(historyStack.length<=1)return flash('Nothing to undo.','warn');
  historyStack.pop();
  currentTemplate.layout=JSON.parse(historyStack[historyStack.length-1]);
  selectedElementIndex=null;
  renderCanvas();
  deselectInspector();
  flash('Undo applied.');
};

$('templatePreviewToggle').onclick=()=>{
  samplePreview=!samplePreview;
  $('previewStatusText').textContent=samplePreview?'ON':'OFF';
  renderCanvas();
};

function renderCanvas(){
  const canvas=$('certCanvas');
  const elements=currentTemplate?.layout?.elements||[];
  
  // Update background layer & border visibility
  const bgLayer=$('canvasBgLayer');
  const bOuter=$('canvasBorderOuter'), bMid=$('canvasBorderMid'), bInner=$('canvasBorderInner');
  if(currentTemplate?.backgroundImage){
    if(bgLayer)bgLayer.style.backgroundImage=`url(${currentTemplate.backgroundImage})`;
    $('templateClearBgBtn')?.classList.remove('hidden');
    if(bOuter)bOuter.style.display='none';
    if(bMid)bMid.style.display='none';
    if(bInner)bInner.style.display='none';
  }else{
    if(bgLayer)bgLayer.style.backgroundImage='none';
    $('templateClearBgBtn')?.classList.add('hidden');
    if(bOuter)bOuter.style.display='';
    if(bMid)bMid.style.display='';
    if(bInner)bInner.style.display='';
  }

  // Remove previous element divs
  canvas.querySelectorAll('.canvas-field').forEach(e=>e.remove());

  elements.forEach((el,idx)=>{
    const elDiv=document.createElement('div');
    elDiv.className='canvas-field'+(selectedElementIndex===idx?' selected':'');
    
    // Convert 842x595 coordinates to percentage
    const leftPct=(el.x/842)*100;
    const topPct=(el.y/595)*100;
    elDiv.style.left=leftPct+'%';
    elDiv.style.top=topPct+'%';
    
    const badgeName=el.label||el.field||el.id;
    const isCrest=el.type==='crest';
    const isQr=el.type==='qr'||el.field==='VERIFICATION_QR';
    
    let contentHtml='';
    if(isCrest){
      contentHtml='<div class="canvas-crest-icon" title="Emblem Crest"><svg width="20" height="20" viewBox="0 0 32 32" fill="none"><path d="M16 3L5 7.5V14.5C5 21.6 9.7 28.1 16 29.5C22.3 28.1 27 21.6 27 14.5V7.5L16 3Z" fill="#1e3a8a" stroke="#caa04b" stroke-width="1.5"/><path d="M11 15.5L14.5 19L21.5 11.5" stroke="#caa04b" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';
    }else if(isQr){
      contentHtml='<div class="canvas-qr-box">QR CODE</div>';
    }else{
      let text=el.text||el.placeholder||el.field||'Field';
      if(samplePreview){
        text=getSamplePreviewText(el.field||el.label||text);
      }
      contentHtml=`
        <span style="
          font-size:${Math.max(9, (el.fontSize||12)*0.85)}px;
          font-weight:${el.isBold?'750':'500'};
          color:${el.color||'#0f172a'};
          text-align:${el.align||'center'};
        ">${esc(text)}</span>
      `;
      if(el.subtext){
        contentHtml+=`<span style="font-size:8px; color:#64748b; margin-top:2px;">${esc(el.subtext)}</span>`;
      }
    }

    elDiv.innerHTML=`
      <div class="canvas-field-badge">${esc(badgeName)}</div>
      ${contentHtml}
    `;

    // Click to select
    elDiv.onclick=e=>{
      e.stopPropagation();
      selectElement(idx);
    };

    // Drag to reposition
    attachDrag(elDiv, idx);

    canvas.appendChild(elDiv);
  });
}

function getSamplePreviewText(key){
  switch(key){
    case 'PARTICIPANT_NAME': return 'JUAN DELA CRUZ';
    case 'STUDENT_NUMBER':
    case 'STUDENT_ID': return '2026-0001';
    case 'PROGRAM': return 'BS Information Technology';
    case 'EVENT_NAME': return 'Emerging Technologies Seminar 2026';
    case 'EVENT_VENUE': return 'BU Polangui Campus';
    case 'EVENT_DATE': return 'October 1, 2026';
    case 'ORGANIZER': return 'BU Polangui Academic Council';
    case 'CERTIFICATE_ID': return 'EP-D16DF166C9';
    case 'ISSUE_DATE': return 'October 1, 2026';
    case 'SIGNATORY_1': return 'Dr. Roberto M. Gomez Dean, College of Science';
    case 'SIGNATORY_2': return 'Prof. Maria Santos Department Chair';
    default: return key;
  }
}

let activeDragState = null;

function initCanvasDragEngine() {
  const canvas = $('certCanvas');
  const snapGuide = $('canvasSnapGuide');
  const coordBadge = $('canvasCoordBadge');

  const handlePointerMove = (clientX, clientY) => {
    if (!activeDragState || !currentTemplate) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = 842 / rect.width;
    const scaleY = 595 / rect.height;

    const deltaX = (clientX - activeDragState.startX) * scaleX;
    const deltaY = (clientY - activeDragState.startY) * scaleY;

    let newX = Math.round(activeDragState.initialX + deltaX);
    let newY = Math.round(activeDragState.initialY + deltaY);

    // Bounds check within canvas
    newX = Math.max(30, Math.min(812, newX));
    newY = Math.max(25, Math.min(570, newY));

    // Magnetic Center Snap to X = 421 (±6px)
    const isCenterSnap = Math.abs(newX - 421) <= 6;
    if (isCenterSnap) {
      newX = 421;
      if (snapGuide) snapGuide.classList.remove('hidden');
    } else {
      if (snapGuide) snapGuide.classList.add('hidden');
    }

    const el = currentTemplate.layout.elements[activeDragState.idx];
    if (el) {
      el.x = newX;
      el.y = newY;
    }

    // Direct style update without destroying DOM elements
    activeDragState.element.style.left = (newX / 842 * 100) + '%';
    activeDragState.element.style.top = (newY / 595 * 100) + '%';

    if ($('inspectorX')) $('inspectorX').value = newX;
    if ($('inspectorY')) $('inspectorY').value = newY;

    if (coordBadge) {
      coordBadge.classList.remove('hidden');
      coordBadge.innerHTML = `X: ${newX} ${isCenterSnap ? '<b style="color:#60a5fa;">[CENTER]</b>' : ''} &bull; Y: ${newY}`;
      coordBadge.style.left = (newX / 842 * 100) + '%';
      coordBadge.style.top = (Math.max(20, newY - 26) / 595 * 100) + '%';
    }
  };

  const handlePointerEnd = () => {
    if (!activeDragState) return;
    activeDragState = null;
    if (snapGuide) snapGuide.classList.add('hidden');
    if (coordBadge) coordBadge.classList.add('hidden');
    pushHistory();
    renderCanvas();
  };

  window.addEventListener('mousemove', e => handlePointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', handlePointerEnd);

  window.addEventListener('touchmove', e => {
    if (activeDragState && e.touches.length > 0) {
      handlePointerMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: true });
  window.addEventListener('touchend', handlePointerEnd);

  // Global Keyboard Navigation for Canvas Selection
  window.addEventListener('keydown', e => {
    if (selectedElementIndex === null || !currentTemplate) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;

    const el = currentTemplate.layout.elements[selectedElementIndex];
    if (!el) return;
    const step = e.shiftKey ? 10 : 1;

    if (e.key === 'ArrowLeft') {
      el.x = Math.max(30, (el.x || 421) - step);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      el.x = Math.min(812, (el.x || 421) + step);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      el.y = Math.max(25, (el.y || 300) - step);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      el.y = Math.min(570, (el.y || 300) + step);
      e.preventDefault();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      currentTemplate.layout.elements.splice(selectedElementIndex, 1);
      deselectInspector();
      pushHistory();
      renderCanvas();
      flash('Field removed from canvas.');
      e.preventDefault();
      return;
    } else {
      return;
    }

    if ($('inspectorX')) $('inspectorX').value = el.x;
    if ($('inspectorY')) $('inspectorY').value = el.y;
    renderCanvas();
  });
}

function attachDrag(element, idx){
  element.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    selectElement(idx);
    activeDragState = {
      idx,
      element,
      startX: e.clientX,
      startY: e.clientY,
      initialX: currentTemplate.layout.elements[idx].x,
      initialY: currentTemplate.layout.elements[idx].y
    };
  });

  element.addEventListener('touchstart', e => {
    if (e.touches.length > 0) {
      selectElement(idx);
      activeDragState = {
        idx,
        element,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        initialX: currentTemplate.layout.elements[idx].x,
        initialY: currentTemplate.layout.elements[idx].y
      };
    }
  }, { passive: true });
}

// Field Inspector Controls
function selectElement(idx){
  selectedElementIndex=idx;
  const el=currentTemplate.layout.elements[idx];
  if(!el)return deselectInspector();
  
  $('inspectorEmptyState').classList.add('hidden');
  $('inspectorForm').classList.remove('hidden');
  
  $('inspectorFieldLabel').textContent=(el.label||el.field||'Field') + ' Content';
  $('inspectorText').value=el.text||el.placeholder||'';
  $('inspectorFontSize').value=el.fontSize||12;
  $('inspectorAlign').value=el.align||'center';
  $('inspectorColor').value=el.color||'#0f172a';
  $('inspectorBold').checked=!!el.isBold;
  $('inspectorX').value=el.x||421;
  $('inspectorY').value=el.y||300;

  if(el.subtext!==undefined){
    $('inspectorSubtextGroup').style.display='block';
    $('inspectorSubtext').value=el.subtext;
  }else{
    $('inspectorSubtextGroup').style.display='none';
  }

  renderCanvas();
}

function deselectInspector(){
  selectedElementIndex=null;
  $('inspectorEmptyState').classList.remove('hidden');
  $('inspectorForm').classList.add('hidden');
}

// Inspector Input Handlers
$('inspectorText').oninput=()=>{
  if(selectedElementIndex===null)return;
  const el=currentTemplate.layout.elements[selectedElementIndex];
  if(el.type==='text')el.text=$('inspectorText').value;
  else el.placeholder=$('inspectorText').value;
  renderCanvas();
};
$('inspectorSubtext').oninput=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].subtext=$('inspectorSubtext').value;
  renderCanvas();
};
$('inspectorFontSize').oninput=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].fontSize=Number($('inspectorFontSize').value)||12;
  renderCanvas();
};
$('inspectorAlign').onchange=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].align=$('inspectorAlign').value;
  renderCanvas();
};
$('inspectorColor').oninput=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].color=$('inspectorColor').value;
  renderCanvas();
};
$('inspectorBold').onchange=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].isBold=$('inspectorBold').checked;
  renderCanvas();
};
$('inspectorX').oninput=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].x=Number($('inspectorX').value)||421;
  renderCanvas();
};
$('inspectorY').oninput=()=>{
  if(selectedElementIndex===null)return;
  currentTemplate.layout.elements[selectedElementIndex].y=Number($('inspectorY').value)||300;
  renderCanvas();
};

$('inspectorRemoveBtn').onclick=()=>{
  if(selectedElementIndex===null)return flash('Select an element to remove.','warn');
  currentTemplate.layout.elements.splice(selectedElementIndex,1);
  deselectInspector();
  pushHistory();
  renderCanvas();
  flash('Field removed from canvas.');
};

if ($('inspectorCenterHBtn')) {
  $('inspectorCenterHBtn').onclick = () => {
    if (selectedElementIndex === null || !currentTemplate) return;
    currentTemplate.layout.elements[selectedElementIndex].x = 421;
    $('inspectorX').value = 421;
    pushHistory();
    renderCanvas();
    flash('Snapped to horizontal center (X: 421).');
  };
}

if ($('inspectorCenterVBtn')) {
  $('inspectorCenterVBtn').onclick = () => {
    if (selectedElementIndex === null || !currentTemplate) return;
    currentTemplate.layout.elements[selectedElementIndex].y = 298;
    $('inspectorY').value = 298;
    pushHistory();
    renderCanvas();
    flash('Snapped to vertical center (Y: 298).');
  };
}

// Insert Dynamic Fields
window.insertField=(fieldKey,label)=>{
  if(!currentTemplate)return flash('Select or create a template first.','error');
  const isQr=fieldKey==='VERIFICATION_QR';
  const isText=fieldKey==='STATIC_TEXT';
  
  let defaultX=421, defaultY=280, defaultFontSize=12, isBold=false, align='center';
  switch(fieldKey){
    case 'PARTICIPANT_NAME': defaultY=230; defaultFontSize=26; isBold=true; break;
    case 'PROGRAM': defaultY=265; defaultFontSize=12; break;
    case 'EVENT_NAME': defaultY=350; defaultFontSize=18; isBold=true; break;
    case 'EVENT_DATE': defaultY=370; defaultFontSize=11; break;
    case 'EVENT_VENUE': defaultY=385; defaultFontSize=10; break;
    case 'ORGANIZER': defaultY=408; defaultFontSize=9; break;
    case 'VERIFICATION_QR': defaultX=115; defaultY=475; defaultFontSize=12; break;
    case 'CERTIFICATE_ID': defaultX=115; defaultY=528; defaultFontSize=8; break;
    case 'SIGNATORY_1': defaultX=390; defaultY=480; defaultFontSize=10; isBold=true; break;
    case 'SIGNATORY_2': defaultX=630; defaultY=480; defaultFontSize=10; isBold=true; break;
    case 'STUDENT_NUMBER': defaultY=245; defaultFontSize=11; break;
    case 'ISSUE_DATE': defaultY=545; defaultFontSize=9; break;
    default: defaultY=300;
  }

  const newEl={
    id:'f_'+Date.now(),
    type:isQr?'qr':isText?'text':'field',
    field:isQr?'VERIFICATION_QR':isText?null:fieldKey,
    label:label.toUpperCase().replace(/\s+/g,'_'),
    placeholder:isText?null:`{{${fieldKey}}}`,
    text:isText?'New informational text paragraph':null,
    x:defaultX,
    y:defaultY,
    fontSize:defaultFontSize,
    isBold,
    color:'#0f172a',
    align
  };
  if(fieldKey==='SIGNATORY_1'||fieldKey==='SIGNATORY_2'){
    newEl.subtext=fieldKey==='SIGNATORY_1'?'Authorized Officer / Dean':'Department Chairperson';
  }
  
  currentTemplate.layout.elements.push(newEl);
  pushHistory();
  renderCanvas();
  selectElement(currentTemplate.layout.elements.length-1);
  flash(`Added ${label} to canvas.`);
};

// Top Bar Action Buttons
$('templateSaveBtn').onclick=async()=>{
  if(!currentTemplate)return;
  const eventVal=$('templateEventSelect').value;
  const payload={
    id:currentTemplate.id,
    name:currentTemplate.name||'Default Institutional Certificate',
    eventId:eventVal?Number(eventVal):null,
    isDefault:currentTemplate.isDefault||!eventVal,
    width:currentTemplate.width||842,
    height:currentTemplate.height||595,
    orientation:'LANDSCAPE',
    layoutJson:JSON.stringify(currentTemplate.layout),
    backgroundImage:currentTemplate.backgroundImage||null
  };
  try{
    const saved=await api('/api/admin/templates',{method:'POST',body:JSON.stringify(payload)});
    flash('Template layout successfully saved.');
    await loadTemplates();
    selectTemplate(saved.id);
  }catch(e){flash(e.message,'error')}
};

$('templateDuplicateBtn').onclick=async()=>{
  if(!currentTemplate)return;
  const newName=prompt('Enter name for the duplicated template:', currentTemplate.name + ' (Copy)');
  if(!newName)return;
  const payload={
    id:null,
    name:newName.trim(),
    eventId:null,
    isDefault:false,
    width:currentTemplate.width||842,
    height:currentTemplate.height||595,
    orientation:'LANDSCAPE',
    layoutJson:JSON.stringify(currentTemplate.layout),
    backgroundImage:currentTemplate.backgroundImage||null
  };
  try{
    const saved=await api('/api/admin/templates',{method:'POST',body:JSON.stringify(payload)});
    flash('Template duplicated.');
    await loadTemplates();
    selectTemplate(saved.id);
  }catch(e){flash(e.message,'error')}
};

$('templateDeleteBtn').onclick=async()=>{
  if(!currentTemplate)return;
  if(currentTemplate.isDefault)return flash('Cannot delete the default template.','error');
  if(!confirm(`Delete template "${currentTemplate.name}"?`))return;
  try{
    await api(`/api/admin/templates/${currentTemplate.id}`,{method:'DELETE'});
    flash('Template deleted.');
    await loadTemplates();
  }catch(e){flash(e.message,'error')}
};

$('templateSamplePdfBtn').onclick=async()=>{
  if(!currentTemplate)return;
  try{
    const r=await fetch('/api/admin/templates/sample-pdf',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        layoutJson:JSON.stringify(currentTemplate.layout),
        backgroundImage:currentTemplate.backgroundImage||''
      })
    });
    if(!r.ok)throw new Error('Failed to generate sample PDF');
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    window.open(url,'_blank');
  }catch(e){flash(e.message,'error')}
};

// Export Template as JSON
$('templateExportBtn').onclick=()=>{
  if(!currentTemplate)return flash('Select a template to export.','error');
  const exportData={
    name:currentTemplate.name||'Certificate Template',
    width:currentTemplate.width||842,
    height:currentTemplate.height||595,
    orientation:currentTemplate.orientation||'LANDSCAPE',
    layout:currentTemplate.layout||{elements:[]},
    hasBackground:!!currentTemplate.backgroundImage,
    exportedAt:new Date().toISOString(),
    generator:'EventProof Cryptographic Certificate System'
  };
  const jsonStr=JSON.stringify(exportData,null,2);
  const blob=new Blob([jsonStr],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  const safeName=(currentTemplate.name||'template').toLowerCase().replace(/[^a-z0-9_-]/g,'_');
  a.download=`eventproof_template_${safeName}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  flash('Template layout exported to JSON.');
};

// Restore Original Classic Template & Coordinates
if ($('templateRestoreOriginalBtn')) {
  $('templateRestoreOriginalBtn').onclick = async () => {
    if (!currentTemplate) return;
    if (!confirm(`Restore template "${currentTemplate.name}" to factory-calibrated classic layout?\n\nThis will remove any custom background stationery, restore classic gold & navy multi-tier borders, and reset all dynamic fields to institutional default coordinates.`)) return;
    try {
      const restored = await api(`/api/admin/templates/${currentTemplate.id}/reset-default`, { method: 'POST' });
      const idx = templatesList.findIndex(t => t.id === restored.id);
      if (idx !== -1) templatesList[idx] = restored;
      currentTemplate = JSON.parse(JSON.stringify(restored));
      if (typeof currentTemplate.layoutJson === 'string') {
        currentTemplate.layout = JSON.parse(currentTemplate.layoutJson);
      }
      historyStack = [JSON.stringify(currentTemplate.layout)];
      selectedElementIndex = null;
      renderCanvas();
      deselectInspector();
      flash('Template restored to factory classic design with default borders.');
    } catch (err) {
      flash('Failed to restore template: ' + err.message, 'error');
    }
  };
}

// Clear Custom Background
$('templateClearBgBtn').onclick=async()=>{
  if(!currentTemplate||!currentTemplate.backgroundImage)return;
  if(!confirm('Clear the custom background stationery and restore classic decorative borders?'))return;
  try{
    currentTemplate.backgroundImage=null;
    const eventVal=$('templateEventSelect').value;
    const payload={
      id:currentTemplate.id,
      name:currentTemplate.name||'Default Institutional Certificate',
      eventId:eventVal?Number(eventVal):null,
      isDefault:currentTemplate.isDefault||!eventVal,
      width:currentTemplate.width||842,
      height:currentTemplate.height||595,
      orientation:'LANDSCAPE',
      layoutJson:JSON.stringify(currentTemplate.layout),
      backgroundImage:null
    };
    const saved=await api('/api/admin/templates',{method:'POST',body:JSON.stringify(payload)});
    const idx=templatesList.findIndex(t=>t.id===saved.id);
    if(idx!==-1)templatesList[idx]=saved;
    currentTemplate=JSON.parse(JSON.stringify(saved));
    if(typeof currentTemplate.layoutJson==='string'){
      currentTemplate.layout=JSON.parse(currentTemplate.layoutJson);
    }
    renderCanvas();
    flash('Background cleared and restored to default borders.');
  }catch(err){
    flash('Failed to clear background: '+err.message,'error');
  }
};

// Import Template / Background Modal & Dropzone
let pendingImportFile=null;

function openImportModal(){
  $('importModal').classList.remove('hidden');
  resetImportState();
}

function closeImportModal(){
  $('importModal').classList.add('hidden');
  resetImportState();
}

function resetImportState(){
  pendingImportFile=null;
  $('importFileInput').value='';
  $('importFileStatus').classList.add('hidden');
  $('confirmImportBtn').disabled=true;
  $('confirmImportBtn').textContent='Apply to Template';
}

$('templateImportBtn').onclick=openImportModal;
$('templateBgBtn').onclick=openImportModal;
$('closeImportModal').onclick=closeImportModal;
$('cancelImportBtn').onclick=closeImportModal;

$('importModal').onclick=e=>{
  if(e.target===$('importModal'))closeImportModal();
};

const dropZone=$('importDropZone');
const fileInput=$('importFileInput');

dropZone.onclick=()=>fileInput.click();

dropZone.ondragover=e=>{
  e.preventDefault();
  dropZone.classList.add('dragover');
};

dropZone.ondragleave=()=>dropZone.classList.remove('dragover');

dropZone.ondrop=e=>{
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if(e.dataTransfer.files&&e.dataTransfer.files.length>0){
    handleFileSelected(e.dataTransfer.files[0]);
  }
};

fileInput.onchange=()=>{
  if(fileInput.files&&fileInput.files.length>0){
    handleFileSelected(fileInput.files[0]);
  }
};

$('importClearFileBtn').onclick=e=>{
  e.stopPropagation();
  resetImportState();
};

function handleFileSelected(file){
  const name=file.name.toLowerCase();
  const isJson=name.endsWith('.json');
  const isPdf=name.endsWith('.pdf');
  const isImg=name.endsWith('.png')||name.endsWith('.jpg')||name.endsWith('.jpeg');

  if(!isJson&&!isPdf&&!isImg){
    return flash('Unsupported file type. Please upload a .JSON layout or .PDF/.PNG/.JPG background.','error');
  }

  pendingImportFile=file;
  $('importFileName').textContent=file.name;
  $('importFileSize').textContent=(file.size/1024).toFixed(1)+' KB';
  
  const badge=$('importFileBadge');
  if(isJson){
    badge.textContent='JSON LAYOUT';
    badge.style.background='#2563eb';
    $('confirmImportBtn').textContent='Apply Layout';
  }else if(isPdf){
    badge.textContent='PDF BACKGROUND (PAGE 1)';
    badge.style.background='#d97706';
    $('confirmImportBtn').textContent='Upload Background';
  }else{
    badge.textContent='IMAGE BACKGROUND';
    badge.style.background='#059669';
    $('confirmImportBtn').textContent='Upload Background';
  }

  $('importFileStatus').classList.remove('hidden');
  $('confirmImportBtn').disabled=false;
}

$('confirmImportBtn').onclick=async()=>{
  if(!pendingImportFile||!currentTemplate)return;
  const file=pendingImportFile;
  const name=file.name.toLowerCase();
  const isJson=name.endsWith('.json');

  if(isJson){
    try{
      const text=await file.text();
      const parsed=JSON.parse(text);
      let elements=null;
      if(Array.isArray(parsed.elements))elements=parsed.elements;
      else if(parsed.layout&&Array.isArray(parsed.layout.elements))elements=parsed.layout.elements;
      else if(typeof parsed.layoutJson==='string'){
        const l=JSON.parse(parsed.layoutJson);
        if(Array.isArray(l.elements))elements=l.elements;
      }
      if(!elements){
        throw new Error('Invalid template format: elements list not found in JSON');
      }
      currentTemplate.layout={
        width:parsed.width||currentTemplate.width||842,
        height:parsed.height||currentTemplate.height||595,
        orientation:parsed.orientation||currentTemplate.orientation||'LANDSCAPE',
        elements
      };
      pushHistory();
      renderCanvas();
      deselectInspector();
      closeImportModal();
      flash(`Imported ${elements.length} layout elements from ${file.name}. Remember to click 'Save Template'.`);
    }catch(err){
      flash('Failed to parse JSON layout: '+err.message,'error');
    }
  }else{
    // Background stationery upload (PDF or image)
    const formData=new FormData();
    formData.append('file', file);
    try{
      $('confirmImportBtn').disabled=true;
      $('confirmImportBtn').textContent='Uploading...';
      const r=await fetch(`/api/admin/templates/${currentTemplate.id}/background`,{
        method:'POST',
        body:formData
      });
      if(!r.ok){
        const errText=await r.text();
        throw new Error(errText||'Failed to upload background');
      }
      const updated=await r.json();
      currentTemplate.backgroundImage=updated.backgroundImage;
      const idx=templatesList.findIndex(t=>t.id===currentTemplate.id);
      if(idx!==-1)templatesList[idx]=updated;
      renderCanvas();
      closeImportModal();
      flash(`Stationery background applied from ${file.name}.`);
    }catch(err){
      flash('Background upload failed: '+err.message,'error');
      $('confirmImportBtn').disabled=false;
      $('confirmImportBtn').textContent='Upload Background';
    }
  }
};


// Initial boot
(async()=>{
  try{
    initCanvasDragEngine();
    await Promise.all([loadEvents(),loadUsers()]);
  }catch(e){flash(e.message,'error')}
})();
