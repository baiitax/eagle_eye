// lint.js — M1 static-analysis gate (zero-dependency)
// Checks: syntax (node --check) · banned patterns · client rules (console.log,
// direct localStorage, eval, debugger) · TODO/FIXME/HACK markers · secret patterns ·
// duplicate route registrations. Exit code 0 = clean.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const errors = [];
const warnings = [];
const JS_AREAS = ['server', 'scripts', 'api'];
const CLIENT_AREAS = ['public/assets/js'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// ---- 1. syntax check ----
const files = [...JS_AREAS, ...CLIENT_AREAS].flatMap(a => walk(path.join(ROOT, a))).filter(f => f.endsWith('.js'));
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { errors.push(`${f}: SYNTAX ERROR`); }
}

// ---- 2. content rules ----
const SECRET_RE = /\b(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[bp]-[A-Za-z0-9-]{10,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)\b/;
const RETIRED_SECRET = /ev2027-kn-demo-session-secret/;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  const lines = src.split('\n');
  const isClient = rel.startsWith('public/assets/js');
  const isSelf = rel === 'scripts/lint.js';
  const isRegressionTest = rel === 'scripts/security-test.js'; // intentionally constructs the retired key to prove rejection
  if (isSelf) continue; // the checker never audits itself
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (isClient && /console\.log\s*\(/.test(line)) errors.push(`${at}: console.log in client bundle — use console.warn/error or remove`);
    // the safeStore wrapper itself (api.js) is exempt: its lines contain the memStore fallback
    if (isClient && /\blocalStorage\./.test(line) && !/memStore/.test(line)) errors.push(`${at}: direct localStorage access — route through window.safeStore`);
    if (/[^\w.]eval\s*\(/.test(line)) errors.push(`${at}: eval() banned`);
    if (/^\s*debugger\s*;?\s*$/.test(line.trim())) errors.push(`${at}: debugger statement`);
    if (/\b(TODO|FIXME|HACK):/.test(line)) warnings.push(`${at}: TODO/FIXME/HACK marker`);
    if (SECRET_RE.test(line)) errors.push(`${at}: SECRET PATTERN DETECTED (value redacted)`);
    if (RETIRED_SECRET.test(line) && !isRegressionTest) errors.push(`${at}: retired default session secret present — P0-01 regression`);
  });
}

// ---- 3. duplicate route registrations ----
const serverSrc = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
const seen = new Map();
for (const [i, line] of serverSrc.split('\n').entries()) {
  const m = line.match(/^route\('([A-Z]+)', \/\^([^/]*)\\?\/([^\n]*)/);
  if (!m) continue;
  const key = `${m[1]} ${m[2]}/${m[3]}`;
  if (seen.has(key)) errors.push(`server/server.js:${i + 1}: duplicate route registration of ${key} (first at line ${seen.get(key)})`);
  else seen.set(key, i + 1);
}

// ---- report ----
console.log(`lint: ${files.length} JS files checked`);
for (const w of warnings) console.log('  ⚠ ' + w);
if (errors.length) {
  for (const e of errors) console.log('  ✗ ' + e);
  console.log(`\nLINT FAILED — ${errors.length} error(s)`);
  process.exit(1);
}
console.log('LINT PASSED — no errors');
