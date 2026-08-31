// map.js — interactive GIS map engine (SVG, no external dependencies)
'use strict';
function createMap(container, geo, opts = {}) {
  const PAD = 6;
  const W = 95, H = (geo && geo.bounds && geo.bounds[3]) || 128;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `${-PAD} ${-PAD} ${W + PAD * 2} ${H + PAD * 2}`);
  svg.style.width = '100%'; svg.style.height = '100%'; svg.style.display = 'block';
  container.innerHTML = '';
  container.style.position = 'relative';
  container.classList.add('map-wrap');
  container.appendChild(svg);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svg.appendChild(defs);
  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  glow.setAttribute('id', 'mglow'); glow.innerHTML = '<feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.appendChild(glow);

  const root = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  svg.appendChild(root);
  const lgaLayer = mk('g'), wardLayer = mk('g'), areaLayer = mk('g'), ptLayer = mk('g'), mkLayer = mk('g'), labelLayer = mk('g');
  root.append(lgaLayer, wardLayer, areaLayer, ptLayer, mkLayer, labelLayer);

  // view state
  let k = 1, tx = 0, ty = 0;
  let dragging = false, lastX = 0, lastY = 0;
  let onClick = null, onHover = null;
  const layers = { wards: false, pus: true, incidents: true, sos: true, streams: true, agents: true };
  let lgaMetric = null, wardMode = null, highlight = null;
  let data = { lgas: [], incidents: [], sos: [], streams: [], agents: [] };
  const lgaById = {}, puById = {}, puGeoById = {};

  for (const l of (geo.lgas || [])) {
    lgaById[l.id] = l;
    for (const w of l.wards || []) for (const p of w.pus || []) puById[p.id] = { ...p, lgaId: l.id, wardId: w.id };
  }
  for (const p of (geo.pus || [])) puGeoById[p.id] = p;
  function mk(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }
  function pointStr(poly) { return poly.map(p => p.join(',')).join(' '); }
  function applyView() { root.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`); render(); }

  // ---- interaction ----
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * (W + PAD * 2) - PAD;
    const my = ((e.clientY - rect.top) / rect.height) * (H + PAD * 2) - PAD;
    const factor = e.deltaY < 0 ? 1.22 : 0.82;
    const nk = Math.min(18, Math.max(0.7, k * factor));
    tx = mx - (mx - tx) * (nk / k);
    ty = my - (my - ty) * (nk / k);
    k = nk;
    applyView();
  }, { passive: false });
  svg.addEventListener('mousedown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; svg.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    tx += (e.clientX - lastX) / rect.width * (W + PAD * 2);
    ty += (e.clientY - lastY) / rect.height * (H + PAD * 2);
    lastX = e.clientX; lastY = e.clientY;
    applyView();
  });
  window.addEventListener('mouseup', () => { dragging = false; svg.style.cursor = ''; });
  svg.addEventListener('click', (e) => {
    if (dragging || !onClick) return;
    const t = e.target;
    const id = t.getAttribute('data-id'), type = t.getAttribute('data-type');
    if (id && type) onClick({ type, id, entity: t.getAttribute('data-entity') });
  });
  svg.addEventListener('mousemove', (e) => {
    if (!onHover) return;
    const t = e.target;
    if (t && t.getAttribute('data-id')) onHover({ type: t.getAttribute('data-type'), id: t.getAttribute('data-id'), x: e.clientX, y: e.clientY });
  });

  // ---- tools UI ----
  const tools = document.createElement('div');
  tools.className = 'map-tools';
  const zb = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; tools.appendChild(b); };
  zb('+', () => { k = Math.min(18, k * 1.5); applyView(); });
  zb('−', () => { k = Math.max(0.7, k / 1.5); applyView(); });
  zb('⌂', () => { k = 1; tx = 0; ty = 0; wardMode = null; applyView(); });
  container.appendChild(tools);
  const legend = document.createElement('div');
  legend.className = 'map-legend';
  container.appendChild(legend);

  // ---- scales ----
  function hsl(c1, c2, f) {
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * f), g = Math.round(c1[1] + (c2[1] - c1[1]) * f), b = Math.round(c1[2] + (c2[2] - c1[2]) * f);
    return `rgb(${r},${g},${b})`;
  }
  function scaleColor(v, min, max, a, b) {
    const f = max === min ? 0.5 : Math.max(0, Math.min(1, (v - min) / (max - min)));
    return hsl(a, b, f);
  }
  const isPublic = !!opts.public;
  const LOW = isPublic ? [214, 231, 246] : [13, 26, 48], HIGH = isPublic ? [11, 106, 168] : [56, 189, 248];
  const RLOW = isPublic ? [240, 235, 230] : [20, 14, 14], RHIGH = [220, 38, 38];

  // ---- render ----
  function render() {
    lgaLayer.innerHTML = ''; wardLayer.innerHTML = ''; areaLayer.innerHTML = ''; ptLayer.innerHTML = ''; mkLayer.innerHTML = ''; labelLayer.innerHTML = '';
    const lgas = data.lgas;
    // LGA polygons
    const vals = lgas.map(l => lgaMetric ? lgaMetric(l) : 0);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    for (const l of lgas) {
      const lid = l.id || l.lgaId;
      const poly = l.poly || (lgaById[lid] && lgaById[lid].poly);
      if (!poly) continue;
      const v = lgaMetric ? lgaMetric(l) : 0;
      const isHl = highlight && highlight === lid;
      const p = mk('polygon');
      p.setAttribute('points', pointStr(poly));
      p.setAttribute('fill', isHl ? (isPublic ? '#fbbf24' : '#f59e0b') : scaleColor(v, mn, mx, LOW, HIGH));
      p.setAttribute('fill-opacity', isPublic ? 0.85 : 0.82);
      p.setAttribute('stroke', isHl ? (isPublic ? '#b45309' : '#fbbf24') : (isPublic ? '#b9c8db' : '#12233d'));
      p.setAttribute('stroke-width', (isHl ? 1.6 : 0.6) / Math.sqrt(k));
      p.setAttribute('data-id', lid); p.setAttribute('data-type', 'LGA');
      p.setAttribute('data-entity', JSON.stringify({ name: l.name, senatorial: l.senatorial }).slice(0, 200));
      p.style.cursor = 'pointer';
      if (!isHl) p.appendChild(title(`${l.name} · ${l.senatorial}`));
      lgaLayer.appendChild(p);
      // label at sufficient zoom
      if (k > 1.25) {
        const t = mk('text');
        const c = l.centroid || (poly ? centroidOf(poly) : null);
        if (!c) continue;
        t.setAttribute('x', c[0]); t.setAttribute('y', c[1]);
        t.setAttribute('fill', isPublic ? '#123' : '#9db4d4'); t.setAttribute('font-size', (8 / k).toFixed(1));
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('pointer-events', 'none');
        t.textContent = l.name;
        labelLayer.appendChild(t);
      }
    }
    // wards when drilled
    if (wardMode && lgaById[wardMode]) {
      const l = lgaById[wardMode];
      const ws = geo.wards.filter(w => w.lgaId === wardMode);
      for (const w of ws) {
        if (!w.poly) continue;
        const p = mk('polygon');
        p.setAttribute('points', pointStr(w.poly));
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', isPublic ? '#8899b4' : '#2a4a75');
        p.setAttribute('stroke-width', (0.8 / k).toFixed(2));
        p.setAttribute('data-id', w.id); p.setAttribute('data-type', 'WARD');
        p.appendChild(title(w.name));
        wardLayer.appendChild(p);
        const t = mk('text');
        t.setAttribute('x', w.centroid[0]); t.setAttribute('y', w.centroid[1]);
        t.setAttribute('fill', isPublic ? '#334155' : '#7d9cc9'); t.setAttribute('font-size', (9 / k).toFixed(1));
        t.setAttribute('text-anchor', 'middle'); t.setAttribute('pointer-events', 'none');
        t.textContent = w.name;
        wardLayer.appendChild(t);
      }
      // dim other LGAs
      for (const p of lgaLayer.children) if (p.getAttribute('data-id') !== wardMode) p.setAttribute('fill-opacity', 0.22);
    }
    // PUs (zoom-gated + clustered)
    if (layers.pus) {
      const pus = geo.pus || [];
      if (k < 2.2) {
        const grid = {};
        const cell = 6 / k;
        for (const p of pus) {
          const key = `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
          grid[key] = grid[key] || { x: Math.round(p.x / cell) * cell, y: Math.round(p.y / cell) * cell, n: 0 };
          grid[key].n++;
        }
        for (const c of Object.values(grid)) {
          const g = mk('circle');
          g.setAttribute('cx', c.x); g.setAttribute('cy', c.y);
          g.setAttribute('r', (c.n > 30 ? 5 : c.n > 10 ? 3.5 : 2.4) / Math.sqrt(k));
          g.setAttribute('fill', isPublic ? '#0b6aa8' : '#38bdf8');
          g.setAttribute('fill-opacity', 0.5 + Math.min(0.45, c.n / 200));
          ptLayer.appendChild(g);
        }
      } else {
        for (const p of pus) {
          const sub = data.subStatus && data.subStatus[p.id];
          const g = mk('circle');
          g.setAttribute('cx', p.x); g.setAttribute('cy', p.y);
          g.setAttribute('r', (sub ? 2.1 : 1.5) / Math.sqrt(k / 4));
          const col = sub === 'VERIFIED' ? (isPublic ? '#157a3a' : '#22c55e') : sub === 'REJECTED' ? '#ef4444' : sub === 'DISPUTED' ? '#a78bfa' : sub === 'SUBMITTED' ? (isPublic ? '#0b6aa8' : '#38bdf8') : (isPublic ? '#8899b4' : '#3a5a86');
          g.setAttribute('fill', col);
          g.setAttribute('data-id', p.id); g.setAttribute('data-type', 'PU');
          g.setAttribute('data-entity', JSON.stringify({ name: p.name, lgaId: p.lgaId }).slice(0, 180));
          g.style.cursor = 'pointer';
          g.appendChild(title(`${p.id} · ${p.name}`));
          ptLayer.appendChild(g);
        }
      }
    }
    // markers
    if (layers.incidents) for (const i of data.incidents) {
      const pos = posOf(i);
      if (!pos) continue;
      const sevCols = { 1: '#94a3b8', 2: '#4ade80', 3: '#fbbf24', 4: '#fb923c', 5: '#ef4444' };
      const g = mk('g');
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
      g.setAttribute('data-id', i.id); g.setAttribute('data-type', 'INCIDENT');
      g.style.cursor = 'pointer';
      const s = 3.2 / Math.sqrt(k);
      if (i.severity >= 4) {
        const pulse = mk('circle');
        pulse.setAttribute('r', s * 2.6); pulse.setAttribute('fill', sevCols[i.severity]); pulse.setAttribute('opacity', 0.35);
        const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
        anim.setAttribute('attributeName', 'r'); anim.setAttribute('values', `${s * 1.4};${s * 3.4};${s * 1.4}`); anim.setAttribute('dur', '1.6s'); anim.setAttribute('repeatCount', 'indefinite');
        pulse.appendChild(anim); g.appendChild(pulse);
      }
      const c = mk('circle');
      c.setAttribute('r', s); c.setAttribute('fill', sevCols[i.severity]); c.setAttribute('stroke', isPublic ? '#fff' : '#0a101d'); c.setAttribute('stroke-width', 0.8);
      g.appendChild(c);
      g.appendChild(title(`INC ${i.code || i.id} · L${i.severity} · ${i.subcategory}`));
      mkLayer.appendChild(g);
    }
    if (layers.sos) for (const s of data.sos) {
      const pos = posOf(s);
      if (!pos) continue;
      const g = mk('g');
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
      g.setAttribute('data-id', s.id); g.setAttribute('data-type', 'SOS');
      g.style.cursor = 'pointer';
      const pulse = mk('circle');
      pulse.setAttribute('r', 4 / Math.sqrt(k)); pulse.setAttribute('fill', '#ef4444'); pulse.setAttribute('opacity', 0.3);
      const anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      anim.setAttribute('attributeName', 'r'); anim.setAttribute('values', `${2.5 / Math.sqrt(k)};${7 / Math.sqrt(k)};${2.5 / Math.sqrt(k)}`); anim.setAttribute('dur', '1.2s'); anim.setAttribute('repeatCount', 'indefinite');
      pulse.appendChild(anim); g.appendChild(pulse);
      const c = mk('circle');
      c.setAttribute('r', 2.6 / Math.sqrt(k)); c.setAttribute('fill', '#ef4444'); c.setAttribute('stroke', '#fff'); c.setAttribute('stroke-width', 0.7);
      g.appendChild(c);
      g.appendChild(title(`SOS ${s.code || s.id} · ${s.category}`));
      mkLayer.appendChild(g);
    }
    if (layers.streams) for (const s of data.streams) {
      const pos = posOf(s);
      if (!pos) continue;
      const g = mk('g');
      g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
      g.setAttribute('data-id', s.id); g.setAttribute('data-type', 'STREAM');
      g.style.cursor = 'pointer';
      const c = mk('circle');
      c.setAttribute('r', 2.8 / Math.sqrt(k)); c.setAttribute('fill', 'none'); c.setAttribute('stroke', '#4ade80'); c.setAttribute('stroke-width', 1.1);
      g.appendChild(c);
      const dot = mk('circle');
      dot.setAttribute('r', 1.1); dot.setAttribute('fill', '#4ade80');
      const an = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
      an.setAttribute('attributeName', 'opacity'); an.setAttribute('values', '1;0.2;1'); an.setAttribute('dur', '1s'); an.setAttribute('repeatCount', 'indefinite');
      dot.appendChild(an); g.appendChild(dot);
      g.appendChild(title(`LIVE STREAM · ${s.puId} · ${s.lga}`));
      mkLayer.appendChild(g);
    }
    if (layers.agents && data.agents && k > 1.6) {
      for (const a of data.agents) {
        const p = puGeoById[a.puId];
        if (!p) continue;
        const g = mk('circle');
        g.setAttribute('cx', p.x + (a.off || 0) * 0.35); g.setAttribute('cy', p.y + (a.off || 0) * 0.35);
        g.setAttribute('r', 1.1 / Math.sqrt(k / 2));
        g.setAttribute('fill', a.online ? '#4ade80' : '#64748b');
        g.setAttribute('data-id', a.id); g.setAttribute('data-type', 'AGENT');
        g.appendChild(title(`Agent ${a.code || a.id} · ${a.online ? 'online' : 'offline'}`));
        ptLayer.appendChild(g);
      }
    }
    // legend
    legend.innerHTML = isPublic
      ? `<b>Legend</b><br>■ LGAs (reporting density)<br><span style="color:#ef4444">●</span> Incident &nbsp; <span style="color:#0b6aa8">●</span> Polling units`
      : `<b>Legend</b><br><span style="color:#38bdf8">■</span> Reporting density<br><span style="color:#ef4444">●</span> Incident (pulse = L4/L5) &nbsp; <span style="color:#ef4444">◉</span> SOS<br><span style="color:#4ade80">◎</span> Live stream &nbsp; <span style="color:#22c55e">●</span> Verified PU<br><span style="color:#8b9cbd">●</span> Agent (zoom in)`;
    function title(t) { const x = mk('title'); x.textContent = t; return x; }
  }

  function posOf(entity) {
    const pu = puGeoById[entity.puId];
    if (pu) return { x: pu.x, y: pu.y };
    if (entity.lgaId) {
      const l = lgaById[entity.lgaId];
      if (l && l.centroid) return { x: l.centroid[0], y: l.centroid[1] };
    }
    return null;
  }
  function centroidOf(poly) {
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const f = poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      cx += (poly[j][0] + poly[i][0]) * f; cy += (poly[j][1] + poly[i][1]) * f; a += f;
    }
    a /= 2;
    return a === 0 ? poly[0] : [cx / (6 * a), cy / (6 * a)];
  }

  return {
    setData(d) { data = { ...data, ...d }; render(); },
    setLgaMetric(fn) { lgaMetric = fn; render(); },
    setSubStatus(map) { data.subStatus = map; render(); },
    setLayer(name, on) { if (name in layers) layers[name] = on; render(); },
    getLayers() { return { ...layers }; },
    onClick(fn) { onClick = fn; },
    onHover(fn) { onHover = fn; },
    zoomToLga(id) {
      const l = lgaById[id];
      if (!l) return;
      wardMode = id;
      const c = l.centroid || centroidOf(l.poly);
      k = Math.min(5, k); tx = 0; ty = 0;
      // center on centroid
      const cw = W + PAD * 2, ch = H + PAD * 2;
      tx = cw / 2 - c[0]; ty = ch / 2 - c[1];
      k = 3.2;
      applyView();
    },
    clearDrill() { wardMode = null; k = 1; tx = 0; ty = 0; applyView(); },
    highlight(id) { highlight = id; render(); },
    reset() { k = 1; tx = 0; ty = 0; wardMode = null; highlight = null; applyView(); },
  };
}
window.createMap = createMap;
