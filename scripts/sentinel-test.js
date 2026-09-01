// sentinel-test.js — drives SENTINEL SECURITY OPERATIONS CENTRE (server + jsdom UI)
// plus the public-domain landing page and the dedicated login page.
let jsdomMod;
try { jsdomMod = require('jsdom'); }
catch (e) {
  try { jsdomMod = require('/tmp/uitest/node_modules/jsdom'); }
  catch (e2) { console.error('jsdom not found — run: npm install (repo) or cd /tmp/uitest && npm install jsdom'); process.exit(1); }
}
const { JSDOM, VirtualConsole } = jsdomMod;
const BASE = 'http://localhost:3000';
function canvasMock(){const g={addColorStop(){}};return{fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},fillText(){},closePath(){},save(){},restore(){},scale(){},translate(){},rotate(){},clearRect(){},drawImage(){},rect(){},setLineDash(){},createLinearGradient:()=>g,createRadialGradient:()=>g,createPattern:()=>g,measureText:()=>({width:10}),set fillStyle(v){},set strokeStyle(v){},set lineWidth(v){},set font(v){},set textAlign(v){},set globalAlpha(v){}};}
async function apiLogin(u, p) {
  const l = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }).then(r => r.json());
  const m = await fetch(BASE + '/api/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: l.challenge, code: l.mfaCode }) }).then(r => r.json());
  const me = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + m.token } }).then(r => r.json());
  return { token: m.token, me };
}
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL ' + name + (extra ? ' — ' + extra : '')); } };

