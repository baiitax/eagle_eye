// sentinel.js — EYES OF VICTORY · SENTINEL SECURITY OPERATIONS CENTRE (client)
// Defensive monitoring & authorized response. Every privileged action is authenticated,
// authorized, logged, reversible where possible, and subject to approval (§1–75).
'use strict';

const SEC_SEV_COLOR = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#fbbf24', LOW: '#38bdf8', INFORMATIONAL: '#64748b' };
const SEC_NODE_COLOR = { HEALTHY: '#22c55e', DEGRADED: '#f59e0b', WARNING: '#f97316', CRITICAL: '#ef4444', OFFLINE: '#64748b', ISOLATED: '#a855f7', BLOCKED: '#ef4444', STANDBY: '#60a5fa', STOPPED: '#64748b', DISABLED: '#ef4444' };
const SEC_RISK_CLS = { LOW: 's-verified', MEDIUM: 's-under', HIGH: 'l4', CRITICAL: 'l5' };
const secSev = (s) => `<span class="badge ${s === 'CRITICAL' ? 'l5' : s === 'HIGH' ? 'l4' : s === 'MEDIUM' ? 's-under' : s === 'LOW' ? 's-submitted' : 's-archived'}"><span class="dot"></span>${esc(s)}</span>`;
const secRisk = (r) => `<span class="badge ${SEC_RISK_CLS[r] || 's-archived'}"><span class="dot"></span>${esc(r)} RISK</span>`;
const secStatus = (s) => {
  const map = { REQUESTED: 's-under', PENDING_DUAL: 'l4', APPROVED: 's-submitted', EXECUTED: 's-verified', REJECTED: 's-rejected', ROLLED_BACK: 's-archived' };
  return `<span class="badge ${map[s] || 's-archived'}"><span class="dot"></span>${esc(s.replace(/_/g, ' '))}</span>`;
};
const secFlowDot = (c, flow) => {
  const idx = (flow || []).indexOf(c.status);
  return (flow || []).map((f, i) => `<span class="pill" style="opacity:${i <= idx ? 1 : 0.35}">${i < idx ? '✓' : i === idx ? '▶' : '·'} ${esc(f)}</span>`).join('');
};
const sbar = (v, color) => `<div class="meter"><i style="width:${Math.max(2, Math.min(100, Math.round(v)))}%;background:${color || '#38bdf8'}"></i></div>`;
const secBadge = (st) => `<span class="badge ${st === 'HEALTHY' ? 's-verified' : st === 'DEGRADED' ? 's-under' : st === 'WARNING' ? 's-submitted' : st === 'CRITICAL' ? 'l5' : st === 'OFFLINE' ? 's-archived' : st === 'ISOLATED' ? 'l4' : st === 'BLOCKED' ? 'l5' : 's-archived'}"><span class="dot"></span>${esc(st)}</span>`;

const NAV = [
  { section: '◉ COMMAND', id: 'cmd', label: 'Security Dashboard', ico: '◉' },
  { section: '◉ COMMAND', id: 'wall', label: 'Command Wall', ico: '▣' },
  { section: '◉ COMMAND', id: 'timeline', label: 'Security Timeline', ico: '≣' },
  { section: '◉ THREATS', id: 'threats', label: 'Threat Monitor', ico: '⚠' },
  { section: '◉ THREATS', id: 'intel', label: 'Threat Intelligence', ico: '🜁' },
  { section: '◉ THREATS', id: 'rules', label: 'Detection Rules', ico: '⚙' },
  { section: '◉ INCIDENTS', id: 'incidents', label: 'Active Incidents', ico: '⚑' },
  { section: '◉ INCIDENTS', id: 'cases', label: 'Case Management', ico: '▤' },
  { section: '◉ INCIDENTS', id: 'playbooks', label: 'Response Playbooks', ico: '📖' },
  { section: '◉ INFRASTRUCTURE', id: 'nodes', label: 'Nodes', ico: '🖥' },
  { section: '◉ INFRASTRUCTURE', id: 'network', label: 'Network', ico: '⇄' },
  { section: '◉ INFRASTRUCTURE', id: 'availability', label: 'Availability', ico: '◔' },
  { section: '◉ API SECURITY', id: 'apis', label: 'API Monitor', ico: '⇌' },
  { section: '◉ IDENTITY', id: 'identity', label: 'Users & Sessions', ico: '👤' },
  { section: '◉ VULNERABILITIES', id: 'vulns', label: 'Vulnerability Centre', ico: '⛨' },
  { section: '◉ VULNERABILITIES', id: 'patches', label: 'Patch Management', ico: '🧩' },
  { section: '◉ VULNERABILITIES', id: 'drift', label: 'Configuration Drift', ico: 'Δ' },
  { section: '◉ DATA SECURITY', id: 'db', label: 'Database', ico: '🗄' },
  { section: '◉ DATA SECURITY', id: 'evidence', label: 'Evidence Store', ico: '🧾' },
  { section: '◉ DATA SECURITY', id: 'recovery', label: 'Recovery Centre', ico: '↺' },
  { section: '◉ APPLICATION SECURITY', id: 'publicsec', label: 'Public Domain / WAF', ico: '🌐' },
  { section: '◉ APPLICATION SECURITY', id: 'apps', label: 'Application Coverage', ico: '▦' },
  { section: '◉ IReV SECURITY', id: 'irevsec', label: 'Watchtower Security', ico: '👁' },
  { section: '◉ RESPONSE', id: 'actions', label: 'Action Centre', ico: '🛡' },
  { section: '◉ RESPONSE', id: 'breakglass', label: 'Break-Glass', ico: '⚡' },
  { section: '◉ ANALYTICS', id: 'kpis', label: 'Security KPIs', ico: '◎' },
  { section: '◉ ANALYTICS', id: 'trends', label: 'Trends', ico: '📈' },
  { section: '◉ ANALYTICS', id: 'risk', label: 'Risk Register', ico: '◪' },
  { section: '◉ GOVERNANCE', id: 'audit', label: 'Audit & Logs', ico: '🗒' },
  { section: '◉ GOVERNANCE', id: 'compliance', label: 'Compliance', ico: '✓' },
  { section: '◉ SYSTEM', id: 'system', label: 'Health & Integrations', ico: '♨' },
];

const secApi = (p, o) => API.get('/api/sentinel' + p, o);
let shell = null;
let eventsCache = [];
const canRespond = () => API.can('security.respond');
const canPriv = () => API.can('security.privileged');
const canAudit = () => API.can('security.audit');

// ---------------- modal: node detail (§8/9) ----------------
async function openNodeModal(nodeId) {
  const d = await secApi('/nodes?id=' + encodeURIComponent(nodeId));
  const n = d.node;
  const body = () => el(`<div>
    <div class="grid3 mb12">
      <div class="stat-tile"><div class="v">${esc(n.id)}</div><div class="l">NODE ID</div></div>
      <div class="stat-tile"><div class="v">${esc(n.hostname)}</div><div class="l">HOSTNAME</div></div>
      <div class="stat-tile ${n.status === 'HEALTHY' ? 'ok' : 'bad'}"><div class="v">${esc(n.status)}</div><div class="l">OPERATING STATUS</div></div>
    </div>
    <div class="grid3 mb12">
      <div class="stat-tile"><div class="v" style="font-size:14px">${esc(n.env)}</div><div class="l">ENVIRONMENT</div></div>
      <div class="stat-tile"><div class="v" style="font-size:14px">${esc(n.region)}</div><div class="l">REGION</div></div>
      <div class="stat-tile ${n.securityAgent === 'ACTIVE' ? 'ok' : 'bad'}"><div class="v" style="font-size:14px">${esc(n.securityAgent)}</div><div class="l">SECURITY AGENT</div></div>
    </div>
    <div class="panel"><div class="ph"><span class="t">Resource utilization</span></div><div class="pb">
      <div class="health-bars">
        <div class="hb"><span class="k">CPU</span><div class="grow">${sbar(n.cpu, n.cpu > 80 ? '#ef4444' : n.cpu > 60 ? '#fbbf24' : '#38bdf8')}</div><span class="v">${Math.round(n.cpu)}%</span></div>
        <div class="hb"><span class="k">Memory</span><div class="grow">${sbar(n.memory, n.memory > 85 ? '#ef4444' : '#38bdf8')}</div><span class="v">${Math.round(n.memory)}%</span></div>
        <div class="hb"><span class="k">Disk</span><div class="grow">${sbar(n.disk, '#38bdf8')}</div><span class="v">${Math.round(n.disk)}%</span></div>
        <div class="hb"><span class="k">Network</span><div class="grow">${sbar(n.netMbps / 9, '#22c55e')}</div><span class="v">${Math.round(n.netMbps)} Mbps</span></div>
      </div>
    </div></div>
    <div class="grid2 mb12">
      <div class="stat-tile ${n.patchStatus === 'UP_TO_DATE' ? 'ok' : 'bad'}"><div class="v" style="font-size:13px">${esc(n.patchStatus.replace(/_/g, ' '))}</div><div class="l">PATCH STATUS</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${fmtWatShort(n.lastCheck)}</div><div class="l">LAST SECURITY CHECK</div></div>
    </div>
    <div class="panel"><div class="ph"><span class="t">Active services</span></div><div class="pb">${(n.services || []).map(s => `<span class="pill">${esc(s)}</span>`).join('') || '<span class="dim small">—</span>'}</div></div>
    ${(d.vulns || []).length ? `<div class="panel mt12"><div class="ph"><span class="t">Vulnerabilities on this node</span></div><div class="pb small">${d.vulns.map(v => `<div class="row mb4"><b style="color:#f87171">${esc(v.cve)}</b> ${secSev(v.severity)} <span class="flex1"></span><span class="dim">${esc(v.status)}</span></div>`).join('')}</div></div>` : ''}
    ${(d.events || []).length ? `<div class="panel mt12"><div class="ph"><span class="t">Recent events</span></div><div class="pb"><div class="feed" style="max-height:150px">${d.events.slice(0, 8).map(e => `<div class="item"><span class="t">${fmtWatShort(e.createdAt)}</span><span class="tx">${secSev(e.severity)} ${esc(e.title)}</span></div>`).join('')}</div></div></div>` : ''}
    <div class="dim small mt8">Last backup: ${fmtWatShort(n.lastBackup)} · Last security scan: ${fmtWatShort(n.lastScan)}</div>
    ${canRespond() ? `<div class="panel mt12"><div class="ph"><span class="t">Node action centre (§9)</span><span class="sp dim small">AUTHENTICATION → AUTHORIZATION → CONFIRMATION → EXECUTION → AUDIT</span></div>
      <div class="pb"><div class="row">
        ${[['RUN_HEALTH_CHECK', '↻ Refresh health check'], ['RESTART_SERVICE', '▶ Restart approved service'], ['ROTATE_CREDENTIAL', '⟳ Rotate service credential'], ['RUN_VULN_SCAN', '⌕ Trigger security scan'], ['ISOLATE_NODE', '⛔ Isolate node'], ['BLOCK_COMPONENT', '▣ Block component'], ['FAILOVER_SERVICE', '⇄ Fail over service']].map(([a, l]) => `<button class="btn sm" data-act="${a}">${l}</button>`).join('')}
      </div></div></div>` : ''}
  </div>`);
  const m = modal({ title: `NODE COMMAND — ${n.id} · ${n.hostname}`, body, wide: true, actions: [{ label: 'Close', cls: 'ghost' }] });
  $$('[data-act]', m.body).forEach(b => {
    b.onclick = () => { m.close(); requestActionModal(b.dataset.act, n.id); };
  });
}

// ---------------- modal: request privileged action (§49) ----------------
function requestActionModal(action, target, detail) {
  let catalog = null;
  secApi('/action-catalog').then(r => { catalog = r.catalog; refreshPreview(); }).catch(() => {});
  const body = () => el(`<div>
    <div class="fl small muted mb8">ACTION PREVIEW</div>
    <div class="grid2 mb12">
      <div class="stat-tile"><div class="v" style="font-size:15px;color:#fbbf24">${esc(action || '—')}</div><div class="l">ACTION</div></div>
      <div class="stat-tile"><div class="v" style="font-size:13px">${esc(target || '—')}</div><div class="l">TARGET</div></div>
    </div>
    <div class="grid2 mb12">
      <div class="stat-tile"><div class="v" style="font-size:12px;color:#7dd3fc" id="apr-impact">${esc(catalog && catalog[action] ? impactOf(action, target) : '—')}</div><div class="l">EXPECTED IMPACT</div></div>
      <div class="stat-tile"><div class="v" style="font-size:12px" id="apr-meta">${catalog && catalog[action] ? `${secRisk(catalog[action].risk)} · Reversible: ${catalog[action].reversible ? 'YES' : 'NO'} · Approval: ${catalog[action].approval === 'NONE' ? 'NOT REQUIRED' : catalog[action].approval}` : '—'}</div><div class="l">RISK / REVERSIBLE / APPROVAL</div></div>
    </div>
    <label class="fl">Reason / justification (required for HIGH & CRITICAL)</label>
    <textarea class="inp" id="apr-detail" style="min-height:64px;width:100%" placeholder="Why is this action required right now?"></textarea>
    <div class="small dim mt8">Every action is written to the append-only security audit: WHO · WHAT · WHEN · WHERE · TARGET · BEFORE · AFTER · WHY · APPROVAL · RESULT.</div>
  </div>`);
  const impactOf = (act, tgt) => {
    const known = { ISOLATE_NODE: 'Traffic will fail over to the sibling node. Target leaves rotation until restored.', DISABLE_API: 'The API returns 503 for all callers until re-enabled.', ROTATE_CREDENTIAL: 'A new credential is issued and propagated; the old one stops working.', RESTART_SERVICE: 'Brief service interruption (seconds) while the service restarts.', RATE_LIMIT_SOURCE: 'Traffic from this source is temporarily rate-limited for 30 minutes.', DISABLE_SESSION: 'The session is terminated immediately; the user must re-authenticate.', BLOCK_COMPONENT: 'The component is blocked at the network layer until restored.', FAILOVER_SERVICE: 'Traffic is moved to the standby; current node returns to standby.', RUN_HEALTH_CHECK: 'Fresh health probe executed against the node.', RUN_VULN_SCAN: 'A vulnerability scan is scheduled against the asset.', VERIFY_BACKUP: 'Backup archives verified against stored checksums.', ADJUST_RATE_LIMIT: 'API rate limit adjusted for all sources.', ENABLE_MAINTENANCE: 'Platform enters maintenance mode; users see a notice.', REVOKE_CREDENTIAL: 'Credential revoked immediately; dependents must be re-issued.', START_RECOVERY: 'Recovery runbook starts; affected services may restart.', FAILOVER_DR: 'All traffic moves to the disaster-recovery site.', PRODUCTION_SHUTDOWN: 'All production services stop. Election monitoring is interrupted.', FIREWALL_POLICY: 'Firewall rules change globally.', DESTRUCTIVE_OP: 'Data or systems destroyed. NOT reversible.', EVIDENCE_STORE_CHANGE: 'Evidence-store policy changes.', DATABASE_RECOVERY: 'Database restored from backup; recent writes may be affected.', POLICY_OVERRIDE: 'A security policy is temporarily overridden.', ACK_ALERT: 'Alert acknowledged and removed from the open queue.', ASSIGN_CASE: 'Case assigned to the selected analyst.', REQUEST_LOGS: 'Log bundle prepared for the requester.' };
    return known[act] || `Controlled effect on ${tgt || 'target'} per the approved runbook.`;
  };
  function refreshPreview() {
    const i = $('#apr-impact'); if (i) i.textContent = impactOf(action, target);
    const meta = $('#apr-meta');
    if (meta && catalog && catalog[action]) meta.innerHTML = `${secRisk(catalog[action].risk)} · Reversible: ${catalog[action].reversible ? 'YES' : 'NO'} · Approval: ${catalog[action].approval === 'NONE' ? 'NOT REQUIRED (audited)' : catalog[action].approval}`;
  }
  const m = modal({
    title: 'SECURITY ACTION CENTRE — request action',
    body, wide: false,
    actions: [
      { label: 'CANCEL', cls: 'ghost' },
      {
        label: 'REQUEST APPROVAL →', cls: 'primary',
        onClick: async () => {
          const detailTxt = $('#apr-detail', m.body)?.value?.trim() || '';
          try {
            const r = await API.post('/api/sentinel/actions/request', { action, target, detail: detailTxt });
            if (r.requiresApproval) toast('Action requested', `${r.action.actionLabel} on ${target} — awaiting ${r.action.approval} approval.`, 'medium');
            else toast('Action executed', `${r.action.actionLabel} on ${target} — logged to the immutable audit.`);
            m.close();
            if (typeof renderActionsTab === 'function' && shell._active === 'actions') renderActionsTab(shell.main);
          } catch (e) { toast('Request failed', e.message, 'critical'); }
        },
      },
    ],
  });
}

