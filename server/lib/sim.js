// sim.js — election-day simulation engine: deterministic plan, scenario backfill, live ticking
'use strict';
const { uuid, mulberry32, ri, pick, watEpoch, fmtWat, sha256 } = require('./util');
const { S, set, audit, notify, nextCode } = require('./store');
const { validateSubmission } = require('./validation');

let plan = null;                 // deterministic day plan
let pointers = null;             // live-tick pointers
let broadcast = null;            // set by server: (evt) => void
const ELECTION_DAY = [2027, 2, 27]; // 27 Feb 2027

const SCENARIOS = {
  MORNING: { label: 'Opening Phase', at: [8, 8], desc: 'Polling units opening, agents checking in' },
  VOTING: { label: 'Voting Phase', at: [11, 40], desc: 'Full voting in progress' },
  RESULTS: { label: 'Collation Phase', at: [16, 20], desc: 'Results arriving, verification queue active' },
  EVENING: { label: 'Evening Phase', at: [19, 5], desc: 'Most results in, disputes forming' },
  NIGHT: { label: 'Post-Election', at: [22, 10], desc: 'Duty completion & archival' },
};

function watTime(y, mo, d, h, mi) { return watEpoch(y, mo, d, h, mi); }
function dayStart() { return watTime(...ELECTION_DAY, 0, 0); }
function scenarioTime(name) { const s = SCENARIOS[name]; return watTime(...ELECTION_DAY, ...s.at); }

function phaseOf(simNow) {
  const day = ELECTION_DAY;
  const h = (new Date(simNow + 3600e3)).getUTCHours() + ((new Date(simNow + 3600e3)).getUTCMinutes()) / 60;
  if (simNow < watTime(day[0], day[1], day[2], 8, 0)) return 'PRE-OPENING';
  if (simNow < watTime(day[0], day[1], day[2], 14, 0)) return 'VOTING';
  if (simNow < watTime(day[0], day[1], day[2], 18, 0)) return 'COLLATION';
  return 'POST-ELECTION';
}

