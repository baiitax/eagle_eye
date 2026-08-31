// server.js — NDC E-Situation Room 2027 — zero-dependency Node.js server
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const util = require('./lib/util');
const store = require('./lib/store');
const { seedStatic } = require('./lib/seed');
const sim = require('./lib/sim');
const auth = require('./lib/auth');
const { validateSubmission } = require('./lib/validation');
const reports = require('./lib/reports');
const copilot = require('./lib/copilot');
const irev = require('./lib/irev');
const sentinel = require('./lib/sentinel');
const fmtWat = util.fmtWat;

const PORT = process.env.PORT || 3000;
const IS_SERVERLESS = !!process.env.VERCEL; // Vercel serverless mode (no timers, no SSE, stateless-ish)
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const { S, set, audit, notify, systemEvent, nextCode } = store;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.map': 'application/json', '.woff2': 'font/woff2',
};

// ---------------- SSE ----------------
const sseClients = new Map(); // clientId -> res
function broadcastSse(obj) {
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for (const [id, res] of sseClients) {
    try { res.write(data); } catch (e) { sseClients.delete(id); }
  }
}
sim.setBroadcast(broadcastSse);
irev.setBroadcast(broadcastSse);

// ---------------- helpers ----------------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendBuffer(res, code, buf, type, extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Content-Length': buf.length, 'Cache-Control': 'no-store', ...extra });
  res.end(buf);
}
function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('BODY_TOO_LARGE')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------------- scope helpers ----------------
function scopedLgas(user) {
  const st = S();
  if (user.scope && user.scope.lga) return st.lgas.filter(l => l.name === user.scope.lga);
  if (user.scope && user.scope.senatorial) return st.lgas.filter(l => l.senatorial === user.scope.senatorial);
  return st.lgas;
}

// ---------------- overview payloads ----------------
function overview(user) {
  const st = S();
  const ag = reports.aggregates();
  const lgasAll = reports.lgAggregates();
  const scopeLgas = scopedLgas(user).map(l => l.id);
  const recent = st.systemEvents.slice(0, 40);
  const queue = st.submissions.filter(s => ['SUBMITTED', 'UNDER_REVIEW', 'UNVERIFIED'].includes(s.status)).slice(0, 30).map(s => ({
    id: s.id, code: s.code, puId: s.puId, ward: st.wards.find(w => w.id === s.wardId)?.name, lga: st.lgas.find(l => l.id === s.lgaId)?.name,
    senatorial: s.senatorial, election: st.elections.find(e => e.id === s.electionId)?.type, submittedAt: s.submittedAt,
    status: s.status, anomalies: (s.anomalies || []).map(a => a.code), agentId: s.agentId,
  }));
  return {
    scope: { lga: user.scope?.lga || null, senatorial: user.scope?.senatorial || null, role: user.roleId },
    sim: { now: st.meta.simNow, phase: sim.phaseOf(st.meta.simNow), scenario: st.meta.scenario, scenarioLabel: sim.SCENARIOS[st.meta.scenario]?.label, speed: st.meta.simSpeed, paused: st.meta.simPaused },
    kpis: { ...ag, agentsTotal: st.agents.length },
    senatorial: st.senatorial.map(sd => {
      const ls = Object.values(lgasAll).filter(x => x.senatorial === sd);
      const tp = ls.reduce((a, x) => a + x.totalPu, 0), tsub = ls.reduce((a, x) => a + x.submitted, 0);
      return { name: sd, totalPu: tp, submitted: tsub, verified: ls.reduce((a, x) => a + x.verified, 0), reportingPct: pct(tsub, tp), incidents: ls.reduce((a, x) => a + x.incidents, 0), sos: ls.reduce((a, x) => a + x.sos, 0), streams: ls.reduce((a, x) => a + x.streams, 0), pending: ls.reduce((a, x) => a + x.pending, 0), anomalies: ls.reduce((a, x) => a + x.anomalies, 0) };
    }),
    lgas: Object.values(lgasAll).filter(x => scopeLgas.includes(x.lgaId)),
    wardHealth: st.wards.filter(w => scopeLgas.includes(w.lgaId)).map(w => {
      const pus = st.pus.filter(p => p.wardId === w.id);
      const subPu = new Set(st.submissions.filter(s => s.wardId === w.id && s.electionId === 'e-gov-2027').map(s => s.puId));
      const verPu = new Set(st.submissions.filter(s => s.wardId === w.id && s.electionId === 'e-gov-2027' && s.status === 'VERIFIED').map(s => s.puId));
      const agents = st.agents.filter(a => a.wardId === w.id);
      const score = Math.round(0.35 * pct(agents.filter(a => a.online).length, Math.max(1, agents.length)) + 0.4 * pct(subPu.size, pus.length) + 0.25 * pct(verPu.size, pus.length));
      return { id: w.id, name: w.name, lgaId: w.lgaId, pus: pus.length, agents: agents.length, online: agents.filter(a => a.online).length, submitted: subPu.size, verified: verPu.size, reportingPct: pct(subPu.size, pus.length), score, incidents: st.incidents.filter(i => i.wardId === w.id && !['RESOLVED', 'CLOSED'].includes(i.status)).length, sos: st.sosEvents.filter(s => s.wardId === w.id && s.status !== 'RESOLVED').length };
    }),
    timeline: recent.map(e => ({ ...e })),
    queue, anomalies: st.submissions.filter(s => s.anomalies?.length).slice(0, 25).map(s => ({ id: s.id, puId: s.puId, lga: st.lgas.find(l => l.id === s.lgaId)?.name, codes: s.anomalies.map(a => a.code), status: s.status, submittedAt: s.submittedAt })),
    incidents: st.incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).slice(0, 40).map(incShort),
    sos: st.sosEvents.filter(s => s.status !== 'RESOLVED').map(sosShort),
    streams: st.streams.filter(s => s.status === 'LIVE').map(streamShort),
    agentsOnMap: st.agents.filter(a => a.online).slice(0, 1200).map(a => ({ id: a.id, puId: a.puId, lgaId: a.lgaId, lat: a.gps?.lat, lon: a.gps?.lon, duty: a.dutyState })),
    health: st.systemHealth,
    config: { orgName: st.config.orgName, platformName: st.config.platformName, tagline: st.config.tagline, stateName: st.config.stateName, announcement: st.config.announcement, demoMode: st.config.demoMode },
    now: Date.now(),
  };
}
const pct = (a, b) => b === 0 ? 0 : Math.round((a / b) * 1000) / 10;

function incShort(i) {
  const st = S();
  return {
    id: i.id, code: i.code, category: i.category, subcategory: i.subcategory, severity: i.severity, level: `LEVEL ${i.severity}`,
    status: i.status, puId: i.puId, wardId: i.wardId, lgaId: i.lgaId, lga: st.lgas.find(l => l.id === i.lgaId)?.name,
    senatorial: st.lgas.find(l => l.id === i.lgaId)?.senatorial, description: i.description, createdAt: i.createdAt, updatedAt: i.updatedAt,
    reporterId: i.reporterId, updates: i.updates?.slice(0, 6),
  };
}
function sosShort(s) {
  const st = S();
  return { id: s.id, code: s.code, category: s.category, status: s.status, puId: s.puId, wardId: s.wardId, lgaId: s.lgaId, lga: st.lgas.find(l => l.id === s.lgaId)?.name, createdAt: s.createdAt, acks: s.acks, updates: s.updates, agentId: s.agentId };
}
function streamShort(s) {
  const st = S();
  const a = st.agents.find(x => x.id === s.agentId);
  const pu = st.pus.find(p => p.id === s.puId);
  return { id: s.id, agentId: s.agentId, agentName: a?.name || '—', puId: s.puId, puName: pu?.name, wardId: s.wardId, lgaId: s.lgaId, lga: st.lgas.find(l => l.id === s.lgaId)?.name, status: s.status, startedAt: s.startedAt, bitrateKbps: s.bitrateKbps, fps: s.fps, viewers: s.viewers, quality: s.quality, pinned: s.pinned };
}

// ---------------- device authorization ----------------
function deviceAuthorized(agent) {
  const st = S();
  if (!agent || !agent.deviceId) return { ok: true };
  const d = st.devices.find(x => x.id === agent.deviceId);
  if (!d) return { ok: true };
  return { ok: d.status === 'APPROVED', status: d.status };
}

// ---------------- agent dashboard ----------------
function agentDashboard(user) {
  const st = S();
  const agent = st.agents.find(a => a.userId === user.id || a.id === user.agentId);
  if (!agent) return { error: 'NO_AGENT_ASSIGNMENT', message: 'This user is not linked to a field agent record.' };
  const pu = st.pus.find(p => p.id === agent.puId);
  const ward = st.wards.find(w => w.id === agent.wardId);
  const lga = st.lgas.find(l => l.id === agent.lgaId);
  const subs = st.submissions.filter(s => s.agentId === agent.id).map(s => ({
    id: s.id, code: s.code, election: st.elections.find(e => e.id === s.electionId)?.name, type: st.elections.find(e => e.id === s.electionId)?.type,
    status: s.status, submittedAt: s.submittedAt, anomalies: (s.anomalies || []).map(a => a.code),
    review: s.review ? { action: s.review.action, reason: s.review.reason, reviewer: s.review.reviewerName, at: s.review.at, second: s.review.secondAction ? { by: s.review.secondReviewerId, at: s.review.secondAt } : null } : null,
    verifiedAt: s.verifiedAt, rejectedAt: s.rejectedAt, note: s.note || '',
    custodies: (s.custodies || []).slice(-8), versions: (s.versions || []).length, evidenceIds: s.evidenceIds,
  })).sort((a, b) => b.submittedAt - a.submittedAt);
  const device = st.devices.find(d => d.id === agent.deviceId) || null;
  const incs = st.incidents.filter(i => i.reporterId === agent.id).map(incShort);
  const sosList = st.sosEvents.filter(s => s.agentId === agent.id).map(sosShort);
  const stats = {
    submissions: subs.length,
    verified: subs.filter(s => s.status === 'VERIFIED').length,
    rejected: subs.filter(s => s.status === 'REJECTED').length,
    incidents: incs.length,
    evidence: st.evidence.filter(e => e.agentId === agent.id).length,
    sos: sosList.length,
    fieldReports: st.fieldReports.filter(f => f.agentId === agent.id).length,
    syncCompletion: subs.length ? Math.round(subs.filter(s => s.status !== 'DRAFT').length / subs.length * 100) : 100,
  };
  const contacts = {
    supervisor: st.users.filter(u => u.roleId === 'supervisor' && u.status === 'ACTIVE').map(u => ({ id: u.id, name: u.name, role: 'Supervisory Agent' })),
    wardCoordinator: st.users.filter(u => u.roleId === 'wardcoord' && u.status === 'ACTIVE').map(u => ({ id: u.id, name: u.name, role: 'Ward Coordinator' })),
    lgCoordinator: st.users.filter(u => u.roleId === 'lgcoord' && u.status === 'ACTIVE' && (!u.scope || !u.scope.lga || u.scope.lga === lga?.name)).map(u => ({ id: u.id, name: u.name, role: 'LG Coordinator' })),
    techSupport: st.users.filter(u => u.roleId === 'support' && u.status === 'ACTIVE').map(u => ({ id: u.id, name: u.name, role: 'Technical Support' })),
    central: st.users.filter(u => u.roleId === 'director' && u.status === 'ACTIVE').map(u => ({ id: u.id, name: u.name, role: 'Central Operations' })),
    escalation: st.config.contacts?.escalation || 'Central Operations — via SOS channel',
  };
  return {
    agent: {
      id: agent.id, code: agent.code, name: agent.name, phone: agent.phone,
      dutyState: agent.dutyState, online: agent.online, network: agent.network, battery: agent.battery,
      gps: agent.gps, activatedAt: agent.activatedAt, checkedInAt: agent.checkedInAt, completedAt: agent.completedAt,
      signal: agent.signal || 'NORMAL', appVersion: agent.appVersion || '1.4.0',
    },
    assignment: { pu: pu ? { id: pu.id, name: pu.name, lat: pu.lat, lon: pu.lon } : null, ward: ward?.name, lga: lga?.name, senatorial: lga?.senatorial, state: 'Kano' },
    device: device ? { id: device.id, model: device.model, os: device.os, imei: device.imei, status: device.status, registeredAt: device.registeredAt, appVersion: '1.4.0' } : null,
    elections: st.elections.filter(e => e.status === 'ACTIVE').map(e => ({
      id: e.id, name: e.name, type: e.type,
      candidates: st.candidates.filter(c => c.electionId === e.id).map(c => ({ id: c.id, name: c.name, party: st.parties.find(p => p.id === c.partyId)?.code, partyName: st.parties.find(p => p.id === c.partyId)?.name, color: st.parties.find(p => p.id === c.partyId)?.color })),
    })),
    submissions: subs,
    incidents: incs.slice(0, 40),
    sos: sosList.slice(0, 10),
    notifications: st.notifications.filter(n => n.userId === user.id || (n.roleIds || []).includes(user.roleId)).slice(0, 30),
    sim: { now: st.meta.simNow, phase: sim.phaseOf(st.meta.simNow) },
    checklist: checklistFor(agent),
    stats, contacts,
    timeline: puTimeline(pu?.id, 40),
  };
}
function puTimeline(puId, limit) {
  const st = S();
  if (!puId) return [];
  const rows = [];
  const agent = st.agents.find(a => a.puId === puId);
  if (agent) {
    if (agent.activatedAt) rows.push({ t: agent.activatedAt, type: 'DUTY', label: 'Duty activated', detail: agent.code });
    if (agent.checkedInAt) rows.push({ t: agent.checkedInAt, type: 'DUTY', label: 'Agent checked in at polling unit' });
    if (agent.completedAt) rows.push({ t: agent.completedAt, type: 'DUTY', label: 'Duty completed & archived' });
  }
  for (const s of st.submissions.filter(x => x.puId === puId)) {
    rows.push({ t: s.submittedAt, type: 'RESULT', label: `Result submitted (${s.code || s.id.slice(0, 8)})`, detail: s.status });
    if (s.verifiedAt) rows.push({ t: s.verifiedAt, type: 'RESULT', label: 'Verification completed', detail: 'VERIFIED' });
    if (s.rejectedAt) rows.push({ t: s.rejectedAt, type: 'RESULT', label: 'Submission rejected — review required', detail: s.review?.reason });
  }
  for (const r of st.reviews.filter(x => st.submissions.find(s => s.id === x.submissionId)?.puId === puId)) {
    rows.push({ t: r.at, type: 'REVIEW', label: `Supervisor ${r.action.toLowerCase().replace(/_/g, ' ')}`, detail: r.reason });
  }
  for (const i of st.incidents.filter(x => x.puId === puId)) {
    rows.push({ t: i.createdAt, type: 'INCIDENT', label: `Incident ${i.code} — ${i.subcategory}`, detail: `L${i.severity} · ${i.status}` });
    for (const u of (i.updates || []).slice(1)) rows.push({ t: u.at, type: 'INCIDENT', label: `Incident ${i.code} — ${u.status || 'update'}`, detail: u.note });
  }
  for (const s of st.sosEvents.filter(x => x.puId === puId)) {
    rows.push({ t: s.createdAt, type: 'SOS', label: `SOS ${s.code} triggered`, detail: s.category });
    for (const u of (s.updates || []).slice(1)) rows.push({ t: u.at, type: 'SOS', label: `SOS ${s.code} — ${u.note}` });
  }
  for (const str of st.streams.filter(x => x.puId === puId)) {
    rows.push({ t: str.startedAt, type: 'VIDEO', label: 'Live stream started' });
    if (str.endedAt) rows.push({ t: str.endedAt, type: 'VIDEO', label: 'Live stream ended' });
  }
  for (const f of st.fieldReports.filter(x => x.puId === puId)) rows.push({ t: f.at, type: 'REPORT', label: `Field report — ${f.type}`, detail: f.note });
  rows.sort((a, b) => b.t - a.t);
  return rows.slice(0, limit || 40);
}
function checklistFor(agent) {
  const st = S();
  const phase = sim.phaseOf(st.meta.simNow);
  const s = (agent && agent.puId) ? null : null;
  return [
    { id: 'device', label: 'Device registered & approved', done: !!agent.deviceId },
    { id: 'gps', label: 'GPS verified at polling unit', done: !!agent.gps },
    { id: 'activate', label: 'Duty activated', done: ['ACTIVATED', 'ON_DUTY', 'POLLING_MONITORING', 'RESULT_RECEIVED', 'RESULT_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'].includes(agent.dutyState) },
    { id: 'checkin', label: 'Checked in at polling unit', done: !!agent.checkedInAt },
    { id: 'observe', label: 'Opening observation logged', done: phase !== 'PRE-OPENING' && agent.checkedInAt },
    { id: 'accred', label: 'Accreditation progress reported', done: phase !== 'PRE-OPENING' && phase !== 'VOTING' ? true : !!agent.checkedInAt },
    { id: 'result', label: 'Result captured & submitted', done: ['RESULT_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'].includes(agent.dutyState) },
    { id: 'verify', label: 'Submission reviewed', done: ['UNDER_REVIEW', 'VERIFIED', 'REJECTED'].includes(agent.dutyState) },
    { id: 'complete', label: 'Duty completed & archived', done: agent.dutyState === 'DUTY_COMPLETED' },
  ];
}

// ---------------- router ----------------
const routes = [];

function route(method, pattern, handler, opts = {}) {
  routes.push({ method, pattern, handler, opts });
}

// --- public ---
route('GET', /^\/api\/health$/, (req, res) => {
  const h = S().systemHealth;
  sendJson(res, 200, { status: 'ok', time: Date.now(), simNow: S().meta.simNow, services: h, serverless: IS_SERVERLESS });
});

route('GET', /^\/api\/public\/statistics$/, (req, res) => {
  const st = S();
  const ag = reports.aggregates();
  const lgas = reports.lgAggregates();
  const released = st.publicReleases;
  const senatorial = st.senatorial.map(sd => {
    const ls = Object.values(lgas).filter(x => x.senatorial === sd);
    return { name: sd, totalPu: ls.reduce((a, x) => a + x.totalPu, 0), reported: ls.reduce((a, x) => a + x.submitted, 0), verified: ls.reduce((a, x) => a + x.verified, 0), verifiedPct: pct(ls.reduce((a, x) => a + x.verified, 0), ls.reduce((a, x) => a + x.totalPu, 0)), reportedPct: pct(ls.reduce((a, x) => a + x.submitted, 0), ls.reduce((a, x) => a + x.totalPu, 0)) };
  });
  sendJson(res, 200, {
    disclaimer: 'UNOFFICIAL MONITORING DATA — DEMO SIMULATION. NOT INEC OFFICIAL RESULTS.',
    demo: true, lastUpdated: Date.now(),
    kpis: { reported: ag.submittedPu, verified: ag.verifiedPu, totalPu: ag.totalPu, reportingPct: ag.reportingPct, verifiedPct: ag.verifiedPct, incidents: ag.activeIncidents, critical: ag.criticalIncidents, activeSos: ag.activeSos },
    senatorial, lgas: Object.values(lgas).map(x => ({ name: x.name, senatorial: x.senatorial, reported: x.submitted, verified: x.verified, totalPu: x.totalPu, reportingPct: x.reportingPct, verifiedPct: x.verifiedPct })),
    releases: released.length,
    irev: (() => {
      try {
        const r = irev.reconcileState();
        return {
          status: irev.cfg().sourceHealth.status,
          observed: r.kpis.observed,
          pending: r.kpis.pending,
          matched: r.kpis.matched,
          coveragePct: r.kpis.coveragePct,
          reconciliationPct: r.kpis.reconciliationPct,
          casesUnderReview: r.kpis.underReview,
          note: 'Aggregated observation status of publicly available IReV result information. Not INEC internal data. Individual records and evidence are never published.',
        };
      } catch (e) { return null; }
    })(),
  });
});

route('GET', /^\/api\/public\/results$/, (req, res) => {
  const st = S();
  const url = new URL(req.url, 'http://x');
  const election = url.searchParams.get('election') || 'e-gov-2027';
  const lga = url.searchParams.get('lga');
  const subs = st.submissions.filter(s => s.status === 'VERIFIED' && s.electionId === election && (!lga || s.lgaId === lga));
  const byLga = {};
  for (const s of subs) {
    const l = st.lgas.find(x => x.id === s.lgaId);
    if (!byLga[s.lgaId]) byLga[s.lgaId] = { lgaId: s.lgaId, lga: l?.name, senatorial: l?.senatorial, puCount: 0, candidates: {}, registered: 0, accredited: 0, valid: 0, rejected: 0 };
    byLga[s.lgaId].puCount++;
    byLga[s.lgaId].registered += s.registered; byLga[s.lgaId].accredited += s.accredited;
    byLga[s.lgaId].valid += s.validVotes; byLga[s.lgaId].rejected += s.rejected;
    for (const it of s.items) {
      byLga[s.lgaId].candidates[it.candidateId] = (byLga[s.lgaId].candidates[it.candidateId] || 0) + it.votes;
    }
  }
  const candidates = st.candidates.filter(c => c.electionId === election);
  const out = Object.values(byLga).map(x => ({
    ...x, candidates: candidates.map(c => ({ id: c.id, name: c.name, party: st.parties.find(p => p.id === c.partyId)?.code, color: st.parties.find(p => p.id === c.partyId)?.color, votes: x.candidates[c.id] || 0 })),
  }));
  sendJson(res, 200, { disclaimer: 'UNOFFICIAL MONITORING DATA — DEMO SIMULATION. NOT INEC OFFICIAL RESULTS.', status: 'VERIFIED BY MONITORING SYSTEM', updatedAt: Date.now(), results: out });
});

route('GET', /^\/api\/public\/incidents$/, (req, res) => {
  const st = S();
  const cats = {};
  for (const i of st.incidents) {
    const k = `${i.category} — ${i.subcategory}`;
    cats[k] = cats[k] || { count: 0, levels: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    cats[k].count++; cats[k].levels[i.severity]++;
  }
  const byLga = st.lgas.map(l => ({ name: l.name, senatorial: l.senatorial, count: st.incidents.filter(i => i.lgaId === l.id).length, open: st.incidents.filter(i => i.lgaId === l.id && !['RESOLVED', 'CLOSED'].includes(i.status)).length }));
  sendJson(res, 200, { disclaimer: 'Aggregated incident counts only. No personal information is published.', incidents: Object.entries(cats).map(([k, v]) => ({ category: k, ...v })), byLga });
});

route('GET', /^\/api\/public\/geo$/, (req, res) => {
  const st = S();
  const geo = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'geo.json'), 'utf8'));
  // public-safe geography: LGA polygons only (no agent locations)
  sendJson(res, 200, {
    bounds: geo.bounds,
    lgas: st.lgas.map(l => ({ id: l.id, name: l.name, senatorial: l.senatorial, centroid: l.centroid, poly: l.poly })),
    pus: st.pus.map(p => ({ id: p.id, name: p.name, wardId: p.wardId, lgaId: p.lgaId, x: p.x, y: p.y })),
    wards: st.wards.map(w => ({ id: w.id, lgaId: w.lgaId, name: w.name, centroid: w.centroid, poly: w.poly })),
  });
});

route('GET', /^\/api\/public\/updates$/, (req, res) => {
  const st = S();
  const rel = st.publicReleases.slice(0, 12).map(r => {
    const s = st.submissions.find(x => x.id === r.submissionId);
    return { id: r.id, pu: s?.puId, lga: s ? st.lgas.find(l => l.id === s.lgaId)?.name : null, election: s ? st.elections.find(e => e.id === s.electionId)?.type : null, at: r.releasedAt };
  });
  sendJson(res, 200, { updates: rel, disclaimer: 'Simulated feed of verification milestones.' });
});

// --- auth ---
route('POST', /^\/api\/auth\/login$/, (req, res, body) => {
  if (auth.rateLimit(req, res, { windowMs: 60000, max: 20, key: 'login' })) return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many sign-in attempts. Please wait a moment and try again.' });
  return auth.loginStep1(req, res, body);
});
route('POST', /^\/api\/auth\/mfa$/, (req, res, body) => auth.loginStep2(req, res, body));
route('POST', /^\/api\/auth\/logout$/, (req, res) => {
  const u = auth.currentUser(req);
  if (u) { delete S().sessions[u.sessionToken]; audit(u, 'LOGOUT', 'session', u.sessionToken.slice(0, 8), '', req); }
  sendJson(res, 200, { ok: true });
});
route('GET', /^\/api\/me$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { user: auth.publicUser(u), permissions: S().roles.find(r => r.id === u.roleId)?.permissions || [], sim: { now: S().meta.simNow, phase: sim.phaseOf(S().meta.simNow) } });
});

// --- bootstrap (geo + reference data) ---
route('GET', /^\/api\/bootstrap$/, (req, res) => {
  const st = S();
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, {
    bounds: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'geo.json'), 'utf8')).bounds,
    lgas: st.lgas.map(l => ({ id: l.id, code: l.code, name: l.name, senatorial: l.senatorial, centroid: l.centroid, poly: l.poly, lat: l.lat, lon: l.lon })),
    wards: st.wards.map(w => ({ id: w.id, lgaId: w.lgaId, name: w.name, centroid: w.centroid, poly: w.poly })),
    pus: st.pus.map(p => ({ id: p.id, name: p.name, wardId: p.wardId, lgaId: p.lgaId, lat: p.lat, lon: p.lon, x: p.x, y: p.y })),
    senatorial: st.senatorial,
    elections: st.elections, candidates: st.candidates, parties: st.parties,
    config: st.config, users: auth.can(u, 'admin.users') ? st.users.map(x => ({ id: x.id, username: x.username, name: x.name, roleId: x.roleId, status: x.status, scope: x.scope, phone: x.phone })) : [],
    roles: auth.can(u, 'admin.roles') ? st.roles : [],
    agents: auth.can(u, 'agents.view') ? st.agents.map(a => ({ id: a.id, code: a.code, name: a.name, puId: a.puId, lgaId: a.lgaId, dutyState: a.dutyState, online: a.online })) : [],
  });
});

// --- overview & dashboards ---
route('GET', /^\/api\/overview$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  req.user = u;
  if (!auth.can(u, 'dashboard.view')) return sendJson(res, 403, { error: 'FORBIDDEN' });
  sendJson(res, 200, overview(u));
});
route('GET', /^\/api\/agent\/dashboard$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const d = agentDashboard(u);
  if (d.error) return sendJson(res, 404, d);
  sendJson(res, 200, d);
});

