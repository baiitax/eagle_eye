# TEST EVIDENCE — fresh full-suite run (M0, 2026-09-01)

All suites executed against a freshly-seeded local server (RESULTS scenario).

| Suite | Result | Scope |
|---|---|---|
| apitest.js | ALL TESTS DONE | auth, review flow, dual control, corrections, copilot, exports |
| e2e.js | E2E complete | agent → LG → central → supervisor → public pipeline + RBAC negatives |
| agent-test.js | 50/50 | field agent app |
| lg-test.js | 62/62 | LG supervisor portal |
| senatorial-test.js | 71/71 | senatorial command |
| central20-test.js | 41/41 | central situation room 2.0 |
| irev-test.js | 69/69 | IReV Watchtower (incl. two-person approval) |
| public-test.js | 58/58 | public observatory (incl. corrections, PII safety) |
| login-test.js | 47/47 | auth lifecycle incl. storage-blocked & failure scenarios |
| sentinel-test.js | 155/155 | SENTINEL SOC API + UI + landing + login pages |
| serverless-check.js | 24/24 | Vercel adapter incl. cold-start + signed-token scenarios |
| **Total** | **~600 checks, 0 failures** | |

Notes: suites are scenario scripts (jsdom-driven) — they validate the demo's
behavioural contracts, not production-grade properties. No unit tests of pure
logic, no load tests, no security scanners (SAST/DAST) exist.