// ---------------- plan builder ----------------
function buildPlan() {
  const st = S();
  const rng = mulberry32(990227);
  const day = ELECTION_DAY;
  const puSchedule = {};   // puId -> schedule
  const incidentList = []; // {t, def}
  const sosList = [];
  const streamList = [];
  const lgaOutage = {};    // lgaId -> {start, end}

  // LGA connectivity outages (rural-heavy, spread across the day)
  for (const l of st.lgas) {
    const rural = l.senatorial !== 'Kano Central';
    if ((rural ? rng() : rng() * 2.4) < 0.45) {
      const start = watTime(day[0], day[1], day[2], 6, 0) + ri(rng, 0, 480) * 60000;
      const dur = ri(rng, 35, 160) * 60000;
      lgaOutage[l.id] = { start, end: start + dur };
    }
  }

  // district party strength (fictional)
  const strength = {
    'Kano Central': { pap: 0.30, pdc: 0.34, aud: 0.14, sdm: 0.12, ypp: 0.10 },
    'Kano North': { pap: 0.38, pdc: 0.26, aud: 0.16, sdm: 0.10, ypp: 0.10 },
    'Kano South': { pap: 0.33, pdc: 0.30, aud: 0.15, sdm: 0.12, ypp: 0.10 },
  };

  const registeredPool = [420, 510, 580, 640, 700, 760, 830, 900, 980, 1100, 1250, 1400];
  for (const pu of st.pus) {
    const idx = parseInt(pu.code.split('-')[1], 10) + parseInt(pu.code.split('-')[2], 10);
    const prng = mulberry32(idx * 7919 + 31);
    const open = watTime(day[0], day[1], day[2], 7, ri(prng, 40, 60)) + ri(prng, 0, 15) * 60000;
    const collate = watTime(day[0], day[1], day[2], 14, 30) + ri(prng, 0, 170) * 60000;
    const registered = pick(prng, registeredPool);
    const accredited = Math.round(registered * (0.52 + prng() * 0.24));
    const anomRoll = prng();
    let anomaly = null;
    if (anomRoll < 0.022) anomaly = { type: 'MATH_MISMATCH' };
    else if (anomRoll < 0.032) anomaly = { type: 'OCR_UNCERTAIN' };
    else if (anomRoll < 0.038) anomaly = { type: 'DUPLICATE_HASH' };
    else if (anomRoll < 0.044) anomaly = { type: 'ACCREDITATION_MISMATCH' };
    const shares = { ...strength[st.lgas.find(l => l.id === pu.lgaId)?.senatorial || 'Kano North'] };
    const rollPrng = mulberry32(parseInt(pu.code.replace(/\D/g, ''), 10) * 104729 + 137); // unique per-PU review-outcome rng
    puSchedule[pu.id] = {
      open, collate, registered, accredited, anomaly, shares,
      reviewDelay: ri(prng, 10, 65) * 60000,
      rejectRoll: rollPrng(), // <0.035 reject, <0.055 dispute (non-anomalous)
      dupHashOf: anomaly && anomaly.type === 'DUPLICATE_HASH' ? true : false,
      streamRoll: rollPrng(),
    };
  }

  // incident plan (~110 across the day)
  const INC = [
    { cat: 'SECURITY', sub: 'Violence', sev: 5, w: 0.5 }, { cat: 'SECURITY', sub: 'Threat', sev: 4, w: 0.8 },
    { cat: 'SECURITY', sub: 'Intimidation', sev: 4, w: 0.9 }, { cat: 'SECURITY', sub: 'Vandalism', sev: 3, w: 0.9 },
    { cat: 'SECURITY', sub: 'Security deployment concern', sev: 3, w: 0.8 },
    { cat: 'PROCESS', sub: 'Delayed opening', sev: 2, w: 1.4 }, { cat: 'PROCESS', sub: 'Missing materials', sev: 3, w: 1.2 },
    { cat: 'PROCESS', sub: 'Accreditation problem', sev: 2, w: 1.2 }, { cat: 'PROCESS', sub: 'Voting interruption', sev: 3, w: 0.8 },
    { cat: 'PROCESS', sub: 'Counting interruption', sev: 3, w: 0.6 }, { cat: 'PROCESS', sub: 'Result-sheet concern', sev: 3, w: 1.0 },
    { cat: 'TECHNOLOGY', sub: 'BVAS issue', sev: 2, w: 1.6 }, { cat: 'TECHNOLOGY', sub: 'Network outage', sev: 2, w: 1.1 },
    { cat: 'TECHNOLOGY', sub: 'Device failure', sev: 2, w: 0.9 }, { cat: 'TECHNOLOGY', sub: 'Communication failure', sev: 2, w: 0.8 },
    { cat: 'ACCESSIBILITY', sub: 'Accessibility issue', sev: 1, w: 0.8 }, { cat: 'ACCESSIBILITY', sub: 'Queue problem', sev: 1, w: 1.2 },
    { cat: 'OTHER', sub: 'General observation', sev: 1, w: 1.6 }, { cat: 'OTHER', sub: 'Environmental issue', sev: 1, w: 0.6 },
  ];
  const totW = INC.reduce((a, i) => a + i.w, 0);
  let t = watTime(day[0], day[1], day[2], 6, 40);
  while (t < watTime(day[0], day[1], day[2], 22, 0)) {
    t += ri(rng, 4, 22) * 60000;
    let roll = rng() * totW, def = INC[0];
    for (const i of INC) { roll -= i.w; if (roll <= 0) { def = i; break; } }
    const pu = pick(rng, st.pus);
    incidentList.push({ t, def: { ...def, puId: pu.id, wardId: pu.wardId, lgaId: pu.lgaId, agentId: st.agents.find(a => a.puId === pu.id)?.id || null } });
  }
  // guaranteed critical incidents around the collation window (so the RESULTS scenario always shows action)
  const critPus = [pick(rng, st.pus), pick(rng, st.pus)];
  incidentList.push({ t: watTime(day[0], day[1], day[2], 15, 40), def: { cat: 'SECURITY', sub: 'Violence', sev: 5, puId: critPus[0].id, wardId: critPus[0].wardId, lgaId: critPus[0].lgaId, agentId: st.agents.find(a => a.puId === critPus[0].id)?.id || null } });
  incidentList.push({ t: watTime(day[0], day[1], day[2], 16, 5), def: { cat: 'PROCESS', sub: 'Result-sheet concern', sev: 5, puId: critPus[1].id, wardId: critPus[1].wardId, lgaId: critPus[1].lgaId, agentId: st.agents.find(a => a.puId === critPus[1].id)?.id || null } });
  incidentList.sort((a, b) => a.t - b.t);

  // SOS plan (5 events)
  const sosTimes = [[9, 55], [12, 20], [15, 45], [17, 30], [20, 10]];
  for (const [h, m] of sosTimes) {
    const pu = pick(rng, st.pus);
    sosList.push({ t: watTime(day[0], day[1], day[2], h, m) + ri(rng, -8, 12) * 60000, def: { puId: pu.id, wardId: pu.wardId, lgaId: pu.lgaId, agentId: st.agents.find(a => a.puId === pu.id)?.id || null, category: pick(rng, ['THREAT', 'MEDICAL', 'SECURITY_BREACH', 'CROWD_CONTROL']) } });
  }
  sosList.sort((a, b) => a.t - b.t);

  // stream plan
  for (const a of st.agents) {
    const prng = mulberry32(parseInt(a.id.slice(3), 10) * 13 + 7);
    if (prng() < 0.055) {
      const start = watTime(day[0], day[1], day[2], 9, 0) + ri(prng, 0, 480) * 60000;
      streamList.push({ t: start, dur: ri(prng, 60, 220) * 60000, agentId: a.id });
    }
  }
  streamList.sort((a, b) => a.t - b.t);

  plan = { puSchedule, incidentList, sosList, streamList, lgaOutage };
  pointers = { incidents: 0, sos: 0, streams: 0, submitCursor: 0, sortedPus: null, heartbeats: {} };
  pointers.sortedPus = st.pus.map(p => p.id).sort((a, b) => plan.puSchedule[a].collate - plan.puSchedule[b].collate);
}

