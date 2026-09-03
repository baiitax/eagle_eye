// api.js — client API + SSE + auth state
'use strict';
// ---- safe storage: works even when localStorage is blocked or throwing ----
// (sandboxed iframes, third-party storage blocking, privacy modes). Falls back to memory.
const memStore = {};
window.safeStore = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return (k in memStore) ? memStore[k] : null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { memStore[k] = String(v); } },
  remove(k) { try { localStorage.removeItem(k); } catch (e) { delete memStore[k]; } },
};
function safeJson(k, fallback) {
  try { const v = window.safeStore.get(k); return v ? JSON.parse(v) : fallback; }
  catch (e) { return fallback; }
}
const API = {
  token: window.safeStore.get('ndc_token') || null,
  user: safeJson('ndc_user', null),
  perms: safeJson('ndc_perms', []),
  setAuth(token, user, perms) {
    this.token = token; this.user = user; this.perms = perms || [];
    window.safeStore.set('ndc_token', token);
    window.safeStore.set('ndc_token_issued', String(Date.now()));
    window.safeStore.set('ndc_user', JSON.stringify(user));
    window.safeStore.set('ndc_perms', JSON.stringify(this.perms));
  },
  clear() {
    this.token = null; this.user = null; this.perms = [];
    window.safeStore.remove('ndc_token'); window.safeStore.remove('ndc_user'); window.safeStore.remove('ndc_perms');
  },
  can(perm) { return this.perms.includes(perm); },
  async req(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), opts.timeout || 15000) : null;
    let r;
    try {
      r = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: ctrl ? ctrl.signal : undefined });
    } catch (e) {
      if (ctrl && ctrl.signal.aborted) throw new Error('The server took too long to respond. Please try again.');
      throw e;
    } finally { if (timer) clearTimeout(timer); }
    if (r.status === 401 && !opts.noRelogin && !opts._retried) {
      // A single 401 must never bounce the user home: serverless instances may
      // recycle mid-session, and stale cached clients exist. Revalidate the
      // signed token against /api/me once and retry the original request;
      // only a FAILED revalidation clears the session.
      try {
        const me = await API.get('/api/me', { noRelogin: true, _retried: true });
        if (me && me.user) {
          API.setAuth(API.token, me.user, me.permissions);
          return this.req(method, path, body, { ...opts, _retried: true });
        }
      } catch (e) { /* fall through — genuinely unauthenticated */ }
      API.clear();
      if (!location.pathname.includes('index')) location.href = '/';
      throw new Error('UNAUTHENTICATED');
    }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) {
      const err = new Error((data && (data.message || data.error)) || r.statusText);
      err.status = r.status; err.data = data;
      throw err;
    }
    return data;
  },
  get(p, o) { return this.req('GET', p, undefined, o); },
  post(p, b, o) { return this.req('POST', p, b, o); },
  patch(p, b, o) { return this.req('PATCH', p, b, o); },
};

let sseSource = null; const sseHandlers = [];
async function sseConnect() {
  if (!API.token) return;
  // serverless deployments cannot hold persistent streams — detect and skip
  try {
    const h = await fetch('/api/health').then(r => r.json());
    if (h && h.serverless) return;
  } catch (e) { /* local or transient — attempt the stream anyway */ }
  if (sseSource) sseSource.close();
  sseSource = new EventSource(`/api/events?token=${encodeURIComponent(API.token)}`);
  sseSource.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      for (const h of sseHandlers) { try { h(msg); } catch (err) { console.warn('sse handler error', err); } }
    } catch (err) { /* ignore */ }
  };
  sseSource.onerror = () => { /* EventSource auto-reconnects */ };
}
function sseOn(fn) { sseHandlers.push(fn); }
function sseOff() { sseHandlers.length = 0; if (sseSource) { sseSource.close(); sseSource = null; } }

// ---- M2: sliding session refresh (real, server-side revocation-safe) ----
async function refreshAuthToken() {
  if (!API.token) return false;
  const issued = parseInt(window.safeStore.get('ndc_token_issued') || '0', 10);
  if (!issued || Date.now() - issued < 45 * 60000) return false; // refresh after ~45 min of age
  try {
    const r = await API.post('/api/auth/refresh', {}, { noRelogin: true, timeout: 8000 });
    if (r && r.token) {
      API.token = r.token;
      window.safeStore.set('ndc_token', r.token);
      window.safeStore.set('ndc_token_issued', String(Date.now()));
      return true;
    }
  } catch (e) { /* best-effort — re-login path handles real expiry */ }
  return false;
}

