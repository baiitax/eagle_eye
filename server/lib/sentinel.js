// sentinel.js — EYES OF VICTORY SENTINEL SECURITY OPERATIONS CENTRE engine
// Defensive monitoring and authorized response only. Every privileged action is
// authenticated, authorized, logged, reversible where possible, and subject to approval.
'use strict';
const { S, set, audit, notify, nextCode } = require('./store');
const { uuid, mulberry32, ri, pick, sha256, fmtWat, fmtWatShort, pct } = require('./util');

const THREAT_LEVELS = ['NORMAL', 'GUARDED', 'ELEVATED', 'HIGH', 'CRITICAL'];
const SEV = { 1: 'INFORMATIONAL', 2: 'LOW', 3: 'MEDIUM', 4: 'HIGH', 5: 'CRITICAL' };
const CASE_FLOW = ['DETECTED', 'TRIAGED', 'ASSIGNED', 'INVESTIGATING', 'CONTAINMENT', 'ERADICATION', 'RECOVERY', 'VALIDATION', 'CLOSED'];
const CATEGORIES = ['INFRASTRUCTURE', 'API', 'IDENTITY', 'APPLICATION', 'DATABASE', 'NETWORK', 'EVIDENCE', 'IREV', 'PUBLIC'];

// ---------------- risk classes for privileged actions (§47) ----------------
const ACTION_CATALOG = {
  ACK_ALERT:            { label: 'Acknowledge alert',        risk: 'LOW',      reversible: true,  approval: 'NONE' },
  ASSIGN_CASE:          { label: 'Assign security case',     risk: 'LOW',      reversible: true,  approval: 'NONE' },
  RUN_HEALTH_CHECK:     { label: 'Run node health check',    risk: 'LOW',      reversible: true,  approval: 'NONE' },
  RUN_VULN_SCAN:        { label: 'Run vulnerability scan',   risk: 'LOW',      reversible: true,  approval: 'NONE' },
  REQUEST_LOGS:         { label: 'Request security logs',    risk: 'LOW',      reversible: true,  approval: 'NONE' },
  RATE_LIMIT_SOURCE:    { label: 'Rate-limit a source',      risk: 'MEDIUM',   reversible: true,  approval: 'SINGLE' },
  DISABLE_SESSION:      { label: 'Disable compromised session', risk: 'MEDIUM', reversible: true, approval: 'SINGLE' },
  ROTATE_CREDENTIAL:    { label: 'Rotate individual credential', risk: 'MEDIUM', reversible: false, approval: 'SINGLE' },
  RESTART_SERVICE:      { label: 'Restart isolated service', risk: 'MEDIUM',   reversible: true,  approval: 'SINGLE' },
  ISOLATE_NODE:         { label: 'Isolate node',             risk: 'HIGH',     reversible: true,  approval: 'SINGLE' },
  DISABLE_API:          { label: 'Disable API',              risk: 'HIGH',     reversible: true,  approval: 'SINGLE' },
  REVOKE_CREDENTIAL:    { label: 'Revoke service credential', risk: 'HIGH',    reversible: false, approval: 'SINGLE' },
  BLOCK_COMPONENT:      { label: 'Block infrastructure component', risk: 'HIGH', reversible: true, approval: 'SINGLE' },
  FAILOVER_SERVICE:     { label: 'Fail over service',        risk: 'HIGH',     reversible: true,  approval: 'SINGLE' },
  PRODUCTION_SHUTDOWN:  { label: 'Production-wide shutdown', risk: 'CRITICAL', reversible: true,  approval: 'DUAL' },
  FIREWALL_POLICY:      { label: 'Major firewall policy change', risk: 'CRITICAL', reversible: true, approval: 'DUAL' },
  DESTRUCTIVE_OP:       { label: 'Destructive operation',    risk: 'CRITICAL', reversible: false, approval: 'DUAL' },
  EVIDENCE_STORE_CHANGE:{ label: 'Evidence-store change',    risk: 'CRITICAL', reversible: false, approval: 'DUAL' },
  DATABASE_RECOVERY:    { label: 'Database recovery',        risk: 'CRITICAL', reversible: true,  approval: 'DUAL' },
  POLICY_OVERRIDE:      { label: 'Security-policy override', risk: 'CRITICAL', reversible: true,  approval: 'DUAL' },
  VERIFY_BACKUP:        { label: 'Verify backup integrity',  risk: 'LOW',      reversible: true,  approval: 'NONE' },
  START_RECOVERY:       { label: 'Start recovery procedure', risk: 'HIGH',     reversible: false, approval: 'SINGLE' },
  FAILOVER_DR:          { label: 'Disaster-recovery failover', risk: 'CRITICAL', reversible: true, approval: 'DUAL' },
  ADJUST_RATE_LIMIT:    { label: 'Adjust API rate limit',    risk: 'MEDIUM',   reversible: true,  approval: 'SINGLE' },
  ENABLE_MAINTENANCE:   { label: 'Enable maintenance mode',  risk: 'MEDIUM',   reversible: true,  approval: 'SINGLE' },
};

const PLAYBOOKS = [
  { id: 'pb-compromised-account', name: 'Compromised Account', icon: '👤', steps: ['Verify unusual-session evidence', 'Step-up authentication on account', 'Disable compromised session', 'Rotate credentials', 'Review recent actions for abuse', 'Notify user & security lead', 'Post-incident review'] },
  { id: 'pb-api-abuse', name: 'API Abuse', icon: '🔌', steps: ['Confirm abuse pattern from telemetry', 'Rate-limit offending source', 'Alert API security engineer', 'Check for data exposure', 'Escalate to WAF if sustained', 'Document & close'] },
  { id: 'pb-suspicious-node', name: 'Suspicious Node', icon: '🖥', steps: ['Collect node telemetry & processes', 'Compare against baseline', 'Isolate node if confirmed', 'Forensic capture', 'Rebuild or restore approved config', 'Validate before re-joining'] },
  { id: 'pb-malware', name: 'Malware Detection', icon: '🦠', steps: ['Preserve affected files & hashes', 'Isolate affected host', 'Block associated indicators', 'Eradicate & patch', 'Restore from clean backup', 'Validate integrity'] },
  { id: 'pb-evidence-integrity', name: 'Evidence Integrity Event', icon: '🧾', steps: ['PRESERVE snapshot immediately', 'FREEZE affected record', 'Open CRITICAL security case', 'Compare original vs current hash', 'Review access history', 'Notify security command & auditors', 'Recover from verified copy if authorized'] },
  { id: 'pb-db-incident', name: 'Database Incident', icon: '🗄', steps: ['Assess availability & replication', 'Capture query/error logs', 'Fail over if authorized', 'Preserve transaction evidence', 'Recover & validate', 'Post-incident review'] },
  { id: 'pb-public-attack', name: 'Public Website Attack', icon: '🌐', steps: ['Confirm attack vector from WAF logs', 'Enable challenge mode', 'Rate-limit source networks', 'Notify communications officer', 'Coordinate with CDN provider', 'Verify public portal availability'] },
  { id: 'pb-ddos', name: 'DDoS Event', icon: '📡', steps: ['Confirm traffic spike signature', 'Engage CDN protection', 'Enable traffic filtering', 'Scale origin capacity', 'Monitor availability', 'Restore normal posture gradually'] },
  { id: 'pb-credential-exposure', name: 'Credential Exposure', icon: '🔑', steps: ['Locate exposure (log/repo/config)', 'REVOKE the exposed credential', 'REDACT the secret from the surface', 'Issue replacement', 'Rotate dependent services', 'Audit for prior abuse'] },
  { id: 'pb-service-outage', name: 'Service Outage', icon: '📉', steps: ['Confirm scope & affected users', 'Notify incident commander', 'Fail over / restart isolated service', 'Monitor recovery', 'Root-cause & patch', 'Post-incident review'] },
  { id: 'pb-irev-connector', name: 'IReV Connector Failure', icon: '🛰', steps: ['Check connector health & auth', 'Verify source availability', 'Preserve last-known snapshots', 'Alert IReV analyst', 'Retry with backoff (no bypass of security controls)', 'Validate ingestion integrity after recovery'] },
];

const COMPLIANCE_CONTROLS = [
  { id: 'ctl-mfa', control: 'MFA on all privileged accounts', status: 'COMPLIANT', evidence: '100% of user accounts enforce MFA challenge' },
  { id: 'ctl-enc', control: 'Encryption at rest & in transit', status: 'COMPLIANT', evidence: 'TLS 1.3 enforced; AES-256 at rest' },
  { id: 'ctl-bak', control: 'Backup & recovery', status: 'COMPLIANT', evidence: 'Daily backups, 30-day retention, weekly restore test' },
  { id: 'ctl-patch', control: 'Patch management', status: 'PARTIAL', evidence: '2 CRITICAL patches pending within maintenance window' },
  { id: 'ctl-access', control: 'Access review', status: 'COMPLIANT', evidence: 'Quarterly privilege review completed' },
  { id: 'ctl-log', control: 'Security logging', status: 'COMPLIANT', evidence: 'Append-only audit storage, 730-day retention' },
  { id: 'ctl-ir', control: 'Incident response', status: 'COMPLIANT', evidence: 'Playbooks defined & tested' },
  { id: 'ctl-evi', control: 'Evidence integrity', status: 'COMPLIANT', evidence: 'SHA-256 chain verification on EC8A evidence' },
  { id: 'ctl-dr', control: 'Disaster recovery', status: 'COMPLIANT', evidence: 'DR failover tested monthly' },
];

