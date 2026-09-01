# EYES OF VICTORY 2027

[![CI](https://github.com/baiitax/eagle_eye/actions/workflows/ci.yml/badge.svg)](https://github.com/baiitax/eagle_eye/actions)

**Kano State — Election Situation Room & Monitoring Platform** · *Monitor. Verify. Respond. Report.*
Public domain tagline: *See the Evidence. Follow the Process. Understand the Election.*

A complete working prototype of an enterprise election-monitoring and command-centre ecosystem for the 2027 Nigerian General Elections — public election domain, field-agent app, LG/senatorial/central situation rooms, supervisory verification, **SENTINEL Security Operations Centre**, administration — all interconnected over a live event stream with a simulated election day running on Kano's real 44-LGA geography.

> ⚠ **DEMO MODE.** All data is fictional simulation data. Nothing here is an official INEC result.

## Run

```bash
npm install                 # devDependencies only (jsdom, for the test suites)
node server/server.js       # → http://localhost:3000  (zero runtime dependencies)
```

First boot seeds everything and loads the **Collation Phase (27 Feb 2027, 16:20 WAT)** scenario at 30× speed. Switch scenarios from the central header dropdown, **Admin → Simulation Control**, or `POST /api/admin/simulation {action:'reset'}` for a full reset.

## M1 Foundation — security hardening & CI (2026-09-01)

Post-audit hardening delivered in this release:

- **P0-01 fixed:** the HMAC session key is no longer hardcoded. Production/serverless boots
  **fail closed** (`SESSION_SECRET_REQUIRED`) until `SESSION_SECRET` is set; local demos use a
  random per-boot secret. **Set `SESSION_SECRET` in Vercel → Settings → Environment Variables**
  (`openssl rand -hex 32`), otherwise the deployment intentionally refuses to start.
- **P1-01 fixed:** geographic scope on the LG/Senatorial evidence APIs is now
  authenticated-user-first (query-parameter overrides restricted to centrally-scoped roles).
- **CI gates:** `npm run lint` (static analysis incl. route-dup detection) ·
  `npm run secret-scan` (tree + full git history) · `npm test` (self-contained runner, 12 suites)
  — wired into GitHub Actions (`.github/workflows/ci.yml`).
- **Environment parity:** `.env.example`, npm scripts, jsdom as the single dev dependency.
- Regression coverage in `scripts/security-test.js`; status tracked in `AUDIT/ROADMAP_STATUS.md`.

## Deploying to Vercel

The repo is Vercel-ready: `api/index.js` is a serverless entry that boots the app per warm instance and serves every route (pages + APIs + static assets) with the exact same handler as the local server; `vercel.json` rewrites all paths to it and force-includes `public/**` + `data/**` in the function bundle.

**Steps:** connect the GitHub repo in Vercel → Framework Preset: **Other** (no build command, no output directory) → Deploy. On redeploy after a push, everything just works.

**Serverless behaviour (documented differences from local):**
- Each **cold start** re-seeds the deterministic demo baseline (Collation Phase, 16:20 WAT). A **warm instance** keeps its in-memory state, so interactions persist while the instance lives.
- Sign-in **survives instance recycling** — session tokens are HMAC-signed (userId + expiry), validated without the in-memory session store; tampered tokens are rejected. User IDs are **deterministic across cold starts** and **MFA challenges are self-contained signed payloads**, so a sign-in (or the post-login navigation to `/admin` etc.) that lands on a different instance still authenticates — no redirects back to the home page.
- The **realtime SSE stream is disabled** (the client detects it via `/api/health`); all data is fetched on demand.
- `/assets/*` are served with `public, max-age=3600` so page loads don't re-invoke the function per file.
- Runtime state writes are skipped gracefully (read-only filesystem) — the baseline re-seeds on the next cold start.

For full realtime + persistent state (SSE, live sim ticking, durable actions), run the long-lived server on Render / Railway / Fly.io instead: `node server/server.js`.

## Pages

| Portal | URL | Login |
|---|---|---|
| **Public Election Domain (home)** | `/` | open access — live KPIs, result observatory, incidents, IReV watch, SIGN IN |
| **Secure Sign-In** | `/login` | one page, MFA, clickable demo credentials for every role |
| Full Public Portal | `/public` | open access |
| **SENTINEL SOC** | `/sentinel` | `socanalyst / SocAna@123!` (Director: `secdirector / SecDir@123!`) |
| Central Situation Room | `/central` | `director / Director@123!` |
| Supervisory Verification | `/supervisor` | `supervisor / Supervisor@123!` |
| LG Supervisor Portal (Nasarawa) | `/lg` | `lgcoord / LGCoord@123!` |
| Senatorial Command (Kano North) | `/senatorial` | `sencoord_n / SenCoord@123!` |
| Field Agent App | `/agent` | `fieldagent / Agent@123!` |
| Super Administration | `/admin` | `superadmin / Admin@123!` |

40 demo users. The demo MFA code is displayed on the sign-in screen.

## SENTINEL SECURITY OPERATIONS CENTRE (new)

**EYES OF VICTORY — SENTINEL SOC** · *Protect the Infrastructure. Preserve the Evidence. Maintain Election-System Integrity.*

A full technical security command centre covering all 75 spec sections: top command bar (SYSTEM SECURITY / THREAT LEVEL / NODES / API HEALTH / ACTIVE INCIDENTS / CRITICAL VULNERABILITIES / SECURITY EVENTS / LAST SCAN), **SECURITY POSTURE** (weighted score from 10 traceable domains — every domain opens its underlying evidence; no unexplained "AI scores"), rule-based **GLOBAL THREAT LEVEL** (NORMAL→CRITICAL, explicit basis + analyst overrides with mandatory reasons), secure-layer **GLOBAL INFRASTRUCTURE MAP**, **Node Command Centre** (14 nodes: CPU/RAM/disk/network/patch/security-agent + node detail + audited action centre), **API Security Centre** (12 APIs, anomaly detection with evidence, rate-limit command), **Identity Security** (sessions, privileged access, MFA coverage), **Vulnerability Centre + Patch Command + Configuration Drift + File Integrity**, **Database / Evidence Store / Recovery Centre** security, **Public Domain + WAF + availability defence**, **IReV Watchtower security**, **Threat Intelligence + Correlation**, **Security Cases** with the 9-step workflow (DETECTED→…→CLOSED), incident workspace, communications, **Response Playbooks (11)**, **Action Centre** with a 25-action catalog (LOW/MEDIUM/HIGH/CRITICAL risk; SINGLE vs **DUAL authorization**; approval → execute → **automated rollback**; every action recorded WHO/WHAT/WHEN/TARGET/BEFORE/AFTER/WHY/APPROVAL/RESULT in the **immutable security audit**), **Break-Glass** emergency access (reason required, auto-expiry, elevated monitoring), **Central Security Log** (search/filter/CSV export/create-case), **KPIs** (MTTD/MTTA/MTTC/MTTR…), **Compliance**, **Risk Register**, **Executive view with top-5 attention**, **Election-Day Defence Mode** with 7 priority layers, large-screen **Command Wall**, and the **SENTINEL Copilot** which *proposes* actions with impact/approval preview but **never executes from chat**.

Security operating model: **MONITOR → DETECT → CORRELATE → VERIFY → PRIORITIZE → CONTAIN → RECOVER → AUDIT** — *no blind spots, no untracked privilege, no unlogged actions, no silent changes.*

## Public domain home & secure sign-in (new)

`/` is now the **public election domain**: live KPI strip (reporting/verified/incidents/SOS/IReV coverage/updates), **Result Observatory** (senatorial districts + governorship monitored vote share from verified submissions), incident monitor, IReV watch, the Kano LGA map, full transparency notes ("UNOFFICIAL MONITORING DATA — NOT OFFICIAL INEC RESULTS"), a SIGN IN button in the header, a fixed **login dock at the bottom**, an "OPEN MY ROLE DASHBOARD" banner for signed-in users, and a compact grid of the nine authorized portals.

`/login` is the dedicated **secure sign-in page**: the MFA login card sits beside five groups of **clickable demo-credential chips** (Field & Verification, Situation Rooms, Central Command, SENTINEL, Administration & Observation — one click fills the form), and successful verification routes straight to the role dashboard.

## Design system (Glassmorphism 2.1)

The entire platform uses a **glassmorphism design language**: an animated aurora gradient layer (deep navy/blue/green/red orbs) sits behind every surface, and all panels, KPI cards, modals, maps, the public landing and the login card render as frosted glass — translucent backgrounds with `backdrop-filter` blur + saturation, 1px luminous borders and inner highlights. The public domain uses a light-theme variant (white frosted glass over pastel orbs). Status colour semantics (green/amber/red/blue/grey, always paired with text/icons) are unchanged, animations respect `prefers-reduced-motion`, and glass never compromises readability.

**Enhanced login (robust across environments)**: secure-connection indicator, icon inputs, show/hide PIN toggle, remember-device, demo quick-fill chip, **clickable demo-credential chips**, loading states, shake feedback on bad credentials, and a 6-box OTP input with auto-advance, paste support, a 5-minute countdown matching the server challenge TTL (with expiry auto-recovery), auto-submit on the 6th digit, a "USE DISPLAYED CODE" one-click demo fill, visible errors on the MFA step, per-challenge attempt limiting (3 attempts → MFA_LOCKED with auto-return to sign-in), network-failure handling with code preservation and RETRY, and a full-screen "AUTHENTICATED — SECURE SESSION ESTABLISHED" transition.

**Post-auth workflow hardening**: after a successful verify, the transition screen names the authenticated user's role and route; every portal boots through `bootPortal()` which, on failure, shows a "COMMAND DATA UNAVAILABLE" recovery screen with RETRY and Sign-out instead of freezing; a 20-second watchdog catches portals that fail to take over; requests carry a 15-second timeout; `/api/me` permissions retry 5×; the landing page shows an "OPEN MY ROLE DASHBOARD" banner; `sseConnect` failures never block sign-in.

**Environment resilience**: all client storage routes through a **safe-storage wrapper with an in-memory fallback** — `localStorage` access that throws (sandboxed preview iframes, privacy modes) can no longer break auth; login/API rate limits accommodate shared proxy IPs.

## Branding assets

The extracted system logo lives in `public/assets/media/` (`logo.png` transparent, `logo-card.png` white-background, `logo-source.png` original) with a full favicon set. Every page carries a branded EYES OF VICTORY preloader (radar sweep + secure-connection checklist; SENTINEL uses a red-alert variant).

## What's inside

- **Field Agent app** — onboarding (assignment → device → GPS → duty activation), election-day phase stepper, 5-step result wizard with OCR confidence, simulated EC8A capture with SHA-256 evidence, incident flow, hold-to-activate SOS, live video, evidence library, offline sync centre, messages, security centre, duty summary.
- **LG & Senatorial situation rooms** — operational health scores, GIS command maps, ward command, results matrices, review queues, EC8A viewers, incident/SOS command, escalations, analytics, copilot, SITREPs, audited exports.
- **Central Situation Room 2.0** — MASTER SYSTEM STATUS with operating modes, 7-component operational health score, six-view GIS map, merged live feed, WHAT CHANGED?, result-flow bottlenecks, Discrepancy Command with two-person approval, video wall, tasks, communications, shift handovers, versioned SITREPs, Mobile Command.
- **IReV WATCHTOWER** — public-observation reconciliation (three-way: FIELD EC8A ↔ EOV ↔ IReV), immutable snapshots with hashes, change detection with careful language ("RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED"), two-person approval for CRITICAL/possible-result-change classifications, coverage matrix, latency analytics, archive.
- **Public observatory** — source+status+last-updated on every figure, public GIS, Result Observatory, IReV WATCH, What Changed, corrections centre, open data API (`/api/public/*`).
- **SENTINEL SOC** — the full security operations centre described above.
- **Security** — MFA, server-side RBAC (20 roles incl. 5 SENTINEL roles), rate limiting, lockout, scrypt hashing, immutable audit, SHA-256 evidence chain, SENTINEL's append-only security audit.
- **Demo mode** — deterministic scenario engine (5 presets), speed control, watermarking, "DEMO DATA — NOT OFFICIAL ELECTION RESULTS" labelling everywhere.

## Tests (all green)

```bash
node scripts/sentinel-test.js   # 155 checks — SENTINEL API + UI + landing + login (self-resets state)
node scripts/apitest.js         # auth, review flow, dual control, corrections, copilot, exports
node scripts/e2e.js             # AGENT → … → PUBLIC pipeline incl. RBAC negatives
node scripts/agent-test.js      # 50 · lg-test.js 62 · senatorial-test.js 71
node scripts/central20-test.js  # 41 · irev-test.js 69 · public-test.js 58 · login-test.js 47
```

Also verified in real headless Chrome: public landing (live data, sign-in paths), login page (chip-fill → OTP → role routing), SENTINEL dashboard (top bar, 10-domain posture, infrastructure map, wall mode, action centre) — see `docs/screenshots/`.

## Layout

```
server/        zero-dependency Node.js server (REST + SSE + static)
server/lib/    store, seed, sim engine, validation, auth, copilot, reports, irev, sentinel
public/        all applications (shared shell, SVG GIS engine, SVG charts) + landing + login
scripts/       geography builder + 10 test suites
docs/          schema, documentation, screenshots
data/          generated geography + runtime simulation state
```
