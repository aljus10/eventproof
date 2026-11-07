const state = {
  events: [],
  students: [],
  registrations: [],
  attendanceRows: [],
  attendanceFilter: 'all',
  attendanceSource: null,
  pollTimer: null,
  currentQr: null
};

const $ = id => document.getElementById(id);

function flash(message, type = 'success') {
  const el = $('flash');
  el.textContent = message;
  el.className = 'notice ' + type;
  setTimeout(() => el.classList.add('hidden'), 4500);
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401 || res.status === 403) {
    location.href = '/index.html';
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    let msg = 'Request failed';
    try {
      const j = await res.json();
      msg = j.detail || j.message || j.error || msg;
    } catch {}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

function fmtDate(v) {
  if (!v) return '—';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
  const d = new Date(v);
  return !isNaN(d.getTime()) ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : String(v);
}

function fmtTime(v) {
  if (!v) return '—';
  if (typeof v === 'string') {
    const timeMatch = v.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    }
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return String(v);
}

function fmtDuration(start, end) {
  if (!start) return '—';
  if (!end) return '<span class="status-pill ok" style="font-size:0.7rem; padding:2px 6px;">In Progress</span>';
  const diffMs = new Date(end) - new Date(start);
  if (diffMs < 0) return '—';
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hrs > 0) return `${hrs}h ${remMins}m`;
  return `${mins}m`;
}

function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

// Navigation Tabs
document.querySelectorAll('.nav button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.nav button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.section').forEach(x => x.classList.remove('active'));
  $(b.dataset.section).classList.add('active');
  if (b.dataset.section === 'attendance') loadAttendance();
  if (b.dataset.section === 'scanners') loadScanners();
}));

// Quick jump to event in specific section
window.selectEventAndTab = (eventId, section) => {
  const navBtn = $(`nav${section.charAt(0).toUpperCase() + section.slice(1)}`);
  if (navBtn) navBtn.click();
  
  if (section === 'attendance') {
    $('attendanceEvent').value = eventId;
    loadAttendance();
  } else if (section === 'students') {
    $('registrationEvent').value = eventId;
    loadRegistrations();
  } else if (section === 'scanners') {
    $('scannerEvent').value = eventId;
    loadScanners();
  }
};

// ==========================================================================
// 1. Dashboard: Metrics & "What is the Event?" Overview Table
// ==========================================================================
async function loadDashboard() {
  const d = await api('/api/manager/dashboard');
  
  // 4 Clean Metric Panels (Restrained, Tabular Numbers, Zero Emojis)
  $('metrics').innerHTML = `
    <div class="metric">
      <span class="metric-label">Scheduled Events</span>
      <strong class="metric-number">${d.events}</strong>
      <span class="metric-sub">Active institutional events</span>
    </div>
    <div class="metric">
      <span class="metric-label">Enrolled Students</span>
      <strong class="metric-number">${d.students}</strong>
      <span class="metric-sub">Master directory roster</span>
    </div>
    <div class="metric">
      <span class="metric-label">Passes Issued</span>
      <strong class="metric-number">${d.registrations}</strong>
      <span class="metric-sub">${d.events > 0 ? (d.registrations / d.events).toFixed(0) : 0} average per event</span>
    </div>
    <div class="metric">
      <span class="metric-label">Attendance Records</span>
      <strong class="metric-number">${d.attendance}</strong>
      <span class="metric-sub">Verified check-in telemetry</span>
    </div>
  `;

  // Load events and render the "What is the Event?" Overview Table
  if (!state.events.length) {
    state.events = await api('/api/manager/events');
  }
  renderDashboardEventsTable();
}