// ---------------- deterministic seeding ----------------
function buildStatic(sec) {
  const rng = mulberry32(20270227);
  const now = S().meta.simNow || Date.now();
  const ago = (min) => now - min * 60000;

  // ---- nodes (§7) ----
  const nodeDefs = [
    ['NODE-0001', 'api-gw-01', 'API Gateway Primary', 'PRODUCTION', 'Cloud · Abuja Edge', 'API_GATEWAY', 'HEALTHY'],
    ['NODE-0002', 'api-gw-02', 'API Gateway Secondary', 'PRODUCTION', 'Cloud · Lagos Edge', 'API_GATEWAY', 'HEALTHY'],
    ['NODE-0003', 'app-srv-01', 'Application Server 01', 'PRODUCTION', 'Data Centre · Kano', 'APPLICATION', 'HEALTHY'],
    ['NODE-0004', 'app-srv-02', 'Application Server 02', 'PRODUCTION', 'Data Centre · Kano', 'APPLICATION', 'DEGRADED'],
    ['NODE-0005', 'app-srv-03', 'Application Server 03', 'PRODUCTION', 'Cloud · Lagos', 'APPLICATION', 'HEALTHY'],
    ['NODE-0006', 'db-cluster-01', 'Database Cluster Primary', 'PRODUCTION', 'Data Centre · Kano', 'DATABASE', 'HEALTHY'],
    ['NODE-0007', 'db-replica-02', 'Database Replica', 'PRODUCTION', 'Cloud · Abuja', 'DATABASE', 'HEALTHY'],
    ['NODE-0008', 'store-obj-01', 'Evidence Object Store', 'PRODUCTION', 'Data Centre · Kano', 'STORAGE', 'HEALTHY'],
    ['NODE-0009', 'cdn-edge-01', 'CDN Edge', 'PRODUCTION', 'Global Edge', 'CDN', 'HEALTHY'],
    ['NODE-0010', 'mon-srv-01', 'Monitoring & SIEM Node', 'PRODUCTION', 'Data Centre · Kano', 'MONITORING', 'HEALTHY'],
    ['NODE-0011', 'video-rtmp-01', 'Video Infrastructure', 'PRODUCTION', 'Data Centre · Kano', 'VIDEO', 'WARNING'],
    ['NODE-0012', 'irev-conn-01', 'IReV Watchtower Connector', 'PRODUCTION', 'Cloud · Abuja', 'IREV_CONNECTOR', 'HEALTHY'],
    ['NODE-0013', 'public-web-01', 'Public Domain Server', 'PRODUCTION', 'Cloud · Lagos Edge', 'PUBLIC', 'HEALTHY'],
    ['NODE-0014', 'internal-tools-01', 'Internal Tools (staging)', 'STAGING', 'Cloud · Abuja', 'INTERNAL', 'HEALTHY'],
  ];
  sec.nodes = nodeDefs.map(([id, host, role, env, region, kind, status]) => ({
    id, hostname: host, name: role, env, region, kind, status,
    cpu: ri(rng, 18, 62), memory: ri(rng, 30, 68), disk: ri(rng, 38, 71), netMbps: ri(rng, 40, 520),
    processHealth: 100, serviceHealth: 100, availability: 100, authStatus: 'OK',
    patchStatus: id === 'NODE-0004' ? 'PENDING_CRITICAL' : 'UP_TO_DATE',
    securityAgent: 'ACTIVE', lastCheck: ago(ri(rng, 1, 4)),
    services: kind === 'API_GATEWAY' ? ['nginx', 'gateway-core', 'rate-limiter'] : kind === 'DATABASE' ? ['postgres-16', 'replication', 'pgbouncer'] : kind === 'APPLICATION' ? ['app-api', 'workers', 'scheduler'] : kind === 'STORAGE' ? ['object-store', 'integrity-checker'] : kind === 'VIDEO' ? ['rtmp-relay', 'transcoder'] : kind === 'IREV_CONNECTOR' ? ['irev-sync', 'snapshot-store'] : ['core-service', 'health-agent'],
    events: [], vulnIds: [], lastBackup: now - 8 * 3600 * 1000, lastScan: ago(ri(rng, 20, 90)),
  }));

  // ---- APIs (§10) ----
  const apiDefs = [
    ['API-AUTH', 'Authentication API', 'IDENTITY', 4120], ['API-RESULTS', 'Results API', 'RESULTS', 2840],
    ['API-INCIDENT', 'Incident API', 'INCIDENTS', 960], ['API-EVIDENCE', 'Evidence API', 'EVIDENCE', 410],
    ['API-NOTIFICATION', 'Notification API', 'NOTIFICATIONS', 1330], ['API-AGENT', 'Agent Field API', 'FIELD', 2270],
    ['API-IREV', 'IReV Watchtower Connector', 'IREV', 620], ['API-PUBLIC', 'Public Data API', 'PUBLIC', 9800],
    ['API-CENTRAL', 'Central Command API', 'CENTRAL', 1720], ['API-ADMIN', 'Administration API', 'ADMIN', 190],
    ['API-LG', 'LG Supervisor API', 'LG', 890], ['API-SENATORIAL', 'Senatorial API', 'SENATORIAL', 470],
  ];
  sec.apis = apiDefs.map(([id, name, group, reqBase], i) => {
    const isPublic = id === 'API-PUBLIC';
    const rps = isPublic ? ri(rng, 95, 120) : Math.min(ri(rng, 8, 96), 90);
    return {
    id, name, group, requests: reqBase * ri(rng, 380, 520), requestsPerSec: rps,
    errors: ri(rng, 0, 24), errorRate: +(ri(rng, 2, 60) / 100).toFixed(2),
    latencyMs: ri(rng, 28, 190), authFailures: ri(rng, 0, 18), authzFailures: ri(rng, 0, 9),
    rateLimitEvents: ri(rng, 0, 18), threats: ri(rng, 0, 2), status: 'HEALTHY',
    availability: 100, tokensAnomalies: 0, suspiciousPatterns: [], version: 'v2.' + ri(rng, 1, 7) + '.' + ri(rng, 0, 4),
  };
  });
  sec.apis.find(a => a.id === 'API-PUBLIC').threats = 7;
  sec.apis.find(a => a.id === 'API-AUTH').authFailures = 42;

  // ---- vulnerabilities (§26) — individual records + portfolio scan counts ----
  sec.vulns = [
    { id: 'VUL-0001', cve: 'CVE-2026-11873', asset: 'NODE-0001', component: 'nginx proxy module', severity: 'CRITICAL', detectedAt: ago(12 * 60), fix: 'Upgrade nginx to 1.28.3', owner: 'Infrastructure Team', deadline: ago(-2 * 24 * 60), status: 'OPEN', riskAcceptance: null, evidence: 'Scanner finding SCN-8841, CVSS 9.8', cvss: 9.8 },
    { id: 'VUL-0002', cve: 'CVE-2026-05147', asset: 'NODE-0011', component: 'video transcoder runtime', severity: 'CRITICAL', detectedAt: ago(36 * 60), fix: 'Apply vendor patch 2026.08', owner: 'Infrastructure Team', deadline: ago(-1 * 24 * 60), status: 'OPEN', riskAcceptance: null, evidence: 'Scanner finding SCN-8812, CVSS 9.4', cvss: 9.4 },
    { id: 'VUL-0003', cve: 'CVE-2026-20971', asset: 'NODE-0006', component: 'OpenSSL 3.2', severity: 'HIGH', detectedAt: ago(30 * 60), fix: 'Upgrade OpenSSL to 3.2.9', owner: 'Database Team', deadline: ago(-3 * 24 * 60), status: 'IN_PROGRESS', riskAcceptance: null, evidence: 'Scanner finding SCN-8798, CVSS 8.1', cvss: 8.1 },
    { id: 'VUL-0004', cve: 'CVE-2026-30412', asset: 'NODE-0003', component: 'Node.js HTTP parser', severity: 'HIGH', detectedAt: ago(50 * 60), fix: 'Upgrade Node.js to 22.14 LTS', owner: 'Application Team', deadline: ago(-4 * 24 * 60), status: 'OPEN', riskAcceptance: null, evidence: 'Scanner finding SCN-8776, CVSS 7.8', cvss: 7.8 },
    { id: 'VUL-0005', cve: 'CVE-2025-99821', asset: 'NODE-0006', component: 'Redis 7.2 cache', severity: 'MEDIUM', detectedAt: ago(70 * 60), fix: 'Upgrade Redis to 7.2.6', owner: 'Database Team', deadline: ago(-10 * 24 * 60), status: 'ACCEPTED_RISK', riskAcceptance: 'Cache network-isolated; no external exposure', evidence: 'Scanner finding SCN-8744, CVSS 5.9', cvss: 5.9 },
    { id: 'VUL-0006', cve: 'CVE-2026-22115', asset: 'NODE-0004', component: 'kernel 6.8 (Kano DC)', severity: 'HIGH', detectedAt: ago(6 * 60), fix: 'Kernel upgrade + reboot window', owner: 'Infrastructure Team', deadline: ago(-2 * 24 * 60), status: 'OPEN', riskAcceptance: null, evidence: 'Scanner finding SCN-8902, CVSS 7.5', cvss: 7.5 },
    { id: 'VUL-0007', cve: 'CVE-2026-17702', asset: 'NODE-0013', component: 'TLS library (public edge)', severity: 'MEDIUM', detectedAt: ago(90 * 60), fix: 'Patch libssl', owner: 'Application Team', deadline: ago(-7 * 24 * 60), status: 'PATCHED', riskAcceptance: null, evidence: 'Patched 2026-08-20 09:12', cvss: 5.4, patchedAt: ago(26 * 60) },
    { id: 'VUL-0008', cve: 'CVE-2025-44662', asset: 'NODE-0008', component: 'object-store gateway', severity: 'LOW', detectedAt: ago(120 * 60), fix: 'Configuration hardening', owner: 'Infrastructure Team', deadline: ago(-14 * 24 * 60), status: 'PATCHED', riskAcceptance: null, evidence: 'Patched 2026-08-18 14:02', cvss: 3.1, patchedAt: ago(2 * 24 * 60) },
  ];
  sec.scanTotals = { critical: 2, high: 11, medium: 47, low: 83, patched: 219, total: 362 };
  sec.scanHistory = [362, 364, 360, 358, 359, 355, 352, 348, 344, 341, 338, 335, 332, 329, 326, 324, 320, 318, 315, 312].map((v, i) => ({ at: now - (19 - i) * 60 * 60000, open: v }));

  // ---- patches (§29) ----
  sec.patches = [
    { id: 'PT-0001', name: 'nginx 1.28.3 security update', target: 'NODE-0001,NODE-0002', status: 'PENDING', severity: 'CRITICAL', maintenanceWindow: '22:00–23:00 WAT', rebootRequired: false },
    { id: 'PT-0002', name: 'video transcoder vendor patch 2026.08', target: 'NODE-0011', status: 'PENDING', severity: 'CRITICAL', maintenanceWindow: '23:00–00:00 WAT', rebootRequired: true },
    { id: 'PT-0003', name: 'Node.js 22.14 LTS upgrade', target: 'NODE-0003,NODE-0004,NODE-0005', status: 'SCHEDULED', severity: 'HIGH', maintenanceWindow: '2026-08-23 00:00', rebootRequired: true },
    { id: 'PT-0004', name: 'kernel 6.8 security rollup', target: 'NODE-0004', status: 'PENDING', severity: 'HIGH', maintenanceWindow: '2026-08-24 01:00', rebootRequired: true },
    { id: 'PT-0005', name: 'OpenSSL 3.2.9', target: 'NODE-0006,NODE-0007', status: 'IN_PROGRESS', severity: 'HIGH', maintenanceWindow: 'in progress', rebootRequired: false },
    { id: 'PT-0006', name: 'libssl public-edge patch', target: 'NODE-0013', status: 'INSTALLED', severity: 'MEDIUM', maintenanceWindow: 'completed', rebootRequired: false },
    { id: 'PT-0007', name: 'os-security rollup 2026.08', target: 'all nodes', status: 'FAILED', severity: 'MEDIUM', maintenanceWindow: '2026-08-21 02:00', rebootRequired: false, failReason: 'Package conflict on NODE-0011 — retry scheduled' },
  ];

  // ---- configuration drift (§30) ----
  sec.drift = [
    { id: 'DRF-0001', target: 'API gateway rate-limit policy', before: '600 req/min per source', after: '420 req/min per source', who: 'engr.t.gwazo', when: ago(4 * 60), why: 'Election-day protective posture (approved change)', status: 'APPROVED' },
    { id: 'DRF-0002', target: 'Authentication session TTL', before: '12 hours', after: '8 hours', who: 'sys.auto (security policy)', when: ago(9 * 60), why: 'Election-day policy update', status: 'APPROVED' },
    { id: 'DRF-0003', target: 'WAF challenge threshold', before: '150 req/min', after: '90 req/min', who: 'engr.t.gwazo', when: ago(26 * 60), why: 'Pre-election hardening', status: 'APPROVED' },
    { id: 'DRF-0004', target: 'Public portal cache TTL', before: '60s', after: '30s', who: 'unknown (API-ADMIN token)', when: ago(2 * 60), why: 'No change ticket found', status: 'REVIEW', suspicious: true },
  ];

  // ---- file integrity (§31) ----
  sec.fileIntegrity = [
    { id: 'FIM-0001', path: '/etc/nginx/nginx.conf', hash: sha256('nginx-config-v17-' + 1), status: 'OK', lastCheck: ago(3), changes: [] },
    { id: 'FIM-0002', path: '/etc/ev/config/application.yml', hash: sha256('app-config-v12-' + 2), status: 'OK', lastCheck: ago(3), changes: [] },
    { id: 'FIM-0003', path: '/etc/ev/config/auth-policy.json', hash: sha256('auth-policy-v9-' + 3), status: 'CHANGED', lastCheck: ago(6), changes: [{ at: ago(6), kind: 'MODIFIED', detail: 'session TTL key updated (matches DRF-0002)' }] },
    { id: 'FIM-0004', path: '/etc/ev/config/firewall.rules', hash: sha256('fw-rules-v31-' + 4), status: 'OK', lastCheck: ago(3), changes: [] },
    { id: 'FIM-0005', path: '/etc/systemd/system/ev-api.service', hash: sha256('unit-v5-' + 5), status: 'OK', lastCheck: ago(3), changes: [] },
    { id: 'FIM-0006', path: '/srv/ev/keys/.checksum-store', hash: sha256('checksum-store-v2-' + 6), status: 'OK', lastCheck: ago(3), changes: [] },
    { id: 'FIM-0007', path: '/etc/cron.d/ev-backup', hash: sha256('cron-v4-' + 7), status: 'UNEXPECTED_NEW', lastCheck: ago(12), changes: [{ at: ago(12), kind: 'CREATED', detail: 'New cron entry referencing unknown script — under investigation' }] },
  ];

  // ---- database security (§32) ----
  sec.db = {
    availability: 100, connections: 84, maxConnections: 200, queryErrors: 3, authFailures: 1,
    privilegedQueries: 4, configChanges: 0, backupStatus: 'OK', replicationLagMs: 120,
    encryption: 'AES-256 AT REST · TLS IN TRANSIT', integrityChecks: 'PASSED',
    alerts: [
      { at: ago(42), text: 'Unusual privileged database access detected', severity: 'HIGH', actor: 'svc-bi-report', status: 'UNDER_REVIEW' },
      { at: ago(118), text: 'Authentication failures exceeded threshold', severity: 'MEDIUM', actor: 'app-node-02', status: 'RESOLVED' },
      { at: ago(300), text: 'Database backup failed', severity: 'HIGH', actor: 'backup-agent', status: 'RESOLVED' },
      { at: ago(540), text: 'Replication lag increased', severity: 'LOW', actor: 'db-replica-02', status: 'RESOLVED' },
    ],
  };

  // ---- evidence store security (§34) ----
  sec.evidence = {
    integrity: 'INTACT', filesTracked: 0, hashVerified: 0, failedVerification: 0,
    accessToday: 184, downloads: 12, exports: 3, unauthorizedModificationAttempts: 0,
    lastFullVerification: ago(52),
    events: [
      { at: ago(52), kind: 'VERIFICATION_PASSED', detail: 'Full hash verification passed on all stored evidence' },
      { at: ago(8 * 60), kind: 'EXPORT', detail: 'Audited export by auditor (scheduled review)' },
    ],
  };

  // ---- IReV security (§36) ----
  sec.irev = {
    connector: 'ONLINE', auth: 'OK', apiFailures: 0, unexpectedResponses: 2,
    sourceAvailability: 'AVAILABLE', ingestionIntegrity: 'VERIFIED', snapshotStorage: 'HEALTHY',
    hashVerification: 'PASSING', notes: ['Connector uses official public observation methods only — no bypass of IReV security controls.'],
    events: [{ at: ago(210), text: 'IReV source rate-limit event (429) — connector backed off per policy', severity: 'LOW', status: 'RESOLVED' }],
  };

  // ---- public domain security (§37/38/39) ----
  sec.public = {
    requests: 4284410, blocked: 12482, challenged: 2310, rateLimited: 1864, allowed: 4267754,
    wafCategories: [
      { label: 'Malicious traffic', value: 3124 }, { label: 'Automated traffic', value: 6912 },
      { label: 'Suspicious requests', value: 1942 }, { label: 'Policy violations', value: 504 },
    ],
    botActivity: 8412, errorSpikes: 2, ddosIndicators: 0, availability: 100, cdnStatus: 'ONLINE',
    trafficSeries: Array.from({ length: 48 }, (_, i) => ({ at: now - (47 - i) * 300000, rps: ri(rng, 240, 520) })),
    rateLimitSources: [{ source: '185.220.101.34', at: ago(220), minutes: 30, by: 'RULE-0001' }],
  };

  // ---- network (§40/41) ----
  sec.network = {
    connectivity: 'OK', serviceTraffic: 'NORMAL', dnsHealth: 'OK',
    firewallEvents: [{ at: ago(75), text: 'Firewall policy updated (DRF-0004 review)', severity: 'MEDIUM', status: 'REVIEW' }],
    unusualConnections: 1,
    tls: [
      { id: 'TLS-0001', domain: 'api.ev2027.ng', expiry: now + 14 * 24 * 3600 * 1000, status: 'EXPIRING_SOON', issuer: 'Let\u2019s Encrypt R11' },
      { id: 'TLS-0002', domain: 'portal.ev2027.ng', expiry: now + 210 * 24 * 3600 * 1000, status: 'VALID', issuer: 'Sectigo RSA DV' },
      { id: 'TLS-0003', domain: 'internal.ev2027.ng', expiry: now + 410 * 24 * 3600 * 1000, status: 'VALID', issuer: 'Internal CA (EV-PKI-01)' },
    ],
  };

  // ---- secrets (§42/43) ----
  sec.secrets = [
    { id: 'SECRET-0001', ref: 'API-GW-SIGNING-KEY', kind: 'API key', location: 'vault:secret/ev/gateway', status: 'ACTIVE', rotatedAt: ago(9 * 24 * 60), nextRotation: now + 21 * 24 * 3600 * 1000, masked: '••••••••••••' },
    { id: 'SECRET-0002', ref: 'DB-SERVICE-ACCOUNT', kind: 'Service credential', location: 'vault:secret/ev/db', status: 'ACTIVE', rotatedAt: ago(31 * 24 * 60), nextRotation: now + 59 * 24 * 3600 * 1000, masked: '••••••••••••' },
    { id: 'SECRET-0003', ref: 'IREV-CONNECTOR-TOKEN', kind: 'Token', location: 'vault:secret/ev/irev', status: 'ACTIVE', rotatedAt: ago(14 * 24 * 60), nextRotation: now + 16 * 24 * 3600 * 1000, masked: '••••••••••••' },
    { id: 'SECRET-0004', ref: 'EVIDENCE-ENC-KEY', kind: 'Encryption key', location: 'HSM slot 3', status: 'ACTIVE', rotatedAt: ago(2 * 24 * 60), nextRotation: now + 28 * 24 * 3600 * 1000, masked: '••••••••••••' },
    { id: 'SECRET-0005', ref: 'CDN-PURGE-CREDENTIAL', kind: 'Service credential', location: 'vault:secret/ev/cdn', status: 'ACTIVE', rotatedAt: ago(47 * 24 * 60), nextRotation: now + 13 * 24 * 3600 * 1000, masked: '••••••••••••' },
    { id: 'SECRET-0006', ref: 'SMS-PROVIDER-APIKEY', kind: 'API key', location: 'vault:secret/ev/sms', status: 'REVOKED', rotatedAt: ago(1 * 24 * 60), nextRotation: null, masked: '••••••••••••', revokedReason: 'Rotated after provider breach advisory' },
    { id: 'SECRET-0007', ref: 'VIDEO-RTMP-KEY', kind: 'Token', location: 'vault:secret/ev/video', status: 'ACTIVE', rotatedAt: ago(70 * 24 * 60), nextRotation: now - 10 * 24 * 3600 * 1000, masked: '••••••••••••', overdue: true },
    { id: 'SECRET-0008', ref: 'INTERNAL-CA-KEY', kind: 'Certificate', location: 'HSM slot 1', status: 'ACTIVE', rotatedAt: ago(360 * 24 * 60), nextRotation: now + 5 * 24 * 3600 * 1000, masked: '••••••••••••' },
  ];
  sec.secretLeaks = [
    { id: 'LEAK-0001', at: ago(96), surface: 'Application log (auth-service)', ref: 'SECRET-0006', status: 'REMEDIATED', detail: 'Masked provider key observed in verbose log line; secret revoked & rotated; log redaction enabled.' },
    { id: 'LEAK-0002', at: ago(7), surface: 'Error message (public API)', ref: 'SECRET-0003', status: 'INVESTIGATING', detail: 'Potential token fragment in stack trace of an error response — exposure contained, rotation pending approval.' },
  ];

  // ---- automation rules (§46) ----
  sec.automation = [
    { id: 'RULE-0001', name: 'Authentication-failure spike', enabled: true, runs: 14, lastRun: ago(220), when: 'Authentication failures exceed threshold', then: ['Rate-limit source', 'Create security alert', 'Notify analyst'] },
    { id: 'RULE-0002', name: 'Evidence integrity mismatch', enabled: true, runs: 0, lastRun: null, when: 'Evidence integrity mismatch detected', then: ['Freeze affected record', 'Preserve snapshot', 'Create CRITICAL case', 'Notify security lead'] },
    { id: 'RULE-0003', name: 'Node CRITICAL > 5 min', enabled: false, runs: 0, lastRun: null, when: 'Node CRITICAL for more than 5 minutes', then: ['Isolate node (requires approval)', 'Notify incident commander'] },
    { id: 'RULE-0004', name: 'Public traffic spike > 300%', enabled: true, runs: 1, lastRun: ago(480), when: 'Public traffic spike > 300% of baseline', then: ['Enable challenge mode', 'Notify communications officer'] },
  ];

  // ---- threat intelligence (§23/24) ----
  sec.threatIntel = [
    { id: 'THR-0001', indicator: '185.220.101.34', type: 'MALICIOUS_IP', severity: 'HIGH', status: 'BLOCKED', firstSeen: ago(3000), lastSeen: ago(40), events: 38, note: 'Credential-stuffing source' },
    { id: 'THR-0002', indicator: '91.240.118.0/24', type: 'SUSPICIOUS_NETWORK', severity: 'MEDIUM', status: 'UNDER_INVESTIGATION', firstSeen: ago(1440), lastSeen: ago(12), events: 12, note: 'Unusual geographic access pattern' },
    { id: 'THR-0003', indicator: 'ev2027-login-check[.]top', type: 'SUSPICIOUS_DOMAIN', severity: 'HIGH', status: 'BLOCKED', firstSeen: ago(2000), lastSeen: ago(180), events: 9, note: 'Lookalike domain' },
    { id: 'THR-0004', indicator: 'sha256:9f4e…b12a', type: 'MALWARE_INDICATOR', severity: 'MEDIUM', status: 'ACTIVE', firstSeen: ago(600), lastSeen: ago(60), events: 2, note: 'Match on video transcode node — being verified' },
    { id: 'THR-0005', indicator: 'ua:BOT/0.9 (legacy-crawler)', type: 'BOT_ACTIVITY', severity: 'LOW', status: 'RESOLVED', firstSeen: ago(4000), lastSeen: ago(900), events: 210, note: 'Rate-limited legacy crawler' },
    { id: 'THR-0006', indicator: '103.5.140.9', type: 'FALSE_POSITIVE', severity: 'LOW', status: 'FALSE_POSITIVE', firstSeen: ago(700), lastSeen: ago(300), events: 4, note: 'Verified staff VPN egress' },
  ];

  // ---- correlation (§25) ----
  sec.correlation = [
    { id: 'COR-0001', name: 'HIGH-RISK SESSION', inputs: ['Failed login (×4)', 'New device', 'Unusual location (Lagos edge)', 'Privileged action (report export)'], verdict: 'HIGH', risk: 82, at: ago(58), status: 'OPEN', why: 'Identity signals clustered within 6 minutes on one session — step-up authentication enforced.' },
    { id: 'COR-0002', name: 'API ABUSE PATTERN', inputs: ['Rate-limit events (×9)', 'Auth failures (×17)', 'Same UA fingerprint'], verdict: 'MEDIUM', risk: 64, at: ago(140), status: 'OPEN', why: 'Token anomalies + repeated 401s from one source — rate-limited.' },
    { id: 'COR-0003', name: 'EVIDENCE ACCESS CLUSTER', inputs: ['Privileged evidence export', 'Off-hours access', 'Unusual volume'], verdict: 'REVIEW', risk: 45, at: ago(300), status: 'CLOSED', why: 'Verified scheduled audit export by auditor role.' },
  ];

  // ---- security cases (§21) — 7 active + history ----
  const caseDefs = [
    ['Credential-stuffing attempt on Authentication API', 'API', 'MEDIUM', 'ASSIGNED', 'API-AUTH', 210, 'socanalyst'],
    ['Sustained bot traffic against Public Portal', 'PUBLIC', 'MEDIUM', 'INVESTIGATING', 'NODE-0013', 175, 'socanalyst'],
    ['Suspicious session with privileged export', 'IDENTITY', 'HIGH', 'INVESTIGATING', 'API-ADMIN', 140, 'socanalyst'],
    ['Possible malware indicator on video node', 'INFRASTRUCTURE', 'MEDIUM', 'TRIAGED', 'NODE-0011', 96, null],
    ['Configuration change without change ticket', 'INFRASTRUCTURE', 'MEDIUM', 'DETECTED', 'NODE-0002', 62, null],
    ['Unusual privileged database access', 'DATABASE', 'MEDIUM', 'CONTAINMENT', 'NODE-0006', 175, 'socanalyst'],
    ['Replication lag & failed backup', 'DATABASE', 'MEDIUM', 'RECOVERY', 'NODE-0007', 30, 'socanalyst'],
  ];
  sec.incidents = caseDefs.map(([title, category, severity, status, affected, minAgo, analyst], i) => {
    const created = ago(minAgo);
    const flowIdx = CASE_FLOW.indexOf(status);
    const timeline = CASE_FLOW.slice(0, flowIdx + 1).map((step, j) => ({ at: created + j * ri(rng, 3, 12) * 60000, step, note: j === 0 ? 'Detection engine alert' : j === 1 ? 'Triaged by SOC analyst' : j === 2 ? 'Assigned to analyst' : 'Automated workflow step' }));
    return {
      id: 'sec-' + (i + 1), code: `SEC-2027-00041${i + 1}`, title, category, severity, status, affectedService: affected,
      detectedAt: created, createdAt: created, analyst: analyst || 'unassigned', source: ['AUTH TELEMETRY', 'WAF', 'SESSION MONITOR', 'EDR', 'DRIFT DETECTOR', 'DB MONITOR', 'DB MONITOR'][i],
      evidence: [], timeline, relatedEvents: [], actions: [], comms: [], recovery: null,
    };
  });
  // closed history for KPIs
  const closedDefs = [
    ['Failed login burst (minor)', 'IDENTITY', 'LOW', 26 * 60, 8, 14, 20, 26],
    ['DNS resolution anomaly', 'NETWORK', 'MEDIUM', 9 * 60, 6, 12, 30, 55],
    ['Public portal error spike', 'PUBLIC', 'LOW', 31 * 60, 4, 9, 18, 40],
    ['Expired staging certificate', 'NETWORK', 'LOW', 52 * 60, 11, 15, 34, 71],
  ];
  for (const [title, category, severity, hAgo, det, ack, cont, rec] of closedDefs) {
    const created = now - hAgo * 3600 * 1000;
    sec.incidents.push({
      id: 'sec-closed-' + title.slice(0, 6) + hAgo, code: 'SEC-2027-000' + (3800 + hAgo), title, category, severity,
      status: 'CLOSED', affectedService: 'VARIOUS', detectedAt: created, createdAt: created, analyst: 'socanalyst', source: 'DETECTION ENGINE',
      evidence: [], timeline: [
        { at: created, step: 'DETECTED', note: 'Detection engine alert' },
        { at: created + det * 60000, step: 'TRIAGED', note: 'Triaged by SOC analyst' },
        { at: created + ack * 60000, step: 'ASSIGNED', note: 'Assigned to analyst' },
        { at: created + cont * 60000, step: 'CONTAINMENT', note: 'Containment applied' },
        { at: created + rec * 60000, step: 'RECOVERY', note: 'Recovered' },
        { at: created + (rec + 12) * 60000, step: 'CLOSED', note: 'Validated & closed' },
      ], relatedEvents: [], actions: [], comms: [], recovery: { validatedAt: created + (rec + 12) * 60000 },
    });
  }

  // ---- alerts (§19) ----
  const alertDefs = [
    ['CRITICAL', 'VULNERABILITY', 'CRITICAL vulnerability CVE-2026-11873 unpatched', 'NODE-0001', 12 * 60],
    ['CRITICAL', 'VULNERABILITY', 'CRITICAL vulnerability CVE-2026-05147 unpatched', 'NODE-0011', 11 * 60],
    ['HIGH', 'INFRASTRUCTURE', 'Possible malware indicator on video node', 'NODE-0011', 96],
    ['HIGH', 'IDENTITY', 'Suspicious session detected', 'API-ADMIN', 58],
    ['HIGH', 'API', 'Authentication failure spike', 'API-AUTH', 46],
    ['HIGH', 'PUBLIC', 'Bot traffic above threshold', 'NODE-0013', 140],
    ['HIGH', 'DATABASE', 'Unusual privileged database access', 'NODE-0006', 175],
    ['HIGH', 'EVIDENCE', 'Scheduled evidence integrity verification due', 'NODE-0008', 250],
    ['MEDIUM', 'NETWORK', 'TLS certificate expiring in 14 days', 'TLS-0001', 14],
    ['MEDIUM', 'CONFIGURATION', 'CONFIGURATION CHANGE DETECTED (no ticket)', 'NODE-0002', 62],
    ['MEDIUM', 'API', 'Rate-limit events above baseline', 'API-PUBLIC', 96],
    ['MEDIUM', 'IREV', 'IReV connector unexpected response pattern', 'API-IREV', 78],
    ['LOW', 'APPLICATION', 'New device sign-in (known user)', 'API-AUTH', 22],
    ['LOW', 'NETWORK', 'Firewall policy change logged', 'NODE-0001', 75],
    ['INFORMATIONAL', 'INFRASTRUCTURE', 'Scheduled vulnerability scan started', 'NODE-0010', 8],
  ];
  sec.alerts = alertDefs.map(([severity, category, title, target, minAgo], i) => ({
    id: 'alert-' + (i + 1), code: `SEC-ALERT-2027-${String(i + 1).padStart(4, '0')}`, severity, category, title,
    target, createdAt: ago(minAgo), status: i % 3 === 0 ? 'OPEN' : (i % 3 === 1 ? 'ACK' : 'OPEN'), ackBy: null,
  }));

  // ---- events (§18) — recent stream ----
  const evDefs = [
    ['Failed authentication spike', 'IDENTITY', 'HIGH', 'API-AUTH', 3], ['API rate-limit triggered', 'API', 'MEDIUM', 'API-PUBLIC', 9],
    ['Suspicious session detected', 'IDENTITY', 'HIGH', 'API-ADMIN', 12], ['Endpoint security warning', 'API', 'MEDIUM', 'API-CENTRAL', 19],
    ['Node vulnerability discovered', 'VULNERABILITY', 'HIGH', 'NODE-0011', 26], ['CONFIGURATION CHANGE DETECTED', 'CONFIGURATION', 'MEDIUM', 'NODE-0002', 62],
    ['Evidence hash verification passed', 'EVIDENCE', 'INFORMATIONAL', 'NODE-0008', 45], ['WAF blocked malicious request', 'PUBLIC', 'LOW', 'NODE-0013', 41],
    ['Firewall policy event', 'NETWORK', 'LOW', 'NODE-0001', 75], ['IReV connector sync completed', 'IREV', 'INFORMATIONAL', 'API-IREV', 38],
    ['Database backup completed', 'DATABASE', 'INFORMATIONAL', 'NODE-0006', 120], ['New device sign-in', 'IDENTITY', 'LOW', 'API-AUTH', 22],
  ];
  sec.events = evDefs.map(([title, category, severity, target, minAgo], i) => ({
    id: uuid(), code: `SEC-EV-2027-${String(9000 - i)}`, title, category, severity, source: target, createdAt: ago(minAgo),
    detail: `Event recorded by ${['SENTINEL DETECTION ENGINE', 'WAF', 'SESSION MONITOR', 'SIEM', 'DRIFT DETECTOR', 'EDR', 'BACKUP AGENT'][i % 7]}`,
    nodeId: target.startsWith('NODE') ? target : null, apiId: target.startsWith('API') ? target : null,
  }));

  // ---- privileged sessions (§15) ----
  sec.sessions = [
    { id: 'SES-0001', user: 'engr.t.gwazo', role: 'API Security Engineer', loginAt: ago(240), device: 'Workstation KN-ADM-12', ip: '10.14.3.21 (VPN)', privilegedActions: 12, riskStatus: 'NORMAL', active: true },
    { id: 'SES-0002', user: 'dr.k.adeyemi', role: 'Security Director', loginAt: ago(95), device: 'MacBook Pro', ip: '10.14.2.8 (VPN)', privilegedActions: 3, riskStatus: 'NORMAL', active: true },
    { id: 'SES-0003', user: 'soc.analyst.02', role: 'SOC Analyst', loginAt: ago(70), device: 'Workstation KN-SOC-03', ip: '10.14.3.30 (VPN)', privilegedActions: 7, riskStatus: 'NORMAL', active: true },
    { id: 'SES-0004', user: 'svc-bi-report', role: 'Service (reporting)', loginAt: ago(50), device: 'service-account', ip: '10.14.9.2 (internal)', privilegedActions: 1, riskStatus: 'ELEVATED', active: true, riskNote: 'Off-hours privileged database query' },
    { id: 'SES-0005', user: 'infra.oncall', role: 'Infrastructure Engineer', loginAt: ago(1800), device: 'Workstation KN-INF-01', ip: '10.14.3.17 (VPN)', privilegedActions: 0, riskStatus: 'NORMAL', active: false },
  ];

  // ---- identity metrics (§14) ----
  sec.identity = {
    loginAttempts: 1840, failedLogins: 14, mfaEvents: 1840, passwordResets: 4,
    sessionsCreated: 340, sessionsTerminated: 296, privilegeChanges: 2,
    newDevices: 9, suspiciousSessions: 1, dormantAccounts: 3,
    series: Array.from({ length: 24 }, (_, i) => ({ at: now - (23 - i) * 3600 * 1000, logins: ri(rng, 40, 140), failures: ri(rng, 0, 9) })),
  };

  // ---- backups (§72) ----
  sec.backup = {
    lastBackup: now - 2 * 3600 * 1000, integrity: 'VERIFIED', recoveryPoint: 'RPO 15 min', replication: 'OK',
    drStatus: 'READY', restoreTest: 'PASSED (2026-08-15)', backupSuccess: 99.2,
    jobs: [
      { at: now - 2 * 3600 * 1000, kind: 'FULL', result: 'SUCCESS' },
      { at: now - 26 * 3600 * 1000, kind: 'FULL', result: 'SUCCESS' },
      { at: now - 50 * 3600 * 1000, kind: 'INCREMENTAL', result: 'SUCCESS' },
      { at: now - 74 * 3600 * 1000, kind: 'INCREMENTAL', result: 'FAILED', note: 'retried successfully 40 min later' },
    ],
  };

  // ---- risk register (§58) ----
  sec.risks = [
    { id: 'RSK-0001', risk: 'DDoS against public portal on results night', asset: 'NODE-0013', probability: 'HIGH', impact: 'HIGH', score: 16, owner: 'API Security Engineer', treatment: 'MITIGATE' },
    { id: 'RSK-0002', risk: 'Credential-stuffing against Authentication API', asset: 'API-AUTH', probability: 'MEDIUM', impact: 'HIGH', score: 12, owner: 'SOC Analyst', treatment: 'MITIGATE' },
    { id: 'RSK-0003', risk: 'Evidence store tampering attempt', asset: 'NODE-0008', probability: 'LOW', impact: 'CRITICAL', score: 10, owner: 'Security Director', treatment: 'MITIGATE' },
    { id: 'RSK-0004', risk: 'Unpatched CRITICAL vulnerability exploited', asset: 'NODE-0001', probability: 'MEDIUM', impact: 'HIGH', score: 12, owner: 'Infrastructure Team', treatment: 'MITIGATE' },
    { id: 'RSK-0005', risk: 'Insider misuse of privileged access', asset: 'ALL', probability: 'LOW', impact: 'HIGH', score: 8, owner: 'Security Director', treatment: 'MITIGATE' },
    { id: 'RSK-0006', risk: 'SMS provider outage (alerts)', asset: 'EXTERNAL', probability: 'MEDIUM', impact: 'LOW', score: 6, owner: 'Operations', treatment: 'ACCEPT' },
    { id: 'RSK-0007', risk: 'IReV connector provider maintenance', asset: 'API-IREV', probability: 'MEDIUM', impact: 'LOW', score: 6, owner: 'IReV Analyst', treatment: 'TRANSFER' },
  ];

  // ---- application coverage (§65) ----
  sec.appCoverage = [
    { app: 'AGENT APP', api: 'API-AGENT', availability: 99.4, auth: 'MFA', apiHealth: 'HEALTHY', errorRate: 0.4, events: 3, version: '4.3.1', vulns: 0, deps: 'CLEAN' },
    { app: 'LG SUPERVISOR', api: 'API-LG', availability: 99.8, auth: 'MFA', apiHealth: 'HEALTHY', errorRate: 0.2, events: 1, version: '2.6.0', vulns: 0, deps: 'CLEAN' },
    { app: 'SENATORIAL PORTAL', api: 'API-SENATORIAL', availability: 99.7, auth: 'MFA', apiHealth: 'HEALTHY', errorRate: 0.3, events: 2, version: '2.4.2', vulns: 1, deps: '1 MEDIUM (patched)' },
    { app: 'CENTRAL SITUATION ROOM', api: 'API-CENTRAL', availability: 99.9, auth: 'MFA', apiHealth: 'HEALTHY', errorRate: 0.2, events: 5, version: '3.9.4', vulns: 0, deps: 'CLEAN' },
    { app: 'IReV WATCHTOWER', api: 'API-IREV', availability: 99.5, auth: 'SERVICE TOKEN', apiHealth: 'HEALTHY', errorRate: 0.6, events: 2, version: '1.8.1', vulns: 0, deps: 'CLEAN' },
    { app: 'PUBLIC ELECTION DOMAIN', api: 'API-PUBLIC', availability: 99.9, auth: 'NONE (read-only)', apiHealth: 'HEALTHY', errorRate: 0.3, events: 12, version: '2.2.0', vulns: 1, deps: '1 LOW (accepted)' },
    { app: 'PUBLIC DATA API', api: 'API-PUBLIC', availability: 99.9, auth: 'KEY (open data)', apiHealth: 'HEALTHY', errorRate: 0.2, events: 4, version: '2.2.0', vulns: 0, deps: 'CLEAN' },
  ];

  sec.actions = [];
  sec.breakglass = [];
  sec.caseComms = [];
  sec.auditSec = [];
  sec.threatOverrides = [];
  sec.electionDay = true;
  sec.electionPriorities = ['Availability', 'Evidence integrity', 'Authentication', 'API security', 'Incident response', 'Public platform availability', 'IReV monitoring integrity'];
  sec.lastScan = ago(ri(rng, 10, 40));
  sec.rateLimitConfig = { requestsPerSec: 420, blockedSources: 0, protectionLevel: 'ELECTION_DAY', maintenanceMode: false };
  sec.attackSurface = { monitoredApps: 7, monitoredApis: 12, monitoredNodes: 14, monitoredSecrets: 8, monitoredFiles: 7 };
  computeThreatLevel(sec);
}