// ---------------- primitives (used by backfill AND live tick) ----------------
const REVIEWERS = () => S().users.filter(u => ['reviewer', 'supervisor'].includes(u.roleId));

function doCheckin(agent, simNow, evts) {
  const s = plan.puSchedule[agent.puId];
  if (!s) return;
  const open = s.open;
  if (simNow >= open - 60 * 60000 && agent.dutyState === 'NOT_ACTIVATED') {
    agent.dutyState = 'ACTIVATED'; agent.activatedAt = simNow;
    evts.push({ type: 'agent.activated', agentId: agent.id });
  }
  if (simNow >= open - 25 * 60000 && agent.dutyState === 'ACTIVATED') {
    agent.dutyState = 'ON_DUTY'; agent.checkedInAt = simNow; agent.online = true;
    agent.lastHeartbeat = simNow; agent.battery = 100;
    evts.push({ type: 'agent.online', agentId: agent.id, reason: 'checkin' });
    audit(null, 'AGENT_CHECK_IN', 'agent', agent.id, `Duty activated at ${agent.puId}`, null);
  }
  if (phaseOf(simNow) === 'VOTING' && agent.dutyState === 'ON_DUTY' && s.collate > simNow) {
    agent.dutyState = 'POLLING_MONITORING';
  }
}

function outageAt(simNow, agent) {
  const o = plan.lgaOutage[agent.lgaId];
  return o && simNow >= o.start && simNow < o.end;
}

function doHeartbeats(simNow, evts) {
  const st = S();
  for (const a of st.agents) {
    if (a.dutyState === 'NOT_ACTIVATED' || a.dutyState === 'DUTY_COMPLETED') continue;
    const off = outageAt(simNow, a);
    if (off && a.online) { a.online = false; evts.push({ type: 'agent.offline', agentId: a.id, reason: 'network' }); }
    else if (!off && !a.online && simNow >= plan.puSchedule[a.puId].open - 30 * 60000) {
      a.online = true; evts.push({ type: 'agent.online', agentId: a.id, reason: 'reconnect' });
    }
    if (a.online) {
      a.lastHeartbeat = simNow;
      a.battery = Math.max(8, a.battery - 0.02);
    }
  }
}

function doSubmit(simNow, evts) {
  const st = S();
  const agentByPu = {};
  for (const a of st.agents) agentByPu[a.puId] = a;
  for (const puId of pointers.sortedPus) {
    const s = plan.puSchedule[puId];
    if (s.collate > simNow) break;
    if (st.submissions.some(x => x.puId === puId && x.electionId === 'e-gov-2027')) continue;
    const agent = agentByPu[puId];
    if (!agent) continue; // vacant PU (reporting gap)
    if (outageAt(simNow, agent)) continue; // offline — will submit on reconnect
    submitForPu(puId, agent, simNow, evts, false);
  }
}

