// ui.js — shared UI components: shell, KPIs, tables, charts, EC8A renderer, sim streams
'use strict';

// ---------------- shell ----------------
const EV_LOGO_FALLBACK = `<svg width="30" height="30" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" fill="#0e2a45" stroke="#1d6fa8" stroke-width="1.6"/><path d="M24 24 L24 4 A20 20 0 0 1 44 24 Z" fill="#16a34a" opacity="0.5"/><circle cx="24" cy="24" r="9" fill="none" stroke="#7dd3fc" stroke-width="1.6"/><circle cx="24" cy="24" r="3.4" fill="#0a1a2e" stroke="#7dd3fc" stroke-width="1.2"/><circle cx="25.6" cy="22.4" r="1.1" fill="#ef4444"/><line x1="24" y1="24" x2="24" y2="4" stroke="#7dd3fc" stroke-width="1.4"/></svg>`;
const EV_LOGO = `<img class="logo" src="/assets/media/logo.png" alt="EYES OF VICTORY" style="height:30px;width:auto;object-fit:contain;display:block" onerror="this.style.display='none';this.insertAdjacentHTML('afterend','${EV_LOGO_FALLBACK.replace(/'/g, "\\'")}')">`;
function initShell({ title, nav, active, me, sim, onNav, portalTag }) {
  window.__portalBooted = true;
  const perms = API.perms;
  const app = el(`<div class="app">
    <div class="topbar">
      <div class="brand">
        ${EV_LOGO}
        <div class="bt"><b>EYES OF VICTORY</b><span>2027 · KANO · ${esc(portalTag || 'COMMAND')}</span></div>
      </div>
      <div class="searchbox" style="display:${API.can('search.global') ? 'block' : 'none'}">
        <span class="ic">⌕</span><input id="gsq" placeholder="Search agent, PU, ward, LGA, incident…" autocomplete="off">
        <div class="search-results" id="gsr" style="display:none"></div>
      </div>
      <span class="spacer"></span>
      <div class="sim-ctl" id="simctl" style="display:${API.can('simulation.control') || ['superadmin'].includes(me.roleId) ? 'flex' : 'none'}">
        <select id="scensel" title="Demo scenario preset">
          <option value="MORNING">Opening Phase</option><option value="VOTING">Voting Phase</option>
          <option value="RESULTS">Collation Phase</option><option value="EVENING">Evening Phase</option><option value="NIGHT">Post-Election</option>
        </select>
        <button class="btn sm" id="pausebtn" title="Pause/resume simulation">⏸</button>
      </div>
      <div class="clock" id="clockbox"><span id="watclock">--:--:--</span><small id="watdate">—</small></div>
      <div class="health-pill" id="healthpill" title="System health" style="display:${API.can('system.health') ? 'flex' : 'none'}"><span class="d"></span><span id="healthtxt">HEALTHY</span></div>
      <div class="dropdown">
        <span class="bell" id="bellbtn">🔔<span class="bub" id="bellbub" style="display:none">0</span></span>
        <div class="menu" id="bellmenu" style="display:none"></div>
      </div>
      <div class="dropdown">
        <span class="btn sm" id="userbtn">◉ ${esc(me.name.split(' ')[0])}</span>
        <div class="menu" id="usermenu" style="display:none"></div>
      </div>
    </div>
    <div class="sidebar" id="sidebar"></div>
    <div class="main" id="main"></div>
    <div class="watermark">DEMO MODE · SIMULATED DATA</div>
  </div>`);
  document.body.innerHTML = '';
  document.body.appendChild(app);

  // nav
  const sb = $('#sidebar', app);
  const groups = {};
  for (const n of nav) (groups[n.section || ''] = groups[n.section || ''] || []).push(n);
  for (const [sec, items] of Object.entries(groups)) {
    if (sec) sb.appendChild(el(`<div class="sec">${esc(sec)}</div>`));
    for (const n of items) {
      if (n.perm && !API.can(n.perm)) continue;
      const it = el(`<div class="nav-item" data-nav="${esc(n.id)}"><span class="ico">${n.ico || '•'}</span>${esc(n.label)}</div>`);
      if (n.badgeEl) it.appendChild(n.badgeEl);
      it.onclick = () => { setNav(n.id); onNav && onNav(n.id); };
      sb.appendChild(it);
    }
  }
  sb.appendChild(el(`<div class="sec">Account</div>`));
  const lo = el(`<div class="nav-item"><span class="ico">⏻</span>Sign out</div>`);
  lo.onclick = async () => { try { await API.post('/api/auth/logout', {}); } catch (e) {} API.clear(); sseOff(); location.href = '/'; };
  sb.appendChild(lo);
  function setNav(id) {
    $$('.nav-item[data-nav]', sb).forEach(x => x.classList.toggle('active', x.dataset.nav === id));
  }
  setNav(active || (nav[0] && nav[0].id));

  // clock (WAT)
  let simNow = (sim && sim.now) || Date.now();
  const tickClock = () => {
    simNow += 1000;
    $('#watclock', app).textContent = watClock(simNow);
    $('#watdate', app).textContent = watDateOnly(simNow) + ' · SIM ACCELERATED';
  };
  tickClock(); setInterval(tickClock, 1000);

  // bell
  const bell = $('#bellbtn', app);
  bell.onclick = async () => {
    const menu = $('#bellmenu', app);
    if (menu.style.display === 'none') {
      const res = await API.get('/api/notifications');
      menu.innerHTML = res.rows.length ? res.rows.slice(0, 25).map(n => `
        <div class="mi" data-nid="${n.id}"><b>${['CRITICAL'].includes(n.priority) ? '🚨 ' : ''}${esc(n.title)}</b>
        <small>${esc(n.body)} · ${fmtWatShort(n.createdAt)}</small></div>`).join('') : '<div class="mi small dim">No notifications</div>';
      $$('[data-nid]', menu).forEach(x => x.onclick = () => { API.post('/api/notifications/read', { id: x.dataset.nid }); if (n && n.link) location.href = n.link; });
      menu.style.display = 'block';
    } else menu.style.display = 'none';
  };
  document.addEventListener('click', (e) => { if (!e.target.closest('.dropdown')) $$('.dropdown .menu', app).forEach(m => m.style.display = 'none'); });
  setInterval(async () => {
    try {
      const res = await API.get('/api/notifications');
      const un = res.rows.filter(n => !n.read).length;
      const b = $('#bellbub', app);
      b.style.display = un ? 'block' : 'none'; b.textContent = un;
      if (un) $('#bellbtn', app).title = `${un} unread notification(s)`;
    } catch (e) {}
  }, 30000);

  // user menu
  $('#userbtn', app).onclick = () => {
    const menu = $('#usermenu', app);
    const portals = portalLinks(me);
    menu.innerHTML = `
      <div class="mi"><b>${esc(me.name)}</b><small>${esc(me.roleName)}${me.scope && me.scope.lga ? ' · ' + esc(me.scope.lga) + ' LGA' : ''}${me.scope && me.scope.senatorial ? ' · ' + esc(me.scope.senatorial) : ''}</small></div>
      ${portals.map(p => `<div class="mi" data-href="${p.href}">↗ ${esc(p.label)}</div>`).join('')}
      <div class="mi" data-signout>⏻ Sign out</div>`;
    $$('[data-href]', menu).forEach(x => x.onclick = () => location.href = x.dataset.href);
    $('[data-signout]', menu).onclick = async () => { try { await API.post('/api/auth/logout', {}); } catch (e) {} API.clear(); sseOff(); location.href = '/'; };
    menu.style.display = 'block';
  };

  // global search
  const gsq = $('#gsq', app);
  if (gsq) {
    const run = debounce(async () => {
      const q = gsq.value.trim();
      const box = $('#gsr', app);
      if (q.length < 2) { box.style.display = 'none'; return; }
      const res = await API.get('/api/search?q=' + encodeURIComponent(q));
      box.innerHTML = res.results.length ? res.results.map(r => `
        <div class="sr" data-type="${r.type}" data-id="${esc(r.id)}"><b>${esc(r.label)}</b><span>${esc(r.type)} · ${esc(r.sub || '')}</span></div>`).join('')
        : '<div class="sr small dim">No matches</div>';
      box.style.display = 'block';
      $$('.sr', box).forEach(x => x.onclick = () => {
        const t = x.dataset.type;
        if (t === 'INCIDENT') location.href = '/central?tab=incidents&focus=' + x.dataset.id;
        else if (t === 'SUBMISSION') location.href = '/supervisor?sub=' + x.dataset.id;
        else if (t === 'AGENT') location.href = '/central?tab=agents&focus=' + x.dataset.id;
        else if (t === 'IREV_OBSERVATION') location.href = '/central?tab=irevarchive';
        else if (t === 'IREV_CASE') location.href = '/central?tab=irevchanges';
        else if (t === 'PU') location.href = '/central?tab=map&focus=PU:' + x.dataset.id;
        else location.href = '/central?tab=map&focus=' + x.dataset.id;
      });
    }, 260);
    gsq.addEventListener('input', run);
    document.addEventListener('click', (e) => { if (!e.target.closest('.searchbox')) $('#gsr', app).style.display = 'none'; });
  }

  // health
  async function refreshHealth() {
    try {
      const h = await API.get('/api/system/health');
      const pill = $('#healthpill', app);
      const status = h.api === 'HEALTHY' && h.db === 'HEALTHY' ? 'HEALTHY' : (h.api === 'CRITICAL' ? 'CRITICAL' : 'DEGRADED');
      pill.classList.toggle('degraded', status === 'DEGRADED');
      pill.classList.toggle('critical', status === 'CRITICAL');
      $('#healthtxt', app).textContent = status;
      pill.title = `API ${h.api} · DB ${h.db} · CPU ${Math.round(h.cpu)}% · MEM ${Math.round(h.memory)}% · ${Math.round(h.responseMs)}ms`;
    } catch (e) {}
  }
  refreshHealth(); setInterval(refreshHealth, 20000);

  // sim controls
  const scsel = $('#scensel', app);
  if (scsel) {
    scsel.value = (sim && sim.scenario) || 'RESULTS';
    scsel.onchange = async () => { await API.post('/api/admin/simulation', { action: 'scenario', value: scsel.value }); location.reload(); };
    $('#pausebtn', app).onclick = async () => {
      const res = await API.post('/api/admin/simulation', { action: 'pause', value: !sim.paused });
      $('#pausebtn', app).textContent = res.paused ? '▶' : '⏸';
    };
  }

  // demo banner
  const banner = el(`<div class="demo-banner">⚠ DEMO MODE — simulated election-day data for demonstration & training. Not official INEC results. <a href="/public">View public transparency portal →</a></div>`);
  app.insertBefore(banner, $('#sidebar', app));

  // SSE-driven live refresh hook
  let liveRefresh = null;
  sseOn((msg) => {
    if (msg.kind === 'tick' && msg.simNow) { simNow = msg.simNow; $('#watclock', app).textContent = watClock(msg.simNow); }
    if (msg.kind === 'sim.reset') location.reload();
    if (msg.kind === 'event' && liveRefresh) {
      if (['result.submitted', 'result.verified', 'result.rejected', 'incident.created', 'incident.updated', 'sos.triggered', 'sos.updated', 'stream.started', 'stream.ended', 'agent.online', 'agent.offline'].includes(msg.type)) {
        if (msg.type === 'sos.triggered') toast('🚨 EMERGENCY SOS', 'New SOS signal from the field', 'critical');
        else if (msg.type === 'incident.created' && msg.severity >= 4) toast('⚠ Critical incident', `Level ${msg.severity} incident reported`, 'critical');
        liveRefresh(msg);
      }
    }
  });

  return {
    main: $('#main', app), setNav,
    onLive: (fn) => { liveRefresh = fn; },
    refreshKpis: async () => {},
  };
}