function ensureInitialized() {
  const st = S();
  if (!st.security) st.security = {};
  if (!st.security.initialized) {
    buildStatic(st.security);
    st.security.initialized = true;
    set(() => {});
  }
}

const cfg = () => { ensureInitialized(); return S().security; };

// ---------------- immutable security audit (§68) ----------------
function secAudit(entry) {
  const sec = cfg();
  sec.auditSec.push({ id: uuid(), at: S().meta.simNow || Date.now(), ...entry });
  if (sec.auditSec.length > 4000) sec.auditSec = sec.auditSec.slice(-4000);
  set(() => {});
}

// ---------------- event emission ----------------
function emit(title, category, severity, source, detail, meta = {}) {
  const sec = cfg();
  const ev = {
    id: uuid(), code: nextCode(S(), 'secEvent'), title, category, severity, source,
    detail: detail || 'Event recorded by SENTINEL DETECTION ENGINE',
    createdAt: S().meta.simNow || Date.now(), ...meta,
  };
  sec.events.unshift(ev);
  if (sec.events.length > 1200) sec.events.length = 1200;
  if (['HIGH', 'CRITICAL'].includes(severity)) {
    sec.alerts.unshift({
      id: uuid(), code: nextCode(S(), 'secAlert'), severity, category, title, target: source,
      createdAt: ev.createdAt, status: 'OPEN', ackBy: null,
    });
    if (sec.alerts.length > 600) sec.alerts.length = 600;
  }
  runAutomation(category, severity, { ...meta, title, source });
  set(() => {});
  return ev;
}