function submitForPu(puId, agent, simNow, evts, live) {
  const st = S();
  const s = plan.puSchedule[puId];
  const pu = st.pus.find(p => p.id === puId);
  const lga = st.lgas.find(l => l.id === pu.lgaId);
  const district = lga.senatorial;
  const elections = st.elections.filter(e => e.status === 'ACTIVE' && (e.level === 'STATE' || (e.level === 'SENATORIAL' && e.scope === district)));
  const prng = mulberry32(parseInt(pu.code.replace(/\D/g, ''), 10) * 97 + 13);
  const docHash = sha256('demo-doc:' + pu.code + ':' + simNow);

  for (const e of elections) {
    const cands = st.candidates.filter(c => c.electionId === e.id);
    const weights = cands.map(c => s.shares[c.partyId] || 0.1);
    const wSum = weights.reduce((a, b) => a + b, 0);
    const validBase = Math.round(s.accredited * 0.94);
    let valid = validBase;
    const votes = cands.map((c, i) => Math.round(validBase * weights[i] / wSum * (0.9 + prng() * 0.2)));
    const vSum = votes.reduce((a, b) => a + b, 0);
    const rejected = Math.round(s.accredited * (0.01 + prng() * 0.03));
    valid = vSum;
    const items = cands.map((c, i) => ({ candidateId: c.id, partyId: c.partyId, votes: votes[i] }));

    // anomaly injection
    let anomaly = s.anomaly;
    if (anomaly && anomaly.type === 'MATH_MISMATCH' && e.id === 'e-gov-2027') {
      items[0].votes += 7; // sum no longer matches valid
      anomaly = { type: 'MATH_MISMATCH' };
    } else if (anomaly && anomaly.type === 'ACCREDITATION_MISMATCH' && e.id === 'e-gov-2027') {
      anomaly = { type: 'ACCREDITATION_MISMATCH' };
    } else if (e.id !== 'e-gov-2027') {
      anomaly = null;
    }
    const ocrConf = items.map(() => +(88 + prng() * 11).toFixed(1));
    if (anomaly && anomaly.type === 'OCR_UNCERTAIN') ocrConf[0] = +(54 + prng() * 12).toFixed(1);

    const sub = {
      id: uuid(), code: nextCode(st, 'submission'), electionId: e.id, puId, wardId: pu.wardId, lgaId: pu.lgaId, senatorial: district,
      agentId: agent.id, status: 'UNVERIFIED',
      items, validVotes: vSum + (anomaly && anomaly.type === 'MATH_MISMATCH' ? 0 : 0), valid, rejected,
      accredited: s.accredited, registered: s.registered,
      totalBallots: vSum + rejected,
      ocr: { confidences: ocrConf, engine: 'NDC-OCR 3.2 (simulated)', processedAt: simNow },
      anomalies: [],
      submittedAt: simNow, receivedAt: simNow,
      verification: null, versions: [], custodies: [],
      evidenceIds: [],
      source: live ? 'LIVE' : 'SIM',
    };
    const vres = validateSubmission(sub);
    sub.anomalies = vres.flags;
    sub.validation = vres;
    if (vres.flags.length === 0) sub.status = 'SUBMITTED';
    else sub.status = 'SUBMITTED'; // anomalies flagged, still queued for review

    // evidence doc
    const ev = {
      id: uuid(), code: nextCode(st, 'evidence'), submissionId: sub.id, kind: 'EC8A', electionId: e.id,
      sha256: anomaly && anomaly.type === 'DUPLICATE_HASH' ? plan.puSchedule[puId].dupHashOf ? sha256('shared-doc-fingerprint') : sha256('shared-doc-fingerprint') : docHash,
      sizeBytes: 824000 + Math.round(prng() * 900000), pages: 2, mime: 'image/png',
      capturedAt: simNow - 4 * 60000, deviceId: agent.deviceId, agentId: agent.id,
      gps: agent.gps, uploadedAt: simNow,
      chain: [{ at: simNow - 4 * 60000, step: 'CAPTURED', by: agent.id }, { at: simNow, step: 'UPLOADED', by: agent.id }, { at: simNow + 500, step: 'RECEIVED', by: 'platform' }],
    };
    st.evidence.push(ev);
    sub.evidenceIds.push(ev.id);

    st.submissions.unshift(sub);
    sub.custodies.push({ at: simNow, step: 'SUBMITTED', by: agent.id });
    audit(null, 'RESULT_SUBMITTED', 'submission', sub.id, `${pu.code} • ${e.type} • status=${sub.status}`, null);
    evts.push({ type: 'result.submitted', submissionId: sub.id, puId, lgaId: pu.lgaId, electionId: e.id, anomalous: vres.flags.length > 0 });
    if (vres.flags.length > 0) {
      notify(['supervisor', 'reviewer', 'analyst'], 'Data anomaly flagged',
        `${pu.code}: ${vres.flags.map(f => f.code).join(', ')} — Requires Human Review`, { priority: 'MEDIUM', link: `/supervisor` });
    }
    if (agent) { agent.dutyState = 'RESULT_SUBMITTED'; agent.submittedAt = simNow; }
  }
}

function doReviews(simNow, evts) {
  const st = S();
  const reviewers = REVIEWERS();
  if (reviewers.length === 0) return;
  let ri2 = 0;
  for (const sub of st.submissions) {
    if (sub.status !== 'SUBMITTED') continue;
    const s = plan.puSchedule[sub.puId];
    const due = sub.submittedAt + (s ? s.reviewDelay : 30 * 60000);
    if (simNow < due) continue;
    if (!s) continue;
    const reviewer = reviewers[ri2++ % reviewers.length];
    const anom = (sub.anomalies || []).length > 0;
    const roll = s.rejectRoll + (anom ? 0.25 : 0);
    let action = 'APPROVE';
    let reason = '';
    if (!anom && roll < 0.035) { action = 'REJECT'; reason = pick(mulberry32(5), ['Illegible document', 'Figures inconsistent with attached EC8A', 'Missing page 2 of result sheet']); }
    else if (!anom && roll < 0.055) { action = 'DISPUTE'; reason = 'Discrepancy raised by party agents at the polling unit'; }
    else if (anom && roll < 0.55) { action = 'APPROVE'; reason = 'Anomaly reviewed and resolved — transcription error confirmed and figures reconciled.'; }
    const needsSecond = anom && mulberry32(19)() < 0.45;
    applyReview(sub, reviewer, action, reason, simNow, evts, needsSecond);
  }
  // dual-control completion: a DIFFERENT reviewer confirms after a delay
  const secondDelay = 25 * 60000;
  for (const sub of st.submissions) {
    if (sub.status !== 'UNDER_REVIEW' || !sub.review || !sub.review.requiresSecond) continue;
    if (simNow < sub.review.at + secondDelay) continue;
    const reviewer = reviewers.find(r => r.id !== sub.review.reviewerId) || reviewers[0];
    sub.review.secondReviewerId = reviewer.id; sub.review.secondAt = simNow; sub.review.secondAction = 'CONFIRM';
    sub.review.requiresSecond = false;
    sub.review.action = 'APPROVE';
    finalizeReview(sub, sub.review, simNow, evts);
  }
}

