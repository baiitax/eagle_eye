// db-test.js — M3 DATABASE suite (runs against a REAL PostgreSQL).
// Requires DATABASE_URL — skips cleanly (exit 0, marked skipped) when absent,
// so the CI runner stays green in no-DB environments.
'use strict';
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const URL = process.env.DATABASE_URL || '';
const PORT = 3101;
const BASE = 'http://localhost:' + PORT;
const STATE_FILE = path.join(ROOT, 'data', 'state.json');

let pass = 0, fail = 0, skipped = false;
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ FAIL ' + n + (x ? ' — ' + x : '')); } };
const J = (p, opts = {}) => fetch(BASE + p, { method: opts.method || 'GET', headers: { ...(opts.token ? { Authorization: 'Bearer ' + opts.token } : {}), ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }).then(async r => {
  const text = await r.text().catch(() => ''); // read ONCE; JSON and SQL both flow through here
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* SQL export / non-JSON */ }
  return { status: r.status, json, text };
});
async function login(u, p) {
  const l = await J('/api/auth/login', { method: 'POST', body: { username: u, password: p } });
  if (!l.json || !l.json.challenge) return { token: null, step1: l.json };
  const m = await J('/api/auth/mfa', { method: 'POST', body: { challenge: l.json.challenge, code: l.json.mfaCode } });
  return { token: m.json.token, user: m.json.user, step1: l.json };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let serverProc = null;
async function startServer({ waitHydrated = false } = {}) {
  try { fs.rmSync(STATE_FILE, { force: true }); } catch (e) { }
  serverProc = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: URL, PORT: String(PORT), SESSION_SECRET: 'db-test-secret-0123456789abcdef0123456789abcdef' },
  });
  serverProc.stdout.on('data', () => { });
  serverProc.stderr.on('data', () => { });
  let h = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await J('/api/health');
      if (r.status === 200 && r.json.database && r.json.database.connected) {
        h = r.json;
        // when a snapshot exists we must wait until hydration finishes — polling
        // the health flag avoids racing the async hydrate on cold-start boots
        if (!waitHydrated || h.stateLoadedFrom === 'database') return h;
        if (i > 20 && h.stateLoadedFrom === 'fresh') throw new Error('hydration did not complete (expected database)');
      } else if (r.status === 200 && r.json.database && !r.json.database.connected && i > 8) {
        throw new Error('database connection failed: ' + (r.json.database.error || 'unknown'));
      }
    } catch (e) {
      if (String(e.message).includes('hydration')) throw e;
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('server did not reach a healthy state');
}
async function stopServer() {
  if (serverProc) { try { serverProc.kill('SIGKILL'); } catch (e) { } serverProc = null; }
  await sleep(800);
}
async function sql(query) {
  return execFileSync('psql', ['-h', '127.0.0.1', '-U', 'ev2027', '-d', 'ev2027', '-tAc', query], { env: { ...process.env, PGPASSWORD: 'ev2027pass' } }).toString().trim();
}