// ---------------- threat level (§5) — explicit rules, no unexplained score ----------------
function computeThreatLevel(sec) {
  const now = S().meta.simNow || Date.now();
  const basis = [];
  const open = sec.incidents.filter(i => !['CLOSED'].includes(i.status));
  const critOpen = open.filter(i => i.severity === 'CRITICAL');
  const highOpen = open.filter(i => i.severity === 'HIGH');
  const hourAgo = now - 3600 * 1000;
  const critAlerts1h = sec.alerts.filter(a => a.severity === 'CRITICAL' && a.createdAt >= hourAgo).length;
  const highAlerts1h = sec.alerts.filter(a => a.severity === 'HIGH' && a.createdAt >= hourAgo).length;
  const authSpike = sec.identity && sec.identity.failedLogins >= 30;
  const evidenceBreach = sec.evidence && sec.evidence.integrity === 'BREACHED';
  const critNodes = sec.nodes.filter(n => n.status === 'CRITICAL' || n.status === 'OFFLINE').length;
  const overdueCrit = sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN' && v.deadline < now).length;
  let level = 'NORMAL';
  if (critOpen.length > 0) { level = 'CRITICAL'; basis.push(`${critOpen.length} open CRITICAL security case(s)`); }
  else if (evidenceBreach) { level = 'CRITICAL'; basis.push('Evidence integrity breach active'); }
  else if (critNodes >= 3) { level = 'CRITICAL'; basis.push(`${critNodes} node(s) CRITICAL/OFFLINE`); }
  else if (highOpen.length >= 3) { level = 'HIGH'; basis.push(`${highOpen.length} open HIGH security case(s)`); }
  else if (critAlerts1h >= 3 || overdueCrit >= 3) { level = 'HIGH'; basis.push(overdueCrit >= 3 ? 'Overdue CRITICAL vulnerabilities' : 'CRITICAL alert volume'); }
  else if (highAlerts1h >= 3 || authSpike || critNodes >= 1) { level = 'ELEVATED'; basis.push(authSpike ? 'Authentication-failure spike' : 'Multiple security anomalies'); }
  else if (highAlerts1h >= 1 || sec.alerts.filter(a => a.severity === 'MEDIUM' && a.createdAt >= hourAgo).length >= 2) { level = 'GUARDED'; basis.push('Minor suspicious activity under review'); }
  else basis.push('No significant active threats');
  // analyst decision may raise the level but a lower override needs a written reason
  if (sec.threatOverrides && sec.threatOverrides.length) {
    const ov = sec.threatOverrides[sec.threatOverrides.length - 1];
    const idx = THREAT_LEVELS.indexOf(level), oidx = THREAT_LEVELS.indexOf(ov.level);
    if (oidx > idx || (oidx < idx && ov.reason && ov.reason.length >= 8)) {
      level = ov.level;
      basis.unshift(`Analyst decision: ${ov.level} — ${ov.reason} (${ov.user})`);
    }
  }
  sec.threatLevel = level;
  sec.threatBasis = basis;
  return { level, basis };
}