// ---------------- modal: security case (§21/22/52/53) ----------------
async function openCaseModal(caseId) {
  const d = await secApi('/incidents/' + encodeURIComponent(caseId));
  const c = d.case;
  const body = () => el(`<div>
    <div class="flex mb12" style="flex-wrap:wrap">
      <span class="pill" style="color:#fbbf24">${esc(c.code)}</span>${secSev(c.severity)}<span class="pill">${esc(c.category)}</span><span class="pill">${esc(c.status)}</span>
      <span class="flex1"></span><span class="dim small">Detected ${fmtWatShort(c.detectedAt)}</span>
    </div>
    <div class="alert-strip"><div class="a amber">SOURCE: ${esc(c.source)} · AFFECTED SERVICE: ${esc(c.affectedService)} · ANALYST: ${esc(c.analyst || 'unassigned')}</div></div>
    <div class="panel mb12"><div class="ph"><span class="t">Workflow</span></div><div class="pb"><div class="row" style="flex-wrap:wrap">${secFlowDot(c, d.flow)}</div></div></div>
    <div class="panel mb12"><div class="ph"><span class="t">Incident timeline (§22)</span></div><div class="pb"><div class="feed">
      ${(c.timeline || []).map(t => `<div class="item"><span class="t">${fmtWatShort(t.at)}</span><span class="tx"><b>${esc(t.step)}</b> — ${esc(t.note || '')}</span></div>`).join('') || '<div class="dim small">No timeline entries</div>'}
    </div></div></div>
    ${(d.relatedAlerts || []).length ? `<div class="panel mb12"><div class="ph"><span class="t">Related alerts</span></div><div class="pb small">${d.relatedAlerts.slice(0, 6).map(a => `<div class="row mb4">${secSev(a.severity)} ${esc(a.title)} <span class="flex1"></span><span class="dim">${fmtWatShort(a.createdAt)}</span></div>`).join('')}</div></div>` : ''}
    <div class="panel mb12"><div class="ph"><span class="t">Case communications (§53)</span></div><div class="pb">
      <div class="feed mb8" style="max-height:140px">${(d.comms || []).map(x => `<div class="item"><span class="t">${fmtWatShort(x.createdAt)}</span><span class="tx"><b>${esc(x.user)}:</b> ${esc(x.text)}</span></div>`).join('') || '<div class="dim small">No communications yet</div>'}</div>
      <div class="row"><input class="inp" id="ccom" placeholder="Post an incident communication…" style="flex:1"><button class="btn sm" id="ccombtn">Send</button></div>
    </div></div>
    ${canRespond() && c.status !== 'CLOSED' ? `<div class="panel"><div class="ph"><span class="t">Advance workflow (§20)</span></div><div class="pb">
      <div class="row" style="flex-wrap:wrap">${(d.flow || []).filter(f => d.flow.indexOf(f) > d.flow.indexOf(c.status) || f === 'CLOSED').map(f => `<button class="btn sm" data-f="${f}">→ ${esc(f)}</button>`).join('')}</div>
    </div></div>` : ''}
  </div>`);
  const m = modal({ title: `SECURITY CASE — ${c.title}`, body, wide: true, actions: [{ label: 'Close', cls: 'ghost' }] });
  $('#ccombtn', m.body).onclick = async () => {
    const t = $('#ccom', m.body).value.trim();
    if (!t) return;
    await API.post('/api/sentinel/incidents/' + encodeURIComponent(caseId) + '/comment', { text: t });
    $('#ccom', m.body).value = '';
    toast('Comment posted', 'Associated with the case.');
    m.close(); openCaseModal(caseId);
  };
  $$('[data-f]', m.body).forEach(b => {
    b.onclick = async () => {
      try {
        await API.post('/api/sentinel/incidents/' + encodeURIComponent(caseId) + '/transition', { status: b.dataset.f });
        toast('Case updated', `${c.code} → ${b.dataset.f}`);
        m.close(); openCaseModal(caseId);
      } catch (e) { toast('Transition failed', e.message, 'critical'); }
    };
  });
}

// ---------------- copilot (§61/62) ----------------
function copilotPanel() {
  const box = el(`<div class="panel"><div class="ph"><span class="t">SENTINEL COPILOT</span><span class="sp dim small">answers cite live telemetry · actions are always PROPOSED, never executed</span></div>
    <div class="pb">
      <div class="small dim mb8">Ask the security engine:</div>
      <div class="row mb8" style="flex-wrap:wrap">
        ${['Most critical issues?', 'Isolated nodes?', 'API anomalies?', 'Critical vulns >7d?', 'Config changed today?', 'Privileged actions 1h?', 'Incident briefing', 'Unresolved incidents?'].map(q => `<button class="btn sm" data-q="${esc(q)}">${esc(q)}</button>`).join('')}
      </div>
      <div class="row mb8"><input class="inp" id="copq" style="flex:1" placeholder="e.g. Block this source."><button class="btn sm primary" id="copgo">Ask</button></div>
      <div id="copout" class="small" style="line-height:1.6;max-height:300px;overflow:auto"></div>
    </div></div>`);
  const ask = async (q) => {
    const out = $('#copout', box);
    out.innerHTML = '<span class="dim">Analysing security records…</span>';
    try {
      const r = await API.post('/api/sentinel/copilot', { q });
      out.innerHTML = mdToHtml(r.answer || 'No answer');
      if (r.sections && r.sections.length) {
        out.innerHTML += `<div class="mt8 dim" style="font-size:10px">${r.sections.map(s => `[${esc(s.provenance)}] ${esc(s.text || '')}`).join('<br>')}</div>`;
      }
      // §62: proposed actions get explicit APPROVE / REJECT — never auto-executed
      if (/Proposed Action/.test(r.answer || '')) {
        const actRow = el(`<div class="row mt8">
          <button class="btn primary sm" data-approve>APPROVE</button><button class="btn ghost sm" data-reject>REJECT</button>
        </div>`);
        $('[data-approve]', actRow).onclick = () => { requestActionModal('RATE_LIMIT_SOURCE', 'SUSPICIOUS-SOURCE', '30-minute rate-limit per Copilot proposal (§62)'); };
        $('[data-reject]', actRow).onclick = () => toast('Proposal rejected', 'No action was executed.');
        out.appendChild(actRow);
      }
    } catch (e) { out.innerHTML = `<span style="color:#f87171">${esc(e.message)}</span>`; }
  };
  $$('[data-q]', box).forEach(b => b.onclick = () => ask(b.dataset.q));
  $('#copgo', box).onclick = () => { const v = $('#copq', box).value.trim(); if (v) ask(v); };
  $('#copq', box).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#copgo', box).click(); });
  return box;
}

// ---------------- live infrastructure map (secure topology, §6) ----------------
function secMap(nodes) {
  const regs = [
    { name: 'CDN · GLOBAL EDGE', x: 380, y: 16, w: 196, h: 58 },
    { name: 'CLOUD · ABUJA EDGE', x: 12, y: 16, w: 172, h: 92 },
    { name: 'CLOUD · LAGOS EDGE', x: 12, y: 122, w: 172, h: 92 },
    { name: 'DATA CENTRE · KANO', x: 12, y: 228, w: 172, h: 118 },
    { name: 'PUBLIC DOMAIN', x: 380, y: 90, w: 196, h: 58 },
    { name: 'VIDEO + IReV', x: 380, y: 164, w: 196, h: 88 },
    { name: 'MONITORING', x: 380, y: 268, w: 196, h: 78 },
  ];
  const regionOf = (n) => {
    if (n.region === 'Cloud · Abuja Edge') return 1; if (n.region === 'Cloud · Lagos Edge') return 2;
    if (n.region === 'Data Centre · Kano') return 3; if (n.region === 'Global Edge') return 0;
    if (n.kind === 'PUBLIC') return 4; if (n.kind === 'VIDEO' || n.kind === 'IREV_CONNECTOR') return 5;
    if (n.kind === 'MONITORING') return 6; if (n.kind === 'INTERNAL') return 6;
    return 3;
  };
  let dots = '';
  const perReg = {};
  for (const n of nodes) {
    const ri = regionOf(n);
    (perReg[ri] = perReg[ri] || []).push(n);
  }
  const lines = `<g stroke="#1d3a5f" stroke-width="1" opacity=".8">
    <line x1="380" y1="45" x2="196" y2="70"/><line x1="380" y1="45" x2="196" y2="170"/>
    <line x1="184" y1="110" x2="184" y2="170"/><line x1="184" y1="170" x2="184" y2="260"/>
    <line x1="380" y1="120" x2="196" y2="120"/><line x1="380" y1="210" x2="196" y2="250"/>
    <line x1="380" y1="300" x2="196" y2="280"/><line x1="576" y1="45" x2="576" y2="120"/>
  </g>`;
  for (const [ri, list] of Object.entries(perReg)) {
    const r = regs[+ri];
    const cols = Math.min(3, list.length);
    list.forEach((n, i) => {
      const cx = r.x + 16 + (i % cols) * 56, cy = r.y + 26 + Math.floor(i / cols) * 24;
      dots += `<circle cx="${cx}" cy="${cy}" r="7" fill="${SEC_NODE_COLOR[n.status] || '#64748b'}" stroke="#0a101d" stroke-width="1.4" data-node="${esc(n.id)}" style="cursor:pointer"><title>${esc(n.id)} ${esc(n.hostname)} — ${esc(n.status)}</title></circle>`;
      dots += `<text x="${cx}" y="${cy + 16}" fill="#566781" font-size="7" text-anchor="middle">${esc(n.id.replace('NODE-', ''))}</text>`;
    });
  }
  const boxes = regs.map(r => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="#0b1526" stroke="#1d3a5f" stroke-width="1"/><text x="${r.x + r.w / 2}" y="${r.y - 4}" fill="#40536f" font-size="7.5" text-anchor="middle" letter-spacing="1">${esc(r.name)}</text>`).join('');
  const svg = `<svg viewBox="0 0 592 362" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto">${lines}${boxes}${dots}</svg>`;
  const wrap = el(`<div class="panel"><div class="ph"><span class="t">GLOBAL INFRASTRUCTURE MAP</span><span class="sp dim small">secure layer view — no sensitive topology exposed</span></div><div class="pb" style="padding:8px">${svg}</div></div>`);
  $$('[data-node]', wrap).forEach(c => { c.addEventListener('click', () => openNodeModal(c.getAttribute('data-node'))); });
  return wrap;
}

// ---------------- COMMAND dashboard (§3/4/5/59/74) ----------------
async function renderCmd(main) {
  shell._active = 'cmd';
  main.innerHTML = '<div class="dim">Loading SENTINEL command data…</div>';
  try {
    const [status, exec, nodes, events, alerts, kpis] = await Promise.all([
      secApi('/status'), secApi('/executive'), secApi('/nodes'), secApi('/events'), secApi('/alerts'), secApi('/kpis'),
    ]);
    eventsCache = events.rows;
    const top = status.top, tl = status.threat, post = status.posture;
    const openCriticalAlerts = alerts.rows.filter(a => a.status === 'OPEN' && ['CRITICAL', 'HIGH'].includes(a.severity)).slice(0, 8);
    const kpiRow = Object.entries(kpis).map(([k, v]) => `<div class="stat-tile"><div class="v">${v.value}${v.unit === 'min' || v.unit === 'h' ? ' ' + v.unit : v.unit === '%' ? '%' : ''}</div><div class="l">${esc(v.label.toUpperCase())}</div></div>`).join('');

    main.innerHTML = '';
    // ---- TOP COMMAND BAR (§3) ----
    main.appendChild(el(`<div class="panel soc-topbar">
      <div class="soc-stat"><span class="ss-l">SYSTEM SECURITY</span><span class="ss-v ok">● ${esc(top.systemSecurity)}</span></div>
      <div class="soc-stat"><span class="ss-l">THREAT LEVEL</span><span class="ss-v ${tl.level === 'NORMAL' ? 'ok' : tl.level === 'GUARDED' ? 'warn' : tl.level === 'ELEVATED' ? 'warn' : 'bad'}">${esc(tl.level)}</span></div>
      <div class="soc-stat"><span class="ss-l">NODES</span><span class="ss-v ok">${top.nodesHealthy}% HEALTHY</span></div>
      <div class="soc-stat"><span class="ss-l">API HEALTH</span><span class="ss-v ok">${top.apiHealth}%</span></div>
      <div class="soc-stat"><span class="ss-l">ACTIVE INCIDENTS</span><span class="ss-v warn">${esc(top.activeIncidents)}</span></div>
      <div class="soc-stat"><span class="ss-l">CRITICAL VULNERABILITIES</span><span class="ss-v warn">${esc(top.criticalVulnerabilities)}</span></div>
      <div class="soc-stat"><span class="ss-l">SECURITY EVENTS</span><span class="ss-v">${esc(top.securityEvents)}</span></div>
      <div class="soc-stat"><span class="ss-l">LAST SCAN</span><span class="ss-v">${esc(top.lastScan)}</span></div>
    </div>`));

    // ---- POSTURE + THREAT + MAP row ----
    const postureColor = post.total >= 90 ? '#22c55e' : post.total >= 75 ? '#fbbf24' : '#ef4444';
    const posturePanel = el(`<div class="panel"><div class="ph"><span class="t">SECURITY POSTURE</span><span class="sp dim small">computed from 10 domains — no unexplained "AI score"</span></div>
      <div class="pb">
        <div class="row" style="justify-content:center">${donutChart({ segments: [{ label: 'score', value: post.total, color: postureColor }, { label: 'gap', value: 100 - post.total, color: '#1c2b45' }], w: 150, h: 150, centerLabel: 'SECURITY POSTURE', centerValue: post.total + '/100' })}</div>
        <div class="mt8">${post.domains.map(d => `<div class="hb" data-dom="${d.id}" style="cursor:pointer"><span class="k">${esc(d.label)}</span><div class="grow">${sbar(d.score, d.score >= 95 ? '#22c55e' : d.score >= 85 ? '#38bdf8' : d.score >= 70 ? '#fbbf24' : '#ef4444')}</div><span class="v">${d.score}%</span></div>`).join('')}</div>
        <div class="small dim mt8">${esc(post.basis)}</div>
      </div></div>`);
    $$('[data-dom]', posturePanel).forEach(hb => {
      hb.onclick = () => {
        const d = post.domains.find(x => x.id === hb.dataset.dom);
        modal({
          title: `POSTURE EVIDENCE — ${d.label}`,
          body: () => el(`<div class="small" style="line-height:1.8"><b style="color:#fff">Score: ${d.score}%</b><br>Weight in overall posture: ${Math.round(d.weight * 100)}%<br><br><b style="color:#fff">Underlying evidence (live records):</b><pre style="white-space:pre-wrap;font-family:var(--mono);font-size:11px;color:#7dd3fc;margin-top:6px">${esc(JSON.stringify(d.evidence, null, 2))}</pre><div class="dim mt8">Domain scores are computed from explicit rules over live telemetry and are always traceable to the records shown above.</div></div>`),
          actions: [{ label: 'Close', cls: 'ghost' }],
        });
      };
    });
    const threatPanel = el(`<div class="panel"><div class="ph"><span class="t">GLOBAL THREAT LEVEL</span><span class="sp dim small">explicit rules + analyst decisions</span></div>
      <div class="pb">
        <div class="soc-levels">${tl.levels.map(l => `<span class="sl ${l === tl.level ? 'on lvl-' + l.toLowerCase() : ''}">${esc(l)}</span>`).join('')}</div>
        <div class="small mt8" style="line-height:1.8">${(tl.basis || []).map(b => `• ${esc(b)}`).join('<br>')}</div>
        ${canPriv() ? `<div class="mt8 dim small">Analyst decision (privileged):<div class="row mt4"><select class="inp" id="tl-level" style="flex:1">${tl.levels.map(l => `<option ${l === tl.level ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn sm" id="tl-set">SET</button></div><input class="inp mt4" id="tl-reason" placeholder="Reason (required to LOWER the level)" style="width:100%"></div>` : ''}
      </div></div>`);
    const setBtn = $('#tl-set', threatPanel);
    if (setBtn) setBtn.onclick = async () => {
      const level = $('#tl-level', threatPanel).value, reason = $('#tl-reason', threatPanel).value.trim();
      try { const r = await API.post('/api/sentinel/threat-level', { level, reason }); toast('Threat level updated', `${level} — decision logged to audit.`); renderCmd(main); } catch (e) { toast('Override rejected', e.message, 'critical'); }
    };

    const mapPanel = secMap(nodes.rows);

    const gridA = el('<div class="grid32 mb12"></div>');
    gridA.appendChild(posturePanel);
    const right = el('<div style="display:flex;flex-direction:column;gap:12px"></div>');
    right.appendChild(threatPanel); right.appendChild(mapPanel);
    gridA.appendChild(right);
    main.appendChild(gridA);

    // ---- CRITICAL ALERTS + LIVE EVENTS + ATTENTION ----
    const alertPanel = el(`<div class="panel"><div class="ph"><span class="t">CRITICAL ALERTS</span><span class="sp dim small">${openCriticalAlerts.length} open</span></div><div class="pb">
      ${openCriticalAlerts.map(a => `<div class="row mb6" style="align-items:flex-start">
        <div style="flex:1"><div class="small" style="color:${SEC_SEV_COLOR[a.severity]};font-weight:700">${esc(a.title)}</div><div class="dim" style="font-size:10px">${esc(a.target)} · ${esc(a.category)} · ${fmtWatShort(a.createdAt)}</div></div>
        ${canRespond() && a.status === 'OPEN' ? `<button class="btn sm" data-ack="${a.id}">ACK</button>` : ''}
      </div>`).join('') || '<div class="dim small">No open CRITICAL/HIGH alerts</div>'}
    </div></div>`);
    $$('[data-ack]', alertPanel).forEach(b => b.onclick = async () => {
      await API.post('/api/sentinel/alerts/' + b.dataset.ack + '/ack', {});
      toast('Alert acknowledged', 'Logged to the security audit.');
      renderCmd(main);
    });

    const evPanel = el(`<div class="panel"><div class="ph"><span class="t">LIVE SECURITY EVENT STREAM</span><span class="sp dim small">click any event</span></div><div class="pb"><div class="feed" style="max-height:262px;overflow:auto">
      ${eventsCache.slice(0, 14).map(e => `<div class="item" data-ev="${e.id}" style="cursor:pointer"><span class="t">${fmtWatShort(e.createdAt)}</span><span class="tx">${secSev(e.severity)} ${esc(e.title)} <span class="dim">(${esc(e.source)})</span></span></div>`).join('')}
    </div></div></div>`);
    $$('[data-ev]', evPanel).forEach(it => it.onclick = () => {
      const e = eventsCache.find(x => x.id === it.dataset.ev);
      const m = modal({
        title: 'SECURITY EVENT',
        body: () => el(`<div class="small" style="line-height:1.8">
          <div class="row mb4"><b style="color:#fff">${esc(e.title)}</b>${secSev(e.severity)}<span class="pill">${esc(e.category)}</span></div>
          <div class="dim mb6">${esc(e.code)} · ${fmtWat(e.createdAt)}</div>
          <div>Source: <b>${esc(e.source)}</b></div><div class="dim">${esc(e.detail || '')}</div>
          ${canRespond() ? `<div class="row mt8"><button class="btn primary sm" id="mkcase">CREATE CASE FROM EVENT</button></div>` : ''}
        </div>`),
        actions: [{ label: 'Close', cls: 'ghost' }],
      });
      const mk = $('#mkcase', m.body);
      if (mk) mk.onclick = async () => {
        try {
          const r = await API.post('/api/sentinel/logs/create-case', { eventId: e.id });
          toast('Case created', r.case.code + ' opened in DETECTED state.');
          m.close();
        } catch (err) { toast('Could not create case', err.message, 'critical'); }
      };
    });

    const attPanel = el(`<div class="panel"><div class="ph"><span class="t">WHAT REQUIRES ATTENTION?</span><span class="sp dim small">top 5 only (§59)</span></div><div class="pb">
      ${exec.attention.slice(0, 5).map((a, i) => `<div class="row mb6"><span style="color:${a.sev === 'CRITICAL' ? '#ef4444' : a.sev === 'HIGH' ? '#f97316' : '#fbbf24'};font-weight:800">${i + 1}.</span><span class="small" style="flex:1">${esc(a.item)}</span></div>`).join('') || '<div class="dim small">No attention items</div>'}
      <div class="grid2 mt8" style="grid-template-columns:1fr 1fr">
        <div class="stat-tile"><div class="v">${exec.cards.activeThreats}</div><div class="l">ACTIVE THREATS</div></div>
        <div class="stat-tile ${exec.cards.evidenceIntegrity === 'INTACT' ? 'ok' : 'bad'}"><div class="v" style="font-size:14px">${esc(exec.cards.evidenceIntegrity)}</div><div class="l">EVIDENCE INTEGRITY</div></div>
        <div class="stat-tile"><div class="v">${exec.cards.systemAvailability}%</div><div class="l">SYSTEM AVAILABILITY</div></div>
        <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(exec.cards.backupHealth)}</div><div class="l">BACKUP HEALTH</div></div>
      </div>
    </div></div>`);

    const gridB = el('<div class="grid3 mb12"></div>');
    gridB.appendChild(alertPanel); gridB.appendChild(evPanel); gridB.appendChild(attPanel);
    main.appendChild(gridB);

    // ---- NODE HEALTH STRIP + KPIs + election-day mode ----
    const nodeStrip = el(`<div class="panel mb12"><div class="ph"><span class="t">INFRASTRUCTURE / SERVICE HEALTH</span><span class="sp dim small">click a node for the action centre</span></div>
      <div class="pb"><div class="row" style="flex-wrap:wrap">
        ${nodes.rows.map(n => `<span class="nodechip" data-node="${n.id}" style="cursor:pointer" title="${esc(n.hostname)} · CPU ${Math.round(n.cpu)}% · ${esc(n.status)}"><span class="nd" style="background:${SEC_NODE_COLOR[n.status] || '#64748b'}"></span>${esc(n.id.replace('NODE-', 'N'))}</span>`).join('')}
      </div>
      <div class="dim small mt8">${esc(nodes.kindSummary.healthy)} healthy · ${nodes.kindSummary.degraded} degraded · ${nodes.kindSummary.warning} warning · ${nodes.kindSummary.critical} critical · ${nodes.kindSummary.isolated} isolated · ${nodes.kindSummary.offline} offline</div>
    </div></div>`);
    $$('[data-node]', nodeStrip).forEach(c => c.onclick = () => openNodeModal(c.dataset.node));
    main.appendChild(nodeStrip);

    main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">SECURITY KPIs</span><span class="sp dim small">MTTD · MTTA · MTTC · MTTR · compliance (§56)</span></div><div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(4,1fr)">${kpiRow}</div></div></div>`));

    const edPanel = el(`<div class="panel mb12"><div class="ph"><span class="t">ELECTION DAY DEFENCE MODE (§69)</span><span class="sp dim small">${status.electionDay.active ? 'ACTIVE — priority order enforced' : 'STANDBY'}</span></div>
      <div class="pb"><div class="row" style="flex-wrap:wrap">
        ${status.electionDay.priorities.map((p, i) => `<span class="pill">P${i + 1}: ${esc(p)}</span>`).join('')}
        <span class="flex1"></span>
        ${canPriv() ? `<button class="btn sm" id="edm-toggle">${status.electionDay.active ? 'DEACTIVATE' : 'ACTIVATE'}</button>` : ''}
      </div></div></div>`);
    const edT = $('#edm-toggle', edPanel);
    if (edT) edT.onclick = async () => {
      const r = await API.post('/api/sentinel/election-mode', { enabled: !status.electionDay.active });
      toast('Election Day Defence Mode', r.electionDay ? 'ACTIVATED — priority order enforced' : 'deactivated');
      renderCmd(main);
    };
    main.appendChild(edPanel);

    // ---- copilot ----
    main.appendChild(copilotPanel());
  } catch (e) {
    main.innerHTML = `<div class="panel"><div class="pb" style="color:#f87171">Could not load SENTINEL command data: ${esc(e.message)}</div></div>`;
  }
}