function renderDashboardEventsTable() {
  const tbody = $('dashboardEventsBody');
  if (!state.events.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">No scheduled events. Click "+ New Event" to create one.</td></tr>';
    return;
  }

  tbody.innerHTML = state.events.map(e => {
    const isDual = e.attendanceType === 'PRESENT_AND_LOGOUT';
    const pct = e.registered > 0 ? Math.round((e.present / e.registered) * 100) : 0;
    const desc = e.description && e.description.trim()
      ? esc(e.description.trim())
      : 'Institutional academic gathering, attendance tracking, and certificate entitlement event.';

    return `
      <tr>
        <td>
          <strong style="display:block; font-size:0.92rem; color:#0f172a; margin-bottom:2px;">${esc(e.name)}</strong>
          <div class="muted small">${esc(e.organizer || 'Academic Department')}</div>
        </td>
        <td>
          <div class="event-purpose-text" title="${desc}">${desc}</div>
        </td>
        <td>
          <div style="font-weight:600; font-size:0.86rem; color:#0f172a;">${fmtDate(e.eventDate)}</div>
          <div class="muted small mono" style="margin-top:2px;">${fmtTime(e.startTime)} &ndash; ${fmtTime(e.endTime)}</div>
          <div class="muted small" style="margin-top:2px;">${esc(e.venue || 'Campus')}</div>
        </td>
        <td>
          <div style="margin-bottom:5px;">
            <span class="status-pill ${isDual ? 'info' : 'ok'}" style="font-size:0.72rem; padding:2px 7px;">
              ${isDual ? 'Two-Stage' : 'Single Check-in'}
            </span>
          </div>
          <div style="font-weight:600; font-size:0.82rem; color:#1e293b; font-variant-numeric:tabular-nums;">${e.present} / ${e.registered} (${pct}%)</div>
          <div class="turnout-bar-track" style="margin-top:4px;">
            <div class="turnout-bar-fill" style="width:${pct}%;"></div>
          </div>
        </td>
        <td style="text-align:right;">
          <div class="row-actions" style="justify-content:flex-end; gap:6px;">
            <button class="btn secondary small-btn" type="button" onclick="selectEventAndTab(${e.id}, 'attendance')" title="View Live Attendance">Monitor</button>
            <button class="btn secondary small-btn" type="button" onclick="selectEventAndTab(${e.id}, 'students')" title="Manage Passes">Passes</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ==========================================================================
// 2. Events: List & Table
// ==========================================================================
async function loadEvents() {
  state.events = await api('/api/manager/events');
  $('eventsBody').innerHTML = state.events.map(e => {
    const isDual = e.attendanceType === 'PRESENT_AND_LOGOUT';
    const pct = e.registered > 0 ? Math.round((e.present / e.registered) * 100) : 0;
    return `<tr>
      <td>
        <strong>${esc(e.name)}</strong>
        <div class="muted small">${esc(e.organizer || 'Academic Department')}</div>
      </td>
      <td>
        <div>${fmtDate(e.eventDate)}</div>
        <div class="muted small mono">${fmtTime(e.startTime)} &ndash; ${fmtTime(e.endTime)}</div>
      </td>
      <td>${esc(e.venue)}</td>
      <td>
        <span class="status-pill ${isDual ? 'info' : 'ok'}">
          ${isDual ? 'Two-Stage Departure' : 'Single Check-in'}
        </span>
      </td>
      <td>
        <div style="font-weight:700; font-size:0.86rem; margin-bottom:3px;">${e.present} / ${e.registered} (${pct}%)</div>
        <div class="turnout-bar-track" style="height:5px; width:120px;">
          <div class="turnout-bar-fill" style="width:${pct}%;"></div>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="btn secondary small-btn" type="button" onclick="selectEventAndTab(${e.id}, 'attendance')">Monitor</button>
          <button class="btn secondary small-btn" type="button" onclick="selectEventAndTab(${e.id}, 'students')">Passes</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="empty-cell">No events created yet.</td></tr>';

  populateEventSelects();
  renderDashboardEventsTable();
}

function populateEventSelects() {
  ['registrationEvent', 'attendanceEvent', 'scannerEvent'].forEach(id => {
    const el = $(id);
    if (!el) return;
    const old = el.value;
    el.innerHTML = state.events.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    if (state.events.some(e => String(e.id) === old)) el.value = old;
  });
  if (state.events.length) {
    loadRegistrations();
    loadAttendance();
    loadScanners();
  }
}

// ==========================================================================
// 3. Students: Directory & Registrations
// ==========================================================================
async function loadStudents() {
  state.students = await api('/api/manager/students');
  renderStudentDirectory();
  $('registrationStudent').innerHTML = state.students.map(s => `<option value="${s.id}">${esc(s.studentNumber)} — ${esc(s.fullName)}</option>`).join('');
}

function renderStudentDirectory(query = '') {
  const q = (query || '').toLowerCase().trim();
  const filtered = state.students.filter(s => 
    !q || s.fullName.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q) || s.program.toLowerCase().includes(q)
  );

  $('studentsBody').innerHTML = filtered.map(s => `<tr>
    <td class="mono font-semibold">${esc(s.studentNumber)}</td>
    <td><strong>${esc(s.fullName)}</strong></td>
    <td><span class="status-pill">${esc(s.program)}</span></td>
    <td>
      <button class="btn secondary small-btn" type="button" onclick="editStudent(${s.id},'${esc(s.studentNumber)}','${esc(s.fullName)}','${esc(s.program)}')">Edit Record</button>
    </td>
  </tr>`).join('') || '<tr><td colspan="4" class="empty-cell">No students matching search.</td></tr>';
}

if ($('directorySearch')) {
  $('directorySearch').addEventListener('input', e => renderStudentDirectory(e.target.value));
}

window.editStudent = (id, num, name, prog) => {
  const newNum = prompt("Student ID Number:", num);
  if (newNum === null) return;
  const newName = prompt("Student Full Name:", name);
  if (newName === null) return;
  const newProg = prompt("Academic Program:", prog);
  if (newProg === null) return;

  api(`/api/manager/students/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ studentNumber: newNum.trim(), fullName: newName.trim(), program: newProg.trim() })
  }).then(async () => {
    flash(`Updated student record for ${newName.trim()}`);
    await Promise.all([loadStudents(), loadRegistrations(), loadDashboard()]);
  }).catch(e => flash(e.message, 'error'));
};

async function loadRegistrations() {
  const id = $('registrationEvent').value;
  if (!id) return;
  state.registrations = await api(`/api/manager/events/${id}/registrations`);
  renderRegistrationsTable();
}

function renderRegistrationsTable(query = '') {
  const q = (query || '').toLowerCase().trim();
  const filtered = state.registrations.filter(r =>
    !q || r.fullName.toLowerCase().includes(q) || r.studentNumber.toLowerCase().includes(q) || r.program.toLowerCase().includes(q)
  );

  $('registrationsBody').innerHTML = filtered.map(r => `<tr>
    <td class="mono font-semibold">${esc(r.studentNumber)}</td>
    <td><strong>${esc(r.fullName)}</strong></td>
    <td>${esc(r.program)}</td>
    <td>${r.present ? '<span class="status-pill ok">PRESENT</span>' : '<span class="status-pill">REGISTERED</span>'}</td>
    <td>
      <div class="row-actions">
        <button class="btn secondary small-btn" onclick="showQr(${r.id})">View / Print</button>
        <a class="btn secondary small-btn" href="/api/manager/registrations/${r.id}/qr" download="${esc(r.studentNumber)}-eventproof-qr.png">Download PNG</a>
        ${r.present ? `<button class="btn secondary small-btn" onclick="unpresentAttendee(${r.id},'${esc(r.fullName)}')">Unpresent</button>` : ''}
      </div>
    </td>
  </tr>`).join('') || '<tr><td colspan="5" class="empty-cell">No registered passes matching search.</td></tr>';
}

if ($('registrationSearch')) {
  $('registrationSearch').addEventListener('input', e => renderRegistrationsTable(e.target.value));
}

// ==========================================================================
// 4. Attendance: Live Command Center
// ==========================================================================
async function loadAttendance() {
  const id = $('attendanceEvent').value;
  if (!id) return;
  const rows = await api(`/api/manager/events/${id}/attendance`);
  state.attendanceRows = rows;

  const event = state.events.find(e => String(e.id) === String(id));
  const total = rows.length;
  const present = rows.filter(r => r.present).length;
  const loggedOut = rows.filter(r => r.loggedOutAt).length;
  const turnout = total ? Math.round((present / total) * 100) : 0;

  // Update Attendance KPIs
  $('kpiTotal').textContent = total;
  $('kpiPresent').textContent = present;
  $('kpiLoggedOut').textContent = loggedOut;
  $('kpiTurnout').textContent = `${turnout}%`;
  $('kpiTurnoutBar').style.width = `${turnout}%`;
  $('kpiEventName').textContent = event?.name || 'Selected Event';

  renderAttendanceTable();
  connectSse(id);
}

function renderAttendanceTable() {
  const filter = state.attendanceFilter || 'all';
  const query = ($('attendanceSearch')?.value || '').toLowerCase().trim();

  let rows = state.attendanceRows || [];

  if (filter === 'present') {
    rows = rows.filter(r => r.present);
  } else if (filter === 'not_yet') {
    rows = rows.filter(r => !r.present);
  } else if (filter === 'logged_out') {
    rows = rows.filter(r => r.loggedOutAt);
  }

  if (query) {
    rows = rows.filter(r =>
      r.fullName.toLowerCase().includes(query) ||
      r.studentNumber.toLowerCase().includes(query) ||
      r.program.toLowerCase().includes(query)
    );
  }

  $('attendanceBody').innerHTML = rows.map(r => {
    let statusBadge = '<span class="status-pill">NOT YET</span>';
    if (r.present) {
      if (r.loggedOutAt) statusBadge = '<span class="status-pill" style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;">LOGGED OUT</span>';
      else statusBadge = '<span class="status-pill ok">PRESENT</span>';
    }

    const isDual = r.attendanceType === 'PRESENT_AND_LOGOUT';
    let actions = '—';
    if (r.present) {
      actions = `<div class="row-actions">
        ${isDual && !r.loggedOutAt ? `<button class="btn secondary small-btn" style="color:#1d4ed8; font-weight:600;" onclick="logoutAttendee(${r.id},'${esc(r.fullName)}')">Log Out</button>` : ''}
        <button class="btn secondary small-btn" onclick="unpresentAttendee(${r.id},'${esc(r.fullName)}')">Unpresent</button>
      </div>`;
    }

    return `<tr>
      <td class="mono font-semibold">${esc(r.studentNumber)}</td>
      <td><strong>${esc(r.fullName)}</strong></td>
      <td>${esc(r.program)}</td>
      <td>${statusBadge}</td>
      <td class="mono small">${fmtTime(r.checkedInAt)}</td>
      <td class="mono small">${fmtTime(r.loggedOutAt)}</td>
      <td class="small">${fmtDuration(r.checkedInAt, r.loggedOutAt)}</td>
      <td><span class="status-pill">${esc(r.scannerName || 'Main Gate 1')}</span></td>
      <td>${actions}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty-cell">No attendee records matching filter.</td></tr>';
}

// Status Filter Tabs
document.querySelectorAll('.attendance-filter-tabs .filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.attendance-filter-tabs .filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.attendanceFilter = tab.dataset.filter;
    renderAttendanceTable();
  });
});