// --- results ---
route('GET', /^\/api\/results\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const sub = st.submissions.find(s => s.id === m[1]);
  if (!sub) return sendJson(res, 404, { error: 'NOT_FOUND' });
  // field agents may read their OWN submissions even without results.view
  let owner = false;
  if (!auth.can(u, 'results.view')) {
    const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
    if (!agent || sub.agentId !== agent.id) return sendJson(res, 403, { error: 'FORBIDDEN' });
    owner = true;
  }
  const ev = sub.evidenceIds.map(id => st.evidence.find(e => e.id === id));
  sendJson(res, 200, {
    ...sub,
    pu: st.pus.find(p => p.id === sub.puId), ward: st.wards.find(w => w.id === sub.wardId)?.name,
    lga: st.lgas.find(l => l.id === sub.lgaId)?.name, senatorial: sub.senatorial,
    election: st.elections.find(e => e.id === sub.electionId),
    candidates: st.candidates.filter(c => c.electionId === sub.electionId).map(c => ({ id: c.id, name: c.name, party: st.parties.find(p => p.id === c.partyId)?.code, partyName: st.parties.find(p => p.id === c.partyId)?.name, color: st.parties.find(p => p.id === c.partyId)?.color })),
    items: sub.items, evidence: ev, custodies: sub.custodies, versions: sub.versions,
    review: sub.review, relatedReviews: st.reviews.filter(r => r.submissionId === sub.id),
    dispute: st.disputes.find(d => d.submissionId === sub.id) || null,
  });
});
route('GET', /^\/api\/results$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  let list = [...st.submissions];
  const q = url.searchParams.get('q');
  const status = url.searchParams.get('status'); const lga = url.searchParams.get('lga'); const ward = url.searchParams.get('ward');
  const election = url.searchParams.get('election') || 'e-gov-2027'; const senatorial = url.searchParams.get('senatorial');
  const anomaly = url.searchParams.get('anomaly');
  list = list.filter(s => s.electionId === election);
  if (status) list = list.filter(s => s.status === status);
  if (lga) list = list.filter(s => s.lgaId === lga);
  if (ward) list = list.filter(s => s.wardId === ward);
  if (senatorial) list = list.filter(s => s.senatorial === senatorial);
  if (anomaly) list = list.filter(s => (s.anomalies || []).length > 0);
  if (q) {
    const ql = q.toLowerCase();
    list = list.filter(s => s.puId.toLowerCase().includes(ql) || (st.pus.find(p => p.id === s.puId)?.name || '').toLowerCase().includes(ql) || (st.agents.find(a => a.id === s.agentId)?.name || '').toLowerCase().includes(ql));
  }
  list.sort((a, b) => b.submittedAt - a.submittedAt);
  const total = list.length;
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(500, parseInt(url.searchParams.get('limit') || '100', 10));
  list = list.slice(offset, offset + limit);
  sendJson(res, 200, { total, offset, rows: list.map(s => ({
    id: s.id, code: s.code, puId: s.puId, puName: st.pus.find(p => p.id === s.puId)?.name, ward: st.wards.find(w => w.id === s.wardId)?.name,
    lga: st.lgas.find(l => l.id === s.lgaId)?.name, senatorial: s.senatorial, agent: st.agents.find(a => a.id === s.agentId)?.name || s.agentId,
    status: s.status, anomalies: (s.anomalies || []).map(a => a.code), submittedAt: s.submittedAt, registered: s.registered, accredited: s.accredited, validVotes: s.validVotes, rejected: s.rejected,
  })) });
});

route('POST', /^\/api\/results$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.submit')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  if (agent.dutyState === 'DUTY_COMPLETED') return sendJson(res, 400, { error: 'DUTY_COMPLETED', message: 'Duty completed — new submissions are disabled. Data is preserved in read-only mode.' });
  const dv = deviceAuthorized(agent);
  if (!dv.ok) return sendJson(res, 403, { error: 'DEVICE_NOT_AUTHORIZED', message: `This device is ${dv.status}. A ${dv.status.toLowerCase()} device cannot submit new evidence. Contact technical support.` });
  const election = st.elections.find(e => e.id === body.electionId && e.status === 'ACTIVE');
  if (!election) return sendJson(res, 400, { error: 'BAD_ELECTION' });
  if (body.puId !== agent.puId) return sendJson(res, 400, { error: 'PU_MISMATCH', message: 'You may only submit for your assigned polling unit.' });
  const existing = st.submissions.filter(s => s.puId === agent.puId && s.electionId === election.id);
  // duplicates are never silently overwritten; resubmission is only possible when the
  // prior submission was REJECTED or DISPUTED — the original always remains on record
  const blocking = existing.find(s => !['REJECTED', 'DISPUTED'].includes(s.status));
  if (blocking) return sendJson(res, 409, { error: 'DUPLICATE', message: 'A similar submission already exists for this polling unit and election. Review before submitting again — the original record is preserved.' });

  const candidates = st.candidates.filter(c => c.electionId === election.id);
  const items = (body.items || []).map(it => ({
    candidateId: it.candidateId, partyId: candidates.find(c => c.id === it.candidateId)?.partyId,
    votes: parseInt(it.votes, 10) || 0,
  }));
  if (items.length !== candidates.length) return sendJson(res, 400, { error: 'BAD_ITEMS', message: 'A vote figure is required for every candidate.' });

  const sub = {
    id: util.uuid(), code: nextCode(st, 'submission'), electionId: election.id, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
    senatorial: st.lgas.find(l => l.id === agent.lgaId)?.senatorial,
    agentId: agent.id, status: 'UNVERIFIED', items,
    validVotes: parseInt(body.validVotes, 10) || 0, rejected: parseInt(body.rejected, 10) || 0,
    accredited: parseInt(body.accredited, 10) || 0, registered: parseInt(body.registered, 10) || 0,
    totalBallots: (parseInt(body.validVotes, 10) || 0) + (parseInt(body.rejected, 10) || 0),
    ocr: body.ocr || null, anomalies: [], submittedAt: st.meta.simNow, receivedAt: st.meta.simNow,
    verification: null, versions: [], custodies: [{ at: st.meta.simNow, step: 'SUBMITTED', by: agent.id }],
    evidenceIds: [], source: 'LIVE',
    note: String(body.note || '').slice(0, 400), supersedes: existing.filter(e => e.status === 'REJECTED').map(e => e.id),
  };

  // evidence handling: hash + store (immutable originals)
  for (const evBody of (body.evidence || [])) {
    if (!evBody.dataUrl || typeof evBody.dataUrl !== 'string') continue;
    const hash = util.sha256(evBody.dataUrl);
    const buf = Buffer.from(evBody.dataUrl.split(',')[1] || '', 'base64');
    const ev = {
      id: util.uuid(), code: nextCode(st, 'evidence'), submissionId: sub.id, kind: evBody.kind || 'EC8A',
      sha256: hash, sizeBytes: buf.length, pages: evBody.pages || 1, mime: 'image/png',
      capturedAt: st.meta.simNow, deviceId: agent.deviceId, agentId: agent.id, gps: agent.gps,
      uploadedAt: st.meta.simNow, dataUrl: evBody.dataUrl,
      chain: [{ at: st.meta.simNow, step: 'CAPTURED', by: agent.id }, { at: st.meta.simNow, step: 'UPLOADED', by: agent.id }, { at: st.meta.simNow + 10, step: 'RECEIVED', by: 'platform' }],
    };
    st.evidence.push(ev);
    sub.evidenceIds.push(ev.id);
  }
  // mark superseded (rejected) submissions so their history references the replacement
  for (const oldId of sub.supersedes) {
    const old = st.submissions.find(s => s.id === oldId);
    if (old) old.supersededBy = sub.id;
  }

  const ctx = { existing, dupHash: st.evidence.some(e => e.kind === 'EC8A' && e.sha256 !== util.sha256('') && st.evidence.some(e2 => e2 !== e && e2.sha256 === e.sha256)) };
  const vres = validateSubmission(sub, ctx);
  sub.anomalies = vres.flags;
  sub.validation = vres;
  sub.status = 'SUBMITTED';
  st.submissions.unshift(sub);
  agent.dutyState = 'RESULT_SUBMITTED'; agent.submittedAt = st.meta.simNow;
  audit(u, 'RESULT_SUBMITTED', 'submission', sub.id, `${sub.puId} • ${election.type} • ${vres.flags.length} flag(s)`, req);
  if (vres.flags.length) {
    notify(['supervisor', 'reviewer'], 'Data anomaly flagged', `${sub.puId}: ${vres.flags.map(f => f.code).join(', ')} — Requires Human Review`, { priority: 'MEDIUM', link: '/supervisor' });
  }
  notify(null, 'Result received', `Your submission for ${sub.puId} is queued for verification.`, { userId: u.id, priority: 'LOW', link: '/agent' });
  broadcastSse({ kind: 'event', type: 'result.submitted', submissionId: sub.id, puId: sub.puId, lgaId: sub.lgaId, electionId: sub.electionId, anomalous: vres.flags.length > 0 });
  set(() => {});
  sendJson(res, 201, { id: sub.id, code: sub.code, status: sub.status, anomalies: sub.anomalies });
});

route('POST', /^\/api\/results\/([^/]+)\/verify$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.verify')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const sub = st.submissions.find(s => s.id === m[1]);
  if (!sub) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (!['SUBMITTED', 'UNDER_REVIEW'].includes(sub.status)) return sendJson(res, 400, { error: 'BAD_STATE', message: `Submission is ${sub.status} — cannot review.` });
  const action = String(body.action || '').toUpperCase();
  if (!['APPROVE', 'REJECT', 'REQUEST_CLARIFICATION', 'FLAG_SECOND_REVIEW', 'MARK_DISPUTED'].includes(action)) return sendJson(res, 400, { error: 'BAD_ACTION' });
  if (['REJECT', 'MARK_DISPUTED'].includes(action) && !(body.reason || '').trim()) return sendJson(res, 400, { error: 'REASON_REQUIRED', message: 'A reason is required when rejecting or disputing a result.' });

  if (action === 'FLAG_SECOND_REVIEW' || (action === 'APPROVE' && (sub.anomalies || []).length > 0 && body.requireSecond)) {
    sub.status = 'UNDER_REVIEW';
    sub.review = { id: util.uuid(), submissionId: sub.id, reviewerId: u.id, reviewerName: u.name, action: 'FLAG_SECOND_REVIEW', reason: body.reason || 'Dual-control verification required', at: st.meta.simNow, requiresSecond: true };
    st.reviews.unshift(sub.review);
    sub.custodies.push({ at: st.meta.simNow, step: 'FLAGGED_FOR_SECOND_REVIEW', by: u.id, note: body.reason || '' });
    audit(u, 'RESULT_FLAGGED_SECOND_REVIEW', 'submission', sub.id, `${sub.puId} — ${body.reason || 'dual control'}`, req);
    notify(['supervisor', 'reviewer'], 'Second review required', `${sub.puId} — dual-control verification needed`, { priority: 'HIGH', link: `/supervisor?sub=${sub.id}` });
    broadcastSse({ kind: 'event', type: 'result.flag_second', submissionId: sub.id, puId: sub.puId });
    set(() => {});
    return sendJson(res, 200, { ok: true, status: sub.status, requiresSecond: true });
  }
  if (action === 'REQUEST_CLARIFICATION') {
    sub.status = 'UNDER_REVIEW';
    sub.review = { id: util.uuid(), submissionId: sub.id, reviewerId: u.id, reviewerName: u.name, action: 'REQUEST_CLARIFICATION', reason: body.reason || 'Clarification requested from field agent', at: st.meta.simNow };
    st.reviews.unshift(sub.review);
    sub.custodies.push({ at: st.meta.simNow, step: 'CLARIFICATION_REQUESTED', by: u.id, note: body.reason || '' });
    const agent = st.agents.find(a => a.id === sub.agentId);
    if (agent?.userId) notify(null, 'Clarification requested', `${sub.puId}: ${body.reason || 'Reviewer requires clarification'}`, { userId: agent.userId, priority: 'HIGH', link: '/agent' });
    audit(u, 'RESULT_CLARIFICATION', 'submission', sub.id, sub.puId, req);
    broadcastSse({ kind: 'event', type: 'result.clarification', submissionId: sub.id });
    set(() => {});
    return sendJson(res, 200, { ok: true, status: sub.status });
  }
  const review = { id: util.uuid(), submissionId: sub.id, reviewerId: u.id, reviewerName: u.name, action, reason: body.reason || '', at: st.meta.simNow };
  sub.review = review;
  st.reviews.unshift(review);
  sim.finalizeReview(sub, review, st.meta.simNow, []);
  audit(u, `RESULT_${action}`, 'submission', sub.id, `${sub.puId} — ${body.reason || ''}`, req);
  broadcastSse({ kind: 'event', type: 'result.' + action.toLowerCase().replace('_', ''), submissionId: sub.id, puId: sub.puId, lgaId: sub.lgaId, electionId: sub.electionId });
  set(() => {});
  sendJson(res, 200, { ok: true, status: sub.status });
});

route('POST', /^\/api\/results\/([^/]+)\/second-review$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.verify')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const sub = st.submissions.find(s => s.id === m[1]);
  if (!sub || !sub.review || !sub.review.requiresSecond) return sendJson(res, 400, { error: 'BAD_STATE', message: 'No pending second review for this submission.' });
  if (sub.review.reviewerId === u.id) return sendJson(res, 400, { error: 'SAME_REVIEWER', message: 'Dual control requires a different reviewer.' });
  const confirm = body.action === 'CONFIRM';
  sub.review.secondReviewerId = u.id; sub.review.secondAt = st.meta.simNow; sub.review.secondAction = confirm ? 'CONFIRM' : 'DECLINE';
  sub.review.requiresSecond = false;
  if (confirm) {
    sub.review.action = 'APPROVE';
    sim.finalizeReview(sub, sub.review, st.meta.simNow, []);
    audit(u, 'RESULT_SECOND_APPROVE', 'submission', sub.id, `${sub.puId} — dual control confirmed`, req);
    broadcastSse({ kind: 'event', type: 'result.verified', submissionId: sub.id, puId: sub.puId, lgaId: sub.lgaId, electionId: sub.electionId });
  } else {
    sub.status = 'DISPUTED';
    sub.custodies.push({ at: st.meta.simNow, step: 'DISPUTED', by: u.id, note: body.reason || 'Second reviewer declined confirmation' });
    st.disputes.unshift({ id: util.uuid(), submissionId: sub.id, reason: body.reason || 'Second reviewer declined confirmation', status: 'OPEN', createdBy: u.id, createdAt: st.meta.simNow, resolution: null });
    audit(u, 'RESULT_DISPUTED', 'submission', sub.id, sub.puId, req);
  }
  set(() => {});
  sendJson(res, 200, { ok: true, status: sub.status });
});

route('POST', /^\/api\/results\/([^/]+)\/correct$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.override')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const sub = st.submissions.find(s => s.id === m[1]);
  if (!sub) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (!(body.reason || '').trim()) return sendJson(res, 400, { error: 'REASON_REQUIRED', message: 'A correction requires a documented reason.' });
  // Four-eyes: correction proposal needs second approval (unless demo bypass flag)
  if (body.approvedBySecond) {
    applyCorrection(sub, u, body, null);
  } else {
    const ch = { id: util.uuid(), submissionId: sub.id, proposedBy: u.id, proposedByName: u.name, reason: body.reason, changes: body.changes || [], status: 'PENDING_APPROVAL', createdAt: st.meta.simNow, approvedBy: null, approvedAt: null };
    st.changes.unshift(ch);
    audit(u, 'RESULT_CORRECTION_PROPOSED', 'submission', sub.id, `v${(sub.versions.length + 1)} — ${body.reason}`, req);
    notify(['director', 'supervisor'], 'Correction awaiting approval', `${sub.puId}: correction proposed by ${u.name} (four-eyes control)`, { priority: 'HIGH', link: `/central?tab=verify` });
    sendJson(res, 200, { ok: true, changeId: ch.id, status: 'PENDING_APPROVAL' });
  }
  set(() => {});
});
function applyCorrection(sub, approver, body, proposal) {
  const st = S();
  const version = { no: sub.versions.length + 1, previous: sub.items.map(i => ({ ...i })), changes: proposal ? proposal.changes : body.changes, reason: proposal ? proposal.reason : body.reason, by: proposal ? proposal.proposedBy : approver.id, approvedBy: approver.id, at: st.meta.simNow };
  for (const c of (proposal ? proposal.changes : body.changes)) {
    const it = sub.items.find(i => i.candidateId === c.candidateId);
    if (it) it.votes = parseInt(c.votes, 10);
  }
  const vSum = sub.items.reduce((a, b) => a + b.votes, 0);
  sub.validVotes = vSum; sub.totalBallots = vSum + sub.rejected;
  sub.versions.push(version);
  sub.custodies.push({ at: st.meta.simNow, step: 'CORRECTED', by: approver.id, note: `Version ${version.no} applied` });
  audit(approver, 'RESULT_CORRECTED', 'submission', sub.id, `v${version.no} — ${version.reason}`, null);
}
route('POST', /^\/api\/changes\/([^/]+)\/approve$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.override')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const ch = st.changes.find(c => c.id === m[1]);
  if (!ch || ch.status !== 'PENDING_APPROVAL') return sendJson(res, 400, { error: 'BAD_STATE' });
  if (ch.proposedBy === u.id) return sendJson(res, 400, { error: 'SAME_USER', message: 'Four-eyes principle: a different authorized user must approve.' });
  const sub = st.submissions.find(s => s.id === ch.submissionId);
  if (!sub) return sendJson(res, 404, { error: 'NOT_FOUND' });
  ch.status = 'APPROVED'; ch.approvedBy = u.id; ch.approvedAt = st.meta.simNow;
  applyCorrection(sub, u, null, ch);
  set(() => {});
  sendJson(res, 200, { ok: true, version: sub.versions.length });
});

// --- incidents ---
route('GET', /^\/api\/incidents\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'incidents.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const inc = S().incidents.find(i => i.id === m[1]);
  if (!inc) return sendJson(res, 404, { error: 'NOT_FOUND' });
  sendJson(res, 200, incShort(inc));
});
route('GET', /^\/api\/incidents$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'incidents.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  let list = [...st.incidents];
  const status = url.searchParams.get('status'); const sev = url.searchParams.get('severity'); const lga = url.searchParams.get('lga');
  const cat = url.searchParams.get('category'); const senatorial = url.searchParams.get('senatorial');
  if (status) list = list.filter(i => i.status === status);
  if (sev) list = list.filter(i => String(i.severity) === sev);
  if (lga) list = list.filter(i => i.lgaId === lga);
  if (cat) list = list.filter(i => i.category === cat);
  if (senatorial) list = list.filter(i => st.lgas.find(l => l.id === i.lgaId)?.senatorial === senatorial);
  const openFirst = (a, b) => (['RESOLVED', 'CLOSED'].includes(a.status) ? 1 : 0) - (['RESOLVED', 'CLOSED'].includes(b.status) ? 1 : 0) || b.createdAt - a.createdAt;
  list.sort(openFirst);
  const total = list.length;
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '100', 10));
  list = list.slice(offset, offset + limit);
  sendJson(res, 200, { total, rows: list.map(incShort) });
});
route('POST', /^\/api\/incidents$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'incidents.create')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (agent) {
    const dv = deviceAuthorized(agent);
    if (!dv.ok) return sendJson(res, 403, { error: 'DEVICE_NOT_AUTHORIZED', message: `This device is ${dv.status}. A ${dv.status.toLowerCase()} device cannot submit new evidence. Contact technical support.` });
  }
  const pu = agent ? st.pus.find(p => p.id === agent.puId) : (body.puId ? st.pus.find(p => p.id === body.puId) : null);
  const inc = {
    id: util.uuid(), code: nextCode(st, 'incident'),
    category: body.category || 'OTHER', subcategory: body.subcategory || 'General observation',
    severity: Math.max(1, Math.min(5, parseInt(body.severity, 10) || 1)),
    puId: pu?.id || null, wardId: pu?.wardId || (agent?.wardId || null), lgaId: pu?.lgaId || (agent?.lgaId || null),
    gps: pu ? { lat: pu.lat, lon: pu.lon } : (agent?.gps || null),
    reporterId: agent?.id || u.id,
    description: String(body.description || '').slice(0, 800),
    status: 'NEW', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
    updates: [{ at: st.meta.simNow, status: 'NEW', by: u.id, note: 'Incident reported' }], mediaIds: [],
  };
  st.incidents.unshift(inc);
  audit(u, 'INCIDENT_CREATED', 'incident', inc.id, `${inc.code} ${inc.category}/${inc.subcategory} L${inc.severity}`, req);
  if (inc.severity >= 4) notify(['director', 'operator', 'incident', 'lgcoord'], `Level ${inc.severity} incident — ${inc.subcategory}`, `${inc.code} reported at ${pu?.name || 'field location'}`, { priority: inc.severity === 5 ? 'CRITICAL' : 'HIGH', link: '/central?tab=incidents' });
  broadcastSse({ kind: 'event', type: 'incident.created', incidentId: inc.id, severity: inc.severity, lgaId: inc.lgaId });
  set(() => {});
  sendJson(res, 201, { id: inc.id, code: inc.code });
});
route('POST', /^\/api\/incidents\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'incidents.manage')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const inc = st.incidents.find(i => i.id === m[1]);
  if (!inc) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const status = String(body.status || '').toUpperCase();
  if (!['ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'RESOLVED', 'CLOSED', 'DISPUTED'].includes(status)) return sendJson(res, 400, { error: 'BAD_STATUS' });
  inc.status = status; inc.updatedAt = st.meta.simNow;
  inc.updates.push({ at: st.meta.simNow, status, by: u.id, note: (body.note || '').slice(0, 300) });
  audit(u, `INCIDENT_${status}`, 'incident', inc.id, `${inc.code} — ${body.note || ''}`, req);
  broadcastSse({ kind: 'event', type: 'incident.updated', incidentId: inc.id, status });
  set(() => {});
  sendJson(res, 200, { ok: true, status });
});

// --- SOS ---
route('POST', /^\/api\/sos$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const dv = deviceAuthorized(agent);
  if (!dv.ok) return sendJson(res, 403, { error: 'DEVICE_NOT_AUTHORIZED', message: `This device is ${dv.status} and cannot send SOS. Contact technical support.` });
  const sos = {
    id: util.uuid(), code: nextCode(st, 'sos'),
    agentId: agent.id, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
    category: body.category || 'SECURITY_BREACH', gps: agent.gps,
    status: 'ACTIVE', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
    acks: [], updates: [{ at: st.meta.simNow, note: `SOS triggered by field agent (${body.note || 'no note'})` }],
  };
  st.sosEvents.unshift(sos);
  audit(u, 'SOS_TRIGGERED', 'sos', sos.id, `${sos.code} ${sos.category} @ ${sos.puId}`, req);
  notify(['director', 'operator', 'sencoord', 'lgcoord'], `EMERGENCY SOS — ${sos.category}`, `${sos.code} at ${sos.puId} (${st.lgas.find(l => l.id === sos.lgaId)?.name} LGA)`, { priority: 'CRITICAL', link: '/central?tab=sos' });
  broadcastSse({ kind: 'event', type: 'sos.triggered', sosId: sos.id, lgaId: sos.lgaId });
  set(() => {});
  sendJson(res, 201, { id: sos.id, code: sos.code, status: 'ACTIVE' });
});
route('GET', /^\/api\/sos$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'sos.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: S().sosEvents.map(sosShort) });
});
route('POST', /^\/api\/sos\/([^/]+)\/ack$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'sos.ack')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const sos = st.sosEvents.find(s => s.id === m[1]);
  if (!sos) return sendJson(res, 404, { error: 'NOT_FOUND' });
  sos.acks.push({ by: u.id, byName: u.name, role: u.roleId, at: st.meta.simNow, note: (body.note || '').slice(0, 200) });
  if (sos.status === 'ACTIVE') sos.status = 'ACKNOWLEDGED';
  sos.updatedAt = st.meta.simNow;
  sos.updates.push({ at: st.meta.simNow, note: `Acknowledged by ${u.name} (${u.roleId})` });
  audit(u, 'SOS_ACKNOWLEDGED', 'sos', sos.id, sos.code, req);
  broadcastSse({ kind: 'event', type: 'sos.updated', sosId: sos.id, status: sos.status });
  set(() => {});
  sendJson(res, 200, { ok: true, status: sos.status });
});
route('POST', /^\/api\/sos\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'sos.manage')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const sos = st.sosEvents.find(s => s.id === m[1]);
  if (!sos) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const status = String(body.status || '').toUpperCase();
  if (!['ACTIVE', 'ACKNOWLEDGED', 'RESPONDING', 'RESOLVED'].includes(status)) return sendJson(res, 400, { error: 'BAD_STATUS' });
  sos.status = status; sos.updatedAt = st.meta.simNow;
  sos.updates.push({ at: st.meta.simNow, note: `${status} — ${u.name} — ${(body.note || '').slice(0, 200)}` });
  audit(u, `SOS_${status}`, 'sos', sos.id, `${sos.code} — ${body.note || ''}`, req);
  broadcastSse({ kind: 'event', type: 'sos.updated', sosId: sos.id, status });
  set(() => {});
  sendJson(res, 200, { ok: true, status });
});

