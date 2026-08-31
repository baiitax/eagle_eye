// central.js — CENTRAL SITUATION ROOM (statewide command centre)
'use strict';
(async () => {
  const { user: me, b, o } = await bootPortal('Central Situation Room', 'Director', { username: 'director', password: 'Director@123!' });
  let bootstrap = b, ov = o;
  const qs = new URLSearchParams(location.search);
  let tab = qs.get('tab') || 'command';
  let map = null, wallGrid = 3, pins = new Set();

  const NAV = [
    { id: 'command', label: 'Central Dashboard', ico: '◈', section: 'COMMAND' },
    { id: 'map', label: 'Live Election Map', ico: '◎' },
    { id: 'wall', label: 'Command Wall', ico: '▣' },
    { id: 'whatchanged', label: 'What Changed?', ico: 'Δ' },
    { id: 'feed', label: 'Live Event Feed', ico: '≡' },
    { id: 'agents', label: 'Agents', ico: '👤', section: 'FIELD NETWORK' },
    { id: 'senatorial', label: 'Senatorial Districts', ico: '⬡' },
    { id: 'lg', label: 'LGs', ico: '▦' },
    { id: 'connectivity', label: 'Connectivity', ico: '📶' },
    { id: 'results', label: 'Result Monitoring', ico: '≡', section: 'RESULTS' },
    { id: 'resultflow', label: 'Result Flow & Bottlenecks', ico: '⇶' },
    { id: 'evidence', label: 'EC8A Evidence', ico: '🗂', perm: 'evidence.view' },
    { id: 'verify', label: 'Verification', ico: '✓', perm: 'results.verify' },
    { id: 'watchtower', label: 'IReV Dashboard', ico: '👁', section: 'IReV WATCHTOWER' },
    { id: 'irevpending', label: 'Pending Uploads', ico: '⏳' },
    { id: 'irevmatrix', label: 'Upload Monitor', ico: '▦' },
    { id: 'irevarchive', label: 'Snapshot Archive', ico: '🗄', perm: 'evidence.view' },
    { id: 'irevchanges', label: 'Change Detection', ico: 'Δ' },
    { id: 'irevrecon', label: 'Reconciliation', ico: '⇄' },
    { id: 'discrepancies', label: 'Discrepancy Command', ico: '⚖' },
    { id: 'irevsource', label: 'Source Health', ico: '📡' },
    { id: 'intel', label: 'Intelligence Brief', ico: '✧', section: 'INTELLIGENCE' },
    { id: 'signals', label: 'Operational Signals', ico: '⚡' },
    { id: 'copilot', label: 'Intelligence Copilot', ico: '🤖', perm: 'copilot.use' },
    { id: 'incidents', label: 'Incident Command', ico: '⚠', section: 'INCIDENTS' },
    { id: 'sos', label: 'SOS', ico: '🚨' },
    { id: 'escalations', label: 'Escalations', ico: '▲', perm: 'escalations.view' },
    { id: 'tasks', label: 'Operations Tasks', ico: '☑', section: 'OPERATIONS' },
    { id: 'comms', label: 'Communications', ico: '💬' },
    { id: 'shifts', label: 'Shift Management', ico: '🕒' },
    { id: 'analytics', label: 'Analytics', ico: '∿', section: 'ANALYTICS' },
    { id: 'latency', label: 'Upload Latency', ico: '⏱' },
    { id: 'reports', label: 'Central SITREP', ico: '▤', section: 'REPORTS' },
    { id: 'irevsitrep', label: 'Reconciliation Report', ico: '⇄' },
    { id: 'reporthistory', label: 'Report History', ico: '📚' },
    { id: 'audit', label: 'Audit Trail', ico: '◉', perm: 'audit.view', section: 'GOVERNANCE' },
    { id: 'chain', label: 'Evidence Chain', ico: '⛓', perm: 'evidence.view' },
    { id: 'security', label: 'Security', ico: '🛡' },
    { id: 'health', label: 'System Health', ico: '⚙', perm: 'system.health' },
  ];
  const shell = initShell({ title: 'Central', nav: NAV, active: tab, me, sim: ov.sim, portalTag: 'CENTRAL SITUATION ROOM', onNav: setTab });

  function setTab(id) {
    tab = id;
    history.replaceState(null, '', `/central?tab=${id}`);
    render();
  }

  async function refresh(force) {
    try {
      ov = await API.get('/api/overview');
      if (force) render();
    } catch (e) { }
  }
  const liveRefresh = debounce(() => refresh(true), 900);
  shell.onLive(liveRefresh);
  setInterval(() => refresh(false), 15000);

  function render() { shell.main.innerHTML = ''; (RENDERS[tab] || rCommand)(shell.main); }

  // ================= COMMAND DASHBOARD =================
  function rCommand() {
    const k = ov.kpis;
    shell.main.appendChild(el(`
      <div class="kpis">
        ${kpiCard('Polling units', fmtN(k.totalPu), { sub: 'configured in Kano' })}
        ${kpiCard('Reporting', fmtN(k.submittedPu), { sub: `${k.reportingPct}% of PUs`, cls: 'accent', spark: sparkline(trendData('submitted')) })}
        ${kpiCard('Verified', fmtN(k.verifiedPu), { sub: `${k.verifiedPct}% of PUs`, cls: 'ok' })}
        ${kpiCard('Pending review', fmtN(k.pending), { sub: 'verification queue', cls: 'warn' })}
        ${kpiCard('Rejected', fmtN(k.rejected), { sub: 'returned to agents' })}
        ${kpiCard('Active incidents', fmtN(k.activeIncidents), { sub: `${fmtN(k.criticalIncidents)} critical`, cls: k.criticalIncidents ? 'alert' : '' })}
        ${kpiCard('Active SOS', fmtN(k.activeSos), { sub: 'emergency signals', cls: k.activeSos ? 'alert' : '' })}
        ${kpiCard('Agents online', fmtN(k.agentsOnline), { sub: `${fmtN(k.agentsOffline)} offline`, cls: 'ok' })}
        ${kpiCard('Live streams', fmtN(k.liveStreams), { sub: 'field video feeds' })}
        ${kpiCard('Data anomalies', fmtN(k.anomalies), { sub: 'requires human review', cls: k.anomalies ? 'warn' : '' })}
      </div>`));

    // §5 + §80: CENTRAL OPERATIONAL HEALTH + MASTER SYSTEM STATUS
    centralHealthHero(shell.main);

    // IReV WATCHTOWER row (§54): banner + reconciliation KPIs + progress + pending + what changed
    const irevRow = el(`<div id="irevrow"><div class="panel"><div class="pb"><span class="dim small">IReV Watchtower: loading reconciliation status…</span></div></div></div>`);
    shell.main.appendChild(irevRow);
    loadIrev().then(ir => {
      if (!document.body.contains(irevRow)) return;
      const k = ir.kpis;
      const h = ir.source;
      const cls = h.status === 'ONLINE' ? '' : h.status === 'DEGRADED' ? 'degraded' : 'offline';
      const col = h.status === 'ONLINE' ? '#4ade80' : h.status === 'DEGRADED' ? '#fbbf24' : '#f87171';
      irevRow.innerHTML = `
        ${irevBanner(ir).outerHTML}
        <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
          ${kpiCard('IReV observed', fmtN(k.observed), { sub: k.coveragePct + '% coverage', cls: 'accent' })}
          ${kpiCard('Pending IReV', fmtN(k.pending), { cls: k.pending ? 'warn' : '' })}
          ${kpiCard('Matched', fmtN(k.matched), { cls: 'ok' })}
          ${kpiCard('Discrepancies', fmtN(k.discrepancies), { cls: k.discrepancies ? 'alert' : '' })}
          ${kpiCard('Doc changes', fmtN(k.docChanges), { cls: k.docChanges ? 'alert' : '' })}
          ${kpiCard('Under review', fmtN(k.underReview), { cls: k.underReview ? 'warn' : '' })}
        </div>
        <div class="grid23">
          <div class="panel"><div class="ph"><span class="t">IReV UPLOAD PROGRESS & FIELD VS IReV RECONCILIATION</span><span class="sub">coverage ${k.coveragePct}% · reconciliation ${k.reconciliationPct}%</span><span class="sp"></span><button class="btn sm ghost" data-go="watchtower">Watchtower →</button></div>
          <div class="pb">
            <div class="small flex mb12"><span style="width:110px">IReV observed</span><div class="pbar flex1"><div class="fill" style="width:${k.coveragePct}%"></div></div><b>${k.coveragePct}%</b></div>
            <div class="small flex mb12"><span style="width:110px">Matched</span><div class="pbar flex1"><div class="fill green" style="width:${k.reconciliationPct}%"></div></div><b>${k.reconciliationPct}%</b></div>
            <div class="small flex"><span style="width:110px">Pending uploads</span><div class="pbar flex1"><div class="fill amber" style="width:${k.pending ? Math.min(100, k.pending / Math.max(1, k.totalMonitored) * 100 * 4) : 0}%"></div></div><b>${fmtN(k.pending)}</b></div>
          </div></div>
          <div class="panel"><div class="ph"><span class="t">WHAT CHANGED? (last 15 min)</span><span class="sub">live</span><span class="sp"></span><button class="btn sm ghost" data-go="whatchanged">Open →</button></div>
          <div class="pb"><div class="wc-grid" style="grid-template-columns:1fr 1fr 1fr">
            ${[['newIrevUploads', 'New IReV uploads'], ['changedDocuments', 'Changed documents'], ['unavailable', 'Currently unavailable'], ['newDiscrepancies', 'New discrepancies'], ['newIncidents', 'New incidents'], ['newSos', 'New SOS']].map(([key, label]) => `<div class="wc-card ${key === 'newDiscrepancies' || key === 'changedDocuments' || key === 'unavailable' ? (ir.whatChanged.cards[key] ? 'hot' : '') : ''}" data-go="${key === 'newIrevUploads' ? 'watchtower' : key === 'changedDocuments' || key === 'unavailable' ? 'irevchanges' : key === 'newDiscrepancies' ? 'irevrecon' : key === 'newIncidents' ? 'incidents' : 'sos'}"><div class="v">${fmtN(ir.whatChanged.cards[key])}</div><div class="l">${label}</div></div>`).join('')}
          </div></div></div>
        </div>
        <div class="panel"><div class="ph"><span class="t">CRITICAL ALERTS</span><span class="sub">IReV & operational</span></div>
        <div class="pb flat" style="max-height:220px;overflow:auto">${ir.alerts.length ? ir.alerts.slice(0, 6).map(a => `<div class="notif-item"><div class="n-t">${a.severity === 'CRITICAL' ? '🚨' : '⚠️'} <b>${esc(a.title)}</b><span class="n-p ${a.severity.toLowerCase()}">${esc(a.severity)}</span></div><div class="small mt8">${esc(a.note.slice(0, 110))}${a.caseId ? ` <a href="#" data-case="${a.caseId}">case →</a>` : ''}</div></div>`).join('') : '<div class="empty small">No critical alerts</div>'}</div></div>`;
      $$('[data-go]', irevRow).forEach(x => x.onclick = () => setTab(x.dataset.go));
      $$('[data-case]', irevRow).forEach(x => x.onclick = (e) => { e.preventDefault(); irevCaseModal(x.dataset.case); });
      // §61 rotating wall panels
    const rot = el(`<div class="panel"><div class="ph"><span class="t">COMMAND WALL — ROTATING PANELS</span><span class="sub">auto-rotates every 20s · click to pin a panel</span></div>
    <div class="pb flat" style="overflow:hidden"><div class="flex" id="rotstrip" style="gap:8px;overflow-x:auto"></div></div></div>`);
    shell.main.appendChild(rot);
    const rotPanels = [['map', 'National map'], ['watchtower', 'IReV Watchtower'], ['resultflow', 'Result progress'], ['incidents', 'Incident command'], ['irevrecon', 'Reconciliation'], ['health', 'System health']];
    let rotIdx = 0;
    const drawRot = () => {
      $('#rotstrip', rot).innerHTML = rotPanels.map(([id, l], i) => `<span class="pill ${i === rotIdx ? '' : 'dim'}" data-rot="${id}" style="cursor:pointer">${i === rotIdx ? '▶' : '·'} ${esc(l)}</span>`).join('');
      $$('[data-rot]', rot).forEach(x => x.onclick = () => { clearInterval(rotTimer); setTab(x.dataset.rot); });
    };
    drawRot();
    const rotTimer = setInterval(() => { rotIdx = (rotIdx + 1) % rotPanels.length; drawRot(); }, 20000);
    shell.main._rotTimer = rotTimer;
    const db = $('#irevdemo', irevRow);
      if (db) db.onclick = irevDemoPanel;
    }).catch(() => { irevRow.innerHTML = '<div class="panel"><div class="pb empty">IReV Watchtower unavailable.</div></div>'; });

    // SOS strip
    if (ov.sos.length) {
      const strip = el(`<div class="alert-strip">${ov.sos.map(s => `<div class="a" data-sos="${s.id}">🚨 ${esc(s.code)} — ${esc(s.category)} @ ${esc(s.lga)} · ${esc(s.status)}</div>`).join('')}</div>`);
      $$('[data-sos]', strip).forEach(x => x.onclick = () => sosModal(ov.sos.find(s => s.id === x.dataset.sos), { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }));
      shell.main.appendChild(strip);
    }

    const grid = el(`<div class="grid23">
      <div class="panel"><div class="ph"><span class="t">◈ KANO STATE COMMAND MAP</span><span class="sub">Live operational picture · click an LGA to drill</span><span class="sp"></span><button class="btn sm ghost" id="openmap">Full map →</button></div>
      <div class="pb flat" style="height:460px"><div id="cmdmap" style="width:100%;height:100%"></div></div></div>
      <div>
        <div class="panel"><div class="ph"><span class="t">INCIDENT FEED</span><span class="sub">live</span><span class="sp"></span><button class="btn sm ghost" data-tab="incidents">All →</button></div>
        <div class="pb flat"><div class="feed" id="incfeed"></div></div></div>
        <div class="panel mt12"><div class="ph"><span class="t">VERIFICATION QUEUE</span><span class="sub">oldest first</span></div>
        <div class="pb flat" style="max-height:220px;overflow:auto"><table class="tbl" id="qtable"></table></div></div>
      </div>
    </div>`);
    shell.main.appendChild(grid);
    $('[data-tab]', grid).onclick = () => setTab('incidents');
    $('#openmap', grid).onclick = () => setTab('map');

    // incident feed
    const feed = $('#incfeed', grid);
    feed.innerHTML = ov.incidents.length ? ov.incidents.map(i => `
      <div class="item" data-inc="${i.id}"><span class="t">${fmtWatShort(i.createdAt)}</span>
      <span class="tx">${sevBadge(i.severity)} <b>${esc(i.subcategory)}</b> — ${esc(i.lga)} · ${esc(i.puId || '')} <span class="dim">${statusBadge(i.status)}</span></span></div>`).join('')
      : '<div class="empty">No active incidents</div>';
    $$('[data-inc]', feed).forEach(x => x.onclick = () => incidentModal(ov.incidents.find(i => i.id === x.dataset.inc), { canManage: API.can('incidents.manage'), onChange: refresh }));

    // queue table
    const qt = $('#qtable', grid);
    qt.innerHTML = `<tr>${['PU', 'LGA', 'Election', 'Status', 'Flags'].map(h => `<th>${h}</th>`).join('')}</tr>` +
      ov.queue.slice(0, 10).map(s => `<tr class="clickable" data-sub="${s.id}"><td class="mono">${esc(s.puId)}</td><td>${esc(s.lga)}</td><td>${esc(s.election)}</td><td>${statusBadge(s.status)}</td><td>${s.anomalies.length ? `<span class="badge l3">${s.anomalies.length} ⚠</span>` : '—'}</td></tr>`).join('');
    $$('[data-sub]', qt).forEach(x => x.onclick = () => location.href = '/supervisor?sub=' + x.dataset.sub);

    // map
    map = createMap($('#cmdmap', grid), bootstrap, {});
    map.setData({ lgas: ov.lgas, incidents: ov.incidents, sos: ov.sos, streams: ov.streams, agents: ov.agentsOnMap });
    map.setLgaMetric(l => l.reportingPct);
    map.setSubStatus(lgaSubStatus());
    map.onClick(({ type, id, entity }) => {
      if (type === 'LGA') {
        const lg = ov.lgas.find(x => x.lgaId === id);
        if (lg) lgaSidePanel(lg);
      } else if (type === 'PU') { focusPu(id); }
      else if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
      else if (type === 'SOS') { const s = ov.sos.find(x => x.id === id); if (s) sosModal(s, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
    });

    // charts row
    const charts = el(`<div class="grid3">
      <div class="panel"><div class="ph"><span class="t">Result submissions per 30 min</span></div><div class="pb"><div class="chart-box" id="ch1"><span class="dim small">Loading…</span></div></div></div>
      <div class="panel"><div class="ph"><span class="t">Verification progress</span></div><div class="pb"><div class="chart-box" id="ch2"><span class="dim small">Loading…</span></div></div></div>
      <div class="panel"><div class="ph"><span class="t">Incidents per 30 min</span></div><div class="pb"><div class="chart-box" id="ch3"><span class="dim small">Loading…</span></div></div></div>
    </div>`);
    shell.main.appendChild(charts);
    loadCharts();

    // system alerts
    shell.main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">SYSTEM ALERTS & DATA-QUALITY FLAGS</span><span class="sub">neutral language by design — never automatic accusations</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>PU</th><th>LGA</th><th>Flags</th><th>Status</th><th>Submitted</th></tr>
      ${ov.anomalies.length ? ov.anomalies.map(a => `<tr class="clickable" data-sub="${a.id}"><td class="mono">${esc(a.puId)}</td><td>${esc(a.lga)}</td><td>${a.codes.map(c => `<span class="badge l3">⚠ ${esc(c)}</span>`).join(' ')}</td><td>${statusBadge(a.status)}</td><td>${fmtWatShort(a.submittedAt)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">No flags — all reviewed data consistent</td></tr>'}
      </table></div></div>`));
    $$('[data-sub]', shell.main).forEach(x => x.onclick = () => location.href = '/supervisor?sub=' + x.dataset.sub);
  }

  function lgaSidePanel(lg) {
    const pus = bootstrap.pus.filter(p => p.lgaId === lg.lgaId);
    const agents = bootstrap.agents.filter(a => a.lgaId === lg.lgaId);
    const incs = ov.incidents.filter(i => i.lgaId === lg.lgaId);
    const m = modal({
      title: `${lg.name} LGA — ${lg.senatorial}`,
      wide: true,
      body: () => el(`<div>
        <div class="kpis" style="grid-template-columns:repeat(5,1fr)">
          ${kpiCard('PUs', fmtN(lg.totalPu))}${kpiCard('Reported', fmtN(lg.submitted), { sub: lg.reportingPct + '%' })}${kpiCard('Verified', fmtN(lg.verified), { sub: lg.verifiedPct + '%' })}${kpiCard('Agents', `${lg.agentsOnline}/${lg.agents}`)}${kpiCard('Health', lg.healthScore + '/100', { cls: lg.healthScore > 70 ? 'ok' : lg.healthScore > 40 ? 'warn' : 'alert' })}
        </div>
        <div class="grid2">
          <div class="panel"><div class="ph"><span class="t">Wards</span></div><div class="pb flat"><table class="tbl"><tr><th>Ward</th><th>PUs</th><th>Reported</th><th>Score</th></tr>
          ${ov.wardHealth.filter(w => w.lgaId === lg.lgaId).map(w => `<tr><td>${esc(w.name)}</td><td class="num">${w.pus}</td><td class="num">${w.submitted}/${w.pus}</td><td class="num">${w.score}</td></tr>`).join('')}</table></div></div>
          <div class="panel"><div class="ph"><span class="t">Active incidents</span></div><div class="pb">${incs.length ? incs.map(i => `<div class="flex small mb12">${sevBadge(i.severity)} <span>${esc(i.subcategory)} @ ${esc(i.puId || '')} — ${statusBadge(i.status)}</span></div>`).join('') : '<div class="empty">None</div>'}</div></div>
        </div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
  }

  function focusPu(puId) {
    const pu = bootstrap.pus.find(p => p.id === puId);
    if (!pu) return;
    const subs = ov ? [] : [];
    API.get(`/api/results?limit=10`).then(() => {});
    modal({
      title: `${pu.code} — ${pu.name}`,
      body: () => el(`<div>
        <div class="small muted mb12">${esc(bootstrap.wards.find(w => w.id === pu.wardId)?.name || '')} · ${esc(bootstrap.lgas.find(l => l.id === pu.lgaId)?.name || '')} LGA · ${pu.lat}, ${pu.lon}</div>
        <div id="pudetail" class="small muted">Loading operational record…</div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get('/api/results?election=e-gov-2027&limit=100').then(res => {
      const subs = res.rows.filter(r => r.puId === puId);
      $('#pudetail').innerHTML = subs.length ? subs.map(s => `<div class="panel"><div class="ph"><span class="t">${esc(s.election)}</span></div><div class="pb small">
        ${statusBadge(s.status)} · ${fmtWatShort(s.submittedAt)} · ${s.anomalies?.length ? '⚠ flagged' : 'clean'}</div></div>`).join('') : 'No submissions recorded for this polling unit.';
    }).catch(() => { $('#pudetail').textContent = 'Could not load record.'; });
  }

  function trendData(key) {
    // derive from LGAs for sparklines
    const vals = ov.lgas.map(l => l[key]).filter(v => v != null);
    return vals.length > 12 ? vals.slice(0, 12) : vals;
  }
  function lgaSubStatus() {
    const st = {};
    for (const l of ov.lgas) {
      if (l.verifiedPct > 0) st[l.lgaId] = 'VERIFIED';
    }
    return st;
  }

  async function loadCharts() {
    try {
      const [subs, ver, incs] = await Promise.all([
        API.get('/api/analytics/timeseries?metric=submissions&bucket=30'),
        API.get('/api/analytics/timeseries?metric=verifications&bucket=30'),
        API.get('/api/analytics/timeseries?metric=incidents&bucket=30'),
      ]);
      const lbl = (s) => s.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
      const box1 = $('#ch1'); if (box1) box1.innerHTML = lineChart({ series: [{ data: subs.series.map(p => p.count) }], labels: lbl(subs), h: 150, color: '#38bdf8' });
      const box2 = $('#ch2'); if (box2) box2.innerHTML = lineChart({ series: [{ data: ver.series.map(p => p.count), color: '#22c55e' }], labels: lbl(ver), h: 150, color: '#22c55e' });
      const box3 = $('#ch3'); if (box3) box3.innerHTML = barChart({ data: incs.series.map(p => p.count), labels: lbl(incs), h: 150, color: '#fb923c' });
    } catch (e) { }
  }

  // ================= LIVE MAP (§6-8) =================
  function rMap(b) {
    let mapView = 'operational';
    const wrap = el(`<div>
      <div class="flex mb12">
        <div class="irev-seg" style="margin:0" id="mvseg">
          ${[['operational', '◎ OPERATIONAL'], ['results', '≡ RESULTS'], ['irev', '👁 IReV'], ['incidents', '⚠ INCIDENTS'], ['connectivity', '📶 CONNECTIVITY']].map(([id, l]) => `<span class="is ${id === 'operational' ? 'on' : ''}" data-v="${id}">${l}</span>`).join('')}
        </div>
        <span class="flex1"></span>
        <select class="inp" style="width:190px" id="metric">
          <option value="reportingPct">Reporting density</option>
          <option value="verifiedPct">Verification density</option>
          <option value="incidents">Open incidents</option>
          <option value="agentsOnline">Agents online</option>
          <option value="healthScore">Ward health score</option>
        </select>
        <button class="btn" id="clearDrill">⌂ Reset view</button>
      </div>
      <div class="map-wrap" style="height:calc(100vh - 210px)"><div id="bigmap" style="width:100%;height:100%"></div></div>
      <div class="small muted mt8" id="maptip">Operational view — click an LGA for its command panel, a PU for its record. Never overloaded: switch views instead of stacking markers.</div>
    </div>`);
    b.appendChild(wrap);
    map = createMap($('#bigmap', wrap), bootstrap, {});
    let irevRows = [];
    API.get('/api/irev/reconciliation').then(r => { irevRows = r.rows; applyMap(); }).catch(() => {});
    const applyMap = () => {
      const lgaStatus = {};
      for (const r of irevRows) {
        if (!lgaStatus[r.lgaId]) lgaStatus[r.lgaId] = { matched: 0, pending: 0, diff: 0, n: 0 };
        lgaStatus[r.lgaId].n++;
        if (r.status === 'MATCHED') lgaStatus[r.lgaId].matched++;
        else if (r.status === 'PENDING') lgaStatus[r.lgaId].pending++;
        else lgaStatus[r.lgaId].diff++;
      }
      const metric = $('#metric', wrap).value;
      if (mapView === 'irev') {
        map.setData({ lgas: ov.lgas, incidents: [], sos: [], streams: [], agents: [] });
        map.setLgaMetric(l => {
          const st2 = lgaStatus[l.lgaId];
          return st2 && st2.n ? Math.round(st2.matched / st2.n * 100) : 0;
        });
        $('#maptip', wrap).textContent = 'IReV view — LGA shading = reconciled (matched) share of observed records. Green = reconciled, red = differences dominate.';
      } else if (mapView === 'results') {
        map.setData({ lgas: ov.lgas, incidents: [], sos: [], streams: [], agents: [] });
        map.setLgaMetric(l => l[metric]);
        $('#maptip', wrap).textContent = 'Results view — shading follows the selected metric (reporting/verification/health).';
      } else if (mapView === 'incidents') {
        map.setData({ lgas: ov.lgas, incidents: ov.incidents, sos: ov.sos, streams: [], agents: [] });
        map.setLgaMetric(l => l.incidents);
        $('#maptip', wrap).textContent = 'Incident view — markers are active incidents and SOS; LGA shading = open incident count.';
      } else if (mapView === 'connectivity') {
        map.setData({ lgas: ov.lgas, incidents: [], sos: [], streams: [], agents: ov.agentsOnMap });
        map.setLgaMetric(l => l.agents ? Math.round(l.agentsOnline / l.agents * 100) : 0);
        $('#maptip', wrap).textContent = 'Connectivity view — green dots are online agents; LGA shading = online share.';
      } else {
        map.setData({ lgas: ov.lgas, incidents: ov.incidents, sos: ov.sos, streams: ov.streams, agents: ov.agentsOnMap });
        map.setLgaMetric(l => l[metric]);
        $('#maptip', wrap).textContent = 'Operational view — full situational layer. Click an LGA for its command panel.';
      }
    };
    $$('#mvseg .is', wrap).forEach(x => x.onclick = () => { mapView = x.dataset.v; $$('#mvseg .is', wrap).forEach(y => y.classList.remove('on')); x.classList.add('on'); applyMap(); });
    $('#metric', wrap).onchange = applyMap;
    $('#clearDrill', wrap).onclick = () => map.reset();
    map.onClick(({ type, id }) => {
      if (type === 'LGA') { const lg = ov.lgas.find(x => x.lgaId === id); if (lg) lgaSidePanel(lg); }
      else if (type === 'PU') focusPu(id);
      else if (type === 'INCIDENT') { const i = ov.incidents.find(x => x.id === id); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
      else if (type === 'SOS') { const s2 = ov.sos.find(x => x.id === id); if (s2) sosModal(s2, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
    });
    applyMap();
    if (qs.get('focus')) {
      const f = qs.get('focus');
      if (f.startsWith('PU:')) { const pu = bootstrap.pus.find(p => p.id === f.slice(3)); if (pu) map.zoomToLga(pu.lgaId); }
      else map.zoomToLga(f);
    }
  }

  // ================= SENATORIAL =================
  function rSenatorial() {
    const sen = ov.senatorial;
    shell.main.appendChild(el(`<div class="kpis">
      ${kpiCard('Districts', '3', { sub: 'Kano Central · North · South' })}
      ${kpiCard('State reporting', ov.kpis.reportingPct + '%', { sub: fmtN(ov.kpis.submittedPu) + ' / ' + fmtN(ov.kpis.totalPu) + ' PUs', cls: 'accent' })}
      ${kpiCard('State verified', ov.kpis.verifiedPct + '%', { sub: fmtN(ov.kpis.verifiedPu) + ' PUs', cls: 'ok' })}
      ${kpiCard('Open incidents', fmtN(ov.kpis.activeIncidents), { sub: fmtN(ov.kpis.criticalIncidents) + ' critical', cls: ov.kpis.criticalIncidents ? 'alert' : '' })}
    </div>`));
    const grid = el('<div class="grid3"></div>');
    for (const sd of sen) {
      const card = el(`<div class="panel">
        <div class="ph"><span class="t">⬡ ${esc(sd.name).toUpperCase()}</span><span class="sp"></span><a href="/senatorial" class="small">Open portal →</a></div>
        <div class="pb">
          <div class="small muted mb12">${fmtN(sd.submitted)} / ${fmtN(sd.totalPu)} PUs reported · ${fmtN(sd.verified)} verified</div>
          <div class="small flex mb12"><span style="width:90px">Reporting</span><div class="pbar flex1"><div class="fill" style="width:${sd.reportingPct}%"></div></div><b>${sd.reportingPct}%</b></div>
          <div class="small flex mb12"><span style="width:90px">Verified</span><div class="pbar flex1"><div class="fill green" style="width:${sd.reportingPct ? Math.round(sd.verified / sd.totalPu * 100) : 0}%"></div></div><b>${Math.round(sd.verified / Math.max(1, sd.totalPu) * 100)}%</b></div>
          <div class="small flex mb12"><span style="width:90px">Queue</span><b>${fmtN(sd.pending)}</b><span class="dim">pending</span></div>
          <div class="small flex mb12"><span style="width:90px">Incidents</span><b>${fmtN(sd.incidents)}</b><span class="dim">open</span></div>
          <div class="small flex"><span style="width:90px">SOS</span><b style="color:${sd.sos ? '#f87171' : ''}">${fmtN(sd.sos)}</b><span class="dim">active</span></div>
          <hr class="soft">
          <div class="small dim">LGAs: ${ov.lgas.filter(l => l.senatorial === sd.name).map(l => esc(l.name)).join(' · ')}</div>
        </div>
      </div>`);
      grid.appendChild(card);
    }
    shell.main.appendChild(grid);
  }

  // ================= LG MONITOR =================
  function rLg() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">LG OPERATIONAL MONITOR</span><span class="sub">all 44 LGAs · live</span><span class="sp"></span><button class="btn sm ghost" id="exp">Export CSV</button></div>
    <div class="pb flat" id="lgtbl"></div></div>`);
    shell.main.appendChild(wrap);
    const t = dataTable({
      cols: [
        { label: 'LGA', key: 'name' }, { label: 'District', key: 'senatorial' },
        { label: 'PUs', key: 'totalPu', cls: 'num' }, { label: 'Reported', key: 'submitted', cls: 'num' },
        { label: 'Reporting', key: 'reportingPct', cls: 'num', render: r => `<div class="pbar" style="width:90px"><div class="fill" style="width:${r.reportingPct}%"></div></div> <span>${r.reportingPct}%</span>` },
        { label: 'Verified', key: 'verified', cls: 'num', render: r => `${r.verified} (${r.verifiedPct}%)` },
        { label: 'Agents', key: 'agentsOnline', cls: 'num', render: r => `${r.agentsOnline}/${r.agents}` },
        { label: 'Incidents', key: 'incidents', cls: 'num', render: r => r.incidents ? `<span style="color:#fbbf24">${r.incidents}</span>` : '0' },
        { label: 'SOS', key: 'sos', cls: 'num', render: r => r.sos ? `<span style="color:#f87171">🚨 ${r.sos}</span>` : '—' },
        { label: 'Streams', key: 'streams', cls: 'num', render: r => r.streams ? `<span style="color:#4ade80">● ${r.streams}</span>` : '—' },
        { label: 'Health', key: 'healthScore', cls: 'num', render: r => `<b style="color:${r.healthScore > 70 ? '#4ade80' : r.healthScore > 40 ? '#fbbf24' : '#f87171'}">${r.healthScore}</b>` },
      ],
      rows: ov.lgas, sortable: true, pageSize: 44,
    });
    $('#lgtbl', wrap).appendChild(t.el);
    $('#exp', wrap).onclick = () => window.open('/api/export?type=results&format=csv', '_blank');
  }

  // ================= RESULTS =================
  function rResults() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">ALL RESULT SUBMISSIONS</span><span class="sp"></span>
      <select class="inp" style="width:150px" id="rStatus"><option value="">All statuses</option>${['UNVERIFIED', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'DISPUTED'].map(s => `<option>${s}</option>`).join('')}</select>
      <select class="inp" style="width:170px" id="rLga"><option value="">All LGAs</option>${bootstrap.lgas.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      <input class="inp" style="width:170px" id="rQ" placeholder="Search PU / agent…">
      <button class="btn sm" id="rExport">Export</button>
    </div><div class="pb flat" id="rbody"></div></div>`);
    shell.main.appendChild(wrap);
    const load = debounce(async () => {
      const p = new URLSearchParams({ election: 'e-gov-2027', limit: '200' });
      if ($('#rStatus', wrap).value) p.set('status', $('#rStatus', wrap).value);
      if ($('#rLga', wrap).value) p.set('lga', $('#rLga', wrap).value);
      if ($('#rQ', wrap).value) p.set('q', $('#rQ', wrap).value);
      const res = await API.get('/api/results?' + p.toString());
      const t = dataTable({
        cols: [
          { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'Ward', key: 'ward' }, { label: 'LGA', key: 'lga' },
          { label: 'Agent', key: 'agent' }, { label: 'Registered', key: 'registered', cls: 'num' },
          { label: 'Accredited', key: 'accredited', cls: 'num' }, { label: 'Valid', key: 'validVotes', cls: 'num' },
          { label: 'Rejected', key: 'rejected', cls: 'num' }, { label: 'Status', key: 'status', render: r => statusBadge(r.status) },
          { label: 'Flags', key: 'anomalies', render: r => r.anomalies?.length ? `<span class="badge l3">⚠ ${r.anomalies.length}</span>` : '—' },
          { label: 'Submitted (WAT)', key: 'submittedAt', render: r => fmtWatShort(r.submittedAt) },
        ],
        rows: res.rows, sortable: true, pageSize: 25,
        onRow: (r) => location.href = '/supervisor?sub=' + r.id,
      });
      t.setTitle(`${res.total} submissions · Governorship`);
      $('#rbody', wrap).innerHTML = ''; $('#rbody', wrap).appendChild(t.el);
    }, 300);
    ['rStatus', 'rLga', 'rQ'].forEach(id => $('#' + id, wrap).addEventListener('input', load));
    $('#rExport', wrap).onclick = () => window.open('/api/export?type=results&format=xlsx', '_blank');
    load();
  }

  // ================= INCIDENTS =================
  function rIncidents() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">INCIDENT MANAGEMENT</span><span class="sp"></span>
      <select class="inp" style="width:150px" id="iStatus"><option value="">All</option>${['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED', 'DISPUTED'].map(s => `<option>${s}</option>`).join('')}</select>
      <select class="inp" style="width:130px" id="iSev"><option value="">All levels</option><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>
    </div><div class="pb flat" id="ibody"></div></div>`);
    shell.main.appendChild(wrap);
    const load = debounce(async () => {
      const p = new URLSearchParams({ limit: '150' });
      if ($('#iStatus', wrap).value) p.set('status', $('#iStatus', wrap).value);
      if ($('#iSev', wrap).value) p.set('severity', $('#iSev', wrap).value);
      const res = await API.get('/api/incidents?' + p.toString());
      const t = dataTable({
        cols: [
          { label: 'ID', key: 'code', cls: 'mono' }, { label: 'Level', key: 'severity', render: r => sevBadge(r.severity) },
          { label: 'Category', key: 'subcategory' }, { label: 'LGA', key: 'lga' }, { label: 'PU', key: 'puId', cls: 'mono' },
          { label: 'Status', key: 'status', render: r => statusBadge(r.status) },
          { label: 'Description', key: 'description', cls: 'wrap', render: r => `<span class="muted small">${esc((r.description || '').slice(0, 140))}${r.description && r.description.length > 140 ? '…' : ''}</span>` },
          { label: 'Reported', key: 'createdAt', render: r => fmtWatShort(r.createdAt) },
        ],
        rows: res.rows, sortable: true, pageSize: 20,
        onRow: (r) => incidentModal(r, { canManage: API.can('incidents.manage'), onChange: load }),
      });
      t.setTitle(`${res.total} incidents`);
      $('#ibody', wrap).innerHTML = ''; $('#ibody', wrap).appendChild(t.el);
    }, 300);
    ['iStatus', 'iSev'].forEach(id => $('#' + id, wrap).addEventListener('input', load));
    load();
  }

  // ================= SOS =================
  function rSos() {
    const wrap = el('<div id="soswrap"></div>');
    shell.main.appendChild(wrap);
    async function load() {
      const res = await API.get('/api/sos');
      wrap.innerHTML = `<div class="alert-strip">${res.rows.filter(s => s.status !== 'RESOLVED').map(s => `<div class="a" data-sos="${s.id}">🚨 ${esc(s.code)} — ${esc(s.category)} @ ${esc(s.lga)} · ${esc(s.status)}</div>`).join('') || '<span class="dim">No active SOS</span>'}</div>
      <div class="panel"><div class="ph"><span class="t">SOS EVENT LOG</span><span class="sub">complete escalation audit trail</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Code</th><th>Category</th><th>PU</th><th>LGA</th><th>Status</th><th>Triggered</th><th>Acknowledgements</th></tr>
      ${res.rows.map(s => `<tr class="clickable" data-sos="${s.id}"><td class="mono">${esc(s.code)}</td><td>${esc(s.category)}</td><td class="mono">${esc(s.puId)}</td><td>${esc(s.lga)}</td><td>${statusBadge(s.status)}</td><td>${fmtWatShort(s.createdAt)}</td><td>${(s.acks || []).length} ✓</td></tr>`).join('')}</table></div></div>`;
      $$('[data-sos]', wrap).forEach(x => x.onclick = () => sosModal(res.rows.find(s => s.id === x.dataset.sos), { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: load }));
    }
    load();
  }

  // ================= LIVE WALL =================
  function rWall() {
    let vFilter = 'ALL';
    const wrap = el(`<div>
      <div class="flex mb12">
        <span class="pill">COMMAND-CENTRE VIDEO WALL</span><span class="dim small">Simulated feeds — production uses signed HLS/WebRTC URLs · only authorized streams are accessible</span>
        <span class="flex1"></span>
        ${[2, 3, 4].map(g => `<button class="btn sm ${wallGrid === g ? 'primary' : ''}" data-grid="${g}">${g}×${g}</button>`).join('')}
        <button class="btn sm" id="fullscreen">⛶ Fullscreen</button>
      </div>
      <div class="flex mb12" style="flex-wrap:wrap">
        <span class="small dim">Priority filter:</span>
        ${[['ALL', 'All Live'], ['INCIDENT', 'Active Incident LGA'], ['SOS', 'SOS LGA'], ['LOWCONN', 'Low Connectivity'], ['PINNED', 'Pinned']].map(([id, l]) => `<button class="btn sm ${vFilter === id ? 'primary' : ''}" data-vf="${id}">${l}</button>`).join('')}
        <span class="small dim right">A stream near an incident is never automatically interpreted as evidence of misconduct.</span>
      </div>
      <div class="vwall g${wallGrid}" id="wall"></div>
    </div>`);
    shell.main.appendChild(wrap);
    async function load() {
      const res = await API.get('/api/streams');
      const wall = $('#wall', wrap);
      let live = [...res.live.filter(s => s.pinned), ...res.live.filter(s => !s.pinned)];
      if (vFilter === 'PINNED') live = live.filter(s => s.pinned);
      if (vFilter === 'INCIDENT') {
        const hotLgas = new Set(ov.incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).map(i => i.lgaId));
        live = live.filter(s => hotLgas.has(s.lgaId));
      }
      if (vFilter === 'SOS') {
        const sosLgas = new Set(ov.sos.filter(x => x.status !== 'RESOLVED').map(x => x.lgaId));
        live = live.filter(s => sosLgas.has(s.lgaId));
      }
      if (vFilter === 'LOWCONN') {
        const low = new Set(ov.lgas.filter(l => l.agents && l.agentsOnline / l.agents < 0.6).map(l => l.lgaId));
        live = live.filter(s => low.has(s.lgaId));
      }
      wall.innerHTML = live.length ? live.map(s => `
        <div class="vcard" data-stream="${s.id}">
          <canvas width="480" height="300"></canvas>
          <div class="vh"></div>
          <div class="vinfo"><b>${esc(s.puId)}</b><br>${esc(s.puName || '')}<br>${esc(s.lga)} LGA · ${esc(s.agentName)}</div>
          <div class="vstatus live">● LIVE</div>
          <button class="vpin ${s.pinned ? 'on' : ''}" data-pin="${s.id}" title="Pin feed">📌</button>
        </div>`).join('') : `<div class="empty" style="grid-column:1/-1">No live streams at the moment — streams appear as agents broadcast.</div>`;
      $$('.vcard', wall).forEach(card => {
        const cv = $('canvas', card);
        const s = live.find(x => x.id === card.dataset.stream);
        startSimStream(cv, { pu: s.puId, lga: s.lga, ward: '', bitrate: s.bitrateKbps, fps: s.fps, viewers: s.viewers, t: ov.sim.now });
        $('[data-pin]', card).onclick = async (e) => {
          e.stopPropagation();
          await API.post(`/api/streams/${s.id}/pin`, {});
          load();
        };
      });
    }
    $$('[data-vf]', wrap).forEach(b2 => b2.onclick = () => { vFilter = b2.dataset.vf; $$('[data-vf]', wrap).forEach(x => x.classList.remove('primary')); b2.classList.add('primary'); load(); });
    $$('[data-grid]', wrap).forEach(b => b.onclick = () => { wallGrid = +b.dataset.grid; render(); });
    $('#fullscreen', wrap).onclick = () => { const w = $('#wall', wrap); if (document.fullscreenElement) document.exitFullscreen(); else w.closest('.panel') ? w.requestFullscreen() : w.requestFullscreen(); };
    load();
  }

  // ================= INTELLIGENCE =================
  function rIntel() {
    const wrap = el(`<div class="grid23">
      <div class="panel" style="display:flex;flex-direction:column;height:calc(100vh - 170px)">
        <div class="ph"><span class="t">✧ SITUATION ROOM INTELLIGENCE ASSISTANT</span><span class="sub">rule-based · every answer carries a data-provenance label</span></div>
        <div class="pb" id="chat" style="flex:1;overflow-y:auto"></div>
        <div class="pb" style="border-top:1px solid var(--line)"><div class="row">
          <input class="inp grow" id="cq" placeholder='Try: "Generate the 30-minute situation-room briefing" or "critical incidents in Kano North"'>
          <button class="btn primary" id="cbtn">Ask</button>
        </div></div>
      </div>
      <div>
        <div class="panel"><div class="ph"><span class="t">INTELLIGENCE PRINCIPLES</span></div>
        <div class="pb small muted">The platform separates <b>RAW DATA</b>, <b>VERIFIED DATA</b>, <b>DERIVED DATA</b>, <b>ANALYTICAL INSIGHT</b> and <b>HUMAN ASSESSMENT</b>. Categories are never mixed. No automatic fraud conclusions exist.</div></div>
        <div class="panel"><div class="ph"><span class="t">FLAGGED FOR HUMAN REVIEW</span><span class="sub">statistical anomalies</span></div>
        <div class="pb flat" style="max-height:300px;overflow:auto"><table class="tbl"><tr><th>PU</th><th>Flags</th><th>Status</th></tr>
        ${ov.anomalies.map(a => `<tr class="clickable" data-sub="${a.id}"><td class="mono">${esc(a.puId)}</td><td>${a.codes.map(c => `<span class="badge l3">${esc(c)}</span>`).join(' ')}</td><td>${statusBadge(a.status)}</td></tr>`).join('')}</table></div></div>
        <div class="panel"><div class="ph"><span class="t">REPORTING GAPS</span></div>
        <div class="pb small" id="gaps">Loading…</div></div>
      </div>
    </div>`);
    shell.main.appendChild(wrap);
    const chat = $('#chat', wrap);
    chat.innerHTML = `<div class="item"><span class="t">COPILOT</span><span class="tx">Ready. Ask about incidents, reporting gaps, verification backlog, LG performance, or generate a briefing.</span></div>`;
    async function ask(q) {
      chat.appendChild(el(`<div class="item"><span class="t">YOU</span><span class="tx">${esc(q)}</span></div>`));
      const res = await API.post('/api/copilot', { query: q });
      const it = el(`<div class="item"><span class="t">COPILOT</span><span class="tx" style="flex:1"></span></div>`);
      $('.tx', it).innerHTML = mdToHtml(res.answer);
      chat.appendChild(it);
      if (res.sections) {
        const labels = { FACT: 'FACT', VERIFIED_DATA: 'VERIFIED', UNVERIFIED_REPORT: 'UNVERIFIED', DERIVED_DATA: 'DERIVED', SYSTEM_INFERENCE: 'INFERENCE', HUMAN_ASSESSMENT: 'HUMAN' };
        chat.appendChild(el(`<div class="item"><span class="t">SOURCE</span><span class="tx">${res.sections.map(s => `<span class="badge s-submitted">${labels[s.provenance] || s.provenance}</span>`).join(' ')} <span class="dim small">— data categories are never mixed</span></span></div>`));
      }
      chat.scrollTop = chat.scrollHeight;
    }
    $('#cbtn', wrap).onclick = () => { const q = $('#cq', wrap).value.trim(); if (q) ask(q); };
    $('#cq', wrap).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cbtn', wrap).click(); });
    // reporting gaps
    const gaps = ov.lgas.filter(l => l.reportingPct < 60).sort((a, b) => a.reportingPct - b.reportingPct).slice(0, 6);
    $('#gaps', wrap).innerHTML = gaps.length ? gaps.map(l => `<div class="flex mb12"><b style="width:130px">${esc(l.name)}</b><div class="pbar flex1"><div class="fill amber" style="width:${l.reportingPct}%"></div></div><b>${l.reportingPct}%</b></div>`).join('') : '<span class="dim">No significant reporting gaps.</span>';
  }

  // ================= ANALYTICS =================
  function rAnalytics() {
    const wrap = el(`<div>
      <div class="grid3" id="anlgrid"><span class="dim small">Loading…</span></div>
      <div class="panel mt12"><div class="ph"><span class="t">CONNECTIVITY HEATMAP</span><span class="sub">agent online share per LGA</span></div>
      <div class="pb flat" style="height:440px"><div id="heatmap" style="width:100%;height:100%"></div></div></div>
    </div>`);
    shell.main.appendChild(wrap);
    (async () => {
      const [subs, ver, incs, sos, chk] = await Promise.all([
        API.get('/api/analytics/timeseries?metric=submissions&bucket=30'), API.get('/api/analytics/timeseries?metric=verifications&bucket=30'),
        API.get('/api/analytics/timeseries?metric=incidents&bucket=30'), API.get('/api/analytics/timeseries?metric=sos&bucket=30'),
        API.get('/api/analytics/timeseries?metric=checkins&bucket=30'),
      ]);
      const lbl = (s) => s.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
      const card = (t, inner, foot) => `<div class="panel"><div class="ph"><span class="t">${t}</span><span class="sub">${foot}</span></div><div class="pb chart-box">${inner}</div></div>`;
      $('#anlgrid', wrap).innerHTML =
        card('Reports per hour', lineChart({ series: [{ data: subs.series.map(p => p.count) }], labels: lbl(subs), h: 160 }), '30-min buckets · WAT') +
        card('Verification rate', lineChart({ series: [{ data: ver.series.map(p => p.count), color: '#22c55e' }], labels: lbl(ver), h: 160, color: '#22c55e' }), 'reviews completed') +
        card('Incident activity', barChart({ data: incs.series.map(p => p.count), labels: lbl(incs), h: 160, color: '#fb923c' }), 'per 30 min') +
        card('SOS activity', barChart({ data: sos.series.map(p => p.count), labels: lbl(sos), h: 160, color: '#ef4444' }), 'per 30 min') +
        card('Agent check-ins', lineChart({ series: [{ data: chk.series.map(p => p.count), color: '#a78bfa' }], labels: lbl(chk), h: 160, color: '#a78bfa' }), 'duty activation');
      // heatmap
      const hm = await API.get('/api/analytics/heatmap?metric=connectivity');
      const m2 = createMap($('#heatmap', wrap), bootstrap, {});
      m2.setData({ lgas: ov.lgas });
      m2.setLgaMetric(l => { const r = hm.rows.find(x => x.lgaId === l.lgaId); return r ? r.value : 0; });
    })();
  }

  // ================= VERIFICATION =================
  function rVerify() {
    const wrap = el(`<div>
      <div class="kpis">${kpiCard('Queue', fmtN(ov.kpis.pending), { cls: 'warn', sub: 'awaiting review' })}${kpiCard('Verified today', fmtN(ov.kpis.verifiedPu), { cls: 'ok', sub: 'polling units' })}${kpiCard('Rejected', fmtN(ov.kpis.rejected))}${kpiCard('Anomalies', fmtN(ov.kpis.anomalies), { sub: 'human review required' })}</div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">REVIEW QUEUE</span><span class="sub">open in the Verification Portal</span></div>
        <div class="pb flat" style="max-height:420px;overflow:auto"><table class="tbl"><tr><th>PU</th><th>LGA</th><th>Election</th><th>Age</th><th>Flags</th></tr>
        ${ov.queue.slice(0, 15).map(s => `<tr class="clickable" data-sub="${s.id}"><td class="mono">${esc(s.puId)}</td><td>${esc(s.lga)}</td><td>${esc(s.election)}</td><td>${timeAgoWat(s.submittedAt, ov.sim.now)}</td><td>${s.anomalies.length ? `<span class="badge l3">⚠</span>` : ''}</td></tr>`).join('')}</table></div></div>
        <div class="panel"><div class="ph"><span class="t">CORRECTIONS & OVERRIDES</span><span class="sub">four-eyes principle enforced</span></div>
        <div class="pb" id="changes"><span class="dim small">Loading…</span></div></div>
      </div>
    </div>`);
    shell.main.appendChild(wrap);
    $$('[data-sub]', wrap).forEach(x => x.onclick = () => location.href = '/supervisor?sub=' + x.dataset.sub);
    API.get('/api/export?type=verification&format=json').then(revs => {
      $('#changes', wrap).innerHTML = `<div class="small muted mb12">${revs.length} reviews logged. Result corrections never overwrite the original — they create <b>VERSION 1 → VERSION 2 → …</b> with full audit trail. Both reviewers' identities and timestamps are preserved.</div>
      <table class="tbl"><tr><th>PU</th><th>Reviewer</th><th>Action</th><th>Reason</th></tr>
      ${revs.filter(r => ['REJECT', 'DISPUTE', 'FLAG_SECOND_REVIEW'].includes(r.action)).slice(0, 10).map(r => `<tr><td class="mono">${esc(r.pu)}</td><td>${esc(r.reviewer)}</td><td>${statusBadge(r.action)}</td><td class="small muted">${esc(r.reason || '—')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No rejections or disputes yet</td></tr>'}</table>`;
    });
  }

  // ================= REPORTS =================
  function rReports() {
    const wrap = el(`<div class="flex mb12">
      <select class="inp" style="width:220px" id="repScope"><option value="state">State SITREP — Kano State</option>${ov.senatorial.map(s => `<option value="senatorial:${s.name}">Senatorial SITREP — ${s.name}</option>`).join('')}${ov.lgas.map(l => `<option value="lg:${l.name}">LG SITREP — ${l.name}</option>`).join('')}</select>
      <button class="btn primary" id="repGen">Generate SITREP</button>
      <span class="flex1"></span>
      <span class="small dim">Exports: JSON · CSV · Excel (XLSX) · Print/PDF — all exports are audit-logged</span>
    </div>
    <div id="repout"></div>`);
    shell.main.appendChild(wrap);
    $('#repGen', wrap).onclick = async () => {
      const v = $('#repScope', wrap).value;
      const [scope, ref] = v.split(':');
      const s = await API.get(`/api/reports/sitrep?scope=${scope}&ref=${encodeURIComponent(ref || '')}`);
      const out = $('#repout', wrap);
      out.innerHTML = renderSitrep(s, ref ? `${scope.toUpperCase()} · ${ref}` : 'STATEWIDE');
      $$('[data-exp]', out).forEach(b => b.onclick = () => window.open(`/api/export?type=sitrep&format=${b.dataset.exp}`, '_blank'));
    };
    $('#repGen', wrap).click();
  }

  // ================= AUDIT =================
  function rAudit() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">◉ IMMUTABLE AUDIT CENTRE</span><span class="sub">every action: user · object · timestamp · IP · device</span><span class="sp"></span>
      <input class="inp" style="width:200px" id="aQ" placeholder="Search action / user / object…">
      <button class="btn sm" id="aExp">Export</button>
    </div><div class="pb flat" id="abody"></div></div>`);
    shell.main.appendChild(wrap);
    const load = debounce(async () => {
      const res = await API.get('/api/audit?limit=150&q=' + encodeURIComponent($('#aQ', wrap).value));
      const t = dataTable({
        cols: [
          { label: 'Time (WAT)', key: 'createdAt', render: r => `<span class="mono small">${fmtWat(r.createdAt)}</span>` },
          { label: 'User', key: 'username', render: r => r.username === 'system' ? `<span class="dim">system</span>` : r.username },
          { label: 'Action', key: 'action', render: r => `<span class="badge s-submitted">${esc(r.action)}</span>` },
          { label: 'Object', key: 'objectType', render: r => esc(r.objectType) + (r.objectId ? ` <span class="mono small">${esc(r.objectId.slice(0, 14))}</span>` : '') },
          { label: 'Detail', key: 'detail', render: r => `<span class="muted small">${esc((r.detail || '').slice(0, 70))}</span>` },
          { label: 'IP', key: 'ip', cls: 'mono' },
        ],
        rows: res.rows, sortable: true, pageSize: 30,
      });
      t.setTitle(`${res.total} audit records`);
      $('#abody', wrap).innerHTML = ''; $('#abody', wrap).appendChild(t.el);
    }, 300);
    $('#aQ', wrap).addEventListener('input', load);
    $('#aExp', wrap).onclick = () => window.open('/api/export?type=audit&format=csv', '_blank');
    load();
  }

  // ================= SYSTEM HEALTH =================
  function rHealth() {
    const wrap = el('<div id="hwrap"><span class="dim small">Loading…</span></div>');
    shell.main.appendChild(wrap);
    async function load() {
      const h = await API.get('/api/system/health');
      const svc = (n, v) => `<div class="kpi ${v === 'HEALTHY' ? 'ok' : v === 'CRITICAL' ? 'alert' : 'warn'}"><div class="l">${n}</div><div class="v" style="font-size:15px">${v}</div></div>`;
      wrap.innerHTML = `<div class="kpis">${svc('API', h.api)}${svc('Database', h.db)}${svc('Storage', h.storage)}${svc('Queue', h.queue)}${svc('WebSocket', h.websocket)}${svc('Video service', h.video)}${svc('SMS gateway', h.sms)}${svc('Notifications', h.notification)}</div>
      <div class="grid3">
        <div class="panel"><div class="ph"><span class="t">Server CPU</span></div><div class="pb"><div class="pbar"><div class="fill" style="width:${h.cpu}%"></div></div><b class="mono">${Math.round(h.cpu)}%</b></div></div>
        <div class="panel"><div class="ph"><span class="t">Memory</span></div><div class="pb"><div class="pbar"><div class="fill green" style="width:${h.memory}%"></div></div><b class="mono">${Math.round(h.memory)}%</b></div></div>
        <div class="panel"><div class="ph"><span class="t">API latency</span></div><div class="pb"><div class="pbar"><div class="fill amber" style="width:${Math.min(100, h.responseMs)}%"></div></div><b class="mono">${Math.round(h.responseMs)}ms</b> · error rate ${h.errorRate}%</div></div>
      </div>
      <div class="panel"><div class="ph"><span class="t">DISASTER RECOVERY POSTURE</span><span class="sub">configured targets</span></div>
      <div class="pb small">
        <div class="flex mb12"><span class="pill">RPO: 5 minutes</span><span class="pill">RTO: 30 minutes</span><span class="pill">Automated backups: hourly</span><span class="pill">DB replication: async standby</span><span class="pill">Object storage replication: cross-region</span><span class="pill">Backup verification: daily restore test</span></div>
        <div class="muted">Evidence objects are immutable; retention favours archival over deletion. Critical election evidence is never casually deleted.</div>
      </div></div>`;
    }
    load();
  }

  // ==================== CENTRAL 2.0 NEW VIEWS ====================
  // ---- Master System Status (§80) + Operational Health (§5) helpers ----
  function masterStatusStrip(h) {
    const chip = (label, status) => {
      const col = status === 'HEALTHY' || status === 'OPERATIONAL' || status === 'CONNECTED' || status === 'MONITORING' || status === 'NORMAL' ? '#4ade80' : status === 'DEGRADED' ? '#fbbf24' : '#f87171';
      return `<span class="pill" style="border-color:${col}"><span style="color:${col}">●</span> ${esc(label)}: <b style="color:${col}">${esc(status)}</b></span>`;
    };
    return `<div class="panel" style="margin-bottom:12px"><div class="ph"><span class="t">MASTER SYSTEM STATUS</span><span class="sub">${esc(h.mode || 'ELECTION_DAY')} MODE</span><span class="sp"></span>
      ${['PRE_ELECTION', 'ELECTION_DAY', 'POST_ELECTION'].map(m => `<button class="btn sm ${h.mode === m ? 'primary' : ''}" data-mode="${m}" ${API.can('admin.config') ? '' : 'disabled'}>${m.replace('_', ' ')}</button>`).join('')}
      </div>
      <div class="pb"><div class="flex" style="flex-wrap:wrap;gap:8px">
        ${chip('SYSTEM', h.score >= 85 ? 'OPERATIONAL' : 'WATCH')}
        ${chip('IReV', h.sources.find(x => x.name === 'IReV WATCHTOWER')?.status || 'MONITORING')}
        ${chip('FIELD NETWORK', h.sources.find(x => x.name === 'AGENT NETWORK')?.status || 'CONNECTED')}
        ${chip('DATABASE', h.sources.find(x => x.name === 'DATABASE')?.status || 'HEALTHY')}
        ${chip('EVIDENCE STORE', h.sources.find(x => x.name === 'STORAGE')?.status || 'HEALTHY')}
        ${chip('SECURITY', 'NORMAL')}
      </div></div></div>`;
  }
  function centralHealthHero(b) {
    API.get('/api/central/health').then(h => {
      const scoreColor = h.score >= 85 ? '#4ade80' : h.score >= 65 ? '#fbbf24' : h.score >= 45 ? '#fb923c' : '#f87171';
      b.appendChild(el(masterStatusStrip(h)));
      $$('[data-mode]', b).forEach(x => x.onclick = async () => { await API.post('/api/central/mode', { mode: x.dataset.mode }); toast('Mode changed', 'Interface re-prioritized: ' + x.dataset.mode.replace('_', ' ')); refresh(); render(); });
      const hero = el(`<div class="panel"><div class="ph"><span class="t">CENTRAL OPERATIONAL HEALTH</span><span class="sub">explainable — operational completeness, never a political measure</span><span class="sp"></span>${statusBadge(h.status)}</div>
      <div class="pb"><div class="health-hero">
        <div class="health-score"><div class="hs-ring" style="color:${scoreColor}">${h.score}%</div><div class="hs-lbl">${h.status}</div></div>
        <div class="health-bars">${h.components.map(c => `<div class="hb" data-go="${c.target}" style="cursor:pointer" title="Open underlying metrics"><span class="k">${esc(c.k)}</span><div class="pbar flex1"><div class="fill ${c.v >= 80 ? 'green' : c.v >= 50 ? 'amber' : 'red'}" style="width:${Math.min(100, c.v)}%"></div></div><span class="v">${Math.round(Math.min(100, c.v))}%</span></div>`).join('')}
        </div>
      </div></div></div>`);
      $$('.hb', hero).forEach(x => x.onclick = () => setTab(x.dataset.go));
      b.appendChild(hero);
      // mode banner
      const modeText = h.mode === 'ELECTION_DAY' ? 'ELECTION DAY MODE — priority order: SOS → critical incidents → IReV changes → reconciliation → reporting gaps → verification backlog → connectivity → system health' : h.mode === 'PRE_ELECTION' ? 'PRE-ELECTION MODE — readiness focus: agent & device readiness, coverage, training, connectivity tests, LG & senatorial readiness' : 'POST-ELECTION MODE — reconciliation, evidence preservation, dispute management, IReV version monitoring, incident closure, audit & archive';
      b.appendChild(el(`<div class="demo-banner" style="border-color:${h.mode === 'ELECTION_DAY' ? '#7f1d1d' : h.mode === 'PRE_ELECTION' ? '#14532d' : '#155e75'}">${esc(modeText)}</div>`));
    }).catch(() => {});
  }
  // ---- Live Event Feed (§9) ----
  function rFeed(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">LIVE OPERATIONS FEED</span><span class="sub">every event is clickable · merged from all engines</span><span class="sp"></span>
      <select class="inp" style="width:160px" id="ftype"><option value="">All event types</option></select>
    </div><div class="pb flat" id="fbody"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    const draw = async () => {
      const res = await API.get('/api/central/eventfeed' + ($('#ftype', wrap).value ? '?type=' + $('#ftype', wrap).value : ''));
      if (!wrap.querySelector('option[value=""] + option')) {
        const sel = $('#ftype', wrap);
        res.types.forEach(t => sel.insertAdjacentHTML('beforeend', `<option value="${esc(t)}">${esc(t)}</option>`));
      }
      const ICON = { FIELD: '📝', RESULT: '📄', INCIDENT: '⚠️', SOS: '🚨', IREV: '👁', IREV_CHANGE: 'Δ', IREV_UNAVAILABLE: '◌', SOURCE: '📡', CASE: '⚖', ESCALATION: '▲' };
      $('#fbody', wrap).innerHTML = `<div class="feed" style="max-height:calc(100vh - 220px)">${res.rows.map(r => `
        <div class="item" data-ev="${esc(JSON.stringify(r)).replace(/"/g, '&quot;')}"><span class="t">${fmtWatShort(r.t)}</span>
        <span class="tx"><b>${ICON[r.type] || '•'} ${esc(r.label)}</b>${r.detail ? ` <span class="dim">— ${esc(r.detail)}</span>` : ''}</span></div>`).join('') || '<div class="empty">No events yet</div>'}</div>`;
      $$('[data-ev]', wrap).forEach(x => x.onclick = () => {
        const ev2 = JSON.parse(x.dataset.ev.replace(/&quot;/g, '"'));
        if (ev2.caseId) irevCaseModal(ev2.caseId);
        else if (ev2.submissionId) location.href = '/supervisor?sub=' + ev2.submissionId;
        else if (ev2.incidentId) { const i = ov.incidents.find(y => y.id === ev2.incidentId); if (i) incidentModal(i, { canManage: API.can('incidents.manage'), onChange: refresh }); }
        else if (ev2.sosId) { const s2 = ov.sos.find(y => y.id === ev2.sosId); if (s2) sosModal(s2, { canAck: API.can('sos.ack'), canManage: API.can('sos.manage'), onChange: refresh }); }
        else if (ev2.puId) irevPuModal(ev2.puId);
      });
    };
    $('#ftype', wrap).onchange = draw;
    draw();
  }
  // ---- Result Flow & Bottlenecks (§14-15, §45) ----
  function rResultFlow(b) {
    const k = ov.kpis;
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">RESULT FLOW VISUALIZATION</span><span class="sub">expected → capture → submit → receive → review → verify → reconcile</span></div>
    <div class="pb">
      <div class="pipeline" style="flex-wrap:wrap;justify-content:center">
        <span class="step">EXPECTED<br><b style="font-size:16px;color:#fff">${fmtN(k.totalPu)}</b></span><span class="arrow">↓</span>
        <span class="step">FIELD CAPTURE<br><b style="font-size:16px;color:#fff">${fmtN(k.submittedPu)}</b></span><span class="arrow">↓</span>
        <span class="step">SUBMITTED<br><b style="font-size:16px;color:#fff">${fmtN(k.submittedPu)}</b></span><span class="arrow">↓</span>
        <span class="step">RECEIVED<br><b style="font-size:16px;color:#fff">${fmtN(k.submittedPu)}</b></span><span class="arrow">↓</span>
        <span class="step">REVIEW<br><b style="font-size:16px;color:#fff">${fmtN(k.pending)}</b></span><span class="arrow">↓</span>
        <span class="step">VERIFIED<br><b style="font-size:16px;color:#4ade80">${fmtN(k.verifiedPu)}</b></span><span class="arrow">↓</span>
        <span class="step" id="reconStep">RECONCILED<br><b style="font-size:16px;color:#38bdf8">…</b></span>
      </div>
    </div></div>`));
    // bottleneck panel
    const bb = el(`<div class="panel"><div class="ph"><span class="t">OPERATIONAL BOTTLENECKS</span><span class="sub">operational signals — never conclusions about election outcomes</span></div><div class="pb" id="bnbody"><span class="dim small">Analyzing…</span></div></div>`);
    b.appendChild(bb);
    API.get('/api/central/health').then(h => {
      $('#bnbody', bb).innerHTML = h.bottlenecks.length ? h.bottlenecks.map(x => `
        <div class="signal-card ${x.sev.toLowerCase()}"><div class="s-head">${x.sev === 'HIGH' ? '⚠' : '▲'} <b>${esc(x.name)}</b><span class="badge ${x.sev === 'HIGH' ? 'l4' : 'l3'}">${esc(x.sev)}</span></div>
        <div class="s-note">${esc(x.detail)}</div>
        <div class="s-actions"><button class="btn sm" data-go="${x.target}">OPEN</button></div></div>`).join('') : '<div class="empty">No significant bottlenecks detected.</div>';
      $$('[data-go]', bb).forEach(x => x.onclick = () => setTab(x.dataset.go));
    }).catch(() => { $('#bnbody', bb).innerHTML = '<div class="empty">—</div>'; });
    // reconciled count from irev
    loadIrev().then(ir => { $('#reconStep', b).innerHTML = `RECONCILED<br><b style="font-size:16px;color:#38bdf8">${fmtN(ir.kpis.matched)}</b>`; }).catch(() => {});
  }
  // ---- Discrepancy Command (§20-21) ----
  function rDiscrepancies(b) {
    const wrap = el('<div id="discwrap"><span class="dim small">Loading discrepancy command…</span></div>');
    b.appendChild(wrap);
    API.get('/api/irev/cases').then(res => {
      const rows = res.rows;
      const high = rows.filter(c => c.severity === 'CRITICAL' && !['RESOLVED', 'CLOSED'].includes(c.status)).length;
      const under = rows.filter(c => !['RESOLVED', 'CLOSED'].includes(c.status)).length;
      const escCount = rows.filter(c => c.status === 'ESCALATED').length;
      const done = rows.filter(c => ['RESOLVED', 'CLOSED'].includes(c.status)).length;
      wrap.innerHTML = `<div class="kpis">
        ${kpiCard('Total cases', fmtN(rows.length))}
        ${kpiCard('High priority', fmtN(high), { cls: high ? 'alert' : '' })}
        ${kpiCard('Under review', fmtN(under), { cls: under ? 'warn' : '' })}
        ${kpiCard('Escalated', fmtN(escCount), { cls: escCount ? 'alert' : '' })}
        ${kpiCard('Resolved', fmtN(done), { cls: 'ok' })}
      </div>
      <div class="pub-note">Each case opens the complete evidence timeline: FIELD EC8A · EOV RECORD · IReV SNAPSHOT 1 · IReV SNAPSHOT 2 · hash comparison · visual comparison · value comparison · review status. <b>Closing CRITICAL cases requires two-person approval.</b></div>
      <div class="panel"><div class="ph"><span class="t">DISCREPANCY CASES</span><span class="sp"></span>
        <select class="inp" style="width:160px" id="dstatus"><option value="">All statuses</option>${['DETECTED', 'ASSIGNED', 'PENDING_APPROVAL', 'ESCALATED', 'RESOLVED', 'CLOSED'].map(s => `<option>${s}</option>`).join('')}</select>
      </div><div class="pb flat" id="dbody"></div></div>`;
      const draw = () => {
        const f = $('#dstatus', wrap).value;
        const list = f ? rows.filter(c => c.status === f) : rows;
        $('#dbody', wrap).innerHTML = list.length ? list.map(c => `
          <div class="esc-card" data-case="${c.id}">
            <div class="e-head"><b>${esc(c.code)}</b><span class="badge ${c.severity === 'CRITICAL' ? 'l5' : c.severity === 'HIGH' ? 'l4' : 'l3'}">${esc(c.severity)}</span><span class="pill">${esc(c.type)}</span>${statusBadge(c.status)}${c.classification ? `<span class="pill">${esc(c.classification)}</span>` : ''}<span class="right small dim">${fmtWatShort(c.createdAt)}</span></div>
            <div class="e-body">${esc(c.puId)} · ${esc(c.lga)} · ${esc(c.note.slice(0, 130))}${c.note.length > 130 ? '…' : ''}</div>
          </div>`).join('') : '<div class="empty">No cases match the filter.</div>';
        $$('[data-case]', wrap).forEach(x => x.onclick = () => irevCaseModal(x.dataset.case));
      };
      $('#dstatus', wrap).onchange = draw;
      draw();
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  // ---- Operations Tasks (§34) ----
  function rTasks(b) {
    const wrap = el(`<div class="flex mb12"><span class="pill">OPERATIONS TASKS — owner · priority · deadline · status · evidence · notes · audit trail</span><span class="flex1"></span><button class="btn primary" id="newtask">＋ Create task</button></div>
    <div class="panel"><div class="ph"><span class="t">TASK BOARD</span><span class="sp"></span>
      <select class="inp" style="width:160px" id="tfilter"><option value="">All statuses</option>${['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map(s => `<option>${s}</option>`).join('')}</select>
    </div><div class="pb flat" id="tbody"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    const draw = () => {
      API.get('/api/tasks').then(res => {
        const f = $('#tfilter', wrap).value;
        const rows = f ? res.rows.filter(t => t.status === f) : res.rows;
        $('#tbody', wrap).innerHTML = rows.length ? rows.map(t => `
          <div class="esc-card">
            <div class="e-head"><b>${esc(t.code)} — ${esc(t.title)}</b><span class="badge ${t.priority === 'CRITICAL' ? 'l5' : t.priority === 'HIGH' ? 'l4' : t.priority === 'MEDIUM' ? 'l3' : 'l2'}">${esc(t.priority)}</span>${statusBadge(t.status)}<span class="pill">${esc(t.ownerName)}</span>${t.deadline ? `<span class="pill">due ${fmtWatShort(t.deadline)}</span>` : ''}<span class="right small dim">${fmtWatShort(t.createdAt)}</span></div>
            ${t.detail ? `<div class="e-body">${esc(t.detail)}</div>` : ''}
            <div class="s-actions" style="margin-top:6px">
              ${['ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].filter(s2 => s2 !== t.status).map(s2 => `<button class="btn sm" data-t="${t.id}" data-s="${s2}">${s2.toLowerCase()}</button>`).join('')}
            </div>
          </div>`).join('') : '<div class="empty">No tasks. Create one from the signals or incidents you are working.</div>';
        $$('[data-t]', wrap).forEach(x => x.onclick = async () => {
          await API.post(`/api/tasks/${x.dataset.t}/status`, { status: x.dataset.s, note: 'Updated from Central Command' });
          toast('Task updated', x.dataset.s);
          draw();
        });
      }).catch(e => { $('#tbody', wrap).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    };
    $('#tfilter', wrap).onchange = draw;
    $('#newtask', wrap).onclick = () => {
      const m = modal({
        title: 'Create operations task',
        body: () => el(`<div>
          <label class="fl">Title *</label><input class="inp" id="ttitle" placeholder="e.g. Review 27 discrepancy cases">
          <label class="fl">Detail</label><textarea class="inp" id="tdetail" rows="2"></textarea>
          <label class="fl">Priority</label><select class="inp" id="tpri"><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option><option>LOW</option></select>
          <label class="fl">Related record (optional)</label><input class="inp" id="tref" placeholder="e.g. EV-DIFF-2027-000042">
        </div>`),
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create task', cls: 'primary', onClick: () => {
          const title = $('#ttitle').value.trim();
          if (!title) return toast('Title required', 'Give the task a title.', 'medium');
          API.post('/api/tasks', { title, detail: $('#tdetail').value, priority: $('#tpri').value, relatedId: $('#tref').value }).then(() => { toast('Task created'); m.close(); draw(); }).catch(e => toast('Failed', e.message, 'high'));
        } }],
      });
    };
    draw();
  }
  // ---- Communications Centre (§32-33) ----
  function rComms(b) {
    const wrap = el(`<div class="grid23">
      <div class="panel" style="display:flex;flex-direction:column;height:calc(100vh - 180px)">
        <div class="ph"><span class="t">COMMAND COMMUNICATIONS</span><span class="sub">structured channels only — no political persuasion content</span></div>
        <div class="pb" style="flex:1;overflow-y:auto" id="cbody"><span class="dim small">Loading…</span></div>
        <div class="pb" style="border-top:1px solid var(--line)">
          <label class="fl">Channel</label>
          <select class="inp" id="ctarget"><option value="SENATORIAL">Central → Senatorial Commands</option><option value="LG">Central → LG Supervisors</option><option value="SUPERVISOR">Central → Verification Supervisors</option><option value="ALL">Central → All commands (broadcast)</option></select>
          <label class="fl">Priority</label>
          <select class="inp" id="cpri"><option>MEDIUM</option><option>HIGH</option><option>CRITICAL</option><option>LOW</option></select>
          <label class="fl">Message</label>
          <textarea class="inp" id="cmsg" rows="3" placeholder="Operational instruction…"></textarea>
          <button class="btn primary btnblock mt12" id="csend">SEND BROADCAST</button>
        </div>
      </div>
      <div class="panel"><div class="ph"><span class="t">ACKNOWLEDGEMENT TRACKING</span><span class="sub">SENT → DELIVERED → READ → ACKNOWLEDGED</span></div>
      <div class="pb" id="cacks"><span class="dim small">Select a message to see recipients.</span></div></div>
    </div>`);
    b.appendChild(wrap);
    const draw = () => {
      API.get('/api/communications').then(res => {
        $('#cbody', wrap).innerHTML = res.rows.length ? res.rows.map(m => `
          <div class="esc-card" data-m="${m.id}">
            <div class="e-head"><b>${esc(m.fromName)}</b><span class="pill">→ ${esc(m.channel)}</span><span class="badge ${m.priority === 'CRITICAL' ? 'l5' : m.priority === 'HIGH' ? 'l4' : m.priority === 'MEDIUM' ? 'l3' : 'l2'}">${esc(m.priority)}</span>${statusBadge(m.status || 'SENT')}<span class="right small dim">${fmtWatShort(m.at)}</span></div>
            <div class="e-body">${esc(m.body)}</div>
          </div>`).join('') : '<div class="empty">No broadcasts yet.</div>';
        $$('[data-m]', wrap).forEach(x => x.onclick = () => {
          const m = res.rows.find(r => r.id === x.dataset.m);
          const unacked = m.toRoleIds.length - (m.acks || []).length;
          $('#cacks', wrap).innerHTML = `<div class="small muted mb12">Recipients (${m.toRoleIds.length} roles) — ${(m.acks || []).length} acknowledged · <b style="color:${unacked ? '#fbbf24' : '#4ade80'}">${unacked} unacknowledged</b></div>
          ${(m.acks || []).map(a => `<div class="flex mb12"><span class="st ok">✓</span><span class="small">${esc(a.name)} (${esc(a.role)})</span><span class="right small dim">${fmtWatShort(a.at)}</span></div>`).join('') || '<div class="small muted">No acknowledgements yet.</div>'}`;
        });
      }).catch(e => { $('#cbody', wrap).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    };
    $('#csend', wrap).onclick = async () => {
      const body = $('#cmsg', wrap).value.trim();
      if (!body) return toast('Empty message', 'Type an operational instruction.', 'medium');
      try {
        await API.post('/api/communications', { target: $('#ctarget', wrap).value, priority: $('#cpri', wrap).value, body });
        toast('Broadcast sent', 'Recipients notified on their channels.');
        $('#cmsg', wrap).value = '';
        draw();
      } catch (e) { toast('Failed', e.message, 'high'); }
    };
    draw();
  }
  // ---- Shift Management (§35-36) ----
  function rShifts(b) {
    const wrap = el('<div id="shwrap"><span class="dim small">Loading shift board…</span></div>');
    b.appendChild(wrap);
    const draw = () => {
      API.get('/api/shifts').then(res => {
        wrap.innerHTML = `<div class="grid2">
          <div class="panel"><div class="ph"><span class="t">CONTROL ROOM SHIFTS — 24-HOUR OPERATION</span></div>
          <div class="pb">${res.schedule.map(sh => `
            <div class="panel mb12" style="margin:0;border-color:${sh.current ? '#155e75' : 'var(--line)'}">
              <div class="ph"><span class="t">${esc(sh.shift)}</span>${sh.current ? '<span class="right"><span class="badge live">● CURRENT</span></span>' : ''}</div>
              <div class="pb small"><div class="flex" style="flex-wrap:wrap;gap:6px">${sh.members.map(m2 => `<span class="pill">${esc(m2)}</span>`).join('')}</div></div>
            </div>`).join('')}
          </div></div>
          <div class="panel"><div class="ph"><span class="t">SHIFT HANDOVER</span><span class="sub">outgoing generates · incoming acknowledges</span></div>
          <div class="pb">
            <label class="fl">Handover notes</label>
            <textarea class="inp" id="hnotes" rows="2" placeholder="Open cases, pending alerts, unresolved incidents…"></textarea>
            <label class="fl">Critical watch items</label>
            <textarea class="inp" id="hwatch" rows="2" placeholder="Items the incoming team must watch first"></textarea>
            <button class="btn primary btnblock mt12" id="hgen">GENERATE SHIFT HANDOVER REPORT</button>
          </div></div>
        </div>
        <div class="panel mt12"><div class="ph"><span class="t">HANDOVER HISTORY</span></div>
        <div class="pb flat">${res.handover.length ? res.handover.map(h2 => `
          <div class="esc-card">
            <div class="e-head"><b>Handover by ${esc(h2.fromName)}</b><span class="right small dim">${fmtWatShort(h2.at)}</span></div>
            <div class="e-body">${h2.acknowledgedBy ? `<span class="st ok">✓ ACKNOWLEDGED by ${esc(h2.acknowledgedBy)}</span>` : `<span class="st warn">AWAITING ACKNOWLEDGEMENT</span> ${'<button class="btn sm" data-ack="' + h2.id + '">✓ Acknowledge (incoming team)</button>'}`}</div>
          </div>`).join('') : '<div class="empty">No handovers yet.</div>'}</div></div>`;
        $$('[data-ack]', wrap).forEach(x => x.onclick = async () => { await API.post(`/api/shifts/handover/${x.dataset.ack}/ack`, {}); toast('Handover acknowledged'); draw(); });
        $('#hgen', wrap).onclick = async () => {
          try {
            const h2 = await API.post('/api/shifts/handover', { notes: $('#hnotes', wrap).value, watch: $('#hwatch', wrap).value });
            const s = h2.summary;
            const m = modal({
              title: 'SHIFT HANDOVER REPORT',
              wide: true,
              body: () => el(`<div>
                <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
                  ${kpiCard('Active incidents', fmtN(s.activeIncidents), { sub: s.criticalIncidents + ' critical', cls: s.criticalIncidents ? 'alert' : '' })}
                  ${kpiCard('Active SOS', fmtN(s.activeSos), { cls: s.activeSos ? 'alert' : '' })}
                  ${kpiCard('IReV discrepancies', fmtN(s.irevDiscrepancies), { cls: s.irevDiscrepancies ? 'alert' : '' })}
                  ${kpiCard('Cases in review', fmtN(s.irevUnderReview), { cls: s.irevUnderReview ? 'warn' : '' })}
                </div>
                <div class="detail-grid">
                  <span class="k">Pending results</span><span class="v">${s.pendingResults}</span>
                  <span class="k">Verification backlog</span><span class="v">${s.verificationBacklog}</span>
                  <span class="k">Open tasks</span><span class="v">${s.openTasks}</span>
                  <span class="k">Open escalations</span><span class="v">${s.openEscalations}</span>
                </div>
                <div class="pub-note mt12">The incoming team must acknowledge this handover. ${esc(h2.notes || '')}</div>
              </div>`),
              actions: [{ label: 'Close', cls: 'ghost' }],
            });
            draw();
          } catch (e) { toast('Failed', e.message, 'high'); }
        };
      }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    };
    draw();
  }
  // ---- Report History (§58) ----
  function rReportHistory(b) {
    const wrap = el(`<div class="flex mb12"><span class="pill">REPORT VERSION CONTROL — SITREP-2027-XXXXXX-V{n} · author · timestamp · data snapshot · approval status</span><span class="flex1"></span>
      <select class="inp" style="width:220px" id="rtype"><option value="CENTRAL_SITREP">Central SITREP</option><option value="IREV_RECONCILIATION">IReV Reconciliation Report</option><option value="INCIDENT_REPORT">Incident Report</option><option value="SHIFT_HANDOVER">Shift Handover</option></select>
      <button class="btn primary" id="genrep">＋ GENERATE REPORT</button>
    </div>
    <div class="panel"><div class="ph"><span class="t">GENERATED REPORTS</span></div><div class="pb flat" id="rbody"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    const draw = () => {
      API.get('/api/reports/generated').then(res => {
        $('#rbody', wrap).innerHTML = res.rows.length ? res.rows.map(r => `
          <div class="esc-card">
            <div class="e-head"><b>${esc(r.code)}-V${r.version}</b><span class="pill">${esc(r.type)}</span>${statusBadge(r.status)}<span class="pill">by ${esc(r.authorName)}</span><span class="right small dim">${fmtWatShort(r.createdAt)}</span></div>
            <div class="e-body small muted">Data snapshot frozen at generation — figures do not drift. ${r.snapshot && r.snapshot.irev ? `IReV at capture: ${r.snapshot.irev.observed} observed · ${r.snapshot.irev.matched} matched` : ''}</div>
          </div>`).join('') : '<div class="empty">No reports generated yet. Use the Central SITREP, Reconciliation Report, or Shift Handover screens.</div>';
      }).catch(e => { $('#rbody', wrap).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    };
    $('#genrep', wrap).onclick = async () => {
      try {
        const r = await API.post('/api/reports/generate', { type: $('#rtype', wrap).value });
        toast('Report generated', `${r.code}-V${r.version} — snapshot frozen, DRAFT status.`);
        draw();
      } catch (e) { toast('Failed', e.message, 'high'); }
    };
    draw();
  }

  // ==================== IReV WATCHTOWER + new central views ====================
  let irevCache = null, irevSeg = 'matrix';
  const loadIrev = async () => { if (!irevCache) irevCache = await API.get('/api/irev/dashboard'); return irevCache; };
  function waitLabel(m) { const hh = Math.floor(m / 60), mm = m % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`; }
  const RECON_META = {
    MATCHED: ['s-verified', 'MATCHED'], PENDING: ['s-archived', 'IReV NOT YET AVAILABLE'],
    FIELD_VS_IREV: ['l4', 'FIELD VS IReV DIFFERENCE'], EYES_VS_IREV: ['l4', 'EYES VS IReV DIFFERENCE'],
    FIELD_VS_EYES: ['l3', 'FIELD VS EYES DIFFERENCE'], MULTIPLE: ['l3', 'MULTIPLE IReV OBSERVATIONS'],
    UNAVAILABLE: ['l5', 'PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED'], REVIEW: ['s-under', 'REQUIRES HUMAN REVIEW'],
  };
  function reconBadge(status) { const m = RECON_META[status] || ['s-archived', status]; return `<span class="badge ${m[0]}"><span class="dot"></span>${esc(m[1])}</span>`; }
  function irevBanner(ir) {
    const h = ir.source;
    const cls = h.status === 'ONLINE' ? '' : h.status === 'DEGRADED' ? 'degraded' : 'offline';
    const col = h.status === 'ONLINE' ? '#4ade80' : h.status === 'DEGRADED' ? '#fbbf24' : '#f87171';
    return el(`<div class="irev-banner ${cls}">
      <span class="ib-status"><span class="d"></span><span style="color:${col}">IReV WATCHTOWER — ${esc(h.status)}</span></span>
      <span class="ib-meta">
        <span>Source: <b>${esc(h.method)}</b></span>
        <span>Last synchronized: <b>${h.lastSync ? fmtWatShort(h.lastSync) : '—'}</b></span>
        <span>${API.can('irev.demo') ? '<button class="btn sm" id="irevdemo">🎬 Watchtower demo</button>' : ''}</span>
      </span>
    </div>`);
  }
  function rWatchtower(b) {
    const box = el('<div><span class="dim small">Loading Watchtower…</span></div>');
    b.appendChild(box);
    loadIrev().then(ir => {
      const k = ir.kpis;
      box.innerHTML = '';
      box.appendChild(irevBanner(ir));
      box.appendChild(el(`<div class="kpis">
        ${kpiCard('Total monitored', fmtN(k.totalMonitored), { sub: 'PUs with field records' })}
        ${kpiCard('IReV observed', fmtN(k.observed), { sub: k.coveragePct + '% coverage', cls: 'accent' })}
        ${kpiCard('Pending', fmtN(k.pending), { cls: k.pending ? 'warn' : '' })}
        ${kpiCard('Matched', fmtN(k.matched), { sub: k.reconciliationPct + '% of observed', cls: 'ok' })}
        ${kpiCard('Discrepancies', fmtN(k.discrepancies), { cls: k.discrepancies ? 'alert' : '' })}
        ${kpiCard('Document changes', fmtN(k.docChanges), { cls: k.docChanges ? 'alert' : '' })}
        ${kpiCard('Currently unavailable', fmtN(k.unavailable), { cls: k.unavailable ? 'alert' : '' })}
        ${kpiCard('Under review', fmtN(k.underReview), { cls: k.underReview ? 'warn' : '' })}
      </div>`));
      box.appendChild(el(`<div class="panel"><div class="ph"><span class="t">IReV UPLOAD PROGRESS & RECONCILIATION COVERAGE</span><span class="sub">RECONCILIATION COVERAGE ${k.reconciliationPct}% — an operational coverage metric, never an "election accuracy score"</span></div>
      <div class="pb">
        <div class="small flex mb12"><span style="width:130px">IReV observed</span><div class="pbar flex1"><div class="fill" style="width:${k.coveragePct}%"></div></div><b>${k.coveragePct}%</b></div>
        <div class="small flex mb12"><span style="width:130px">Matched records</span><div class="pbar flex1"><div class="fill green" style="width:${k.reconciliationPct}%"></div></div><b>${k.reconciliationPct}%</b></div>
        <div class="small muted mt8">Breakdown: ${fmtN(k.matched)} matched · ${fmtN(k.pending)} pending · ${fmtN(k.discrepancies)} discrepant · ${fmtN(k.unavailable)} unavailable · ${fmtN(k.underReview)} under review.</div>
      </div></div>`));
      // recent events
      box.appendChild(el(`<div class="grid2">
        <div class="panel"><div class="ph"><span class="t">IReV ACTIVITY STREAM</span><span class="sub">live · observation → match → reconcile → change</span></div>
        <div class="pb flat"><div class="feed" style="max-height:300px">${ir.events.length ? ir.events.slice(0, 20).map(e => `<div class="item"><span class="t">${fmtWatShort(e.t)}</span><span class="tx"><b>${esc(e.label)}</b>${e.detail ? ` <span class="dim">— ${esc(e.detail)}</span>` : ''}</span></div>`).join('') : '<div class="empty">No events yet</div>'}</div></div></div>
        <div class="panel"><div class="ph"><span class="t">CRITICAL RECONCILIATION ALERTS</span></div>
        <div class="pb flat" style="max-height:300px;overflow:auto">${ir.alerts.length ? ir.alerts.slice(0, 10).map(a => `<div class="notif-item"><div class="n-t">${a.severity === 'CRITICAL' ? '🚨' : a.severity === 'HIGH' ? '⚠️' : '🔔'} <b>${esc(a.title)}</b><span class="n-p ${a.severity.toLowerCase()}">${esc(a.severity)}</span></div>
        <div class="small mt8">${esc(a.note)}<br><span class="dim">${a.observationCount} observation(s) · ${a.caseId ? `<a href="#" data-case="${a.caseId}">open case →</a>` : ''}</span></div></div>`).join('') : '<div class="empty">No alerts</div>'}</div></div>
      </div>`));
      box.appendChild(el(`<div class="pub-note">Integration operates only through authorized channels (OFFICIAL API / OFFICIAL FEED / AUTHORIZED EXPORT / PUBLIC IReV OBSERVATION). No attempt is made to penetrate, bypass or reverse-engineer protected INEC infrastructure. Observations are never labelled as official INEC internal-system events unless the evidence establishes that. Language policy: differences are "POTENTIAL DOCUMENT CHANGE — HUMAN REVIEW REQUIRED", never automatic accusations.</div>`));
      $$('[data-case]', box).forEach(x => x.onclick = (e) => { e.preventDefault(); irevCaseModal(x.dataset.case); });
      const db = $('#irevdemo', box);
      if (db) db.onclick = irevDemoPanel;
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function irevDemoPanel() {
    const ACTS = [
      ['observe', '👁 OBSERVE PENDING RESULT', 'Simulate a new IReV observation'],
      ['change', 'Δ SIMULATE DOCUMENT CHANGE', 'Simulate a version change on an observed result'],
      ['outage', '📡 SIMULATE SOURCE OUTAGE', 'Public source becomes unavailable (30 sim-min)'],
      ['restore', '✔ RESTORE SOURCE', 'Source restored — reconciliation re-run'],
    ];
    const m = modal({
      title: '🎬 WATCHTOWER DEMO — authorized-observation simulation',
      body: () => el(`<div>
        <div class="pub-note">Simulated observations of the public IReV surface. All snapshots are preserved immutably. DEMO DATA — NOT OFFICIAL ELECTION RESULTS.</div>
        <div class="agent-grid">${ACTS.map(([a, l, d]) => `<div class="agent-btn" data-a="${a}"><span class="big">${l.split(' ')[0]}</span>${l.slice(l.indexOf(' ') + 1)}<span class="small dim" style="font-weight:400">${d}</span></div>`).join('')}</div>
        <div id="demores" class="small muted mt12"></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $$('[data-a]', m.body).forEach(btn => btn.onclick = async () => {
      btn.style.opacity = '.5';
      try {
        const res = await API.post('/api/irev/demo', { action: btn.dataset.a });
        $('#demores', m.body).textContent = '✓ ' + res.detail;
        toast('Watchtower demo', res.detail);
        irevCache = null; refresh(); render();
      } catch (e) { toast('Demo failed', (e.data && e.data.message) || e.message, 'high'); }
      btn.style.opacity = '1';
    });
  }
  function rWhatChanged(b) {
    const box = el('<div><span class="dim small">Computing changes for the last 15 minutes…</span></div>');
    b.appendChild(box);
    API.get('/api/irev/whatchanged').then(wc => {
      const cards = [
        ['newIrevUploads', 'New IReV uploads', 'watchtower', false],
        ['newDocuments', 'New EC8A documents', 'evidence', false],
        ['newDiscrepancies', 'New discrepancies', 'irevrecon', true],
        ['changedDocuments', 'Changed documents', 'irevchanges', true],
        ['unavailable', 'Previously observed — currently unavailable', 'irevchanges', true],
        ['newIncidents', 'New incidents', 'incidents', false],
        ['newSos', 'New SOS', 'sos', wc.cards.newSos > 0],
        ['newVerified', 'New verified results', 'results', false],
      ];
      box.innerHTML = `<div class="panel"><div class="ph"><span class="t">WHAT CHANGED IN THE LAST 15 MINUTES?</span><span class="sub">every card drills to the underlying records — no black-box statistics</span></div>
      <div class="pb"><div class="wc-grid">${cards.map(([key, label, target, hot]) => `<div class="wc-card ${hot ? 'hot' : ''}" data-go="${target}"><div class="v">${fmtN(wc.cards[key])}</div><div class="l">${label}</div></div>`).join('')}</div></div></div>`;
      $$('[data-go]', box).forEach(x => x.onclick = () => setTab(x.dataset.go));
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rIrevPending(b) {
    const box = el('<div><span class="dim small">Loading pending upload monitor…</span></div>');
    b.appendChild(box);
    API.get('/api/irev/pending').then(res => {
      const t = res.thresholds;
      box.innerHTML = `<div class="pub-note">Which polling-unit results have already been captured by the field network but have not yet appeared in the authorized/public IReV source. <b>A delay is not interpreted as wrongdoing.</b> Possible causes: connectivity, device issue, upload queue, public portal delay, operational delay, system availability.</div>
      <div class="threshold-bar"><span class="tb n">NORMAL 0–${t.normalMin}m</span><span class="tb a">ATTENTION ${t.normalMin}–${t.attentionMin}m</span><span class="tb h">HIGH ${t.attentionMin}–${t.highMin}m</span><span class="tb c">CRITICAL ${t.highMin}m+</span></div>
      <div class="panel"><div class="ph"><span class="t">PENDING IReV UPLOADS</span><span class="sub">field capture received · EOV processed · IReV not yet observed</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>PU</th><th>Ward</th><th>LGA</th><th>Field capture</th><th>EOV</th><th>IReV</th><th>Waiting</th><th></th></tr>
      ${res.rows.length ? res.rows.map(r => `<tr><td class="mono">${esc(r.code)}</td><td>${esc(r.ward)}</td><td>${esc(r.lga)}</td><td><span class="st ok">RECEIVED</span></td><td>${statusBadge(r.eovStatus)}</td><td><span class="st ${r.tier === 'CRITICAL' ? 'bad' : r.tier === 'HIGH' ? 'bad' : 'warn'}">NOT OBSERVED</span></td><td class="mono" style="color:${r.tier === 'CRITICAL' ? '#f87171' : r.tier === 'HIGH' ? '#fb923c' : '#fbbf24'}">${waitLabel(r.waitMin)}</td><td><button class="btn sm" data-pu="${r.puId}">PU record</button></td></tr>`).join('') : '<tr><td colspan="8" class="empty">No pending uploads — every captured result has an IReV observation.</td></tr>'}
      </table></div></div>`;
      $$('[data-pu]', box).forEach(x => x.onclick = () => irevPuModal(x.dataset.pu));
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rIrevMatrix(b) {
    const box = el('<div><span class="dim small">Loading coverage matrix…</span></div>');
    b.appendChild(box);
    API.get('/api/irev/matrix').then(res => {
      const lat = res.latency;
      box.innerHTML = `<div class="kpis">
        ${kpiCard('Avg upload latency', Math.round(lat.averageMin) + 'm', { sub: 'field capture → observation' })}
        ${kpiCard('Median', lat.medianMin + 'm')}
        ${kpiCard('Maximum', lat.maxMin + 'm', { cls: lat.maxMin > 60 ? 'warn' : '' })}
      </div>
      <div class="pub-note">This measures <b>observed publication latency</b> — not necessarily internal INEC processing time.</div>
      <div class="panel"><div class="ph"><span class="t">IReV COVERAGE — LGA MATRIX</span><span class="sub">drill: state → senatorial → LGA → ward → PU (click a row for the LGA monitor)</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>LGA</th><th>Senatorial</th><th class="num">Expected</th><th class="num">Observed</th><th class="num">Pending</th><th class="num">Matched</th><th class="num">Differences</th><th>Coverage</th></tr>
      ${res.rows.map(r => `<tr class="clickable" data-lg="${r.lgaId}"><td><b>${esc(r.name)}</b></td><td>${esc(r.senatorial)}</td><td class="num">${r.expected}</td><td class="num">${r.observed}</td><td class="num" style="color:${r.pending ? '#fbbf24' : ''}">${r.pending}</td><td class="num" style="color:#4ade80">${r.matched}</td><td class="num" style="color:${r.differences ? '#f87171' : ''}">${r.differences}</td><td><div class="pbar" style="width:80px"><div class="fill" style="width:${r.observedPct}%"></div></div> ${r.observedPct}%</td></tr>`).join('')}
      </table></div></div>
      <div class="panel mt12"><div class="ph"><span class="t">UPLOAD LATENCY BY LGA</span><span class="sub">minutes · field capture → first IReV observation</span></div>
      <div class="pb chart-box">${barChart({ data: lat.byLga.map(x => x.avg), labels: lat.byLga.map(x => x.lga.length > 9 ? x.lga.slice(0, 8) + '…' : x.lga), h: 200, color: '#38bdf8' })}</div></div>`;
      $$('[data-lg]', box).forEach(x => x.onclick = () => setTab('lg'));
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rIrevArchive(b) {
    const box = el('<div><span class="dim small">Loading immutable snapshot archive…</span></div>');
    b.appendChild(box);
    API.get('/api/irev/snapshots').then(res => {
      box.innerHTML = `<div class="pub-note">Every observed result record receives an immutable snapshot: image/document, metadata, timestamp, hash, source reference, retrieval status. <b>Snapshot #1 is never overwritten by Snapshot #2.</b> This answers: "What did the public IReV record look like when we first observed it — and what does it look like now?"</div>
      <div class="panel"><div class="ph"><span class="t">SOURCE ARCHIVE</span><span class="sub">${res.total} observation(s)</span></div>
      <div class="pb flat" style="max-height:520px;overflow:auto">${res.rows.length ? res.rows.map(o => `
        <div class="snap-row" data-pu="${o.puId}"><span class="sn-no">${o.snapshotNo}</span>
          <span><b class="small" style="color:var(--text)">${esc(o.code)}</b> — ${esc(o.puId)} · ${esc(o.lga || '')} · ${o.version >= 2 ? '<span class="badge l4">VERSION ' + o.version + '</span>' : 'VERSION 1'}</span>
          <span class="mono small dim" style="margin-left:auto">SHA-256 ${esc(o.docHash.slice(0, 14))}…</span>
          <span class="small dim">${fmtWatShort(o.observedAt)}</span>
          <span>${o.available === false ? '<span class="badge l5">CURRENTLY NOT OBSERVED</span>' : '<span class="badge s-verified">OBSERVED</span>'}</span>
        </div>`).join('') : '<div class="empty">No snapshots yet</div>'}</div></div>`;
      $$('[data-pu]', box).forEach(x => x.onclick = () => irevPuModal(x.dataset.pu));
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rIrevChanges(b) {
    const box = el('<div><span class="dim small">Loading change detector…</span></div>');
    b.appendChild(box);
    API.get('/api/irev/cases').then(res => {
      const changes = res.rows.filter(c => ['DOCUMENT_CHANGED', 'RESULT_VALUES_CHANGED', 'RESULT_DISAPPEARED'].includes(c.type));
      box.innerHTML = `<div class="pub-note">Change categories: DOCUMENT CHANGED · METADATA CHANGED · RESULT VALUES CHANGED · RESULT APPEARED · <b>RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED</b> · RESULT REPLACED · NO CHANGE. A public portal can become unavailable temporarily without a record being removed — the platform never states a result was "deleted".</div>
      <div class="panel"><div class="ph"><span class="t">CHANGE EVENTS & VERSION TIMELINES</span></div>
      <div class="pb flat">${changes.length ? changes.map(c => `
        <div class="esc-card" data-case="${c.id}">
          <div class="e-head"><b>${esc(c.code)}</b><span class="badge ${c.severity === 'CRITICAL' ? 'l5' : 'l4'}">${esc(c.severity)}</span><span class="pill">${esc(c.type)}</span>${statusBadge(c.status)}<span class="right small dim">${fmtWatShort(c.createdAt)}</span></div>
          <div class="e-body">${esc(c.note.slice(0, 160))}${c.note.length > 160 ? '…' : ''}<br><span class="dim">${esc(c.puId)} · ${esc(c.lga)} · ${c.observationCount} observation(s) · confidence ${esc(c.confidence)}</span></div>
        </div>`).join('') : '<div class="empty">No change events — every observation is consistent with its previous snapshot.</div>'}</div></div>`;
      $$('[data-case]', box).forEach(x => x.onclick = () => irevCaseModal(x.dataset.case));
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rIrevRecon(b) {
    const box = el('<div><span class="dim small">Loading three-way reconciliation…</span></div>');
    b.appendChild(box);
    const seg = el(`<div class="irev-seg">${[['matrix', '⇄ THREE-WAY MATRIX'], ['cases', '🗂 DISCREPANCY CASES'], ['queue', '✓ REVIEW QUEUE']].map(([id, l]) => `<span class="is ${irevSeg === id ? 'on' : ''}" data-s="${id}">${l}</span>`).join('')}</div>`);
    box.appendChild(seg);
    $$('.is', seg).forEach(x => x.onclick = () => { irevSeg = x.dataset.s; render(); });
    if (irevSeg === 'matrix') {
      API.get('/api/irev/reconciliation').then(res => {
        box.appendChild(el(`<div class="pub-note">THREE-WAY RESULT RECONCILIATION — compares <b>FIELD CAPTURE</b> (agent EC8A) ↔ <b>EYES OF VICTORY SUBMISSION</b> (structured data) ↔ <b>IReV OBSERVATION</b> (public record). Every status is clickable to its evidence. A changed hash means the observed content differs — it does not automatically mean manipulation.</div>
        <div class="panel"><div class="ph"><span class="t">RECONCILIATION MATRIX</span><span class="sub">${res.rows.length} records · ${fmtN(res.kpis.matched)} matched · ${fmtN(res.kpis.discrepancies)} discrepant · ${fmtN(res.kpis.underReview)} under review</span></div>
        <div class="pb flat" style="max-height:560px;overflow:auto"><table class="tbl"><tr><th>PU</th><th>Ward</th><th>LGA</th><th>EOV EC8A</th><th>IReV</th><th>Doc match</th><th>Value match</th><th>Status</th><th></th></tr>
        ${res.rows.map(r => `<tr class="clickable" data-pu="${r.puId}"><td class="mono">${esc(r.code)}</td><td>${esc(r.ward)}</td><td>${esc(r.lga)}</td><td>${r.fieldHash ? '<span class="st ok">RECEIVED</span>' : '<span class="st warn">NONE</span>'}</td><td>${r.obsCount ? '<span class="st ok">OBSERVED ×' + r.obsCount + '</span>' : '<span class="st warn">NOT OBSERVED</span>'}</td><td>${r.docMatch === null ? '<span class="diff-badge na">—</span>' : r.docMatch ? '<span class="diff-badge match">MATCH</span>' : '<span class="diff-badge diff">DIFFERENCE</span>'}</td><td>${r.valMatch === null ? '<span class="diff-badge na">—</span>' : r.valMatch ? '<span class="diff-badge match">MATCH</span>' : '<span class="diff-badge diff">DIFFERENCE</span>'}</td><td>${reconBadge(r.status)}</td><td><span class="dim small">drill →</span></td></tr>`).join('')}
        </table></div></div>`));
        $$('[data-pu]', box).forEach(x => x.onclick = () => irevPuModal(x.dataset.pu));
      }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    } else if (irevSeg === 'cases') {
      API.get('/api/irev/cases').then(res => {
        box.appendChild(el(`<div class="panel"><div class="ph"><span class="t">DISCREPANCY CASE FILES</span><span class="sub">EV-DIFF case per detected change — evidence preserved: previous snapshot · current snapshot · field EC8A · EOV record · hashes · comparison output</span></div>
        <div class="pb flat">${res.rows.length ? res.rows.map(c => `
          <div class="esc-card" data-case="${c.id}">
            <div class="e-head"><b>${esc(c.code)}</b><span class="badge ${c.severity === 'CRITICAL' ? 'l5' : c.severity === 'HIGH' ? 'l4' : 'l3'}">${esc(c.severity)}</span><span class="pill">${esc(c.type)}</span>${statusBadge(c.status)}${c.classification ? `<span class="pill">${esc(c.classification)}</span>` : ''}<span class="right small dim">${fmtWatShort(c.createdAt)}</span></div>
            <div class="e-body">${esc(c.puId)} · ${esc(c.lga)} · ${esc(c.note.slice(0, 130))}${c.note.length > 130 ? '…' : ''}</div>
          </div>`).join('') : '<div class="empty">No discrepancy cases.</div>'}</div></div>`));
        $$('[data-case]', box).forEach(x => x.onclick = () => irevCaseModal(x.dataset.case));
      }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    } else {
      API.get('/api/irev/cases?status=DETECTED').then(r1 => API.get('/api/irev/cases?status=ASSIGNED').then(r2 => {
        const rows = [...r1.rows, ...r2.rows];
        box.appendChild(el(`<div class="pub-note">Reconciliation review workflow: <b>DETECTED → ASSIGNED → DOCUMENT REVIEW → DATA REVIEW → SOURCE CONFIRMATION → CLASSIFICATION → ESCALATION / RESOLUTION</b>. Reviewer classifications: MATCH · DATA ENTRY ERROR · IMAGE/SCAN ISSUE · LEGITIMATE VERSION CHANGE · POSSIBLE RESULT CHANGE · UNRESOLVED (reason required).</div>
        <div class="panel"><div class="ph"><span class="t">RECONCILIATION REVIEW QUEUE</span><span class="sub">${rows.length} awaiting review</span></div>
        <div class="pb flat">${rows.length ? rows.map(c => `
          <div class="esc-card" data-case="${c.id}">
            <div class="e-head"><b>${esc(c.code)}</b><span class="badge ${c.severity === 'CRITICAL' ? 'l5' : 'l4'}">${esc(c.severity)}</span><span class="pill">${esc(c.type)}</span>${statusBadge(c.status)}<span class="right small dim">${timeAgoWat(c.createdAt, ov.sim.now)}</span></div>
            <div class="e-body">${esc(c.puId)} · ${esc(c.lga)} — assign yourself and review the preserved evidence.</div>
          </div>`).join('') : '<div class="empty">Queue is clear — all discrepancies reviewed.</div>'}</div></div>`));
        $$('[data-case]', box).forEach(x => x.onclick = () => irevCaseModal(x.dataset.case));
      })).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    }
  }
  function rIrevSource(b) {
    const box = el('<div><span class="dim small">Loading source health…</span></div>');
    b.appendChild(box);
    API.get('/api/irev/status').then(res => {
      box.innerHTML = `<div class="kpis">
        ${kpiCard('Source status', res.status, { cls: res.status === 'ONLINE' ? 'ok' : res.status === 'DEGRADED' ? 'warn' : 'alert' })}
        ${kpiCard('Source method', res.sourceMethod, { sub: 'configured integration channel' })}
        ${kpiCard('Observations', fmtN(res.observations), { cls: 'accent' })}
        ${kpiCard('Response time', Math.round(res.responseMs) + 'ms')}
        ${kpiCard('Errors', fmtN(res.errors), { cls: res.errors ? 'warn' : '' })}
        ${kpiCard('Rate-limit events', fmtN(res.rateLimitEvents))}
      </div>
      <div class="pub-note"><b>${esc(res.note)}</b></div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">SOURCE AVAILABILITY PROTECTION</span></div><div class="pb small" style="line-height:1.9">
          If the source becomes unavailable the platform does <b>not</b> generate false "deleted result" alerts. Instead it raises a <b>SOURCE AVAILABILITY INCIDENT</b>, suspends disappearance comparisons, and re-runs reconciliation against the last good snapshot when the service returns — identifying reappeared records, unavailable records, changed documents and changed metadata.
        </div></div>
        <div class="panel"><div class="ph"><span class="t">INTEGRATION CHANNELS</span></div><div class="pb small" style="line-height:1.9">
          ${res.sourceMethods.map(m => `<div class="flex mb12"><span class="pill ${m === res.sourceMethod ? '' : 'dim'}">${esc(m)}</span>${m === res.sourceMethod ? '<span class="st ok">ACTIVE</span>' : '<span class="st">CONFIGURABLE</span>'}</div>`).join('')}
          <div class="small muted">The system records the source method for every observation. An observation is never labelled as an official INEC internal-system event unless the evidence establishes that.</div>
        </div></div>
      </div>`;
    }).catch(e => { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rIrevSitrep(b) {
    b.appendChild(el(`<div class="flex mb12"><button class="btn primary" id="gen">⟳ GENERATE IReV RECONCILIATION SITREP</button><span class="flex1"></span><span class="small dim">JSON · CSV · Excel · Print/PDF — every export is logged</span></div><div id="out"></div>`));
    const gen = async () => {
      const s = await API.get('/api/irev/sitrep');
      const k = s.kpis;
      $('#out', b).innerHTML = `
      <div style="max-width:820px;margin:0 auto">
        <div class="flex mb12"><div><h2 style="color:#fff;font-size:16px">IReV RECONCILIATION SITUATION REPORT</h2>
        <div class="small muted">Generated ${esc(s.generatedAtWat)} · Source: ${esc(s.source.method)} (${esc(s.source.status)})</div></div>
        <div class="right"><button class="btn" onclick="window.print()">🖨 Print / PDF</button></div></div>
        <div class="panel"><div class="ph"><span class="t">EXECUTIVE SUMMARY</span></div><div class="pb small">${esc(s.executive)}</div></div>
        <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
          ${kpiCard('Field coverage', fmtN(k.totalMonitored) + ' PUs')}
          ${kpiCard('IReV observed', fmtN(k.observed), { sub: k.coveragePct + '%' })}
          ${kpiCard('Matched', fmtN(k.matched), { sub: k.reconciliationPct + '%', cls: 'ok' })}
          ${kpiCard('Under review', fmtN(k.underReview), { cls: k.underReview ? 'alert' : '' })}
        </div>
        <div class="grid2">
          <div class="panel"><div class="ph"><span class="t">HIGH-PRIORITY CASES</span></div><div class="pb small">${s.openCases.length ? s.openCases.map(c => `<div class="mb12"><b>${esc(c.code)}</b> — ${esc(c.puId)} — ${esc(c.type)} (${esc(c.severity)}, ${esc(c.confidence)} confidence)<br><span class="muted">${esc(c.note.slice(0, 110))}</span></div>`).join('') : 'None open.'}</div></div>
          <div class="panel"><div class="ph"><span class="t">OPEN ALERTS</span></div><div class="pb small">${s.alerts.length ? s.alerts.map(a => `<div class="mb12"><b>${esc(a.code)}</b> — ${esc(a.title)} <span class="pill">${esc(a.severity)}</span> · ${a.observationCount} obs</div>`).join('') : 'None.'}</div></div>
        </div>
        <div class="panel mt12"><div class="ph"><span class="t">UPLOAD LATENCY</span></div><div class="pb small">Average ${s.latency.averageMin}m · Median ${s.latency.medianMin}m · Maximum ${s.latency.maxMin}m — observed publication latency, not necessarily internal INEC processing time.</div></div>
        <div class="pub-note mt12">${esc(s.language)}</div>
      </div>`;
    };
    $('#gen', b).onclick = gen;
    gen();
  }
  // ---------------- PU three-way record ----------------
  function irevPuModal(puId) {
    const m = modal({
      title: 'THREE-WAY RECONCILIATION — POLLING UNIT RECORD',
      wide: true,
      body: () => el(`<div id="ipu"><span class="dim small">Loading traceable record…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get('/api/irev/pu/' + puId).then(d => {
      const p = d.pu, r = d.recon;
      const valRow = (label, items, valid, rejected) => `<div class="tw-x"><b style="color:var(--text)">${esc(label)}</b><br>${(items || []).map(i => `${i.candidateId.slice(-6)}: ${fmtN(i.votes)}`).join(' · ') || '—'}<br><span class="dim">Valid ${fmtN(valid)} · Rejected ${fmtN(rejected)}</span></div>`;
      const obsCards = d.observations.length ? d.observations.map(o => `
        <div class="tw-col"><div class="tw-t">IReV SNAPSHOT #${o.snapshotNo}${o.version >= 2 ? ' · V' + o.version : ''}${o.available === false ? ' · CURRENTLY NOT OBSERVED' : ''}</div>
        ${valRow('Values', o.values, o.validVotes, o.rejected)}
        <div class="tw-x mt8"><span class="dim">SHA-256</span><br>${esc(o.docHash)}</div>
        <div class="tw-x mt8"><span class="dim">${fmtWatShort(o.observedAt)} · ${esc(o.sourceMethod)}</span></div>
      </div>`).join('<div class="tw-arrow">→</div>') : '<div class="tw-col"><div class="tw-t">IReV OBSERVATION</div><div class="tw-x">NOT YET OBSERVED</div></div>';
      $('#ipu', m.body).innerHTML = `
        <div class="flex mb12"><b style="color:#fff">${esc(p.code)} — ${esc(p.name)}</b><span class="pill">${esc(p.ward)}</span><span class="pill">${esc(p.lga)}</span><span class="pill">${esc(p.senatorial)}</span><span class="right">${r ? reconBadge(r.status) : ''}</span></div>
        <div class="threeway">
          <div class="tw-col"><div class="tw-t">SOURCE A — FIELD CAPTURE</div>
            ${d.fieldEv ? `<div class="tw-x"><span class="dim">Evidence ${esc(d.fieldEv.code)}</span><br>SHA-256 ${esc(d.fieldEv.sha256)}<br><span class="dim">${fmtWatShort(d.fieldEv.capturedAt)}</span></div>` : '<div class="tw-x">No field EC8A evidence</div>'}
          </div>
          <div class="tw-arrow">↕</div>
          <div class="tw-col"><div class="tw-t">SOURCE B — EOV SUBMISSION</div>
            ${d.eov ? `<div class="tw-x">${esc(d.eov.code)} · ${statusBadge(d.eov.status)}<br>${valRow('Values', d.eov.items, d.eov.validVotes, d.eov.rejected)}<br><span class="dim">${fmtWatShort(d.eov.submittedAt)}</span>${(d.eov.anomalies || []).length ? '<br><span class="badge l3">⚠ ' + d.eov.anomalies.join(', ') + '</span>' : ''}</div>` : '<div class="tw-x">No EOV submission</div>'}
          </div>
          <div class="tw-arrow">↕</div>
          <div class="tw-col"><div class="tw-t">SOURCE C — IReV OBSERVATION</div>
            ${d.observations.length ? valRow('Values', d.observations[d.observations.length - 1].values, d.observations[d.observations.length - 1].validVotes, d.observations[d.observations.length - 1].rejected) + `<div class="tw-x mt8"><span class="dim">Latest hash</span><br>${esc(d.observations[d.observations.length - 1].docHash)}</div>` : '<div class="tw-x">NOT YET OBSERVED</div>'}
          </div>
        </div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">SNAPSHOT HISTORY (immutable)</span></div><div class="pb flat"><div class="threeway" style="grid-template-columns:1fr">${obsCards}</div></div></div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">PU TIMELINE</span></div><div class="pb"><div class="feed" style="max-height:220px">${(d.timeline || []).map(tl => `<div class="item"><span class="t">${fmtWatShort(tl.t)}</span><span class="tx"><b>${esc(tl.label)}</b>${tl.detail ? ` <span class="dim">— ${esc(tl.detail)}</span>` : ''}</span></div>`).join('') || '<div class="empty small">No events</div>'}</div></div></div>
        ${d.cases.length ? `<div class="panel mt12" style="margin:0"><div class="ph"><span class="t">DISCREPANCY CASES</span></div><div class="pb">${d.cases.map(c => `<div class="esc-card" data-case="${c.id}"><div class="e-head"><b>${esc(c.code)}</b><span class="pill">${esc(c.type)}</span>${statusBadge(c.status)}${c.classification ? `<span class="pill">${esc(c.classification)}</span>` : ''}</div></div>`).join('')}</div></div>` : ''}
        <div class="pub-note mt12">A changed hash means the captured/observed content differs. It does not automatically mean manipulation. Causes are never asserted without verified evidence.</div>`;
      $$('[data-case]', m.body).forEach(x => x.onclick = () => { m.close(); irevCaseModal(x.dataset.case); });
    }).catch(e => { $('#ipu', m.body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  // ---------------- case file + review workflow ----------------
  function irevCaseModal(caseId) {
    const m = modal({
      title: 'DISCREPANCY CASE FILE',
      wide: true,
      body: () => el(`<div id="icase"><span class="dim small">Loading case file…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    API.get('/api/irev/cases/' + caseId).then(d => {
      const c = d.case;
      const steps = ['DETECTED', 'ASSIGNED', 'DOCUMENT REVIEW', 'DATA REVIEW', 'SOURCE CONFIRMATION', 'CLASSIFICATION', 'ESCALATION / RESOLUTION'];
      const curIdx = c.status === 'ESCALATED' ? 6 : c.status === 'RESOLVED' ? 6 : c.status === 'ASSIGNED' ? 1 : 0;
      const diffRows = (label, a, bb) => {
        if (!a && !bb) return '';
        const aV = a ? (a.values || []).map(i => `${i.candidateId.slice(-6)}: ${fmtN(i.votes)}`).join(' · ') : '—';
        const bV = bb ? (bb.values || []).map(i => `${i.candidateId.slice(-6)}: ${fmtN(i.votes)}`).join(' · ') : '—';
        const diff = a && bb && JSON.stringify(a.values) !== JSON.stringify(bb.values);
        return `<tr class="vs-table"><td class="small">${esc(label)}</td><td class="small">${aV}</td><td class="small ${diff ? 'diff' : ''}">${bV}</td><td>${diff ? '<span class="diff-badge diff">DIFFERENCE</span>' : '<span class="diff-badge match">MATCH</span>'}</td></tr>`;
      };
      $('#icase', m.body).innerHTML = `
        <div class="flex mb12"><b style="color:#fff">${esc(c.code)}</b><span class="badge ${c.severity === 'CRITICAL' ? 'l5' : c.severity === 'HIGH' ? 'l4' : 'l3'}">${esc(c.severity)}</span><span class="pill">${esc(c.type)}</span>${statusBadge(c.status)}<span class="pill">${esc(c.confidence)} CONFIDENCE</span>${c.classification ? `<span class="pill">${esc(c.classification)}</span>` : ''}<span class="right small dim">${fmtWatShort(c.createdAt)}</span></div>
        <div class="detail-grid">
          <span class="k">Polling unit</span><span class="v">${esc(c.puId)} — ${esc(c.puCode || '')}</span>
          <span class="k">LGA / Ward</span><span class="v">${esc(c.lga)} / ${esc(c.ward)}</span>
          <span class="k">Election</span><span class="v">2027 Governorship</span>
          <span class="k">First observed</span><span class="v">${d.allObservations[0] ? fmtWatShort(d.allObservations[0].observedAt) : '—'}</span>
          <span class="k">Last observed</span><span class="v">${d.currObs ? fmtWatShort(d.currObs.observedAt) : '—'}</span>
          <span class="k">Observation count</span><span class="v">${c.observationCount}</span>
        </div>
        <div class="pub-note mt12">${esc(c.note)}</div>
        <div class="case-steps">${steps.map((s, i) => `<span class="cs ${i < curIdx ? 'done' : i === curIdx ? 'current' : ''}">${s}</span>`).join('')}</div>
        <div class="grid2">
          <div class="panel" style="margin:0"><div class="ph"><span class="t">HASHES</span></div><div class="pb small mono" style="word-break:break-all">
            <div class="mb12"><span class="dim">PREVIOUS SNAPSHOT</span><br>${d.prevObs ? esc(d.prevObs.docHash) : '—'}</div>
            <div class="mb12"><span class="dim">CURRENT SNAPSHOT</span><br>${d.currObs ? esc(d.currObs.docHash) : '—'}</div>
            <div class="mb12"><span class="dim">FIELD EC8A</span><br>${d.fieldEv ? esc(d.fieldEv.sha256) : '—'}</div>
            ${d.fieldEv && d.prevObs ? `<div>${d.fieldEv.sha256 === d.prevObs.docHash ? '<span class="diff-badge match">FIELD = PREVIOUS SNAPSHOT</span>' : '<span class="diff-badge diff">DOCUMENT DIFFERENCE DETECTED</span>'}</div>` : ''}
          </div></div>
          <div class="panel" style="margin:0"><div class="ph"><span class="t">VALUE COMPARISON</span><span class="sub">both values preserved — never overwritten</span></div>
          <div class="pb flat"><table class="tbl"><tr><th>Candidate</th><th>Previous</th><th>Current</th><th></th></tr>
          ${diffRows('Previous vs Current IReV', d.prevObs, d.currObs)}
          ${diffRows('EOV vs Current IReV', d.eov, d.currObs)}
          </table></div></div>
        </div>
        <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">AUDIT HISTORY</span></div><div class="pb">${(c.timeline || []).map(tl => `<div class="small mb12"><b>${esc(tl.step)}</b> — ${esc(tl.note || '')} <span class="dim">· ${fmtWatShort(tl.at)}</span></div>`).join('')}</div></div>
        ${c.status === 'PENDING_APPROVAL' && (API.can('results.verify') || API.can('results.override')) ? `
        <div class="panel mt12" style="margin:0;border-color:#713f12"><div class="ph"><span class="t">👥 TWO-PERSON APPROVAL</span><span class="sub">closing critical cases requires a second authorized reviewer</span></div>
        <div class="pb">
          <div class="small muted mb12">${esc(c.classification || '')} proposed by ${esc(c.reviewerName || 'reviewer')} — a <b>different</b> authorized reviewer must confirm before this case closes.</div>
          <button class="btn success" id="csecond">✓ CONFIRM (second reviewer)</button>
          <button class="btn" id="csecondEsc">▲ Confirm & escalate</button>
        </div></div>` : ''}
        ${['DETECTED', 'ASSIGNED'].includes(c.status) && (API.can('results.verify') || API.can('results.override')) ? `
        <div class="panel mt12" style="margin:0;border-color:#713f12"><div class="ph"><span class="t">HUMAN REVIEW — CLASSIFICATION</span><span class="sub">reason required · the original evidence is never modified</span></div>
        <div class="pb">
          ${c.status === 'DETECTED' ? `<button class="btn primary sm mb12" id="cassign">✓ Assign to me (document & data review)</button>` : `<div class="small muted mb12">Assigned to ${esc(c.reviewerName || 'you')}. Review both documents, then classify.</div>`}
          <label class="fl">Classification</label>
          <select class="inp" id="cclass">${d.classifications.map(x => `<option>${x}</option>`).join('')}</select>
          <label class="fl">Reason *</label><textarea class="inp" id="creason" rows="2" placeholder="Documented reason — becomes part of the audit trail."></textarea>
          <div class="row mt12">
            <button class="btn success" id="cresolve">✔ RESOLVE</button>
            <button class="btn warn" id="cescalate">▲ ESCALATE</button>
          </div>
          <div class="small muted mt8">CRITICAL cases (or POSSIBLE RESULT CHANGE classifications) require a second authorized reviewer after this step.</div>
        </div></div>` : ''}`;
      const as = $('#cassign', m.body);
      if (as) as.onclick = async () => {
        await API.post(`/api/irev/cases/${caseId}/assign`, {});
        toast('Assigned', 'Case assigned to you for review.');
        m.close(); irevCaseModal(caseId);
      };
      const doClassify = async (escalate) => {
        const classification = $('#cclass', m.body).value, reason = $('#creason', m.body).value.trim();
        if (!reason) return toast('Reason required', 'Reviewer classifications require a documented reason.', 'medium');
        try {
          const res = await API.post(`/api/irev/cases/${caseId}/classify`, { classification, reason, escalate });
          toast('Case ' + (escalate ? 'escalated' : 'resolved'), c.code + ' → ' + classification);
          m.close(); irevCache = null; refresh(); render();
        } catch (e) { toast('Classification failed', (e.data && e.data.message) || e.message, 'high'); }
      };
      const r1 = $('#cresolve', m.body);
      if (r1) r1.onclick = () => doClassify(false);
      const e1 = $('#cescalate', m.body);
      if (e1) e1.onclick = () => doClassify(true);
      const s1 = $('#csecond', m.body);
      if (s1) s1.onclick = async () => {
        try {
          const res = await API.post(`/api/irev/cases/${caseId}/classify`, { classification: c.classification || 'MATCH', reason: c.reason || 'Second reviewer confirmation', secondApproval: true });
          toast('Dual control complete', res.status === 'RESOLVED' ? 'Case resolved under two-person approval.' : res.status);
          m.close(); irevCache = null; refresh(); render();
        } catch (e) { toast('Approval failed', (e.data && e.data.message) || e.message, 'high'); }
      };
      const s2 = $('#csecondEsc', m.body);
      if (s2) s2.onclick = async () => {
        try {
          const res = await API.post(`/api/irev/cases/${caseId}/classify`, { classification: c.classification || 'POSSIBLE RESULT CHANGE', reason: c.reason || 'Second reviewer confirmed and escalated', secondApproval: true, escalate: true });
          toast('Escalated', 'Confirmed by second reviewer and escalated.');
          m.close(); irevCache = null; refresh(); render();
        } catch (e) { toast('Approval failed', (e.data && e.data.message) || e.message, 'high'); }
      };
    }).catch(e => { $('#icase', m.body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  // ---------------- remaining new central views ----------------
  function rAgentsCentral(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">FIELD NETWORK — STATEWIDE</span><span class="sp"></span>
      <select class="inp" style="width:170px" id="agsen"><option value="">All districts</option>${ov.senatorial.map(s => `<option>${s}</option>`).join('')}</select>
      <input class="inp" style="width:170px" id="agq" placeholder="Search agent…"></div>
      <div class="pb flat" id="agbody"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    const draw = debounce(async () => {
      const p = new URLSearchParams({ limit: '200' });
      if ($('#agsen', wrap).value) p.set('senatorial', $('#agsen', wrap).value);
      if ($('#agq', wrap).value) p.set('q', $('#agq', wrap).value);
      const res = await API.get('/api/agents?' + p.toString());
      // §31 agent lifecycle
      const lc = { ASSIGNED: 0, ACTIVATED: 0, CHECKED_IN: 0, REPORTING: 0, RESULT_SUBMITTED: 0, DUTY_COMPLETE: 0 };
      res.rows.forEach(a => {
        if (a.dutyState === 'DUTY_COMPLETED') lc.DUTY_COMPLETE++;
        else if (['RESULT_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'].includes(a.dutyState)) lc.RESULT_SUBMITTED++;
        else if (['ON_DUTY', 'POLLING_MONITORING'].includes(a.dutyState)) lc.REPORTING++;
        else if (a.dutyState === 'ACTIVATED') lc.ACTIVATED++;
        else lc.ASSIGNED++;
      });
      if (!wrap.querySelector('#lifestrip')) {
        wrap.insertBefore(el(`<div class="panel"><div class="ph"><span class="t">AGENT LIFECYCLE</span><span class="sub">ASSIGNED → ACTIVATED → CHECKED IN → REPORTING → RESULT SUBMITTED → DUTY COMPLETE</span></div>
        <div class="pb"><div class="flex" id="lifestrip" style="flex-wrap:wrap;gap:8px">${Object.entries(lc).map(([k2, v2]) => `<span class="pill">${esc(k2)}: <b>${fmtN(v2)}</b></span>`).join('')}</div></div></div>`), wrap.querySelector('.pb'));
      }
      const t = dataTable({
        cols: [
          { label: 'Code', key: 'code', cls: 'mono' }, { label: 'Name', key: 'name' }, { label: 'PU', key: 'puId', cls: 'mono' },
          { label: 'LGA', key: 'lga' }, { label: 'District', key: 'senatorial' },
          { label: 'Duty', key: 'dutyState', render: r => statusBadge(r.dutyState) },
          { label: 'Network', key: 'online', render: r => `<span class="st ${r.online ? 'ok' : 'bad'}">${r.online ? 'ONLINE' : 'OFFLINE'}</span>` },
          { label: 'Battery', key: 'battery', cls: 'num', render: r => `${r.battery}%` },
          { label: 'Last seen', key: 'lastHeartbeat', render: r => r.lastHeartbeat ? timeAgoWat(r.lastHeartbeat, ov.sim.now) : '—' },
        ],
        rows: res.rows, sortable: true, pageSize: 25,
      });
      t.setTitle(`${res.total} agents statewide`);
      $('#agbody', wrap).innerHTML = ''; $('#agbody', wrap).appendChild(t.el);
    }, 300);
    ['agsen', 'agq'].forEach(id => $('#' + id, wrap).addEventListener('input', draw));
    draw();
  }
  function rConnectivityCentral(b) {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">CONNECTIVITY — STATEWIDE HEATMAP</span><span class="sub">agent online share per LGA</span></div>
      <div class="pb flat" style="height:480px"><div id="chmap" style="width:100%;height:100%"></div></div></div>`);
    b.appendChild(wrap);
    const m = createMap($('#chmap', wrap), bootstrap, {});
    m.setData({ lgas: ov.lgas });
    m.setLgaMetric(l => l.agents ? Math.round(l.agentsOnline / l.agents * 100) : 0);
  }
  function rEvidenceCentral(b) {
    const wrap = el(`<div id="evwrap"><span class="dim small">Loading statewide EC8A evidence…</span></div>`);
    b.appendChild(wrap);
    API.get('/api/senatorial/evidence').then(res => {
      const s = res.stats;
      wrap.innerHTML = `<div class="kpis">
        ${kpiCard('Documents received', fmtN(s.received))}
        ${kpiCard('Pending review', fmtN(s.pendingReview), { cls: s.pendingReview ? 'warn' : '' })}
        ${kpiCard('Low quality', fmtN(s.lowQuality), { cls: s.lowQuality ? 'warn' : '' })}
        ${kpiCard('Verified', fmtN(s.verified), { cls: 'ok' })}
        ${kpiCard('Disputed', fmtN(s.disputed), { cls: s.disputed ? 'alert' : '' })}
        ${kpiCard('Requires review', fmtN(s.requiresReview), { cls: s.requiresReview ? 'warn' : '' })}
      </div>
      <div class="panel"><div class="ph"><span class="t">EC8A EVIDENCE — ALL DISTRICTS</span><span class="sub">data-quality signals are decision support, never automatic fraud determinations</span></div>
      <div class="pb flat" style="max-height:520px;overflow:auto"><table class="tbl"><tr><th>Evidence</th><th>PU</th><th>LGA</th><th>Doc</th><th>OCR</th><th>Math</th><th>Dup</th><th>Meta</th><th>Status</th><th></th></tr>
      ${res.rows.length ? res.rows.map(r => `<tr>
        <td class="mono">${esc(r.code)}</td><td class="mono">${esc(r.puId)}</td><td>${esc(r.lga)}</td>
        <td>${r.signals.documentQuality === 'GOOD' ? '<span class="badge s-verified">GOOD</span>' : '<span class="badge l3">ATTENTION</span>'}</td>
        <td>${r.signals.ocrConfidence === 'HIGH' ? '<span class="badge s-verified">HIGH</span>' : r.signals.ocrConfidence === 'MEDIUM' ? '<span class="badge s-under">MED</span>' : '<span class="badge l4">LOW</span>'}</td>
        <td>${r.signals.mathReconciliation === 'PASSED' ? 'PASSED' : '<span class="badge l4">REVIEW</span>'}</td>
        <td>${r.signals.duplicateSignal === 'CLEAR' ? 'CLEAR' : '<span class="badge l4">DUP?</span>'}</td>
        <td>${r.signals.metadata === 'COMPLETE' ? 'COMPLETE' : '<span class="badge l3">INCOMPLETE</span>'}</td>
        <td>${statusBadge(r.status)}</td><td><button class="btn sm" data-pu="${r.puId}">PU record</button></td>
      </tr>`).join('') : '<tr><td colspan="10" class="empty">No EC8A documents yet</td></tr>'}
      </table></div></div>`;
      $$('[data-pu]', wrap).forEach(x => x.onclick = () => irevPuModal(x.dataset.pu));
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rSignalsCentral(b) {
    const out = [];
    const sen = ov.senatorial;
    for (const sd of sen) {
      if (sd.pending > 30) out.push({ sev: sd.pending > 60 ? 'HIGH' : 'MEDIUM', title: 'VERIFICATION BACKLOG', note: `${sd.name}: ${sd.pending} submissions pending review.` });
      if (sd.reportingPct < 60) out.push({ sev: 'HIGH', title: 'REPORTING GAP', note: `${sd.name}: only ${sd.reportingPct}% of polling units reported. The system does not infer why a report is missing.` });
    }
    if (ov.kpis.activeSos) out.push({ sev: 'CRITICAL', title: 'ACTIVE SOS', note: `${ov.kpis.activeSos} active emergency signal(s) statewide.` });
    if (ov.kpis.criticalIncidents) out.push({ sev: 'CRITICAL', title: 'CRITICAL INCIDENTS', note: `${ov.kpis.criticalIncidents} Level-5 incident(s) active.` });
    if (ov.kpis.anomalies) out.push({ sev: 'MEDIUM', title: 'DATA-QUALITY FLAGS', note: `${ov.kpis.anomalies} record(s) flagged — neutral language by design.` });
    b.appendChild(el(`<div class="pub-note">Operational signals require human review. The system never automatically concludes fraud, rigging, intimidation or electoral manipulation without verified evidence.</div>
    ${out.length ? out.map(s => `<div class="signal-card ${s.sev.toLowerCase()}"><div class="s-head">${s.sev === 'CRITICAL' ? '🚨' : '⚠'} <b>${esc(s.title)}</b><span class="badge ${s.sev === 'CRITICAL' ? 'l5' : s.sev === 'HIGH' ? 'l4' : 'l3'}">${esc(s.sev)}</span><span class="pill">SIGNAL REQUIRES HUMAN REVIEW</span></div><div class="s-note">${esc(s.note)}</div></div>`).join('') : '<div class="panel"><div class="pb empty">No active operational signals.</div></div>'}`));
  }
  function rIntelBrief(b) {
    const k = ov.kpis;
    b.appendChild(el(`<div class="panel"><div class="pb">
      <div class="brief-sec"><div class="b-t">CURRENT STATUS</div><div class="b-x">${fmtN(k.submittedPu)} of ${fmtN(k.totalPu)} polling units reporting (${k.reportingPct}%) · ${fmtN(k.verifiedPu)} verified · ${fmtN(k.agentsOnline)}/${fmtN(k.agentsTotal)} agents online.</div></div>
      <div class="brief-sec"><div class="b-t">INCIDENTS & SOS</div><div class="b-x">${fmtN(k.activeIncidents)} active incidents (${fmtN(k.criticalIncidents)} critical) · ${fmtN(k.activeSos)} active SOS.</div></div>
      <div class="brief-sec"><div class="b-t">IReV WATCHTOWER</div><div class="b-x" id="briefirev">Loading reconciliation summary…</div></div>
      <div class="brief-sec"><div class="b-t">PRIORITY ACTIONS</div><div class="b-x"><a href="#" data-go="signals">Open operational signals →</a> · <a href="#" data-go="irevrecon">Open reconciliation matrix →</a> · <a href="#" data-go="whatchanged">What changed? →</a></div></div>
    </div></div>`));
    $$('[data-go]', b).forEach(x => x.onclick = (e) => { e.preventDefault(); setTab(x.dataset.go); });
    loadIrev().then(ir => {
      $('#briefirev', b).innerHTML = `${fmtN(ir.kpis.observed)} observed (${ir.kpis.coveragePct}%) · ${fmtN(ir.kpis.matched)} matched · ${fmtN(ir.kpis.pending)} pending · ${fmtN(ir.kpis.underReview)} cases under review — <a href="#" data-go="watchtower">open Watchtower →</a>`;
      const a = $('#briefirev [data-go]', b); if (a) a.onclick = (e) => { e.preventDefault(); setTab('watchtower'); };
    }).catch(() => { $('#briefirev', b).textContent = '—'; });
  }
  function rEscalationsCentral(b) {
    const wrap = el('<div id="escwrap"><span class="dim small">Loading escalations…</span></div>');
    b.appendChild(wrap);
    const draw = () => {
      API.get('/api/escalations').then(res => {
        wrap.innerHTML = `<div class="panel"><div class="ph"><span class="t">ESCALATIONS FROM LG & SENATORIAL COMMANDS</span><span class="sub">structured cases, never informal messages</span></div>
        <div class="pb flat">${res.rows.length ? res.rows.map(e => `
          <div class="esc-card" data-esc="${e.id}">
            <div class="e-head"><b>${esc(e.code)}</b><span class="pill">${esc(e.type)}</span><span class="badge ${e.priority === 'CRITICAL' ? 'l5' : e.priority === 'HIGH' ? 'l4' : e.priority === 'MEDIUM' ? 'l3' : 'l2'}">${esc(e.priority)}</span>${statusBadge(e.status)}<span class="pill">${esc(e.senatorial)}</span><span class="right small dim">${fmtWatShort(e.createdAt)}</span></div>
            <div class="e-body">${esc(e.summary.slice(0, 140))}${e.summary.length > 140 ? '…' : ''}<br><span class="dim">ref: ${esc(e.refId)} · by ${esc(e.fromName)} (${esc(e.fromRole)})</span></div>
          </div>`).join('') : '<div class="empty">No escalations received.</div>'}</div></div>`;
        $$('[data-esc]', wrap).forEach(x => x.onclick = () => {
          const e = res.rows.find(r => r.id === x.dataset.esc);
          const m = modal({
            title: `${e.code} — escalation case`,
            wide: true,
            body: () => el(`<div>
              <div class="flex mb12">${statusBadge(e.status)}<span class="badge ${e.priority === 'CRITICAL' ? 'l5' : e.priority === 'HIGH' ? 'l4' : 'l3'}">${e.priority}</span><span class="pill">${e.type}</span></div>
              <div class="detail-grid"><span class="k">Reference</span><span class="v mono">${esc(e.refId)}</span><span class="k">Raised by</span><span class="v">${esc(e.fromName)} (${esc(e.fromRole)})</span><span class="k">District</span><span class="v">${esc(e.senatorial)}</span></div>
              <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Summary</span></div><div class="pb small">${esc(e.summary)}</div></div>
              <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">Actions taken / requested attention</span></div><div class="pb small">${esc(e.actionsTaken || '—')}<br><b>Requested:</b> ${esc(e.requestedAttention || '—')}</div></div>
              <div class="panel mt12" style="margin:0"><div class="ph"><span class="t">History</span></div><div class="pb">${e.updates.map(u => `<div class="small mb12"><b>${esc(u.status)}</b> — ${esc(u.note || '')} <span class="dim">· ${fmtWatShort(u.at)} · ${esc(u.by)}</span></div>`).join('')}</div></div>
              ${['SUBMITTED', 'ACKNOWLEDGED', 'IN_PROGRESS'].includes(e.status) ? `<div class="row mt12">
                <button class="btn" data-es="${e.id}" data-st="ACKNOWLEDGED">✓ Acknowledge</button>
                <button class="btn" data-es="${e.id}" data-st="IN_PROGRESS">▶ In progress</button>
                <button class="btn success" data-es="${e.id}" data-st="RESOLVED">✔ Resolve</button>
              </div>` : ''}
            </div>`),
            actions: [{ label: 'Close', cls: 'ghost' }],
          });
          $$('[data-es]', m.body).forEach(x => x.onclick = async () => {
            await API.post(`/api/escalations/${x.dataset.es}/status`, { status: x.dataset.st, note: 'Updated from Central Situation Room' });
            toast('Escalation updated', e.code + ' → ' + x.dataset.st);
            m.close(); refresh(); render();
          });
        });
      }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
    };
    draw();
  }
  function rLatencyCentral(b) {
    const wrap = el('<div><span class="dim small">Loading upload latency analytics…</span></div>');
    b.appendChild(wrap);
    API.get('/api/irev/latency').then(lat => {
      wrap.innerHTML = `<div class="kpis">
        ${kpiCard('Average', Math.round(lat.averageMin) + 'm', { sub: 'field capture → IReV observation' })}
        ${kpiCard('Median', lat.medianMin + 'm')}
        ${kpiCard('Maximum', lat.maxMin + 'm', { cls: lat.maxMin > 60 ? 'warn' : '' })}
      </div>
      <div class="pub-note">Observed publication latency — not necessarily internal INEC processing time.</div>
      <div class="panel"><div class="ph"><span class="t">LATENCY BY LGA</span><span class="sub">minutes</span></div>
      <div class="pb chart-box">${barChart({ data: lat.byLga.map(x => x.avg), labels: lat.byLga.map(x => x.lga.length > 9 ? x.lga.slice(0, 8) + '…' : x.lga), h: 240, color: '#38bdf8' })}</div></div>`;
    }).catch(e => { wrap.innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }
  function rChainCentral(b) {
    const wrap = el(`<div class="pub-note">Evidence chain: CAPTURED → UPLOADED → SERVER RECEIVED → LG VIEWED → SENATORIAL REVIEW → VERIFICATION → ARCHIVED. No user can rewrite this history.</div>
    <div class="panel"><div class="ph"><span class="t">EVIDENCE CHAIN — IReV SNAPSHOTS & FIELD EVIDENCE</span></div>
    <div class="pb" id="chbox"><span class="dim small">Loading…</span></div></div>`);
    b.appendChild(wrap);
    API.get('/api/irev/snapshots').then(res => {
      $('#chbox', wrap).innerHTML = `<table class="tbl"><tr><th>Observation</th><th>PU</th><th>Source</th><th>Hash</th><th>Observed</th><th>Available</th></tr>
      ${res.rows.slice(0, 40).map(o => `<tr><td class="mono">${esc(o.code)}</td><td class="mono">${esc(o.puId)}</td><td>${esc(o.sourceMethod)}</td><td class="mono small">${esc(o.docHash.slice(0, 16))}…</td><td>${fmtWatShort(o.observedAt)}</td><td>${o.available === false ? '<span class="badge l5">NOT OBSERVED NOW</span>' : '<span class="badge s-verified">OBSERVED</span>'}</td></tr>`).join('')}</table>`;
    }).catch(() => { $('#chbox', wrap).innerHTML = '<div class="empty">—</div>'; });
  }
  function rSecurityCentral(b) {
    b.appendChild(el(`<div class="grid3">
      <div class="panel"><div class="ph"><span class="t">ACCESS</span></div><div class="pb small" style="line-height:1.9">RBAC on every endpoint · MFA · rate limiting · session expiration · device/session monitoring · audit trails. Client-side permissions are advisory only.</div></div>
      <div class="panel"><div class="ph"><span class="t">IReV INTEGRATION BOUNDARY</span></div><div class="pb small" style="line-height:1.9">Authorized channels only — OFFICIAL API / OFFICIAL FEED / AUTHORIZED EXPORT / PUBLIC IReV OBSERVATION. No penetration, bypass or reverse-engineering of protected INEC infrastructure. Technical restrictions are respected; rate limits are never circumvented.</div></div>
      <div class="panel"><div class="ph"><span class="t">PUBLICATION CONTROL</span></div><div class="pb small" style="line-height:1.9">AUTOMATED SIGNAL → HUMAN REVIEW → EVIDENCE CONFIRMATION → AUTHORIZED DECISION → APPROVED REPORT. No automated discrepancy ever becomes a public accusation.</div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">DISASTER RECOVERY</span></div>
    <div class="pb small muted">Automated backups · immutable evidence storage · queue persistence · offline archival · backup verification. Field evidence continues to be preserved even if the IReV monitoring component becomes unavailable.</div></div>`));
  }

  const RENDERS = { command: rCommand, map: rMap, wall: rWall, whatchanged: rWhatChanged, feed: rFeed, agents: rAgentsCentral, senatorial: rSenatorial, lg: rLg, connectivity: rConnectivityCentral, results: rResults, resultflow: rResultFlow, evidence: rEvidenceCentral, verify: rVerify, watchtower: rWatchtower, irevpending: rIrevPending, irevmatrix: rIrevMatrix, irevarchive: rIrevArchive, irevchanges: rIrevChanges, irevrecon: rIrevRecon, discrepancies: rDiscrepancies, irevsource: rIrevSource, intel: rIntelBrief, signals: rSignalsCentral, copilot: rIntel, incidents: rIncidents, sos: rSos, escalations: rEscalationsCentral, tasks: rTasks, comms: rComms, shifts: rShifts, analytics: rAnalytics, latency: rLatencyCentral, reports: rReports, irevsitrep: rIrevSitrep, reporthistory: rReportHistory, audit: rAudit, chain: rChainCentral, security: rSecurityCentral, health: rHealth };
  render();
})();
