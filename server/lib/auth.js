// auth.js — sessions, MFA, RBAC middleware, rate limiting, brute-force protection
'use strict';
const crypto = require('crypto');
const { uuid, checkPassword } = require('./util');
const { S, audit } = require('./store');

const SESSION_TTL = 12 * 3600 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'ev2027-kn-demo-session-secret';

// Signed session tokens: on serverless hosts the in-memory session store is lost
// whenever an instance recycles, so every token carries an HMAC-signed
// userId + expiry that survives cold starts (seed data is deterministic).
function signToken(userId, expiresAt) {
  const payload = `${userId}.${expiresAt}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(`${uid}.${exp}`).digest('base64url');
  const a = Buffer.from(String(sig)); const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expiresAt = parseInt(exp, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  return { userId: uid, expiresAt };
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// simple in-memory rate limiter
function rateLimit(req, res, { windowMs = 60000, max = 240, key } = {}) {
  const st = S();
  const ip = clientIp(req);
  const k = `${key || 'api'}:${ip}`;
  const now = Date.now();
  const b = st.rateBuckets[k] || { count: 0, start: now };
  if (now - b.start > windowMs) { b.count = 0; b.start = now; }
  b.count++;
  st.rateBuckets[k] = b;
  if (Object.keys(st.rateBuckets).length > 20000) st.rateBuckets = {};
  if (b.count > max) return true;
  return false;
}

function issueSession(userId, req) {
  const st = S();
  const expiresAt = Date.now() + SESSION_TTL;
  const token = signToken(userId, expiresAt);
  const session = {
    token, userId, createdAt: Date.now(), expiresAt,
    ip: clientIp(req), device: (req.headers['user-agent'] || '').slice(0, 90),
  };
  st.sessions[token] = session;
  // prune expired
  for (const [tk, s] of Object.entries(st.sessions)) if (s.expiresAt < Date.now()) delete st.sessions[tk];
  return token;
}

function currentUser(req) {
  const st = S();
  const h = req.headers['authorization'] || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return null;
  let s = st.sessions[token];
  let userId = s ? s.userId : null;
  if (!s || s.expiresAt < Date.now()) {
    // serverless fallback: the session store may have been lost on an instance
    // recycle — validate the signed token and rebuild the session record.
    const parsed = verifyToken(token);
    if (!parsed) return null;
    userId = parsed.userId;
    s = { token, userId, createdAt: Date.now(), expiresAt: parsed.expiresAt };
    st.sessions[token] = s;
  }
  const user = st.users.find(u => u.id === userId);
  if (!user || user.status !== 'ACTIVE') return null;
  return { ...user, sessionToken: token };
}

function roleOf(user) { return S().roles.find(r => r.id === user.roleId); }

function can(user, perm) {
  if (!user) return false;
  const role = roleOf(user);
  if (!role) return false;
  return role.permissions.includes(perm);
}

// route guard
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

// login: step 1 -> challenge (MFA); step 2 -> session token
// Self-contained signed MFA challenge: carries userId + expiry + code hash, HMAC-signed.
// On serverless hosts the in-memory challenge store may live on another instance than
// the one that receives the verification POST — the signed payload makes the challenge
// verifiable anywhere without shared memory.
function signChallenge(userId, code) {
  const expires = Date.now() + CHALLENGE_TTL;
  const codeHash = crypto.createHash('sha256').update(String(code)).digest('base64url');
  const payload = `${userId}.${expires}.${codeHash}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyChallenge(token, code) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return null;
  const [uid, exp, codeHash, sig] = parts;
  const payload = `${uid}.${exp}.${codeHash}`;
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(String(sig)), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const expiresAt = parseInt(exp, 10);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;
  const given = crypto.createHash('sha256').update(String(code || '')).digest('base64url');
  const g = Buffer.from(given), h = Buffer.from(codeHash);
  if (g.length !== h.length || !crypto.timingSafeEqual(g, h)) return null;
  return { userId: uid, expiresAt };
}