// --- streams ---
route('GET', /^\/api\/streams$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'streams.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const live = S().streams.filter(s => s.status === 'LIVE').map(streamShort);
  const recent = S().streams.filter(s => s.status !== 'LIVE').slice(0, 20).map(streamShort);
  sendJson(res, 200, { live, recent });
});
route('POST', /^\/api\/streams\/start$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'streams.start')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const dv = deviceAuthorized(agent);
  if (!dv.ok) return sendJson(res, 403, { error: 'DEVICE_NOT_AUTHORIZED', message: `This device is ${dv.status} and cannot start a live transmission.` });
  if (st.streams.some(s => s.agentId === agent.id && s.status === 'LIVE')) return sendJson(res, 400, { error: 'ALREADY_LIVE' });
  const str = { id: util.uuid(), agentId: agent.id, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId, status: 'LIVE', startedAt: st.meta.simNow, endedAt: null, planEnd: st.meta.simNow + 30 * 60000, planT: st.meta.simNow, bitrateKbps: 1400, fps: 24, viewers: 0, quality: 'GOOD', pinned: false, source: 'LIVE' };
  st.streams.unshift(str);
  audit(u, 'STREAM_STARTED', 'stream', str.id, `${agent.puId} by ${agent.name}`, req);
  broadcastSse({ kind: 'event', type: 'stream.started', streamId: str.id, lgaId: agent.lgaId });
  set(() => {});
  sendJson(res, 201, { id: str.id });
});
route('POST', /^\/api\/streams\/([^/]+)\/stop$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'streams.start')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const str = S().streams.find(s => s.id === m[1]);
  if (!str) return sendJson(res, 404, { error: 'NOT_FOUND' });
  str.status = 'ENDED'; str.endedAt = S().meta.simNow;
  audit(u, 'STREAM_ENDED', 'stream', str.id, str.puId, req);
  broadcastSse({ kind: 'event', type: 'stream.ended', streamId: str.id });
  set(() => {});
  sendJson(res, 200, { ok: true });
});
route('POST', /^\/api\/streams\/([^/]+)\/pin$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'streams.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const str = S().streams.find(s => s.id === m[1]);
  if (!str) return sendJson(res, 404, { error: 'NOT_FOUND' });
  str.pinned = !str.pinned;
  set(() => {});
  sendJson(res, 200, { pinned: str.pinned });
});

// --- agents ---
route('GET', /^\/api\/agents\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'agents.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const a = S().agents.find(x => x.id === m[1]);
  if (!a) return sendJson(res, 404, { error: 'NOT_FOUND' });
  sendJson(res, 200, { ...a, pu: S().pus.find(p => p.id === a.puId), ward: S().wards.find(w => w.id === a.wardId)?.name, lga: S().lgas.find(l => l.id === a.lgaId)?.name, device: S().devices.find(d => d.id === a.deviceId) });
});
route('GET', /^\/api\/agents$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'agents.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  let list = [...st.agents];
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const lga = url.searchParams.get('lga'); const state = url.searchParams.get('state');
  const senatorial = url.searchParams.get('senatorial');
  if (lga) list = list.filter(a => a.lgaId === lga);
  if (state) list = list.filter(a => a.dutyState === state);
  if (senatorial) list = list.filter(a => a.senatorial === senatorial);
  if (q) list = list.filter(a => a.name.toLowerCase().includes(q) || a.code.toLowerCase().includes(q) || a.puId.toLowerCase().includes(q));
  const total = list.length;
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '100', 10));
  list = list.slice(offset, offset + limit);
  sendJson(res, 200, { total, rows: list.map(a => ({ id: a.id, code: a.code, name: a.name, puId: a.puId, wardId: a.wardId, lgaId: a.lgaId, lga: st.lgas.find(l => l.id === a.lgaId)?.name, senatorial: a.senatorial, dutyState: a.dutyState, online: a.online, battery: a.battery, network: a.network, lastHeartbeat: a.lastHeartbeat, phone: a.phone, signal: a.signal || 'NORMAL', appVersion: a.appVersion || '1.4.0' })) });
});
route('POST', /^\/api\/agents\/heartbeat$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  agent.lastHeartbeat = st.meta.simNow; agent.online = true;
  if (body.gps) agent.gps = body.gps;
  if (body.battery != null) agent.battery = body.battery;
  if (body.network) agent.network = body.network;
  if (body.signal && ['NORMAL', 'ATTENTION', 'WARNING', 'CRITICAL'].includes(body.signal)) agent.signal = body.signal;
  if (body.appVersion) agent.appVersion = String(body.appVersion).slice(0, 20);
  set(() => {});
  sendJson(res, 200, { ok: true, simNow: st.meta.simNow });
});
route('POST', /^\/api\/agent\/duty$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const action = body.action;
  if (agent.dutyState === 'DUTY_COMPLETED' && action !== 'complete') {
    return sendJson(res, 400, { error: 'DUTY_COMPLETED', message: 'Duty completed — election-duty functions are locked. Evidence and records remain available read-only.' });
  }
  if (action === 'activate') {
    if (agent.dutyState !== 'NOT_ACTIVATED') return sendJson(res, 400, { error: 'BAD_STATE', message: `Duty state is ${agent.dutyState}` });
    agent.dutyState = 'ACTIVATED'; agent.activatedAt = st.meta.simNow; agent.online = true; agent.lastHeartbeat = st.meta.simNow;
    audit(u, 'DUTY_ACTIVATED', 'agent', agent.id, agent.puId, req);
    broadcastSse({ kind: 'event', type: 'agent.activated', agentId: agent.id });
  } else if (action === 'checkin') {
    agent.dutyState = 'ON_DUTY'; agent.checkedInAt = st.meta.simNow; agent.online = true; agent.lastHeartbeat = st.meta.simNow;
    audit(u, 'AGENT_CHECK_IN', 'agent', agent.id, agent.puId, req);
    broadcastSse({ kind: 'event', type: 'agent.online', agentId: agent.id, reason: 'checkin' });
  } else if (action === 'complete') {
    agent.dutyState = 'DUTY_COMPLETED'; agent.completedAt = st.meta.simNow; agent.online = false;
    audit(u, 'DUTY_COMPLETED', 'agent', agent.id, agent.puId, req);
    broadcastSse({ kind: 'event', type: 'agent.duty_completed', agentId: agent.id });
  } else {
    return sendJson(res, 400, { error: 'BAD_ACTION' });
  }
  set(() => {});
  sendJson(res, 200, { ok: true, dutyState: agent.dutyState });
});

// --- geography queries ---
route('GET', /^\/api\/lgas$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: S().lgas.map(l => ({ id: l.id, code: l.code, name: l.name, senatorial: l.senatorial })) });
});
route('GET', /^\/api\/wards$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const url = new URL(req.url, 'http://x');
  const lga = url.searchParams.get('lga');
  let rows = S().wards;
  if (lga) rows = rows.filter(w => w.lgaId === lga);
  sendJson(res, 200, { rows: rows.map(w => ({ id: w.id, name: w.name, lgaId: w.lgaId })) });
});
route('GET', /^\/api\/pus$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const url = new URL(req.url, 'http://x');
  const ward = url.searchParams.get('ward'); const lga = url.searchParams.get('lga'); const q = (url.searchParams.get('q') || '').toLowerCase();
  let rows = S().pus;
  if (ward) rows = rows.filter(p => p.wardId === ward);
  if (lga) rows = rows.filter(p => p.lgaId === lga);
  if (q) rows = rows.filter(p => p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
  sendJson(res, 200, { rows: rows.slice(0, 400).map(p => ({ id: p.id, name: p.name, wardId: p.wardId, lgaId: p.lgaId })) });
});

// --- notifications ---
route('GET', /^\/api\/notifications$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const rows = st.notifications.filter(n => n.userId === u.id || (n.roleIds || []).includes(u.roleId)).slice(0, 60);
  sendJson(res, 200, { rows, unread: rows.filter(r => !r.read).length });
});
route('POST', /^\/api\/notifications\/read$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  for (const n of st.notifications) {
    if ((body.id && n.id === body.id) || (!body.id && (n.userId === u.id || (n.roleIds || []).includes(u.roleId)))) n.read = true;
  }
  set(() => {});
  sendJson(res, 200, { ok: true });
});

// --- audit ---
route('GET', /^\/api\/audit$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'audit.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const action = url.searchParams.get('action');
  let list = st.audit;
  if (q) list = list.filter(a => (a.action + a.objectId + a.username + a.detail).toLowerCase().includes(q));
  if (action) list = list.filter(a => a.action.includes(action.toUpperCase()));
  const total = list.length;
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const limit = Math.min(300, parseInt(url.searchParams.get('limit') || '100', 10));
  sendJson(res, 200, { total, rows: list.slice(offset, offset + limit) });
});

route('GET', /^\/api\/verification\/stats$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.verify')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const rows = st.reviews.map(r => {
    const sub = st.submissions.find(s => s.id === r.submissionId);
    return { id: r.id, submission: r.submissionId, pu: sub?.puId || '', reviewer: r.reviewerName, action: r.action, reason: r.reason || '', at: r.at, secondReviewer: r.secondReviewerId || '' };
  });
  sendJson(res, 200, { rows });
});

// --- analytics ---
route('GET', /^\/api\/analytics\/timeseries$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'analytics.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const metric = url.searchParams.get('metric') || 'submissions';
  const bucketMin = parseInt(url.searchParams.get('bucket') || '30', 10);
  const start = new Date(st.meta.simNow); start.setUTCHours(5, 0, 0, 0);
  const buckets = [];
  for (let t = start.getTime(); t <= st.meta.simNow; t += bucketMin * 60000) {
    buckets.push({ t, count: 0 });
  }
  const inc = (ts) => { if (!ts) return; const b = Math.floor((ts - start.getTime()) / (bucketMin * 60000)); if (b >= 0 && b < buckets.length) buckets[b].count++; };
  if (metric === 'submissions') for (const s of st.submissions) inc(s.submittedAt);
  if (metric === 'verifications') for (const r of st.reviews) inc(r.at);
  if (metric === 'incidents') for (const i of st.incidents) inc(i.createdAt);
  if (metric === 'sos') for (const s of st.sosEvents) inc(s.createdAt);
  if (metric === 'streams') for (const s of st.streams) inc(s.startedAt);
  if (metric === 'checkins') for (const a of st.agents) inc(a.checkedInAt);
  if (metric === 'anomalies') for (const s of st.submissions.filter(x => x.anomalies?.length)) inc(s.submittedAt);
  sendJson(res, 200, { metric, bucketMin, start: start.getTime(), series: buckets });
});
route('GET', /^\/api\/analytics\/heatmap$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'analytics.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const metric = url.searchParams.get('metric') || 'reporting';
  const rows = st.lgas.map(l => {
    const pus = st.pus.filter(p => p.lgaId === l.id);
    const subs = st.submissions.filter(s => s.lgaId === l.id && s.electionId === 'e-gov-2027');
    let v = 0;
    if (metric === 'reporting') v = pct(new Set(subs.map(s => s.puId)).size, pus.length);
    if (metric === 'verified') v = pct(new Set(subs.filter(s => s.status === 'VERIFIED').map(s => s.puId)).size, pus.length);
    if (metric === 'incidents') v = st.incidents.filter(i => i.lgaId === l.id && !['RESOLVED', 'CLOSED'].includes(i.status)).length;
    if (metric === 'connectivity') { const ags = st.agents.filter(a => a.lgaId === l.id); v = pct(ags.filter(a => a.online).length, ags.length); }
    if (metric === 'pending') v = subs.filter(s => ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status)).length;
    return { lgaId: l.id, name: l.name, value: v };
  });
  sendJson(res, 200, { metric, rows });
});

// --- reports & exports ---
route('GET', /^\/api\/reports\/sitrep$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'reports.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const url = new URL(req.url, 'http://x');
  const scope = url.searchParams.get('scope') || 'state';
  const ref = url.searchParams.get('ref') || (u.scope?.lga || u.scope?.senatorial || 'Kano State');
  sendJson(res, 200, reports.sitrep(scope, ref));
});
route('GET', /^\/api\/export$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'reports.export')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const url = new URL(req.url, 'http://x');
  const type = url.searchParams.get('type') || 'results';
  const format = url.searchParams.get('format') || 'csv';
  if (!['results', 'incidents', 'verification', 'agents', 'audit', 'sitrep'].includes(type)) return sendJson(res, 400, { error: 'BAD_TYPE' });
  const rows = reports.exportRows(type);
  audit(u, 'DATA_EXPORT', 'export', type, `${format} • ${rows.length} rows`, req);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'json') return sendBuffer(res, 200, Buffer.from(JSON.stringify(rows, null, 1)), 'application/json', { 'Content-Disposition': `attachment; filename="ndc-${type}-${stamp}.json"` });
  if (format === 'xlsx') {
    const buf = reports.toXlsx(rows, type);
    return sendBuffer(res, 200, buf, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { 'Content-Disposition': `attachment; filename="ndc-${type}-${stamp}.xlsx"` });
  }
  sendBuffer(res, 200, Buffer.from(reports.toCsv(rows)), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="ndc-${type}-${stamp}.csv"` });
});

// --- copilot ---
route('POST', /^\/api\/copilot$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'copilot.use')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  audit(u, 'COPILOT_QUERY', 'copilot', null, String(body.query || '').slice(0, 120), req);
  const ql = String(body.query || '').toLowerCase();
  // SENTINEL SOC intents (security questions route to the security engine)
  if (/security|sentinel|threat level|vulnerab|isolat|compromised|privileged action|break.?glass|firewall|ddos|waf|malware|credential|patch|cyber|incident briefing|critical security|unresolved incident|block this source/.test(ql)) {
    return sendJson(res, 200, sentinel.copilot(body.query, u));
  }
  sendJson(res, 200, copilot.answer(body.query));
});

// --- search ---
route('GET', /^\/api\/search$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'search.global')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').toLowerCase().trim();
  if (!q) return sendJson(res, 200, { results: [] });
  const out = [];
  for (const a of st.agents) if (a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) { out.push({ type: 'AGENT', id: a.id, label: `${a.code} — ${a.name}`, sub: `PU ${a.puId} • ${a.dutyState}` }); if (out.length > 30) break; }
  for (const p of st.pus) if (p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) { out.push({ type: 'PU', id: p.id, label: `${p.code} — ${p.name}`, sub: `${st.wards.find(w => w.id === p.wardId)?.name} • ${st.lgas.find(l => l.id === p.lgaId)?.name} LGA` }); if (out.length > 30) break; }
  for (const w of st.wards) if (w.name.toLowerCase().includes(q)) { out.push({ type: 'WARD', id: w.id, label: w.name, sub: st.lgas.find(l => l.id === w.lgaId)?.name }); if (out.length > 30) break; }
  for (const l of st.lgas) if (l.name.toLowerCase().includes(q)) { out.push({ type: 'LGA', id: l.id, label: `${l.name} LGA`, sub: l.senatorial }); if (out.length > 30) break; }
  for (const i of st.incidents) if (i.code.toLowerCase().includes(q)) { out.push({ type: 'INCIDENT', id: i.id, label: i.code, sub: `${i.subcategory} • ${i.status}` }); if (out.length > 30) break; }
  for (const s of st.submissions) if (s.id.toLowerCase().includes(q)) { out.push({ type: 'SUBMISSION', id: s.id, label: s.puId, sub: s.status }); if (out.length > 30) break; }
  for (const o of irev.cfg().observations) if (o.code.toLowerCase().includes(q)) { out.push({ type: 'IREV_OBSERVATION', id: o.id, label: o.code, sub: `${o.puId} • snapshot #${o.snapshotNo}` }); if (out.length > 30) break; }
  for (const c of irev.cfg().cases) if (c.code.toLowerCase().includes(q)) { out.push({ type: 'IREV_CASE', id: c.id, label: c.code, sub: `${c.puId} • ${c.type} • ${c.status}` }); if (out.length > 30) break; }
  sendJson(res, 200, { results: out.slice(0, 40) });
});

// --- system health ---
route('GET', /^\/api\/system\/health$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'system.health')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, S().systemHealth);
});

