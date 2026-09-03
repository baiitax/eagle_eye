// seed.js — static seed data: roles, users, geography, parties, elections, candidates, agents, devices
'use strict';
const fs = require('fs');
const path = require('path');
const { uuid, mulberry32, ri, pick, hashPassword } = require('./util');
const totp = require('./totp');
const { S, set } = require('./store');

// M2: deterministic TOTP enrollment — RFC 6238 secrets derived from the signing
// master + username, so serverless cold starts re-seed identically and stateless
// MFA challenges keep verifying across instances. (Production stores a random
// per-user secret in the database instead.)
const TOTP_MASTER = process.env.SESSION_SECRET || 'demo-totp-master';

const GEO_FILE = path.join(__dirname, '..', '..', 'data', 'geo.json');

// ---------------- permissions ----------------
const PERMISSIONS = [
  'dashboard.view', 'map.view', 'results.view', 'results.submit', 'results.verify', 'results.override',
  'incidents.view', 'incidents.create', 'incidents.manage', 'sos.view', 'sos.ack', 'sos.manage',
  'streams.view', 'streams.start', 'agents.view', 'agents.manage', 'analytics.view', 'reports.view',
  'reports.export', 'audit.view', 'admin.users', 'admin.roles', 'admin.config', 'admin.devices',
  'admin.elections', 'admin.geography', 'public.release', 'notifications.view', 'system.health',
  'simulation.control', 'copilot.use', 'evidence.view', 'search.global',
  'escalations.create', 'escalations.view', 'senatorial.demo', 'lg.demo', 'irev.demo',
  'security.view', 'security.respond', 'security.privileged', 'security.audit',
];
const ROLE_DEFS = [
  { id: 'superadmin', name: 'Super Administrator', perms: PERMISSIONS },
  { id: 'director', name: 'Central Situation Room Director', perms: [...PERMISSIONS.filter(p => !p.startsWith('admin.') && p !== 'simulation.control'), 'results.override', 'irev.demo'] },
  // ---- Central Command 2.0 roles (§49) ----
  { id: 'chiefanalyst', name: 'Chief Analyst', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'sos.view', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'audit.view', 'notifications.view', 'copilot.use', 'evidence.view', 'search.global', 'escalations.view', 'system.health'] },
  { id: 'resultmanager', name: 'Result Manager', perms: ['dashboard.view', 'map.view', 'results.view', 'results.verify', 'results.override', 'incidents.view', 'sos.view', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'notifications.view', 'evidence.view', 'search.global', 'escalations.view', 'copilot.use'] },
  { id: 'irevanalyst', name: 'IReV Analyst', perms: ['dashboard.view', 'map.view', 'results.view', 'results.verify', 'incidents.view', 'sos.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'audit.view', 'notifications.view', 'copilot.use', 'evidence.view', 'search.global', 'escalations.create', 'escalations.view', 'system.health', 'irev.demo'] },
  { id: 'incidentcommander', name: 'Incident Commander', perms: ['dashboard.view', 'map.view', 'incidents.view', 'incidents.create', 'incidents.manage', 'sos.view', 'sos.ack', 'sos.manage', 'streams.view', 'agents.view', 'analytics.view', 'notifications.view', 'search.global', 'escalations.create', 'escalations.view'] },
  { id: 'comms', name: 'Communications Officer', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'sos.view', 'agents.view', 'analytics.view', 'reports.view', 'notifications.view', 'search.global', 'escalations.view'] },
  { id: 'analyst', name: 'Central Analyst', perms: ['dashboard.view', 'map.view', 'results.view', 'results.override', 'incidents.view', 'incidents.manage', 'sos.view', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'notifications.view', 'copilot.use', 'evidence.view', 'search.global', 'audit.view'] },
  { id: 'operator', name: 'Central Operator', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.manage', 'sos.view', 'sos.ack', 'sos.manage', 'streams.view', 'agents.view', 'notifications.view', 'system.health', 'search.global'] },
  { id: 'sencoord', name: 'Senatorial Coordinator', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.manage', 'sos.view', 'sos.ack', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.create', 'escalations.view', 'copilot.use'] },
  // ---- EYES OF VICTORY Senatorial Command roles ----
  { id: 'sendirector', name: 'Senatorial Director', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.manage', 'sos.view', 'sos.ack', 'sos.manage', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'audit.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.create', 'escalations.view', 'copilot.use', 'senatorial.demo', 'system.health'] },
  { id: 'senops', name: 'Senatorial Operations Officer', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.create', 'incidents.manage', 'sos.view', 'sos.ack', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.create', 'escalations.view'] },
  { id: 'senincident', name: 'Senatorial Incident Officer', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.manage', 'sos.view', 'sos.ack', 'sos.manage', 'streams.view', 'agents.view', 'notifications.view', 'search.global', 'escalations.create', 'escalations.view'] },
  { id: 'senanalyst', name: 'Senatorial Analyst', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'sos.view', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'audit.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.view', 'copilot.use', 'system.health'] },
  { id: 'senverify', name: 'Senatorial Verification Liaison', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'sos.view', 'agents.view', 'analytics.view', 'reports.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.view'] },
  { id: 'senviewer', name: 'Senatorial Viewer', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'sos.view', 'streams.view', 'agents.view', 'analytics.view', 'notifications.view', 'search.global'] },
  { id: 'lgcoord', name: 'LG Coordinator', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.create', 'incidents.manage', 'sos.view', 'sos.ack', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.create', 'escalations.view', 'copilot.use'] },
  // ---- EYES OF VICTORY LG Supervisor roles ----
  { id: 'lgsupervisor', name: 'LG Supervisor', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.create', 'incidents.manage', 'sos.view', 'sos.ack', 'sos.manage', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'audit.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.create', 'escalations.view', 'copilot.use', 'lg.demo', 'system.health'] },
  { id: 'lganalyst', name: 'LG Analyst', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'sos.view', 'streams.view', 'agents.view', 'analytics.view', 'reports.view', 'reports.export', 'audit.view', 'notifications.view', 'search.global', 'evidence.view', 'escalations.view', 'copilot.use', 'system.health'] },
  { id: 'lgtech', name: 'LG Technical Officer', perms: ['dashboard.view', 'map.view', 'agents.view', 'agents.manage', 'system.health', 'notifications.view', 'search.global', 'analytics.view', 'streams.view'] },
  { id: 'wardcoord', name: 'Ward Coordinator', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'incidents.create', 'sos.view', 'agents.view', 'notifications.view', 'search.global'] },
  { id: 'supervisor', name: 'Supervisory Agent', perms: ['dashboard.view', 'map.view', 'results.view', 'results.verify', 'results.override', 'incidents.view', 'sos.view', 'agents.view', 'analytics.view', 'reports.view', 'notifications.view', 'evidence.view', 'search.global'] },
  { id: 'reviewer', name: 'Result Reviewer', perms: ['dashboard.view', 'results.view', 'results.verify', 'incidents.view', 'analytics.view', 'notifications.view', 'evidence.view', 'search.global'] },
  { id: 'agent', name: 'Field Agent', perms: ['dashboard.view', 'results.submit', 'incidents.create', 'sos.ack', 'streams.start', 'notifications.view'] },
  { id: 'incident', name: 'Incident Officer', perms: ['dashboard.view', 'map.view', 'incidents.view', 'incidents.manage', 'sos.view', 'sos.ack', 'notifications.view', 'search.global'] },
  { id: 'support', name: 'Technical Support', perms: ['dashboard.view', 'map.view', 'agents.view', 'agents.manage', 'system.health', 'notifications.view', 'search.global'] },
  { id: 'pio', name: 'Public Information Officer', perms: ['dashboard.view', 'results.view', 'analytics.view', 'reports.view', 'public.release', 'notifications.view', 'search.global'] },
  { id: 'auditor', name: 'Auditor', perms: ['audit.view', 'dashboard.view', 'results.view', 'evidence.view', 'agents.view', 'search.global', 'reports.view', 'security.view', 'security.audit', 'notifications.view', 'system.health'] },
  { id: 'observer', name: 'Read-Only Observer', perms: ['dashboard.view', 'map.view', 'results.view', 'incidents.view', 'agents.view', 'analytics.view', 'search.global'] },
  // ---- EYES OF VICTORY SENTINEL SECURITY OPERATIONS CENTRE roles (§54) ----
  { id: 'secdirector', name: 'Security Director', perms: ['security.view', 'security.respond', 'security.privileged', 'security.audit', 'dashboard.view', 'analytics.view', 'audit.view', 'notifications.view', 'search.global', 'copilot.use', 'system.health', 'results.view'] },
  { id: 'socanalyst', name: 'SOC Analyst', perms: ['security.view', 'security.respond', 'dashboard.view', 'analytics.view', 'audit.view', 'notifications.view', 'search.global', 'copilot.use', 'system.health'] },
  { id: 'infraengineer', name: 'Infrastructure Engineer', perms: ['security.view', 'security.respond', 'dashboard.view', 'notifications.view', 'search.global', 'system.health'] },
  { id: 'apisecurity', name: 'API Security Engineer', perms: ['security.view', 'security.respond', 'dashboard.view', 'notifications.view', 'search.global', 'system.health'] },
  { id: 'secinccmd', name: 'Security Incident Commander', perms: ['security.view', 'security.respond', 'security.privileged', 'dashboard.view', 'analytics.view', 'audit.view', 'notifications.view', 'search.global', 'copilot.use', 'system.health'] },
];