function portalLinks(me) {
  const all = [
    { href: '/agent', label: 'Field Agent App', roles: ['agent', 'superadmin'] },
    { href: '/lg', label: 'LG Supervisor Portal', roles: ['lgcoord', 'lgsupervisor', 'lganalyst', 'lgtech', 'wardcoord', 'superadmin', 'director', 'operator'] },
    { href: '/senatorial', label: 'Senatorial Command', roles: ['sencoord', 'sendirector', 'senops', 'senanalyst', 'senincident', 'senverify', 'senviewer', 'superadmin', 'director', 'operator'] },
    { href: '/central', label: 'Central Situation Room', roles: ['superadmin', 'director', 'chiefanalyst', 'resultmanager', 'irevanalyst', 'incidentcommander', 'comms', 'analyst', 'operator', 'incident', 'support', 'auditor', 'observer'] },
    { href: '/mobile', label: 'Mobile Command', roles: ['superadmin', 'director', 'chiefanalyst', 'resultmanager', 'irevanalyst', 'incidentcommander', 'comms', 'analyst', 'operator'] },
    { href: '/supervisor', label: 'Verification Portal', roles: ['supervisor', 'reviewer', 'superadmin', 'director', 'resultmanager'] },
    { href: '/sentinel', label: 'SENTINEL SOC', roles: ['secdirector', 'socanalyst', 'infraengineer', 'apisecurity', 'secinccmd', 'superadmin', 'auditor'] },
    { href: '/admin', label: 'Administration', roles: ['superadmin'] },
    { href: '/public', label: 'Public Portal', roles: [] },
  ];
  return all.filter(p => p.roles.length === 0 || p.roles.includes(me.roleId)).filter(p => p.href !== location.pathname);
}

