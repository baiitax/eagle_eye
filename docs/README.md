# EYES OF VICTORY 2027 — Kano State Election Monitoring Platform

**Monitor. Verify. Respond. Report.**

A complete, working prototype of an enterprise election situation-room & monitoring platform for the 2027 Nigerian General Elections, deployed first on Kano State. Everything in this repository runs **without any npm dependencies** — a plain Node.js server plus a hand-built frontend (SVG GIS engine, SVG chart library, no external CDNs).

> ⚠ **DEMO MODE.** All data is fictional simulation data. No figure on this platform is an official INEC result, and no fictional candidate result is presented as a real election result.

---

## 1. Quick start

```bash
node server/server.js          # starts on http://localhost:3000
```

First boot seeds the full dataset (44 real Kano LGA boundaries from geoBoundaries, 504 wards, 1,476 polling units, 1,319 field agents) and loads the **Collation Phase (16:20 WAT, 27 Feb 2027)** simulation scenario. The simulated clock runs at 30× real time by default.

### Demo accounts (MFA code is displayed on screen — demo mode)

| Portal | URL | Username / Password |
|---|---|---|
| Central Situation Room | `/central` | `director` / `Director@123!` |
| Central Analyst | `/central` | `analyst` / `Analyst@123!` |
| Supervisory Verification | `/supervisor` | `supervisor` / `Supervisor@123!` (second reviewer: `supervisor2`) |
| Result Reviewer | `/supervisor` | `reviewer` / `Reviewer@123!` (`reviewer2`, `reviewer3`) |
| LG Situation Room (Nasarawa) | `/lg` | `lgcoord` / `LGCoord@123!` |
| Senatorial Command (Kano North) | `/senatorial` | `sencoord_n` / `SenCoord@123!` (`sencoord_c`, `sencoord_s`) |
| Field Agent App | `/agent` | `fieldagent` / `Agent@123!` |
| Incident Officer | `/central` | `incident` / `Incident@123!` |
| Public Information Officer | `/central` | `pio` / `PIO@123!` |
| Technical Support (NOC) | `/central` | `support` / `Support@123!` |
| Auditor | `/central` | `auditor` / `Auditor@123!` |
| Read-Only Observer | `/central` | `observer` / `Observer@123!` |
| Super Administrator | `/admin` | `superadmin` / `Admin@123!` |
| Public Portal | `/public` | open access — no login |

---

## 2. What is built

**Seven interconnected applications** (a change in one propagates live to the others):

1. **Field Agent App** (`/agent`) — mobile-first. Duty lifecycle (NOT ACTIVATED → ACTIVATED → ON DUTY → POLLING MONITORING → RESULT SUBMITTED → VERIFIED/REJECTED → DUTY COMPLETED), duty checklist, result submission wizard with **simulated camera capture of EC8A pages** (edge-detection/blur/lighting simulation), OCR cross-check with confidence scores (human confirmation always required), offline mode with local queue ("N ITEMS WAITING TO SYNC"), SOS with confirmation, simulated live video, photo evidence, supervisor feedback, and a read-only post-duty archive (evidence is preserved, never deleted).
2. **LG Situation Room** (`/lg`) — scope-bound command dashboard: KPIs, GIS map drilled into the coordinator's LGA, ward intelligence (Ward Health Score = operational completeness only), polling units, agents, results, incident management, SOS acknowledgement, streams, analytics, LG SITREPs.
3. **Senatorial Command** (`/senatorial`) — Kano Central / North / South configurable dashboards, district map, LG & ward monitoring, live wall (2×2/3×3/4×4/fullscreen), escalation views.
4. **Central Situation Room** (`/central`) — the statewide command centre: 12-KPI band, full-screen command map with filters, senatorials, LG monitor, results, incidents, SOS escalation, live wall with pinning, **Situation Room Intelligence Assistant (Copilot)** with data-provenance labels (FACT / VERIFIED DATA / UNVERIFIED REPORT / DERIVED DATA / SYSTEM INFERENCE / HUMAN ASSESSMENT), analytics with time-series and connectivity heatmap, verification oversight (four-eyes corrections), SITREPs with JSON/CSV/XLSX/print-PDF export, immutable audit centre, system health.
5. **Supervisory Verification Portal** (`/supervisor`) — split-screen EC8A review (original document left, extracted data with OCR confidence right), actions APPROVE / REJECT / REQUEST CLARIFICATION / FLAG FOR SECOND REVIEW / MARK DISPUTED with mandatory reasons, **two-person (dual-control) verification** for flagged results, chain-of-custody viewer, version history.
6. **Public Statistics Portal** (`/public`) — clean light theme, "UNOFFICIAL / MONITORING DATA — NOT INEC OFFICIAL RESULTS" labelling everywhere, verified-only result aggregates, incident aggregates (no personal data), statistics, public-safe map, full methodology & correction policy.
7. **Super Administration** (`/admin`) — users, granular role/permission matrix, agent assignment engine (audited reassignment), device management (approve/revoke/lock), elections, geography (PU rename), candidates/parties, branding & system configuration, security posture, audit, system health, **simulation control** (speed, pause, scenario presets, full reset) and integrations overview.