// ---- boot helper: fetches bootstrap + overview with retries (proxy-safe) ----
async function apiBoot() {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // noRelogin: a mid-boot 401 must surface as the visible recovery screen
      // (bootPortal), never as a silent bounce back to the home page
      const [b, o] = await Promise.all([
        API.get('/api/bootstrap', { noRelogin: true, timeout: 12000 }),
        API.get('/api/overview', { noRelogin: true, timeout: 12000 }),
      ]);
      return { b, o };
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 900 * (attempt + 1))); }
  }
  throw lastErr || new Error('Command data could not be loaded.');
}

// ---- login flow helpers ----
async function loginStep1(username, password) {
  return API.post('/api/auth/login', { username, password }, { noRelogin: true });
}
async function loginStep2(challenge, code) {
  const res = await API.post('/api/auth/mfa', { challenge, code }, { noRelogin: true });
  API.setAuth(res.token, res.user, []);
  // fetch /api/me with retries — a transient network hiccup must not abort an otherwise successful sign-in
  let me = null, lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { me = await API.get('/api/me', { noRelogin: true }); break; }
    catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 600)); }
  }
  if (me && me.user && Array.isArray(me.permissions)) API.setAuth(res.token, me.user, me.permissions);
  else {
    // best-effort fallback: the session token is already valid server-side;
    // permissions refresh again during bootPortal — never fail the sign-in over a perms hiccup
    API.setAuth(res.token, res.user, []);
    me = { user: res.user, permissions: [], needsPermsRefresh: true };
  }
  try { sseConnect(); } catch (e) { /* realtime optional — never block sign-in */ }
  return me;
}