// ---------------- KPI cards ----------------
function kpiCard(label, value, { sub, cls, spark } = {}) {
  return `<div class="kpi ${cls || ''}">
    <div class="l">${esc(label)}</div>
    <div class="v">${value}</div>
    ${sub ? `<div class="d">${sub}</div>` : ''}
    ${spark ? `<div class="spark">${spark}</div>` : ''}
  </div>`;
}

// ---------------- tables ----------------
function dataTable({ cols, rows, onRow, sortable = true, pageSize = 0, emptyText }) {
  const wrap = el('<div class="panel"><div class="ph"><span class="t"></span><span class="sp"></span></div><div class="pb flat"></div></div>');
  const titleEl = $('.ph .t', wrap);
  const bodyEl = $('.pb', wrap);
  let _cols = cols, _rows = rows, sortKey = null, sortDir = 1, page = 0;
  function render() {
    let list = [..._rows];
    if (sortKey) list.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      return (typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))) * sortDir;
    });
    const total = list.length;
    if (pageSize) { list = list.slice(page * pageSize, (page + 1) * pageSize); }
    const head = `<table class="tbl"><thead><tr>${_cols.map((c, i) => `<th data-i="${i}" ${sortable ? 'style="cursor:pointer"' : ''}>${esc(c.label)}${sortKey === c.key ? (sortDir === 1 ? ' ↑' : ' ↓') : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.length ? list.map((r, ri) => `<tr ${onRow ? `class="clickable" data-i="${ri}"` : ''}>${_cols.map(c => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${_cols.length}" class="empty">${esc(emptyText || 'No records')}</td></tr>`}</tbody></table>`;
    bodyEl.innerHTML = head;
    if (sortable) $$('th', bodyEl).forEach(th => th.onclick = () => {
      const k = _cols[+th.dataset.i].key;
      if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = 1; }
      render();
    });
    if (onRow) $$('tbody tr.clickable', bodyEl).forEach(tr => tr.onclick = () => onRow(list[+tr.dataset.i]));
    if (pageSize && total > pageSize) {
      bodyEl.appendChild(el(`<div class="pagination"><span>${total} records</span><span class="flex1"></span>
        <button class="btn sm" data-pg="-1">← Prev</button><span>Page ${page + 1} / ${Math.ceil(total / pageSize)}</span><button class="btn sm" data-pg="1">Next →</button></div>`));
      $$('[data-pg]', bodyEl).forEach(b => b.onclick = () => { page = Math.max(0, Math.min(Math.ceil(total / pageSize) - 1, page + (+b.dataset.pg))); render(); });
    }
  }
  render();
  return { el: wrap, setRows: (r) => { _rows = r; page = 0; render(); }, setTitle: (t) => { titleEl.textContent = t; } };
}

// ---------------- SVG charts ----------------
function svgChart(w, h, inner) {
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}
function lineChart({ series, labels, w = 460, h = 180, color = '#38bdf8', fill = true, yFmt = fmtN, area }) {
  const pad = { l: 44, r: 10, t: 12, b: 22 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...series.map(s => Math.max(...s.data)));
  const x = (i) => pad.l + (series[0].data.length <= 1 ? 0 : (i / (series[0].data.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  let out = '';
  // gridlines
  for (let g = 0; g <= 4; g++) {
    const gy = pad.t + (ih / 4) * g;
    out += `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="#16233a" stroke-width="1"/><text x="${pad.l - 6}" y="${gy + 3}" fill="#566781" font-size="8.5" text-anchor="end">${yFmt(max - (max / 4) * g)}</text>`;
  }
  for (const s of series) {
    const c = s.color || color;
    const pts = s.data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (fill || s.fill) out += `<polygon points="${pad.l},${pad.t + ih} ${pts} ${w - pad.r},${pad.t + ih}" fill="${c}" opacity="0.12"/>`;
    out += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`;
    if (s.data.length <= 40) for (let i = 0; i < s.data.length; i++) out += `<circle cx="${x(i).toFixed(1)}" cy="${y(s.data[i]).toFixed(1)}" r="1.6" fill="${c}"><title>${esc(labels ? labels[i] : '')}: ${fmtN(s.data[i])}</title></circle>`;
  }
  // x labels (sparse)
  if (labels) {
    const step = Math.max(1, Math.ceil(labels.length / 7));
    for (let i = 0; i < labels.length; i += step) {
      out += `<text x="${x(i).toFixed(1)}" y="${h - 7}" fill="#566781" font-size="8.5" text-anchor="middle">${esc(labels[i])}</text>`;
    }
  }
  return svgChart(w, h, out);
}
function barChart({ data, labels, w = 460, h = 160, color = '#38bdf8', yFmt = fmtN, colorFn }) {
  const pad = { l: 40, r: 8, t: 10, b: 20 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...data);
  const bw = Math.min(34, (iw / Math.max(1, data.length)) * 0.62);
  let out = '';
  for (let g = 0; g <= 4; g++) {
    const gy = pad.t + (ih / 4) * g;
    out += `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="#16233a"/><text x="${pad.l - 6}" y="${gy + 3}" fill="#566781" font-size="8.5" text-anchor="end">${yFmt(max - (max / 4) * g)}</text>`;
  }
  const stepX = iw / Math.max(1, data.length);
  data.forEach((v, i) => {
    const cx = pad.l + stepX * i + stepX / 2;
    const c = colorFn ? colorFn(v, i) : color;
    const bh = (v / max) * ih;
    out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(pad.t + ih - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, bh).toFixed(1)}" rx="1.5" fill="${c}"><title>${esc(labels ? labels[i] : '')}: ${fmtN(v)}</title></rect>`;
    if (labels && data.length <= 18) out += `<text x="${cx.toFixed(1)}" y="${h - 6}" fill="#566781" font-size="7.8" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return svgChart(w, h, out);
}
function donutChart({ segments, w = 150, h = 150, centerLabel, centerValue }) {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 8, ri = r * 0.64;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  let ang = -Math.PI / 2, out = '';
  for (const s of segments) {
    const a2 = ang + (s.value / total) * Math.PI * 2;
    const large = a2 - ang > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    out += `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${s.color}"><title>${esc(s.label)}: ${fmtN(s.value)} (${Math.round(s.value / total * 100)}%)</title></path>`;
    ang = a2;
  }
  out += `<circle cx="${cx}" cy="${cy}" r="${ri}" fill="#0a101d"/>`;
  if (centerLabel) out += `<text x="${cx}" y="${cy - 4}" fill="#8ba0bd" font-size="9" text-anchor="middle">${esc(centerLabel)}</text>`;
  if (centerValue != null) out += `<text x="${cx}" y="${cy + 13}" fill="#fff" font-size="17" font-weight="700" text-anchor="middle" font-family="var(--mono)">${esc(centerValue)}</text>`;
  return svgChart(w, h, out);
}
function sparkline(data, w = 90, h = 24, color = '#38bdf8') {
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4"/></svg>`;
}
function stackedBar({ groups, labels, w = 460, h = 170, colors }) {
  const pad = { l: 40, r: 8, t: 10, b: 20 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const max = Math.max(1, ...groups.map(g => g.reduce((a, b) => a + b, 0)));
  let out = '';
  for (let g = 0; g <= 4; g++) {
    const gy = pad.t + (ih / 4) * g;
    out += `<line x1="${pad.l}" y1="${gy}" x2="${w - pad.r}" y2="${gy}" stroke="#16233a"/><text x="${pad.l - 6}" y="${gy + 3}" fill="#566781" font-size="8.5" text-anchor="end">${fmtN(max - (max / 4) * g)}</text>`;
  }
  const bw = Math.min(30, (iw / Math.max(1, groups.length)) * 0.6);
  const stepX = iw / Math.max(1, groups.length);
  groups.forEach((g, gi) => {
    let acc = 0;
    const cx = pad.l + stepX * gi + stepX / 2;
    g.forEach((v, si) => {
      const bh = (v / max) * ih;
      out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(pad.t + ih - acc - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0.5, bh).toFixed(1)}" fill="${colors[si]}" opacity="0.9"><title>${esc(labels ? labels[gi] : '')} · ${fmtN(v)}</title></rect>`;
      acc += bh;
    });
    if (labels && groups.length <= 14) out += `<text x="${cx.toFixed(1)}" y="${h - 6}" fill="#566781" font-size="7.8" text-anchor="middle">${esc(labels[gi])}</text>`;
  });
  return svgChart(w, h, out);
}

