// audit-extract.js — M0 audit artifact (read-only): route + authz inventory extractor
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
const lines = src.split('\n');
const routes = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^route\('([A-Z]+)', \/\^\\\/([^\n]+)/);
  if (!m) continue;
  let auth = 'UNKNOWN', scope = '';
  for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
    const seg = lines[j];
    const pm = seg.match(/auth\.can\(u, '([a-z.]+)'\)/);
    if (/currentUser\(req\)/.test(seg) || /secUser\(req/.test(seg)) auth = 'AUTH';
    if (pm) { auth = 'AUTH'; if (!scope) scope = pm[1]; }
    if (/sendJson\(res/.test(seg) || /sendBuffer\(res/.test(seg)) break;
  }
  if (auth === 'UNKNOWN') auth = 'PUBLIC';
  const pat = m[2].replace(/\\\//g, '/').replace(/\\\$/g, '').replace(/\\\\/g, '\\');
  routes.push({ line: i + 1, method: m[1], pattern: pat, auth, scope });
}
console.log('TOTAL_ROUTES', routes.length);
console.log('PUBLIC', routes.filter(r => r.auth === 'PUBLIC').length, 'AUTH', routes.filter(r => r.auth === 'AUTH').length);
for (const r of routes) {
  console.log([String(r.line).padEnd(5), r.method.padEnd(6), r.pattern.slice(0, 78).padEnd(80), r.auth.padEnd(7), r.scope].join(' '));
}