// ---------------- posture (§4) — every domain traceable to its evidence ----------------
function posture(sec) {
  const now = S().meta.simNow || Date.now();
  const n = sec.nodes.length;
  const nodeScore = Math.round(Math.max(20, 100 - sec.nodes.filter(x => x.status === 'DEGRADED').length * 1.5 - sec.nodes.filter(x => x.status === 'WARNING').length * 3 - sec.nodes.filter(x => ['CRITICAL', 'OFFLINE'].includes(x.status)).length * 20 - sec.nodes.filter(x => ['ISOLATED', 'BLOCKED'].includes(x.status)).length * 25));
  const apiErr = sec.apis.reduce((a, x) => a + x.errorRate, 0) / sec.apis.length;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const apiScore = Math.round(clamp(100 - apiErr * 4 - Math.min(3, sec.apis.reduce((a, x) => a + x.authFailures, 0) / 40), 60, 100));
  const mfaPct = S().users.length ? Math.round(S().users.filter(u => u.mfa).length / S().users.length * 100) : 100;
  const identScore = Math.round(clamp(mfaPct - Math.min(20, (sec.identity?.failedLogins || 0) * 0.4) - (sec.identity?.suspiciousSessions || 0) * 2, 50, 100));
  const appScore = Math.round(sec.appCoverage.reduce((a, x) => a + x.availability, 0) / sec.appCoverage.length * 0.96);
  const dbScore = sec.db.availability >= 99.9 && sec.db.replicationLagMs < 1000 ? 98 : 80;
  const evScore = sec.evidence.integrity === 'INTACT' ? 99 : 20;
  const netScore = Math.round(clamp(97 - (sec.network.unusualConnections ? 4 : 0) - (sec.network.tls.some(t => t.status === 'EXPIRING_SOON') ? 2 : 0), 40, 100));
  const overdueCrit = sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN' && v.deadline < now).length;
  const openHigh = sec.vulns.filter(v => v.severity === 'HIGH' && v.status === 'OPEN').length;
  const vulnScore = Math.round(clamp(96 - overdueCrit * 2 - Math.min(6, openHigh * 2), 30, 100));
  const monScore = 97;
  const bakScore = sec.backup.backupSuccess >= 99 ? 99 : 85;
  const domains = [
    { id: 'infra', label: 'Infrastructure', score: nodeScore, weight: 0.15, evidence: { nodes: n, healthy: sec.nodes.filter(x => x.status === 'HEALTHY').length, degraded: sec.nodes.filter(x => x.status === 'DEGRADED').length, warning: sec.nodes.filter(x => x.status === 'WARNING').length, critical: sec.nodes.filter(x => x.status === 'CRITICAL').length } },
    { id: 'api', label: 'API Security', score: apiScore, weight: 0.13, evidence: { apis: sec.apis.length, errors: sec.apis.reduce((a, x) => a + x.errors, 0), authFailures: sec.apis.reduce((a, x) => a + x.authFailures, 0), rateLimitEvents: sec.apis.reduce((a, x) => a + x.rateLimitEvents, 0) } },
    { id: 'identity', label: 'Identity', score: identScore, weight: 0.10, evidence: { mfaCoverage: mfaPct, failedLogins: sec.identity?.failedLogins || 0, suspiciousSessions: sec.identity?.suspiciousSessions || 0 } },
    { id: 'app', label: 'Application', score: appScore, weight: 0.10, evidence: { apps: sec.appCoverage.length, avgAvailability: (sec.appCoverage.reduce((a, x) => a + x.availability, 0) / sec.appCoverage.length).toFixed(1) } },
    { id: 'db', label: 'Database', score: dbScore, weight: 0.08, evidence: { availability: sec.db.availability, replicationLagMs: sec.db.replicationLagMs, connections: sec.db.connections } },
    { id: 'evidence', label: 'Evidence Store', score: evScore, weight: 0.10, evidence: { integrity: sec.evidence.integrity, hashVerified: sec.evidence.hashVerified, failures: sec.evidence.failedVerification } },
    { id: 'network', label: 'Network', score: netScore, weight: 0.08, evidence: { connectivity: sec.network.connectivity, dns: sec.network.dnsHealth, unusualConnections: sec.network.unusualConnections } },
    { id: 'vuln', label: 'Vulnerability', score: vulnScore, weight: 0.09, evidence: { critical: sec.scanTotals.critical, high: sec.scanTotals.high, medium: sec.scanTotals.medium, low: sec.scanTotals.low, patched: sec.scanTotals.patched } },
    { id: 'monitoring', label: 'Monitoring', score: monScore, weight: 0.07, evidence: { siem: 'ONLINE', collectors: 12, lastScan: sec.lastScan } },
    { id: 'backup', label: 'Backup', score: bakScore, weight: 0.10, evidence: { lastBackup: sec.backup.lastBackup, integrity: sec.backup.integrity, restoreTest: sec.backup.restoreTest } },
  ];
  const total = Math.round(domains.reduce((a, d) => a + d.score * d.weight, 0));
  return { total, domains, basis: 'Weighted aggregation of ten monitored domains. Each domain score is computed from explicit rules over live telemetry — click any domain for its underlying evidence.' };
}

