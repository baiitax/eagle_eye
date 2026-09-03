// aux_boot_failure_ux_check.js — spawned by scripts/serverless-check.js
// (P0-01 UX regression). Runs the Vercel handler WITHOUT SESSION_SECRET and
// verifies the fail-closed UX: browsers get a guided HTML setup page, API
// clients get clean JSON. Not a standalone test; exits non-zero on failure.
'use strict';
process.env.VERCEL = '1';
delete process.env.SESSION_SECRET;

const path = require('path');
const http = require('http');
const h = require(path.resolve(__dirname, '..', 'api', 'index.js'));

const srv = http.createServer(async (q, s) => {
  try { await h(q, s); } catch (e) { s.writeHead(500); s.end('handler error'); }
});

srv.listen(3199, '127.0.0.1', async () => {
  try {
    const get = (opts) => new Promise((resolve, reject) => {
      http.get(opts, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'], body: b }));
      }).on('error', reject);
    });
    const page = await get({ host: '127.0.0.1', port: 3199, path: '/sentinel' });
    const api = await get({ host: '127.0.0.1', port: 3199, path: '/api/health', headers: { accept: 'application/json' } });
    const htmlOk = page.status === 500 && /text\/html/.test(page.ct || '') && page.body.includes('SETUP REQUIRED') && page.body.includes('SESSION_SECRET');
    const jsonOk = api.status === 500 && /"error":"BOOT_FAILURE"/.test(api.body) && /SESSION_SECRET_REQUIRED/.test(api.body);
    console.log('HTML:' + htmlOk);
    console.log('JSON:' + jsonOk);
    srv.close();
    process.exit(htmlOk && jsonOk ? 0 : 1);
  } catch (e) {
    console.log('ERR:' + e.message);
    process.exit(1);
  }
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(1); }, 15000);
