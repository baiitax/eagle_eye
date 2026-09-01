// security-test.js — M1 regression suite for audit P0-01 and P1-01
// P0-01: tokens signed with the retired default key must be rejected.
// P1-01: a scoped user's geographic scope is authoritative — query parameters
//        must not widen their access; centrally-scoped roles may filter by param.
'use strict';
const crypto = require('crypto');
const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (x ? ' — ' + x : '')); } };
async function login(u, p) {
  const l = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) }).then(r => r.json());
  const m = await fetch(BASE + '/api/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: l.challenge, code: l.mfaCode }) }).then(r => r.json());
  return m.token;
}
(async () => {
  console.log('== P0-01: retired default signing key ==');
  // forge a token with the OLD committed default secret (audit SEC-01)
  const OLD_DEFAULT = 'ev2027-kn-demo-session-secret';
  const payload = 'u-superadmin.' + String(Date.now() + 3600 * 1000);
  const forged = payload + '.' + crypto.createHmac('sha256', OLD_DEFAULT).update(payload).digest('base64url');
  const r1 = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + forged } });
  ok('token forged with retired default key rejected (401)', r1.status === 401, 'status=' + r1.status);
  const r1b = await fetch(BASE + '/api/sentinel/status', { headers: { Authorization: 'Bearer ' + forged } });
  ok('privileged API rejects forged token (401)', r1b.status === 401, 'status=' + r1b.status);
  // sanity: real login still works
  const tok = await login('socanalyst', 'SocAna@123!');
  const r2 = await fetch(BASE + '/api/me', { headers: { Authorization: 'Bearer ' + tok } });
  const me = await r2.json();
  ok('real sign-in still works (sanity)', r2.status === 200 && me.user && me.user.username === 'socanalyst');

  console.log('== P1-01: geographic scope is authoritative (AUTHZ-01) ==');
  // scoped user: sencoord_c → Kano Central only, regardless of ?senatorial=
  const sc = await login('sencoord_c', 'SenCoord@123!');
  const cross = await fetch(BASE + '/api/senatorial/evidence?senatorial=Kano North', { headers: { Authorization: 'Bearer ' + sc } }).then(r => r.json());
  ok('scoped user cross-district param IGNORED (all rows in own district)', (cross.rows || []).every(r => r.senatorial === 'Kano Central'), 'rows=' + (cross.rows || []).length + ' sample=' + (cross.rows || []).map(r => r.senatorial).slice(0, 3).join(','));
  // centrally-scoped user: analyst may filter by param
  const an = await login('analyst', 'Analyst@123!');
  const north = await fetch(BASE + '/api/senatorial/evidence?senatorial=Kano North', { headers: { Authorization: 'Bearer ' + an } }).then(r => r.json());
  ok('unscoped role can filter by param (Kano North rows)', (north.rows || []).every(r => r.senatorial === 'Kano North'), 'rows=' + (north.rows || []).length);
  const central = await fetch(BASE + '/api/senatorial/evidence?senatorial=Kano Central', { headers: { Authorization: 'Bearer ' + an } }).then(r => r.json());
  ok('param filter switches district for unscoped role (Kano Central rows)', (central.rows || []).every(r => r.senatorial === 'Kano Central') && (central.rows || []).length !== (north.rows || []).length);
  // LG equivalent: lgcoord (Nasarawa) cannot read Kano Municipal via ?lga=
  const lc = await login('lgcoord', 'LGCoord@123!');
  const crossLga = await fetch(BASE + '/api/lg/evidence?lga=Kano Municipal', { headers: { Authorization: 'Bearer ' + lc } }).then(r => r.json());
  ok('scoped LG user cross-LGA param IGNORED (all rows Nasarawa)', (crossLga.rows || []).every(r => r.lga === 'Nasarawa'), 'rows=' + (crossLga.rows || []).length + ' sample=' + (crossLga.rows || []).map(r => r.lga).slice(0, 3).join(','));
  const lgAn = await fetch(BASE + '/api/lg/evidence?lga=Kano Municipal', { headers: { Authorization: 'Bearer ' + an } }).then(r => r.json());
  ok('unscoped role LG param filter works (Kano Municipal rows)', (lgAn.rows || []).every(r => r.lga === 'Kano Municipal'), 'rows=' + (lgAn.rows || []).length);
  // scoped user with NO param gets their own district (no regression)
  const own = await fetch(BASE + '/api/senatorial/evidence', { headers: { Authorization: 'Bearer ' + sc } }).then(r => r.json());
  ok('scoped user without param sees own district', (own.rows || []).every(r => r.senatorial === 'Kano Central'));

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST FAILURE', e); process.exit(1); });