if ($('attendanceSearch')) {
  $('attendanceSearch').addEventListener('input', () => renderAttendanceTable());
}

function connectSse(eventId) {
  if (state.attendanceSource) state.attendanceSource.close();
  try {
    const es = new EventSource(`/api/manager/events/${eventId}/stream`);
    es.addEventListener('attendance', () => {
      loadAttendance().catch(() => {});
      loadDashboard().catch(() => {});
    });
    state.attendanceSource = es;
    $('sseStatusText').textContent = 'SSE Stream Connected';
  } catch {
    $('sseStatusText').textContent = 'Polling Active';
  }

  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if ($('attendance').classList.contains('active')) loadAttendance().catch(() => {});
  }, 7000);
}

// ==========================================================================
// 5. Scanners Fleet
// ==========================================================================
async function loadScanners() {
  const id = $('scannerEvent').value;
  if (!id) return;
  const rows = await api(`/api/manager/events/${id}/scanners`);
  $('scannersBody').innerHTML = rows.map(s => `<tr>
    <td>
      <strong>${esc(s.scannerName)}</strong>
    </td>
    <td>
      ${s.paired ? '<span class="status-pill ok">PAIRED &amp; READY</span>' : '<span class="status-pill warn">WAITING FOR PAIRING</span>'}
    </td>
    <td class="mono small">${esc(s.deviceId || 'Awaiting Device Handshake')}</td>
    <td class="small">${new Date(s.createdAt).toLocaleDateString()} ${new Date(s.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
    <td>
      <span class="mono font-semibold" style="color:#1d4ed8; background:#eff6ff; padding:3px 8px; border-radius:6px; border:1px solid #bfdbfe;">${esc(s.pairingToken)}</span>
    </td>
    <td>
      <div class="row-actions">
        <button class="btn secondary small-btn" onclick="showPair(${s.id})">Show Pairing QR</button>
        <button class="btn secondary small-btn" style="color:#ef4444; border-color:#fca5a5;" onclick="removeScanner(${s.id},'${esc(s.scannerName)}')">Revoke</button>
      </div>
    </td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty-cell">No scanners authorized for this event yet.</td></tr>';
}

window.removeScanner = async (scannerId, scannerName) => {
  if (!confirm(`Revoke authorization for scanner "${scannerName}"? The smartphone will be unpaired.`)) return;
  const eventId = $('scannerEvent').value;
  try {
    await api(`/api/manager/events/${eventId}/scanners/${scannerId}`, { method: 'DELETE' });
    flash(`Scanner "${scannerName}" revoked.`);
    await loadScanners();
  } catch (err) {
    flash(err.message, 'error');
  }
};

window.logoutAttendee = async (id, name) => {
  if (!confirm(`Record departure / logout for ${name || 'attendee'}?`)) return;
  const eventId = $('attendanceEvent').value;
  try {
    await api(`/api/manager/events/${eventId}/registrations/${id}/logout`, { method: 'POST' });
    flash(`Attendee ${name || ''} logged out.`);
    await Promise.all([loadAttendance(), loadRegistrations(), loadEvents(), loadDashboard()]);
  } catch (err) {
    flash(err.message, 'error');
  }
};

window.unpresentAttendee = async (id, name) => {
  if (!confirm(`Mark ${name || 'attendee'} as absent (unpresent)? This resets check-in so you can re-scan them in your live demo.`)) return;
  const eventId = $('attendanceEvent').value || $('registrationEvent').value;
  try {
    await api(`/api/manager/events/${eventId}/registrations/${id}/unpresent`, { method: 'POST' });
    flash(`Attendee ${name || ''} marked absent.`);
    await Promise.all([loadAttendance(), loadRegistrations(), loadEvents(), loadDashboard()]);
  } catch (err) {
    flash(err.message, 'error');
  }
};

if ($('studentForm')) {
  $('studentForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api('/api/manager/students', { method: 'POST', body: JSON.stringify(f) });
      e.target.reset();
      await Promise.all([loadStudents(), loadDashboard()]);
      flash('Student successfully enrolled into institutional directory.');
    } catch (err) {
      flash(err.message, 'error');
    }
  });
}

$('registerBtn').addEventListener('click', async () => {
  const eventId = $('registrationEvent').value;
  const studentId = Number($('registrationStudent').value);
  if (!eventId || !studentId) return;
  try {
    await api(`/api/manager/events/${eventId}/registrations`, { method: 'POST', body: JSON.stringify({ studentId }) });
    await Promise.all([loadRegistrations(), loadEvents(), loadDashboard()]);
    flash('Student registered to event and cryptographic pass generated.');
  } catch (err) {
    flash(err.message, 'error');
  }
});

$('registrationEvent').addEventListener('change', loadRegistrations);
$('attendanceEvent').addEventListener('change', loadAttendance);
$('scannerEvent').addEventListener('change', loadScanners);

// Batch ZIP Download
if ($('batchZipBtn')) {
  $('batchZipBtn').onclick = () => {
    const eventId = $('registrationEvent').value;
    if (!eventId) return flash('Select an event first.', 'error');
    const event = state.events.find(e => String(e.id) === String(eventId));
    flash(`Preparing ZIP archive of QR passes for "${event?.name || 'event'}"...`);
    const link = document.createElement('a');
    link.href = `/api/manager/events/${eventId}/registrations/qr-zip`;
    link.download = `EventProof-${(event?.name || 'event').replace(/[^a-zA-Z0-9_-]/g, '_')}-QR-Passes.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => flash('QR passes ZIP download started.'), 1000);
  };
}

