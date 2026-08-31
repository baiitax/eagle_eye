// util.js — client helpers (NDC E-Situation Room)
'use strict';
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NUM = new Intl.NumberFormat('en-NG');
const fmtN = (n) => NUM.format(Math.round(n || 0));
const pct = (a, b) => b === 0 ? 0 : Math.round((a / b) * 1000) / 10;

// WAT (Africa/Lagos) formatting from a UTC epoch ms (internal storage is UTC)
const WAT_FMT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const WAT_DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', weekday: 'short', year: 'numeric', month: 'short', day: '2-digit' });
function fmtWat(ms) {
  if (!ms) return '—';
  const parts = WAT_FMT.formatToParts(new Date(ms));
  const g = (t) => parts.find(p => p.type === t)?.value || '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}:${g('second')} WAT`;
}
function fmtWatShort(ms) {
  if (!ms) return '—';
  const parts = WAT_FMT.formatToParts(new Date(ms));
  const g = (t) => parts.find(p => p.type === t)?.value || '';
  return `${g('day')} ${WAT_DATE.format(new Date(ms)).split(',')[1]}, ${g('hour')}:${g('minute')} WAT`;
}
function watClock(ms) {
  const parts = WAT_FMT.formatToParts(new Date(ms));
  const g = (t) => parts.find(p => p.type === t)?.value || '';
  return `${g('hour')}:${g('minute')}:${g('second')}`;
}
function watDateOnly(ms) {
  const parts = WAT_FMT.formatToParts(new Date(ms));
  const g = (t) => parts.find(p => p.type === t)?.value || '';
  return `${g('day')} ${WAT_DATE.format(new Date(ms)).split(',')[1]} ${g('year')}`;
}
function timeAgoWat(ms, now) {
  const d = Math.max(0, (now || Date.now()) - ms);
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return `${Math.floor(h / 24)}d ${h % 24}h ago`;
}

const STATUS_META = {
  UNVERIFIED: { label: 'UNVERIFIED', cls: 's-unverified' },
  SUBMITTED: { label: 'SUBMITTED', cls: 's-submitted' },
  UNDER_REVIEW: { label: 'UNDER REVIEW', cls: 's-under' },
  VERIFIED: { label: 'VERIFIED', cls: 's-verified' },
  REJECTED: { label: 'REJECTED', cls: 's-rejected' },
  DISPUTED: { label: 'DISPUTED', cls: 's-disputed' },
  ARCHIVED: { label: 'ARCHIVED', cls: 's-archived' },
  // incident / sos statuses
  NEW: { label: 'NEW', cls: 's-under' },
  ACKNOWLEDGED: { label: 'ACKNOWLEDGED', cls: 's-submitted' },
  INVESTIGATING: { label: 'INVESTIGATING', cls: 's-under' },
  ESCALATED: { label: 'ESCALATED', cls: 'l4' },
  RESOLVED: { label: 'RESOLVED', cls: 's-verified' },
  CLOSED: { label: 'CLOSED', cls: 's-archived' },
  ACTIVE: { label: 'ACTIVE', cls: 'l5' },
  RESPONDING: { label: 'RESPONDING', cls: 'l4' },
  LIVE: { label: 'LIVE', cls: 'live' },
  OFFLINE: { label: 'OFFLINE', cls: 's-archived' },
  BUFFERING: { label: 'BUFFERING', cls: 's-under' },
  ENDED: { label: 'ENDED', cls: 's-archived' },
  PENDING_APPROVAL: { label: 'PENDING APPROVAL', cls: 's-under' },
  APPROVED: { label: 'APPROVED', cls: 's-verified' },
  OPEN: { label: 'OPEN', cls: 's-under' },
  'NOT_ACTIVATED': { label: 'NOT ACTIVATED', cls: 's-archived' },
  ACTIVATED: { label: 'ACTIVATED', cls: 's-submitted' },
  ON_DUTY: { label: 'ON DUTY', cls: 's-submitted' },
  POLLING_MONITORING: { label: 'POLLING MONITORING', cls: 's-verified' },
  RESULT_RECEIVED: { label: 'RESULT RECEIVED', cls: 's-submitted' },
  RESULT_SUBMITTED: { label: 'RESULT SUBMITTED', cls: 's-submitted' },
  DUTY_COMPLETED: { label: 'DUTY COMPLETED', cls: 's-verified' },
};
function statusBadge(status, extra) {
  const m = STATUS_META[status] || { label: status || '—', cls: 's-archived' };
  return `<span class="badge ${m.cls}"><span class="dot"></span>${esc(m.label)}${extra ? ' ' + extra : ''}</span>`;
}
function sevBadge(level) {
  const icons = { 1: 'i', 2: '▌', 3: '▲', 4: '⚠', 5: '☢' };
  return `<span class="sev l${level}"><span class="sic">${icons[level] || level}</span>LEVEL ${level}</span>`;
}
const SEV_NAMES = { 1: 'INFORMATIONAL', 2: 'LOW', 3: 'MEDIUM', 4: 'HIGH', 5: 'CRITICAL' };

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function el(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html ?? '').trim();
  if (d.children.length === 1) return d.firstElementChild;
  // multi-root template: wrap in a neutral container so nothing is dropped
  const f = document.createElement('div');
  while (d.firstChild) f.appendChild(d.firstChild);
  return f;
}

