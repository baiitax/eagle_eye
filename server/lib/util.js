// util.js — shared helpers for the NDC E-Situation Room server
'use strict';
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

// deterministic rng for reproducible seeding
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const ri = (rng, a, b) => a + Math.floor(rng() * (b - a + 1));
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

const hashPassword = (pw) => {
  const salt = crypto.randomBytes(8).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
};
const checkPassword = (pw, stored) => {
  if (!stored || !stored.includes(':')) return false;
  const [salt, h] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(h, 'hex'));
};

// WAT = Africa/Lagos (UTC+1, no DST)
const WAT_OFFSET_MS = 3600 * 1000;
const utcToWat = (ms) => new Date(ms + WAT_OFFSET_MS);
const watToUtc = (ms) => ms - WAT_OFFSET_MS;
const watEpoch = (y, mo, d, h = 0, mi = 0, s = 0) => Date.UTC(y, mo - 1, d, h, mi, s) - WAT_OFFSET_MS;

function fmtWat(ms, opts = {}) {
  const d = utcToWat(ms);
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 19);
  const withSec = opts.seconds !== false;
  const t = withSec ? time : time.slice(0, 5);
  if (opts.date === false) return t;
  if (opts.time === false) return date;
  return `${date} ${t}`;
}
function fmtWatShort(ms) {
  const d = utcToWat(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} WAT`;
}
const watClock = (ms) => {
  const d = utcToWat(ms);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}`;
};
const watDate = (ms) => {
  const d = utcToWat(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const NUM = new Intl.NumberFormat('en-NG');
const fmtNum = (n) => NUM.format(n || 0);
const pct = (a, b) => b === 0 ? 0 : Math.round((a / b) * 1000) / 10;

module.exports = { uuid, sha256, mulberry32, ri, pick, hashPassword, checkPassword, fmtWat, fmtWatShort, watClock, watDate, watEpoch, utcToWat, fmtNum, pct, WAT_OFFSET_MS };