// ---------------- simulated EC8A document ----------------
function drawEc8a(canvas, data) {
  // data: { pu, ward, lga, election, candidates:[{name,party,votes}], valid, rejected, accredited, registered, page, simTag }
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const paper = '#f7f4ea';
  c.fillStyle = paper; c.fillRect(0, 0, W, H);
  // slight paper texture + edge wear
  for (let i = 0; i < 260; i++) {
    c.fillStyle = `rgba(140,120,80,${0.02 + Math.random() * 0.05})`;
    c.fillRect(Math.random() * W, Math.random() * H, 1.4, 1.4);
  }
  c.strokeStyle = '#c9c0a8'; c.lineWidth = 2;
  c.strokeRect(6, 6, W - 12, H - 12);
  c.strokeStyle = '#8a8371'; c.lineWidth = 1;
  c.strokeRect(12, 12, W - 24, H - 24);
  const ink = '#1a2a1a';
  c.fillStyle = ink; c.textAlign = 'center';
  c.font = 'bold 17px Georgia, serif';
  c.fillText('INDEPENDENT NATIONAL ELECTORAL COMMISSION', W / 2, 42);
  c.font = 'bold 13px Georgia, serif';
  c.fillText('FORM EC8A — POLLING UNIT RESULT SHEET', W / 2, 60);
  c.font = '10px Arial';
  c.fillStyle = '#4a4a3a';
  c.fillText('(SIMULATED DOCUMENT — DEMONSTRATION ONLY · NOT AN OFFICIAL INEC DOCUMENT)', W / 2, 74);
  c.strokeStyle = '#4a4a3a'; c.lineWidth = 1;
  c.beginPath(); c.moveTo(40, 82); c.lineTo(W - 40, 82); c.stroke();
  c.textAlign = 'left';
  const kv = (label, val, y) => {
    c.font = 'bold 10px Arial'; c.fillStyle = '#333';
    c.fillText(label, 52, y);
    c.font = '11px Arial'; c.fillStyle = ink;
    c.fillText(val, 190, y);
  };
  let y = 102;
  c.font = 'bold 12px Arial';
  c.fillText('STATE: KANO', 52, y); c.fillText('LGA: ' + (data.lga || '').toUpperCase(), 260, y);
  y += 18;
  c.fillText('WARD: ' + (data.ward || '').toUpperCase(), 52, y); c.fillText('PU: ' + (data.pu || ''), 260, y);
  y += 18;
  c.fillText('ELECTION: ' + (data.election || '').toUpperCase(), 52, y);
  y += 26;
  // table
  const tx = 46, ty = y, tw = W - 92, rh = 22;
  c.strokeStyle = '#5a5a4a'; c.lineWidth = 1.4;
  c.strokeRect(tx, ty, tw, rh * (data.candidates.length + 2));
  c.beginPath(); c.moveTo(tx, ty + rh); c.lineTo(tx + tw, ty + rh); c.stroke();
  c.beginPath(); c.moveTo(tx + tw - 90, ty); c.lineTo(tx + tw - 90, ty + rh * (data.candidates.length + 2)); c.stroke();
  c.font = 'bold 10px Arial'; c.textAlign = 'left';
  c.fillText('CANDIDATE / PARTY', tx + 8, ty + 15);
  c.textAlign = 'right'; c.fillText('VOTES', tx + tw - 12, ty + 15);
  c.textAlign = 'left'; c.font = '10.5px Arial';
  data.candidates.forEach((cd, i) => {
    const ry = ty + rh * (i + 1);
    c.fillText(`${cd.name}  (${cd.party})`, tx + 8, ry + 15);
    c.textAlign = 'right';
    c.fillText(String(cd.votes), tx + tw - 12, ry + 15);
    c.textAlign = 'left';
  });
  const ry = ty + rh * (data.candidates.length + 1);
  c.font = 'bold 10px Arial';
  c.fillText('TOTAL VALID VOTES', tx + 8, ry + 15);
  c.textAlign = 'right'; c.fillText(String(data.valid), tx + tw - 12, ry + 15); c.textAlign = 'left';
  y = ty + rh * (data.candidates.length + 2) + 16;
  c.font = '10.5px Arial';
  c.fillText(`Rejected ballots: ${data.rejected ?? ''}`, 52, y);
  c.fillText(`Accredited voters: ${data.accredited ?? ''}`, 260, y);
  y += 16;
  c.fillText(`Registered voters: ${data.registered ?? ''}`, 52, y);
  y += 22;
  c.font = 'bold 10px Arial';
  c.fillText('PRESIDING OFFICER SIGNATURE: _______________________', 52, y);
  c.fillText('PARTY AGENT SIGNATURE: _______________________', 260, y);
  y += 22;
  c.font = '9px Arial'; c.fillStyle = '#6a6a55';
  c.fillText('Date: 27/02/2027   Time: ____ : ____ WAT', 52, y);
  if (data.page === 2) {
    c.fillStyle = 'rgba(0,0,0,0.7)'; c.font = 'bold 15px Arial'; c.textAlign = 'center';
    c.fillText('PAGE 2 — WARD COLLATION ANNEX (DEMO)', W / 2, H - 26);
  }
  c.fillStyle = '#8a8a72'; c.font = '8px Arial'; c.textAlign = 'right';
  c.fillText('NDC-DEMO ' + (data.docId || ''), W - 22, H - 10);
  return canvas;
}

