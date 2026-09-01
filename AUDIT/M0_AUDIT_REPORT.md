# EAGLE EYE 2.0
# M0 TECHNICAL & CYBERSECURITY AUDIT

**Repository:** https://github.com/baiitax/eagle_eye (branch `main`, HEAD `15d077c`)
**Deployed:** https://eagle-eye-swart.vercel.app (verified live, HTTP 200 on `/`, `/admin`, `/api/health`)
**Audit date:** 2026-09-01 · **Method:** static forensic analysis + live read-only probes + fresh full test execution
**Scope discipline:** M0 is DISCOVERY ONLY. No application code was modified. All artifacts are under `/AUDIT` (uncommitted) plus one read-only extraction script `scripts/audit-extract.js`.

> **Evidence artifacts:** `AUDIT/appendices/api-inventory.md` (188 routes) · `AUDIT/appendices/authorization-matrix.md` · `AUDIT/appendices/component-inventory.md` · `AUDIT/evidence/forensic-greps.md` · `AUDIT/evidence/test-results.md`

---

## 1. EXECUTIVE SUMMARY

EAGLE EYE (branded EYES OF VICTORY in the application) is a **remarkably complete, working demonstration prototype** of an election-observation command ecosystem: public transparency domain, field-agent application, LG/Senatorial/Central situation rooms, supervisory verification, IReV reconciliation watchtower, SENTINEL security operations centre, and administration — 10 pages, 188 server routes, ~16,700 lines of client/server JavaScript, zero runtime dependencies, ~600 automated behavioural checks all green.

It is also, **by explicit design, a simulation**. Every election result, incident, SOS, agent, evidence image, IReV observation and every SENTINEL security metric is seeded fictional data. There is no production database, no real evidence storage, no real MFA, no offline-first field stack, no backups, no CI, and no monitoring. The architecture is a single Node.js process with an in-memory store snapshotted to a JSON file.

The platform's genuine assets are: a mature **workflow blueprint** (capture → validate → verify → reconcile → publish), a **real server-side RBAC model** (34 roles, verified with negative tests), strong **data-trust language policies** (never "fraud/rigging"; "RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED"), thoughtful **evidence-chain field design** (SHA-256, dual review, four-eyes corrections), and an unusually good **demo UX**.

**Verdict (preview): NOT PRODUCTION READY** — score **41/100** (details §34). This is a Category-A demo / design-validation asset, not an operational system. It could serve as the specification and UI foundation for a production build (roadmap §41), but deploying it as-is for a serious observation operation would fail on persistence, trust, auth, evidence and reliability grounds (§43).

---

## 2. SYSTEM MISSION

**Intended mission** (as implemented and labeled in-app): an independent, citizen-verifiable election-monitoring platform for the 2027 Kano State Governorship & Legislative elections, covering:

| Phase | Intended capability | Implemented state |
|---|---|---|
| PRE-ELECTION | observer management, training, assignments, geographic deployment, readiness | Simulated (seeded agents/devices/assignments; admin CRUD exists but operates on seed data) |
| ELECTION DAY | field observations, PU reporting, incidents, SOS, evidence capture, result-sheet observation, sync, command monitoring | Simulated engine (`server/lib/sim.js`) drives a scripted day at 30× speed; all flows work end-to-end on fictional data |
| POST-ELECTION | verification, reconciliation, investigation, evidence review, reporting, transparency | Simulated + structurally real: verification pipeline, IReV reconciliation, corrections centre, public API all function — over simulated records |

**Critical distinction:** the *workflows* exist and run; the *data* is fictional and there is **no path for real field data to enter the system** (no ingestion, no device connectivity, no storage tier). The UI correctly labels everything "DEMO DATA — NOT OFFICIAL ELECTION RESULTS" (48 label sites), which is the single most important trust control and must be preserved in any evolution of the platform.

---

## 3. CURRENT ARCHITECTURE

```
                    ┌─────────────────────────────────────────────┐
                    │        SINGLE NODE.JS PROCESS               │
   USER/UI  ──────► │  serveStatic (10 HTML pages + assets)        │
   (browser,        │  REST router (188 routes, regex matching)    │
    vanilla JS      │  business logic in route handlers            │
    SPA pages)      │  in-memory state store (store.js)            │
                    │  ── JSON snapshot → data/state.json (1.5s    │
                    │     debounce, full-file rewrite ~11 MB)      │
                    │  sim engine (1 s tick, 30× clock)            │
                    │  SSE broadcast (local mode only)             │
                    └───────────────┬─────────────────────────────┘
                                    │ Vercel adapter (api/index.js)
                                    ▼
                    serverless instance: boot() per warm instance,
                    state lives in RAM, lost on recycle; cold start
                    re-seeds deterministic demo baseline
```

**Layers observed:** frontend (per-page JS apps sharing `util/api/ui/map`), routing (server-side regex router), API (REST + SSE), business logic (route handlers + `server/lib/*` modules), storage (in-memory + JSON file). There is **no database tier, no queue, no cache, no object storage, no external service** other than the Vercel HTTP platform.

**Where it breaks the reference model:** everything from business logic to "database" collapses into one process; the JSON snapshot is the persistence tier; analytics/reconciliation compute on every request over the full in-memory dataset.

**Architecture rating: WEAK for production / GOOD for a single-purpose demo.** The monolith is legible, consistent and testable; it is not horizontally scalable, fault-tolerant, or secure-by-layering.

---

## 4. TECHNOLOGY STACK

| Technology | Version | Purpose | Risk | Upgrade needed |
|---|---|---|---|---|
| Node.js | ≥18 (tested v20.20.2) | runtime | maintained LTS | no |
| Vanilla JS SPA (per-page apps) | — | frontend | no framework security patches needed; but no component/test tooling | n/a |
| Custom SVG GIS + SVG charts | — | maps/analytics | hand-rolled; no rendering bugs found in tests | n/a |
| SQL (none at runtime) | — | — | n/a | n/a |
| PostgreSQL/PostGIS schema | `docs/schema.sql` | **target only, not wired** | false impression of a DB tier | implement (M3) |
| HTTP/SSE (Node `http`) | — | API + realtime | SSE disabled on Vercel; token-in-query (§30) | replace with WS + auth header (M7) |
| HMAC + scrypt (Node `crypto`) | — | auth | default signing secret hardcoded (§30 P0-01) | rotate + env-require |
| Vercel serverless adapter | `api/index.js` + `vercel.json` | hosting | stateless instances; cold-start reseed; no persistent state | keep for demo; prod on a long-lived platform |
| jsdom / puppeteer | /tmp harness (not shipped) | test tooling | outside repo; not reproducible in CI | move into repo devDeps (M1) |

**Dependencies:** zero npm runtime dependencies (deliberate). `npm audit` surface: none. This is simultaneously a strength (no supply-chain attack surface) and a weakness (no battle-tested libraries for auth/session/upload/crypto UX). **No dependency upgrades required; none exist.**

---

## 5. REPOSITORY INVENTORY

- **86 files** · server 444 KB · public 2.9 MB (incl. 1.4 MB logo source) · scripts 208 KB · data 13 MB (state snapshot, gitignored) · docs 3.5 MB (screenshots)
- **Git:** 4 commits, single branch `main`, all authored this session; no merges, no deleted-file archaeology, no dependency churn. History is clean but shallow — **no forensic value beyond the working tree**.
- **Secret scan (CONFIRMED):** no tokens/keys in working tree or history. **SECRET DETECTED — LOCATION REDACTED:** hardcoded default HMAC session secret in `server/lib/auth.js:9` (finding P0-01, §30). Demo credentials committed in `server/lib/seed.js` (documented demo accounts — E-class, acceptable for demo only).
- Marker greps: zero TODO/FIXME/HACK/PLACEHOLDER/FAKE/BYPASS/MOCK; 10 `DISABLED` feature flags (documented); console logging limited to boot lines server-side.

---

## 6. APPLICATION INVENTORY (A–I classification)

Classification key: **A** production-functional · **B** partially functional · **C** frontend simulation · **D** backend simulation · **E** hardcoded · **F** broken · **G** security risk · **H** dead · **I** missing. *(Full per-component table: `AUDIT/appendices/component-inventory.md`.)*

