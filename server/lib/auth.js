// auth.js — M2 IDENTITY & ACCESS: real TOTP MFA, revocable + refreshable sessions,
// password reset/change with policy, real auth telemetry, brute-force protection.
'use strict';
const crypto = require('crypto');
const { uuid, sha256, checkPassword, hashPassword } = require('./util');
const { S, set, audit } = require('./store');
const totp = require('./totp');

const SESSION_TTL = 12 * 3600 * 1000;          // sliding session lifetime
const SESSION_ABSOLUTE_TTL = 72 * 3600 * 1000; // hard cap from issuance
const CHALLENGE_TTL = 5 * 60 * 1000;
const RESET_TTL = 15 * 60 * 1000;

// ---- P0-01 (audit): no committed default signing key ----
let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (!SESSION_SECRET && !process.env.VERCEL && process.env.NODE_ENV !== 'production') {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] SESSION_SECRET not set — using a random per-boot secret (sessions reset on restart). Set SESSION_SECRET for stable sessions.');
}
function assertSessionSecretConfigured() {
  if (!SESSION_SECRET) {
    throw new Error('SESSION_SECRET_REQUIRED: set the SESSION_SECRET environment variable (generate one with: openssl rand -hex 32). On Vercel: Project → Settings → Environment Variables.');
  }
}

// ---------------- HMAC-signed payloads ----------------
function sign(payload) {
  return payload + '.' + crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}
