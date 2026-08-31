// senatorial.js — EYES OF VICTORY — SENATORIAL COMMAND (v2, master-spec build)
// 28 views: Command (Dashboard/Live Map/Command Wall/Notifications/Tasks),
// Operations (LGAs/Wards/PUs/Agents/Connectivity), Results (Monitoring/Queue/Evidence/Disputes),
// Incidents (Command/Map/Escalations), SOS, Live Video, Analytics, Intelligence (Brief/Signals/Copilot),
// Reports (SITREP/Exports), Governance (Audit/Evidence Chain/Security/Health).
'use strict';
(async () => {
  const { user: me, b, o } = await bootPortal('Senatorial Command', 'Senatorial Director', { username: 'sencoord', password: 'SenCoord@123!' });
  const bootstrap = b; let ov = o;
  const canSwitch = !(me.scope && me.scope.senatorial);
  let district = (me.scope && me.scope.senatorial) || 'Kano North';
  let tab = 'dashboard';
  let lgaDrill = null;      // lgaId → LGA detail
  let wardDrill = null;     // wardId → ward/PU drill
  let wallGrid = 3;
  let evidenceCache = null, agentsCache = null, escCache = null, resultRowsCache = null;

  // ---------------- helpers ----------------
  const distLgas = () => ov.lgas.filter(l => l.senatorial === district);
  const dlIds = () => new Set(distLgas().map(l => l.lgaId));
  const sd = () => ov.senatorial.find(s => s.name === district);
  const distIncidents = () => ov.incidents.filter(i => i.senatorial === district);
  const distSos = () => ov.sos.filter(s => (s.senatorial === district) || (s.lga && distLgas().some(l => l.name === s.lga)));
  const distStreams = () => ov.streams.filter(s => distLgas().some(l => l.name === s.lga));
  const lgaOf = (id) => distLgas().find(l => l.lgaId === id);
  const totalPu = () => distLgas().reduce((a, l) => a + l.totalPu, 0);
  const totalSubmitted = () => distLgas().reduce((a, l) => a + l.submitted, 0);
  const totalVerified = () => distLgas().reduce((a, l) => a + l.verified, 0);
  const pctSafe = (a, b) => b === 0 ? 0 : Math.round((a / b) * 1000) / 10;

  async function loadAgents() {
    if (agentsCache) return agentsCache;
    const all = [];
    let offset = 0;
    while (true) {
      const res = await API.get(`/api/agents?senatorial=${encodeURIComponent(district)}&limit=300&offset=${offset}`);
      all.push(...res.rows);
      if (res.total <= offset + res.rows.length) break;
      offset += 300;
      if (offset > 5000) break;
    }
    agentsCache = { rows: all, at: Date.now() };
    return agentsCache;
  }
  async function loadEvidence() { if (!evidenceCache) evidenceCache = await API.get(`/api/senatorial/evidence?senatorial=${encodeURIComponent(district)}`); return evidenceCache; }
  async function loadEsc() { if (!escCache) escCache = await API.get(`/api/escalations?senatorial=${encodeURIComponent(district)}`); return escCache; }
  async function loadResults() {
    if (!resultRowsCache) {
      const res = await API.get(`/api/results?election=e-gov-2027&senatorial=${encodeURIComponent(district)}&limit=500`);
      resultRowsCache = res.rows;
    }
    return resultRowsCache;
  }

  // ---------------- operational health (§6) ----------------
  function healthBreakdown() {
    const lgs = distLgas();
    const pus = totalPu(), sub = totalSubmitted(), ver = totalVerified();
    const agents = lgs.reduce((a, l) => a + l.agents, 0);
    const online = lgs.reduce((a, l) => a + l.agentsOnline, 0);
    const incs = distIncidents();
    const resolved = incs.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status)).length;
    const anomalies = ov.anomalies.filter(a => distLgas().some(l => l.name === a.lga)).length;
    const comps = [
      { k: 'AGENT COVERAGE', v: pctSafe(agents, Math.max(1, pus / 2)), w: 0.15 },
      { k: 'REPORTING', v: pctSafe(sub, pus), w: 0.2 },
      { k: 'CONNECTIVITY', v: pctSafe(online, agents), w: 0.15 },
      { k: 'VERIFICATION', v: pctSafe(ver, Math.max(1, sub)), w: 0.25 },
      { k: 'INCIDENT RESPONSE', v: pctSafe(resolved, Math.max(1, incs.length)), w: 0.15 },
      { k: 'DATA QUALITY', v: 100 - Math.min(25, anomalies * 2.5), w: 0.1 },
    ];
    const score = Math.round(comps.reduce((a, c) => a + c.v * c.w, 0));
    return { score, comps, status: score >= 85 ? 'HEALTHY' : score >= 65 ? 'WATCH' : score >= 45 ? 'ATTENTION' : 'CRITICAL' };
  }

  // ---------------- intelligence signals (§36) ----------------
  function computeSignals() {
    const out = [];
    const lgs = distLgas();
    const pus = totalPu(), sub = totalSubmitted();
    // reporting gap
    const gapLgas = lgs.filter(l => l.reportingPct < 50);
    const gapPus = lgs.reduce((a, l) => a + (l.totalPu - l.submitted), 0);
    if (gapPus > 20) out.push({ id: 'gap', sev: gapPus > 100 ? 'CRITICAL' : 'HIGH', title: 'REPORTING GAP', note: `Reporting has stopped or not started for ${gapPus} polling units${gapLgas.length ? ` across ${gapLgas.length} LGA(s)` : ''}. The system does not infer why a report is missing.`, act: 'view-locations', actLabel: 'VIEW AFFECTED LOCATIONS' });
    // verification backlog
    const backlog = lgs.reduce((a, l) => a + l.pending, 0);
    if (backlog > 40) out.push({ id: 'backlog', sev: backlog > 120 ? 'HIGH' : 'MEDIUM', title: 'VERIFICATION BACKLOG', note: `${backlog} submissions remain under review across the district.`, act: 'view-queue', actLabel: 'OPEN VERIFICATION QUEUE' });
    // connectivity
    const agents = lgs.reduce((a, l) => a + l.agents, 0), online = lgs.reduce((a, l) => a + l.agentsOnline, 0);
    if (agents > 0 && pctSafe(online, agents) < 70) out.push({ id: 'conn', sev: 'HIGH', title: 'CONNECTIVITY DECLINE', note: `Agent connectivity is at ${pctSafe(online, agents)}% (${online}/${agents} online). ${lgs.filter(l => l.agents > 0 && pctSafe(l.agentsOnline, l.agents) < 60).map(l => l.name).slice(0, 3).join(', ') || ''}`, act: 'view-connectivity', actLabel: 'OPEN CONNECTIVITY MAP' });
    // incident cluster
    const recent = distIncidents().filter(i => ov.sim.now - i.createdAt < 90 * 60000);
    if (recent.length >= 4) out.push({ id: 'cluster', sev: 'MEDIUM', title: 'INCIDENT CLUSTER', note: `${recent.length} incidents were reported within the last 90 minutes — a defined time/location window. Review is recommended; no conclusion is drawn automatically.`, act: 'view-incidents', actLabel: 'OPEN INCIDENT COMMAND' });
    // data quality
    const anom = ov.anomalies.filter(a => distLgas().some(l => l.name === a.lga)).length;
    if (anom > 0) out.push({ id: 'quality', sev: 'MEDIUM', title: 'DATA-QUALITY REVIEW', note: `${anom} record(s) flagged by the validation engine with neutral "DATA ANOMALY DETECTED" flags. SIGNAL REQUIRES HUMAN REVIEW.`, act: 'view-queue', actLabel: 'REVIEW FLAGGED RECORDS' });
    // active SOS
    if (distSos().length) out.push({ id: 'sos', sev: 'CRITICAL', title: 'ACTIVE SOS', note: `${distSos().length} active emergency signal(s) in the district.`, act: 'view-sos', actLabel: 'OPEN SOS COMMAND' });
    return out.sort((a, b) => ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.sev) - ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.sev));
  }

  // ---------------- NAV (§60) ----------------
  const NAV = [
    { id: 'dashboard', label: 'Dashboard', ico: '◈', section: 'COMMAND' },
    { id: 'map', label: 'Live Map', ico: '◎' },
    { id: 'wall', label: 'Command Wall', ico: '▣' },
    { id: 'notifications', label: 'Notifications', ico: '🔔' },
    { id: 'tasks', label: 'Tasks', ico: '☑' },
    { id: 'lgas', label: 'LGAs', ico: '▦', section: 'OPERATIONS' },
    { id: 'wards', label: 'Wards', ico: '⬡' },
    { id: 'pus', label: 'Polling Units', ico: '📍' },
    { id: 'agents', label: 'Agents', ico: '👤' },
    { id: 'connectivity', label: 'Connectivity', ico: '📶' },
    { id: 'results', label: 'Result Monitoring', ico: '≡', section: 'RESULTS' },
    { id: 'queue', label: 'Verification Queue', ico: '✓' },
    { id: 'evidence', label: 'Evidence Centre', ico: '🗂', perm: 'evidence.view' },
    { id: 'disputes', label: 'Disputes', ico: '⚖' },
    { id: 'incidents', label: 'Incident Command', ico: '⚠', section: 'INCIDENTS' },
    { id: 'incmap', label: 'Incident Map', ico: '🗺' },
    { id: 'escalations', label: 'Escalations', ico: '▲', perm: 'escalations.view' },
    { id: 'sos', label: 'SOS Command', ico: '🚨', section: 'EMERGENCY' },
    { id: 'video', label: 'Video Wall', ico: '▣', section: 'LIVE' },
    { id: 'analytics', label: 'Analytics', ico: '∿', section: 'ANALYTICS' },
    { id: 'brief', label: 'Intelligence Brief', ico: '✧', section: 'INTELLIGENCE' },
    { id: 'signals', label: 'Signals', ico: '⚡' },
    { id: 'copilot', label: 'Copilot', ico: '🤖', perm: 'copilot.use' },
    { id: 'sitrep', label: 'SITREP Generator', ico: '▤', section: 'REPORTS' },
    { id: 'exports', label: 'Export Centre', ico: '⬇', perm: 'reports.export' },
    { id: 'audit', label: 'Audit Log', ico: '◉', perm: 'audit.view', section: 'GOVERNANCE' },
    { id: 'chain', label: 'Evidence Chain', ico: '⛓', perm: 'evidence.view' },
    { id: 'security', label: 'Security', ico: '🛡' },
    { id: 'health', label: 'System Health', ico: '⚙', perm: 'system.health' },
  ];
  const shell = initShell({ title: 'Senatorial', nav: NAV, active: tab, me, sim: ov.sim, portalTag: `${district.toUpperCase()} SENATORIAL COMMAND`, onNav: setTab });
  function setTab(id) { tab = id; lgaDrill = null; wardDrill = null; render(); }
  const liveRefresh = debounce(() => { refresh(); render(); }, 900);
  shell.onLive(liveRefresh);
  async function refresh() {
    try {
      ov = await API.get('/api/overview');
      evidenceCache = null; escCache = null; resultRowsCache = null;
      if (agentsCache && Date.now() - agentsCache.at > 30000) agentsCache = null;
    } catch (e) {}
  }

  function render() {
    shell.main.innerHTML = '';
    // district switcher (only for users without a scope binding, e.g. central visitors)
    const sw = el(`<div class="flex mb12">
      ${canSwitch ? ov.senatorial.map(s => `<button class="btn ${s.name === district ? 'primary' : ''}" data-d="${s.name}">${esc(s.name)}</button>`).join('') : `<span class="pill">ASSIGNED DISTRICT: <b>${esc(district).toUpperCase()}</b></span>`}
      <span class="flex1"></span>
      <span class="pill">${distLgas().length} LGAs · ${fmtN(totalPu())} PUs</span>
      ${API.can('senatorial.demo') ? `<button class="btn sm" id="demobtn">🎬 Demo controls</button>` : ''}
      ${district !== (me.scope && me.scope.senatorial) ? '' : ''}
    </div>`);
    shell.main.appendChild(sw);
    if (canSwitch) $$('[data-d]', sw).forEach(x => x.onclick = () => { district = x.dataset.d; agentsCache = null; evidenceCache = null; escCache = null; resultRowsCache = null; render(); });
    const db = $('#demobtn', sw);
    if (db) db.onclick = demoPanel;
    const V = { dashboard: vDashboard, map: vMap, wall: vWall, notifications: vNotifications, tasks: vTasks, lgas: vLgas, wards: vWards, pus: vPus, agents: vAgents, connectivity: vConnectivity, results: vResults, queue: vQueue, evidence: vEvidence, disputes: vDisputes, incidents: vIncidents, incmap: vIncmap, escalations: vEscalations, sos: vSos, video: vVideo, analytics: vAnalytics, brief: vBrief, signals: vSignals, copilot: vCopilot, sitrep: vSitrep, exports: vExports, audit: vAudit, chain: vChain, security: vSecurity, health: vHealth };
    (V[tab] || vDashboard)(shell.main);
  }

  // ================= DEMO CONTROLS (§63) =================
  function demoPanel() {
    const ACTIONS = [
      ['result', '📄 SIMULATE RESULT', 'A field agent submits a new EC8A result'],
      ['incident', '⚠️ SIMULATE INCIDENT', 'A new incident is reported in the district'],
      ['sos', '🚨 SIMULATE SOS', 'An emergency SOS triggers'],
      ['agent-offline', '📴 SIMULATE AGENT OFFLINE', 'A random online agent goes offline'],
      ['connectivity-loss', '📶 SIMULATE CONNECTIVITY LOSS', 'An LGA loses connectivity'],
      ['verify', '✓ SIMULATE RESULT VERIFICATION', 'A pending submission is verified'],
      ['dispute', '⚖ SIMULATE DOCUMENT DISPUTE', 'A pending submission is disputed'],
      ['reporting-gap', '📉 SIMULATE LGA REPORTING GAP', 'Agents in one LGA stop reporting'],
    ];
    const m = modal({
      title: '🎬 DEMO CONTROLS — Senatorial simulation',
      body: () => el(`<div>
        <div class="pub-note">Every simulated event propagates through the whole ecosystem: LG rooms, senatorial analytics, Central Situation Room, supervisory queue and (for verified results) the public portal. <b>DEMO DATA — NOT OFFICIAL ELECTION RESULTS.</b></div>
        <div class="agent-grid">${ACTIONS.map(([a, l, d]) => `<div class="agent-btn" data-a="${a}"><span class="big">${l.split(' ')[0]}</span>${l.slice(l.indexOf(' ') + 1)}<span class="small dim" style="font-weight:400">${d}</span></div>`).join('')}</div>
        <div id="demores" class="small muted mt12"></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $$('[data-a]', m.body).forEach(btn => btn.onclick = async () => {
      btn.style.opacity = '.5';
      try {
        const res = await API.post('/api/senatorial/demo/simulate', { action: btn.dataset.a });
        $('#demores', m.body).textContent = '✓ ' + res.detail;
        toast('Simulated', res.detail);
        refresh(); render();
      } catch (e) { toast('Simulation failed', (e.data && e.data.message) || e.message, 'high'); }
      btn.style.opacity = '1';
    });
  }

  // ================= COMMAND: DASHBOARD (§5, §65) =================
  function vDashboard(b) {
    const h = healthBreakdown();
    const s = sd() || {};
    const lgs = distLgas();
    const agents = lgs.reduce((a, l) => a + l.agents, 0);
    const online = lgs.reduce((a, l) => a + l.agentsOnline, 0);
    const signals = computeSignals();
    const hot = signals.filter(x => ['CRITICAL', 'HIGH'].includes(x.sev));

    // KPIs
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Total LGAs', fmtN(lgs.length))}
      ${kpiCard('Total wards', fmtN(lgs.reduce((a, l) => a + l.wards, 0)))}
      ${kpiCard('Polling units', fmtN(totalPu()))}
      ${kpiCard('Agents', fmtN(agents), { sub: `${online} online · ${pctSafe(online, agents)}%`, cls: pctSafe(online, agents) < 70 ? 'warn' : 'ok' })}
      ${kpiCard('Reporting coverage', pctSafe(totalSubmitted(), totalPu()) + '%', { sub: `${fmtN(totalSubmitted())}/${fmtN(totalPu())} PUs`, cls: 'accent' })}
      ${kpiCard('Results received', pctSafe(totalSubmitted(), totalPu()) + '%', { sub: 'of expected submissions' })}
      ${kpiCard('Results verified', pctSafe(totalVerified(), totalPu()) + '%', { sub: `${fmtN(totalVerified())} PUs`, cls: 'ok' })}
    </div>`));

    // operational health hero
    const scoreColor = h.score >= 85 ? '#4ade80' : h.score >= 65 ? '#fbbf24' : h.score >= 45 ? '#fb923c' : '#f87171';
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">SENATORIAL OPERATIONAL HEALTH</span><span class="sub">configurable & explainable — operational completeness only, never a political measurement</span><span class="sp"></span>${statusBadge(h.status)}</div>
    <div class="pb"><div class="health-hero">
      <div class="health-score"><div class="hs-ring" style="color:${scoreColor}">${h.score}%</div><div class="hs-lbl">${h.status}</div></div>
      <div class="health-bars">${h.comps.map(c => `<div class="hb"><span class="k">${esc(c.k)}</span><div class="pbar flex1"><div class="fill ${c.v >= 80 ? 'green' : c.v >= 50 ? 'amber' : 'red'}" style="width:${Math.min(100, c.v)}%"></div></div><span class="v">${Math.round(c.v)}%</span></div>`).join('')}
      </div>
    </div></div></div>`));

    // critical alerts strip (§35)
    if (hot.length) {
      const strip = el(`<div class="alert-strip">${hot.map(x => `<div class="a ${x.sev === 'HIGH' ? 'amber' : ''}" data-sig="${x.id}">${x.sev === 'CRITICAL' ? '🚨' : '⚠'} ${esc(x.title)} — ${esc(x.note.slice(0, 60))}…</div>`).join('')}</div>`);
      $$('[data-sig]', strip).forEach(x => x.onclick = () => setTab('signals'));
      b.appendChild(strip);
    }

    const grid = el(`<div class="grid23">
      <div class="panel"><div class="ph"><span class="t">◎ ${esc(district.toUpperCase())} LIVE MAP</span><span class="sp"></span><button class="btn sm ghost" data-t="map">Full map →</button></div>
      <div class="pb flat" style="height:420px"><div id="dashmap" style="width:100%;height:100%"></div></div></div>
      <div>
        <div class="panel"><div class="ph"><span class="t">LIVE INCIDENT FEED</span><span class="sp"></span><button class="btn sm ghost" data-t="incidents">All →</button></div>
        <div class="pb flat"><div class="feed" id="incfeed" style="max-height:200px"></div></div></div>
        <div class="panel mt12"><div class="ph"><span class="t">ESCALATIONS TO CENTRAL</span><span class="sp"></span><button class="btn sm ghost" data-t="escalations">All →</button></div>
        <div class="pb flat" id="escf" style="max-height:150px;overflow:auto"></div></div>
      </div>
    </div>`);
    b.appendChild(grid);
    $('[data-t]', grid).onclick = () => setTab($('[data-t]', grid).dataset.t);

    // map
    const m = createMap($('#dashmap', grid), bootstrap, {});
    m.setData({ lgas: ov.lgas, incidents: distIncidents(), sos: distSos(), streams: distStreams(), agents: ov.agentsOnMap.filter(a => dlIds().has(a.lgaId)) });
    m.setLgaMetric(l => l.senatorial === district ? l.reportingPct : 0);
    m.onClick(({ type, id }) => {
      if (type === 'LGA') { const lg = lgaOf(id); if (lg) lgaPanel(lg); }
      else if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
      else if (type === 'SOS') { const x = distSos().find(s => s.id === id); if (x) sosModal(x, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
    });

    // feeds
    const incs = distIncidents();
    $('#incfeed', grid).innerHTML = incs.length ? incs.slice(0, 8).map(i => `<div class="item" data-inc="${i.id}"><span class="t">${fmtWatShort(i.createdAt)}</span><span class="tx">${sevBadge(i.severity)} <b>${esc(i.subcategory)}</b> — ${esc(i.lga)} · ${esc(i.puId || '')} ${statusBadge(i.status)}</span></div>`).join('') : '<div class="empty">No incidents</div>';
    $$('[data-inc]', $('#incfeed', grid)).forEach(x => x.onclick = () => incidentModal(ov.incidents.find(i => i.id === x.dataset.inc), { canManage: API.can('incidents.manage'), onChange: refresh }));

    loadEsc().then(res => {
      const box = $('#escf', grid);
      box.innerHTML = res.rows.length ? res.rows.slice(0, 5).map(e => `<div class="esc-card" data-esc="${e.id}"><div class="e-head"><b>${esc(e.code)}</b><span class="pill">${esc(e.type)}</span><span class="pill">${esc(e.priority)}</span><span class="right small dim">${fmtWatShort(e.createdAt)}</span></div><div class="e-body">${esc(e.summary.slice(0, 90))}${e.summary.length > 90 ? '…' : ''}</div></div>`).join('') : '<div class="empty small">Nothing escalated to Central.</div>';
      $$('[data-esc]', box).forEach(x => x.onclick = () => escalationModal(res.rows.find(e => e.id === x.dataset.esc)));
    }).catch(() => { $('#escf', grid).innerHTML = '<div class="empty small">—</div>'; });

    // LGA strip mini table
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">LGA OPERATIONS — QUICK STATUS</span><span class="sub">click an LGA for its command panel</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>LGA</th><th class="num">PUs</th><th>Reporting</th><th class="num">Verified</th><th class="num">Pending</th><th class="num">Incidents</th><th class="num">SOS</th><th class="num">Connectivity</th><th class="num">Health</th></tr>
    ${lgs.map(l => `<tr class="clickable" data-lg="${l.lgaId}"><td><b>${esc(l.name)}</b></td><td class="num">${l.totalPu}</td><td><div class="pbar" style="width:70px"><div class="fill" style="width:${l.reportingPct}%"></div></div> ${l.reportingPct}%</td><td class="num">${l.verified}</td><td class="num" style="color:${l.pending ? '#fbbf24' : ''}">${l.pending}</td><td class="num" style="color:${l.incidents ? '#fbbf24' : ''}">${l.incidents}</td><td class="num" style="color:${l.sos ? '#f87171' : ''}">${l.sos}</td><td class="num">${pctSafe(l.agentsOnline, l.agents)}%</td><td class="num"><b style="color:${l.healthScore > 70 ? '#4ade80' : l.healthScore > 40 ? '#fbbf24' : '#f87171'}">${l.healthScore}</b></td></tr>`).join('')}
    </table></div></div>`));
    $$('[data-lg]', b).forEach(x => x.onclick = () => { const lg = lgaOf(x.dataset.lg); if (lg) lgaPanel(lg); });
  }

  // ---------------- LGA command panel (§9) ----------------
  function lgaPanel(lg) {
    const m = modal({
      title: `LGA COMMAND PANEL — ${lg.name}`,
      wide: true,
      body: () => el(`<div>
        <div class="kpis" style="grid-template-columns:repeat(6,1fr)">
          ${kpiCard('Reporting', lg.reportingPct + '%', { sub: `${lg.submitted}/${lg.totalPu} PUs` })}
          ${kpiCard('Results', pctSafe(lg.submitted, lg.totalPu) + '%', { sub: 'submission rate' })}
          ${kpiCard('Verified', lg.verifiedPct + '%', { sub: `${lg.verified} PUs`, cls: 'ok' })}
          ${kpiCard('Incidents', fmtN(lg.incidents), { sub: 'active', cls: lg.incidents ? 'alert' : '' })}
          ${kpiCard('SOS', fmtN(lg.sos), { sub: 'active', cls: lg.sos ? 'alert' : '' })}
          ${kpiCard('Connectivity', pctSafe(lg.agentsOnline, lg.agents) + '%', { sub: `${lg.agentsOnline}/${lg.agents} online` })}
        </div>
        <div class="detail-grid">
          <span class="k">Agent coverage</span><span class="v">${lg.agents} of ${lg.totalPu} PUs</span>
          <span class="k">Verification backlog</span><span class="v">${lg.pending} pending</span>
          <span class="k">Last update</span><span class="v">${fmtWatShort(ov.sim.now)}</span>
          <span class="k">Anomalies</span><span class="v">${lg.anomalies || 0}</span>
        </div>
        <div class="row mt12">
          <button class="btn primary" id="opendrill">OPEN LGA COMMAND</button>
          <button class="btn" id="openlgroom">Open LG portal ↗</button>
        </div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $('#opendrill', m.body).onclick = () => { m.close(); lgaDrill = lg.lgaId; setTab('lgas'); };
    $('#openlgroom', m.body).onclick = () => { location.href = '/lg'; };
  }

  // ================= COMMAND: LIVE MAP (§7-9) =================
  function vMap(b) {
    const wrap = el(`<div>
      <div class="flex mb12">
        <select class="inp" style="width:200px" id="metric">
          <option value="reportingPct">Reporting density</option>
          <option value="verifiedPct">Verification density</option>
          <option value="incidents">Open incidents</option>
          <option value="agentsOnline">Agents online</option>
          <option value="healthScore">Ward health score</option>
        </select>
        <span class="flex1"></span><button class="btn" id="resetmap">⌂ Reset view</button>
      </div>
      <div class="map-wrap" style="height:calc(100vh - 190px)"><div id="bigmap" style="width:100%;height:100%"></div></div>
    </div>`);
    b.appendChild(wrap);
    const m = createMap($('#bigmap', wrap), bootstrap, {});
    const apply = () => {
      m.setData({ lgas: ov.lgas, incidents: distIncidents(), sos: distSos(), streams: distStreams(), agents: ov.agentsOnMap.filter(a => dlIds().has(a.lgaId)) });
      m.setLgaMetric(l => l.senatorial === district ? l[$('#metric', wrap).value] : 0);
    };
    $('#metric', wrap).onchange = apply;
    $('#resetmap', wrap).onclick = () => m.reset();
    m.onClick(({ type, id }) => {
      if (type === 'LGA') { const lg = lgaOf(id); if (lg) lgaPanel(lg); }
      else if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
      else if (type === 'SOS') { const x = distSos().find(s => s.id === id); if (x) sosModal(x, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
    });
    apply();
  }

  // ================= COMMAND: WALL MODE (§51) =================
  function vWall(b) {
    const h = healthBreakdown();
    const lgs = distLgas();
    const agents = lgs.reduce((a, l) => a + l.agents, 0);
    const online = lgs.reduce((a, l) => a + l.agentsOnline, 0);
    const wm = el(`<div class="wall-mode">
      <div class="wm-head">
        <img src="/assets/media/logo.png" style="height:44px;object-fit:contain" onerror="this.style.display='none'">
        <div><div style="color:#fff;font-size:19px;font-weight:800;letter-spacing:2px">EYES OF VICTORY — SENATORIAL COMMAND</div>
        <div class="wm-sub">${esc(district.toUpperCase())} · KANO STATE · ELECTION DAY</div></div>
        <span class="flex1"></span>
        <div class="wm-clock" id="wmclock">${watClock(ov.sim.now)}</div>
        <button class="btn" id="wmexit">✕ Exit wall</button>
      </div>
      <div class="wm-kpis">
        ${[['DISTRICT HEALTH', h.score + '%', h.score >= 85 ? '#4ade80' : h.score >= 65 ? '#fbbf24' : '#f87171'], ['REPORTING', pctSafe(totalSubmitted(), totalPu()) + '%', '#38bdf8'], ['RESULTS VERIFIED', pctSafe(totalVerified(), totalPu()) + '%', '#4ade80'], ['AGENTS ONLINE', pctSafe(online, agents) + '%', online / Math.max(1, agents) < 0.7 ? '#fbbf24' : '#4ade80'], ['ACTIVE INCIDENTS', fmtN(distIncidents().filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).length), '#fb923c'], ['ACTIVE SOS', fmtN(distSos().length), distSos().length ? '#f87171' : '#4ade80']].map(([l, v, c]) => `<div class="wm-kpi"><div class="l">${l}</div><div class="v" style="color:${c}">${v}</div></div>`).join('')}
      </div>
      <div class="wm-grid">
        <div class="wm-col">
          <div class="wm-panel"><div class="t">Live map</div><div class="wm-map"><div id="wm-map" style="width:100%;height:100%"></div></div></div>
        </div>
        <div class="wm-col">
          <div class="wm-panel" style="flex:1"><div class="t">LGA STATUS</div>
            <div class="wm-strip">${lgs.map(l => `<div class="s"><b>${esc(l.name)}</b>R ${l.reportingPct}% · V ${l.verifiedPct}% · I ${l.incidents} · S ${l.sos}</div>`).join('')}</div>
          </div>
          <div class="wm-panel"><div class="t">LIVE INCIDENTS</div><div style="overflow:auto">${distIncidents().slice(0, 6).map(i => `<div class="small mb12" style="color:var(--muted)">${sevBadge(i.severity)} <b style="color:#fff">${esc(i.subcategory)}</b> — ${esc(i.lga)} ${statusBadge(i.status)}</div>`).join('') || '<div class="small muted">None</div>'}</div></div>
          <div class="wm-panel"><div class="t">SYSTEM</div><div class="small muted">API ${ov.health.api} · DB ${ov.health.db} · WS ${ov.health.websocket} · CONNECTION LIVE</div></div>
        </div>
      </div>
    </div>`);
    document.body.appendChild(wm);
    const mm = createMap($('#wm-map', wm), bootstrap, {});
    mm.setData({ lgas: ov.lgas, incidents: distIncidents(), sos: distSos(), streams: distStreams(), agents: [] });
    mm.setLgaMetric(l => l.senatorial === district ? l.reportingPct : 0);
    $('#wmexit', wm).onclick = () => wm.remove();
    const clk = setInterval(() => { const c = $('#wmclock', wm); if (c) c.textContent = watClock(ov.sim.now + (Date.now() % 1000)); }, 1000);
    wm.addEventListener('click', (e) => { if (e.target === wm) { clearInterval(clk); wm.remove(); } });
  }

  // ================= COMMAND: NOTIFICATIONS / TASKS =================
  function vNotifications(b) {
    const n = ov.notifications ? [] : [];
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">NOTIFICATIONS</span></div><div class="pb flat" id="nbody"><span class="dim small">Loading…</span></div></div>`));
    API.get('/api/notifications').then(res => {
      $('#nbody', b).innerHTML = res.rows.length ? res.rows.map(x => `
        <div class="notif-item"><div class="n-t">${x.priority === 'CRITICAL' ? '🚨' : x.priority === 'HIGH' ? '⚠️' : '🔔'} <b>${esc(x.title)}</b><span class="n-p ${x.priority.toLowerCase()}">${esc(x.priority)}</span></div>
        <div class="small mt8">${esc(x.body)}<br>${fmtWatShort(x.createdAt)}</div></div>`).join('') : '<div class="empty">No notifications</div>';
    }).catch(() => { $('#nbody', b).innerHTML = '<div class="empty">—</div>'; });
  }
  function vTasks(b) {
    const signals = computeSignals();
    const t = el(`<div class="panel"><div class="ph"><span class="t">PRIORITY ACTIONS & FOLLOW-UPS</span><span class="sub">derived from operational signals — every action is logged</span></div>
    <div class="pb">${signals.length ? signals.map(s => `
      <div class="signal-card ${s.sev.toLowerCase()}"><div class="s-head">${s.sev === 'CRITICAL' ? '🚨' : s.sev === 'HIGH' ? '⚠' : s.sev === 'MEDIUM' ? '▲' : 'i'} <b>${esc(s.title)}</b><span class="pill">${esc(s.sev)}</span></div>
      <div class="s-note">${esc(s.note)}</div>
      <div class="s-actions">
        <button class="btn sm" data-go="${s.act}">${esc(s.actLabel || 'VIEW')}</button>
        <button class="btn sm" data-follow="${esc(s.title)}">+ CREATE FOLLOW-UP TASK</button>
      </div></div>`).join('') : '<div class="empty">No outstanding tasks — district operations are nominal.</div>'}</div></div>`);
    b.appendChild(t);
    $$('[data-go]', t).forEach(x => x.onclick = () => {
      const go = { 'view-locations': 'wards', 'view-queue': 'queue', 'view-connectivity': 'connectivity', 'view-incidents': 'incidents', 'view-sos': 'sos' }[x.dataset.go];
      if (go) setTab(go);
    });
    $$('[data-follow]', t).forEach(x => x.onclick = () => escalateModal(null, { type: 'TASK', refId: 'TASK-' + Date.now().toString(36).toUpperCase(), summary: 'Follow-up task: ' + x.dataset.follow }));
  }

  // ================= OPERATIONS: LGAs (§10) =================
  function vLgas(b) {
    if (lgaDrill) return vLgaDetail(b);
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">LGA OPERATIONS — COMPARISON</span><span class="sub">operational prioritization, never political ranking · click any LGA to drill</span></div>
    <div class="pb flat" id="lgabody"></div></div>`);
    b.appendChild(wrap);
    const t = dataTable({
      cols: [
        { label: 'LGA', key: 'name', render: r => `<b>${esc(r.name)}</b>` },
        { label: 'Agents', key: 'agents', cls: 'num' },
        { label: 'Reporting', key: 'reportingPct', cls: 'num', render: r => `<div class="pbar" style="width:80px"><div class="fill ${r.reportingPct < 50 ? 'red' : ''}" style="width:${r.reportingPct}%"></div></div> ${r.reportingPct}%` },
        { label: 'Results', key: 'submitted', cls: 'num', render: r => `${r.submitted}/${r.totalPu}` },
        { label: 'Verified', key: 'verified', cls: 'num', render: r => `${r.verified} (${r.verifiedPct}%)` },
        { label: 'Incidents', key: 'incidents', cls: 'num', render: r => r.incidents ? `<span style="color:#fbbf24">${r.incidents}</span>` : '0' },
        { label: 'SOS', key: 'sos', cls: 'num', render: r => r.sos ? `<span style="color:#f87171">🚨 ${r.sos}</span>` : '—' },
        { label: 'Connectivity', key: 'agentsOnline', cls: 'num', render: r => `${pctSafe(r.agentsOnline, r.agents)}% (${r.agentsOnline}/${r.agents})` },
        { label: 'Backlog', key: 'pending', cls: 'num', render: r => r.pending ? `<span style="color:#fbbf24">${r.pending}</span>` : '0' },
        { label: 'Health', key: 'healthScore', cls: 'num', render: r => `<b style="color:${r.healthScore > 70 ? '#4ade80' : r.healthScore > 40 ? '#fbbf24' : '#f87171'}">${r.healthScore}</b>` },
        { label: '', key: 'lgaId', render: r => '<span class="dim small">drill →</span>' },
      ],
      rows: distLgas(), sortable: true, pageSize: 25,
      onRow: (r) => { lgaDrill = r.lgaId; render(); },
    });
    t.setTitle(`${distLgas().length} LGAs · sort by reporting gap, backlog, incidents, connectivity — operational prioritization`);
    $('#lgabody', wrap).appendChild(t.el);
  }
  function vLgaDetail(b) {
    const lg = lgaOf(lgaDrill);
    if (!lg) { lgaDrill = null; return vLgas(b); }
    const wards = ov.wardHealth.filter(w => w.lgaId === lgaDrill);
    const agentsIn = (agentsCache || { rows: [] }).rows.filter(a => a.lgaId === lgaDrill);
    const incs = distIncidents().filter(i => i.lgaId === lgaDrill);
    b.appendChild(el(`<div class="flex mb12"><button class="btn" id="lgback">← All LGAs</button><b style="color:#fff">${esc(lg.name)} LGA</b><span class="pill">${esc(lg.senatorial)}</span><span class="pill">${lg.totalPu} PUs · ${wards.length} wards</span><span class="flex1"></span><button class="btn primary" id="lgpanel">LGA Command Panel</button></div>
    <div class="kpis">
      ${kpiCard('Reporting', lg.reportingPct + '%', { sub: `${lg.submitted}/${lg.totalPu} PUs`, cls: 'accent' })}
      ${kpiCard('Verified', lg.verifiedPct + '%', { cls: 'ok' })}
      ${kpiCard('Agents online', `${lg.agentsOnline}/${lg.agents}`, { cls: pctSafe(lg.agentsOnline, lg.agents) < 70 ? 'warn' : 'ok' })}
      ${kpiCard('Active incidents', fmtN(lg.incidents), { cls: lg.incidents ? 'alert' : '' })}
      ${kpiCard('Pending review', fmtN(lg.pending), { cls: lg.pending ? 'warn' : '' })}
      ${kpiCard('Ward health avg', fmtN(wards.length ? Math.round(wards.reduce((a, w) => a + w.score, 0) / wards.length) : 0), { sub: 'operational' })}
    </div>
    <div class="grid2">
      <div class="panel"><div class="ph"><span class="t">WARDS</span><span class="sub">click a ward to drill to polling units</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Ward</th><th class="num">PUs</th><th>Reporting</th><th class="num">Agents</th><th class="num">Incidents</th><th class="num">Health</th></tr>
      ${wards.map(w => `<tr class="clickable" data-w="${w.id}"><td>${esc(w.name)}</td><td class="num">${w.pus}</td><td><div class="pbar" style="width:70px"><div class="fill" style="width:${w.reportingPct}%"></div></div> ${w.reportingPct}%</td><td class="num">${w.online}/${w.agents}</td><td class="num">${w.incidents}</td><td class="num"><b style="color:${w.score > 70 ? '#4ade80' : w.score > 40 ? '#fbbf24' : '#f87171'}">${w.score}</b></td></tr>`).join('')}
      </table></div></div>
      <div class="panel"><div class="ph"><span class="t">ACTIVE INCIDENTS — ${esc(lg.name.toUpperCase())}</span></div>
      <div class="pb">${incs.length ? incs.map(i => `<div class="flex mb12" style="cursor:pointer" data-inc="${i.id}">${sevBadge(i.severity)} <span>${esc(i.subcategory)} @ ${esc(i.puId || '')} ${statusBadge(i.status)}</span></div>`).join('') : '<div class="empty">None</div>'}</div></div>
    </div>`));
    $('#lgback', b).onclick = () => { lgaDrill = null; render(); };
    $('#lgpanel', b).onclick = () => lgaPanel(lg);
    $$('[data-w]', b).forEach(x => x.onclick = () => { wardDrill = x.dataset.w; tab = 'wards'; render(); });
    $$('[data-inc]', b).forEach(x => x.onclick = () => incidentModal(ov.incidents.find(i => i.id === x.dataset.inc), { canManage: API.can('incidents.manage'), onChange: refresh }));
  }

  // ================= OPERATIONS: WARDS (§11 reporting matrix, §32) =================
  function vWards(b) {
    if (wardDrill) return vWardDetail(b);
    const wards = ov.wardHealth.filter(w => dlIds().has(w.lgaId));
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">SENATORIAL REPORTING MATRIX</span><span class="sub">LGA → WARD → PU → AGENT → LATEST REPORT · click to drill</span><span class="sp"></span><input class="inp" style="width:180px" id="wq" placeholder="Search ward…"></div>
    <div class="pb flat" id="wbody"></div></div>`);
    b.appendChild(wrap);
    const draw = debounce(() => {
      const q = $('#wq', wrap).value.toLowerCase();
      const rows = wards.filter(w => !q || w.name.toLowerCase().includes(q) || (lgaOf(w.lgaId)?.name || '').toLowerCase().includes(q));
      const t = dataTable({
        cols: [
          { label: 'LGA', key: 'lgaId', render: r => esc(lgaOf(r.lgaId)?.name || '') },
          { label: 'Ward', key: 'name', render: r => `<b>${esc(r.name)}</b>` },
          { label: 'PUs', key: 'pus', cls: 'num' },
          { label: 'Expected reports', key: 'pus', cls: 'num' },
          { label: 'Received', key: 'submitted', cls: 'num' },
          { label: 'Coverage', key: 'reportingPct', cls: 'num', render: r => `<div class="pbar" style="width:80px"><div class="fill ${r.reportingPct < 50 ? 'red' : ''}" style="width:${r.reportingPct}%"></div></div> ${r.reportingPct}%` },
          { label: 'Agents', key: 'online', cls: 'num', render: r => `${r.online}/${r.agents}` },
          { label: 'Verified', key: 'verified', cls: 'num' },
          { label: 'Health', key: 'score', cls: 'num', render: r => `<b style="color:${r.score > 70 ? '#4ade80' : r.score > 40 ? '#fbbf24' : '#f87171'}">${r.score}</b>` },
        ],
        rows, sortable: true, pageSize: 25,
        onRow: (r) => { wardDrill = r.id; render(); },
      });
      t.setTitle(`${rows.length} wards · expected reports = polling units in ward`);
      $('#wbody', wrap).innerHTML = ''; $('#wbody', wrap).appendChild(t.el);
    }, 250);
    $('#wq', wrap).addEventListener('input', draw);
    draw();
    // gap summary banner (§12)
    const gaps = wards.filter(w => w.reportingPct < 60);
    if (gaps.length) {
      const gapPus = gaps.reduce((a, w) => a + (w.pus - w.submitted), 0);
      wrap.insertBefore(el(`<div class="alert-strip"><div class="a amber">⚠ ATTENTION — ${gapPus} polling units across ${gaps.length} ward(s) have not submitted a recent report. The system does not infer why a report is missing.</div></div>`), wrap.querySelector('.pb'));
    }
  }
  function vWardDetail(b) {
    const w = ov.wardHealth.find(x => x.id === wardDrill);
    const puList = bootstrap.pus.filter(p => p.wardId === wardDrill);
    if (!w) { wardDrill = null; return vWards(b); }
    b.appendChild(el(`<div class="flex mb12"><button class="btn" id="wback">← All wards</button><b style="color:#fff">${esc(w.name)}</b><span class="pill">${esc(lgaOf(w.lgaId)?.name || '')} LGA</span></div>
    <div class="panel"><div class="ph"><span class="t">POLLING UNITS — ${esc(w.name.toUpperCase())}</span><span class="sub">agent → latest report status</span></div>
    <div class="pb flat" id="pubody"><span class="dim small">Loading…</span></div></div>`));
    $('#wback', b).onclick = () => { wardDrill = null; render(); };
    loadAgents().then(async () => {
      const res = await loadResults();
      const subByPu = {};
      for (const r of res) subByPu[r.puId] = r;
      const rows = puList.map(p => {
        const agent = (agentsCache.rows || []).find(a => a.puId === p.id);
        const sub = subByPu[p.id];
        return { ...p, agent, sub };
      });
      const t = dataTable({
        cols: [
          { label: 'PU', key: 'code', cls: 'mono' },
          { label: 'Name', key: 'name' },
          { label: 'Agent', key: 'agent', render: r => r.agent ? `${esc(r.agent.name)} <span class="mono small dim">${esc(r.agent.code)}</span>` : '<span class="dim">VACANT</span>' },
          { label: 'Agent status', key: 'agent', render: r => r.agent ? statusBadge(r.agent.dutyState) : '—' },
          { label: 'Latest report', key: 'sub', render: r => r.sub ? `${statusBadge(r.sub.status)} ${fmtWatShort(r.sub.submittedAt)}` : '<span class="dim">NOT REPORTED</span>' },
          { label: '', key: 'id', render: r => r.sub ? `<button class="btn sm" data-open="${r.sub.id}">Open submission</button>` : '' },
        ],
        rows, sortable: true, pageSize: 25,
      });
      t.setTitle(`${rows.length} polling units in ${w.name}`);
      $('#pubody', b).innerHTML = ''; $('#pubody', b).appendChild(t.el);
      $$('[data-open]', b).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
    }).catch(() => { $('#pubody', b).innerHTML = '<div class="empty">Could not load.</div>'; });
  }

  // ================= OPERATIONS: PUs =================
  function vPus(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">POLLING UNITS — ${esc(district.toUpperCase())}</span><span class="sp"></span>
    <select class="inp" style="width:160px" id="plga"><option value="">All LGAs</option>${distLgas().map(l => `<option value="${l.lgaId}">${esc(l.name)}</option>`).join('')}</select>
    <input class="inp" style="width:170px" id="pq" placeholder="Search PU code / name…"></div>
    <div class="pb flat" id="pubody"></div></div>`);
    b.appendChild(wrap);
    const draw = debounce(async () => {
      const lga = $('#plga', wrap).value, q = $('#pq', wrap).value.toLowerCase();
      let rows = bootstrap.pus.filter(p => dlIds().has(p.lgaId));
      if (lga) rows = rows.filter(p => p.lgaId === lga);
      if (q) rows = rows.filter(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      const res = await loadResults();
      const subByPu = {};
      for (const r of res) subByPu[r.puId] = r;
      const t = dataTable({
        cols: [
          { label: 'Code', key: 'code', cls: 'mono' },
          { label: 'Name', key: 'name' },
          { label: 'Ward', key: 'wardId', render: r => esc(bootstrap.wards.find(w => w.id === r.wardId)?.name || '') },
          { label: 'LGA', key: 'lgaId', render: r => esc(bootstrap.lgas.find(l => l.id === r.lgaId)?.name || '') },
          { label: 'Status', key: 'code', render: r => subByPu[r.code] ? statusBadge(subByPu[r.code].status) : '<span class="badge s-archived">NOT REPORTED</span>' },
          { label: '', key: 'code', render: r => subByPu[r.code] ? `<button class="btn sm" data-open="${subByPu[r.code].id}">Open</button>` : '' },
        ],
        rows: rows.slice(0, 300), sortable: true, pageSize: 25,
      });
      t.setTitle(`${rows.length} polling units in ${district}`);
      $('#pubody', wrap).innerHTML = ''; $('#pubody', wrap).appendChild(t.el);
      $$('[data-open]', wrap).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
    }, 250);
    ['plga', 'pq'].forEach(id => $('#' + id, wrap).addEventListener('input', draw));
    draw();
  }

  // ================= OPERATIONS: AGENTS (§30-31) =================
  function vAgents(b) {
    const wrap = el(`<div id="agwrap"><span class="dim small">Loading field network…</span></div>`);
    b.appendChild(wrap);
    loadAgents().then(({ rows }) => {
      const online = rows.filter(a => a.online).length;
      const lowBat = rows.filter(a => a.battery < 25 && a.online).length;
      const syncing = queueish(rows).length;
      const done = rows.filter(a => a.dutyState === 'DUTY_COMPLETED').length;
      const sosA = distSos().length;
      wrap.innerHTML = `
      <div class="kpis">
        ${kpiCard('Total agents', fmtN(rows.length))}
        ${kpiCard('Online', fmtN(online), { sub: pctSafe(online, rows.length) + '%', cls: 'ok' })}
        ${kpiCard('Offline', fmtN(rows.length - online), { sub: 'no recent heartbeat', cls: rows.length - online > rows.length * 0.3 ? 'warn' : '' })}
        ${kpiCard('Low battery', fmtN(lowBat), { sub: '< 25%', cls: lowBat ? 'warn' : '' })}
        ${kpiCard('Duty completed', fmtN(done))}
        ${kpiCard('SOS active', fmtN(sosA), { cls: sosA ? 'alert' : '' })}
      </div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">AGENT CONNECTIVITY OVER TIME</span><span class="sub">duty check-ins per 30 min</span></div><div class="pb chart-box" id="connchart"><span class="dim small">Loading…</span></div></div>
        <div class="panel"><div class="ph"><span class="t">FIELD NETWORK</span><span class="sp"></span><input class="inp" style="width:170px" id="agq" placeholder="Search agent…"></div>
        <div class="pb flat" id="agbody"></div></div>
      </div>`;
      API.get('/api/analytics/timeseries?metric=checkins&bucket=30').then(cs => {
        const lbl = cs.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
        $('#connchart', wrap).innerHTML = lineChart({ series: [{ data: cs.series.map(p => p.count), color: '#a78bfa' }], labels: lbl, h: 190, color: '#a78bfa' });
      }).catch(() => {});
      const draw = debounce(() => {
        const q = $('#agq', wrap).value.toLowerCase();
        const list = rows.filter(a => !q || a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || a.puId.toLowerCase().includes(q));
        const t = dataTable({
          cols: [
            { label: 'Code', key: 'code', cls: 'mono' }, { label: 'Name', key: 'name' },
            { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'LGA', key: 'lga' },
            { label: 'Duty', key: 'dutyState', render: r => statusBadge(r.dutyState) },
            { label: 'Network', key: 'online', render: r => `<span class="st ${r.online ? 'ok' : 'bad'}">${r.online ? 'ONLINE' : 'OFFLINE'}</span>` },
            { label: 'Battery', key: 'battery', cls: 'num', render: r => `${r.battery}%` },
            { label: 'Last seen', key: 'lastHeartbeat', render: r => r.lastHeartbeat ? timeAgoWat(r.lastHeartbeat, ov.sim.now) : '—' },
            { label: '', key: 'id', render: r => `<button class="btn sm" data-ag="${r.id}">Profile</button>` },
          ],
          rows: list, sortable: true, pageSize: 20,
        });
        t.setTitle(`${list.length} agents · sensitive agent information remains restricted by role`);
        $('#agbody', wrap).innerHTML = ''; $('#agbody', wrap).appendChild(t.el);
        $$('[data-ag]', wrap).forEach(x => x.onclick = () => agentModal(rows.find(a => a.id === x.dataset.ag)));
      }, 250);
      $('#agq', wrap).addEventListener('input', draw);
      draw();
    }).catch(e => { wrap.innerHTML = `<div class="empty">Could not load agents: ${esc(e.message)}</div>`; });
  }
  function queueish(rows) { return rows.filter(a => a.online && a.lastHeartbeat && ov.sim.now - a.lastHeartbeat > 10 * 60000); }
  function agentModal(a) {
    const pu = bootstrap.pus.find(p => p.id === a.puId);
    modal({
      title: `${a.code} — ${a.name}`,
      wide: true,
      body: () => el(`<div>
        <div class="detail-grid">
          <span class="k">Agent ID</span><span class="v mono">${esc(a.id)}</span>
          <span class="k">Assignment</span><span class="v">${esc(a.puId)} — ${esc(pu?.name || '')}</span>
          <span class="k">LGA / Ward</span><span class="v">${esc(a.lga)} / ${esc(bootstrap.wards.find(w => w.id === a.wardId)?.name || '—')}</span>
          <span class="k">Senatorial</span><span class="v">${esc(a.senatorial)}</span>
          <span class="k">Duty status</span><span class="v">${statusBadge(a.dutyState)}</span>
          <span class="k">Network</span><span class="v">${a.online ? '<span class="st ok">ONLINE</span>' : '<span class="st bad">OFFLINE</span>'} · ${esc(a.network)}</span>
          <span class="k">Last heartbeat</span><span class="v">${a.lastHeartbeat ? fmtWatShort(a.lastHeartbeat) : '—'}</span>
          <span class="k">Battery</span><span class="v">${a.battery}%</span>
          <span class="k">Signal</span><span class="v">${esc(a.signal || 'NORMAL')}</span>
          <span class="k">App version</span><span class="v">${esc(a.appVersion || '1.4.0')}</span>
        </div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">OPERATIONAL TIMELINE</span></div><div class="pb" id="agtl"><span class="dim small">Loading…</span></div></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get(`/api/pus/${a.puId}/timeline`).then(res => {
      $('#agtl').innerHTML = res.rows.length ? res.rows.slice(0, 12).map(r => `<div class="small mb12"><b>${esc(r.label)}</b> <span class="dim">${fmtWatShort(r.t)}</span></div>`).join('') : '<div class="empty small">No events</div>';
    }).catch(() => { $('#agtl').innerHTML = '<div class="empty small">—</div>'; });
  }

  // ================= OPERATIONS: CONNECTIVITY (§30, §54) =================
  function vConnectivity(b) {
    const wrap = el(`<div>
      <div class="panel"><div class="ph"><span class="t">CONNECTIVITY HEATMAP — ${esc(district.toUpperCase())}</span><span class="sub">agent online share per LGA</span></div>
      <div class="pb flat" style="height:420px"><div id="connmap" style="width:100%;height:100%"></div></div></div>
      <div class="grid2 mt12">
        <div class="panel"><div class="ph"><span class="t">OFFLINE AGENTS</span><span class="sub">no recent heartbeat</span></div><div class="pb flat" id="offbody"><span class="dim small">Loading…</span></div></div>
        <div class="panel"><div class="ph"><span class="t">SYNCHRONIZATION HEALTH</span></div><div class="pb" id="synchealth"><span class="dim small">Loading…</span></div></div>
      </div>
    </div>`);
    b.appendChild(wrap);
    const m = createMap($('#connmap', wrap), bootstrap, {});
    m.setData({ lgas: ov.lgas });
    m.setLgaMetric(l => l.senatorial === district ? pctSafe(l.agentsOnline, l.agents) : 0);
    loadAgents().then(({ rows }) => {
      const offline = rows.filter(a => !a.online && !['NOT_ACTIVATED', 'DUTY_COMPLETED'].includes(a.dutyState));
      $('#offbody', wrap).innerHTML = offline.length ? `<table class="tbl"><tr><th>Agent</th><th>PU</th><th>LGA</th><th>Last seen</th></tr>${offline.slice(0, 20).map(a => `<tr><td>${esc(a.name)}</td><td class="mono">${esc(a.puId)}</td><td>${esc(a.lga)}</td><td>${a.lastHeartbeat ? timeAgoWat(a.lastHeartbeat, ov.sim.now) : '—'}</td></tr>`).join('')}</table>` : '<div class="empty">All agents online ✓</div>';
      const perLga = distLgas().map(l => ({ name: l.name, online: l.agentsOnline, total: l.agents, pct: pctSafe(l.agentsOnline, l.agents) }));
      $('#synchealth', wrap).innerHTML = perLga.map(l => `<div class="small flex mb12"><b style="width:120px">${esc(l.name)}</b><div class="pbar flex1"><div class="fill ${l.pct < 60 ? 'red' : l.pct < 85 ? 'amber' : 'green'}" style="width:${l.pct}%"></div></div><b>${l.pct}%</b></div>`).join('');
    }).catch(() => {});
  }

  // ================= RESULTS: MONITORING (§13-17) =================
  function vResults(b) {
    if (lgaDrill) return vLgaResults(b);
    const lgs = distLgas();
    const sub = totalSubmitted(), ver = totalVerified(), pus = totalPu();
    const rows = ov.queue.filter(q => distLgas().some(l => l.name === q.lga));
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Expected', fmtN(pus))}
      ${kpiCard('Received', fmtN(sub), { sub: pctSafe(sub, pus) + '%', cls: 'accent' })}
      ${kpiCard('Under review', fmtN(lgs.reduce((a, l) => a + l.pending, 0)), { cls: 'warn' })}
      ${kpiCard('Verified', fmtN(ver), { sub: pctSafe(ver, pus) + '%', cls: 'ok' })}
      ${kpiCard('Rejected', fmtN(ov.kpis.rejected))}
      ${kpiCard('Disputed', fmtN(ov.kpis.disputed), { cls: ov.kpis.disputed ? 'alert' : '' })}
    </div>
    <div class="grid23">
      <div class="panel"><div class="ph"><span class="t">RESULT SUBMISSION PROGRESS</span><span class="sub">30-min buckets · WAT</span></div><div class="pb chart-box" id="progchart"><span class="dim small">Loading…</span></div></div>
      <div class="panel"><div class="ph"><span class="t">LATEST ARRIVALS</span></div><div class="pb flat" style="max-height:300px;overflow:auto"><table class="tbl"><tr><th>PU</th><th>LGA</th><th>Status</th><th>Time</th></tr>
      ${rows.slice(0, 10).map(q => `<tr class="clickable" data-sub="${q.id}"><td class="mono">${esc(q.puId)}</td><td>${esc(q.lga)}</td><td>${statusBadge(q.status)}</td><td>${fmtWatShort(q.submittedAt)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Queue empty</td></tr>'}</table></div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">LGA RESULT MATRIX</span><span class="sub">every aggregate is clickable — drill to the underlying records</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>LGA</th><th class="num">Expected</th><th class="num">Submitted</th><th class="num">Under review</th><th class="num">Verified</th><th class="num">Disputed</th><th></th></tr>
    ${lgs.map(l => `<tr class="clickable" data-lg="${l.lgaId}"><td><b>${esc(l.name)}</b></td><td class="num">${l.totalPu}</td><td class="num">${l.submitted}</td><td class="num" style="color:${l.pending ? '#fbbf24' : ''}">${l.pending}</td><td class="num" style="color:#4ade80">${l.verified}</td><td class="num">—</td><td><span class="dim small">drill →</span></td></tr>`).join('')}
    </table></div></div>`));
    $$('[data-sub]', b).forEach(x => x.onclick = () => submissionModal(x.dataset.sub));
    $$('[data-lg]', b).forEach(x => x.onclick = () => { lgaDrill = x.dataset.lg; render(); });
    API.get('/api/analytics/timeseries?metric=submissions&bucket=30').then(s => {
      const lbl = s.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
      $('#progchart', b).innerHTML = lineChart({ series: [{ data: s.series.map(p => p.count) }], labels: lbl, h: 210 });
    }).catch(() => {});
  }
  async function vLgaResults(b) {
    if (!lgaDrill) return vResults(b);
    const lg = lgaOf(lgaDrill);
    if (!lg) { lgaDrill = null; return vResults(b); }
    b.innerHTML = `<div class="flex mb12"><button class="btn" id="rlback">← Result matrix</button><b style="color:#fff">${esc(lg.name)} LGA — results</b></div>
    <div class="panel"><div class="ph"><span class="t">SUBMISSIONS — ${esc(lg.name.toUpperCase())}</span></div><div class="pb flat" id="rbody"><span class="dim small">Loading…</span></div></div>`;
    $('#rlback', b).onclick = () => { lgaDrill = null; render(); };
    const res = await API.get(`/api/results?election=e-gov-2027&lga=${lgaDrill}&limit=150`);
    const t = dataTable({
      cols: [
        { label: 'Code', key: 'code', cls: 'mono' }, { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'Ward', key: 'ward' },
        { label: 'Valid', key: 'validVotes', cls: 'num' }, { label: 'Status', key: 'status', render: r => statusBadge(r.status) },
        { label: 'Flags', key: 'anomalies', render: r => r.anomalies?.length ? `<span class="badge l3">⚠ ${r.anomalies.length}</span>` : '—' },
        { label: '', key: 'id', render: r => `<button class="btn sm" data-open="${r.id}">Open</button>` },
      ],
      rows: res.rows, sortable: true, pageSize: 20,
    });
    t.setTitle(`${res.total} submissions`);
    $('#rbody', b).innerHTML = ''; $('#rbody', b).appendChild(t.el);
    $$('[data-open]', b).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
  }

  // ---------------- submission modal (§16 drill, §17 status model) ----------------
  function submissionModal(id) {
    const m = modal({
      title: 'Result submission record',
      wide: true,
      body: () => el(`<div id="sbox"><span class="dim small">Loading traceable record…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get('/api/results/' + id).then(sub => {
      const itemsById = Object.fromEntries(sub.items.map(i => [i.candidateId, i.votes]));
      const cands = sub.candidates || [];
      $('#sbox', m.body).innerHTML = `
        <div class="flex mb12"><span class="mono small dim">${esc(sub.code || id.slice(0, 8))}</span>${statusBadge(sub.status)}<span class="pill">${esc(sub.election?.name || '')}</span><span class="right small dim">${fmtWatShort(sub.submittedAt)}</span></div>
        <div class="detail-grid">
          <span class="k">Polling unit</span><span class="v">${esc(sub.puId)} — ${esc(sub.pu?.name || '')}</span>
          <span class="k">Ward / LGA</span><span class="v">${esc(sub.ward)} / ${esc(sub.lga)}</span>
          <span class="k">Senatorial</span><span class="v">${esc(sub.senatorial)}</span>
          <span class="k">Agent</span><span class="v">${esc(sub.agentId)}</span>
        </div>
        <table class="tbl mt12"><tr><th>Candidate</th><th class="num">Votes</th></tr>
        ${cands.map(c => `<tr><td class="small">${esc(c.name)} <span style="color:${c.color}">${esc(c.party)}</span></td><td class="num mono">${fmtN(itemsById[c.id] ?? 0)}</td></tr>`).join('')}
        <tr><td class="small muted">Valid / Rejected</td><td class="num mono">${fmtN(sub.validVotes)} / ${fmtN(sub.rejected)}</td></tr></table>
        ${(sub.anomalies || []).length ? `<div class="mt12">${sub.anomalies.map(a => `<span class="badge l3 mb12">⚠ ${esc(a.code)}</span>`).join(' ')}</div>` : ''}
        ${sub.review ? `<div class="small muted mt12">Review: <b>${esc(sub.review.action)}</b> by ${esc(sub.review.reviewerName || sub.review.reviewerId)}${sub.review.reason ? ' — “' + esc(sub.review.reason) + '”' : ''}${sub.review.secondAction ? ' · dual-control: ' + esc(sub.review.secondAction) : ''}</div>` : ''}
        <div class="small muted mt12">Chain of custody: ${(sub.custodies || []).map(c => c.step).join(' → ')}</div>
        ${(sub.evidence || []).length ? `<div class="row mt12">${sub.evidence.map(e => `<button class="btn sm" data-ev="${e.id}">🗂 View EC8A evidence (SHA-256 ${esc(e.sha256.slice(0, 10))}…)</button>`).join('')}</div>` : ''}
        <div class="row mt12">
          ${API.can('results.verify') ? `<button class="btn primary sm" data-vp="${id}">Open in Verification Portal</button>` : ''}
          ${API.can('escalations.create') ? `<button class="btn warn sm" data-esc="${id}">▲ Escalate issue</button>` : ''}
        </div>`;
      $$('[data-ev]', m.body).forEach(x => x.onclick = () => ec8aViewer(sub.evidence.find(e => e.id === x.dataset.ev), sub));
      const vp = $('[data-vp]', m.body);
      if (vp) vp.onclick = () => { location.href = '/supervisor?sub=' + id; };
      const es = $('[data-esc]', m.body);
      if (es) es.onclick = () => escalateModal(null, { type: 'RESULT_ISSUE', refId: sub.code || id.slice(0, 8), summary: `Result issue at ${sub.puId} (${sub.status})`, evidenceRef: sub.evidence?.[0]?.code || '' });
    }).catch(e => { $('#sbox', m.body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ================= RESULTS: QUEUE =================
  function vQueue(b) {
    const rows = ov.queue.filter(q => distLgas().some(l => l.name === q.lga));
    const anom = rows.filter(q => q.anomalies?.length);
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Awaiting review', fmtN(rows.length), { cls: 'warn' })}
      ${kpiCard('Anomaly-flagged', fmtN(anom.length), { sub: 'human review required', cls: anom.length ? 'alert' : '' })}
      ${kpiCard('Verification remains with supervisors', '—', { sub: 'this portal monitors, never bypasses controls' })}
    </div>
    <div class="pub-note">The senatorial portal monitors the verification pipeline. Approval and rejection actions remain exclusively with authorized supervisory agents (two-person verification for high-risk records).</div>
    <div class="panel"><div class="ph"><span class="t">VERIFICATION QUEUE — ${esc(district.toUpperCase())}</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Code</th><th>PU</th><th>LGA</th><th>Election</th><th>Age</th><th>Flags</th><th></th></tr>
    ${rows.length ? rows.map(q => `<tr><td class="mono">${esc(q.code || q.id.slice(0, 8))}</td><td class="mono">${esc(q.puId)}</td><td>${esc(q.lga)}</td><td>${esc(q.election)}</td><td>${timeAgoWat(q.submittedAt, ov.sim.now)}</td><td>${q.anomalies.length ? q.anomalies.map(a => `<span class="badge l3">${esc(a)}</span>`).join(' ') : '—'}</td><td><button class="btn sm" data-open="${q.id}">Open</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">Queue is clear</td></tr>'}
    </table></div></div>`));
    $$('[data-open]', b).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
  }

  // ================= RESULTS: EVIDENCE CENTRE (§18-20) =================
  function vEvidence(b) {
    const wrap = el(`<div id="evwrap"><span class="dim small">Loading evidence centre…</span></div>`);
    b.appendChild(wrap);
    loadEvidence().then(res => {
      const s = res.stats;
      wrap.innerHTML = `<div class="kpis">
        ${kpiCard('Documents received', fmtN(s.received))}
        ${kpiCard('Pending review', fmtN(s.pendingReview), { cls: s.pendingReview ? 'warn' : '' })}
        ${kpiCard('Low-quality documents', fmtN(s.lowQuality), { cls: s.lowQuality ? 'warn' : '' })}
        ${kpiCard('Under review', fmtN(s.underReview))}
        ${kpiCard('Verified documents', fmtN(s.verified), { cls: 'ok' })}
        ${kpiCard('Disputed documents', fmtN(s.disputed), { cls: s.disputed ? 'alert' : '' })}
      </div>
      <div class="pub-note">Data-quality signals (document quality, OCR confidence, mathematical reconciliation, duplicate signal, metadata) are <b>review signals — never automatic fraud determinations</b>. SIGNAL REQUIRES HUMAN REVIEW.</div>
      <div class="panel"><div class="ph"><span class="t">DOCUMENT & EVIDENCE CENTRE — ${esc(district.toUpperCase())}</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Evidence ID</th><th>Submission</th><th>PU</th><th>LGA</th><th>Agent</th><th>Doc quality</th><th>OCR</th><th>Math</th><th>Duplicate</th><th>Metadata</th><th>Status</th><th></th></tr>
      ${res.rows.length ? res.rows.map(r => `<tr>
        <td class="mono">${esc(r.code)}</td><td class="mono">${esc(r.subCode || r.submissionId.slice(0, 8))}</td>
        <td class="mono">${esc(r.puId)}</td><td>${esc(r.lga)}</td><td class="small">${esc(r.agent)}</td>
        <td>${r.signals.documentQuality === 'GOOD' ? '<span class="badge s-verified">GOOD</span>' : '<span class="badge l3">ATTENTION</span>'}</td>
        <td>${r.signals.ocrConfidence === 'HIGH' ? '<span class="badge s-verified">HIGH</span>' : r.signals.ocrConfidence === 'MEDIUM' ? '<span class="badge s-under">MED</span>' : '<span class="badge l4">LOW</span>'}</td>
        <td>${r.signals.mathReconciliation === 'PASSED' ? '<span class="badge s-verified">PASSED</span>' : '<span class="badge l4">REVIEW</span>'}</td>
        <td>${r.signals.duplicateSignal === 'CLEAR' ? 'CLEAR' : '<span class="badge l4">POSSIBLE DUP</span>'}</td>
        <td>${r.signals.metadata === 'COMPLETE' ? 'COMPLETE' : '<span class="badge l3">INCOMPLETE</span>'}</td>
        <td>${statusBadge(r.status)}</td>
        <td><button class="btn sm" data-ev="${r.id}">View EC8A</button></td>
      </tr>`).join('') : '<tr><td colspan="12" class="empty">No EC8A documents in this district yet</td></tr>'}
      </table></div></div>`;
      $$('[data-ev]', wrap).forEach(x => x.onclick = () => {
        const r = res.rows.find(e => e.id === x.dataset.ev);
        if (r) ec8aViewer(r, { code: r.subCode, status: r.status, puId: r.puId, ward: r.ward, lga: r.lga, senatorial: r.senatorial, submittedAt: r.uploadedAt });
      });
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ---------------- EC8A viewer (§19) ----------------
  function ec8aViewer(ev, sub) {
    let zoom = 1;
    const m = modal({
      title: `EC8A VIEWER — ${ev.code || 'EVIDENCE'}`,
      wide: true,
      body: () => el(`<div>
        <div class="grid2" style="align-items:start">
          <div class="panel" style="margin:0"><div class="ph"><span class="t">ORIGINAL DOCUMENT</span><span class="sub">immutable</span></div>
          <div class="pb" style="overflow:auto;max-height:520px"><div id="docimg"></div></div></div>
          <div class="panel" style="margin:0"><div class="ph"><span class="t">STRUCTURED DATA</span><span class="sp"></span>${statusBadge(sub?.status || '—')}</div>
          <div class="pb small" style="max-height:520px;overflow:auto" id="docdata"></div></div>
        </div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">METADATA & CHAIN OF CUSTODY</span></div>
        <div class="pb small" id="docmeta"></div></div>
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
    $('#docdata', m.body).innerHTML = `
      <div class="detail-grid">
        <span class="k">Submission</span><span class="v mono">${esc(ev.subCode || ev.submissionId || '—')}</span>
        <span class="k">Polling unit</span><span class="v">${esc(ev.puId || sub?.puId || '—')}</span>
        <span class="k">Ward / LGA</span><span class="v">${esc(ev.ward || '')} / ${esc(ev.lga || '')}</span>
        <span class="k">Agent</span><span class="v">${esc(ev.agent || '—')}</span>
        <span class="k">Timestamp</span><span class="v">${fmtWatShort(ev.capturedAt || ev.uploadedAt)}</span>
        <span class="k">Pages</span><span class="v">${ev.pages || 1}</span>
      </div>
      <hr class="soft"><b class="small">DATA-QUALITY SIGNALS</b>
      <div class="mt8">${ev.signals ? Object.entries(ev.signals).map(([k, v]) => `<div class="flex mb12"><span class="small muted" style="width:170px">${esc(k)}</span><span class="small">${esc(v)}</span></div>`).join('') : '<span class="dim small">—</span>'}</div>`;
    $('#docmeta', m.body).innerHTML = `
      <div class="detail-grid">
        <span class="k">Evidence ID</span><span class="v mono">${esc(ev.code || ev.id || '—')}</span>
        <span class="k">Source</span><span class="v">${esc(ev.agent || 'field agent')} · device-bound</span>
        <span class="k">Location</span><span class="v">${esc(ev.lga || '')} · ${esc(ev.puId || '')}</span>
        <span class="k">SHA-256</span><span class="v mono small">${esc(ev.sha256 || '—')}</span>
        <span class="k">Review status</span><span class="v">${statusBadge(ev.status || sub?.status || '—')}</span>
        <span class="k">Reviewer action</span><span class="v">${esc(ev.reviewAction || '—')}${ev.reviewReason ? ' — ' + esc(ev.reviewReason) : ''}</span>
      </div>
      <hr class="soft"><b class="small">CHAIN OF CUSTODY</b>
      <div class="mt8">${(ev.chain || []).map((c, i) => `<div class="flex mb12"><span class="pill">${i + 1}</span><b class="small">${esc(c.step)}</b><span class="small muted">${fmtWatShort(c.at)} · ${esc(c.by || '')}</span></div>`).join('') || '<span class="dim small">—</span>'}</div>
      <div class="small muted mt8">The original document is never modified. Processed previews are stored separately.</div>`;
  }

  // ================= RESULTS: DISPUTES (§56) =================
  function vDisputes(b) {
    const wrap = el(`<div id="diswrap"><span class="dim small">Loading disputed records…</span></div>`);
    b.appendChild(wrap);
    Promise.all([loadResults(), loadEvidence()]).then(([rows, ev]) => {
      const disputed = rows.filter(r => r.status === 'DISPUTED');
      wrap.innerHTML = `<div class="panel"><div class="ph"><span class="t">DISPUTED RECORDS — ${esc(district.toUpperCase())}</span><span class="sub">workflow: DISPUTED → REVIEW → REQUEST CLARIFICATION → ESCALATE → RESOLVE → ARCHIVE</span></div>
      <div class="pb flat">${disputed.length ? `<table class="tbl"><tr><th>Code</th><th>PU</th><th>LGA</th><th>Ward</th><th>Flags</th><th></th></tr>
      ${disputed.map(r => `<tr><td class="mono">${esc(r.code || r.id.slice(0, 8))}</td><td class="mono">${esc(r.puId)}</td><td>${esc(r.lga)}</td><td>${esc(r.ward)}</td><td>${r.anomalies?.length ? `<span class="badge l3">⚠ ${r.anomalies.length}</span>` : '—'}</td><td><button class="btn sm" data-open="${r.id}">Open record</button></td></tr>`).join('')}</table>` : '<div class="empty">No disputed records in this district.</div>'}</div></div>`;
      $$('[data-open]', wrap).forEach(x => x.onclick = () => submissionModal(x.dataset.open));
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ================= INCIDENTS: COMMAND (§21-25) =================
  function vIncidents(b) {
    const incs = distIncidents();
    const open = incs.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status));
    const bySev = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    open.forEach(i => bySev[i.severity]++);
    const resolved = incs.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status)).length;
    const escalated = incs.filter(i => i.status === 'ESCALATED').length;
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Total incidents', fmtN(incs.length))}
      ${kpiCard('Active', fmtN(open.length), { cls: open.length ? 'warn' : '' })}
      ${kpiCard('Critical', fmtN(bySev[5]), { cls: bySev[5] ? 'alert' : '' })}
      ${kpiCard('High', fmtN(bySev[4]), { cls: bySev[4] ? 'warn' : '' })}
      ${kpiCard('Medium', fmtN(bySev[3]))}
      ${kpiCard('Low', fmtN(bySev[2] + bySev[1]))}
      ${kpiCard('Resolved', fmtN(resolved), { cls: 'ok' })}
      ${kpiCard('Escalated', fmtN(escalated))}
    </div>
    <div class="grid23">
      <div class="panel"><div class="ph"><span class="t">LIVE INCIDENT FEED</span><span class="sub">chronological · click for complete record</span><span class="sp"></span>
        <select class="inp" style="width:130px" id="isev"><option value="">All levels</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
        <select class="inp" style="width:140px" id="ist"><option value="">All statuses</option>${['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED'].map(s => `<option>${s}</option>`).join('')}</select>
      </div>
      <div class="pb flat" id="incbody"><div class="feed" style="max-height:480px"></div></div></div>
      <div class="panel"><div class="ph"><span class="t">INCIDENT CATEGORIES</span><span class="sub">neutral descriptions of observed facts</span></div>
      <div class="pb" id="catbox"></div></div>
    </div>`));
    const draw = () => {
      const sev = $('#isev', b).value, st = $('#ist', b).value;
      let list = incs;
      if (sev) list = list.filter(i => String(i.severity) === sev);
      if (st) list = list.filter(i => i.status === st);
      const feed = $('#incbody .feed', b);
      feed.innerHTML = list.length ? list.slice(0, 30).map(i => `
        <div class="item" data-inc="${i.id}"><span class="t">${fmtWatShort(i.createdAt)}</span>
        <span class="tx">${sevBadge(i.severity)} <b>${esc(i.subcategory)}</b> — ${esc(i.lga)} · ${esc(i.puId || '')} ${statusBadge(i.status)}</span></div>`).join('') : '<div class="empty">No incidents match the filter</div>';
      $$('[data-inc]', feed).forEach(x => x.onclick = () => incidentModal(ov.incidents.find(i => i.id === x.dataset.inc), { canManage: API.can('incidents.manage'), onChange: refresh }));
    };
    $('#isev', b).onchange = draw;
    $('#ist', b).onchange = draw;
    draw();
    const cats = {};
    for (const i of incs) cats[`${i.category} · ${i.subcategory}`] = (cats[`${i.category} · ${i.subcategory}`] || 0) + 1;
    $('#catbox', b).innerHTML = Object.entries(cats).sort((a, z) => z[1] - a[1]).map(([k, n]) => `<div class="flex mb12"><span class="small" style="flex:1">${esc(k)}</span><b class="small">${n}</b></div>`).join('') || '<div class="empty small">No incidents</div>';
  }

  // ================= INCIDENTS: MAP (§24) =================
  function vIncmap(b) {
    const wrap = el(`<div>
      <div class="flex mb12">
        <select class="inp" style="width:120px" id="msev"><option value="">All levels</option>${[5, 4, 3, 2, 1].map(s => `<option>${s}</option>`).join('')}</select>
        <select class="inp" style="width:150px" id="mst"><option value="">All statuses</option>${['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED'].map(s => `<option>${s}</option>`).join('')}</select>
        <select class="inp" style="width:150px" id="mlga"><option value="">All LGAs</option>${distLgas().map(l => `<option value="${l.lgaId}">${esc(l.name)}</option>`).join('')}</select>
        <span class="flex1"></span><span class="small dim">green = resolved · amber = active · red pulse = L4/L5</span>
      </div>
      <div class="map-wrap" style="height:calc(100vh - 190px)"><div id="incmap" style="width:100%;height:100%"></div></div>
    </div>`);
    b.appendChild(wrap);
    const m = createMap($('#incmap', wrap), bootstrap, {});
    const apply = () => {
      let list = distIncidents();
      if ($('#msev', wrap).value) list = list.filter(i => String(i.severity) === $('#msev', wrap).value);
      if ($('#mst', wrap).value) list = list.filter(i => i.status === $('#mst', wrap).value);
      if ($('#mlga', wrap).value) list = list.filter(i => i.lgaId === $('#mlga', wrap).value);
      m.setData({ lgas: ov.lgas, incidents: list, sos: [], streams: [] });
      m.setLgaMetric(l => l.senatorial === district ? l.reportingPct : 0);
    };
    ['msev', 'mst', 'mlga'].forEach(id => $('#' + id, wrap).addEventListener('input', apply));
    m.onClick(({ type, id }) => {
      if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
    });
    apply();
  }

  // ================= INCIDENTS: ESCALATIONS (§39-40) =================
  function vEscalations(b) {
    const wrap = el(`<div>
      <div class="flex mb12"><span class="pill">ESCALATIONS TO CENTRAL SITUATION ROOM</span><span class="flex1"></span>
      ${API.can('escalations.create') ? `<button class="btn primary" id="newesc">▲ ESCALATE TO CENTRAL</button>` : ''}</div>
      <div id="escrows"><span class="dim small">Loading…</span></div>
    </div>`);
    b.appendChild(wrap);
    const draw = () => {
      loadEsc().then(res => {
        $('#escrows', wrap).innerHTML = res.rows.length ? res.rows.map(e => `
          <div class="esc-card" data-esc="${e.id}">
            <div class="e-head"><b>${esc(e.code)}</b><span class="pill">${esc(e.type)}</span><span class="badge ${e.priority === 'CRITICAL' ? 'l5' : e.priority === 'HIGH' ? 'l4' : e.priority === 'MEDIUM' ? 'l3' : 'l2'}">${esc(e.priority)}</span>${statusBadge(e.status)}<span class="right small dim">${fmtWatShort(e.createdAt)}</span></div>
            <div class="e-body">${esc(e.summary.slice(0, 140))}${e.summary.length > 140 ? '…' : ''}<br><span class="dim">ref: ${esc(e.refId)} · by ${esc(e.fromName)} (${esc(e.fromRole)})</span></div>
          </div>`).join('') : '<div class="panel"><div class="pb empty">Nothing escalated to Central. Critical incidents and SOS follow their own escalation channels.</div></div>';
        $$('[data-esc]', wrap).forEach(x => x.onclick = () => escalationModal(res.rows.find(e => e.id === x.dataset.esc)));
      }).catch(() => { $('#escrows', wrap).innerHTML = '<div class="empty">Could not load escalations.</div>'; });
    };
    draw();
    const nb = $('#newesc', wrap);
    if (nb) nb.onclick = () => escalateModal();
  }
  function escalateModal(rec, prefill = {}) {
    if (rec) {
      const m = modal({
        title: `${rec.code} — escalation case`,
        wide: true,
        body: () => el(`<div>
          <div class="flex mb12">${statusBadge(rec.status)}<span class="badge ${rec.priority === 'CRITICAL' ? 'l5' : rec.priority === 'HIGH' ? 'l4' : 'l3'}">${rec.priority}</span><span class="pill">${rec.type}</span></div>
          <div class="detail-grid">
            <span class="k">Reference ID</span><span class="v mono">${esc(rec.refId)}</span>
            <span class="k">Raised by</span><span class="v">${esc(rec.fromName)} (${esc(rec.fromRole)})</span>
            <span class="k">District</span><span class="v">${esc(rec.senatorial)}</span>
            <span class="k">Current status</span><span class="v">${esc(rec.currentStatus || '—')}</span>
          </div>
          <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Situation summary</span></div><div class="pb small">${esc(rec.summary)}</div></div>
          <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Action already taken</span></div><div class="pb small">${esc(rec.actionsTaken || '—')}</div></div>
          <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Requested attention</span></div><div class="pb small">${esc(rec.requestedAttention || '—')}</div></div>
          <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Escalation history</span></div><div class="pb">${rec.updates.map(u => `<div class="small mb12"><b>${esc(u.status)}</b> — ${esc(u.note || '')} <span class="dim">· ${fmtWatShort(u.at)} · ${esc(u.by)}</span></div>`).join('')}</div></div>
          ${['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(rec.status) ? `<div class="row mt12">
            <button class="btn" data-es="${rec.id}" data-st="ACKNOWLEDGED">✓ Acknowledge</button>
            <button class="btn" data-es="${rec.id}" data-st="IN_PROGRESS">▶ In progress</button>
            <button class="btn success" data-es="${rec.id}" data-st="RESOLVED">✔ Resolve</button>
          </div>` : ''}
        </div>`),
        actions: [{ label: 'Close', cls: 'ghost' }],
      });
      $$('[data-es]', m.body).forEach(x => x.onclick = async () => {
        await API.post(`/api/escalations/${x.dataset.es}/status`, { status: x.dataset.st, note: 'Updated from Senatorial Command' });
        toast('Escalation updated', rec.code + ' → ' + x.dataset.st);
        escCache = null; m.close(); refresh(); render();
      });
      return;
    }
    const m = modal({
      title: '▲ ESCALATE TO CENTRAL SITUATION ROOM',
      wide: true,
      body: () => el(`<div>
        <div class="pub-note">A structured case is sent to Central Command. Required: reference ID, situation summary, priority, evidence reference, current status, action already taken and requested attention.</div>
        <label class="fl">Reference ID *</label><input class="inp" id="eRef" value="${esc(prefill.refId || '')}" placeholder="e.g. INC-2027-000123 or SOS-2027-0004">
        <label class="fl">Type</label><select class="inp" id="eType">${['INCIDENT', 'SOS', 'RESULT_ISSUE', 'DATA_QUALITY', 'CONNECTIVITY', 'REPORTING_GAP', 'TASK'].map(t => `<option ${prefill.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <label class="fl">Priority *</label><select class="inp" id="ePri"><option>HIGH</option><option selected>CRITICAL</option><option>MEDIUM</option><option>LOW</option></select>
        <label class="fl">Situation summary *</label><textarea class="inp" id="eSum" rows="3" placeholder="Factual summary of the situation">${esc(prefill.summary || '')}</textarea>
        <label class="fl">Evidence reference</label><input class="inp" id="eEv" value="${esc(prefill.evidenceRef || '')}" placeholder="evidence / document ID(s)">
        <label class="fl">Current status</label><input class="inp" id="eCur" placeholder="e.g. awaiting field clarification">
        <label class="fl">Action already taken</label><textarea class="inp" id="eAct" rows="2" placeholder="What has been done at LG/senatorial level"></textarea>
        <label class="fl">Requested attention</label><textarea class="inp" id="eReq" rows="2" placeholder="What Central should do"></textarea>
      </div>`),
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'SEND TO CENTRAL', cls: 'warn', onClick: () => {
          const payload = { refId: $('#eRef').value.trim(), type: $('#eType').value, priority: $('#ePri').value, summary: $('#eSum').value.trim(), evidenceRef: $('#eEv').value.trim(), currentStatus: $('#eCur').value.trim(), actionsTaken: $('#eAct').value.trim(), requestedAttention: $('#eReq').value.trim() };
          if (!payload.refId || !payload.summary) return toast('Required fields', 'Reference ID and situation summary are required.', 'medium');
          API.post('/api/escalations', payload).then(res => {
            toast('Escalation sent', `${res.code} — Central Situation Room notified`);
            escCache = null; m.close(); refresh(); render();
          }).catch(e => toast('Escalation failed', (e.data && e.data.message) || e.message, 'high'));
        } },
      ],
    });
  }

  // ================= EMERGENCY: SOS (§26-27) =================
  function vSos(b) {
    const sos = distSos();
    const active = sos.filter(s => s.status !== 'RESOLVED');
    b.appendChild(el(`<div class="kpis">
      ${kpiCard('Active SOS', fmtN(active.length), { cls: active.length ? 'alert' : 'ok', sub: active.length ? 'IMMEDIATE ATTENTION' : 'none' })}
      ${kpiCard('Acknowledged', fmtN(sos.filter(s => s.status === 'ACKNOWLEDGED').length))}
      ${kpiCard('Responding', fmtN(sos.filter(s => s.status === 'RESPONDING').length), { cls: 'warn' })}
      ${kpiCard('Resolved', fmtN(sos.filter(s => s.status === 'RESOLVED').length), { cls: 'ok' })}
    </div>
    <div class="pub-note">SOS workflow: <b>SOS ACTIVE → ACKNOWLEDGED → LG RESPONSE → SENATORIAL ESCALATION → CENTRAL NOTIFICATION → RESOLVED</b>. The system coordinates authorized operational escalation — it does not itself provide physical emergency response.</div>
    ${active.length ? `<div class="alert-strip">${active.map(s => `<div class="a" data-sos="${s.id}">🚨 ${esc(s.code)} — ${esc(s.category)} @ ${esc(s.puId)} (${esc(s.lga)}) · ${esc(s.status)}</div>`).join('')}</div>` : ''}
    <div class="panel"><div class="ph"><span class="t">SOS EVENT LOG — ${esc(district.toUpperCase())}</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Code</th><th>Category</th><th>PU</th><th>LGA</th><th>Status</th><th>Triggered</th><th>Acks</th><th></th></tr>
    ${sos.length ? sos.map(s => `<tr><td class="mono">${esc(s.code)}</td><td>${esc(s.category)}</td><td class="mono">${esc(s.puId)}</td><td>${esc(s.lga)}</td><td>${statusBadge(s.status)}</td><td>${fmtWatShort(s.createdAt)}</td><td>${(s.acks || []).length} ✓</td><td><button class="btn sm" data-sos="${s.id}">Open</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No SOS events in this district</td></tr>'}
    </table></div></div>`));
    $$('[data-sos]', b).forEach(x => x.onclick = () => sosModal(distSos().find(s => s.id === x.dataset.sos), { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }));
  }

  // ================= LIVE: VIDEO WALL (§28-29) =================
  function vVideo(b) {
    const wrap = el(`<div>
      <div class="flex mb12">
        <span class="pill">SENATORIAL LIVE MONITORING — authorized field streams</span>
        <select class="inp" style="width:150px" id="vlga"><option value="">All LGAs</option>${distLgas().map(l => `<option value="${l.lgaId}">${esc(l.name)}</option>`).join('')}</select>
        <button class="btn sm ${false ? 'primary' : ''}" id="vfilter">SHOW FEEDS FROM LGAs WITH ACTIVE INCIDENTS</button>
        <span class="flex1"></span>
        ${[2, 3, 4].map(g => `<button class="btn sm ${wallGrid === g ? 'primary' : ''}" data-g="${g}">${g}×${g}</button>`).join('')}
        <button class="btn sm" data-full>⛶ Fullscreen</button>
      </div>
      <div class="vwall g${wallGrid}" id="vw"></div>
    </div>`);
    b.appendChild(wrap);
    let incidentFilter = false;
    const draw = () => {
      let live = [...distStreams().filter(s => s.pinned), ...distStreams().filter(s => !s.pinned)];
      if ($('#vlga', wrap).value) live = live.filter(s => s.lgaId === $('#vlga', wrap).value);
      if (incidentFilter) {
        const hotLgas = new Set(distIncidents().filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).map(i => i.lgaId));
        live = live.filter(s => hotLgas.has(s.lgaId));
      }
      $('#vw', wrap).innerHTML = live.length ? live.map(s => `
        <div class="vcard"><canvas width="400" height="240"></canvas><div class="vh"></div>
        <div class="vinfo"><b>${esc(s.puId)}</b><br>${esc(s.lga)} LGA · ${esc(s.agentName)}</div>
        <div class="vstatus live">● LIVE</div>
        <button class="vpin ${s.pinned ? 'on' : ''}" data-pin="${s.id}">📌</button></div>`).join('') : '<div class="empty" style="grid-column:1/-1">No live streams matching the filters — streams appear as agents broadcast.</div>';
      $$('canvas', $('#vw', wrap)).forEach((cv, i) => { if (live[i]) startSimStream(cv, { pu: live[i].puId, lga: live[i].lga, bitrate: live[i].bitrateKbps, fps: live[i].fps, viewers: live[i].viewers, t: ov.sim.now }); });
      $$('[data-pin]', wrap).forEach(x => x.onclick = async (e) => { e.stopPropagation(); await API.post(`/api/streams/${x.dataset.pin}/pin`, {}); refresh().then(() => render()); });
    };
    $$('[data-g]', wrap).forEach(x => x.onclick = () => { wallGrid = +x.dataset.g; render(); });
    $('[data-full]', wrap).onclick = () => { const w = $('#vw', wrap); if (document.fullscreenElement) document.exitFullscreen(); else w.requestFullscreen(); };
    $('#vlga', wrap).onchange = draw;
    $('#vfilter', wrap).onclick = () => { incidentFilter = !incidentFilter; $('#vfilter', wrap).classList.toggle('primary', incidentFilter); draw(); };
    draw();
  }

  // ================= ANALYTICS (§33, §43) =================
  function vAnalytics(b) {
    const SUB = [['reporting', 'REPORTING'], ['results', 'RESULTS'], ['incidents', 'INCIDENTS'], ['connectivity', 'CONNECTIVITY']];
    b.appendChild(el(`<div class="act-seg mb12" id="ansub">${SUB.map(([id, l]) => `<span class="as ${id === 'reporting' ? 'on' : ''}" data-s="${id}">${l}</span>`).join('')}</div><div id="anbox"></div>`));
    const box = $('#anbox', b);
    const drawReporting = () => {
      box.innerHTML = '<span class="dim small">Loading…</span>';
      Promise.all([
        API.get('/api/analytics/timeseries?metric=submissions&bucket=30'),
        API.get('/api/analytics/timeseries?metric=checkins&bucket=30'),
      ]).then(([subs, chk]) => {
        const lbl = (s) => s.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
        const wards = ov.wardHealth.filter(w => dlIds().has(w.lgaId)).sort((a, z) => a.reportingPct - z.reportingPct).slice(0, 10);
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Reports per hour</span></div><div class="pb chart-box">${lineChart({ series: [{ data: subs.series.map(p => p.count) }], labels: lbl(subs), h: 200 })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Ward coverage (lowest first)</span><span class="sub">drill: district → LGA → ward → PU</span></div><div class="pb chart-box">${barChart({ data: wards.map(w => w.reportingPct), labels: wards.map(w => w.name.length > 10 ? w.name.slice(0, 9) + '…' : w.name), h: 200, colorFn: v => v < 50 ? '#ef4444' : v < 80 ? '#f59e0b' : '#22c55e' })}</div></div>
        </div>
        <div class="panel mt12"><div class="ph"><span class="t">REPORTING GAPS BY LGA</span></div><div class="pb" id="gaplist">${distLgas().map(l => `<div class="small flex mb12"><b style="width:130px">${esc(l.name)}</b><div class="pbar flex1"><div class="fill ${l.reportingPct < 50 ? 'red' : ''}" style="width:${l.reportingPct}%"></div></div><b>${l.reportingPct}%</b><span class="dim" style="width:70px;text-align:right">${l.submitted}/${l.totalPu}</span></div>`).join('')}</div></div>`;
      });
    };
    const drawResults = () => {
      box.innerHTML = '<span class="dim small">Loading…</span>';
      Promise.all([
        API.get('/api/analytics/timeseries?metric=submissions&bucket=30'),
        API.get('/api/analytics/timeseries?metric=verifications&bucket=30'),
        loadResults(),
      ]).then(([subs, ver, rows]) => {
        const lbl = (s) => s.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
        const byStatus = { VERIFIED: 0, SUBMITTED: 0, UNDER_REVIEW: 0, REJECTED: 0, DISPUTED: 0 };
        rows.forEach(r => { if (byStatus[r.status] != null) byStatus[r.status]++; });
        box.innerHTML = `<div class="grid3">
          <div class="panel"><div class="ph"><span class="t">Submission progress</span></div><div class="pb chart-box">${lineChart({ series: [{ data: subs.series.map(p => p.count) }], labels: lbl(subs), h: 170 })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Verification completion</span></div><div class="pb chart-box">${lineChart({ series: [{ data: ver.series.map(p => p.count), color: '#22c55e' }], labels: lbl(ver), h: 170, color: '#22c55e' })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Record status mix</span></div><div class="pb chart-box">${donutChart({ segments: [{ label: 'Verified', value: byStatus.VERIFIED, color: '#22c55e' }, { label: 'Submitted', value: byStatus.SUBMITTED, color: '#38bdf8' }, { label: 'Under review', value: byStatus.UNDER_REVIEW, color: '#f59e0b' }, { label: 'Rejected', value: byStatus.REJECTED, color: '#ef4444' }, { label: 'Disputed', value: byStatus.DISPUTED, color: '#a78bfa' }], w: 220, h: 170, centerLabel: 'records', centerValue: rows.length })}</div></div>
        </div>`;
      });
    };
    const drawIncidents = () => {
      box.innerHTML = '<span class="dim small">Loading…</span>';
      API.get('/api/analytics/timeseries?metric=incidents&bucket=30').then(incs => {
        const lbl = incs.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
        const list = distIncidents();
        const bySev = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        list.forEach(i => bySev[i.severity]++);
        const cats = {};
        for (const i of list) cats[i.subcategory] = (cats[i.subcategory] || 0) + 1;
        const avgRes = list.filter(i => i.status === 'RESOLVED' && i.updatedAt).reduce((a, i) => a + (i.updatedAt - i.createdAt), 0) / Math.max(1, list.filter(i => i.status === 'RESOLVED' && i.updatedAt).length) / 60000;
        box.innerHTML = `<div class="grid3">
          <div class="panel"><div class="ph"><span class="t">Incidents over time</span></div><div class="pb chart-box">${barChart({ data: incs.series.map(p => p.count), labels: lbl, h: 170, color: '#fb923c' })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Severity distribution</span></div><div class="pb chart-box">${donutChart({ segments: [1, 2, 3, 4, 5].map(s => ({ label: 'L' + s, value: bySev[s], color: ['#94a3b8', '#4ade80', '#fbbf24', '#fb923c', '#ef4444'][s - 1] })), w: 220, h: 170, centerLabel: 'incidents', centerValue: list.length })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Categories</span><span class="sub">avg resolution ${Math.round(avgRes)} min</span></div><div class="pb chart-box">${barChart({ data: Object.values(cats).sort((a, z) => z - a).slice(0, 8), labels: Object.keys(cats).sort((a, z) => cats[z] - cats[a]).map(c => c.length > 12 ? c.slice(0, 11) + '…' : c).slice(0, 8), h: 170, color: '#d97706' })}</div></div>
        </div>`;
      });
    };
    const drawConn = () => {
      box.innerHTML = '<span class="dim small">Loading…</span>';
      loadAgents().then(({ rows }) => {
        const online = rows.filter(a => a.online).length;
        const perLga = distLgas().map(l => ({ name: l.name, pct: pctSafe(l.agentsOnline, l.agents) }));
        box.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Online / offline share</span></div><div class="pb chart-box">${donutChart({ segments: [{ label: 'Online', value: online, color: '#22c55e' }, { label: 'Offline', value: rows.length - online, color: '#ef4444' }], w: 220, h: 180, centerLabel: 'agents', centerValue: rows.length })}</div></div>
          <div class="panel"><div class="ph"><span class="t">Connectivity by LGA</span></div><div class="pb chart-box">${barChart({ data: perLga.map(l => l.pct), labels: perLga.map(l => l.name.length > 9 ? l.name.slice(0, 8) + '…' : l.name), h: 180, colorFn: v => v < 60 ? '#ef4444' : v < 85 ? '#f59e0b' : '#22c55e' })}</div></div>
        </div>`;
      });
    };
    $$('#ansub .as', b).forEach(x => x.onclick = () => {
      $$('#ansub .as', b).forEach(y => y.classList.remove('on'));
      x.classList.add('on');
      ({ reporting: drawReporting, results: drawResults, incidents: drawIncidents, connectivity: drawConn })[x.dataset.s]();
    });
    drawReporting();
  }

  // ================= INTELLIGENCE: BRIEF (§38) =================
  function vBrief(b) {
    const h = healthBreakdown();
    const signals = computeSignals();
    const lgs = distLgas();
    const agents = lgs.reduce((a, l) => a + l.agents, 0);
    const online = lgs.reduce((a, l) => a + l.agentsOnline, 0);
    const incs = distIncidents();
    const active = incs.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status));
    b.appendChild(el(`<div class="flex mb12"><span class="pill">INTELLIGENCE BRIEF — auto-generated · refreshed continuously · provenance-labelled</span><span class="flex1"></span><button class="btn sm" id="brefresh">↻ Refresh</button></div>
    <div class="panel"><div class="pb" id="brief">
      <div class="brief-sec"><div class="b-t">CURRENT SITUATION</div><div class="b-x">${esc(district)} is at <b>${h.score}% operational health (${h.status})</b> with ${fmtN(totalSubmitted())} of ${fmtN(totalPu())} polling units reporting (${pctSafe(totalSubmitted(), totalPu())}%).</div></div>
      <div class="brief-sec"><div class="b-t">REPORTING</div><div class="b-x">Coverage ${pctSafe(totalSubmitted(), totalPu())}% · ${lgs.filter(l => l.reportingPct < 50).length} LGA(s) below 50%. ${signals.find(s => s.id === 'gap') ? '<span class="badge l4">REPORTING GAP SIGNAL</span>' : 'No major gap signal.'}</div></div>
      <div class="brief-sec"><div class="b-t">RESULTS</div><div class="b-x">${fmtN(totalVerified())} verified (${pctSafe(totalVerified(), totalPu())}%) · ${fmtN(lgs.reduce((a, l) => a + l.pending, 0))} under review · ${fmtN(ov.kpis.rejected)} rejected · ${fmtN(ov.kpis.disputed)} disputed. All figures are <b>VERIFIED / SUBMITTED / UNVERIFIED / DISPUTED</b>-labelled in the result centre.</div></div>
      <div class="brief-sec"><div class="b-t">INCIDENTS</div><div class="b-x">${fmtN(active.length)} active (${fmtN(active.filter(i => i.severity >= 4).length)} L4/L5) · ${fmtN(incs.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status)).length)} resolved.</div></div>
      <div class="brief-sec"><div class="b-t">SOS</div><div class="b-x">${distSos().length ? `<span style="color:#f87171">🚨 ${distSos().length} active emergency alert(s)</span>` : 'No active emergency alerts.'}</div></div>
      <div class="brief-sec"><div class="b-t">CONNECTIVITY</div><div class="b-x">${online}/${agents} agents online (${pctSafe(online, agents)}%) · ${lgs.filter(l => pctSafe(l.agentsOnline, l.agents) < 60).length} LGA(s) below 60% connectivity.</div></div>
      <div class="brief-sec"><div class="b-t">DATA QUALITY</div><div class="b-x">${fmtN(ov.anomalies.filter(a => distLgas().some(l => l.name === a.lga)).length)} record(s) flagged — all require human review, none are automatic conclusions.</div></div>
      <div class="brief-sec"><div class="b-t">PRIORITY ACTIONS</div><div class="b-x">${signals.length ? signals.slice(0, 4).map((s, i) => `${i + 1}. ${esc(s.title)} — ${esc(s.note.slice(0, 90))}`).join('<br>') : 'No priority actions — district operations are nominal.'}</div></div>
      <div class="brief-sec"><div class="b-t">ESCALATIONS</div><div class="b-x" id="briefesc">Loading…</div></div>
    </div></div>`));
    $('#brefresh', b).onclick = () => { refresh().then(() => { render(); }); };
    loadEsc().then(res => {
      $('#briefesc', b).innerHTML = res.rows.length ? res.rows.slice(0, 3).map(e => `${esc(e.code)} (${esc(e.priority)}) — ${esc(e.summary.slice(0, 80))}`).join('<br>') : 'Nothing escalated to Central.';
    }).catch(() => { $('#briefesc', b).innerHTML = '—'; });
  }

  // ================= INTELLIGENCE: SIGNALS (§36) =================
  function vSignals(b) {
    const signals = computeSignals();
    b.appendChild(el(`<div class="pub-note">The signal engine identifies <b>operational patterns for human review</b>. It may say <b>SIGNAL REQUIRES HUMAN REVIEW</b> — it never automatically concludes fraud, rigging, intimidation or electoral manipulation without verified evidence.</div>
    ${signals.length ? signals.map(s => `
      <div class="signal-card ${s.sev.toLowerCase()}">
        <div class="s-head">${s.sev === 'CRITICAL' ? '🚨' : s.sev === 'HIGH' ? '⚠' : s.sev === 'MEDIUM' ? '▲' : 'i'} <b>${esc(s.title)}</b><span class="badge ${s.sev === 'CRITICAL' ? 'l5' : s.sev === 'HIGH' ? 'l4' : s.sev === 'MEDIUM' ? 'l3' : 'l2'}">${esc(s.sev)}</span><span class="pill">SIGNAL REQUIRES HUMAN REVIEW</span></div>
        <div class="s-note">${esc(s.note)}</div>
        <div class="s-actions">
          <button class="btn sm" data-go="${s.act}">${esc(s.actLabel || 'VIEW')}</button>
          ${API.can('escalations.create') ? `<button class="btn sm warn" data-esc="${esc(s.title)}">▲ Escalate</button>` : ''}
        </div>
      </div>`).join('') : '<div class="panel"><div class="pb empty">No active operational signals. Routine reporting.</div></div>'}`));
    $$('[data-go]', b).forEach(x => x.onclick = () => {
      const go = { 'view-locations': 'wards', 'view-queue': 'queue', 'view-connectivity': 'connectivity', 'view-incidents': 'incidents', 'view-sos': 'sos' }[x.dataset.go];
      if (go) setTab(go);
    });
    $$('[data-esc]', b).forEach(x => x.onclick = () => escalateModal(null, { type: 'DATA_QUALITY', refId: 'SIGNAL-' + Date.now().toString(36).toUpperCase(), summary: x.dataset.esc + ' — signal escalated from Senatorial Command' }));
  }

  // ================= INTELLIGENCE: COPILOT (§37) =================
  function vCopilot(b) {
    const wrap = el(`<div class="panel" style="display:flex;flex-direction:column;height:calc(100vh - 180px)">
      <div class="ph"><span class="t">🤖 EYES INTELLIGENCE COPILOT</span><span class="sub">district-scoped · every answer labels VERIFIED / SUBMITTED / UNVERIFIED / DISPUTED / SYSTEM SIGNAL / ANALYTICAL SUMMARY</span></div>
      <div class="pb" id="chat" style="flex:1;overflow-y:auto"></div>
      <div class="pb" style="border-top:1px solid var(--line)"><div class="row">
        <input class="inp grow" id="cq" placeholder='Try: "Which LGAs have the largest reporting gaps?" or "Generate a Senatorial Situation Report"'>
        <button class="btn primary" id="cbtn">Ask</button>
      </div></div>
    </div>`);
    b.appendChild(wrap);
    const chat = $('#chat', wrap);
    chat.innerHTML = `<div class="item"><span class="t">COPILOT</span><span class="tx">District-scoped assistant for <b>${esc(district)}</b>. Ask about LGA status, reporting gaps, pending verification, incidents, connectivity, or generate the situation report. I never invent statistics.</span></div>`;
    async function ask(q) {
      chat.appendChild(el(`<div class="item"><span class="t">YOU</span><span class="tx">${esc(q)}</span></div>`));
      const res = await API.post('/api/copilot', { query: `[District scope: ${district}] ${q}` });
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

  // ================= REPORTS: SITREP (§41) =================
  function vSitrep(b) {
    b.appendChild(el(`<div class="flex mb12"><button class="btn primary" id="gen">⟳ GENERATE SENATORIAL SITREP</button><span class="flex1"></span><span class="small dim">JSON · CSV · Excel · Print/PDF — every export is audit-logged</span></div><div id="out"></div>`));
    const gen = async () => {
      const s = await API.get(`/api/reports/sitrep?scope=senatorial&ref=${encodeURIComponent(district)}`);
      $('#out', b).innerHTML = renderSitrep(s, `SENATORIAL · ${district}`) + `
        <div class="pub-note mt12">Every figure in this report is provenance-labelled: <b>VERIFIED</b> (supervisor-approved), <b>SUBMITTED</b> (received, awaiting review), <b>UNVERIFIED</b> (field report), <b>DISPUTED</b> (under escalation). Monitoring data is never presented as official INEC results.</div>`;
      $$('[data-exp]', $('#out', b)).forEach(x => x.onclick = () => window.open(`/api/export?type=sitrep&format=${x.dataset.exp}`, '_blank'));
    };
    $('#gen', b).onclick = gen;
    gen();
  }

  // ================= REPORTS: EXPORT CENTRE (§50) =================
  function vExports(b) {
    const ITEMS = [
      ['sitrep', 'Senatorial SITREP', 'Full situation report dataset'],
      ['results', 'Result monitoring statistics', 'Submissions with status & anomalies'],
      ['incidents', 'Incident report', 'All incident records with levels'],
      ['verification', 'Verification backlog', 'Review actions and timestamps'],
      ['agents', 'Agent activity', 'Field network status per agent'],
      ['audit', 'Audit report', 'Immutable audit trail records'],
    ];
    b.appendChild(el(`<div class="pub-note">Every export is logged in the audit centre with user, timestamp and IP. Formats: CSV · Excel (XLSX) · JSON.</div>
    <div class="grid3">${ITEMS.map(([t, l, d]) => `
      <div class="panel"><div class="ph"><span class="t">${esc(l)}</span></div>
      <div class="pb"><div class="small muted mb12">${esc(d)}</div>
      <div class="row">${['csv', 'xlsx', 'json'].map(f => `<button class="btn sm" data-exp="${t}:${f}">${f.toUpperCase()}</button>`).join('')}</div></div></div>`).join('')}
    </div>`));
    $$('[data-exp]', b).forEach(x => x.onclick = () => {
      const [t, f] = x.dataset.exp.split(':');
      window.open(`/api/export?type=${t}&format=${f}`, '_blank');
    });
  }

  // ================= GOVERNANCE: AUDIT (§47) =================
  function vAudit(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">AUDIT LOG — immutable</span><span class="sp"></span><input class="inp" style="width:200px" id="aq" placeholder="Search…"><button class="btn sm" id="aexp">Export</button></div>
    <div class="pb flat" id="abody"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    const load = debounce(async () => {
      const res = await API.get('/api/audit?limit=150&q=' + encodeURIComponent($('#aq', wrap).value));
      const t = dataTable({
        cols: [
          { label: 'Time', key: 'createdAt', render: r => `<span class="mono small">${fmtWat(r.createdAt)}</span>` },
          { label: 'User', key: 'username', render: r => r.username === 'system' ? '<span class="dim">system</span>' : r.username },
          { label: 'Action', key: 'action', render: r => `<span class="badge s-submitted">${esc(r.action)}</span>` },
          { label: 'Object', key: 'objectId', cls: 'mono' },
          { label: 'Detail', key: 'detail', render: r => `<span class="muted small">${esc((r.detail || '').slice(0, 60))}</span>` },
          { label: 'IP', key: 'ip', cls: 'mono' },
        ],
        rows: res.rows, sortable: true, pageSize: 30,
      });
      t.setTitle(`${res.total} records — login, access, actions, exports and administrative changes`);
      $('#abody', wrap).innerHTML = ''; $('#abody', wrap).appendChild(t.el);
    }, 300);
    $('#aq', wrap).addEventListener('input', load);
    $('#aexp', wrap).onclick = () => window.open('/api/export?type=audit&format=xlsx', '_blank');
    load();
  }

  // ================= GOVERNANCE: EVIDENCE CHAIN (§46) =================
  function vChain(b) {
    const wrap = el(`<div id="chwrap"><span class="dim small">Loading evidence chain…</span></div>`);
    b.appendChild(wrap);
    loadEvidence().then(res => {
      const rows = res.rows.slice(0, 40);
      wrap.innerHTML = `<div class="pub-note">Evidence chain: <b>CAPTURED → UPLOADED → SERVER RECEIVED → LG VIEWED → SENATORIAL REVIEW → VERIFICATION → ARCHIVED</b> — user, timestamp, action and hash where applicable. The original document is never modified.</div>
      <div class="panel"><div class="ph"><span class="t">EVIDENCE AUDIT VIEW</span><span class="sub">select a document to inspect its full chain</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Evidence</th><th>Submission</th><th>PU</th><th>LGA</th><th>Status</th><th>Chain steps</th><th></th></tr>
      ${rows.length ? rows.map(r => `<tr><td class="mono">${esc(r.code)}</td><td class="mono">${esc(r.subCode || '')}</td><td class="mono">${esc(r.puId)}</td><td>${esc(r.lga)}</td><td>${statusBadge(r.status)}</td><td>${(r.chain || []).length} steps</td><td><button class="btn sm" data-ev="${r.id}">Inspect chain</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No documents in this district</td></tr>'}
      </table></div></div>`;
      $$('[data-ev]', wrap).forEach(x => x.onclick = () => {
        const r = res.rows.find(e => e.id === x.dataset.ev);
        modal({
          title: `Evidence chain — ${r.code}`,
          wide: true,
          body: () => el(`<div>
            <div class="sos-steps">${['CAPTURED', 'UPLOADED', 'SERVER RECEIVED', 'LG VIEWED', 'SENATORIAL REVIEW', 'VERIFICATION', 'ARCHIVED'].map((step, i) => {
              const done = (r.chain || []).some(c => c.step === step) || ((r.chain || []).length >= i + 1 && i < 3);
              const isLast = done && i === Math.min((r.chain || []).length, 6) - 1;
              return `<div class="sos-step ${done ? 'done' : ''} ${isLast ? 'active' : ''}"><span class="ss-dot">${done ? '✓' : ''}</span><span class="ss-t"><b>${step}</b><br><span class="small">${done ? fmtWatShort((r.chain || []).find(c => c.step === step)?.at || r.uploadedAt) : 'pending'}</span></span></div>`;
            }).join('')}</div>
            <hr class="soft">
            <div class="detail-grid">
              <span class="k">Hash</span><span class="v mono small">${esc(r.sha256)}</span>
              <span class="k">Captured</span><span class="v">${fmtWatShort(r.capturedAt)}</span>
              <span class="k">Uploaded</span><span class="v">${fmtWatShort(r.uploadedAt)}</span>
              <span class="k">Device</span><span class="v">registered agent device</span>
            </div>
          </div>`),
          actions: [{ label: 'Close', cls: 'ghost' }],
        });
      });
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ================= GOVERNANCE: SECURITY (§57) =================
  function vSecurity(b) {
    b.appendChild(el(`<div class="grid3">
      <div class="panel"><div class="ph"><span class="t">ACCESS CONTROL</span></div><div class="pb small">
        <div class="flex mb12"><span>RBAC enforced server-side</span><span class="right"><b style="color:#4ade80">✓ every endpoint</b></span></div>
        <div class="flex mb12"><span>MFA / OTP</span><span class="right"><b>✓</b></span></div>
        <div class="flex mb12"><span>Session expiration</span><span class="right"><b>12 h</b></span></div>
        <div class="flex mb12"><span>Device/session monitoring</span><span class="right"><b>✓</b></span></div>
        <div class="flex"><span>Rate limiting</span><span class="right"><b>per-endpoint</b></span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">EVIDENCE & DATA</span></div><div class="pb small">
        <div class="flex mb12"><span>Signed evidence URLs</span><span class="right"><b>✓</b></span></div>
        <div class="flex mb12"><span>Encryption in transit / at rest</span><span class="right"><b>✓</b></span></div>
        <div class="flex mb12"><span>Never overwrite source records</span><span class="right"><b style="color:#4ade80">✓ versioned</b></span></div>
        <div class="flex mb12"><span>Audit trails</span><span class="right"><b>immutable to users</b></span></div>
        <div class="flex"><span>Backup / disaster recovery</span><span class="right"><b>configured</b></span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">PUBLIC DATA FIREWALL (§48)</span></div><div class="pb small" style="line-height:1.8">
        Internal operations (agent identity, GPS, private communications, incident detail, private video, operational security) are strictly separated from <b>public statistics</b>. The public portal receives only information explicitly approved through the publication workflow — always labelled <b>MONITORING DATA</b>, never official INEC results.
      </div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">ACTIVE SECURITY POSTURE</span></div>
    <div class="pb small muted">Client-side permissions are advisory only — the backend authorizes every request. Security alerts appear in the notification centre and audit log.</div></div>`));
  }

  // ================= GOVERNANCE: SYSTEM HEALTH (§58) =================
  function vHealth(b) {
    const h = ov.health;
    const svc = (n, v) => `<div class="kpi ${v === 'HEALTHY' ? 'ok' : v === 'CRITICAL' ? 'alert' : 'warn'}"><div class="l">${n}</div><div class="v" style="font-size:15px">${v}</div></div>`;
    b.appendChild(el(`<div class="kpis">${svc('API', h.api)}${svc('Database', h.db)}${svc('Storage', h.storage)}${svc('Video', h.video)}${svc('Notifications', h.notification)}${svc('Queue', h.queue)}${svc('WebSocket', h.websocket)}${svc('Auth', 'HEALTHY')}${svc('GIS', 'HEALTHY')}${svc('Sync service', h.queue)}</div>
    <div class="grid3">
      <div class="panel"><div class="ph"><span class="t">CPU</span></div><div class="pb"><div class="pbar"><div class="fill" style="width:${h.cpu}%"></div></div><b>${Math.round(h.cpu)}%</b></div></div>
      <div class="panel"><div class="ph"><span class="t">Memory</span></div><div class="pb"><div class="pbar"><div class="fill green" style="width:${h.memory}%"></div></div><b>${Math.round(h.memory)}%</b></div></div>
      <div class="panel"><div class="ph"><span class="t">API latency</span></div><div class="pb"><div class="pbar"><div class="fill amber" style="width:${Math.min(100, h.responseMs)}%"></div></div><b>${Math.round(h.responseMs)}ms</b> · error rate ${h.errorRate}%</div></div>
    </div>`));
  }

  render();
})();