function applyReview(sub, reviewer, action, reason, simNow, evts, needsSecond = false) {
  const st = S();
  sub.status = 'UNDER_REVIEW';
  const review = {
    id: uuid(), submissionId: sub.id, reviewerId: reviewer.id, reviewerName: reviewer.name,
    action, reason, at: simNow, secondReviewerId: null, secondAt: null,
  };
  sub.review = review;
  sub.custodies.push({ at: simNow, step: 'REVIEWED', by: reviewer.id, note: action });
  st.reviews.unshift(review);

  if (needsSecond) {
    review.requiresSecond = true;
    notify(['supervisor'], 'Second review required', `${sub.puId} — dual-control verification needed`, { priority: 'HIGH', link: `/supervisor?sub=${sub.id}` });
    return; // stays UNDER_REVIEW until second reviewer confirms (live user can act)
  }

  finalizeReview(sub, review, simNow, evts);
}

function finalizeReview(sub, review, simNow, evts) {
  const st = S();
  const agent = st.agents.find(a => a.id === sub.agentId);
  if (review.action === 'APPROVE') {
    sub.status = 'VERIFIED';
    sub.verifiedAt = simNow;
    sub.custodies.push({ at: simNow, step: 'VERIFIED', by: review.reviewerId });
    st.publicReleases.unshift({ id: uuid(), submissionId: sub.id, electionId: sub.electionId, releasedAt: simNow, releasedBy: 'verification-flow' });
    if (agent) { agent.dutyState = agent.dutyState === 'RESULT_SUBMITTED' ? 'UNDER_REVIEW' : agent.dutyState; }
    evts.push({ type: 'result.verified', submissionId: sub.id, puId: sub.puId, lgaId: sub.lgaId, electionId: sub.electionId });
  } else if (review.action === 'REJECT') {
    sub.status = 'REJECTED';
    sub.rejectedAt = simNow;
    sub.custodies.push({ at: simNow, step: 'REJECTED', by: review.reviewerId });
    if (agent) { agent.dutyState = 'REJECTED'; notify(null, 'Submission rejected', `${sub.puId}: ${review.reason}`, { userId: agent.userId, priority: 'HIGH', link: '/agent' }); }
    evts.push({ type: 'result.rejected', submissionId: sub.id, puId: sub.puId, lgaId: sub.lgaId, electionId: sub.electionId });
  } else if (review.action === 'DISPUTE') {
    sub.status = 'DISPUTED';
    sub.custodies.push({ at: simNow, step: 'DISPUTED', by: review.reviewerId });
    st.disputes.unshift({ id: uuid(), submissionId: sub.id, reason: review.reason, status: 'OPEN', createdBy: review.reviewerId, createdAt: simNow, resolution: null });
    evts.push({ type: 'result.disputed', submissionId: sub.id, puId: sub.puId });
  }
  audit(null, `RESULT_${review.action}`, 'submission', sub.id, `${sub.puId} by ${review.reviewerName}${review.reason ? ' — ' + review.reason : ''}`, null);
  // notify agent on approval
  if (review.action === 'APPROVE' && agent && agent.userId) {
    notify(null, 'Result verified', `Your submission for ${sub.puId} has been verified.`, { userId: agent.userId, priority: 'LOW', link: '/agent' });
  }
}