| # | Component | Location | State | Notes |
|---|---|---|---|---|
| 1 | Public Election Domain `/` | `public/index.html` | B/D | live stats from sim engine; real public APIs behind it |
| 2 | Secure sign-in `/login` | `public/login.html` + `api.js` | B/E | works incl. Vercel; demo-credential chips; MFA code displayed (demo) |
| 3 | Full Public Portal `/public` | `public/assets/js/pages/public.js` | B/D | observatory, corrections centre, open-data API |
| 4 | Field Agent App `/agent` | `pages/agent.js` (1,447 LOC) | B/C/D | full onboarding/wizard/SOS; capture simulated; offline queue = localStorage |
| 5 | LG Situation Room `/lg` | `pages/lg.js` | B/D | scoped views (Nasarawa demo) |
| 6 | Senatorial Command `/senatorial` | `pages/senatorial.js` | B/D | 6-role set, escalations |
| 7 | Central Situation Room 2.0 `/central` | `pages/central.js` | B/D | modes, health score, bottlenecks, IReV Watchtower |
| 8 | Supervisory Verification `/supervisor` | `pages/supervisor.js` | B | dual-control review over simulated EC8As |
| 9 | SENTINEL SOC `/sentinel` | `pages/sentinel.js` + `server/lib/sentinel.js` | **D** | entire telemetry simulated (SECURITY TRUST RISK §18) |
| 10 | Super Administration `/admin` | `pages/admin.js` | B/D/E | real CRUD flows over seed data; sim control |
| 11 | Mobile Command `/mobile` | `pages/central.js` (shared) | B | responsive shell |
| 12 | Docs `/docs/README.html` | — | A | accurate |

**No F-class (broken) or H-class (dead) components found.** Nothing is removed at this stage; several things are reclassified by production standards in §37.

---

## 7. ROUTE INVENTORY

**188 server routes** — 17 public (health, 15 `/api/public/*` endpoints, login) + 171 authenticated (including 60+ SENTINEL routes guarded by `secUser()`). Every non-public route performs an authentication check in its handler; permission checks are per-route via `auth.can()` or custom role guards. **No authenticated route was found without an authorization check.**

Pages: `/`, `/login`, `/agent`, `/lg`, `/senatorial`, `/central`, `/supervisor`, `/sentinel`, `/admin`, `/mobile`, `/public`, `/docs/README.html` (all served via extensionless fallback).

Verified behaviours (fresh test run): unauthenticated API access → 401; wrong-role access → 403 (e.g. agent → `/api/admin/users`, auditor → action requests, observer → SENTINEL); malformed IDs → 404; oversize body → 400 BODY_TOO_LARGE. Global API rate limit 600 req/min/IP; login 20/min/IP (in-memory — see AUTH-03, §30).

**Full table:** `AUDIT/appendices/api-inventory.md`.

---

## 8. API INVENTORY

Complete 188-route table with auth classification: `AUDIT/appendices/api-inventory.md`. Highlights:

| Area | Endpoints | Auth | Notable |
|---|---|---|---|
| Public data | `/api/public/{statistics,results,incidents,geo,updates,reconciliation,kpis,activity,wards,pus,search,corrections,reports,export,api-docs}` | public | aggregated only; no PII/agent GPS in payloads (verified by public-test 58 checks) |
| Auth | `/api/auth/{login,mfa,logout}`, `/api/me` | public / bearer | scrypt hashing; demo-MFA; HMAC-signed sessions |
| Operations | `/api/{results,incidents,sos,streams,agents,reviews,disputes,changes,messages,fieldReports,escalations,tasks,shifts,notifications}` | RBAC per route | all CRUD guarded; scoped overviews |
| Command | `/api/{lg,senatorial,central}/*` | RBAC | geographic scoping **bypassable** — finding AUTHZ-01 (§10) |
| IReV | `/api/irev/*` (status, dashboard, pending, reconciliation, matrix, latency, events, snapshots, pu, cases) | RBAC | simulated observations; hash-chained snapshots; two-person approval |
| SENTINEL | `/api/sentinel/*` (~60 routes) | `security.view/respond/privileged/audit` | action catalogue, approval/rollback, break-glass, audit |
| Admin | `/api/admin/{users,roles,devices,config,agents,elections,pus,changes,simulation,announcement}` | `admin.*` + superadmin | real CRUD over seed data |
| Exports | `/api/export`, `/api/public/export`, `/api/sentinel/logs/export` | RBAC | CSV/XLSX (hand-rolled XLSX in `lib/reports.js`) |
| Realtime | `/api/events` (SSE) | bearer token in query string | local mode only; 501 SSE_DISABLED on Vercel |

**API quality findings:** consistent JSON envelope (`{error, message}` / `{ok, ...}`); input validation is per-handler and uneven (strong on submissions/incidents, thin on some admin PATCHes — e.g. `PATCH /api/admin/config` accepts any keys); no response schema contract; no API versioning beyond fixed `v2.x` labels in SENTINEL telemetry; pagination exists on heavy lists but several endpoints return unbounded slices (capped at 200–400 rows). No mass-assignment protection needed (no ORM). **No information leakage observed in public payloads (verified).**

---

## 9. AUTHENTICATION AUDIT

**Login lifecycle (traced end-to-end):** credential check (scrypt, `timingSafeEqual`) → MFA challenge (6-digit code, **displayed in the UI — demo mode only**) → session token (HMAC-signed `userId.expiry.sig`) → stored in `localStorage` (safeStore wrapper with memory fallback) → `Authorization: Bearer` header on every request → server verifies signature/expiry and, failing that, falls back to the in-memory session map → logout clears client token (server session record persists to TTL).

| Control | State | Class |
|---|---|---|
| Password hashing | scrypt + per-user salt, timing-safe compare | **A** (real) |
| Password policy | none (demo PINs committed in seed.js) | **E** |
| MFA | code generated server-side but **displayed client-side**; no TOTP/WebAuthn/SMS | **C/E** |
| Session management | 12 h TTL, HMAC-signed stateless token + in-memory mirror; survives serverless cold starts (verified) | **B** |
| Refresh tokens / rotation | none | **I** |
| Cookies | none (bearer in localStorage — XSS-stealable) | **G** (accepted trade-off, see §30) |
| CSRF | API not cookie-authenticated → CSRF class N/A; XSS is the vector | n/a |
| Password reset | absent (Forgot-PIN shows a contact-support toast) | **I** |
| Account lockout | 5 failed logins → 5 min per-IP lock; MFA 3 attempts → challenge lock | **B** (per-IP, per-process) |
| Session revocation | none server-side (logout is client-only; stolen token valid until TTL) | **I** |
| Brute-force protection | per-IP rate limit 20/min (in-memory; resets per process/instance) | **B/G** |

**Findings:** AUTH-01 (P1) demo-only MFA — must be replaced with TOTP/WebAuthn; AUTH-02 (P2) no reset/revocation/refresh lifecycle; AUTH-03 (P2) rate limits are per-process in-memory — multi-instance or process-restart bypass; SEC-01 (P0) default session secret in source — tokens forgeable by anyone with repo access. No authentication bypass was found (tests: tampered tokens rejected 401, MFA replay locked, challenge expiry enforced).

---

## 10. AUTHORIZATION AUDIT

**Model:** 34 roles × 42 permissions, checked server-side per route (`auth.can(user, perm)`), never UI-only. Negative-path tests confirm enforcement (403s). Geographic scoping applied in overviews and LG/Senatorial evidence endpoints.

**Authorization Matrix** (condensed — full version `AUDIT/appendices/authorization-matrix.md`):

| Role | Results | Evidence | Incidents | Escalations | Admin users | Export | Approve (verify/override) |
|---|---|---|---|---|---|---|---|
| superadmin | RW | RW | RW | RW | RW | ✓ | ✓ |
| director | RW+override | R | RW | R | ✗ | ✓ | override |
| sencoord* | R (scoped) | R (scoped†) | RW | W | ✗ | ✗ | ✗ |
| lgsupervisor | R (scoped) | R (scoped†) | RW | W | ✗ | ✓ | ✗ |
| supervisor/reviewer | R | R | R | ✗ | ✗ | ✗ | verify (dual) |
| agent | submit own | own | create | ✗ | ✗ | ✗ | ✗ |
| observer | R | ✗ | R | ✗ | ✗ | ✗ | ✗ |
| auditor | R | R | R | ✗ | ✗ | ✗ | ✗ |
| pio | R | ✗ | R | ✗ | ✗ | ✗ | public.release |