let toastBox = null;
function toast(title, body, kind = '') {
  if (!toastBox) { toastBox = el('<div class="toasts"></div>'); document.body.appendChild(toastBox); }
  const t = el(`<div class="toast ${kind}"><b>${esc(title)}</b>${esc(body || '')}</div>`);
  toastBox.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 420); }, kind === 'critical' ? 9000 : 5200);
}
function modal({ title, body, actions, wide }) {
  const ov = el(`<div class="overlay"><div class="modal" ${wide ? 'style="max-width:min(1000px,96vw)"' : ''}>
    <div class="mh"><b>${esc(title)}</b><span class="flex1"></span><span class="btn ghost sm" data-x>✕</span></div>
    <div class="mb">${typeof body === 'string' ? body : ''}</div>
    <div class="mf"></div></div></div>`);
  const mb = $('.mb', ov);
  if (typeof body === 'function') mb.appendChild(body());
  const mf = $('.mf', ov);
  for (const a of (actions || [])) {
    const b = el(`<button class="btn ${a.cls || ''}">${esc(a.label)}</button>`);
    b.onclick = () => {
      // run the action FIRST so handlers can still read inputs inside the modal body
      const r = a.onClick && a.onClick();
      if (!a.keep) {
        if (r && typeof r.then === 'function') r.finally(() => ov.remove());
        else ov.remove();
      }
    };
    mf.appendChild(b);
  }
  const close = () => ov.remove();
  $('[data-x]', ov).onclick = close;
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  document.body.appendChild(ov);
  return { close, body: mb };
}
function confirmBox(title, text, onYes, yesLabel = 'Confirm', cls = 'primary') {
  modal({ title, body: `<div class="small muted">${text}</div>`, actions: [{ label: 'Cancel', cls: 'ghost' }, { label: yesLabel, cls, onClick: onYes }] });
}

function download(filename, content, mime) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// hash string (for offline queue ids)
function strHash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; } return (h >>> 0).toString(36); }

// simple markdown-ish renderer for copilot answers
function mdToHtml(text) {
  let out = esc(text);
  out = out.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  out = out.replace(/\n/g, '<br>');
  return out;
}

window.$ = $; window.$$ = $$; window.esc = esc; window.fmtN = fmtN; window.pct = pct;
Object.assign(window, { fmtWat, fmtWatShort, watClock, watDateOnly, timeAgoWat, statusBadge, sevBadge, SEV_NAMES, debounce, el, toast, modal, confirmBox, download, strHash, mdToHtml, NUM });