// ---------------- simulated live stream ----------------
function startSimStream(canvas, meta) {
  // procedural "live feed" with HUD — placeholder for real WebRTC/HLS pipeline
  const c = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let raf = null, t0 = Date.now();
  const noise = [];
  for (let i = 0; i < 90; i++) noise.push({ x: Math.random() * W, y: Math.random() * H, s: 2 + Math.random() * 5, v: 0.2 + Math.random() * 1.1 });
  const people = [];
  for (let i = 0; i < 6; i++) people.push({ x: Math.random() * W, y: H * 0.5 + Math.random() * H * 0.45, w: 8 + Math.random() * 7, v: (Math.random() - 0.5) * 0.5, hue: 190 + Math.random() * 40 });
  function frame() {
    const t = (Date.now() - t0) / 1000;
    // scene
    c.fillStyle = '#10141c'; c.fillRect(0, 0, W, H);
    const grad = c.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#1b2434'); grad.addColorStop(1, '#0c1016');
    c.fillStyle = grad; c.fillRect(0, 0, W, H);
    // ground line
    c.fillStyle = '#1a2330'; c.fillRect(0, H * 0.72, W, H * 0.28);
    // crowd silhouettes
    for (const p of people) {
      p.x += p.v; if (p.x < -20) p.x = W + 10; if (p.x > W + 20) p.x = -10;
      c.fillStyle = `hsl(${p.hue}, 18%, ${16 + Math.sin(t * 2 + p.x) * 4}%)`;
      c.beginPath(); c.arc(p.x, H * 0.78 - p.w, p.w / 2, 0, Math.PI * 2); c.fill();
      c.fillRect(p.x - p.w / 2, H * 0.78 - p.w, p.w, p.w * 1.5);
    }
    // drifting sensor noise
    for (const n of noise) {
      n.x += n.v * 0.2; if (n.x > W) n.x = 0;
      c.fillStyle = `rgba(${140 + Math.random() * 60},${160 + Math.random() * 60},${180 + Math.random() * 40},${0.05 + Math.random() * 0.12})`;
      c.fillRect(n.x, n.y, n.s, n.s);
    }
    // scanline + vignette
    c.fillStyle = 'rgba(255,255,255,0.015)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
    const vg = c.createRadialGradient(W / 2, H / 2, H / 3, W / 2, H / 2, H);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vg; c.fillRect(0, 0, W, H);
    // HUD
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, W, 24);
    c.fillStyle = '#7CFC9A'; c.font = 'bold 11px monospace';
    c.fillText('● LIVE', 8, 16);
    c.fillStyle = '#e8e8e8'; c.font = '10px monospace';
    c.fillText(`${meta.pu || '—'} · ${meta.lga || ''} · ${meta.ward || ''}`, 58, 16);
    c.fillStyle = '#9fd8ff'; c.textAlign = 'right';
    const bitrate = (meta.bitrate || 1400) + Math.round(Math.sin(t) * 120);
    c.fillText(`${watClock(meta.t || Date.now())} · ${bitrate} kbps · ${meta.fps || 24} fps · ${meta.viewers || 0} viewers`, W - 8, 16);
    c.textAlign = 'left';
    c.fillStyle = 'rgba(255,255,255,0.65)'; c.font = '9px monospace';
    c.fillText('SECURE SIMULATED FEED · SIGNED URL · AGENT STREAM', 8, H - 8);
    raf = requestAnimationFrame(frame);
  }
  frame();
  return () => cancelAnimationFrame(raf);
}