function doIncidents(simNow, evts) {
  const st = S();
  while (pointers.incidents < plan.incidentList.length && plan.incidentList[pointers.incidents].t <= simNow) {
    const { t, def } = plan.incidentList[pointers.incidents++];
    if (st.incidents.some(i => i.planT === t)) continue;
    const pu = st.pus.find(p => p.id === def.puId);
    const inc = {
      id: uuid(), code: nextCode(st, 'incident'),
      category: def.cat, subcategory: def.sub, severity: def.sev, level: `LEVEL ${def.sev}`,
      puId: def.puId, wardId: def.wardId, lgaId: def.lgaId,
      gps: pu ? { lat: pu.lat, lon: pu.lon } : null,
      reporterId: def.agentId, description: describeIncident(def, pu),
      status: 'NEW', createdAt: t, updatedAt: t, updates: [{ at: t, status: 'NEW', by: def.agentId || 'system', note: 'Incident reported by field agent' }],
      mediaIds: [], planT: t,
    };
    st.incidents.unshift(inc);
    audit(null, 'INCIDENT_CREATED', 'incident', inc.id, `${inc.code} ${def.cat}/${def.sub} L${def.sev}`, null);
    evts.push({ type: 'incident.created', incidentId: inc.id, severity: def.sev, lgaId: def.lgaId });
    if (def.sev >= 4) {
      notify(['director', 'operator', 'sencoord', 'lgcoord', 'incident'], `Level ${def.sev} incident — ${def.sub}`,
        `${inc.code} at ${pu ? pu.name : ''}, ${st.lgas.find(l => l.id === def.lgaId)?.name} LGA`, { priority: def.sev === 5 ? 'CRITICAL' : 'HIGH', link: `/central?tab=incidents` });
    }
  }
  // advance statuses deterministically by age
  const ackDelay = 8 * 60000, resDelay = 95 * 60000, escDelay = 50 * 60000;
  for (const inc of st.incidents) {
    const age = simNow - inc.createdAt;
    if (inc.status === 'NEW' && age > ackDelay) {
      inc.status = 'ACKNOWLEDGED'; inc.updatedAt = inc.createdAt + ackDelay;
      inc.updates.push({ at: inc.updatedAt, status: 'ACKNOWLEDGED', by: 'lgcoord', note: 'Acknowledged by LG Situation Room' });
    }
    if (inc.status === 'ACKNOWLEDGED' && inc.severity >= 4 && age > escDelay) {
      inc.status = 'ESCALATED'; inc.updatedAt = inc.createdAt + escDelay;
      inc.updates.push({ at: inc.updatedAt, status: 'ESCALATED', by: 'sencoord', note: 'Escalated to Senatorial & Central Situation Room' });
    }
    if ((inc.status === 'ACKNOWLEDGED' || inc.status === 'ESCALATED' || inc.status === 'INVESTIGATING') && age > resDelay) {
      inc.status = 'RESOLVED'; inc.updatedAt = inc.createdAt + resDelay;
      inc.updates.push({ at: inc.updatedAt, status: 'RESOLVED', by: 'incident', note: 'Resolved and documented' });
    }
    if (inc.severity === 1 && inc.status === 'NEW' && age > 18 * 60000) {
      inc.status = 'CLOSED'; inc.updatedAt = inc.createdAt + 18 * 60000;
      inc.updates.push({ at: inc.updatedAt, status: 'CLOSED', by: 'system', note: 'Informational — closed' });
    }
  }
}

function doSos(simNow, evts) {
  const st = S();
  while (pointers.sos < plan.sosList.length && plan.sosList[pointers.sos].t <= simNow) {
    const { t, def } = plan.sosList[pointers.sos++];
    if (st.sosEvents.some(s => s.planT === t)) continue;
    const sos = {
      id: uuid(), code: nextCode(st, 'sos'),
      agentId: def.agentId, puId: def.puId, wardId: def.wardId, lgaId: def.lgaId,
      category: def.category, gps: st.pus.find(p => p.id === def.puId)?.gps || null,
      status: 'ACTIVE', createdAt: t, updatedAt: t,
      acks: [], updates: [{ at: t, note: 'SOS triggered by field agent' }], planT: t,
    };
    st.sosEvents.unshift(sos);
    audit(null, 'SOS_TRIGGERED', 'sos', sos.id, `${sos.code} ${def.category}`, null);
    notify(['director', 'operator', 'sencoord', 'lgcoord'], `EMERGENCY SOS — ${def.category}`, `${sos.code} at ${def.puId}`, { priority: 'CRITICAL', link: '/central?tab=sos' });
    evts.push({ type: 'sos.triggered', sosId: sos.id, lgaId: def.lgaId });
  }
  const ackDelay = 6 * 60000, respDelay = 24 * 60000;
  for (const sos of st.sosEvents) {
    const age = simNow - sos.createdAt;
    if (sos.status === 'ACTIVE' && age > ackDelay) {
      sos.status = 'ACKNOWLEDGED'; sos.updatedAt = sos.createdAt + ackDelay;
      sos.acks.push({ by: 'lgcoord', at: sos.updatedAt, note: 'LG Control acknowledging — response team alerted' });
      sos.updates.push({ at: sos.updatedAt, note: 'Acknowledged by LG Control' });
    }
    if (sos.status === 'ACKNOWLEDGED' && age > respDelay) {
      sos.status = 'RESPONDING'; sos.updatedAt = sos.createdAt + respDelay;
      sos.updates.push({ at: sos.updatedAt, note: 'Authorized response team deployed' });
    }
    if (sos.status === 'RESPONDING' && age > respDelay + 50 * 60000) {
      sos.status = 'RESOLVED'; sos.updatedAt = sos.createdAt + respDelay + 50 * 60000;
      sos.updates.push({ at: sos.updatedAt, note: 'Situation resolved — after-action report filed' });
    }
  }
}

