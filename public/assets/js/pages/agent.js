// agent.js — EYES OF VICTORY FIELD AGENT (v2 — full master-spec build)
// Navigation: HOME / REPORT / EVIDENCE / ACTIVITY / PROFILE + persistent floating SOS
// Screens: onboarding (assignment→device→GPS→duty), phase stepper, result wizard with
// OCR confidence labels + math validation + EVR confirmation, incident category grid with
// evidence, hold-to-activate SOS lifecycle, live video controls, evidence library,
// sync centre, messages, security centre, help, contacts, performance, mini-map,
// PU event timeline, duty summary & read-only archive.
'use strict';
(async () => {
  const { user: me } = await bootPortal('Field Agent App', 'Field Agent', { username: 'fieldagent', password: 'Agent@123!' }, { biometric: true, skipApiBoot: true });
  let dash = null, bootstrap = null;
  let offline = false;
  let stack = ['home'];
  let actTab = 'submissions';
  const LS = window.safeStore || { get: () => null, set: () => {}, remove: () => {} };
  let queue = (() => { try { return JSON.parse(LS.get('ndc_offline_queue') || '[]'); } catch (e) { return []; } })().filter(i => i && i.kind);
  let wiz = null, incDraft = null;
  let sosPoll = null, msgPoll = null, clockTimer = null;
  let pendingCaptureLabel = '';

  const PHASES = ['OPENING', 'ACCREDITATION', 'VOTING', 'COUNTING', 'RESULT', 'CLOSURE'];
  const APP_VERSION = '1.4.0';

  // ---------------- data ----------------
  async function loadDash() { try { dash = await API.get('/api/agent/dashboard'); } catch (e) { dash = null; } }
  async function loadAll() { await loadDash(); if (!bootstrap) { try { bootstrap = await API.get('/api/bootstrap'); } catch (e) { bootstrap = null; } } }

  // ---------------- helpers ----------------
  const dutyGate = (action) => {
    if (!dash || !dash.agent) return false;
    if (dash.agent.dutyState === 'NOT_ACTIVATED') { toast('Duty not active', 'Complete your assignment verification and activate duty first.', 'medium'); nav('home'); go('onb1'); return false; }
    if (dash.agent.dutyState === 'DUTY_COMPLETED') { toast('Duty completed', 'Operational submission functions are locked. Records remain available read-only.', 'high'); return false; }
    if (offline && ['result', 'evidence'].includes(action)) { /* offline allowed */ }
    return true;
  };
  function friendlyErr(err) {
    if (!err) return 'Something went wrong. Please try again.';
    if (err.status === 409) return 'A similar submission already exists for this polling unit. Review before submitting again — the original record is preserved.';
    if (err.status === 403 && err.data && err.data.error === 'DEVICE_NOT_AUTHORIZED') return `This device is ${err.data.message || 'not authorized'}. A revoked or locked device cannot submit new evidence. Contact technical support.`;
    if (err.status === 400 && err.data && err.data.error === 'DUTY_COMPLETED') return 'Duty completed — submission functions are locked. Your records remain available read-only.';
    if (err.status === 400 && err.data && err.data.error === 'PU_MISMATCH') return 'You may only submit for your assigned polling unit.';
    if (err.status === 401) return 'Your session has expired. Please sign in again.';
    if (err.message === 'Failed to fetch') return 'We could not complete the upload. Your information has been safely saved and will retry automatically.';
    return (err.data && err.data.message) || err.message || 'Something went wrong. Please try again.';
  }
  function errModal(err, { retry, onOffline } = {}) {
    const msg = friendlyErr(err);
    const m = modal({
      title: '⚠ Unable to complete action',
      body: () => el(`<div class="small muted" style="line-height:1.7">${esc(msg)}</div>`),
      actions: [
        { label: 'Continue offline', cls: 'ghost', onClick: () => { m.close(); onOffline && onOffline(); } },
        { label: 'Try again', cls: 'primary', onClick: () => { m.close(); retry && retry(); } },
      ],
    });
  }
  const connInfo = () => {
    if (offline) return { label: 'OFFLINE — DATA WILL SYNC AUTOMATICALLY', quality: 'OFFLINE', bars: 0 };
    const n = (dash.agent.network || '4G');
    if (n.startsWith('4')) return { label: 'ONLINE', quality: 'EXCELLENT', bars: 4 };
    if (n.startsWith('3')) return { label: 'ONLINE', quality: 'GOOD', bars: 3 };
    return { label: 'ONLINE', quality: 'WEAK', bars: 2 };
  };
  const phaseIndex = () => {
    const h = new Date(dash.sim.now + 3600e3).getUTCHours();
    if (h < 8) return 0; if (h < 10) return 1; if (h < 14) return 2; if (h < 16) return 3; if (h < 20) return 4;
    return 5;
  };
  const dutyDuration = () => {
    if (!dash.agent.activatedAt) return '—';
    const m = Math.max(0, Math.round((dash.sim.now - dash.agent.activatedAt) / 60000));
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
  };
  const batteryCls = (b) => b < 15 ? 'bad' : b < 30 ? 'warn' : '';
  const gpsStatus = () => {
    const g = dash.agent.gps, p = dash.assignment.pu;
    if (!g || !p) return { ok: false, label: 'LOCATION NOT VERIFIED', m: null };
    const dLat = (g.lat - p.lat) * 111320, dLon = (g.lon - p.lon) * 111320 * Math.cos(p.lat * Math.PI / 180);
    const m = Math.round(Math.hypot(dLat, dLon));
    return { ok: m < 300, label: m < 300 ? 'LOCATION VERIFIED' : 'LOCATION NOT VERIFIED', m };
  };

  // ---------------- offline queue ----------------
  const saveQueue = () => LS.set('ndc_offline_queue', JSON.stringify(queue));
  async function doCall(item) {
    if (item.kind === 'result') return API.post('/api/results', item.payload);
    if (item.kind === 'incident') return API.post('/api/incidents', item.payload);
    if (item.kind === 'incident-evidence') {
      const inc = await API.post('/api/incidents', item.payload.incident);
      for (const ph of (item.payload.photos || [])) {
        await API.post('/api/evidence', { kind: 'PHOTO', dataUrl: ph.dataUrl, description: 'Incident evidence (synced)', relatedType: 'incident', relatedId: inc.id });
      }
      return inc;
    }
    if (item.kind === 'sos') return API.post('/api/sos', item.payload);
    if (item.kind === 'duty') return API.post('/api/agent/duty', item.payload);
    if (item.kind === 'evidence') return API.post('/api/evidence', item.payload);
    if (item.kind === 'report') return API.post('/api/reports/field', item.payload);
    if (item.kind === 'stream-start') return API.post('/api/streams/start', item.payload);
    if (item.kind === 'stream-stop') return API.post(`/api/streams/${item.payload.id}/stop`, item.payload);
  }
  async function enqueue(kind, payload) {
    queue.unshift({ id: 'q-' + Date.now() + '-' + Math.floor(Math.random() * 9999), kind, payload, ts: Date.now(), status: 'waiting', retries: 0 });
    saveQueue();
    toast('Offline — queued securely', 'Item stored locally and will synchronize automatically when connectivity returns');
    header(); render();
  }
  async function syncQueue(showToast = true) {
    if (offline) { toast('Offline', 'Connectivity is required to synchronize.', 'medium'); return; }
    let synced = 0, failed = 0;
    for (const item of [...queue]) {
      item.status = 'uploading'; saveQueue();
      try {
        const res = await doCall(item);
        item.resultCode = res && res.code;
        queue.splice(queue.indexOf(item), 1);
        synced++;
      } catch (e) {
        item.status = 'failed'; item.retries++; item.lastError = friendlyErr(e);
        failed++;
        if (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404) { queue.splice(queue.indexOf(item), 1); } // unrecoverable
      }
      saveQueue();
    }
    if (showToast) toast(synced ? 'Synchronization complete' : 'Sync finished', synced ? `${synced} item(s) uploaded and acknowledged.` : failed ? `${failed} item(s) could not upload — will retry automatically.` : 'Nothing to sync.');
    header(); render(); await loadDash();
  }

  // ---------------- capture (simulated camera) ----------------
  function capturePhoto(label, w = 360, h = 200) {
    return new Promise((resolve) => {
      const m = modal({
        title: '📷 Evidence camera — keep the object fully visible',
        body: () => {
          const d = el(`<div>
            <div class="small muted mb12" id="camstate">Auto-focus: <b>focusing…</b> · edge detection ✓ · lighting ✓</div>
            <div style="border-radius:9px;overflow:hidden;border:1px solid var(--line2);background:#000"><canvas id="camcv" width="${w}" height="${h}" style="width:100%"></canvas></div>
            <div class="row mt12">
              <button class="btn sm" id="camflash">⚡ Flash</button>
              <button class="btn sm" id="camretake">↻ Retake</button>
              <span class="flex1"></span>
              <button class="btn success" id="camaccept">✓ Accept</button>
            </div>
          </div>`);
          const cv = $('#camcv', d);
          const draw = () => {
            const c = cv.getContext('2d');
            const g = c.createLinearGradient(0, 0, 0, h);
            g.addColorStop(0, '#c9bf9e'); g.addColorStop(1, '#83795f');
            c.fillStyle = g; c.fillRect(0, 0, w, h);
            c.fillStyle = '#3f3a30'; c.font = 'bold 13px sans-serif'; c.textAlign = 'center';
            c.fillText(label || 'POLLING UNIT ENVIRONMENT', w / 2, 46);
            c.font = '10px sans-serif'; c.fillStyle = '#4a4437';
            c.fillText(`${dash.assignment.pu?.name || ''} · ${dash.assignment.lga} LGA`, w / 2, 62);
            for (let i = 0; i < 8; i++) { c.fillRect(24 + i * 42, 92, 26, 78); c.beginPath(); c.arc(37 + i * 42, 88, 9, 0, 7); c.fill(); }
            c.fillStyle = '#554d3c'; c.font = '9px sans-serif';
            c.fillText('DEMO SCENE — SIMULATED CAPTURE · ORIGINAL PRESERVED UNMODIFIED', w / 2, h - 12);
          };
          draw();
          cv.style.filter = 'blur(6px)';
          setTimeout(() => { cv.style.filter = 'blur(0px)'; $('#camstate', d).innerHTML = 'Auto-focus: <b>focused ✓</b> · edge detection ✓ · lighting ✓'; }, 800);
          $('#camflash', d).onclick = () => { draw(); toast('Flash', 'Lighting adjusted for the next capture.'); };
          $('#camretake', d).onclick = () => { draw(); cv.style.filter = 'blur(6px)'; setTimeout(() => { cv.style.filter = 'blur(0px)'; }, 600); };
          $('#camaccept', d).onclick = () => {
            const dataUrl = cv.toDataURL('image/png');
            const hash = strHash(dataUrl);
            m.close();
            resolve({ dataUrl, hash, quality: 88 + Math.floor(Math.random() * 11), at: Date.now(), lat: dash.agent.gps?.lat, lon: dash.agent.gps?.lon });
          };
          return d;
        },
        actions: [{ label: 'Cancel', cls: 'ghost' }],
      });
    });
  }

  // ---------------- shell ----------------
  const host = el(`<div class="agent-host"><div class="phone"><div class="phone-wrap">
    <div class="phead" id="phead"></div>
    <div class="pbody" id="pbody"></div>
    <div class="pnav" id="pnav"></div>
    <button class="floating-sos" id="floatSos" title="Emergency / SOS — hold to activate">🚨</button>
  </div></div></div>`);
  document.body.innerHTML = '';
  document.body.appendChild(host);

  function header() {
    const ph = $('#phead');
    if (!dash || !dash.agent) { ph.innerHTML = '<div class="small muted">EYES OF VICTORY — FIELD AGENT</div>'; return; }
    const a = dash.agent, as = dash.assignment;
    const dutyCol = { 'NOT_ACTIVATED': 'bad', ACTIVATED: 'warn', ON_DUTY: 'ok', POLLING_MONITORING: 'ok', RESULT_SUBMITTED: 'warn', UNDER_REVIEW: 'warn', VERIFIED: 'ok', REJECTED: 'bad', DUTY_COMPLETED: '' };
    const conn = connInfo();
    ph.innerHTML = `
      <div class="flex mb12" style="justify-content:space-between">
        <span class="flex" style="gap:8px">
          <img src="/assets/media/logo.png" alt="EYES OF VICTORY" style="height:20px;width:auto;object-fit:contain" onerror="this.style.display='none'">
          <span style="font-size:9px;letter-spacing:1.6px;color:var(--muted);text-transform:uppercase"><b style="color:#fff">EYES OF VICTORY</b><br>FIELD AGENT</span>
        </span>
        <span class="small dim mono" id="hdclock">${watClock(dash.sim.now)} WAT</span>
      </div>
      <div class="flex">
        <div><b style="color:#fff;font-size:13.5px">${esc(a.name)}</b><br><span class="small muted mono">${esc(a.code)} · ${esc(as.pu?.id || '—')}</span></div>
        <span class="right status-row">
          <span class="st ${offline ? 'bad' : 'ok'}">${conn.quality}</span>
          <span class="st ${gpsStatus().ok ? 'ok' : 'warn'}">GPS ${gpsStatus().ok ? '✓' : '⚠'}</span>
          <span class="st ${batteryCls(a.battery)}">🔋${a.battery}%</span>
        </span>
      </div>
      <div class="small muted mt8">${esc(as.ward || '')} · ${esc(as.lga || '')} LGA · ${esc(as.senatorial || '')}</div>
      <div class="flex mt8" style="flex-wrap:wrap">
        <span class="st ${dutyCol[a.dutyState] || ''}">${esc(a.dutyState)}</span>
        <span class="pill">SIGNAL: ${esc(a.signal || 'NORMAL')}</span>
        <span class="pill">DUTY: ${dutyDuration()}</span>
        <span class="pill dim">Sync: ${a.lastHeartbeat ? fmtWatShort(a.lastHeartbeat) : '—'}</span>
        <span class="right"><button class="btn sm ghost" id="offtoggle">${offline ? 'Go online' : 'Simulate offline'}</button></span>
      </div>
      ${queue.length ? `<div class="offline-banner mt8">⏳ ${queue.length} ITEM${queue.length > 1 ? 'S' : ''} WAITING TO SYNC — uploads resume automatically when connectivity returns. <a href="#" id="bannerSync" class="small">Open Sync Centre →</a></div>` : ''}`;
    $('#offtoggle').onclick = () => {
      offline = !offline;
      toast(offline ? 'OFFLINE MODE' : 'Back online', offline ? 'Capture continues locally. Sync is automatic.' : 'Synchronizing queued items…', offline ? 'medium' : '');
      if (!offline) syncQueue(true);
      else header(); render();
    };
    const bs = $('#bannerSync'); if (bs) bs.onclick = (e) => { e.preventDefault(); go('sync'); };
  }

  function bottomNav() {
    const tabs = [['home', '🏠', 'HOME'], ['report', '📋', 'REPORT'], ['evidence', '📷', 'EVIDENCE'], ['activity', '🕘', 'ACTIVITY'], ['profile', '👤', 'PROFILE']];
    const active = stack[0];
    $('#pnav').innerHTML = `<div class="bottom-nav">${tabs.map(([id, ic, l]) => `<div class="bn ${active === id ? 'active' : ''}" data-v="${id}"><span class="bi">${ic}</span>${l}</div>`).join('')}</div>`;
    $$('[data-v]', $('#pnav')).forEach(b => b.onclick = () => nav(b.dataset.v));
  }

  function nav(v) { stack = [v]; viewParam = null; render(); }
  function go(v, param) { viewParam = param; stack.push(v); render(); }
  function back() { if (stack.length > 1) { stack.pop(); render(); } else nav('home'); }
  let viewParam = null;

  $('#floatSos').onclick = () => { go('sosflow'); };
  $('#floatSos').title = 'EMERGENCY / SOS';

  function render() {
    header(); bottomNav();
    const top = stack[stack.length - 1];
    const body = $('#pbody');
    body.innerHTML = '';
    $('#floatSos').style.display = ['sosflow', 'onb1', 'onb2', 'onb3', 'onb4', 'dutycomplete'].includes(top) ? 'none' : 'block';
    if (!dash || !dash.agent) { body.appendChild(el(`<div class="agent-card"><h3><span class="ico">ℹ</span>No field-agent assignment</h3><div class="small muted">This account is not linked to a field-agent record. Contact the administrator.</div></div>`)); return; }
    const V = { home: vHome, report: vReport, evidence: vEvidence, activity: vActivity, profile: vProfile, onb1: vOnb1, onb2: vOnb2, onb3: vOnb3, onb4: vOnb4, dutyactive: vDutyActive, resultflow: vResultFlow, resultdone: vResultDone, incidentflow: vIncidentFlow, incdone: vIncDone, sosflow: vSosFlow, video: vVideo, fieldreport: vFieldReport, subdetail: vSubDetail, incdetail: vIncidentDetail, dutysummary: vDutySummary, dutycomplete: vDutyComplete, map: vMap, messages: vMessages, security: vSecurity, settings: vSettings, help: vHelp, contacts: vContacts, performance: vPerformance, device: vDevice, sync: vSync };
    const fn = V[top] || vHome;
    fn(body);
  }

  // ---------------- HOME (§62 hierarchy) ----------------
  function vHome(b) {
    const a = dash.agent;
    if (a.dutyState === 'DUTY_COMPLETED') { vDutyComplete(b); return; }
    const conn = connInfo(), gps = gpsStatus();
    const bars = [1, 2, 3, 4].map(i => `<i style="height:${i * 3 + 2}px" class="${i <= conn.bars ? 'on' : ''}"></i>`).join('');
    // duty status card
    b.appendChild(el(`
      <div class="agent-card" style="border-color:${a.dutyState === 'NOT_ACTIVATED' ? '#78350f' : '#14532d'}">
        <div class="flex"><h3 style="margin:0"><span class="ico">${a.dutyState === 'NOT_ACTIVATED' ? '⏸' : '●'}</span>DUTY STATUS — ${a.dutyState === 'NOT_ACTIVATED' ? 'NOT ACTIVATED' : esc(a.dutyState)}</h3>
        <span class="right small mono dim">${watClock(dash.sim.now)} WAT</span></div>
        <div class="small muted mt8">Duty duration: <b>${dutyDuration()}</b> · ${esc(dash.assignment.pu?.name || '')} · ${esc(dash.assignment.ward)} · ${esc(dash.assignment.lga)} LGA</div>
      </div>
      <div class="agent-card">
        <div class="flex mb12"><b class="small">CONNECTIVITY</b><span class="right conn-label"><span class="bars ${offline ? 'off' : conn.quality === 'WEAK' ? 'weak' : ''}">${bars}</span> <b style="color:${offline ? '#f87171' : '#4ade80'}">${conn.quality}</b></span></div>
        ${offline ? '<div class="small" style="color:#fde68a">OFFLINE — your information will be securely queued and synchronized when connectivity returns.</div>' : ''}
        <div class="flex mt12"><b class="small">GPS</b><span class="right st ${gps.ok ? 'ok' : 'warn'}">${gps.label}</span></div>
        <div class="small muted mt12">Accuracy ±8 m · ${a.gps ? a.gps.lat.toFixed(5) + ', ' + a.gps.lon.toFixed(5) : '—'} · Last update: ${fmtWatShort(a.lastHeartbeat || dash.sim.now)}</div>
        <div class="flex mt12"><b class="small">BATTERY</b>
          <span class="right battery-bar" style="width:130px"><div class="bb-track"><div class="bb-fill ${batteryCls(a.battery)}" style="width:${a.battery}%"></div></div><b>${a.battery}%</b></span>
        </div>
        ${a.battery < 30 ? `<div class="small mt8" style="color:#fbbf24">⚠ Battery is ${a.battery < 15 ? 'critically ' : ''}low. Consider enabling power-saving mode in Settings. Evidence capture is never disabled without warning.</div>` : ''}
      </div>`));
    // election-day phase stepper
    const pi = phaseIndex();
    b.appendChild(el(`
      <div class="agent-card"><h3><span class="ico">🗓</span>ELECTION-DAY PHASE</h3>
        <div class="phase-track">
          ${PHASES.map((p, i) => `<div class="ph-step ${i < pi ? 'done' : i === pi ? 'current' : ''}"><div class="ph-dot"></div><div class="ph-label">${p}</div></div>`).join('')}
        </div>
        <div class="small muted mt8">Current phase: <b style="color:var(--cyan)">${PHASES[pi]}</b> — report what you personally observe at each stage.</div>
      </div>`));
    // primary actions
    const grid = el('<div class="agent-grid"></div>');
    const cards = [
      ['result', '📄', 'SUBMIT RESULT', 'Capture and submit result documentation', false],
      ['incident', '⚠️', 'REPORT INCIDENT', 'Report an election-related incident', false],
      ['sos', '🚨', 'EMERGENCY / SOS', 'Request immediate operational assistance', false],
      ['video', '🎥', 'LIVE VIDEO', 'Start authorized live transmission', false],
      ['fieldreport', '📝', 'FIELD REPORT', 'Submit operational observation', false],
      ['evidence', '📷', 'EVIDENCE', 'Capture supporting evidence', false],
    ];
    for (const [id, ic, label, desc, disabled] of cards) {
      const c = el(`<div class="agent-btn ${id === 'sos' ? 'danger' : ''}" style="opacity:${a.dutyState === 'NOT_ACTIVATED' && id !== 'sos' ? '.45' : '1'}"><span class="big">${ic}</span>${label}<span class="small dim" style="font-weight:400">${desc}</span></div>`);
      c.onclick = () => {
        if (id === 'sos') go('sosflow');
        else if (id === 'video') { if (dutyGate()) go('video'); }
        else if (id === 'evidence') { if (dutyGate('evidence')) go('evidence'); }
        else if (id === 'fieldreport') { if (dutyGate()) go('fieldreport'); }
        else { if (dutyGate()) go(id === 'result' ? 'resultflow' : 'incidentflow'); }
      };
      grid.appendChild(c);
    }
    b.appendChild(grid);
    // onboarding CTA
    if (a.dutyState === 'NOT_ACTIVATED') {
      b.appendChild(el(`<div class="agent-card" style="border-color:#155e75">
        <h3><span class="ico">🔓</span>Begin duty</h3>
        <div class="small muted mb12">Verify your assignment, device and location, then activate duty. Activation records your timestamp, GPS, device and assignment.</div>
        <button class="btn primary btnblock" id="startOnb">Verify assignment →</button>
      </div>`));
      $('#startOnb').onclick = () => go('onb1');
    } else if (['ACTIVATED'].includes(a.dutyState)) {
      b.appendChild(el(`<div class="agent-card" style="border-color:#155e75">
        <h3><span class="ico">📍</span>Check in</h3>
        <div class="small muted mb12">Confirm you are at the polling unit to begin polling monitoring.</div>
        <button class="btn success btnblock" id="checkinBtn">✓ Check in at Polling Unit</button>
      </div>`));
      $('#checkinBtn').onclick = async () => { await apiOrQueue({ kind: 'duty', payload: { action: 'checkin' } }); await loadDash(); toast('Checked in', 'GPS captured at polling unit'); render(); };
    }
    // current tasks
    const tasks = dash.checklist.filter(c => !c.done).slice(0, 4);
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">✅</span>CURRENT TASKS</h3>
      ${tasks.length ? tasks.map(t => `<div class="flex mb12"><span style="width:20px">⬜</span><span class="small">${esc(t.label)}</span></div>`).join('') : '<div class="small muted">All checklist items complete.</div>'}</div>`));
    // sync status
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🔄</span>SYNC STATUS</h3>
      <div class="small muted">Pending uploads: <b style="color:${queue.length ? '#fbbf24' : '#4ade80'}">${queue.length}</b> · Last sync: ${a.lastHeartbeat ? fmtWatShort(a.lastHeartbeat) : '—'} · Automatic synchronization: ${offline ? 'PAUSED (offline)' : 'ACTIVE'}</div>
      ${queue.length ? `<button class="btn sm mt12" id="qsync">Open Sync Centre</button>` : ''}</div>`));
    const qs = $('#qsync'); if (qs) qs.onclick = () => go('sync');
    // recent activity
    const recent = (dash.timeline || []).slice(0, 4);
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🕘</span>RECENT ACTIVITY</h3>
      ${recent.length ? recent.map(r => `<div class="flex mb12"><span class="t mono small" style="width:52px;color:var(--dim)">${fmtWatShort(r.t)}</span><span class="small">${esc(r.label)} ${r.detail ? `<span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('') : '<div class="small muted">No activity recorded yet.</div>'}</div>`));
  }

  // ---------------- REPORT tab ----------------
  function vReport(b) {
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">📋</span>REPORT</h3>
      <div class="small muted">Choose the report type. Every submission is timestamped, located and evidence-linked.</div></div>`));
    const rows = [
      ['resultflow', '📄', 'SUBMIT RESULT', 'Capture EC8A document, OCR cross-check, validate figures and submit for supervisory verification.'],
      ['incidentflow', '⚠️', 'REPORT INCIDENT', 'Fast incident reporting with categories, severity and photo evidence.'],
      ['fieldreport', '📝', 'FIELD REPORT', 'Structured operational questions — answer only what you personally observed.'],
    ];
    for (const [target, ic, label, desc] of rows) {
      const c = el(`<div class="agent-card" style="cursor:pointer" data-go="${target}">
        <div class="flex"><span style="font-size:22px">${ic}</span><span><b>${label}</b><br><span class="small muted">${desc}</span></span><span class="right dim">→</span></div></div>`);
      c.onclick = () => { if (dutyGate()) go(target); };
      b.appendChild(c);
    }
  }

  // ---------------- EVIDENCE tab ----------------
  let serverEvidence = null;
  async function loadEvidence() { try { serverEvidence = (await API.get('/api/agent/evidence')).rows; } catch (e) { serverEvidence = []; } }
  function vEvidence(b) {
    const grid = el(`<div class="agent-grid mb12">
      <div class="agent-btn" id="evcapture"><span class="big">📷</span>CAPTURE EVIDENCE<span class="small dim" style="font-weight:400">Photo / document</span></div>
      <div class="agent-btn" id="evsync"><span class="big">🔄</span>SYNC CENTRE<span class="small dim" style="font-weight:400">${queue.length} pending</span></div>
    </div>`);
    grid.querySelector('#evcapture').onclick = async () => {
      if (!dutyGate('evidence')) return;
      const ph = await capturePhoto('EVIDENCE CAPTURE — keep the document/object fully visible');
      const payload = { kind: 'PHOTO', dataUrl: ph.dataUrl, description: 'Field evidence' };
      if (offline) return enqueue('evidence', payload);
      try {
        const res = await API.post('/api/evidence', payload);
        toast('Evidence secured', `${res.code} — SHA-256 fingerprint computed`);
        await loadEvidence(); render();
      } catch (e) { errModal(e, { retry: () => {}, onOffline: () => enqueue('evidence', payload) }); }
    };
    grid.querySelector('#evsync').onclick = () => go('sync');
    b.appendChild(grid);
    const filt = el(`<div class="seg mb12" id="evfilter">${['ALL', 'PHOTO', 'DOCUMENT', 'VIDEO', 'AUDIO'].map((f, i) => `<span class="sg ${i === 0 ? 'on' : ''}" data-f="${f}">${f}</span>`).join('')}</div>`);
    b.appendChild(filt);
    const box = el('<div id="evbox"><span class="dim small">Loading evidence…</span></div>');
    b.appendChild(box);
    const draw = () => {
      const f = $('#evfilter').querySelector('.sg.on').dataset.f;
      const rows = (serverEvidence || []).filter(e => f === 'ALL' || e.kind === f);
      const local = queue.filter(q => q.kind === 'evidence').map(q => ({ code: 'LOCAL-QUEUED', kind: q.payload.kind || 'PHOTO', capturedAt: q.ts, local: true, description: q.payload.description || '' }));
      const all = [...local, ...rows];
      box.innerHTML = all.length ? `<div class="ev-grid">${all.map(e => `
        <div class="ev-card" data-ev="${e.id || e.code}">
          ${e.dataUrl ? `<img src="${e.dataUrl}">` : `<div class="ev-thumb">${e.kind === 'PHOTO' ? '📷' : e.kind === 'DOCUMENT' ? '📄' : e.kind === 'VIDEO' ? '🎥' : '🎙'}</div>`}
          <div class="ev-meta"><b>${esc(e.code || 'EVIDENCE')}</b>${esc(e.kind)} · ${fmtWatShort(e.capturedAt)}<br>${e.local ? '<span style="color:#fbbf24">⏳ waiting to sync</span>' : e.relatedTo ? 'linked: ' + esc(e.relatedTo.type) + ' ' + esc(e.relatedTo.id.slice(0, 12)) : 'standalone'}<br>${e.local ? '' : 'SHA-256 ' + esc((e.sha256 || '').slice(0, 14)) + '…'}</div>
        </div>`).join('')}</div>` : '<div class="empty small">No evidence captured yet — photos, documents, videos and audio appear here.</div>';
      $$('.ev-card', box).forEach(c => c.onclick = () => {
        const e = (serverEvidence || []).find(x => x.id === c.dataset.ev);
        if (!e) { toast('Queued locally', 'This item will synchronize when connectivity returns.'); return; }
        modal({
          title: `${e.code} — ${e.kind} evidence`,
          body: () => el(`<div>
            ${e.dataUrl ? `<img src="${e.dataUrl}" style="width:100%;border-radius:8px;border:1px solid var(--line2)">` : ''}
            <div class="detail-grid mt12">
              <span class="k">Captured</span><span class="v">${fmtWatShort(e.capturedAt)}</span>
              <span class="k">Uploaded</span><span class="v">${fmtWatShort(e.uploadedAt)}</span>
              <span class="k">Location</span><span class="v">${e.gps ? e.gps.lat.toFixed(5) + ', ' + e.gps.lon.toFixed(5) : '—'}</span>
              <span class="k">SHA-256</span><span class="v mono small">${esc(e.sha256)}</span>
              <span class="k">Size</span><span class="v">${fmtN(e.sizeBytes)} bytes</span>
              <span class="k">Linked</span><span class="v">${e.relatedTo ? esc(e.relatedTo.type) + ' ' + esc(e.relatedTo.id.slice(0, 14)) : e.submissionId ? 'submission ' + esc(e.submissionId.slice(0, 14)) : 'standalone'}</span>
            </div>
            <div class="small muted mt12">Evidence is immutable after submission. Chain of custody: ${(e.chain || []).map(ch => ch.step).join(' → ')}</div>
          </div>`),
          actions: [{ label: 'Close', cls: 'ghost' }],
        });
      });
    };
    $$('.sg', filt).forEach(s => s.onclick = () => { $$('.sg', filt).forEach(x => x.classList.remove('on')); s.classList.add('on'); draw(); });
    loadEvidence().then(draw);
  }

  // ---------------- ACTIVITY tab ----------------
  function vActivity(b) {
    const seg = el(`<div class="act-seg">${[['submissions', '🗂 Submissions'], ['incidents', '⚠️ Incidents'], ['timeline', '🕘 Timeline'], ['notifications', '🔔 Alerts']].map(([id, l]) => `<span class="as ${actTab === id ? 'on' : ''}" data-t="${id}">${l}</span>`).join('')}</div>`);
    b.appendChild(seg);
    $$('.as', seg).forEach(s => s.onclick = () => { actTab = s.dataset.t; render(); });
    const box = el('<div></div>'); b.appendChild(box);
    if (actTab === 'notifications') {
      if (dash.notifications.length) API.post('/api/notifications/read', {}).catch(() => {});
      box.innerHTML = dash.notifications.length ? dash.notifications.map(n => `
        <div class="notif-item"><div class="n-t">${n.priority === 'CRITICAL' ? '🚨' : n.priority === 'HIGH' ? '⚠️' : '🔔'} <b>${esc(n.title)}</b><span class="n-p ${n.priority.toLowerCase()}">${esc(n.priority)}</span></div>
        <div class="small mt8">${esc(n.body)}<br>${fmtWatShort(n.createdAt)}</div></div>`).join('') : '<div class="empty small">No notifications</div>';
    } else if (actTab === 'submissions') {
      box.innerHTML = dash.submissions.length ? dash.submissions.map(s => `
        <div class="sub-row" data-sub="${s.id}"><span style="font-size:17px">📄</span>
        <span class="sr-main"><b>${esc(s.code || s.id.slice(0, 8))} — ${esc(s.type || '')}</b><span class="small">${esc(dash.assignment.pu?.id)} · ${fmtWatShort(s.submittedAt)}</span></span>
        ${statusBadge(s.status)}</div>`).join('') : '<div class="empty small">No submissions yet — results you submit appear here with their verification state.</div>';
      $$('[data-sub]', box).forEach(x => x.onclick = () => go('subdetail', x.dataset.sub));
    } else if (actTab === 'incidents') {
      box.innerHTML = dash.incidents.length ? dash.incidents.map(i => `
        <div class="sub-row" data-inc="${i.id}"><span style="font-size:17px">⚠️</span>
        <span class="sr-main"><b>${esc(i.code)} — ${esc(i.subcategory)}</b><span class="small">${fmtWatShort(i.createdAt)} · ${esc(i.puId)}</span></span>
        ${sevBadge(i.severity)} ${statusBadge(i.status)}</div>`).join('') : '<div class="empty small">No incidents reported yet.</div>';
      $$('[data-inc]', box).forEach(x => x.onclick = () => go('incdetail', x.dataset.inc));
    } else {
      box.innerHTML = (dash.timeline || []).length ? `<div class="feed">${dash.timeline.map(r => `
        <div class="item"><span class="t">${fmtWatShort(r.t)}</span><span class="tx"><b>${esc(r.label)}</b>${r.detail ? ` <span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('')}</div>` : '<div class="empty small">No events yet.</div>';
    }
  }

  // ---------------- PROFILE tab ----------------
  function vProfile(b) {
    const a = dash.agent;
    b.appendChild(el(`<div class="agent-card">
      <div class="flex"><span style="font-size:26px">👤</span>
        <span><b style="color:#fff">${esc(a.name)}</b><br><span class="small muted mono">${esc(a.code)}</span><br><span class="small muted">${statusBadge(a.dutyState)}</span></span>
        <span class="right small muted">v${esc(a.appVersion || APP_VERSION)}</span></div>
    </div>`));
    const menu = el(`<div class="profile-menu">
      ${[
        ['assignment', '📍', 'My assignment', 'Polling unit · ward · LGA · district'],
        ['device', '📱', 'Device & integrity', `Device registration · authorization`],
        ['security', '🛡', 'Security centre', 'Sessions · MFA · lock account'],
        ['performance', '📊', 'My performance', 'Operational completeness & data quality'],
        ['map', '🗺', 'My assigned location', 'Assignment boundary & GPS'],
        ['messages', '💬', 'Operational messages', 'Ward · LG · supervisor · central'],
        ['contacts', '📞', 'Operational contacts', 'Administrator-configured contacts'],
        ['help', '❓', 'Help centre', 'Guides · offline · SOS · support'],
        ['settings', '⚙', 'Settings', 'Biometric · power saving · notifications'],
        ['sync', '🔄', 'Sync centre', `${queue.length} pending upload(s)`],
        ['dutysummary', '🏁', 'Field duty summary', 'Complete duty & archive record'],
      ].map(([id, ic, label, desc]) => `
        <div class="pm" data-go="${id}"><span class="pm-ic">${ic}</span><span><b style="color:var(--text)">${label}</b><br><span class="small muted">${desc}</span></span><span class="pm-arrow">→</span></div>`).join('')}
    </div>`);
    b.appendChild(menu);
    $$('[data-go]', menu).forEach(x => x.onclick = () => {
      const t = x.dataset.go;
      if (t === 'assignment') go('onb1');
      else if (t === 'dutysummary') { if (dash.agent.dutyState === 'DUTY_COMPLETED') go('dutycomplete'); else go('dutysummary'); }
      else go(t);
    });
    const lo = el(`<div class="mt12"><button class="btn ghost btnblock" id="signout">⏻ Log out</button></div>`);
    lo.querySelector('#signout').onclick = async () => { try { await API.post('/api/auth/logout', {}); } catch (e) {} API.clear(); location.href = '/agent'; };
    b.appendChild(lo);
    b.appendChild(el(`<div class="small muted mt12 center">DEMO ENVIRONMENT — fictional data · DEMO DATA — NOT OFFICIAL ELECTION RESULTS</div>`));
  }

  // ---------------- ONBOARDING ----------------
  function onbShell(b, stepIdx, inner) {
    b.innerHTML = `<div class="onboard">
      <div class="prog-dots">${[0, 1, 2, 3].map(i => `<span class="pd ${i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}"></span>`).join('')}</div>
      <div class="ob-body" id="obbody"></div>
      <div class="ob-nav" id="obnav"></div>
    </div>`;
    const bb = $('#obbody', b);
    bb.appendChild(typeof inner === 'function' ? inner() : inner);
    const nav = $('#obnav', b);
    if (stepIdx > 0) {
      const prev = el('<button class="btn">← Back</button>');
      prev.onclick = () => go('onb' + stepIdx);
      nav.appendChild(prev);
    }
    return { bb, nav, addNext: (label, fn, cls) => { const nx = el(`<button class="btn ${cls || 'primary'}" style="flex:1">${label}</button>`); nx.onclick = fn; nav.appendChild(nx); return nx; } };
  }
  function vOnb1(b) {
    const as = dash.assignment;
    const s = onbShell(b, 0, () => el(`<div class="agent-card"><h3><span class="ico">📍</span>YOUR ASSIGNMENT</h3>
      <div class="detail-grid mt8">
        <span class="k">Polling Unit</span><span class="v">${esc(as.pu?.id || '—')}</span>
        <span class="k">PU Name</span><span class="v">${esc(as.pu?.name || '—')}</span>
        <span class="k">Ward</span><span class="v">${esc(as.ward || '—')}</span>
        <span class="k">LGA</span><span class="v">${esc(as.lga || '—')}</span>
        <span class="k">Senatorial District</span><span class="v">${esc(as.senatorial || '—')}</span>
        <span class="k">State</span><span class="v">${esc(as.state || 'Kano')}</span>
      </div>
      <div class="small muted mt12">Confirm this assignment corresponds to your authorized deployment. You cannot change the polling unit yourself.</div>
    </div>`));
    s.addNext('✗ Report assignment issue', () => {
      const m = modal({
        title: 'Report assignment issue',
        body: () => el(`<label class="fl">What appears incorrect?</label><textarea class="inp" id="ai" rows="3" placeholder="Describe the mismatch. This creates an audited incident for your coordinator."></textarea>`),
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Report (audited)', cls: 'warn', onClick: async () => {
          try {
            const res = await API.post('/api/agent/assignment/issue', { note: $('#ai').value });
            toast('Assignment issue reported', `${res.code} — a coordinator will review.`, 'high');
          } catch (e) { toast('Error', friendlyErr(e), 'high'); }
        } }],
      });
    }, 'ghost');
    s.addNext('✓ VERIFY ASSIGNMENT', async () => {
      try { await API.post('/api/agent/assignment/verify', {}); toast('Assignment verified', 'Recorded with timestamp and audit entry'); go('onb2'); }
      catch (e) { toast('Error', friendlyErr(e), 'high'); }
    });
  }
  function vOnb2(b) {
    const d = dash.device;
    const s = onbShell(b, 1, () => el(`<div class="agent-card"><h3><span class="ico">📱</span>DEVICE VERIFICATION</h3>
      <div class="detail-grid mt8">
        <span class="k">Device model</span><span class="v">${esc(d?.model || 'Unknown')}</span>
        <span class="k">OS</span><span class="v">${esc(d?.os || '—')}</span>
        <span class="k">App version</span><span class="v">${APP_VERSION}</span>
        <span class="k">Device status</span><span class="v">${statusBadge(d?.status || 'UNREGISTERED')}</span>
        <span class="k">Registered</span><span class="v">${d?.registeredAt ? fmtWatShort(d.registeredAt) : '—'}</span>
      </div>
      <div class="small muted mt12">${d?.status === 'APPROVED' ? '✓ This device is AUTHORIZED for field operations. Evidence from revoked or locked devices is rejected by the server.' : `⚠ This device is ${d?.status || 'not registered'}. Contact technical support before duty.`}</div>
    </div>`));
    s.addNext('Continue →', () => go('onb3'));
  }
  function vOnb3(b) {
    const gps = gpsStatus();
    const a = dash.agent;
    const s = onbShell(b, 2, () => el(`<div class="agent-card"><h3><span class="ico">🛰</span>LOCATION STATUS</h3>
      <div class="center mb12"><span class="st ${gps.ok ? 'ok' : 'warn'}" style="font-size:13px">${gps.label}</span></div>
      <div class="detail-grid">
        <span class="k">GPS accuracy</span><span class="v">±8 m</span>
        <span class="k">Latitude</span><span class="v mono">${a.gps ? a.gps.lat.toFixed(5) : '—'}</span>
        <span class="k">Longitude</span><span class="v mono">${a.gps ? a.gps.lon.toFixed(5) : '—'}</span>
        <span class="k">Distance to PU</span><span class="v">${gps.m == null ? '—' : gps.m + ' m'}</span>
        <span class="k">Last update</span><span class="v">${fmtWatShort(a.lastHeartbeat || dash.sim.now)}</span>
      </div>
      <div class="small muted mt12">GPS assists verification — it does not judge whether you are truthful, and your location is visible only to authorized operational personnel, never publicly.</div>
    </div>`));
    s.addNext('Continue →', () => go('onb4'));
  }
  function vOnb4(b) {
    const a = dash.agent, d = dash.device;
    const items = [
      ['Assignment confirmed', true],
      ['Device operational', d?.status === 'APPROVED'],
      ['GPS available', !!a.gps],
      ['Network available / offline mode ready', true],
      ['Camera functional', true],
      [`Battery level — ${a.battery}%`, a.battery >= 20],
      ['Emergency contact available', true],
    ];
    const s = onbShell(b, 3, () => el(`<div class="agent-card"><h3><span class="ico">🔓</span>DUTY ACTIVATION CHECKLIST</h3>
      ${items.map(([l, ok]) => `<div class="integrity-row"><span>${ok ? '✅' : '⚠️'}</span><span>${esc(l)}</span><span class="st ${ok ? 'ok' : 'warn'}">${ok ? 'READY' : 'CHECK'}</span></div>`).join('')}
      <div class="small muted mt12">Activation records: timestamp · GPS · device · agent ID · assignment — and creates an immutable audit event.</div>
    </div>`));
    s.addNext('⚡ ACTIVATE DUTY', async () => {
      try {
        const res = await apiOrQueue({ kind: 'duty', payload: { action: 'activate' } });
        await loadDash();
        if (res && res.queued) { toast('Queued offline', 'Duty activation will synchronize when connectivity returns.'); nav('home'); return; }
        go('dutyactive');
      } catch (e) { toast('Activation failed', friendlyErr(e), 'high'); }
    }, 'success');
  }
  function vDutyActive(b) {
    const a = dash.agent;
    b.appendChild(el(`<div class="confirm-hero">
      <div class="big">🟢</div>
      <h3>DUTY ACTIVE</h3>
      <div class="small muted">${esc(a.code)} · ${esc(dash.assignment.pu?.id)} · ${fmtWat(a.activatedAt || dash.sim.now)}</div>
      <div class="small muted mt8">GPS ${a.gps ? a.gps.lat.toFixed(5) + ', ' + a.gps.lon.toFixed(5) : '—'} · Device ${esc(dash.device?.model || '—')} · Agent ${esc(a.id.slice(0, 8))} · Assignment ${esc(dash.assignment.pu?.id)}</div>
      <div class="small mt8" style="color:#4ade80">✓ Activation recorded in the audit trail and visible to your LG Situation Room.</div>
      <div class="mt12"><button class="btn primary btnblock" id="goduty">✓ Check in at Polling Unit</button></div>
      <div class="mt8"><button class="btn ghost btnblock" id="gohome">Return to dashboard</button></div>
    </div>`));
    $('#goduty').onclick = async () => { await apiOrQueue({ kind: 'duty', payload: { action: 'checkin' } }); await loadDash(); toast('Checked in', 'Polling monitoring begins'); nav('home'); };
    $('#gohome').onclick = () => nav('home');
  }

  // ---------------- RESULT FLOW ----------------
  function vResultFlow(b) {
    if (!wiz) wiz = { step: 1, pages: [] };
    if (!dutyGate('result')) { back(); return; }
    if (!dash.elections || !dash.elections.length) {
      b.appendChild(el(`<div class="agent-card"><h3><span class="ico">📄</span>No active elections</h3>
        <div class="small muted">There is no active election configured for result submission. Contact your coordinator.</div>
        <button class="btn ghost btnblock mt12" id="noback">← Back</button></div>`));
      $('#noback').onclick = back;
      return;
    }
    const flowBody = el('<div id="flowb"></div>');
    b.appendChild(flowBody);
    const renderStep = () => {
      const fb = flowBody;
      fb.innerHTML = '';
      const STEP = wiz.step;
      if (STEP === 1) {
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">📄</span>SUBMIT RESULT — Step 1/5 · Confirm location</h3>
          <label class="fl">Election</label><select class="inp" id="wel">${dash.elections.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
          <div class="detail-grid mt12">
            <span class="k">Polling unit</span><span class="v">${esc(dash.assignment.pu?.id)} — ${esc(dash.assignment.pu?.name)}</span>
            <span class="k">Ward</span><span class="v">${esc(dash.assignment.ward)}</span>
            <span class="k">LGA</span><span class="v">${esc(dash.assignment.lga)}</span>
            <span class="k">GPS</span><span class="v">${dash.agent.gps ? dash.agent.gps.lat.toFixed(5) + ', ' + dash.agent.gps.lon.toFixed(5) : '—'}</span>
            <span class="k">Timestamp</span><span class="v">${fmtWatShort(dash.sim.now)}</span>
          </div>
          <div class="mt12"><button class="btn primary btnblock" id="wnext">Next →</button></div>
        </div>`));
        $('#wnext', fb).onclick = () => {
          const eid = $('#wel', fb).value;
          wiz.election = dash.elections.find(e => e.id === eid);
          wiz.candidates = wiz.election.candidates;
          wiz.step = 2; renderStep();
        };
      } else if (STEP === 2) {
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">🔢</span>Step 2/5 — Result data entry</h3>
          <div class="small muted mb12">Enter the figures exactly as written on the EC8A result sheet.</div>
          ${wiz.candidates.map((c, i) => `<label class="fl">${esc(c.name)} <span style="color:${c.color}">(${esc(c.party)})</span></label><input class="inp" type="number" min="0" inputmode="numeric" data-ci="${i}" placeholder="Votes">`).join('')}
          <label class="fl">Total valid votes</label><input class="inp" type="number" id="wvalid" inputmode="numeric">
          <label class="fl">Rejected ballots</label><input class="inp" type="number" id="wrej" inputmode="numeric">
          <label class="fl">Accredited voters</label><input class="inp" type="number" id="wacc" inputmode="numeric">
          <label class="fl">Registered voters</label><input class="inp" type="number" id="wreg" inputmode="numeric">
          <div class="row mt12"><button class="btn" id="wautosum">Σ Auto-sum candidates</button><button class="btn primary" style="flex:1" id="wnext2">Run OCR cross-check →</button></div>
        </div>`));
        $('#wautosum', fb).onclick = () => {
          const sum = wiz.candidates.reduce((acc, c, i) => acc + (+($(`[data-ci="${i}"]`, fb).value || 0)), 0);
          $('#wvalid', fb).value = sum;
          toast('Totals calculated', 'Candidate votes summed into total valid votes.');
        };
        $('#wnext2', fb).onclick = () => {
          const items = wiz.candidates.map((c, i) => ({ candidateId: c.id, votes: +($(`[data-ci="${i}"]`, fb).value || 0) }));
          const validVotes = +($('#wvalid', fb).value || 0), rejected = +($('#wrej', fb).value || 0);
          const accredited = +($('#wacc', fb).value || 0), registered = +($('#wreg', fb).value || 0);
          if (items.some(i => i.votes === 0)) return toast('Missing values', 'Enter a figure for every candidate.', 'medium');
          wiz.figures = { items, validVotes, rejected, accredited, registered };
          wiz.step = 3; renderStep();
        };
      } else if (STEP === 3) {
        let seed = 42 + Math.floor(Math.random() * 100);
        const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
        wiz.ocr = wiz.candidates.map((c, i) => ({ candidateId: c.id, votes: wiz.figures.items[i].votes, confidence: +(84 + rnd() * 15).toFixed(1) }));
        if (Math.random() < 0.3) wiz.ocr[0].confidence = +(52 + rnd() * 20).toFixed(1);
        const lbl = (c) => c >= 90 ? '<span class="quality-chip high">HIGH CONFIDENCE</span>' : c >= 75 ? '<span class="quality-chip med">MEDIUM CONFIDENCE</span>' : '<span class="quality-chip low">LOW CONFIDENCE</span>';
        const hasLow = wiz.ocr.some(o => o.confidence < 75);
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">🔍</span>Step 3/5 — OCR cross-check</h3>
          <div class="small muted mb12">DATA DETECTED — OCR assists entry only. It never modifies the original document and never becomes a verified result without human confirmation.</div>
          <table class="tbl"><tr><th>Candidate</th><th class="num">Entered</th><th>Confidence</th></tr>
          ${wiz.ocr.map((o, i) => `<tr><td class="small">${esc(wiz.candidates[i].name.split('(')[0])}</td><td class="num mono">${fmtN(wiz.figures.items[i].votes)}</td><td>${lbl(o.confidence)} ${o.confidence}%</td></tr>`).join('')}</table>
          ${hasLow ? `<div class="mt12" style="border:1px solid #7f1d1d;border-radius:8px;padding:10px;background:#20090b">
            <label class="flex small" style="color:#fca5a5;margin:0"><input type="checkbox" id="lowconf"> I confirm the low-confidence values against the paper document</label></div>` : ''}
          <div class="row mt12"><button class="btn" id="wback">← Back</button><button class="btn primary" style="flex:1" id="wnext3">Confirm & capture EC8A →</button></div>
        </div>`));
        $('#wback', fb).onclick = () => { wiz.step = 2; renderStep(); };
        $('#wnext3', fb).onclick = () => {
          if (hasLow && !$('#lowconf', fb).checked) return toast('Confirmation required', 'Low-confidence fields require explicit human confirmation.', 'medium');
          wiz.step = 4; renderStep();
        };
      } else if (STEP === 4) {
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">📷</span>Step 4/5 — Capture EC8A pages</h3>
          <div class="small muted mb12">Boundary detection, auto-focus, lighting & blur checks run automatically. Original images are preserved unmodified with SHA-256 fingerprints.</div>
          <div id="pages"></div>
          <div class="row mt12"><button class="btn" id="cap1">📄 Page 1</button><button class="btn" id="cap2">📄 Page 2 (annex)</button></div>
          <div class="mt12"><button class="btn primary btnblock" id="wnext4" disabled>Review & submit →</button></div>
        </div>`));
        const renderPages = () => {
          $('#pages', fb).innerHTML = wiz.pages.map((p, i) => `<div class="flex mb12"><div style="width:110px;flex:none"><img src="${p.dataUrl}" style="width:100%;border-radius:6px;border:1px solid var(--line2)"></div>
            <div class="small"><b>Page ${i + 1}</b> — quality ${p.quality}% · edges ✓ · blur ✓ · lighting ✓<br><span class="mono dim">SHA-256 ${p.hash.slice(0, 16)}…</span><br><button class="btn sm ghost" data-del="${i}">Retake</button></div></div>`).join('') || '<div class="empty small">No pages captured yet</div>';
          $('#wnext4', fb).disabled = wiz.pages.length === 0;
          $$('[data-del]', $('#pages', fb)).forEach(x => x.onclick = () => { wiz.pages.splice(+x.dataset.del, 1); renderPages(); });
        };
        const capturePage = async (page) => {
          const m = modal({
            title: `EC8A capture — page ${page}`, wide: true,
            body: () => {
              const d = el(`<div><div class="small muted mb12">Auto-focus: <b id="fst">focusing…</b> · exposure ✓ · document edges detected</div>
                <div style="background:#000;border-radius:8px;overflow:hidden;position:relative"><canvas id="vf" width="640" height="380"></canvas>
                <div style="position:absolute;inset:0;border:2px dashed rgba(255,255,255,.5);border-radius:8px;pointer-events:none"></div></div>
                <div class="mt12"><button class="btn primary btnblock" id="shutter">📸 Capture</button></div></div>`);
              const cv = $('#vf', d);
              drawEc8a(cv, {
                pu: dash.assignment.pu?.id, ward: dash.assignment.ward, lga: dash.assignment.lga,
                election: wiz.election.name,
                candidates: wiz.candidates.map((c, i) => ({ name: c.name, party: c.party, votes: wiz.figures.items[i].votes })),
                valid: wiz.figures.validVotes, rejected: wiz.figures.rejected, accredited: wiz.figures.accredited, registered: wiz.figures.registered,
                page, docId: 'EC8A-' + dash.assignment.pu?.id,
              });
              cv.style.filter = 'blur(6px)';
              setTimeout(() => { cv.style.filter = 'blur(0px)'; $('#fst', d).textContent = 'focused ✓'; }, 900);
              $('#shutter', d).onclick = () => {
                const dataUrl = cv.toDataURL('image/png');
                wiz.pages.push({ dataUrl, hash: strHash(dataUrl), quality: 88 + Math.floor(Math.random() * 11) });
                toast('Page captured', 'Fingerprint computed — original preserved');
                renderPages();
                m.close();
              };
              return d;
            },
            actions: [{ label: 'Cancel', cls: 'ghost' }],
          });
        };
        $('#cap1', fb).onclick = () => capturePage(1);
        $('#cap2', fb).onclick = () => capturePage(2);
        $('#wnext4', fb).onclick = () => { wiz.step = 5; renderStep(); };
        renderPages();
      } else if (STEP === 5) {
        const vSum = wiz.figures.items.reduce((a, x) => a + x.votes, 0);
        const mismatch = vSum !== wiz.figures.validVotes;
        const overAcc = vSum > wiz.figures.accredited;
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">🧾</span>Step 5/5 — Review before submission</h3>
          <table class="tbl"><tr><th>Candidate / Party</th><th class="num">Votes</th></tr>
          ${wiz.candidates.map((c, i) => `<tr><td class="small">${esc(c.name)} <span style="color:${c.color}">${esc(c.party)}</span></td><td class="num mono">${fmtN(wiz.figures.items[i].votes)}</td></tr>`).join('')}
          <tr><td class="small muted">Total valid</td><td class="num mono">${fmtN(wiz.figures.validVotes)}</td></tr>
          <tr><td class="small muted">Rejected</td><td class="num mono">${fmtN(wiz.figures.rejected)}</td></tr>
          <tr><td class="small muted">Accredited / Registered</td><td class="num mono">${fmtN(wiz.figures.accredited)} / ${fmtN(wiz.figures.registered)}</td></tr></table>
          <div class="small muted mt8">✓ ${wiz.pages.length} EC8A page(s) · SHA-256 fingerprints · GPS · device · agent · timestamp<br>✓ Original documents are preserved unmodified; processed copies never replace them.</div>
          ${mismatch || overAcc ? `<div class="mt12" style="border:1px solid #713f12;border-radius:8px;padding:10px;background:#2b1c07">
            <b class="small" style="color:#fbbf24">⚠ DATA CHECK REQUIRED</b>
            <div class="small muted mt8">${mismatch ? `Candidate totals (${fmtN(vSum)}) do not reconcile with valid votes (${fmtN(wiz.figures.validVotes)}).` : ''} ${overAcc ? `Candidate totals exceed accredited voters (${fmtN(wiz.figures.accredited)}).` : ''} Please review the entered figures against the original document. This is not an accusation — figures are checked for consistency only.</div>
            <div class="row mt12"><button class="btn" id="wcorrect">✏ CORRECT</button><button class="btn warn" style="flex:1" id="wsubmitnote">SUBMIT WITH EXPLANATION</button></div>
          </div>` : `<div class="small mt8" style="color:#4ade80">✓ READY TO SUBMIT — data quality checks passed</div><div class="mt12"><button class="btn success btnblock" id="wsubmit">✓ SUBMIT RESULT</button></div>`}
          <div class="row mt12"><button class="btn" id="wback5">← Back</button></div>
        </div>`));
        $('#wback5', fb).onclick = () => { wiz.step = 4; renderStep(); };
        const doSubmit = async (note) => {
          try {
            const payload = {
              electionId: wiz.election.id, puId: dash.assignment.pu.id,
              items: wiz.figures.items, validVotes: wiz.figures.validVotes, rejected: wiz.figures.rejected,
              accredited: wiz.figures.accredited, registered: wiz.figures.registered,
              ocr: { confidences: wiz.ocr.map(o => o.confidence), engine: 'on-device OCR (simulated)' },
              evidence: wiz.pages.map(p => ({ kind: 'EC8A', dataUrl: p.dataUrl, pages: wiz.pages.length })),
              note,
            };
            if (offline) { enqueue('result', payload); back(); return; }
            const res = await API.post('/api/results', payload);
            await loadDash();
            wizResultCode = res.code;
            go('resultdone');
          } catch (e) {
            errModal(e, { retry: () => doSubmit(note), onOffline: () => { enqueue('result', { electionId: wiz.election.id, puId: dash.assignment.pu.id, items: wiz.figures.items, validVotes: wiz.figures.validVotes, rejected: wiz.figures.rejected, accredited: wiz.figures.accredited, registered: wiz.figures.registered, ocr: { confidences: wiz.ocr.map(o => o.confidence) }, evidence: wiz.pages.map(p => ({ kind: 'EC8A', dataUrl: p.dataUrl })), note }); back(); } });
          }
        };
        const ws = $('#wsubmit', fb);
        if (ws) ws.onclick = () => doSubmit('');
        const wc = $('#wcorrect', fb);
        if (wc) wc.onclick = () => { wiz.step = 2; renderStep(); };
        const wn = $('#wsubmitnote', fb);
        if (wn) wn.onclick = () => {
          const m = modal({
            title: 'Submit with explanation',
            body: () => el(`<label class="fl">Explanation (recorded in the audit trail)</label><textarea class="inp" id="expnote" rows="3" placeholder="e.g. Figures entered exactly as written on the EC8A; discrepancy may be a transcription error on the form."></textarea>`),
            actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Submit with explanation', cls: 'warn', onClick: () => { const note = $('#expnote').value.trim(); m.close(); doSubmit(note); } }],
          });
        };
      }
    };
    renderStep();
  }
  let wizResultCode = null;
  function vResultDone(b) {
    b.appendChild(el(`<div class="confirm-hero">
      <div class="big">✅</div>
      <h3>Result submitted successfully</h3>
      <div class="code">${esc(wizResultCode || 'EVR-2027-…')}</div>
      <div class="small muted">Status: ${statusBadge('SUBMITTED')} — received by server, queued for supervisory verification.<br>You can never manually mark a result as verified.</div>
      <div class="small muted mt8">The LG dashboard (+1 result), senatorial progress, central command map and the supervisory queue have all been updated live.</div>
      <div class="mt12"><button class="btn primary btnblock" id="rdsubs">View my submissions</button></div>
      <div class="mt8"><button class="btn ghost btnblock" id="rdhome">Return to dashboard</button></div>
    </div>`));
    $('#rdsubs').onclick = () => { actTab = 'submissions'; nav('activity'); };
    $('#rdhome').onclick = () => nav('home');
    wiz = null;
  }

  // ---------------- INCIDENT FLOW ----------------
  const INC_CATS = [
    ['Voting interruption', 'PROCESS', 'Voting interruption', '🗳'],
    ['Polling-unit operational issue', 'PROCESS', 'Polling-unit operational issue', '🏫'],
    ['Material issue', 'PROCESS', 'Missing materials', '📦'],
    ['Accreditation issue', 'PROCESS', 'Accreditation problem', '📇'],
    ['Counting issue', 'PROCESS', 'Counting interruption', '🧮'],
    ['Result/document issue', 'PROCESS', 'Result-sheet concern', '📄'],
    ['Technology issue', 'TECHNOLOGY', 'BVAS issue', '💻'],
    ['Accessibility issue', 'ACCESSIBILITY', 'Accessibility issue', '♿'],
    ['Security concern', 'SECURITY', 'Security concern', '🛡'],
    ['Other', 'OTHER', 'Other incident', '•'],
  ];
  const SEV_OPTS = [
    [1, 'INFORMATIONAL', 'Routine operational issue'], [2, 'LOW', 'Issue requiring monitoring'],
    [3, 'MEDIUM', 'Issue requiring LG intervention'], [4, 'HIGH', 'Major election-operation disruption'],
    [5, 'CRITICAL', 'Immediate safety/security concern'],
  ];
  function vIncidentFlow(b) {
    if (!incDraft) incDraft = { step: 1 };
    if (!dutyGate()) { back(); return; }
    const fb = el('<div id="incb"></div>');
    b.appendChild(fb);
    const renderStep = () => {
      fb.innerHTML = '';
      if (incDraft.step === 1) {
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">⚠️</span>WHAT HAPPENED?</h3>
          <div class="small muted mb12">Neutral classification — report what you observed, not motives.</div>
          <div class="cat-grid">${INC_CATS.map((d, i) => `<div class="cat-card" data-c="${i}"><span class="ic">${d[3]}</span>${esc(d[0])}</div>`).join('')}</div>
        </div>`));
        $$('.cat-card', fb).forEach(c => c.onclick = () => {
          const d = INC_CATS[+c.dataset.c];
          incDraft.label = d[0]; incDraft.category = d[1]; incDraft.subcategory = d[2];
          incDraft.step = 2; renderStep();
        });
      } else if (incDraft.step === 2) {
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">📝</span>${esc(incDraft.label)} — details</h3>
          <div class="small muted mb12">WHEN — timestamped automatically · WHERE — your polling unit & GPS are attached automatically.</div>
          <label class="fl">WHAT? — short description</label><textarea class="inp" id="idesc" rows="4" placeholder="Describe what you observed, factually and neutrally."></textarea>
          <label class="fl">SEVERITY</label>
          <div class="seg" id="isev">${SEV_OPTS.map(([v, l]) => `<span class="sg" data-s="${v}">${l}</span>`).join('')}</div>
          <div class="small muted mt8" id="sevtxt">Select a severity level.</div>
          <label class="fl">EVIDENCE (optional)</label>
          <button class="btn btnblock" id="addphoto">📷 Add photo evidence</button>
          <div id="incphotos" class="mt8"></div>
          <div class="row mt12"><button class="btn" id="iback">← Back</button><button class="btn primary" style="flex:1" id="inext">Review →</button></div>
        </div>`));
        incDraft.severity = incDraft.severity || 2; incDraft.photos = incDraft.photos || [];
        const drawSev = () => { $$('#isev .sg', fb).forEach(s => s.classList.toggle('on', +s.dataset.s === incDraft.severity)); $('#sevtxt', fb).textContent = `LEVEL ${incDraft.severity} — ${SEV_OPTS[incDraft.severity - 1][2]}`; };
        drawSev();
        $$('#isev .sg', fb).forEach(s => s.onclick = () => { incDraft.severity = +s.dataset.s; drawSev(); });
        const drawPhotos = () => {
          $('#incphotos', fb).innerHTML = (incDraft.photos || []).map((p, i) => `<div class="flex mb12"><img src="${p.dataUrl}" style="width:72px;border-radius:5px"><span class="small muted">SHA-256 ${p.hash.slice(0, 12)}…<br><button class="btn sm ghost" data-rm="${i}">Remove</button></span></div>`).join('');
          $$('[data-rm]', $('#incphotos', fb)).forEach(x => x.onclick = () => { incDraft.photos.splice(+x.dataset.rm, 1); drawPhotos(); });
        };
        drawPhotos();
        $('#addphoto', fb).onclick = async () => { const p = await capturePhoto('INCIDENT EVIDENCE'); incDraft.photos.push(p); drawPhotos(); };
        $('#iback', fb).onclick = () => { incDraft.step = 1; renderStep(); };
        $('#inext', fb).onclick = () => {
          const desc = $('#idesc', fb).value.trim();
          if (!desc) return toast('Description required', 'A short factual description is required.', 'medium');
          incDraft.description = desc;
          incDraft.step = 3; renderStep();
        };
      } else {
        fb.appendChild(el(`<div class="agent-card"><h3><span class="ico">🧾</span>INCIDENT REVIEW</h3>
          <div class="detail-grid">
            <span class="k">Category</span><span class="v">${esc(incDraft.label)}</span>
            <span class="k">Location</span><span class="v">${esc(dash.assignment.pu?.id)}</span>
            <span class="k">Time</span><span class="v">${fmtWatShort(dash.sim.now)}</span>
            <span class="k">Severity</span><span class="v">${sevBadge(incDraft.severity)}</span>
            <span class="k">Evidence</span><span class="v">${incDraft.photos.length} photo(s)</span>
          </div>
          <div class="small muted mt12">“${esc(incDraft.description)}”</div>
          <div class="small muted mt12">Report what you observed — the system never speculates about motives and never auto-accuses anyone.</div>
          <div class="row mt12"><button class="btn" id="rback">← Back</button><button class="btn primary" style="flex:1" id="isend">SUBMIT INCIDENT</button></div>
        </div>`));
        $('#rback', fb).onclick = () => { incDraft.step = 2; renderStep(); };
        $('#isend', fb).onclick = async () => {
          const payload = {
            category: incDraft.category, subcategory: incDraft.subcategory, severity: incDraft.severity, description: incDraft.description,
          };
          try {
            let inc;
            if (offline) { enqueue('incident-evidence', { incident: payload, photos: incDraft.photos }); incDraft = null; back(); return; }
            inc = await API.post('/api/incidents', payload);
            for (const ph of incDraft.photos) {
              await API.post('/api/evidence', { kind: 'PHOTO', dataUrl: ph.dataUrl, description: 'Incident evidence', relatedType: 'incident', relatedId: inc.id }).catch(() => {});
            }
            await loadDash();
            incCode = inc.code;
            go('incdone');
          } catch (e) { errModal(e, { retry: () => {}, onOffline: () => { enqueue('incident-evidence', { incident: payload, photos: incDraft.photos }); incDraft = null; back(); } }); }
        };
      }
    };
    renderStep();
  }
  let incCode = null;
  function vIncDone(b) {
    b.appendChild(el(`<div class="confirm-hero">
      <div class="big">⚠️</div>
      <h3>Incident submitted</h3>
      <div class="code">${esc(incCode || 'INC-2027-…')}</div>
      <div class="small muted">Status: RECEIVED — your report entered the escalation pipeline (Ward → LG → Senatorial → Central as severity requires).</div>
      <div class="mt12"><button class="btn primary btnblock" id="idact">View my incidents</button></div>
      <div class="mt8"><button class="btn ghost btnblock" id="idhome">Return to dashboard</button></div>
    </div>`));
    $('#idact').onclick = () => { actTab = 'incidents'; nav('activity'); };
    $('#idhome').onclick = () => nav('home');
    incDraft = null;
  }
  function vIncidentDetail(b) {
    const inc = dash.incidents.find(i => i.id === viewParam);
    if (!inc) { back(); return; }
    b.appendChild(el(`<div class="agent-card"><div class="flex mb12">${sevBadge(inc.severity)} ${statusBadge(inc.status)}<span class="right small mono dim">${esc(inc.code)}</span></div>
      <b>${esc(inc.subcategory)}</b>
      <div class="small muted mt8">${esc(inc.description || '')}</div>
      <div class="detail-grid mt12">
        <span class="k">Location</span><span class="v">${esc(inc.puId || '')} · ${esc(inc.lga || '')} LGA</span>
        <span class="k">Reported</span><span class="v">${fmtWatShort(inc.createdAt)}</span>
      </div>
      <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Status history</span></div><div class="pb">
        ${(inc.updates || []).map(u => `<div class="small mb12"><b>${esc(u.status || 'UPDATE')}</b> — ${esc(u.note || '')} <span class="dim">· ${fmtWatShort(u.at)}</span></div>`).join('')}
      </div></div>
      <div class="mt12"><button class="btn ghost btnblock" id="incback">← Back</button></div>
    </div>`));
    $('#incback').onclick = back;
  }

  // ---------------- SOS FLOW (hold-to-activate + lifecycle) ----------------
  let sosHoldTimer = null, sosProgress = 0;
  function vSosFlow(b) {
    const sent = currentSos ? sosById(currentSos) : null;
    if (sent && sent.code) return vSosLifecycle(b, sent);
    b.appendChild(el(`<div class="agent-card" style="border-color:#7f1d1d;background:#1c0a0d">
      <h3><span class="ico">🚨</span>EMERGENCY / SOS</h3>
      <label class="fl">Emergency category</label>
      <select class="inp" id="soscat"><option value="SAFETY">Immediate safety concern</option><option value="MEDICAL">Medical emergency</option><option value="SECURITY_BREACH">Security incident</option><option value="COMMS">Communication emergency</option><option value="OTHER">Other</option></select>
      <label class="fl">Optional voice note (simulated)</label>
      <button class="btn btnblock" id="sosvoice">🎙 Record voice note</button>
      <div class="small muted mt8" id="sosvoicest"></div>
      <div class="hold-note mt12">The platform notifies the authorized operational escalation chain (LG → Senatorial → Central). It does not claim to dispatch law enforcement or emergency responders.</div>
      <div class="hold-wrap mt12">
        <button class="hold-btn" id="holdbtn">
          <svg class="hold-progress" viewBox="0 0 180 180"><circle cx="90" cy="90" r="84" fill="none" stroke="#3a0d0d" stroke-width="8"/><circle id="holdring" cx="90" cy="90" r="84" fill="none" stroke="#ef4444" stroke-width="8" stroke-linecap="round" stroke-dasharray="528" stroke-dashoffset="528" transform="rotate(-90 90 90)"/></svg>
          <span class="hb-inner"><span class="ic">🚨</span><span class="lbl">HOLD 3s</span><span class="hint">TO ACTIVATE SOS</span></span>
        </button>
      </div>
      <div class="center small muted mt8">A deliberate hold prevents accidental activation.</div>
    </div>`));
    let recording = false;
    $('#sosvoice').onclick = () => { recording = !recording; $('#sosvoice').textContent = recording ? '⏹ Stop recording' : '🎙 Record voice note'; $('#sosvoicest').textContent = recording ? '● Recording… (demo)' : 'Voice note captured: 00:24 (demo)'; };
    const holdBtn = $('#holdbtn');
    const ring = $('#holdring');
    const startHold = () => {
      if (sosHoldTimer) return;
      holdBtn.classList.add('holding');
      sosHoldTimer = setInterval(() => {
        sosProgress += 3.4;
        ring.setAttribute('stroke-dashoffset', String(528 - 528 * (sosProgress / 100)));
        if (sosProgress >= 100) {
          clearInterval(sosHoldTimer); sosHoldTimer = null; sosProgress = 0;
          holdBtn.classList.remove('holding');
          ring.setAttribute('stroke-dashoffset', '528');
          const m = modal({
            title: '🚨 EMERGENCY ALERT',
            body: () => el(`<div class="small muted" style="line-height:1.7">You are about to send an emergency alert to authorized monitoring personnel. Your GPS, polling unit and timestamp will be transmitted. Location is shared only with the authorized escalation chain — never publicly.</div>`),
            actions: [
              { label: 'CANCEL', cls: 'ghost' },
              { label: 'SEND SOS', cls: 'danger', onClick: async () => {
                m.close();
                try {
                  const cat = $('#soscat').value;
                  if (offline) { enqueue('sos', { category: cat, note: 'SOS from field agent (queued offline)' }); toast('SOS queued', 'Will transmit the moment connectivity returns.'); return; }
                  const res = await API.post('/api/sos', { category: cat, note: 'SOS triggered via hold-to-activate' });
                  await loadDash();
                  currentSos = res.code;
                  toast('🚨 SOS ACTIVE', `${res.code} — escalation chain notified`, 'critical');
                  render();
                } catch (e) { toast('SOS failed', friendlyErr(e), 'critical'); }
              } },
            ],
          });
        }
      }, 100);
    };
    const stopHold = () => { if (sosHoldTimer) { clearInterval(sosHoldTimer); sosHoldTimer = null; } sosProgress = 0; holdBtn.classList.remove('holding'); ring.setAttribute('stroke-dashoffset', '528'); };
    holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startHold(); });
    holdBtn.addEventListener('pointerup', stopHold);
    holdBtn.addEventListener('pointerleave', stopHold);
    holdBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  let currentSos = null;
  const sosById = (code) => dash.sos.find(s => s.code === code);
  function vSosLifecycle(b, sos) {
    const steps = [
      ['ACTIVE', 'ALERT SENT', 'Your emergency signal is with the escalation chain'],
      ['ACKNOWLEDGED', 'ACKNOWLEDGED', 'A control room has acknowledged your alert'],
      ['RESPONDING', 'RESPONDING', 'An authorized response team is engaged'],
      ['RESOLVED', 'RESOLVED', 'Situation resolved — after-action report filed'],
    ];
    const order = ['ACTIVE', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED'];
    const idx = order.indexOf(sos.status);
    b.appendChild(el(`<div class="agent-card" style="border-color:${sos.status === 'RESOLVED' ? '#14532d' : '#ef4444'};background:${sos.status === 'RESOLVED' ? '#06170c' : '#2b0a0a'}">
      <div class="center mb12"><div style="font-size:40px">${sos.status === 'RESOLVED' ? '✅' : '🚨'}</div>
      <h3 style="justify-content:center;color:${sos.status === 'RESOLVED' ? '#4ade80' : '#fca5a5'}">SOS ${esc(sos.status)}</h3>
      <div class="code" style="font-size:13px">${esc(sos.code)} · ${esc(sos.category)} · ${esc(sos.puId)}</div>
      <div class="small muted">Triggered ${fmtWatShort(sos.createdAt)}</div></div>
      <div class="sos-steps">${steps.map(([st, label, desc], i) => {
        const cls = i < idx ? 'done' : i === idx ? 'active' : '';
        return `<div class="sos-step ${cls}"><span class="ss-dot">${i < idx ? '✓' : ''}</span><span class="ss-t"><b>${label}</b><br><span class="small">${desc}</span></span></div>`;
      }).join('')}</div>
      ${sos.acks && sos.acks.length ? `<div class="small muted mt12">Acknowledgements: ${sos.acks.map(a => `<span class="pill">${esc(a.byName || a.by)} · ${fmtWatShort(a.at)}</span>`).join(' ')}</div>` : ''}
      <div class="small muted mt12">The escalation chain: AGENT → LG CONTROL → SENATORIAL → CENTRAL. Every transition is timestamped and logged.</div>
      <div class="mt12"><button class="btn ghost btnblock" id="sosback">← Back to dashboard</button></div>
    </div>`));
    $('#sosback').onclick = () => nav('home');
    // poll for lifecycle updates
    if (sosPoll) clearInterval(sosPoll);
    sosPoll = setInterval(async () => {
      if (stack[stack.length - 1] !== 'sosflow') { clearInterval(sosPoll); sosPoll = null; return; }
      await loadDash();
      const s = sosById(sos.code);
      if (s && s.status !== sos.status) { render(); }
    }, 4000);
  }

  // ---------------- LIVE VIDEO ----------------
  function vVideo(b) {
    let stopFn = null, streamId = null, muted = false, cam = 'REAR';
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🎥</span>LIVE FIELD TRANSMISSION</h3>
      <div class="small muted mb12">Secure signed streaming tokens identify: stream ID · agent ID · polling unit · timestamp. Authorized command centres can monitor the stream — it is never public by default.</div>
      <div class="livehud"><canvas width="360" height="200" style="width:100%"></canvas>
        <div class="lh-overlay"><div class="lh-top"><span class="chipx" id="vstatus">● OFFLINE</span><span class="chipx" id="vtime">${watClock(dash.sim.now)}</span></div>
        <div class="lh-bot"><span class="chipx" id="vnet">NET: ${connInfo().quality}</span><span class="chipx" id="vqual">QUALITY: —</span><span class="chipx">GPS: ${gpsStatus().ok ? '✓' : '⚠'}</span><span class="chipx">🔋 ${dash.agent.battery}%</span><span class="chipx" id="vcam">CAM: REAR</span>${muted ? '<span class="chipx" style="color:#f87171">🔇 MUTED</span>' : ''}</div></div>
      </div>
      <div class="row mt12" style="flex-wrap:wrap">
        <button class="btn success" id="vstart">▶ START LIVE</button>
        <button class="btn" id="vmute">${muted ? '🔇 Unmute' : '🎙 Mute'}</button>
        <button class="btn" id="vswitch">🔄 Switch camera</button>
        <button class="btn danger" id="vstop" disabled>■ STOP LIVE</button>
      </div>
      <div class="small muted mt8" id="vmeta">Stream health: —</div>
    </div>`));
    const cv = $('canvas', b);
    $('#vstart', b).onclick = async () => {
      try {
        const res = offline ? await enqueue('stream-start', {}) : await API.post('/api/streams/start', {});
        streamId = res && res.id;
        $('#vstatus', b).innerHTML = '<span style="color:#4ade80">● LIVE</span>';
        $('#vstart', b).disabled = true; $('#vstop', b).disabled = false;
        stopFn = startSimStream(cv, { pu: dash.assignment.pu?.id, lga: dash.assignment.lga, ward: dash.assignment.ward, bitrate: 1400, fps: 24, viewers: 3, t: dash.sim.now });
        $('#vmeta', b).textContent = 'Stream health: GOOD · 1,400 kbps · 24 fps · adaptive bitrate · signed URL ✓';
      } catch (e) { toast('Stream error', friendlyErr(e), 'high'); }
    };
    $('#vstop', b).onclick = async () => {
      if (stopFn) stopFn();
      $('#vstatus', b).innerHTML = '<span class="chipx" style="color:#94a3b8">■ ENDED</span>';
      $('#vstart', b).disabled = false; $('#vstop', b).disabled = true;
      $('#vmeta', b).textContent = 'Stream ended · recording archived for review';
      if (streamId && !offline) { await API.post(`/api/streams/${streamId}/stop`, {}).catch(() => {}); streamId = null; }
    };
    $('#vmute', b).onclick = () => { muted = !muted; $('#vmute', b).textContent = muted ? '🔇 Unmute' : '🎙 Mute'; $('.lh-bot', b).innerHTML = `<span class="chipx" id="vnet2">NET: ${connInfo().quality}</span><span class="chipx" id="vqual2">QUALITY: GOOD</span><span class="chipx">GPS: ${gpsStatus().ok ? '✓' : '⚠'}</span><span class="chipx">🔋 ${dash.agent.battery}%</span><span class="chipx">CAM: ${cam}</span>${muted ? '<span class="chipx" style="color:#f87171">🔇 MUTED</span>' : ''}`; };
    $('#vswitch', b).onclick = () => { cam = cam === 'REAR' ? 'FRONT' : 'REAR'; $('#vcam', b).textContent = 'CAM: ' + cam; toast('Camera switched', cam + ' camera active'); };
  }

  // ---------------- FIELD REPORT ----------------
  function vFieldReport(b) {
    if (!dutyGate()) { back(); return; }
    const pi = phaseIndex();
    const QUESTIONS = [
      ['Is the polling unit operational?', 'PU operational'],
      ['Has voting activity commenced at your polling unit?', 'Activity commenced'],
      ['Are you able to observe proceedings from your position?', 'Able to observe'],
      ['Are there operational delays affecting the process?', 'Operational delays'],
      ['Are election materials available and sufficient?', 'Materials available'],
      ['Has counting commenced?', 'Counting commenced'],
      ['Has result documentation been completed?', 'Result documentation complete'],
    ];
    const qs = [QUESTIONS[0], QUESTIONS[2], QUESTIONS[3]];
    if (pi <= 1) qs.push(QUESTIONS[4]);
    if (pi >= 2) qs.push(QUESTIONS[1]);
    if (pi >= 3) qs.push(QUESTIONS[5]);
    if (pi >= 4) qs.push(QUESTIONS[6]);
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">📝</span>FIELD REPORT</h3>
      <div class="small muted mb12">Answer only what you personally observed. Every item supports OBSERVED / NOT OBSERVED / NOT APPLICABLE.</div>
      <div id="frqs"></div>
      <label class="fl">Additional note</label><textarea class="inp" id="frnote" rows="3" placeholder="Optional operational note"></textarea>
      <div class="mt12"><button class="btn primary btnblock" id="frsend">SUBMIT FIELD REPORT</button></div>
    </div>`));
    const answers = {};
    $('#frqs', b).innerHTML = qs.map(([q, key], i) => `
      <div class="mb12"><b class="small" style="color:#fff">${esc(q)}</b>
      <div class="seg mt8" data-qi="${i}">${['OBSERVED', 'NOT OBSERVED', 'NOT APPLICABLE'].map((l, j) => `<span class="sg ${j === 1 ? 'on' : ''}" data-v="${l}">${l}</span>`).join('')}</div>
      </div>`).join('');
    $$('[data-qi]', b).forEach(seg => {
      const qi = +seg.dataset.qi;
      answers[qs[qi][1]] = 'NOT OBSERVED';
      $$('.sg', seg).forEach(s => s.onclick = () => { $$('.sg', seg).forEach(x => x.classList.remove('on')); s.classList.add('on'); answers[qs[qi][1]] = s.dataset.v; });
    });
    $('#frsend', b).onclick = async () => {
      try {
        if (offline) { enqueue('report', { type: `Field report — ${PHASES[pi]}`, answers, note: $('#frnote', b).value }); back(); return; }
        await API.post('/api/reports/field', { type: `Field report — ${PHASES[pi]}`, answers, note: $('#frnote', b).value });
        await loadDash();
        toast('Field report submitted', 'Logged to your PU event timeline and the LG room');
        back();
      } catch (e) { toast('Error', friendlyErr(e), 'high'); }
    };
  }

  // ---------------- SUBMISSION DETAIL ----------------
  function vSubDetail(b) {
    const id = viewParam;
    if (!id) { back(); return; }
    b.appendChild(el(`<div class="small muted mb12"><a href="#" id="sback">← Back</a></div><div id="sbox"><span class="dim small">Loading submission…</span></div>`));
    $('#sback').onclick = (e) => { e.preventDefault(); back(); };
    API.get('/api/results/' + id).then(sub => {
      const itemsById = Object.fromEntries(sub.items.map(i => [i.candidateId, i.votes]));
      const cands = sub.candidates || [];
      $('#sbox', b).innerHTML = `
        <div class="agent-card"><div class="flex mb12"><span class="mono small dim">${esc(sub.code || sub.id.slice(0, 8))}</span><span class="right">${statusBadge(sub.status)}</span></div>
        <b>${esc(sub.election?.name || '')}</b>
        <div class="detail-grid mt12">
          <span class="k">Polling unit</span><span class="v">${esc(sub.puId)}</span>
          <span class="k">Submitted</span><span class="v">${fmtWatShort(sub.submittedAt)}</span>
          <span class="k">GPS</span><span class="v">${sub.pu ? sub.pu.lat.toFixed(5) + ', ' + sub.pu.lon.toFixed(5) : '—'}</span>
          ${sub.verifiedAt ? `<span class="k">Verified</span><span class="v">${fmtWatShort(sub.verifiedAt)}</span>` : ''}
          ${sub.rejectedAt ? `<span class="k">Rejected</span><span class="v">${fmtWatShort(sub.rejectedAt)}</span>` : ''}
        </div>
        ${(sub.anomalies || []).length ? `<div class="mt12">${sub.anomalies.map(a => `<span class="badge l3 mb12">⚠ ${esc(a.code)}</span>`).join(' ')}</div>` : ''}
        ${sub.status === 'REJECTED' ? `<div class="mt12" style="border:1px solid #7f1d1d;border-radius:8px;padding:10px;background:#20090b">
          <b class="small" style="color:#fca5a5">REVIEW REQUIRED</b>
          <div class="small muted mt8">Reviewer: ${esc(sub.review?.reviewer || '—')} — “${esc(sub.review?.reason || '')}”</div>
          <div class="small muted mt8">The original evidence remains preserved. Re-capture clearly and resubmit.</div>
          <button class="btn warn sm mt12" id="resub">↻ Resubmit corrected result</button>
        </div>` : ''}
        <hr class="soft">
        <b class="small">Submitted values</b>
        <table class="tbl mt8"><tr><th>Candidate</th><th class="num">Votes</th></tr>
        ${cands.map(c => `<tr><td class="small">${esc(c.name)} <span style="color:${c.color}">${esc(c.party)}</span></td><td class="num mono">${fmtN(itemsById[c.id] ?? 0)}</td></tr>`).join('')}
        <tr><td class="small muted">Valid / Rejected</td><td class="num mono">${fmtN(sub.validVotes)} / ${fmtN(sub.rejected)}</td></tr>
        <tr><td class="small muted">Accredited / Registered</td><td class="num mono">${fmtN(sub.accredited)} / ${fmtN(sub.registered)}</td></tr></table>
        <hr class="soft">
        <b class="small">Original evidence</b>
        <div class="mt8">${(sub.evidence || []).map(e => e.dataUrl ? `<img src="${e.dataUrl}" style="width:100%;border-radius:7px;border:1px solid var(--line2);margin-bottom:8px">` : `<div class="small muted">EC8A evidence ${esc(e.sha256 ? e.sha256.slice(0, 16) + '…' : '')} (${e.pages} page(s)) — original preserved unmodified.</div>`).join('') || '<div class="small muted">—</div>'}</div>
        ${(sub.custodies || []).length ? `<hr class="soft"><b class="small">Verification history</b>
        <div class="mt8">${sub.custodies.map(c => `<div class="small mb12"><b>${esc(c.step)}</b> ${esc(c.note || '')} <span class="dim">· ${fmtWatShort(c.at)} · ${esc(c.by || '')}</span></div>`).join('')}</div>` : ''}
        ${sub.versions ? `<div class="small muted mt12">Corrections create new versions — the original is never overwritten. Versions recorded: <b>${sub.versions}</b></div>` : ''}
        ${sub.note ? `<hr class="soft"><b class="small">Explanation on record</b><div class="small muted mt8">“${esc(sub.note)}”</div>` : ''}
        <div class="mt12"><button class="btn ghost btnblock" id="sback2">← Back</button></div></div>`;
      $('#sback2', b).onclick = (e) => { e.preventDefault(); back(); };
      const rb = $('#resub', b);
      if (rb) rb.onclick = () => { go('resultflow'); };
    }).catch(e => { $('#sbox', b).innerHTML = `<div class="empty small">${esc(friendlyErr(e))}</div>`; });
  }

  // ---------------- DUTY SUMMARY & COMPLETION ----------------
  function vDutySummary(b) {
    const a = dash.agent, s = dash.stats;
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🏁</span>FIELD DUTY SUMMARY</h3>
      <div class="duty-summary mt8">
        <div class="ds-row"><span class="k">Agent</span><span class="v">${esc(a.name)} (${esc(a.code)})</span></div>
        <div class="ds-row"><span class="k">Polling unit</span><span class="v">${esc(dash.assignment.pu?.id)}</span></div>
        <div class="ds-row"><span class="k">Start time</span><span class="v">${a.activatedAt ? fmtWatShort(a.activatedAt) : '—'}</span></div>
        <div class="ds-row"><span class="k">Duty duration</span><span class="v">${dutyDuration()}</span></div>
        <div class="ds-row"><span class="k">Results submitted</span><span class="v">${s.submissions}</span></div>
        <div class="ds-row"><span class="k">Incidents reported</span><span class="v">${s.incidents}</span></div>
        <div class="ds-row"><span class="k">Evidence uploaded</span><span class="v">${s.evidence}</span></div>
        <div class="ds-row"><span class="k">SOS events</span><span class="v">${s.sos}</span></div>
        <div class="ds-row"><span class="k">Field reports</span><span class="v">${s.fieldReports}</span></div>
        <div class="ds-row"><span class="k">Pending uploads</span><span class="v" style="color:${queue.length ? '#fbbf24' : '#4ade80'}">${queue.length}</span></div>
        <div class="ds-row"><span class="k">Synchronization</span><span class="v" style="color:${s.syncCompletion === 100 ? '#4ade80' : '#fbbf24'}">${s.syncCompletion}%</span></div>
      </div>
      ${queue.length ? `<div class="offline-banner mt12">⚠ You have ${queue.length} item(s) waiting to synchronize. Synchronize before completing duty.</div>
      <button class="btn btnblock mt8" id="dsync">🔄 Sync now</button>` : ''}
      <div class="small muted mt12">Completing duty locks operational submission functions. All evidence, submissions and audit records are preserved and remain available read-only for authorized post-election review.</div>
      <button class="btn success btnblock mt12" id="dcomplete">✓ COMPLETE DUTY</button>
    </div>`));
    $('#dsync', b) && ($('#dsync', b).onclick = async () => { await syncQueue(true); await loadDash(); render(); });
    $('#dcomplete', b).onclick = () => confirmBox('Complete duty', queue.length ? `You still have ${queue.length} item(s) waiting to synchronize. Complete duty anyway?` : 'Your FIELD DUTY SUMMARY will be archived with the operational record. Continue?', async () => {
      try {
        const res = await apiOrQueue({ kind: 'duty', payload: { action: 'complete' } });
        await loadDash();
        if (res && res.queued) { toast('Queued', 'Duty completion will sync when connectivity returns.'); nav('home'); return; }
        go('dutycomplete');
      } catch (e) { toast('Error', friendlyErr(e), 'high'); }
    }, 'Complete duty', 'success');
  }
  function vDutyComplete(b) {
    const a = dash.agent;
    b.appendChild(el(`<div class="agent-card" style="border-color:#14532d;text-align:center">
      <div style="font-size:40px">🏁</div>
      <h3 style="justify-content:center;color:#4ade80">DUTY COMPLETED</h3>
      <div class="small muted">${a.completedAt ? `Completed ${fmtWatShort(a.completedAt)}` : ''} — Election-duty functions are locked. Evidence, submissions and audit records are preserved in secure read-only mode for authorized post-election review. Nothing is deleted.</div>
    </div>
    <div class="agent-card"><h3><span class="ico">🗂</span>Operational record archive</h3>
      <div class="small muted mb12">Submissions: ${dash.submissions.length} · Incidents: ${dash.incidents.length} · Evidence: ${dash.stats.evidence} · Field reports: ${dash.stats.fieldReports}</div>
      <button class="btn btnblock" id="archsubs">View my submissions (read-only)</button>
      <button class="btn btnblock mt8" id="archtl">View event timeline</button>
    </div>
    <div class="small muted center mt12">DEMO DATA — NOT OFFICIAL ELECTION RESULTS</div>`));
    $('#archsubs').onclick = () => { actTab = 'submissions'; nav('activity'); };
    $('#archtl').onclick = () => { actTab = 'timeline'; nav('activity'); };
  }

  // ---------------- MAP ----------------
  function vMap(b) {
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🗺</span>MY ASSIGNED LOCATION</h3>
      <div class="small muted mb12">Your current location, assigned polling unit and LGA boundary. Neighboring agent locations are never shown.</div>
      <div class="map-wrap" style="height:300px"><div id="mymap" style="width:100%;height:100%"></div></div>
      <div class="small muted mt8">GPS: ${dash.agent.gps ? dash.agent.gps.lat.toFixed(5) + ', ' + dash.agent.gps.lon.toFixed(5) : '—'} · Distance to PU: ${gpsStatus().m == null ? '—' : gpsStatus().m + ' m'}</div>
      <div class="mt8"><button class="btn ghost btnblock" id="mapback">← Back</button></div>
    </div>`));
    $('#mapback').onclick = back;
    if (!bootstrap) { $('#mymap').innerHTML = '<div class="empty small">Map data unavailable</div>'; return; }
    const m = createMap($('#mymap'), bootstrap, {});
    const ownLga = bootstrap.lgas.find(l => l.name === dash.assignment.lga);
    m.setData({ lgas: bootstrap.lgas.map(l => ({ ...l, reportingPct: 0 })), agents: [{ id: dash.agent.id, puId: dash.assignment.pu?.id, lgaId: ownLga?.id, online: true, off: 0 }], incidents: [], sos: [], streams: [] });
    m.setLgaMetric(() => 0);
    m.zoomToLga(ownLga?.id || bootstrap.lgas[0].id);
  }

  // ---------------- MESSAGES ----------------
  function vMessages(b) {
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">💬</span>OPERATIONAL MESSAGES</h3>
      <div class="small muted mb12">Controlled operational messaging — not an open chat room. Every message is logged.</div>
      <label class="fl">Recipient</label>
      <select class="inp" id="msgtarget">
        <option value="role:wardcoord">Ward Coordinator</option>
        <option value="role:lgcoord">LG Coordinator</option>
        <option value="role:supervisor">Assigned Supervisor</option>
        <option value="role:director">Central Operations</option>
      </select>
      <div class="msg-list mt12" id="msglist" style="max-height:300px;overflow-y:auto"><span class="dim small">Loading…</span></div>
      <div class="row mt12"><input class="inp grow" id="msgtext" placeholder="Type a message…"><button class="btn primary" id="msgsend">Send</button></div>
      <div class="mt12"><button class="btn ghost btnblock" id="msgback">← Back</button></div>
    </div>`));
    $('#msgback').onclick = back;
    const load = async () => {
      try {
        const res = await API.get('/api/messages');
        $('#msglist', b).innerHTML = res.rows.length ? res.rows.map(msg => `<div class="msg ${msg.mine ? 'mine' : 'them'}">${esc(msg.body)}<div class="m-meta">${esc(msg.fromName)} · ${fmtWatShort(msg.at)}${msg.toRoleId ? ' → ' + esc(msg.toRoleId) : ''}</div></div>`).join('') : '<span class="dim small">No messages yet.</span>';
        $('#msglist', b).scrollTop = $('#msglist', b).scrollHeight;
      } catch (e) { }
    };
    load();
    if (msgPoll) clearInterval(msgPoll);
    msgPoll = setInterval(load, 8000);
    $('#msgsend', b).onclick = async () => {
      const text = $('#msgtext', b).value.trim();
      if (!text) return;
      const [mode, val] = $('#msgtarget', b).value.split(':');
      try {
        await API.post('/api/messages', mode === 'role' ? { toRoleId: val, body: text } : { toUserId: val, body: text });
        $('#msgtext', b).value = '';
        load();
      } catch (e) { toast('Message failed', friendlyErr(e), 'high'); }
    };
  }

  // ---------------- SECURITY ----------------
  function vSecurity(b) {
    const d = dash.device;
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🛡</span>SECURITY CENTRE</h3>
      <div class="integrity-row"><span>Device authorization</span><span class="st ${d?.status === 'APPROVED' ? 'ok' : 'bad'}">${esc(d?.status || 'UNREGISTERED')}</span></div>
      <div class="integrity-row"><span>Active session</span><span class="st ok">VALID</span></div>
      <div class="integrity-row"><span>MFA</span><span class="st ok">ENABLED</span></div>
      <div class="integrity-row"><span>Root / jailbreak risk</span><span class="st ok">NONE DETECTED</span></div>
      <div class="integrity-row"><span>Application tampering</span><span class="st ok">NONE DETECTED</span></div>
      <div class="integrity-row"><span>Application version</span><span class="st">${APP_VERSION}</span></div>
      <div class="integrity-row"><span>Last synchronization</span><span class="st">${dash.agent.lastHeartbeat ? fmtWatShort(dash.agent.lastHeartbeat) : '—'}</span></div>
      <div class="small muted mt12">Credentials are stored in secure device storage — never in plaintext. If a risk is detected, sensitive operations are restricted and administrators are notified. Local evidence is never destroyed.</div>
      <button class="btn warn btnblock mt12" id="lockacc">🔒 LOCK ACCOUNT</button>
      <button class="btn ghost btnblock mt8" id="secback">← Back</button>
    </div>`));
    $('#secback').onclick = back;
    $('#lockacc').onclick = () => confirmBox('Lock account', 'This terminates all active sessions immediately. Local evidence on the device is preserved. Continue?', async () => {
      try {
        await API.post('/api/agent/lock', {});
        toast('Account locked', 'All sessions terminated. Local evidence is preserved.');
        API.clear(); location.href = '/agent';
      } catch (e) { toast('Error', friendlyErr(e), 'high'); }
    }, 'Lock account', 'danger');
  }

  // ---------------- DEVICE ----------------
  function vDevice(b) {
    const d = dash.device;
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">📱</span>DEVICE & REGISTRATION</h3>
      <div class="detail-grid">
        <span class="k">Device ID</span><span class="v mono small">${esc(d?.id?.slice(0, 12) || '—')}…</span>
        <span class="k">Model</span><span class="v">${esc(d?.model || '—')}</span>
        <span class="k">OS</span><span class="v">${esc(d?.os || '—')}</span>
        <span class="k">App version</span><span class="v">${APP_VERSION}</span>
        <span class="k">Registered</span><span class="v">${d?.registeredAt ? fmtWatShort(d.registeredAt) : '—'}</span>
        <span class="k">Assigned agent</span><span class="v">${esc(dash.agent.code)}</span>
        <span class="k">Status</span><span class="v">${statusBadge(d?.status || 'UNREGISTERED')}</span>
      </div>
      <div class="small muted mt12">A revoked or locked device cannot submit new evidence or send SOS. Original captures are kept in the app's secure evidence workflow — never automatically saved to the public device gallery.</div>
      <button class="btn ghost btnblock mt12" id="devback">← Back</button>
    </div>`));
    $('#devback').onclick = back;
  }

  // ---------------- PERFORMANCE ----------------
  function vPerformance(b) {
    const s = dash.stats;
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">📊</span>MY PERFORMANCE</h3>
      <div class="small muted mb12">Operational completeness and data quality — never a ranking by political loyalty or candidate preference.</div>
      <div class="stat-tiles">
        <div class="stat-tile"><div class="v">${s.submissions}</div><div class="l">Reports submitted</div></div>
        <div class="stat-tile ${s.verified ? 'ok' : ''}"><div class="v">${s.verified}</div><div class="l">Verified</div></div>
        <div class="stat-tile ${s.rejected ? 'bad' : ''}"><div class="v">${s.rejected}</div><div class="l">Review required</div></div>
        <div class="stat-tile"><div class="v">${s.evidence}</div><div class="l">Evidence uploaded</div></div>
        <div class="stat-tile"><div class="v">${s.incidents}</div><div class="l">Incidents submitted</div></div>
        <div class="stat-tile"><div class="v">${s.fieldReports}</div><div class="l">Field reports</div></div>
      </div>
      <div class="flex mt12"><span class="small muted">Sync completion</span><div class="pbar flex1"><div class="fill green" style="width:${s.syncCompletion}%"></div></div><b class="small">${s.syncCompletion}%</b></div>
      <div class="small muted mt12">Verification status reflects supervisory review — you can never mark your own result as verified.</div>
      <button class="btn ghost btnblock mt12" id="perfback">← Back</button>
    </div>`));
    $('#perfback').onclick = back;
  }

  // ---------------- SETTINGS ----------------
  const getSet = (k, d) => LS.get('ev_set_' + k) === null ? d : LS.get('ev_set_' + k) === '1';
  const setSet = (k, v) => LS.set('ev_set_' + k, v ? '1' : '0');
  function vSettings(b) {
    const bio = getSet('biometric', true), pwr = getSet('powersave', false), notif = getSet('notifications', true);
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">⚙</span>SETTINGS</h3>
      <div class="integrity-row"><span>🖐 Biometric authentication</span><span class="sw ${bio ? 'on' : ''}" id="swbio"></span></div>
      <div class="integrity-row"><span>🔋 Power-saving mode</span><span class="sw ${pwr ? 'on' : ''}" id="swpwr"></span></div>
      <div class="integrity-row"><span>🔔 Notifications</span><span class="sw ${notif ? 'on' : ''}" id="swnot"></span></div>
      <hr class="soft">
      <button class="btn btnblock" id="changepin">🔑 Change PIN</button>
      <div class="small muted mt12">App version ${APP_VERSION} · DEMO ENVIRONMENT — fictional data · DEMO DATA — NOT OFFICIAL ELECTION RESULTS</div>
      <button class="btn ghost btnblock mt12" id="setback">← Back</button>
    </div>`));
    $('#setback').onclick = back;
    $('#swbio').onclick = () => { setSet('biometric', !getSet('biometric', true)); render(); };
    $('#swpwr').onclick = () => { setSet('powersave', !getSet('powersave', false)); toast('Power saving ' + (getSet('powersave', false) ? 'enabled' : 'disabled'), getSet('powersave', false) ? 'Screen brightness and background sync are reduced.' : 'Normal operation restored.'); render(); };
    $('#swnot').onclick = () => { setSet('notifications', !getSet('notifications', true)); render(); };
    $('#changepin').onclick = () => {
      const m = modal({
        title: 'Change PIN',
        body: () => el(`<div>
          <label class="fl">Current PIN</label><input class="inp" type="password" id="cp1">
          <label class="fl">New PIN</label><input class="inp" type="password" id="cp2">
          <label class="fl">Confirm new PIN</label><input class="inp" type="password" id="cp3">
        </div>`),
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Update PIN', cls: 'primary', onClick: () => {
          if (!$('#cp2').value || $('#cp2').value !== $('#cp3').value) return toast('PIN mismatch', 'New PINs do not match.', 'medium');
          toast('PIN updated (demo)', 'In production this binds to the secure credential store.');
          m.close();
        } }],
      });
    };
  }

  // ---------------- HELP ----------------
  function vHelp(b) {
    const SECS = [
      ['📄 How to submit a result', 'From HOME tap SUBMIT RESULT: 1) confirm location 2) enter figures 3) review OCR confidence 4) capture EC8A pages 5) review & submit. You receive an EVR submission ID and can track the verification state in Activity → Submissions.'],
      ['📷 How to capture EC8A', 'Frame the full form in the camera guide. The app checks edges, lighting and blur. Capture every page — originals are stored unmodified with SHA-256 fingerprints. Processed previews never replace originals.'],
      ['⚠️ How to report an incident', 'Tap REPORT INCIDENT, choose the category, describe only what you observed, set severity, optionally attach a photo, review and submit. You get an INC ID and can track statuses in Activity → Incidents.'],
      ['🚨 How SOS works', 'Hold the SOS button for 3 seconds to avoid accidental activation, then confirm. Your GPS, polling unit and timestamp are sent to the authorized escalation chain: LG → Senatorial → Central. Track ACKNOWLEDGED → RESPONDING → RESOLVED live.'],
      ['📶 How offline mode works', 'Capture results, incidents, photos, reports and drafts offline — everything is securely queued locally and synchronizes automatically when connectivity returns. Nothing is lost; local copies are kept until the server acknowledges.'],
      ['🔄 How to synchronize', 'Open Sync Centre (Profile → Sync centre) and tap SYNC NOW when online. Watch each item move from WAITING → UPLOADING → COMPLETE. Failed items retry automatically.'],
      ['👤 Contact supervisor', 'Use Profile → Operational messages to reach your Ward Coordinator, LG Coordinator, supervisor or Central Operations. Every message is logged.'],
      ['🛠 Technical support', 'Contact Technical Support through Profile → Operational contacts. Report your device model and app version (' + APP_VERSION + ') when requesting help.'],
    ];
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">❓</span>HELP CENTRE</h3>
      ${SECS.map(([t, d]) => `<details class="help-sec"><summary>${t}</summary><div class="hs-body">${d}</div></details>`).join('')}
      <button class="btn btnblock mt12" id="helpsup">📞 Contact technical support</button>
      <button class="btn ghost btnblock mt8" id="helpback">← Back</button>
    </div>`));
    $('#helpback').onclick = back;
    $('#helpsup').onclick = () => go('contacts');
  }

  // ---------------- CONTACTS ----------------
  function vContacts(b) {
    const c = dash.contacts;
    const groups = [
      ['Supervisor', c.supervisor, '👤'],
      ['Ward Coordinator', c.wardCoordinator, '🏘'],
      ['LG Coordinator', c.lgCoordinator, '🏢'],
      ['Technical Support', c.techSupport, '🛠'],
      ['Central Operations', c.central, '🛰'],
    ];
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">📞</span>OPERATIONAL CONTACTS</h3>
      <div class="small muted mb12">Administrator-configured contacts for your assignment. No external telephone numbers are invented by the application.</div>
      ${groups.map(([label, list, ic]) => `
        <b class="small" style="color:#fff;display:block;margin:10px 0 4px">${ic} ${label}</b>
        ${(list || []).length ? list.map(p => `<div class="contact-row"><span class="c-ic">${ic}</span><span><b class="small" style="color:var(--text)">${esc(p.name)}</b><br><span class="small muted">${esc(p.role || label)}</span></span><button class="btn sm right" data-msg="${esc(p.name)}">Message</button></div>`).join('') : '<div class="small muted mb12">— configured by administrator —</div>'}`).join('')}
      <div class="small muted mt12">🚨 Emergency escalation channel: ${esc(c.escalation || 'Central Operations — via SOS channel')}</div>
      <button class="btn ghost btnblock mt12" id="conback">← Back</button>
    </div>`));
    $('#conback').onclick = back;
    $$('[data-msg]', b).forEach(x => x.onclick = () => { toast('Message', `Message ${x.dataset.msg} via Profile → Operational messages.`, 'medium'); go('messages'); });
  }

  // ---------------- SYNC CENTRE ----------------
  function vSync(b) {
    const items = [...queue].map(q => ({
      q, label: { result: 'EC8A result submission', incident: 'Incident report', 'incident-evidence': 'Incident + evidence', sos: 'SOS alert', duty: 'Duty status update', evidence: 'Photo evidence', report: 'Field report', 'stream-start': 'Live stream start', 'stream-stop': 'Live stream stop' }[q.kind] || q.kind,
      ic: { result: '📄', incident: '⚠️', 'incident-evidence': '⚠️', sos: '🚨', duty: '🔓', evidence: '📷', report: '📝', 'stream-start': '🎥', 'stream-stop': '🎥' }[q.kind] || '•',
    }));
    b.appendChild(el(`<div class="agent-card"><h3><span class="ico">🔄</span>SYNC CENTRE</h3>
      <div class="flex mb12"><span class="small muted">Pending uploads: <b style="color:${queue.length ? '#fbbf24' : '#4ade80'}">${queue.length}</b></span>
      <span class="right"><button class="btn primary sm" id="syncnow" ${offline ? 'disabled' : ''}>⟳ SYNC NOW</button></span></div>
      ${offline ? '<div class="offline-banner">OFFLINE MODE — your information is securely queued and will synchronize when connectivity returns.</div>' : ''}
      ${items.length ? items.map(({ q, label, ic }) => `
        <div class="sync-item"><span class="si-ic">${ic}</span>
          <span><b class="small" style="color:var(--text)">${esc(label)}</b><br><span class="small muted">${timeAgoWat(q.ts)} · retries: ${q.retries}${q.lastError ? ' · ' + esc(q.lastError.slice(0, 40)) : ''}</span></span>
          <span class="si-st ${q.status}">${q.status.toUpperCase()}</span>
        </div>`).join('') : '<div class="empty small">All synchronized — nothing queued.</div>'}
      <div class="small muted mt12">Automatic synchronization: ${offline ? 'PAUSED (offline)' : 'ACTIVE'} · Local copies are never deleted until the server acknowledges receipt. Duplicates are detected by ID, document hash, agent, polling unit and timestamp — never silently discarded.</div>
      <button class="btn ghost btnblock mt12" id="syncback">← Back</button>
    </div>`));
    $('#syncback').onclick = back;
    $('#syncnow').onclick = async () => { await syncQueue(true); await loadDash(); render(); };
  }

  // ---------------- apiOrQueue + lifecycle ----------------
  async function apiOrQueue(item) {
    if (offline) { enqueue(item.kind, item.payload); return { queued: true }; }
    return doCall(item);
  }

  // live clock
  clockTimer = setInterval(() => {
    if (!dash) return;
    dash.sim.now += 1000;
    const c = $('#hdclock'); if (c) c.textContent = watClock(dash.sim.now) + ' WAT';
  }, 1000);
  // refresh dashboard periodically
  setInterval(async () => { if (document.hidden) return; await loadDash(); if (stack[0] === 'home' || stack[0] === 'activity') header(); }, 30000);
  // secure heartbeat to central system
  const sendHeartbeat = () => {
    if (offline || !dash) return;
    const signal = dash.agent.battery < 20 ? 'WARNING' : 'NORMAL';
    API.post('/api/agents/heartbeat', { battery: dash.agent.battery, network: dash.agent.network, gps: dash.agent.gps, appVersion: APP_VERSION, signal }).catch(() => {});
  };
  setInterval(sendHeartbeat, 25000);
  sendHeartbeat();

  await loadAll();
  window.__portalBooted = true;
  render();
  if (queue.length) toast('Offline queue', `${queue.length} item(s) waiting to sync — open the Sync Centre to upload.`);
})();
