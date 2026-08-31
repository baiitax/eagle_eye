// auth.js — sessions, MFA, RBAC middleware, rate limiting, brute-force protection
'use strict';
const crypto = require('crypto');
const { uuid, checkPassword } = require('./util');
const { S, audit } = require('./store');

const SESSION_TTL = 12 * 3600 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;

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
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    token, userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL,
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
  const s = st.sessions[token];
  if (!s || s.expiresAt < Date.now()) return null;
  const user = st.users.find(u => u.id === s.userId);
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
  const challenge = crypto.randomBytes(16).toString('hex');
  st.loginAttempts['ch:' + challenge] = { userId: user.id, expires: Date.now() + CHALLENGE_TTL };
  // DEMO MODE: MFA code is surfaced in the response so the demo flow is usable
  const mfaCode = String(Math.floor(100000 + Math.random() * 900000));
  st.loginAttempts['code:' + challenge] = mfaCode;
  audit(null, 'LOGIN_CHALLENGE', 'user', user.id, `MFA challenge issued (ip=${ip})`, req);
  return sendJson(res, 200, { mfaRequired: true, challenge, mfaCode, demoHint: 'DEMO MODE: the OTP is displayed for demonstration', user: publicUser(user) });
}

function loginStep2(req, res, body) {
  const st = S();
  const chKey = 'ch:' + (body.challenge || '');
  const ch = st.loginAttempts[chKey];
  if (!ch || ch.expires < Date.now()) {
    delete st.loginAttempts[chKey];
    delete st.loginAttempts['code:' + (body.challenge || '')];
    return sendJson(res, 400, { error: 'CHALLENGE_EXPIRED', message: 'MFA challenge expired. Please sign in again to receive a fresh code.' });
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