// --- admin ---
route('GET', /^\/api\/admin\/users$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.users')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: S().users.map(x => auth.publicUser(x)) });
});
route('POST', /^\/api\/admin\/users$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.users')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!body.username || !body.password || !body.roleId) return sendJson(res, 400, { error: 'BAD_BODY' });
  if (st.users.some(x => x.username === body.username)) return sendJson(res, 409, { error: 'EXISTS' });
  const nu = { id: util.uuid(), username: body.username, name: body.name || body.username, roleId: body.roleId, scope: body.scope || {}, passwordHash: util.hashPassword(body.password), mfa: true, status: 'ACTIVE', phone: body.phone || '', createdAt: Date.now() };
  st.users.push(nu);
  audit(u, 'USER_CREATED', 'user', nu.id, nu.username, req);
  set(() => {});
  sendJson(res, 201, auth.publicUser(nu));
});
route('PATCH', /^\/api\/admin\/users\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.users')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const t = st.users.find(x => x.id === m[1]);
  if (!t) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const changes = [];
  if (body.status) { if (t.status !== body.status) changes.push(`status ${t.status}→${body.status}`); t.status = body.status; }
  if (body.roleId) { if (t.roleId !== body.roleId) changes.push(`role ${t.roleId}→${body.roleId}`); t.roleId = body.roleId; }
  if (body.scope) t.scope = body.scope;
  if (body.password) t.passwordHash = util.hashPassword(body.password);
  if (t.status === 'DISABLED') { for (const [tk, s] of Object.entries(st.sessions)) if (s.userId === t.id) delete st.sessions[tk]; }
  audit(u, 'USER_UPDATED', 'user', t.id, `${t.username} — ${changes.join(', ')}`, req);
  set(() => {});
  sendJson(res, 200, auth.publicUser(t));
});
route('PATCH', /^\/api\/admin\/roles\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.roles')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const r = st.roles.find(x => x.id === m[1]);
  if (!r) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (Array.isArray(body.permissions)) r.permissions = body.permissions;
  audit(u, 'ROLE_UPDATED', 'role', r.id, `${r.name} — ${r.permissions.length} permissions`, req);
  set(() => {});
  sendJson(res, 200, r);
});
route('GET', /^\/api\/admin\/devices$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.devices')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  sendJson(res, 200, { rows: st.devices.slice(0, 300).map(d => ({ ...d, agent: st.agents.find(a => a.id === d.agentId)?.name })) });
});
route('POST', /^\/api\/admin\/devices\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.devices')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const d = st.devices.find(x => x.id === m[1]);
  if (!d) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (['APPROVED', 'REVOKED', 'LOCKED'].includes(body.status)) d.status = body.status;
  audit(u, `DEVICE_${body.status}`, 'device', d.id, d.imei, req);
  set(() => {});
  sendJson(res, 200, d);
});
route('PATCH', /^\/api\/admin\/config$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.config')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const allowed = ['orgName', 'platformName', 'tagline', 'stateName', 'announcement', 'demoMode', 'pollOpen', 'pollClose'];
  for (const k of allowed) if (body[k] !== undefined) st.config[k] = body[k];
  audit(u, 'CONFIG_UPDATED', 'config', null, Object.keys(body).filter(k => allowed.includes(k)).join(','), req);
  set(() => {});
  sendJson(res, 200, st.config);
});
route('POST', /^\/api\/admin\/agents\/([^/]+)\/assign$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'agents.manage')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const a = st.agents.find(x => x.id === m[1]);
  if (!a) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const pu = st.pus.find(p => p.id === body.puId);
  if (!pu) return sendJson(res, 404, { error: 'PU_NOT_FOUND' });
  if (st.agents.some(x => x.id !== a.id && x.puId === pu.id)) return sendJson(res, 409, { error: 'PU_TAKEN', message: 'Another agent is already assigned to this polling unit.' });
  const prev = a.puId;
  a.puId = pu.id; a.wardId = pu.wardId; a.lgaId = pu.lgaId;
  a.senatorial = st.lgas.find(l => l.id === pu.lgaId)?.senatorial;
  a.gps = { lat: pu.lat, lon: pu.lon };
  audit(u, 'AGENT_REASSIGNED', 'agent', a.id, `${prev} → ${pu.id}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true });
});
route('POST', /^\/api\/admin\/elections$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.elections')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!body.name || !body.type) return sendJson(res, 400, { error: 'BAD_BODY' });
  const e = {
    id: 'e-' + util.uuid().slice(0, 8), name: body.name, type: body.type, level: body.level || 'STATE',
    scope: body.scope || 'Kano State', date: body.date || '2027-02-27', status: body.status || 'CONFIGURED', positions: body.positions || 1,
  };
  st.elections.push(e);
  for (const c of (body.candidates || [])) {
    st.candidates.push({ id: util.uuid(), electionId: e.id, partyId: c.partyId, name: c.name });
  }
  audit(u, 'ELECTION_CREATED', 'election', e.id, `${e.name} (${e.type})`, req);
  set(() => {});
  sendJson(res, 201, e);
});
route('PATCH', /^\/api\/admin\/elections\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.elections')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const e = st.elections.find(x => x.id === m[1]);
  if (!e) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (body.status && ['ACTIVE', 'CONFIGURED', 'CLOSED', 'ARCHIVED'].includes(body.status)) {
    const prev = e.status;
    e.status = body.status;
    audit(u, 'ELECTION_STATUS', 'election', e.id, `${e.name}: ${prev} → ${e.status}`, req);
  }
  if (body.name) e.name = body.name;
  set(() => {});
  sendJson(res, 200, e);
});
route('PATCH', /^\/api\/admin\/pus\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.geography')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const pu = st.pus.find(p => p.id === m[1]);
  if (!pu) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (body.name) {
    const prev = pu.name;
    pu.name = String(body.name).slice(0, 120);
    audit(u, 'PU_RENAMED', 'pu', pu.id, `${prev} → ${pu.name}`, req);
  }
  set(() => {});
  sendJson(res, 200, pu);
});
route('GET', /^\/api\/admin\/changes$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.override')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  sendJson(res, 200, {
    rows: st.changes.filter(c => c.status === 'PENDING_APPROVAL').map(c => {
      const sub = st.submissions.find(s => s.id === c.submissionId);
      return { ...c, puId: sub?.puId || '', lga: sub ? st.lgas.find(l => l.id === sub.lgaId)?.name : '' };
    }),
  });
});

route('POST', /^\/api\/admin\/simulation$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'simulation.control')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const action = body.action;
  if (action === 'speed') { st.meta.simSpeed = Math.max(1, Math.min(600, parseInt(body.value, 10) || 30)); audit(u, 'SIM_SPEED_CHANGED', 'simulation', null, `speed=${st.meta.simSpeed}`, req); }
  else if (action === 'pause') { st.meta.simPaused = !!body.value; audit(u, st.meta.simPaused ? 'SIM_PAUSED' : 'SIM_RESUMED', 'simulation', null, '', req); }
  else if (action === 'scenario') {
    if (!sim.SCENARIOS[body.value]) return sendJson(res, 400, { error: 'BAD_SCENARIO' });
    const scRes = sim.applyScenario(body.value, []);
    irev.resetAndBackfill();
    audit(u, 'SCENARIO_SWITCHED', 'simulation', null, `→ ${body.value} (${scRes.label})`, req);
    broadcastSse({ kind: 'sim.reset', scenario: body.value, simNow: st.meta.simNow });
    set(() => {});
    return sendJson(res, 200, scRes);
  }
  else if (action === 'reset') {
    store.reset(); seedStatic(); sim.buildPlan();
    const scRes = sim.applyScenario('RESULTS', []);
    irev.resetAndBackfill();
    audit(u, 'SIMULATION_RESET', 'simulation', null, 'full reset to RESULTS scenario', req);
    broadcastSse({ kind: 'sim.reset', scenario: 'RESULTS', simNow: S().meta.simNow });
    set(() => {});
    return sendJson(res, 200, scRes);
  }
  else return sendJson(res, 400, { error: 'BAD_ACTION' });
  set(() => {});
  sendJson(res, 200, { ok: true, speed: st.meta.simSpeed, paused: st.meta.simPaused });
});
route('POST', /^\/api\/admin\/announcement$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.config')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  st.config.announcement = String(body.text || '').slice(0, 400);
  notify(Object.values(st.roles.map(r => r.id)), 'System-wide announcement', st.config.announcement, { priority: body.critical ? 'CRITICAL' : 'MEDIUM' });
  audit(u, 'SYSTEM_ANNOUNCEMENT', 'config', null, st.config.announcement.slice(0, 80), req);
  set(() => {});
  sendJson(res, 200, { ok: true });
});

// --- EYES OF VICTORY Senatorial Command endpoints ---
route('POST', /^\/api\/escalations$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'escalations.create')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!(body.refId || '').trim()) return sendJson(res, 400, { error: 'REF_REQUIRED', message: 'A reference ID (incident, SOS, submission or task) is required for escalation.' });
  if (!(body.summary || '').trim()) return sendJson(res, 400, { error: 'SUMMARY_REQUIRED', message: 'A situation summary is required.' });
  if (!['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(body.priority)) return sendJson(res, 400, { error: 'BAD_PRIORITY' });
  const district = u.scope?.senatorial || st.lgas.find(l => l.id === body.lgaId)?.senatorial || 'Kano State';
  const esc = {
    id: util.uuid(), code: nextCode(st, 'escalation'),
    fromUserId: u.id, fromName: u.name, fromRole: u.roleId,
    senatorial: district, lgaId: body.lgaId || null,
    refId: String(body.refId).slice(0, 40), type: String(body.type || 'OPERATIONAL').slice(0, 30),
    priority: body.priority, summary: String(body.summary).slice(0, 500),
    evidenceRef: String(body.evidenceRef || '').slice(0, 200),
    currentStatus: String(body.currentStatus || '').slice(0, 80),
    actionsTaken: String(body.actionsTaken || '').slice(0, 400),
    requestedAttention: String(body.requestedAttention || '').slice(0, 400),
    status: 'SUBMITTED', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
    updates: [{ at: st.meta.simNow, status: 'SUBMITTED', by: u.name, note: 'Escalation sent to Central Situation Room' }],
  };
  st.escalations.unshift(esc);
  if (st.escalations.length > 500) st.escalations.length = 500;
  audit(u, 'ESCALATION_CREATED', 'escalation', esc.id, `${esc.code} ${body.priority} → Central`, req);
  notify(['director', 'operator'], `Escalation from ${district} — ${esc.code}`, `${body.priority}: ${esc.summary.slice(0, 100)}`, { priority: body.priority === 'LOW' ? 'MEDIUM' : body.priority, link: '/central?tab=escalations' });
  broadcastSse({ kind: 'event', type: 'escalation.created', escalationId: esc.id, senatorial: district, priority: body.priority });
  set(() => {});
  sendJson(res, 201, { id: esc.id, code: esc.code, status: 'SUBMITTED', message: 'Structured case received by Central Situation Room.' });
});
route('GET', /^\/api\/escalations$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'escalations.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  let rows = [...st.escalations];
  const senatorial = url.searchParams.get('senatorial');
  if (senatorial) rows = rows.filter(e => e.senatorial === senatorial);
  else if (u.scope?.senatorial) rows = rows.filter(e => e.senatorial === u.scope.senatorial);
  sendJson(res, 200, { total: rows.length, rows: rows.slice(0, 200) });
});
route('POST', /^\/api\/escalations\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'escalations.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const esc = st.escalations.find(e => e.id === m[1]);
  if (!esc) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const status = String(body.status || '').toUpperCase();
  if (!['ACKNOWLEDGED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) return sendJson(res, 400, { error: 'BAD_STATUS' });
  esc.status = status; esc.updatedAt = st.meta.simNow;
  esc.updates.push({ at: st.meta.simNow, status, by: u.name, note: String(body.note || '').slice(0, 200) });
  audit(u, `ESCALATION_${status}`, 'escalation', esc.id, `${esc.code} — ${body.note || ''}`, req);
  broadcastSse({ kind: 'event', type: 'escalation.updated', escalationId: esc.id, status });
  set(() => {});
  sendJson(res, 200, { ok: true, status });
});
route('GET', /^\/api\/senatorial\/evidence$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'evidence.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const district = u.scope?.senatorial || url.searchParams.get('senatorial') || null;
  const rows = [];
  for (const e of st.evidence) {
    if (e.kind !== 'EC8A' || !e.submissionId) continue;
    const sub = st.submissions.find(s => s.id === e.submissionId);
    if (!sub) continue;
    if (district && sub.senatorial !== district) continue;
    const hasMath = (sub.anomalies || []).some(a => a.code === 'MATH_MISMATCH' || a.code === 'TOTALS_INCONSISTENT');
    const hasDup = (sub.anomalies || []).some(a => a.code === 'DOCUMENT_FINGERPRINT' || a.code === 'DUPLICATE_SUBMISSION');
    const hasOcr = (sub.anomalies || []).some(a => a.code === 'OCR_UNCERTAIN');
    const ocrConf = sub.ocr?.confidences || [];
    const q = parseInt(e.sha256.slice(0, 2), 16) % 100;
    rows.push({
      id: e.id, code: e.code, submissionId: sub.id, subCode: sub.code,
      puId: sub.puId, ward: st.wards.find(w => w.id === sub.wardId)?.name || '', lga: st.lgas.find(l => l.id === sub.lgaId)?.name || '',
      senatorial: sub.senatorial, agent: st.agents.find(a => a.id === sub.agentId)?.name || sub.agentId,
      sha256: e.sha256, capturedAt: e.capturedAt, uploadedAt: e.uploadedAt, pages: e.pages,
      status: sub.status, reviewAction: sub.review?.action || null, reviewReason: sub.review?.reason || '',
      signals: {
        documentQuality: q < 55 ? 'ATTENTION' : 'GOOD',
        ocrConfidence: hasOcr ? 'LOW' : Math.min(...(ocrConf.length ? ocrConf : [99])) >= 90 ? 'HIGH' : Math.min(...(ocrConf.length ? ocrConf : [99])) >= 75 ? 'MEDIUM' : 'LOW',
        mathReconciliation: hasMath ? 'REQUIRES_REVIEW' : 'PASSED',
        duplicateSignal: hasDup ? 'POSSIBLE_DUPLICATE' : 'CLEAR',
        metadata: e.gps ? 'COMPLETE' : 'INCOMPLETE',
      },
      chain: e.chain, dataUrl: e.dataUrl || null,
    });
  }
  const stats = {
    received: rows.length,
    pendingReview: rows.filter(r => ['SUBMITTED', 'UNDER_REVIEW', 'UNVERIFIED'].includes(r.status)).length,
    lowQuality: rows.filter(r => r.signals.documentQuality === 'ATTENTION').length,
    underReview: rows.filter(r => r.status === 'UNDER_REVIEW').length,
    verified: rows.filter(r => r.status === 'VERIFIED').length,
    disputed: rows.filter(r => r.status === 'DISPUTED').length,
    requiresReview: rows.filter(r => r.signals.mathReconciliation === 'REQUIRES_REVIEW' || r.signals.duplicateSignal === 'POSSIBLE_DUPLICATE').length,
  };
  sendJson(res, 200, { stats, rows });
});
route('POST', /^\/api\/senatorial\/demo\/simulate$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'senatorial.demo')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!st.config.demoMode) return sendJson(res, 400, { error: 'NOT_DEMO', message: 'Demo simulation is disabled.' });
  const district = u.scope?.senatorial || 'Kano North';
  const lgas = st.lgas.filter(l => l.senatorial === district);
  const pus = st.pus.filter(p => lgas.some(l => l.id === p.lgaId));
  const agents = st.agents.filter(a => a.senatorial === district);
  const action = body.action;
  const evts = [];
  const rnd = (n) => Math.floor(Math.random() * n);
  const pickP = (arr) => arr[rnd(arr.length)];
  let detail = '';

  if (action === 'result') {
    const pending = pus.filter(p => !st.submissions.some(s => s.puId === p.id && s.electionId === 'e-gov-2027'));
    if (!pending.length) return sendJson(res, 400, { error: 'NO_PENDING_PU', message: 'All polling units in this district already have results.' });
    const pu = pickP(pending);
    const agent = agents.find(a => a.puId === pu.id);
    if (!agent) return sendJson(res, 400, { error: 'NO_AGENT', message: 'Selected polling unit has no assigned agent.' });
    sim.submitForPu(pu.id, agent, st.meta.simNow, evts, true);
    detail = `Result simulated for ${pu.id}`;
  } else if (action === 'incident') {
    const cats = [['PROCESS', 'Result-sheet concern', 3], ['SECURITY', 'Security deployment concern', 4], ['TECHNOLOGY', 'BVAS issue', 2], ['PROCESS', 'Counting interruption', 3]];
    const c = pickP(cats);
    const pu = pickP(pus);
    const inc = {
      id: util.uuid(), code: nextCode(st, 'incident'), category: c[0], subcategory: c[1], severity: c[2],
      puId: pu.id, wardId: pu.wardId, lgaId: pu.lgaId, gps: { lat: pu.lat, lon: pu.lon },
      reporterId: agents.find(a => a.puId === pu.id)?.id || null,
      description: `[DEMO SIMULATION] ${c[1]} reported at ${pu.name}.`,
      status: 'NEW', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
      updates: [{ at: st.meta.simNow, status: 'NEW', by: 'demo-panel', note: 'Simulated incident (demo control)' }], mediaIds: [],
    };
    st.incidents.unshift(inc);
    evts.push({ type: 'incident.created', incidentId: inc.id, severity: c[2], lgaId: pu.lgaId });
    detail = `Incident ${inc.code} (L${c[2]}) at ${pu.id}`;
  } else if (action === 'sos') {
    const agent = pickP(agents.filter(a => a.online));
    if (!agent) return sendJson(res, 400, { error: 'NO_AGENT', message: 'No online agents in this district.' });
    const sos = {
      id: util.uuid(), code: nextCode(st, 'sos'), agentId: agent.id, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
      category: pickP(['SAFETY', 'SECURITY_BREACH', 'MEDICAL', 'COMMS']), gps: agent.gps,
      status: 'ACTIVE', createdAt: st.meta.simNow, updatedAt: st.meta.simNow, acks: [],
      updates: [{ at: st.meta.simNow, note: 'Simulated SOS (demo control)' }],
    };
    st.sosEvents.unshift(sos);
    notify(['director', 'operator'], `EMERGENCY SOS (demo) — ${sos.category}`, `${sos.code} at ${sos.puId}`, { priority: 'CRITICAL', link: '/central?tab=sos' });
    evts.push({ type: 'sos.triggered', sosId: sos.id, lgaId: agent.lgaId });
    detail = `SOS ${sos.code} triggered`;
  } else if (action === 'agent-offline') {
    const agent = pickP(agents.filter(a => a.online));
    if (!agent) return sendJson(res, 400, { error: 'NO_AGENT', message: 'No online agents in this district.' });
    agent.online = false;
    evts.push({ type: 'agent.offline', agentId: agent.id, reason: 'simulated' });
    detail = `Agent ${agent.code} marked offline`;
  } else if (action === 'connectivity-loss') {
    const lga = pickP(lgas);
    let n = 0;
    for (const a of agents.filter(x => x.lgaId === lga.id && x.online)) { a.online = false; evts.push({ type: 'agent.offline', agentId: a.id, reason: 'simulated-outage' }); n++; }
    detail = `${n} agent(s) offline in ${lga.name} (simulated outage)`;
  } else if (action === 'verify') {
    const sub = st.submissions.find(s => s.senatorial === district && ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status));
    if (!sub) return sendJson(res, 400, { error: 'NO_PENDING', message: 'No pending submissions in this district.' });
    const reviewer = st.users.find(x => x.roleId === 'reviewer') || { id: 'demo', name: 'Demo Reviewer' };
    sub.review = { id: util.uuid(), submissionId: sub.id, reviewerId: reviewer.id, reviewerName: reviewer.name, action: 'APPROVE', reason: 'Approved via demo panel', at: st.meta.simNow };
    st.reviews.unshift(sub.review);
    sim.finalizeReview(sub, sub.review, st.meta.simNow, evts);
    detail = `${sub.puId} verified via demo panel`;
  } else if (action === 'dispute') {
    const sub = st.submissions.find(s => s.senatorial === district && ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status));
    if (!sub) return sendJson(res, 400, { error: 'NO_PENDING', message: 'No pending submissions in this district.' });
    const reviewer = st.users.find(x => x.roleId === 'reviewer') || { id: 'demo', name: 'Demo Reviewer' };
    sub.review = { id: util.uuid(), submissionId: sub.id, reviewerId: reviewer.id, reviewerName: reviewer.name, action: 'DISPUTE', reason: 'Discrepancy flagged via demo panel', at: st.meta.simNow };
    st.reviews.unshift(sub.review);
    sub.status = 'DISPUTED';
    sub.custodies.push({ at: st.meta.simNow, step: 'DISPUTED', by: reviewer.id });
    st.disputes.unshift({ id: util.uuid(), submissionId: sub.id, reason: sub.review.reason, status: 'OPEN', createdBy: reviewer.id, createdAt: st.meta.simNow, resolution: null });
    evts.push({ type: 'result.disputed', submissionId: sub.id, puId: sub.puId });
    detail = `${sub.puId} disputed via demo panel`;
  } else if (action === 'reporting-gap') {
    const lga = pickP(lgas);
    let n = 0;
    for (const a of agents.filter(x => x.lgaId === lga.id && x.online)) { a.online = false; evts.push({ type: 'agent.offline', agentId: a.id, reason: 'simulated-reporting-gap' }); n++; }
    notify(['sendirector', 'senops', 'sencoord', 'director'], 'Reporting gap (demo)', `${lga.name}: ${n} agent(s) offline — reporting may stall (simulated)`, { priority: 'HIGH', link: '/senatorial' });
    detail = `Reporting gap simulated in ${lga.name} (${n} agents offline)`;
  } else {
    return sendJson(res, 400, { error: 'BAD_ACTION', message: 'Unknown demo action.' });
  }
  for (const e of evts) broadcastSse({ kind: 'event', ...e });
  set(() => {});
  sendJson(res, 200, { ok: true, detail, simNow: st.meta.simNow });
});

// --- EYES OF VICTORY LG Supervisor endpoints ---
route('GET', /^\/api\/lg\/evidence$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'evidence.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const lgaName = u.scope?.lga || url.searchParams.get('lga') || null;
  const lga = lgaName ? st.lgas.find(l => l.name === lgaName) : null;
  const rows = [];
  for (const e of st.evidence) {
    if (e.kind !== 'EC8A' || !e.submissionId) continue;
    const sub = st.submissions.find(s => s.id === e.submissionId);
    if (!sub) continue;
    if (lga && sub.lgaId !== lga.id) continue;
    const hasMath = (sub.anomalies || []).some(a => a.code === 'MATH_MISMATCH' || a.code === 'TOTALS_INCONSISTENT');
    const hasDup = (sub.anomalies || []).some(a => a.code === 'DOCUMENT_FINGERPRINT' || a.code === 'DUPLICATE_SUBMISSION');
    const hasOcr = (sub.anomalies || []).some(a => a.code === 'OCR_UNCERTAIN');
    const ocrConf = sub.ocr?.confidences || [];
    const q = parseInt(e.sha256.slice(0, 2), 16) % 100;
    rows.push({
      id: e.id, code: e.code, submissionId: sub.id, subCode: sub.code,
      puId: sub.puId, ward: st.wards.find(w => w.id === sub.wardId)?.name || '', lga: st.lgas.find(l => l.id === sub.lgaId)?.name || '',
      agent: st.agents.find(a => a.id === sub.agentId)?.name || sub.agentId,
      sha256: e.sha256, capturedAt: e.capturedAt, uploadedAt: e.uploadedAt, pages: e.pages,
      status: sub.status, reviewAction: sub.review?.action || null, reviewReason: sub.review?.reason || '',
      signals: {
        documentQuality: q < 55 ? 'ATTENTION' : 'GOOD',
        ocrConfidence: hasOcr ? 'LOW' : Math.min(...(ocrConf.length ? ocrConf : [99])) >= 90 ? 'HIGH' : Math.min(...(ocrConf.length ? ocrConf : [99])) >= 75 ? 'MEDIUM' : 'LOW',
        mathReconciliation: hasMath ? 'REQUIRES_REVIEW' : 'PASSED',
        duplicateSignal: hasDup ? 'POSSIBLE_DUPLICATE' : 'CLEAR',
        metadata: e.gps ? 'COMPLETE' : 'INCOMPLETE',
      },
      chain: e.chain, dataUrl: e.dataUrl || null,
    });
  }
  const stats = {
    received: rows.length,
    pendingReview: rows.filter(r => ['SUBMITTED', 'UNDER_REVIEW', 'UNVERIFIED'].includes(r.status)).length,
    lowQuality: rows.filter(r => r.signals.documentQuality === 'ATTENTION').length,
    verified: rows.filter(r => r.status === 'VERIFIED').length,
    disputed: rows.filter(r => r.status === 'DISPUTED').length,
    requiresReview: rows.filter(r => r.signals.mathReconciliation === 'REQUIRES_REVIEW' || r.signals.duplicateSignal === 'POSSIBLE_DUPLICATE').length,
  };
  sendJson(res, 200, { stats, rows });
});
route('GET', /^\/api\/lg\/timeline$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const lgaName = u.scope?.lga || url.searchParams.get('lga') || null;
  const lga = lgaName ? st.lgas.find(l => l.name === lgaName) : null;
  if (!lga) return sendJson(res, 400, { error: 'NO_LGA', message: 'No LGA scope.' });
  const rows = [];
  const lgaIds = new Set([lga.id]);
  for (const a of st.agents.filter(x => x.lgaId === lga.id)) {
    if (a.activatedAt) rows.push({ t: a.activatedAt, type: 'DUTY', label: 'Duty activated', detail: `${a.code} · ${a.puId}` });
    if (a.checkedInAt) rows.push({ t: a.checkedInAt, type: 'DUTY', label: 'Agent checked in', detail: `${a.code} · ${a.puId}` });
    if (a.completedAt) rows.push({ t: a.completedAt, type: 'DUTY', label: 'Duty completed', detail: a.code });
    if (a.lastHeartbeat && !a.online) rows.push({ t: a.lastHeartbeat, type: 'CONNECTIVITY', label: 'Agent heartbeat lost', detail: a.code });
  }
  for (const s of st.submissions.filter(x => x.lgaId === lga.id)) {
    rows.push({ t: s.submittedAt, type: 'RESULT', label: `Result submitted (${s.code || s.id.slice(0, 8)})`, detail: `${s.puId} · ${s.status}` });
    if (s.verifiedAt) rows.push({ t: s.verifiedAt, type: 'RESULT', label: 'Verification completed', detail: s.puId });
    if (s.rejectedAt) rows.push({ t: s.rejectedAt, type: 'RESULT', label: 'Submission rejected — review required', detail: s.puId });
  }
  for (const i of st.incidents.filter(x => x.lgaId === lga.id)) {
    rows.push({ t: i.createdAt, type: 'INCIDENT', label: `Incident ${i.code} — ${i.subcategory}`, detail: `L${i.severity} · ${i.status}` });
    for (const ux of (i.updates || []).slice(1)) rows.push({ t: ux.at, type: 'INCIDENT', label: `Incident ${i.code} — ${ux.status || 'update'}`, detail: ux.note });
  }
  for (const s of st.sosEvents.filter(x => x.lgaId === lga.id)) {
    rows.push({ t: s.createdAt, type: 'SOS', label: `SOS ${s.code} triggered`, detail: s.category });
    for (const ux of (s.updates || []).slice(1)) rows.push({ t: ux.at, type: 'SOS', label: `SOS ${s.code} — ${ux.note}` });
  }
  for (const str of st.streams.filter(x => x.lgaId === lga.id)) {
    rows.push({ t: str.startedAt, type: 'VIDEO', label: 'Live stream started', detail: str.puId });
    if (str.endedAt) rows.push({ t: str.endedAt, type: 'VIDEO', label: 'Live stream ended', detail: str.puId });
  }
  for (const f of st.fieldReports.filter(x => x.lgaId === lga.id)) rows.push({ t: f.at, type: 'REPORT', label: `Field report — ${f.type}`, detail: f.puId });
  for (const e of st.escalations.filter(x => x.lgaId === lga.id)) rows.push({ t: e.createdAt, type: 'ESCALATION', label: `Escalation ${e.code} sent`, detail: `${e.priority} → ${e.type}` });
  rows.sort((a, b) => b.t - a.t);
  sendJson(res, 200, { rows: rows.slice(0, 200) });
});
route('POST', /^\/api\/lg\/demo\/simulate$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'lg.demo')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!st.config.demoMode) return sendJson(res, 400, { error: 'NOT_DEMO', message: 'Demo simulation is disabled.' });
  const lga = st.lgas.find(l => l.name === (u.scope?.lga || 'Nasarawa'));
  if (!lga) return sendJson(res, 400, { error: 'NO_LGA' });
  const pus = st.pus.filter(p => p.lgaId === lga.id);
  const agents = st.agents.filter(a => a.lgaId === lga.id);
  const action = body.action;
  const evts = [];
  const rnd = (n) => Math.floor(Math.random() * n);
  const pickP = (arr) => arr[rnd(arr.length)];
  let detail = '';
  if (action === 'result') {
    const pending = pus.filter(p => !st.submissions.some(s => s.puId === p.id && s.electionId === 'e-gov-2027'));
    if (!pending.length) return sendJson(res, 400, { error: 'NO_PENDING_PU', message: 'All polling units in this LG already have results.' });
    const pu = pickP(pending);
    const agent = agents.find(a => a.puId === pu.id);
    if (!agent) return sendJson(res, 400, { error: 'NO_AGENT', message: 'Selected polling unit has no assigned agent.' });
    sim.submitForPu(pu.id, agent, st.meta.simNow, evts, true);
    detail = `Result simulated for ${pu.id}`;
  } else if (action === 'incident') {
    const cats = [['PROCESS', 'Voting interruption', 3], ['SECURITY', 'Security deployment concern', 4], ['TECHNOLOGY', 'BVAS issue', 2], ['PROCESS', 'Result-sheet concern', 3]];
    const c = pickP(cats);
    const pu = pickP(pus);
    const inc = {
      id: util.uuid(), code: nextCode(st, 'incident'), category: c[0], subcategory: c[1], severity: c[2],
      puId: pu.id, wardId: pu.wardId, lgaId: pu.lgaId, gps: { lat: pu.lat, lon: pu.lon },
      reporterId: agents.find(a => a.puId === pu.id)?.id || null,
      description: `[DEMO SIMULATION] ${c[1]} reported at ${pu.name}.`,
      status: 'NEW', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
      updates: [{ at: st.meta.simNow, status: 'NEW', by: 'lg-demo-panel', note: 'Simulated incident (LG demo control)' }], mediaIds: [],
    };
    st.incidents.unshift(inc);
    evts.push({ type: 'incident.created', incidentId: inc.id, severity: c[2], lgaId: pu.lgaId });
    detail = `Incident ${inc.code} (L${c[2]}) at ${pu.id}`;
  } else if (action === 'sos') {
    const agent = pickP(agents.filter(a => a.online));
    if (!agent) return sendJson(res, 400, { error: 'NO_AGENT', message: 'No online agents in this LG.' });
    const sos = {
      id: util.uuid(), code: nextCode(st, 'sos'), agentId: agent.id, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
      category: pickP(['SAFETY', 'SECURITY_BREACH', 'MEDICAL', 'COMMS']), gps: agent.gps,
      status: 'ACTIVE', createdAt: st.meta.simNow, updatedAt: st.meta.simNow, acks: [],
      updates: [{ at: st.meta.simNow, note: 'Simulated SOS (LG demo control)' }],
    };
    st.sosEvents.unshift(sos);
    notify(['director', 'operator'], `EMERGENCY SOS (demo) — ${sos.category}`, `${sos.code} at ${sos.puId}`, { priority: 'CRITICAL', link: '/central?tab=sos' });
    evts.push({ type: 'sos.triggered', sosId: sos.id, lgaId: agent.lgaId });
    detail = `SOS ${sos.code} triggered`;
  } else if (action === 'agent-offline') {
    const agent = pickP(agents.filter(a => a.online));
    if (!agent) return sendJson(res, 400, { error: 'NO_AGENT', message: 'No online agents in this LG.' });
    agent.online = false;
    evts.push({ type: 'agent.offline', agentId: agent.id, reason: 'simulated' });
    detail = `Agent ${agent.code} marked offline`;
  } else if (action === 'verify') {
    const sub = st.submissions.find(s => s.lgaId === lga.id && ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status));
    if (!sub) return sendJson(res, 400, { error: 'NO_PENDING', message: 'No pending submissions in this LG.' });
    const reviewer = st.users.find(x => x.roleId === 'reviewer') || { id: 'demo', name: 'Demo Reviewer' };
    sub.review = { id: util.uuid(), submissionId: sub.id, reviewerId: reviewer.id, reviewerName: reviewer.name, action: 'APPROVE', reason: 'Approved via LG demo panel (authorized verification)', at: st.meta.simNow };
    st.reviews.unshift(sub.review);
    sim.finalizeReview(sub, sub.review, st.meta.simNow, evts);
    detail = `${sub.puId} verified via demo panel`;
  } else {
    return sendJson(res, 400, { error: 'BAD_ACTION', message: 'Unknown demo action.' });
  }
  for (const e of evts) broadcastSse({ kind: 'event', ...e });
  set(() => {});
  sendJson(res, 200, { ok: true, detail, simNow: st.meta.simNow });
});

// --- IReV WATCHTOWER endpoints ---
route('GET', /^\/api\/irev\/status$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const h = ir.sourceHealth;
  sendJson(res, 200, {
    status: h.status, sourceMethod: ir.config.sourceMethod,
    sourceMethods: irev.SOURCE_METHODS,
    lastSync: h.lastSync, lastSuccess: h.lastSuccess,
    responseMs: h.responseMs, errors: h.errors, rateLimitEvents: h.rateLimitEvents,
    observations: h.observations, outageSince: h.outageSince, outageUntil: h.outageUntil,
    enabled: ir.config.enabled, simNow: st.meta.simNow,
    note: 'Integration operates only through authorized channels: OFFICIAL API, OFFICIAL FEED, AUTHORIZED EXPORT, or public IReV interface observation. No attempt is made to penetrate, bypass or reverse-engineer protected INEC infrastructure.',
  });
});
route('GET', /^\/api\/irev\/dashboard$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const r = irev.reconcileState();
  const wc = irev.whatChanged(15);
  sendJson(res, 200, {
    kpis: r.kpis, whatChanged: wc,
    matrix: irev.coverageMatrix(),
    events: ir.events.slice(0, 40),
    alerts: ir.alerts.filter(a => a.status !== 'RESOLVED').slice(0, 15),
    cases: ir.cases.filter(c => !['RESOLVED', 'CLOSED'].includes(c.status)).slice(0, 15).map(c => ({ id: c.id, code: c.code, puId: c.puId, lga: st.lgas.find(l => l.id === c.lgaId)?.name, type: c.type, severity: c.severity, status: c.status, confidence: c.confidence, createdAt: c.createdAt })),
    source: { status: ir.sourceHealth.status, method: ir.config.sourceMethod, lastSync: ir.sourceHealth.lastSync },
    thresholds: { normalMin: ir.config.normalMin, attentionMin: ir.config.attentionMin, highMin: ir.config.highMin },
  });
});
route('GET', /^\/api\/irev\/pending$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const r = irev.reconcileState();
  const now = st.meta.simNow;
  const rows = r.rows.filter(x => x.status === 'PENDING').map(x => {
    const waitMin = Math.max(0, Math.round((now - x.pendingSince) / 60000));
    const t = ir.config;
    const tier = waitMin >= t.highMin ? 'CRITICAL' : waitMin >= t.attentionMin ? 'HIGH' : waitMin >= t.normalMin ? 'ATTENTION' : 'NORMAL';
    return { ...x, waitMin, tier, waitLabel: fmtWait(waitMin) };
  }).sort((a, b) => b.waitMin - a.waitMin);
  function fmtWait(m) { const hh = Math.floor(m / 60), mm = m % 60; return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`; }
  sendJson(res, 200, {
    rows,
    thresholds: { normalMin: ir.config.normalMin, attentionMin: ir.config.attentionMin, highMin: ir.config.highMin },
    note: 'A delay is not interpreted as wrongdoing. Possible causes: connectivity, device issue, upload queue, public portal delay, operational delay, or system availability.',
  });
});
route('GET', /^\/api\/irev\/reconciliation$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const r = irev.reconcileState();
  sendJson(res, 200, { rows: r.rows.slice(0, 400), kpis: r.kpis, labels: irev.STATUS_LABELS });
});
route('GET', /^\/api\/irev\/matrix$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'analytics.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: irev.coverageMatrix(), latency: irev.latencyStats() });
});
route('GET', /^\/api\/irev\/latency$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'analytics.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, irev.latencyStats());
});
route('GET', /^\/api\/irev\/events$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: irev.cfg().events.slice(0, 200) });
});
route('GET', /^\/api\/irev\/snapshots$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'evidence.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const url = new URL(req.url, 'http://x');
  const puId = url.searchParams.get('pu');
  let rows = ir.observations;
  if (puId) rows = rows.filter(o => o.puId === puId);
  sendJson(res, 200, {
    rows: rows.slice(-400).reverse().map(o => ({ ...o, values: undefined, ward: st.wards.find(w => w.id === o.wardId)?.name || '', lga: st.lgas.find(l => l.id === o.lgaId)?.name || '' })),
    total: rows.length,
  });
});
route('GET', /^\/api\/irev\/pu\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const puId = m[1];
  const pu = st.pus.find(p => p.id === puId);
  if (!pu) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const sub = st.submissions.find(s => s.puId === puId && s.electionId === 'e-gov-2027');
  const fieldEv = sub ? st.evidence.find(e => e.submissionId === sub.id && e.kind === 'EC8A') : null;
  const obs = ir.observations.filter(o => o.puId === puId).sort((a, b) => a.observedAt - b.observedAt);
  const r = irev.reconcileState().rows.find(x => x.puId === puId) || null;
  const cases = ir.cases.filter(c => c.puId === puId);
  sendJson(res, 200, {
    pu: { id: pu.id, code: pu.code, name: pu.name, ward: st.wards.find(w => w.id === pu.wardId)?.name, lga: st.lgas.find(l => l.id === pu.lgaId)?.name, senatorial: st.lgas.find(l => l.id === pu.lgaId)?.senatorial },
    recon: r,
    eov: sub ? { id: sub.id, code: sub.code, status: sub.status, submittedAt: sub.submittedAt, verifiedAt: sub.verifiedAt, items: sub.items, validVotes: sub.validVotes, rejected: sub.rejected, accredited: sub.accredited, anomalies: (sub.anomalies || []).map(a => a.code) } : null,
    fieldEv: fieldEv ? { id: fieldEv.id, code: fieldEv.code, sha256: fieldEv.sha256, capturedAt: fieldEv.capturedAt, chain: fieldEv.chain, dataUrl: fieldEv.dataUrl || null } : null,
    observations: obs.map(o => ({ id: o.id, code: o.code, observedAt: o.observedAt, docHash: o.docHash, valuesHash: o.valuesHash, values: o.values, validVotes: o.validVotes, rejected: o.rejected, available: o.available, version: o.version, sourceMethod: o.sourceMethod, snapshotNo: o.snapshotNo })),
    cases: cases.map(c => ({ id: c.id, code: c.code, type: c.type, severity: c.severity, confidence: c.confidence, status: c.status, classification: c.classification, reason: c.reason, createdAt: c.createdAt, timeline: c.timeline, comparisons: c.comparisons, note: c.note, observationCount: c.observationCount })),
    timeline: puTimeline(puId, 30),
  });
});
route('GET', /^\/api\/irev\/cases$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const url = new URL(req.url, 'http://x');
  const status = url.searchParams.get('status');
  let rows = ir.cases;
  if (status) rows = rows.filter(c => c.status === status);
  sendJson(res, 200, {
    total: rows.length,
    rows: rows.slice(0, 200).map(c => ({ id: c.id, code: c.code, puId: c.puId, ward: st.wards.find(w => w.id === c.wardId)?.name, lga: st.lgas.find(l => l.id === c.lgaId)?.name, senatorial: c.senatorial, type: c.type, severity: c.severity, confidence: c.confidence, status: c.status, classification: c.classification, reason: c.reason, createdAt: c.createdAt, updatedAt: c.updatedAt, reviewerName: c.reviewerName, note: c.note, observationCount: c.observationCount, comparisons: c.comparisons })),
  });
});
route('GET', /^\/api\/irev\/cases\/([^/]+)$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const cse = ir.cases.find(c => c.id === m[1]);
  if (!cse) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const prevObs = cse.prevObsId ? ir.observations.find(o => o.id === cse.prevObsId) : null;
  const currObs = cse.currObsId ? ir.observations.find(o => o.id === cse.currObsId) : null;
  const sub = cse.eovSubId ? st.submissions.find(s => s.id === cse.eovSubId) : null;
  const fieldEv = cse.fieldEvId ? st.evidence.find(e => e.id === cse.fieldEvId) : null;
  const pu = st.pus.find(p => p.id === cse.puId);
  const allObs = ir.observations.filter(o => o.puId === cse.puId).sort((a, b) => a.observedAt - b.observedAt);
  sendJson(res, 200, {
    case: { ...cse, lga: st.lgas.find(l => l.id === cse.lgaId)?.name, ward: st.wards.find(w => w.id === cse.wardId)?.name, puCode: pu?.code, puName: pu?.name },
    prevObs: prevObs ? { id: prevObs.id, code: prevObs.code, observedAt: prevObs.observedAt, docHash: prevObs.docHash, valuesHash: prevObs.valuesHash, values: prevObs.values, validVotes: prevObs.validVotes, rejected: prevObs.rejected, available: prevObs.available } : null,
    currObs: currObs ? { id: currObs.id, code: currObs.code, observedAt: currObs.observedAt, docHash: currObs.docHash, valuesHash: currObs.valuesHash, values: currObs.values, validVotes: currObs.validVotes, rejected: currObs.rejected, available: currObs.available } : null,
    eov: sub ? { id: sub.id, code: sub.code, items: sub.items, validVotes: sub.validVotes, rejected: sub.rejected, status: sub.status } : null,
    fieldEv: fieldEv ? { id: fieldEv.id, code: fieldEv.code, sha256: fieldEv.sha256, capturedAt: fieldEv.capturedAt, chain: fieldEv.chain, dataUrl: fieldEv.dataUrl || null } : null,
    allObservations: allObs.map(o => ({ id: o.id, code: o.code, observedAt: o.observedAt, docHash: o.docHash, version: o.version, available: o.available, values: o.values, validVotes: o.validVotes, rejected: o.rejected })),
    classifications: irev.CLASSIFICATIONS,
    candidates: sub ? st.candidates.filter(c => c.electionId === sub.electionId).map(c => ({ id: c.id, name: c.name, party: st.parties.find(p => p.id === c.partyId)?.code, color: st.parties.find(p => p.id === c.partyId)?.color })) : [],
  });
});
route('POST', /^\/api\/irev\/cases\/([^/]+)\/assign$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'results.verify')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const cse = ir.cases.find(c => c.id === m[1]);
  if (!cse) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (cse.status === 'RESOLVED' || cse.status === 'CLOSED') return sendJson(res, 400, { error: 'ALREADY_RESOLVED' });
  if (cse.status === 'DETECTED') {
    cse.status = 'ASSIGNED';
    cse.timeline.push({ at: st.meta.simNow, step: 'ASSIGNED', note: `Assigned to ${u.name} for document and data review` });
    audit(u, 'IREV_CASE_ASSIGNED', 'irevCase', cse.id, `${cse.code} → ${u.name}`, req);
    set(() => {});
  }
  sendJson(res, 200, { ok: true, status: cse.status });
});
route('POST', /^\/api\/irev\/cases\/([^/]+)\/classify$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || (!auth.can(u, 'results.verify') && !auth.can(u, 'results.override'))) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const cse = ir.cases.find(c => c.id === m[1]);
  if (!cse) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const out = irev.classifyCase(cse, u, String(body.classification || '').toUpperCase(), String(body.reason || ''), { escalate: !!body.escalate, secondApproval: !!body.secondApproval });
  if (out.error) return sendJson(res, 400, out);
  sendJson(res, 200, out);
});
route('GET', /^\/api\/irev\/alerts$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const url = new URL(req.url, 'http://x');
  const sev = url.searchParams.get('severity');
  let rows = ir.alerts;
  if (sev && sev !== 'RESOLVED') rows = rows.filter(a => a.severity === sev && a.status !== 'RESOLVED');
  else if (sev === 'RESOLVED') rows = rows.filter(a => a.status === 'RESOLVED');
  sendJson(res, 200, {
    total: rows.length,
    rows: rows.slice(0, 200).map(a => ({ ...a, puCode: a.puId ? (st.pus.find(p => p.id === a.puId)?.code || a.puId) : null, lga: a.lgaId ? st.lgas.find(l => l.id === a.lgaId)?.name : null })),
  });
});
route('POST', /^\/api\/irev\/alerts\/([^/]+)\/ack$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const al = ir.alerts.find(a => a.id === m[1]);
  if (!al) return sendJson(res, 404, { error: 'NOT_FOUND' });
  al.acknowledgedBy = u.name; al.acknowledgedAt = st.meta.simNow;
  audit(u, 'IREV_ALERT_ACKNOWLEDGED', 'irevAlert', al.id, al.code, req);
  set(() => {});
  sendJson(res, 200, { ok: true });
});
route('GET', /^\/api\/irev\/sitrep$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'reports.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const r = irev.reconcileState();
  const lat = irev.latencyStats();
  const openCases = ir.cases.filter(c => !['RESOLVED', 'CLOSED'].includes(c.status));
  sendJson(res, 200, {
    generatedAt: st.meta.simNow,
    generatedAtWat: util.fmtWat(st.meta.simNow),
    source: { status: ir.sourceHealth.status, method: ir.config.sourceMethod, lastSync: ir.sourceHealth.lastSync },
    executive: `Of ${r.kpis.totalMonitored} polling units with field-monitoring records, ${r.kpis.observed} have a corresponding observation in the public IReV surface (${r.kpis.coveragePct}% coverage). ${r.kpis.matched} reconcile as MATCHED (${r.kpis.reconciliationPct}% of observed). ${r.kpis.underReview} case(s) currently require human review.`,
    kpis: r.kpis, latency: lat, matrix: irev.coverageMatrix(),
    openCases: openCases.slice(0, 20).map(c => ({ code: c.code, puId: c.puId, type: c.type, severity: c.severity, status: c.status, confidence: c.confidence, note: c.note.slice(0, 140) })),
    alerts: ir.alerts.filter(a => a.status !== 'RESOLVED').slice(0, 15).map(a => ({ code: a.code, category: a.category, severity: a.severity, title: a.title, observationCount: a.observationCount })),
    language: 'All differences are reported factually: "A difference was detected between the previously observed IReV document and the current IReV observation." Causes are never asserted without verified evidence.',
  });
});
route('POST', /^\/api\/irev\/demo$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'irev.demo')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  if (!st.config.demoMode) return sendJson(res, 400, { error: 'NOT_DEMO' });
  const action = body.action;
  let detail = '';
  if (action === 'observe') {
    const rows = irev.reconcileState().rows.filter(x => x.status === 'PENDING');
    if (!rows.length) return sendJson(res, 400, { error: 'NO_PENDING', message: 'No pending uploads to observe.' });
    const row = rows[Math.floor(Math.random() * rows.length)];
    const sub = st.submissions.find(s => s.puId === row.puId && s.electionId === 'e-gov-2027');
    if (sub) { irev.produceSnapshot(row.puId, sub, st.meta.simNow); detail = `Result observed for ${row.puId}`; }
  } else if (action === 'change') {
    const rows = irev.reconcileState().rows.filter(x => ['MATCHED', 'FIELD_VS_IREV', 'EYES_VS_IREV'].includes(x.status) && x.obsCount > 0);
    if (!rows.length) return sendJson(res, 400, { error: 'NO_MATCHED', message: 'No observed results to version-change.' });
    const row = rows[Math.floor(Math.random() * rows.length)];
    const sub = st.submissions.find(s => s.puId === row.puId && s.electionId === 'e-gov-2027');
    if (sub) { const obs = irev.produceSnapshot(row.puId, sub, st.meta.simNow); detail = obs ? `Version change simulated for ${row.puId} — case generated.` : 'No change produced.'; }
  } else if (action === 'outage') {
    const h = ir.sourceHealth;
    if (h.status === 'UNAVAILABLE') return sendJson(res, 400, { error: 'ALREADY_OUTAGE', message: 'Source is already unavailable.' });
    h.status = 'UNAVAILABLE';
    h.outageSince = st.meta.simNow;
    h.outageUntil = st.meta.simNow + 30 * 60000;
    irev.upsertAlert({
      dedupeKey: 'source-outage', category: 'SOURCE OUTAGE', severity: 'HIGH',
      title: 'IReV SOURCE UNAVAILABLE',
      note: 'Public IReV source is currently unavailable. Result disappearance comparisons are temporarily suspended. No false "deleted result" alerts will be generated.',
    });
    irev.logEvent('SOURCE', 'SOURCE OUTAGE', 'Public IReV source unavailable — disappearance comparisons suspended');
    detail = 'Source outage simulated (30 sim-minutes). Disappearance comparisons suspended.';
  } else if (action === 'restore') {
    const h = ir.sourceHealth;
    h.status = 'ONLINE'; h.outageUntil = null;
    detail = 'Source restored — reconciliation re-run against last good snapshots.';
    irev.logEvent('SOURCE', 'SOURCE RESTORED — reconciliation re-run', detail);
  } else {
    return sendJson(res, 400, { error: 'BAD_ACTION', message: 'Unknown demo action.' });
  }
  set(() => {});
  sendJson(res, 200, { ok: true, detail, simNow: st.meta.simNow });
});
route('GET', /^\/api\/irev\/whatchanged$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, irev.whatChanged(15));
});