// Batch Print Grid Sheet
if ($('batchPrintBtn')) {
  $('batchPrintBtn').onclick = () => {
    const eventId = $('registrationEvent').value;
    if (!eventId) return flash('Select an event first.', 'error');
    const event = state.events.find(e => String(e.id) === String(eventId));
    const regs = state.registrations || [];
    if (!regs.length) return flash('No registered participants in this event.', 'error');

    const printWin = window.open('', '_blank');
    const cardsHtml = regs.map(r => `
      <div class="badge-card">
        <div class="badge-header">
          <div class="badge-institution">BICOL UNIVERSITY</div>
          <div class="badge-sub">Institutional Event Pass</div>
        </div>
        <div class="badge-event">${esc(event?.name || 'Event')}</div>
        <div class="badge-qr-wrap">
          <img class="badge-qr" src="/api/manager/registrations/${r.id}/qr" alt="QR Pass">
        </div>
        <div class="badge-name">${esc(r.fullName)}</div>
        <div class="badge-meta">${esc(r.studentNumber)} · ${esc(r.program)}</div>
        <div class="badge-footer">EventProof Cryptographic Verification Token</div>
      </div>
    `).join('');

    printWin.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>EventProof Passes - ${esc(event?.name || 'Event')}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 10px; background: #fff; color: #0f172a; }
    .print-controls { text-align: center; margin-bottom: 20px; }
    .print-controls button { padding: 10px 24px; font-size: 15px; font-weight: 700; background: #2563eb; color: #fff; border: none; border-radius: 8px; cursor: pointer; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    .badge-card { border: 1.5px solid #cbd5e1; border-radius: 12px; padding: 14px 16px; text-align: center; background: #ffffff; page-break-inside: avoid; break-inside: avoid; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 270px; }
    .badge-header { border-bottom: 1px solid #e2e8f0; width: 100%; padding-bottom: 6px; margin-bottom: 8px; }
    .badge-institution { font-size: 11px; font-weight: 800; letter-spacing: 1px; color: #1e3a8a; }
    .badge-sub { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-event { font-size: 12px; font-weight: 700; color: #0f172a; margin-bottom: 8px; line-height: 1.25; max-width: 90%; }
    .badge-qr-wrap { width: 135px; height: 135px; margin: 0 auto 8px; }
    .badge-qr { width: 100%; height: 100%; object-fit: contain; }
    .badge-name { font-size: 13px; font-weight: 800; color: #0f172a; margin-bottom: 2px; }
    .badge-meta { font-size: 10.5px; font-weight: 600; color: #475569; margin-bottom: 6px; }
    .badge-footer { font-size: 8px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; border-top: 1px dashed #e2e8f0; width: 100%; padding-top: 4px; }
    @media print {
      .print-controls { display: none; }
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="print-controls">
    <button onclick="window.print()">Print Badge Grid Sheet</button>
  </div>
  <div class="grid">${cardsHtml}</div>
  <script>
    window.onload = () => { setTimeout(() => window.print(), 500); };
  <\/script>
</body>
</html>`);
    printWin.document.close();
  };
}

// Create Scanner Handler
$('createScanner').addEventListener('click', async () => {
  const eventId = $('scannerEvent').value;
  const scannerName = $('scannerName').value.trim();
  if (!scannerName) return flash('Enter a scanner name.', 'error');
  try {
    const s = await api(`/api/manager/events/${eventId}/scanners`, { method: 'POST', body: JSON.stringify({ scannerName }) });
    $('scannerName').value = '';
    await loadScanners();
    flash('Scanner station authorized. Pair device using token or QR.');
    showPair(s.id);
  } catch (err) {
    flash(err.message, 'error');
  }
});

// QR Modal Handlers
window.showQr = async id => {
  const r = state.registrations.find(x => x.id === id);
  if (!r) return;
  const event = state.events.find(e => e.id === r.eventId);
  state.currentQr = { r, event };
  $('qrTitle').textContent = 'Event QR Pass';
  $('qrDetails').innerHTML = `<b>${esc(r.fullName)}</b><br>${esc(r.studentNumber)} · ${esc(r.program)}<br><span class="muted">${esc(event?.name || '')}</span>`;
  $('qrImage').src = `/api/manager/registrations/${id}/qr`;
  $('qrToken').textContent = r.qrToken;
  $('qrModal').classList.remove('hidden');
};

$('closeQr').onclick = () => $('qrModal').classList.add('hidden');
$('printPass').onclick = () => {
  const x = state.currentQr;
  if (!x) return;
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><title>EventPass - ${esc(x.r.fullName)}</title><style>body{font-family:sans-serif;text-align:center;padding:40px}img{width:300px}.box{border:1px solid #cbd5e1;border-radius:12px;padding:24px;max-width:480px;margin:auto}</style><div class="box"><h2>EventProof Pass</h2><h3>${esc(x.r.fullName)}</h3><p>${esc(x.r.studentNumber)} · ${esc(x.r.program)}</p><p>${esc(x.event?.name || '')}</p><img src="${$('qrImage').src}"><p style="font-size:12px;color:#64748b;margin-top:16px;">Present this credential to authorized gate staff.</p></div><script>window.onload=()=>window.print()<\/script>`);
  w.document.close();
};

// Scanner Pairing Modal Handlers
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
        btn.textContent = 'Copied';
        btn.style.backgroundColor = '#15803d';
        setTimeout(() => {
          btn.textContent = oldText;
          btn.style.backgroundColor = '';
        }, 2200);
        flash('Pairing token copied to clipboard.');
      }).catch(() => {
        $('pairTokenOnly').select();
        document.execCommand('copy');
        flash('Pairing token copied.');
      });
    };

    // Copy direct link handler
    $('copyPairUrlBtn').onclick = () => {
      const url = $('pairUrl').textContent;
      if (!url) return;
      navigator.clipboard.writeText(url).then(() => {
        const btn = $('copyPairUrlBtn');
        const oldText = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(() => { btn.textContent = oldText; }, 2200);
        flash('Direct scanner link copied to clipboard.');
      }).catch(() => {
        flash('Link: ' + url);
      });
    };

    $('pairModal').classList.remove('hidden');
  } catch (err) {
    flash(err.message, 'error');
  }
};
$('closePair').onclick = () => $('pairModal').classList.add('hidden');

// ==========================================================================
// 6. Event Organizer Wizard (Compact Medium Scale)
// ==========================================================================
let wizStep = 1;
let wizSelectedStudentIds = new Set();
const wizStepsTotal = 4;
const wizStepTitles = [
  'Event Details',
  'Participants',
  'Attendance',
  'Review'
];

function getStudentYearLevel(student) {
  if (student.yearLevel != null) {
    const y = parseInt(student.yearLevel, 10);
    if (!isNaN(y) && y >= 1 && y <= 4) return y;
  }
  if (student.year != null) {
    const y = parseInt(student.year, 10);
    if (!isNaN(y) && y >= 1 && y <= 4) return y;
  }
  const match = (student.studentNumber || '').match(/^(\d{4})/);
  if (match) {
    const entryYear = parseInt(match[1], 10);
    const nowYear = new Date().getFullYear();
    const diff = nowYear - entryYear + 1;
    if (diff <= 1) return 1;
    if (diff === 2) return 2;
    if (diff === 3) return 3;
    return 4;
  }
  return 1;
}

function getYearLevelLabel(yearNum) {
  switch (Number(yearNum)) {
    case 1: return '1st Year';
    case 2: return '2nd Year';
    case 3: return '3rd Year';
    case 4: return '4th Year';
    default: return `${yearNum}th Year`;
  }
}

// --------------------------------------------------------------------------
// Centered Roller Time Picker Logic
// --------------------------------------------------------------------------
let activeTimePickerTarget = 'start'; // 'start' | 'end'
let rollerInitialized = false;

function to12h(time24) {
  if (!time24) return { hh: '09', mm: '00', period: 'AM', formatted: '09:00 AM' };
  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr, 10);
  const m = mStr || '00';
  const period = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  const hh = String(h12).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return { hh, mm, period, formatted: `${hh}:${mm} ${period}` };
}

function to24h(hh, mm, period) {
  let h = parseInt(hh, 10);
  if (period === 'AM') {
    if (h === 12) h = 0;
  } else {
    if (h < 12) h += 12;
  }
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function updateTimeDisplays() {
  const startVal = $('wizStart')?.value || '09:00';
  const endVal = $('wizEnd')?.value || '17:00';
  if ($('wizStartDisplay')) $('wizStartDisplay').textContent = to12h(startVal).formatted;
  if ($('wizEndDisplay')) $('wizEndDisplay').textContent = to12h(endVal).formatted;
  updateDurationHint();
}

function initRollerPicker() {
  if (rollerInitialized) return;
  rollerInitialized = true;

  const hourCol = $('rollerColHour');
  const minCol = $('rollerColMinute');
  const periodCol = $('rollerColPeriod');
  if (!hourCol || !minCol || !periodCol) return;

  // Build Hours 01 to 12
  let hHtml = '';
  for (let i = 1; i <= 12; i++) {
    const val = String(i).padStart(2, '0');
    hHtml += `<div class="roller-item" data-val="${val}">${val}</div>`;
  }
  hourCol.innerHTML = hHtml;

  // Build Minutes 00 to 59
  let mHtml = '';
  for (let i = 0; i < 60; i++) {
    const val = String(i).padStart(2, '0');
    mHtml += `<div class="roller-item" data-val="${val}">${val}</div>`;
  }
  minCol.innerHTML = mHtml;

  // Bind click & scroll behavior to all columns
  [hourCol, minCol, periodCol].forEach(col => {
    col.querySelectorAll('.roller-item').forEach((item, idx) => {
      item.onclick = () => {
        col.scrollTo({ top: idx * 42, behavior: 'smooth' });
      };
    });

    let scrollTimeout;
    col.onscroll = () => {
      clearTimeout(scrollTimeout);
      updateRollerActiveStyles(col);
      scrollTimeout = setTimeout(() => {
        updateRollerActiveStyles(col);
        syncRollerPreview();
      }, 50);
    };
  });
}

function updateRollerActiveStyles(col) {
  const idx = Math.round(col.scrollTop / 42);
  const items = col.querySelectorAll('.roller-item');
  items.forEach((it, i) => it.classList.toggle('active', i === idx));
}

function getRollerCurrentTime() {
  const hourCol = $('rollerColHour');
  const minCol = $('rollerColMinute');
  const periodCol = $('rollerColPeriod');

  const hItems = hourCol ? hourCol.querySelectorAll('.roller-item') : [];
  const mItems = minCol ? minCol.querySelectorAll('.roller-item') : [];
  const pItems = periodCol ? periodCol.querySelectorAll('.roller-item') : [];

  const hIdx = Math.max(0, Math.min(hItems.length - 1, Math.round((hourCol ? hourCol.scrollTop : 0) / 42)));
  const mIdx = Math.max(0, Math.min(mItems.length - 1, Math.round((minCol ? minCol.scrollTop : 0) / 42)));
  const pIdx = Math.max(0, Math.min(pItems.length - 1, Math.round((periodCol ? periodCol.scrollTop : 0) / 42)));

  const hh = hItems[hIdx]?.dataset.val || '09';
  const mm = mItems[mIdx]?.dataset.val || '00';
  const period = pItems[pIdx]?.dataset.val || 'AM';

  return { hh, mm, period };
}

function syncRollerPreview() {
  const { hh, mm, period } = getRollerCurrentTime();
  if ($('rollerPreviewDisplay')) {
    $('rollerPreviewDisplay').textContent = `${hh}:${mm} ${period}`;
  }
}

window.openTimePicker = function(target) {
  initRollerPicker();
  activeTimePickerTarget = target;
  const isStart = target === 'start';
  $('rollerTargetLabel').textContent = isStart ? 'Selecting Start Time' : 'Selecting End Time';
  
  const currentVal = $(isStart ? 'wizStart' : 'wizEnd').value || (isStart ? '09:00' : '17:00');
  const { hh, mm, period } = to12h(currentVal);

  $('rollerTimeModal').classList.remove('hidden');

  const hourCol = $('rollerColHour');
  const minCol = $('rollerColMinute');
  const periodCol = $('rollerColPeriod');

  const hIdx = Math.max(0, parseInt(hh, 10) - 1);
  const mIdx = Math.max(0, parseInt(mm, 10));
  const pIdx = period === 'AM' ? 0 : 1;

  setTimeout(() => {
    if (hourCol) hourCol.scrollTop = hIdx * 42;
    if (minCol) minCol.scrollTop = mIdx * 42;
    if (periodCol) periodCol.scrollTop = pIdx * 42;
    if (hourCol) updateRollerActiveStyles(hourCol);
    if (minCol) updateRollerActiveStyles(minCol);
    if (periodCol) updateRollerActiveStyles(periodCol);
    syncRollerPreview();
  }, 20);
};

window.closeTimePicker = function() {
  if ($('rollerTimeModal')) $('rollerTimeModal').classList.add('hidden');
};

window.confirmTimePicker = function() {
  const { hh, mm, period } = getRollerCurrentTime();
  const time24 = to24h(hh, mm, period);
  const inputId = activeTimePickerTarget === 'start' ? 'wizStart' : 'wizEnd';
  $(inputId).value = time24;
  updateTimeDisplays();
  closeTimePicker();
};

window.setRollerPreset = function(time24) {
  const { hh, mm, period } = to12h(time24);
  const hourCol = $('rollerColHour');
  const minCol = $('rollerColMinute');
  const periodCol = $('rollerColPeriod');

  const hIdx = Math.max(0, parseInt(hh, 10) - 1);
  const mIdx = Math.max(0, parseInt(mm, 10));
  const pIdx = period === 'AM' ? 0 : 1;

  if (hourCol) hourCol.scrollTo({ top: hIdx * 42, behavior: 'smooth' });
  if (minCol) minCol.scrollTo({ top: mIdx * 42, behavior: 'smooth' });
  if (periodCol) periodCol.scrollTo({ top: pIdx * 42, behavior: 'smooth' });
};

function calculateDuration(start, end) {
  if (!start || !end) return '';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins <= 0) return '';
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hrs > 0 && rem > 0) return `${hrs}h ${rem}m`;
  if (hrs > 0) return `${hrs} hr${hrs > 1 ? 's' : ''}`;
  return `${rem} mins`;
}

function updateDurationHint() {
  const hint = $('wizDurationHint');
  if (!hint) return;
  const start = $('wizStart')?.value;
  const end = $('wizEnd')?.value;
  const dur = calculateDuration(start, end);
  if (dur) {
    hint.textContent = `Estimated Duration: ${dur}`;
    hint.style.color = '#0284c7';
  } else if (start && end && end <= start) {
    hint.textContent = 'End time must be after Start time';
    hint.style.color = '#dc2626';
  } else {
    hint.textContent = '';
  }
}

function initEventMaker() {
  wizStep = 1;
  if (!$('wizDate').value) {
    $('wizDate').value = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  }
  if (!$('wizOrganizer').value) {
    $('wizOrganizer').value = 'CS Department';
  }
  if (!$('wizVenue').value) {
    $('wizVenue').value = 'Gymnasium';
  }
  initRollerPicker();
  updateTimeDisplays();
  populateDeptOptions();
  applyScope('ALL');
  renderWizardStep();
}

function populateDeptOptions() {
  const sel = $('wizDeptSelect');
  if (!sel) return;
  const counts = {};
  state.students.forEach(s => { counts[s.program] = (counts[s.program] || 0) + 1; });
  sel.innerHTML = Object.entries(counts).map(([dept, c]) => `<option value="${esc(dept)}">${esc(dept)} (${c} Students)</option>`).join('');
}

function applyScope(scope) {
  const yearVal = $('wizYearSelect') ? $('wizYearSelect').value : 'ALL';
  const filterByYear = s => (yearVal === 'ALL' || getStudentYearLevel(s) === Number(yearVal));

  if (scope === 'ALL') {
    $('deptSelectWrap').classList.add('hidden');
    wizSelectedStudentIds = new Set(state.students.filter(filterByYear).map(s => s.id));
  } else if (scope === 'DEPT') {
    $('deptSelectWrap').classList.remove('hidden');
    const selectedDept = $('wizDeptSelect').value;
    wizSelectedStudentIds = new Set(
      state.students
        .filter(s => s.program === selectedDept && filterByYear(s))
        .map(s => s.id)
    );
  } else if (scope === 'CUSTOM') {
    $('deptSelectWrap').classList.add('hidden');
  }
  document.querySelectorAll('input[name="wizScope"]').forEach(r => {
    const card = r.closest('.scope-card');
    if (card) card.classList.toggle('active', r.value === scope);
  });
  renderWizardRoster($('wizStudentSearch').value);
}

document.querySelectorAll('input[name="wizScope"]').forEach(radio => {
  radio.addEventListener('change', () => applyScope(radio.value));
});

if ($('wizDeptSelect')) {
  $('wizDeptSelect').addEventListener('change', () => {
    const selectedDept = $('wizDeptSelect').value;
    const yearVal = $('wizYearSelect') ? $('wizYearSelect').value : 'ALL';
    const filterByYear = s => (yearVal === 'ALL' || getStudentYearLevel(s) === Number(yearVal));
    wizSelectedStudentIds = new Set(
      state.students
        .filter(s => s.program === selectedDept && filterByYear(s))
        .map(s => s.id)
    );
    renderWizardRoster($('wizStudentSearch').value);
  });
}

if ($('wizYearSelect')) {
  $('wizYearSelect').addEventListener('change', () => {
    const currentScope = document.querySelector('input[name="wizScope"]:checked')?.value || 'ALL';
    if (currentScope === 'CUSTOM') {
      renderWizardRoster($('wizStudentSearch').value);
    } else {
      applyScope(currentScope);
    }
  });
}

document.querySelectorAll('input[name="wizAttendanceType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.querySelectorAll('input[name="wizAttendanceType"]').forEach(r => {
      const card = r.closest('.scope-card');
      if (card) card.classList.toggle('active', r.checked);
    });
  });
});