// ---------------- sitrep renderer ----------------
function renderSitrep(s, scopeLabel) {
  const k = s.kpis;
  return `
  <div style="max-width:760px;margin:0 auto">
    <div class="flex mb12"><div><h2 style="color:#fff;font-size:16px">${esc(s.platform)} — ${scopeLabel || s.scope.toUpperCase()} SITREP</h2>
    <div class="small muted">Generated ${esc(s.generatedAtWat)} · ${esc(s.phase)} · ${esc(s.disclaimer)}</div></div>
    <div class="right"><button class="btn" onclick="window.print()">🖨 Print / PDF</button>
    <button class="btn" data-exp="json">JSON</button><button class="btn" data-exp="csv">CSV</button><button class="btn" data-exp="xlsx">Excel</button></div></div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      ${kpiCard('Reporting', fmtN(k.submittedPu) + ' / ' + fmtN(k.totalPu), { sub: k.reportingPct + '% of polling units' })}
      ${kpiCard('Verified', fmtN(k.verifiedPu), { sub: k.verifiedPct + '% of polling units', cls: 'ok' })}
      ${kpiCard('Verification queue', fmtN(k.verificationQueue), { sub: 'awaiting review', cls: 'warn' })}
      ${kpiCard('Active incidents', fmtN(k.activeIncidents), { sub: fmtN(k.criticalIncidents) + ' critical', cls: k.criticalIncidents ? 'alert' : '' })}
    </div>
    <div class="panel"><div class="ph"><span class="t">LGA Operational Status</span></div>
    <div class="pb flat">${dataTable({ cols: [
      { label: 'LGA', key: 'name' }, { label: 'Senatorial', key: 'senatorial' },
      { label: 'PUs', key: 'totalPu', cls: 'num' }, { label: 'Reported', key: 'submitted', cls: 'num' },
      { label: 'Reporting %', key: 'reportingPct', cls: 'num', render: r => r.reportingPct + '%' },
      { label: 'Verified %', key: 'verifiedPct', cls: 'num', render: r => r.verifiedPct + '%' },
      { label: 'Agents online', key: 'agentsOnline', cls: 'num', render: r => `${r.agentsOnline}/${r.agents}` },
      { label: 'Incidents', key: 'incidents', cls: 'num' }, { label: 'Health', key: 'healthScore', cls: 'num' },
    ], rows: s.lgas || [], sortable: true, pageSize: 30 }).el.outerHTML}</div></div>
    ${s.incidentSummary ? `<div class="panel"><div class="ph"><span class="t">Incident Summary (all day)</span></div><div class="pb">
      ${Object.entries(s.incidentSummary).map(([cat, n]) => `<span class="pill" style="margin:3px">${esc(cat)}: <b>${n}</b></span>`).join('')}</div></div>` : ''}
    ${s.verification ? `<div class="panel"><div class="ph"><span class="t">Verification Performance</span></div><div class="pb small">
      Queue: <b>${fmtN(s.verification.queue)}</b> · Reviewed: <b>${fmtN(s.verification.reviewed)}</b> · Avg review time: <b>${s.verification.avgReviewMin ?? '—'} min</b> · Anomalies flagged: <b>${fmtN(s.verification.anomalies)}</b>
    </div></div>` : ''}
  </div>`;
}

