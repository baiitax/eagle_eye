# COMPONENT INVENTORY — A–I classification (M0)

Key: **A** production-functional · **B** partially functional · **C** frontend simulation · **D** backend simulation · **E** hardcoded · **F** broken · **G** security risk · **H** dead · **I** missing.
*"Simulated" means the mechanism is real but its inputs are seeded fiction, or vice versa.*

## Server (server/)

| Component | Location | Purpose | State | Dependencies | Risk |
|---|---|---|---|---|---|
| HTTP router + static server | server/server.js (3.5k LOC) | all 188 routes, SSE, static serving | **B** | store, auth, sim, irev, sentinel, reports | monolith coupling |
| State store | server/lib/store.js | in-memory state + JSON snapshot, audit, notify | **D→E** (no DB) | fs | P0 data loss |
| Seed data | server/lib/seed.js | 40 users, 34 roles, geography, agents, devices | **E** | geo.json | demo creds committed |
| Simulation engine | server/lib/sim.js | scripted election day at 30× | **D** | store | fake telemetry origin |
| Auth | server/lib/auth.js | scrypt, MFA (demo), signed sessions, rate limits | **B/G** | crypto | P0 default secret |
| Validation | server/lib/validation.js | submission anomaly rules (neutral language) | **A** (logic) | — | — |
| IReV Watchtower | server/lib/irev.js | simulated observation/reconciliation, hash snapshots | **B/D** | store | data is fictional |
| SENTINEL engine | server/lib/sentinel.js | SOC telemetry, cases, actions, approvals | **D** | store | SECURITY TRUST RISK |
| Copilot | server/lib/copilot.js | rule-based intents, provenance labels | **A** (logic) | store, irev | none (no mutations) |
| Reports | server/lib/reports.js | aggregates, CSV/XLSX export | **A** (logic) | store | — |
| Util | server/lib/util.js | uuid, sha256, scrypt, WAT time | **A** | — | — |
| Vercel adapter | api/index.js + vercel.json | serverless entry, rewrites, asset include | **B** | server.js | stateless cold starts |

## Client (public/)

| Component | Location | Purpose | State | Notes |
|---|---|---|---|---|
| Public domain home | index.html | live KPIs, result observatory, incidents, IReV watch, sign-in | **B/D** | real APIs over sim data |
| Secure sign-in | login.html + api.js | MFA login card + clickable demo chips | **B/E** | OTP displayed (demo) |
| Shared core | assets/js/{util,api,ui,map}.js | helpers, fetch+auth, shell/KPIs/charts, SVG GIS | **A** (logic) | safeStore fallback | — |
| Field Agent | pages/agent.js (1.4k) | onboarding, wizard, EC8A capture, SOS, sync | **B/C/D** | canvas-simulated capture | offline gap |
| LG Room | pages/lg.js (1.1k) | ward command, matrix, review, escalations | **B/D** | — | scope bypass (server) |
| Senatorial | pages/senatorial.js (1.4k) | district command, evidence centre, SOS | **B/D** | — | scope bypass (server) |
| Central 2.0 | pages/central.js (1.6k) | modes, health, GIS, IReV, tasks, shifts | **B/D** | — | — |
| Verification | pages/supervisor.js | dual-control EC8A review | **B** | — | — |
| SENTINEL SOC | pages/sentinel.js (1.5k) | SOC dashboards, wall, action centre | **D** (UI) | sentinel APIs | trust risk |
| Admin | pages/admin.js | users/roles/devices/elections/sim control | **B/E** | — | — |
| Public portal | pages/public.js | observatory, corrections, open data | **B/D** | — | PII-safe (verified) |
| Theme | assets/css/theme.css (886 lines) | glassmorphism design system | **A** | — | — |

## Data & docs

| Component | Location | Purpose | State |
|---|---|---|---|
| Geography | data/geo.json (312 KB) | real geoBoundaries LGA shapes; generated wards/PUs | **B/E** (real shapes, generated children) |
| Runtime state | data/state.json (gitignored) | snapshot of in-memory store | **D** (regenerable) |
| Target schema | docs/schema.sql | PostgreSQL/PostGIS design | **I** (not wired) |
| Screenshots | docs/screenshots/ | reference shots | **A** |

## Critical Dependency Map (§43)

| Dependency | Affected capabilities | Failure effect | Rating |
|---|---|---|---|
| Node process | everything | total outage; state loss | CRITICAL |
| data/state.json | all records | silent reseed to fiction | CRITICAL |
| SESSION_SECRET default | auth | token forgery | CRITICAL |
| Vercel instance memory | everything on serverless | state loss per cold start | CRITICAL |
| Sim engine | all data freshness | static demo (clock pauses at day end) | HIGH |
| SSE broadcaster (local) | realtime dashboards | stale UI (recoverable) | MEDIUM |
| jsdom/puppeteer harness | test execution | tests unrunnable (not in repo) | MEDIUM |
| GitHub → Vercel linkage | deployments | stale deploy (recoverable) | LOW |

**No F-class (broken) or H-class (dead) components found in the working tree.**
