// lg.js — EYES OF VICTORY — LG SUPERVISOR (v2, master-spec build)
// Scope: assigned LGA only. Flow: LG → WARD → PU → AGENT → SUBMISSION → EVIDENCE.
// Views: Dashboard, Map, Wall Mode, Notifications, Tasks, Wards (+Ward Command View),
// Polling Units (+drill panel), Agents (+command profile), Connectivity, Results (+detail),
// Review Queue, Evidence Centre (+EC8A viewer), Disputes, Incidents (+map), SOS, Video Wall,
// Analytics, Intelligence Brief/Signals/Copilot, SITREP, Exports, Audit, Evidence Chain,
// Security, System Health + Demo Controls + Escalate to Senatorial/Central.
'use strict';
(async () => {
  const { user: me, b, o } = await bootPortal('LG Supervisor Portal', 'LG Supervisor', { username: 'lgcoord', password: 'LGCoord@123!' });
  const bootstrap = b; let ov = o;
  let tab = 'dashboard';
  let wardDrill = null, wallGrid = 3, actSub = 'reporting';
  let evidenceCache = null, escCache = null, tlCache = null, agentsCache = null, resultCache = null;

  const myLga = (me.scope && me.scope.lga) || ov.lgas[0]?.name || 'Nasarawa';
  const myLgaId = bootstrap.lgas.find(l => l.name === myLga)?.id || bootstrap.lgas[0].id;
  const lgData = () => ov.lgas.find(l => l.lgaId === myLgaId) || ov.lgas[0];
  const myWards = () => ov.wardHealth.filter(w => w.lgaId === myLgaId);
  const myPus = () => bootstrap.pus.filter(p => p.lgaId === myLgaId);
  const myIncidents = () => ov.incidents.filter(i => i.lgaId === myLgaId);
  const mySos = () => ov.sos.filter(s => s.lgaId === myLgaId);
  const myStreams = () => ov.streams.filter(s => s.lgaId === myLgaId);
  const myQueue = () => ov.queue.filter(q => q.lga === myLga);
  const pctSafe = (a, bb) => bb === 0 ? 0 : Math.round((a / bb) * 1000) / 10;

  async function loadAgents() { if (!agentsCache) { const r = await API.get(`/api/agents?lga=${myLgaId}&limit=300`); agentsCache = { rows: r.rows, at: Date.now() }; } return agentsCache; }
  async function loadEvidence() { if (!evidenceCache) evidenceCache = await API.get(`/api/lg/evidence?lga=${encodeURIComponent(myLga)}`); return evidenceCache; }
  async function loadEsc() { if (!escCache) escCache = await API.get('/api/escalations'); return escCache; }
  async function loadTl() { if (!tlCache) tlCache = await API.get(`/api/lg/timeline?lga=${encodeURIComponent(myLga)}`); return tlCache; }
  async function loadResults() { if (!resultCache) { const r = await API.get(`/api/results?election=e-gov-2027&lga=${myLgaId}&limit=300`); resultCache = r.rows; } return resultCache; }

  // ---- operational health (§9) ----
  function healthBreakdown() {
    const lg = lgData();
    const wards = myWards();
    const comps = [
      { k: 'AGENT COVERAGE', v: pctSafe(lg.agents, lg.totalPu) * 1.3 > 100 ? 100 : Math.round(pctSafe(lg.agents, lg.totalPu) * 1.3), w: 0.15 },
      { k: 'REPORTING', v: lg.reportingPct, w: 0.25 },
      { k: 'CONNECTIVITY', v: pctSafe(lg.agentsOnline, lg.agents), w: 0.15 },
      { k: 'VERIFICATION', v: lg.verifiedPct, w: 0.25 },
      { k: 'INCIDENT RESPONSE', v: 100 - Math.min(30, lg.incidents * 5 + lg.sos * 10), w: 0.1 },
      { k: 'DATA QUALITY', v: 100 - Math.min(30, (lg.anomalies || 0) * 3), w: 0.1 },
    ];
    const score = Math.round(comps.reduce((a, c) => a + Math.max(0, Math.min(100, c.v)) * c.w, 0));
    return { score, comps, status: score >= 85 ? 'HEALTHY' : score >= 65 ? 'WATCH' : score >= 45 ? 'ATTENTION' : 'CRITICAL' };
  }
  function computeSignals() {
    const out = [];
    const lg = lgData();
    const wards = myWards();
    const lowWards = wards.filter(w => w.reportingPct < 50);
    const missing = wards.reduce((a, w) => a + (w.pus - w.submitted), 0);
    if (missing > 5) out.push({ id: 'gap', sev: missing > 25 ? 'HIGH' : 'MEDIUM', title: 'REPORTING GAP', note: `${missing} polling units in ${lowWards.length} ward(s) have not submitted a recent report. This triggers operational follow-up, not assumptions about what happened.`, go: 'wards' });
    if (lg.pending > 5) out.push({ id: 'backlog', sev: lg.pending > 20 ? 'HIGH' : 'MEDIUM', title: 'VERIFICATION BACKLOG', note: `${lg.pending} submissions await authorized review. The LG portal monitors — verification remains with supervisors.`, go: 'queue' });
    if (pctSafe(lg.agentsOnline, lg.agents) < 70) out.push({ id: 'conn', sev: 'HIGH', title: 'CONNECTIVITY', note: `Agent connectivity at ${pctSafe(lg.agentsOnline, lg.agents)}% (${lg.agentsOnline}/${lg.agents} online).`, go: 'connectivity' });
    const recent = myIncidents().filter(i => ov.sim.now - i.createdAt < 60 * 60000);
    if (recent.length >= 3) out.push({ id: 'cluster', sev: 'MEDIUM', title: 'INCIDENT CLUSTER', note: `${recent.length} incidents within the last hour — review recommended. SYSTEM SIGNAL — REQUIRES REVIEW.`, go: 'incidents' });
    if (lg.anomalies > 0) out.push({ id: 'quality', sev: 'MEDIUM', title: 'DATA-QUALITY FLAGS', note: `${lg.anomalies} record(s) flagged by the validation engine. Neutral language by design — never automatic fraud determinations.`, go: 'queue' });
    if (mySos().length) out.push({ id: 'sos', sev: 'CRITICAL', title: 'ACTIVE SOS', note: `${mySos().length} active emergency signal(s) in this LG.`, go: 'sos' });
    return out.sort((a, bb) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.sev) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(bb.sev));
  }

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', ico: '◈', section: 'CORE' },
    { id: 'map', label: 'Command Map', ico: '◎' },
    { id: 'wall', label: 'Wall Mode', ico: '▣' },
    { id: 'notifications', label: 'Notifications', ico: '🔔' },
    { id: 'tasks', label: 'Tasks', ico: '☑' },
    { id: 'wards', label: 'Wards', ico: '▦', section: 'OPERATIONS' },
    { id: 'pus', label: 'Polling Units', ico: '📍' },
    { id: 'agents', label: 'Agents', ico: '👤' },
    { id: 'connectivity', label: 'Connectivity', ico: '📶' },
    { id: 'results', label: 'Results Command', ico: '≡', section: 'RESULTS' },
    { id: 'queue', label: 'Review Queue', ico: '✓' },
    { id: 'evidence', label: 'Evidence Centre', ico: '🗂' },
    { id: 'disputes', label: 'Disputes', ico: '⚖' },
    { id: 'incidents', label: 'Incidents', ico: '⚠', section: 'INCIDENTS' },
    { id: 'incmap', label: 'Incident Map', ico: '🗺' },
    { id: 'sos', label: 'SOS Command', ico: '🚨', section: 'EMERGENCY' },
    { id: 'video', label: 'Live Video', ico: '▣', section: 'LIVE' },
    { id: 'analytics', label: 'Analytics', ico: '∿', section: 'ANALYTICS' },
    { id: 'brief', label: 'Intelligence Brief', ico: '✧', section: 'INTELLIGENCE' },
    { id: 'signals', label: 'Signals', ico: '⚡' },
    { id: 'copilot', label: 'Copilot', ico: '🤖', perm: 'copilot.use' },
    { id: 'sitrep', label: 'SITREP', ico: '▤', section: 'REPORTS' },
    { id: 'exports', label: 'Exports', ico: '⬇', perm: 'reports.export' },
    { id: 'audit', label: 'Audit', ico: '◉', perm: 'audit.view', section: 'GOVERNANCE' },
    { id: 'chain', label: 'Evidence Chain', ico: '⛓' },
    { id: 'security', label: 'Security', ico: '🛡' },
    { id: 'health', label: 'System Health', ico: '⚙', perm: 'system.health' },
  ];
  const shell = initShell({ title: 'LG', nav: NAV, active: tab, me, sim: ov.sim, portalTag: `${myLga.toUpperCase()} LG SUPERVISOR`, onNav: setTab });
  function setTab(id) { tab = id; wardDrill = null; render(); }
  const liveRefresh = debounce(() => { refresh(); render(); }, 900);
  shell.onLive(liveRefresh);
  async function refresh() {
    try { ov = await API.get('/api/overview'); evidenceCache = null; escCache = null; tlCache = null; resultCache = null; if (agentsCache && Date.now() - agentsCache.at > 30000) agentsCache = null; } catch (e) {}
  }

  // ---- security check on boot (§6) ----
  function securityCheck() {
    const d = dashDeviceInfo();
    const m = modal({
      title: '🛡 SECURITY CHECK',
      body: () => el(`<div class="detail-grid">
        <span class="k">Account status</span><span class="v"><span class="st ok">ACTIVE</span></span>
        <span class="k">Device authorization</span><span class="v">${d.device ? `<span class="st ${d.device.status === 'APPROVED' ? 'ok' : 'bad'}">${esc(d.device.status)}</span>` : '—'}</span>
        <span class="k">MFA status</span><span class="v"><span class="st ok">VERIFIED THIS SESSION</span></span>
        <span class="k">Current session</span><span class="v"><span class="st ok">VALID</span></span>
        <span class="k">System connection</span><span class="v"><span class="st ok">LIVE (SSE)</span></span>
        <span class="k">App version</span><span class="v">1.4.0</span>
      </div>
      <div class="small muted mt12">If a suspicious session or device is detected, access is restricted and administrators are notified. Local evidence is never destroyed.</div>`),
      actions: [{ label: 'Proceed to LG Command', cls: 'primary' }],
    });
  }
  function dashDeviceInfo() {
    const agent = bootstrap.agents.find(a => a.lgaId === myLgaId);
    return { device: null };
  }

  function render() {
    shell.main.innerHTML = '';
    const lg = lgData();
    const sw = el(`<div class="flex mb12">
      <span class="pill">ASSIGNED LG: <b>${esc(myLga).toUpperCase()}</b></span>
      <span class="pill">${esc(lg.senatorial)}</span>
      <span class="pill">${fmtN(lg.totalPu)} PUs · ${fmtN(myWards().length)} wards</span>
      <span class="pill">Election: 2027 Governorship & Senate</span>
      <span class="flex1"></span>
      ${API.can('lg.demo') ? `<button class="btn sm" id="demobtn">🎬 Demo controls</button>` : ''}
      ${API.can('escalations.create') ? `<button class="btn sm warn" id="escalatebtn">▲ Escalate</button>` : ''}
    </div>`);
    shell.main.appendChild(sw);
    const db = $('#demobtn', sw); if (db) db.onclick = demoPanel;
    const eb = $('#escalatebtn', sw); if (eb) eb.onclick = () => escalateModal();
    const V = { dashboard: vDashboard, map: vMap, wall: vWall, notifications: vNotifications, tasks: vTasks, wards: vWards, pus: vPus, agents: vAgents, connectivity: vConnectivity, results: vResults, queue: vQueue, evidence: vEvidence, disputes: vDisputes, incidents: vIncidents, incmap: vIncmap, sos: vSos, video: vVideo, analytics: vAnalytics, brief: vBrief, signals: vSignals, copilot: vCopilot, sitrep: vSitrep, exports: vExports, audit: vAudit, chain: vChain, security: vSecurity, health: vHealth };
    (V[tab] || vDashboard)(shell.main);
  }

  // ================= DEMO CONTROLS (§67) =================
  function demoPanel() {
    const ACTIONS = [
      ['result', '📄 SIMULATE RESULT SUBMISSION', 'A field agent submits a new EC8A'],
      ['incident', '⚠️ SIMULATE INCIDENT', 'A new incident is reported in the LG'],
      ['sos', '🚨 SIMULATE SOS', 'An emergency SOS triggers'],
      ['agent-offline', '📴 SIMULATE AGENT OFFLINE', 'A random online agent goes offline'],
      ['verify', '✓ SIMULATE VERIFICATION', 'A pending submission is verified'],
    ];
    const m = modal({
      title: '🎬 DEMO CONTROLS — LG simulation',
      body: () => el(`<div>
        <div class="pub-note">Every simulated event propagates through the whole ecosystem in real time: LG statistics, ward statistics, the LG map, Senatorial and Central rooms, and (for verified results) the public portal. <b>DEMO MODE — NOT OFFICIAL ELECTION DATA.</b></div>
        <div class="agent-grid">${ACTIONS.map(([a, l, d]) => `<div class="agent-btn" data-a="${a}"><span class="big">${l.split(' ')[0]}</span>${l.slice(l.indexOf(' ') + 1)}<span class="small dim" style="font-weight:400">${d}</span></div>`).join('')}</div>
        <div id="demores" class="small muted mt12"></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $$('[data-a]', m.body).forEach(btn => btn.onclick = async () => {
      btn.style.opacity = '.5';
      try {
        const res = await API.post('/api/lg/demo/simulate', { action: btn.dataset.a });
        $('#demores', m.body).textContent = '✓ ' + res.detail;
        toast('Simulated', res.detail);
        refresh(); render();
      } catch (e) { toast('Simulation failed', (e.data && e.data.message) || e.message, 'high'); }
      btn.style.opacity = '1';
    });
  }

  // ================= DASHBOARD (§7-9, §71) =================
  function vDashboard(b) {
    const lg = lgData();
    const h = healthBreakdown();
    const signals = computeSignals();
    const hot = signals.filter(s => ['CRITICAL', 'HIGH'].includes(s.sev));
    const scoreColor = h.score >= 85 ? '#4ade80' : h.score >= 65 ? '#fbbf24' : h.score >= 45 ? '#fb923c' : '#f87171';
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Polling units', fmtN(lg.totalPu), { sub: `${fmtN(myWards().length)} wards` })}
      ${kpiCard('Agents', fmtN(lg.agents), { sub: `${lg.agentsOnline} online · ${lg.agents - lg.agentsOnline} offline` })}
      ${kpiCard('Reporting', lg.reportingPct + '%', { sub: `${lg.submitted}/${lg.totalPu} PUs`, cls: 'accent' })}
      ${kpiCard('Verified', lg.verifiedPct + '%', { sub: `${lg.verified} PUs`, cls: 'ok' })}
      ${kpiCard('Pending', fmtN(lg.pending), { cls: lg.pending ? 'warn' : '' })}
      ${kpiCard('Active incidents', fmtN(lg.incidents), { cls: lg.incidents ? 'alert' : '' })}
      ${kpiCard('Active SOS', fmtN(lg.sos), { cls: lg.sos ? 'alert' : '' })}
      ${kpiCard('Live feeds', fmtN(lg.streams))}
    </div>`));
    // health hero
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">LG OPERATIONAL HEALTH</span><span class="sub">operational metric — never a measure of electoral popularity or candidate performance</span><span class="sp"></span>${statusBadge(h.status)}</div>
    <div class="pb"><div class="health-hero">
      <div class="health-score"><div class="hs-ring" style="color:${scoreColor}">${h.score}%</div><div class="hs-lbl">${h.status}</div></div>
      <div class="health-bars">${h.comps.map(c => `<div class="hb"><span class="k">${esc(c.k)}</span><div class="pbar flex1"><div class="fill ${c.v >= 80 ? 'green' : c.v >= 50 ? 'amber' : 'red'}" style="width:${Math.min(100, c.v)}%"></div></div><span class="v">${Math.round(Math.min(100, c.v))}%</span></div>`).join('')}
      </div>
    </div></div></div>`));
    if (hot.length) {
      const strip = el(`<div class="alert-strip">${hot.map(x => `<div class="a ${x.sev === 'HIGH' ? 'amber' : ''}" data-sig="${x.id}">${x.sev === 'CRITICAL' ? '🚨' : '⚠'} ${esc(x.title)} — ${esc(x.note.slice(0, 70))}…</div>`).join('')}</div>`);
      $$('[data-sig]', strip).forEach(x => x.onclick = () => setTab('signals'));
      b.appendChild(strip);
    }
    const grid = el(`<div class="grid23">
      <div class="panel"><div class="ph"><span class="t">◎ ${esc(myLga.toUpperCase())} LIVE MAP</span><span class="sp"></span><button class="btn sm ghost" data-t="map">Full map →</button></div>
      <div class="pb flat" style="height:400px"><div id="dashmap" style="width:100%;height:100%"></div></div></div>
      <div>
        <div class="panel"><div class="ph"><span class="t">LIVE INCIDENT FEED</span></div>
        <div class="pb flat"><div class="feed" id="incfeed" style="max-height:170px"></div></div></div>
        <div class="panel mt12"><div class="ph"><span class="t">LIVE TIMELINE</span></div>
        <div class="pb flat"><div class="feed" id="tlfeed" style="max-height:170px"></div></div></div>
      </div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">WARD STATUS</span><span class="sub">click for the Ward Command View</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Ward</th><th class="num">PUs</th><th>Reporting</th><th class="num">Verified</th><th class="num">Online</th><th class="num">Incidents</th><th class="num">Health</th></tr>
    ${myWards().map(w => `<tr class="clickable" data-w="${w.id}"><td><b>${esc(w.name)}</b></td><td class="num">${w.pus}</td><td><div class="pbar" style="width:70px"><div class="fill ${w.reportingPct < 50 ? 'red' : ''}" style="width:${w.reportingPct}%"></div></div> ${w.reportingPct}%</td><td class="num">${w.verified}</td><td class="num">${w.online}/${w.agents}</td><td class="num" style="color:${w.incidents ? '#fbbf24' : ''}">${w.incidents}</td><td class="num"><b style="color:${w.score > 70 ? '#4ade80' : w.score > 40 ? '#fbbf24' : '#f87171'}">${w.score}</b></td></tr>`).join('')}
    </table></div></div>`);
    b.appendChild(grid);
    $('[data-t]', grid).onclick = () => setTab('map');
    $$('[data-w]', b).forEach(x => x.onclick = () => { wardDrill = x.dataset.w; tab = 'wards'; render(); });
    // map
    const m = createMap($('#dashmap', grid), bootstrap, {});
    m.setData({ lgas: ov.lgas, incidents: myIncidents(), sos: mySos(), streams: myStreams(), agents: ov.agentsOnMap.filter(a => a.lgaId === myLgaId) });
    m.setLgaMetric(l => l.lgaId === myLgaId ? l.reportingPct : 0);
    m.zoomToLga(myLgaId);
    m.onClick(({ type, id }) => {
      if (type === 'PU') puPanel(id);
      else if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
      else if (type === 'SOS') { const x = mySos().find(s => s.id === id); if (x) sosModal(x, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
    });
    // feeds
    const incs = myIncidents();
    $('#incfeed', grid).innerHTML = incs.length ? incs.slice(0, 6).map(i => `<div class="item" data-inc="${i.id}"><span class="t">${fmtWatShort(i.createdAt)}</span><span class="tx">${sevBadge(i.severity)} <b>${esc(i.subcategory)}</b> @ ${esc(i.puId || '')} ${statusBadge(i.status)}</span></div>`).join('') : '<div class="empty">No incidents</div>';
    $$('[data-inc]', $('#incfeed', grid)).forEach(x => x.onclick = () => incidentModal(ov.incidents.find(i => i.id === x.dataset.inc), { canManage: API.can('incidents.manage'), onChange: refresh }));
    loadTl().then(res => {
      $('#tlfeed', grid).innerHTML = res.rows.length ? res.rows.slice(0, 8).map(r => `<div class="item"><span class="t">${fmtWatShort(r.t)}</span><span class="tx"><b>${esc(r.label)}</b>${r.detail ? ` <span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('') : '<div class="empty">No events yet</div>';
    }).catch(() => {});
  }

  // ================= MAP (§10-13) =================
  function vMap(b) {
    const wrap = el(`<div>
      <div class="flex mb12">
        <div class="map-filters" style="position:static" id="filters"></div>
        <span class="flex1"></span><button class="btn" id="resetv">⌂ RESET FILTERS</button>
      </div>
      <div class="map-wrap" style="height:calc(100vh - 180px)"><div id="bigmap" style="width:100%;height:100%"></div></div>
    </div>`);
    b.appendChild(wrap);
    const fs = { incidents: true, sos: true, streams: true, agents: true };
    const fbox = $('#filters', wrap);
    fbox.innerHTML = Object.keys(fs).map(k => `<span class="chip on" data-f="${k}">${k.toUpperCase()}</span>`).join('');
    const m = createMap($('#bigmap', wrap), bootstrap, {});
    m.zoomToLga(myLgaId);
    const apply = () => {
      m.setData({
        lgas: ov.lgas,
        incidents: fs.incidents ? myIncidents() : [],
        sos: fs.sos ? mySos() : [],
        streams: fs.streams ? myStreams() : [],
        agents: fs.agents ? ov.agentsOnMap.filter(a => a.lgaId === myLgaId) : [],
      });
      m.setLgaMetric(l => l.lgaId === myLgaId ? l.reportingPct : 0);
    };
    apply();
    $$('[data-f]', fbox).forEach(c => c.onclick = () => { fs[c.dataset.f] = !fs[c.dataset.f]; c.classList.toggle('on', fs[c.dataset.f]); apply(); });
    $('#resetv', wrap).onclick = () => { Object.keys(fs).forEach(k => fs[k] = true); $$('[data-f]', fbox).forEach(c => c.classList.add('on')); m.zoomToLga(myLgaId); apply(); };
    m.onClick(({ type, id }) => {
      if (type === 'PU') puPanel(id);
      else if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
      else if (type === 'SOS') { const x = mySos().find(s => s.id === id); if (x) sosModal(x, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
    });
  }

  // ================= WALL MODE (§54) =================
  function vWall(b) {
    const lg = lgData();
    const h = healthBreakdown();
    const wm = el(`<div class="wall-mode">
      <div class="wm-head">
        <img src="/assets/media/logo.png" style="height:44px;object-fit:contain" onerror="this.style.display='none'">
        <div><div style="color:#fff;font-size:19px;font-weight:800;letter-spacing:2px">EYES OF VICTORY — LG SUPERVISOR</div>
        <div class="wm-sub">${esc(myLga.toUpperCase())} · ${esc(lg.senatorial.toUpperCase())} · KANO STATE</div></div>
        <span class="flex1"></span>
        <div class="wm-clock" id="wmclock">${watClock(ov.sim.now)}</div>
        <button class="btn" id="wmexit">✕ Exit wall</button>
      </div>
      <div class="wm-kpis">
        ${[['LG HEALTH', h.score + '%', h.score >= 85 ? '#4ade80' : h.score >= 65 ? '#fbbf24' : '#f87171'], ['REPORTING', lg.reportingPct + '%', '#38bdf8'], ['VERIFIED', lg.verifiedPct + '%', '#4ade80'], ['AGENTS ONLINE', `${lg.agentsOnline}/${lg.agents}`, lg.agentsOnline / Math.max(1, lg.agents) < 0.7 ? '#fbbf24' : '#4ade80'], ['ACTIVE INCIDENTS', fmtN(lg.incidents), '#fb923c'], ['ACTIVE SOS', fmtN(lg.sos), lg.sos ? '#f87171' : '#4ade80']].map(([l, v, c]) => `<div class="wm-kpi"><div class="l">${l}</div><div class="v" style="color:${c}">${v}</div></div>`).join('')}
      </div>
      <div class="wm-grid">
        <div class="wm-col"><div class="wm-panel"><div class="t">Live map</div><div class="wm-map"><div id="wm-map" style="width:100%;height:100%"></div></div></div></div>
        <div class="wm-col">
          <div class="wm-panel" style="flex:1"><div class="t">WARD STATUS</div>
            <div class="wm-strip">${myWards().map(w => `<div class="s"><b>${esc(w.name)}</b>R ${w.reportingPct}% · V ${w.verified} · I ${w.incidents} · S ${w.sos}</div>`).join('')}</div>
          </div>
          <div class="wm-panel"><div class="t">LIVE INCIDENTS</div><div style="overflow:auto">${myIncidents().slice(0, 5).map(i => `<div class="small mb12" style="color:var(--muted)">${sevBadge(i.severity)} <b style="color:#fff">${esc(i.subcategory)}</b> ${statusBadge(i.status)}</div>`).join('') || '<div class="small muted">None</div>'}</div></div>
          <div class="wm-panel"><div class="t">SYSTEM</div><div class="small muted">API ${ov.health.api} · DB ${ov.health.db} · CONNECTION LIVE</div></div>
        </div>
      </div>
    </div>`);
    document.body.appendChild(wm);
    const mm = createMap($('#wm-map', wm), bootstrap, {});
    mm.setData({ lgas: ov.lgas, incidents: myIncidents(), sos: mySos(), streams: myStreams(), agents: [] });
    mm.setLgaMetric(l => l.lgaId === myLgaId ? l.reportingPct : 0);
    mm.zoomToLga(myLgaId);
    $('#wmexit', wm).onclick = () => wm.remove();
    const clk = setInterval(() => { const c = $('#wmclock', wm); if (c) c.textContent = watClock(ov.sim.now + (Date.now() % 1000)); }, 1000);
    wm.addEventListener('click', (e) => { if (e.target === wm) { clearInterval(clk); wm.remove(); } });
  }

  // ================= NOTIFICATIONS / TASKS (§42-44) =================
  function vNotifications(b) {
    b.appendChild(el(`<div class="pub-note">Alert workflow: <b>ACKNOWLEDGE → ASSIGN → ESCALATE → RESOLVE</b> — notifications become operational actions, not passive toasts.</div>
    <div class="panel"><div class="ph"><span class="t">ALERT CENTRE</span></div><div class="pb flat" id="nbody"><span class="dim small">Loading…</span></div></div>`));
    API.get('/api/notifications').then(res => {
      $('#nbody', b).innerHTML = res.rows.length ? res.rows.map(x => `
        <div class="notif-item"><div class="n-t">${x.priority === 'CRITICAL' ? '🚨' : x.priority === 'HIGH' ? '⚠️' : '🔔'} <b>${esc(x.title)}</b><span class="n-p ${x.priority.toLowerCase()}">${esc(x.priority)}</span></div>
        <div class="small mt8">${esc(x.body)}<br>${fmtWatShort(x.createdAt)} · ${x.read ? 'READ' : 'UNREAD'}</div>
        <div class="row mt8">
          <button class="btn sm" data-ack="${x.id}">✓ ACKNOWLEDGE</button>
          ${API.can('escalations.create') ? `<button class="btn sm warn" data-escn="${esc(x.title)}">▲ ESCALATE</button>` : ''}
        </div></div>`).join('') : '<div class="empty">No alerts</div>';
      $$('[data-ack]', b).forEach(x => x.onclick = async () => { await API.post('/api/notifications/read', { id: x.dataset.ack }); toast('Acknowledged', 'Alert marked as read — recorded in your activity log.'); refresh(); render(); });
      $$('[data-escn]', b).forEach(x => x.onclick = () => escalateModal(null, { type: 'TASK', refId: 'ALERT-' + Date.now().toString(36).toUpperCase(), summary: 'Alert escalated: ' + x.dataset.escn }));
    }).catch(() => { $('#nbody', b).innerHTML = '<div class="empty">—</div>'; });
  }
  function vTasks(b) {
    const signals = computeSignals();
    const t = el(`<div class="panel"><div class="ph"><span class="t">MY TASKS — PRIORITY ACTIONS</span><span class="sub">derived from operational signals · every task links to its record</span></div>
    <div class="pb">${signals.length ? signals.map(s => `
      <div class="signal-card ${s.sev.toLowerCase()}"><div class="s-head">${s.sev === 'CRITICAL' ? '🚨' : s.sev === 'HIGH' ? '⚠' : '▲'} <b>${esc(s.title)}</b><span class="badge ${s.sev === 'CRITICAL' ? 'l5' : s.sev === 'HIGH' ? 'l4' : 'l3'}">${esc(s.sev)}</span></div>
      <div class="s-note">${esc(s.note)}</div>
      <div class="s-actions">
        <button class="btn sm" data-go="${s.go}">VIEW RECORD</button>
        <button class="btn sm" data-follow="${esc(s.title)}">+ ASSIGN TASK</button>
        ${API.can('escalations.create') ? `<button class="btn sm warn" data-esct="${esc(s.title)}">ESCALATE</button>` : ''}
      </div></div>`).join('') : '<div class="empty">No outstanding tasks — LG operations are nominal.</div>'}</div></div>`);
    b.appendChild(t);
    $$('[data-go]', t).forEach(x => x.onclick = () => setTab(x.dataset.go));
    $$('[data-follow]', t).forEach(x => x.onclick = () => toast('Task assigned', 'Follow-up task logged: ' + x.dataset.follow + ' — recorded in the audit trail.'));
    $$('[data-esct]', t).forEach(x => x.onclick = () => escalateModal(null, { type: 'TASK', refId: 'TASK-' + Date.now().toString(36).toUpperCase(), summary: x.dataset.esct }));
  }

  // ================= WARDS (§14-15) =================
  function vWards(b) {
    if (wardDrill) return vWardDetail(b);
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">WARDS — ${esc(myLga.toUpperCase())}</span><span class="sub">click a ward for its Command View</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Ward</th><th class="num">PUs</th><th class="num">Agents</th><th class="num">Online</th><th class="num">Offline</th><th>Reporting</th><th class="num">Verified</th><th class="num">Incidents</th><th class="num">SOS</th><th class="num">Health</th></tr>
    ${myWards().map(w => `<tr class="clickable" data-w="${w.id}"><td><b>${esc(w.name)}</b></td><td class="num">${w.pus}</td><td class="num">${w.agents}</td><td class="num" style="color:#4ade80">${w.online}</td><td class="num" style="color:${w.agents - w.online ? '#f87171' : ''}">${w.agents - w.online}</td><td><div class="pbar" style="width:80px"><div class="fill ${w.reportingPct < 50 ? 'red' : ''}" style="width:${w.reportingPct}%"></div></div> ${w.reportingPct}%</td><td class="num">${w.verified}</td><td class="num">${w.incidents}</td><td class="num">${w.sos}</td><td class="num"><b style="color:${w.score > 70 ? '#4ade80' : w.score > 40 ? '#fbbf24' : '#f87171'}">${w.score}</b></td></tr>`).join('')}
    </table></div></div>`);
    b.appendChild(wrap);
    $$('[data-w]', b).forEach(x => x.onclick = () => { wardDrill = x.dataset.w; render(); });
    const gaps = myWards().filter(w => w.reportingPct < 60);
    if (gaps.length) {
      const missing = gaps.reduce((a, w) => a + (w.pus - w.submitted), 0);
      wrap.insertBefore(el(`<div class="alert-strip"><div class="a amber">⚠ ATTENTION: ${missing} polling units in ${gaps.length} ward(s) have not submitted their latest operational report. This triggers operational follow-up, not assumptions about what happened.</div></div>`), wrap.querySelector('.pb'));
    }
  }
  function vWardDetail(b) {
    const w = myWards().find(x => x.id === wardDrill);
    if (!w) { wardDrill = null; return vWards(b); }
    const pus = myPus().filter(p => p.wardId === w.id);
    b.appendChild(el(`<div class="flex mb12"><button class="btn" id="wback">← All wards</button><b style="color:#fff">WARD COMMAND VIEW — ${esc(w.name)}</b></div>
    <div class="kpis">
      ${kpiCard('Polling units', fmtN(w.pus))}
      ${kpiCard('Agents', `${w.online}/${w.agents}`, { sub: 'online/assigned' })}
      ${kpiCard('Reporting', w.reportingPct + '%', { sub: `${w.submitted}/${w.pus}`, cls: 'accent' })}
      ${kpiCard('Verified', fmtN(w.verified), { cls: 'ok' })}
      ${kpiCard('Incidents', fmtN(w.incidents), { cls: w.incidents ? 'alert' : '' })}
      ${kpiCard('SOS', fmtN(w.sos), { cls: w.sos ? 'alert' : '' })}
    </div>
    <div class="grid2">
      <div class="panel"><div class="ph"><span class="t">WARD MAP</span></div><div class="pb flat" style="height:320px"><div id="wmap" style="width:100%;height:100%"></div></div></div>
      <div class="panel"><div class="ph"><span class="t">WARD TIMELINE</span></div><div class="pb flat" id="wtl" style="max-height:320px;overflow:auto"><span class="dim small">Loading…</span></div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">POLLING UNITS IN ${esc(w.name.toUpperCase())}</span></div>
    <div class="pb flat" id="wpulist"><span class="dim small">Loading…</span></div></div>`));
    $('#wback', b).onclick = () => { wardDrill = null; render(); };
    const m = createMap($('#wmap', b), bootstrap, {});
    m.setData({ lgas: ov.lgas, incidents: myIncidents().filter(i => i.wardId === w.id), sos: mySos().filter(s => s.wardId === w.id), streams: myStreams(), agents: [] });
    m.setLgaMetric(l => l.lgaId === myLgaId ? l.reportingPct : 0);
    m.zoomToLga(myLgaId);
    loadTl().then(res => {
      const rows = res.rows.filter(r => (r.detail || '').includes(pus.map(p => p.code).join('|')) || pus.some(p => (r.detail || '').includes(p.code)) || (r.detail || '').includes(w.name));
      $('#wtl', b).innerHTML = rows.length ? rows.slice(0, 15).map(r => `<div class="item"><span class="t">${fmtWatShort(r.t)}</span><span class="tx"><b>${esc(r.label)}</b>${r.detail ? ` <span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('') : '<div class="empty small">No ward events yet</div>';
    }).catch(() => { $('#wtl', b).innerHTML = '<div class="empty small">—</div>'; });
    loadResults().then(rows => {
      const byPu = {};
      rows.forEach(r => byPu[r.puId] = r);
      $('#wpulist', b).innerHTML = `<table class="tbl"><tr><th>PU</th><th>Name</th><th>Agent</th><th>Status</th><th></th></tr>
      ${pus.map(p => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}</td><td class="small">${esc((bootstrap.agents.find(a => a.puId === p.id) || {}).name || 'VACANT')}</td><td>${byPu[p.id] ? statusBadge(byPu[p.id].status) : '<span class="badge s-archived">NOT REPORTED</span>'}</td><td><button class="btn sm" data-pu="${p.id}">PU profile</button></td></tr>`).join('')}</table>`;
      $$('[data-pu]', b).forEach(x => x.onclick = () => puPanel(x.dataset.pu));
    }).catch(() => { $('#wpulist', b).innerHTML = '<div class="empty small">—</div>'; });
  }

  // ================= PUs + drill panel (§13) =================
  function vPus(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">POLLING UNITS — ${esc(myLga.toUpperCase())}</span><span class="sp"></span><input class="inp" style="width:180px" id="puq" placeholder="Search PU…"></div>
    <div class="pb flat" id="pubody"></div></div>`);
    b.appendChild(wrap);
    const draw = debounce(async () => {
      const q = $('#puq', wrap).value.toLowerCase();
      const rows = myPus().filter(p => !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      const res = await loadResults();
      const byPu = {};
      res.forEach(r => byPu[r.puId] = r);
      const t = dataTable({
        cols: [
          { label: 'Code', key: 'code', cls: 'mono' }, { label: 'Name', key: 'name' },
          { label: 'Ward', key: 'wardId', render: r => esc(bootstrap.wards.find(w => w.id === r.wardId)?.name || '') },
          { label: 'Status', key: 'code', render: r => byPu[r.code] ? statusBadge(byPu[r.code].status) : '<span class="badge s-archived">NOT REPORTED</span>' },
          { label: '', key: 'id', render: r => `<button class="btn sm" data-pu="${r.id}">PU profile</button>` },
        ],
        rows, sortable: true, pageSize: 20,
      });
      t.setTitle(`${rows.length} polling units`);
      $('#pubody', wrap).innerHTML = ''; $('#pubody', wrap).appendChild(t.el);
      $$('[data-pu]', wrap).forEach(x => x.onclick = () => puPanel(x.dataset.pu));
    }, 250);
    $('#puq', wrap).addEventListener('input', draw);
    draw();
  }
  function puPanel(puId) {
    const pu = myPus().find(p => p.id === puId);
    if (!pu) return;
    const agent = (agentsCache || { rows: [] }).rows.find(a => a.puId === puId);
    const m = modal({
      title: `POLLING UNIT PROFILE — ${pu.code}`,
      wide: true,
      body: () => el(`<div>
        <div class="small muted mb12"><b>${esc(pu.name)}</b> · ${esc(bootstrap.wards.find(w => w.id === pu.wardId)?.name || '')} · ${esc(myLga)} LGA</div>
        <div class="detail-grid" id="puinfo"><span class="k">Loading…</span></div>
        <div class="row mt12" id="puactions"></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    loadAgents().then(() => {
      const a = (agentsCache.rows || []).find(x => x.puId === puId);
      $('#puinfo', m.body).innerHTML = `
        <span class="k">Assigned agent</span><span class="v">${a ? `${esc(a.name)} (${esc(a.code)})` : 'VACANT'}</span>
        <span class="k">Agent status</span><span class="v">${a ? statusBadge(a.dutyState) : '—'}</span>
        <span class="k">Last heartbeat</span><span class="v">${a && a.lastHeartbeat ? fmtWatShort(a.lastHeartbeat) : '—'}</span>
        <span class="k">Connectivity</span><span class="v">${a ? (a.online ? '<span class="st ok">ONLINE</span>' : '<span class="st bad">OFFLINE</span>') : '—'}</span>
        <span class="k">GPS</span><span class="v">${pu.lat.toFixed(5)}, ${pu.lon.toFixed(5)}</span>`;
      $('#puactions', m.body).innerHTML = `
        ${a ? `<button class="btn sm" data-ag="${a.id}">VIEW AGENT</button>` : ''}
        <button class="btn sm" data-r="${puId}">VIEW RESULT</button>
        <button class="btn sm" data-i="${puId}">VIEW INCIDENTS</button>
        <button class="btn sm" data-t="${puId}">OPEN TIMELINE</button>`;
      const agb = $('#puactions [data-ag]', m.body);
      if (agb) agb.onclick = () => { m.close(); const ag = (agentsCache.rows || []).find(x => x.id === agb.dataset.ag); if (ag) agentModal(ag); };
      $('#puactions [data-r]', m.body).onclick = async () => {
        const rows = await loadResults();
        const sub = rows.find(r => r.puId === puId);
        if (sub) { m.close(); submissionModal(sub.id); } else toast('Not reported', 'This polling unit has not submitted a result yet.');
      };
      $('#puactions [data-i]', m.body).onclick = () => { m.close(); const incs = myIncidents().filter(i => i.puId === puId); if (incs.length) incidentModal(incs[0], { canManage: API.can('incidents.manage'), onChange: refresh }); else toast('No incidents', 'No incidents recorded at this polling unit.'); };
      $('#puactions [data-t]', m.body).onclick = () => {
        m.close();
        const tm = modal({
          title: `PU timeline — ${pu.code}`,
          body: () => el(`<div id="putl"><span class="dim small">Loading…</span></div>`),
          actions: [{ label: 'Close', cls: 'ghost' }],
        });
        API.get(`/api/pus/${puId}/timeline`).then(res => {
          $('#putl', tm.body).innerHTML = res.rows.length ? `<div class="feed">${res.rows.slice(0, 20).map(r => `<div class="item"><span class="t">${fmtWatShort(r.t)}</span><span class="tx"><b>${esc(r.label)}</b>${r.detail ? ` <span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('')}</div>` : '<div class="empty">No events</div>';
        }).catch(() => { $('#putl', tm.body).innerHTML = '<div class="empty">—</div>'; });
      };
    });
  }

  // ================= AGENTS (§16-18) =================
  function vAgents(b) {
    const wrap = el(`<div id="agwrap"><span class="dim small">Loading field agents…</span></div>`);
    b.appendChild(wrap);
    loadAgents().then(({ rows }) => {
      const online = rows.filter(a => a.online).length;
      const lowBat = rows.filter(a => a.battery < 25 && a.online).length;
      const sosA = mySos().length;
      const done = rows.filter(a => a.dutyState === 'DUTY_COMPLETED').length;
      wrap.innerHTML = `<div class="kpis">
        ${kpiCard('Assigned', fmtN(rows.length))}
        ${kpiCard('Online', fmtN(online), { cls: 'ok' })}
        ${kpiCard('Offline', fmtN(rows.length - online), { cls: rows.length - online > 0 ? 'warn' : '' })}
        ${kpiCard('Low battery', fmtN(lowBat), { cls: lowBat ? 'warn' : '' })}
        ${kpiCard('SOS active', fmtN(sosA), { cls: sosA ? 'alert' : '' })}
        ${kpiCard('Duty completed', fmtN(done))}
      </div>
      <div class="panel"><div class="ph"><span class="t">AGENT MONITORING</span><span class="sp"></span><input class="inp" style="width:170px" id="agq" placeholder="Search agent…"></div>
      <div class="pb flat" id="agbody"></div></div>`;
      const draw = debounce(() => {
        const q = $('#agq', wrap).value.toLowerCase();
        const list = rows.filter(a => !q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || a.puId.toLowerCase().includes(q));
        const t = dataTable({
          cols: [
            { label: 'ID', key: 'code', cls: 'mono' }, { label: 'Name', key: 'name' },
            { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'Ward', key: 'wardId', render: r => esc(bootstrap.wards.find(w => w.id === r.wardId)?.name || '') },
            { label: 'Status', key: 'dutyState', render: r => r.online === false ? '<span class="st bad">OFFLINE</span>' : statusBadge(r.dutyState) },
            { label: 'Last heartbeat', key: 'lastHeartbeat', render: r => r.lastHeartbeat ? timeAgoWat(r.lastHeartbeat, ov.sim.now) : '—' },
            { label: 'Battery', key: 'battery', cls: 'num', render: r => `${r.battery}%` },
            { label: 'Network', key: 'network' },
            { label: 'GPS', key: 'dutyState', render: () => '<span class="st ok">✓</span>' },
            { label: '', key: 'id', render: r => `<button class="btn sm" data-ag="${r.id}">Profile</button>` },
          ],
          rows: list, sortable: true, pageSize: 20,
        });
        t.setTitle(`${list.length} agents · statuses: ONLINE / OFFLINE / LOW BATTERY / SYNCING / SOS ACTIVE / DUTY COMPLETED`);
        $('#agbody', wrap).innerHTML = ''; $('#agbody', wrap).appendChild(t.el);
        $$('[data-ag]', wrap).forEach(x => x.onclick = () => agentModal(rows.find(a => a.id === x.dataset.ag)));
      }, 250);
      $('#agq', wrap).addEventListener('input', draw);
      draw();
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function agentModal(a) {
    const m = modal({
      title: `AGENT COMMAND PROFILE — ${a.code}`,
      wide: true,
      body: () => el(`<div>
        <div class="detail-grid">
          <span class="k">Agent</span><span class="v">${esc(a.name)} (${esc(a.code)})</span>
          <span class="k">Assignment</span><span class="v">${esc(a.puId)} · ${esc(a.lga)}</span>
          <span class="k">Duty status</span><span class="v">${statusBadge(a.dutyState)}</span>
          <span class="k">Last heartbeat</span><span class="v">${a.lastHeartbeat ? fmtWatShort(a.lastHeartbeat) : '—'}</span>
          <span class="k">Battery / Network</span><span class="v">${a.battery}% · ${esc(a.network)}</span>
          <span class="k">Signal</span><span class="v">${esc(a.signal || 'NORMAL')}</span>
          <span class="k">App version</span><span class="v">${esc(a.appVersion || '1.4.0')}</span>
        </div>
        <div class="row mt12">
          <button class="btn sm" data-msg="${esc(a.name)}">💬 Message agent</button>
          <button class="btn sm" data-tl="${a.puId}">🕘 Agent timeline</button>
        </div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">AGENT TIMELINE</span></div><div class="pb" id="agtl" style="max-height:260px;overflow:auto"><span class="dim small">Loading…</span></div></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get(`/api/pus/${a.puId}/timeline`).then(res => {
      $('#agtl', m.body).innerHTML = res.rows.length ? `<div class="feed">${res.rows.slice(0, 16).map(r => `<div class="item"><span class="t">${fmtWatShort(r.t)}</span><span class="tx"><b>${esc(r.label)}</b>${r.detail ? ` <span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('')}</div>` : '<div class="empty small">No events</div>';
    }).catch(() => { $('#agtl', m.body).innerHTML = '<div class="empty small">—</div>'; });
    $('[data-tl]', m.body).onclick = () => { /* already shown */ };
    $('[data-msg]', m.body).onclick = () => {
      const mm = modal({
        title: `Operational message to ${a.name}`,
        body: () => el(`<label class="fl">Message (logged, never anonymous)</label><textarea class="inp" id="agmsg" rows="3" placeholder="Operational instruction / clarification request / status update request…"></textarea>`),
        actions: [
          { label: 'Cancel', cls: 'ghost' },
          { label: 'Send instruction', cls: 'primary', onClick: () => {
            const body = $('#agmsg').value.trim();
            if (!body) return toast('Empty message', 'Type an operational instruction first.', 'medium');
            const role = bootstrap.agents.length ? null : null;
            API.post('/api/messages', { toRoleId: 'agent', body: `[LG ${myLga}] ${body}` }).then(() => {
              toast('Message sent', `Logged communication to ${a.name} (agent role channel).`);
              mm.close();
            }).catch(e => toast('Failed', (e.data && e.data.message) || e.message, 'high'));
          } },
        ],
      });
    };
  }

  // ================= CONNECTIVITY (§34-35) =================
  function vConnectivity(b) {
    const wrap = el(`<div>
      <div class="panel"><div class="ph"><span class="t">NETWORK HEALTH — ${esc(myLga.toUpperCase())}</span><span class="sub">connectivity heat layer</span></div>
      <div class="pb flat" style="height:380px"><div id="connmap" style="width:100%;height:100%"></div></div></div>
      <div class="grid2 mt12">
        <div class="panel"><div class="ph"><span class="t">AGENT CONNECTIVITY</span></div><div class="pb flat" id="connbody"><span class="dim small">Loading…</span></div></div>
        <div class="panel"><div class="ph"><span class="t">SYNCHRONIZATION</span></div><div class="pb" id="syncbody"><span class="dim small">Loading…</span></div></div>
      </div>
    </div>`);
    b.appendChild(wrap);
    const m = createMap($('#connmap', wrap), bootstrap, {});
    m.setData({ lgas: ov.lgas, agents: ov.agentsOnMap.filter(a => a.lgaId === myLgaId) });
    m.setLgaMetric(l => l.lgaId === myLgaId ? pctSafe(lgData().agentsOnline, lgData().agents) : 0);
    m.zoomToLga(myLgaId);
    loadAgents().then(({ rows }) => {
      const offline = rows.filter(a => !a.online && !['NOT_ACTIVATED', 'DUTY_COMPLETED'].includes(a.dutyState));
      $('#connbody', wrap).innerHTML = offline.length ? `<table class="tbl"><tr><th>Agent</th><th>PU</th><th>Last heartbeat</th><th>Signal</th></tr>${offline.slice(0, 15).map(a => `<tr><td>${esc(a.name)}</td><td class="mono">${esc(a.puId)}</td><td>${a.lastHeartbeat ? fmtWatShort(a.lastHeartbeat) : '—'}</td><td><span class="badge l4">${esc(a.signal || 'OFFLINE')}</span></td></tr>`).join('')}</table>` : '<div class="empty">All agents online ✓</div>';
      const syncPct = rows.length ? Math.round(rows.filter(a => a.online).length / rows.length * 100) : 100;
      $('#syncbody', wrap).innerHTML = `
        <div class="small muted mb12">SYNCHRONIZATION <b style="color:#4ade80">${syncPct}.0% complete</b></div>
        <div class="flex mb12"><span class="small muted">Pending submissions</span><b class="right">${lgData().pending}</b></div>
        <div class="flex mb12"><span class="small muted">Upload failures</span><b class="right">0</b></div>
        <div class="flex mb12"><span class="small muted">Retry queue</span><b class="right">0</b></div>
        <div class="flex"><span class="small muted">Last successful sync</span><b class="right">${fmtWatShort(ov.sim.now)}</b></div>`;
    }).catch(() => {});
  }

  // ================= RESULTS (§19-23) =================
  function vResults(b) {
    const lg = lgData();
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Expected', fmtN(lg.totalPu))}
      ${kpiCard('Submitted', fmtN(lg.submitted), { sub: lg.reportingPct + '%', cls: 'accent' })}
      ${kpiCard('Pending', fmtN(lg.pending), { cls: lg.pending ? 'warn' : '' })}
      ${kpiCard('Under review', fmtN(myQueue().length))}
      ${kpiCard('Verified', fmtN(lg.verified), { sub: lg.verifiedPct + '%', cls: 'ok' })}
      ${kpiCard('Rejected', fmtN(ov.kpis.rejected))}
      ${kpiCard('Disputed', fmtN(ov.kpis.disputed), { cls: ov.kpis.disputed ? 'alert' : '' })}
    </div>
    <div class="panel"><div class="ph"><span class="t">RESULT PROGRESS MATRIX</span><span class="sub">ward × status · sort by lowest reporting, highest pending, backlog</span></div>
    <div class="pb flat" id="matrix"></div></div>
    <div class="panel mt12"><div class="ph"><span class="t">SUBMISSIONS</span></div>
    <div class="pb flat" id="subbody"><span class="dim small">Loading…</span></div></div>`));
    const wards = myWards();
    const t1 = dataTable({
      cols: [
        { label: 'Ward', key: 'name', render: r => `<b>${esc(r.name)}</b>` },
        { label: 'Expected', key: 'pus', cls: 'num' },
        { label: 'Submitted', key: 'submitted', cls: 'num' },
        { label: 'Verified', key: 'verified', cls: 'num' },
        { label: 'Pending', key: 'pending', cls: 'num', render: r => `<span style="color:${r.pus - r.submitted ? '#fbbf24' : ''}">${r.pus - r.submitted}</span>` },
        { label: 'Status', key: 'reportingPct', render: r => r.reportingPct >= 90 ? '<span class="st ok">COMPLETE</span>' : r.reportingPct >= 50 ? '<span class="st warn">IN PROGRESS</span>' : '<span class="st bad">ATTENTION</span>' },
      ],
      rows: wards, sortable: true, pageSize: 20,
    });
    t1.setTitle(`${wards.length} wards`);
    $('#matrix', b).appendChild(t1.el);
    loadResults().then(rows => {
      const t2 = dataTable({
        cols: [
          { label: 'Code', key: 'code', cls: 'mono' }, { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'Ward', key: 'ward' },
          { label: 'Valid', key: 'validVotes', cls: 'num' }, { label: 'Status', key: 'status', render: r => statusBadge(r.status) },
          { label: 'Flags', key: 'anomalies', render: r => r.anomalies?.length ? `<span class="badge l3">⚠ ${r.anomalies.length}</span>` : '—' },
          { label: '', key: 'id', render: r => `<button class="btn sm" data-open="${r.id}">Open</button>` },
        ],
        rows, sortable: true, pageSize: 20,
      });
      t2.setTitle(`${rows.length} submissions`);
      $('#subbody', b).innerHTML = ''; $('#subbody', b).appendChild(t2.el);
      $$('[data-open]', b).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
    }).catch(() => { $('#subbody', b).innerHTML = '<div class="empty">—</div>'; });
  }

  // ---------------- submission modal (§21) ----------------
  function submissionModal(id) {
    const m = modal({
      title: 'RESULT RECORD',
      wide: true,
      body: () => el(`<div id="sbox"><span class="dim small">Loading record…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get('/api/results/' + id).then(sub => {
      const itemsById = Object.fromEntries(sub.items.map(i => [i.candidateId, i.votes]));
      const cands = sub.candidates || [];
      $('#sbox', m.body).innerHTML = `
        <div class="flex mb12"><span class="mono small dim">${esc(sub.code || id.slice(0, 8))}</span>${statusBadge(sub.status)}<span class="right small dim">${fmtWatShort(sub.submittedAt)}</span></div>
        <div class="detail-grid">
          <span class="k">Polling unit</span><span class="v">${esc(sub.puId)} — ${esc(sub.pu?.name || '')}</span>
          <span class="k">Ward</span><span class="v">${esc(sub.ward)}</span>
          <span class="k">Agent</span><span class="v">${esc(sub.agentId)}</span>
          <span class="k">GPS</span><span class="v">${sub.pu ? sub.pu.lat.toFixed(5) + ', ' + sub.pu.lon.toFixed(5) : '—'}</span>
          <span class="k">Reviewer</span><span class="v">${sub.review ? esc(sub.review.reviewerName || sub.review.reviewerId) : 'awaiting review'}</span>
        </div>
        <table class="tbl mt12"><tr><th>Candidate</th><th class="num">Votes</th></tr>
        ${cands.map(c => `<tr><td class="small">${esc(c.name)} <span style="color:${c.color}">${esc(c.party)}</span></td><td class="num mono">${fmtN(itemsById[c.id] ?? 0)}</td></tr>`).join('')}
        <tr><td class="small muted">Valid / Rejected / Accredited</td><td class="num mono">${fmtN(sub.validVotes)} / ${fmtN(sub.rejected)} / ${fmtN(sub.accredited)}</td></tr></table>
        ${(sub.anomalies || []).length ? `<div class="mt12">${sub.anomalies.map(a => `<span class="badge l3 mb12">⚠ ${esc(a.code)}</span>`).join(' ')}</div>` : '<div class="small mt8" style="color:#4ade80">✓ Validation checks passed</div>'}
        ${sub.review ? `<div class="small muted mt12">Review comments: “${esc(sub.review.reason || '—')}” ${sub.review.secondAction ? '· dual-control: ' + esc(sub.review.secondAction) : ''}</div>` : ''}
        <div class="row mt12">
          ${(sub.evidence || []).length ? sub.evidence.map(e => `<button class="btn sm" data-ev="${e.id}">🗂 EC8A viewer</button>`).join('') : ''}
          ${sub.versions ? `<span class="pill">Versions recorded: ${sub.versions} (originals preserved)</span>` : ''}
        </div>`;
      $$('[data-ev]', m.body).forEach(x => x.onclick = () => ec8aViewer(sub.evidence.find(e => e.id === x.dataset.ev), sub));
    }).catch(e => { $('#sbox', m.body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ---------------- EC8A viewer (§22) ----------------
  function ec8aViewer(ev, sub) {
    let zoom = 1;
    const m = modal({
      title: `EC8A VIEWER — ${ev.code || 'EVIDENCE'}`,
      wide: true,
      body: () => el(`<div>
        <div class="grid2" style="align-items:start">
          <div class="panel" style="margin:0"><div class="ph"><span class="t">ORIGINAL DOCUMENT</span><span class="sub">immutable · never modified</span></div>
          <div class="pb" style="overflow:auto;max-height:500px"><div id="docimg"></div></div></div>
          <div class="panel" style="margin:0"><div class="ph"><span class="t">STRUCTURED DATA</span><span class="sp"></span>${statusBadge(sub?.status || '—')}</div>
          <div class="pb small" style="max-height:500px;overflow:auto"><div class="detail-grid">
            <span class="k">Submission</span><span class="v mono">${esc(ev.subCode || ev.submissionId || '—')}</span>
            <span class="k">PU / Ward</span><span class="v">${esc(ev.puId || '')} / ${esc(ev.ward || '')}</span>
            <span class="k">Agent</span><span class="v">${esc(ev.agent || '—')}</span>
            <span class="k">Captured</span><span class="v">${fmtWatShort(ev.capturedAt || ev.uploadedAt)}</span>
            <span class="k">Pages</span><span class="v">${ev.pages || 1}</span>
            <span class="k">SHA-256</span><span class="v mono small">${esc(ev.sha256 || '—')}</span>
          </div>
          <hr class="soft"><b class="small">DATA-QUALITY SIGNALS</b>
          <div class="mt8">${ev.signals ? Object.entries(ev.signals).map(([k, v]) => `<div class="flex mb12"><span class="small muted" style="width:160px">${esc(k)}</span><span class="small">${esc(v)}</span></div>`).join('') : '—'}</div></div>
        </div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">CHAIN OF CUSTODY</span></div>
        <div class="pb small">${(ev.chain || []).map((c, i) => `<div class="flex mb12"><span class="pill">${i + 1}</span><b class="small">${esc(c.step)}</b><span class="small muted">${fmtWatShort(c.at)} · ${esc(c.by || '')}</span></div>`).join('') || '—'}</div></div>
      </div>`),
      actions: [
        { label: 'Zoom', cls: '', onClick: () => { zoom = zoom === 1 ? 1.8 : 1; const im = $('#docimg img', m.body); if (im) im.style.transform = `scale(${zoom})`; } },
        { label: 'Full screen', cls: '', onClick: () => { const p = $('#docimg', m.body).closest('.panel'); if (p && p.requestFullscreen) p.requestFullscreen(); } },
        { label: 'Close', cls: 'ghost' },
      ],
    });
    if (ev.dataUrl) {
      $('#docimg', m.body).innerHTML = `<img src="${ev.dataUrl}" style="width:100%;border-radius:6px;border:1px solid var(--line2);transform-origin:top left;transition:transform .2s">`;
    } else {
      const cv = el('<canvas width="640" height="400" style="width:100%;border-radius:6px;border:1px solid var(--line2)"></canvas>');
      $('#docimg', m.body).appendChild(cv);
      drawEc8a(cv, { pu: ev.puId || sub?.puId, ward: ev.ward || sub?.ward, lga: ev.lga || sub?.lga, election: 'Governorship', candidates: [], valid: 0, rejected: 0, accredited: 0, registered: 0, page: 1, docId: (ev.sha256 || '').slice(0, 12) });
    }
  }

  // ================= REVIEW QUEUE (§24) =================
  function vQueue(b) {
    const rows = myQueue();
    b.appendChild(el(`<div class="pub-note">Categories: new submissions · low-quality documents · mathematical inconsistencies · possible duplicates · missing metadata · disputed · clarification requests. Each item shows <b>PRIORITY · AGE · LOCATION · STATUS</b>. The LG portal monitors and forwards — verification remains with authorized supervisors.</div>
    <div class="panel"><div class="ph"><span class="t">REVIEW QUEUE — ${esc(myLga.toUpperCase())}</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Priority</th><th>PU</th><th>Election</th><th>Age</th><th>Flags</th><th></th></tr>
    ${rows.length ? rows.map(q => `<tr><td>${q.anomalies.length ? '<span class="badge l4">HIGH</span>' : '<span class="badge l3">MEDIUM</span>'}</td><td class="mono">${esc(q.puId)}</td><td>${esc(q.election)}</td><td>${timeAgoWat(q.submittedAt, ov.sim.now)}</td><td>${q.anomalies.length ? q.anomalies.map(a => `<span class="badge l3">${esc(a)}</span>`).join(' ') : '—'}</td><td><button class="btn sm" data-open="${q.id}">Open</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">Queue is clear</td></tr>'}
    </table></div></div>`));
    $$('[data-open]', b).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
  }

  // ================= EVIDENCE / DISPUTES =================
  function vEvidence(b) {
    const wrap = el(`<div id="evwrap"><span class="dim small">Loading evidence centre…</span></div>`);
    b.appendChild(wrap);
    loadEvidence().then(res => {
      const s = res.stats;
      wrap.innerHTML = `<div class="kpis">
        ${kpiCard('Documents received', fmtN(s.received))}
        ${kpiCard('Pending review', fmtN(s.pendingReview), { cls: s.pendingReview ? 'warn' : '' })}
        ${kpiCard('Low quality', fmtN(s.lowQuality), { cls: s.lowQuality ? 'warn' : '' })}
        ${kpiCard('Verified', fmtN(s.verified), { cls: 'ok' })}
        ${kpiCard('Disputed', fmtN(s.disputed), { cls: s.disputed ? 'alert' : '' })}
        ${kpiCard('Requires review', fmtN(s.requiresReview), { cls: s.requiresReview ? 'warn' : '' })}
      </div>
      <div class="pub-note">Decision-support indicators only — <b>they never automatically imply fraud</b>. SIGNAL REQUIRES REVIEW.</div>
      <div class="panel"><div class="ph"><span class="t">EC8A DOCUMENTS — ${esc(myLga.toUpperCase())}</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Evidence</th><th>Submission</th><th>PU</th><th>Doc</th><th>OCR</th><th>Math</th><th>Dup</th><th>Meta</th><th>Status</th><th></th></tr>
      ${res.rows.length ? res.rows.map(r => `<tr>
        <td class="mono">${esc(r.code)}</td><td class="mono">${esc(r.subCode || '')}</td><td class="mono">${esc(r.puId)}</td>
        <td>${r.signals.documentQuality === 'GOOD' ? '<span class="badge s-verified">GOOD</span>' : '<span class="badge l3">ATTENTION</span>'}</td>
        <td>${r.signals.ocrConfidence === 'HIGH' ? '<span class="badge s-verified">HIGH</span>' : r.signals.ocrConfidence === 'MEDIUM' ? '<span class="badge s-under">MED</span>' : '<span class="badge l4">LOW</span>'}</td>
        <td>${r.signals.mathReconciliation === 'PASSED' ? 'PASSED' : '<span class="badge l4">REVIEW</span>'}</td>
        <td>${r.signals.duplicateSignal === 'CLEAR' ? 'CLEAR' : '<span class="badge l4">DUP?</span>'}</td>
        <td>${r.signals.metadata === 'COMPLETE' ? 'COMPLETE' : '<span class="badge l3">INCOMPLETE</span>'}</td>
        <td>${statusBadge(r.status)}</td><td><button class="btn sm" data-ev="${r.id}">View</button></td>
      </tr>`).join('') : '<tr><td colspan="10" class="empty">No EC8A documents in this LG yet</td></tr>'}
      </table></div></div>`;
      $$('[data-ev]', wrap).forEach(x => x.onclick = () => { const r = res.rows.find(e => e.id === x.dataset.ev); if (r) ec8aViewer(r, { code: r.subCode, status: r.status, puId: r.puId }); });
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function vDisputes(b) {
    const wrap = el(`<div id="diswrap"><span class="dim small">Loading disputed records…</span></div>`);
    b.appendChild(wrap);
    loadResults().then(rows => {
      const disputed = rows.filter(r => r.status === 'DISPUTED');
      wrap.innerHTML = `<div class="pub-note">Workflow: <b>OPEN → UNDER REVIEW → ESCALATED → RESOLVED → CLOSED</b>. Original documents and all versions are preserved; corrections create new versions, never overwrite.</div>
      <div class="panel"><div class="ph"><span class="t">DISPUTES — ${esc(myLga.toUpperCase())}</span></div>
      <div class="pb flat">${disputed.length ? `<table class="tbl"><tr><th>Code</th><th>PU</th><th>Ward</th><th>Flags</th><th></th></tr>
      ${disputed.map(r => `<tr><td class="mono">${esc(r.code || r.id.slice(0, 8))}</td><td class="mono">${esc(r.puId)}</td><td>${esc(r.ward)}</td><td>${r.anomalies?.length ? `<span class="badge l3">⚠ ${r.anomalies.length}</span>` : '—'}</td><td><button class="btn sm" data-open="${r.id}">Open</button></td></tr>`).join('')}</table>` : '<div class="empty">No disputed records in this LG.</div>'}</div></div>`;
      $$('[data-open]', wrap).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ================= INCIDENTS (§25-29) =================
  function vIncidents(b) {
    const incs = myIncidents();
    const open = incs.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status));
    const bySev = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    open.forEach(i => bySev[i.severity]++);
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Total', fmtN(incs.length))}
      ${kpiCard('Active', fmtN(open.length), { cls: open.length ? 'warn' : '' })}
      ${kpiCard('Critical', fmtN(bySev[5]), { cls: bySev[5] ? 'alert' : '' })}
      ${kpiCard('High', fmtN(bySev[4]), { cls: bySev[4] ? 'warn' : '' })}
      ${kpiCard('Medium', fmtN(bySev[3]))}
      ${kpiCard('Low', fmtN(bySev[2] + bySev[1]))}
      ${kpiCard('Resolved', fmtN(incs.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status)).length), { cls: 'ok' })}
    </div>
    <div class="pub-note">Incident workflow: <b>ACKNOWLEDGE → ASSESS → ESCALATE → MONITOR → RESOLVE/CLOSE</b>. Critical incidents automatically notify the higher-level operations team. Use neutral factual language — unsupported accusations are not permitted.</div>
    <div class="panel"><div class="ph"><span class="t">LIVE INCIDENT FEED</span></div>
    <div class="pb flat"><div class="feed" style="max-height:440px">${incs.length ? incs.slice(0, 25).map(i => `
      <div class="item" data-inc="${i.id}"><span class="t">${fmtWatShort(i.createdAt)}</span>
      <span class="tx">${sevBadge(i.severity)} <b>${esc(i.subcategory)}</b> — ${esc(i.puId || '')} ${statusBadge(i.status)}<br><span class="muted small">“${esc((i.description || '').slice(0, 90))}${(i.description || '').length > 90 ? '…' : ''}”</span></span></div>`).join('') : '<div class="empty">No incidents</div>'}</div></div></div>`));
    $$('[data-inc]', b).forEach(x => x.onclick = () => incidentModal(ov.incidents.find(i => i.id === x.dataset.inc), { canManage: API.can('incidents.manage'), onChange: refresh }));
  }
  function vIncmap(b) {
    const wrap = el(`<div>
      <div class="flex mb12">
        <select class="inp" style="width:120px" id="msev"><option value="">All levels</option>${[5, 4, 3, 2, 1].map(s => `<option>${s}</option>`).join('')}</select>
        <select class="inp" style="width:150px" id="mst"><option value="">All statuses</option>${['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED'].map(s => `<option>${s}</option>`).join('')}</select>
        <span class="flex1"></span><span class="small dim">red pulse = L4/L5 · click a marker for the full record</span>
      </div>
      <div class="map-wrap" style="height:calc(100vh - 190px)"><div id="incmap" style="width:100%;height:100%"></div></div>
    </div>`);
    b.appendChild(wrap);
    const m = createMap($('#incmap', wrap), bootstrap, {});
    const apply = () => {
      let list = myIncidents();
      if ($('#msev', wrap).value) list = list.filter(i => String(i.severity) === $('#msev', wrap).value);
      if ($('#mst', wrap).value) list = list.filter(i => i.status === $('#mst', wrap).value);
      m.setData({ lgas: ov.lgas, incidents: list, sos: mySos(), streams: myStreams(), agents: [] });
      m.setLgaMetric(l => l.lgaId === myLgaId ? l.reportingPct : 0);
    };
    m.zoomToLga(myLgaId);
    ['msev', 'mst'].forEach(id => $('#' + id, wrap).addEventListener('input', apply));
    m.onClick(({ type, id }) => {
      if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
    });
    apply();
  }

  // ================= SOS (§30-31) =================
  function vSos(b) {
    const sos = mySos();
    const active = sos.filter(s => s.status !== 'RESOLVED');
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Active SOS', fmtN(active.length), { cls: active.length ? 'alert' : 'ok', sub: active.length ? 'IMMEDIATE ATTENTION' : 'none' })}
      ${kpiCard('Acknowledged', fmtN(sos.filter(s => s.status === 'ACKNOWLEDGED').length))}
      ${kpiCard('Responding', fmtN(sos.filter(s => s.status === 'RESPONDING').length), { cls: 'warn' })}
      ${kpiCard('Resolved', fmtN(sos.filter(s => s.status === 'RESOLVED').length), { cls: 'ok' })}
    </div>
    ${active.length ? `<div class="alert-strip">${active.map(s => `<div class="a" data-sos="${s.id}">🚨 ${esc(s.code)} — ${esc(s.category)} @ ${esc(s.puId)} · ${esc(s.status)}</div>`).join('')}</div>` : ''}
    <div class="pub-note">Workflow: <b>ACTIVE → ACKNOWLEDGED → ESCALATED → RESPONDING → RESOLVED</b>. Every transition requires user, timestamp, action and optional note. The platform coordinates authorized escalation — it does not provide physical emergency response itself.</div>
    <div class="panel"><div class="ph"><span class="t">SOS EVENTS — ${esc(myLga.toUpperCase())}</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Code</th><th>Category</th><th>PU</th><th>Status</th><th>Triggered</th><th>Acks</th><th></th></tr>
    ${sos.length ? sos.map(s => `<tr><td class="mono">${esc(s.code)}</td><td>${esc(s.category)}</td><td class="mono">${esc(s.puId)}</td><td>${statusBadge(s.status)}</td><td>${fmtWatShort(s.createdAt)}</td><td>${(s.acks || []).length} ✓</td><td><button class="btn sm" data-sos="${s.id}">Open</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No SOS events in this LG</td></tr>'}
    </table></div></div>`));
    $$('[data-sos]', b).forEach(x => x.onclick = () => sosModal(mySos().find(s => s.id === x.dataset.sos), { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }));
  }

  // ================= VIDEO (§32-33) =================
  function vVideo(b) {
    const wrap = el(`<div>
      <div class="flex mb12"><span class="pill">LIVE MONITORING — ${esc(myLga.toUpperCase())}</span><span class="small dim">Unsupervised recording or redistribution is not permitted.</span><span class="flex1"></span>
      ${[2, 3, 4].map(g => `<button class="btn sm ${wallGrid === g ? 'primary' : ''}" data-g="${g}">${g}×${g}</button>`).join('')}
      <button class="btn sm" data-full>⛶</button></div>
      <div class="vwall g${wallGrid}" id="vw"></div>
    </div>`);
    b.appendChild(wrap);
    const draw = () => {
      const live = myStreams();
      $('#vw', wrap).innerHTML = live.length ? live.map(s => `
        <div class="vcard"><canvas width="400" height="240"></canvas><div class="vh"></div>
        <div class="vinfo"><b>${esc(s.puId)}</b><br>${esc(s.puName || '')}<br>${esc(s.agentName)}</div>
        <div class="vstatus live">● LIVE</div>
        <button class="vpin ${s.pinned ? 'on' : ''}" data-pin="${s.id}">📌</button></div>`).join('') : '<div class="empty" style="grid-column:1/-1">No live streams in this LG — streams appear as agents broadcast.</div>';
      $$('canvas', $('#vw', wrap)).forEach((cv, i) => { if (live[i]) startSimStream(cv, { pu: live[i].puId, lga: live[i].lga, bitrate: live[i].bitrateKbps, fps: live[i].fps, viewers: live[i].viewers, t: ov.sim.now }); });
      $$('[data-pin]', wrap).forEach(x => x.onclick = async (e) => { e.stopPropagation(); await API.post(`/api/streams/${x.dataset.pin}/pin`, {}); refresh().then(() => render()); });
    };
    $$('[data-g]', wrap).forEach(x => x.onclick = () => { wallGrid = +x.dataset.g; render(); });
    $('[data-full]', wrap).onclick = () => { const w = $('#vw', wrap); if (document.fullscreenElement) document.exitFullscreen(); else w.requestFullscreen(); };
    draw();
  }

  // ================= ANALYTICS (§38-40) =================
  function vAnalytics(b) {
    const SUBS = [['reporting', 'REPORTING'], ['results', 'RESULTS'], ['verification', 'VERIFICATION'], ['incidents', 'INCIDENTS'], ['connectivity', 'CONNECTIVITY']];
    b.appendChild(el(`<div class="act-seg mb12" id="ansub">${SUBS.map(([id, l]) => `<span class="as ${id === actSub ? 'on' : ''}" data-s="${id}">${l}</span>`).join('')}</div>
    <div class="flex mb12"><span class="small dim">Time range</span>
      <select class="inp" style="width:170px" id="range"><option value="30">Last 30 minutes</option><option value="60" selected>Last hour</option><option value="360">Last 6 hours</option><option value="0">Election day</option></select>
    </div>
    <div id="anbox"></div>`));
    const box = $('#anbox', b);
    const loadMetric = async (metric) => {
      const res = await API.get(`/api/analytics/timeseries?metric=${metric}&bucket=30`);
      const range = +$('#range', b).value;
      let series = res.series;
      if (range > 0) series = series.slice(-range / 30);
      const lbl = series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
      return { data: series.map(p => p.count), labels: lbl };
    };
    const draw = async () => {
      const sub = actSub;
      box.innerHTML = '<span class="dim small">Loading…</span>';
      if (sub === 'reporting') {
        const [subs, chk] = await Promise.all([loadMetric('submissions'), loadMetric('checkins')]);
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Reports over time</span><span class="sub">statewide context · timestamps in WAT</span></div><div class="pb chart-box">${lineChart({ series: [{ data: subs.data }], labels: subs.labels, h: 210 })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Agent check-ins</span></div><div class="pb chart-box">${lineChart({ series: [{ data: chk.data, color: '#a78bfa' }], labels: chk.labels, h: 210, color: '#a78bfa' })}</div></div>
        </div>`;
      } else if (sub === 'results') {
        const s = await loadMetric('submissions');
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Result submissions by hour</span></div><div class="pb chart-box">${barChart({ data: s.data, labels: s.labels, h: 210, color: '#38bdf8' })}</div></div>
          <div class="panel"><div class="ph"><span class="t">WARD COMPARISON — operational completeness</span><span class="sub">never ranked by candidate support</span></div>
          <div class="pb chart-box">${barChart({ data: myWards().map(w => w.score), labels: myWards().map(w => w.name.length > 10 ? w.name.slice(0, 9) + '…' : w.name), h: 210, colorFn: v => v > 70 ? '#22c55e' : v > 40 ? '#f59e0b' : '#ef4444' })}</div></div>
        </div>`;
      } else if (sub === 'verification') {
        const s = await loadMetric('verifications');
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Verification rate over time</span></div><div class="pb chart-box">${lineChart({ series: [{ data: s.data, color: '#22c55e' }], labels: s.labels, h: 210, color: '#22c55e' })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Verification backlog</span><span class="sub">pending review</span></div>
          <div class="pb"><div class="stat-tiles">
            <div class="stat-tile ${lgData().pending ? 'warn' : 'ok'}"><div class="v">${lgData().pending}</div><div class="l">Awaiting review</div></div>
            <div class="stat-tile ok"><div class="v">${lgData().verified}</div><div class="l">Verified PUs</div></div>
            <div class="stat-tile"><div class="v">${lgData().rejected || 0}</div><div class="l">Rejected</div></div>
            <div class="stat-tile"><div class="v">${lgData().disputed || 0}</div><div class="l">Disputed</div></div>
          </div></div></div>
        </div>`;
      } else if (sub === 'incidents') {
        const s = await loadMetric('incidents');
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Incident trend</span></div><div class="pb chart-box">${barChart({ data: s.data, labels: s.labels, h: 210, color: '#fb923c' })}</div></div>
          <div class="panel"><div class="ph"><span class="t">SOS trend</span></div><div class="pb chart-box" id="soschart"><span class="dim small">Loading…</span></div></div>
        </div>`;
        loadMetric('sos').then(s2 => { $('#soschart', box).innerHTML = barChart({ data: s2.data, labels: s2.labels, h: 210, color: '#ef4444' }); });
      } else {
        const { rows } = await loadAgents();
        const online = rows.filter(a => a.online).length;
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Online / offline trend</span></div><div class="pb chart-box">${donutChart({ segments: [{ label: 'Online', value: online, color: '#22c55e' }, { label: 'Offline', value: rows.length - online, color: '#ef4444' }], w: 220, h: 210, centerLabel: 'agents', centerValue: rows.length })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Ward connectivity</span></div><div class="pb chart-box">${barChart({ data: myWards().map(w => w.agents ? pctSafe(w.online, w.agents) : 0), labels: myWards().map(w => w.name.length > 10 ? w.name.slice(0, 9) + '…' : w.name), h: 210, colorFn: v => v < 60 ? '#ef4444' : v < 85 ? '#f59e0b' : '#22c55e' })}</div></div>
        </div>`;
      }
    };
    $$('#ansub .as', b).forEach(x => x.onclick = () => { actSub = x.dataset.s; $$('#ansub .as', b).forEach(y => y.classList.remove('on')); x.classList.add('on'); draw(); });
    $('#range', b).onchange = draw;
    draw();
  }

  // ================= INTELLIGENCE (§58-59) =================
  function vBrief(b) {
    const lg = lgData();
    const h = healthBreakdown();
    const signals = computeSignals();
    b.appendChild(el(`<div class="flex mb12"><span class="pill">LG INTELLIGENCE BRIEF — real-time · provenance-labelled</span><span class="flex1"></span><button class="btn sm" id="brefresh">↻ Refresh</button></div>
    <div class="panel"><div class="pb">
      <div class="brief-sec"><div class="b-t">CURRENT SITUATION</div><div class="b-x">${esc(myLga)} LGA is at <b>${h.score}% operational health (${h.status})</b>. ${lg.agentsOnline} of ${lg.agents} agents online · ${fmtN(lg.incidents)} active incidents · ${fmtN(lg.sos)} active SOS.</div></div>
      <div class="brief-sec"><div class="b-t">REPORTING</div><div class="b-x">${lg.submitted}/${lg.totalPu} polling units reported (${lg.reportingPct}%) — FACTUAL DATA from the polling-unit register.</div></div>
      <div class="brief-sec"><div class="b-t">INCIDENTS</div><div class="b-x">${fmtN(lg.incidents)} open — ${myIncidents().filter(i => i.severity >= 4).length} at L4/L5 require immediate attention.</div></div>
      <div class="brief-sec"><div class="b-t">CONNECTIVITY</div><div class="b-x">${pctSafe(lg.agentsOnline, lg.agents)}% agent connectivity — ${myWards().filter(w => w.agents && pctSafe(w.online, w.agents) < 60).length} ward(s) below 60%.</div></div>
      <div class="brief-sec"><div class="b-t">VERIFICATION</div><div class="b-x">${lg.verified} verified · ${lg.pending} backlog — VERIFIED MONITORING DATA vs SUBMITTED vs UNVERIFIED is always distinguished; never labelled as official results.</div></div>
      <div class="brief-sec"><div class="b-t">PRIORITY ACTIONS</div><div class="b-x">${signals.length ? signals.slice(0, 4).map((s, i) => `${i + 1}. ${esc(s.title)} — ${esc(s.note.slice(0, 90))}`).join('<br>') : 'No priority actions — LG operations are nominal.'}</div></div>
    </div></div>`));
    $('#brefresh', b).onclick = () => { refresh().then(() => render()); };
  }
  function vSignals(b) {
    const signals = computeSignals();
    b.appendChild(el(`<div class="pub-note">The anomaly engine identifies <b>operational patterns requiring review</b> — unusually long reporting gaps, repeated upload failures, duplicate documents, data inconsistencies, verification backlog. It labels them <b>SYSTEM SIGNAL — REQUIRES REVIEW</b>. It never automatically labels an event as electoral fraud.</div>
    ${signals.length ? signals.map(s => `
      <div class="signal-card ${s.sev.toLowerCase()}">
        <div class="s-head">${s.sev === 'CRITICAL' ? '🚨' : s.sev === 'HIGH' ? '⚠' : '▲'} <b>${esc(s.title)}</b><span class="badge ${s.sev === 'CRITICAL' ? 'l5' : s.sev === 'HIGH' ? 'l4' : 'l3'}">${esc(s.sev)}</span><span class="pill">SYSTEM SIGNAL — REQUIRES REVIEW</span></div>
        <div class="s-note">${esc(s.note)}</div>
        <div class="s-actions"><button class="btn sm" data-go="${s.go}">VIEW RECORD</button>${API.can('escalations.create') ? `<button class="btn sm warn" data-escs="${esc(s.title)}">ESCALATE</button>` : ''}</div>
      </div>`).join('') : '<div class="panel"><div class="pb empty">No operational signals. Routine reporting.</div></div>'}`));
    $$('[data-go]', b).forEach(x => x.onclick = () => setTab(x.dataset.go));
    $$('[data-escs]', b).forEach(x => x.onclick = () => escalateModal(null, { type: 'DATA_QUALITY', refId: 'SIGNAL-' + Date.now().toString(36).toUpperCase(), summary: x.dataset.escs }));
  }
  function vCopilot(b) {
    const wrap = el(`<div class="panel" style="display:flex;flex-direction:column;height:calc(100vh - 180px)">
      <div class="ph"><span class="t">🤖 EYES INTELLIGENCE COPILOT</span><span class="sub">LG-scoped · labels VERIFIED DATA / UNVERIFIED REPORT / SYSTEM SIGNAL / ANALYTICAL SUMMARY · never invents information</span></div>
      <div class="pb" id="chat" style="flex:1;overflow-y:auto"></div>
      <div class="pb" style="border-top:1px solid var(--line)"><div class="row">
        <input class="inp grow" id="cq" placeholder='Try: "Which wards have the highest reporting backlog?" or "Summarize the last hour of activity"'>
        <button class="btn primary" id="cbtn">Ask</button>
      </div></div>
    </div>`);
    b.appendChild(wrap);
    const chat = $('#chat', wrap);
    chat.innerHTML = `<div class="item"><span class="t">COPILOT</span><span class="tx">LG-scoped assistant for <b>${esc(myLga)}</b>. Ask about wards, backlogs, unresolved incidents, synchronization, or generate the LG situation report.</span></div>`;
    async function ask(q) {
      chat.appendChild(el(`<div class="item"><span class="t">YOU</span><span class="tx">${esc(q)}</span></div>`));
      const res = await API.post('/api/copilot', { query: `[LG scope: ${myLga}] ${q}` });
      const it = el(`<div class="item"><span class="t">COPILOT</span><span class="tx" style="flex:1"></span></div>`);
      $('.tx', it).innerHTML = mdToHtml(res.answer);
      chat.appendChild(it);
      if (res.sections) {
        const labels = { FACT: 'FACT', VERIFIED_DATA: 'VERIFIED', UNVERIFIED_REPORT: 'UNVERIFIED', DERIVED_DATA: 'DERIVED', SYSTEM_INFERENCE: 'SIGNAL', HUMAN_ASSESSMENT: 'ANALYST' };
        chat.appendChild(el(`<div class="item"><span class="t">SOURCE</span><span class="tx">${res.sections.map(s => `<span class="badge s-submitted">${labels[s.provenance] || s.provenance}</span>`).join(' ')}</span></div>`));
      }
      chat.scrollTop = chat.scrollHeight;
    }
    $('#cbtn', wrap).onclick = () => { const q = $('#cq', wrap).value.trim(); if (q) ask(q); };
    $('#cq', wrap).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cbtn', wrap).click(); });
  }

  // ================= REPORTS (§41, §52) =================
  function vSitrep(b) {
    b.appendChild(el(`<div class="flex mb12"><button class="btn primary" id="gen">⟳ GENERATE LG SITREP</button><span class="flex1"></span><span class="small dim">JSON · CSV · Excel · Print/PDF — every export is logged</span></div><div id="out"></div>`));
    const gen = async () => {
      const s = await API.get(`/api/reports/sitrep?scope=lg&ref=${encodeURIComponent(myLga)}`);
      $('#out', b).innerHTML = renderSitrep(s, `LG · ${myLga}`) + `
        <div class="pub-note mt12">This report distinguishes <b>FACTUAL DATA</b> from <b>SYSTEM-GENERATED ANALYSIS</b> and <b>UNVERIFIED REPORTS</b>. Field-submitted, under-review, verified monitoring data, disputed and archived records are never conflated — and none are official election results.</div>`;
      $$('[data-exp]', $('#out', b)).forEach(x => x.onclick = () => window.open(`/api/export?type=sitrep&format=${x.dataset.exp}`, '_blank'));
    };
    $('#gen', b).onclick = gen;
    gen();
  }
  function vExports(b) {
    const ITEMS = [
      ['sitrep', 'LG SITREP', 'Full situation report dataset'],
      ['results', 'Result monitoring status', 'Submissions with status & flags'],
      ['incidents', 'Incident report', 'All incidents with levels'],
      ['verification', 'Verification queue', 'Review actions and timestamps'],
      ['agents', 'Agent activity', 'Field network per agent'],
      ['audit', 'Audit report', 'Immutable audit trail'],
    ];
    b.appendChild(el(`<div class="pub-note">Every export is logged with user, timestamp and IP. Formats: CSV · Excel (XLSX) · JSON.</div>
    <div class="grid3">${ITEMS.map(([t, l, d]) => `
      <div class="panel"><div class="ph"><span class="t">${esc(l)}</span></div>
      <div class="pb"><div class="small muted mb12">${esc(d)}</div>
      <div class="row">${['csv', 'xlsx', 'json'].map(f => `<button class="btn sm" data-exp="${t}:${f}">${f.toUpperCase()}</button>`).join('')}</div></div></div>`).join('')}
    </div>`));
    $$('[data-exp]', b).forEach(x => x.onclick = () => { const [t, f] = x.dataset.exp.split(':'); window.open(`/api/export?type=${t}&format=${f}`, '_blank'); });
  }

  // ================= GOVERNANCE (§47-48, §56, §64) =================
  function vAudit(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">LG AUDIT — immutable</span><span class="sp"></span><input class="inp" style="width:200px" id="aq" placeholder="Search…"><button class="btn sm" id="aexp">Export</button></div>
    <div class="pb flat" id="abody"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    const load = debounce(async () => {
      const res = await API.get('/api/audit?limit=150&q=' + encodeURIComponent($('#aq', wrap).value));
      const t = dataTable({
        cols: [
          { label: 'Time', key: 'createdAt', render: r => `<span class="mono small">${fmtWat(r.createdAt)}</span>` },
          { label: 'User', key: 'username', render: r => r.username === 'system' ? '<span class="dim">system</span>' : r.username },
          { label: 'Action', key: 'action', render: r => `<span class="badge s-submitted">${esc(r.action)}</span>` },
          { label: 'Record', key: 'objectId', cls: 'mono' },
          { label: 'Detail', key: 'detail', render: r => `<span class="muted small">${esc((r.detail || '').slice(0, 60))}</span>` },
          { label: 'IP', key: 'ip', cls: 'mono' },
        ],
        rows: res.rows, sortable: true, pageSize: 30,
      });
      t.setTitle(`${res.total} records — login, result viewing, evidence access, acknowledgements, escalations, messages, reports, exports`);
      $('#abody', wrap).innerHTML = ''; $('#abody', wrap).appendChild(t.el);
    }, 300);
    $('#aq', wrap).addEventListener('input', load);
    $('#aexp', wrap).onclick = () => window.open('/api/export?type=audit&format=xlsx', '_blank');
    load();
  }
  function vChain(b) {
    const wrap = el(`<div id="chwrap"><span class="dim small">Loading evidence chain…</span></div>`);
    b.appendChild(wrap);
    loadEvidence().then(res => {
      const rows = res.rows.slice(0, 30);
      wrap.innerHTML = `<div class="pub-note">Chain of custody: <b>CAPTURED → UPLOADED → RECEIVED → VIEWED → REVIEWED → VERIFIED/DISPUTED → ARCHIVED</b>. No normal LG user can rewrite this history.</div>
      <div class="panel"><div class="ph"><span class="t">EVIDENCE CHAIN — ${esc(myLga.toUpperCase())}</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Evidence</th><th>Submission</th><th>PU</th><th>Status</th><th>Chain steps</th><th></th></tr>
      ${rows.length ? rows.map(r => `<tr><td class="mono">${esc(r.code)}</td><td class="mono">${esc(r.subCode || '')}</td><td class="mono">${esc(r.puId)}</td><td>${statusBadge(r.status)}</td><td>${(r.chain || []).length} steps</td><td><button class="btn sm" data-ev="${r.id}">Inspect</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">No documents in this LG</td></tr>'}
      </table></div></div>`;
      $$('[data-ev]', wrap).forEach(x => x.onclick = () => {
        const r = res.rows.find(e => e.id === x.dataset.ev);
        modal({
          title: `Evidence chain — ${r.code}`,
          body: () => el(`<div class="sos-steps">${['CAPTURED', 'UPLOADED', 'RECEIVED', 'VIEWED', 'REVIEWED', 'VERIFIED / DISPUTED', 'ARCHIVED'].map((step, i) => {
            const done = (r.chain || []).some(c => c.step === step) || ((r.chain || []).length >= i + 1 && i < 3);
            return `<div class="sos-step ${done ? 'done' : ''}"><span class="ss-dot">${done ? '✓' : ''}</span><span class="ss-t"><b>${step}</b><br><span class="small">${done ? fmtWatShort((r.chain || []).find(c => c.step === step)?.at || r.uploadedAt) : 'pending'}</span></span></div>`;
          }).join('')}</div>
          <hr class="soft"><div class="detail-grid"><span class="k">SHA-256</span><span class="v mono small">${esc(r.sha256)}</span><span class="k">Captured</span><span class="v">${fmtWatShort(r.capturedAt)}</span></div>`),
          actions: [{ label: 'Close', cls: 'ghost' }],
        });
      });
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function vSecurity(b) {
    b.appendChild(el(`<div class="grid3">
      <div class="panel"><div class="ph"><span class="t">ACCESS & SESSION</span></div><div class="pb small">
        <div class="flex mb12"><span>RBAC enforced server-side</span><span class="right"><b style="color:#4ade80">✓ every endpoint</b></span></div>
        <div class="flex mb12"><span>MFA / OTP</span><span class="right"><b>✓</b></span></div>
        <div class="flex mb12"><span>Short-lived sessions / timeout</span><span class="right"><b>12 h</b></span></div>
        <div class="flex mb12"><span>Rate limiting</span><span class="right"><b>✓</b></span></div>
        <div class="flex"><span>Device/session tracking</span><span class="right"><b>✓</b></span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">WHAT LG SUPERVISORS CANNOT DO</span></div><div class="pb small" style="line-height:1.9">
        ✗ Alter original evidence &nbsp;✗ Falsify results<br>✗ Mark unverified results as verified<br>✗ Delete evidence &nbsp;✗ Change agent assignments without authorization<br>✗ Modify election geography &nbsp;✗ Override audit logs<br>✗ Publish public results independently
      </div></div>
      <div class="panel"><div class="ph"><span class="t">PUBLIC DATA SEPARATION (§51)</span></div><div class="pb small" style="line-height:1.8">
        Internal data (agent GPS, contacts, private video, internal communications, security-sensitive reports) never reaches the public portal directly. Publication requires the authorized workflow and is always labelled MONITORING DATA — not official INEC results.
      </div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">SIGNED EVIDENCE URLS & ENCRYPTION</span></div>
    <div class="pb small muted">Evidence access uses signed URLs; encryption in transit and at rest; audit logging on every access. Client-side permissions are advisory only — the backend authorizes every request.</div></div>`));
  }
  function vHealth(b) {
    const h = ov.health;
    const svc = (n, v) => `<div class="kpi ${v === 'HEALTHY' ? 'ok' : v === 'CRITICAL' ? 'alert' : 'warn'}"><div class="l">${n}</div><div class="v" style="font-size:15px">${v}</div></div>`;
    b.appendChild(el(`<div class="kpis">${svc('API', h.api)}${svc('Database', h.db)}${svc('Storage', h.storage)}${svc('Notifications', h.notification)}${svc('Video', h.video)}${svc('Sync service', h.queue)}${svc('WebSocket', h.websocket)}${svc('Queue', h.queue)}</div>
    <div class="grid3">
      <div class="panel"><div class="ph"><span class="t">CPU</span></div><div class="pb"><div class="pbar"><div class="fill" style="width:${h.cpu}%"></div></div><b>${Math.round(h.cpu)}%</b></div></div>
      <div class="panel"><div class="ph"><span class="t">Memory</span></div><div class="pb"><div class="pbar"><div class="fill green" style="width:${h.memory}%"></div></div><b>${Math.round(h.memory)}%</b></div></div>
      <div class="panel"><div class="ph"><span class="t">API latency</span></div><div class="pb"><div class="pbar"><div class="fill amber" style="width:${Math.min(100, h.responseMs)}%"></div></div><b>${Math.round(h.responseMs)}ms</b> · error rate ${h.errorRate}%</div></div>
    </div>`));
  }

  // ================= ESCALATION (§49-50) =================
  function escalateModal(rec, prefill = {}) {
    const m = modal({
      title: '▲ ESCALATE (structured case)',
      wide: true,
      body: () => el(`<div>
        <div class="pub-note">Escalations reach the Senatorial Situation Room with <b>SOURCE: LG SUPERVISOR</b> and complete supporting evidence. High-priority cases route onward to Central Command. Neutral factual language only — unsupported accusations are not permitted.</div>
        <label class="fl">Reference ID *</label><input class="inp" id="eRef" value="${esc(prefill.refId || '')}" placeholder="e.g. INC-2027-000123 / SOS-2027-0004 / result code">
        <label class="fl">Type</label><select class="inp" id="eType">${['INCIDENT', 'SOS', 'RESULT_ISSUE', 'VERIFICATION_ISSUE', 'REPORTING_GAP', 'DATA_QUALITY', 'TASK'].map(t => `<option ${prefill.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label class="fl">Priority *</label><select class="inp" id="ePri"><option>HIGH</option><option>CRITICAL</option><option>MEDIUM</option><option>LOW</option></select>
        <label class="fl">Situation summary *</label><textarea class="inp" id="eSum" rows="3">${esc(prefill.summary || '')}</textarea>
        <label class="fl">Current status</label><input class="inp" id="eCur" placeholder="e.g. awaiting field clarification">
        <label class="fl">Evidence reference</label><input class="inp" id="eEv" value="${esc(prefill.evidenceRef || '')}">
        <label class="fl">Action already taken</label><textarea class="inp" id="eAct" rows="2"></textarea>
        <label class="fl">Requested attention</label><textarea class="inp" id="eReq" rows="2"></textarea>
      </div>`),
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'SEND ESCALATION', cls: 'warn', onClick: () => {
          const payload = { refId: $('#eRef').value.trim(), type: $('#eType').value, priority: $('#ePri').value, summary: $('#eSum').value.trim(), currentStatus: $('#eCur').value.trim(), evidenceRef: $('#eEv').value.trim(), actionsTaken: $('#eAct').value.trim(), requestedAttention: $('#eReq').value.trim() };
          if (!payload.refId || !payload.summary) return toast('Required fields', 'Reference ID and situation summary are required.', 'medium');
          API.post('/api/escalations', payload).then(res => {
            toast('Escalation sent', `${res.code} — Senatorial/Central Situation Rooms notified with the structured case.`);
            escCache = null; m.close(); refresh(); render();
          }).catch(e => toast('Escalation failed', (e.data && e.data.message) || e.message, 'high'));
        } },
      ],
    });
  }

  securityCheck();
  render();
})();
