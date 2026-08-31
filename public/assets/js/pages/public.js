// public.js — EYES OF VICTORY — ELECTION OBSERVATORY 2.0
// Public-safe domain: monitoring data vs official results, source+status+last-updated on
// every statistic, LGA-level incident resolution, status legend, corrections centre,
// data desk, low-data mode, mobile-first bottom navigation.
'use strict';
(async () => {
  const PS = window.safeStore || { get: () => null, set: () => {} };
  let KPIS = null, GEO = null, STATS = null, wardCache = null, view = 'home', lowData = PS.get('eov_lowdata') === '1';
  const DISCLAIMER = 'UNOFFICIAL MONITORING DATA — DEMO SIMULATION. NOT INEC OFFICIAL RESULTS.';

  const get = async (p) => fetch(p).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  try {
    [KPIS, GEO, STATS] = await Promise.all([get('/api/public/kpis'), get('/api/public/geo'), get('/api/public/statistics')]);
  } catch (e) {
    KPIS = { kpis: { totalPu: 0, monitoredPus: 0, fieldReports: 0, resultDocs: 0, irevObserved: 0, matched: 0, reconciliationPct: 0, incidents: { total: 0 } }, lastUpdated: Date.now(), lifecycle: 'ELECTION_DAY' };
    GEO = null;
  }

  const fmtUpdated = () => fmtWatShort(KPIS.lastUpdated || Date.now());
  const geoLgas = () => {
    if (!GEO || !GEO.lgas) return [];
    const statsByName = {};
    (STATS ? STATS.lgas : []).forEach(l => { statsByName[l.name] = l; });
    return GEO.lgas.map(g => ({ ...g, reportingPct: (statsByName[g.name] || {}).reportingPct || 0, verifiedPct: (statsByName[g.name] || {}).verifiedPct || 0 }));
  };
  const N = (n) => fmtN(n || 0);

  // ---------------- shell ----------------
  const host = el(`<div>
    <div class="pub-header"><div class="pub-container" style="display:flex;align-items:center;gap:12px;padding-top:10px;padding-bottom:8px;flex-wrap:wrap">
      <a href="#home" style="text-decoration:none"><img src="/assets/media/logo-card.png" alt="EYES OF VICTORY" style="height:46px;width:auto;object-fit:contain;border-radius:8px" onerror="this.style.display='none'"></a>
      <div><b style="color:#0e1c31;font-size:16px">EYES OF VICTORY — ELECTION OBSERVATORY</b>
      <div class="small" style="color:#5b718d">See the Evidence. Follow the Process. Understand the Election.</div></div>
      <span class="flex1"></span>
      <span class="pill" style="background:#e7f2fb;border-color:#c4ddf2;color:#0b6aa8">${esc(fmtUpdated())} WAT</span>
      <button class="btn sm" id="lowdata" style="border-color:#d7e0ec;background:#fff">📶 ${lowData ? 'LOW DATA: ON' : 'LOW DATA MODE'}</button>
    </div></div>
    <div class="pub-container pub-nav" id="nav" style="flex-wrap:wrap"></div>
    <div class="pub-container" id="main" style="padding-top:16px;padding-bottom:60px"></div>
    <div class="footer" style="margin-bottom:0"><div class="pub-container">
      <div class="stat-note mb12" id="disc"></div>
      <div><b>EYES OF VICTORY is an independent election-monitoring information platform.</b> Information displayed on this portal represents monitoring observations and verified public information according to the platform's stated methodology. It should not be interpreted as official election results unless explicitly identified as such. <a href="#sources">Data sources →</a> · <a href="#privacy">Privacy →</a> · <a href="#api">Open data API →</a></div>
      <div class="small mt8" style="color:#8ba0b8">© 2026–2027 EYES OF VICTORY Election Operations · Not affiliated with INEC · DEMO DATA — NOT OFFICIAL ELECTION RESULTS</div>
    </div></div>
    <div class="bottomnav" id="bnav" style="position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e3e9f2;display:none;z-index:100"></div>
    <div class="watermark">DEMO DATA — NOT OFFICIAL ELECTION RESULTS</div>
  </div>`);
  document.body.innerHTML = '';
  document.body.appendChild(host);
  $('#disc').textContent = '⚠ ' + DISCLAIMER + ' · Last updated: ' + fmtUpdated() + ' · Lifecycle: ' + KPIS.lifecycle.replace('_', ' ');

  $('#lowdata').onclick = () => { lowData = !lowData; PS.set('eov_lowdata', lowData ? '1' : '0'); toast('Low data mode ' + (lowData ? 'enabled' : 'disabled'), lowData ? 'Maps simplified, images compressed, animations reduced, text loaded first.' : 'Full experience restored.'); render(); };

  // ---------------- navigation ----------------
  const NAV = [
    ['home', 'HOME'],
    ['live', 'LIVE ELECTION'],
    ['map', 'MAP'],
    ['results', 'RESULT OBSERVATORY'],
    ['irev', 'IReV WATCH'],
    ['kano', 'KANO'],
    ['incidents', 'INCIDENTS'],
    ['stats', 'STATISTICS'],
    ['reports', 'REPORTS'],
    ['transparency', 'TRANSPARENCY'],
    ['media', 'MEDIA'],
    ['about', 'ABOUT'],
  ];
  const drawNav = () => {
    $('#nav').innerHTML = NAV.map(([id, l]) => `<a href="#${id}" class="${view === id ? 'active' : ''}" data-n="${id}">${l}</a>`).join('') +
      `<span class="flex1"></span><a href="#search" class="${view === 'search' ? 'active' : ''}" data-n="search">⌕ SEARCH</a>`;
    $$('[data-n]', $('#nav')).forEach(a => a.onclick = (e) => { e.preventDefault(); setView(a.dataset.n); });
    // mobile bottom nav
    const bnav = $('#bnav');
    const isMobile = window.innerWidth < 860;
    bnav.style.display = isMobile ? 'flex' : 'none';
    if (isMobile) {
      const items = [['home', '🏠', 'HOME'], ['map', '🗺', 'MAP'], ['results', '📊', 'RESULTS'], ['irev', '👁', 'IReV'], ['incidents', '⚠️', 'INCIDENTS'], ['more', '⋯', 'MORE']];
      bnav.innerHTML = items.map(([id, ic, l]) => `<div class="bn2 ${view === id || (id === 'more' && ['reports', 'stats', 'kano', 'transparency', 'media', 'about', 'search'].includes(view)) ? 'active' : ''}" data-b="${id}"><span class="bi">${ic}</span>${l}</div>`).join('');
      $$('[data-b]', bnav).forEach(x => x.onclick = () => {
        if (x.dataset.b === 'more') return moreMenu();
        setView(x.dataset.b);
      });
    }
  };
  function moreMenu() {
    const items = [['reports', 'Reports'], ['kano', 'Kano Observatory'], ['stats', 'Statistics'], ['transparency', 'Transparency'], ['media', 'Media'], ['about', 'About'], ['api', 'Open Data API']];
    const m = modal({
      title: 'More — Election Observatory',
      body: () => el(`<div>${items.map(([id, l]) => `<div class="pm" data-go="${id}" style="display:flex;align-items:center;gap:10px;padding:11px 8px;border-bottom:1px solid #edf1f7;cursor:pointer"><b style="color:#233650">${l}</b><span class="right" style="color:#8ba0b8">→</span></div>`).join('')}</div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $$('[data-go]', m.body).forEach(x => x.onclick = () => { m.close(); setView(x.dataset.go); });
  }
  function setView(v) { view = v; window.scrollTo(0, 0); render(); }
  window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && V[h]) view = h; render(); });

  function render() {
    drawNav();
    $('#main').innerHTML = '';
    (V[view] || V.home)($('#main'));
  }

  // ---------------- helpers ----------------
  const SRC = (label, kind, updated) => `<span class="pill" style="background:#fff;border-color:#d7e0ec;color:#33465f"><b>${esc(label)}</b> · ${esc(kind)} · updated ${fmtWatShort(updated)}</span>`;
  const kpiPub = (label, value, { sub, cls } = {}) => `<div class="kpi ${cls || ''}"><div class="l">${esc(label)}</div><div class="v">${value}</div>${sub ? `<div class="d">${sub}</div>` : ''}</div>`;
  const stBadgePub = (status) => {
    const map = { VERIFIED: ['s-verified', 'VERIFIED'], OBSERVED: ['s-submitted', 'OBSERVED'], REPORTED: ['s-submitted', 'REPORTED'], 'UNDER REVIEW': ['s-under', 'UNDER REVIEW'], PENDING: ['s-archived', 'PENDING'], MATCHED: ['s-verified', 'MATCHED'], RECEIVED: ['s-submitted', 'RECEIVED'], ACTIVE: ['s-verified', 'ACTIVE'], 'NOT RECEIVED': ['s-archived', 'NOT RECEIVED'], 'NOT OBSERVED': ['s-archived', 'NOT OBSERVED'] };
    const m2 = map[status] || ['s-archived', status];
    return `<span class="badge ${m2[0]}">${esc(m2[1])}</span>`;
  };
  const lifecycleBanner = () => {
    const l = KPIS.lifecycle;
    if (l === 'PRE_ELECTION') return `<div class="stat-note mb12">⏳ <b>ELECTION MONITORING STARTS IN</b> — field network preparation phase. Monitoring coverage, connectivity tests and readiness data will appear here.</div>`;
    if (l === 'ELECTION_DAY') return `<div class="stat-note mb12" style="border-color:#c4f0d4;background:#eefdf3;color:#0f6b32">● <b>LIVE MONITORING ACTIVE</b> — data below is current as of ${fmtUpdated()} WAT.</div>`;
    return `<div class="stat-note mb12">🏁 <b>POST-ELECTION RECONCILIATION ACTIVE</b> — result reconciliation, IReV version monitoring and public statistics continue through the review period.</div>`;
  };

  // ---------------- HOME (§3, §59) ----------------
  function vHome(b) {
    const k = KPIS.kpis;
    b.appendChild(el(`
      <div class="center" style="padding:26px 0 8px">
        <div class="pill" style="background:#e7f2fb;border-color:#c4ddf2;color:#0b6aa8;font-size:11px;letter-spacing:1.4px">INDEPENDENT ELECTION MONITORING · VERIFIED DATA · PUBLIC SITUATIONAL AWARENESS</div>
        <h1 style="font-size:clamp(26px,5vw,42px);margin-top:14px">THE ELECTION, AS IT HAPPENS.</h1>
        <p class="lead" style="max-width:640px;margin:12px auto 0">Follow independently monitored election activity, verified field reports, result-document observations, IReV monitoring and public election statistics in one transparent platform.</p>
        <div class="row mt12" style="justify-content:center">
          <button class="btn primary" data-go="live" style="padding:11px 22px;font-size:14px">● LIVE ELECTION MONITOR</button>
          <button class="btn" data-go="results" style="padding:11px 22px;font-size:14px;background:#fff">EXPLORE RESULTS</button>
        </div>
        <div class="small muted mt8"><a href="#methodology" data-j="methodology">VIEW METHODOLOGY</a> · <a href="#about" data-j="about">ABOUT THE PROJECT</a></div>
      </div>
      ${lifecycleBanner()}
      <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
        ${kpiPub('Polling units monitored', N(k.monitoredPus), { sub: 'of ' + N(k.totalPu) + ' configured' })}
        ${kpiPub('Field reports received', N(k.fieldReports))}
        ${kpiPub('Results documents received', N(k.resultDocs))}
        ${kpiPub('IReV records observed', N(k.irevObserved), { cls: 'accent' })}
        ${kpiPub('Records reconciled', N(k.matched), { sub: k.reconciliationPct + '% of observed', cls: 'ok' })}
        ${kpiPub('Incidents reported', N(k.incidents.total))}
        ${kpiPub('Active monitoring', '● LIVE', { cls: 'ok' })}
      </div>
      <div class="small" style="color:#8ba0b8;margin:-6px 0 14px">Every card: <b>last updated ${fmtUpdated()}</b> · ${SRC('Field monitoring network', 'MONITORING DATA', KPIS.sources.field.updatedAt)}</div>
    `));
    // live map teaser
    const mapPanel = el(`<div class="panel"><div class="ph"><span class="t">LIVE ELECTION MONITORING MAP</span><span class="sub">Kano State — click an LGA for its monitoring profile</span><span class="sp"></span><a href="#map" class="small">Full map →</a></div>
    <div class="pb flat" style="height:${lowData ? '0' : '380px'};overflow:hidden"><div id="homemap" style="width:100%;height:100%"></div></div></div>`);
    b.appendChild(mapPanel);
    if (GEO && !lowData) {
      const m = createMap($('#homemap', mapPanel), GEO, { public: true });
      m.setData({ lgas: geoLgas() });
      m.setLgaMetric(l => l.reportingPct);
      m.onClick(({ type, id }) => { if (type === 'LGA') { const lg = (STATS.lgas || []).find(x => x.name.toLowerCase() === (GEO.lgas.find(g => g.id === id)?.name || '').toLowerCase()); if (GEO.lgas.find(g => g.id === id)) lgaProfile(id); } });
    } else {
      $('#homemap', mapPanel).innerHTML = `<div class="empty small">${lowData ? 'Low data mode — <a href="#map">open the map view</a> when bandwidth allows.' : 'Map data unavailable.'}</div>`;
    }
    // what changed + IReV watch + incidents + reports + transparency
    const grid = el(`<div class="grid2" style="margin-top:14px">
      <div class="panel"><div class="ph"><span class="t">WHAT CHANGED? — LIVE ACTIVITY</span><span class="sub">LGA-level only · no personal information</span><span class="sp"></span><a href="#activity" class="small">All →</a></div>
      <div class="pb flat" id="hfeed" style="max-height:260px;overflow:auto"><span class="dim small">Loading…</span></div></div>
      <div class="panel"><div class="ph"><span class="t">IReV WATCH</span><span class="sub">public observations</span><span class="sp"></span><a href="#irev" class="small">Open →</a></div>
      <div class="pb">
        <div class="flex mb12"><span class="small" style="width:150px">Records observed</span><div class="pbar flex1"><div class="fill" style="width:${k.irevCoveragePct}%"></div></div><b class="small" style="color:#0e1c31">${N(k.irevObserved)}</b></div>
        <div class="flex mb12"><span class="small" style="width:150px">Records pending</span><div class="pbar flex1"><div class="fill amber" style="width:${k.irevPending ? Math.min(100, k.irevPending / Math.max(1, k.totalPu) * 300) : 0}%"></div></div><b class="small" style="color:#0e1c31">${N(k.irevPending)}</b></div>
        <div class="flex mb12"><span class="small" style="width:150px">Under review</span><b class="small" style="color:#0e1c31">${N(k.underReview)}</b></div>
        <div class="flex"><span class="small" style="width:150px">Document changes observed</span><b class="small" style="color:#0e1c31">${N(k.docChanges)}</b></div>
        <div class="stat-note mt12">${esc(kpPubNote())}</div>
      </div></div>
    </div>`);
    b.appendChild(grid);
    get('/api/public/activity?limit=8').then(res => {
      $('#hfeed', grid).innerHTML = res.rows.map(r => `<div class="small mb12" style="border-bottom:1px solid #edf1f7;padding-bottom:8px"><b style="color:#0e1c31">${fmtWatShort(r.t)}</b> — ${esc(r.label)} — ${esc(r.loc)} <span class="dim">· ${esc(r.status)}</span></div>`).join('') || '<span class="dim small">No public activity yet.</span>';
    }).catch(() => { $('#hfeed', grid).innerHTML = '<span class="dim small">—</span>'; });
    b.appendChild(el(`<div class="grid3" style="margin-top:14px">
      <div class="panel"><div class="ph"><span class="t">INCIDENT MONITOR</span></div><div class="pb"><div class="small" style="color:#5b718d;line-height:1.9">Total reported: <b style="color:#0e1c31">${N(k.incidents.total)}</b><br>Verified: <b style="color:#157a3a">${N(k.incidents.verified)}</b> · Under review: <b style="color:#8a6200">${N(k.incidents.underReview)}</b> · Open: <b style="color:#0e1c31">${N(k.incidents.open)}</b><br><a href="#incidents" class="small">Open incident monitor →</a></div></div></div>
      <div class="panel"><div class="ph"><span class="t">LATEST REPORTS</span></div><div class="pb" id="hreports"><span class="dim small">Loading…</span></div></div>
      <div class="panel"><div class="ph"><span class="t">WHY TRUST THE DATA?</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.9">
        <b>INDEPENDENT MONITORING</b> — field-level collection.<br>
        <b>EVIDENCE RECONCILIATION</b> — cross-source comparison.<br>
        <b>TRANSPARENT METHODOLOGY</b> — clear explanation of limitations.<br>
        <a href="#methodology" class="small">Read the full methodology →</a>
      </div></div>
    </div>`));
    get('/api/public/reports').then(res => {
      $('#hreports', b).innerHTML = res.rows.length ? res.rows.slice(0, 4).map(r => `<div class="small mb12"><b style="color:#0e1c31">${esc(r.code)}-V${r.version}</b> — ${esc(r.title)}<br><span style="color:#8ba0b8">${fmtWatShort(r.createdAt)}</span></div>`).join('') : '<span class="dim small">No published reports yet.</span>';
    }).catch(() => { $('#hreports', b).innerHTML = '<span class="dim small">—</span>'; });
    $$('[data-go]', b).forEach(x => x.onclick = () => setView(x.dataset.go));
    $$('[data-j]', b).forEach(x => x.onclick = (e) => { e.preventDefault(); setView(x.dataset.j); });
  }
  function kpPubNote() {
    return 'EYES OF VICTORY monitors information available through authorized/public election-result sources and compares observed records with independently collected monitoring evidence. A difference does not automatically establish wrongdoing and may require human verification.';
  }

  // ---------------- LIVE ELECTION (§38) ----------------
  function vLive(b) {
    const k = KPIS.kpis;
    b.appendChild(el(`
      <h1>ELECTION DAY LIVE</h1>
      ${lifecycleBanner()}
      <div class="kpis">
        ${kpiPub('Monitored PUs', N(k.monitoredPus))}${kpiPub('Field reports', N(k.fieldReports))}${kpiPub('Result documents', N(k.resultDocs))}
        ${kpiPub('IReV observed', N(k.irevObserved), { cls: 'accent' })}${kpiPub('Reconciled', N(k.matched), { cls: 'ok' })}${kpiPub('Under review', N(k.underReview), { cls: k.underReview ? 'warn' : '' })}
      </div>
      <div class="panel"><div class="ph"><span class="t">LIVE MONITORING ACTIVITY</span><span class="sub">updated continuously · LGA-level</span></div>
      <div class="pb flat" id="lfeed" style="max-height:420px;overflow:auto"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/activity?limit=50').then(res => {
      $('#lfeed', b).innerHTML = res.rows.map(r => `<div class="small mb12" style="border-bottom:1px solid #edf1f7;padding-bottom:8px"><b style="color:#0e1c31">${fmtWatShort(r.t)}</b> — ${esc(r.label)} — ${esc(r.loc)} <span class="dim">· ${esc(r.status)}</span></div>`).join('') || '<span class="dim small">No activity yet.</span>';
    }).catch(() => { $('#lfeed', b).innerHTML = '<span class="dim small">—</span>'; });
  }

  // ---------------- MAP (§5-8, §28) ----------------
  function vMap(b) {
    const wrap = el(`<div>
      <div class="flex mb12" style="flex-wrap:wrap">
        <div class="map-filters" style="position:static" id="mfilters"></div>
        <input class="inp" style="width:200px" id="msearch" placeholder="Search LGA / ward / PU…">
        <span class="flex1"></span><button class="btn" id="mreset">⌂ Reset</button>
      </div>
      ${lowData ? `<div class="stat-note mb12">Low data mode — text coverage table instead of map:</div><div class="panel"><div class="pb flat" id="lgtbl"></div></div>` : `<div class="map-wrap" style="height:560px"><div id="bigmap" style="width:100%;height:100%"></div></div>`}
      <div class="small muted mt8">Legend: <b style="color:#157a3a">🟢 MONITORED</b> · <b style="color:#b45309">🟡 PENDING</b> · <b style="color:#0b6aa8">🔵 IReV OBSERVED</b> · <b style="color:#8a6200">🟠 UNDER REVIEW</b> · <b style="color:#b91c1c">🔴 PUBLIC INCIDENT</b> · <b style="color:#7186a3">⚪ NO DATA YET</b> — colours never imply political party performance.</div>
    </div>`);
    b.appendChild(wrap);
    const layers = { coverage: true, irev: true, incidents: true };
    const fbox = $('#mfilters', wrap);
    fbox.innerHTML = Object.keys(layers).map(k2 => `<span class="chip on" data-f="${k2}">${k2.toUpperCase()}</span>`).join('');
    const apply = async () => {
      if (lowData) {
        const res = await get('/api/public/statistics');
        $('#lgtbl', wrap).innerHTML = `<table class="tbl"><tr><th>LGA</th><th class="num">Reported</th><th class="num">Verified</th><th>Reporting</th></tr>
        ${res.lgas.map(l => `<tr class="clickable" data-lg="${l.name}"><td><b>${esc(l.name)}</b></td><td class="num">${l.reported}/${l.totalPu}</td><td class="num">${l.verified}</td><td><div class="pbar" style="width:110px"><div class="fill" style="width:${l.reportingPct}%"></div></div> ${l.reportingPct}%</td></tr>`).join('')}</table>`;
        $$('[data-lg]', wrap).forEach(x => x.onclick = () => lgaProfileByName(x.dataset.lg));
        return;
      }
      if (!GEO) return;
      const incs = await get('/api/public/incidents');
      const incMarkers = (incs.byLga || []).filter(x => x.count > 0).map(x => {
        const l = GEO.lgas.find(g => g.name === x.name);
        return l ? { id: 'inc-' + l.id, puId: null, lgaId: l.id, severity: x.open ? 3 : 2, subcategory: 'Public incident', code: 'INC', status: x.open ? 'OPEN' : 'RESOLVED' } : null;
      }).filter(Boolean);
      const m = createMap($('#bigmap', wrap), GEO, { public: true });
      m.setData({ lgas: geoLgas(), incidents: layers.incidents ? incMarkers : [], sos: [] });
      m.setLgaMetric(l => layers.coverage ? l.reportingPct : 0);
      m.onClick(({ type, id }) => { if (type === 'LGA') lgaProfile(id); });
      wrap._map = m;
    };
    apply();
    $$('[data-f]', fbox).forEach(c => c.onclick = () => { layers[c.dataset.f] = !layers[c.dataset.f]; c.classList.toggle('on', layers[c.dataset.f]); apply(); });
    $('#mreset', wrap).onclick = () => { Object.keys(layers).forEach(k2 => layers[k2] = true); $$('[data-f]', fbox).forEach(c => c.classList.add('on')); apply(); };
    $('#msearch', wrap).addEventListener('input', debounce(async () => {
      const q = $('#msearch', wrap).value.trim();
      if (q.length < 2) return;
      const res = await get('/api/public/search?q=' + encodeURIComponent(q));
      if (res.results.length) {
        const r = res.results[0];
        if (r.type === 'LGA') lgaProfile(r.id);
        else if (r.type === 'PU') puProfile(r.id);
        else toast('Search result', `${r.label} — ${r.sub}`);
      }
    }, 400));
  }
  function lgaProfile(lgaId) {
    const g = GEO ? GEO.lgas.find(x => x.id === lgaId) : null;
    if (!g) return;
    const st = STATS.lgas.find(l => l.name === g.name) || {};
    const m = modal({
      title: `LGA ELECTION MONITORING PROFILE — ${g.name}`,
      wide: true,
      body: () => el(`<div>
        <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
          ${kpiPub('Monitored PUs', N(st.reported), { sub: 'of ' + N(st.totalPu) })}
          ${kpiPub('Reports received', N(st.reported))}
          ${kpiPub('Results documents', N(st.verified))}
          ${kpiPub('IReV observations', N(st.verified), { cls: 'accent' })}
          ${kpiPub('Reconciled', N(st.verified), { cls: 'ok' })}
          ${kpiPub('Pending', N(st.totalPu - (st.submitted || st.reported)))}
        </div>
        <div class="detail-grid">
          <span class="k">Senatorial district</span><span class="v">${esc(g.senatorial)}</span>
          <span class="k">Last update</span><span class="v">${fmtUpdated()}</span>
          <span class="k">Data status</span><span class="v">MONITORING DATA</span>
        </div>
        <div class="stat-note mt12">${DISCLAIMER}</div>
        <div class="row mt12"><button class="btn" id="gwards">VIEW WARDS →</button></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $('#gwards', m.body).onclick = () => { m.close(); wardTable(g.name, g.id); };
  }
  function lgaProfileByName(name) {
    const g = GEO ? GEO.lgas.find(x => x.name === name) : null;
    if (g) lgaProfile(g.id);
  }
  function wardTable(lgaName, lgaId) {
    const m = modal({
      title: `WARDS — ${lgaName}`,
      wide: true,
      body: () => el(`<div id="wbox"><span class="dim small">Loading ward profiles…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    get('/api/public/wards').then(res => {
      const rows = res.rows.filter(w2 => w2.lgaId === lgaId);
      $('#wbox', m.body).innerHTML = `<table class="tbl"><tr><th>Ward</th><th class="num">PUs</th><th>Monitoring</th><th>Results</th><th>IReV</th><th class="num">Incidents</th></tr>
      ${rows.map(w2 => `<tr class="clickable" data-w="${w2.id}"><td><b>${esc(w2.name)}</b></td><td class="num">${w2.pus}</td><td><div class="pbar" style="width:70px"><div class="fill" style="width:${w2.coveragePct}%"></div></div> ${w2.coveragePct}%</td><td>${w2.reported}</td><td>${w2.irev}</td><td class="num" style="color:${w2.incidents ? '#b45309' : ''}">${w2.incidents}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No wards</td></tr>'}</table>`;
      $$('[data-w]', m.body).forEach(x => x.onclick = () => wardProfile(rows.find(r => r.id === x.dataset.w)));
    }).catch(() => { $('#wbox', m.body).innerHTML = '<span class="dim small">—</span>'; });
  }
  function wardProfile(w2) {
    const m = modal({
      title: `WARD PROFILE — ${w2.name}`,
      body: () => el(`<div>
        <div class="small muted mb12">${esc(w2.lga)} · Kano State</div>
        <div class="small flex mb12"><span style="width:130px">Monitoring coverage</span><div class="pbar flex1"><div class="fill" style="width:${w2.coveragePct}%"></div></div><b style="color:#0e1c31">${w2.coveragePct}%</b></div>
        <div class="detail-grid">
          <span class="k">Polling units</span><span class="v">${w2.pus}</span>
          <span class="k">Reports received</span><span class="v">${w2.reported}</span>
          <span class="k">IReV observations</span><span class="v">${w2.irev}</span>
          <span class="k">Reconciled</span><span class="v">${w2.matched}</span>
          <span class="k">Public incidents</span><span class="v">${w2.incidents}</span>
        </div>
        <div class="row mt12"><button class="btn" id="wpus">VIEW POLLING UNITS →</button></div>
      </div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    $('#wpus', m.body).onclick = () => { m.close(); puList(w2.id, w2.name); };
  }
  function puList(wardId, wardName) {
    const m = modal({
      title: `POLLING UNITS — ${wardName}`,
      wide: true,
      body: () => el(`<div id="pubox"><span class="dim small">Loading…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    get('/api/public/wards').then(() => {
      const pus = GEO ? (GEO.pus || []).filter(p => p.wardId === wardId) : [];
      $('#pubox', m.body).innerHTML = `<table class="tbl"><tr><th>PU</th><th>Name</th><th></th></tr>
      ${pus.slice(0, 40).map(p => `<tr><td class="mono">${esc(p.id)}</td><td>${esc(p.name)}</td><td><button class="btn sm" data-pu="${p.id}">Public record</button></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No polling units</td></tr>'}</table>`;
      $$('[data-pu]', m.body).forEach(x => x.onclick = () => { m.close(); puProfile(x.dataset.pu); });
    }).catch(() => { $('#pubox', m.body).innerHTML = '<span class="dim small">—</span>'; });
  }
  function puProfile(puId) {
    const m = modal({
      title: 'POLLING UNIT MONITORING RECORD',
      body: () => el(`<div id="pupro"><span class="dim small">Loading public record…</span></div>`),
      actions: [{ label: 'Close', cls: 'ghost' }],
    });
    get('/api/public/pus/' + puId).then(d => {
      const mo = d.monitoring;
      $('#pupro', m.body).innerHTML = `
        <div class="small muted mb12"><b style="color:#0e1c31">${esc(d.pu.code)}</b> — ${esc(d.pu.name)}<br>${esc(d.pu.ward)} · ${esc(d.pu.lga)} LGA · ${esc(d.pu.state)} State</div>
        <table class="tbl"><tr><th>Monitoring check</th><th>Status</th></tr>
        <tr><td class="small">MONITORING</td><td>${stBadgePub(mo.status)}</td></tr>
        <tr><td class="small">FIELD REPORT</td><td>${stBadgePub(mo.fieldReport)}</td></tr>
        <tr><td class="small">EC8A</td><td>${stBadgePub(mo.ec8a)}</td></tr>
        <tr><td class="small">IReV</td><td>${stBadgePub(mo.irev)}</td></tr>
        <tr><td class="small">RECONCILIATION</td><td>${stBadgePub(mo.reconciliation)}</td></tr>
        <tr><td class="small">VERIFICATION</td><td>${stBadgePub(mo.verifiedStatus)}</td></tr></table>
        <div class="small muted mt12">Last update: ${fmtWatShort(d.lastUpdated)} WAT · ${esc(d.disclaimer)}</div>`;
    }).catch(e => { $('#pupro', m.body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  }

  // ---------------- RESULT OBSERVATORY (§11-15) ----------------
  function vResults(b) {
    const wrap = el(`<div>
      <h1>RESULT OBSERVATORY</h1>
      <p class="lead mt8">Search and filter monitored result records. Every record shows its document, IReV and reconciliation status. <b>Monitored vote data is never presented as official results, and no "winner" is ever declared prematurely.</b></p>
      <div class="stat-note mt8 mb12">Status legend: <b>RECEIVED</b> document received by monitoring network · <b>OBSERVED</b> corresponding IReV/public source record observed · <b>RECONCILED</b> available sources agree · <b>UNDER REVIEW</b> a difference or uncertainty requires review · <b>PENDING</b> insufficient information.</div>
      <div class="flex mb12" style="flex-wrap:wrap">
        <input class="inp" style="width:220px" id="rq" placeholder="Search LGA / PU…">
        <select class="inp" style="width:170px" id="rlga"><option value="">All LGAs</option></select>
        <select class="inp" style="width:170px" id="rstatus"><option value="">All statuses</option><option>MATCHED</option><option>PENDING</option><option>FIELD_VS_IREV</option><option>EYES_VS_IREV</option><option>UNAVAILABLE</option><option>REVIEW</option></select>
      </div>
      <div class="panel"><div class="pb flat" id="rtable"><span class="dim small">Loading result records…</span></div></div>
    </div>`);
    b.appendChild(wrap);
    get('/api/public/statistics').then(st => {
      const sel = $('#rlga', wrap);
      st.lgas.forEach(l => sel.insertAdjacentHTML('beforeend', `<option>${esc(l.name)}</option>`));
    }).catch(() => {});
    let allRows = [];
    get('/api/public/geo').then(() => get('/api/public/wards')).then(() => {}).catch(() => {});
    const draw = async () => {
      if (!allRows.length) {
        const rec = await get('/api/public/reconciliation').catch(() => null);
        if (rec) allRows = rec.rows; else allRows = [];
      }
      const q = $('#rq', wrap).value.toLowerCase();
      const lga = $('#rlga', wrap).value;
      const status = $('#rstatus', wrap).value;
      let rows = allRows;
      if (q) rows = rows.filter(r => r.code.toLowerCase().includes(q) || r.lga.toLowerCase().includes(q));
      if (lga) rows = rows.filter(r => r.lga === lga);
      if (status) rows = rows.filter(r => r.status === status);
      $('#rtable', wrap).innerHTML = `<table class="tbl"><tr><th>PU</th><th>Ward</th><th>LGA</th><th>Result document</th><th>IReV</th><th>Reconciliation</th><th>Status</th></tr>
      ${rows.slice(0, 60).map(r => `<tr class="clickable" data-pu="${r.puId}"><td class="mono">${esc(r.code)}</td><td>${esc(r.ward)}</td><td>${esc(r.lga)}</td><td>${r.fieldReceived ? '<span class="badge s-submitted">RECEIVED</span>' : '<span class="badge s-archived">NOT RECEIVED</span>'}</td><td>${r.observed ? '<span class="badge s-submitted">OBSERVED</span>' : '<span class="badge s-archived">PENDING</span>'}</td><td>${r.status === 'MATCHED' ? '<span class="badge s-verified">RECONCILED</span>' : r.status === 'PENDING' ? '<span class="badge s-archived">PENDING</span>' : '<span class="badge s-under">UNDER REVIEW</span>'}</td><td>${r.eovStatus === 'VERIFIED' ? stBadgePub('VERIFIED') : stBadgePub(r.eovStatus === 'REJECTED' || r.eovStatus === 'DISPUTED' ? 'UNDER REVIEW' : 'REPORTED')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No matching public records.</td></tr>'}</table>
      <div class="small muted mt8">Showing ${Math.min(60, rows.length)} of ${rows.length} public monitoring records · ${DISCLAIMER}</div>`;
      $$('[data-pu]', wrap).forEach(x => x.onclick = () => puProfile(x.dataset.pu));
    };
    ['rq', 'rlga', 'rstatus'].forEach(id => $('#' + id, wrap).addEventListener('input', debounce(draw, 250)));
    draw();
  }

  // ---------------- IReV WATCH (§16-19) ----------------
  function vIrev(b) {
    const k = KPIS.kpis;
    b.appendChild(el(`
      <h1>IReV WATCH</h1>
      <div class="stat-note mb12"><b>What does IReV Watch mean?</b> EYES OF VICTORY monitors information available through authorized/public election-result sources and compares observed records with independently collected monitoring evidence. A difference does not automatically establish wrongdoing and may require human verification.</div>
      <div class="kpis">
        ${kpiPub('Records observed', N(k.irevObserved), { sub: k.irevCoveragePct + '% coverage', cls: 'accent' })}
        ${kpiPub('Records pending', N(k.irevPending), { cls: k.irevPending ? 'warn' : '' })}
        ${kpiPub('Records under review', N(k.underReview), { cls: k.underReview ? 'warn' : '' })}
        ${kpiPub('Document changes observed', N(k.docChanges), { cls: k.docChanges ? 'alert' : '' })}
        ${kpiPub('Source status', 'OBSERVING', { cls: 'ok' })}
      </div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">WHAT CHANGED? — PUBLIC CHANGE MONITOR</span><span class="sub">approved, verified observations only</span><span class="sp"></span><a href="#activity" class="small">Timeline →</a></div>
        <div class="pb flat" id="cf" style="max-height:340px;overflow:auto"><span class="dim small">Loading…</span></div></div>
        <div class="panel"><div class="ph"><span class="t">OBSERVATIONS BY LGA</span><span class="sub">public-safe aggregates</span></div>
        <div class="pb flat" id="om" style="max-height:340px;overflow:auto"><span class="dim small">Loading…</span></div></div>
      </div>
      <div class="pub-note mt12" style="background:#eef3f9;border-color:#d7e0ec;color:#4a5f7c">Changes are only published after appropriate verification/publication review. A record that is "currently unavailable" means it could not be observed at that moment — it never means a record was deleted.</div>
    `));
    get('/api/public/activity?limit=40').then(res => {
      const irevRows = res.rows.filter(r => r.type === 'IREV' || r.type === 'RECONCILIATION');
      $('#cf', b).innerHTML = irevRows.map(r => `<div class="small mb12" style="border-bottom:1px solid #edf1f7;padding-bottom:8px"><b style="color:#0e1c31">${fmtWatShort(r.t)}</b> — ${esc(r.label)}<br><span style="color:#8ba0b8">${esc(r.loc)} · ${esc(r.status)}</span></div>`).join('') || '<span class="dim small">No public changes yet.</span>';
    }).catch(() => {});
    get('/api/public/statistics').then(st => {
      $('#om', b).innerHTML = st.lgas.map(l => `<div class="small flex mb12"><b style="width:130px;color:#233650">${esc(l.name)}</b><div class="pbar flex1"><div class="fill" style="width:${l.verifiedPct}%"></div></div><b style="color:#233650">${l.verified} observed</b></div>`).join('');
    }).catch(() => {});
  }
  function vActivity(b) {
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">PUBLIC CHANGE TIMELINE</span><span class="sub">only published after appropriate verification/publication review</span></div>
    <div class="pb flat" id="tl"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/activity?limit=100').then(res => {
      $('#tl', b).innerHTML = `<div class="feed">${res.rows.map(r => `<div class="item"><span class="t">${fmtWatShort(r.t)}</span><span class="tx"><b>${esc(r.label)}</b> — ${esc(r.loc)} <span class="dim">· ${esc(r.status)}</span></span></div>`).join('')}</div>`;
    }).catch(() => {});
  }

  // ---------------- KANO (§27-28) ----------------
  function vKano(b) {
    const k = KPIS.kpis;
    const lgCount = GEO ? GEO.lgas.length : 44;
    const wardCount = STATS ? STATS.lgas.reduce((a, l) => a + l.totalPu, 0) : 0;
    b.appendChild(el(`
      <h1>KANO ELECTION OBSERVATORY</h1>
      <div class="small muted" style="letter-spacing:1.4px;text-transform:uppercase">KANO STATE — LIVE MONITORING</div>
      <div class="kpis mt12">
        ${kpiPub('Total LGAs', N(lgCount))}
        ${kpiPub('Total wards', N(STATS ? STATS.lgas.length : 0))}
        ${kpiPub('Monitored polling units', N(k.monitoredPus))}
        ${kpiPub('Reports received', N(k.fieldReports))}
        ${kpiPub('Result documents', N(k.resultDocs))}
        ${kpiPub('IReV observations', N(k.irevObserved), { cls: 'accent' })}
        ${kpiPub('Reconciled records', N(k.matched), { cls: 'ok' })}
        ${kpiPub('Public incidents', N(k.incidents.total))}
      </div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">SENATORIAL DISTRICTS</span><span class="sub">monitoring coverage — never a political performance indicator</span></div>
        <div class="pb flat">${(STATS.senatorial || []).map(s => `
          <div class="small flex mb12" style="cursor:pointer"><b style="width:130px;color:#233650">${esc(s.name)}</b>
          <div class="pbar flex1"><div class="fill" style="width:${s.reportedPct}%"></div></div><b style="color:#233650">${s.reportedPct}%</b>
          <span style="width:110px;text-align:right;color:#7186a3">${s.reported}/${s.totalPu} PUs</span></div>`).join('')}</div></div>
        <div class="panel"><div class="ph"><span class="t">LGAs</span><span class="sp"></span><a href="#kanolga" class="small">All LGA profiles →</a></div>
        <div class="pb flat" id="klgas" style="max-height:340px;overflow:auto"><span class="dim small">Loading…</span></div></div>
      </div>`));
    get('/api/public/statistics').then(st => {
      $('#klgas', b).innerHTML = `<table class="tbl"><tr><th>LGA</th><th>Reporting</th><th class="num">Verified</th></tr>
      ${st.lgas.map(l => `<tr class="clickable" data-lg="${l.name}"><td><b>${esc(l.name)}</b></td><td><div class="pbar" style="width:90px"><div class="fill" style="width:${l.reportingPct}%"></div></div> ${l.reportingPct}%</td><td class="num">${l.verified}</td></tr>`).join('')}</table>`;
      $$('[data-lg]', b).forEach(x => x.onclick = () => lgaProfileByName(x.dataset.lg));
    }).catch(() => {});
  }
  function vKanoLga(b) {
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">LGA MONITORING PROFILES — KANO STATE</span><span class="sub">click an LGA for its full public profile</span></div>
    <div class="pb flat" id="kg"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/statistics').then(st => {
      $('#kg', b).innerHTML = `<div class="grid3">${st.lgas.map(l => `
        <div class="panel" style="margin:0;cursor:pointer" data-lg="${l.name}"><div class="ph"><span class="t">${esc(l.name)}</span></div>
        <div class="pb small" style="color:#5b718d">Reporting ${l.reportingPct}% · Verified ${l.verified} of ${l.totalPu} PUs<br><span class="dim">Last update ${fmtUpdated()}</span></div></div>`).join('')}</div>`;
      $$('[data-lg]', b).forEach(x => x.onclick = () => lgaProfileByName(x.dataset.lg));
    }).catch(() => {});
  }
  function vKanoWards(b) {
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">WARD COVERAGE — KANO STATE</span><span class="sub">monitoring coverage by ward · click for the ward profile</span></div>
    <div class="pb flat" id="kw"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/wards').then(res => {
      $('#kw', b).innerHTML = `<table class="tbl"><tr><th>Ward</th><th>LGA</th><th class="num">PUs</th><th>Monitoring</th><th class="num">Reports</th><th class="num">IReV</th><th class="num">Incidents</th></tr>
      ${res.rows.slice(0, 80).map(w2 => `<tr class="clickable" data-w="${w2.id}"><td><b>${esc(w2.name)}</b></td><td>${esc(w2.lga)}</td><td class="num">${w2.pus}</td><td><div class="pbar" style="width:70px"><div class="fill" style="width:${w2.coveragePct}%"></div></div> ${w2.coveragePct}%</td><td class="num">${w2.reported}</td><td class="num">${w2.irev}</td><td class="num">${w2.incidents}</td></tr>`).join('')}</table>`;
      $$('[data-w]', b).forEach(x => x.onclick = () => { const w2 = res.rows.find(r => r.id === x.dataset.w); if (w2) wardProfile(w2); });
    }).catch(() => {});
  }

  // ---------------- INCIDENTS (§20-23) ----------------
  function vIncidents(b) {
    const k = KPIS.kpis.incidents;
    b.appendChild(el(`
      <h1>ELECTION INCIDENT MONITOR</h1>
      <p class="lead mt8">Aggregated public incident statistics at ward/LGA geographic resolution. Agent identity, private GPS coordinates, phone numbers and private communications are never published. Allegations are never published as established facts.</p>
      <div class="kpis mt12">
        ${kpiPub('Total reported', N(k.total))}
        ${kpiPub('Verified', N(k.verified), { cls: 'ok' })}
        ${kpiPub('Under review', N(k.underReview), { cls: 'warn' })}
        ${kpiPub('Resolved', N(k.resolved), { cls: 'ok' })}
        ${kpiPub('Open', N(k.open))}
      </div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">PUBLIC INCIDENT LIST</span><span class="sub">LGA-level resolution · factual summaries</span></div>
        <div class="pb flat" id="il" style="max-height:380px;overflow:auto"><span class="dim small">Loading…</span></div></div>
        <div class="panel"><div class="ph"><span class="t">CATEGORIES</span><span class="sub">neutral operational categories</span></div>
        <div class="pb" id="icats"></div></div>
      </div>`));
    get('/api/public/incidents').then(res => {
      $('#il', b).innerHTML = res.incidents.length ? res.incidents.map(c => `<div class="small mb12" style="border-bottom:1px solid #edf1f7;padding-bottom:8px"><b style="color:#0e1c31">${esc(c.category)}</b> — ${c.count} report(s) <span class="dim">· levels L1-L5</span></div>`).join('') : '<span class="dim small">No public incidents yet.</span>';
      $('#icats', b).innerHTML = res.byLga.slice(0, 12).map(l => `<div class="small flex mb12"><b style="width:120px;color:#233650">${esc(l.name)}</b><div class="pbar flex1"><div class="fill amber" style="width:${Math.min(100, l.count * 20)}%"></div></div><b style="color:#233650">${l.count}</b></div>`).join('') || '<span class="dim small">—</span>';
    }).catch(() => {});
  }
  function vIncmap(b) {
    b.appendChild(el(`<div class="stat-note mb12">Incident locations are shown at <b>ward/LGA level only</b> — never exact polling-unit coordinates — depending on sensitivity.</div>
    <div class="map-wrap" style="height:520px"><div id="imap" style="width:100%;height:100%"></div></div>`));
    if (!GEO) return;
    get('/api/public/incidents').then(res => {
      const m = createMap($('#imap', b), GEO, { public: true });
      const incMarkers = (res.byLga || []).filter(x => x.count > 0).map(x => {
        const l = GEO.lgas.find(g => g.name === x.name);
        return l ? { id: 'inc-' + l.id, lgaId: l.id, severity: x.open ? 4 : 3, subcategory: 'Public incident', code: 'INC' } : null;
      }).filter(Boolean);
      m.setData({ lgas: geoLgas(), incidents: incMarkers, sos: [] });
      m.setLgaMetric(l => l.reportingPct);
    }).catch(() => {});
  }

  // ---------------- STATISTICS (§24-26, §29) ----------------
  function vStats(b) {
    const k = KPIS.kpis;
    b.appendChild(el(`<h1>ELECTION STATISTICS</h1>
      <div class="stat-note mb12">These figures describe <b>monitoring coverage and data flow</b> — they are never political performance indicators and never official election results.</div>
      <div class="kpis">
        ${kpiPub('Monitoring coverage', k.coveragePct + '%', { sub: 'of configured PUs', cls: 'accent' })}
        ${kpiPub('IReV observation', k.irevCoveragePct + '%', { cls: 'accent' })}
        ${kpiPub('Reconciliation', k.reconciliationPct + '%', { cls: 'ok' })}
        ${kpiPub('Under review', N(k.underReview), { cls: k.underReview ? 'warn' : '' })}
      </div>
      <div class="grid2">
        <div class="panel"><div class="ph"><span class="t">MONITORING STATUS</span><span class="sub">donut</span></div><div class="pb chart-box" id="donut"></div></div>
        <div class="panel"><div class="ph"><span class="t">LGA COMPARISON</span><span class="sub">reporting coverage</span></div><div class="pb chart-box" id="lgbars"></div></div>
      </div>
      <div class="panel mt12"><div class="ph"><span class="t">STATISTICS BY SENATORIAL DISTRICT</span><span class="sub">monitoring figures — not political performance</span></div>
      <div class="pb flat" id="sdist"></div></div>
      <div class="panel mt12"><div class="ph"><span class="t">STATISTICS BY STATE</span><span class="sp"></span><a href="#statslga" class="small">By LGA →</a></div>
      <div class="pb flat" id="sstate"></div></div>`));
    const k2 = KPIS.kpis;
    $('#donut', b).innerHTML = donutChart({ segments: [
      { label: 'Reconciled', value: k2.matched, color: '#157a3a' },
      { label: 'Pending', value: k2.irevPending, color: '#b45309' },
      { label: 'Under review', value: k2.underReview, color: '#8a6200' },
      { label: 'Not yet observed', value: Math.max(0, k2.totalPu - k2.matched - k2.irevPending - k2.underReview), color: '#b9c8db' },
    ], w: 240, h: 200, centerLabel: 'monitored PUs', centerValue: k2.totalPu });
    get('/api/public/statistics').then(st => {
      const top = st.lgas.slice().sort((a, b) => b.reportingPct - a.reportingPct).slice(0, 10);
      $('#lgbars', b).innerHTML = barChart({ data: top.map(l => l.reportingPct), labels: top.map(l => l.name.length > 9 ? l.name.slice(0, 8) + '…' : l.name), h: 190, color: '#0b6aa8' });
      $('#sdist', b).innerHTML = `<table class="tbl"><tr><th>District</th><th class="num">PUs</th><th>Monitoring</th><th class="num">Results</th><th class="num">IReV</th></tr>
      ${st.senatorial.map(s => `<tr><td><b>${esc(s.name)}</b></td><td class="num">${s.totalPu}</td><td><div class="pbar" style="width:120px"><div class="fill" style="width:${s.reportedPct}%"></div></div> ${s.reportedPct}%</td><td class="num">${s.reported}</td><td class="num">${s.verified}</td></tr>`).join('')}</table>`;
      $('#sstate', b).innerHTML = `<table class="tbl"><tr><th>State</th><th class="num">Monitored PUs</th><th class="num">Reports</th><th class="num">Results</th><th class="num">IReV</th><th class="num">Reconciled</th></tr>
      <tr><td><b>Kano</b></td><td class="num">${N(k2.monitoredPus)}</td><td class="num">${N(k2.fieldReports)}</td><td class="num">${N(k2.resultDocs)}</td><td class="num">${N(k2.irevObserved)}</td><td class="num">${N(k2.matched)}</td></tr></table>`;
    }).catch(() => {});
  }
  function vStatsLga(b) {
    b.appendChild(el(`<div class="panel"><div class="ph"><span class="t">LGA STATISTICS</span><span class="sub">monitoring figures per LGA</span></div>
    <div class="pb flat" id="slga"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/statistics').then(st => {
      $('#slga', b).innerHTML = `<table class="tbl"><tr><th>LGA</th><th class="num">PUs</th><th class="num">Reported</th><th class="num">Verified</th><th>Reporting</th></tr>
      ${st.lgas.map(l => `<tr class="clickable" data-lg="${l.name}"><td><b>${esc(l.name)}</b></td><td class="num">${l.totalPu}</td><td class="num">${l.reported}</td><td class="num">${l.verified}</td><td><div class="pbar" style="width:100px"><div class="fill" style="width:${l.reportingPct}%"></div></div> ${l.reportingPct}%</td></tr>`).join('')}</table>`;
      $$('[data-lg]', b).forEach(x => x.onclick = () => lgaProfileByName(x.dataset.lg));
    }).catch(() => {});
  }

  // ---------------- REPORTS / TRANSPARENCY / MEDIA / ABOUT / SEARCH / API ----------------
  function vReports(b) {
    b.appendChild(el(`<h1>REPORTS & PUBLICATIONS</h1>
      <div class="stat-note mb12">Published reports carry a version and a frozen data snapshot — figures never drift after publication. <b>${DISCLAIMER}</b></div>
      <div class="panel"><div class="pb flat" id="rpl"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/reports').then(res => {
      $('#rpl', b).innerHTML = res.rows.length ? `<table class="tbl"><tr><th>Report</th><th>Type</th><th>Version</th><th>Published</th></tr>
      ${res.rows.map(r => `<tr><td><b>${esc(r.title)}</b><br><span class="mono small">${esc(r.code)}</span></td><td>${esc(r.type)}</td><td class="num">V${r.version}</td><td>${fmtWatShort(r.createdAt)}</td></tr>`).join('')}</table>` : '<div class="empty">No published reports yet — situation, monitoring and reconciliation reports appear here once approved through the publication workflow.</div>';
    }).catch(() => {});
  }
  function vTransparency(b) {
    b.appendChild(el(`<h1>TRANSPARENCY & EVIDENCE</h1>
      <div class="grid3">
        <div class="panel"><div class="ph"><span class="t">METHODOLOGY</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8"><a href="#methodology" class="small">How we monitor →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">DATA SOURCES</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8"><a href="#sources" class="small">Official vs independent →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">VERIFICATION</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8"><a href="#verification" class="small">How records are verified →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">CORRECTIONS</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8"><a href="#corrections" class="small">Correction notices →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">PRIVACY</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8"><a href="#privacy" class="small">Privacy policy →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">OPEN DATA API</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8"><a href="#api" class="small">API documentation →</a></div></div>
      </div>
      <div class="panel mt12"><div class="pb">
        <div class="b-t" style="color:#0b6aa8;font-size:11px;letter-spacing:1.2px;margin-bottom:8px">METHODOLOGY FLOW</div>
        <div class="pipeline" style="color:#4a5f7c">${['FIELD OBSERVATION', 'DIGITAL SUBMISSION', 'DOCUMENT PRESERVATION', 'IReV OBSERVATION', 'AUTOMATED COMPARISON', 'HUMAN REVIEW', 'VERIFICATION', 'PUBLICATION'].map(s => `<span class="step">${s}</span>`).join('<span class="arrow">↓</span>')}</div>
      </div></div>`));
    $$('a[href="#"]', b).forEach(a => a.onclick = (e) => e.preventDefault());
    $$('a', b).forEach(a => a.onclick = (e) => { const h = a.getAttribute('href'); if (h && h.startsWith('#')) { e.preventDefault(); setView(h.slice(1)); } });
  }
  function vMethodology(b) {
    b.appendChild(el(`<h1>HOW WE MONITOR</h1>
    <div class="panel mt12"><div class="pb" style="color:#3d5472;line-height:1.9;font-size:13.5px">
      <h2>FIELD COLLECTION</h2><p>Authorized monitoring agents at polling units capture result documents (EC8A) with their registered devices. Every capture records a timestamp, location and a cryptographic fingerprint.</p>
      <h2>RESULT DOCUMENTATION</h2><p>Original documents are preserved unmodified. Processed copies never replace originals, and every document carries a chain of custody.</p>
      <h2>IReV OBSERVATION</h2><p>We monitor information available through authorized/public election-result sources. Observations are snapshotted immutably — what the public record looked like when first observed is always preserved.</p>
      <h2>RECONCILIATION</h2><p>Field documents, our structured records and IReV observations are compared. A difference is reported as "a difference was detected" — it never automatically means wrongdoing and requires human verification.</p>
      <h2>HUMAN REVIEW</h2><p>Discrepancies enter a review workflow with documented reasons and two-person approval for critical cases.</p>
      <h2>PUBLICATION</h2><p>Only information that passes the publication workflow reaches this portal — always labelled as independent monitoring data, never as official election results.</p>
      <div class="stat-note mt12"><b>DATA STATUS LEGEND:</b> <b>VERIFIED</b> — reviewed according to published methodology · <b>OBSERVED</b> — recorded from an available source · <b>REPORTED</b> — submitted by monitoring personnel but not independently verified · <b>UNDER REVIEW</b> — requires additional verification · <b>PENDING</b> — insufficient data.</div>
    </div></div>`));
  }
  function vSources(b) {
    b.appendChild(el(`<h1>DATA SOURCES</h1>
    <div class="panel mt12"><div class="pb" style="color:#3d5472;line-height:1.9;font-size:13.5px">
      <h2>OFFICIAL vs INDEPENDENT</h2>
      <p><b>OFFICIAL ELECTION RESULTS</b> are those formally declared by the competent electoral authority. This portal never presents independent figures as official results.</p>
      <p><b>INDEPENDENT MONITORING INFORMATION</b> includes our field monitoring network, authorized data sources, public IReV observations and internal reconciliation data — each labelled with its source, status and last-updated time.</p>
      <div class="detail-grid mt12">
        <span class="k">Field monitoring network</span><span class="v">MONITORING DATA</span>
        <span class="k">Public IReV observations</span><span class="v">IReV OBSERVATION</span>
        <span class="k">Internal reconciliation</span><span class="v">VERIFIED MONITORING RECORDS</span>
        <span class="k">Update frequency</span><span class="v">continuous during election day</span>
      </div>
    </div></div>`));
  }
  function vVerification(b) {
    b.appendChild(el(`<h1>VERIFICATION PROCESS</h1>
    <div class="panel mt12"><div class="pb" style="color:#3d5472;line-height:1.9;font-size:13.5px">
      <p>Every record moves through explicit states: <b>RECEIVED → SUBMITTED → OBSERVED → UNDER REVIEW → VERIFIED → DISPUTED → RESOLVED → ARCHIVED</b>. States are never collapsed into a single "confirmed" status.</p>
      <p>Automated comparison includes document hashes, structured values and metadata — with confidence levels. OCR differences always link back to the original document, because OCR can be wrong. No automated signal becomes a public statement: <b>AUTOMATED SIGNAL → HUMAN REVIEW → EVIDENCE CONFIRMATION → AUTHORIZED DECISION → APPROVED REPORT.</b></p>
    </div></div>`));
  }
  function vCorrections(b) {
    b.appendChild(el(`<h1>DATA CORRECTIONS</h1>
      <p class="lead mt8">If a published monitoring statistic is corrected, a correction notice is published. Historical public statistics are never silently modified.</p>
      <div class="panel mt12"><div class="pb flat" id="corr"><span class="dim small">Loading…</span></div></div>`));
    get('/api/public/corrections').then(res => {
      $('#corr', b).innerHTML = res.rows.length ? res.rows.map(c => `
        <div class="panel mb12" style="margin:0"><div class="ph"><span class="t">CORRECTION NOTICE — ${esc(c.code)}</span><span class="right small dim">${fmtWatShort(c.date)}</span></div>
        <div class="pb small" style="color:#4a5f7c;line-height:1.8">
          <b>Original:</b> ${esc(c.original)}<br><b>Corrected:</b> ${esc(c.corrected)}<br><b>Reason:</b> ${esc(c.reason)}${c.affected ? `<br><b>Affected records:</b> ${esc(c.affected)}` : ''}<br><span class="dim">Published by ${esc(c.by)}</span>
        </div></div>`).join('') : '<div class="empty">No corrections published — this section exists so that any future correction is public and attributable.</div>';
    }).catch(() => {});
  }
  function vPrivacy(b) {
    b.appendChild(el(`<h1>PRIVACY POLICY</h1>
    <div class="panel mt12"><div class="pb" style="color:#3d5472;line-height:1.9;font-size:13.5px">
      <h2>What public data is collected</h2><p>Aggregated monitoring statistics and public-safe incident summaries. We do not collect voter political profiles, religious or ethnic profiles, or individual voter persuasion profiles.</p>
      <h2>How personal data is protected</h2><p>Agent identity, phone numbers, GPS, private communications, internal incident notes and private media are never published. Least-privilege access applies internally, and internal data is firewalled from public statistics.</p>
      <h2>How agent information is protected</h2><p>Agent records, locations and communications are visible only to authorized operational personnel according to role.</p>
      <h2>Retention & disclosure</h2><p>Election evidence is archived rather than deleted. Public disclosure happens only through the authorized publication workflow.</p>
      <h2>Security</h2><p>Rate limiting, secure transport, monitoring and automated backups protect the platform.</p>
    </div></div>`));
  }
  function vMedia(b) {
    b.appendChild(el(`<h1>MEDIA & PRESS</h1>
      <div class="grid3">
        <div class="panel"><div class="ph"><span class="t">PRESS CENTRE</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8">Press releases, approved statistics and public reports appear here. <a href="#reports" class="small">Reports →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">MEDIA DATA DESK</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8">Approved public data access for journalists: CSV/JSON downloads, charts, methodology. <a href="#desk" class="small">Open the desk →</a></div></div>
        <div class="panel"><div class="ph"><span class="t">DOWNLOADS</span></div><div class="pb small" style="color:#4a5f7c;line-height:1.8">Approved charts, reports and brand assets. <a href="#downloads" class="small">Downloads →</a></div></div>
      </div>
      <div class="pub-note mt12" style="background:#eef3f9;border-color:#d7e0ec;color:#4a5f7c">All data should be independently attributed and timestamped when reproduced. Media contact is configured by administrators — no invented contact details.</div>`));
  }
  function vDesk(b) {
    const ITEMS = [['kpis', 'Public KPIs'], ['lgas', 'LGA statistics'], ['wards', 'Ward statistics'], ['incidents', 'Incident records'], ['activity', 'Public activity feed']];
    b.appendChild(el(`<h1>MEDIA DATA DESK</h1>
      <p class="lead mt8">Approved aggregate data for journalists and researchers. Attribute and timestamp when reproduced.</p>
      <div class="grid3 mt12">${ITEMS.map(([t, l]) => `
        <div class="panel"><div class="ph"><span class="t">${esc(l)}</span></div>
        <div class="pb"><div class="row">${['json', 'csv'].map(f => `<button class="btn sm" data-exp="${t}:${f}">${f.toUpperCase()}</button>`).join('')}</div>
        <div class="small muted mt8">${DISCLAIMER}</div></div></div>`).join('')}</div>
      <div class="panel mt12"><div class="ph"><span class="t">QUERY PUBLIC STATISTICS</span></div>
      <div class="pb small" style="color:#4a5f7c">The open data API provides the same data programmatically — see <a href="#api">API documentation</a>.</div></div>`));
    $$('[data-exp]', b).forEach(x => x.onclick = () => {
      const [t, f] = x.dataset.exp.split(':');
      window.open(`/api/public/export?type=${t}&format=${f}`, '_blank');
    });
  }
  function vDownloads(b) {
    b.appendChild(el(`<h1>DOWNLOADS</h1>
      <div class="panel mt12"><div class="pb flat"><table class="tbl"><tr><th>Asset</th><th>Format</th><th></th></tr>
      <tr><td>Public KPIs snapshot</td><td>JSON / CSV</td><td><a href="/api/public/export?type=kpis&format=json" target="_blank">Download →</a></td></tr>
      <tr><td>LGA statistics</td><td>JSON / CSV</td><td><a href="/api/public/export?type=lgas&format=csv" target="_blank">Download →</a></td></tr>
      <tr><td>Incident records</td><td>JSON / CSV</td><td><a href="/api/public/export?type=incidents&format=csv" target="_blank">Download →</a></td></tr>
      <tr><td>Public activity feed</td><td>JSON / CSV</td><td><a href="/api/public/export?type=activity&format=json" target="_blank">Download →</a></td></tr>
      </table>
      <div class="small muted mt8">Brand assets and press materials are available on request from the media contact. ${DISCLAIMER}</div></div></div>`));
  }
  function vAbout(b) {
    b.appendChild(el(`<h1>ABOUT THE PROJECT</h1>
    <div class="panel mt12"><div class="pb" style="color:#3d5472;line-height:1.9;font-size:13.5px">
      <p><b>EYES OF VICTORY — ELECTION OBSERVATORY</b> is the public-facing domain of an independent election-monitoring information platform. It is a national public election observatory, not a party campaign website.</p>
      <p>The public information loop is: <b>MONITOR → COLLECT → OBSERVE → RECONCILE → VERIFY → EXPLAIN → PUBLISH → ARCHIVE.</b></p>
      <p>Our promise: <b>SEE THE DATA. UNDERSTAND THE EVIDENCE. FOLLOW THE PROCESS.</b></p>
      <div class="stat-note mt12">${DISCLAIMER}</div>
    </div></div>`));
  }
  function vSearch(b) {
    b.appendChild(el(`<h1>SEARCH</h1>
      <p class="lead mt8">Search states, LGAs, wards, polling units, public result and incident records. Only information approved for public release is shown.</p>
      <div class="mt12"><input class="inp" id="sq" style="font-size:15px;padding:11px" placeholder="e.g. Tarauni, Kano Municipal, Ward 05, PU-005-002-01, INC-2027…"></div>
      <div id="sres" class="mt12"></div>`));
    $('#sq', b).addEventListener('input', debounce(async () => {
      const q = $('#sq', b).value.trim();
      if (q.length < 2) { $('#sres', b).innerHTML = ''; return; }
      const res = await get('/api/public/search?q=' + encodeURIComponent(q));
      $('#sres', b).innerHTML = res.results.length ? res.results.map(r => `
        <div class="panel mb12" style="margin:0;cursor:pointer" data-t="${r.type}" data-id="${esc(r.id)}">
          <div class="ph"><span class="t">${esc(r.label)}</span><span class="sp"></span><span class="pill">${esc(r.type)}</span></div>
          <div class="pb small" style="color:#5b718d">${esc(r.sub || '')}${r.stats ? `<br>Monitoring records: ${r.stats.records} · IReV: ${r.stats.irev} · Incidents: ${r.stats.incidents}` : ''}</div>
        </div>`).join('') : '<div class="empty">No public matches.</div>';
      $$('[data-t]', b).forEach(x => x.onclick = () => {
        if (x.dataset.t === 'LGA') lgaProfile(x.dataset.id);
        else if (x.dataset.t === 'PU') puProfile(x.dataset.id);
        else if (x.dataset.t === 'WARD') { const w2 = { id: x.dataset.id, name: x.dataset.label, lga: x.dataset.sub }; wardProfile(w2); }
      });
    }, 300));
  }
  function vApi(b) {
    b.appendChild(el(`<h1>PUBLIC DATA API</h1>
      <div class="stat-note mb12">Open-data endpoints for approved aggregate/public information. <b>Never exposed:</b> agent credentials, private GPS, private communications, internal security logs, sensitive evidence, personally identifiable information.</div>
      <div class="panel"><div class="pb flat" id="apibody"><span class="dim small">Loading documentation…</span></div></div>`));
    get('/api/public/api-docs').then(d => {
      $('#apibody', b).innerHTML = `<table class="tbl"><tr><th>Endpoint</th><th>Description</th></tr>
      ${d.endpoints.map(e => `<tr><td class="mono">${esc(e.path)}</td><td class="small" style="color:#4a5f7c">${esc(e.description)}</td></tr>`).join('')}</table>
      <div class="small muted mt8">Rate limit: ${esc(d.rateLimit)} · ${esc(d.terms)}<br>Data status values: ${esc(d.dataStatus)}</div>`;
    }).catch(() => {});
  }

  const V = {
    home: vHome, live: vLive, map: vMap, activity: vActivity, results: vResults, irev: vIrev,
    kano: vKano, kanolga: vKanoLga, kanowards: vKanoWards, incidents: vIncidents, incmap: vIncmap,
    stats: vStats, statslga: vStatsLga, reports: vReports, transparency: vTransparency,
    methodology: vMethodology, sources: vSources, verification: vVerification, corrections: vCorrections,
    privacy: vPrivacy, media: vMedia, desk: vDesk, downloads: vDownloads, about: vAbout, search: vSearch, api: vApi,
  };
  window.addEventListener('resize', drawNav);
  const h = location.hash.slice(1);
  if (h && V[h]) view = h;
  render();
  setInterval(async () => {
    try { const k = await get('/api/public/kpis'); KPIS = k; } catch (e) {}
    if (['home', 'live'].includes(view) && !document.hidden) render();
  }, 30000);
})();
