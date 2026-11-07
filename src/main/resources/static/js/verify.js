const box = document.getElementById('verifyResult');
const input = document.getElementById('verifyInput');
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));

async function runVerification(rawId, rawToken) {
  if (!rawId || !rawId.trim()) {
    box.innerHTML = '<div class="verify-status UNKNOWN">ENTER ID</div><p style="color:#94a3b8;">Please enter a Certificate ID or verification URL above.</p>';
    return;
  }

  let certId = rawId.trim();
  let token = (rawToken || '').trim();

  // If the user pasted a full verification URL (e.g. http://localhost:8080/verify.html?id=EP-123&token=xyz)
  if (certId.includes('?') || certId.includes('http://') || certId.includes('https://') || certId.includes('id=')) {
    try {
      const url = new URL(certId.startsWith('http') ? certId : ('http://dummy/' + certId));
      const qId = url.searchParams.get('id');
      const qToken = url.searchParams.get('token');
      if (qId) certId = qId;
      if (qToken) token = qToken;
    } catch (e) {
      // Regex fallback if URL parsing fails
      const idMatch = certId.match(/[?&]id=([^&]+)/);
      const tokenMatch = certId.match(/[?&]token=([^&]+)/);
      if (idMatch) certId = decodeURIComponent(idMatch[1]);
      if (tokenMatch) token = decodeURIComponent(tokenMatch[1]);
    }
  }

  if (input) input.value = certId;
  box.innerHTML = '<div class="muted" style="padding:16px 0; color:#94a3b8;">Verifying Ed25519 cryptographic signature...</div>';

  try {
    const res = await fetch(`/api/verify/${encodeURIComponent(certId)}?token=${encodeURIComponent(token)}`);
    const data = await res.json();

    const status = data.status || 'UNKNOWN';
    let statusClass = status;
    if (status !== 'VALID' && status !== 'REVOKED' && status !== 'INVALID') {
      statusClass = 'UNKNOWN';
    }

    let detailsHtml = '';
    if (data.participant) {
      detailsHtml = `
        <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; margin-top:14px; text-align:left;">
          <div style="margin-bottom:10px;">
            <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; font-weight:700;">Participant Name</div>
            <div style="font-size:1.05rem; font-weight:750; color:#ffffff;">${esc(data.participant)}</div>
          </div>
          <div style="margin-bottom:10px;">
            <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; font-weight:700;">Institutional Event</div>
            <div style="font-size:0.95rem; font-weight:600; color:#e2e8f0;">${esc(data.eventName)}</div>
          </div>
          <div>
            <div style="font-size:0.75rem; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; font-weight:700;">Issuance Date</div>
            <div style="font-size:0.9rem; color:#cbd5e1;">${new Date(data.issueDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>
      `;
    }

    box.innerHTML = `
      <div class="verify-status ${statusClass}">${esc(status)} CERTIFICATE</div>
      ${detailsHtml}
      <p style="margin-top:14px; font-size:0.85rem; color:#94a3b8;">
        Certificate Credential: <span class="mono" style="color:#ffffff; font-weight:700;">${esc(data.certificateId || certId)}</span>
      </p>
    `;
  } catch (err) {
    box.innerHTML = '<div class="verify-status UNKNOWN">UNAVAILABLE</div><p style="color:#f87171;">Verification service could not be reached or server is offline.</p>';
  }
}

window.verifyManualSubmit = function() {
  const val = input ? input.value : '';
  runVerification(val);
};

// Initial boot: check if URL query parameter contains ?id=
(function() {
  const params = new URLSearchParams(window.location.search);
  const qId = params.get('id');
  const qToken = params.get('token');

  if (qId) {
    if (input) input.value = qId;
    runVerification(qId, qToken);
  } else {
    box.innerHTML = `
      <div style="padding:16px 14px; background:rgba(255,255,255,0.03); border:1px dashed rgba(255,255,255,0.12); border-radius:12px; color:#94a3b8; font-size:0.88rem;">
        Enter a Certificate ID above or paste an EventProof verification link to inspect its cryptographic authenticity.
      </div>
    `;
  }
})();