// ---------------- automation (§46) ----------------
function runAutomation(category, severity, meta) {
  const sec = cfg();
  const now = S().meta.simNow || Date.now();
  for (const rule of sec.automation) {
    if (!rule.enabled) continue;
    let fire = false;
    if (rule.id === 'RULE-0001' && category === 'IDENTITY' && severity === 'HIGH') fire = true;
    if (rule.id === 'RULE-0002' && category === 'EVIDENCE' && severity === 'CRITICAL') fire = true;
    if (rule.id === 'RULE-0004' && category === 'PUBLIC' && severity === 'HIGH') fire = true;
    if (!fire) continue;
    rule.runs = (rule.runs || 0) + 1; rule.lastRun = now;
    sec.auditSec.push({ id: uuid(), at: now, who: 'AUTOMATION', what: `RULE ${rule.id} ${rule.name}`, when: fmtWat(now), where: 'SENTINEL ENGINE', target: meta.source || 'n/a', before: null, after: 'defensive actions applied', why: rule.when, approval: 'PRE-AUTHORIZED RULE', result: rule.then.join('; ') });
    if (rule.id === 'RULE-0002') {
      // §71 failsafe: preserve evidence BEFORE remediation
      sec.evidence.events.unshift({ at: now, kind: 'PRESERVED', detail: 'Snapshot preserved before any remediation', by: 'RULE-0002' });
      if (meta.recordId) sec.evidence.frozen = (sec.evidence.frozen || []).concat([{ recordId: meta.recordId, frozenAt: now, by: 'RULE-0002' }]);
      const cse = openIncidentInternal('Evidence integrity event (automated)', 'EVIDENCE', 'CRITICAL', 'NODE-0008', 'Evidence hash mismatch detected — record frozen, snapshot preserved. Human review required.');
      notify(['secdirector'], '🚨 SENTINEL: evidence integrity event', `Rule ${rule.id} preserved the snapshot, froze the record and opened case ${cse.code}.`, { priority: 'CRITICAL' });
    }
  }
  set(() => {});
}

function openIncidentInternal(title, category, severity, affected, detail) {
  const sec = cfg();
  const now = S().meta.simNow || Date.now();
  const cse = {
    id: uuid(), code: nextCode(S(), 'secCase'), title, category, severity, status: 'DETECTED',
    affectedService: affected, detectedAt: now, createdAt: now, analyst: null, source: 'SENTINEL DETECTION ENGINE',
    evidence: [], timeline: [{ at: now, step: 'DETECTED', note: detail || 'Detection engine alert' }],
    relatedEvents: [], actions: [], comms: [], recovery: null,
  };
  sec.incidents.unshift(cse);
  set(() => {});
  return cse;
}

// ---------------- live tick (called from server sim loop) ----------------
let lastEventAt = 0;
function tick(simNow) {
  const sec = cfg();
  const now = simNow || S().meta.simNow || Date.now();
  // metrics drift
  for (const n of sec.nodes) {
    if (['CRITICAL', 'OFFLINE', 'ISOLATED'].includes(n.status)) continue;
    n.cpu = Math.max(6, Math.min(96, n.cpu + (Math.random() * 8 - 4)));
    n.memory = Math.max(12, Math.min(92, n.memory + (Math.random() * 5 - 2.5)));
    n.disk = Math.max(10, Math.min(94, n.disk + (Math.random() * 0.6 - 0.3)));
    n.netMbps = Math.max(10, Math.min(900, n.netMbps + (Math.random() * 60 - 30)));
    n.lastCheck = now;
  }
  for (const a of sec.apis) {
    a.requests += Math.round(a.requestsPerSec * (Math.random() * 0.5 + 0.75));
    if (Math.random() < 0.002) { a.errors++; a.errorRate = Math.min(4, +(a.errorRate + 0.05).toFixed(2)); }
    if (Math.random() < 0.0015 && a.id === 'API-AUTH') { a.authFailures++; sec.identity.failedLogins++; }
    a.latencyMs = Math.max(18, Math.min(320, a.latencyMs + (Math.random() * 14 - 7)));
  }
  // occasional live event (sim-time throttled so the stream feels alive but not spammy)
  if (now - lastEventAt > 35 * 60000) {
    lastEventAt = now;
    const pool = [
      ['Evidence hash verification passed', 'EVIDENCE', 'INFORMATIONAL', 'NODE-0008'],
      ['API health probe completed', 'API', 'INFORMATIONAL', 'API-CENTRAL'],
      ['WAF blocked suspicious request', 'PUBLIC', 'LOW', 'NODE-0013'],
      ['IReV connector sync completed', 'IREV', 'INFORMATIONAL', 'API-IREV'],
      ['Node heartbeat OK', 'INFRASTRUCTURE', 'INFORMATIONAL', 'NODE-0003'],
      ['Rate-limit event (source throttled)', 'API', 'MEDIUM', 'API-PUBLIC'],
    ];
    const [t, c, s, src] = pool[Math.floor(Math.random() * pool.length)];
    emit(t, c, s, src, 'Live event from SENTINEL collectors');
  }
  // break-glass expiry
  for (const bg of sec.breakglass) {
    if (bg.status === 'ACTIVE' && now >= bg.expiresAt) {
      bg.status = 'EXPIRED';
      secAudit({ who: 'SYSTEM', what: 'BREAK_GLASS_EXPIRED', when: fmtWat(now), where: 'SENTINEL', target: bg.id, before: 'ACTIVE', after: 'EXPIRED', why: 'Automatic expiration (time limit reached)', approval: 'POLICY', result: 'Session terminated' });
    }
  }
  // recompute threat level periodically
  computeThreatLevel(sec);
  set(() => {});
}

// ---------------- case workflow (§20) ----------------
function transitionCase(user, caseId, targetStatus) {
  const sec = cfg();
  const cse = sec.incidents.find(i => i.id === caseId);
  if (!cse) return { error: 'NOT_FOUND' };
  const from = CASE_FLOW.indexOf(cse.status), to = CASE_FLOW.indexOf(targetStatus);
  if (to === -1) return { error: 'INVALID_STATUS' };
  if (to < from && targetStatus !== 'CLOSED') return { error: 'WORKFLOW_ORDER', message: `Cannot move from ${cse.status} back to ${targetStatus}` };
  const now = S().meta.simNow || Date.now();
  cse.status = targetStatus;
  if (targetStatus === 'ASSIGNED' && !cse.analyst) cse.analyst = user.name;
  cse.timeline.push({ at: now, step: targetStatus, note: `Advanced to ${targetStatus} by ${user.name}` });
  if (targetStatus === 'CLOSED') cse.recovery = { validatedAt: now, by: user.name };
  secAudit({ who: user.name, what: 'CASE_TRANSITION', when: fmtWat(now), where: 'SENTINEL', target: cse.code, before: from >= 0 ? CASE_FLOW[from] : '?', after: targetStatus, why: 'Incident workflow step', approval: 'RBAC', result: 'OK' });
  audit(user, 'SECURITY_CASE_TRANSITION', 'secCase', cse.id, `${cse.code} → ${targetStatus}`, null);
  set(() => {});
  return { ok: true, case: cse };
}

// ---------------- privileged actions (§47/49/50/16) ----------------
function actionRisk(action) {
  const def = ACTION_CATALOG[action];
  if (!def) return { error: 'UNKNOWN_ACTION' };
  return def;
}
function canRequest(user, action) {
  const def = actionRisk(action);
  if (def.error) return false;
  const st = S();
  const role = st.roles.find(r => r.id === user.roleId);
  const perms = role?.permissions || [];
  if (!perms.includes('security.view')) return false;
  if (def.risk === 'LOW') return true;
  return perms.includes('security.respond');
}
function canApprove(user) {
  const st = S();
  const role = st.roles.find(r => r.id === user.roleId);
  return role?.permissions.includes('security.privileged') || user.roleId === 'superadmin' || user.roleId === 'secdirector';
}

function requestAction(user, action, target, detail = '', opts = {}) {
  const sec = cfg();
  const def = actionRisk(action);
  if (def.error) return def;
  if (!canRequest(user, action)) return { error: 'FORBIDDEN' };
  // STEP-UP AUTHENTICATION (§16): HIGH/CRITICAL actions require a fresh TOTP code.
  if (['HIGH', 'CRITICAL'].includes(def.risk)) {
    if (!opts.stepupCode) return { error: 'STEPUP_REQUIRED', message: 'High-risk actions require step-up authentication. Provide your current TOTP code as stepupCode.' };
    const authMod = require('./auth');
    if (!authMod.verifyStepup(user, opts.stepupCode)) {
      authMod.bump('mfaFailures');
      return { error: 'STEPUP_INVALID', message: 'Step-up code invalid. A fresh 6-digit TOTP code is required for this action.' };
    }
  }
  const now = S().meta.simNow || Date.now();
  const req = {
    id: uuid(), code: nextCode(S(), 'secApr'), action, actionLabel: def.label, target, detail,
    risk: def.risk, reversible: def.reversible, approval: def.approval,
    status: def.approval === 'NONE' ? 'APPROVED' : 'REQUESTED',
    requestedBy: user.name, requestedById: user.id, requestedAt: now,
    approvedBy: null, approvals: [], executedAt: null, before: null, after: null, result: null,
    impact: actionImpact(action, target),
  };
  if (def.approval === 'NONE') {
    sec.actions.unshift(req);
    return executeAction(user, req.id);
  }
  sec.actions.unshift(req);
  secAudit({ who: user.name, what: 'ACTION_REQUESTED', when: fmtWat(now), where: 'SENTINEL', target: `${action} → ${target}`, before: null, after: null, why: detail || 'Security response', approval: `PENDING (${def.approval})`, result: 'AWAITING APPROVAL' });
  notify(['secdirector'], `🔐 Security action requested: ${def.label}`, `${user.name} requests ${def.label} on ${target} (${def.risk} risk). ${def.approval} approval required.`, { priority: 'HIGH' });
  audit(user, 'SECURITY_ACTION_REQUESTED', 'secAction', req.code, `${action} on ${target} (${def.risk})`, null);
  set(() => {});
  return { ok: true, action: req, requiresApproval: def.approval !== 'NONE' };
}