// ---------------- WALL (§63/70) ----------------
async function renderWall(main) {
  shell._active = 'wall';
  main.innerHTML = '<div class="dim">Opening command wall…</div>';
  try {
    const [w, nodes] = await Promise.all([secApi('/wall'), secApi('/nodes')]);
    main.innerHTML = '';
    const wallEl = el(`<div class="soc-wall">
      <div class="sw-top">
        <div class="sw-brand"><span class="sw-dot"></span>SENTINEL SOC <small>SECURITY OPERATIONS CENTRE · ELECTION DAY</small></div>
        <div class="sw-protected">● PROTECTED</div>
        <div class="sw-clock" id="swclock">--:--:--</div>
      </div>
      <div class="sw-body">
        <div class="sw-left">
          <div class="sw-threat">
            <div class="dim">THREAT LEVEL</div>
            <div class="sw-big" style="color:${w.threatLevel === 'CRITICAL' ? '#ef4444' : w.threatLevel === 'NORMAL' ? '#22c55e' : '#fbbf24'}">${esc(w.threatLevel)}</div>
            <div class="dim small">ELECTION DAY DEFENCE MODE ${w.electionDay ? 'ACTIVE' : 'STANDBY'}</div>
          </div>
          <div class="sw-priorities">
            ${w.priorities.map((p, i) => `<div class="row"><b style="color:#7dd3fc">P${i + 1}</b><span class="small">${esc(p)}</span></div>`).join('')}
          </div>
        </div>
        <div class="sw-center">
          <div class="sw-bigstrip">
            <div class="sw-cell"><span class="v ok">${w.nodes}%</span><span class="l">NODES</span></div>
            <div class="sw-cell"><span class="v ok">${w.api}%</span><span class="l">API</span></div>
            <div class="sw-cell"><span class="v warn">${esc(w.activeIncidents)}</span><span class="l">ACTIVE INCIDENTS</span></div>
            <div class="sw-cell"><span class="v warn">${esc(w.criticalVulns)}</span><span class="l">CRITICAL VULNS</span></div>
            <div class="sw-cell"><span class="v ok">${esc(w.evidenceIntegrity)}</span><span class="l">EVIDENCE INTEGRITY</span></div>
            <div class="sw-cell"><span class="v ok">${esc(w.publicPlatform)}</span><span class="l">PUBLIC PLATFORM</span></div>
            <div class="sw-cell"><span class="v ok">${esc(w.irevWatchtower)}</span><span class="l">IReV WATCHTOWER</span></div>
          </div>
          <div class="sw-map" id="swmap"></div>
          <div class="sw-ticker">${w.eventTicker.map(e => `<span class="tick"><span class="tt">${esc((fmtWatShort(e.createdAt).split(',')[1] || '').trim())}</span> ${secSev(e.severity)} ${esc(e.title)}</span>`).join('')}</div>
        </div>
        <div class="sw-right">
          <div class="dim">CRITICAL ALERTS</div>
          ${w.criticalAlerts.map(a => `<div class="sw-alert ${a.severity === 'CRITICAL' ? 'crit' : 'high'}"><b>${esc(a.title)}</b><small>${esc(a.target)} · ${fmtWatShort(a.createdAt)}</small></div>`).join('') || '<div class="dim small">None</div>'}
        </div>
      </div>
      <div class="sw-footer">
        ${w.footer.nodes.map(n => `<span class="sf"><span class="nd" style="background:${SEC_NODE_COLOR[n.status] || '#64748b'}"></span>${esc(n.id.replace('NODE-', 'N'))}</span>`).join('')}
        <span class="sf-dim">· DATABASE ${esc(w.db)} · EVIDENCE ${esc(w.evidenceIntegrity)} · IReV ${esc(w.irevWatchtower)} · PUBLIC ${esc(w.publicPlatform)}</span>
      </div>
    </div>`);
    main.appendChild(wallEl);
    $('#swmap', wallEl).appendChild(secMap(nodes.rows));
    const ck = () => { const c = $('#swclock', wallEl); if (c) c.textContent = watClock(Date.now() + 3600 * 1000); };
    ck(); setInterval(ck, 1000);
  } catch (e) { main.innerHTML = `<div class="panel"><div class="pb" style="color:#f87171">Command wall unavailable: ${esc(e.message)}</div></div>`; }
}

// ---------------- TIMELINE (§60) ----------------
async function renderTimeline(main) {
  shell._active = 'timeline';
  main.innerHTML = '';
  main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">SECURITY ACTIVITY TIMELINE</span><span class="sp dim small">all significant events, chronological</span></div>
    <div class="pb"><div class="row mb8" style="flex-wrap:wrap">${['ALL', 'THREATS', 'INCIDENTS', 'VULNERABILITIES', 'INFRASTRUCTURE', 'API', 'IDENTITY', 'EVIDENCE'].map(f => `<button class="btn sm" data-f="${f}">${esc(f)}</button>`).join('')}</div><div id="tlb" class="feed"></div></div></div>`));
  const load = async (f) => {
    $('#tlb', main).innerHTML = '<div class="dim">Loading…</div>';
    const r = await secApi('/timeline' + (f !== 'ALL' ? '?filter=' + f : ''));
    $('#tlb', main).innerHTML = r.rows.map(x => `<div class="item"><span class="t">${fmtWatShort(x.at)}</span><span class="tx">${secSev(x.severity)} <b>${esc(x.title)}</b> <span class="dim">[${esc(x.kind)} · ${esc(x.target)}]</span></span></div>`).join('') || '<div class="dim">No events match this filter</div>';
  };
  $$('[data-f]', main).forEach(b => b.onclick = () => load(b.dataset.f));
  await load('ALL');
}

// ---------------- THREAT MONITOR (§23) ----------------
async function renderThreats(main) {
  shell._active = 'threats';
  main.innerHTML = '';
  try {
    const [status, events] = await Promise.all([secApi('/status'), secApi('/events')]);
    const tl = status.threat;
    main.appendChild(el(`<div class="grid3 mb12">
      <div class="panel"><div class="ph"><span class="t">THREAT LEVEL</span></div><div class="pb">
        <div class="soc-levels">${tl.levels.map(l => `<span class="sl ${l === tl.level ? 'on lvl-' + l.toLowerCase() : ''}">${esc(l)}</span>`).join('')}</div>
        <div class="small mt8" style="line-height:1.8">${(tl.basis || []).map(b => `• ${esc(b)}`).join('<br>')}</div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">DETECTION ENGINE</span></div><div class="pb small" style="line-height:1.8">
        <div>• Malicious IP reputation</div><div>• Suspicious domains</div><div>• Malware indicators</div><div>• Credential abuse & brute-force</div><div>• Bot activity</div><div>• Abnormal API activity</div><div>• Unauthorized access attempts</div><div>• Suspicious file changes</div>
        <div class="dim mt8">Threat intelligence is treated as a SIGNAL — never automatic proof.</div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">CORRELATION ENGINE (§25)</span></div><div class="pb small">
        ${[['HIGH-RISK SESSION', 'Failed Login + New Device + Unusual Location + Privileged Action', 'HIGH'], ['API ABUSE PATTERN', 'Rate-limit events + Auth failures + Same UA fingerprint', 'MEDIUM'], ['EVIDENCE ACCESS CLUSTER', 'Privileged export + Off-hours + Unusual volume', 'REVIEW']].map(([n, ch, v]) => `<div class="mb8" style="border-left:2px solid ${v === 'HIGH' ? '#ef4444' : v === 'MEDIUM' ? '#fbbf24' : '#38bdf8'};padding-left:8px"><b style="color:#fff">${esc(n)}</b><div class="dim" style="font-size:10.5px">${esc(ch)}</div><div class="small mt2">→ <b style="color:${v === 'HIGH' ? '#ef4444' : v === 'MEDIUM' ? '#fbbf24' : '#38bdf8'}">${esc(v)}</b></div></div>`).join('')}
      </div></div>
    </div>`));
    const tab = dataTable({
      cols: [
        { key: 'createdAt', label: 'TIME', render: r => `<span class="dim">${fmtWatShort(r.createdAt)}</span>` },
        { key: 'severity', label: 'SEV', render: r => secSev(r.severity) },
        { key: 'title', label: 'THREAT SIGNAL / EVENT', render: r => `<b>${esc(r.title)}</b>` },
        { key: 'source', label: 'SOURCE' },
        { key: 'category', label: 'CATEGORY', render: r => `<span class="pill">${esc(r.category)}</span>` },
      ],
      rows: events.rows.filter(e => ['HIGH', 'CRITICAL'].includes(e.severity)).slice(0, 60),
      pageSize: 12, emptyText: 'No high-severity signals',
    });
    tab.setTitle('ACTIVE THREAT SIGNALS (HIGH & CRITICAL)');
    main.appendChild(tab.el);
  } catch (e) { main.innerHTML = `<div class="dim" style="color:#f87171">${esc(e.message)}</div>`; }
}

// ---------------- THREAT INTELLIGENCE (§24) ----------------
async function renderIntel(main) {
  shell._active = 'intel';
  main.innerHTML = '';
  const intel = [
    { i: '185.220.101.34', t: 'MALICIOUS_IP', sev: 'HIGH', s: 'BLOCKED', n: 'Credential-stuffing source', e: 38 },
    { i: '91.240.118.0/24', t: 'SUSPICIOUS_NETWORK', sev: 'MEDIUM', s: 'UNDER_INVESTIGATION', n: 'Unusual geographic access pattern', e: 12 },
    { i: 'ev2027-login-check.top', t: 'SUSPICIOUS_DOMAIN', sev: 'HIGH', s: 'BLOCKED', n: 'Lookalike domain', e: 9 },
    { i: 'sha256:9f4e…b12a', t: 'MALWARE_INDICATOR', sev: 'MEDIUM', s: 'ACTIVE', n: 'Match on video node — being verified', e: 2 },
    { i: 'ua:BOT/0.9 (legacy-crawler)', t: 'BOT_ACTIVITY', sev: 'LOW', s: 'RESOLVED', n: 'Rate-limited legacy crawler', e: 210 },
    { i: '103.5.140.9', t: 'FALSE_POSITIVE', sev: 'LOW', s: 'FALSE_POSITIVE', n: 'Verified staff VPN egress', e: 4 },
  ];
  const counts = { active: intel.filter(x => ['ACTIVE', 'UNDER_INVESTIGATION'].includes(x.s)).length, newI: 3, blocked: intel.filter(x => x.s === 'BLOCKED').length, under: intel.filter(x => x.s === 'UNDER_INVESTIGATION').length, fp: intel.filter(x => x.s === 'FALSE_POSITIVE').length, resolved: intel.filter(x => x.s === 'RESOLVED').length };
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">THREAT INTELLIGENCE DASHBOARD</span><span class="sp dim small">signals, not proof</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(6,1fr)">
      <div class="stat-tile warn"><div class="v">${counts.active}</div><div class="l">ACTIVE THREATS</div></div>
      <div class="stat-tile"><div class="v">${counts.newI}</div><div class="l">NEW INDICATORS</div></div>
      <div class="stat-tile ok"><div class="v">${counts.blocked}</div><div class="l">BLOCKED EVENTS</div></div>
      <div class="stat-tile warn"><div class="v">${counts.under}</div><div class="l">UNDER INVESTIGATION</div></div>
      <div class="stat-tile"><div class="v">${counts.fp}</div><div class="l">FALSE POSITIVES</div></div>
      <div class="stat-tile ok"><div class="v">${counts.resolved}</div><div class="l">RESOLVED</div></div>
    </div></div></div>`));
  const tab = dataTable({
    cols: [
      { key: 'i', label: 'INDICATOR', render: r => `<b style="font-family:var(--mono)">${esc(r.i)}</b>` },
      { key: 't', label: 'TYPE', render: r => `<span class="pill">${esc(r.t)}</span>` },
      { key: 'sev', label: 'SEVERITY', render: r => secSev(r.sev) },
      { key: 's', label: 'STATUS', render: r => `<span class="badge ${r.s === 'BLOCKED' ? 's-verified' : r.s === 'ACTIVE' ? 'l4' : r.s === 'UNDER_INVESTIGATION' ? 's-under' : r.s === 'RESOLVED' ? 's-archived' : 's-submitted'}"><span class="dot"></span>${esc(r.s)}</span>` },
      { key: 'n', label: 'NOTE' },
      { key: 'e', label: 'EVENTS', render: r => `<b>${r.e}</b>` },
    ],
    rows: intel, emptyText: 'No indicators',
  });
  tab.setTitle('INDICATOR REGISTER');
  main.appendChild(tab.el);
}