// --- CENTRAL COMMAND 2.0 endpoints ---
route('GET', /^\/api\/central\/health$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const k = reports.aggregates();
  const rec = irev.reconcileState();
  const lgas = reports.lgAggregates();
  const lgs = Object.values(lgas);
  const agents = st.agents.length, online = st.agents.filter(a => a.online).length;
  const incs = st.incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status));
  const resolved = st.incidents.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status)).length;
  const evTotal = st.evidence.filter(e => e.kind === 'EC8A').length;
  const evAnom = st.submissions.filter(s => (s.anomalies || []).length).length;
  const components = [
    { k: 'FIELD NETWORK', v: pct(online, agents), w: 0.12, target: 'agents' },
    { k: 'REPORTING', v: k.reportingPct, w: 0.15, target: 'results' },
    { k: 'RESULTS', v: pct(k.submittedPu, k.totalPu), w: 0.15, target: 'results' },
    { k: 'IReV MONITORING', v: rec.kpis.coveragePct, w: 0.15, target: 'watchtower' },
    { k: 'CONNECTIVITY', v: pct(online, agents), w: 0.13, target: 'connectivity' },
    { k: 'INCIDENT RESPONSE', v: pct(resolved, Math.max(1, st.incidents.length)), w: 0.15, target: 'incidents' },
    { k: 'EVIDENCE INTEGRITY', v: 100 - Math.min(30, evAnom * 1.5), w: 0.15, target: 'evidence' },
  ];
  const score = Math.round(components.reduce((a, c) => a + Math.max(0, Math.min(100, c.v)) * c.w, 0));
  // bottlenecks (§45)
  const bottlenecks = [];
  if (k.pending > 40) bottlenecks.push({ sev: k.pending > 100 ? 'HIGH' : 'MEDIUM', name: 'VERIFICATION BACKLOG', detail: `${k.pending} submissions await review (${k.verificationQueue} in queue).`, target: 'verify' });
  if (rec.kpis.pending > 20) bottlenecks.push({ sev: rec.kpis.pending > 80 ? 'HIGH' : 'MEDIUM', name: 'IReV OBSERVATION GAP', detail: `${rec.kpis.pending} field results have no corresponding IReV observation.`, target: 'irevpending' });
  const lowLg = lgs.filter(l => l.reportingPct < 50);
  if (lowLg.length) bottlenecks.push({ sev: 'HIGH', name: 'AGENT REPORTING GAP', detail: `${lowLg.length} LGA(s) below 50% reporting: ${lowLg.slice(0, 3).map(l => l.name).join(', ')}.`, target: 'lg' });
  if (online / Math.max(1, agents) < 0.75) bottlenecks.push({ sev: 'MEDIUM', name: 'CONNECTIVITY', detail: `${pct(online, agents)}% of agents online.`, target: 'connectivity' });
  if (rec.kpis.underReview > 10) bottlenecks.push({ sev: 'MEDIUM', name: 'RECONCILIATION REVIEW BACKLOG', detail: `${rec.kpis.underReview} discrepancy case(s) await human review.`, target: 'irevrecon' });
  // source reliability (§46)
  const h = st.systemHealth;
  const sources = [
    { name: 'AGENT NETWORK', status: online / Math.max(1, agents) > 0.7 ? 'HEALTHY' : online / Math.max(1, agents) > 0.4 ? 'DEGRADED' : 'CRITICAL', detail: `${online}/${agents} online` },
    { name: 'LG SYSTEM', status: lgs.filter(l => l.agentsOnline > 0).length / Math.max(1, lgs.length) > 0.8 ? 'HEALTHY' : 'DEGRADED', detail: `${lgs.length} LGAs reporting` },
    { name: 'SENATORIAL SYSTEM', status: 'HEALTHY', detail: '3 districts reporting' },
    { name: 'CENTRAL API', status: h.api, detail: `${Math.round(h.responseMs)}ms` },
    { name: 'IReV WATCHTOWER', status: irev.cfg().sourceHealth.status === 'ONLINE' ? 'HEALTHY' : irev.cfg().sourceHealth.status === 'DEGRADED' ? 'DEGRADED' : 'CRITICAL', detail: `${irev.cfg().sourceHealth.observations} observations` },
    { name: 'DATABASE', status: h.db, detail: 'persisted snapshot' },
    { name: 'STORAGE', status: h.storage, detail: 'immutable evidence store' },
    { name: 'NOTIFICATION', status: h.notification, detail: 'in-app + SSE' },
    { name: 'VIDEO', status: h.video, detail: `${st.streams.filter(s => s.status === 'LIVE').length} live streams` },
    { name: 'GIS', status: 'HEALTHY', detail: '44 LGA polygons' },
  ];
  sendJson(res, 200, {
    score, status: score >= 85 ? 'OPERATIONAL' : score >= 65 ? 'WATCH' : score >= 45 ? 'ATTENTION' : 'CRITICAL', components,
    bottlenecks, sources, mode: st.config.mode || 'ELECTION_DAY',
    simNow: st.meta.simNow,
  });
});
route('GET', /^\/api\/central\/eventfeed$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const url = new URL(req.url, 'http://x');
  const type = url.searchParams.get('type');
  const rows = [];
  const add = (t, type, label, detail, extra = {}) => rows.push({ t, type, label, detail: detail || '', ...extra });
  for (const f of st.fieldReports.slice(0, 60)) add(f.at, 'FIELD', 'NEW FIELD REPORT', `${f.type} @ ${f.puId}`, { puId: f.puId, lgaId: f.lgaId });
  for (const s of st.submissions.slice(0, 80)) {
    add(s.submittedAt, 'RESULT', 'RESULT SUBMITTED', `${s.code || s.id.slice(0, 8)} @ ${s.puId} (${s.status})`, { puId: s.puId, lgaId: s.lgaId, submissionId: s.id });
    if (s.verifiedAt) add(s.verifiedAt, 'RESULT', 'RESULT VERIFIED', `${s.puId} — verification completed`, { puId: s.puId, lgaId: s.lgaId, submissionId: s.id });
    if (s.rejectedAt) add(s.rejectedAt, 'RESULT', 'RESULT REJECTED', `${s.puId} — review required`, { puId: s.puId, lgaId: s.lgaId, submissionId: s.id });
  }
  for (const i of st.incidents.slice(0, 60)) add(i.createdAt, 'INCIDENT', 'INCIDENT RECEIVED', `${i.code} — ${i.subcategory} (L${i.severity})`, { puId: i.puId, lgaId: i.lgaId, incidentId: i.id });
  for (const s of st.sosEvents.slice(0, 30)) add(s.createdAt, 'SOS', 'SOS ALERT', `${s.code} — ${s.category} @ ${s.puId}`, { puId: s.puId, lgaId: s.lgaId, sosId: s.id });
  for (const e of irev.cfg().events.slice(0, 100)) {
    add(e.t, e.type === 'CHANGE' ? 'IREV_CHANGE' : e.type === 'UNAVAILABLE' ? 'IREV_UNAVAILABLE' : e.type === 'SOURCE' ? 'SOURCE' : 'IREV', e.label, e.detail, { puId: e.puId, lgaId: e.lgaId });
  }
  for (const c of irev.cfg().cases.slice(0, 60)) add(c.createdAt, 'CASE', 'RECONCILIATION CASE', `${c.code} — ${c.type} (${c.status})`, { puId: c.puId, lgaId: c.lgaId, caseId: c.id });
  for (const e of st.escalations.slice(0, 40)) add(e.createdAt, 'ESCALATION', 'ESCALATION RECEIVED', `${e.code} — ${e.type} (${e.priority})`, { lgaId: e.lgaId });
  for (const a of st.agents) {
    if (a.checkedInAt) add(a.checkedInAt, 'FIELD', 'AGENT CHECKED IN', `${a.code} @ ${a.puId}`, { puId: a.puId, lgaId: a.lgaId, agentId: a.id });
    if (a.completedAt) add(a.completedAt, 'FIELD', 'DUTY COMPLETED', a.code, { puId: a.puId, lgaId: a.lgaId, agentId: a.id });
  }
  let out = rows.sort((a, b) => b.t - a.t);
  if (type) out = out.filter(r => r.type === type);
  sendJson(res, 200, { total: out.length, rows: out.slice(0, 150), types: [...new Set(rows.map(r => r.type))] });
});
// tasks (§34)
route('GET', /^\/api\/tasks$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  sendJson(res, 200, { total: st.tasks.length, rows: st.tasks.slice(0, 200) });
});
route('POST', /^\/api\/tasks$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!(body.title || '').trim()) return sendJson(res, 400, { error: 'TITLE_REQUIRED' });
  const task = {
    id: util.uuid(), code: nextCode(st, 'task'),
    title: String(body.title).slice(0, 160), detail: String(body.detail || '').slice(0, 400),
    ownerId: body.ownerId || u.id, ownerName: body.ownerName || u.name,
    priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(body.priority) ? body.priority : 'MEDIUM',
    deadline: body.deadline || null, status: 'OPEN',
    relatedType: String(body.relatedType || '').slice(0, 24), relatedId: String(body.relatedId || '').slice(0, 80),
    createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
    history: [{ at: st.meta.simNow, note: `Task created by ${u.name}` }],
  };
  st.tasks.unshift(task);
  if (st.tasks.length > 500) st.tasks.length = 500;
  audit(u, 'TASK_CREATED', 'task', task.id, `${task.code} ${task.title}`, req);
  broadcastSse({ kind: 'event', type: 'task.created', taskId: task.id });
  set(() => {});
  sendJson(res, 201, task);
});
route('POST', /^\/api\/tasks\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const t = st.tasks.find(x => x.id === m[1]);
  if (!t) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const status = String(body.status || '').toUpperCase();
  if (!['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) return sendJson(res, 400, { error: 'BAD_STATUS' });
  t.status = status; t.updatedAt = st.meta.simNow;
  if (body.ownerName) t.ownerName = String(body.ownerName).slice(0, 80);
  t.history.push({ at: st.meta.simNow, note: `${status} — ${u.name}${body.note ? ' — ' + String(body.note).slice(0, 160) : ''}` });
  audit(u, `TASK_${status}`, 'task', t.id, `${t.code} — ${body.note || ''}`, req);
  broadcastSse({ kind: 'event', type: 'task.updated', taskId: t.id, status });
  set(() => {});
  sendJson(res, 200, { ok: true, status });
});
// communications (§32-33)
route('POST', /^\/api\/communications$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!(body.body || '').trim()) return sendJson(res, 400, { error: 'EMPTY_BODY' });
  const target = body.target || 'LG';
  if (!['SENATORIAL', 'LG', 'SUPERVISOR', 'ALL'].includes(target)) return sendJson(res, 400, { error: 'BAD_TARGET' });
  const roleIds = target === 'SENATORIAL' ? ['sencoord', 'sendirector', 'senops', 'senanalyst'] : target === 'LG' ? ['lgcoord', 'lgsupervisor', 'lganalyst', 'lgtech'] : target === 'SUPERVISOR' ? ['supervisor', 'reviewer'] : ['lgcoord', 'sencoord', 'supervisor', 'director', 'analyst', 'operator'];
  const priority = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].includes(body.priority) ? body.priority : 'MEDIUM';
  const msg = {
    id: util.uuid(), fromId: u.id, fromName: u.name, fromRole: u.roleId,
    channel: target, toRoleIds: roleIds, body: String(body.body).slice(0, 600),
    priority, at: st.meta.simNow,
    acks: [], status: 'SENT',
  };
  st.messages.unshift(msg);
  if (st.messages.length > 2000) st.messages.length = 2000;
  notify(roleIds, `Central broadcast — ${target}`, msg.body.slice(0, 120), { priority, link: '/central?tab=comms' });
  audit(u, 'COMMUNICATION_SENT', 'message', msg.id, `${target} broadcast (${priority})`, req);
  broadcastSse({ kind: 'event', type: 'communication.sent', messageId: msg.id, priority });
  set(() => {});
  sendJson(res, 201, { id: msg.id, status: 'SENT', recipients: roleIds.length });
});
route('GET', /^\/api\/communications$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const rows = st.messages.filter(m => m.channel && m.toRoleIds && m.toRoleIds.includes(u.roleId) || (m.channel && ['director', 'superadmin', 'chiefanalyst', 'comms', 'analyst', 'operator', 'irevanalyst'].includes(u.roleId))).slice(0, 100);
  sendJson(res, 200, { rows });
});
route('POST', /^\/api\/communications\/([^/]+)\/ack$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const msg = st.messages.find(x => x.id === m[1]);
  if (!msg) return sendJson(res, 404, { error: 'NOT_FOUND' });
  if (!msg.acks.some(a => a.userId === u.id)) {
    msg.acks.push({ userId: u.id, name: u.name, role: u.roleId, at: st.meta.simNow });
    if (msg.acks.length === 1) msg.status = 'DELIVERED';
    msg.status = 'ACKNOWLEDGED';
    audit(u, 'COMMUNICATION_ACKNOWLEDGED', 'message', msg.id, `${msg.channel} broadcast by ${msg.fromName}`, req);
    set(() => {});
  }
  sendJson(res, 200, { ok: true, acks: msg.acks.length, status: msg.status });
});
// shift management (§35-36)
route('GET', /^\/api\/shifts$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const team = st.users.filter(x => ['director', 'chiefanalyst', 'resultmanager', 'irevanalyst', 'incidentcommander', 'comms', 'analyst', 'operator'].includes(x.roleId)).map(x => ({ id: x.id, name: x.name, roleId: x.roleId, roleName: st.roles.find(r => r.id === x.roleId)?.name }));
  const shiftA = team.filter((_, i) => i % 2 === 0).map(t => t.name);
  const shiftB = team.filter((_, i) => i % 2 === 1).map(t => t.name);
  const current = (st.config.mode === 'ELECTION_DAY' ? shiftA.length ? shiftA : shiftB : shiftB.length ? shiftB : shiftA);
  sendJson(res, 200, {
    team,
    schedule: [
      { shift: 'SHIFT A — 06:00–14:00 WAT', members: shiftA, current: st.config.mode !== 'POST_ELECTION' },
      { shift: 'SHIFT B — 14:00–22:00 WAT', members: shiftB, current: st.config.mode === 'POST_ELECTION' },
    ],
    handover: st.shifts.slice(0, 20),
  });
});
route('POST', /^\/api\/shifts\/handover$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'reports.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const rec = irev.reconcileState();
  const k = reports.aggregates();
  const handover = {
    id: util.uuid(),
    fromName: u.name, fromRole: u.roleId, at: st.meta.simNow,
    notes: String(body.notes || '').slice(0, 600),
    criticalWatch: String(body.watch || '').slice(0, 600),
    summary: {
      activeIncidents: k.activeIncidents, criticalIncidents: k.criticalIncidents, activeSos: k.activeSos,
      irevDiscrepancies: rec.kpis.discrepancies, irevUnderReview: rec.kpis.underReview,
      pendingResults: k.pending, verificationBacklog: k.verificationQueue,
      openTasks: st.tasks.filter(t => !['RESOLVED', 'CLOSED'].includes(t.status)).length,
      openCases: rec.kpis.underReview,
      openEscalations: st.escalations.filter(e => !['RESOLVED', 'CLOSED'].includes(e.status)).length,
    },
    acknowledgedBy: null, acknowledgedAt: null,
  };
  st.shifts.unshift(handover);
  if (st.shifts.length > 60) st.shifts.length = 60;
  audit(u, 'SHIFT_HANDOVER_GENERATED', 'handover', handover.id, `by ${u.name}`, req);
  set(() => {});
  sendJson(res, 201, handover);
});
route('POST', /^\/api\/shifts\/handover\/([^/]+)\/ack$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const h = st.shifts.find(x => x.id === m[1]);
  if (!h) return sendJson(res, 404, { error: 'NOT_FOUND' });
  h.acknowledgedBy = u.name; h.acknowledgedAt = st.meta.simNow;
  audit(u, 'SHIFT_HANDOVER_ACKNOWLEDGED', 'handover', h.id, `by ${u.name}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true });
});
// report generation + version control (§56-58)
route('POST', /^\/api\/reports\/generate$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'reports.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const type = String(body.type || 'CENTRAL_SITREP').toUpperCase();
  if (!['CENTRAL_SITREP', 'IREV_RECONCILIATION', 'INCIDENT_REPORT', 'SHIFT_HANDOVER'].includes(type)) return sendJson(res, 400, { error: 'BAD_TYPE' });
  const prev = st.reports.filter(r => r.type === type).length;
  const rep = {
    id: util.uuid(), code: nextCode(st, 'sitrep'),
    type, version: prev + 1, authorId: u.id, authorName: u.name,
    createdAt: st.meta.simNow, status: 'DRAFT',
    snapshot: {
      simNow: st.meta.simNow,
      kpis: reports.aggregates(),
      irev: (() => { try { return irev.reconcileState().kpis; } catch (e) { return null; } })(),
    },
  };
  st.reports.unshift(rep);
  if (st.reports.length > 200) st.reports.length = 200;
  audit(u, 'REPORT_GENERATED', 'report', rep.id, `${rep.code}-V${rep.version} (${type})`, req);
  set(() => {});
  sendJson(res, 201, rep);
});
route('GET', /^\/api\/reports\/generated$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'reports.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: S().reports.slice(0, 100) });
});
// mode (§77-79)
route('POST', /^\/api\/central\/mode$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'admin.config')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!['PRE_ELECTION', 'ELECTION_DAY', 'POST_ELECTION'].includes(body.mode)) return sendJson(res, 400, { error: 'BAD_MODE' });
  st.config.mode = body.mode;
  audit(u, 'MODE_CHANGED', 'config', null, `→ ${body.mode}`, req);
  broadcastSse({ kind: 'mode.changed', mode: body.mode });
  set(() => {});
  sendJson(res, 200, { ok: true, mode: body.mode });
});
// alert lifecycle (§65)
route('POST', /^\/api\/irev\/alerts\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S(); const ir = irev.cfg();
  const al = ir.alerts.find(a => a.id === m[1]);
  if (!al) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const status = String(body.status || '').toUpperCase();
  if (!['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].includes(status)) return sendJson(res, 400, { error: 'BAD_STATUS' });
  al.status = status; al.updatedAt = st.meta.simNow;
  if (body.assignee) al.assignee = String(body.assignee).slice(0, 80);
  audit(u, `IREV_ALERT_${status}`, 'irevAlert', al.id, `${al.code} — ${body.note || ''}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, status });
});