### Simulation & demo flow
Scenario presets (Opening 08:10 / Voting 11:40 / Collation 16:20 / Evening 19:05 / Post-election 22:10) regenerate the entire election day deterministically — agents check in, PUs open, incidents spawn (neutral language, severity 1–5), SOS events escalate, streams go live, results arrive per-PU collation schedule, the validation engine flags anomalies ("DATA ANOMALY DETECTED — Requires Human Review"), supervisors approve/reject/dispute, dual-control kicks in for high-risk records, and verified data flows to the public portal. A live tick engine continues the day at the configured speed.

### Full result lifecycle
`UNVERIFIED → SUBMITTED → UNDER REVIEW → VERIFIED / REJECTED / DISPUTED → ARCHIVED` — with validation flags, anti-duplication (submission ID, PU ID, document SHA-256, perceptual hash, metadata), versioned corrections (VERSION 1 → VERSION 2 → …), four-eyes approval for overrides, and complete audit + custody trails.

---

## 3. Architecture

```
public/                     frontend (7 apps, shared shell/components)
  assets/css/theme.css      design system (dark command centre + light public theme)
  assets/js/util.js         helpers, WAT timezone formatting
  assets/js/api.js          API client, auth flow, SSE
  assets/js/ui.js           shell, KPI cards, tables, SVG charts, EC8A renderer, sim streams
  assets/js/map.js          dependency-free SVG GIS engine (pan/zoom/layers/clustering)
  assets/js/pages/*.js      one module per application
server/
  server.js                 zero-dependency HTTP server: REST API + static + SSE
  lib/store.js              in-memory state + JSON persistence
  lib/seed.js               roles, users, geography, parties, candidates, agents
  lib/sim.js                deterministic election-day plan + live tick engine
  lib/validation.js         automated validation engine (neutral language)
  lib/auth.js               sessions, MFA, RBAC, rate limiting, lockout
  lib/copilot.js            rule-based Situation Room Intelligence Assistant
  lib/reports.js            SITREPs + CSV/JSON/XLSX exports (no dependencies)
scripts/
  build_geo.js              real Kano LGA boundaries → wards → polling units
  e2e.js                    full pipeline test (agent → verify → public)
docs/
  schema.sql                production PostgreSQL/PostGIS schema
  README.md                 this file
data/
  geo.json                  generated geography (committed)
  state.json                persisted simulation state (runtime)
```

- **Real-time**: Server-Sent Events (`/api/events`) broadcast `result.submitted/verified`, `incident.created`, `sos.triggered`, `stream.started`, `agent.online/offline` — dashboards update live without polling.
- **Time**: stored UTC, displayed Africa/Lagos (WAT) everywhere.
- **Evidence**: original uploads are immutable; each receives SHA-256, timestamps, user/device/GPS metadata and a custody chain (CAPTURED → UPLOADED → RECEIVED → REVIEWED → VERIFIED → DISPUTED → ARCHIVED).
- **Security**: MFA (demo OTP shown), RBAC enforced server-side on every endpoint, rate limiting, brute-force lockout, hashed passwords (scrypt), audit logging of every mutation incl. exports. Login `superadmin` to edit the permission matrix.
- **Scale-out**: configurable `Country → State → Senatorial → LGA → Ward → PU` and `Election → Type → Constituency → Candidate → Result` hierarchies — Kano is the first deployment, not a hard-coded limit. The prototype's in-memory store maps 1:1 onto `docs/schema.sql` (PostgreSQL + PostGIS) for production, with horizontal scaling targets (1k → 5k → 10k agents) documented in `docs/SCALE.md` principles below.

## 4. Responsible election technology

- Voter privacy is protected; no unnecessary personal data is collected; no voter profiling, persuasion or targeting exists anywhere in the system.
- Monitoring data is **never** presented as official INEC results.
- The intelligence engine separates RAW DATA / VERIFIED DATA / DERIVED DATA / ANALYTICAL INSIGHT / HUMAN ASSESSMENT — categories are never mixed.
- The validation engine uses neutral language ("DATA ANOMALY DETECTED — Requires Human Review"); it never accuses an agent, party, candidate or polling unit.
- Every critical record preserves **SOURCE + TIME + LOCATION + USER + EVIDENCE + STATUS + AUDIT TRAIL**.

## 5. Testing

```bash
node scripts/apitest.js   # auth, review flow, dual control, corrections, copilot, exports
node scripts/e2e.js       # AGENT → VALIDATION → LG/CENTRAL → SUPERVISOR → PUBLIC end-to-end
```

Both scripts run against a live server and exercise RBAC negative cases, duplicate protection, SOS escalation, incident lifecycle, duty lock-out and evidence preservation.

## 6. Known prototype boundaries (production hardening path)