// ---------------- DETECTION RULES (§46) ----------------
async function renderRules(main) {
  shell._active = 'rules';
  main.innerHTML = '';
  const d = await secApi('/automation');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">AUTOMATED DEFENCE</span><span class="sp dim small">every automated action is logged · approval gates protect high-risk actions</span></div>
    <div class="pb small" style="line-height:1.7">Controlled defensive rules only. No automated rule can take down election-monitoring infrastructure without human authorization (§73).</div></div>`));
  main.appendChild(el(`<div class="grid2">${d.rules.map(r => `<div class="panel"><div class="ph"><span class="t">${esc(r.id)} · ${esc(r.name)}</span><span class="sp">${r.enabled ? '<span class="badge s-verified"><span class="dot"></span>ENABLED</span>' : '<span class="badge s-archived"><span class="dot"></span>DISABLED</span>'}</span></div>
    <div class="pb small" style="line-height:1.7">
      <div><b style="color:#7dd3fc">IF</b> ${esc(r.when)}</div>
      <div><b style="color:#fbbf24">THEN</b> ${r.then.map(t => `<span class="pill">${esc(t)}</span>`).join(' ')}</div>
      <div class="dim mt6">Runs: ${r.runs} · Last run: ${r.lastRun ? fmtWatShort(r.lastRun) : 'never'}</div>
      ${canPriv() ? `<div class="row mt8"><button class="btn sm" data-tog="${r.id}">${r.enabled ? 'DISABLE' : 'ENABLE'}</button></div>` : ''}
    </div></div>`).join('')}</div>`));
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">AUTOMATION AUDIT TRAIL</span></div><div class="pb"><div class="feed" style="max-height:220px">${d.auditTail.map(a => `<div class="item"><span class="t">${fmtWatShort(a.at)}</span><span class="tx"><b>${esc(a.what)}</b> — ${esc(a.result || '')}</span></div>`).join('') || '<div class="dim small">No automated actions yet</div>'}</div></div></div>`));
  $$('[data-tog]', main).forEach(b => b.onclick = async () => {
    await API.post('/api/sentinel/automation/' + b.dataset.tog + '/toggle', {});
    toast('Rule updated', 'Change logged to the immutable audit.');
    renderRules(main);
  });
}

// ---------------- ACTIVE INCIDENTS (§20) ----------------
async function renderIncidents(main) {
  shell._active = 'incidents';
  main.innerHTML = '';
  const d = await secApi('/incidents');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">SECURITY INCIDENT COMMAND</span><span class="sp dim small">${d.openCount} open</span></div>
    <div class="pb"><div class="row" style="flex-wrap:wrap">${d.flow.map(f => `<span class="pill">${esc(f)}</span>`).join('')}</div></div></div>`));
  const tab = dataTable({
    cols: [
      { key: 'code', label: 'CASE', render: r => `<b style="color:#fbbf24;font-family:var(--mono)">${esc(r.code)}</b>` },
      { key: 'title', label: 'TITLE', render: r => `<b>${esc(r.title)}</b>` },
      { key: 'severity', label: 'SEV', render: r => secSev(r.severity) },
      { key: 'category', label: 'CATEGORY', render: r => `<span class="pill">${esc(r.category)}</span>` },
      { key: 'status', label: 'STATUS', render: r => `<span class="badge ${r.status === 'CLOSED' ? 's-archived' : r.status === 'DETECTED' ? 's-rejected' : 's-under'}"><span class="dot"></span>${esc(r.status)}</span>` },
      { key: 'affectedService', label: 'AFFECTED' },
      { key: 'analyst', label: 'ANALYST', render: r => esc(r.analyst || 'unassigned') },
      { key: 'detectedAt', label: 'DETECTED', render: r => `<span class="dim">${fmtWatShort(r.detectedAt)}</span>` },
    ],
    rows: d.rows, pageSize: 15, emptyText: 'No security cases',
    onRow: (r) => openCaseModal(r.id),
  });
  tab.setTitle('SECURITY CASES — click a row for the incident workspace');
  main.appendChild(tab.el);
}

// ---------------- CASE MANAGEMENT (§52) ----------------
async function renderCases(main) {
  shell._active = 'cases';
  main.innerHTML = '';
  const d = await secApi('/incidents');
  const active = d.rows.filter(r => r.status !== 'CLOSED');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">CASE MANAGEMENT — INCIDENT RESPONSE WORKSPACE</span><span class="sp dim small">Summary · Timeline · Assets · Alerts · Evidence · Related events · Actions · Communications · Approvals · Recovery · Post-incident review</span></div>
    <div class="pb"><div class="row" style="flex-wrap:wrap">${active.map(r => `<button class="btn sm" data-case="${r.id}"><b>${esc(r.code)}</b> · ${esc(r.title.slice(0, 40))}${r.title.length > 40 ? '…' : ''}</button>`).join('') || '<span class="dim">No open cases</span>'}</div></div></div>`));
  $$('[data-case]', main).forEach(b => b.onclick = () => openCaseModal(b.dataset.case));
  if (active.length) await openCaseModal(active[0].id);
}

// ---------------- PLAYBOOKS (§51) ----------------
async function renderPlaybooks(main) {
  shell._active = 'playbooks';
  main.innerHTML = '';
  const d = await secApi('/playbooks');
  main.appendChild(el(`<div class="grid2">${d.playbooks.map(p => `<div class="panel"><div class="ph"><span class="t">${p.icon} ${esc(p.name)}</span><span class="sp">${canRespond() ? `<button class="btn sm" data-pb="${p.id}">ACTIVATE</button>` : ''}</span></div>
    <div class="pb small"><ol style="margin:0 0 0 16px;line-height:1.7">${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div></div>`).join('')}</div>`));
  $$('[data-pb]', main).forEach(b => b.onclick = async () => {
    try {
      const r = await API.post('/api/sentinel/playbooks/' + b.dataset.pb + '/activate', { target: 'TBD' });
      toast('Playbook activated', `${r.case.code} opened — runbook steps attached.`);
      openCaseModal(r.case.id);
    } catch (e) { toast('Activation failed', e.message, 'critical'); }
  });
}

// ---------------- NODES (§7) ----------------
async function renderNodes(main) {
  shell._active = 'nodes';
  main.innerHTML = '';
  const d = await secApi('/nodes');
  const tab = dataTable({
    cols: [
      { key: 'id', label: 'NODE', render: r => `<b style="font-family:var(--mono)">${esc(r.id)}</b><div class="dim" style="font-size:9.5px">${esc(r.hostname)}</div>` },
      { key: 'status', label: 'STATUS', render: r => secBadge(r.status) },
      { key: 'cpu', label: 'CPU', render: r => `<div style="min-width:70px">${sbar(r.cpu, r.cpu > 80 ? '#ef4444' : r.cpu > 60 ? '#fbbf24' : '#38bdf8')}<span class="dim" style="font-size:9.5px">${Math.round(r.cpu)}%</span></div>` },
      { key: 'memory', label: 'RAM', render: r => `<div style="min-width:70px">${sbar(r.memory, '#38bdf8')}<span class="dim" style="font-size:9.5px">${Math.round(r.memory)}%</span></div>` },
      { key: 'disk', label: 'DISK', render: r => `<div style="min-width:70px">${sbar(r.disk, '#38bdf8')}<span class="dim" style="font-size:9.5px">${Math.round(r.disk)}%</span></div>` },
      { key: 'securityAgent', label: 'SECURITY AGENT', render: r => `<span class="badge ${r.securityAgent === 'ACTIVE' ? 's-verified' : 'l5'}"><span class="dot"></span>${esc(r.securityAgent)}</span>` },
      { key: 'patchStatus', label: 'PATCH', render: r => `<span class="dim">${esc((r.patchStatus || '').replace(/_/g, ' '))}</span>` },
      { key: 'lastCheck', label: 'LAST CHECK', render: r => `<span class="dim">${fmtWatShort(r.lastCheck)}</span>` },
    ],
    rows: d.rows, pageSize: 20, emptyText: 'No nodes',
    onRow: (r) => openNodeModal(r.id),
  });
  tab.setTitle(`INFRASTRUCTURE NODES (${d.total}) — click a row for node detail & action centre`);
  main.appendChild(tab.el);
}

// ---------------- NETWORK (§40/41) ----------------
async function renderNetwork(main) {
  shell._active = 'network';
  main.innerHTML = '';
  const d = await secApi('/network');
  main.appendChild(el(`<div class="grid3 mb12">
    <div class="stat-tile ok"><div class="v" style="font-size:15px">${esc(d.connectivity)}</div><div class="l">CONNECTIVITY</div></div>
    <div class="stat-tile ok"><div class="v" style="font-size:15px">${esc(d.dnsHealth)}</div><div class="l">DNS HEALTH</div></div>
    <div class="stat-tile ${d.unusualConnections ? 'warn' : 'ok'}"><div class="v">${d.unusualConnections}</div><div class="l">UNUSUAL CONNECTION PATTERNS</div></div>
  </div>`));
  const tls = dataTable({
    cols: [
      { key: 'domain', label: 'DOMAIN', render: r => `<b style="font-family:var(--mono)">${esc(r.domain)}</b>` },
      { key: 'issuer', label: 'ISSUER' },
      { key: 'expiry', label: 'EXPIRES', render: r => `${fmtWat(r.expiry).slice(0, 10)} <span class="dim">(${Math.max(0, Math.round((r.expiry - Date.now()) / 86400000))}d)</span>` },
      { key: 'status', label: 'STATUS', render: r => r.status === 'EXPIRING_SOON' ? '<span class="badge l4"><span class="dot"></span>⚠ CERTIFICATE EXPIRING IN 14 DAYS</span>' : '<span class="badge s-verified"><span class="dot"></span>VALID</span>' },
    ],
    rows: d.tls, emptyText: 'No certificates',
  });
  tls.setTitle('TLS / CERTIFICATE MONITOR (§41)');
  main.appendChild(tls.el);
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">FIREWALL EVENTS</span></div><div class="pb"><div class="feed" style="max-height:200px">${d.firewallEvents.map(f => `<div class="item"><span class="t">${fmtWatShort(f.at)}</span><span class="tx">${secSev(f.severity)} ${esc(f.text)} — ${esc(f.status)}</span></div>`).join('')}</div></div></div>`));
}

// ---------------- AVAILABILITY (§39) ----------------
async function renderAvailability(main) {
  shell._active = 'availability';
  main.innerHTML = '';
  const d = await secApi('/public');
  const series = (d.trafficSeries || []).map(x => x.rps);
  main.appendChild(el(`<div class="grid3 mb12">
    <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(d.cdnStatus)}</div><div class="l">CDN STATUS</div></div>
    <div class="stat-tile ok"><div class="v">${d.availability}%</div><div class="l">PUBLIC AVAILABILITY</div></div>
    <div class="stat-tile ${d.ddosIndicators ? 'bad' : 'ok'}"><div class="v">${d.ddosIndicators}</div><div class="l">DDoS INDICATORS</div></div>
  </div>`));
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">AVAILABILITY DEFENCE</span><span class="sp dim small">traffic spikes · request distribution · origin load · CDN · API saturation · connection exhaustion</span></div>
    <div class="pb">${series.length ? lineChart({ series: [{ data: series, color: '#38bdf8' }], labels: (d.trafficSeries || []).map(x => fmtWatShort(x.at)), w: 640, h: 170, yFmt: (v) => v + '/s' }) : '<div class="dim">No traffic series'}</div></div>`));
  main.appendChild(el(`<div class="grid2">
    <div class="panel"><div class="ph"><span class="t">WAF COMMAND (§38)</span></div><div class="pb">
      <div class="stat-tiles">
        <div class="stat-tile"><div class="v">${fmtN(d.requests)}</div><div class="l">REQUESTS</div></div>
        <div class="stat-tile bad"><div class="v">${fmtN(d.blocked)}</div><div class="l">BLOCKED</div></div>
        <div class="stat-tile warn"><div class="v">${fmtN(d.challenged)}</div><div class="l">CHALLENGED</div></div>
        <div class="stat-tile warn"><div class="v">${fmtN(d.rateLimited)}</div><div class="l">RATE LIMITED</div></div>
        <div class="stat-tile ok"><div class="v">${fmtN(d.allowed)}</div><div class="l">ALLOWED</div></div>
        <div class="stat-tile"><div class="v">${fmtN(d.botActivity)}</div><div class="l">BOT ACTIVITY</div></div>
      </div>
    </div></div>
    <div class="panel"><div class="ph"><span class="t">BLOCKED TRAFFIC CATEGORIES</span></div><div class="pb">
      ${barChart({ data: d.wafCategories.map(c => c.value), labels: d.wafCategories.map(c => c.label), w: 420, h: 170, colorFn: (v, i) => ['#ef4444', '#f97316', '#fbbf24', '#38bdf8'][i % 4] })}
      <div class="small dim mt8">${(d.rateLimitSources || []).map(s => `Rate-limited source ${esc(s.source)} (${s.minutes} min, by ${esc(s.by)})`).join('<br>') || 'No active source blocks'}</div>
    </div></div>
  </div>`));
}

// ---------------- API MONITOR (§10/11/12/13) ----------------
async function renderApis(main) {
  shell._active = 'apis';
  main.innerHTML = '';
  const d = await secApi('/apis');
  main.appendChild(el(`<div class="grid3 mb12">
    <div class="stat-tile"><div class="v">${d.rateLimit.requestsPerSec}</div><div class="l">REQUESTS / SECOND LIMIT</div></div>
    <div class="stat-tile warn"><div class="v">${d.rows.reduce((a, x) => a + x.rateLimitEvents, 0)}</div><div class="l">RATE-LIMIT EVENTS</div></div>
    <div class="stat-tile warn"><div class="v">${d.rows.reduce((a, x) => a + x.authFailures, 0)}</div><div class="l">AUTHENTICATION FAILURES</div></div>
  </div>`));
  if (d.anomalies.length) {
    main.appendChild(el(`<div class="alert-strip">${d.anomalies.map(a => `<div class="a"><b>⚠ ANOMALY DETECTED — ${esc(a.api)}</b>: ${a.reasons.map(r => esc(r.kind) + ' (' + esc(r.evidence) + ')').join(' · ')}</div>`).join('')}</div>`));
  }
  const tab = dataTable({
    cols: [
      { key: 'id', label: 'API', render: r => `<b style="font-family:var(--mono)">${esc(r.id)}</b><div class="dim" style="font-size:9.5px">${esc(r.name)}</div>` },
      { key: 'requests', label: 'REQUESTS', render: r => fmtN(r.requests) },
      { key: 'requestsPerSec', label: 'REQ/S', render: r => `${Math.round(r.requestsPerSec)}/s` },
      { key: 'errors', label: 'ERRORS', render: r => `<span class="${r.errorRate > 1 ? 'bad' : ''}">${r.errors} (${r.errorRate}%)</span>` },
      { key: 'latencyMs', label: 'LATENCY', render: r => `${Math.round(r.latencyMs)}ms` },
      { key: 'authFailures', label: 'AUTH FAIL', render: r => `<span style="color:${r.authFailures > 30 ? '#f87171' : 'inherit'}">${r.authFailures}</span>` },
      { key: 'rateLimitEvents', label: 'RATE-LIMIT', render: r => r.rateLimitEvents || '—' },
      { key: 'threats', label: 'THREATS', render: r => r.threats ? `<span style="color:#f97316;font-weight:700">${r.threats}</span>` : '0' },
      { key: 'status', label: 'STATUS', render: r => secBadge(r.status) },
    ],
    rows: d.rows, pageSize: 15, emptyText: 'No APIs',
  });
  tab.setTitle('API SECURITY CENTRE (§10) — request volume · errors · latency · auth failures · rate limits · threats');
  main.appendChild(tab.el);
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">API COMMUNICATION MAP (§11)</span><span class="sp dim small">live service relationships — no credentials or tokens exposed</span></div>
    <div class="pb" style="padding:10px"><svg viewBox="0 0 640 160" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto">
      <rect x="8" y="56" width="120" height="34" rx="6" fill="#0b1526" stroke="#1d3a5f"/><text x="68" y="77" fill="#8ba0bd" font-size="10" text-anchor="middle">AGENT APP</text>
      <rect x="240" y="56" width="130" height="34" rx="6" fill="#0e2440" stroke="#38bdf8"/><text x="305" y="77" fill="#7dd3fc" font-size="10" text-anchor="middle">API GATEWAY</text>
      ${['Authentication', 'Results API', 'Incident API', 'Evidence API', 'Notification API'].map((s, i) => `<rect x="470" y="${16 + i * 28}" width="150" height="22" rx="5" fill="#0b1526" stroke="#1d3a5f"/><text x="545" y="${31 + i * 28}" fill="#8ba0bd" font-size="9" text-anchor="middle">${s}</text>`).join('')}
      <line x1="128" y1="73" x2="238" y2="73" stroke="#1d6fa8" stroke-width="1.4"/><line x1="370" y1="73" x2="468" y2="73" stroke="#1d6fa8" stroke-width="1.4"/>
      <line x1="240" y1="90" x2="370" y2="90" stroke="#1d6fa8" stroke-width="1" stroke-dasharray="3,3"/>
    </svg>
    <div class="small dim mt8">Service-to-service communication is monitored for anomalies. All traffic is authenticated; secrets are never rendered.</div></div></div>`));
  if (canRespond()) {
    const rl = el(`<div class="panel mt12"><div class="ph"><span class="t">API RATE-LIMIT COMMAND (§13)</span><span class="sp dim small">privileged changes require authorization & audit</span></div>
      <div class="pb"><div class="row" style="flex-wrap:wrap">
        <button class="btn sm" data-rl="adjust">⚙ Adjust rate limit</button>
        <button class="btn sm" data-rl="block">⛔ Temporarily block a source</button>
        <button class="btn sm" data-rl="reauth">🔑 Require re-authentication</button>
        <button class="btn sm" data-rl="protect">🛡 Increase protection level</button>
        <button class="btn sm" data-rl="maintenance">🚧 Enable maintenance mode</button>
      </div>
      <div class="small dim mt8">Protection level: ${esc(d.rateLimit.protectionLevel)}${d.rateLimit.maintenanceMode ? ' · MAINTENANCE MODE ON' : ''}</div></div></div>`);
    $$('[data-rl]', rl).forEach(b => b.onclick = () => {
      const mapAct = { adjust: ['ADJUST_RATE_LIMIT', 'API-GATEWAY'], block: ['RATE_LIMIT_SOURCE', 'SOURCE'], reauth: ['POLICY_OVERRIDE', 'API-GATEWAY'], protect: ['ADJUST_RATE_LIMIT', 'API-GATEWAY'], maintenance: ['ENABLE_MAINTENANCE', 'API-GATEWAY'] };
      requestActionModal(mapAct[b.dataset.rl][0], mapAct[b.dataset.rl][1]);
    });
    main.appendChild(rl);
  }
}