// --- PUBLIC ELECTION OBSERVATORY 2.0 endpoints (public-safe) ---
route('GET', /^\/api\/public\/reconciliation$/, (req, res) => {
  const st = S();
  const rec = irev.reconcileState();
  const rows = rec.rows.map(r => ({
    puId: r.puId, code: r.code, ward: r.ward, lga: r.lga, senatorial: r.senatorial,
    status: r.status, label: r.label,
    fieldReceived: !!r.fieldHash, observed: r.obsCount > 0, obsCount: r.obsCount,
    eovStatus: r.eovStatus, pendingSince: r.pendingSince,
  }));
  sendJson(res, 200, { rows, kpis: rec.kpis, disclaimer: 'UNOFFICIAL MONITORING DATA — NOT INEC OFFICIAL RESULTS. Reconciliation states only — no vote figures are published.' });
});

route('GET', /^\/api\/public\/kpis$/, (req, res) => {
  const st = S();
  const ag = reports.aggregates();
  const rec = irev.reconcileState();
  const evDocs = st.evidence.filter(e => e.kind === 'EC8A').length;
  const incs = st.incidents;
  const incStatus = {
    total: incs.length,
    verified: incs.filter(i => ['RESOLVED', 'CLOSED'].includes(i.status)).length,
    underReview: incs.filter(i => ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'ESCALATED', 'DISPUTED'].includes(i.status)).length,
    resolved: incs.filter(i => i.status === 'RESOLVED').length,
    open: incs.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).length,
  };
  const phase = sim.phaseOf(st.meta.simNow);
  sendJson(res, 200, {
    disclaimer: 'UNOFFICIAL MONITORING DATA — DEMO SIMULATION. NOT INEC OFFICIAL RESULTS.',
    lastUpdated: st.meta.simNow,
    phase,
    lifecycle: phase === 'PRE-OPENING' ? 'PRE_ELECTION' : phase === 'POST-ELECTION' ? 'POST_ELECTION' : 'ELECTION_DAY',
    active: true,
    kpis: {
      totalPu: ag.totalPu, monitoredPus: st.agents.length,
      fieldReports: st.fieldReports.length,
      resultDocs: evDocs,
      irevObserved: rec.kpis.observed, irevPending: rec.kpis.pending,
      matched: rec.kpis.matched, reconciled: rec.kpis.matched,
      underReview: rec.kpis.underReview,
      docChanges: rec.kpis.docChanges,
      unavailable: rec.kpis.unavailable,
      coveragePct: ag.reportingPct,
      irevCoveragePct: rec.kpis.coveragePct,
      reconciliationPct: rec.kpis.reconciliationPct,
      incidents: incStatus,
    },
    sources: {
      field: { label: 'Field monitoring network', kind: 'MONITORING DATA', updatedAt: st.meta.simNow },
      irev: { label: 'Public IReV observations', kind: 'IReV OBSERVATION', updatedAt: irev.cfg().sourceHealth.lastSync },
      reconciliation: { label: 'Internal reconciliation engine', kind: 'VERIFIED MONITORING RECORDS', updatedAt: st.meta.simNow },
    },
  });
});
route('GET', /^\/api\/public\/activity$/, (req, res) => {
  const st = S();
  const url = new URL(req.url, 'http://x');
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '40', 10));
  const rows = [];
  const lgaName = (id) => st.lgas.find(l => l.id === id)?.name || '';
  const push = (t, type, label, loc, status) => rows.push({ t, type, label, loc, status });
  for (const s of st.submissions) {
    if (s.status === 'VERIFIED' && s.verifiedAt) push(s.verifiedAt, 'RECONCILIATION', 'Reconciliation completed', lgaName(s.lgaId), 'VERIFIED');
    else if (['SUBMITTED', 'UNDER_REVIEW'].includes(s.status)) push(s.submittedAt, 'RESULT', 'Result document received', lgaName(s.lgaId), 'UNDER REVIEW');
    else if (s.status === 'VERIFIED') push(s.verifiedAt, 'RESULT', 'Result record verified', lgaName(s.lgaId), 'VERIFIED');
  }
  for (const o of irev.cfg().observations) {
    if (o.available === false) push(o.observedAt, 'IREV', 'Record currently unavailable', lgaName(o.lgaId), 'UNDER REVIEW');
    else if (o.version >= 2) push(o.observedAt, 'IREV', 'New version observed', lgaName(o.lgaId), 'UNDER REVIEW');
    else push(o.observedAt, 'IREV', 'IReV record observed', lgaName(o.lgaId), 'OBSERVED');
  }
  for (const i of st.incidents) {
    if (['RESOLVED', 'CLOSED'].includes(i.status)) push(i.updatedAt || i.createdAt, 'INCIDENT', 'Public incident verified', lgaName(i.lgaId), 'VERIFIED');
    else push(i.createdAt, 'INCIDENT', 'Public incident reported', lgaName(i.lgaId), 'UNDER REVIEW');
  }
  rows.sort((a, b) => b.t - a.t);
  sendJson(res, 200, { rows: rows.slice(0, limit), note: 'LGA-level public activity only — no agent identity, no private coordinates.' });
});
route('GET', /^\/api\/public\/wards$/, (req, res) => {
  const st = S();
  const rec = irev.reconcileState();
  const byWard = {};
  for (const r of rec.rows) {
    const w = st.pus.find(p => p.id === r.puId)?.wardId;
    if (!w) continue;
    byWard[w] = byWard[w] || { pus: 0, reported: 0, irev: 0, matched: 0, incidents: 0 };
    byWard[w].pus++;
    if (r.eovStatus && r.eovStatus !== 'UNVERIFIED') byWard[w].reported++;
    if (r.obsCount > 0) byWard[w].irev++;
    if (r.status === 'MATCHED') byWard[w].matched++;
  }
  for (const i of st.incidents) if (i.wardId && byWard[i.wardId]) byWard[i.wardId].incidents++;
  const rows = st.wards.map(w2 => {
    const s2 = byWard[w2.id] || { pus: 0, reported: 0, irev: 0, matched: 0, incidents: 0 };
    return {
      id: w2.id, name: w2.name, lgaId: w2.lgaId, lga: st.lgas.find(l => l.id === w2.lgaId)?.name,
      pus: s2.pus, reported: s2.reported, irev: s2.irev, matched: s2.matched, incidents: s2.incidents,
      coveragePct: s2.pus ? Math.round(s2.reported / s2.pus * 100) : 0,
    };
  });
  sendJson(res, 200, { rows });
});
route('GET', /^\/api\/public\/pus\/([^/]+)$/, (req, res, body, m) => {
  const st = S();
  const rec = irev.reconcileState();
  const pu = st.pus.find(p => p.id === m[1] || p.code === m[1]);
  if (!pu) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const r = rec.rows.find(x => x.puId === pu.id);
  const sub = st.submissions.find(s => s.puId === pu.id && s.electionId === 'e-gov-2027');
  const ward = st.wards.find(w => w.id === pu.wardId);
  const lga = st.lgas.find(l => l.id === pu.lgaId);
  sendJson(res, 200, {
    disclaimer: 'UNOFFICIAL MONITORING DATA — NOT INEC OFFICIAL RESULTS.',
    pu: { code: pu.code, name: pu.name, ward: ward?.name, lga: lga?.name, senatorial: lga?.senatorial, state: 'Kano' },
    monitoring: {
      status: st.agents.some(a => a.puId === pu.id && ['ON_DUTY', 'POLLING_MONITORING', 'RESULT_SUBMITTED', 'UNDER_REVIEW', 'VERIFIED'].includes(a.dutyState)) ? 'ACTIVE' : 'NOT ACTIVE',
      fieldReport: sub ? 'RECEIVED' : 'NOT RECEIVED',
      ec8a: sub && sub.evidenceIds?.length ? 'RECEIVED' : sub ? 'SUBMITTED' : 'NOT RECEIVED',
      irev: r ? (r.obsCount > 0 ? 'OBSERVED' : 'NOT OBSERVED') : 'NOT OBSERVED',
      reconciliation: r ? r.status : 'PENDING',
      verifiedStatus: sub ? sub.status : 'UNVERIFIED',
    },
    lastUpdated: sub ? sub.submittedAt : st.meta.simNow,
  });
});
route('GET', /^\/api\/public\/search$/, (req, res) => {
  const st = S();
  const q = (new URL(req.url, 'http://x').searchParams.get('q') || '').toLowerCase().trim();
  if (!q || q.length < 2) return sendJson(res, 200, { results: [] });
  const rec = irev.reconcileState();
  const out = [];
  for (const l of st.lgas) if (l.name.toLowerCase().includes(q)) {
    const rows = rec.rows.filter(x => x.lgaId === l.id);
    out.push({ type: 'LGA', id: l.id, label: `${l.name} LGA`, sub: `${l.senatorial} · ${rows.length} monitoring records`, stats: { records: rows.length, irev: rows.filter(x => x.obsCount > 0).length, incidents: st.incidents.filter(i => i.lgaId === l.id).length } });
    if (out.length > 12) break;
  }
  for (const w2 of st.wards) if (w2.name.toLowerCase().includes(q)) {
    out.push({ type: 'WARD', id: w2.id, label: w2.name, sub: `${st.lgas.find(l => l.id === w2.lgaId)?.name || ''} · Ward` });
    if (out.length > 24) break;
  }
  for (const p of st.pus) if (p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)) {
    out.push({ type: 'PU', id: p.id, label: p.code, sub: `${p.name} · ${st.lgas.find(l => l.id === p.lgaId)?.name || ''}` });
    if (out.length > 24) break;
  }
  for (const i of st.incidents) if (i.code.toLowerCase().includes(q)) {
    out.push({ type: 'INCIDENT', id: i.id, label: i.code, sub: `${i.subcategory} · ${st.lgas.find(l => l.id === i.lgaId)?.name || ''} · ${i.status}` });
    if (out.length > 24) break;
  }
  sendJson(res, 200, { results: out.slice(0, 30), note: 'Public search — only information approved for public release.' });
});
route('GET', /^\/api\/public\/corrections$/, (req, res) => {
  sendJson(res, 200, { rows: S().publicCorrections.slice(0, 50) });
});
route('POST', /^\/api\/admin\/public\/corrections$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'public.release')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  if (!(body.original || '').trim() || !(body.corrected || '').trim() || !(body.reason || '').trim()) return sendJson(res, 400, { error: 'FIELDS_REQUIRED' });
  const c = { id: util.uuid(), code: 'CORR-' + String(st.publicCorrections.length + 1).padStart(4, '0'), original: body.original, corrected: body.corrected, reason: body.reason, affected: String(body.affected || '').slice(0, 200), date: st.meta.simNow, by: u.name };
  st.publicCorrections.unshift(c);
  audit(u, 'PUBLIC_CORRECTION_PUBLISHED', 'publicCorrection', c.id, c.code, req);
  set(() => {});
  sendJson(res, 201, c);
});
route('GET', /^\/api\/public\/reports$/, (req, res) => {
  const st = S();
  const rows = st.reports.filter(r => r.status === 'PUBLISHED').map(r => ({ id: r.id, code: r.code, type: r.type, version: r.version, title: r.title || (r.type || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, x => x.toUpperCase()), createdAt: r.createdAt }));
  sendJson(res, 200, { rows: rows.slice(0, 60) });
});
route('POST', /^\/api\/admin\/reports\/([^/]+)\/publish$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'public.release')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const rep = st.reports.find(r => r.id === m[1]);
  if (!rep) return sendJson(res, 404, { error: 'NOT_FOUND' });
  rep.status = 'PUBLISHED';
  rep.publishedBy = u.name;
  rep.publishedAt = st.meta.simNow;
  if (body.title) rep.title = String(body.title).slice(0, 160);
  audit(u, 'REPORT_PUBLISHED', 'report', rep.id, `${rep.code}-V${rep.version} published to public portal`, req);
  set(() => {});
  sendJson(res, 200, rep);
});
route('GET', /^\/api\/public\/export$/, (req, res) => {
  const url = new URL(req.url, 'http://x');
  const type = url.searchParams.get('type') || 'kpis';
  const format = url.searchParams.get('format') || 'json';
  const st = S();
  const ag = reports.aggregates();
  const rec = irev.reconcileState();
  let rows = [];
  if (type === 'kpis') rows = Object.entries({ totalPollingUnits: ag.totalPu, fieldReports: st.fieldReports.length, resultDocuments: st.evidence.filter(e => e.kind === 'EC8A').length, irevObserved: rec.kpis.observed, irevPending: rec.kpis.pending, reconciled: rec.kpis.matched, underReview: rec.kpis.underReview, docChanges: rec.kpis.docChanges, coveragePct: ag.reportingPct, reconciliationPct: rec.kpis.reconciliationPct, incidentsTotal: st.incidents.length, lastUpdated: util.fmtWat(st.meta.simNow) }).map(([k, v]) => ({ metric: k, value: v }));
  else if (type === 'lgas') rows = irev.coverageMatrix().map(l => ({ lga: l.name, senatorial: l.senatorial, expected: l.expected, observed: l.observed, pending: l.pending, matched: l.matched, observedPct: l.observedPct }));
  else if (type === 'wards') rows = [];
  else if (type === 'incidents') rows = st.incidents.map(i => ({ code: i.code, category: i.subcategory, level: i.severity, status: i.status, lga: st.lgas.find(l => l.id === i.lgaId)?.name || '', reportedAt: util.fmtWat(i.createdAt) }));
  else if (type === 'activity') rows = [];
  else return sendJson(res, 400, { error: 'BAD_TYPE' });
  if (type === 'wards') {
    // reuse public wards computation inline
    const byWard = {};
    for (const r of rec.rows) {
      const w2 = st.pus.find(p => p.id === r.puId)?.wardId;
      if (!w2) continue;
      byWard[w2] = byWard[w2] || { pus: 0, reported: 0, irev: 0, matched: 0 };
      byWard[w2].pus++;
      if (r.eovStatus && r.eovStatus !== 'UNVERIFIED') byWard[w2].reported++;
      if (r.obsCount > 0) byWard[w2].irev++;
      if (r.status === 'MATCHED') byWard[w2].matched++;
    }
    rows = st.wards.map(w2 => ({ ward: w2.name, lga: st.lgas.find(l => l.id === w2.lgaId)?.name || '', ...(byWard[w2.id] || { pus: 0, reported: 0, irev: 0, matched: 0 }) }));
  }
  if (type === 'activity') {
    // safe LGA-level activity
    const push = (t, type2, label, loc) => rows.push({ time: util.fmtWat(t), type: type2, event: label, location: loc });
    const lgaName = (id) => st.lgas.find(l => l.id === id)?.name || '';
    for (const s of st.submissions) if (s.status === 'VERIFIED' && s.verifiedAt) push(s.verifiedAt, 'RECONCILIATION', 'Reconciliation completed', lgaName(s.lgaId));
    for (const o of irev.cfg().observations.slice(0, 500)) push(o.observedAt, 'IREV', o.available === false ? 'Record currently unavailable' : o.version >= 2 ? 'New version observed' : 'IReV record observed', lgaName(o.lgaId));
    rows.sort((a, b) => a.time.localeCompare(b.time));
    rows = rows.slice(0, 200);
  }
  if (format === 'csv') return sendBuffer(res, 200, Buffer.from(reports.toCsv(rows)), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="eov-public-' + type + '.csv"' });
  sendJson(res, 200, { type, rows, disclaimer: 'INDEPENDENT MONITORING DATA — attribute and timestamp when reproduced. Not official election results.', generatedAt: util.fmtWat(st.meta.simNow) });
});
route('GET', /^\/api\/public\/api-docs$/, (req, res) => {
  sendJson(res, 200, {
    title: 'PUBLIC DATA API', version: '1.0', basePath: '/api/public',
    endpoints: [
      { path: '/api/public/kpis', method: 'GET', description: 'Public monitoring KPIs with source + status + last-updated' },
      { path: '/api/public/activity', method: 'GET', description: 'LGA-level public activity feed' },
      { path: '/api/public/wards', method: 'GET', description: 'Ward-level public coverage' },
      { path: '/api/public/pus/{code}', method: 'GET', description: 'Polling-unit public monitoring record' },
      { path: '/api/public/search?q=', method: 'GET', description: 'Public search (LGA/ward/PU/public incident)' },
      { path: '/api/public/incidents', method: 'GET', description: 'Aggregated public incident statistics' },
      { path: '/api/public/corrections', method: 'GET', description: 'Published data corrections' },
      { path: '/api/public/reports', method: 'GET', description: 'Published public reports' },
      { path: '/api/public/export?type=kpis|lgas|wards|incidents|activity&format=json|csv', method: 'GET', description: 'Open-data export (aggregate only)' },
      { path: '/api/public/geo', method: 'GET', description: 'Public-safe geography (LGA polygons only)' },
    ],
    rateLimit: '60 requests per minute per address',
    terms: 'Public data may be reproduced with attribution and timestamps. Never exposed: agent credentials, private GPS, private communications, internal security logs, sensitive evidence, personally identifiable information.',
    dataStatus: 'VERIFIED / OBSERVED / REPORTED / UNDER REVIEW / PENDING — see the public status legend.',
  });
});

// --- EYES OF VICTORY field-agent endpoints ---
route('GET', /^\/api\/agent\/device$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const d = st.devices.find(x => x.id === agent.deviceId);
  sendJson(res, 200, {
    agentCode: agent.code,
    device: d ? { id: d.id, model: d.model, os: d.os, imei: d.imei, status: d.status, registeredAt: d.registeredAt } : null,
    appVersion: '1.4.0',
    integrity: {
      deviceAuthorized: d ? d.status === 'APPROVED' : true,
      sessionValid: true,
      rootRisk: 'NONE_DETECTED',
      tamperRisk: 'NONE_DETECTED',
    },
  });
});
route('POST', /^\/api\/agent\/assignment\/verify$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  agent.assignmentVerifiedAt = st.meta.simNow;
  agent.gps = agent.gps || (st.pus.find(p => p.id === agent.puId)?.gps || agent.gps);
  audit(u, 'ASSIGNMENT_VERIFIED', 'agent', agent.id, `${agent.puId} confirmed by agent`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, verifiedAt: agent.assignmentVerifiedAt });
});
route('POST', /^\/api\/agent\/assignment\/issue$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const inc = {
    id: util.uuid(), code: nextCode(st, 'incident'),
    category: 'PROCESS', subcategory: 'Assignment issue', severity: 3,
    puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
    gps: agent.gps, reporterId: agent.id,
    description: String(body.note || 'Agent reports a possible assignment mismatch.').slice(0, 500),
    status: 'NEW', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
    updates: [{ at: st.meta.simNow, status: 'NEW', by: agent.id, note: 'Assignment issue reported by field agent' }], mediaIds: [],
  };
  st.incidents.unshift(inc);
  audit(u, 'ASSIGNMENT_ISSUE_REPORTED', 'agent', agent.id, inc.code, req);
  notify(['lgcoord', 'wardcoord', 'sencoord'], 'Assignment issue reported', `${agent.code}: ${inc.code} — ${agent.puId}`, { priority: 'HIGH', link: '/central?tab=incidents' });
  broadcastSse({ kind: 'event', type: 'incident.created', incidentId: inc.id, severity: 3, lgaId: agent.lgaId });
  set(() => {});
  sendJson(res, 201, { id: inc.id, code: inc.code });
});
route('GET', /^\/api\/agent\/contacts$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  const lga = agent ? st.lgas.find(l => l.id === agent.lgaId) : null;
  const list = [
    ...st.users.filter(x => x.roleId === 'supervisor' && x.status === 'ACTIVE').map(x => ({ id: x.id, name: x.name, role: 'Supervisory Agent' })),
    ...st.users.filter(x => x.roleId === 'lgcoord' && x.status === 'ACTIVE' && (!x.scope?.lga || x.scope.lga === lga?.name)).map(x => ({ id: x.id, name: x.name, role: 'LG Coordinator' })),
    ...st.users.filter(x => x.roleId === 'wardcoord' && x.status === 'ACTIVE').map(x => ({ id: x.id, name: x.name, role: 'Ward Coordinator' })),
    ...st.users.filter(x => x.roleId === 'support' && x.status === 'ACTIVE').map(x => ({ id: x.id, name: x.name, role: 'Technical Support' })),
    ...st.users.filter(x => x.roleId === 'director' && x.status === 'ACTIVE').map(x => ({ id: x.id, name: x.name, role: 'Central Operations' })),
  ];
  sendJson(res, 200, {
    contacts: list,
    escalation: st.config.contacts?.escalation || 'Central Operations — via SOS channel',
    note: 'Contacts are administrator-configured. No external telephone numbers are hard-coded by the application.',
  });
});
route('POST', /^\/api\/agent\/lock$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  for (const [tk, s] of Object.entries(st.sessions)) if (s.userId === u.id) delete st.sessions[tk];
  audit(u, 'ACCOUNT_LOCKED', 'user', u.id, 'Locked from the Field Agent app — all sessions terminated', req);
  set(() => {});
  sendJson(res, 200, { ok: true, message: 'Account locked. All active sessions were terminated. Local evidence on the device is preserved.' });
});
route('POST', /^\/api\/evidence$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const dv = deviceAuthorized(agent);
  if (!dv.ok) return sendJson(res, 403, { error: 'DEVICE_NOT_AUTHORIZED', message: `This device is ${dv.status} and cannot upload evidence. Contact technical support.` });
  const dataUrl = String(body.dataUrl || '');
  if (!dataUrl.startsWith('data:image')) return sendJson(res, 400, { error: 'BAD_EVIDENCE', message: 'A captured image is required.' });
  const ev = {
    id: util.uuid(), code: nextCode(st, 'evidence'),
    kind: ['PHOTO', 'DOCUMENT', 'VIDEO', 'AUDIO'].includes(body.kind) ? body.kind : 'PHOTO',
    sha256: util.sha256(dataUrl), sizeBytes: Math.round(dataUrl.length * 0.75),
    dataUrl, mime: 'image/png', pages: 1,
    capturedAt: st.meta.simNow, uploadedAt: st.meta.simNow,
    deviceId: agent.deviceId, agentId: agent.id, gps: agent.gps,
    description: String(body.description || '').slice(0, 300),
    relatedTo: body.relatedType && body.relatedId ? { type: String(body.relatedType).slice(0, 20), id: String(body.relatedId).slice(0, 80) } : null,
    chain: [{ at: st.meta.simNow, step: 'CAPTURED', by: agent.id }, { at: st.meta.simNow, step: 'UPLOADED', by: agent.id }, { at: st.meta.simNow + 10, step: 'RECEIVED', by: 'platform' }],
  };
  st.evidence.unshift(ev);
  if (ev.relatedTo && ev.relatedTo.type === 'incident') {
    const inc = st.incidents.find(i => i.id === ev.relatedTo.id);
    if (inc) inc.mediaIds.push(ev.id);
  }
  audit(u, 'EVIDENCE_CAPTURED', 'evidence', ev.id, `${ev.code} ${ev.kind}${ev.relatedTo ? ' → ' + ev.relatedTo.type + ' ' + ev.relatedTo.id.slice(0, 12) : ''}`, req);
  broadcastSse({ kind: 'event', type: 'evidence.uploaded', evidenceId: ev.id, agentId: agent.id });
  set(() => {});
  sendJson(res, 201, { id: ev.id, code: ev.code });
});
route('GET', /^\/api\/agent\/evidence$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const rows = st.evidence.filter(e => e.agentId === agent.id).map(e => ({
    id: e.id, code: e.code, kind: e.kind, sha256: e.sha256, sizeBytes: e.sizeBytes, pages: e.pages,
    capturedAt: e.capturedAt, uploadedAt: e.uploadedAt, gps: e.gps, description: e.description || '',
    relatedTo: e.relatedTo || null, submissionId: e.submissionId || null, chain: e.chain, dataUrl: e.dataUrl || null,
  }));
  sendJson(res, 200, { rows });
});
route('GET', /^\/api\/pus\/([^/]+)\/timeline$/, (req, res, body, m) => {
  const u = auth.currentUser(req);
  if (!u || !auth.can(u, 'dashboard.view')) return u ? sendJson(res, 403, { error: 'FORBIDDEN' }) : sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  sendJson(res, 200, { rows: puTimeline(m[1], 80) });
});
route('POST', /^\/api\/reports\/field$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const agent = st.agents.find(a => a.userId === u.id || a.id === u.agentId);
  if (!agent) return sendJson(res, 404, { error: 'NO_AGENT' });
  const fr = {
    id: util.uuid(), agentId: agent.id, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
    type: String(body.type || 'Field report').slice(0, 60),
    answers: body.answers || {}, note: String(body.note || '').slice(0, 500),
    at: st.meta.simNow,
  };
  st.fieldReports.unshift(fr);
  audit(u, 'FIELD_REPORT_SUBMITTED', 'fieldReport', fr.id, `${agent.puId} — ${fr.type}`, req);
  notify(['lgcoord', 'wardcoord'], 'Field report received', `${agent.code}: ${fr.type} @ ${agent.puId}`, { priority: 'LOW', link: '/lg' });
  broadcastSse({ kind: 'event', type: 'fieldreport.submitted', reportId: fr.id, lgaId: agent.lgaId });
  set(() => {});
  sendJson(res, 201, { id: fr.id });
});
route('GET', /^\/api\/messages$/, (req, res) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const rows = st.messages.filter(msg => msg.toUserId === u.id || msg.toRoleId === u.roleId || msg.fromId === u.id).slice(0, 100).map(msg => ({ ...msg, mine: msg.fromId === u.id }));
  sendJson(res, 200, { rows });
});
route('POST', /^\/api\/messages$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  const body_ = String(body.body || '').trim().slice(0, 600);
  if (!body_) return sendJson(res, 400, { error: 'EMPTY_BODY' });
  if (!body.toUserId && !body.toRoleId) return sendJson(res, 400, { error: 'NO_RECIPIENT' });
  const msg = { id: util.uuid(), fromId: u.id, fromName: u.name, fromRole: u.roleId, toUserId: body.toUserId || null, toRoleId: body.toRoleId || null, body: body_, at: st.meta.simNow, read: false };
  st.messages.unshift(msg);
  if (st.messages.length > 2000) st.messages.length = 2000;
  audit(u, 'MESSAGE_SENT', 'message', msg.id, `${body.toRoleId || body.toUserId} — ${body_.slice(0, 60)}`, req);
  if (body.toUserId) notify(null, `Message from ${u.name}`, body_.slice(0, 120), { userId: body.toUserId, priority: 'MEDIUM', link: '/supervisor?tab=messages' });
  set(() => {});
  sendJson(res, 201, { id: msg.id, at: msg.at });
});
route('POST', /^\/api\/messages\/read$/, (req, res, body) => {
  const u = auth.currentUser(req);
  if (!u) return sendJson(res, 401, { error: 'UNAUTHENTICATED' });
  const st = S();
  for (const msg of st.messages) if (msg.toUserId === u.id && (!body.id || msg.id === body.id)) msg.read = true;
  set(() => {});
  sendJson(res, 200, { ok: true });
});