function doStreams(simNow, evts) {
  const st = S();
  while (pointers.streams < plan.streamList.length && plan.streamList[pointers.streams].t <= simNow) {
    const { t, dur, agentId } = plan.streamList[pointers.streams++];
    if (st.streams.some(s => s.planT === t)) continue;
    const agent = st.agents.find(a => a.id === agentId);
    if (!agent) continue;
    const str = {
      id: uuid(), agentId, puId: agent.puId, wardId: agent.wardId, lgaId: agent.lgaId,
      status: 'LIVE', startedAt: t, endedAt: null, planEnd: t + dur, planT: t,
      bitrateKbps: ri(mulberry32(t), 320, 2400), fps: ri(mulberry32(t + 1), 15, 30),
      viewers: 0, quality: 'GOOD', pinned: false,
    };
    st.streams.unshift(str);
    evts.push({ type: 'stream.started', streamId: str.id, lgaId: agent.lgaId });
    audit(null, 'STREAM_STARTED', 'stream', str.id, `${agent.puId} by ${agent.name}`, null);
  }
  for (const str of st.streams) {
    if (str.status !== 'LIVE') continue;
    str.viewers = Math.max(0, str.viewers + ri(mulberry32(Date.now() % 10000), -2, 5));
    str.bitrateKbps = Math.max(180, str.bitrateKbps + ri(mulberry32(Date.now() % 9999), -120, 120));
    if (simNow >= str.planEnd) {
      str.status = 'ENDED'; str.endedAt = str.planEnd;
      evts.push({ type: 'stream.ended', streamId: str.id });
    }
  }
}

function doDutyCompletion(simNow, evts) {
  const st = S();
  if (phaseOf(simNow) !== 'POST-ELECTION') return;
  for (const a of st.agents) {
    if (a.dutyState === 'DUTY_COMPLETED') continue;
    if (['NOT_ACTIVATED', 'ACTIVATED', 'ON_DUTY', 'POLLING_MONITORING'].includes(a.dutyState)) continue;
    const s = plan.puSchedule[a.puId];
    const due = Math.max(s.collate + s.reviewDelay, watTime(...ELECTION_DAY, 18, 15)) + 40 * 60000;
    if (simNow >= due && a.dutyState !== 'UNDER_REVIEW') {
      a.dutyState = 'DUTY_COMPLETED'; a.completedAt = simNow; a.online = false;
      evts.push({ type: 'agent.duty_completed', agentId: a.id });
    }
  }
}

function describeIncident(def, pu) {
  const lga = S().lgas.find(l => l.id === def.lgaId);
  const loc = pu ? `${pu.name}, ${lga ? lga.name : ''} LGA` : 'Polling unit';
  const t = {
    'Violence': `Clash reported between groups near the polling area. Situation being monitored; security response requested.`,
    'Threat': `Field agent reports verbal threats directed at voters in the queue area.`,
    'Intimidation': `Reports of voter intimidation around the polling environment.`,
    'Vandalism': `Damage reported to election materials/structures at the location.`,
    'Security deployment concern': `Concern raised about adequacy of security presence at the location.`,
    'Delayed opening': `Polling unit opened later than the scheduled 08:00 WAT start.`,
    'Missing materials': `Sensitive/non-sensitive materials reported incomplete at opening.`,
    'Accreditation problem': `Accreditation proceeding slowly; equipment/personnel issue reported.`,
    'Voting interruption': `Voting process temporarily interrupted at this location.`,
    'Counting interruption': `Sorting/counting process interrupted; party agents observing.`,
    'Result-sheet concern': `Concern raised about the condition/completion of the result sheet.`,
    'BVAS issue': `BVAS device malfunction reported; technicians notified.`,
    'Network outage': `Mobile network unavailable in the area; agent working offline.`,
    'Device failure': `Agent device malfunctioning; backup workflow activated.`,
    'Communication failure': `Unable to reach field team from the ward level.`,
    'Accessibility issue': `Access for elderly/persons with disability needs attention.`,
    'Queue problem': `Long queues forming; crowd management requested.`,
    'General observation': `Routine observation logged by field agent.`,
    'Environmental issue': `Environmental condition (weather/lighting) affecting operations.`,
  };
  return `${loc}: ${t[def.sub] || def.sub}`;
}