function verifySig(token, parts) {
  const expected = String(token || '').split('.');
  if (expected.length !== parts) return null;
  const payload = expected.slice(0, parts - 1).join('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(expected[parts - 1]); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return expected;
}

// Session token: sid.userId.iat.expiresAt.gen.sig
function signToken(sid, userId, iat, expiresAt, gen) {
  return sign(`${sid}.${userId}.${iat}.${expiresAt}.${gen}`);
}
function parseToken(token) {
  const p = verifySig(token, 6);
  if (!p) return null;
  const [sid, userId, iat, exp, gen] = p;
  const iatN = parseInt(iat, 10), expN = parseInt(exp, 10), genN = parseInt(gen, 10);
  if (!Number.isFinite(iatN) || !Number.isFinite(expN) || !Number.isFinite(genN)) return null;
  return { sid, userId, iat: iatN, expiresAt: expN, gen: genN };
}

// Challenge token (MFA / password reset): userId.expiry.codeHash.sig
function signChallenge(userId, code, ttl = CHALLENGE_TTL) {
  const expires = Date.now() + ttl;
  const codeHash = crypto.createHash('sha256').update(String(code)).digest('base64url');
  return sign(`${userId}.${expires}.${codeHash}`);
}
// verifies signature + expiry + code match when `code` is provided
function verifyChallenge(token, code) {
  const p = verifySig(token, 4);
  if (!p) return null;
  const [uid, exp, codeHash] = p;
  const expiresAt = parseInt(exp, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  if (code !== undefined) {
    const given = crypto.createHash('sha256').update(String(code || '')).digest('base64url');
    const g = Buffer.from(given), h = Buffer.from(codeHash);
    if (g.length !== h.length || !crypto.timingSafeEqual(g, h)) return null;
  }
  return { userId: uid, expiresAt };
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || 'unknown').split(',')[0].trim();
}

// ---------------- auth telemetry (real, feeds SENTINEL §14/§56) ----------------
function bump(key) {
  const st = S();
  if (!st.authTelemetry) st.authTelemetry = {};
  st.authTelemetry[key] = (st.authTelemetry[key] || 0) + 1;
  set(() => {});
}
function bumpHour(field) {
  const st = S();
  if (!st.authTelemetry) st.authTelemetry = {};
  if (!Array.isArray(st.authTelemetry.hourly)) st.authTelemetry.hourly = [];
  const hour = Math.floor(Date.now() / 3600000);
  let b = st.authTelemetry.hourly[st.authTelemetry.hourly.length - 1];
  if (!b || b.h !== hour) {
    b = { h: hour, logins: 0, failures: 0, resets: 0, mfa: 0 };
    st.authTelemetry.hourly.push(b);
    if (st.authTelemetry.hourly.length > 48) st.authTelemetry.hourly.shift();
  }
  b[field] = (b[field] || 0) + 1;
  set(() => {});
}
function telemetry() {
  const st = S();
  const t = st.authTelemetry || {};
  const hourly = (t.hourly || []).slice(-24).map(b => ({ at: b.h * 3600000, logins: b.logins, failures: b.failures, resets: b.resets, mfa: b.mfa }));
  return {
    loginAttempts: t.loginAttempts || 0, failedLogins: t.failedLogins || 0,
    mfaEvents: t.mfaEvents || 0, mfaFailures: t.mfaFailures || 0,
    passwordResets: t.passwordResets || 0, sessionsCreated: t.sessionsCreated || 0,
    sessionsTerminated: t.sessionsTerminated || 0, privilegeChanges: t.privilegeChanges || 0,
    newDevices: t.newDevices || 0, hourly,
  };
}

// ---------------- sessions v2 (revocable + refreshable) ----------------
function deviceIdOf(req) {
  return sha256(String(req.headers['user-agent'] || 'unknown')).slice(0, 16);
}
function issueSession(userId, req) {
  const st = S();
  const now = Date.now();
  const sid = uuid();
  const expiresAt = now + SESSION_TTL;
  const token = signToken(sid, userId, now, expiresAt, 1);
  const deviceId = deviceIdOf(req);
  const record = {
    sid, userId, createdAt: now, lastSeenAt: now, expiresAt,
    absoluteExpiryAt: now + SESSION_ABSOLUTE_TTL,
    ip: clientIp(req), device: String(req.headers['user-agent'] || '').slice(0, 90),
    deviceId, gen: 1, currentToken: token, revoked: false,
  };
  st.sessions[sid] = record;
  st.sessionTokens[token] = sid;
  // device trust telemetry: first login from this device for this user
  if (!st.userDevices) st.userDevices = {};
  if (!st.userDevices[userId]) st.userDevices[userId] = {};
  if (!st.userDevices[userId][deviceId]) {
    st.userDevices[userId][deviceId] = now;
    bump('newDevices');
  }
  bump('sessionsCreated');
  // prune expired sessions
  for (const [s, r] of Object.entries(st.sessions)) {
    if (r.expiresAt < now || r.absoluteExpiryAt < now) { delete st.sessionTokens[r.currentToken]; delete st.sessions[s]; }
  }
  set(() => {});
  return { token, sid };
}

function recordFor(sid) {
  const st = S();
  return st.sessions[sid] || null;
}
function revokeSession(sid, by = null) {
  const st = S();
  const rec = st.sessions[sid];
  if (!rec) return false;
  rec.revoked = true;
  st.revokedSids[sid] = Date.now();
  delete st.sessionTokens[rec.currentToken];
  bump('sessionsTerminated');
  if (by) audit(by, 'SESSION_REVOKED', 'session', sid, `session of ${rec.userId} revoked by ${by.username}`, null);
  set(() => {});
  return true;
}
function revokeAllSessions(userId, by = null) {
  const st = S();
  const user = st.users.find(u => u.id === userId);
  let n = 0;
  if (user) {
    user.sessionsInvalidatedAt = Date.now();
    for (const [sid, rec] of Object.entries(st.sessions)) {
      if (rec.userId === userId) { rec.revoked = true; st.revokedSids[sid] = Date.now(); delete st.sessionTokens[rec.currentToken]; n++; bump('sessionsTerminated'); }
    }
  }
  if (by) audit(by, 'SESSIONS_REVOKED_ALL', 'user', userId, `${n} session(s) invalidated by ${by.username}`, null);
  set(() => {});
  return n;
}
function revokeAllExcept(userId, keepSid) {
  const st = S();
  let n = 0;
  for (const [sid, rec] of Object.entries(st.sessions)) {
    if (rec.userId === userId && sid !== keepSid) { rec.revoked = true; st.revokedSids[sid] = Date.now(); delete st.sessionTokens[rec.currentToken]; n++; bump('sessionsTerminated'); }
  }
  set(() => {});
  return n;
}
function listSessions(userId = null) {
  const st = S();
  const out = [];
  for (const rec of Object.values(st.sessions)) {
    if (userId && rec.userId !== userId) continue;
    const u = st.users.find(x => x.id === rec.userId);
    out.push({
      id: rec.sid, sid: rec.sid, user: u ? u.username : rec.userId,
      role: u ? (st.roles.find(r => r.id === u.roleId)?.name || u.roleId) : '—',
      loginAt: rec.createdAt, device: rec.device, ip: rec.ip,
      privilegedActions: 0, riskStatus: 'NORMAL', active: !rec.revoked && rec.expiresAt > Date.now(),
      expiresAt: rec.expiresAt,
    });
  }
  return out;
}

function currentUser(req) {
  const st = S();
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  const sid = st.sessionTokens[token];
  let rec = sid ? st.sessions[sid] : null;
  if (rec) {
    // a refresh retires the previous token: only the CURRENT token is valid
    // while the session record exists (stateless fallback covers lost records)
    if (rec.currentToken !== token) return null;
    if (rec.revoked || rec.expiresAt < Date.now() || rec.absoluteExpiryAt < Date.now()) return null;
    const user = st.users.find(u => u.id === rec.userId);
    if (!user || user.status !== 'ACTIVE') return null;
    if (user.sessionsInvalidatedAt && rec.createdAt < user.sessionsInvalidatedAt) return null;
    rec.lastSeenAt = Date.now();
    return { ...user, sessionToken: token, sessionId: rec.sid };
  }
  // serverless fallback: session store lost on instance recycle — validate the
  // signed token statelessly (deterministic user ids keep this working).
  // If the session record DOES exist, only its current token is valid (refresh
  // retirement is enforced even on the fallback path).
  const parsed = parseToken(token);
  if (!parsed) return null;
  const existing = st.sessions[parsed.sid];
  if (existing && existing.currentToken !== token) return null;
  if (parsed.expiresAt < Date.now()) return null;
  if (parsed.iat + SESSION_ABSOLUTE_TTL < Date.now()) return null;
  if (st.revokedSids[parsed.sid] && st.revokedSids[parsed.sid] > parsed.iat) return null;
  const user = st.users.find(u => u.id === parsed.userId);
  if (!user || user.status !== 'ACTIVE') return null;
  if (user.sessionsInvalidatedAt && parsed.iat < user.sessionsInvalidatedAt) return null;
  // rebuild the record for continuity
  rec = {
    sid: parsed.sid, userId: parsed.userId, createdAt: parsed.iat, lastSeenAt: Date.now(),
    expiresAt: parsed.expiresAt, absoluteExpiryAt: parsed.iat + SESSION_ABSOLUTE_TTL,
    ip: clientIp(req), device: String(req.headers['user-agent'] || '').slice(0, 90),
    deviceId: deviceIdOf(req), gen: parsed.gen, currentToken: token, revoked: false,
  };
  st.sessions[parsed.sid] = rec;
  st.sessionTokens[token] = parsed.sid;
  set(() => {});
  return { ...user, sessionToken: token, sessionId: parsed.sid };
}

// Sliding refresh: validates the current token, issues a new one (same sid, gen+1),
// retires the old one. The old token becomes invalid while the session record exists.
function refreshSession(req) {
  const st = S();
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return { error: 'UNAUTHENTICATED' };
  const parsed = parseToken(token);
  if (!parsed) return { error: 'UNAUTHENTICATED' };
  const rec = st.sessions[parsed.sid];
  if (!rec || rec.revoked) return { error: 'SESSION_LOST', message: 'Session no longer exists. Please sign in again.' };
  const user = st.users.find(u => u.id === rec.userId);
  if (!user || user.status !== 'ACTIVE') return { error: 'UNAUTHENTICATED' };
  if (parsed.iat + SESSION_ABSOLUTE_TTL < Date.now()) return { error: 'ABSOLUTE_EXPIRY', message: 'Session reached its absolute lifetime. Please sign in again.' };
  const now = Date.now();
  const newToken = signToken(rec.sid, rec.userId, rec.createdAt, now + SESSION_TTL, rec.gen + 1);
  delete st.sessionTokens[rec.currentToken];
  rec.currentToken = newToken; rec.gen += 1; rec.expiresAt = now + SESSION_TTL; rec.lastSeenAt = now;
  st.sessionTokens[newToken] = rec.sid;
  audit({ id: user.id, username: user.username }, 'SESSION_REFRESHED', 'session', rec.sid, `gen ${rec.gen}`, req);
  set(() => {});
  return { ok: true, token: newToken, expiresAt: rec.expiresAt };
}

// ---------------- password policy ----------------
function passwordPolicyError(pw) {
  const p = String(pw || '');
  if (p.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'Password must contain at least one letter and one number.';
  return null;
}

// ---------------- MFA (TOTP) ----------------
function mfaSetup(user) {
  const secret = user.totpSecret;
  if (!secret) return null;
  return {
    type: 'TOTP', secret,
    uri: totp.otpauthUrl('EYES OF VICTORY', user.username, secret),
    currentCode: totp.totpCode(secret), // demo mode: displayed
    rotatesInSec: totp.secondsToRotation(),
  };
}
function verifyStepup(user, code) {
  if (!user || !user.totpSecret) return false;
  return totp.totpVerify(user.totpSecret, code);
}
function mfaCoverage() {
  const st = S();
  const users = st.users.filter(u => u.status === 'ACTIVE');
  if (!users.length) return 100;
  const enrolled = users.filter(u => u.mfa && u.totpSecret).length;
  return Math.round(enrolled / users.length * 100);
}

// ---------------- login ----------------
function loginStep1(req, res, body) {
  const st = S();
  const ip = clientIp(req);
  bump('loginAttempts'); bumpHour('logins');
  const lock = st.loginAttempts[ip] || { fails: 0, until: 0 };
  if (lock.until > Date.now()) {
    return sendJson(res, 429, { error: 'LOCKED', message: `Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} min.` });
  }
  const user = st.users.find(u => u.username === (body.username || '').trim().toLowerCase());
  if (!user || !checkPassword(body.password || '', user.passwordHash)) {
    lock.fails++; lock.until = lock.fails >= 5 ? Date.now() + 5 * 60000 : 0;
    st.loginAttempts[ip] = lock;
    bump('failedLogins'); bumpHour('failures');
    if (user) { user.failedLoginCount = (user.failedLoginCount || 0) + 1; user.lastFailedAt = Date.now(); }
    audit(null, 'LOGIN_FAILED', 'user', user ? user.id : null, `ip=${ip}`, req);
    set(() => {});
    return sendJson(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
  }
  if (user.status !== 'ACTIVE') return sendJson(res, 403, { error: 'DISABLED', message: 'Account disabled. Contact administrator.' });
  delete st.loginAttempts[ip];
  // REAL TOTP: the code is computed from the user's enrolled RFC 6238 secret and
  // verified against the same algorithm. In demo mode the current code is displayed.
  const mfaCode = totp.totpCode(user.totpSecret);
  const challenge = signChallenge(user.id, mfaCode);
  st.loginAttempts['ch:' + challenge] = { userId: user.id, expires: Date.now() + CHALLENGE_TTL, failedBefore: user.failedLoginCount || 0 };
  audit(null, 'LOGIN_CHALLENGE', 'user', user.id, `TOTP challenge issued (ip=${ip})`, req);
  set(() => {});
  return sendJson(res, 200, {
    mfaRequired: true, mfaType: 'TOTP', challenge, mfaCode,
    totpRotatesInSec: totp.secondsToRotation(),
    demoHint: 'DEMO MODE: the current TOTP code is displayed for demonstration',
    user: publicUser(user),
  });
}

function loginStep2(req, res, body) {
  const st = S();
  const challenge = body.challenge || '';
  const chKey = 'ch:' + challenge;
  const ch = st.loginAttempts[chKey];
  const MAX_ATTEMPTS = 3;
  const complete = (user, note) => {
    delete st.loginAttempts[chKey];
    const { token } = issueSession(user.id, req);
    user.failedLoginCount = 0;
    user.loginCount = (user.loginCount || 0) + 1;
    user.lastLoginAt = Date.now();
    bump('mfaEvents'); bumpHour('mfa');
    audit(null, 'LOGIN_SUCCESS', 'user', user.id, note, req);
    set(() => {});
    return sendJson(res, 200, { token, user: publicUser(user) });
  };
  // stateless path (serverless): challenge issued on another instance
  if (!ch || ch.expires < Date.now()) {
    const parsed = verifyChallenge(challenge);
    if (!parsed) {
      delete st.loginAttempts[chKey];
      return sendJson(res, 400, { error: 'CHALLENGE_EXPIRED', message: 'MFA challenge expired. Please sign in again to receive a fresh code.' });
    }
    const user = st.users.find(u => u.id === parsed.userId);
    if (!user) return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Session user no longer exists.' });
    if (!totp.totpVerify(user.totpSecret, body.code)) {
      bump('mfaFailures');
      audit(null, 'MFA_FAILED', 'user', user.id, 'stateless TOTP mismatch', req);
      return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Incorrect verification code.' });
    }
    return complete(user, `TOTP verified — signed challenge (stateless) (ip=${clientIp(req)})`);
  }
  ch.attempts = (ch.attempts || 0) + 1;
  const user = st.users.find(u => u.id === ch.userId);
  if (!user) return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Session user no longer exists.' });
  if (!totp.totpVerify(user.totpSecret, body.code)) {
    bump('mfaFailures');
    const left = MAX_ATTEMPTS - ch.attempts;
    if (left <= 0) {
      delete st.loginAttempts[chKey];
      audit(null, 'MFA_LOCKED', 'user', ch.userId, `too many incorrect codes (${MAX_ATTEMPTS})`, req);
      return sendJson(res, 429, { error: 'MFA_LOCKED', message: 'Too many incorrect codes. Please sign in again to receive a fresh code.', attemptsLeft: 0 });
    }
    audit(null, 'MFA_FAILED', 'user', ch.userId, `incorrect TOTP code (${left} attempt(s) left)`, req);
    return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Incorrect verification code.', attemptsLeft: left });
  }
  return complete(user, `TOTP verified (ip=${clientIp(req)})`);
}

// ---------------- password reset (enumeration-safe, demo displays the code) ----------------
function requestPasswordReset(req, res, body) {
  const st = S();
  const username = (body.username || '').trim().toLowerCase();
  const user = st.users.find(u => u.username === username);
  if (user && user.status === 'ACTIVE') {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const token = signChallenge(user.id, code, RESET_TTL);
    audit(null, 'PASSWORD_RESET_REQUESTED', 'user', user.id, `ip=${clientIp(req)}`, req);
    set(() => {});
    if (st.config.demoMode) {
      return sendJson(res, 200, { ok: true, demo: { token, code, username: user.username }, note: 'DEMO MODE: the reset code is displayed. Production delivers it via a verified channel (email/SMS).' });
    }
    return sendJson(res, 200, { ok: true, note: 'If the account exists, reset instructions have been sent.' });
  }
  // enumeration-safe: identical response shape
  if (S().config.demoMode) return sendJson(res, 200, { ok: true, note: 'No active account matches that username.' });
  return sendJson(res, 200, { ok: true, note: 'If the account exists, reset instructions have been sent.' });
}

function completePasswordReset(req, res, body) {
  const st = S();
  const parsed = verifyChallenge(body.token || '', body.code);
  if (!parsed) return sendJson(res, 400, { error: 'RESET_INVALID', message: 'Reset link invalid or expired. Request a new one.' });
  const user = st.users.find(u => u.id === parsed.userId);
  if (!user || user.status !== 'ACTIVE') return sendJson(res, 400, { error: 'RESET_INVALID', message: 'Account unavailable.' });
  const policyErr = passwordPolicyError(body.newPassword);
  if (policyErr) return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: policyErr });
  user.passwordHash = hashPassword(body.newPassword);
  user.passwordChangedAt = Date.now();
  revokeAllSessions(user.id, { id: user.id, username: user.username });
  bump('passwordResets'); bumpHour('resets');
  audit(null, 'PASSWORD_RESET_COMPLETED', 'user', user.id, `ip=${clientIp(req)}`, req);
  set(() => {});
  return sendJson(res, 200, { ok: true, message: 'Password updated. All previous sessions have been signed out.' });
}

function changePassword(req, res, body) {
  const u = currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  if (!checkPassword(body.currentPassword || '', u.passwordHash)) {
    return sendJson(res, 401, { error: 'BAD_CURRENT_PASSWORD', message: 'Current password is incorrect.' });
  }
  const policyErr = passwordPolicyError(body.newPassword);
  if (policyErr) return sendJson(res, 400, { error: 'WEAK_PASSWORD', message: policyErr });
  const st = S();
  const user = st.users.find(x => x.id === u.id);
  user.passwordHash = hashPassword(body.newPassword);
  user.passwordChangedAt = Date.now();
  revokeAllExcept(user.id, u.sessionId);
  audit(u, 'PASSWORD_CHANGED', 'user', user.id, 'self-service change', req);
  set(() => {});
  return sendJson(res, 200, { ok: true, message: 'Password changed. Other sessions were signed out.' });
}

// ---------------- RBAC ----------------
function roleOf(user) { return S().roles.find(r => r.id === user.roleId); }
function can(user, perm) {
  if (!user) return false;
  const role = roleOf(user);
  if (!role) return false;
  return role.permissions.includes(perm);
}
function requirePerm(perm) {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED', message: 'Authentication required' });
    if (!can(user, perm)) return sendJson(res, 403, { error: 'FORBIDDEN', message: `Missing permission: ${perm}` });
    req.user = user;
    next();
  };
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return sendJson(res, 401, { error: 'UNAUTHENTICATED', message: 'Authentication required' });
  req.user = user;
  next();
}