// ---------------- IDENTITY (§14/15) ----------------
async function renderIdentity(main) {
  shell._active = 'identity';
  main.innerHTML = '';
  const m = await secApi('/identity');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">IDENTITY SECURITY</span><span class="sp dim small">MFA coverage ${m.mfaCoverage}% · platform sessions ${m.activePlatformSessions}</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-tile"><div class="v">${fmtN(m.loginAttempts)}</div><div class="l">LOGIN ATTEMPTS</div></div>
      <div class="stat-tile ${m.failedLogins > 30 ? 'bad' : 'ok'}"><div class="v">${m.failedLogins}</div><div class="l">FAILED LOGINS</div></div>
      <div class="stat-tile"><div class="v">${fmtN(m.mfaEvents)}</div><div class="l">MFA EVENTS</div></div>
      <div class="stat-tile"><div class="v">${m.passwordResets}</div><div class="l">PASSWORD RESETS</div></div>
      <div class="stat-tile"><div class="v">${m.newDevices}</div><div class="l">NEW DEVICES</div></div>
      <div class="stat-tile"><div class="v">${m.sessionsCreated}</div><div class="l">SESSIONS CREATED</div></div>
      <div class="stat-tile"><div class="v">${m.sessionsTerminated}</div><div class="l">SESSIONS TERMINATED</div></div>
      <div class="stat-tile"><div class="v">${m.privilegeChanges}</div><div class="l">PRIVILEGE CHANGES</div></div>
      <div class="stat-tile warn"><div class="v">${m.suspiciousSessions}</div><div class="l">SUSPICIOUS SESSIONS</div></div>
      <div class="stat-tile"><div class="v">${m.dormantAccounts}</div><div class="l">DORMANT ACCOUNTS</div></div>
    </div></div></div>`));
  const tab = dataTable({
    cols: [
      { key: 'user', label: 'USER', render: r => `<b>${esc(r.user)}</b>` },
      { key: 'role', label: 'ROLE' },
      { key: 'loginAt', label: 'LOGIN TIME', render: r => `<span class="dim">${fmtWatShort(r.loginAt)}</span>` },
      { key: 'device', label: 'DEVICE' },
      { key: 'ip', label: 'IP / NETWORK', render: r => `<span style="font-family:var(--mono)">${esc(r.ip)}</span>` },
      { key: 'privilegedActions', label: 'PRIV ACTIONS', render: r => `<b>${r.privilegedActions}</b>` },
      { key: 'riskStatus', label: 'RISK STATUS', render: r => `<span class="badge ${r.riskStatus === 'NORMAL' ? 's-verified' : 'l4'}"><span class="dot"></span>${esc(r.riskStatus)}</span>${r.riskNote ? `<div class="dim" style="font-size:9.5px">${esc(r.riskNote)}</div>` : ''}` },
      { key: 'active', label: 'CURRENT', render: r => r.active ? '<span class="badge live"><span class="dot"></span>LIVE</span>' : '<span class="dim">—</span>' },
      { key: '_act', label: '', render: r => canRespond() && r.active && r.riskStatus !== 'NORMAL' ? `<button class="btn sm" data-term="${r.id}">TERMINATE</button>` : '' },
    ],
    rows: m.sessions, emptyText: 'No sessions',
  });
  tab.setTitle('PRIVILEGED ACCESS MONITORING (§15)');
  main.appendChild(tab.el);
  $$('[data-term]', main).forEach(b => b.onclick = async () => {
    confirmBox('Terminate session', 'This disables the compromised session and forces re-authentication. Requires authorization and is written to the audit.', async () => {
      await API.post('/api/sentinel/sessions/' + b.dataset.term + '/terminate', {});
      toast('Session disabled', 'Audited. The user must re-authenticate.');
      renderIdentity(main);
    }, 'TERMINATE');
  });
  const ser = (m.series || []).map(x => x.failures);
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">AUTHENTICATION FAILURES — 24H</span></div><div class="pb">${ser.length ? lineChart({ series: [{ data: ser, color: '#f97316' }], labels: (m.series || []).map(x => (fmtWatShort(x.at).split(',')[1] || '').trim()), w: 640, h: 150 }) : '<div class="dim">No series'}</div></div>`));
}