// ---------------- scenario control ----------------
function resetDynamic() {
  const st = S();
  for (const k of ['submissions', 'evidence', 'incidents', 'sosEvents', 'streams', 'notifications', 'reviews', 'disputes', 'changes', 'publicReleases', 'systemEvents']) st[k] = [];
  for (const a of st.agents) {
    a.dutyState = 'NOT_ACTIVATED'; a.online = false; a.lastHeartbeat = null;
    a.activatedAt = null; a.checkedInAt = null; a.completedAt = null; a.submittedAt = null;
  }
}

function applyScenario(name, evtsOut) {
  const st = S();
  const target = scenarioTime(name);
  resetDynamic();
  buildPlan();
  st.meta.scenario = name;
  st.meta.simNow = target;
  st.meta.simBaseReal = Date.now();
  // bulk run from 05:00 to target in 4-minute steps
  const evts = [];
  let t = watTime(...ELECTION_DAY, 5, 0);
  let guard = 0;
  const steps = Math.ceil((target - t) / (4 * 60000));
  for (let i = 0; i <= steps && guard++ < 4000; i++) {
    t = watTime(...ELECTION_DAY, 5, 0) + i * 4 * 60000;
    if (t > target) t = target;
    stepSim(t, evts, true);
  }
  // final state adjustments
  doDutyCompletion(target, evts);
  audit(null, 'SCENARIO_LOADED', 'simulation', name, `Scenario "${SCENARIOS[name].label}" loaded at ${fmtWat(target)}`, null);
  return { scenario: name, label: SCENARIOS[name].label, simNow: target, phase: phaseOf(target), eventsGenerated: evts.length };
}

function stepSim(t, evts, bulk) {
  for (const a of S().agents) doCheckin(a, t, evts);
  doHeartbeats(t, evts);
  doSubmit(t, evts);
  doReviews(t, evts);
  doIncidents(t, evts);
  doSos(t, evts);
  doStreams(t, evts);
  if (bulk) doDutyCompletion(t, evts);
}

function tick(dtRealMs) {
  const st = S();
  if (st.meta.simPaused) return;
  const dtSimMs = dtRealMs * st.meta.simSpeed;
  st.meta.simNow += dtSimMs;
  // clamp at end of election day → platform enters read-only post-election state
  const dayEnd = watTime(...ELECTION_DAY, 23, 59);
  if (st.meta.simNow >= dayEnd) {
    st.meta.simNow = dayEnd;
    st.meta.simPaused = true;
  }
  const evts = [];
  for (const step of [doCheckinAll, doHeartbeats, doSubmit, doReviews, doIncidents, doSos, doStreams, doDutyCompletion]) {
    try { step(st.meta.simNow, evts, false); } catch (e) { console.error('sim step error', step.name, e.message); }
  }
  for (const e of evts) broadcast && broadcast({ kind: 'event', ...e });
  // system health jitter
  const h = st.systemHealth;
  h.cpu = Math.max(12, Math.min(88, h.cpu + (Math.random() * 6 - 3)));
  h.memory = Math.max(20, Math.min(85, h.memory + (Math.random() * 4 - 2)));
  h.responseMs = Math.max(22, Math.min(320, h.responseMs + (Math.random() * 20 - 10)));
  if (broadcast) broadcast({ kind: 'tick', simNow: st.meta.simNow, phase: phaseOf(st.meta.simNow), paused: st.meta.simPaused });
  set(() => {});
}
function doCheckinAll(t, evts) { for (const a of S().agents) doCheckin(a, t, evts); }

function setBroadcast(fn) { broadcast = fn; }
function getPlan() { return plan; }

function resume() {
  // rebuild plan + pointers, keep all dynamic state (used after restart with persisted data)
  buildPlan();
  const st = S();
  const simNow = st.meta.simNow;
  // advance pointers past scheduled events already due (state already reflects what happened)
  while (pointers.incidents < plan.incidentList.length && plan.incidentList[pointers.incidents].t <= simNow) pointers.incidents++;
  while (pointers.sos < plan.sosList.length && plan.sosList[pointers.sos].t <= simNow) pointers.sos++;
  while (pointers.streams < plan.streamList.length && plan.streamList[pointers.streams].t <= simNow) pointers.streams++;
  // skip streams whose planned window is over
  for (const str of st.streams) if (str.status === 'LIVE' && str.planEnd <= simNow) { str.status = 'ENDED'; str.endedAt = str.planEnd; }
  // clamp sim to election day window
  const dayEnd = watTime(...ELECTION_DAY, 23, 59);
  if (simNow > dayEnd) st.meta.simNow = dayEnd;
}

module.exports = { buildPlan, applyScenario, resume, tick, phaseOf, scenarioTime, SCENARIOS, submitForPu, applyReview, finalizeReview, setBroadcast, getPlan, ELECTION_DAY };
