// migrate.js — M3 database migrations runner
// Usage:
//   node scripts/migrate.js status            — show applied migrations
//   node scripts/migrate.js up                — apply pending migrations
//   node scripts/migrate.js down              — roll back the most recent migration (destructive)
//   node scripts/migrate.js reset             — drop ALL tables and re-apply everything (destructive)
// Requires DATABASE_URL. Pass DATABASE_URL=... inline when not in the environment.
'use strict';
const fs = require('fs');
const path = require('path');
const db = require('../server/lib/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'server', 'migrations');

async function appliedVersions(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const r = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  return r.rows.map(x => x.version);
}

(async () => {
  if (!db.configured()) {
    console.error('DATABASE_URL is not set. Example:');
    console.error('  DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ev2027 node scripts/migrate.js up');
    process.exit(1);
  }
  const cmd = process.argv[2] || 'status';
  const p = await db.ready();
  if (!p) { console.error('[migrate] could not connect:', db.statusInfo().error); process.exit(1); }
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  if (cmd === 'status') {
    const applied = await appliedVersions(p);
    for (const f of files) {
      const v = f.replace(/\.sql$/, '');
      console.log((applied.includes(v) ? '  ✓ applied  ' : '  ✗ pending ') + v);
    }
    return process.exit(0);
  }

  if (cmd === 'up') {
    await db.migrate();
    console.log('[migrate] up to date');
    return process.exit(0);
  }

  if (cmd === 'down') {
    const applied = await appliedVersions(p);
    const last = applied[applied.length - 1];
    if (!last) { console.log('[migrate] nothing to roll back'); return process.exit(0); }
    // destructive drop of the objects this migration created — tables from both files
    const TARGETS = {
      '001_identity.sql': ['rate_policy', 'app_config', 'audit_log', 'revoked_sessions', 'sessions', 'roles', 'users'],
      '002_operations.sql': ['state_snapshots', 'notifications', 'streams', 'sos_events', 'incidents', 'evidence', 'submissions', 'devices', 'agents', 'elections', 'pus', 'wards', 'lgas'],
    };
    const tables = TARGETS[last] || [];
    for (const t of tables) await p.query(`DROP TABLE IF EXISTS ${t} CASCADE`);
    await p.query('DELETE FROM schema_migrations WHERE version=$1', [last]);
    console.log('[migrate] rolled back', last);
    return process.exit(0);
  }

  if (cmd === 'reset') {
    const r = await p.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
    for (const { tablename } of r.rows) {
      if (tablename === 'schema_migrations') continue;
      await p.query(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
    }
    await p.query('DROP TABLE IF EXISTS schema_migrations CASCADE');
    await db.migrate();
    console.log('[migrate] reset complete — all migrations applied');
    return process.exit(0);
  }

  console.error('unknown command:', cmd, '(use status|up|down|reset)');
  process.exit(1);
})().catch(e => { console.error('[migrate] failed:', e.message); process.exit(1); });
