// secret-scan.js — M1 secret-scanning gate (zero-dependency)
// Scans the working tree for credential patterns; --history additionally scans
// the full git history (diff lines). Values are NEVER printed.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');

const PATTERNS = [
  { name: 'GitHub PAT', re: /\bghp_[A-Za-z0-9]{20,}/ },
  { name: 'OpenAI/Anthropic-style key', re: /\bsk-[A-Za-z0-9]{20,}/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[bp]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'Generic password assignment (in code)', re: /\b(?:password|passwd|pwd|secret|api_key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i },
  // documented demo credentials (convention: end with @123! / @123) are not secrets
  { name: 'DEMO_CREDENTIALS_ALLOWLIST', re: /['"][^'"]*@123!?['"]/ },
];
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'media', 'AUDIT', 'screenshots', '.cache']);
const EXCLUDE_FILES = new Set(['state.json', 'nga_adm2_src.geojson', 'package-lock.json']);

const findings = [];
function scanText(text, origin) {
  const demo = PATTERNS[PATTERNS.length - 1].re;
  for (const p of PATTERNS.slice(0, -1)) {
    const m = text.match(p.re);
    if (m && p.name !== 'Generic password assignment (in code)') { findings.push(`${p.name} in ${origin} (value redacted)`); continue; }
    if (m && !demo.test(m[0])) findings.push(`${p.name} in ${origin} (value redacted)`);
  }
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (!EXCLUDE_FILES.has(e.name)) out.push(p);
  }
  return out;
}

// working tree
const files = walk(ROOT).filter(f => fs.statSync(f).size < 2 * 1024 * 1024);
for (const f of files) {
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  scanText(src, path.relative(ROOT, f));
}

// history (optional, used in CI)
if (process.argv.includes('--history')) {
  try {
    const diff = execFileSync('git', ['-C', ROOT, 'log', '--all', '-p', '--diff-filter=AM'], { stdio: 'pipe', maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
    scanText(diff, 'git history (diff of all commits)');
  } catch (e) { findings.push('could not read git history: ' + e.message.split('\n')[0]); }
}

console.log(`secret-scan: ${files.length} files scanned${process.argv.includes('--history') ? ' + full git history' : ''}`);
if (findings.length) {
  for (const f of findings) console.log('  ✗ ' + f);
  console.log(`\nSECRET SCAN FAILED — ${findings.length} finding(s). Rotate/remove immediately.`);
  process.exit(1);
}
console.log('SECRET SCAN PASSED — no credential patterns found');