// ---------------- VULNERABILITY CENTRE (§26/27/28) ----------------
async function renderVulns(main) {
  shell._active = 'vulns';
  main.innerHTML = '';
  const d = await secApi('/vulns');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">VULNERABILITY CENTRE</span><span class="sp dim small">servers · applications · APIs · dependencies · containers · databases · network devices · endpoints</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-tile bad"><div class="v">${String(d.totals.critical).padStart(2, '0')}</div><div class="l">CRITICAL</div></div>
      <div class="stat-tile warn"><div class="v">${d.totals.high}</div><div class="l">HIGH</div></div>
      <div class="stat-tile"><div class="v">${d.totals.medium}</div><div class="l">MEDIUM</div></div>
      <div class="stat-tile"><div class="v">${d.totals.low}</div><div class="l">LOW</div></div>
      <div class="stat-tile ok"><div class="v">${d.totals.patched}</div><div class="l">PATCHED</div></div>
    </div></div></div>`));
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">VULNERABILITIES OVER TIME</span></div><div class="pb">${lineChart({ series: [{ data: d.scanHistory.map(x => x.open), color: '#fbbf24' }], labels: d.scanHistory.map(x => fmtWatShort(x.at)), w: 640, h: 150 })}</div></div>`));
  const tab = dataTable({
    cols: [
      { key: 'cve', label: 'CVE / IDENTIFIER', render: r => `<b style="font-family:var(--mono)">${esc(r.cve)}</b>` },
      { key: 'asset', label: 'ASSET', render: r => `<span style="font-family:var(--mono)">${esc(r.asset)}</span>` },
      { key: 'component', label: 'AFFECTED COMPONENT' },
      { key: 'severity', label: 'SEVERITY', render: r => secSev(r.severity) },
      { key: 'detectedAt', label: 'DETECTED', render: r => `<span class="dim">${fmtWatShort(r.detectedAt)}</span>` },
      { key: 'fix', label: 'AVAILABLE FIX' },
      { key: 'owner', label: 'OWNER' },
      { key: 'deadline', label: 'DEADLINE', render: r => `<span class="${r.deadline < Date.now() && r.status === 'OPEN' ? 'bad' : 'dim'}">${fmtWat(r.deadline).slice(0, 10)}${r.deadline < Date.now() && r.status === 'OPEN' ? ' (OVERDUE)' : ''}</span>` },
      { key: 'status', label: 'STATUS', render: r => `<span class="badge ${r.status === 'OPEN' ? (r.severity === 'CRITICAL' ? 'l5' : 's-under') : r.status === 'PATCHED' ? 's-verified' : r.status === 'ACCEPTED_RISK' ? 's-submitted' : 's-under'}"><span class="dot"></span>${esc(r.status)}</span>` },
      { key: '_act', label: '', render: r => canRespond() && r.status === 'OPEN' ? `<button class="btn sm" data-v="${r.id}">UPDATE</button>` : '' },
    ],
    rows: d.rows, pageSize: 10, emptyText: 'No vulnerabilities',
  });
  tab.setTitle('VULNERABILITY REGISTER — click UPDATE to patch, accept risk or track progress');
  main.appendChild(tab.el);
  $$('[data-v]', main).forEach(b => b.onclick = () => {
    const v = d.rows.find(x => x.id === b.dataset.v);
    const m = modal({
      title: `VULNERABILITY DETAIL — ${v.cve}`,
      body: () => el(`<div class="small" style="line-height:1.9">
        <div class="row mb4">${secSev(v.severity)} <span class="pill">${esc(v.asset)}</span> <span class="pill">CVSS ${v.cvss}</span></div>
        <div><b>Component:</b> ${esc(v.component)}</div>
        <div><b>Detected:</b> ${fmtWat(v.detectedAt)}</div>
        <div><b>Available fix:</b> ${esc(v.fix)}</div>
        <div><b>Owner:</b> ${esc(v.owner)}</div>
        <div><b>Deadline:</b> ${fmtWat(v.deadline).slice(0, 10)}</div>
        <div><b>Evidence:</b> ${esc(v.evidence)}</div>
        <div><b>Risk acceptance:</b> ${esc(v.riskAcceptance || '—')}</div>
        <label class="fl mt8">New status</label>
        <select class="inp" id="vst" style="width:100%">${['OPEN', 'IN_PROGRESS', 'PATCHED', 'ACCEPTED_RISK'].map(s => `<option ${s === v.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input class="inp mt4" id="vra" placeholder="Risk acceptance justification (for ACCEPTED_RISK)" style="width:100%">
      </div>`),
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'SAVE STATUS', cls: 'primary', onClick: async () => {
          await API.post('/api/sentinel/vulns/' + v.id + '/status', { status: $('#vst', m.body).value, riskAcceptance: $('#vra', m.body).value });
          toast('Vulnerability updated', v.cve + ' status changed — audited.');
          m.close(); renderVulns(main);
        } },
      ],
    });
  });
}

// ---------------- PATCH MANAGEMENT (§29) ----------------
async function renderPatches(main) {
  shell._active = 'patches';
  main.innerHTML = '';
  const d = await secApi('/patches');
  const tab = dataTable({
    cols: [
      { key: 'id', label: 'ID', render: r => `<b style="font-family:var(--mono)">${esc(r.id)}</b>` },
      { key: 'name', label: 'PATCH' },
      { key: 'target', label: 'TARGET' },
      { key: 'severity', label: 'SEV', render: r => secSev(r.severity) },
      { key: 'maintenanceWindow', label: 'MAINTENANCE WINDOW' },
      { key: 'rebootRequired', label: 'REBOOT', render: r => r.rebootRequired ? '<span class="badge l4"><span class="dot"></span>REQUIRED</span>' : '<span class="dim">—</span>' },
      { key: 'status', label: 'STATUS', render: r => `<span class="badge ${r.status === 'INSTALLED' ? 's-verified' : r.status === 'FAILED' ? 'l5' : r.status === 'IN_PROGRESS' ? 's-under' : 's-submitted'}"><span class="dot"></span>${esc(r.status)}</span>${r.failReason ? `<div class="dim" style="font-size:9.5px">${esc(r.failReason)}</div>` : ''}` },
      { key: '_act', label: 'ACTIONS', render: r => canRespond() ? `<div class="row">${[['schedule', 'SCHEDULE'], ['approve', 'APPROVE'], ['rollback', 'ROLLBACK'], ['verify', 'VERIFY']].map(([a, l]) => `<button class="btn sm" data-pa="${a}" data-pid="${r.id}">${l}</button>`).join('')}</div>` : '' },
    ],
    rows: d.rows, emptyText: 'No patches',
  });
  tab.setTitle(`PATCH COMMAND — pending ${d.counts.pending} · scheduled ${d.counts.scheduled} · in progress ${d.counts.inProgress} · installed ${d.counts.installed} · failed ${d.counts.failed}`);
  main.appendChild(tab.el);
  $$('[data-pa]', main).forEach(b => b.onclick = async () => {
    try {
      await API.post('/api/sentinel/patches/' + b.dataset.pid + '/action', { action: b.dataset.pa });
      toast('Patch action applied', b.dataset.pa.toUpperCase() + ' — audited.');
      renderPatches(main);
    } catch (e) { toast('Failed', e.message, 'critical'); }
  });
}

// ---------------- CONFIGURATION DRIFT + FIM (§30/31) ----------------
async function renderDrift(main) {
  shell._active = 'drift';
  main.innerHTML = '';
  const d = await secApi('/config');
  main.appendChild(el(`<div class="grid2 mb12">${d.drift.map(x => `<div class="panel ${x.suspicious ? 'soc-panel-warn' : ''}"><div class="ph"><span class="t">${x.suspicious ? '⚠ ' : ''}CONFIGURATION CHANGE DETECTED</span><span class="sp">${x.status === 'APPROVED' ? '<span class="badge s-verified"><span class="dot"></span>APPROVED</span>' : '<span class="badge l4"><span class="dot"></span>REVIEW</span>'}</span></div>
    <div class="pb small" style="line-height:1.8">
      <div><b style="color:#7dd3fc">BEFORE:</b> ${esc(x.before)}</div>
      <div><b style="color:#fbbf24">AFTER:</b> ${esc(x.after)}</div>
      <div class="dim"><b>WHO:</b> ${esc(x.who)} · <b>WHEN:</b> ${fmtWatShort(x.when)}</div>
      <div><b>WHY:</b> ${esc(x.why)}</div>
    </div></div>`).join('')}</div>`));
  const fim = dataTable({
    cols: [
      { key: 'path', label: 'MONITORED FILE', render: r => `<span style="font-family:var(--mono)">${esc(r.path)}</span>` },
      { key: 'hash', label: 'HASH (MASKED)', render: r => `<span class="dim" style="font-family:var(--mono)">${esc(r.hash.slice(0, 20))}…</span>` },
      { key: 'status', label: 'STATUS', render: r => r.status === 'OK' ? '<span class="badge s-verified"><span class="dot"></span>OK</span>' : r.status === 'CHANGED' ? '<span class="badge s-under"><span class="dot"></span>CHANGED</span>' : `<span class="badge l4"><span class="dot"></span>${esc(r.status)}</span>` },
      { key: 'lastCheck', label: 'LAST CHECK', render: r => `<span class="dim">${fmtWatShort(r.lastCheck)}</span>` },
      { key: 'changes', label: 'CHANGES', render: r => (r.changes || []).map(c => `<div class="small">${fmtWatShort(c.at)} — ${esc(c.kind)} — ${esc(c.detail)}</div>`).join('') || '—' },
    ],
    rows: d.files, emptyText: 'No files monitored',
  });
  fim.setTitle(`CONFIGURATION INTEGRITY — ${d.driftOpen} drift item(s) awaiting review · unexpected modification / deletion / creation / permission changes. Raw secrets never exposed.`);
  main.appendChild(fim.el);
}

// ---------------- DATABASE (§32/33) ----------------
async function renderDb(main) {
  shell._active = 'db';
  main.innerHTML = '';
  const d = await secApi('/db');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">DATABASE SECURITY</span></div><div class="pb">
    <div class="stat-tiles" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-tile ok"><div class="v">${d.availability}%</div><div class="l">AVAILABILITY</div></div>
      <div class="stat-tile"><div class="v">${d.connections}<span class="dim" style="font-size:11px">/${d.maxConnections}</span></div><div class="l">CONNECTIONS</div></div>
      <div class="stat-tile ${d.queryErrors ? 'warn' : 'ok'}"><div class="v">${d.queryErrors}</div><div class="l">QUERY ERRORS</div></div>
      <div class="stat-tile ${d.authFailures ? 'warn' : 'ok'}"><div class="v">${d.authFailures}</div><div class="l">AUTH FAILURES</div></div>
      <div class="stat-tile"><div class="v">${d.privilegedQueries}</div><div class="l">PRIVILEGED QUERIES</div></div>
      <div class="stat-tile"><div class="v">${d.replicationLagMs}ms</div><div class="l">REPLICATION LAG</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${esc(d.backupStatus)}</div><div class="l">BACKUP STATUS</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${esc(d.integrityChecks)}</div><div class="l">INTEGRITY CHECKS</div></div>
      <div class="stat-tile"><div class="v">${d.configChanges}</div><div class="l">CONFIG CHANGES</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:11px">${esc(d.encryption)}</div><div class="l">ENCRYPTION</div></div>
    </div></div></div>`));
  main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">DATABASE ACCESS ALERTS (§33)</span></div><div class="pb"><div class="feed">${d.alerts.map(a => `<div class="item"><span class="t">${fmtWatShort(a.at)}</span><span class="tx">${secSev(a.severity)} ${esc(a.text)} <span class="dim">(${esc(a.actor)} · ${esc(a.status)})</span></span></div>`).join('')}</div></div></div>`));
}

// ---------------- EVIDENCE STORE (§34/35/71) ----------------
async function renderEvidence(main) {
  shell._active = 'evidence';
  main.innerHTML = '';
  const d = await secApi('/evidence');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">EVIDENCE SECURITY</span><span class="sp dim small">EC8A documents & incident evidence — storage, access, hash integrity, encryption</span></div>
    <div class="pb">
      <div class="stat-tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="stat-tile ${d.integrity === 'INTACT' ? 'ok' : 'bad'}"><div class="v" style="font-size:15px">${esc(d.integrity)}</div><div class="l">INTEGRITY</div></div>
        <div class="stat-tile"><div class="v">${fmtN(d.filesTracked)}</div><div class="l">FILES TRACKED</div></div>
        <div class="stat-tile ok"><div class="v">${fmtN(d.hashVerified)}</div><div class="l">HASHES VERIFIED</div></div>
        <div class="stat-tile ${d.failedVerification ? 'bad' : 'ok'}"><div class="v">${d.failedVerification}</div><div class="l">FAILED VERIFICATIONS</div></div>
        <div class="stat-tile"><div class="v">${d.accessToday}</div><div class="l">ACCESSES TODAY</div></div>
        <div class="stat-tile"><div class="v">${d.downloads}</div><div class="l">DOWNLOADS</div></div>
        <div class="stat-tile"><div class="v">${d.exports}</div><div class="l">EXPORTS</div></div>
        <div class="stat-tile ok"><div class="v">${d.unauthorizedModificationAttempts}</div><div class="l">UNAUTHORIZED MODIFICATION ATTEMPTS</div></div>
      </div>
      <div class="row mt8">
        <span class="dim small">Last full verification: ${fmtWatShort(d.lastFullVerification)}</span><span class="flex1"></span>
        ${canRespond() ? `<button class="btn sm" id="evverify">✓ VERIFY ALL HASHES</button>` : ''}
        ${canPriv() ? `<button class="btn sm" id="evdemo" style="border-color:#6b4a10;color:#fde68a">⚠ DEMO: SIMULATE INTEGRITY EVENT</button>` : ''}
      </div>
    </div></div>`));
  const evv = $('#evverify', main);
  if (evv) evv.onclick = async () => { await API.post('/api/sentinel/evidence/verify', {}); toast('Verification executed', 'Full hash verification passed — audited.'); renderEvidence(main); };
  const evd = $('#evdemo', main);
  if (evd) evd.onclick = () => {
    confirmBox('DEMO SIMULATION ONLY', 'This simulates a critical evidence-integrity event to demonstrate the §71 failsafe: DETECTION → PRESERVE EVIDENCE → FREEZE RECORD → NOTIFY → OPEN INCIDENT → INVESTIGATE → RECOVER → VALIDATE. No real evidence is affected (demo mode).', async () => {
      await API.post('/api/sentinel/evidence/simulate-event', {});
      toast('CRITICAL EVIDENCE INTEGRITY EVENT (DEMO)', 'Snapshot preserved, record frozen, case opened — see Incidents.', 'critical');
      renderEvidence(main);
    }, 'RUN DEMO EVENT');
  };
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">EVIDENCE STORE EVENTS</span></div><div class="pb"><div class="feed">${d.events.map(e => `<div class="item"><span class="t">${fmtWatShort(e.at)}</span><span class="tx"><b>${esc(e.kind)}</b> — ${esc(e.detail)}${e.by ? ' (by ' + esc(e.by) + ')' : ''}</span></div>`).join('') || '<div class="dim small">No events</div>'}</div></div></div>`));
  const tab = dataTable({
    cols: [
      { key: 'code', label: 'EVIDENCE', render: r => `<b style="font-family:var(--mono)">${esc(r.code || r.id)}</b>` },
      { key: 'kind', label: 'KIND', render: r => `<span class="pill">${esc(r.kind)}</span>` },
      { key: 'sha256', label: 'HASH', render: r => `<span style="font-family:var(--mono)" class="dim">${esc(r.sha256 || '—')}</span>` },
      { key: 'capturedAt', label: 'CAPTURED', render: r => `<span class="dim">${fmtWatShort(r.capturedAt)}</span>` },
      { key: 'chain', label: 'CHAIN', render: r => esc(r.chain || '—') },
    ],
    rows: d.sample || [], pageSize: 8, emptyText: 'No field evidence captured yet (simulation phase dependent)',
  });
  tab.setTitle('TRACKED EVIDENCE (EC8A & incident evidence) — hashes masked, never exposed in full');
  main.appendChild(tab.el);
}

// ---------------- RECOVERY CENTRE (§72) ----------------
async function renderRecovery(main) {
  shell._active = 'recovery';
  main.innerHTML = '';
  const d = await secApi('/recovery');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">RECOVERY CENTRE</span><span class="sp dim small">backup & recovery command</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${fmtWatShort(d.lastBackup)}</div><div class="l">LAST SUCCESSFUL BACKUP</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(d.integrity)}</div><div class="l">BACKUP INTEGRITY</div></div>
      <div class="stat-tile"><div class="v" style="font-size:14px">${esc(d.recoveryPoint)}</div><div class="l">RECOVERY POINT</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${esc(d.drStatus)}</div><div class="l">DR STATUS</div></div>
      <div class="stat-tile"><div class="v" style="font-size:13px">${esc(d.restoreTest)}</div><div class="l">RESTORE TEST</div></div>
      <div class="stat-tile ok"><div class="v">${d.backupSuccess}%</div><div class="l">BACKUP SUCCESS RATE</div></div>
    </div>
    ${canRespond() ? `<div class="row mt8"><button class="btn sm" data-rc="verify">✓ VERIFY BACKUP</button><button class="btn sm" data-rc="recovery">▶ START RECOVERY PROCEDURE</button><button class="btn sm" data-rc="failover">⇄ FAILOVER</button><span class="dim small">High-impact actions require approval (§72)</span></div>` : ''}
    </div></div>`));
  $$('[data-rc]', main).forEach(b => b.onclick = () => requestActionModal(b.dataset.rc === 'verify' ? 'VERIFY_BACKUP' : b.dataset.rc === 'recovery' ? 'START_RECOVERY' : 'FAILOVER_DR', b.dataset.rc === 'verify' ? 'BACKUP-ARCHIVE' : b.dataset.rc === 'recovery' ? 'RECOVERY-RUNBOOK' : 'DR-SITE-01'));
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">BACKUP JOBS</span></div><div class="pb"><div class="feed">${d.jobs.map(j => `<div class="item"><span class="t">${fmtWatShort(j.at)}</span><span class="tx"><b>${esc(j.kind)}</b> — <span style="color:${j.result === 'SUCCESS' ? '#4ade80' : '#f87171'}">${esc(j.result)}</span>${j.note ? ' — ' + esc(j.note) : ''}</span></div>`).join('')}</div></div></div>`));
}

// ---------------- PUBLIC DOMAIN / WAF (§37/38) ----------------
async function renderPublicSec(main) {
  shell._active = 'publicsec';
  main.innerHTML = '';
  const d = await secApi('/public');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">PUBLIC PLATFORM SECURITY</span><span class="sp dim small">traffic · bot activity · WAF · rate limiting · auth · error spikes · availability · DDoS · API abuse</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-tile"><div class="v">${fmtN(d.requests)}</div><div class="l">TRAFFIC</div></div>
      <div class="stat-tile bad"><div class="v">${fmtN(d.blocked)}</div><div class="l">WAF BLOCKED</div></div>
      <div class="stat-tile warn"><div class="v">${fmtN(d.challenged)}</div><div class="l">CHALLENGED</div></div>
      <div class="stat-tile warn"><div class="v">${fmtN(d.rateLimited)}</div><div class="l">RATE LIMITED</div></div>
      <div class="stat-tile"><div class="v">${d.errorSpikes}</div><div class="l">ERROR SPIKES</div></div>
      <div class="stat-tile"><div class="v">${fmtN(d.botActivity)}</div><div class="l">BOT ACTIVITY</div></div>
      <div class="stat-tile ${d.ddosIndicators ? 'bad' : 'ok'}"><div class="v">${d.ddosIndicators}</div><div class="l">DDoS INDICATORS</div></div>
      <div class="stat-tile ok"><div class="v">${d.availability}%</div><div class="l">AVAILABILITY</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(d.cdnStatus)}</div><div class="l">CDN STATUS</div></div>
      <div class="stat-tile"><div class="v">${fmtN(d.allowed)}</div><div class="l">ALLOWED</div></div>
    </div></div></div>`));
  main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">WEB APPLICATION FIREWALL — CATEGORIES</span></div><div class="pb">${barChart({ data: d.wafCategories.map(c => c.value), labels: d.wafCategories.map(c => c.label), w: 640, h: 170, colorFn: (v, i) => ['#ef4444', '#f97316', '#fbbf24', '#38bdf8'][i % 4] })}</div></div>`));
}