function loginStep1(req, res, body) {
  const st = S();
  const ip = clientIp(req);
  const lock = st.loginAttempts[ip] || { fails: 0, until: 0 };
  if (lock.until > Date.now()) {
    return sendJson(res, 429, { error: 'LOCKED', message: `Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} min.` });
  }
  const user = st.users.find(u => u.username === (body.username || '').trim().toLowerCase());
  if (!user || !checkPassword(body.password || '', user.passwordHash)) {
    lock.fails++; lock.until = lock.fails >= 5 ? Date.now() + 5 * 60000 : 0;
    st.loginAttempts[ip] = lock;
    audit(null, 'LOGIN_FAILED', 'user', user ? user.id : null, `ip=${ip}`, req);
    return sendJson(res, 401, { error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
  }
  if (user.status !== 'ACTIVE') return sendJson(res, 403, { error: 'DISABLED', message: 'Account disabled. Contact administrator.' });
  delete st.loginAttempts[ip];
  // DEMO MODE: MFA code is surfaced in the response so the demo flow is usable
  const mfaCode = String(Math.floor(100000 + Math.random() * 900000));
  const challenge = signChallenge(user.id, mfaCode);
  // in-memory mirror for attempt limiting on this instance (stateless fallback below)
  st.loginAttempts['ch:' + challenge] = { userId: user.id, expires: Date.now() + CHALLENGE_TTL };
  st.loginAttempts['code:' + challenge] = mfaCode;
  audit(null, 'LOGIN_CHALLENGE', 'user', user.id, `MFA challenge issued (ip=${ip})`, req);
  return sendJson(res, 200, { mfaRequired: true, challenge, mfaCode, demoHint: 'DEMO MODE: the OTP is displayed for demonstration', user: publicUser(user) });
}

function loginStep2(req, res, body) {
  const st = S();
  const challenge = body.challenge || '';
  const chKey = 'ch:' + challenge;
  const ch = st.loginAttempts[chKey];
  // Serverless fallback: the challenge may have been issued by another instance —
  // verify the signed payload instead of relying on shared memory.
  if (!ch || ch.expires < Date.now()) {
    const parsed = verifyChallenge(challenge, body.code);
    if (!parsed) {
      delete st.loginAttempts[chKey];
      delete st.loginAttempts['code:' + challenge];
      return sendJson(res, 400, { error: 'CHALLENGE_EXPIRED', message: 'MFA challenge expired. Please sign in again to receive a fresh code.' });
    }
    const user = st.users.find(u => u.id === parsed.userId);
    if (!user) return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Session user no longer exists.' });
    const token = issueSession(user.id, req);
    audit(null, 'LOGIN_SUCCESS', 'user', user.id, `MFA verified — signed challenge (stateless) (ip=${clientIp(req)})`, req);
    return sendJson(res, 200, { token, user: publicUser(user) });
  }
  const expect = st.loginAttempts['code:' + (body.challenge || '')];
  ch.attempts = (ch.attempts || 0) + 1;
  const MAX_ATTEMPTS = 3;
  if (!expect || String(body.code || '').trim() !== expect) {
    const left = MAX_ATTEMPTS - ch.attempts;
    if (left <= 0) {
      delete st.loginAttempts[chKey];
      delete st.loginAttempts['code:' + (body.challenge || '')];
      audit(null, 'MFA_LOCKED', 'user', ch.userId, `too many incorrect codes (${MAX_ATTEMPTS})`, req);
      return sendJson(res, 429, { error: 'MFA_LOCKED', message: `Too many incorrect codes. Please sign in again to receive a fresh code.`, attemptsLeft: 0 });
    }
    audit(null, 'MFA_FAILED', 'user', ch.userId, `incorrect code (${left} attempt(s) left)`, req);
    return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Incorrect verification code.', attemptsLeft: left });
  }
  delete st.loginAttempts[chKey];
  delete st.loginAttempts['code:' + (body.challenge || '')];
  const user = st.users.find(u => u.id === ch.userId);
  if (!user) return sendJson(res, 401, { error: 'MFA_FAILED', message: 'Session user no longer exists.' });
  const token = issueSession(user.id, req);
  audit(null, 'LOGIN_SUCCESS', 'user', user.id, `MFA verified (ip=${clientIp(req)})`, req);
  return sendJson(res, 200, { token, user: publicUser(user) });
}

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, name: u.name, roleId: u.roleId, roleName: S().roles.find(r => r.id === u.roleId)?.name, scope: u.scope, phone: u.phone, mfa: u.mfa, status: u.status, agentId: u.agentId };
}

module.exports = { requireAuth, requirePerm, can, currentUser, loginStep1, loginStep2, publicUser, rateLimit, clientIp, sendJson, SESSION_TTL };
