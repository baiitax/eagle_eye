# FORENSIC EVIDENCE — marker greps & secret scan (M0)

Date: 2026-09-01 · Repo: baiitax/eagle_eye @ 15d077c (main) · Node v20.20.2

## Marker greps (server/ public/assets/js scripts, media excluded)
| Marker | Count | Notes |
|---|---|---|
| TODO / FIXME / HACK / PLACEHOLDER / FAKE / BYPASS / MOCK | 0 | clean |
| TEMP | 5 | all false positives (MAX_ATTEMPTS etc.) |
| DISABLED | 10 | feature flags (e.g. RULE-0003 disabled, resend-link states) |
| console.log | 202 | server: boot lines only; client: console.warn error handlers |
| SIMULAT* | 30 | all demo simulation labels/engine |
| DEMO labels | 48 | demo-mode banners & disclaimers throughout |

## Secret scan
- Working tree: **no** `ghp_`, `sk-`, AKIA, private-key blocks, xox tokens. CONFIRMED clean.
- Git history (4 commits, single branch main): **no** secret-looking diff lines. CONFIRMED clean.
- `process.env` usage: only `PORT`, `VERCEL`, `SESSION_SECRET`.
- **SECRET DETECTED — LOCATION REDACTED** (source default, not env): `server/lib/auth.js:9`
  `SESSION_SECRET = process.env.SESSION_SECRET || 'ev2027-kn-demo-session-secret'`
  → hardcoded fallback signing key committed in source. Forged-token risk. Recommend: rotate,
  require env var, fail closed when absent.
- Demo credentials (40 accounts incl. superadmin) are committed in `server/lib/seed.js`
  (documented demo accounts — acceptable only for the demo; production must use provisioned
  identities + a real MFA provider).

## Security headers
Server emits only `Content-Type`, `Content-Length`, `Cache-Control` (+ SSE headers).
**Absent:** CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy,
X-Frame-Options/frame-ancestors. CONFIRMED.

## Capability probes
| Capability | Present? | Evidence |
|---|---|---|
| Service Worker | NO | 0 matches in public/ |
| IndexedDB | NO | 0 matches |
| Cookies | NO | 0 matches (bearer token in localStorage/safeStore) |
| Offline queue | PARTIAL | localStorage-backed queue (agent.js), memory fallback |
| Evidence at-rest encryption | NO | no crypto usage outside scrypt/hash/HMAC |
| Body size cap | YES | readBody limit 12 MB |
| Path traversal guard | YES | normalize + startsWith(PUBLIC_DIR) check |
| SQL/command injection surface | NONE | no SQL, no child_process |
| SSRF surface | NONE | no server-side outbound fetch |
| Open redirect surface | NONE | no redirect-from-param code |
| Copilot destructive capability | NONE | rule-based; propose/approve only (verified by tests) |

## Live deployment probe (read-only, 2026-09-01)
| Target | Result |
|---|---|
| https://eagle-eye-swart.vercel.app/ | HTTP 200 |
| https://eagle-eye-swart.vercel.app/admin | HTTP 200 |
| https://eagle-eye-swart.vercel.app/api/health | HTTP 200, simNow=RESULTS baseline |
