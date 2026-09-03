// mfa-test.js — M2 IDENTITY & ACCESS suite
// Real TOTP (RFC 6238/4226 vectors) · session revocation/refresh · password reset &
// change with policy · central rate limiting · SENTINEL identity realness · step-up auth.
'use strict';
const BASE = 'http://localhost:3000';
const totp = require('../server/lib/totp.js');
let pass = 0, fail = 0;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (x ? ' — ' + x : '')); } };
const J = (path, opts = {}) => fetch(BASE + path, { method: opts.method || 'GET', headers: { ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));
async function login(u, p) {
  const l = await J('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
  const m = await J('/api/auth/mfa', { method: 'POST', body: { challenge: l.json.challenge, code: l.json.mfaCode } });
  return { token: m.json.token, user: m.json.user, step1: l.json };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('== TOTP ENGINE (RFC 6238/4226 official vectors) ==');
  const VEC = totp.base32Encode(Buffer.from('12345678901234567890'));
  ok('base32 encoding matches RFC 4648 vector', VEC === 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  ok('T=59s → 287082 (counter 1)', totp.totpCode(VEC, 59000) === '287082');
  ok('T=1111111109 → 081804', totp.totpCode(VEC, 1111111109000) === '081804');
  ok('T=1234567890 → 005924', totp.totpCode(VEC, 1234567890000) === '005924');
  ok('verify accepts vector code', totp.totpVerify(VEC, '287082', 59000) === true);
  ok('verify rejects wrong code', totp.totpVerify(VEC, '000000', 59000) === false);
  ok('window tolerance ±1 step', totp.totpVerify(VEC, '287082', 59000 + 30000) === true || totp.totpVerify(VEC, '287082', 59000 - 30000) === true);

  console.log('== LOGIN: real TOTP MFA ==');
  const demo = await login('director', 'Director@123!');
  ok('login succeeds with displayed code', !!demo.token && demo.user.username === 'director');
  ok('user carries TOTP enrollment', demo.user.mfaType === 'TOTP' && demo.user.totpEnrolled === true);
  ok('server reports TOTP rotation countdown', demo.step1.mfaType === 'TOTP' && demo.step1.totpRotatesInSec >= 1 && demo.step1.totpRotatesInSec <= 30);
  // real authenticator loop: compute the code ourselves from the setup secret
  const setup = await J('/api/auth/mfa/setup', { token: demo.token });
  ok('MFA setup exposes secret + otpauth URI', setup.json.secret && /^otpauth:\/\/totp\//.test(setup.json.uri));
  ok('setup currentCode matches engine computation', setup.json.currentCode === totp.totpCode(setup.json.secret));
  const step1b = await J('/api/auth/login', { method: 'POST', body: { username: 'director', password: 'Director@123!' } });
  const selfCode = totp.totpCode(setup.json.secret);
  const m2 = await J('/api/auth/mfa', { method: 'POST', body: { challenge: step1b.json.challenge, code: selfCode } });
  ok('code computed by the test engine verifies (true RFC loop)', m2.status === 200 && !!m2.json.token);
  const step1c = await J('/api/auth/login', { method: 'POST', body: { username: 'director', password: 'Director@123!' } });
  const wrong = await J('/api/auth/mfa', { method: 'POST', body: { challenge: step1c.json.challenge, code: '000001' } });
  ok('wrong TOTP rejected with attemptsLeft', wrong.status === 401 && wrong.json.error === 'MFA_FAILED' && wrong.json.attemptsLeft === 2, JSON.stringify(wrong.json).slice(0, 90));
  ok('old random-code era is gone (challenge is TOTP-bound)', /rotates in 30s|TOTP/.test(step1b.json.demoHint || '') || step1b.json.mfaType === 'TOTP');

  console.log('== SESSIONS: revocation & refresh ==');
  const s1 = await login('socanalyst', 'SocAna@123!');
  const s2 = await login('socanalyst', 'SocAna@123!');
  const meA = await J('/api/me', { token: s1.token });
  ok('two live sessions coexist', meA.status === 200);
  const rev = await J('/api/auth/sessions/definitely-not-a-real-sid', { method: 'POST', token: s1.token, body: {} });
  ok('bogus session id → 404', rev.status === 404);
  const own = await J('/api/auth/sessions', { token: s1.token });
  ok('own session list grows (>=2 rows)', own.json.rows.length >= 2, 'rows=' + own.json.rows.length);
  // the LATEST session is s2's (loginAt desc) — revoking it must kill exactly s2
  const latest = own.json.rows.slice().sort((a, b) => b.loginAt - a.loginAt)[0];
  const revokeOther = await J('/api/auth/sessions/' + latest.id + '/revoke', { method: 'POST', token: s1.token, body: {} });
  ok('revoke the latest of own sessions', revokeOther.status === 200 && revokeOther.json.ok === true);
  const a1 = (await J('/api/me', { token: s1.token })).status;
  const a2 = (await J('/api/me', { token: s2.token })).status;
  ok('latest session revoked, earlier one survives', a1 === 200 && a2 === 401, a1 + '/' + a2);
  const aliveToken = s1.token;
  // refresh: extend + rotate
  const fresh = await J('/api/auth/refresh', { method: 'POST', token: aliveToken, body: {} });
  ok('refresh issues a new token', fresh.status === 200 && fresh.json.token && fresh.json.token !== aliveToken);
  const me3 = await J('/api/me', { token: fresh.json.token });
  ok('refreshed token works', me3.status === 200 && me3.json.user.username === 'socanalyst');
  const meOld = await J('/api/me', { token: aliveToken });
  ok('pre-refresh token retired (401)', meOld.status === 401);
  // revoke-all
  const sa = await login('socanalyst', 'SocAna@123!');
  const sb = await login('socanalyst', 'SocAna@123!');
  const ra = await J('/api/auth/revoke-all', { method: 'POST', token: sa.token, body: {} });
  ok('revoke-all-other keeps current session', ra.status === 200 && ra.json.revoked >= 1);
  ok('other session signed out', (await J('/api/me', { token: sb.token })).status === 401);
  ok('current session survives', (await J('/api/me', { token: sa.token })).status === 200);
  // logout is now a REAL server-side revocation
  await J('/api/auth/logout', { method: 'POST', token: sa.token, body: {} });
  ok('logout revokes server-side', (await J('/api/me', { token: sa.token })).status === 401);

  console.log('== SENTINEL terminates a real session (spec §15) ==');
  // deliberate bad credential → real failed-login telemetry (visible in SENTINEL §14)
  await J('/api/auth/login', { method: 'POST', body: { username: 'socanalyst', password: 'totally-wrong' } });
  const sec = await login('secdirector', 'SecDir@123!');
  const victim = await login('observer', 'Observer@123!');
  const sent = await J('/api/sentinel/identity', { token: sec.token });
  const vrow = sent.json.sessions.filter(x => x.user === 'observer').sort((a, b) => b.loginAt - a.loginAt)[0];
  ok('SENTINEL identity lists REAL sessions', !!vrow && vrow.device.length > 0 && vrow.ip.length > 0);
  const term = await J('/api/sentinel/sessions/' + vrow.id + '/terminate', { method: 'POST', token: sec.token, body: {} });
  ok('terminate from SENTINEL succeeds', term.status === 200 && term.json.ok === true);
  ok('terminated session token is REALLY revoked', (await J('/api/me', { token: victim.token })).status === 401);
  const idn = await J('/api/sentinel/identity', { token: sec.token });
  ok('identity reports real telemetry source', idn.json.source === 'LIVE AUTH SUBSYSTEM');
  ok('MFA coverage 100% (all enrolled TOTP)', idn.json.mfaCoverage === 100);
  ok('dormant accounts computed (never signed in)', idn.json.dormantAccounts >= 1 && idn.json.dormantAccountNames.length >= 1);
  ok('real login/failed-login counters present', idn.json.loginAttempts >= 5 && idn.json.failedLogins >= 1);
  ok('sessionsTerminated counter incremented', idn.json.sessionsTerminated >= 1);

  console.log('== STEP-UP AUTHENTICATION (§16/§48) ==');
  const an = await login('socanalyst', 'SocAna@123!');
  const noStep = await J('/api/sentinel/actions/request', { method: 'POST', token: an.token, body: { action: 'ISOLATE_NODE', target: 'NODE-0001', detail: 'test' } });
  ok('HIGH action without step-up → STEPUP_REQUIRED', noStep.status === 400 && noStep.json.error === 'STEPUP_REQUIRED');
  const badStep = await J('/api/sentinel/actions/request', { method: 'POST', token: an.token, body: { action: 'ISOLATE_NODE', target: 'NODE-0001', detail: 'test', stepupCode: '000001' } });
  ok('wrong step-up code → STEPUP_INVALID', badStep.status === 400 && badStep.json.error === 'STEPUP_INVALID');
  const curCode = totp.totpCode(setup.json.secret); // socanalyst secret differs — fetch per-user
  const socSetup = await J('/api/auth/mfa/setup', { token: an.token });
  const goodStep = await J('/api/sentinel/actions/request', { method: 'POST', token: an.token, body: { action: 'ISOLATE_NODE', target: 'NODE-0001', detail: 'test', stepupCode: totp.totpCode(socSetup.json.secret) } });
  ok('valid step-up code → action REQUESTED', goodStep.status === 200 && goodStep.json.action.status === 'REQUESTED');
  const lowNoStep = await J('/api/sentinel/actions/request', { method: 'POST', token: an.token, body: { action: 'RUN_HEALTH_CHECK', target: 'NODE-0001', detail: '' } });
  ok('LOW action needs no step-up (auto-executes)', lowNoStep.status === 200 && lowNoStep.json.action.status === 'EXECUTED');
  // break-glass requires step-up
  const bgNo = await J('/api/sentinel/breakglass/open', { method: 'POST', token: an.token, body: { reason: 'Emergency test access', incidentId: 'SEC-2027-000411' } });
  ok('break-glass without step-up rejected', bgNo.status === 400 && bgNo.json.error === 'STEPUP_REQUIRED');
  const bgOk = await J('/api/sentinel/breakglass/open', { method: 'POST', token: an.token, body: { reason: 'Emergency test access', incidentId: 'SEC-2027-000411', minutes: 15, stepupCode: totp.totpCode(socSetup.json.secret) } });
  ok('break-glass with step-up opens', bgOk.status === 200 && bgOk.json.ok === true && bgOk.json.session.minutes === 15);
  await J('/api/sentinel/breakglass/close', { method: 'POST', token: an.token, body: { id: bgOk.json.session.id } });

  console.log('== PASSWORD RESET & CHANGE (policy + revocation) ==');
  const resetReq = await J('/api/auth/password-reset/request', { method: 'POST', body: { username: 'observer' } });
  ok('reset request returns demo code + token', resetReq.json.demo && /^\d{6}$/.test(resetReq.json.demo.code) && !!resetReq.json.demo.token);
  const weak = await J('/api/auth/password-reset/complete', { method: 'POST', body: { token: resetReq.json.demo.token, code: resetReq.json.demo.code, newPassword: 'short' } });
  ok('weak password rejected with policy message', weak.status === 400 && weak.json.error === 'WEAK_PASSWORD' && /8 characters/.test(weak.json.message));
  const badCode = await J('/api/auth/password-reset/complete', { method: 'POST', body: { token: resetReq.json.demo.token, code: '000000', newPassword: 'Observer2027x' } });
  ok('wrong reset code rejected', badCode.status === 400 && badCode.json.error === 'RESET_INVALID');
  const victimLogin = await login('observer', 'Observer@123!');
  const done = await J('/api/auth/password-reset/complete', { method: 'POST', body: { token: resetReq.json.demo.token, code: resetReq.json.demo.code, newPassword: 'Observer2027x' } });
  ok('reset completes with strong password', done.status === 200 && done.json.ok === true);
  ok('old password now invalid', (await J('/api/auth/login', { method: 'POST', body: { username: 'observer', password: 'Observer@123!' } })).status === 401);
  const newLogin = await J('/api/auth/login', { method: 'POST', body: { username: 'observer', password: 'Observer2027x' } });
  ok('new password works', newLogin.status === 200 && newLogin.json.mfaRequired === true);
  ok('reset signed out previous sessions', (await J('/api/me', { token: victimLogin.token })).status === 401);
  // enumeration safety: unknown user → identical 200 shape
  const unknown = await J('/api/auth/password-reset/request', { method: 'POST', body: { username: 'ghost-user-99' } });
  ok('enumeration-safe response for unknown user', unknown.status === 200 && !unknown.json.demo);
  // change password (self-service)
  const dir = await login('director', 'Director@123!');
  const dir2 = await login('director', 'Director@123!');
  const badCur = await J('/api/auth/change-password', { method: 'POST', token: dir.token, body: { currentPassword: 'wrong-pass', newPassword: 'Director2027x' } });
  ok('change-password rejects wrong current password', badCur.status === 401 && badCur.json.error === 'BAD_CURRENT_PASSWORD');
  const chg = await J('/api/auth/change-password', { method: 'POST', token: dir.token, body: { currentPassword: 'Director@123!', newPassword: 'Director2027x' } });
  ok('change-password succeeds', chg.status === 200);
  ok('other session signed out, current kept', (await J('/api/me', { token: dir2.token })).status === 401 && (await J('/api/me', { token: dir.token })).status === 200);
  // restore the demo credential for other suites
  const dirNew = await login('director', 'Director2027x');
  await J('/api/auth/change-password', { method: 'POST', token: dirNew.token, body: { currentPassword: 'Director2027x', newPassword: 'Director@123!' } });
  ok('demo credential restored', (await J('/api/auth/login', { method: 'POST', body: { username: 'director', password: 'Director@123!' } })).status === 200);

  console.log('== CENTRAL RATE LIMITING (AUTH-03) ==');
  const sup = await login('superadmin', 'Admin@123!');
  await J('/api/admin/ratelimit/reset', { method: 'POST', token: sup.token, body: {} }); // clean buckets before limit tests
  const snap = await J('/api/admin/ratelimit', { token: sup.token });
  ok('policies visible (login/mfa/pwreset/api)', snap.json.login && snap.json.mfa && snap.json.pwreset && snap.json.api);
  const adj = await J('/api/admin/ratelimit', { method: 'PATCH', token: sup.token, body: { key: 'api', max: 650 } });
  ok('policy adjustment works + audited', adj.status === 200 && adj.json.max === 650);
  const noPerm = await J('/api/admin/ratelimit', { token: (await login('observer', 'Observer2027x')).token });
  ok('non-admin cannot view rate policies (403)', noPerm.status === 403);
  // mfa endpoint rate limit actually fires (tighten the policy, brute-force, restore)
  await J('/api/admin/ratelimit', { method: 'PATCH', token: sup.token, body: { key: 'mfa', max: 3 } });
  const l1 = await J('/api/auth/login', { method: 'POST', body: { username: 'secdirector', password: 'SecDir@123!' } });
  let limited = false;
  for (let i = 0; i < 6 && !limited; i++) {
    const r = await J('/api/auth/mfa', { method: 'POST', body: { challenge: l1.json.challenge, code: '000001' } });
    if (r.status === 429 && r.json.error === 'RATE_LIMITED') limited = true;
  }
  ok('MFA brute-force hits central 429 limit', limited);
  await J('/api/admin/ratelimit', { method: 'PATCH', token: sup.token, body: { key: 'mfa', max: 30 } });
  // SENTINEL ADJUST_RATE_LIMIT action now has a real effect on the registry
  const sec2 = await login('secdirector', 'SecDir@123!');
  const secSetup = await J('/api/auth/mfa/setup', { token: sec2.token });
  const ar = await J('/api/sentinel/actions/request', { method: 'POST', token: sec2.token, body: { action: 'ADJUST_RATE_LIMIT', target: 'API-GATEWAY', detail: '700', stepupCode: totp.totpCode(secSetup.json.secret) } });
  ok('ADJUST_RATE_LIMIT requested (MEDIUM)', ar.status === 200 && ar.json.action.status === 'REQUESTED');
  const ap = await J('/api/sentinel/actions/' + ar.json.action.id + '/approve', { method: 'POST', token: sup.token, body: { note: 'ok' } });
  await J('/api/sentinel/actions/' + ar.json.action.id + '/execute', { method: 'POST', token: sec2.token, body: {} });
  const snap2 = await J('/api/admin/ratelimit', { token: sup.token });
  ok('SENTINEL action adjusted the central policy (real effect)', snap2.json.api.max === 700, 'api.max=' + snap2.json.api.max);
  await J('/api/admin/ratelimit', { method: 'PATCH', token: sup.token, body: { key: 'api', max: 600 } });

  console.log('== ADMIN PASSWORD + SESSION CONTROLS ==');
  const ad = await login('superadmin', 'Admin@123!');
  // restore observer's demo password BEFORE the admin section consumes it
  const obsReset = await J('/api/auth/password-reset/request', { method: 'POST', body: { username: 'observer' } });
  await J('/api/auth/password-reset/complete', { method: 'POST', body: { token: obsReset.json.demo.token, code: obsReset.json.demo.code, newPassword: 'Observer@123!' } });
  ok('observer demo credential restored', (await J('/api/auth/login', { method: 'POST', body: { username: 'observer', password: 'Observer@123!' } })).status === 200);
  const tgt = await login('lganalyst', 'LGAnalyst@123!');
  const weakAd = await J('/api/admin/users/' + tgt.user.id + '/password', { method: 'POST', token: ad.token, body: { newPassword: 'weak' } });
  ok('admin password change enforces policy', weakAd.status === 400 && weakAd.json.error === 'WEAK_PASSWORD');
  const adPw = await J('/api/admin/users/' + tgt.user.id + '/password', { method: 'POST', token: ad.token, body: { newPassword: 'LGAnalyst2027x' } });
  ok('admin sets new password', adPw.status === 200 && adPw.json.ok === true);
  ok('admin password change revoked sessions', (await J('/api/me', { token: tgt.token })).status === 401);
  ok('new password signs in', !!(await login('lganalyst', 'LGAnalyst2027x')).token);
  await J('/api/admin/users/' + tgt.user.id + '/password', { method: 'POST', token: ad.token, body: { newPassword: 'LGAnalyst@123!' } });

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST FAILURE', e); process.exit(1); });