† **AUTHZ-01 (P1, CONFIRMED):** `GET /api/lg/evidence` and `GET /api/senatorial/evidence` compute scope as `u.scope?.lga || url.searchParams.get('lga')` — a scoped user can **override their own scope via query parameter** and read other districts'/LGAs' evidence records (all roles with `evidence.view` and a scope are affected, e.g. `sencoord_c` reading Kano North). Fix: prefer the authenticated user's scope, allow the query override only for centrally-scoped roles. Location: `server/server.js` (routes `api/lg/evidence`, `api/senatorial/evidence`).

**Assessment:** strong RBAC foundation, one confirmed horizontal-access gap, no ownership-model (org-hierarchy design — appropriate for command systems), no vertical escalation paths found. Rating **GOOD** for demo, needs the AUTHZ-01 fix + geographic ABAC formalization for production.

---

## 11. DATABASE FORENSIC AUDIT

**Where data actually lives:** a single in-memory state object (`server/lib/store.js`) snapshotted to `data/state.json` (~11 MB) with a 1.5 s debounce and full-file synchronous rewrite; 5,000-entry audit cap, 800-entry event cap. `docs/schema.sql` (PostgreSQL/PostGIS) is a **design document with no runtime connection**.

| Entity | Storage | Relationships | Lifecycle |
|---|---|---|---|
| users / roles | in-memory (seeded) | roleId → roles | static seed; no CRUD at runtime (admin UI edits exist for users) |
| agents / devices / pus / wards / lgas | in-memory + `data/geo.json` (real geoBoundaries LGA shapes; wards/PUs generated) | nested ids | seeded; agent duty states advance via sim |
| submissions / evidence / incidents / sos / streams | in-memory | id-linked | sim-driven; state machine transitions |
| irev observations/cases | in-memory (irev.js) | per-PU | appended by sim/backfill |
| sentinel telemetry | in-memory (sentinel.js) | static arrays + drift | seeded each boot |
| audit | in-memory, capped | user-linked | unshift-only by convention |

**Findings (all CONFIRMED):** DB-01 (P0) no production database — crash/restart loses un-flushed writes; Vercel cold starts discard everything; DB-02 (P1) no transactions — multi-step writes (submission + evidence + audit) are not atomic; DB-03 (P2) unbounded growth of main collections (only audit/events capped); full-file 11 MB rewrite per save — write amplification; DB-04 (P2) no FK constraints/unique indexes — duplicates only prevented ad hoc in code (submission duplicate check exists and is tested). No SQL injection surface (no SQL). Race conditions: single-process synchronous handlers make in-process races unlikely; multi-instance races are unaddressed (Vercel).

---

## 12. EVIDENCE AUDIT

**Current mechanism:** the field app *simulates* photographing an EC8A; a canvas-drawn fictional document is converted to a data-URL PNG, hashed with SHA-256 over the data-URL string, and stored **in memory** alongside the submission (`sha256`, `chain`, `capturedAt` fields). Verification/dual-review/comparison flows operate on these simulated artifacts.

| Requirement | State | Class |
|---|---|---|
| Capture (image/video/document) | simulated canvas rendering; no camera/file input | **C** |
| Storage | in-memory + JSON snapshot; no object storage | **D** |
| Metadata (time/GPS/device) | present on submission; device-linked (deviceId) | **B** (sim data) |
| Hashing | SHA-256 computed and displayed end-to-end (over simulated bytes) | **B** (real crypto, fake input) |
| Timestamps | WAT-formatted sim clock | **B** |
| Chain of custody | audit entries + status transitions + reviewer identities | **B** (in-memory) |
| Access control | RBAC on evidence views; perms verified | **A** |
| Retention | `retentionDays` config exists, **not enforced anywhere** | **E/I** |
| Encryption at rest | **none** (grep: no cipher usage) | **I** |
| Download/export | RBAC-gated; audit recorded | **B** |

**Direct answer to §13's question:** *Can the current system prove an evidence object has not been altered?* — **NO.** Hashes are real but computed over simulated in-memory artifacts; there is no WORM storage, no independent verification anchor, no signing, and the entire store can be rewritten by a crash or a cold start. **CRITICAL GAP — EVID-01 (P1).** The required production model is designed in §39 (capture → local encrypt → hash → upload → server validation → object storage → chain of custody → verification → audit).

---

## 13. OBSERVATION AUDIT

Observations (result submissions) are: persisted (in-memory/file), **versioned via a corrections workflow** (`PENDING_APPROVAL → four-eyes approve → version++`, tested), attributable (agentId + deviceId), timestamped (sim WAT), geographically linked (PU→ward→LGA→senatorial), device-linked, and audited. Status machine: UNVERIFIED → SUBMITTED → UNDER REVIEW → VERIFIED / REJECTED / DISPUTED → ARCHIVED, with validation anomalies phrased as "DATA ANOMALY DETECTED / REQUIRES HUMAN REVIEW" (never accusations). Conditional logic and evidence requirements exist in the wizard. **All of it operates on simulated submissions** — the *mechanics* are Category B; the *substrate* is Category D.

**Immutability caveat:** no write-once guarantee; verified submissions can be corrected via the approval workflow (legitimate) and the underlying store can be rewritten wholesale (not legitimate). No cryptographic anchoring (hash chains exist per-evidence but are not persisted to an external ledger).

---

## 14. FIELD / OFFLINE CAPABILITY AUDIT

| Capability | State | Evidence |
|---|---|---|
| Service worker | **absent** | 0 matches |
| IndexedDB / local DB | **absent** | 0 matches |
| Offline queue | localStorage-backed (safeStore) with retry counts; in-memory fallback | agent.js sync centre |
| Local encryption | **absent** | — |
| Conflict resolution | absent (last-write-wins) | — |
| Idempotency | duplicate-submission guard exists **server-side** (fingerprint check) | tested |

**Answer to §17:** *Can an observer collect observations for several hours offline and synchronize safely later?* — **NO.** A browser tab holding a localStorage queue can re-send queued submissions after reconnecting (demo-level), but there is no durable offline store, no local encryption, no robust conflict handling, and re-submission semantics depend on in-memory state surviving. **ELECTION-DAY CRITICAL GAP — OFFLINE-01 (P1).** Target model designed in §40.

---

## 15. DEVICE TRUST AUDIT

Devices are: uniquely identified (IMEI + id), registered, assigned to an agent, revocable (status field + admin endpoint), and "health checked" (simulated security centre). **Missing:** cryptographic device identity (no attestation/certificates), no pinning of device↔account, no risk scoring, no multi-device policy, no real endpoint telemetry. Device spoofing/stolen-device risk is **unmitigated** — the demo's device verification step is a UI checklist, not a trust mechanism. Class **C/D**. Target model in §39.

---

## 16. INCIDENT MANAGEMENT AUDIT

Two incident systems exist:
1. **Field/operations incidents** (INC-2027-…): category/subcategory grid, severity LEVEL 1–5, status machine NEW → ACKNOWLEDGED → INVESTIGATING → ESCALATED → RESOLVED/CLOSED, updates log, SOS hold-to-activate escalation chain (AGENT → LG → SENATORIAL → CENTRAL) — all real mechanics on simulated events. **Class B.**
2. **SENTINEL security cases** (SEC-2027-…): 9-step workflow DETECTED → TRIAGED → ASSIGNED → INVESTIGATING → CONTAINMENT → ERADICATION → RECOVERY → VALIDATION → CLOSED, with evidence, related alerts/events, communications, playbooks (11), timeline. Mechanics real; every case is seeded fiction. **Class D.**

Both enforce workflow order (back-stepping rejected — tested). Incident coverage of the required conceptual states: complete (CONTAINED≈CONTAINMENT, VERIFIED≈VALIDATION).

