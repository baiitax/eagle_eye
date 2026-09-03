// run-all-tests.js — M1 reproducible test runner (CI + local)
// Reuses a healthy server on :3000 or spawns its own; runs every suite in order;
// reports a summary and exits non-zero on any failure.
'use strict';
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BASE = 'http://localhost:3000';

const SUITES = [
  'apitest', 'security-test', 'mfa-test', 'e2e', 'agent-test', 'lg-test', 'senatorial-test',
  'central20-test', 'irev-test', 'public-test', 'login-test', 'sentinel-test', 'serverless-check', 'db-test',
];

async function healthy() {
  try {
    const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(3000) });
    return r.ok;
  } catch (e) { return false; }
}

(async () => {
  let spawned = null;
  if (await healthy()) {
    console.log('server already healthy on :3000 — reusing it');
  } else {
    console.log('no server on :3000 — spawning a dedicated test server');
    spawned = spawn(process.execPath, ['server/server.js'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SESSION_SECRET: process.env.SESSION_SECRET || 'ci-test-secret-9f3a1c77', PORT: '3000' },
    });
    spawned.stdout.on('data', () => { });
    spawned.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
    for (let i = 0; i < 40; i++) {
      if (await healthy()) break;
      await new Promise(r => setTimeout(r, 500));
    }
    if (!(await healthy())) { console.error('test server failed to start'); process.exit(1); }
    console.log('test server up');
  }

  // deterministic runs: clear the central rate-limit buckets before each suite
  // (tests share one IP; the per-IP policies would otherwise flake across suites)
  let adminToken = null; // cached across resets — reset itself must not add login traffic
  async function resetRateBuckets() {
    try {
      if (!adminToken) {
        const l = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'superadmin', password: 'Admin@123!' }) }).then(r => r.json());
        const m = await fetch(BASE + '/api/auth/mfa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: l.challenge, code: l.mfaCode }) }).then(r => r.json());
        adminToken = m.token;
      }
      const res = await fetch(BASE + '/api/admin/ratelimit/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken }, body: '{}' });
      if (res.status === 401) adminToken = null; // token invalidated — re-login next time
    } catch (e) { /* best-effort */ }
  }

  const results = [];
  for (const suite of SUITES) {
    await resetRateBuckets();
    process.stdout.write(`\n===== ${suite} =====\n`);
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', suite + '.js')], {
      cwd: ROOT, stdio: ['inherit', 'inherit', 'inherit'], timeout: 10 * 60 * 1000,
      env: process.env,
    });
    if (r.error || r.status !== 0) {
      results.push({ suite, ok: false, why: r.error ? String(r.error) : 'exit ' + r.status });
      if (r.signal === 'SIGTERM') results[results.length - 1].why = 'TIMEOUT';
    } else results.push({ suite, ok: true });
  }

  if (spawned) { try { spawned.kill('SIGTERM'); } catch (e) { } }

  console.log('\n===== SUMMARY =====');
  for (const r of results) console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.suite + (r.ok ? '' : ' — ' + r.why));
  const failed = results.filter(r => !r.ok).length;
  console.log(`${SUITES.length - failed}/${SUITES.length} suites passed`);
  process.exit(failed ? 1 : 0);
})();