function showLogin({ portalName, roleHint, onSuccess, creds, opts = {} }) {
  const mountEl = opts.mount ? (typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount) : null;
  const hint = creds || { username: '', password: '' };
  const remembered = window.safeStore.get('ndc_remembered_user') || '';
  const wrap = el(`<div class="login-wrap"><div class="login-card">
    <div class="logo-row">
      <img src="/assets/media/logo.png" alt="EYES OF VICTORY" style="height:58px;width:auto;object-fit:contain" onerror="this.style.display='none'">
      <div><h2>EYES OF VICTORY</h2><div class="tagline">Monitor · Verify · Respond · Report</div><div class="dim small">${esc(portalName || 'Portal')} · Kano State 2027</div></div>
    </div>
    <div class="secure-pill"><span class="sp-dot"></span>SECURE CONNECTION · MFA-PROTECTED SESSION</div>
    <div class="step1">
      <label class="fl">Agent ID / User ID</label>
      <div class="inp-wrap"><span class="inp-ic">👤</span><input class="inp" id="lu" placeholder="e.g. fieldagent" autocomplete="off" value="${esc(remembered)}"></div>
      <label class="fl">Password / PIN</label>
      <div class="inp-wrap"><span class="inp-ic">🔒</span><input class="inp" id="lp" type="password" placeholder="••••••••••"><button class="pwtoggle" id="pwtoggle" type="button" title="Show/hide PIN">👁</button></div>
      <div class="remember-row">
        <label><input type="checkbox" id="remember"> Remember my device</label>
        <a href="#" class="small" id="forgotLink">Forgot PIN?</a>
      </div>
      <button class="btn primary btnblock login-btn" id="lbtn">⚡ SECURE LOGIN →</button>
      ${opts.biometric ? `<div class="row mt8"><button class="btn btnblock" id="bioBtn" style="flex:1">🖐 USE BIOMETRIC</button></div>` : ''}
      ${hint.username ? `<div class="quickchips"><span class="small dim" style="align-self:center">Demo:</span><span class="qc" id="qfill">⏩ Quick-fill ${esc(hint.username)}</span></div>` : ''}
      <div class="demo-creds" id="hintbox">
        <b>${esc(portalName || 'Portal')} access</b><br>
        <code>${esc(hint.username || 'director')}</code> / <code>${esc(hint.password || 'Director@123!')}</code>
        <div class="dim small mt8">DEMO MODE — the MFA code is displayed on the next screen. All data is fictional simulation data.</div>
      </div>
      ${hint.demoUsers ? `<div class="demo-chips" id="demochips">${hint.demoUsers.map((d, i) => `<span class="chip" data-di="${i}" title="Click to fill ${esc(d.u)}">${esc(d.label || d.u)} · <b>${esc(d.u)}</b></span>`).join('')}</div>` : ''}
    </div>
    <div class="step2" style="display:none">
      <div class="center"><span class="pill">MFA verification required</span></div>
      <label class="fl center" style="text-align:center">Enter the 6-digit code</label>
      <div class="otp-boxes" id="otpboxes"></div>
      <input class="inp" id="lc" style="display:none" inputmode="numeric" maxlength="6">
      <div class="center mt8"><span class="pill" id="otpshow"></span> <button class="btn sm" id="fillcode">⏩ USE DISPLAYED CODE</button></div>
      <div class="otp-meta"><span>Expires in <span class="timer" id="otptimer">5:00</span></span><a href="#" id="resend" class="disabled">Resend code</a></div>
      <div class="mt12"><button class="btn primary btnblock login-btn" id="mbtn">✓ VERIFY & ENTER SITUATION ROOM</button></div>
      <div class="center small muted mt8"><a href="#" id="backlink">← back to sign in</a></div>
    </div>
    <div class="step3" style="display:none">
      <div class="center"><span class="pill">Password reset</span></div>
      <label class="fl">Agent ID / User ID</label>
      <div class="inp-wrap"><span class="inp-ic">👤</span><input class="inp" id="ru" autocomplete="off" placeholder="e.g. director"></div>
      <div class="mt8"><button class="btn primary btnblock" id="rbtn1">REQUEST RESET CODE</button></div>
      <div class="small mt8" id="rbox1"></div>
      <div id="rstep2" style="display:none">
        <label class="fl">Reset code</label>
        <input class="inp" id="rc" inputmode="numeric" maxlength="6" placeholder="6-digit code">
        <label class="fl">New password</label>
        <input class="inp" id="rp" type="password" placeholder="min 8 chars · letters + numbers">
        <label class="fl">Confirm new password</label>
        <input class="inp" id="rp2" type="password" placeholder="repeat new password">
        <div class="mt8"><button class="btn primary btnblock" id="rbtn2">SET NEW PASSWORD</button></div>
        <div class="small mt8" id="rbox2"></div>
      </div>
      <div class="center small muted mt8"><a href="#" id="resetbacklink">← back to sign in</a></div>
    </div>
    <div class="mt12 center small dim">© 2026–2027 NDC Election Operations · Unofficial monitoring platform · Not affiliated with INEC</div>
  </div></div>`);
  if (mountEl) { mountEl.innerHTML = ''; mountEl.appendChild(wrap); }
  else { document.body.innerHTML = ''; document.body.appendChild(wrap); }
  const card = $('.login-card', wrap);
  // error box lives on the CARD (outside step1/step2) so MFA errors are always visible
  const errBox = el('<div class="mt8 small" id="autherr" style="color:#f87171;display:none"></div>');
  card.insertBefore(errBox, $('.step1', wrap));
  const showErr = (msg) => { errBox.textContent = msg; errBox.style.display = 'block'; };
  const clearErr = () => { errBox.textContent = ''; errBox.style.display = 'none'; };
  let challenge = null, mfaCode = null, otpTimer = null, secsLeft = 30, submitting = false, networkFail = false, lastCreds = null, challengeExpiresAt = 0;

  const shakeCard = () => { const c = $('.login-card', wrap); c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); };

  // password visibility toggle
  $('#pwtoggle', wrap).onclick = () => {
    const lp = $('#lp', wrap);
    lp.type = lp.type === 'password' ? 'text' : 'password';
    $('#pwtoggle', wrap).textContent = lp.type === 'password' ? '👁' : '🙈';
  };
  // quick-fill demo credentials
  const qf = $('#qfill', wrap);
  if (qf) qf.onclick = () => { $('#lu', wrap).value = hint.username; $('#lp', wrap).value = hint.password; $('#lp', wrap).focus(); };
  // clickable demo credentials — one click fills the secure sign-in form
  $$('.chip[data-di]', wrap).forEach(ch => ch.onclick = () => {
    const d = (hint.demoUsers || [])[+ch.dataset.di];
    if (d) { $('#lu', wrap).value = d.u; $('#lp', wrap).value = d.p; $('#lp', wrap).focus(); }
  });

  // ---- step 1: login ----
  $('#lbtn', wrap).onclick = async () => {
    clearErr();
    const btn = $('#lbtn', wrap);
    if (btn.disabled) return;
    btn.disabled = true; btn.textContent = '◌ VERIFYING…';
    try {
      const res = await loginStep1($('#lu', wrap).value.trim(), $('#lp', wrap).value);
      lastCreds = { username: $('#lu', wrap).value.trim(), password: $('#lp', wrap).value };
      challenge = res.challenge; mfaCode = res.mfaCode;
      challengeExpiresAt = Date.now() + 5 * 60000; // server challenge TTL
      if ($('#remember', wrap).checked) window.safeStore.set('ndc_remembered_user', $('#lu', wrap).value.trim());
      $('#otpshow', wrap).innerHTML = `DEMO OTP: <b style="font-size:16px;color:#fde047">${mfaCode}</b> <span style="color:#8ba0bd">(real TOTP · rotates in 30s)</span>`;
      $('.step1', wrap).style.display = 'none';
      $('.step2', wrap).style.display = 'block';
      buildOtp();
      startOtpTimer(res.totpRotatesInSec || 30);
    } catch (e) {
      showErr(e.message);
      shakeCard();
      btn.disabled = false; btn.textContent = '⚡ SECURE LOGIN →';
    }
  };
  // one-click demo fill: inserts the displayed code and submits (demo mode only)
  $('#fillcode', wrap).onclick = () => {
    if (!mfaCode || submitting) return;
    const inputs = $('#otpboxes', wrap)._inputs || [];
    mfaCode.split('').forEach((ch, i) => { if (inputs[i]) { inputs[i].value = ch; inputs[i].classList.add('filled'); } });
    $('#lc', wrap).value = mfaCode;
    updateVerifyState();
    doVerify();
  };

  // ---- step 2: OTP boxes ----
  function updateVerifyState() {
    const inputs = $('#otpboxes', wrap)._inputs || [];
    const code = inputs.map(x => x.value).join('');
    $('#lc', wrap).value = code;
    const btn = $('#mbtn', wrap);
    btn.disabled = code.length !== 6 || submitting;
    return code;
  }
  function buildOtp() {
    const box = $('#otpboxes', wrap);
    box.innerHTML = '';
    const inputs = [];
    for (let i = 0; i < 6; i++) {
      const inp = document.createElement('input');
      inp.maxLength = 1; inp.inputMode = 'numeric'; inp.dataset.idx = i;
      inp.autocomplete = 'one-time-code';
      inp.addEventListener('input', () => {
        inp.value = inp.value.replace(/\D/g, '');
        if (inp.value) {
          inp.classList.add('filled');
          const next = inputs[i + 1];
          if (next) next.focus();
        } else inp.classList.remove('filled');
        clearErr();
        const code = updateVerifyState();
        // auto-submit the moment all six digits are present
        if (code.length === 6 && !submitting) doVerify();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && inputs[i - 1]) inputs[i - 1].focus();
        if (e.key === 'Enter' && !submitting) doVerify();
      });
      inp.addEventListener('paste', (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        text.split('').forEach((ch, j) => { if (inputs[j]) { inputs[j].value = ch; inputs[j].classList.add('filled'); } });
        const last = inputs[Math.min(text.length - 1, 5)];
        if (last) last.focus();
        clearErr();
        const code = updateVerifyState();
        if (code.length === 6 && !submitting) doVerify();
      });
      box.appendChild(inp);
      inputs.push(inp);
    }
    inputs[0].focus();
    box._inputs = inputs;
    updateVerifyState();
  }
  function startOtpTimer(seconds) {
    if (otpTimer) clearInterval(otpTimer);
    secsLeft = seconds || 30;
    const t = $('#otptimer', wrap), r = $('#resend', wrap);
    r.classList.add('disabled');
    t.textContent = '0:' + String(secsLeft).padStart(2, '0');
    otpTimer = setInterval(() => {
      secsLeft--;
      if (secsLeft <= 0) {
        clearInterval(otpTimer); otpTimer = null;
        if (Date.now() > challengeExpiresAt) {
          t.textContent = '0:00'; r.classList.remove('disabled');
          backToSignIn('Verification session expired. Please sign in again for a fresh code.');
          return;
        }
        // TOTP window rotated: fetch the fresh code (demo) and restart the countdown
        refreshDemoCode();
        return;
      }
      t.textContent = '0:' + String(secsLeft).padStart(2, '0');
    }, 1000);
  }
  async function refreshDemoCode() {
    const t = $('#otptimer', wrap);
    try {
      const r = await API.post('/api/auth/mfa/code', { challenge }, { noRelogin: true });
      mfaCode = r.mfaCode;
      $('#otpshow', wrap).innerHTML = `DEMO OTP: <b style="font-size:16px;color:#fde047">${mfaCode}</b> <span style="color:#8ba0bd">(real TOTP · rotates in 30s)</span>`;
      toast('Code rotated', 'The displayed TOTP code was refreshed.');
      startOtpTimer(r.rotatesInSec || 30);
    } catch (e) {
      t.textContent = '0:00'; $('#resend', wrap).classList.remove('disabled');
      backToSignIn('Could not refresh the verification code. Please sign in again.');
    }
  }
  $('#resend', wrap).onclick = async (e) => {
    e.preventDefault();
    if ($('#resend', wrap).classList.contains('disabled')) return;
    if (!lastCreds) return backToSignIn('Please sign in again.');
    // re-issue a fresh challenge (new 5-minute TTL) with the same credentials
    $('#resend', wrap).textContent = '◌ re-issuing…';
    try {
      const res = await loginStep1(lastCreds.username, lastCreds.password);
      challenge = res.challenge; mfaCode = res.mfaCode;
      challengeExpiresAt = Date.now() + 5 * 60000;
      $('#otpshow', wrap).innerHTML = `DEMO OTP: <b style="font-size:16px;color:#fde047">${mfaCode}</b> <span style="color:#8ba0bd">(real TOTP · rotates in 30s)</span>`;
      startOtpTimer(res.totpRotatesInSec || 30);
    } catch (err) {
      backToSignIn('Could not re-issue the code. Please sign in again.');
    }
    $('#resend', wrap).textContent = 'Resend code';
  };
  function backToSignIn(msg) {
    showErr(msg);
    shakeCard();
    setTimeout(() => {
      if (otpTimer) { clearInterval(otpTimer); otpTimer = null; }
      challenge = null; submitting = false; networkFail = false;
      $('.step2', wrap).style.display = 'none';
      $('.step3', wrap).style.display = 'none';
      $('.step1', wrap).style.display = 'block';
      const mb = $('#mbtn', wrap);
      mb.textContent = '✓ VERIFY & ENTER SITUATION ROOM';
      mb.style.background = ''; mb.style.borderColor = '';
      const lb = $('#lbtn', wrap);
      lb.disabled = false; lb.textContent = '⚡ SECURE LOGIN →';
    }, 1400);
  }
  async function doVerify() {
    if (submitting || !challenge) return;
    const code = updateVerifyState();
    if (code.length !== 6) {
      showErr('Enter all 6 digits of the verification code.');
      shakeCard();
      return;
    }
    submitting = true;
    clearErr();
    const btn = $('#mbtn', wrap);
    btn.disabled = true; btn.textContent = '◌ VERIFYING…';
    try {
      const me = await loginStep2(challenge, code);
      // REPLACE the login card with an explicit authenticated transition screen —
      // the user must never be left staring at the OTP screen after a successful verify.
      const roleName = (me.user && me.user.roleName) || (me.user && me.user.roleId) || 'command';
      const roleDest = (me.user && me.user.roleId) ? rolePortal(me.user.roleId) : '';
      document.body.innerHTML = `<div class="login-wrap"><div class="login-card" style="text-align:center">
        <div class="confirm-hero">
          <div class="big" style="color:#4ade80">✓</div>
          <h3 style="color:#4ade80">AUTHENTICATED</h3>
          <div class="code" style="font-size:13px;color:#7dd3fc">SECURE SESSION ESTABLISHED</div>
          <div class="small muted">Welcome, <b style="color:#fff">${esc((me.user && me.user.name) || '')}</b> — routing to your <b style="color:#fff">${esc(roleName)}</b> dashboard${roleDest ? ' <a href="' + esc(roleDest) + '" style="color:#7dd3fc">(' + esc(roleDest) + ')</a>' : ''}…</div>
          <div class="evp-bar mt12"><i></i></div>
          <div class="small muted mt8" id="bootstatus">Establishing secure session…</div>
        </div>
      </div></div>`;
      window.__portalBooted = false;
      const bootstatus = document.getElementById('bootstatus');
      // status progression so the wait is always explained
      setTimeout(() => { if (bootstatus && document.body.contains(bootstatus)) bootstatus.textContent = 'Session established — loading command data…'; }, 450);
      // watchdog: if the portal has not taken over within 30s, show a recoverable failure screen
      // (30s: serverless cold starts can legitimately take several seconds per request)
      setTimeout(() => {
        if (!window.__portalBooted && !document.querySelector('.app') && !document.querySelector('.agent-host') && !document.querySelector('.mc-head')) {
          showBootFailure('The dashboard did not respond after authentication. Your session is safe — please retry.');
        }
      }, 30000);
      setTimeout(() => {
        try {
          if (bootstatus && document.body.contains(bootstatus)) bootstatus.textContent = 'Data received — rendering your dashboard…';
          onSuccess && onSuccess(me);
        }
        catch (err) {
          // if the portal's own boot crashes, surface it instead of dying silently
          const bs = document.getElementById('bootstatus');
          if (bs) bs.innerHTML = '<span style="color:#f87171">A problem occurred while loading command data.</span>';
        }
      }, 600);
    } catch (e) {
      submitting = false;
      btn.style.background = '';
      btn.style.borderColor = '';
      const data = (e && e.data) || {};
      // network-level failure: the code is still valid server-side — preserve it and offer retry
      const msg = e && e.message;
      const isNetwork = !e || !e.status || msg === 'Failed to fetch' || /fetch|network|load failed|refused/i.test(String(msg));
      if (isNetwork) {
        networkFail = true;
        showErr('We could not reach the server to verify your code. Your code is still valid — check your connection and try again.');
        shakeCard();
        btn.disabled = false; btn.textContent = '↻ RETRY VERIFICATION';
        return;
      }
      if (data.error === 'CHALLENGE_EXPIRED') {
        backToSignIn('Verification session expired. Please sign in again for a fresh code.');
        return;
      }
      if (data.error === 'MFA_LOCKED') {
        backToSignIn(data.message || 'Too many incorrect codes. Please sign in again.');
        return;
      }
      const left = data.attemptsLeft;
      showErr((e.message || 'Verification failed.') + (left != null ? ` — ${left} attempt${left === 1 ? '' : 's'} remaining.` : ''));
      shakeCard();
      btn.disabled = false; btn.textContent = '✓ VERIFY & ENTER SITUATION ROOM';
      const inputs = $('#otpboxes', wrap)._inputs || [];
      inputs.forEach(x => { x.value = ''; x.classList.remove('filled'); });
      updateVerifyState();
      if (inputs[0]) inputs[0].focus();
    }
  }
  $('#mbtn', wrap).onclick = () => doVerify();
  $('#backlink', wrap).onclick = (e) => { e.preventDefault(); if (otpTimer) { clearInterval(otpTimer); otpTimer = null; } challenge = null; submitting = false; clearErr(); const mb = $('#mbtn', wrap); mb.textContent = '✓ VERIFY & ENTER SITUATION ROOM'; mb.style.background = ''; mb.style.borderColor = ''; const lb = $('#lbtn', wrap); lb.disabled = false; lb.textContent = '⚡ SECURE LOGIN →'; $('.step2', wrap).style.display = 'none'; $('.step1', wrap).style.display = 'block'; };
  $('#forgotLink', wrap).onclick = (e) => {
    e.preventDefault();
    if (otpTimer) { clearInterval(otpTimer); otpTimer = null; }
    challenge = null; submitting = false; clearErr();
    $('.step1', wrap).style.display = 'none';
    $('.step2', wrap).style.display = 'none';
    $('.step3', wrap).style.display = 'block';
    const remembered = window.safeStore.get('ndc_remembered_user') || '';
    $('#ru', wrap).value = $('#lu', wrap).value || remembered;
    $('#rbox1', wrap).textContent = '';
    $('#rstep2', wrap).style.display = 'none';
  };
  $('#rbtn1', wrap).onclick = async () => {
    const uname = $('#ru', wrap).value.trim();
    if (!uname) { $('#rbox1', wrap).innerHTML = '<span style="color:#f87171">Enter your user ID first.</span>'; return; }
    $('#rbtn1', wrap).disabled = true; $('#rbtn1', wrap).textContent = '◌ REQUESTING…';
    try {
      const res = await API.post('/api/auth/password-reset/request', { username: uname }, { noRelogin: true });
      if (res.demo && res.demo.code) {
        $('#rbox1', wrap).innerHTML = `<span style="color:#fde047">Reset code: <b style="font-size:15px">${esc(res.demo.code)}</b></span><div class="dim">DEMO MODE — the code is displayed. Production delivers it via a verified channel. Expires in 15 minutes.</div>`;
        wrap._resetToken = res.demo.token;
        $('#rstep2', wrap).style.display = 'block';
      } else {
        $('#rbox1', wrap).innerHTML = `<span style="color:#4ade80">${esc(res.note || 'If the account exists, reset instructions have been sent.')}</span>`;
      }
    } catch (err) {
      $('#rbox1', wrap).innerHTML = `<span style="color:#f87171">${esc(err.message)}</span>`;
    }
    $('#rbtn1', wrap).disabled = false; $('#rbtn1', wrap).textContent = 'REQUEST RESET CODE';
  };
  $('#rbtn2', wrap).onclick = async () => {
    const code = $('#rc', wrap).value.trim(), pw = $('#rp', wrap).value, pw2 = $('#rp2', wrap).value;
    if (code.length !== 6) { $('#rbox2', wrap).innerHTML = '<span style="color:#f87171">Enter the 6-digit reset code.</span>'; return; }
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) { $('#rbox2', wrap).innerHTML = '<span style="color:#f87171">Password must be at least 8 characters with letters and numbers.</span>'; return; }
    if (pw !== pw2) { $('#rbox2', wrap).innerHTML = '<span style="color:#f87171">Passwords do not match.</span>'; return; }
    $('#rbtn2', wrap).disabled = true; $('#rbtn2', wrap).textContent = '◌ UPDATING…';
    try {
      const res = await API.post('/api/auth/password-reset/complete', { token: wrap._resetToken, code, newPassword: pw }, { noRelogin: true });
      $('#rbox2', wrap).innerHTML = `<span style="color:#4ade80">${esc(res.message || 'Password updated.')}</span>`;
      setTimeout(() => backToSignIn('Password updated. Sign in with your new password.'), 1600);
    } catch (err) {
      $('#rbox2', wrap).innerHTML = `<span style="color:#f87171">${esc(err.message)}</span>`;
      $('#rbtn2', wrap).disabled = false; $('#rbtn2', wrap).textContent = 'SET NEW PASSWORD';
    }
  };
  $('#resetbacklink', wrap).onclick = (e) => {
    e.preventDefault();
    clearErr();
    $('.step3', wrap).style.display = 'none';
    $('.step1', wrap).style.display = 'block';
    const lb = $('#lbtn', wrap); lb.disabled = false; lb.textContent = '⚡ SECURE LOGIN →';
  };
  if ($('#bioBtn', wrap)) {
    $('#bioBtn', wrap).onclick = () => {
      const b = $('#bioBtn', wrap);
      b.disabled = true; b.textContent = '◍ SCANNING BIOMETRIC…';
      setTimeout(() => {
        b.disabled = false; b.textContent = '🖐 USE BIOMETRIC';
        if (hint.username) {
          $('#lu', wrap).value = hint.username;
          $('#lp', wrap).focus();
          toast('Biometric verified', 'Device authentication passed — enter your PIN to complete sign-in.');
        } else {
          toast('Biometric unavailable', 'No stored credential on this device. Sign in with your Agent ID and PIN.', 'medium');
        }
      }, 1600);
    };
  }
  $('#lu', wrap).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lp', wrap).focus(); });
  $('#lp', wrap).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lbtn', wrap).click(); });
  $('#lc', wrap).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#mbtn', wrap).click(); });
}