function renderWizardStep() {
  $('makerSubtitle').textContent = `Step ${wizStep} of ${wizStepsTotal}: ${wizStepTitles[wizStep - 1]}`;

  for (let i = 1; i <= wizStepsTotal; i++) {
    const pill = $(`stepPill${i}`);
    const content = $(`wizardStep${i}`);
    if (pill) {
      pill.classList.remove('active', 'completed');
      if (i === wizStep) pill.classList.add('active');
      else if (i < wizStep) pill.classList.add('completed');
    }
    if (content) {
      if (i === wizStep) content.classList.remove('hidden');
      else content.classList.add('hidden');
    }
  }

  // Back button
  if (wizStep > 1) $('wizBackBtn').classList.remove('hidden');
  else $('wizBackBtn').classList.add('hidden');

  // Next / Submit button
  const nextBtn = $('wizNextBtn');
  if (wizStep === 1) nextBtn.textContent = 'Next: Participants →';
  else if (wizStep === 2) nextBtn.textContent = 'Next: Attendance →';
  else if (wizStep === 3) nextBtn.textContent = 'Next: Review →';
  else if (wizStep === 4) {
    nextBtn.textContent = 'Publish Event';
    populateWizardReview();
  }
}

// Stepper clicks
for (let i = 1; i <= wizStepsTotal; i++) {
  const stepIdx = i;
  $(`stepPill${stepIdx}`).onclick = () => {
    if (stepIdx < wizStep) {
      wizStep = stepIdx;
      renderWizardStep();
    }
  };
}