- Live video is a **simulated feed** with the HUD/telemetry of the real pipeline; production uses WebRTC ingest → adaptive-bitrate HLS → signed URLs.
- OCR is simulated; production integrates a document OCR service with the same confidence/human-confirmation contract.
- The AI Copilot is rule-based over live system records (no external model); the answer schema (provenance-labelled sections) is the contract for a future LLM backend.
- Persistence is a JSON snapshot of the in-memory store; `docs/schema.sql` is the production target.

## 7. SENTINEL SECURITY OPERATIONS CENTRE

**EYES OF VICTORY — SENTINEL SOC** (`/sentinel`) — *Protect the Infrastructure. Preserve the Evidence. Maintain Election-System Integrity.* — 24/7 cybersecurity, infrastructure monitoring, threat detection and incident response (spec §1–75).

**Roles & access** — five security roles: `secdirector` (Security Director, `SecDir@123!`), `socanalyst` (SOC Analyst, `SocAna@123!`), `infraengineer` (Infrastructure Engineer), `apisecurity` (API Security Engineer), `secinccmd` (Security Incident Commander, `SecCmd@123!`). Permissions: `security.view` (all five + auditor), `security.respond` (request/execute actions), `security.privileged` (approve/reject/override; audit + superadmin carry it), `security.audit` (immutable audit). Roles without `security.view` see an explicit SECURITY ACCESS REQUIRED screen.

**Coverage** — 14 nodes (API gateways, app servers, DB cluster, evidence store, CDN, video, IReV connector, public domain), 12 APIs with anomaly detection (spikes, auth failures, error rates — each with the evidence), identity + privileged sessions, vulnerability register (CVE/asset/fix/owner/deadline/risk acceptance), patch command, configuration drift (BEFORE→AFTER, who/when/why), file integrity, database, evidence store (SHA-256 verification + §71 failsafe: preserve → freeze → notify → case), IReV connector security (no bypass of IReV security controls), public domain + WAF, threat intelligence (signals, not proof), correlation (why the risk increased), 9-step security cases with communications, 11 response playbooks, central security log (search/filter/CSV export/create-case), MTTD/MTTA/MTTC/MTTR KPIs, compliance controls, risk register, executive top-5, election-day defence mode (7 priorities), command wall, SENTINEL Copilot.

**Privileged action control** — 25-action catalog with risk classes (LOW/MEDIUM/HIGH/CRITICAL), reversibility and approval requirements (none / SINGLE / **DUAL authorization** — the requester can never approve their own CRITICAL action). Flow: REQUEST → APPROVE → EXECUTE (records BEFORE/AFTER) → ROLLBACK (reversible actions) / REJECT. Break-glass emergency access requires a written reason, carries a time limit, elevated monitoring, automatic expiry and full audit. Everything is written to the append-only security audit: WHO · WHAT · WHEN · WHERE · TARGET · BEFORE · AFTER · WHY · APPROVAL · RESULT.

**Scoring rules (explicit, traceable)** — the security posture is a weighted aggregate of 10 domains, each computed from live telemetry and opening its underlying evidence on click; the threat level (NORMAL/GUARDED/ELEVATED/HIGH/CRITICAL) is computed from explicit rules (open CRITICAL cases, evidence-integrity breaches, node states, alert volumes, overdue vulnerabilities) plus analyst overrides that require written reasons to lower. No unexplained "AI security scores".

**APIs** — `/api/sentinel/status|nodes|apis|events|alerts|incidents|vulns|patches|config|db|evidence|irev|public|identity|sessions|network|secrets|logs|automation|action-catalog|actions|breakglass|playbooks|analytics|kpis|compliance|risk|executive|timeline|apps|audit|election-mode|threat-level|recovery|wall|copilot`.

## 8. Vercel serverless deployment

`api/index.js` (serverless entry) + `vercel.json` (rewrite-all to the function, `maxDuration: 30`, `includeFiles: public/**,data/**`) + `package.json` make the repo deployable on Vercel as-is (Framework Preset: **Other**). The same `handleRequest`/`boot` exports used locally serve every page, API and asset. Serverless notes: deterministic re-seed per cold start, warm instances keep state, HMAC-signed session tokens survive instance recycling (user IDs are deterministic across cold starts; MFA challenges are self-contained signed payloads, so login and post-login navigation work on any instance), SSE auto-disabled (client checks `/api/health`), assets cached `public, max-age=3600`. For full realtime/persistence use the long-running server (`node server/server.js`). Verified by `scripts/serverless-check` (24 checks: pages, assets, cache headers, SSE 501, login, signed-token recycle, tamper rejection, **full cold-start wipe + re-seed with token/challenge issued pre-wipe**, idempotent boot).

## 9. Public domain home & secure sign-in

`/` — public election domain: live KPI strip, Result Observatory (senatorial districts + governorship monitored vote share, verified submissions only), incident monitor, IReV watch, Kano map, DEMO/unofficial disclaimers, SIGN IN (header) + bottom login dock, role-dashboard banner for signed-in users, authorized-portal grid.

`/login` — dedicated secure sign-in: MFA login card beside five groups of clickable demo-credential chips (one click fills the form); success routes to the role dashboard via `rolePortal()`.
