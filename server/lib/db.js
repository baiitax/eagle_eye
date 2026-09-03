// db.js — M3 DATABASE LAYER.
// Postgres becomes the durable source of truth when DATABASE_URL is configured
// (local managed Postgres, Neon, Vercel Postgres, Supabase — any PG-compatible URL).
// The in-memory store stays the runtime working set; this module:
//   - applies migrations at boot (server/migrations/*.sql)
//   - hydrates users / sessions / revoked / config / rate policies / full state
//     snapshot into the store when a cold start has no state file
//   - mirrors those entities back on every store save (throttled)
//   - appends every audit entry to the append-only audit_log table
//   - exposes status / export / retention / snapshot helpers for the admin UI
// Without DATABASE_URL the platform keeps working exactly as before (JSON fallback).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let pg = null;
try { pg = require('pg'); } catch (e) { pg = null; }

const ROOT = path.join(__dirname, '..');
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const state = {
  url: process.env.DATABASE_URL || '',
  connected: false,
  error: null,
  pool: null,
  readyPromise: null,
  readyResolve: null,
  lastMirrorAt: 0,
  lastSnapshotAt: 0,
  snapshotMinSecs: Number(process.env.DB_SNAPSHOT_SECS || 60),
  mirrorMinMs: Number(process.env.DB_MIRROR_MS || 3000),
  tables: [],
  counts: {},
  hydration: null, // set after successful hydrate
};

const configured = () => !!state.url;

function pool() {
  if (!state.url) return null;
  if (state.pool) return state.pool;
  if (!pg) {
    state.error = 'DATABASE_URL is set but the pg driver is not installed (npm install)';
    console.error('[db] ' + state.error);
    return null;
  }
  state.pool = new pg.Pool({
    connectionString: state.url,
    max: 2,                              // serverless-friendly pool
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 5000,
  });
  state.pool.on('error', (e) => { state.error = String(e.message); console.error('[db] pool error', e.message); });
  return state.pool;
}

function ready() {
  if (!configured()) return Promise.resolve(null);
  if (state.readyPromise) return state.readyPromise;
  state.readyPromise = (async () => {
    const p = pool();
    if (!p) return null;
    try {
      await migrate();
      // NOTE: use p.query directly here — query() awaits ready(), which would deadlock
      const res = await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
      state.tables = res.rows.map(r => r.tablename);
      state.connected = true;
      state.error = null;
      console.log('[db] postgres connected —', state.tables.length, 'tables');
    } catch (e) {
      state.connected = false;
      state.error = String(e.message);
      console.error('[db] connection/migration failed:', e.message);
      console.error('[db] falling back to the JSON store for this process (demo mode).');
      return null;
    }
    return state.pool;
  })();
  return state.readyPromise;
}

async function query(text, params = []) {
  const p = await ready();
  if (!p) throw new Error(state.error || 'database unavailable');
  return p.query(text, params);
}

// ---------------- migrations ----------------
async function migrate() {
  const p = pool();
  if (!p) throw new Error('pg driver unavailable');
  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const version = f.replace(/\.sql$/, '');
    const applied = await p.query('SELECT 1 FROM schema_migrations WHERE version=$1', [version]);
    if (applied.rowCount > 0) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
    await p.query('BEGIN');
    try {
      await p.query(sql);
      await p.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
      await p.query('COMMIT');
      console.log('[db] migration applied:', version);
    } catch (e) {
      await p.query('ROLLBACK');
      throw e;
    }
  }
}

// ---------------- hydrate: DB → in-memory store (cold-start continuity) ----------------
let hydrationPromise = null;
function ensureHydrated(storeState) {
  if (!configured()) return Promise.resolve(null);
  if (!hydrationPromise) {
    hydrationPromise = hydrateInto(storeState).catch(e => { state.error = 'hydrate failed: ' + e.message; console.error('[db]', e.message); return null; });
  }
  return hydrationPromise;
}