$('wizBackBtn').onclick = () => {
  if (wizStep > 1) {
    wizStep--;
    renderWizardStep();
  }
};

$('wizResetBtn').onclick = () => {
  if (!confirm('Reset the event organizer form?')) return;
  $('wizEventName').value = '';
  $('wizOrganizer').value = '';
  $('wizVenue').value = '';
  $('wizDate').value = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  $('wizStart').value = '09:00';
  $('wizEnd').value = '17:00';
  updateTimeDisplays();
  $('wizDescription').value = '';
  $('wizScannerName').value = 'Main Entrance Scanner 1';
  if ($('wizYearSelect')) $('wizYearSelect').value = 'ALL';
  updateDurationHint();
  document.querySelector('input[name="wizScope"][value="ALL"]').checked = true;
  document.querySelector('input[name="wizAttendanceType"][value="PRESENT_ONLY"]').checked = true;
  document.querySelectorAll('input[name="wizAttendanceType"]').forEach(r => {
    r.closest('.scope-card')?.classList.toggle('active', r.value === 'PRESENT_ONLY');
  });
  applyScope('ALL');
  showAllRoster = false;
  wizStep = 1;
  renderWizardStep();
};

$('wizNextBtn').onclick = async () => {
  if (wizStep === 1) {
    const name = $('wizEventName').value.trim();
    const venue = $('wizVenue').value.trim();
    const date = $('wizDate').value;
    const start = $('wizStart').value;
    const end = $('wizEnd').value;
    if (!name) return flash('Please enter an Event Name.', 'error');
    if (!venue) return flash('Please enter a Venue.', 'error');
    if (!date) return flash('Please select an Event Date.', 'error');
    if (!start || !end) return flash('Please select Start and End times.', 'error');
    if (end <= start) return flash('End time must be after Start time.', 'error');
    wizStep = 2;
    renderWizardStep();
  } else if (wizStep === 2) {
    if (wizSelectedStudentIds.size === 0) {
      if (!confirm('No students are selected. Create event without pre-enrolled attendees?')) return;
    }
    wizStep = 3;
    renderWizardStep();
  } else if (wizStep === 3) {
    wizStep = 4;
    renderWizardStep();
  } else if (wizStep === 4) {
    await submitWizardEvent();
  }
};