// ---------------- APPLICATION COVERAGE (§65) ----------------
async function renderApps(main) {
  shell._active = 'apps';
  main.innerHTML = '';
  const d = await secApi('/apps');
  const tab = dataTable({
    cols: [
      { key: 'app', label: 'APPLICATION', render: r => `<b>${esc(r.app)}</b>` },
      { key: 'version', label: 'VERSION', render: r => `<span style="font-family:var(--mono)">${esc(r.version)}</span>` },
      { key: 'api', label: 'API', render: r => `<span style="font-family:var(--mono)">${esc(r.api)}</span>` },
      { key: 'availability', label: 'AVAILABILITY', render: r => `<span style="color:${r.availability >= 99.5 ? '#4ade80' : '#fbbf24'}">${r.availability}%</span>` },
      { key: 'auth', label: 'AUTHENTICATION', render: r => `<span class="pill">${esc(r.auth)}</span>` },
      { key: 'apiHealth', label: 'API HEALTH', render: r => secBadge(r.apiHealth) },
      { key: 'errorRate', label: 'ERROR RATE', render: r => `${r.errorRate}%` },
      { key: 'events', label: 'SEC EVENTS', render: r => `<b>${r.events}</b>` },
      { key: 'vulns', label: 'VULNERABILITIES', render: r => r.vulns || '0' },
      { key: 'deps', label: 'DEPENDENCIES', render: r => esc(r.deps) },
    ],
    rows: d.rows, emptyText: 'No applications',
  });
  tab.setTitle('APPLICATION SECURITY COVERAGE — every major application monitored (§65)');
  main.appendChild(tab.el);
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">ATTACK SURFACE</span></div><div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(5,1fr)">
    <div class="stat-tile"><div class="v">${d.surface.monitoredApps}</div><div class="l">APPS</div></div>
    <div class="stat-tile"><div class="v">${d.surface.monitoredApis}</div><div class="l">APIs</div></div>
    <div class="stat-tile"><div class="v">${d.surface.monitoredNodes}</div><div class="l">NODES</div></div>
    <div class="stat-tile"><div class="v">${d.surface.monitoredSecrets}</div><div class="l">SECRETS</div></div>
    <div class="stat-tile"><div class="v">${d.surface.monitoredFiles}</div><div class="l">MONITORED FILES</div></div>
  </div></div></div>`));
}

// ---------------- IReV SECURITY (§36) ----------------
async function renderIrevSec(main) {
  shell._active = 'irevsec';
  main.innerHTML = '';
  const d = await secApi('/irev');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">IReV WATCHTOWER SECURITY</span><span class="sp dim small">connector · auth · API/feed failures · unexpected responses · source availability · ingestion integrity · snapshot storage · hash verification</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(5,1fr)">
      <div class="stat-tile ok"><div class="v" style="font-size:15px">${esc(d.connector)}</div><div class="l">CONNECTOR</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(d.auth)}</div><div class="l">AUTHENTICATION</div></div>
      <div class="stat-tile ${d.apiFailures ? 'warn' : 'ok'}"><div class="v">${d.apiFailures}</div><div class="l">API / FEED FAILURES</div></div>
      <div class="stat-tile ${d.unexpectedResponses ? 'warn' : 'ok'}"><div class="v">${d.unexpectedResponses}</div><div class="l">UNEXPECTED RESPONSE PATTERNS</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(d.sourceAvailability)}</div><div class="l">SOURCE AVAILABILITY</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${esc(d.ingestionIntegrity)}</div><div class="l">INGESTION INTEGRITY</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:14px">${esc(d.snapshotStorage)}</div><div class="l">SNAPSHOT STORAGE</div></div>
      <div class="stat-tile ok"><div class="v" style="font-size:13px">${esc(d.hashVerification)}</div><div class="l">HASH VERIFICATION</div></div>
      <div class="stat-tile"><div class="v">${d.observations}</div><div class="l">OBSERVATIONS</div></div>
      <div class="stat-tile"><div class="v">${d.cases}</div><div class="l">CASES</div></div>
    </div></div></div>`));
  main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">SECURITY NOTES & EVENTS</span></div><div class="pb">
    <div class="small mb8" style="line-height:1.7">${d.notes.map(n => `• ${esc(n)}`).join('<br>')}</div>
    <div class="feed">${d.events.map(e => `<div class="item"><span class="t">${fmtWatShort(e.at)}</span><span class="tx">${secSev(e.severity)} ${esc(e.text)} — ${esc(e.status)}</span></div>`).join('') || '<div class="dim small">No connector events</div>'}</div>
  </div></div>`));
}

// ---------------- ACTION CENTRE (§47/49/50/16) ----------------
async function renderActionsTab(main) {
  shell._active = 'actions';
  main.innerHTML = '';
  const [d, cat] = await Promise.all([secApi('/actions'), secApi('/action-catalog')]);
  const groups = { LOW: [], MEDIUM: [], HIGH: [], CRITICAL: [] };
  for (const [k, v] of Object.entries(cat.catalog)) { (groups[v.risk] = groups[v.risk] || []).push([k, v]); }
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">SECURITY ACTION CENTRE</span><span class="sp dim small">AUTHENTICATION → AUTHORIZATION → CONFIRMATION → EXECUTION → AUDIT</span></div>
    <div class="pb">
      ${Object.entries(groups).map(([risk, acts]) => `<div class="mb8"><b style="color:${risk === 'CRITICAL' ? '#ef4444' : risk === 'HIGH' ? '#f97316' : risk === 'MEDIUM' ? '#fbbf24' : '#4ade80'}">${risk} RISK${risk === 'CRITICAL' ? ' — DUAL AUTHORIZATION REQUIRED' : ''}</b><div class="row mt4" style="flex-wrap:wrap">${acts.map(([k, v]) => `<button class="btn sm" data-req="${k}" title="${esc(v.label)} — reversible: ${v.reversible ? 'yes' : 'no'}">${esc(v.label)}</button>`).join('')}</div></div>`).join('')}
    </div></div>`));
  $$('[data-req]', main).forEach(b => b.onclick = () => {
    const def = cat.catalog[b.dataset.req];
    const m = modal({
      title: `REQUEST ACTION — ${def.label}`,
      body: () => el(`<div class="small" style="line-height:1.8">
        <label class="fl">Target</label><input class="inp" id="req-target" style="width:100%" placeholder="e.g. NODE-0042">
        <label class="fl mt8">Reason</label><textarea class="inp" id="req-detail" style="width:100%;min-height:60px" placeholder="Why is this action required?"></textarea>
        <div class="dim mt8">Risk: <b>${esc(def.risk)}</b> · Reversible: <b>${def.reversible ? 'YES' : 'NO'}</b> · Approval: <b>${esc(def.approval)}</b></div>
      </div>`),
      actions: [
        { label: 'Cancel', cls: 'ghost' },
        { label: 'REQUEST', cls: 'primary', onClick: async () => {
          try {
            const r = await API.post('/api/sentinel/actions/request', { action: b.dataset.req, target: $('#req-target', m.body).value.trim() || 'UNSPECIFIED', detail: $('#req-detail', m.body).value.trim() });
            toast(r.requiresApproval ? 'Approval requested' : 'Action executed', `${r.action.actionLabel} — audited.`);
            m.close(); renderActionsTab(main);
          } catch (e) { toast('Request failed', e.message, 'critical'); }
        } },
      ],
    });
  });
  const pending = d.rows.filter(a => ['REQUESTED', 'PENDING_DUAL'].includes(a.status));
  if (pending.length) {
    main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">PENDING APPROVALS (${pending.length})</span><span class="sp dim small">${canPriv() ? 'you can approve or reject' : 'approval requires security.privileged'}</span></div>
      <div class="pb">${pending.map(a => `<div class="row mb8" style="align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:220px"><b style="color:#fbbf24">${esc(a.code)}</b> ${secRisk(a.risk)} <b>${esc(a.actionLabel)}</b> on <b style="font-family:var(--mono)">${esc(a.target)}</b>
        <div class="dim small">${esc(a.impact)}</div>
        <div class="dim small">Requested by ${esc(a.requestedBy)} ${fmtWatShort(a.requestedAt)} · Reversible: ${a.reversible ? 'YES' : 'NO'} · Approval: ${esc(a.approval)}${a.approvals && a.approvals.length ? ' · ' + a.approvals.map(x => x.by).join(' + ') + ' approved' : ''}</div></div>
        ${canPriv() ? `<div class="row">${(a.approvals || []).length < (a.approval === 'DUAL' ? 2 : 1) ? `<button class="btn sm success" data-ok="${a.id}">APPROVE</button>` : ''}<button class="btn sm" data-no="${a.id}">REJECT</button></div>` : ''}
      </div>`).join('')}</div></div>`));
    $$('[data-ok]', main).forEach(b => b.onclick = async () => {
      try { const r = await API.post('/api/sentinel/actions/' + b.dataset.ok + '/approve', { note: 'Approved via Action Centre' }); toast(r.pendingDual ? 'First approval recorded' : 'Action approved', r.pendingDual ? 'A SECOND approver is required (dual authorization).' : 'Ready for execution — execute from the action ledger.'); renderActionsTab(main); } catch (e) { toast('Not approved', e.message, 'critical'); }
    });
    $$('[data-no]', main).forEach(b => b.onclick = async () => {
      await API.post('/api/sentinel/actions/' + b.dataset.no + '/reject', { note: 'Rejected via Action Centre' });
      toast('Action rejected', 'Not executed — audited.');
      renderActionsTab(main);
    });
  }
  const ledger = dataTable({
    cols: [
      { key: 'code', label: 'REQUEST', render: r => `<b style="font-family:var(--mono)">${esc(r.code)}</b>` },
      { key: 'actionLabel', label: 'ACTION', render: r => `<b>${esc(r.actionLabel)}</b>` },
      { key: 'target', label: 'TARGET', render: r => `<span style="font-family:var(--mono)">${esc(r.target)}</span>` },
      { key: 'risk', label: 'RISK', render: r => secRisk(r.risk) },
      { key: 'status', label: 'STATUS', render: r => secStatus(r.status) },
      { key: 'requestedBy', label: 'REQUESTED BY', render: r => `<span>${esc(r.requestedBy)}</span><div class="dim" style="font-size:9.5px">${fmtWatShort(r.requestedAt)}</div>` },
      { key: 'approvedBy', label: 'APPROVED BY', render: r => esc(r.approvedBy || '—') },
      { key: '_act', label: 'EXECUTE / ROLLBACK', render: r => {
        if (r.status === 'APPROVED' && canRespond()) return `<button class="btn sm success" data-ex="${r.id}">EXECUTE</button>`;
        if (r.status === 'EXECUTED' && r.reversible && canPriv()) return `<button class="btn sm" data-rb="${r.id}">↺ ROLLBACK</button>`;
        if (r.status === 'ROLLED_BACK') return '<span class="dim small">RESTORED</span>';
        return '';
      } },
    ],
    rows: d.rows, pageSize: 12, emptyText: 'No security actions yet',
  });
  ledger.setTitle('ACTION LEDGER — every privileged action with WHO · WHAT · WHEN · TARGET · BEFORE · AFTER · WHY · APPROVAL · RESULT');
  main.appendChild(ledger.el);
  $$('[data-ex]', main).forEach(b => b.onclick = async () => {
    confirmBox('Execute approved action', 'This executes the authorized security action and writes BEFORE/AFTER state to the immutable audit.', async () => {
      try { await API.post('/api/sentinel/actions/' + b.dataset.ex + '/execute', {}); toast('Action executed', 'BEFORE/AFTER state recorded.'); renderActionsTab(main); } catch (e) { toast('Execution failed', e.message, 'critical'); }
    }, 'EXECUTE');
  });
  $$('[data-rb]', main).forEach(b => b.onclick = async () => {
    confirmBox('Rollback action', 'Restores the target to its pre-action state (change → monitor → validation → rollback → verify, §50).', async () => {
      try { await API.post('/api/sentinel/actions/' + b.dataset.rb + '/rollback', {}); toast('Action rolled back', 'Target restored — audited.'); renderActionsTab(main); } catch (e) { toast('Rollback failed', e.message, 'critical'); }
    }, 'ROLLBACK');
  });
}

// ---------------- BREAK-GLASS (§48) ----------------
async function renderBreakGlass(main) {
  shell._active = 'breakglass';
  main.innerHTML = '';
  const [d, status] = await Promise.all([secApi('/actions'), secApi('/status')]);
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">EMERGENCY ACCESS (BREAK-GLASS)</span><span class="sp dim small">${status.counters.breakglassActive} active emergency session(s)</span></div>
    <div class="pb small" style="line-height:1.7">For genuine emergencies only. Requires: strong authentication · reason · incident ID · time limit · elevated monitoring · automatic expiration · full audit.<br><b style="color:#fbbf24">Emergency privileged sessions expire automatically.</b></div></div>`));
  if (canRespond()) {
    const openBtn = el(`<div class="panel mb12"><div class="ph"><span class="t">ACTIONS</span></div><div class="pb"><button class="btn" id="bgopen" style="border-color:#6b4a10;color:#fde68a">⚡ OPEN EMERGENCY ACCESS</button></div></div>`);
    $('#bgopen', openBtn).onclick = () => {
      const m = modal({
        title: 'OPEN BREAK-GLASS EMERGENCY ACCESS',
        body: () => el(`<div class="small" style="line-height:1.8">
          <label class="fl">Reason (mandatory, min 10 characters)</label>
          <textarea class="inp" id="bg-reason" style="width:100%;min-height:64px" placeholder="e.g. Evidence store availability incident SEC-2027-000414 requires immediate recovery access"></textarea>
          <label class="fl mt8">Incident ID</label>
          <input class="inp" id="bg-inc" style="width:100%" placeholder="SEC-2027-…">
          <label class="fl mt8">Time limit (minutes, max 120)</label>
          <input class="inp" id="bg-min" type="number" value="30" min="5" max="120" style="width:100%">
          <div class="dim mt8">Opening a break-glass session is written to the immutable audit and notifies the security director.</div>
        </div>`),
        actions: [
          { label: 'Cancel', cls: 'ghost' },
          { label: 'OPEN EMERGENCY SESSION', cls: 'primary', onClick: async () => {
            const reason = $('#bg-reason', m.body).value.trim();
            if (reason.length < 10) { toast('Reason required', 'A clear reason (min 10 chars) is mandatory.', 'critical'); return; }
            try {
              const r = await API.post('/api/sentinel/breakglass/open', { reason, incidentId: $('#bg-inc', m.body).value.trim(), minutes: parseInt($('#bg-min', m.body).value, 10) || 30 });
              toast('Break-glass opened', `Emergency privileged session expires in ${r.session.minutes}:00 — elevated monitoring active.`, 'critical');
              m.close(); renderBreakGlass(main);
            } catch (e) { toast('Open failed', e.message, 'critical'); }
          } },
        ],
      });
    };
    main.appendChild(openBtn);
  }
  const bgRows = d.rows.filter(a => ['BREAK_GLASS_OPEN'].includes(a.what || a.action)).concat(status.counters.breakglassActive ? [{ code: 'ACTIVE', status: 'ACTIVE', detail: 'Emergency session in progress — see audit', requestedBy: 'security team', requestedAt: Date.now() }] : []);
  main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">BREAK-GLASS SESSIONS</span></div><div class="pb">${bgRows.length ? bgRows.map(a => `<div class="row mb8" style="flex-wrap:wrap"><div style="flex:1"><b style="font-family:var(--mono)">${esc(a.code)}</b> ${secStatus(a.status)}<div class="small dim mt4">${esc(a.detail || '')} · ${esc(a.requestedBy || '')} ${a.requestedAt ? fmtWatShort(a.requestedAt) : ''}</div></div></div>`).join('') : '<div class="dim small">No emergency sessions recorded.</div>'}</div></div>`));
}

// ---------------- SECURITY KPIs (§56) ----------------
async function renderKpis(main) {
  shell._active = 'kpis';
  main.innerHTML = '';
  const d = await secApi('/kpis');
  const cards = Object.entries(d).map(([k, v]) => `<div class="panel"><div class="ph"><span class="t">${esc(v.label.toUpperCase())}</span></div><div class="pb">
    <div class="big-num" style="font-size:34px;font-weight:800;font-family:var(--mono);color:${k === 'critVulnAge' ? '#fbbf24' : '#7dd3fc'}">${v.value}<small style="font-size:14px;color:#566781">${v.unit === 'min' || v.unit === 'h' ? ' ' + v.unit : v.unit}</small></div>
    <div class="dim small mt4">${k === 'mttd' ? 'Mean Time to Detect' : k === 'mtta' ? 'Mean Time to Acknowledge' : k === 'mttc' ? 'Mean Time to Contain' : k === 'mttr' ? 'Mean Time to Recover' : ''}${k === 'patchCompliance' ? 'patched ÷ total findings' : k === 'mfaCoverage' ? 'accounts with MFA enforced' : k === 'backupSuccess' ? 'successful backup jobs' : k === 'critVulnAge' ? 'oldest open CRITICAL finding' : ''}</div>
  </div></div>`).join('');
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">SECURITY KPIs (§56)</span><span class="sp dim small">MTTD · MTTA · MTTC · MTTR · patch compliance · MFA coverage · backup success · critical vulnerability age</span></div><div class="pb small dim">All metrics computed from the closed-case timeline and live registers — every value traces to a record.</div></div>`));
  main.appendChild(el(`<div class="grid2" style="grid-template-columns:repeat(4,1fr)">${cards}</div>`));
  main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">INTERPRETATION</span></div><div class="pb small" style="line-height:1.8">
    <div>• <b>MTTD ${d.mttd.value}${d.mttd.unit}:</b> detection engine latency from first anomaly to triage-ready case.</div>
    <div>• <b>MTTA ${d.mtta.value}${d.mtta.unit}:</b> acknowledgement by the SOC team.</div>
    <div>• <b>MTTC ${d.mttc.value}${d.mttc.unit} / MTTR ${d.mttr.value}${d.mttr.unit}:</b> containment and recovery from the incident timeline.</div>
    <div>• <b>PATCH COMPLIANCE ${d.patchCompliance.value}%:</b> patched findings ÷ all findings.</div>
    <div>• <b>CRITICAL VULNERABILITY AGE ${d.critVulnAge.value}${d.critVulnAge.unit}:</b> the 7-day remediation target is enforced by the vulnerability register.</div>
  </div></div>`));
}

// ---------------- TRENDS (§55) ----------------
async function renderTrends(main) {
  shell._active = 'trends';
  main.innerHTML = '';
  const d = await secApi('/analytics');
  main.appendChild(el(`<div class="grid2 mb12">
    <div class="panel"><div class="ph"><span class="t">THREATS BY HOUR (24H)</span></div><div class="pb">${lineChart({ series: [{ data: d.threatsByHour.map(x => x.threats), color: '#ef4444' }], labels: d.threatsByHour.map(x => x.label), w: 460, h: 160 })}</div></div>
    <div class="panel"><div class="ph"><span class="t">ALERTS BY SEVERITY</span></div><div class="pb">${barChart({ data: Object.values(d.alertsBySeverity), labels: Object.keys(d.alertsBySeverity), w: 460, h: 160, colorFn: (v, i) => ['#ef4444', '#f97316', '#fbbf24', '#38bdf8', '#64748b'][i] })}</div></div>
    <div class="panel"><div class="ph"><span class="t">VULNERABILITIES BY SEVERITY</span></div><div class="pb">${barChart({ data: [d.vulnsBySeverity.CRITICAL, d.vulnsBySeverity.HIGH, d.vulnsBySeverity.MEDIUM, d.vulnsBySeverity.LOW, d.vulnsBySeverity.PATCHED], labels: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'PATCHED'], w: 460, h: 160, colorFn: (v, i) => ['#ef4444', '#f97316', '#fbbf24', '#38bdf8', '#22c55e'][i] })}</div></div>
    <div class="panel"><div class="ph"><span class="t">AUTHENTICATION FAILURES (24H)</span></div><div class="pb">${lineChart({ series: [{ data: d.authFailures.map(x => x.failures), color: '#f97316' }], labels: d.authFailures.map(x => (fmtWatShort(x.at).split(',')[1] || '').trim()), w: 460, h: 160 })}</div></div>
  </div>`));
  main.appendChild(el(`<div class="grid2 mb12">
    <div class="panel"><div class="ph"><span class="t">API ERRORS</span></div><div class="pb">${barChart({ data: d.apiErrors.map(x => x.errors), labels: d.apiErrors.map(x => x.id.replace('API-', '')), w: 460, h: 160, colorFn: (v, i) => v > 20 ? '#ef4444' : '#38bdf8' })}</div></div>
    <div class="panel"><div class="ph"><span class="t">SECURITY INCIDENTS BY WORKFLOW STATUS</span></div><div class="pb">${barChart({ data: d.incidentsByStatus.map(x => x.count), labels: d.incidentsByStatus.map(x => x.status), w: 460, h: 160, colorFn: (v, i) => ['#ef4444', '#f97316', '#fbbf24', '#38bdf8', '#a855f7', '#22c55e', '#64748b', '#64748b', '#64748b'][i] })}</div></div>
  </div>`));
  main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">NODE AVAILABILITY</span></div><div class="pb">
    <div class="row" style="flex-wrap:wrap">${d.nodeAvailability.map(n => `<span class="nodechip" style="cursor:pointer" data-node="${n.id}" title="${esc(n.id)} — ${n.availability}%"><span class="nd" style="background:${n.availability >= 99 ? '#22c55e' : '#fbbf24'}"></span>${esc(n.id.replace('NODE-', 'N'))} ${n.availability}%</span>`).join('')}</div>
  </div></div>`));
  $$('[data-node]', main).forEach(c => c.onclick = () => openNodeModal(c.dataset.node));
}