// ---------------- demo incident modal ----------------
function incidentModal(inc, { canManage, onChange }) {
  const m = modal({
    title: `${inc.code} — ${inc.subcategory}`,
    wide: true,
    body: () => {
      const d = el(`<div>
        <div class="flex mb12">${sevBadge(inc.severity)} ${statusBadge(inc.status)} <span class="pill">${esc(inc.category)}</span><span class="pill">${esc(inc.lga || '')} LGA</span><span class="pill">${esc(inc.puId || '')}</span></div>
        <div class="panel"><div class="ph"><span class="t">Description</span></div><div class="pb">${esc(inc.description || '—')}</div></div>
        <div class="panel"><div class="ph"><span class="t">Timeline</span></div><div class="pb"><div class="feed" style="max-height:200px">
          ${(inc.updates || []).map(u => `<div class="item"><span class="t">${fmtWatShort(u.at)}</span><span class="tx"><b>${esc(u.status || 'UPDATE')}</b> — ${esc(u.note || '')} <span class="dim">(${esc(u.by || '')})</span></span></div>`).join('')}
        </div></div></div>
        ${canManage ? `<div class="row mt8">
          <button class="btn" data-st="ACKNOWLEDGED">✓ Acknowledge</button>
          <button class="btn" data-st="INVESTIGATING">🔍 Investigating</button>
          <button class="btn warn" data-st="ESCALATED">▲ Escalate</button>
          <button class="btn success" data-st="RESOLVED">✔ Resolve</button>
          <button class="btn ghost" data-st="CLOSED">✕ Close</button>
        </div>` : ''}
      </div>`);
      $$('[data-st]', d).forEach(b => b.onclick = async () => {
        try {
          await API.post(`/api/incidents/${inc.id}/status`, { status: b.dataset.st, note: 'Status updated from situation room' });
          toast('Incident updated', `${inc.code} → ${b.dataset.st}`);
          m.close(); onChange && onChange();
        } catch (e) { toast('Error', e.message, 'high'); }
      });
      return d;
    },
    actions: [{ label: 'Close', cls: 'ghost' }],
  });
}