// ================= SENTINEL SOC ROUTES (§1–75) =================
// helper: security portal guard
function secUser(req, res, perm = 'security.view') {
  const u = auth.currentUser(req);
  if (!u) { sendJson(res, 401, { error: 'UNAUTHENTICATED' }); return null; }
  if (!auth.can(u, perm)) { sendJson(res, 403, { error: 'FORBIDDEN', message: `Missing permission: ${perm}` }); return null; }
  return u;
}
const secShortInc = (c) => ({
  id: c.id, code: c.code, title: c.title, category: c.category, severity: c.severity, status: c.status,
  affectedService: c.affectedService, detectedAt: c.detectedAt, analyst: c.analyst, source: c.source,
  timelineCount: c.timeline.length, recovery: c.recovery,
});

route('GET', /^\/api\/sentinel\/status$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const st = S(); const sec = sentinel.cfg();
  const posture = sentinel.posture(sec);
  const now = st.meta.simNow || Date.now();
  const open = sec.incidents.filter(i => i.status !== 'CLOSED');
  const nodePct = Math.round(sec.nodes.filter(n => ['HEALTHY', 'STANDBY'].includes(n.status)).length / sec.nodes.length * 1000) / 10;
  const apiPct = Math.round(sec.apis.filter(a => a.status === 'HEALTHY').length / sec.apis.length * 10000) / 100;
  const critVulns = sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN').length;
  const eventsTotal = 12482 + sec.events.length;
  const hourAgo = now - 3600 * 1000;
  const alertOpen = sec.alerts.filter(a => a.status === 'OPEN');
  const critAlerts = alertOpen.filter(a => a.severity === 'CRITICAL');
  const pendingApprovals = sec.actions.filter(a => ['REQUESTED', 'PENDING_DUAL'].includes(a.status));
  sendJson(res, 200, {
    top: {
      systemSecurity: 'PROTECTED', threatLevel: sec.threatLevel, nodesHealthy: nodePct, apiHealth: apiPct,
      activeIncidents: String(open.length).padStart(2, '0'),
      criticalVulnerabilities: String(critVulns).padStart(2, '0'),
      securityEvents: eventsTotal.toLocaleString('en-NG'),
      lastScan: fmtWat(sec.lastScan).split(' ')[1] || '—',
    },
    threat: { level: sec.threatLevel, basis: sec.threatBasis, levels: sentinel.THREAT_LEVELS || ['NORMAL', 'GUARDED', 'ELEVATED', 'HIGH', 'CRITICAL'], overrides: sec.threatOverrides },
    posture,
    electionDay: { active: sec.electionDay, priorities: sec.electionPriorities },
    counters: {
      openIncidents: open.length, openAlerts: alertOpen.length, criticalAlerts: critAlerts.length,
      pendingApprovals: pendingApprovals.length, degradedNodes: sec.nodes.filter(n => ['DEGRADED', 'WARNING'].includes(n.status)).length,
      criticalNodes: sec.nodes.filter(n => ['CRITICAL', 'OFFLINE', 'ISOLATED', 'BLOCKED'].includes(n.status)).length,
      activeThreats: sec.threatIntel.filter(t => ['ACTIVE', 'UNDER_INVESTIGATION'].includes(t.status)).length,
      breakglassActive: sec.breakglass.filter(b => b.status === 'ACTIVE').length,
      totalEvents1h: sec.events.filter(e => e.createdAt >= hourAgo).length,
    },
    evidence: { integrity: sec.evidence.integrity, hashVerified: sec.evidence.hashVerified, failures: sec.evidence.failedVerification },
    irevSec: { connector: sec.irev.connector, hashVerification: sec.irev.hashVerification },
    publicSec: { availability: sec.public.availability, cdn: sec.public.cdnStatus },
    sim: { now, scenario: st.meta.scenario, speed: st.meta.simSpeed, paused: st.meta.simPaused },
  });
});

// ---- nodes (§7/8/9) ----
route('GET', /^\/api\/sentinel\/nodes$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const id = url.searchParams.get('id');
  if (id) {
    const n = sec.nodes.find(x => x.id === id);
    if (!n) return sendJson(res, 404, { error: 'NOT_FOUND' });
    return sendJson(res, 200, {
      node: n,
      events: sec.events.filter(e => e.nodeId === id || e.source === id).slice(0, 20),
      vulns: sec.vulns.filter(v => v.asset === id),
      networkHealth: 'OK',
      backups: sec.backup.jobs.slice(0, 3),
    });
  }
  sendJson(res, 200, { rows: sec.nodes.map(n => ({ ...n, events: undefined })), total: sec.nodes.length, kindSummary: {
    healthy: sec.nodes.filter(n => n.status === 'HEALTHY').length, degraded: sec.nodes.filter(n => n.status === 'DEGRADED').length,
    warning: sec.nodes.filter(n => n.status === 'WARNING').length, critical: sec.nodes.filter(n => n.status === 'CRITICAL').length,
    isolated: sec.nodes.filter(n => n.status === 'ISOLATED').length, offline: sec.nodes.filter(n => n.status === 'OFFLINE').length,
  } });
});
route('POST', /^\/api\/sentinel\/nodes\/([^/]+)\/action$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  if (!sec.nodes.find(n => n.id === m[1])) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const action = String(body.action || '');
  const safe = ['RUN_HEALTH_CHECK', 'RESTART_SERVICE', 'ROTATE_CREDENTIAL', 'ISOLATE_NODE', 'BLOCK_COMPONENT', 'RUN_VULN_SCAN', 'VERIFY_BACKUP', 'FAILOVER_SERVICE'];
  if (!safe.includes(action)) return sendJson(res, 400, { error: 'INVALID_ACTION' });
  const r = sentinel.requestAction(u, action, m[1], body.detail || '');
  if (r.error) return sendJson(res, r.error === 'FORBIDDEN' ? 403 : 400, r);
  sendJson(res, 200, r);
});

// ---- API security (§10/12/13/11) ----
route('GET', /^\/api\/sentinel\/apis$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const now = S().meta.simNow || Date.now();
  const hourAgo = now - 3600 * 1000;
  const anomalies = [];
  for (const a of sec.apis) {
    const reasons = [];
    if (a.requestsPerSec > 92) reasons.push({ kind: 'REQUEST_SPIKE', evidence: `${a.requestsPerSec} req/s vs baseline` });
    if (a.authFailures > 40) reasons.push({ kind: 'AUTH_FAILURES', evidence: `${a.authFailures} auth failures` });
    if (a.authzFailures > 6) reasons.push({ kind: 'AUTHZ_FAILURES', evidence: `${a.authzFailures} authorization failures` });
    if (a.errorRate > 1.2) reasons.push({ kind: 'ERROR_RATE', evidence: `${a.errorRate}% error rate` });
    if (a.rateLimitEvents > 10) reasons.push({ kind: 'RATE_LIMIT_EVENTS', evidence: `${a.rateLimitEvents} rate-limit events` });
    if (a.threats > 0) reasons.push({ kind: 'THREAT_SIGNALS', evidence: `${a.threats} threat signal(s)` });
    if (reasons.length) anomalies.push({ api: a.id, reasons });
  }
  sendJson(res, 200, {
    rows: sec.apis.map(a => ({ ...a, suspiciousPatterns: undefined })),
    anomalies,
    rateLimit: sec.rateLimitConfig,
    events1h: sec.events.filter(e => e.createdAt >= hourAgo && e.apiId).map(e => ({ code: e.code, title: e.title, api: e.apiId, severity: e.severity, createdAt: e.createdAt })),
    blockedSources: sec.public.rateLimitSources,
  });
});
route('POST', /^\/api\/sentinel\/ratelimit$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const action = String(body.action || '');
  const map = {
    adjust: { action: 'ADJUST_RATE_LIMIT', target: 'API-GATEWAY', detail: String(body.value || 420) },
    block: { action: 'RATE_LIMIT_SOURCE', target: 'SOURCE', detail: body.value || 'source-id' },
    reauth: { action: 'POLICY_OVERRIDE', target: 'API-GATEWAY', detail: 'Require re-authentication for active sessions' },
    protect: { action: 'ADJUST_RATE_LIMIT', target: 'API-GATEWAY', detail: String(body.value || 240) },
    maintenance: { action: 'ENABLE_MAINTENANCE', target: 'API-GATEWAY', detail: 'maintenance mode toggle' },
  };
  const m2 = map[action];
  if (!m2) return sendJson(res, 400, { error: 'INVALID_ACTION' });
  const r = sentinel.requestAction(u, m2.action, m2.target, m2.detail);
  if (r.error) return sendJson(res, r.error === 'FORBIDDEN' ? 403 : 400, r);
  sendJson(res, 200, r);
});

// ---- events (§18) ----
route('GET', /^\/api\/sentinel\/events$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const severity = url.searchParams.get('severity');
  const category = url.searchParams.get('category');
  let rows = sec.events;
  if (severity) rows = rows.filter(e => e.severity === severity);
  if (category) rows = rows.filter(e => e.category === category);
  sendJson(res, 200, { rows: rows.slice(0, 300), total: rows.length });
});

// ---- alerts (§19) ----
route('GET', /^\/api\/sentinel\/alerts$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const severity = url.searchParams.get('severity');
  const category = url.searchParams.get('category');
  let rows = sec.alerts;
  if (severity) rows = rows.filter(a => a.severity === severity);
  if (category) rows = rows.filter(a => a.category === category);
  const counts = {};
  for (const a of sec.alerts) counts[a.severity] = (counts[a.severity] || 0) + 1;
  sendJson(res, 200, { rows: rows.slice(0, 400), counts, categories: sentinel.CATEGORIES });
});
route('POST', /^\/api\/sentinel\/alerts\/([^/]+)\/ack$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const al = sec.alerts.find(a => a.id === m[1] || a.code === m[1]);
  if (!al) return sendJson(res, 404, { error: 'NOT_FOUND' });
  al.status = 'ACK';
  al.ackBy = u.name;
  al.ackedAt = S().meta.simNow || Date.now();
  audit(u, 'SECURITY_ALERT_ACK', 'secAlert', al.code, `${al.title}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, alert: al });
});

// ---- incidents (§20/21/22/52/53) ----
route('GET', /^\/api\/sentinel\/incidents$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const status = url.searchParams.get('status');
  let rows = sec.incidents;
  if (status) rows = rows.filter(i => i.status === status);
  sendJson(res, 200, { rows: rows.slice(0, 200).map(secShortInc), flow: sentinel.CASE_FLOW, openCount: sec.incidents.filter(i => i.status !== 'CLOSED').length });
});
route('GET', /^\/api\/sentinel\/incidents\/([^/]+)$/, (req, res, body, m) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const cse = sec.incidents.find(i => i.id === m[1] || i.code === m[1]);
  if (!cse) return sendJson(res, 404, { error: 'NOT_FOUND' });
  sendJson(res, 200, {
    case: { ...cse, evidence: cse.evidence || [] },
    comms: sec.caseComms.filter(c => c.caseId === cse.id),
    relatedAlerts: sec.alerts.filter(a => a.title.toLowerCase().includes(cse.title.toLowerCase().slice(0, 20)) || a.target === cse.affectedService).slice(0, 10),
    relatedEvents: sec.events.filter(e => e.source === cse.affectedService || e.detail.includes(cse.code)).slice(0, 15),
    flow: sentinel.CASE_FLOW,
  });
});
route('POST', /^\/api\/sentinel\/incidents\/([^/]+)\/transition$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const r = sentinel.transitionCase(u, m[1], String(body.status || ''));
  if (r.error) return sendJson(res, 400, r);
  notify(['secdirector'], `🔐 Case ${r.case.code} → ${r.case.status}`, `${u.name} advanced ${r.case.title} to ${r.case.status}.`, { priority: 'HIGH' });
  sendJson(res, 200, r);
});
route('POST', /^\/api\/sentinel\/incidents\/([^/]+)\/comment$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.view');
  if (!u) return;
  const sec = sentinel.cfg();
  const cse = sec.incidents.find(i => i.id === m[1]);
  if (!cse) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const text = String(body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: 'EMPTY' });
  sec.caseComms.push({ id: util.uuid(), caseId: cse.id, userId: u.id, user: u.name, text: text.slice(0, 1000), createdAt: S().meta.simNow || Date.now() });
  set(() => {});
  sendJson(res, 200, { ok: true, comms: sec.caseComms.filter(c => c.caseId === cse.id) });
});

// ---- vulnerabilities (§26/27/28) ----
route('GET', /^\/api\/sentinel\/vulns$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const severity = url.searchParams.get('severity');
  let rows = sec.vulns;
  if (severity) rows = rows.filter(v => v.severity === severity);
  sendJson(res, 200, { rows: rows.slice(0, 200), totals: sec.scanTotals, scanHistory: sec.scanHistory });
});
route('POST', /^\/api\/sentinel\/vulns\/([^/]+)\/status$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const v = sec.vulns.find(x => x.id === m[1]);
  if (!v) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const status = String(body.status || '');
  if (!['OPEN', 'IN_PROGRESS', 'PATCHED', 'ACCEPTED_RISK'].includes(status)) return sendJson(res, 400, { error: 'INVALID_STATUS' });
  const before = v.status;
  v.status = status;
  if (status === 'ACCEPTED_RISK') v.riskAcceptance = String(body.riskAcceptance || 'Risk accepted by security director');
  if (status === 'PATCHED') v.patchedAt = S().meta.simNow || Date.now();
  audit(u, 'SECURITY_VULN_STATUS', 'vuln', v.cve, `${before} → ${status}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, vuln: v });
});

// ---- patches (§29) ----
route('GET', /^\/api\/sentinel\/patches$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { rows: sec.patches, counts: { pending: sec.patches.filter(p => p.status === 'PENDING').length, scheduled: sec.patches.filter(p => p.status === 'SCHEDULED').length, inProgress: sec.patches.filter(p => p.status === 'IN_PROGRESS').length, installed: sec.patches.filter(p => p.status === 'INSTALLED').length, failed: sec.patches.filter(p => p.status === 'FAILED').length } });
});
route('POST', /^\/api\/sentinel\/patches\/([^/]+)\/action$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const p = sec.patches.find(x => x.id === m[1]);
  if (!p) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const action = String(body.action || '');
  const map = { schedule: 'SCHEDULED', approve: 'APPROVED', rollback: 'ROLLED_BACK', verify: 'INSTALLED' };
  if (!map[action]) return sendJson(res, 400, { error: 'INVALID_ACTION' });
  const before = p.status;
  p.status = map[action];
  audit(u, 'SECURITY_PATCH_ACTION', 'patch', p.id, `${action}: ${before} → ${p.status}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, patch: p });
});

// ---- configuration drift + file integrity (§30/31) ----
route('GET', /^\/api\/sentinel\/config$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { drift: sec.drift, files: sec.fileIntegrity, driftOpen: sec.drift.filter(d => d.status === 'REVIEW').length, filesChanged: sec.fileIntegrity.filter(f => f.status !== 'OK').length });
});

// ---- database security (§32/33) ----
route('GET', /^\/api\/sentinel\/db$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, sec.db);
});

// ---- evidence store security (§34/35) ----
route('GET', /^\/api\/sentinel\/evidence$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const st = S();
  const fieldEvidence = st.evidence || [];
  sec.evidence.filesTracked = fieldEvidence.length;
  sec.evidence.hashVerified = fieldEvidence.filter(e => e.sha256 && e.sha256.length >= 40).length;
  sendJson(res, 200, { ...sec.evidence, sample: fieldEvidence.slice(0, 8).map(e => ({ id: e.id, code: e.code, kind: e.kind, sha256: e.sha256 ? e.sha256.slice(0, 16) + '…' : null, capturedAt: e.capturedAt, chain: e.chain })) });
});
route('POST', /^\/api\/sentinel\/evidence\/verify$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  sec.evidence.lastFullVerification = S().meta.simNow || Date.now();
  sec.evidence.integrity = sec.evidence.integrity === 'BREACHED' ? 'BREACHED' : 'INTACT';
  audit(u, 'SECURITY_EVIDENCE_VERIFY', 'evidence', null, 'Full hash verification executed', req);
  set(() => {});
  sendJson(res, 200, { ok: true, integrity: sec.evidence.integrity, lastFullVerification: sec.evidence.lastFullVerification });
});
// DEMO control: simulate an evidence-integrity event to demonstrate the §71 failsafe chain
route('POST', /^\/api\/sentinel\/evidence\/simulate-event$/, (req, res, body) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  if (!S().config.demoMode) return sendJson(res, 403, { error: 'DEMO_ONLY' });
  const evidenceId = String(body.evidenceId || 'EVD-2027-DEMO-0001');
  const ev = sentinel.evidenceIntegrityEvent(evidenceId, 'sha256:7f83b165…(original)', 'sha256:9e51a3c2…(current)', 'NODE-0008');
  notify(['secdirector'], '🚨 CRITICAL EVIDENCE INTEGRITY EVENT', `DEMO SIMULATION: hash mismatch on ${evidenceId}. Record frozen, snapshot preserved, case opened.`, { priority: 'CRITICAL' });
  audit(u, 'SECURITY_DEMO_EVIDENCE_EVENT', 'evidence', evidenceId, 'Simulated evidence integrity event (demo)', req);
  sendJson(res, 200, { ok: true, event: ev, demo: true, note: 'DEMO SIMULATION ONLY — no real evidence was affected.' });
});

// ---- IReV security (§36) ----
route('GET', /^\/api\/sentinel\/irev$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const ir = irev.cfg();
  sendJson(res, 200, {
    ...sec.irev,
    observations: ir.observations.length,
    cases: ir.cases.length,
    sourceHealth: ir.sourceHealth,
    config: { sourceMethod: ir.config.sourceMethod, enabled: ir.config.enabled },
  });
});

// ---- public platform security (§37/38/39) ----
route('GET', /^\/api\/sentinel\/public$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { ...sec.public, trafficSeries: sec.public.trafficSeries.slice(-48) });
});

// ---- identity (§14/15) ----
route('GET', /^\/api\/sentinel\/identity$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const st = S();
  const mfaCoverage = st.users.length ? Math.round(st.users.filter(x => x.mfa).length / st.users.length * 100) : 100;
  sendJson(res, 200, {
    ...sec.identity,
    sessions: sec.sessions,
    mfaCoverage,
    activePlatformSessions: Object.keys(st.sessions).length,
    dormantAccountNames: ['observer.legacy.01', 'support.legacy.02', 'temp.analyst.03'],
  });
});
route('POST', /^\/api\/sentinel\/sessions\/([^/]+)\/terminate$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const s = sec.sessions.find(x => x.id === m[1]);
  if (!s) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const r = sentinel.requestAction(u, 'DISABLE_SESSION', m[1], 'Session terminated by security operator');
  if (r.error) return sendJson(res, 403, r);
  s.active = false; s.terminatedAt = S().meta.simNow || Date.now();
  audit(u, 'SECURITY_SESSION_TERMINATED', 'session', m[1], `${s.user} (${s.role})`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, session: s });
});

// ---- network + TLS (§40/41) ----
route('GET', /^\/api\/sentinel\/network$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, sec.network);
});

// ---- secrets (§42/43) ----
route('GET', /^\/api\/sentinel\/secrets$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { secrets: sec.secrets, leaks: sec.secretLeaks });
});
route('POST', /^\/api\/sentinel\/secrets\/([^/]+)\/action$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const s = sec.secrets.find(x => x.id === m[1] || x.ref === m[1]);
  if (!s) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const action = String(body.action || '');
  if (action === 'rotate') return sendJson(res, 200, sentinel.requestAction(u, 'ROTATE_CREDENTIAL', s.ref, s.ref));
  if (action === 'revoke') return sendJson(res, 200, sentinel.requestAction(u, 'REVOKE_CREDENTIAL', s.ref, s.ref));
  if (action === 'reissue') {
    s.rotatedAt = S().meta.simNow || Date.now();
    s.nextRotation = (S().meta.simNow || Date.now()) + 30 * 24 * 3600 * 1000;
    audit(u, 'SECURITY_SECRET_REISSUED', 'secret', s.ref, 'Reissued replacement credential', req);
    set(() => {});
    return sendJson(res, 200, { ok: true, secret: s });
  }
  sendJson(res, 400, { error: 'INVALID_ACTION' });
});

// ---- central security log (§44/45) ----
route('GET', /^\/api\/sentinel\/logs$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const severity = url.searchParams.get('severity');
  const category = url.searchParams.get('category');
  const rows = [...sec.auditSec.map(e => ({ id: e.id, kind: 'AUDIT', who: e.who, what: e.what, when: e.at, target: e.target, approval: e.approval, result: e.result, severity: 'N/A', category: 'AUDIT' })),
    ...sec.events.map(e => ({ id: e.id, kind: 'EVENT', who: 'SENTINEL', what: e.title, when: e.createdAt, target: e.source, approval: '—', result: '—', severity: e.severity, category: e.category }))];
  let out = rows;
  if (q) out = out.filter(r => (r.what + ' ' + r.target + ' ' + r.who).toLowerCase().includes(q));
  if (severity) out = out.filter(r => r.severity === severity);
  if (category) out = out.filter(r => r.category === category);
  out.sort((a, b) => (b.when || 0) - (a.when || 0));
  sendJson(res, 200, { rows: out.slice(0, 400), total: out.length });
});
route('GET', /^\/api\/sentinel\/logs\/export$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const lines = ['kind,who,what,when,target,severity,category,approval,result'];
  for (const e of sec.auditSec) lines.push(['AUDIT', e.who, e.what, fmtWat(e.at), e.target, 'N/A', 'AUDIT', e.approval, e.result].map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','));
  for (const e of sec.events.slice(0, 200)) lines.push(['EVENT', 'SENTINEL', e.title, fmtWat(e.createdAt), e.source, e.severity, e.category, '—', '—'].map(x => `"${String(x ?? '').replace(/"/g, '""')}"`).join(','));
  sendBuffer(res, 200, Buffer.from(lines.join('\n')), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="sentinel-security-log.csv"' });
});
route('POST', /^\/api\/sentinel\/logs\/create-case$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const src = sec.events.find(e => e.id === body.eventId) || sec.auditSec.find(e => e.id === body.eventId);
  if (!src) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const cse = {
    id: util.uuid(), code: nextCode(S(), 'secCase'),
    title: src.title || src.what || 'Case from log entry',
    category: src.category === 'AUDIT' ? 'INFRASTRUCTURE' : src.category,
    severity: ['HIGH', 'CRITICAL'].includes(src.severity) ? src.severity : 'MEDIUM',
    status: 'DETECTED', affectedService: src.source || src.target || 'N/A',
    detectedAt: src.createdAt || src.at, createdAt: S().meta.simNow || Date.now(), analyst: null,
    source: 'LOG CENTRE', evidence: [], timeline: [{ at: S().meta.simNow || Date.now(), step: 'DETECTED', note: `Case created from log entry by ${u.name}` }],
    relatedEvents: [], actions: [], comms: [], recovery: null,
  };
  sec.incidents.unshift(cse);
  audit(u, 'SECURITY_CASE_CREATED', 'secCase', cse.code, cse.title, req);
  set(() => {});
  sendJson(res, 200, { ok: true, case: secShortInc(cse) });
});

