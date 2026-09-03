// api/index.js — Vercel serverless entry point for EYES OF VICTORY 2027
//
// The platform is a zero-dependency Node.js HTTP application. Locally it runs as a
// long-lived server (`node server/server.js`). On Vercel, every request is routed
// here (see vercel.json rewrites): each warm instance boots the demo once and then
// serves requests with the exact same handler as the local server.
//
// Serverless notes:
//  - boot is idempotent per instance; seeded data is deterministic, so every cold
//    start shows the same baseline demo (Collation Phase, 27 Feb 2027 16:20 WAT)
//  - session tokens are HMAC-signed, so sign-ins survive instance recycling
//  - realtime SSE is disabled (the client detects this via /api/health)
//  - runtime state writes are skipped gracefully (read-only filesystem)
//  - boot FAILS CLOSED without SESSION_SECRET (audit P0-01): browsers see a guided
//    setup page, API clients get a clean JSON error.
'use strict';
const { handleRequest, boot } = require('../server/server.js');
const store = require('../server/lib/store');
const db = require('../server/lib/db');

let bootPromise = null;
function ensureBoot() {
  if (!bootPromise) bootPromise = Promise.resolve().then(() => boot());
  return bootPromise;
}

function setupPageHtml(message) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Setup required — EYES OF VICTORY</title>
<style>
body{margin:0;min-height:100vh;background:radial-gradient(900px 500px at 50% -10%,#14233f,#060a13);color:#cfe3f5;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:640px;width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(148,183,235,.2);border-radius:14px;padding:28px 30px;backdrop-filter:blur(14px)}
h1{color:#fff;font-size:19px;margin:0 0 6px;letter-spacing:.5px}
h1 small{display:block;font-size:9px;letter-spacing:2.5px;color:#8ba0bd;margin-top:4px;font-weight:400}
.alert{border:1px solid #6b4a10;background:#2b1c07;color:#fde68a;border-radius:8px;padding:10px 14px;font-size:12.5px;margin:16px 0;line-height:1.6;word-break:break-word}
ol{margin:14px 0 0 20px;padding:0;font-size:13px;line-height:2;color:#8ba0bd}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#7dd3fc;background:#0c1626;border:1px solid #1d3a5f;padding:1px 6px;border-radius:4px}
pre{background:#0c1626;border:1px solid #1d3a5f;border-radius:8px;padding:12px;font-size:11.5px;color:#7dd3fc;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.note{font-size:11px;color:#64748b;margin-top:14px;line-height:1.7}
b{color:#fff}
</style></head><body><div class="card">
<h1>EYES OF VICTORY<small>SETUP REQUIRED — DEPLOYMENT REFUSED TO START (SECURITY)</small></h1>
<div class="alert">⚠ <b>${esc(message)}</b><br>
This refusal is intentional: the platform fails closed rather than run with a predictable signing key (audit P0-01).</div>
<ol>
<li>Open <b>Vercel → your project → Settings → Environment Variables</b>.</li>
<li>Add <b><code>SESSION_SECRET</code></b> — generate a value with:<br><pre>openssl rand -hex 32</pre>
(paste the output as the value — the platform requires it, never the example below)<br>
<pre>SESSION_SECRET=PASTE_GENERATED_64_CHAR_HEX_VALUE_HERE</pre></li>
<li>Optional but recommended — add <b><code>DATABASE_URL</code></b> (Neon or Vercel Postgres) so identity, sessions and audit survive cold starts:<br><pre>DATABASE_URL=postgres://USER:PASSWORD@HOST/DBNAME?sslmode=require</pre></li>
<li>Check the <b>Environment</b> dropdown: variables must be added to <b>Production</b> (and Preview if you use preview URLs).</li>
<li>Click <b>Save</b>, then <b>Deployments → ⋮ on the latest deployment → Redeploy</b>.<br>
<b>Environment variables only apply to NEW deployments — saving them is not enough; a redeploy is required.</b></li>
<li>Reload this page — it becomes the public election domain.</li>
</ol>
<div class="note">If you already added the variables: verify the spelling (<code>SESSION_SECRET</code>), the environment scope (Production), and that you redeployed after saving. This screen disappears automatically once the platform boots.</div>
</div></body></html>`;
}

module.exports = async function handler(req, res) {
  try {
    await ensureBoot();
    // M3: wait for the database layer (migrations + hydration) before serving,
    // so sessions, revocations and passwords survive instance cold starts.
    await db.ensureHydrated(store.S());
  } catch (e) {
    const msg = String((e && e.message) || e || 'Boot failure');
    const url = new URL(req.url, 'http://x');
    const wantsJson = url.pathname.startsWith('/api/') || /application\/json/.test(req.headers.accept || '');
    if (wantsJson) {
      const body = JSON.stringify({ error: 'BOOT_FAILURE', message: msg });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      return res.end(body);
    }
    // Browsers get a guided setup page instead of raw JSON
    const html = setupPageHtml(msg);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) });
    return res.end(html);
  }
  return handleRequest(req, res);
};