function getFilteredStudents(filterText = '') {
  const q = (filterText || '').toLowerCase().trim();
  const yearVal = $('wizYearSelect') ? $('wizYearSelect').value : 'ALL';
  const scope = document.querySelector('input[name="wizScope"]:checked')?.value || 'ALL';
  const selectedDept = $('wizDeptSelect')?.value;

  return state.students.filter(s => {
    const matchesQuery = !q || s.fullName.toLowerCase().includes(q) || s.studentNumber.toLowerCase().includes(q) || s.program.toLowerCase().includes(q);
    const matchesYear = (yearVal === 'ALL' || getStudentYearLevel(s) === Number(yearVal));
    const matchesDept = (scope !== 'DEPT' || s.program === selectedDept);
    return matchesQuery && matchesYear && matchesDept;
  });
}

let showAllRoster = false;

function renderWizardRoster(filterText = '') {
  const container = $('wizRosterContainer');
  const list = getFilteredStudents(filterText);

  $('wizRosterCount').textContent = `${wizSelectedStudentIds.size} of ${state.students.length} selected`;

  if (!list.length) {
    container.innerHTML = '<div class="muted small" style="padding:16px; text-align:center;">No students matching current filters or search.</div>';
    return;
  }

  const isSearchActive = !!(filterText && filterText.trim());
  const displayLimit = (showAllRoster || isSearchActive) ? list.length : 5;
  const displayList = list.slice(0, displayLimit);
  const remaining = list.length - displayList.length;

  let rowsHtml = displayList.map(s => {
    const checked = wizSelectedStudentIds.has(s.id);
    const yearLabel = getYearLevelLabel(getStudentYearLevel(s));
    return `
      <div class="wizard-roster-row ${checked ? 'selected' : ''}" data-id="${s.id}">
        <input type="checkbox" ${checked ? 'checked' : ''} data-id="${s.id}" style="cursor:pointer; width:16px; height:16px;">
        <div style="flex:1;">
          <b style="font-size:0.86rem; display:block;">${esc(s.fullName)}</b>
          <span class="muted small mono">${esc(s.studentNumber)} &bull; ${esc(s.program)} &bull; ${yearLabel}</span>
        </div>
        <span class="status-pill ${checked ? 'ok' : ''}" style="font-size:0.7rem; padding:2px 8px;">${checked ? 'ENROLLED' : 'EXCLUDED'}</span>
      </div>
    `;
  }).join('');

  if (list.length > 5 && !isSearchActive) {
    rowsHtml += `
      <div style="padding:10px 14px; text-align:center; background:#f8fafc; border-top:1px solid #e2e8f0; font-size:0.82rem; color:#64748b; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px;">
        <span>${showAllRoster ? `Showing all ${list.length} participants` : `Previewing 5 of ${list.length} participants`} <b style="color:#2563eb;">${!showAllRoster && remaining > 0 ? `(+${remaining} more enrolled)` : ''}</b></span>
        <button type="button" class="btn secondary small-btn" id="rosterToggleExpandBtn" style="padding:3px 10px; font-size:0.75rem;">${showAllRoster ? 'Collapse to 5' : `Show All (${list.length})`}</button>
      </div>
    `;
  }

  container.innerHTML = rowsHtml;

  const toggleBtn = $('rosterToggleExpandBtn');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      showAllRoster = !showAllRoster;
      renderWizardRoster($('wizStudentSearch').value);
    };
  }

  container.querySelectorAll('.wizard-roster-row').forEach(row => {
    row.onclick = e => {
      if (e.target.tagName === 'INPUT') return;
      const id = Number(row.dataset.id);
      if (wizSelectedStudentIds.has(id)) wizSelectedStudentIds.delete(id);
      else wizSelectedStudentIds.add(id);
      const customRadio = document.querySelector('input[name="wizScope"][value="CUSTOM"]');
      if (customRadio) {
        customRadio.checked = true;
        document.querySelectorAll('input[name="wizScope"]').forEach(r => r.closest('.scope-card')?.classList.toggle('active', r.value === 'CUSTOM'));
        $('deptSelectWrap').classList.add('hidden');
      }
      renderWizardRoster($('wizStudentSearch').value);
    };
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.onchange = () => {
        const id = Number(cb.dataset.id);
        if (cb.checked) wizSelectedStudentIds.add(id);
        else wizSelectedStudentIds.delete(id);
        const customRadio = document.querySelector('input[name="wizScope"][value="CUSTOM"]');
        if (customRadio) {
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
  const visible = getFilteredStudents($('wizStudentSearch').value);
  visible.forEach(s => wizSelectedStudentIds.add(s.id));
  renderWizardRoster($('wizStudentSearch').value);
};

$('wizClearAllBtn').onclick = () => {
  const visible = getFilteredStudents($('wizStudentSearch').value);
  visible.forEach(s => wizSelectedStudentIds.delete(s.id));
  const customRadio = document.querySelector('input[name="wizScope"][value="CUSTOM"]');
  if (customRadio) {
    customRadio.checked = true;
    document.querySelectorAll('input[name="wizScope"]').forEach(r => r.closest('.scope-card')?.classList.toggle('active', r.value === 'CUSTOM'));
    $('deptSelectWrap').classList.add('hidden');
  }
  renderWizardRoster($('wizStudentSearch').value);
};

function populateWizardReview() {
  $('revName').textContent = $('wizEventName').value.trim() || '—';
  $('revOrganizer').textContent = $('wizOrganizer').value.trim() || 'Student Council';
  $('revVenue').textContent = $('wizVenue').value.trim() || 'Gymnasium';
  $('revDate').textContent = fmtDate($('wizDate').value);
  const dur = calculateDuration($('wizStart').value, $('wizEnd').value);
  const start12 = to12h($('wizStart').value).formatted;
  const end12 = to12h($('wizEnd').value).formatted;
  $('revTime').textContent = `${start12} — ${end12}${dur ? ` (${dur})` : ''}`;
  
  const attType = document.querySelector('input[name="wizAttendanceType"]:checked')?.value || 'PRESENT_ONLY';
  if (attType === 'PRESENT_AND_LOGOUT') {
    $('revAttType').textContent = 'Present and Logout (Two-Stage)';
    $('revAttTypeDesc').textContent = 'Requires Time-In on arrival and Time-Out on departure';
  } else {
    $('revAttType').textContent = 'Present Only (Single Check-In)';
    $('revAttTypeDesc').textContent = 'Single Time-In check-in upon arrival';
  }

  const scope = document.querySelector('input[name="wizScope"]:checked')?.value || 'ALL';
  const yearVal = $('wizYearSelect') ? $('wizYearSelect').value : 'ALL';
  const yearSuffix = yearVal === 'ALL' ? '' : ` (${getYearLevelLabel(yearVal)})`;
  
  $('revAttendees').textContent = `${wizSelectedStudentIds.size} Participants Enrolled`;
  if (scope === 'ALL') $('revScopeDesc').textContent = `Scope: Open to All Students${yearSuffix}`;
  else if (scope === 'DEPT') $('revScopeDesc').textContent = `Scope: ${$('wizDeptSelect').value}${yearSuffix}`;
  else $('revScopeDesc').textContent = `Scope: Custom Selection${yearSuffix}`;

  $('revScanner').textContent = $('wizScannerName').value.trim() || 'Main Entrance Scanner 1';
}

async function submitWizardEvent() {
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

  try {
    const created = await api('/api/manager/events', { method: 'POST', body: JSON.stringify(payload) });
    flash(`Event "${created.name}" created with ${payload.studentIds.length} enrolled attendees.`);
    await Promise.all([loadEvents(), loadDashboard(), loadStudents()]);
    ['registrationEvent', 'attendanceEvent', 'scannerEvent'].forEach(id => {
      $(id).value = created.id;
    });
    await Promise.all([loadRegistrations(), loadAttendance(), loadScanners()]);
    // Reset form for next event
    $('wizResetBtn').click();
    document.getElementById('navDashboard').click();
  } catch (err) {
    flash(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Publish Event';
  }
}

// Initial Page Load
(async () => {
  try {
    await Promise.all([loadDashboard(), loadEvents(), loadStudents()]);
    initEventMaker();
  } catch (err) {
    flash(err.message, 'error');
  }
})();