async function hydrateInto(storeState) {
  const p = await ready();
  if (!p) return null;
  try {
    const res = await p.query('SELECT * FROM users');
    if (res.rowCount > 0) {
      for (const row of res.rows) {
        const u = storeState.users.find(x => x.id === row.id);
        if (u) Object.assign(u, {
          username: row.username, name: row.name, roleId: row.role_id, scope: row.scope || {},
          passwordHash: row.password_hash, phone: row.phone, status: row.status,
          mfa: row.mfa, mfaType: row.mfa_type, totpSecret: row.totp_secret,
          agentId: row.agent_id, lastLoginAt: row.last_login_at, loginCount: row.login_count,
          failedLoginCount: row.failed_login_count, lastFailedAt: row.last_failed_at,
          sessionsInvalidatedAt: row.sessions_invalidated_at, passwordChangedAt: row.password_changed_at,
        });
      }
      console.log('[db] hydrated', res.rowCount, 'users (password/session state survives cold starts)');
    }
    const rev = await p.query('SELECT * FROM revoked_sessions');
    for (const row of rev.rows) storeState.revokedSids[row.sid] = row.revoked_at;
    if (rev.rowCount > 0) console.log('[db] hydrated', rev.rowCount, 'revoked sessions');
    const sess = await p.query('SELECT * FROM sessions');
    for (const row of sess.rows) {
      const rec = {
        sid: row.sid, userId: row.user_id, createdAt: row.created_at, lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at, absoluteExpiryAt: row.absolute_expiry_at, ip: row.ip,
        device: row.device, deviceId: row.device_id, gen: row.gen, currentToken: row.current_token,
        revoked: row.revoked,
      };
      storeState.sessions[row.sid] = rec;
      if (row.current_token) storeState.sessionTokens[row.current_token] = row.sid;
    }
    if (sess.rowCount > 0) console.log('[db] hydrated', sess.rowCount, 'sessions');
    const cfg = await p.query('SELECT * FROM app_config');
    for (const row of cfg.rows) storeState.config[row.key] = row.value;
    const rp = await p.query('SELECT * FROM rate_policy');
    storeState.ratePolicy = storeState.ratePolicy || {};
    for (const row of rp.rows) storeState.ratePolicy[row.key] = row.policy;
    if (rp.rowCount > 0) console.log('[db] hydrated', rp.rowCount, 'rate policies');
    // full-state continuity: use the latest snapshot only when no state file existed
    if (storeState.meta && storeState.meta.loadedFrom === 'fresh') {
      const snap = await p.query('SELECT state FROM state_snapshots ORDER BY saved_at DESC LIMIT 1');
      if (snap.rowCount > 0 && snap.rows[0].state) {
        const snapState = snap.rows[0].state;
        for (const k of Object.keys(storeState)) delete storeState[k];
        Object.assign(storeState, snapState);
        storeState.meta = storeState.meta || {};
        storeState.meta.loadedFrom = 'database';
        storeState.meta.loadedFromAt = snap.rows[0].saved_at || Date.now();
        console.log('[db] full state restored from snapshot (cold-start continuity)');
      }
    }
    await refreshCounts();
    return { hydrated: true };
  } catch (e) {
    state.error = 'hydrate failed: ' + e.message;
    console.error('[db] hydrate failed:', e.message);
    return null;
  }
}

async function refreshCounts() {
  if (!state.connected) return;
  try {
    const c = {};
    for (const t of ['users', 'roles', 'sessions', 'revoked_sessions', 'audit_log', 'submissions', 'evidence', 'incidents', 'lgas', 'wards', 'pus', 'agents', 'devices', 'state_snapshots']) {
      try {
        const r = await query(`SELECT count(*)::int AS n FROM ${t}`);
        c[t] = r.rows[0].n;
      } catch (e) { c[t] = null; }
    }
    state.counts = c;
  } catch (e) { /* best-effort */ }
}

// ---------------- mirror: store → DB (throttled) ----------------
let mirrorTimer = null;
function scheduleMirror(storeState, { force = false } = {}) {
  if (!configured()) return;
  const now = Date.now();
  if (!force && now - state.lastMirrorAt < state.mirrorMinMs) {
    if (!mirrorTimer) mirrorTimer = setTimeout(() => { mirrorTimer = null; scheduleMirror(storeState, { force: true }); }, state.mirrorMinMs);
    return;
  }
  state.lastMirrorAt = now;
  mirror(storeState).catch(e => { state.error = 'mirror failed: ' + e.message; console.error('[db] mirror failed:', e.message); });
}

