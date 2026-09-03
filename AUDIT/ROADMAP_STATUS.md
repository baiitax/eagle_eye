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

## M2 COMPLETE — IDENTITY & ACCESS (2026-09-01)

**Delivered (all verified):**
- **Real TOTP MFA (RFC 6238)** — zero-dependency engine (`server/lib/totp.js`, verified against
  the official RFC 6238/4226 test vectors 287082 / 081804 / 005924). Every account is enrolled
  with a TOTP secret; login step 2 verifies the code against the user's secret (±1 step window,
  timing-safe). Demo mode displays the current code with a live 30s rotation countdown and
  auto-refresh; the same code verifies in any authenticator app via the `otpauth://` URI
  (`GET /api/auth/mfa/setup`).
- **Revocable + refreshable sessions** — sessions carry sid/gen, HMAC-signed tokens; logout and
  SENTINEL/admin termination perform REAL server-side revocation; `POST /api/auth/refresh`
  rotates tokens (retiring the previous one — enforced incl. the stateless fallback);
  `/api/auth/revoke-all` and admin revoke-all; password changes/resets sign out other sessions;
  absolute 72h session cap.
- **Password reset & change** — enumeration-safe request flow (signed 15-min tokens; demo shows
  the code), strong-password policy (≥8 chars, letters+digits) enforced on reset, change,
  admin-set and user creation; self-service change requires the current password and keeps only
  the current session.
- **Central rate limiting (AUTH-03)** — policy registry (`server/lib/ratelimit.js`): login/mfa/
  pwreset/api budgets with cooldown lockouts, viewable & adjustable via
  `GET/PATCH /api/admin/ratelimit` and the SENTINEL ADJUST_RATE_LIMIT action (real effect);
  brute-force 429 verified; Redis-swap boundary documented.
- **SENTINEL identity is now REAL (spec §14/§15/§56)** — `/api/sentinel/identity` reports live
  auth telemetry (attempts, failures, MFA events, resets, session counts, new devices, hourly
  series), REAL session rows with risk flags, dormant accounts, and MFA coverage computed from
  enrollment. Session termination from SENTINEL revokes the real token.
- **Step-up authentication (spec §16/§48)** — HIGH/CRITICAL SENTINEL actions and break-glass
  require a fresh TOTP code (`STEPUP_REQUIRED`/`STEPUP_INVALID`); the UI provides a
  "USE MY CURRENT CODE" helper. LOW/MEDIUM actions unchanged.
- Client: TOTP countdown UI, demo-code auto-refresh, forgot-PIN reset flow on /login, sliding
  token refresh in boot, admin users tab (TOTP status, last login, revoke sessions, policy hints).

**Verification:** `mfa-test.js` 63 checks · real-browser review 9/9 (TOTP login→routing, step-up
modal + fill, reset flow, credential restore) · full runner 13/13 suites (~700 checks) · lint +
secret-scan clean.

## M3 COMPLETE — DATABASE (2026-09-01)

**Delivered (verified against REAL PostgreSQL):**
- `server/lib/db.js` provider layer (Postgres = durable source of truth when `DATABASE_URL`
  set; in-memory store = runtime working set, mirrored every save at 3s cadence; JSON fallback
  unchanged) + `pg` as the single runtime dependency.
- 21-table versioned migrations (`server/migrations/`, auto-applied at boot, `npm run migrate`).
- Cold-start continuity: users (password/TOTP/status), revoked_sessions, rate policies,
  app_config, append-only audit_log and a throttled full-state snapshot hydrate at boot —
  proven by `scripts/db-test.js` (25 checks: password change and session revocation SURVIVE a
  kill-and-reboot with the state file deleted; `stateLoadedFrom: database`).
- Retention enforced (PRIV-01) with the platform clock; audit_log prune included.
- Backup & restore (DR-01): SQL export endpoint + `scripts/db-import.js`; round-trip verified
  into a fresh database (row counts match). `scripts/migrate.js` (status/up/down/reset).
- Admin → Database panel (mode/connection/row counts/snapshot/retention/export);
  `/api/health` reports `database.mode` + `stateLoadedFrom`.
- Full regression: 14/14 suites in no-DB fallback mode; db-test 25/25 against Postgres.

## Next milestones (awaiting authorization)

- **M4 Evidence · M5 Field/Offline · M6 Verification · M7 Command · M8 SENTINEL · M9 Analytics ·
  M10 Public Transparency · M11 Security & Resilience · M12 Production** (see M0 report §41).