async function requireSession(portalName, roleHint, creds, opts) {
  if (API.token) {
    await refreshAuthToken(); // M2: sliding refresh (best-effort)
    try {
      const me = await API.get('/api/me', { noRelogin: true });
      API.setAuth(API.token, me.user, me.permissions);
      return me.user;
    } catch (e) {
      // serverless hosts may lose per-instance session memory on a cold start;
      // the server re-validates signed tokens statelessly — one clean retry
      // before falling back to the sign-in screen
      try {
        await new Promise(r => setTimeout(r, 500));
        const me2 = await API.get('/api/me', { noRelogin: true });
        API.setAuth(API.token, me2.user, me2.permissions);
        return me2.user;
      } catch (e2) { API.clear(); }
    }
  }
  return new Promise((resolve) => {
    showLogin({ portalName, roleHint, creds, opts, onSuccess: (me) => resolve(me.user) });
  });
}

// ---- role dashboard routing (post-auth) ----
function rolePortal(roleId) {
  const map = {
    superadmin: '/admin',
    director: '/central', chiefanalyst: '/central', resultmanager: '/central', irevanalyst: '/central',
    incidentcommander: '/central', comms: '/central', analyst: '/central', operator: '/central',
    incident: '/central', support: '/central', auditor: '/central', observer: '/central',
    sencoord: '/senatorial', sendirector: '/senatorial', senops: '/senatorial', senanalyst: '/senatorial',
    senincident: '/senatorial', senverify: '/senatorial', senviewer: '/senatorial',
    lgcoord: '/lg', lgsupervisor: '/lg', lganalyst: '/lg', lgtech: '/lg', wardcoord: '/lg',
    supervisor: '/supervisor', reviewer: '/supervisor',
    agent: '/agent', pio: '/central',
  };
  map.secdirector = '/sentinel'; map.socanalyst = '/sentinel'; map.infraengineer = '/sentinel'; map.apisecurity = '/sentinel'; map.secinccmd = '/sentinel';
  return map[roleId] || '/central';
}

