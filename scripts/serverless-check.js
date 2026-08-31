// serverless-check.js — exercises api/index.js exactly as Vercel will:
// a fresh boot via boot(), requests served by handleRequest, plus a simulated
// instance recycle (in-memory sessions lost → HMAC-signed tokens must still work).
'use strict';
process.env.VERCEL = '1'; // force serverless behaviour (SSE 501, asset caching, health flag)
const http = require('http');
const path = require('path');
const ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'api/index.js')); // loads the vercel handler module
const { handleRequest, boot } = require(path.join(ROOT, 'server/server.js'));
const store = require(path.join(ROOT, 'server/lib/store'));

const PORT = 3100;
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (x ? ' — ' + x : '')); } };
const req = (method, p, headers = {}, body = null) => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (res) => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  });
  r.on('error', reject);
  if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body));
  r.end();
});
const j = (o) => { try { return JSON.parse(o.text); } catch (e) { return null; } };
async function login(u, p) {
  const l = j(await req('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, { username: u, password: p }));
  const m = j(await req('POST', '/api/auth/mfa', { 'Content-Type': 'application/json' }, { challenge: l.challenge, code: l.mfaCode }));
  return m;
}

(async () => {
  boot(); // simulate Vercel cold start boot (idempotent — the handler calls it too)
  const server = http.createServer((q, s) => { handleRequest(q, s).catch(e => { console.error('handler error', e); s.writeHead(500); s.end('error'); }); });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  console.log('== SERVERLESS MODE (VERCEL=1) ==');

  const health = j(await req('GET', '/api/health'));
  ok('health reports serverless:true', health.serverless === true, JSON.stringify(health).slice(0, 100));

  const home = await req('GET', '/');
  ok('landing page served (200, public domain)', home.status === 200 && home.text.includes('THE ELECTION') && home.text.includes('PUBLIC MONITORING DOMAIN'));
  const loginPage = await req('GET', '/login');
  ok('login page served (extensionless → .html)', loginPage.status === 200 && loginPage.text.includes('Secure sign-in'));
  const sentinel = await req('GET', '/sentinel');
  ok('sentinel page served', sentinel.status === 200 && sentinel.text.includes('SENTINEL'));
  const central = await req('GET', '/central');
  ok('central page served', central.status === 200 && central.text.includes('Central Situation Room'));

  const css = await req('GET', '/assets/css/theme.css');
  ok('static asset served', css.status === 200 && css.text.includes('SENTINEL SOC'));
  ok('assets cached on serverless (public, max-age)', /public, max-age=3600/.test(css.headers['cache-control'] || ''), css.headers['cache-control']);
  const apiJs = await req('GET', '/assets/js/api.js');
  ok('JS asset served', apiJs.status === 200 && apiJs.text.includes('safeStore'));

  const sse = j(await req('GET', '/api/events'));
  ok('SSE disabled on serverless (501 SSE_DISABLED)', sse && sse.error === 'SSE_DISABLED');

  const stats = j(await req('GET', '/api/public/statistics'));
  ok('public statistics API works', stats && stats.kpis && stats.kpis.totalPu === 1476 && stats.senatorial.length === 3);

  // full login flow through the serverless handler
  const m = await login('socanalyst', 'SocAna@123!');
  ok('MFA login works on serverless', !!m.token && m.token.includes('.'), 'token has 3 signed parts');
  const me = j(await req('GET', '/api/me', { Authorization: 'Bearer ' + m.token }));
  ok('/api/me works with signed token', me && me.user && me.user.username === 'socanalyst' && me.permissions.includes('security.view'));

  const st = j(await req('GET', '/api/sentinel/status', { Authorization: 'Bearer ' + m.token }));
  ok('SENTINEL status API works', st && st.top.systemSecurity === 'PROTECTED' && st.posture.domains.length === 10);

  // ---- simulate instance recycle: wipe the in-memory session store ----
  console.log('== INSTANCE RECYCLE (sessions lost) ==');
  const stObj = store.S();
  for (const k of Object.keys(stObj.sessions)) delete stObj.sessions[k];
  const me2 = j(await req('GET', '/api/me', { Authorization: 'Bearer ' + m.token }));
  ok('session survives instance recycle (signed fallback)', me2 && me2.user && me2.user.username === 'socanalyst', me2 ? JSON.stringify(me2).slice(0, 80) : 'null');
  const st2 = j(await req('GET', '/api/sentinel/status', { Authorization: 'Bearer ' + m.token }));
  ok('privileged API still works after recycle', st2 && st2.top.systemSecurity === 'PROTECTED');

  // tampered token must be rejected
  const forged = m.token.slice(0, -4) + 'aaaa';
  const me3 = await req('GET', '/api/me', { Authorization: 'Bearer ' + forged });
  ok('tampered token rejected (401)', me3.status === 401, 'status=' + me3.status);

  // per-instance mutations work within the instance
  const al = j(await req('GET', '/api/sentinel/alerts', { Authorization: 'Bearer ' + m.token }));
  const openAlert = al.rows.find(a => a.status === 'OPEN');
  const ack = j(await req('POST', '/api/sentinel/alerts/' + openAlert.id + '/ack', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + m.token }, {}));
  ok('per-instance mutations work (alert ack)', ack && ack.ok === true && ack.alert.status === 'ACK');

  const secDirector = await login('secdirector', 'SecDir@123!');
  const actionReq = j(await req('POST', '/api/sentinel/actions/request', { 'Content-Type': 'application/json', Authorization: 'Bearer ' + secDirector.token }, { action: 'ISOLATE_NODE', target: 'NODE-0011', detail: 'serverless test' }));
  ok('action request flow works', actionReq && actionReq.action && actionReq.action.status === 'REQUESTED' && actionReq.action.approval === 'SINGLE');

  // ---- simulate a FULL cold start: wipe all state and re-seed (new instance) ----
  console.log('== COLD START (full wipe + re-seed, new instance) ==');
  const stBefore = store.S();
  const tokenBefore = m.token;
  const challengeTest = await (async () => {
    // issue a challenge on "this instance", then wipe memory BEFORE verifying it
    const l2 = j(await req('POST', '/api/auth/login', { 'Content-Type': 'application/json' }, { username: 'superadmin', password: 'Admin@123!' }));
    return l2;
  })();
  store.reset();               // fresh state object — in-memory sessions/challenges all gone
  const { seedStatic } = require(path.join(ROOT, 'server/lib/seed.js'));
  seedStatic();                // re-seed like a brand-new instance
  const meCold = j(await req('GET', '/api/me', { Authorization: 'Bearer ' + tokenBefore }));
  ok('token issued pre-wipe still authenticates after cold start (deterministic user ids)', meCold && meCold.user && meCold.user.username === 'socanalyst', meCold ? JSON.stringify(meCold).slice(0, 100) : 'null');
  const stCold = j(await req('GET', '/api/sentinel/status', { Authorization: 'Bearer ' + tokenBefore }));
  ok('privileged API works after cold start', stCold && stCold.top.systemSecurity === 'PROTECTED');
  const mfaCold = j(await req('POST', '/api/auth/mfa', { 'Content-Type': 'application/json' }, { challenge: challengeTest.challenge, code: challengeTest.mfaCode }));
  ok('MFA challenge issued pre-wipe verifies after cold start (signed challenge)', mfaCold && mfaCold.token && mfaCold.user.username === 'superadmin', mfaCold ? JSON.stringify({ err: mfaCold.error, u: mfaCold.user && mfaCold.user.username }).slice(0, 120) : 'null');
  const adminMe = j(await req('GET', '/api/me', { Authorization: 'Bearer ' + (mfaCold && mfaCold.token) }));
  ok('superadmin /api/me after cold-start MFA', adminMe && adminMe.user && adminMe.user.roleId === 'superadmin' && adminMe.permissions.includes('admin.users'));

  // boot is idempotent (call boot again — must not double-seed)
  const before = store.S().users.length;
  boot();
  ok('boot() idempotent (no double-seed)', store.S().users.length === before, before + ' vs ' + store.S().users.length);
  ok('40 users re-seeded deterministically', before === 40, 'users=' + before);

  server.close();
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SERVERLESS CHECK FAILURE', e); process.exit(1); });
