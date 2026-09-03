// ratelimit.js — M2 central rate limiting.
// Policies live in the shared store (persisted locally; re-seeded deterministically
// on serverless cold starts). Buckets are keyed by policy + identifier (IP / username).
// AUTH-03 (audit): replaces the ad-hoc per-call limiter with one policy registry that
// admins and SENTINEL actions can adjust at runtime — and that has a clean boundary
// for a future Redis-backed implementation (swap `check()` + `snapshot()` only).
'use strict';
const { S, set } = require('./store');

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
}

const DEFAULT_POLICIES = {
  login:   { windowMs: 60000,   max: 60,   cooldownAfter: 8,  cooldownMs: 5 * 60000,   label: 'Sign-in attempts per address (demo: shared proxy IPs)' },
  mfa:     { windowMs: 60000,   max: 60,   cooldownAfter: 5,  cooldownMs: 2 * 60000,   label: 'MFA verifications per address (demo: shared proxy IPs)' },
  pwreset: { windowMs: 900000,  max: 3,    cooldownAfter: 3,  cooldownMs: 15 * 60000,  label: 'Password-reset requests' },
  api:     { windowMs: 60000,   max: 2000, cooldownAfter: 0,  cooldownMs: 0,           label: 'General API requests per address (demo: shared proxy IPs)' },
};

function ensureInitialized() {
  const st = S();
  if (!st.ratePolicy) st.ratePolicy = {};
  for (const [k, v] of Object.entries(DEFAULT_POLICIES)) {
    if (!st.ratePolicy[k]) st.ratePolicy[k] = { ...v };
  }
  if (!st.rateBuckets) st.rateBuckets = {};
}

function policyOf(key) {
  ensureInitialized();
  const st = S();
  return st.ratePolicy[key] || { windowMs: 60000, max: 240, cooldownAfter: 0, cooldownMs: 0, label: key };
}

function snapshot() {
  ensureInitialized();
  const st = S();
  const summary = {};
  for (const [key, pol] of Object.entries(st.ratePolicy)) {
    const active = Object.keys(st.rateBuckets).filter(b => b.startsWith(key + ':')).length;
    summary[key] = { ...pol, activeBuckets: active };
  }
  return summary;
}

function setPolicy(key, patch) {
  ensureInitialized();
  const st = S();
  const pol = st.ratePolicy[key] || { ...(DEFAULT_POLICIES[key] || {}) };
  if (Number.isFinite(patch.max)) pol.max = Math.max(1, Math.min(100000, parseInt(patch.max, 10)));
  if (Number.isFinite(patch.windowMs)) pol.windowMs = Math.max(1000, Math.min(86400000, parseInt(patch.windowMs, 10)));
  if (Number.isFinite(patch.cooldownMs)) pol.cooldownMs = Math.max(0, Math.min(86400000, parseInt(patch.cooldownMs, 10)));
  st.ratePolicy[key] = pol;
  set(() => {});
  return pol;
}

function clearBuckets(key) {
  ensureInitialized();
  const st = S();
  for (const k of Object.keys(st.rateBuckets)) if (!key || k.startsWith(key + ':')) delete st.rateBuckets[k];
  set(() => {});
}

// Returns { allowed } — bumps the bucket. Cooldown lockouts live in the same bucket map.
function check(key, identifier) {
  ensureInitialized();
  const st = S();
  const pol = policyOf(key);
  const now = Date.now();
  const id = String(identifier || 'unknown').slice(0, 64);
  const lockKey = `${key}:lock:${id}`;
  const lock = st.rateBuckets[lockKey];
  if (lock && lock.until > now) return { allowed: false, retryAfterMs: lock.until - now, locked: true };
  const bk = `${key}:${id}`;
  let b = st.rateBuckets[bk] || { count: 0, start: now };
  if (now - b.start > pol.windowMs) { b.count = 0; b.start = now; }
  b.count++;
  st.rateBuckets[bk] = b;
  if (b.count > pol.max) {
    if (pol.cooldownAfter > 0 && b.count - pol.max >= pol.cooldownAfter) {
      st.rateBuckets[lockKey] = { until: now + pol.cooldownMs };
    }
    if (Object.keys(st.rateBuckets).length > 20000) { // bound the registry
      for (const k of Object.keys(st.rateBuckets)) { delete st.rateBuckets[k]; break; }
    }
    return { allowed: false, retryAfterMs: Math.max(1000, pol.windowMs - (now - b.start)), locked: false };
  }
  return { allowed: true };
}

// HTTP-shaped helper used by the router (keeps error shapes from M1 intact)
function httpGuard(req, res, key, identifierOverride) {
  const id = identifierOverride || clientIp(req);
  const r = check(key, id);
  if (r.allowed) return false;
  const retry = Math.max(1, Math.ceil((r.retryAfterMs || 60000) / 1000));
  const body = JSON.stringify({ error: 'RATE_LIMITED', message: `Too many requests. Please wait about ${retry}s and try again.`, locked: !!r.locked });
  res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
  return true;
}

module.exports = { DEFAULT_POLICIES, ensureInitialized, policyOf, snapshot, setPolicy, clearBuckets, check, httpGuard };