// ---- automation (§46) ----
route('GET', /^\/api\/sentinel\/automation$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { rules: sec.automation, auditTail: sec.auditSec.filter(e => e.who === 'AUTOMATION').slice(0, 20) });
});
route('POST', /^\/api\/sentinel\/automation\/([^/]+)\/toggle$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  const sec = sentinel.cfg();
  const rule = sec.automation.find(r => r.id === m[1]);
  if (!rule) return sendJson(res, 404, { error: 'NOT_FOUND' });
  rule.enabled = !rule.enabled;
  audit(u, 'SECURITY_RULE_TOGGLE', 'automation', rule.id, `${rule.name} → ${rule.enabled ? 'ENABLED' : 'DISABLED'}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, rule });
});

// ---- action centre (§47/49/50/16) ----
route('GET', /^\/api\/sentinel\/action-catalog$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  sendJson(res, 200, { catalog: sentinel.ACTION_CATALOG });
});
route('GET', /^\/api\/sentinel\/actions$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { rows: sec.actions.slice(0, 200), pending: sec.actions.filter(a => ['REQUESTED', 'PENDING_DUAL'].includes(a.status)).length });
});
route('POST', /^\/api\/sentinel\/actions\/request$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const r = sentinel.requestAction(u, String(body.action || ''), String(body.target || ''), String(body.detail || ''));
  if (r.error) return sendJson(res, r.error === 'FORBIDDEN' ? 403 : 400, r);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/sentinel\/actions\/([^/]+)\/approve$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  const r = sentinel.approveAction(u, m[1], String(body.note || ''));
  if (r.error) return sendJson(res, r.error === 'FORBIDDEN' ? 403 : 400, r);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/sentinel\/actions\/([^/]+)\/reject$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  const r = sentinel.rejectAction(u, m[1], String(body.note || ''));
  if (r.error) return sendJson(res, r.error === 'FORBIDDEN' ? 403 : 400, r);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/sentinel\/actions\/([^/]+)\/execute$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const r = sentinel.executeAction(u, m[1]);
  if (r.error) return sendJson(res, 400, r);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/sentinel\/actions\/([^/]+)\/rollback$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  const r = sentinel.rollbackAction(u, m[1]);
  if (r.error) return sendJson(res, 400, r);
  sendJson(res, 200, r);
});

// ---- break-glass (§48) ----
route('POST', /^\/api\/sentinel\/breakglass\/open$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const reason = String(body.reason || '').trim();
  if (reason.length < 10) return sendJson(res, 400, { error: 'REASON_REQUIRED', message: 'A clear reason (min 10 characters) is mandatory for emergency access.' });
  const r = sentinel.openBreakGlass(u, reason, String(body.incidentId || 'none'), body.minutes || 30);
  sendJson(res, 200, r);
});
route('POST', /^\/api\/sentinel\/breakglass\/close$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const r = sentinel.closeBreakGlass(u, String(body.id || ''));
  if (r.error) return sendJson(res, 404, r);
  sendJson(res, 200, r);
});

// ---- playbooks (§51) ----
route('GET', /^\/api\/sentinel\/playbooks$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  sendJson(res, 200, { playbooks: sentinel.PLAYBOOKS });
});
route('POST', /^\/api\/sentinel\/playbooks\/([^/]+)\/activate$/, (req, res, body, m) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const pb = sentinel.PLAYBOOKS.find(p => p.id === m[1]);
  if (!pb) return sendJson(res, 404, { error: 'NOT_FOUND' });
  const sec = sentinel.cfg();
  const now = S().meta.simNow || Date.now();
  const cse = {
    id: util.uuid(), code: nextCode(S(), 'secCase'),
    title: `Playbook: ${pb.name}`, category: 'INFRASTRUCTURE', severity: 'MEDIUM', status: 'ASSIGNED',
    affectedService: String(body.target || 'TBD'), detectedAt: now, createdAt: now, analyst: u.name,
    source: 'RESPONSE PLAYBOOK',
    evidence: [], timeline: [{ at: now, step: 'ASSIGNED', note: `Playbook "${pb.name}" activated by ${u.name}` }, ...pb.steps.slice(0, 4).map((s, i) => ({ at: now + (i + 1) * 60000, step: 'INVESTIGATING', note: `Runbook step ${i + 1}: ${s}` }))],
    relatedEvents: [], actions: [], comms: [], recovery: null,
  };
  sec.incidents.unshift(cse);
  audit(u, 'SECURITY_PLAYBOOK_ACTIVATED', 'playbook', pb.id, `${pb.name} → case ${cse.code}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, case: secShortInc(cse), steps: pb.steps });
});

// ---- analytics (§55) ----
route('GET', /^\/api\/sentinel\/analytics$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const now = S().meta.simNow || Date.now();
  const hourMs = 3600 * 1000;
  const threatsByHour = [];
  const alertsBySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFORMATIONAL: 0 };
  for (const a of sec.alerts) alertsBySeverity[a.severity] = (alertsBySeverity[a.severity] || 0) + 1;
  for (let h = 23; h >= 0; h--) {
    const from = now - h * hourMs;
    threatsByHour.push({ at: from, label: fmtWat(from).split(' ')[1].slice(0, 5), threats: sec.events.filter(e => e.createdAt >= from - hourMs && e.createdAt < from + hourMs && ['HIGH', 'CRITICAL'].includes(e.severity)).length, events: sec.events.filter(e => e.createdAt >= from - hourMs && e.createdAt < from + hourMs).length });
  }
  const closed = sec.incidents.filter(i => i.status === 'CLOSED');
  const mttd = closed.length ? Math.round(closed.reduce((a, c) => a + (c.timeline[1] ? c.timeline[1].at - c.detectedAt : 0), 0) / closed.length / 60000) : 7;
  const mtta = closed.length ? Math.round(closed.reduce((a, c) => { const t = c.timeline.find(x => x.step === 'ASSIGNED'); return a + (t ? t.at - c.detectedAt : 0); }, 0) / closed.length / 60000) : 12;
  const mttc = closed.length ? Math.round(closed.reduce((a, c) => { const t = c.timeline.find(x => x.step === 'CONTAINMENT'); return a + (t ? t.at - c.detectedAt : 0); }, 0) / closed.length / 60000) : 30;
  const mttr = closed.length ? Math.round(closed.reduce((a, c) => { const t = c.timeline.find(x => x.step === 'RECOVERY'); return a + (t ? t.at - c.detectedAt : 0); }, 0) / closed.length / 60000) : 55;
  sendJson(res, 200, {
    threatsByHour,
    alertsBySeverity,
    vulnsBySeverity: { CRITICAL: sec.scanTotals.critical, HIGH: sec.scanTotals.high, MEDIUM: sec.scanTotals.medium, LOW: sec.scanTotals.low, PATCHED: sec.scanTotals.patched },
    apiErrors: sec.apis.map(a => ({ id: a.id, errors: a.errors, errorRate: a.errorRate })),
    authFailures: sec.identity.series.slice(-24),
    blockedTraffic: sec.public.wafCategories.map(c => ({ label: c.label, value: c.value })),
    nodeAvailability: sec.nodes.map(n => ({ id: n.id, availability: n.availability, status: n.status })),
    incidentsByStatus: sentinel.CASE_FLOW.map(s => ({ status: s, count: sec.incidents.filter(i => i.status === s).length })),
    kpis: { mttd, mtta, mttc, mttr, patchCompliance: Math.round(sec.scanTotals.patched / sec.scanTotals.total * 100), mfaCoverage: S().users.length ? Math.round(S().users.filter(x => x.mfa).length / S().users.length * 100) : 100, backupSuccess: sec.backup.backupSuccess, critVulnAgeHrs: Math.round((now - Math.min(...sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN').map(v => v.detectedAt), now)) / hourMs) || 0 },
  });
});

// ---- KPIs (§56) ----
route('GET', /^\/api\/sentinel\/kpis$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const now = S().meta.simNow || Date.now();
  const closed = sec.incidents.filter(i => i.status === 'CLOSED');
  const calc = (step) => closed.length ? Math.round(closed.reduce((a, c) => { const t = c.timeline.find(x => x.step === step); return a + (t ? t.at - c.detectedAt : 0); }, 0) / closed.length / 60000) : null;
  const critVulns = sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN');
  const critAgeHrs = critVulns.length ? Math.round((now - Math.min(...critVulns.map(v => v.detectedAt))) / 3600000) : 0;
  sendJson(res, 200, {
    mttd: { label: 'Mean Time to Detect', value: calc('TRIAGED') ?? 7, unit: 'min' },
    mtta: { label: 'Mean Time to Acknowledge', value: calc('ASSIGNED') ?? 12, unit: 'min' },
    mttc: { label: 'Mean Time to Contain', value: calc('CONTAINMENT') ?? 30, unit: 'min' },
    mttr: { label: 'Mean Time to Recover', value: calc('RECOVERY') ?? 55, unit: 'min' },
    patchCompliance: { label: 'Patch Compliance', value: Math.round(sec.scanTotals.patched / sec.scanTotals.total * 100), unit: '%' },
    mfaCoverage: { label: 'MFA Coverage', value: S().users.length ? Math.round(S().users.filter(x => x.mfa).length / S().users.length * 100) : 100, unit: '%' },
    backupSuccess: { label: 'Backup Success', value: sec.backup.backupSuccess, unit: '%' },
    critVulnAge: { label: 'Critical Vulnerability Age', value: critAgeHrs, unit: 'h' },
  });
});

// ---- compliance (§57) ----
route('GET', /^\/api\/sentinel\/compliance$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  sendJson(res, 200, { controls: sentinel.COMPLIANCE_CONTROLS });
});

// ---- risk register (§58) ----
route('GET', /^\/api\/sentinel\/risk$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { rows: sec.risks });
});
route('POST', /^\/api\/sentinel\/risk$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const sec = sentinel.cfg();
  const risk = String(body.risk || '').trim();
  if (!risk) return sendJson(res, 400, { error: 'EMPTY' });
  const prob = ['LOW', 'MEDIUM', 'HIGH'].includes(String(body.probability).toUpperCase()) ? String(body.probability).toUpperCase() : 'MEDIUM';
  const imp = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(body.impact).toUpperCase()) ? String(body.impact).toUpperCase() : 'MEDIUM';
  const pv = { LOW: 2, MEDIUM: 4, HIGH: 5 }, iv = { LOW: 2, MEDIUM: 4, HIGH: 5, CRITICAL: 6 };
  const row = { id: util.uuid(), risk, asset: String(body.asset || 'UNSPECIFIED'), probability: prob, impact: imp, score: pv[prob] * iv[imp], owner: String(body.owner || u.name), treatment: ['MITIGATE', 'TRANSFER', 'ACCEPT', 'AVOID'].includes(String(body.treatment).toUpperCase()) ? String(body.treatment).toUpperCase() : 'MITIGATE', addedBy: u.name };
  sec.risks.push(row);
  audit(u, 'SECURITY_RISK_ADDED', 'risk', row.id, `${risk} (score ${row.score})`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, row });
});

// ---- executive view (§59) ----
route('GET', /^\/api\/sentinel\/executive$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const posture = sentinel.posture(sec);
  const open = sec.incidents.filter(i => i.status !== 'CLOSED');
  const now = S().meta.simNow || Date.now();
  const attention = [];
  if (sec.evidence.integrity === 'BREACHED') attention.push({ sev: 'CRITICAL', item: 'Evidence integrity breach — record frozen, snapshot preserved', link: 'evidence' });
  for (const c of open.filter(i => i.severity === 'CRITICAL')) attention.push({ sev: 'CRITICAL', item: `${c.code} — ${c.title} (${c.status})`, link: 'incidents' });
  for (const v of sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN' && v.deadline < now)) attention.push({ sev: 'HIGH', item: `Overdue CRITICAL patch: ${v.cve} on ${v.asset}`, link: 'vulns' });
  for (const t of sec.network.tls.filter(t => t.status === 'EXPIRING_SOON')) attention.push({ sev: 'HIGH', item: `TLS certificate expiring in 14 days: ${t.domain}`, link: 'network' });
  for (const n of sec.nodes.filter(n => ['CRITICAL', 'ISOLATED', 'BLOCKED'].includes(n.status))) attention.push({ sev: 'HIGH', item: `${n.id} ${n.hostname} — ${n.status}`, link: 'nodes' });
  if (sec.identity.failedLogins >= 30) attention.push({ sev: 'MEDIUM', item: `Authentication failures elevated: ${sec.identity.failedLogins}`, link: 'identity' });
  sendJson(res, 200, {
    posture,
    cards: {
      activeThreats: sec.threatIntel.filter(t => ['ACTIVE', 'UNDER_INVESTIGATION'].includes(t.status)).length,
      criticalVulns: sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN').length,
      systemAvailability: Math.round(sec.apis.reduce((a, x) => a + x.availability, 0) / sec.apis.length * 10) / 10,
      evidenceIntegrity: sec.evidence.integrity,
      apiHealth: Math.round(sec.apis.filter(a => a.status === 'HEALTHY').length / sec.apis.length * 10000) / 100,
      securityIncidents: open.length,
      backupHealth: sec.backup.integrity,
    },
    attention: attention.slice(0, 5),
    threatLevel: sec.threatLevel,
  });
});

// ---- security timeline (§60) ----
route('GET', /^\/api\/sentinel\/timeline$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const url = new URL(req.url, 'http://x');
  const filter = url.searchParams.get('filter');
  const rows = [
    ...sec.events.map(e => ({ kind: 'EVENT', category: e.category, severity: e.severity, title: e.title, at: e.createdAt, target: e.source })),
    ...sec.incidents.map(c => ({ kind: 'INCIDENT', category: c.category, severity: c.severity, title: `${c.code} ${c.title}`, at: c.detectedAt, target: c.affectedService })),
    ...sec.vulns.map(v => ({ kind: 'VULNERABILITY', category: 'VULNERABILITY', severity: v.severity, title: `${v.cve} on ${v.asset}`, at: v.detectedAt, target: v.asset })),
    ...sec.drift.map(d => ({ kind: 'INFRASTRUCTURE', category: 'CONFIGURATION', severity: 'MEDIUM', title: `CONFIGURATION CHANGE: ${d.target}`, at: d.when, target: d.target })),
    ...sec.auditSec.filter(e => /ACTION|BREAK_GLASS/.test(e.what)).map(e => ({ kind: 'AUDIT', category: 'AUDIT', severity: 'MEDIUM', title: `${e.what} by ${e.who}`, at: e.at, target: e.target })),
  ];
  let out = rows;
  if (filter && filter !== 'ALL') out = rows.filter(r => {
    if (filter === 'THREATS') return r.kind === 'EVENT' && ['HIGH', 'CRITICAL'].includes(r.severity);
    if (filter === 'INCIDENTS') return r.kind === 'INCIDENT';
    if (filter === 'VULNERABILITIES') return r.kind === 'VULNERABILITY';
    if (filter === 'INFRASTRUCTURE') return r.kind === 'INFRASTRUCTURE';
    if (filter === 'API') return r.kind === 'EVENT' && r.category === 'API';
    if (filter === 'IDENTITY') return r.kind === 'EVENT' && r.category === 'IDENTITY';
    if (filter === 'EVIDENCE') return r.kind === 'EVENT' && r.category === 'EVIDENCE';
    return true;
  });
  out.sort((a, b) => (b.at || 0) - (a.at || 0));
  sendJson(res, 200, { rows: out.slice(0, 300) });
});

// ---- application coverage (§65) ----
route('GET', /^\/api\/sentinel\/apps$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { rows: sec.appCoverage, surface: sec.attackSurface });
});

// ---- immutable audit (§68) ----
route('GET', /^\/api\/sentinel\/audit$/, (req, res) => {
  const u = secUser(req, res, 'security.audit');
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, { rows: sec.auditSec.slice(0, 300), total: sec.auditSec.length, immutable: true, note: 'Append-only security audit — entries are never modified or deleted.' });
});

// ---- election-day defence mode (§69) ----
route('POST', /^\/api\/sentinel\/election-mode$/, (req, res, body) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  const sec = sentinel.cfg();
  const before = sec.electionDay;
  sec.electionDay = body.enabled !== false;
  audit(u, 'SECURITY_ELECTION_MODE', 'config', 'election-day-defence', `${before} → ${sec.electionDay}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, electionDay: sec.electionDay, priorities: sec.electionPriorities });
});

// ---- analyst threat-level override (§5) ----
route('POST', /^\/api\/sentinel\/threat-level$/, (req, res, body) => {
  const u = secUser(req, res, 'security.privileged');
  if (!u) return;
  const sec = sentinel.cfg();
  const level = String(body.level || '').toUpperCase();
  if (!['NORMAL', 'GUARDED', 'ELEVATED', 'HIGH', 'CRITICAL'].includes(level)) return sendJson(res, 400, { error: 'INVALID_LEVEL' });
  const reason = String(body.reason || '').trim();
  sec.threatOverrides.push({ level, reason, user: u.name, at: S().meta.simNow || Date.now() });
  sentinel.computeThreatLevel(sec);
  audit(u, 'SECURITY_THREAT_OVERRIDE', 'config', 'threat-level', `${level} — ${reason}`, req);
  set(() => {});
  sendJson(res, 200, { ok: true, threatLevel: sec.threatLevel, basis: sec.threatBasis });
});

// ---- recovery centre (§72) ----
route('GET', /^\/api\/sentinel\/recovery$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  sendJson(res, 200, sec.backup);
});
route('POST', /^\/api\/sentinel\/recovery\/action$/, (req, res, body) => {
  const u = secUser(req, res, 'security.respond');
  if (!u) return;
  const action = String(body.action || '');
  if (action === 'verify') return sendJson(res, 200, sentinel.requestAction(u, 'VERIFY_BACKUP', 'BACKUP-ARCHIVE', 'Verify backup integrity'));
  if (action === 'recovery') return sendJson(res, 200, sentinel.requestAction(u, 'START_RECOVERY', 'RECOVERY-RUNBOOK', 'Start recovery procedure'));
  if (action === 'failover') return sendJson(res, 200, sentinel.requestAction(u, 'FAILOVER_DR', 'DR-SITE-01', 'Disaster-recovery failover'));
  sendJson(res, 400, { error: 'INVALID_ACTION' });
});

// ---- command wall (§63/70) ----
route('GET', /^\/api\/sentinel\/wall$/, (req, res) => {
  const u = secUser(req, res);
  if (!u) return;
  const sec = sentinel.cfg();
  const st = S();
  const open = sec.incidents.filter(i => i.status !== 'CLOSED');
  sendJson(res, 200, {
    systemSecurity: 'PROTECTED',
    threatLevel: sec.threatLevel,
    nodes: Math.round(sec.nodes.filter(n => ['HEALTHY', 'STANDBY'].includes(n.status)).length / sec.nodes.length * 1000) / 10,
    api: Math.round(sec.apis.filter(a => a.status === 'HEALTHY').length / sec.apis.length * 10000) / 100,
    activeIncidents: String(open.length).padStart(2, '0'),
    criticalVulns: String(sec.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN').length).padStart(2, '0'),
    evidenceIntegrity: sec.evidence.integrity === 'INTACT' ? '100%' : 'BREACH',
    publicPlatform: sec.public.availability > 99 ? 'ONLINE' : 'DEGRADED',
    irevWatchtower: sec.irev.connector === 'ONLINE' ? 'ONLINE' : 'ISSUES',
    db: sec.db.availability > 99 ? 'ONLINE' : 'DEGRADED',
    electionDay: sec.electionDay, priorities: sec.electionPriorities,
    criticalAlerts: sec.alerts.filter(a => a.status === 'OPEN' && a.severity === 'CRITICAL').slice(0, 8),
    eventTicker: sec.events.slice(0, 12),
    footer: { nodes: sec.nodes.map(n => ({ id: n.id, status: n.status })), apis: sec.apis.map(a => ({ id: a.id, status: a.status })) },
    now: st.meta.simNow,
  });
});

// ---- SENTINEL copilot (§61/62) ----
route('POST', /^\/api\/sentinel\/copilot$/, (req, res, body) => {
  const u = secUser(req, res, 'copilot.use');
  if (!u) return;
  audit(u, 'SENTINEL_COPILOT_QUERY', 'sentinel', null, String(body.q || '').slice(0, 200), req);
  sendJson(res, 200, sentinel.copilot(body.q, u));
});

// --- static files ---
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(file)) file += '.html';
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, b2) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b2);
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    const cacheControl = (IS_SERVERLESS && pathname.startsWith('/assets/')) ? 'public, max-age=300' : 'no-store';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cacheControl });
    res.end(buf);
  });
}

// ---------------- request handler (shared by long-running mode and Vercel serverless) ----------------
async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  // SSE — persistent connections do not exist in serverless deployments
  if (pathname === '/api/events' && req.method === 'GET') {
    if (IS_SERVERLESS) { res.writeHead(501, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'SSE_DISABLED', message: 'Realtime stream is disabled in the serverless demo — all data is fetched on demand.' })); }
    const token = url.searchParams.get('token') || '';
    const user = token ? auth.currentUser({ headers: { authorization: `Bearer ${token}` } }) : null;
    if (!user) { res.writeHead(401); return res.end('unauthorized'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    const cid = util.uuid();
    sseClients.set(cid, res);
    res.write(`data: ${JSON.stringify({ kind: 'hello', simNow: S().meta.simNow })}\n\n`);
    const hb = setInterval(() => { try { res.write(':hb\n\n'); } catch (e) { clearInterval(hb); sseClients.delete(cid); } }, 25000);
    req.on('close', () => { clearInterval(hb); sseClients.delete(cid); });
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (auth.rateLimit(req, res, { windowMs: 60000, max: 600 })) return sendJson(res, 429, { error: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' });
    let body = {};
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.pattern);
      if (m) {
        try {
          return r.handler(req, res, body, m);
        } catch (e) {
          console.error('route error', pathname, e);
          return sendJson(res, 500, { error: 'INTERNAL', message: e.message });
        }
      }
    }
    return sendJson(res, 404, { error: 'NOT_FOUND', message: `No route ${req.method} ${pathname}` });
  }
  serveStatic(req, res, pathname);
}

// ---------------- boot (shared by both modes — idempotent per process) ----------------
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  store.load();
  seedStatic();
  sim.buildPlan();
  if (!S().meta.simNow) {
    sim.applyScenario('RESULTS', []);
    console.log('[boot] fresh state → RESULTS scenario');
  } else {
    // keep persisted position; rebuild pointers and resume live sim
    sim.resume();
    console.log('[boot] resumed persisted state at', util.fmtWat(S().meta.simNow), 'scenario', S().meta.scenario);
  }
  irev.buildPlan();
  irev.backfill(S().meta.simNow);
  console.log('[boot] IReV Watchtower ready:', irev.cfg().observations.length, 'observations,', irev.cfg().cases.length, 'cases');
  sentinel.ensureInitialized();
  const secBoot = sentinel.cfg();
  console.log('[boot] SENTINEL SOC ready:', secBoot.nodes.length, 'nodes,', secBoot.apis.length, 'APIs,', secBoot.incidents.filter(i => i.status !== 'CLOSED').length, 'open cases,', secBoot.vulns.filter(v => v.severity === 'CRITICAL' && v.status === 'OPEN').length, 'CRITICAL vulns, threat level', secBoot.threatLevel);
}

// ---------------- long-running mode (local / Render / Railway / Fly) ----------------
if (require.main === module) {
  boot();
  const server = http.createServer(handleRequest);
  const simTimer = setInterval(() => {
    try { sim.tick(1000); irev.tick(S().meta.simNow); sentinel.tick(S().meta.simNow); } catch (e) { console.error('tick error', e); }
  }, 1000);
  process.on('SIGTERM', () => { clearInterval(simTimer); store.save(); process.exit(0); });
  process.on('SIGINT', () => { clearInterval(simTimer); store.save(); process.exit(0); });
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`NDC E-SITUATION ROOM 2027 — listening on 0.0.0.0:${PORT}`);
    console.log(`Simulation: ${S().meta.scenario} @ ${util.fmtWat(S().meta.simNow)} (speed ${S().meta.simSpeed}x)`);
  });
}

module.exports = { handleRequest, boot };