async function mirror(storeState) {
  const p = await ready();
  if (!p) return;
  const now = Date.now();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    for (const u of storeState.users) {
      await client.query(
        `INSERT INTO users (id, username, name, role_id, scope, password_hash, phone, status, mfa, mfa_type, totp_secret, agent_id, last_login_at, login_count, failed_login_count, last_failed_at, sessions_invalidated_at, password_changed_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (id) DO UPDATE SET password_hash=EXCLUDED.password_hash, status=EXCLUDED.status, role_id=EXCLUDED.role_id,
           scope=EXCLUDED.scope, last_login_at=EXCLUDED.last_login_at, login_count=EXCLUDED.login_count,
           failed_login_count=EXCLUDED.failed_login_count, last_failed_at=EXCLUDED.last_failed_at,
           sessions_invalidated_at=EXCLUDED.sessions_invalidated_at, password_changed_at=EXCLUDED.password_changed_at,
           updated_at=EXCLUDED.updated_at`,
        [u.id, u.username, u.name, u.roleId, JSON.stringify(u.scope || {}), u.passwordHash, u.phone || '', u.status, !!u.mfa, u.mfaType || 'TOTP',
         u.totpSecret, u.agentId || null, u.lastLoginAt || null, u.loginCount || 0, u.failedLoginCount || 0,
         u.lastFailedAt || null, u.sessionsInvalidatedAt || 0, u.passwordChangedAt || now, u.createdAt || now, now]);
    }
    for (const [sid, rec] of Object.entries(storeState.sessions)) {
      await client.query(
        `INSERT INTO sessions (sid, user_id, created_at, last_seen_at, expires_at, absolute_expiry_at, ip, device, device_id, gen, current_token, revoked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (sid) DO UPDATE SET current_token=EXCLUDED.current_token, gen=EXCLUDED.gen, expires_at=EXCLUDED.expires_at,
           revoked=EXCLUDED.revoked, last_seen_at=EXCLUDED.last_seen_at`,
        [sid, rec.userId, rec.createdAt, rec.lastSeenAt || 0, rec.expiresAt, rec.absoluteExpiryAt, rec.ip || '',
         rec.device || '', rec.deviceId || '', rec.gen || 1, rec.currentToken, !!rec.revoked]);
    }
    for (const [sid, at] of Object.entries(storeState.revokedSids || {})) {
      await client.query('INSERT INTO revoked_sessions (sid, revoked_at) VALUES ($1,$2) ON CONFLICT (sid) DO UPDATE SET revoked_at=EXCLUDED.revoked_at', [sid, at]);
    }
    for (const [key, value] of Object.entries(storeState.config)) {
      // JSON.stringify: plain strings become valid JSON string literals for the jsonb column
      await client.query('INSERT INTO app_config (key, value, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at',
        [key, JSON.stringify(value ?? null), now]);
    }
    if (storeState.ratePolicy) {
      for (const [key, pol] of Object.entries(storeState.ratePolicy)) {
        await client.query('INSERT INTO rate_policy (key, policy, updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET policy=EXCLUDED.policy, updated_at=EXCLUDED.updated_at',
          [key, JSON.stringify(pol ?? null), now]);
      }
    }
    await client.query('COMMIT');
    // full snapshot (separate, slower cadence)
    if (now - state.lastSnapshotAt > state.snapshotMinSecs * 1000) {
      state.lastSnapshotAt = now;
      await snapshotNow(storeState);
    }
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function snapshotNow(storeState) {
  const p = await ready();
  if (!p) return null;
  const json = JSON.stringify(storeState);
  const res = await p.query('INSERT INTO state_snapshots (saved_at, size_bytes, state) VALUES ($1,$2,$3::jsonb) RETURNING id',
    [Date.now(), Buffer.byteLength(json), json]);
  // keep the last 20 snapshots
  await p.query('DELETE FROM state_snapshots WHERE id NOT IN (SELECT id FROM state_snapshots ORDER BY saved_at DESC LIMIT 20)');
  return res.rows[0].id;
}

// ---------------- audit append (append-only in the DB) ----------------
let auditQueue = [];
let auditFlushing = false;
async function flushAudit() {
  if (!configured() || auditFlushing) return;
  auditFlushing = true;
  const batch = auditQueue.splice(0, auditQueue.length);
  try {
    const p = await ready();
    if (!p || !batch.length) return;
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      for (const e of batch) {
        await client.query(
          `INSERT INTO audit_log (id, username, action, object_type, object_id, detail, ip, device, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [e.id, e.username, e.action, e.objectType, e.objectId, String(e.detail || '').slice(0, 2000), e.ip, e.device, e.createdAt]);
      }
      await client.query('COMMIT');
    } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; }
    finally { client.release(); }
  } catch (e) { state.error = 'audit flush failed: ' + e.message; console.error('[db] audit flush failed:', e.message); }
  finally { auditFlushing = false; }
}
function appendAudit(entry) {
  if (!configured()) return;
  auditQueue.push(entry);
  if (auditQueue.length >= 25) flushAudit();
  else setTimeout(flushAudit, 3000);
}

// ---------------- retention (PRIV-01) ----------------
async function runRetention(storeState, days) {
  // Retention uses the platform's own clock domain (simNow in the demo; wall-clock
  // in production) so records timestamped in the simulation are pruned consistently.
  const clock = (storeState.meta && storeState.meta.simNow) || Date.now();
  const cutoff = clock - days * 86400000;
  let pruned = 0;
  if (storeState.audit) {
    const before = storeState.audit.length;
    storeState.audit = storeState.audit.filter(a => a.createdAt >= cutoff);
    pruned += before - storeState.audit.length;
  }
  if (storeState.systemEvents) {
    const before = storeState.systemEvents.length;
    storeState.systemEvents = storeState.systemEvents.filter(e => e.ts >= cutoff);
    pruned += before - storeState.systemEvents.length;
  }
  if (configured()) {
    const p = await ready();
    if (p) {
      const r = await p.query('DELETE FROM audit_log WHERE created_at < $1', [cutoff]);
      pruned += r.rowCount;
      await p.query('DELETE FROM notifications WHERE created_at < $1', [cutoff]);
    }
  }
  return pruned;
}

// ---------------- export / import (backup & restore) ----------------
const EXPORT_TABLES = ['users', 'roles', 'sessions', 'revoked_sessions', 'audit_log', 'app_config', 'rate_policy',
  'lgas', 'wards', 'pus', 'elections', 'agents', 'devices', 'submissions', 'evidence', 'incidents', 'sos_events', 'streams', 'notifications'];

function sqlEscape(v, type) {
  if (v === null || v === undefined) return 'NULL';
  // json/jsonb columns: emit the value as a JSON literal (booleans/numbers inside
  // JSON stay valid — a bare TRUE/FALSE would fail the jsonb cast)
  if (type === 'jsonb' || type === 'json') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

async function exportSql() {
  const p = await ready();
  if (!p) throw new Error(state.error || 'database unavailable');
  const out = [];
  out.push('-- EYES OF VICTORY — logical backup (M3 database layer)');
  out.push('-- Generated ' + new Date().toISOString());
  for (const t of EXPORT_TABLES) {
    const cols = await p.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [t]);
    if (!cols.rowCount) continue;
    const colNames = cols.rows.map(r => r.column_name);
    const colTypes = cols.rows.map(r => r.data_type);
    const rows = await p.query(`SELECT * FROM ${t}`);
    out.push(`-- table: ${t} (${rows.rowCount} rows)`);
    out.push(`DELETE FROM ${t};`);
    for (const row of rows.rows) {
      const vals = colNames.map((c, i) => sqlEscape(row[c], colTypes[i])).join(', ');
      out.push(`INSERT INTO ${t} (${colNames.map(c => '"' + c + '"').join(', ')}) VALUES (${vals});`);
    }
  }
  return out.join('\n') + '\n';
}

async function importSql(sqlText) {
  const p = await ready();
  if (!p) throw new Error(state.error || 'database unavailable');
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(sqlText);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

function statusInfo() {
  return {
    mode: configured() ? 'postgres' : 'json',
    configured: configured(),
    connected: state.connected,
    driverAvailable: !!pg,
    error: state.error,
    tables: state.tables,
    counts: state.counts,
    lastMirrorAt: state.lastMirrorAt,
    lastSnapshotAt: state.lastSnapshotAt,
    snapshotMinSecs: state.snapshotMinSecs,
    pendingAuditQueue: auditQueue.length,
    note: configured()
      ? 'Postgres is the durable source of truth; the in-memory store is the runtime working set mirrored on every save.'
      : 'No DATABASE_URL configured — running on the JSON store (demo fallback). Set DATABASE_URL to enable PostgreSQL persistence.',
  };
}

module.exports = {
  configured, ready, query, migrate, hydrateInto, ensureHydrated, scheduleMirror, snapshotNow, appendAudit,
  runRetention, exportSql, importSql, statusInfo, refreshCounts,
};