const DEMO_USERS = [
  { u: 'superadmin', n: 'Ibrahim Sani', r: 'superadmin', p: 'Admin@123!', scope: {} },
  { u: 'director', n: 'Dr. Hauwa K. Abdullahi', r: 'director', p: 'Director@123!', scope: {} },
  { u: 'analyst', n: 'Chinedu Okafor', r: 'analyst', p: 'Analyst@123!', scope: {} },
  { u: 'operator', n: 'Aisha Musa Gwarzo', r: 'operator', p: 'Operator@123!', scope: {} },
  { u: 'sencoord_c', n: 'Yusuf Ado Bayero', r: 'sencoord', p: 'SenCoord@123!', scope: { senatorial: 'Kano Central' } },
  { u: 'sencoord_n', n: 'Maryam Tijjani Dambatta', r: 'sencoord', p: 'SenCoord@123!', scope: { senatorial: 'Kano North' } },
  { u: 'sencoord_s', n: 'Kabiru Shehu Rano', r: 'sencoord', p: 'SenCoord@123!', scope: { senatorial: 'Kano South' } },
  // ---- EYES OF VICTORY Senatorial Command (6 role set) ----
  { u: 'sendirector', n: 'Prof. Ahmad S. Bichi', r: 'sendirector', p: 'SenDir@123!', scope: { senatorial: 'Kano North' } },
  { u: 'senops', n: 'Halima T. Gezawa', r: 'senops', p: 'SenOps@123!', scope: { senatorial: 'Kano North' } },
  { u: 'senincident', n: 'Ibrahim D. Rano', r: 'senincident', p: 'SenInc@123!', scope: { senatorial: 'Kano South' } },
  { u: 'senanalyst', n: 'Dr. Maryam K. Kabo', r: 'senanalyst', p: 'SenAna@123!', scope: { senatorial: 'Kano North' } },
  { u: 'senverify', n: 'Sani U. Dala', r: 'senverify', p: 'SenVer@123!', scope: { senatorial: 'Kano Central' } },
  { u: 'senviewer', n: 'Zainab G. Tofa', r: 'senviewer', p: 'SenVie@123!', scope: { senatorial: 'Kano North' } },
  { u: 'lgcoord', n: 'Sadiq Bello Nasarawa', r: 'lgcoord', p: 'LGCoord@123!', scope: { lga: 'Nasarawa' } },
  { u: 'lgcoord_mun', n: 'Fatima Zango', r: 'lgcoord', p: 'LGCoord@123!', scope: { lga: 'Kano Municipal' } },
  // ---- EYES OF VICTORY LG Supervisor role set ----
  { u: 'lgsupervisor', n: 'Engr. Tijjani H. Nasarawa', r: 'lgsupervisor', p: 'LGSuper@123!', scope: { lga: 'Nasarawa' } },
  { u: 'lganalyst', n: 'Rukayya S. Gama', r: 'lganalyst', p: 'LGAnalyst@123!', scope: { lga: 'Nasarawa' } },
  { u: 'lgtech', n: 'Usman A. (LG NOC)', r: 'lgtech', p: 'LGTech@123!', scope: { lga: 'Nasarawa' } },
  { u: 'wardcoord', n: 'Umar Dandago', r: 'wardcoord', p: 'WardCoord@123!', scope: { lga: 'Nasarawa' } },
  { u: 'supervisor', n: 'Engr. Musa Yakasai', r: 'supervisor', p: 'Supervisor@123!', scope: {} },
  { u: 'supervisor2', n: 'Salamatu G. Inuwa', r: 'supervisor', p: 'Supervisor@123!', scope: {} },
  { u: 'reviewer', n: 'Dr. Nura Maitama', r: 'reviewer', p: 'Reviewer@123!', scope: {} },
  { u: 'reviewer2', n: 'Zainab U. Kiru', r: 'reviewer', p: 'Reviewer@123!', scope: {} },
  { u: 'reviewer3', n: 'Adamu L. Gaya', r: 'reviewer', p: 'Reviewer@123!', scope: {} },
  { u: 'fieldagent', n: 'Sani Musa Dantata', r: 'agent', p: 'Agent@123!', scope: {} },
  { u: 'incident', n: 'Halima S. Wudil', r: 'incident', p: 'Incident@123!', scope: {} },
  { u: 'support', n: 'Ikenna O. (NOC)', r: 'support', p: 'Support@123!', scope: {} },
  { u: 'pio', n: 'Amina G. Bichi', r: 'pio', p: 'PIO@123!', scope: {} },
  { u: 'auditor', n: 'Femi Adewale', r: 'auditor', p: 'Auditor@123!', scope: {} },
  // ---- Central Command 2.0 demo accounts ----
  { u: 'chiefanalyst', n: 'Dr. Kemi Adeyemi', r: 'chiefanalyst', p: 'Chief@123!', scope: {} },
  { u: 'resultmanager', n: 'Ibrahim G. Bebeji', r: 'resultmanager', p: 'ResMgr@123!', scope: {} },
  { u: 'irevanalyst', n: 'Amina S. Wudil', r: 'irevanalyst', p: 'IrevAna@123!', scope: {} },
  { u: 'incidentcommander', n: 'Yakubu M. Dala', r: 'incidentcommander', p: 'IncCmd@123!', scope: {} },
  { u: 'comms', n: 'Halima R. Kura', r: 'comms', p: 'Comms@123!', scope: {} },
  { u: 'observer', n: 'Guest Observer', r: 'observer', p: 'Observer@123!', scope: {} },
  // ---- EYES OF VICTORY SENTINEL SOC demo accounts ----
  { u: 'secdirector', n: 'Hajiya Bilkisu S. Tarauni', r: 'secdirector', p: 'SecDir@123!', scope: {} },
  { u: 'socanalyst', n: 'Engr. David U. Enugu', r: 'socanalyst', p: 'SocAna@123!', scope: {} },
  { u: 'infraengineer', n: 'Engr. Tijjani Gwazo', r: 'infraengineer', p: 'InfraEng@123!', scope: {} },
  { u: 'apisecurity', n: 'Sani A. Bompai', r: 'apisecurity', p: 'ApiSec@123!', scope: {} },
  { u: 'secinccmd', n: 'Col. (rtd) Yusuf Kazaure', r: 'secinccmd', p: 'SecCmd@123!', scope: {} },
];

