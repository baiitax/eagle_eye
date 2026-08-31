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
'use strict';
const { handleRequest, boot } = require('../server/server.js');

let bootPromise = null;
function ensureBoot() {
  if (!bootPromise) bootPromise = Promise.resolve().then(() => boot());
  return bootPromise;
}

module.exports = async function handler(req, res) {
  await ensureBoot();
  return handleRequest(req, res);
};
