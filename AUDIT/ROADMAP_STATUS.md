# ROADMAP STATUS — M1 COMPLETE (2026-09-01)

Implementation authorized by the operator after the M0 audit. This file tracks
findings → resolution → verification per milestone.

## Resolved findings

### P0-01 · SEC-01 — Default session-signing key (RESOLVED)
- **Fix:** `server/lib/auth.js` no longer contains a committed default. Local/demo runs use a
  random per-boot secret (with a loud warning); **production/serverless boots FAIL CLOSED**
  with `SESSION_SECRET_REQUIRED` and guidance when the env var is missing (`boot()` →
  `auth.assertSessionSecretConfigured()`; `api/index.js` surfaces a friendly JSON error).
- **Verification:**
  - `scripts/security-test.js` proves a token forged with the **retired** default key is rejected (401)
    on `/api/me` and on a privileged endpoint.
  - `scripts/serverless-check.js` proves serverless boot fails closed without the env var (subprocess check).
  - `scripts/lint.js` guards against the retired string ever returning (regression rule).
- **Operator action required:** set `SESSION_SECRET` (generate: `openssl rand -hex 32`) in
  Vercel → eagle-eye-swart → Settings → Environment Variables. Until set, the deployed site
  intentionally returns `SESSION_SECRET_REQUIRED` (fail-closed per the audit).

### P1-01 · AUTHZ-01 — Geographic scope bypass (RESOLVED)
- **Fix:** `GET /api/senatorial/evidence` and `GET /api/lg/evidence` now resolve scope
  **authenticated-user-first**; the query parameter is honoured only for centrally-scoped
  (unscoped) roles.
- **Verification:** `scripts/security-test.js` (6 checks) proves a scoped coordinator
  requesting another district/LGA receives only their own scope's rows, and that unscoped
  roles can still filter by parameter.

### Bonus · safeStore gap (RESOLVED)
- "Remember my device" used raw `localStorage.setItem` and would throw in storage-blocked
  environments; now routed through `window.safeStore`.

## M1 Foundation deliverables

| Item | Status | Location |
|---|---|---|
| Static-analysis gate (syntax, banned patterns, client rules, route-dup detection) | ✅ | `scripts/lint.js` |
| Secret scanner (tree + full git history, value-redacted output) | ✅ | `scripts/secret-scan.js` |
| Reproducible test runner (self-spawns/reuses server, runs all 12 suites) | ✅ | `scripts/run-all-tests.js` |
| CI pipeline (lint + secret scan + tests on push/PR) | ✅ | `.github/workflows/ci.yml` |
| Environment parity (fail-closed secret, documented vars) | ✅ | `.env.example`, `package.json` |
| Test harness portability (jsdom from repo devDependencies) | ✅ | `package.json` + suite resolution |
| P0/P1 regression suite | ✅ | `scripts/security-test.js` |
| npm scripts (`start` / `test` / `lint` / `secret-scan`) | ✅ | `package.json` |

## Verification run (2026-09-01, clean slate)

- `npm run lint` → **41 JS files, 0 errors**
- `npm run secret-scan` → **tree + full history clean**
- `npm test` → **12/12 suites** (apitest, security-test, e2e, agent, lg, senatorial,
  central20, irev, public, login, sentinel, serverless-check) — ~650 checks, 0 failures
- `serverless-check` → 31/31 including P0-01 fail-closed regression

## Next milestones (awaiting authorization)

- **M2 Identity & Access:** real MFA (TOTP/WebAuthn), session revocation/refresh, password
  reset, central rate limiting, complete auth lifecycle (AUTH-01/02/03).
- **M3 Database:** PostgreSQL/PostGIS per `docs/schema.sql`, retention enforcement (DB-01..04, PRIV-01).
- **M4 Evidence · M5 Field/Offline · M6 Verification · M7 Command · M8 SENTINEL · M9 Analytics ·
  M10 Public Transparency · M11 Security & Resilience · M12 Production** (see M0 report §41).
