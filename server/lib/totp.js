// totp.js — RFC 6238 TOTP (time-based one-time passwords), zero dependencies.
// M2 (Identity & Access): real MFA. HMAC-SHA1, 30-second steps, 6-digit codes,
// ±1 step verification window (30 s clock-skew tolerance).
'use strict';
const crypto = require('crypto');

const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---- base32 (RFC 4648, no padding) ----
function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// ---- RFC 4226 HOTP (dynamic truncation) ----
function hotp(secretBuf, counter, digits = 6) {
  const cbuf = Buffer.alloc(8);
  // 64-bit big-endian counter
  cbuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  cbuf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', secretBuf).update(cbuf).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % Math.pow(10, digits)).padStart(digits, '0');
}

// ---- RFC 6238 TOTP ----
function totpCode(secretBase32, timeMs = Date.now(), { stepSec = 30, digits = 6 } = {}) {
  const counter = Math.floor(timeMs / 1000 / stepSec);
  return hotp(base32Decode(secretBase32), counter, digits);
}

function totpVerify(secretBase32, code, timeMs = Date.now(), { windowSteps = 1, stepSec = 30, digits = 6 } = {}) {
  const given = String(code || '').replace(/\D/g, '');
  if (given.length !== digits) return false;
  const counter = Math.floor(timeMs / 1000 / stepSec);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    const expect = hotp(base32Decode(secretBase32), counter + w, digits);
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(given))) return true;
  }
  return false;
}

// 20 random bytes → base32 secret (RFC 4648 standard length)
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// Deterministic per-user secret for the demo platform (serverless cold starts re-seed
// identically). Production stores a per-user random secret in the database instead.
function deterministicSecret(masterKey, username) {
  const buf = crypto.createHmac('sha256', String(masterKey)).update('totp:' + String(username)).digest();
  return base32Encode(buf.subarray(0, 20));
}

function otpauthUrl(issuer, account, secretBase32) {
  return `otpauth://totp/${encodeURIComponent(issuer + ':' + account)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// seconds until the current 30s window rotates (for UI countdowns)
function secondsToRotation(timeMs = Date.now(), stepSec = 30) {
  return stepSec - (Math.floor(timeMs / 1000) % stepSec);
}

module.exports = { base32Encode, base32Decode, hotp, totpCode, totpVerify, generateSecret, deterministicSecret, otpauthUrl, secondsToRotation };
