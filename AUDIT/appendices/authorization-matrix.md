# AUTHORIZATION MATRIX (M0)

34 roles × key resources. Read = R · Create = C · Update = U · Verify/Approve = V · Export = E.
Source: `server/lib/seed.js` role definitions + per-route guards in `server/server.js` (verified by negative-path tests).

## Core resource matrix

| Role (id) | Results | Evidence | Incidents | SOS | Escalations | Streams | Agents admin | Analytics | Reports/Export | Audit | Public release | Sim control |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| superadmin | R/C/U/V | R | R/C/U | R/U | R/U | R/C | R/U | R | E | R | R | ✓ |
| director | R/U/V | R | R/U | R | R | R | R | R | E | R | R | ✗ |
| chiefanalyst | R | R | R | R | R | R | R | R | E | R | ✗ | ✗ |
| resultmanager | R/V/U | R | R | R | R | R | R | R | E | ✗ | ✗ | ✗ |
| irevanalyst | R/V | R | R | R | R/C | R | R | R | E | R | ✗ | ✗ |
| incidentcommander | R | ✗ | R/C/U | R/U | R/C | R | R | R | ✗ | ✗ | ✗ | ✗ |
| comms | R | ✗ | R | R | R | ✗ | ✗ | R | ✗ | ✗ | ✗ | ✗ |
| analyst | R/U | R | R/U | R | ✗ | R | R | R | E | R | ✗ | ✗ |
| operator | R | ✗ | R/U | R/U | ✗ | R | R | ✗ | ✗ | ✗ | ✗ | ✗ |
| sencoord (scoped) | R | R † | R/U | R | R/C | R | R | R | ✗ | ✗ | ✗ | ✗ |
| sendirector | R | R † | R/U | R/U | R/C | R | R | R | E | R | ✗ | ✗ |
| senops / senincident / senanalyst / senverify / senviewer | R | R (analyst/verify †) | R (/U) | R | R/C | R | R | R | (analyst E) | (analyst R) | ✗ | ✗ |
| lgcoord (scoped) | R | R † | R/C/U | R | R/C | R | R | R | ✗ | ✗ | ✗ | ✗ |
| lgsupervisor | R | R † | R/C/U | R/U | R/C | R | R | R | E | R | ✗ | ✗ |
| lganalyst / lgtech / wardcoord | R | R (analyst †) | R (/C) | R | ✗ / R | R | R (tech U) | R | (analyst E) | (analyst R) | ✗ | ✗ |
| supervisor | R/V/U | R | R | R | ✗ | ✗ | ✗ | R | ✗ | ✗ | ✗ | ✗ |
| reviewer | R/V | R | R | ✗ | ✗ | ✗ | ✗ | R | ✗ | ✗ | ✗ | ✗ |
| agent | submit own | own (create) | C | C | ✗ | C | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| incident | R | ✗ | R/U | R | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| support | R | ✗ | ✗ | ✗ | ✗ | ✗ | R/U | ✗ | ✗ | ✗ | ✗ | ✗ |
| pio | R | ✗ | R | ✗ | ✗ | ✗ | ✗ | R | ✗ | ✗ | R | ✗ |
| auditor | R | R | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | R (+SENTINEL security.audit) | ✗ | ✗ |
| observer | R | ✗ | R | ✗ | ✗ | ✗ | ✗ | R | ✗ | ✗ | ✗ | ✗ |
| secdirector | R | R | SENTINEL R/U | ✗ | ✗ | ✗ | ✗ | R | ✗ | R | ✗ | ✗ |
| socanalyst | R | R | SENTINEL R/U | ✗ | ✗ | ✗ | ✗ | R | ✗ | R | ✗ | ✗ |
| infraengineer / apisecurity | R | ✗ | SENTINEL R/U | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| secinccmd | R | R | SENTINEL R/U + approve | ✗ | ✗ | ✗ | ✗ | R | ✗ | R | ✗ | ✗ |

† **AUTHZ-01 (P1, CONFIRMED):** scoped roles' evidence views resolve scope as `user.scope OR query param` — a scoped user can override their district/LGA via `?lga=` / `?senatorial=` and read other scopes' evidence records.

## SENTINEL privilege gates

| Permission | Meaning | Holders |
|---|---|---|
| security.view | read SOC dashboards | 5 security roles + auditor |
| security.respond | request/execute security actions | 5 security roles (not auditor) |
| security.privileged | approve/reject actions, dual authorization, threat overrides, rule toggles | secdirector, secinccmd, superadmin |
| security.audit | immutable security audit | secdirector, secinccmd, auditor, superadmin |

Action approval model: LOW risk → auto-execute (audited) · MEDIUM/HIGH → SINGLE approval · CRITICAL → **DUAL authorization** (requester cannot self-approve; verified by tests).

## Verified negative-path checks (from the suites)

agent → /api/admin/users → 403 · agent → exports → 403 · auditor → action request → 403 · observer → /api/sentinel/* → 403 · sencoord → demo simulate (senatorial.demo) → 403 · same reviewer second-approve → 400 · unauthenticated → 401 · tampered session token → 401.