function actionImpact(action, target) {
  const map = {
    ISOLATE_NODE: `Traffic will fail over to the sibling node. ${target} leaves rotation until restored.`,
    DISABLE_API: 'The API returns 503 for all callers until re-enabled.',
    REVOKE_CREDENTIAL: 'The credential is revoked immediately; dependent services must be re-issued.',
    ROTATE_CREDENTIAL: 'A new credential is issued and propagated; the old one stops working.',
    RESTART_SERVICE: 'Brief service interruption (seconds) while the service restarts.',
    RATE_LIMIT_SOURCE: 'Traffic from this source is temporarily rate-limited for 30 minutes.',
    DISABLE_SESSION: 'The session is terminated immediately; the user must re-authenticate.',
    BLOCK_COMPONENT: 'The component is blocked at the network layer until restored.',
    FAILOVER_SERVICE: 'Traffic is moved to the standby; current node returns to standby.',
    PRODUCTION_SHUTDOWN: 'All production services stop. Election monitoring is interrupted.',
    FIREWALL_POLICY: 'Firewall rules change globally; connectivity to the platform may be affected.',
    DESTRUCTIVE_OP: 'Data or systems are destroyed. NOT reversible.',
    EVIDENCE_STORE_CHANGE: 'Evidence-store policy changes; integrity guarantees are re-evaluated.',
    DATABASE_RECOVERY: 'Database is restored from backup; recent writes may be affected.',
    POLICY_OVERRIDE: 'A security policy is temporarily overridden.',
    VERIFY_BACKUP: 'Backup archives are verified against stored checksums.',
    START_RECOVERY: 'Recovery runbook starts; affected services may be restarted.',
    FAILOVER_DR: 'All traffic moves to the disaster-recovery site.',
    ADJUST_RATE_LIMIT: 'The API rate limit is adjusted for all sources.',
    ENABLE_MAINTENANCE: 'The platform enters maintenance mode; users see a notice.',
    ACK_ALERT: 'Alert is acknowledged and removed from the open queue.',
    ASSIGN_CASE: 'Case is assigned to the selected analyst.',
    RUN_HEALTH_CHECK: 'Fresh health probe is executed against the node.',
    RUN_VULN_SCAN: 'A vulnerability scan is scheduled against the asset.',
    REQUEST_LOGS: 'Log bundle is prepared for the requester.',
  };
  return map[action] || 'Effect described at execution time.';
}

function approveAction(user, actionId, note = '') {
  const sec = cfg();
  const req = sec.actions.find(a => a.id === actionId);
  if (!req) return { error: 'NOT_FOUND' };
  if (req.status !== 'REQUESTED' && req.status !== 'PENDING_DUAL') return { error: 'NOT_PENDING' };
  if (!canApprove(user)) return { error: 'FORBIDDEN' };
  if (req.requestedById === user.id && req.approval === 'DUAL') return { error: 'SECOND_APPROVER_REQUIRED', message: 'Dual authorization: the requester cannot approve their own CRITICAL action.' };
  const now = S().meta.simNow || Date.now();
  req.approvals.push({ by: user.name, at: now, note });
  if (req.approval === 'DUAL' && req.approvals.length < 2) {
    req.status = 'PENDING_DUAL';
    notify(['secdirector'], '🔐 Dual approval — one more approver needed', `${req.actionLabel} on ${req.target} approved by ${user.name}. A second approver is required.`, { priority: 'CRITICAL' });
    set(() => {});
    return { ok: true, pendingDual: true, action: req };
  }
  req.status = 'APPROVED';
  req.approvedBy = req.approvals.map(a => a.by).join(' + ');
  secAudit({ who: user.name, what: 'ACTION_APPROVED', when: fmtWat(now), where: 'SENTINEL', target: `${req.action} → ${req.target}`, before: 'REQUESTED', after: 'APPROVED', why: note || 'Security approval', approval: `${req.approval} authorization`, result: 'READY FOR EXECUTION' });
  audit(user, 'SECURITY_ACTION_APPROVED', 'secAction', req.code, `${req.action} on ${req.target}`, null);
  set(() => {});
  return { ok: true, action: req };
}

function rejectAction(user, actionId, note = '') {
  const sec = cfg();
  const req = sec.actions.find(a => a.id === actionId);
  if (!req) return { error: 'NOT_FOUND' };
  if (req.status !== 'REQUESTED' && req.status !== 'PENDING_DUAL') return { error: 'NOT_PENDING' };
  if (!canApprove(user)) return { error: 'FORBIDDEN' };
  req.status = 'REJECTED';
  secAudit({ who: user.name, what: 'ACTION_REJECTED', when: fmtWat(S().meta.simNow), where: 'SENTINEL', target: `${req.action} → ${req.target}`, before: req.status === 'PENDING_DUAL' ? 'PENDING_DUAL' : 'REQUESTED', after: 'REJECTED', why: note || 'Rejected by approver', approval: 'RBAC', result: 'NOT EXECUTED' });
  set(() => {});
  return { ok: true, action: req };
}

function executeAction(user, actionId) {
  const sec = cfg();
  const req = sec.actions.find(a => a.id === actionId);
  if (!req) return { error: 'NOT_FOUND' };
  if (req.status === 'EXECUTED') return { error: 'ALREADY_EXECUTED' };
  if (req.status === 'REJECTED') return { error: 'REJECTED' };
  if (req.status !== 'APPROVED') return { error: 'NOT_APPROVED', message: 'This action requires approval before execution.' };
  const now = S().meta.simNow || Date.now();
  const before = captureBefore(req.action, req.target);
  const res = applyEffect(req.action, req.target, req.detail);
  if (res && res.error) return res;
  req.status = 'EXECUTED';
  req.executedAt = now;
  req.before = before;
  req.after = captureAfter(req.action, req.target);
  req.result = 'OK';
  secAudit({
    who: user ? user.name : 'SYSTEM', what: 'ACTION_EXECUTED', when: fmtWat(now), where: 'SENTINEL',
    target: `${req.action} → ${req.target}`, before: JSON.stringify(req.before), after: JSON.stringify(req.after),
    why: req.detail || 'Approved security response', approval: `${req.approval} authorization (${req.approvedBy || 'auto'})`, result: 'OK',
  });
  if (user) audit(user, 'SECURITY_ACTION_EXECUTED', 'secAction', req.code, `${req.action} on ${req.target}`, null);
  emit(`${req.actionLabel} executed on ${req.target}`, 'INFRASTRUCTURE', req.risk === 'CRITICAL' ? 'HIGH' : 'MEDIUM', req.target, `Executed by ${req.requestedBy}`, { actionId: req.id });
  set(() => {});
  return { ok: true, action: req };
}

function rollbackAction(user, actionId) {
  const sec = cfg();
  const req = sec.actions.find(a => a.id === actionId);
  if (!req) return { error: 'NOT_FOUND' };
  if (req.status !== 'EXECUTED') return { error: 'NOT_EXECUTED' };
  if (!req.reversible) return { error: 'NOT_REVERSIBLE' };
  if (!canApprove(user)) return { error: 'FORBIDDEN' };
  applyEffect('ROLLBACK_' + req.action, req.target, req.detail, req.before);
  req.status = 'ROLLED_BACK';
  const now = S().meta.simNow || Date.now();
  secAudit({ who: user.name, what: 'ACTION_ROLLED_BACK', when: fmtWat(now), where: 'SENTINEL', target: `${req.action} → ${req.target}`, before: 'EXECUTED', after: 'ROLLED_BACK', why: 'Restore to pre-action state', approval: 'RBAC', result: 'RESTORED' });
  emit(`${req.actionLabel} rolled back on ${req.target}`, 'INFRASTRUCTURE', 'MEDIUM', req.target, `Rolled back by ${user.name}`);
  set(() => {});
  return { ok: true, action: req };
}

function captureBefore(action, target) {
  const sec = cfg();
  const n = sec.nodes.find(x => x.id === target);
  const a = sec.apis.find(x => x.id === target);
  if (n) return { status: n.status, cpu: n.cpu };
  if (a) return { status: a.status };
  return { target };
}
function captureAfter(action, target) {
  const sec = cfg();
  const n = sec.nodes.find(x => x.id === target);
  const a = sec.apis.find(x => x.id === target);
  if (n) return { status: n.status, cpu: n.cpu };
  if (a) return { status: a.status };
  return { target };
}
function applyEffect(action, target, detail, before) {
  const sec = cfg();
  const n = sec.nodes.find(x => x.id === target);
  const a = sec.apis.find(x => x.id === target);
  switch (action) {
    case 'ISOLATE_NODE': if (!n) return { error: 'TARGET_NOT_FOUND' }; n.status = 'ISOLATED'; n.securityAgent = 'ISOLATED'; emit('Node isolated (authorized)', 'INFRASTRUCTURE', 'HIGH', target, `Isolation executed per approved action — ${detail || ''}`); break;
    case 'ROLLBACK_ISOLATE_NODE': if (n && before) { n.status = before.status || 'HEALTHY'; n.securityAgent = 'ACTIVE'; } break;
    case 'DISABLE_API': if (!a) return { error: 'TARGET_NOT_FOUND' }; a.status = 'DISABLED'; break;
    case 'ROLLBACK_DISABLE_API': if (a && before) a.status = before.status || 'HEALTHY'; break;
    case 'RESTART_SERVICE': if (!n) return { error: 'TARGET_NOT_FOUND' }; n.processHealth = 100; n.serviceHealth = 100; n.lastCheck = S().meta.simNow || Date.now(); break;
    case 'FAILOVER_SERVICE': if (!n) return { error: 'TARGET_NOT_FOUND' }; n.status = 'STANDBY'; break;
    case 'ROLLBACK_FAILOVER_SERVICE': if (n && before) n.status = before.status || 'HEALTHY'; break;
    case 'ROTATE_CREDENTIAL': case 'REVOKE_CREDENTIAL': {
      const s = sec.secrets.find(x => x.ref === detail || x.id === detail);
      if (!s) return { error: 'TARGET_NOT_FOUND' };
      if (action === 'REVOKE_CREDENTIAL') { s.status = 'REVOKED'; s.revokedReason = detail || 'Revoked by security action'; }
      else { s.rotatedAt = S().meta.simNow || Date.now(); s.nextRotation = (S().meta.simNow || Date.now()) + 30 * 24 * 3600 * 1000; }
      break;
    }
    case 'BLOCK_COMPONENT': if (!n) return { error: 'TARGET_NOT_FOUND' }; n.status = 'BLOCKED'; break;
    case 'ROLLBACK_BLOCK_COMPONENT': if (n && before) n.status = before.status || 'HEALTHY'; break;
    case 'DISABLE_SESSION': { const s = sec.sessions.find(x => x.id === target); if (s) { s.active = false; s.terminatedAt = S().meta.simNow || Date.now(); } break; }
    case 'RUN_HEALTH_CHECK': if (n) { n.lastCheck = S().meta.simNow || Date.now(); n.processHealth = 100; } break;
    case 'RUN_VULN_SCAN': sec.lastScan = S().meta.simNow || Date.now(); sec.lastScanLabel = fmtWat(sec.lastScan).split(' ')[1]; break;
    case 'ADJUST_RATE_LIMIT': {
      const v = parseInt(detail, 10);
      if (!Number.isFinite(v)) return { error: 'BAD_VALUE' };
      sec.rateLimitConfig.requestsPerSec = v;
      // REAL effect (M2): the central rate-limit policy is adjusted live
      require('./ratelimit').setPolicy('api', { max: v });
      break;
    }
    case 'ENABLE_MAINTENANCE': sec.rateLimitConfig.maintenanceMode = true; break;
    case 'ROLLBACK_ENABLE_MAINTENANCE': sec.rateLimitConfig.maintenanceMode = false; break;
    case 'RATE_LIMIT_SOURCE': sec.public.rateLimitSources.push({ source: detail || target, at: S().meta.simNow || Date.now(), minutes: 30, by: 'SECURITY ACTION' }); break;
    case 'VERIFY_BACKUP': sec.backup.integrity = 'VERIFIED'; sec.backup.lastVerification = S().meta.simNow || Date.now(); break;
    case 'ACK_ALERT': { const al = sec.alerts.find(x => x.id === target || x.code === target); if (al) al.status = 'ACK'; break; }
    case 'PRODUCTION_SHUTDOWN': for (const x of sec.apis) x.status = 'STOPPED'; break;
    case 'ROLLBACK_PRODUCTION_SHUTDOWN': for (const x of sec.apis) x.status = 'HEALTHY'; break;
    default: return { error: 'ACTION_NOT_IMPLEMENTED', message: `${action} is modelled; effect available in the approved runbook.` };
  }
  return { ok: true };
}