// ---------------- parties & elections (FICTIONAL demo data) ----------------
const PARTIES = [
  { id: 'pap', code: 'PAP', name: 'People\'s Advancement Party', color: '#16a34a' },
  { id: 'pdc', code: 'PDC', name: 'People\'s Democratic Congress', color: '#2563eb' },
  { id: 'aud', code: 'AUD', name: 'Alliance for Unity & Development', color: '#dc2626' },
  { id: 'sdm', code: 'SDM', name: 'Social Democratic Movement', color: '#d97706' },
  { id: 'ypp', code: 'YPP', name: 'Youth Progressive Platform', color: '#7c3aed' },
];

const GOV_CANDIDATES = [
  { id: 'gov-pap', partyId: 'pap', name: 'Alh. Kabiru Danladi Mai-Gida', runningMate: 'Engr. Bashir Ado Kibiya' },
  { id: 'gov-pdc', partyId: 'pdc', name: 'Dr. Amina Bello Yusuf', runningMate: 'Mallam Suleiman Inuwa Rano' },
  { id: 'gov-aud', partyId: 'aud', name: 'Mallam Sani Abubakar Gwarzo', runningMate: 'Hajiya Rabi T. Kunchi' },
  { id: 'gov-sdm', partyId: 'sdm', name: 'Barr. Fatima Zainab Adamu', runningMate: 'Alh. Nura Mohammed Gezawa' },
  { id: 'gov-ypp', partyId: 'ypp', name: 'Comrade Musa Tijjani Kano', runningMate: 'Mrs. Larai A. Dawakin Kudu' },
];
const SEN_NAMES = {
  'Kano Central': [
    { id: 'sc-pap', partyId: 'pap', name: 'Sen. Ibrahim Shekarau II (PAP)' },
    { id: 'sc-pdc', partyId: 'pdc', name: 'Hon. Khadija Abdullahi (PDC)' },
    { id: 'sc-aud', partyId: 'aud', name: 'Alh. Bashir Garba Tarauni (AUD)' },
    { id: 'sc-sdm', partyId: 'sdm', name: 'Mallam Lawal Danladi (SDM)' },
  ],
  'Kano North': [
    { id: 'sn-pap', partyId: 'pap', name: 'Alh. Tijjani Sa\'ad Bichi (PAP)' },
    { id: 'sn-pdc', partyId: 'pdc', name: 'Dr. Musa Ado Dambatta (PDC)' },
    { id: 'sn-aud', partyId: 'aud', name: 'Hon. Fatima Shehu Gwarzo (AUD)' },
    { id: 'sn-sdm', partyId: 'sdm', name: 'Mallam Sani Bako Shanono (SDM)' },
  ],
  'Kano South': [
    { id: 'ss-pap', partyId: 'pap', name: 'Sen. Kabiru Gaya II (PAP)' },
    { id: 'ss-pdc', partyId: 'pdc', name: 'Hon. Aminu Wudil (PDC)' },
    { id: 'ss-aud', partyId: 'aud', name: 'Barr. Maryam Rano (AUD)' },
    { id: 'ss-sdm', partyId: 'sdm', name: 'Alh. Musa Tudun Wada (SDM)' },
  ],
};

