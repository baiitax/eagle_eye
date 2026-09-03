// store.js — central in-memory state container + JSON persistence
'use strict';
const fs = require('fs');
const path = require('path');
const { uuid, watEpoch } = require('./util');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function freshState() {
  return {
    meta: {
      version: 7,
      createdAt: Date.now(),
      simBaseReal: Date.now(),      // real epoch at which simNow was fixed
      simNow: null,                 // simulated WAT epoch ms (UTC-based internal)
      simSpeed: 30,                 // sim seconds per real second
      simPaused: false,
      scenario: 'RESULTS',          // MORNING | VOTING | RESULTS | EVENING | NIGHT
      electionDayWat: '2027-02-27',
    },
    config: {
      orgName: 'NDC EYES OF VICTORY',
      platformName: 'EYES OF VICTORY',
      tagline: 'Monitor. Verify. Respond. Report.',
      stateName: 'Kano State',
      demoMode: true,
      electionDayWat: '2027-02-27',
      mode: 'ELECTION_DAY', // PRE_ELECTION | ELECTION_DAY | POST_ELECTION
      pollOpen: '08:00',
      pollClose: '14:00',
      retentionDays: 730,
      announcement: '2027 Kano Governorship & Legislative Elections — EYES OF VICTORY DEMO SIMULATION. All data is fictional demonstration data.',
      contacts: {
        supervisor: 'Supervisory Agents (configured)',
        lgRoom: 'LG Situation Room (configured)',
        techSupport: 'Technical Support — NOC (configured)',
        escalation: 'Central Operations — via SOS channel (configured)',
      },
    },
    users: [], roles: [], sessions: {}, loginAttempts: {}, rateBuckets: {},
    devices: [], agents: [],
    lgas: [], wards: [], pus: [], senatorial: [],
    parties: [], elections: [], candidates: [],
    submissions: [], evidence: [], incidents: [], sosEvents: [], streams: [],
    notifications: [], reviews: [], disputes: [], changes: [],
    messages: [], fieldReports: [], escalations: [], tasks: [], shifts: [], reports: [], publicCorrections: [],
    irev: {
      config: { sourceMethod: 'PUBLIC IReV OBSERVATION', enabled: true, normalMin: 10, attentionMin: 30, highMin: 60 },
      sourceHealth: { status: 'ONLINE', lastSync: null, lastSuccess: null, responseMs: 0, errors: 0, failedObservations: 0, rateLimitEvents: 0, observations: 0, outageSince: null, outageUntil: null, notes: [] },
      plan: {}, observations: [], cases: [], alerts: [], events: [], outageAlertId: null,
    },
    // SENTINEL SOC — populated/upgraded lazily by server/lib/sentinel.js ensureInitialized()
    security: null,
    authTelemetry: { loginAttempts: 0, failedLogins: 0, mfaEvents: 0, mfaFailures: 0, passwordResets: 0, sessionsCreated: 0, sessionsTerminated: 0, privilegeChanges: 0, newDevices: 0, hourly: [] },
    ratePolicy: null, rateBuckets: {}, revokedSids: {}, sessionTokens: {}, userDevices: {},
    audit: [], publicReleases: [], systemEvents: [],
    seq: { submission: 0, incident: 0, sos: 0, evidence: 0, escalation: 0, irevObs: 0, irevCase: 0, irevAlert: 0, task: 0, sitrep: 0, secEvent: 0, secAlert: 0, secCase: 0, secApr: 0 },
    systemHealth: {
      api: 'HEALTHY', db: 'HEALTHY', storage: 'HEALTHY', queue: 'HEALTHY', websocket: 'HEALTHY',
      video: 'HEALTHY', sms: 'DEGRADED', notification: 'HEALTHY',
      errorRate: 0.3, responseMs: 84, cpu: 31, memory: 46, disk: 58, lastChecked: Date.now(),
    },
  };
}

// nextCode — human-readable operational IDs (EVR-2027-…, INC-2027-…, SOS-2027-…, EVD-2027-…)
function nextCode(st, kind) {
  const map = { submission: ['EVR-2027', 8], incident: ['INC-2027', 6], sos: ['SOS-2027', 4], evidence: ['EVD-2027', 8], escalation: ['ESC-2027', 6], irevObs: ['IREV-OBS-2027', 6], irevCase: ['EV-DIFF-2027', 6], irevAlert: ['IREV-ALERT-2027', 6], task: ['TSK-2027', 6], sitrep: ['SITREP-2027', 6], secEvent: ['SEC-EV-2027', 6], secAlert: ['SEC-ALERT-2027', 6], secCase: ['SEC-2027', 6], secApr: ['SEC-APR-2027', 6] };
  const [prefix, width] = map[kind];
  st.seq[kind] = (st.seq[kind] || 0) + 1;
  return `${prefix}-${String(st.seq[kind]).padStart(width, '0')}`;
}

let state = null;

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (raw && raw.meta && raw.meta.version === 7) {
        state = raw;
        return { loaded: true };
      }
    }
  } catch (e) { /* fall through to fresh */ }
  state = freshState();
  return { loaded: false };
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 1500);
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) { console.error('state save failed', e.message); }
}
function reset() {
  state = freshState();
  save();
}

const S = () => state;
const set = (mutator) => { mutator(state); scheduleSave(); };

// ---- audit helper ----
function audit(user, action, objectType, objectId, detail = '', req = null) {
  state.audit.unshift({
    id: uuid(), userId: user ? user.id : null, username: user ? user.username : 'system',
    action, objectType, objectId, detail,
    ip: req ? (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim() : '127.0.0.1',
    device: req ? (req.headers['user-agent'] || '').slice(0, 80) : 'server',
    createdAt: state.meta.simNow || Date.now(),
  });
  if (state.audit.length > 5000) state.audit.length = 5000;
  scheduleSave();
}
function systemEvent(type, payload) {
  state.systemEvents.unshift({ id: uuid(), type, payload, ts: state.meta.simNow || Date.now() });
  if (state.systemEvents.length > 800) state.systemEvents.length = 800;
}

function notify(targetRoleIds, title, body, { priority = 'MEDIUM', link = null, userId = null } = {}) {
  const n = {
    id: uuid(), roleIds: targetRoleIds, userId, title, body, priority, link,
    read: false, createdAt: state.meta.simNow || Date.now(),
  };
  state.notifications.unshift(n);
  if (state.notifications.length > 1500) state.notifications.length = 1500;
  scheduleSave();
  return n;
}

module.exports = { S, set, load, save, reset, audit, systemEvent, notify, nextCode, STATE_FILE };