// ---------------- break-glass (§48) ----------------
function openBreakGlass(user, reason, incidentId, minutes = 30, opts = {}) {
  const sec = cfg();
  const authMod = require('./auth');
  if (!opts.stepupCode) return { error: 'STEPUP_REQUIRED', message: 'Emergency access requires strong (step-up) authentication. Provide your current TOTP code as stepupCode.' };
  if (!authMod.verifyStepup(user, opts.stepupCode)) {
    authMod.bump('mfaFailures');
    return { error: 'STEPUP_INVALID', message: 'Step-up code invalid. A fresh 6-digit TOTP code is required for emergency access.' };
  }
  const now = S().meta.simNow || Date.now();
  const bg = {
    id: uuid(), code: nextCode(S(), 'secApr'), userId: user.id, user: user.name, reason, incidentId,
    minutes: Math.min(Math.max(parseInt(minutes, 10) || 30, 5), 120),
    openedAt: now, expiresAt: now + Math.min(Math.max(parseInt(minutes, 10) || 30, 5), 120) * 60000,
    status: 'ACTIVE', elevatedMonitoring: true,
  };
  sec.breakglass.unshift(bg);
  secAudit({ who: user.name, what: 'BREAK_GLASS_OPENED', when: fmtWat(now), where: 'SENTINEL', target: bg.code, before: null, after: 'EMERGENCY SESSION ACTIVE', why: reason, approval: 'STRONG AUTH + REASON', result: `Expires in ${bg.minutes} min` });
  notify(['secdirector'], '🚨 Break-glass emergency access', `${user.name} opened emergency privileged access: ${reason} — expires in ${bg.minutes} minutes. Elevated monitoring enabled.`, { priority: 'CRITICAL' });
  audit(user, 'BREAK_GLASS_OPENED', 'secAction', bg.code, reason, null);
  set(() => {});
  return { ok: true, session: bg };
}
function closeBreakGlass(user, id) {
  const sec = cfg();
  const bg = sec.breakglass.find(b => b.id === id);
  if (!bg) return { error: 'NOT_FOUND' };
  bg.status = 'CLOSED';
  secAudit({ who: user ? user.name : 'SYSTEM', what: 'BREAK_GLASS_CLOSED', when: fmtWat(S().meta.simNow), where: 'SENTINEL', target: bg.code, before: 'ACTIVE', after: 'CLOSED', why: 'Emergency concluded', approval: 'RBAC', result: 'OK' });
  set(() => {});
  return { ok: true };
}

// ---------------- evidence integrity event (§35/71) ----------------
function evidenceIntegrityEvent(evidenceId, originalHash, currentHash, location) {
  const sec = cfg();
  const now = S().meta.simNow || Date.now();
  sec.evidence.integrity = 'BREACHED';
  sec.evidence.failedVerification++;
  const ev = {
    id: uuid(), at: now, evidenceId, originalHash, currentHash, firstObserved: sec.evidence.lastFullVerification,
    changedAt: now, storageLocation: location || 'NODE-0008', accessHistory: [],
  };
  sec.evidence.events.unshift(ev);
  emit('CRITICAL EVIDENCE INTEGRITY EVENT', 'EVIDENCE', 'CRITICAL', 'NODE-0008', 'Stored evidence hash changed — record frozen, snapshot preserved, case opened.', { recordId: evidenceId });
  set(() => {});
  return ev;
}

// ---------------- copilot (§61/62) ----------------
function copilot(q, user) {
  const sec = cfg();
  const st = S();
  const ql = String(q || '').toLowerCase().trim();
  const now = S().meta.simNow || Date.now();
  const secq = (pred) => ({ fact: () => pred, text: '' });
  void secq;
  const open = sec.incidents.filter(i => i.status !== 'CLOSED');
  const mk = (title, body, prov = []) => ({ answer: `**${title}**\n${body}`, sections: prov });

  if (/most critical|critical security issues|top security|what needs attention|priority/.test(ql)) {
    const crit = open.filter(i => i.severity === 'CRITICAL');
    const body = (crit.length ? crit.map(c => `• **${c.code}** — ${c.title} (${c.status})`).join('\n') : '• No open CRITICAL cases.') +
      `\n\n• Overdue CRITICAL vulnerabilities: **${sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN').map(v => v.cve).join(', ') || 'none'}**` +
      `\n• Evidence integrity: **${sec.evidence.integrity}**` +
      `\n• Threat level: **${sec.threatLevel}**` +
      `\n\nPriorities follow the ELECTION DAY DEFENCE MODE order: availability → evidence integrity → authentication → API security → incident response → public platform → IReV integrity.`;
    return mk('Most critical security issues', body, [{ provenance: 'FACT', text: 'Computed from open cases, vulnerability register and integrity state.' }]);
  }
  if (/compromised|isolat/.test(ql)) {
    const rows = sec.nodes.filter(n => ['ISOLATED', 'CRITICAL', 'BLOCKED', 'OFFLINE'].includes(n.status));
    return mk('Compromised / isolated nodes', rows.length ? rows.map(n => `• **${n.id}** ${n.hostname} — ${n.status} (${n.region})`).join('\n') : '• None — all nodes within healthy status.', [{ provenance: 'FACT', text: 'Live node registry.' }]);
  }
  if (/unusual activity|anomal|which apis/.test(ql) && /api/.test(ql)) {
    const anom = sec.apis.filter(a => a.threats > 0 || a.authFailures > 30 || a.errorRate > 1).map(a => `• **${a.id}** — ${a.threats} threat signal(s), ${a.authFailures} auth failures, ${a.errorRate}% errors`).join('\n');
    return mk('APIs with unusual activity', anom || '• No API currently exceeds normal baselines.', [{ provenance: 'DERIVED_DATA', text: 'API telemetry vs baselines.' }]);
  }
  if (/older than seven days|critical vulnerabilities|vulnerab/.test(ql)) {
    const week = 7 * 24 * 3600 * 1000;
    const old = sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN' && now - v.detectedAt > week);
    return mk('Critical vulnerabilities older than seven days', old.length ? old.map(v => `• **${v.cve}** on ${v.asset} — detected ${fmtWat(v.detectedAt)} — fix: ${v.fix}`).join('\n') : '• None. All CRITICAL findings are within the 7-day remediation target.', [{ provenance: 'FACT', text: 'Vulnerability register.' }]);
  }
  if (/changed.*security configuration|security configuration.*today|config/.test(ql) && /securit|today/.test(ql)) {
    const day = 24 * 3600 * 1000;
    const rows = sec.drift.filter(d => now - d.when < day);
    return mk('Security configuration changes (24h)', rows.length ? rows.map(d => `• **${d.target}** — ${d.before} → ${d.after} (${d.who}, ${fmtWat(d.when)}) — ${d.status}`).join('\n') : '• No security configuration changes in the last 24 hours.', [{ provenance: 'VERIFIED_DATA', text: 'Configuration-drift detector.' }]);
  }
  if (/privileged action|last hour/.test(ql)) {
    const hour = 3600 * 1000;
    const rows = sec.auditSec.filter(e => now - (e.at || 0) < hour && /ACTION|BREAK_GLASS/.test(e.what));
    return mk('Privileged actions (last hour)', rows.length ? rows.map(e => `• ${fmtWat(e.at)} — **${e.what}** by ${e.who} on ${e.target} (${e.approval})`).join('\n') : '• No privileged actions in the last hour.', [{ provenance: 'FACT', text: 'Append-only security audit.' }]);
  }
  if (/brief/.test(ql)) {
    const p = posture(sec);
    return mk(`SENTINEL SECURITY BRIEFING — ${fmtWat(now)}`,
      `**Posture: ${p.total}/100** · Threat level: **${sec.threatLevel}**\n\n` +
      `• Open cases: **${open.length}** (${open.filter(i => i.severity === 'CRITICAL').length} CRITICAL)\n` +
      `• Nodes: **${pct(sec.nodes.filter(n => n.status === 'HEALTHY').length, sec.nodes.length)}% healthy**\n` +
      `• API health: **${(sec.apis.filter(a => a.status === 'HEALTHY').length / sec.apis.length * 100).toFixed(1)}%**\n` +
      `• Vulnerabilities: **${sec.scanTotals.critical} CRITICAL / ${sec.scanTotals.high} HIGH** open\n` +
      `• Evidence integrity: **${sec.evidence.integrity}** · IReV connector: **${sec.irev.connector}**\n` +
      `• Backups: **${sec.backup.integrity}** (last ${fmtWat(sec.backup.lastBackup)})\n\n` +
      `Top 3 priorities:\n${sec.threatBasis.slice(0, 3).map((b, i) => `${i + 1}. ${b}`).join('\n')}`, [
      { provenance: 'FACT', text: 'All figures from live SENTINEL telemetry.' },
    ]);
  }
  if (/unresolved|open incident/.test(ql)) {
    return mk('Unresolved security incidents', open.length ? open.map(c => `• **${c.code}** [${c.severity}] ${c.title} — ${c.status}`).join('\n') : '• No unresolved security incidents.', [{ provenance: 'FACT', text: 'Case registry.' }]);
  }
  if (/block|rate.?limit|source/.test(ql) && /this|source/.test(ql)) {
    // §62: never execute from natural language — propose with approval flow
    return mk('Proposed Action (requires approval)',
      `Target: \`Source-ID (recent suspicious source)\`\nReason: repeated suspicious requests\nImpact: traffic from this source will be temporarily rate-limited.\nDuration: 30 minutes.\nReversible: Yes.\nApproval: Required.\n\nI never execute high-risk actions from chat. Use the **Action Centre → Request action** with this proposal, or approve the pre-filled request below.`,
      [{ provenance: 'SYSTEM_INFERENCE', text: 'Proposal only — execution requires the standard approval chain.' }]);
  }
  return mk('SENTINEL COPILOT',
    'Ask about security, for example:\n\n• "What are the most critical security issues right now?"\n• "Show all compromised or isolated nodes."\n• "Which APIs are experiencing unusual activity?"\n• "Show critical vulnerabilities older than seven days."\n• "What changed in the security configuration today?"\n• "Which privileged actions happened in the last hour?"\n• "Prepare a security incident briefing."\n• "Show unresolved incidents."\n\nAll answers cite live telemetry. Actions are always proposed — never executed — from chat.',
    [{ provenance: 'FACT', text: 'Rule-based assistant over SENTINEL records.' }]);
}

module.exports = {
  ensureInitialized, cfg, tick, emit, computeThreatLevel, posture, transitionCase,
  requestAction, approveAction, rejectAction, executeAction, rollbackAction,
  openBreakGlass, closeBreakGlass, evidenceIntegrityEvent, copilot,
  ACTION_CATALOG, PLAYBOOKS, CASE_FLOW, CATEGORIES, SEV, COMPLIANCE_CONTROLS, THREAT_LEVELS,
  canApprove, canRequest, actionImpact, actionRisk,
};