const HAUSA_FIRST = ['Sani', 'Musa', 'Ibrahim', 'Amina', 'Fatima', 'Kabiru', 'Halima', 'Yusuf', 'Zainab', 'Bashir', 'Salamatu', 'Adamu', 'Rabi', 'Nura', 'Hauwa', 'Umar', 'Aliyu', 'Maryam', 'Tijjani', 'Aisha', 'Ishaq', 'Larai', 'Bello', 'Gambo', 'Sadiq', 'Rahama', 'Lawal', 'Safiya', 'Danladi', 'Jamila', 'Iliya', 'Hussaina'];
const HAUSA_LAST = ['Dantata', 'Gwarzo', 'Bichi', 'Rano', 'Wudil', 'Gaya', 'Dambatta', 'Kibiya', 'Karaye', 'Tofa', 'Gezawa', 'Sumaila', 'Takai', 'Albasu', 'Rimin Gado', 'Shanono', 'Kunchi', 'Bagwai', 'Kiru', 'Bebeji', 'Madobi', 'Tarauni', 'Dala', 'Fagge', 'Minjibir', 'Ungogo', 'Ajingi', 'Doguwa', 'Tudun Wada', 'Kura', 'Gabasawa', 'Warawa'];

// ---------------- build static entities ----------------
function seedStatic() {
  const st = S();
  if (st.users.length > 0) return; // already seeded

  const rng = mulberry32(20270044);

  // roles
  st.roles = ROLE_DEFS.map(r => ({ id: r.id, name: r.name, description: '', permissions: [...r.perms] }));

  // users
  for (const du of DEMO_USERS) {
    st.users.push({
      // deterministic IDs: serverless hosts re-seed on every cold start; stable IDs
      // keep HMAC-signed session tokens valid across instances (auth.js currentUser)
      id: 'u-' + du.u, username: du.u, name: du.n, roleId: du.r, scope: du.scope,
      passwordHash: hashPassword(du.p), mfa: true, mfaType: 'TOTP', totpSecret: totp.deterministicSecret(TOTP_MASTER, du.u),
      status: 'ACTIVE', phone: '0803' + ri(rng, 1000000, 9999999),
      createdAt: Date.now(), lastLoginAt: null, loginCount: 0, failedLoginCount: 0, lastFailedAt: null,
      sessionsInvalidatedAt: 0, passwordChangedAt: Date.now(),
    });
  }

  // ------- geography -------
  const geo = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
  st.senatorial = geo.senatorial;
  let lgaIdx = 0;
  for (const gl of geo.lgas) {
    lgaIdx++;
    const lgaId = `lga-${lgaIdx}`;
    const code = `KN-${String(lgaIdx).padStart(2, '0')}`;
    st.lgas.push({
      id: lgaId, code, name: gl.name, senatorial: gl.senatorial,
      centroid: gl.centroid, poly: gl.poly, lat: gl.lat, lon: gl.lon,
    });
    let wardIdx = 0;
    for (const gw of gl.wards) {
      wardIdx++;
      const wardId = `${code}-W${String(wardIdx).padStart(2, '0')}`;
      st.wards.push({
        id: wardId, lgaId, name: gw.name, centroid: gw.centroid, poly: gw.poly,
      });
      for (const p of (gw.pus || [])) {
        st.pus.push({
          id: p.code, code: p.code, name: p.name, wardId, lgaId,
          lat: p.lat, lon: p.lon, x: p.x, y: p.y,
        });
      }
    }
  }

  // ------- elections -------
  st.elections = [
    { id: 'e-gov-2027', name: 'Kano State Governorship Election 2027', type: 'GOVERNORSHIP', level: 'STATE', scope: 'Kano State', date: '2027-02-27', status: 'ACTIVE', positions: 1 },
    { id: 'e-sen-c-2027', name: 'Kano Central Senatorial District Election 2027', type: 'SENATE', level: 'SENATORIAL', scope: 'Kano Central', date: '2027-02-27', status: 'ACTIVE', positions: 1 },
    { id: 'e-sen-n-2027', name: 'Kano North Senatorial District Election 2027', type: 'SENATE', level: 'SENATORIAL', scope: 'Kano North', date: '2027-02-27', status: 'ACTIVE', positions: 1 },
    { id: 'e-sen-s-2027', name: 'Kano South Senatorial District Election 2027', type: 'SENATE', level: 'SENATORIAL', scope: 'Kano South', date: '2027-02-27', status: 'ACTIVE', positions: 1 },
    { id: 'e-ha-2027', name: 'Kano State House of Assembly Election 2027', type: 'STATE_ASSEMBLY', level: 'CONSTITUENCY', scope: 'Kano State', date: '2027-02-27', status: 'CONFIGURED', positions: 1 },
    { id: 'e-hor-2027', name: 'House of Representatives 2027 — Kano Federal Constituencies', type: 'HOUSE_OF_REPS', level: 'FEDERAL_CONSTITUENCY', scope: 'Kano State', date: '2027-02-27', status: 'CONFIGURED', positions: 1 },
  ];
  st.parties = PARTIES;
  st.candidates = GOV_CANDIDATES.map(c => ({ ...c, electionId: 'e-gov-2027' }));
  for (const [sd, list] of Object.entries(SEN_NAMES)) {
    const eid = sd === 'Kano Central' ? 'e-sen-c-2027' : sd === 'Kano North' ? 'e-sen-n-2027' : 'e-sen-s-2027';
    for (const c of list) st.candidates.push({ id: c.id, electionId: eid, partyId: c.partyId, name: c.name });
  }

  // ------- devices & agents -------
  const lgasById = Object.fromEntries(st.lgas.map(l => [l.id, l]));
  const puByWard = {};
  for (const p of st.pus) (puByWard[p.wardId] = puByWard[p.wardId] || []).push(p);

  // agent assignment: ~90% of PUs get an agent
  let agentCount = 0;
  for (const pu of st.pus) {
    if (rng() > 0.90) continue; // 10% vacant
    agentCount++;
    const fname = pick(rng, HAUSA_FIRST), lname = pick(rng, HAUSA_LAST);
    const agent = {
      id: `ag-${String(agentCount).padStart(4, '0')}`,
      code: `KNA-${String(agentCount).padStart(4, '0')}`,
      name: `${fname} ${lname}`,
      puId: pu.id, wardId: pu.wardId, lgaId: pu.lgaId,
      senatorial: lgasById[pu.lgaId] ? lgasById[pu.lgaId].senatorial : '',
      phone: '0807' + ri(rng, 1000000, 9999999),
      dutyState: 'NOT_ACTIVATED',
      online: false, lastHeartbeat: null, network: '4G', battery: ri(rng, 40, 100),
      gps: { lat: +(pu.lat + (rng() - 0.5) * 0.004).toFixed(5), lon: +(pu.lon + (rng() - 0.5) * 0.004).toFixed(5) },
      activatedAt: null, checkedInAt: null, completedAt: null,
    };
    st.agents.push(agent);
    const dev = {
      id: uuid(), agentId: agent.id, model: pick(rng, ['Tecno Spark 20', 'Infinix Hot 40', 'Samsung Galaxy A15', 'Itel P55', 'Redmi 13C']),
      os: 'Android ' + pick(rng, ['13', '14']), imei: '35' + String(ri(rng, 10000000000000, 99999999999999)),
      status: 'APPROVED', registeredAt: Date.now() - ri(rng, 3, 20) * 86400000, lastSeen: null, ip: null,
    };
    st.devices.push(dev);
    agent.deviceId = dev.id;
  }

  // bind the demo field agent user to a real agent record (Nasarawa LGA, metro PU)
  const fieldUser = st.users.find(u => u.username === 'fieldagent');
  if (fieldUser) {
    const nasLgas = st.lgas.filter(l => l.name === 'Nasarawa');
    const targetLga = nasLgas[0];
    const targetWards = st.wards.filter(w => w.lgaId === targetLga.id);
    const targetWard = targetWards[1];
    const pus = st.pus.filter(p => p.wardId === targetWard.id);
    const targetPu = pus[0];
    const existing = st.agents.find(a => a.puId === targetPu.id);
    if (existing) {
      existing.userId = fieldUser.id;
      existing.name = fieldUser.name;
      existing.code = 'KNA-0001';
      fieldUser.agentId = existing.id;
    }
  }

  console.log(`[seed] static: ${st.users.length} users, ${st.lgas.length} LGAs, ${st.wards.length} wards, ${st.pus.length} PUs, ${st.agents.length} agents`);
  set(() => {});
  return true;
}

module.exports = { seedStatic };