---

## 17. IReV / PUBLIC-SOURCE MODULE AUDIT

**Reality check: the entire IReV Watchtower is simulated.** `server/lib/irev.js` generates fictional IReV observations for seeded PUs and reconciles them against simulated field submissions. There is **no connection to any real public portal, no polling, no network calls at all**.

What is genuinely implemented (on simulated data): per-PU immutable-by-convention snapshot archive with SHA-256 doc/value hashes and source-method recording (OFFICIAL API / OFFICIAL FEED / AUTHORIZED EXPORT / PUBLIC IReV OBSERVATION), three-way reconciliation (FIELD ↔ EOV ↔ IReV) with statuses incl. "RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED", change-detection with deduplicated alerts and EV-DIFF case files, two-person approval for CRITICAL / possible-result-change classifications, source-outage logic that suspends disappearance detection, coverage matrix and latency stats. Verified by 69 test checks. **Class: D (data) / B (mechanics).**

The module's careful-language policy is exemplary and must be retained verbatim in any production build. No unauthorized-access pattern exists anywhere in the code (verified by review) — the spec constraint "do not attempt to penetrate INEC infrastructure" is honoured architecturally (simulation only).

---

## 18. SENTINEL AUDIT

**SECURITY TRUST RISK — CONFIRMED.** Every number on the SENTINEL SOC dashboard (14 nodes' CPU/RAM/disk, 12 APIs' traffic, threat feeds, vulnerabilities, WAF counters, TLS certificates, "12,482 security events", posture 96/100, threat level GUARDED) is **seeded fictional telemetry** from `server/lib/sentinel.js` with a drift function, computed by deterministic rules over that fiction. Classification per metric:

| Metric group | Classification |
|---|---|
| Node/API/network/db/evidence/IReV/WAF metrics | **SIMULATED** (seeded arrays + random drift) |
| Threat level / posture | **CALCULATED** (real rules — over simulated inputs) |
| Case workflow, action catalogue, approvals, break-glass, audit | **CALCULATED/functional** (real mechanics, simulated events) |
| KPIs (MTTD etc.) | **CALCULATED** (over simulated case timelines) |
| Anything "LIVE" | **UNKNOWN/NONE** (no collectors exist) |

A production SOC must never present simulated telemetry as real — today the demo banner mitigates, but the component is a **design prototype, not a security product** (finding SENT-01, P1). The privileged-action control design (request → approve → execute-with-BEFORE/AFTER → rollback; dual authorization for CRITICAL; break-glass with expiry) is genuinely good and worth porting to a real telemetry backend.

---

## 19. ANALYTICS AUDIT

All charts are **CALCULATED from simulated data**. The mathematics (percentages, aggregates, sparklines, stacked bars) were reviewed and are correct on their inputs; denominators use guards against divide-by-zero; the WAT (Africa/Lagos) timezone helpers are applied consistently. Caveats: charts mix the **accelerated simulation clock** (30×) with wall-clock labels; aggregation is per-request over the full dataset (no materialized views); the public KPIs recompute live but their source rows are fictional. **No misleading math found; the misleading part is the fictional substrate, which the UI labels.** Class **D** data / **B** computation.

---

## 20. AI / COPILOT AUDIT

**No AI model exists.** The Copilot is a rule-based, regex-intent engine over live system records (`server/lib/copilot.js`, `server/lib/sentinel.js`), with provenance-labelled answer sections (FACT / VERIFIED_DATA / DERIVED_DATA / SYSTEM_INFERENCE / HUMAN_ASSESSMENT). Audit trail: every query writes an audit entry. **No capability to modify anything** — the "Block this source" intent returns a proposal with APPROVE/REJECT (verified by tests; execution requires the standard approval chain). Verdict: safe, honest, and the answer-schema is a good contract for a future grounded LLM. Class **B**.

---

## 21. PRIVACY AUDIT

**Personal data present:** 40 demo persona names/phones (fictional), agent roster (1,300+ generated names/phones), device IMEIs, agent GPS coordinates, session IPs. **Public exposure: none found** — the public API emits aggregated counts only; geography endpoint excludes agent locations (verified by public-test). Access control: authenticated roles see scoped data (with the AUTHZ-01 exception). **Retention: configured but unenforced** (finding PRIV-01, P2). No encryption of PII at rest; no data-subject/access-review tooling. For a real deployment: PIA required; fictional seed data must be replaced by vetted demo personas (already fictional — low risk).

---

## 22. INFRASTRUCTURE AUDIT

Local mode: single Node process, all state in RAM + JSON file. Vercel mode: serverless instances, boot-per-warm-instance, deterministic reseed on cold start, SSE disabled, assets cached 5 min. **No queue, cache, database, object storage, CDN controls, secrets manager, or monitoring.** The "infrastructure" is one process; the critical-dependency map is correspondingly flat: everything depends on the process and the JSON file (§27).

---

## 23. DEPLOYMENT AUDIT

**Works today:** Vercel serves `/`, `/login`, `/admin`, APIs (verified live, HTTP 200); local `node server/server.js` fully functional; serverless adapter handles signed sessions across cold starts (verified). **Gaps:** no staging/preview separation discipline (single project), no environment variables defined on Vercel (SESSION_SECRET falls back to the committed default — **the deployed app runs the known default key**), no database migrations (no database), no rollback beyond git redeploy, no canary/feature flags. Rating **ACCEPTABLE for demo, WEAK for production**.

---

## 24. CI/CD AUDIT

**None.** No lint, typecheck, unit/integration gates, SAST, DAST, dependency or secret scanning, build verification. Tests are manual scripts run ad hoc (documented in README). Every quality property currently demonstrated is held together by convention, not by pipeline. Finding CI-01 (P3→P1 when production starts).

---

## 25. TESTING AUDIT