const sendJson = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
};

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, name: u.name, roleId: u.roleId,
    roleName: S().roles.find(r => r.id === u.roleId)?.name, scope: u.scope, phone: u.phone,
    mfa: u.mfa, mfaType: u.mfaType || 'TOTP', totpEnrolled: !!u.totpSecret,
    status: u.status, agentId: u.agentId, lastLoginAt: u.lastLoginAt || null,
  };
}

// backward-compatible limiter wrapper (router now uses lib/ratelimit directly)
function rateLimit(req, res, { windowMs = 60000, max = 240, key } = {}) {
  const limiter = require('./ratelimit');
  return limiter.httpGuard(req, res, key || 'api');
}

module.exports = {
  requireAuth, requirePerm, can, currentUser, loginStep1, loginStep2, publicUser,
  rateLimit, clientIp, sendJson, SESSION_TTL, SESSION_ABSOLUTE_TTL, assertSessionSecretConfigured,
  issueSession, revokeSession, revokeAllSessions, revokeAllExcept, listSessions, refreshSession,
  passwordPolicyError, requestPasswordReset, completePasswordReset, changePassword,
  verifyStepup, mfaSetup, mfaCoverage, telemetry, bump, bumpHour, deviceIdOf, signChallenge, verifyChallenge,
};