// ---------------- sos modal ----------------
function sosModal(sos, { canAck, canManage, onChange }) {
  const m = modal({
    title: `🚨 ${sos.code} — EMERGENCY SOS`,
    body: () => {
      const d = el(`<div>
        <div class="flex mb12">${statusBadge(sos.status)} <span class="pill">${esc(sos.category)}</span><span class="pill">${esc(sos.lga || '')} LGA</span><span class="pill">${esc(sos.puId || '')}</span></div>
        <div class="alert-strip"><div class="a">Agent GPS captured · ${esc(sos.puId)} · Location shared with authorized responders only</div></div>
        <div class="panel"><div class="ph"><span class="t">Escalation chain</span></div><div class="pb small">
          <div class="flex" style="justify-content:space-between;flex-wrap:wrap">
            ${['AGENT', 'LG CONTROL', 'SENATORIAL', 'CENTRAL'].map((s, i) => `<span class="pill" style="opacity:${(sos.acks?.length || 0) >= i ? 1 : 0.4}">${i + 1}. ${s}${(sos.acks || []).length > i ? ' ✓' : ''}</span>`).join('')}
          </div>
        </div></div>
        <div class="panel"><div class="ph"><span class="t">Log</span></div><div class="pb"><div class="feed" style="max-height:160px">
          ${(sos.updates || []).map(u => `<div class="item"><span class="t">${fmtWatShort(u.at)}</span><span class="tx">${esc(u.note)}</span></div>`).join('')}
          ${(sos.acks || []).map(a => `<div class="item"><span class="t">${fmtWatShort(a.at)}</span><span class="tx"><b>${esc(a.byName || a.by)}</b> acknowledged${a.note ? ' — ' + esc(a.note) : ''}</span></div>`).join('')}
        </div></div></div>
        <div class="row mt8">
          ${canAck ? `<button class="btn primary" data-act="ack">✓ Acknowledge SOS</button>` : ''}
          ${canManage ? `<button class="btn" data-act="RESPONDING">🚑 Responding</button><button class="btn success" data-act="RESOLVED">✔ Resolve</button>` : ''}
        </div>`);
      const doAck = async () => { await API.post(`/api/sos/${sos.id}/ack`, { note: 'Acknowledged by situation room' }); toast('SOS acknowledged', sos.code); m.close(); onChange && onChange(); };
      $('[data-act="ack"]', d).onclick = doAck;
      $$('[data-act]', d).forEach(b => {
        if (b.dataset.act === 'ack') return;
        b.onclick = async () => { await API.post(`/api/sos/${sos.id}/status`, { status: b.dataset.act, note: 'Updated by command' }); toast('SOS updated', `${sos.code} → ${b.dataset.act}`); m.close(); onChange && onChange(); };
      });
      return d;
    },
    actions: [{ label: 'Close', cls: 'ghost' }],
  });
}

window.initShell = initShell;
Object.assign(window, { kpiCard, dataTable, lineChart, barChart, donutChart, sparkline, stackedBar, drawEc8a, startSimStream, renderSitrep, incidentModal, sosModal, portalLinks });