**~600 automated behavioural checks across 12 scripted suites, all green** (evidence: `AUDIT/evidence/test-results.md`). Coverage is genuinely broad for a demo: RBAC negatives, dual control, MFA failure paths, offline/storage-blocked scenarios, corrections, escalations, SENTINEL action lifecycle, serverless cold starts, public-PII safety. **Missing:** unit tests for pure logic (validation, hash chains, permission matrix), property/fuzz tests, mobile-device tests, load/soak tests, and any CI to run them. **Critical workflows with zero tests:** real-media evidence capture (doesn't exist), backup/restore (doesn't exist), account recovery (doesn't exist). Rating **GOOD for prototype scope**.

---

## 26. PERFORMANCE AUDIT

Observed: 84 ms average API response (local), state JSON ~11 MB, `overview` payload computed per request (44 LGAs / 1,476 PUs — fine), SVG chart/map rendering client-side (no heavy libs), total JS shipped ≈ 1 MB across pages (per-page ~30–150 KB) — acceptable for demo. **Risks at scale:** full-file synchronous JSON rewrite per save (write amplification; blocks event loop at multi-MB scale), unbounded in-memory growth of uncapped collections, per-request aggregation over full datasets, SSE fan-out per event in local mode. No image processing (images simulated). Rating **ACCEPTABLE now; will degrade sharply past ~10× current simulated load**.

---

## 27. RELIABILITY AUDIT

**Single points of failure:** the process itself, the JSON snapshot, the (unset) SESSION_SECRET default, the GitHub-linked Vercel project. **Failure modes:** process crash → last ≤1.5 s of writes lost (local) / everything lost (Vercel recycle); file corruption → boot silently falls back to fresh seed (data loss without alert); sim clock runs to day-end and pauses (by design); SSE client map unbounded per process. No retries/queues for writes, no health checks beyond `/api/health` (which reports static HEALTHY strings — itself simulated). Rating **WEAK**. Critical-dependency map in `AUDIT/appendices/component-inventory.md`.

---

## 28. DISASTER RECOVERY AUDIT

**Direct answer:** *If the production database is destroyed today, how quickly can Eagle Eye recover?* — **There is no production database, and no backup of any kind.** Local state is a single gitignored JSON file; Vercel state is RAM. Worst case: the entire operational record vanishes on the next cold start — the system silently re-seeds the fictional baseline. Recovery time: instant, because **nothing real is stored** — which is precisely the point: for a real operation this is **CRITICAL UNKNOWN / ABSENT — DR-01 (P1)**. No restore test exists; SENTINEL's "Recovery Centre" is simulated fiction.

---

## 29. THREAT MODEL (defensive assessment)

**Assets:** identities (40 demo accounts), observations (simulated), evidence (simulated artifacts + real hashes), reports, device identities, credentials (scrypt-hashed), session tokens, audit logs, operational communications, public trust.

**Threats & current posture:**

| Threat actor | Attack path | Current exposure | Rating |
|---|---|---|---|
| External attacker | Forged session token (known default secret) | **CONFIRMED possible** — signing key committed in source | CRITICAL |
| External attacker | Auth brute force | per-IP lockout + rate limit (in-memory) | MEDIUM |
| External attacker | Public API abuse / DDoS | 600 req/min/IP in-memory limiter; Vercel platform absorbs basics | MEDIUM |
| External attacker | XSS → token theft | output escaping is thorough; **no CSP** as backstop | LOW–MEDIUM |
| External attacker | Path traversal / injection | guarded (normalize check); no SQL/shell | LOW |
| Compromised observer | Cross-scope data access | **AUTHZ-01 scope bypass confirmed** | HIGH |
| Compromised admin | Unrestricted write (RBAC-granted) | inherent to design; mitigated by audit + dual approval (SENTINEL) | MEDIUM |
| Malicious insider | Audit tampering | audit is append-by-convention in RAM — not cryptographically protected | MEDIUM |
| Stolen device | Account takeover | no device trust/attestation; demo MFA | HIGH |
| Evidence tampering | Rewrite JSON store / memory | trivial today — no WORM, no signing | CRITICAL |
| Misinformation | Simulated data mistaken for real | mitigated by 48 demo labels; must survive refactor | MEDIUM |
| Infrastructure failure | Process/instance loss | total state loss; no DR | CRITICAL |

(No exploit instructions for real election systems are included; this is a defensive assessment of this repository only.)

---

## 30. SECURITY FINDINGS (consolidated, §58 format)

**P0-01 — SEC-01 · Hardcoded default session-signing secret · CONFIRMED**
- **Location:** `server/lib/auth.js:9` (SECRET DETECTED — LOCATION REDACTED in detail; value not reproduced here)
- **Observation:** HMAC session secret falls back to a committed string when `SESSION_SECRET` env is unset; the deployed Vercel project sets no env var → **the live deployment runs the publicly-known key**.
- **Impact:** anyone with repo access can forge valid session tokens for any user (including superadmin).
- **Exploitability:** trivial (sign `userId.expiry` with the known key).
- **Recommendation:** rotate immediately; require the env var (fail closed); use a secrets manager; regenerate all tokens.

**P0-02 — DATA-01 · Entire data substrate is simulated · CONFIRMED (by design)**
- **Location:** `server/lib/{sim,irev,sentinel,seed}.js` + `data/geo.json`
- **Observation:** every operational figure is seeded fiction; no real-data ingestion path exists.
- **Impact:** platform cannot produce operational value as-is; only its workflows are real.
- **Recommendation:** keep as demo; build ingestion + persistence (M3/M4/M6) before any operational use.

**P0-03 — DB-01 · No production database · CONFIRMED**
- **Location:** `server/lib/store.js` (in-memory + JSON snapshot)
- **Impact:** data loss on crash/recycle; no transactions/constraints/backups.
- **Recommendation:** PostgreSQL/PostGIS per `docs/schema.sql` (already drafted) — see §39.

**P1-01 — AUTHZ-01 · Geographic scope bypass via query parameter · CONFIRMED**
- **Location:** `server/server.js` routes `api/lg/evidence`, `api/senatorial/evidence`
- **Evidence:** scope = `u.scope?.lga || url.searchParams.get('lga')` — scoped roles can pass another LGA/district.
- **Impact:** horizontal access violation across districts (e.g. `sencoord_c` reading Kano North evidence).
- **Exploitability:** trivial (one query param, no special tools).
- **Recommendation:** use the authenticated scope; allow overrides only for unscoped (central) roles; add regression test.

**P1-02 — AUTH-01 · MFA is demonstration-only · CONFIRMED**
- **Location:** `server/lib/auth.js` (`mfaCode` returned to client), `public/assets/js/api.js`
- **Impact:** the second factor provides zero security in production terms.
- **Recommendation:** TOTP (RFC 6238) or WebAuthn; keep the demo path behind `demoMode`.

**P1-03 — EVID-01 · No defensible evidence architecture · CONFIRMED**
- **Location:** evidence = simulated data-URL images hashed in memory (`server/server.js` evidence routes)
- **Impact:** cannot prove non-alteration; no WORM storage, encryption, or signing (see §12).
- **Recommendation:** target model §39.

**P1-04 — OFFLINE-01 · No offline-first field capability · CONFIRMED**
- **Location:** `public/assets/js/pages/agent.js` (localStorage queue only)
- **Impact:** election-day field data loss on weak networks; no encrypted local store, no idempotency.
- **Recommendation:** target model §40.

**P1-05 — HDRS-01 · No security headers · CONFIRMED**
- **Location:** `server/server.js` response helpers (Content-Type/Cache-Control only)
- **Impact:** clickjacking, MIME sniffing, no CSP backstop for XSS.
- **Recommendation:** CSP (nonce-based for inline scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, frame-ancestors (note: the platform is intentionally embedded in sandboxed preview iframes — configure per environment).

**P1-06 — SENT-01 · SENTINEL telemetry fully simulated · CONFIRMED**
- **Location:** `server/lib/sentinel.js` (seeded arrays + drift)
- **Impact:** a SOC displaying fictional telemetry erodes security trust if ever mistaken for real.
- **Recommendation:** keep as demo only; production SENTINEL must ingest real collectors (M8).

**P1-07 — DR-01 · No backups / disaster recovery · CONFIRMED** — see §28.

**P2 findings:** AUTH-02 (no password reset / session revocation / refresh lifecycle) · AUTH-03 (per-process rate limits) · SSE-01 (token in query string + `Access-Control-Allow-Origin: *` on the SSE endpoint, local mode) · SEC-02 (demo credentials committed — acceptable for demo, forbidden for production) · PRIV-01 (`retentionDays` unenforced) · DB-02/03/04 (no transactions, uncapped growth, no constraints).

**P3 findings:** CI-01 (no CI/CD/SAST/secret-scan) · XSS-01 (no CSP backstop; escaping itself is consistently applied) · UPLOAD-01 (base64 evidence in JSON; 12 MB cap; no MIME/AV scanning; no signed URLs) · OBS-01 (console-only logging; no levels/shipping/alerting).

**Explicitly checked and NOT found (avoiding overstatement):** no SQL/command injection surface, no SSRF, no open redirects, no deserialization sinks, no committed secrets in history, no broken or dead components, no authentication bypass, no copilot destructive capability.

---

## 31. DATA INTEGRITY FINDINGS

- Every dashboard statistic can be traced to a record (seed/sim → store → route → UI) — the trace exists, but the origin is simulation (SOURCE=SEED, TIMESTAMP=sim clock). §40-style data-trust labels exist only as global demo banners; **per-figure provenance is not rendered** (the public portal shows source/status/last-updated per block — good; internal dashboards do not).
- Correction workflow is versioned + four-eyes (real, tested). IReV snapshots hash-chained (real crypto, fictional payloads).
- **No cryptographic anchoring to any external trust anchor** (no ledger, no WORM, no signing) — the single weakest integrity property for production.
- Timezone handling is correct (WAT); the accelerated sim clock must never be presented as wall-clock in production (flag).

---

## 32. UX FINDINGS

Scored 1–5 (1 critical → 5 excellent): Discoverability **4** (coherent nav, demo chips) · Clarity **4** (dense but labeled) · Speed **4** (zero-dependency frontend, fast local) · Error recovery **4** (boot-failure recovery screens, retries, safe storage) · Accessibility **2** (no audited ARIA/focus/contrast work; icon+color status pairs exist) · Mobile usability **3** (agent app mobile-first; dashboards responsive but information-dense) · Consistency **4** (glassmorphism system, shared shell). Known friction: 5-step result wizard is intentionally heavyweight (correct for evidence discipline); OTP flow is demo-simplified; no reduced-motion gaps found (respected). **UX is the platform's strongest production asset** — retain the design system.

---

## 33. OPERATIONAL FINDINGS (§41/§42)

**Questions leadership could answer with this build:** COVERAGE (ward/LGA coverage matrices — over simulated agents) ✓ · BLIND SPOTS (missing submissions/PU lists) ✓ · INCIDENTS (live feeds, escalation chains) ✓ · EVIDENCE (evidence centres with hashes) ✓ (simulated artifacts) · VERIFICATION (review queues, dual control) ✓ · SECURITY (SENTINEL — simulated, ⚠) · SYSTEM HEALTH (component health strips — partly simulated) ⚠ · RESPONSE (tasks, shifts, communications) ✓.

**Decision loop (OBSERVE→VALIDATE→VERIFY→ANALYZE→PRIORITIZE→ESCALATE→RESPOND→RECORD→REPORT):** structurally complete and demonstrable end-to-end on simulated data — the loop's *mechanics* are the product's core value. The broken links are all substrate links (real field ingress, real persistence, real telemetry), not workflow links.

---

## 34. PRODUCTION READINESS SCORE

Category weights per the audit brief (sum 105; normalized to 100).

| Category | Max | Earned | Rationale |
|---|---|---|---|
| Architecture | 10 | 4 | legible monolith, single process, no service boundaries |
| Security | 15 | 4 | good RBAC & escaping; default secret, no headers, simulated SOC |
| Authentication | 10 | 4 | scrypt + signed tokens; demo MFA, no lifecycle (reset/revoke) |
| Authorization | 10 | 6 | real server-side RBAC, tested; one confirmed scope bypass |
| Data integrity | 10 | 5 | hashes/corrections real over fictional data; no anchoring |
| Evidence | 10 | 3 | simulated capture; in-memory storage; no encryption/WORM |
| Field / offline | 10 | 3 | localStorage queue only; no SW/IDB/encryption |
| Reliability | 10 | 2 | single process; no DR; total state loss on recycle |
| Testing | 5 | 3 | ~600 checks, no CI/unit/load/security automation |
| Observability | 5 | 2 | audit trail in RAM; console logs; no metrics/alerting |
| Deployment | 5 | 3 | Vercel works (verified); no staging/secrets/migrations |
| UX | 5 | 4 | strong demo UX; accessibility gaps |
| **Total** | **105** | **43** | **→ 41 / 100** |

---

## 35. RED / AMBER / GREEN MATRIX

| Domain | Status | Basis |
|---|---|---|
| Workflow design & decision loops | 🟢 GREEN | complete, tested, exemplary policies |
| RBAC & permission model | 🟢 GREEN (demo) | server-enforced, negative-tested; fix AUTHZ-01 |
| Public transparency layer | 🟢 GREEN (demo) | PII-safe, labeled, open-data API |
| UX / design system | 🟢 GREEN (demo) | polished, consistent |
| Authentication | 🟡 AMBER | real hashing/sessions; demo MFA, missing lifecycle |
| Deployment (Vercel) | 🟡 AMBER | works; stateless, unset secret env, no staging |
| Persistence / database | 🔴 RED | in-memory + JSON snapshot |
| Evidence architecture | 🔴 RED | simulated artifacts, no WORM/encryption |
| Field / offline | 🔴 RED | no durable offline capability |
| SENTINEL telemetry | 🔴 RED (as product) | fully simulated |
| DR / backups | 🔴 RED | absent |
| CI/CD & security automation | 🔴 RED | absent |

---

## 36. GAP REGISTER (top items; full register in appendices)

| ID | Gap | Category | Severity | Evidence | Impact | Recommended fix | Effort | Phase |
|---|---|---|---|---|---|---|---|---|
| SEC-01 | Default session secret committed | Crypto | **P0** | auth.js:9 | token forgery | env-required secret + rotation | S | M2 |
| DATA-01 | Simulated data substrate | Data | **P0** | sim/irev/sentinel/seed | no operational value | ingestion + real persistence | XL | M3–M6 |
| DB-01 | No production database | Data | **P0** | store.js | data loss | PostgreSQL per schema.sql | L | M3 |
| AUTHZ-01 | Scope bypass on evidence APIs | Authz | **P1** | server.js lg/senatorial evidence routes | cross-district reads | scope-first logic + test | XS | M2 |
| AUTH-01 | Demo-only MFA | Auth | **P1** | auth.js mfaCode to client | no second factor | TOTP/WebAuthn | M | M2 |
| EVID-01 | No defensible evidence chain | Evidence | **P1** | §12 | can't prove integrity | WORM storage + signing | L | M4 |
| OFFLINE-01 | No offline-first field stack | Field | **P1** | §14 | field data loss | SW + IndexedDB + crypto | L | M5 |
| HDRS-01 | No security headers | Security | **P1** | §23/evidence | clickjack/sniff/XSS | header middleware + CSP | S | M2 |
| SENT-01 | Simulated SOC telemetry | Security | **P1** | sentinel.js | trust risk | real collectors | XL | M8 |
| DR-01 | No backups/DR | Reliability | **P1** | §28 | total loss | managed DB backups + RTO test | M | M11 |
| AUTH-02/03 | No auth lifecycle; per-process limits | Auth | P2 | §9 | session abuse | revoke list, refresh, central limiter | M | M2/M11 |
| PRIV-01 | Retention unenforced | Privacy | P2 | config.retentionDays | over-retention | retention job | S | M3 |
| CI-01 | No CI/CD/SAST/secret scan | Quality | P3 | §24 | regression risk | pipeline + scanners | M | M1 |

Effort: XS <1d · S 1–3d · M 1–2w · L 3–6w · XL 6w+.

---

## 37. RETAIN / REFACTOR / REBUILD MATRIX

| Module | Decision | Reason |
|---|---|---|
| Design system (glassmorphism, theme.css) | **RETAIN** | polished, consistent, low-dependency |
| Page shells / preloaders / branding | **RETAIN** | works everywhere, incl. sandboxed iframes |
| RBAC model + permission catalog | **RETAIN** (extend) | server-enforced, tested; add ABAC attrs |
| Careful-language policies (IReV, anomalies, corrections) | **RETAIN verbatim** | the platform's core trust contract |
| Workflow state machines (submission, incident, security cases) | **RETAIN** | complete, order-enforced, tested |
| Audit trail design | **RETAIN** (re-home) | move to append-only DB table + hash chaining |
| Test suites (12, ~600 checks) | **RETAIN** | regression harness; promote into CI |
| Auth core (scrypt, signed sessions, lockout) | **REFACTOR** | real MFA, secret from vault, revocation, refresh |
| Storage layer (store.js) | **REBUILD** | PostgreSQL/PostGIS per schema.sql; repository layer |
| Evidence pipeline | **REBUILD** | real capture → client hash → upload → object storage → WORM → chain |
| Field offline stack | **REBUILD** | service worker + IndexedDB + local encryption + idempotent sync |
| SENTINEL engine | **REBUILD** | real collectors/telemetry; keep the action/approval design |
| Sim engine | **DEFER → test-fixture** | keep as deterministic test fixture; remove from production path |
| Analytics | **REFACTOR** | materialized aggregates; real provenance per figure |
| Copilot | **REFACTOR** | keep contract; optional grounded LLM with same guardrails |
| Public portal | **RETAIN** (re-wire) | UI kept; data becomes real verified records |
| Vercel adapter | **DEFER** | fine for demo; production on managed platform + Postgres |

---

## 38. TARGET ARCHITECTURE (design only — no implementation in M0)

```
        OBSERVERS (PWA)                 COMMAND (Web)                PUBLIC (Web)
              │                              │                            │
              ▼                              ▼                            ▼
   ┌────────────────────────── API GATEWAY / WAF (rate limit, JWT validation) ──────────┐
   │        Auth service (TOTP/WebAuthn, sessions, revocation, device trust)             │
   │        Application services:                                                        │
   │          observations · incidents · SOS · verification · reconciliation            │
   │          reports · notifications · admin                                            │
   │        Realtime gateway (WebSocket, presence, fan-out)                              │
   │        Queue workers (evidence hashing/thumbnails, notifications, exports)          │
   └──────────────┬────────────────┬───────────────────┬────────────────────────────────┘
                  ▼                ▼                   ▼
        PostgreSQL/PostGIS   Object storage (WORM)   Redis (cache/queues)
        (source of truth,    (encrypted evidence,    (+ blob/metadata store)
         append-only audit,   signed objects, CDN)
         materialized views)
                  │                │                   │
                  ▼                ▼                   ▼
        Secrets manager · Metrics/OTel · Central logging · SOC (real telemetry)
```

Principles: stateless app tier; Postgres as the single source of truth; object storage with server-side encryption + object lock (WORM) for evidence; per-figure provenance; every privileged action in the append-only audit; environment parity between staging and production.

---

## 39. TARGET DATA ARCHITECTURE (design only)

Core entities (mapped to the existing `docs/schema.sql` draft + deltas):
`users` · `roles` · `role_permissions` · `elections` · `geography(lgas/wards/pus)` · `agents` · `assignments` · `devices` · `observations` (immutable) · `observation_revisions` (correction workflow) · `evidence_objects` (key, sha256, mime, size, captured_at, gps, device_id, chain_id) · `evidence_chain_events` (append-only, hash-linked) · `verification_decisions` (reviewer, decision, reason, timestamps) · `incidents` + `incident_updates` · `reconciliation_snapshots` (per-PU, hash-chained, source_method) · `reconciliation_cases` · `audit_log` (append-only) · `security_actions` (request→approval→execution→rollback) · `reports`/`releases` · `sync_outbox/inbox` (idempotency keys).

Properties: FK constraints, unique indexes (idempotency, duplicates), partial indexes for active rows, row-level provenance columns (source, captured_by, captured_at, verification status), timezone-safe UTC + WAT presentation, retention jobs, encrypted PII columns, logical backups + PITR.

---

## 40. TARGET SECURITY MODEL (design only)

RBAC retained + **geographic ABAC** (role × district/LGA attributes enforced server-side, scope-override bug pattern eliminated) · TOTP/WebAuthn MFA · device trust (registered device + risk scoring + revocation) · secrets in a vault (never in code/env defaults; fail closed) · HMAC-signed short-lived access tokens + refresh rotation + server-side revocation list · central rate limiting (Redis) with per-route budgets · WAF + CDN · CSP/HSTS/nosniff/Referrer/Permissions/frame policies per environment · immutable audit (append-only table + periodic hash anchoring) · evidence: client-side capture hash → TLS upload → server re-hash → S3 SSE-KMS + object lock → chain of custody events · incident response runbooks (already designed in SENTINEL playbooks) · real SOC telemetry (collectors → SIEM).

---

## 41. TRANSFORMATION ROADMAP (for authorization — M0 ends here)

| Phase | Objective | Key dependencies | Deliverables | Acceptance criteria | Complexity |
|---|---|---|---|---|---|
| M1 Foundation | repo hygiene, CI, env parity | git | lint+typecheck+tests in CI, secret scanning, staging env | pipeline green on every PR; secrets scanned | S |
| M2 Identity & Access | real MFA, revocation, ABAC | vault, TOTP lib | auth service v2, AUTHZ-01 fix, scope tests | MFA enforced; scope bypass regression test passes | M |
| M3 Database | Postgres + migrations + retention | managed DB | schema v1, repository layer, backups | data survives restarts; PITR demo | L |
| M4 Evidence | capture→hash→upload→WORM→chain | object storage | evidence pipeline + verification UI | hash mismatch detected end-to-end; chain complete | L |
| M5 Field/Offline | PWA offline capture + encrypted queue + idempotent sync | M3/M4 | field app v2 | 4h offline → sync → no dupes, verified test | L |
| M6 Verification | dual control over real records | M3/M4 | verification service | two-person approval on live data | M |
| M7 Command | realtime WS, queues, notifications | Redis, WS GW | command centre v2 | live updates < 2 s at 1k agents | M |
| M8 SENTINEL | real telemetry collectors + SIEM | monitoring stack | SOC v1 (real metrics) | every metric traceable to a collector | XL |
| M9 Analytics | materialized aggregates + provenance | M3 | analytics service | per-figure SOURCE/QUERY/TIMESTAMP rendered | M |
| M10 Public Transparency | verified-record publishing + corrections centre on live data | M3/M6 | public portal v2 | PII-safe, traceable, corrections audited | M |
| M11 Security & Resilience | pen test, load test, DR drills, chaos | M2–M8 | hardening report + runbooks | M11 gate (§42) passes | L |
| M12 Production | pilot operation, training, cutover | all | production deployment + SOPs | M12 gate (§42) passes | M |

---

## 42. MILESTONE GATES

**M2 PASS:** MFA enforced for all roles · RBAC + ABAC tested · session lifecycle complete (revocation/refresh) · privileged actions audited · AUTHZ-01 regression green.
**M3 PASS:** all data survives process restarts · migrations reproducible · backup restore tested · retention jobs run.
**M4 PASS:** evidence hashed client+server · encrypted at rest · WORM enabled · chain-of-custody complete on a tamper test.
**M5 PASS:** observer workflow functions offline ≥4 h · sync idempotent (zero duplicates) · local store encrypted.
**M11 PASS:** penetration test with no P0/P1 findings · load test at target observer scale · backup restore drill · chaos test (DB/object-store/WS failures) documented.
**M12 PASS:** pilot election simulation with real observers · public portal serves verified records only · SOC shows real telemetry · DR runbook executed.

---

## 43. PRODUCTION ACCEPTANCE CRITERIA (summary)

1. No committed secrets; all keys from a vault; session tokens unforgeable.
2. Every data record real, attributable, timestamped (wall-clock + WAT), traceable to source.
3. Every dashboard figure renders SOURCE · QUERY · TRANSFORMATION · TIMESTAMP · VERIFICATION.
4. Evidence chain end-to-end provable (capture hash → WORM store → custody events).
5. Authorization (RBAC+ABAC) tested at API layer incl. cross-scope negatives.
6. Field operations degrade gracefully offline.
7. DR: RPO ≤ 5 min, RTO ≤ 1 h, restore drill executed.
8. CI gates: lint, typecheck, tests, SAST, secret scan, dependency scan.
9. Monitoring/alerting on real metrics; incident response runbooks tested.
10. Public portal PII-safe with audited corrections.

---

## 44. FINAL RECOMMENDATION

Retain this codebase as the **specification-grade prototype and UI foundation**. Its workflows, RBAC, careful-language policies, dual-control designs and test harness are genuinely good and would be expensive to re-derive. Do **not** attempt to harden the current single-process, simulated-data architecture into production — the persistence, evidence, offline and telemetry layers must be rebuilt on real infrastructure (§38–§40). Proceed to M1 **only with explicit authorization**; M0 ends here.

---

# 60. EXECUTIVE VERDICT

## **NOT PRODUCTION READY**

The platform is an exceptional demo/blueprint (41/100 by the §44 scorecard), not an operational system. The five most important blockers, in order:

1. **P0-01 SEC-01** — known default session-signing key committed in source; the live Vercel deployment runs it. Any party with repository access can forge sessions, including superadmin.
2. **P0-02 DATA-01** — every operational figure is simulated; there is no real-data ingress path, so the platform cannot observe a real election.
3. **P0-03 DB-01** — no production database; total state loss on process/instance loss; no transactions, constraints, or backups.
4. **P1-03 EVID-01** — evidence cannot be proven unaltered (simulated capture, in-memory storage, no encryption/WORM/signing) — the single most important property for an election-integrity platform.
5. **P1-04 OFFLINE-01 + P1-07 DR-01** — no offline-first field capability and no disaster recovery: a real field operation would lose data and have no recovery path.

---

# 61. CRITICAL OUTPUT — TOP 20 PRIORITY ACTIONS

**P0-01 · Rotate & externalize the session secret.** Problem: default HMAC key in source (auth.js:9); deployed with it. Why: token forgery for any account. Solution: require `SESSION_SECRET` env (fail closed), rotate, revoke existing tokens, add secret scanning. Dependency: none. Complexity: S. Milestone: **M2 (immediate)**.

**P0-02 · Decide and document the platform's real role.** Problem: it is a demo; any operational expectation is unsafe. Why: prevents the platform's single greatest risk — simulated data trusted as real. Solution: formal demo/design-validation charter; retain all DEMO labels through any refactor. Dependency: none. Complexity: XS. Milestone: **M1**.

**P0-03 · Stand up the production data layer.** Problem: in-memory + JSON snapshot. Why: total data loss; no transactions. Solution: PostgreSQL/PostGIS per docs/schema.sql, repository layer, managed backups. Dependency: P0-02. Complexity: L. Milestone: **M3**.

**P1-01 · Fix the AUTHZ-01 scope bypass.** Problem: `?lga=`/`?senatorial=` overrides scoped users' districts on evidence endpoints. Why: cross-district horizontal access. Solution: scope-first resolution; central-role-only overrides; regression test. Dependency: none. Complexity: XS. Milestone: **M2**.

**P1-02 · Implement real MFA.** Problem: OTP displayed client-side. Why: no second factor exists. Solution: TOTP (RFC 6238) or WebAuthn; demo path gated by demoMode. Dependency: P0-01. Complexity: M. Milestone: **M2**.

**P1-03 · Build the evidence architecture.** Problem: simulated capture, in-memory storage. Why: election-integrity evidence must be provably unaltered. Solution: client hash → TLS upload → server re-hash → SSE-KMS object storage + object lock → custody events. Dependency: P0-03. Complexity: L. Milestone: **M4**.

**P1-04 · Build offline-first field capability.** Problem: localStorage-only queue. Why: field data loss on election day. Solution: service worker + IndexedDB + local encryption + idempotent sync (dedupe keys). Dependency: P0-03, P1-03. Complexity: L. Milestone: **M5**.

**P1-05 · Add security headers + CSP.** Problem: none present. Why: clickjacking/sniffing/XSS backstop. Solution: per-environment header middleware; nonce-based CSP for inline scripts. Dependency: none. Complexity: S. Milestone: **M2**.

**P1-06 · Real SENTINEL telemetry.** Problem: entire SOC is seeded fiction. Why: security dashboards must never misrepresent. Solution: collectors → metrics/logs pipeline → real dashboards; keep action/approval design. Dependency: M7/M8 stack. Complexity: XL. Milestone: **M8**.

**P1-07 · Backups & DR.** Problem: none exist. Why: no recovery path. Solution: PITR backups, restore drills, RPO≤5min/RTO≤1h targets. Dependency: P0-03. Complexity: M. Milestone: **M11**.

**P1-08 · Complete the auth lifecycle.** Problem: no reset, revocation, refresh. Why: stolen-token exposure window is 12 h. Solution: revocation list, refresh rotation, secure reset flow. Dependency: P0-01. Complexity: M. Milestone: **M2**.

**P1-09 · Central rate limiting.** Problem: per-process in-memory limits reset on restart; multi-instance bypass. Why: brute-force/abuse protection must be global. Solution: Redis-backed limiter + per-route budgets. Dependency: M7 infra. Complexity: M. Milestone: **M7/M11**.

**P2-01 · Enforce retention.** Problem: `retentionDays` is config-only. Why: privacy obligations. Solution: scheduled purge jobs + per-entity policy. Dependency: P0-03. Complexity: S. Milestone: **M3**.

**P2-02 · Real-data ingestion path.** Problem: no field ingress exists. Why: without it nothing else matters. Solution: observation/evidence ingestion APIs (M3/M4) with validation parity to the sim engine. Dependency: P0-03. Complexity: L. Milestone: **M6**.

**P2-03 · Per-figure provenance rendering.** Problem: only global demo banners. Why: trust requires figure-level SOURCE/TIMESTAMP/VERIFICATION. Solution: provenance component across all dashboards. Dependency: P0-02. Complexity: M. Milestone: **M9**.

**P2-04 · API contract & validation hardening.** Problem: uneven validation, thin admin PATCHes. Why: injection/mass-assignment/abuse surface. Solution: schema validation (e.g. zod-style), unified error envelope, pagination everywhere. Dependency: none. Complexity: M. Milestone: **M1/M2**.

**P2-05 · Move SSE auth off the query string.** Problem: token in URL + `Access-Control-Allow-Origin: *` (local mode). Why: token leakage via logs/referrers. Solution: WebSocket upgrade with header auth. Dependency: M7. Complexity: M. Milestone: **M7**.

**P3-01 · CI/CD with security gates.** Problem: nothing automated. Why: regression and secret risk. Solution: lint, typecheck, tests, SAST, dependency + secret scanning per PR. Dependency: P0-02. Complexity: M. Milestone: **M1**.

**P3-02 · Accessibility pass.** Problem: no ARIA/contrast work. Why: public-facing observatory must be inclusive. Solution: WCAG 2.1 AA review + fixes. Dependency: none. Complexity: M. Milestone: **M10**.

**P3-03 · Evidence upload hardening.** Problem: base64-in-JSON, no AV/MIME checks. Why: upload-surface hygiene. Solution: multipart + signed URLs, MIME/size validation, malware scan. Dependency: P1-03. Complexity: M. Milestone: **M4**.

**P3-04 · Observability.** Problem: console-only logs, no metrics. Why: "what does the organization know about a failure?" — currently nothing. Solution: structured logs, OpenTelemetry metrics, alerting. Dependency: M8 stack. Complexity: M. Milestone: **M8**.

---

# 62. SCOPE OF THIS AUDIT

M0 is complete. **No implementation has begun.** Per the directive, no production behaviour was modified; the only artifacts created are read-only documentation under `/AUDIT/` and the extraction script `scripts/audit-extract.js`. The audit stops here and awaits explicit authorization to begin M1.

---

# 63. THE FINAL QUESTION — DIRECT ANSWER

> *"If Eagle Eye were deployed today for a serious election observation operation, what could fail, how could it fail, what would the organization know about the failure, how quickly could it respond, and what evidence would remain trustworthy?"*

**What would fail:** (1) an attacker (or any curious person with the public repository) could **forge a session as any administrator** using the committed default signing key — silent, complete account takeover. (2) A Vercel cold start, crash, or redeploy would **erase every observation, evidence record and audit entry** captured since the last boot — silently replaced by the fictional seed baseline. (3) Field observers with weak connectivity would **lose queued work** (localStorage-only queue, no durable offline store). (4) **Evidence could not be shown to be unaltered** — hashes exist but cover simulated in-memory artifacts with no WORM storage, no encryption, no signing; the JSON snapshot can be rewritten wholesale. (5) A scoped LG or Senatorial officer could **read other districts' evidence** with a one-line query-parameter override. (6) The **SENTINEL SOC would display fictional telemetry** as if it were the platform's own security posture — an operational blind spot wearing the costume of visibility.

**How would the organization know?** Mostly it wouldn't: no monitoring, no metrics, no alerting, no log shipping, no integrity alarms on the state file; `/api/health` returns simulated status strings. Failure awareness would come from users noticing, hours later.

**How quickly could it respond?** Re-deploy and re-seed take minutes — but there is nothing real to restore, so "recovery" is illusory; real data would be gone permanently. No runbooks, no DR, no backups.

**What evidence would remain trustworthy?** The **workflow blueprints** — the state machines, RBAC model, dual-control designs, careful-language policies, test suites and UX — are trustworthy as specifications. **No operational record produced by the platform today would be trustworthy as evidence**, because none of it is real, and the storage beneath it could be rewritten without detection.

---

# M0 GO / NO-GO RECOMMENDATION

## **NO-GO** for production operation — with a conditional **GO** for its current, honest purpose.

**Justification:** the platform is a Category-A demonstration and design-validation asset with excellent workflow specifications, and every production-critical substrate (persistence, evidence, offline, telemetry, DR, secret handling) is absent or simulated. It is safe to continue using as a clearly-labelled demo, blueprint and training simulator. It must not enter operational service, and no data it produces may be represented as real. Proceeding to M1 (foundation) is recommended **only after explicit authorization**, per §62.