// ---- visible, recoverable boot failure (never a frozen transition screen) ----
function showBootFailure(message) {
  window.__portalBooted = true; // disarm the transition watchdog — this screen IS the state
  document.body.innerHTML = `<div class="login-wrap"><div class="login-card" style="text-align:center">
    <div class="confirm-hero">
      <div class="big" style="color:#fbbf24">⚠</div>
      <h3 style="color:#fbbf24">COMMAND DATA UNAVAILABLE</h3>
      <div class="small muted mb12">You are authenticated, but the command data could not be loaded. Your session is safe — this is usually a temporary network issue.</div>
      <div class="small" style="color:#f87171;line-height:1.6">${esc(message || 'The server did not respond in time.')}</div>
      <div class="row mt12" style="justify-content:center">
        <button class="btn primary" id="bretry">↻ RETRY</button>
        <button class="btn ghost" id="bsignout">Sign out</button>
      </div>
    </div>
  </div></div>`;
  const rb = document.getElementById('bretry');
  const sb = document.getElementById('bsignout');
  if (rb) rb.onclick = () => location.reload();
  if (sb) sb.onclick = () => { API.clear(); location.href = '/'; };
}

// ---- unified portal boot: session + data, with guaranteed recovery UI ----
async function bootPortal(portalName, roleHint, creds, opts = {}) {
  try {
    const user = await requireSession(portalName, roleHint, creds, opts);
    // if the perms fetch fell back earlier, try once more now that things have settled
    if (API.perms.length === 0) {
      try {
        const me2 = await API.get('/api/me', { noRelogin: true, timeout: 8000 });
        if (me2 && me2.user) API.setAuth(API.token, me2.user, me2.permissions || []);
      } catch (e) { /* keep best-effort session */ }
    }
    let b = null, o = null;
    if (!opts.skipApiBoot) {
      const boot = await apiBoot();
      b = boot.b; o = boot.o;
    }
    return { user, b, o };
  } catch (e) {
    showBootFailure((e && e.message) || 'The command data could not be loaded.');
    // hold forever: the recovery screen is now the UI — never let the portal continue
    // into a half-initialized state, and never leak an unhandled rejection
    await new Promise(() => {});
  }
}

window.API = API; window.sseConnect = sseConnect; window.sseOn = sseOn; window.sseOff = sseOff;
window.loginStep1 = loginStep1; window.loginStep2 = loginStep2; window.showLogin = showLogin; window.requireSession = requireSession;
window.apiBoot = apiBoot; window.bootPortal = bootPortal; window.showBootFailure = showBootFailure; window.rolePortal = rolePortal;
window.refreshAuthToken = refreshAuthToken;