(async () => {
  // deterministic start: reset the simulation to a known-good fresh state
  const boot = await apiLogin('superadmin', 'Admin@123!');
  const rs = await fetch(BASE + '/api/admin/simulation', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + boot.token }, body: JSON.stringify({ action: 'reset' }) }).then(r => r.json());
  console.log('(simulation reset →', rs.scenario + ' @ ' + rs.simNow + ')');
  const auth = await apiLogin('socanalyst', 'SocAna@123!');
  const H = { Authorization: 'Bearer ' + auth.token };
  const sec = await apiLogin('secdirector', 'SecDir@123!');
  const SH = { Authorization: 'Bearer ' + sec.token };
  const incCmd = await apiLogin('secinccmd', 'SecCmd@123!');
  const IH = { Authorization: 'Bearer ' + incCmd.token };
  const aud = await apiLogin('auditor', 'Auditor@123!');
  const superAdm = await apiLogin('superadmin', 'Admin@123!');
  const obs = await apiLogin('observer', 'Observer@123!');
  const waitMs = (ms) => new Promise(r => setTimeout(r, ms));
  const J = (path, opts = {}) => fetch(BASE + '/api/sentinel' + path, { headers: opts.token ? { Authorization: 'Bearer ' + opts.token } : opts.headers || H, method: opts.method || 'GET', body: opts.body ? JSON.stringify(opts.body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

  console.log('== SENTINEL STATUS / POSTURE / THREAT (§3/4/5) ==');
  const st = await J('/status');
  ok('top command bar fields', st.json.top.systemSecurity === 'PROTECTED' && typeof st.json.top.nodesHealthy === 'number' && typeof st.json.top.apiHealth === 'number', JSON.stringify(st.json.top));
  ok('threat level GUARDED with explicit basis', st.json.threat.level === 'GUARDED' && Array.isArray(st.json.threat.basis) && st.json.threat.basis.length > 0, st.json.threat.level + ' | ' + (st.json.threat.basis || []).join(', '));
  ok('posture 0-100 + 10 traceable domains', st.json.posture.total >= 0 && st.json.posture.total <= 100 && st.json.posture.domains.length === 10 && st.json.posture.domains.every(d => d.evidence && d.score >= 0 && d.score <= 100));
  ok('election day defence priorities P1-P7', st.json.electionDay.active && st.json.electionDay.priorities.length === 7 && st.json.electionDay.priorities[0] === 'Availability');
  ok('counters (open incidents 07, alerts, pending approvals)', st.json.counters.openIncidents === 7);

  console.log('== NODES (§7/8/9) ==');
  const nodes = await J('/nodes');
  ok('14 nodes registered', nodes.json.total === 14 && nodes.json.rows.length === 14);
  ok('kind summary aggregates', nodes.json.kindSummary.healthy + nodes.json.kindSummary.degraded + nodes.json.kindSummary.warning === 14);
  const n11 = await J('/nodes?id=NODE-0011');
  ok('node detail (services, vulns, events)', Array.isArray(n11.json.node.services) && n11.json.node.services.length >= 2 && Array.isArray(n11.json.vulns) && n11.json.vulns.length >= 1 && Array.isArray(n11.json.events));
  const nodeAct = await J('/nodes/NODE-0011/action', { method: 'POST', body: { action: 'RUN_HEALTH_CHECK' } });
  ok('node action centre (low-risk executes immediately)', nodeAct.json.ok === true && nodeAct.json.action.status === 'EXECUTED');
  const nodeActBad = await J('/nodes/NODE-0011/action', { method: 'POST', body: { action: 'EXPLOIT' } });
  ok('unknown node action rejected', nodeActBad.status === 400);

  console.log('== API SECURITY (§10/12/13) ==');
  const apis = await J('/apis');
  ok('12 APIs with telemetry', apis.json.rows.length === 12 && apis.json.rows.every(a => a.requests > 0));
  ok('anomaly detection with evidence', apis.json.anomalies.length >= 1 && apis.json.anomalies.every(a => a.reasons.length > 0), 'anomalies=' + apis.json.anomalies.length);
  ok('API-PUBLIC request spike detected', apis.json.anomalies.some(a => a.api === 'API-PUBLIC' && a.reasons.some(r => r.kind === 'REQUEST_SPIKE')), JSON.stringify(apis.json.anomalies.filter(a => a.api === 'API-PUBLIC')));
  ok('rate-limit config (420 req/s, ELECTION_DAY)', apis.json.rateLimit.requestsPerSec === 420 && apis.json.rateLimit.protectionLevel === 'ELECTION_DAY');

  console.log('== EVENTS / ALERTS (§18/19) ==');
  const events = await J('/events');
  ok('live event stream', events.json.rows.length >= 10 && events.json.rows.every(e => e.title && e.createdAt));
  const alerts = await J('/alerts');
  ok('alerts with category counts (2 CRITICAL)', alerts.json.counts.CRITICAL === 2 && alerts.json.rows.length >= 10);
  const alFilt = await J('/alerts?category=API');
  ok('alert category filter', alFilt.json.rows.every(a => a.category === 'API'));
  const ack = await J('/alerts/' + alerts.json.rows.find(a => a.status === 'OPEN').id + '/ack', { method: 'POST', body: {} });
  ok('alert acknowledge (audited)', ack.json.ok && ack.json.alert.status === 'ACK');

  console.log('== INCIDENTS (§20/21/22/52/53) ==');
  const incs = await J('/incidents');
  ok('9-step workflow + 7 open', incs.json.flow.length === 9 && incs.json.openCount === 7);
  const c1 = incs.json.rows.find(i => i.status === 'DETECTED');
  const c1d = await J('/incidents/' + c1.id);
  ok('case file (timeline, related, comms)', c1d.json.case.timeline.length >= 1 && Array.isArray(c1d.json.relatedAlerts) && Array.isArray(c1d.json.comms));
  const tr = await J('/incidents/' + c1.id + '/transition', { method: 'POST', body: { status: 'TRIAGED' } });
  ok('workflow advance DETECTED→TRIAGED', tr.json.ok && tr.json.case.status === 'TRIAGED');
  const cm = await J('/incidents/' + c1.id + '/comment', { method: 'POST', body: { text: 'Correlating with auth telemetry.' } });
  ok('incident communication posted', cm.json.ok && cm.json.comms.length >= 1);
  const inv = incs.json.rows.find(i => i.status === 'INVESTIGATING');
  const badTr = await J('/incidents/' + inv.id + '/transition', { method: 'POST', body: { status: 'DETECTED' } });
  ok('workflow back-step rejected', badTr.status === 400 && badTr.json.error === 'WORKFLOW_ORDER');

  console.log('== VULNERABILITIES / PATCHES / DRIFT (§26-31) ==');
  const vul = await J('/vulns');
  ok('portfolio counts (02 CRITICAL / 219 PATCHED)', vul.json.totals.critical === 2 && vul.json.totals.patched === 219 && vul.json.rows.length >= 8);
  ok('scan history trend 20 points', vul.json.scanHistory.length === 20);
  const vUpd = await J('/vulns/VUL-0001/status', { method: 'POST', body: { status: 'IN_PROGRESS' } });
  ok('vulnerability status update', vUpd.json.ok && vUpd.json.vuln.status === 'IN_PROGRESS');
  const vAcc = await J('/vulns/VUL-0005/status', { method: 'POST', body: { status: 'ACCEPTED_RISK', riskAcceptance: 'Cache network-isolated' } });
  ok('risk acceptance with justification', vAcc.json.ok && vAcc.json.vuln.riskAcceptance);
  const pat = await J('/patches');
  ok('patch command counts', pat.json.counts.pending >= 2 && pat.json.counts.failed === 1);
  const pAct = await J('/patches/PT-0001/action', { method: 'POST', body: { action: 'approve' } });
  ok('patch approve action', pAct.json.ok && pAct.json.patch.status === 'APPROVED');
  const cfg = await J('/config');
  ok('configuration drift + BEFORE/AFTER + who/when/why', cfg.json.drift.length >= 4 && cfg.json.drift.every(d => d.before && d.after && d.who && d.why));
  ok('FIM monitored files + change detected', cfg.json.files.length >= 7 && cfg.json.filesChanged >= 2 && cfg.json.driftOpen === 1);

  console.log('== DATABASE / EVIDENCE / IReV (§32-36) ==');
  const db = await J('/db');
  ok('database security (alerts, encryption)', db.json.alerts.length >= 4 && /AES-256/.test(db.json.encryption));
  const ev = await J('/evidence');
  ok('evidence store integrity intact', ev.json.integrity === 'INTACT' && ev.json.filesTracked >= 0);
  const evVerify = await J('/evidence/verify', { method: 'POST', body: {} });
  ok('hash verification executed', evVerify.json.ok && evVerify.json.lastFullVerification);
  const evForbid = await J('/evidence/simulate-event', { method: 'POST', body: { evidenceId: 'EVD-X' } });
  ok('evidence demo event requires security.privileged (403)', evForbid.status === 403);
  const evDemo = await J('/evidence/simulate-event', { method: 'POST', token: sec.token, body: { evidenceId: 'EVD-DEMO-99' } });
  ok('demo integrity event → BREACHED + failsafe', evDemo.json.ok && evDemo.json.demo);
  const st2 = await J('/status');
  ok('integrity breach reflected in status', st2.json.evidence.integrity === 'BREACHED' && st2.json.counters.openIncidents === 8);
  const irevSec = await J('/irev');
  ok('IReV connector security', irevSec.json.connector === 'ONLINE' && irevSec.json.hashVerification === 'PASSING' && irevSec.json.observations > 0);

  console.log('== IDENTITY / SESSIONS / NETWORK / SECRETS (§14/15/40-43) ==');
  const idn = await J('/identity');
  ok('identity metrics + MFA coverage 100%', idn.json.mfaCoverage === 100 && idn.json.sessions.length >= 5 && idn.json.failedLogins >= 0);
  const term = await J('/sessions/SES-0004/terminate', { method: 'POST', body: {} });
  ok('compromised session terminated', term.json.ok && term.json.session.active === false);
  const net = await J('/network');
  ok('TLS monitor incl expiring cert', net.json.tls.length >= 3 && net.json.tls.some(t => t.status === 'EXPIRING_SOON'));
  const secrets = await J('/secrets');
  ok('secrets masked — never displayed', secrets.json.secrets.length >= 8 && secrets.json.secrets.every(s => s.masked === '••••••••••••' && !s.value));
  ok('secret leak detection', secrets.json.leaks.length >= 1 && secrets.json.leaks.some(l => l.status === 'INVESTIGATING'));
  const rot = await J('/secrets/SECRET-0001/action', { method: 'POST', body: { action: 'rotate' } });
  ok('credential rotation requires approval flow', rot.json.action && rot.json.action.status === 'REQUESTED');

  console.log('== LOG CENTRE / AUTOMATION / PLAYBOOKS (§44/45/46/51) ==');
  const lg = await J('/logs?q=NODE-0011');
  ok('log search by target', lg.json.rows.length > 0 && lg.json.rows.every(r => (r.target || '').includes('NODE-0011') || (r.what || '').includes('NODE-0011')));
  const lgExp = await fetch(BASE + '/api/sentinel/logs/export', { headers: H }).then(r => r.text());
  ok('CSV export with header', lgExp.includes('kind,who,what,when,target'));
  const evt = events.json.rows[0];
  const mkCase = await J('/logs/create-case', { method: 'POST', body: { eventId: evt.id } });
  ok('create case from log entry', mkCase.json.ok && mkCase.json.case.code.startsWith('SEC-2027-'));
  const auto = await J('/automation');
  ok('automation rules (IF/THEN, logged)', auto.json.rules.length >= 4 && auto.json.rules.every(r => r.when && r.then.length > 0));
  const togForbid = await J('/automation/RULE-0001/toggle', { method: 'POST', body: {} });
  ok('rule toggle requires security.privileged', togForbid.status === 403);
  const togOk = await J('/automation/RULE-0001/toggle', { method: 'POST', token: sec.token, body: {} });
  ok('privileged rule toggle', togOk.json.ok);
  const pb = await J('/playbooks');
  ok('11 response playbooks with defensive steps', pb.json.playbooks.length === 11 && pb.json.playbooks.every(p => p.steps.length >= 5));
  const pbAct = await J('/playbooks/pb-evidence-integrity/activate', { method: 'POST', body: { target: 'NODE-0008' } });
  ok('playbook activation opens case', pbAct.json.ok && pbAct.json.case.status === 'ASSIGNED' && pbAct.json.case.code.startsWith('SEC-2027-'));

  console.log('== ACTION CENTRE (§47/49/50/16) ==');
  const cat = await J('/action-catalog');
  ok('25-action catalog with risk/reversible/approval', Object.keys(cat.json.catalog).length >= 25 && cat.json.catalog.ISOLATE_NODE.risk === 'HIGH' && cat.json.catalog.PRODUCTION_SHUTDOWN.approval === 'DUAL' && cat.json.catalog.ACK_ALERT.risk === 'LOW');
  const forb = await J('/actions/request', { method: 'POST', token: aud.token, body: { action: 'ISOLATE_NODE', target: 'NODE-0001' } });
  ok('auditor blocked from requesting actions (403)', forb.status === 403);
  const req1 = await J('/actions/request', { method: 'POST', body: { action: 'ISOLATE_NODE', target: 'NODE-0003', detail: 'Test isolation flow' } });
  ok('HIGH action requested → REQUESTED (SINGLE approval)', req1.json.action.status === 'REQUESTED' && req1.json.action.approval === 'SINGLE' && req1.json.requiresApproval);
  const appr1 = await J('/actions/' + req1.json.action.id + '/approve', { method: 'POST', token: sec.token, body: { note: 'Approved for test' } });
  ok('director approves', appr1.json.action.status === 'APPROVED' && appr1.json.action.approvedBy);
  const ex1 = await J('/actions/' + req1.json.action.id + '/execute', { method: 'POST', body: {} });
  ok('execute records BEFORE/AFTER', ex1.json.action.status === 'EXECUTED' && ex1.json.action.before && ex1.json.action.after && ex1.json.action.after.status === 'ISOLATED');
  const n3 = await J('/nodes?id=NODE-0003');
  ok('NODE-0003 isolated in registry', n3.json.node.status === 'ISOLATED');
  const rb1 = await J('/actions/' + req1.json.action.id + '/rollback', { method: 'POST', token: sec.token, body: {} });
  ok('automated rollback restores node', rb1.json.action.status === 'ROLLED_BACK');
  const n3b = await J('/nodes?id=NODE-0003');
  ok('node restored to pre-action state', n3b.json.node.status === 'HEALTHY');
  // dual authorization
  const req2 = await J('/actions/request', { method: 'POST', token: sec.token, body: { action: 'PRODUCTION_SHUTDOWN', target: 'ALL-APIS', detail: 'DR exercise' } });
  ok('CRITICAL action → DUAL authorization', req2.json.action.approval === 'DUAL' && req2.json.action.status === 'REQUESTED');
  const selfAppr = await J('/actions/' + req2.json.action.id + '/approve', { method: 'POST', token: sec.token, body: { note: 'self' } });
  ok('requester cannot self-approve DUAL action', selfAppr.status === 400 && selfAppr.json.error === 'SECOND_APPROVER_REQUIRED');
  const appr2a = await J('/actions/' + req2.json.action.id + '/approve', { method: 'POST', token: incCmd.token, body: { note: 'first approver' } });
  ok('first approver → PENDING_DUAL', appr2a.json.pendingDual === true && appr2a.json.action.status === 'PENDING_DUAL');
  const appr2b = await J('/actions/' + req2.json.action.id + '/approve', { method: 'POST', token: superAdm.token, body: { note: 'second approver (independent)' } });
  ok('second approver → APPROVED', appr2b.json.action.status === 'APPROVED' && appr2b.json.action.approvals.length === 2);
  const rej = await J('/actions/request', { method: 'POST', body: { action: 'BLOCK_COMPONENT', target: 'NODE-0004', detail: 'test reject' } });
  const rejR = await J('/actions/' + rej.json.action.id + '/reject', { method: 'POST', token: sec.token, body: { note: 'Not required' } });
  ok('rejection flow → NOT EXECUTED', rejR.json.action.status === 'REJECTED');

  console.log('== BREAK-GLASS (§48) ==');
  const bgBad = await J('/breakglass/open', { method: 'POST', body: { reason: 'short' } });
  ok('reason required (min 10 chars)', bgBad.status === 400 && bgBad.json.error === 'REASON_REQUIRED');
  const bgOk = await J('/breakglass/open', { method: 'POST', body: { reason: 'Emergency DB recovery access required', incidentId: 'SEC-2027-000414', minutes: 20 } });
  ok('emergency session with expiry + audit', bgOk.json.ok && bgOk.json.session.expiresAt > Date.now() && bgOk.json.session.minutes === 20);

  console.log('== ANALYTICS / KPIs / COMPLIANCE / RISK (§55-58) ==');
  const an = await J('/analytics');
  ok('analytics: threats by hour + MTTD/MTTA/MTTC/MTTR', an.json.threatsByHour.length === 24 && an.json.kpis.mttd >= 0 && an.json.kpis.mttr >= 0);
  const kp = await J('/kpis');
  ok('8 security KPIs', kp.json && Object.keys(kp.json).length === 8 && kp.json.mttd && kp.json.mttd.label === 'Mean Time to Detect', JSON.stringify(kp.json).slice(0, 120));
  const comp = await J('/compliance');
  ok('compliance controls (COMPLIANT/PARTIAL)', comp.json.controls.length >= 9 && comp.json.controls.some(c => c.status === 'PARTIAL'));
  const risk = await J('/risk');
  ok('risk register with scores', risk.json.rows.length >= 7 && risk.json.rows.every(r => r.score >= 2 && r.score <= 25));
  const riskAdd = await J('/risk', { method: 'POST', body: { risk: 'Test risk entry', asset: 'NODE-0002', probability: 'HIGH', impact: 'CRITICAL', treatment: 'AVOID' } });
  ok('risk add computes score 30 (5×6)', riskAdd.json.row.score === 30);

  console.log('== EXECUTIVE / TIMELINE / APPS / WALL / AUDIT (§59/60/63/65/68) ==');
  const ex = await J('/executive');
  ok('executive cards + top-5 attention', Object.keys(ex.json.cards).length === 7 && ex.json.attention.length <= 5, 'cards=' + Object.keys(ex.json.cards || {}).join(',') + ' | attn=' + (ex.json.attention || []).length);
  const tl = await J('/timeline?filter=INCIDENTS');
  ok('timeline filter', tl.json.rows.length > 0 && tl.json.rows.every(r => r.kind === 'INCIDENT'));
  const apps = await J('/apps');
  ok('application coverage (7 apps)', apps.json.rows.length === 7 && apps.json.surface.monitoredNodes === 14);
  // the live tick recomputes the threat level each second — wait for the breach to propagate
  let tickOk = false, tickBasis = '';
  for (let i = 0; i < 20; i++) {
    const s3 = await J('/status');
    if (s3.json.threat.level === 'CRITICAL') { tickOk = true; break; }
    tickBasis = (s3.json.threat.basis || []).join(', ');
    await waitMs(500);
  }
  ok('live tick propagates evidence breach → threat CRITICAL', tickOk, tickBasis);
  const wall = await J('/wall');
  ok('command wall (PROTECTED · CRITICAL · 10 open · 1 open CRITICAL vuln after status update)', wall.json.systemSecurity === 'PROTECTED' && wall.json.threatLevel === 'CRITICAL' && wall.json.activeIncidents === '10' && wall.json.criticalVulns === '01', JSON.stringify({ sec: wall.json.systemSecurity, lvl: wall.json.threatLevel, inc: wall.json.activeIncidents, vul: wall.json.criticalVulns }));
  const audAudit = await J('/audit');
  ok('audit requires security.audit (SOC analyst 403)', audAudit.status === 403);
  const audAudit2 = await J('/audit', { token: aud.token });
  ok('immutable security audit (auditor)', audAudit2.json.immutable && audAudit2.json.rows.length > 0 && audAudit2.json.rows.some(r => r.what === 'ACTION_EXECUTED'));

  console.log('== ELECTION MODE / THREAT OVERRIDE / RECOVERY (§69/5/72) ==');
  const edm = await J('/election-mode', { method: 'POST', token: sec.token, body: { enabled: false } });
  ok('election-day defence mode toggle', edm.json.ok && edm.json.electionDay === false);
  await J('/election-mode', { method: 'POST', token: sec.token, body: { enabled: true } });
  const tlSet = await J('/threat-level', { method: 'POST', token: sec.token, body: { level: 'HIGH', reason: 'Evidence breach under investigation' } });
  ok('analyst threat override with reason', tlSet.json.ok && tlSet.json.threatLevel === 'HIGH' && tlSet.json.basis.some(b => /Analyst decision/.test(b)));
  const tlNo = await J('/threat-level', { method: 'POST', token: sec.token, body: { level: 'NORMAL', reason: 'x' } });
  ok('lower override without reason is not applied', tlNo.json.threatLevel !== 'NORMAL' && ['CRITICAL', 'HIGH'].includes(tlNo.json.threatLevel), tlNo.json.threatLevel);
  const rec = await J('/recovery');
  ok('recovery centre (backup, DR, restore test)', rec.json.backupSuccess > 0 && /PASSED/.test(rec.json.restoreTest));
  const recV = await J('/recovery/action', { method: 'POST', body: { action: 'verify' } });
  ok('verify backup executes (low risk)', recV.json.action.status === 'EXECUTED');

  console.log('== COPILOT (§61/62) ==');
  const cop = async (q, token) => J('/copilot', { method: 'POST', token, body: { q } });
  const cop1 = await cop('What are the most critical security issues right now?', sec.token);
  ok('copilot critical issues', /Most critical|critical security/.test(cop1.json.answer));
  const cop2 = await cop('Show all compromised or isolated nodes.', sec.token);
  ok('copilot isolated nodes', /nodes|None/.test(cop2.json.answer));
  const cop3 = await cop('Prepare a security incident briefing.', sec.token);
  ok('copilot briefing', /BRIEFING/.test(cop3.json.answer) && /Posture/.test(cop3.json.answer));
  const cop4 = await cop('Block this source.', sec.token);
  ok('copilot PROPOSES actions — never executes (§62)', /Proposed Action/.test(cop4.json.answer) && /Approval: Required/.test(cop4.json.answer) && /never execute/.test(cop4.json.answer));

  console.log('== RBAC BOUNDARIES ==');
  const obsSt = await J('/status', { token: obs.token });
  ok('observer without security.view blocked (403)', obsSt.status === 403);
  const audSt = await J('/status', { token: aud.token });
  ok('auditor can view status', audSt.status === 200 && audSt.json.top.systemSecurity === 'PROTECTED');
  const unauth = await fetch(BASE + '/api/sentinel/status').then(r => r.status);
  ok('unauthenticated blocked (401)', unauth === 401);

  // ================= UI: SENTINEL portal (jsdom) =================
  console.log('== UI: /sentinel SOC DASHBOARD ==');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String(e.message).split('\n')[0]));
  vc.on('error', (...a) => errors.push(String(a[0]).slice(0, 140)));
  const html = await fetch(BASE + '/sentinel').then(r => r.text());
  const dom = new JSDOM(html, {
    url: BASE + '/sentinel', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.localStorage.setItem('ndc_token', auth.token); w.localStorage.setItem('ndc_user', JSON.stringify(auth.me.user)); w.localStorage.setItem('ndc_perms', JSON.stringify(auth.me.permissions)); },
  });
  const w = dom.window;
  w.fetch = (i, o) => fetch(String(i).startsWith('http') ? String(i) : BASE + String(i), o);
  w.EventSource = class { constructor(u) { } close() { } };
  w.HTMLCanvasElement.prototype.getContext = function () { return canvasMock(); };
  w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,AAAA'; };
  w.requestAnimationFrame = (fn) => setTimeout(fn, 50);
  w.cancelAnimationFrame = (t) => clearTimeout(t);
  const $ = (s, r) => w.document.querySelector(s);
  const $$ = (s, r) => Array.from((r || w.document).querySelectorAll(s));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const bodyText = () => w.document.body.textContent.replace(/\s+/g, ' ');
  const navTo = async (id) => { const b = $$('#sidebar .nav-item[data-nav]').find(x => x.dataset.nav === id); if (!b) { console.log('   (nav item missing: ' + id + ')'); return false; } b.click(); await sleep(700); return true; };
  await sleep(3500);
  ok('SOC shell rendered', !!$('.app') && !!$('#sidebar'));
  ok('top command bar (§3)', bodyText().includes('SYSTEM SECURITY') && bodyText().includes('PROTECTED') && bodyText().includes('THREAT LEVEL') && bodyText().includes('ACTIVE INCIDENTS') && bodyText().includes('CRITICAL VULNERABILITIES'));
  ok('security posture 10 domains (§4)', $$('[data-dom]').length === 10 && bodyText().includes('SECURITY POSTURE'));
  ok('threat level indicator with 5 levels (§5)', $$('.soc-levels .sl').length === 5);
  ok('live infrastructure map nodes (§6)', $$('#main svg circle[data-node]').length >= 1);
  ok('critical alerts + live events + attention', bodyText().includes('CRITICAL ALERTS') && bodyText().includes('LIVE SECURITY EVENT STREAM') && bodyText().includes('WHAT REQUIRES ATTENTION'));
  ok('infrastructure health strip (14 node chips)', $$('.nodechip[data-node]').length === 14);
  ok('security KPIs cards (§56)', bodyText().includes('MEAN TIME TO DETECT') && bodyText().includes('MEAN TIME TO RECOVER'));
  ok('election day defence mode (§69)', bodyText().includes('ELECTION DAY DEFENCE MODE') && bodyText().includes('P1: Availability'));
  ok('SENTINEL copilot panel (§61)', bodyText().includes('SENTINEL COPILOT'));
  ok('nav groups per §64 (COMMAND/THREATS/… )', bodyText().includes('◉ COMMAND') && bodyText().includes('◉ THREATS') && bodyText().includes('◉ RESPONSE') && bodyText().includes('◉ GOVERNANCE'));
  ok('30+ nav items', $$('#sidebar .nav-item[data-nav]').length >= 30, 'nav=' + $$('#sidebar .nav-item[data-nav]').length);
  ok('no runtime errors on dashboard', errors.length === 0, errors.join('; ').slice(0, 300));

  ok('wall renders bigstrip + priorities', await navTo('wall') && $$('.sw-cell').length === 7 && bodyText().includes('ELECTION DAY DEFENCE MODE'));
  ok('timeline renders with filters', await navTo('timeline') && $$('[data-f]').length === 8 && $$('#tlb .item').length > 0);
  ok('threat monitor renders', await navTo('threats') && bodyText().includes('THREAT LEVEL') && bodyText().includes('CORRELATION ENGINE'));
  ok('intel dashboard cards (§24)', await navTo('intel') && bodyText().includes('ACTIVE THREATS') && bodyText().includes('INDICATOR REGISTER'));
  ok('detection rules IF/THEN (§46)', await navTo('rules') && bodyText().includes('AUTOMATED DEFENCE') && bodyText().includes('IF'));
  ok('incidents table + workflow pills (§20)', await navTo('incidents') && bodyText().includes('SECURITY INCIDENT COMMAND') && $$('#main .tbl tbody tr').length >= 7);
  ok('case workspace opens from row (§52)', await (async () => { const row = $('#main .tbl tbody tr.clickable'); if (!row) return false; row.click(); await sleep(900); for (let i = 0; i < 5; i++) { const t = bodyText(); if (t.includes('Incident timeline') && t.includes('Case communications')) return true; await sleep(400); } return false; })());
  { const ov = $('.overlay'); if (ov) { const x = $$('.overlay .mf .btn').pop(); if (x) x.click(); await sleep(200); } }
  ok('playbooks activate buttons (§51)', await navTo('playbooks') && $$('#main [data-pb]').length === 11);
  ok('nodes table (§7)', await navTo('nodes') && bodyText().includes('INFRASTRUCTURE NODES') && $$('#main .tbl tbody tr').length >= 14);
  ok('node detail modal + action centre (§8/9)', await (async () => { const row = $('#main .tbl tbody tr.clickable'); if (!row) return false; row.click(); await sleep(800); const t = bodyText(); return t.includes('NODE COMMAND') && t.includes('Node action centre') && t.includes('Resource utilization'); })());
  { const ov = $('.overlay'); if (ov) { const x = $$('.overlay .mf .btn').pop(); if (x) x.click(); await sleep(200); } }
  ok('network + TLS expiring alert (§41)', await navTo('network') && bodyText().includes('CERTIFICATE EXPIRING IN 14 DAYS'));
  ok('availability + WAF (§38/39)', await navTo('availability') && bodyText().includes('WAF COMMAND') && bodyText().includes('CDN STATUS'));
  ok('API monitor with anomalies (§10/12)', await navTo('apis') && bodyText().includes('ANOMALY DETECTED') && bodyText().includes('API COMMUNICATION MAP'));
  ok('identity + privileged sessions (§15)', await navTo('identity') && bodyText().includes('PRIVILEGED ACCESS MONITORING') && bodyText().includes('RISK STATUS'));
  ok('vulnerability centre (02 CRITICAL) (§27)', await navTo('vulns') && bodyText().includes('VULNERABILITY CENTRE') && bodyText().includes('VULNERABILITIES OVER TIME'));
  ok('patch command (§29)', await navTo('patches') && bodyText().includes('PATCH COMMAND') && bodyText().includes('SCHEDULE'));
  ok('configuration drift BEFORE→AFTER (§30)', await navTo('drift') && bodyText().includes('CONFIGURATION CHANGE DETECTED') && bodyText().includes('BEFORE:') && bodyText().includes('CONFIGURATION INTEGRITY'));
  ok('database security (§32)', await navTo('db') && bodyText().includes('DATABASE SECURITY') && bodyText().includes('DATABASE ACCESS ALERTS'));
  ok('evidence store security (§34)', await navTo('evidence') && bodyText().includes('EVIDENCE SECURITY') && bodyText().includes('HASHES VERIFIED'));
  ok('recovery centre (§72)', await navTo('recovery') && bodyText().includes('RECOVERY CENTRE') && bodyText().includes('VERIFY BACKUP'));
  ok('public domain security + WAF (§37)', await navTo('publicsec') && bodyText().includes('PUBLIC PLATFORM SECURITY') && bodyText().includes('WEB APPLICATION FIREWALL'));
  ok('application coverage (§65)', await navTo('apps') && bodyText().includes('APPLICATION SECURITY COVERAGE') && bodyText().includes('IReV WATCHTOWER'));
  ok('IReV security (§36)', await navTo('irevsec') && bodyText().includes('IReV WATCHTOWER SECURITY') && bodyText().includes('INGESTION INTEGRITY'));
  ok('action centre catalog + ledger (§47)', await navTo('actions') && bodyText().includes('SECURITY ACTION CENTRE') && bodyText().includes('LOW RISK') && bodyText().includes('DUAL AUTHORIZATION REQUIRED') && bodyText().includes('ACTION LEDGER'));
  ok('break-glass with reason enforcement (§48)', await navTo('breakglass') && bodyText().includes('EMERGENCY ACCESS'));
  ok('KPIs tab (§56)', await navTo('kpis') && bodyText().includes('PATCH COMPLIANCE') && bodyText().includes('MFA COVERAGE'));
  ok('trends tab charts (§55)', await navTo('trends') && bodyText().includes('THREATS BY HOUR') && bodyText().includes('ALERTS BY SEVERITY'));
  ok('risk register (§58)', await navTo('risk') && bodyText().includes('RISK REGISTER') && bodyText().includes('TREATMENT'));
  ok('audit & logs with filters (§44)', await navTo('audit') && bodyText().includes('CENTRAL SECURITY LOG') && bodyText().includes('EXPORT CSV') && bodyText().includes('FILTER'));
  ok('compliance (§57)', await navTo('compliance') && bodyText().includes('SECURITY COMPLIANCE') && bodyText().includes('COMPLIANT'));
  ok('system + secrets masked (§42/66/67)', await navTo('system') && bodyText().includes('CREDENTIAL SECURITY') && bodyText().includes('••••••••••••') && bodyText().includes('LAYERED DEFENCE ARCHITECTURE'));

  // ================= UI: role without security.view =================
  console.log('== UI: SENTINEL access control ==');
  const dom2 = new JSDOM(await fetch(BASE + '/sentinel').then(r => r.text()), {
    url: BASE + '/sentinel', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w2) { w2.localStorage.setItem('ndc_token', obs.token); w2.localStorage.setItem('ndc_user', JSON.stringify(obs.me.user)); w2.localStorage.setItem('ndc_perms', JSON.stringify(obs.me.permissions)); },
  });
  const w2 = dom2.window;
  w2.fetch = (i, o) => fetch(String(i).startsWith('http') ? String(i) : BASE + String(i), o);
  w2.EventSource = class { constructor(u) { } close() { } };
  await sleep(3000);
  ok('observer sees SECURITY ACCESS REQUIRED screen', w2.document.body.textContent.includes('SECURITY ACCESS REQUIRED'));

  // ================= UI: landing page (public domain) =================
  console.log('== UI: / public domain landing ==');
  const domL = new JSDOM(await fetch(BASE + '/').then(r => r.text()), {
    url: BASE + '/', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(wL) {
      wL.fetch = (i, o) => fetch(String(i).startsWith('http') ? String(i) : BASE + String(i), o);
      wL.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
    },
  });
  const wL = domL.window;
  await sleep(2500);
  const tL = wL.document.body.textContent.replace(/\s+/g, ' ');
  ok('public tagline (§brand)', tL.includes('See the Evidence. Follow the Process. Understand the Election.'));
  ok('DEMO disclaimer visible', tL.includes('DEMO ENVIRONMENT — SIMULATED DATA — NOT OFFICIAL ELECTION RESULTS'));
  ok('SIGN IN button in header → /login', (() => { const a = wL.document.querySelector('.ph-head a[href="/login"]'); return !!a && a.textContent.includes('SIGN IN'); })());
  ok('login dock fixed at bottom', (() => { const d = wL.document.querySelector('.login-dock a[href="/login"]'); return !!d && d.textContent.includes('SIGN IN'); })());
  ok('6 live KPI tiles rendered with data', (() => { const tiles = wL.document.querySelectorAll('#kpis .ph-tile .v'); return tiles.length === 6 && tiles[0] && tiles[0].textContent !== '—' && !tL.includes('Loading public monitoring data'); })());
  ok('result observatory — senatorial districts', wL.document.querySelectorAll('#senresults .dist-row').length === 3);
  ok('governorship monitored vote share', wL.document.querySelectorAll('#govresults .dist-row').length > 0);
  ok('incident monitor chips', wL.document.querySelectorAll('#incmon .inc-chip').length > 0);
  ok('IReV watch status', tL.includes('Source status:') && tL.includes('Pending uploads:'));
  ok('authorized command portals grid (9 cards)', wL.document.querySelectorAll('#pgrid .lcard').length === 9);
  ok('SENTINEL SOC card present', tL.includes('SENTINEL SOC'));
  ok('Kano LGA map polygons rendered', wL.document.querySelectorAll('#heromap polygon').length >= 40);
  ok('footer carries NOT OFFICIAL disclaimer', tL.includes('DEMO DATA — NOT OFFICIAL ELECTION RESULTS'));

  // ================= UI: login page (clickable demo credentials) =================
  console.log('== UI: /login page ==');
  const domG = new JSDOM(await fetch(BASE + '/login').then(r => r.text()), {
    url: BASE + '/login', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(wG) {
      wG.fetch = (i, o) => fetch(String(i).startsWith('http') ? String(i) : BASE + String(i), o);
      wG.EventSource = class { constructor(u) { } close() { } };
      wG.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
    },
  });
  const wG = domG.window;
  await sleep(2000);
  const tG = wG.document.body.textContent.replace(/\s+/g, ' ');
  ok('login card rendered', !!wG.document.getElementById('lu') && !!wG.document.getElementById('lp'));
  ok('clickable demo credential groups (5 groups)', wG.document.querySelectorAll('.lp-group').length === 5);
  ok('20+ demo credential chips', wG.document.querySelectorAll('.lp-group .chip[data-fill]').length >= 20, 'chips=' + wG.document.querySelectorAll('.lp-group .chip[data-fill]').length);
  ok('chip click fills the sign-in form', (() => {
    const chip = wG.document.querySelector('.chip[data-fill="secdirector"]');
    if (!chip) return false;
    chip.click();
    const lu = wG.document.getElementById('lu'), lp = wG.document.getElementById('lp');
    return lu.value === 'secdirector' && lp.value === 'SecDir@123!';
  })());
  ok('login card also lists demo chips (demoUsers)', wG.document.querySelectorAll('#demochips .chip').length >= 20);
  ok('public home link present', tG.includes('Public election monitoring home'));

  console.log('\\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST FAILURE', e); process.exit(1); });