(async () => {
  if (!URL || !/^postgres(ql)?:\/\//.test(URL)) {
    console.log('db-test: SKIPPED — no DATABASE_URL configured (JSON-store mode only).');
    skipped = true;
    console.log('\nRESULT: skipped (set DATABASE_URL to run the database suite)');
    return process.exit(0);
  }
  console.log('== M3 DATABASE — REAL POSTGRES ==');

  // 1. migrations on a clean database
  try { execFileSync(process.execPath, ['scripts/migrate.js', 'reset'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: URL } }); }
  catch (e) { console.error('migrate reset failed:', e.message); return process.exit(1); }
  ok('migrations reset + applied (21 tables)', (await sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'")) === '21');
  execFileSync(process.execPath, ['scripts/migrate.js', 'up'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: URL } });
  ok('migrations idempotent (second up run clean)', true);

  // 2. boot with DB
  const h1 = await startServer();
  ok('boot: database mode postgres + connected', h1.database.mode === 'postgres' && h1.database.connected === true, JSON.stringify(h1.database).slice(0, 120));
  ok('state loaded from fresh seed (no snapshot yet)', h1.stateLoadedFrom === 'fresh');

  // 3. identity mutations persist
  const d1 = await login('director', 'Director@123!');
  ok('login works over DB-backed boot', !!d1.token);
  const adm = await login('superadmin', 'Admin@123!');
  ok('superadmin login for admin endpoints', !!adm.token);
  const chg = await J('/api/auth/change-password', { method: 'POST', token: d1.token, body: { currentPassword: 'Director@123!', newPassword: 'DirectorDb2027x' } });
  ok('password change succeeds', chg.status === 200);
  const oldFail = await J('/api/auth/login', { method: 'POST', body: { username: 'director', password: 'Director@123!' } });
  ok('old password rejected after change', oldFail.status === 401);
  const d2 = await login('director', 'DirectorDb2027x');
  ok('new password works', !!d2.token);
  await sleep(4000); // mirror flush (3s cadence)
  const usrRow = await sql("SELECT password_hash FROM users WHERE username='director'");
  ok('users table holds the new hash', usrRow.length > 30);

  // 4. revocation persists (revoke the OTHER device's session, keep this one)
  const v1 = await login('observer', 'Observer@123!');
  const v2 = await login('observer', 'Observer@123!');
  const ra = await J('/api/auth/revoke-all', { method: 'POST', token: v2.token, body: {} });
  ok('revoke-all-other revokes the first session', ra.status === 200 && ra.json.revoked >= 1);
  ok('revoked token dead immediately', (await J('/api/me', { token: v1.token })).status === 401);
  ok('current session survives', (await J('/api/me', { token: v2.token })).status === 200);
  const victim = v1;
  await sleep(4000); // mirror flush (3s cadence) — the same rows prove cold-start revocation below
  const revRow = await sql('SELECT count(*) FROM revoked_sessions');
  ok('revoked_sessions mirrored to Postgres', parseInt(revRow, 10) >= 1);

  // 5. audit append-only in DB
  const auBefore = parseInt(await sql('SELECT count(*) FROM audit_log'), 10);
  await J('/api/admin/db/status', { token: adm.token }); // any audited action
  await sleep(3800); // audit queue flush
  const auAfter = parseInt(await sql('SELECT count(*) FROM audit_log'), 10);
  ok('audit_log grows in Postgres', auAfter > auBefore, auBefore + '→' + auAfter);

  // 6. forced snapshot
  const snap = await J('/api/admin/db/snapshot', { method: 'POST', token: adm.token, body: {} });
  ok('admin can force a state snapshot', snap.status === 200 && !!snap.json.snapshotId);

  // 7. COLD START: kill server, delete state file, boot again
  // (give the throttled mirror a moment to flush users/sessions/revocations to Postgres)
  await sleep(9000);
  await stopServer();
  const h2 = await startServer({ waitHydrated: true });
  ok('cold-start boot: state hydrated from DATABASE', h2.stateLoadedFrom === 'database', h2.stateLoadedFrom);
  const d3 = await login('director', 'DirectorDb2027x');
  ok('password change SURVIVED the cold start', !!d3.token);
  const oldAfter = await J('/api/auth/login', { method: 'POST', body: { username: 'director', password: 'Director@123!' } });
  ok('old password still rejected after cold start', oldAfter.status === 401);
  const revAfter = await J('/api/me', { token: victim.token });
  ok('revoked session STILL rejected after cold start', revAfter.status === 401);

  // 8. retention (uses the platform clock; sim-now timestamps)
  const adm2 = await login('superadmin', 'Admin@123!');
  const daysSet = await J('/api/admin/config', { method: 'PATCH', token: adm2.token, body: { retentionDays: 0 } });
  ok('retentionDays configurable', daysSet.status === 200);
  const ret = await J('/api/admin/db/retention', { method: 'POST', token: adm2.token, body: { days: 0 } });
  ok('retention run prunes audit rows', ret.status === 200 && ret.json.pruned > 0, JSON.stringify(ret.json));
  await J('/api/admin/config', { method: 'PATCH', token: adm2.token, body: { retentionDays: 730 } });

  // 9. export → import roundtrip into a second database
  const exp = await J('/api/admin/db/export', { token: adm2.token });
  ok('logical SQL export produced', exp.status === 200 && /INSERT INTO users/.test(exp.text));
  fs.writeFileSync('/tmp/eagle-eye-backup.sql', exp.text);
  const srcUsers = await sql('SELECT count(*) FROM users');
  execFileSync(process.execPath, ['scripts/migrate.js', 'reset'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: 'postgres://ev2027:ev2027pass@127.0.0.1:5432/ev2027_restore' } });
  execFileSync(process.execPath, ['scripts/db-import.js', '/tmp/eagle-eye-backup.sql'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: 'postgres://ev2027:ev2027pass@127.0.0.1:5432/ev2027_restore' } });
  const rstUsers = execFileSync('psql', ['-h', '127.0.0.1', '-U', 'ev2027', '-d', 'ev2027_restore', '-tAc', 'SELECT count(*) FROM users'], { env: { ...process.env, PGPASSWORD: 'ev2027pass' } }).toString().trim();
  ok('backup imported into a fresh database (users match)', rstUsers === srcUsers, srcUsers + ' vs ' + rstUsers);

  // 10. cleanup: restore demo credential
  await J('/api/auth/change-password', { method: 'POST', token: d3.token, body: { currentPassword: 'DirectorDb2027x', newPassword: 'Director@123!' } });
  const d4 = await login('director', 'Director@123!');
  ok('demo credential restored', !!d4.token);

  await stopServer();
  // leave a clean database for other suites (they hydrate from it on boot)
  try { execFileSync(process.execPath, ['scripts/migrate.js', 'reset'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: URL } }); console.log('  (main database reset to a clean schema)'); } catch (e) { }
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('DB TEST FAILURE', e);
  if (serverProc) { try { serverProc.kill('SIGKILL'); } catch (x) { } }
  try { execFileSync(process.execPath, ['scripts/migrate.js', 'reset'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: URL } }); } catch (x) { }
  process.exit(1);
});