// ---------------- RISK REGISTER (§58) ----------------
async function renderRisk(main) {
  shell._active = 'risk';
  main.innerHTML = '';
  const d = await secApi('/risk');
  const tab = dataTable({
    cols: [
      { key: 'risk', label: 'RISK', render: r => `<b>${esc(r.risk)}</b>` },
      { key: 'asset', label: 'ASSET', render: r => `<span style="font-family:var(--mono)">${esc(r.asset)}</span>` },
      { key: 'probability', label: 'PROBABILITY' },
      { key: 'impact', label: 'IMPACT' },
      { key: 'score', label: 'SCORE', render: r => `<b style="color:${r.score >= 12 ? '#f87171' : r.score >= 8 ? '#fbbf24' : '#4ade80'}">${r.score}</b>` },
      { key: 'owner', label: 'OWNER' },
      { key: 'treatment', label: 'TREATMENT', render: r => `<span class="badge ${r.treatment === 'MITIGATE' ? 's-under' : r.treatment === 'AVOID' ? 'l5' : r.treatment === 'ACCEPT' ? 's-submitted' : 's-verified'}"><span class="dot"></span>${esc(r.treatment)}</span>` },
    ],
    rows: d.rows, emptyText: 'Risk register empty',
  });
  tab.setTitle('RISK REGISTER — probability × impact = score · treatments: MITIGATE / TRANSFER / ACCEPT / AVOID');
  main.appendChild(tab.el);
  if (canRespond()) {
    main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">ADD RISK</span></div><div class="pb">
      <div class="row mb8"><input class="inp" id="rk-risk" placeholder="Risk description" style="flex:2"><input class="inp" id="rk-asset" placeholder="Asset" style="flex:1"></div>
      <div class="row mb8">
        <select class="inp" id="rk-prob"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option></select>
        <select class="inp" id="rk-imp"><option>LOW</option><option selected>MEDIUM</option><option>HIGH</option><option>CRITICAL</option></select>
        <select class="inp" id="rk-treat"><option selected>MITIGATE</option><option>TRANSFER</option><option>ACCEPT</option><option>AVOID</option></select>
        <button class="btn primary sm" id="rk-add">ADD TO REGISTER</button>
      </div>
    </div></div>`));
    $('#rk-add', main).onclick = async () => {
      const risk = $('#rk-risk', main).value.trim();
      if (!risk) { toast('Description required', '', 'critical'); return; }
      await API.post('/api/sentinel/risk', { risk, asset: $('#rk-asset', main).value.trim(), probability: $('#rk-prob', main).value, impact: $('#rk-imp', main).value, treatment: $('#rk-treat', main).value });
      toast('Risk added', 'Score computed from probability × impact.');
      renderRisk(main);
    };
  }
}

// ---------------- AUDIT & LOGS (§44/68) ----------------
async function renderAudit(main) {
  shell._active = 'audit';
  main.innerHTML = '';
  const [logs, immu] = await Promise.all([secApi('/logs'), canAudit() ? secApi('/audit') : Promise.resolve(null)]);
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">CENTRAL SECURITY LOG (§44)</span><span class="sp dim small">search by user · IP · node · API · event · case · time · severity · resource</span></div>
    <div class="pb"><div class="row mb8">
      <input class="inp" id="lg-q" placeholder="Search: user, node, event, case, e.g. SEC-2027-000411 · NODE-0042 · API-RESULTS" style="flex:2">
      <select class="inp" id="lg-sev"><option value="">ALL SEVERITIES</option>${['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFORMATIONAL', 'N/A'].map(s => `<option>${s}</option>`).join('')}</select>
      <select class="inp" id="lg-cat"><option value="">ALL CATEGORIES</option>${['INFRASTRUCTURE', 'API', 'IDENTITY', 'APPLICATION', 'DATABASE', 'NETWORK', 'EVIDENCE', 'IREV', 'PUBLIC', 'AUDIT'].map(s => `<option>${s}</option>`).join('')}</select>
      <button class="btn sm" id="lg-go">FILTER</button>
      <a class="btn sm" href="/api/sentinel/logs/export" target="_blank" id="lg-exp">⬇ EXPORT CSV</a>
      <button class="btn sm" id="lg-case">+ CREATE CASE</button>
    </div>
    <div class="dim small mb8">FILTER · CORRELATE · EXPORT · CREATE CASE — the security audit is append-only (immutable), entries are never modified or deleted (§68).</div>
    <div id="lg-body" class="feed" style="max-height:420px;overflow:auto"></div></div></div>`));
  const loadLogs = async (q, sev, cat) => {
    $('#lg-body', main).innerHTML = '<div class="dim">Loading…</div>';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (sev && sev !== 'N/A') params.set('severity', sev);
    if (cat) params.set('category', cat);
    const r = await secApi('/logs' + (params.toString() ? '?' + params.toString() : ''));
    $('#lg-body', main).innerHTML = r.rows.map(x => `<div class="item" data-lg="${x.id}" style="cursor:pointer"><span class="t">${fmtWatShort(x.when || x.at || 0)}</span><span class="tx">${x.severity && x.severity !== 'N/A' ? secSev(x.severity) : ''} <b>${esc(x.what)}</b> by ${esc(x.who)} · ${esc(x.target)} <span class="dim">[${esc(x.kind)}${x.approval ? ' · approval: ' + esc(x.approval) : ''}]</span></span></div>`).join('') || '<div class="dim">No matching log entries</div>';
    if (canRespond()) {
      $$('[data-lg]', main).forEach(it => it.onclick = () => {
        confirmBox('Create security case', 'Open a case from this log entry? The case starts in DETECTED state and is written to the audit.', async () => {
          const r = await API.post('/api/sentinel/logs/create-case', { eventId: it.dataset.lg });
          toast('Case created', r.case.code);
        }, 'CREATE CASE');
      });
    }
  };
  $('#lg-go', main).onclick = () => loadLogs($('#lg-q', main).value.trim(), $('#lg-sev', main).value, $('#lg-cat', main).value);
  await loadLogs('', '', '');
  if (immu) {
    main.appendChild(el(`<div class="panel mt12"><div class="ph"><span class="t">IMMUTABLE SECURITY AUDIT (§68)</span><span class="sp dim small">${immu.total} entries · append-only · WHO WHAT WHEN WHERE TARGET BEFORE AFTER WHY APPROVAL RESULT</span></div>
      <div class="pb"><div class="feed" style="max-height:300px;overflow:auto">${immu.rows.map(e => `<div class="item"><span class="t">${fmtWatShort(e.at)}</span><span class="tx"><b>${esc(e.what)}</b> · ${esc(e.who)} → ${esc(e.target)}<div class="dim" style="font-size:10px">BEFORE: ${esc(JSON.stringify(e.before ?? null)).slice(0, 80)} · AFTER: ${esc(JSON.stringify(e.after ?? null)).slice(0, 80)}</div><div class="dim" style="font-size:10px">WHY: ${esc(e.why)} · APPROVAL: ${esc(e.approval)} · RESULT: ${esc(e.result)}</div></span></div>`).join('') || '<div class="dim small">No audit entries yet</div>'}</div></div></div>`));
  }
}

// ---------------- COMPLIANCE (§57) ----------------
async function renderCompliance(main) {
  shell._active = 'compliance';
  main.innerHTML = '';
  const d = await secApi('/compliance');
  const counts = { COMPLIANT: d.controls.filter(c => c.status === 'COMPLIANT').length, PARTIAL: d.controls.filter(c => c.status === 'PARTIAL').length, 'NON-COMPLIANT': d.controls.filter(c => c.status === 'NON-COMPLIANT').length };
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">SECURITY COMPLIANCE</span><span class="sp dim small">${counts.COMPLIANT} compliant · ${counts.PARTIAL} partial · ${counts['NON-COMPLIANT']} non-compliant</span></div><div class="pb"></div></div>`));
  const tab = dataTable({
    cols: [
      { key: 'control', label: 'CONTROL', render: r => `<b>${esc(r.control)}</b>` },
      { key: 'evidence', label: 'EVIDENCE' },
      { key: 'status', label: 'STATUS', render: r => `<span class="badge ${r.status === 'COMPLIANT' ? 's-verified' : r.status === 'PARTIAL' ? 's-under' : 'l5'}"><span class="dot"></span>${esc(r.status)}</span>` },
    ],
    rows: d.controls, emptyText: 'No controls',
  });
  tab.setTitle('ORGANIZATIONAL CONTROLS — MFA · encryption · backup · patch management · access review · logging · incident response · evidence integrity · disaster recovery');
  main.appendChild(tab.el);
}

// ---------------- SYSTEM (health, secrets, integrations) (§42/43/66/67) ----------------
async function renderSystem(main) {
  shell._active = 'system';
  main.innerHTML = '';
  const [h, secrets, status, apps] = await Promise.all([API.get('/api/system/health'), secApi('/secrets'), secApi('/status'), secApi('/apps')]);
  main.appendChild(el(`<div class="panel mb12"><div class="ph"><span class="t">PLATFORM INTEGRATIONS</span><span class="sp dim small">health of every monitored subsystem</span></div>
    <div class="pb"><div class="stat-tiles" style="grid-template-columns:repeat(6,1fr)">
      ${Object.entries(h).filter(([k]) => !['cpu', 'memory', 'disk', 'responseMs', 'errorRate', 'lastChecked'].includes(k)).map(([k, v]) => `<div class="stat-tile ${v === 'HEALTHY' ? 'ok' : v === 'DEGRADED' ? 'warn' : 'bad'}"><div class="v" style="font-size:14px">${esc(v)}</div><div class="l">${esc(k.toUpperCase())}</div></div>`).join('')}
      <div class="stat-tile ok"><div class="v" style="font-size:14px">SENTINEL ${esc(status.top.threatLevel)}</div><div class="l">SECURITY ENGINE</div></div>
    </div></div></div>`));
  const sTab = dataTable({
    cols: [
      { key: 'ref', label: 'SECRET', render: r => `<b style="font-family:var(--mono)">${esc(r.ref)}</b>` },
      { key: 'kind', label: 'KIND' },
      { key: 'location', label: 'VAULT LOCATION' },
      { key: 'masked', label: 'VALUE', render: r => `<span style="font-family:var(--mono)" class="dim">${esc(r.masked)}</span>` },
      { key: 'status', label: 'STATUS', render: r => `<span class="badge ${r.status === 'ACTIVE' ? 's-verified' : 'l5'}"><span class="dot"></span>${esc(r.status)}</span>${r.overdue ? ' <span class="badge l4"><span class="dot"></span>ROTATION OVERDUE</span>' : ''}` },
      { key: 'nextRotation', label: 'NEXT ROTATION', render: r => r.nextRotation ? `<span class="${r.nextRotation < Date.now() ? 'bad' : 'dim'}">${fmtWat(r.nextRotation).slice(0, 10)}</span>` : '—' },
      { key: '_act', label: '', render: r => canRespond() && r.status === 'ACTIVE' ? `<div class="row"><button class="btn sm" data-sec="${r.ref}" data-sa="rotate">ROTATE</button><button class="btn sm" data-sec="${r.ref}" data-sa="revoke">REVOKE</button></div>` : '' },
    ],
    rows: secrets.secrets, emptyText: 'No secrets',
  });
  sTab.setTitle('CREDENTIAL SECURITY — actual secrets are never displayed (§42) · ROTATE / REVOKE subject to approval');
  main.appendChild(sTab.el);
  $$('[data-sa]', main).forEach(b => b.onclick = () => {
    requestActionModal(b.dataset.sa === 'rotate' ? 'ROTATE_CREDENTIAL' : 'REVOKE_CREDENTIAL', b.dataset.sec, b.dataset.sec);
  });
  main.appendChild(el(`<div class="panel mt12 ${secrets.leaks.some(l => l.status === 'INVESTIGATING') ? 'soc-panel-warn' : ''}"><div class="ph"><span class="t">SECRET LEAK DETECTION (§43)</span><span class="sp dim small">logs · source repositories · configuration · error messages</span></div>
    <div class="pb">${secrets.leaks.map(l => `<div class="row mb8" style="align-items:flex-start"><div style="flex:1">
      <b style="color:${l.status === 'INVESTIGATING' ? '#fbbf24' : '#4ade80'}">${l.status === 'INVESTIGATING' ? '⚠ POTENTIAL SECRET EXPOSURE' : '✓ REMEDIATED'}</b> — ${esc(l.ref)}
      <div class="small dim">Surface: ${esc(l.surface)} · ${fmtWatShort(l.at)}</div>
      <div class="small">${esc(l.detail)}</div><div class="dim" style="font-size:10px">The secret itself is never displayed.</div>
    </div></div>`).join('') || '<div class="dim small">No exposures detected</div>'}</div></div>`));
  main.appendChild(el(`<div class="grid2 mt12">
    <div class="panel"><div class="ph"><span class="t">LAYERED DEFENCE ARCHITECTURE (§66)</span></div><div class="pb small" style="line-height:1.7;font-family:var(--mono);font-size:11px">
      <div>INTERNET → CDN / DDoS → WAF → API GATEWAY → AUTHENTICATION → APPLICATION LAYER</div>
      <div class="dim">→ SERVICES · DATABASE · STORAGE</div>
      <div>→ SECURITY LAYER → SIEM · SOC · AUDIT</div>
    </div></div>
    <div class="panel"><div class="ph"><span class="t">SECURITY DATA PIPELINE (§67)</span></div><div class="pb small" style="line-height:1.7;font-family:var(--mono);font-size:11px">
      <div>LOGS · EVENTS · METRICS · API TELEMETRY · AUTH EVENTS · NETWORK EVENTS · VULNERABILITY DATA</div>
      <div class="dim">→ COLLECTORS → NORMALIZATION → CORRELATION → DETECTION ENGINE → RISK SCORING</div>
      <div>→ SOC DASHBOARD → HUMAN RESPONSE</div>
    </div></div>
  </div>`));
}

// ---------------- tab router + boot ----------------
const RENDERS = {
  cmd: renderCmd, wall: renderWall, timeline: renderTimeline,
  threats: renderThreats, intel: renderIntel, rules: renderRules,
  incidents: renderIncidents, cases: renderCases, playbooks: renderPlaybooks,
  nodes: renderNodes, network: renderNetwork, availability: renderAvailability,
  apis: renderApis, identity: renderIdentity,
  vulns: renderVulns, patches: renderPatches, drift: renderDrift,
  db: renderDb, evidence: renderEvidence, recovery: renderRecovery,
  publicsec: renderPublicSec, apps: renderApps, irevsec: renderIrevSec,
  actions: renderActionsTab, breakglass: renderBreakGlass,
  kpis: renderKpis, trends: renderTrends, risk: renderRisk,
  audit: renderAudit, compliance: renderCompliance, system: renderSystem,
};

(async () => {
  const boot = await bootPortal('SENTINEL Security Operations Centre', 'SENTINEL', { username: 'socanalyst', password: 'SocAna@123!', demoUsers: [
    { u: 'secdirector', p: 'SecDir@123!', label: 'Security Director' },
    { u: 'socanalyst', p: 'SocAna@123!', label: 'SOC Analyst' },
    { u: 'infraengineer', p: 'InfraEng@123!', label: 'Infrastructure Engineer' },
    { u: 'apisecurity', p: 'ApiSec@123!', label: 'API Security Engineer' },
    { u: 'secinccmd', p: 'SecCmd@123!', label: 'Incident Commander' },
  ] });
  const me = boot.user;
  if (!me || !['secdirector', 'socanalyst', 'infraengineer', 'apisecurity', 'secinccmd', 'superadmin', 'auditor'].includes(me.roleId)) {
    // roles without security.view land here defensively: show an explicit access screen
    document.body.innerHTML = `<div class="login-wrap"><div class="login-card" style="text-align:center">
      <div class="big" style="color:#fbbf24">⚠</div>
      <h3 style="color:#fbbf24">SECURITY ACCESS REQUIRED</h3>
      <div class="small muted mb12">SENTINEL is restricted to authorized security roles. Your role (${esc(me.roleName)}) has no security permissions.</div>
      <a class="btn" href="/">← Back to public home</a>
    </div></div>`;
    window.__portalBooted = true;
    return;
  }
  const startTab = (new URLSearchParams(location.search).get('tab')) || 'cmd';
  shell = initShell({
    title: 'SENTINEL SOC',
    nav: NAV,
    active: startTab,
    me,
    sim: { now: boot.o ? boot.o.sim.now : Date.now(), scenario: boot.o ? boot.o.sim.scenario : 'RESULTS', paused: false },
    onNav: (id) => { const r = RENDERS[id] || renderCmd; r(shell.main).catch(err => { shell.main.innerHTML = `<div class="panel"><div class="pb" style="color:#f87171">View failed to load: ${esc(err.message)}</div></div>`; }); },
    portalTag: 'SENTINEL SOC',
  });
  // demo banner — SENTINEL variant
  const banner = $('.demo-banner');
  if (banner) banner.innerHTML = '⚠ DEMO ENVIRONMENT — simulated security telemetry for demonstration & training. Defensive monitoring and authorized response only. <a href="/">View public election portal →</a>';
  const r0 = RENDERS[startTab] || renderCmd;
  r0(shell.main).catch(err => { shell.main.innerHTML = `<div class="panel"><div class="pb" style="color:#f87171">View failed to load: ${esc(err.message)}</div></div>`; });
  // live refresh: re-render the dashboard occasionally so the telemetry feels live
  setInterval(() => {
    if (shell._active === 'cmd') { /* light refresh of the event stream only */ }
  }, 30000);
  if (window.__evHidePreloader) window.__evHidePreloader();
})();
