// irev.js — IReV WATCHTOWER engine
// Observes the authorized/public IReV result surface (simulated), preserves immutable
// snapshots, and reconciles them against field EC8A evidence and EOV structured records.
// Language discipline: differences are "POTENTIAL DOCUMENT CHANGE — HUMAN REVIEW REQUIRED",
// never automatic accusations. Outages suspend disappearance logic, never produce false alerts.
'use strict';
const { uuid, mulberry32, sha256, fmtWat } = require('./util');
const { S, set, audit, notify, nextCode } = require('./store');

let broadcast = null;
const setBroadcast = (fn) => { broadcast = fn; };
const ev = (payload) => broadcast && broadcast({ kind: 'event', ...payload });

const SOURCE_METHODS = ['OFFICIAL API', 'OFFICIAL FEED', 'AUTHORIZED EXPORT', 'PUBLIC IReV OBSERVATION'];
const STATUS_LABELS = {
  MATCHED: 'MATCHED', FIELD_VS_IREV: 'FIELD VS IReV DIFFERENCE', EYES_VS_IREV: 'EYES VS IReV DIFFERENCE',
  FIELD_VS_EYES: 'FIELD VS EYES DIFFERENCE', PENDING: 'IReV NOT YET AVAILABLE', MULTIPLE: 'MULTIPLE IReV OBSERVATIONS',
  UNAVAILABLE: 'RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED', REVIEW: 'REQUIRES HUMAN REVIEW',
};
const CHANGE_LABELS = {
  DOCUMENT_CHANGED: 'DOCUMENT CHANGED', METADATA_CHANGED: 'METADATA CHANGED', RESULT_VALUES_CHANGED: 'RESULT VALUES CHANGED',
  RESULT_APPEARED: 'RESULT APPEARED', RESULT_DISAPPEARED: 'RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED',
  RESULT_REPLACED: 'RESULT REPLACED', NO_CHANGE: 'NO CHANGE',
};
const CLASSIFICATIONS = ['MATCH', 'DATA ENTRY ERROR', 'IMAGE/SCAN ISSUE', 'LEGITIMATE VERSION CHANGE', 'POSSIBLE RESULT CHANGE', 'UNRESOLVED'];

function cfg() {
  const st = S();
  if (!st.irev) st.irev = { config: { sourceMethod: 'PUBLIC IReV OBSERVATION', enabled: true, normalMin: 10, attentionMin: 30, highMin: 60 }, sourceHealth: { status: 'ONLINE', lastSync: null, lastSuccess: null, responseMs: 0, errors: 0, failedObservations: 0, rateLimitEvents: 0, observations: 0, outageSince: null, outageUntil: null, notes: [] }, plan: {}, observations: [], cases: [], alerts: [], events: [], outageAlertId: null };
  return st.irev;
}
function logEvent(type, label, detail, { puId, lgaId } = {}) {
  const ir = cfg();
  ir.events.unshift({ id: uuid(), t: S().meta.simNow, type, label, detail: detail || '', puId: puId || null, lgaId: lgaId || null });
  if (ir.events.length > 400) ir.events.length = 400;
}
function valuesKey(items) { return (items || []).map(i => `${i.candidateId}:${i.votes}`).join('|'); }

// ---------------- plan ----------------
function buildPlan() {
  const st = S(); const ir = cfg();
  ir.plan = {};
  for (const pu of st.pus) {
    const r = mulberry32(parseInt(pu.code.replace(/\D/g, ''), 10) * 31 + 7);
    const delayMin = 4 + Math.floor(r() * 22);
    const never = r() < 0.06;
    const v1DocDiff = !never && r() < 0.02;
    const verChg = !never && r() < 0.045;
    const unavail = !never && r() < 0.016;
    ir.plan[pu.id] = {
      delayMin, never, v1DocDiff, verChg, unavail,
      verAtMin: 55 + Math.floor(r() * 60),
      unavailAtMin: 130 + Math.floor(r() * 100),
      tweakVotes: 1 + Math.floor(r() * 5),
    };
  }
}
function govSubFor(puId) {
  return S().submissions.find(s => s.puId === puId && s.electionId === 'e-gov-2027');
}
function fieldHashFor(sub) {
  const evd = S().evidence.find(e => e.submissionId === sub.id && e.kind === 'EC8A');
  return evd ? evd.sha256 : sha256('eov-doc:' + sub.puId);
}
function observationFor(puId, sub, simNow, { version, docHash, values, validVotes, rejected, accredited }) {
  const st = S(); const ir = cfg();
  const pu = st.pus.find(p => p.id === puId);
  const lga = st.lgas.find(l => l.id === pu?.lgaId);
  const prior = ir.observations.filter(o => o.puId === puId);
  return {
    id: uuid(), code: nextCode(st, 'irevObs'), puId, wardId: pu?.wardId || '', lgaId: pu?.lgaId || '',
    senatorial: lga?.senatorial || '', observedAt: simNow,
    docHash, valuesHash: sha256(valuesKey(values) + '|' + validVotes + '|' + rejected),
    values, validVotes, rejected, accredited,
    available: true, version, sourceMethod: ir.config.sourceMethod, snapshotNo: prior.length + 1,
    eovSubmissionId: sub.id,
  };
}
function pushObservation(obs) {
  const ir = cfg();
  ir.observations.push(obs);
  ir.sourceHealth.observations = ir.observations.length;
  ir.sourceHealth.lastSuccess = obs.observedAt;
  ir.sourceHealth.lastSync = obs.observedAt;
}
function upsertAlert({ dedupeKey, category, severity, title, note, caseId, puId, lgaId }) {
  const st = S(); const ir = cfg();
  const existing = ir.alerts.find(a => a.dedupeKey === dedupeKey && a.status !== 'RESOLVED');
  if (existing) { existing.observationCount++; existing.updatedAt = st.meta.simNow; return existing; }
  const al = {
    id: uuid(), code: nextCode(st, 'irevAlert'), dedupeKey, category, severity, title, note,
    caseId: caseId || null, puId: puId || null, lgaId: lgaId || null,
    status: 'OPEN', createdAt: st.meta.simNow, updatedAt: st.meta.simNow, observationCount: 1, confidence: 'MEDIUM',
  };
  ir.alerts.unshift(al);
  if (ir.alerts.length > 500) ir.alerts.length = 500;
  notify(['director', 'analyst', 'senanalyst'], `IReV ${category} — ${title}`, `${note.slice(0, 110)}`, { priority: severity === 'CRITICAL' ? 'CRITICAL' : severity === 'HIGH' ? 'HIGH' : 'MEDIUM', link: '/central?tab=watchtower' });
  ev({ type: 'irev.alert', alertId: al.id, severity, lgaId: lgaId || null });
  return al;
}
function createCase({ type, severity, confidence, puId, lgaId, prevObsId, currObsId, fieldEvId, eovSubId, comparisons, note }) {
  const st = S(); const ir = cfg();
  const pu = st.pus.find(p => p.id === puId);
  const cse = {
    id: uuid(), code: nextCode(st, 'irevCase'), puId, lgaId, wardId: pu?.wardId || '',
    senatorial: st.lgas.find(l => l.id === lgaId)?.senatorial || '',
    type, severity, confidence,
    prevObsId: prevObsId || null, currObsId: currObsId || null, fieldEvId: fieldEvId || null, eovSubId: eovSubId || null,
    comparisons, note,
    status: 'DETECTED', reviewerId: null, reviewerName: null, classification: null, reason: '',
    createdAt: st.meta.simNow, updatedAt: st.meta.simNow, resolvedAt: null, escalatedAt: null,
    timeline: [{ at: st.meta.simNow, step: 'DETECTED', note: 'Automated comparison flagged this record. HUMAN VERIFICATION REQUIRED.' }],
    observationCount: 1,
  };
  ir.cases.unshift(cse);
  if (ir.cases.length > 600) ir.cases.length = 600;
  audit(null, 'IREV_CASE_DETECTED', 'irevCase', cse.id, `${cse.code} ${type} @ ${puId}`, null);
  ev({ type: 'irev.case', caseId: cse.id, puId, lgaId, severity });
  return cse;
}
function ensureCaseTimeline(cse) { if (!cse.timeline) cse.timeline = []; return cse; }

// ---------------- ingestion / snapshot lifecycle ----------------
function isOutage() {
  const ir = cfg(); const h = ir.sourceHealth;
  return h.status === 'UNAVAILABLE' || (h.outageUntil && S().meta.simNow < h.outageUntil);
}
function produceSnapshot(puId, sub, simNow, opts = {}) {
  const st = S(); const ir = cfg();
  if (ir.config.enabled === false) return null;
  if (isOutage()) return null;
  const p = ir.plan[puId] || {};
  const prior = ir.observations.filter(o => o.puId === puId);
  const latest = [...prior].reverse().find(o => o.available !== false);
  const version = (latest ? latest.version : 0) + 1;
  const fieldHash = fieldHashFor(sub);
  const baseValues = (sub.items || []).map(i => ({ candidateId: i.candidateId, votes: i.votes }));
  let docHash, values, validVotes, rejected, accredited;
  if (version === 1) {
    docHash = p.v1DocDiff ? sha256('irev-v1:' + puId) : fieldHash;
    values = baseValues;
  } else {
    docHash = sha256(`irev-v${version}:${puId}:${simNow}`);
    values = baseValues.map((i, idx) => idx === 0 ? { ...i, votes: Math.max(0, i.votes + p.tweakVotes) } : i);
  }
  validVotes = values.reduce((a, i) => a + i.votes, 0);
  rejected = sub.rejected; accredited = sub.accredited;
  const obs = observationFor(puId, sub, simNow, { version, docHash, values, validVotes, rejected, accredited });
  pushObservation(obs);
  const pu = st.pus.find(x => x.id === puId);
  const loc = pu ? `${st.lgas.find(l => l.id === pu.lgaId)?.name || ''} · ${pu.code}` : puId;
  if (version === 1) {
    logEvent('OBSERVED', 'NEW RESULT OBSERVED', loc, { puId, lgaId: pu?.lgaId });
    ev({ type: 'irev.observed', observationId: obs.id, puId, lgaId: pu?.lgaId });
  } else {
    // change detection vs previous snapshot
    const prevObs = latest;
    const docChanged = latest && latest.docHash !== docHash;
    const valChanged = latest && (sha256(valuesKey(latest.values) + '|' + latest.validVotes + '|' + latest.rejected) !== obs.valuesHash);
    let type = 'NO_CHANGE';
    if (docChanged && valChanged) type = 'DOCUMENT_CHANGED';
    else if (docChanged) type = 'DOCUMENT_CHANGED';
    else if (valChanged) type = 'RESULT_VALUES_CHANGED';
    const comparisons = {
      doc: docChanged ? 'DIFFERENCE' : 'MATCH',
      values: valChanged ? 'DIFFERENCE' : 'MATCH',
      metadata: 'MATCH',
    };
    const cse = createCase({
      type, severity: docChanged ? 'CRITICAL' : 'HIGH', confidence: 'HIGH',
      puId, lgaId: pu?.lgaId, prevObsId: prevObs?.id, currObsId: obs.id,
      fieldEvId: sub.evidenceIds?.[0] || null, eovSubId: sub.id, comparisons,
      note: 'A difference was detected between the previously observed IReV document and the current IReV observation. This does not establish the cause of the difference.',
    });
    upsertAlert({
      dedupeKey: `change:${puId}`, category: type === 'DOCUMENT_CHANGED' ? 'RESULT VERSION CHANGE' : 'RESULT VALUES CHANGED',
      severity: docChanged ? 'CRITICAL' : 'HIGH',
      title: type === 'DOCUMENT_CHANGED' ? 'RESULT VERSION CHANGE DETECTED' : 'RESULT VALUES CHANGED',
      note: `${pu?.code || puId}: previous snapshot ${fmtWat(prevObs?.observedAt)} → new snapshot ${fmtWat(simNow)}. POTENTIAL DOCUMENT CHANGE — HUMAN REVIEW REQUIRED.`,
      caseId: cse.id, puId, lgaId: pu?.lgaId,
    });
    logEvent('CHANGE', 'DOCUMENT CHANGE DETECTED', loc, { puId, lgaId: pu?.lgaId });
    ev({ type: 'irev.changed', observationId: obs.id, caseId: cse.id, puId, lgaId: pu?.lgaId });
  }
  return obs;
}
function markUnavailable(puId, simNow) {
  const st = S(); const ir = cfg();
  if (isOutage()) return;
  const obs = ir.observations.filter(o => o.puId === puId);
  if (!obs.length) return;
  const latest = [...obs].reverse()[0];
  if (latest.available === false) return;
  const unavail = { ...latest, id: uuid(), observedAt: simNow, available: false, snapshotNo: obs.length + 1 };
  pushObservation(unavail);
  const pu = st.pus.find(x => x.id === puId);
  const cse = createCase({
    type: 'RESULT_DISAPPEARED', severity: 'HIGH', confidence: 'MEDIUM',
    puId, lgaId: pu?.lgaId, prevObsId: latest.id, currObsId: unavail.id,
    fieldEvId: null, eovSubId: latest.eovSubmissionId,
    comparisons: { doc: 'UNAVAILABLE', values: 'UNAVAILABLE', metadata: 'UNAVAILABLE' },
    note: 'RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED. A public portal can become unavailable temporarily without a record being removed. Human verification required.',
  });
  upsertAlert({
    dedupeKey: `unavail:${puId}`, category: 'RESULT NO LONGER OBSERVED', severity: 'HIGH',
    title: 'RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED',
    note: `${pu?.code || puId}: first observed ${fmtWat(obs[0].observedAt)}, last observed ${fmtWat(latest.observedAt)}, current observation NOT AVAILABLE. Requires human verification.`,
    caseId: cse.id, puId, lgaId: pu?.lgaId,
  });
  logEvent('UNAVAILABLE', 'RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED', pu?.code || puId, { puId, lgaId: pu?.lgaId });
  ev({ type: 'irev.unavailable', caseId: cse.id, puId, lgaId: pu?.lgaId });
}

// ---------------- backfill + tick ----------------
function resetDynamic() {
  const st = S();
  cfg();
  st.irev.observations = []; st.irev.cases = []; st.irev.alerts = []; st.irev.events = []; st.irev.outageAlertId = null;
  st.irev.sourceHealth = { status: 'ONLINE', lastSync: null, lastSuccess: null, responseMs: 0, errors: 0, failedObservations: 0, rateLimitEvents: 0, observations: 0, outageSince: null, outageUntil: null, notes: [] };
}
function resetAndBackfill() {
  const st = S();
  resetDynamic();
  buildPlan();
  backfill(st.meta.simNow);
  st.irev.sourceHealth.lastSync = st.meta.simNow;
  set(() => {});
}
function backfill(simNow) {
  const st = S(); const ir = cfg();
  for (const pu of st.pus) {
    if (ir.observations.some(o => o.puId === pu.id)) continue;
    const sub = govSubFor(pu.id);
    if (!sub) continue;
    const p = ir.plan[pu.id] || {};
    if (p.never) continue;
    const t1 = sub.submittedAt + p.delayMin * 60000;
    if (simNow >= t1) {
      produceSnapshot(pu.id, sub, t1);
      if (p.verChg && simNow >= t1 + p.verAtMin * 60000) produceSnapshot(pu.id, sub, t1 + p.verAtMin * 60000);
      if (p.unavail && simNow >= t1 + p.unavailAtMin * 60000) markUnavailable(pu.id, t1 + p.unavailAtMin * 60000);
    }
  }
}
function tick(simNow) {
  const st = S(); const ir = cfg();
  const h = ir.sourceHealth;
  // outage lifecycle
  if (h.outageUntil && simNow >= h.outageUntil && h.status === 'UNAVAILABLE') {
    h.status = 'ONLINE'; h.outageUntil = null;
    logEvent('SOURCE', 'SOURCE RESTORED — reconciliation re-run', 'Comparing last good snapshot against current observation. No false disappearance alerts were generated during the outage.');
    upsertAlert({ dedupeKey: 'source-restored', category: 'SOURCE HEALTH', severity: 'LOW', title: 'IReV SOURCE RESTORED', note: 'Public IReV source is reachable again. Disappearance comparisons were suspended during the outage and have been re-run.' });
    ev({ type: 'irev.source.restored' });
  }
  // new snapshots
  for (const pu of st.pus) {
    const p = ir.plan[pu.id] || {};
    if (p.never) continue;
    const sub = govSubFor(pu.id);
    if (!sub) continue;
    const t1 = sub.submittedAt + p.delayMin * 60000;
    if (simNow < t1) continue;
    const existing = ir.observations.filter(o => o.puId === pu.id);
    if (!existing.some(o => o.available !== false)) {
      produceSnapshot(pu.id, sub, Math.max(t1, simNow));
      continue;
    }
    if (p.verChg) {
      const t2 = t1 + p.verAtMin * 60000;
      const latest = [...existing].reverse()[0];
      const hasV2 = existing.some(o => o.version >= 2);
      if (simNow >= t2 && !hasV2 && latest.available !== false) {
        produceSnapshot(pu.id, sub, t2);
        continue;
      }
    }
    if (p.unavail) {
      const t3 = t1 + p.unavailAtMin * 60000;
      const latest = [...existing].reverse()[0];
      if (simNow >= t3 && latest.available !== false) {
        markUnavailable(pu.id, t3);
      }
    }
  }
  // source health jitter
  if (!isOutage()) {
    h.responseMs = Math.max(120, Math.min(900, h.responseMs + Math.round(Math.random() * 40 - 20)));
  }
  h.lastSync = simNow;
}

// ---------------- reconciliation computation ----------------
function valuesEqual(a, b) { return sha256(valuesKey(a)) === sha256(valuesKey(b)); }
function reconcileState() {
  const st = S(); const ir = cfg();
  const rows = [];
  for (const pu of st.pus) {
    const sub = govSubFor(pu.id);
    if (!sub) continue;
    const fieldEv = st.evidence.find(e => e.submissionId === sub.id && e.kind === 'EC8A');
    const fieldHash = fieldEv ? fieldEv.sha256 : null;
    const obs = ir.observations.filter(o => o.puId === pu.id).sort((a, b) => a.observedAt - b.observedAt);
    const avail = obs.filter(o => o.available !== false);
    const latest = [...avail].reverse()[0] || null;
    const openCase = ir.cases.find(c => c.puId === pu.id && !['RESOLVED', 'CLOSED'].includes(c.status));
    let status = 'PENDING', label = STATUS_LABELS.PENDING;
    let docMatch = null, valMatch = null;
    if (openCase) { status = 'REVIEW'; label = STATUS_LABELS.REVIEW; }
    else if (!obs.length) { status = 'PENDING'; }
    else if (obs.some(o => o.available === false) && !latest) { status = 'UNAVAILABLE'; label = STATUS_LABELS.UNAVAILABLE; }
    else if (avail.length > 1 && new Set(avail.map(o => o.docHash)).size > 1) { status = 'MULTIPLE'; label = STATUS_LABELS.MULTIPLE; }
    else if (latest) {
      docMatch = fieldHash ? latest.docHash === fieldHash : null;
      const eovValues = (sub.items || []).map(i => ({ candidateId: i.candidateId, votes: i.votes }));
      valMatch = valuesEqual(latest.values, eovValues) && latest.validVotes === sub.validVotes && latest.rejected === sub.rejected;
      if ((sub.anomalies || []).length && docMatch === true) { status = 'FIELD_VS_EYES'; label = STATUS_LABELS.FIELD_VS_EYES; }
      else if (docMatch === true && valMatch === true) { status = 'MATCHED'; label = STATUS_LABELS.MATCHED; }
      else if (docMatch === false && valMatch === true) { status = 'FIELD_VS_IREV'; label = STATUS_LABELS.FIELD_VS_IREV; }
      else if (docMatch === true && valMatch === false) { status = 'EYES_VS_IREV'; label = STATUS_LABELS.EYES_VS_IREV; }
      else if (docMatch === false && valMatch === false) { status = 'FIELD_VS_IREV'; label = STATUS_LABELS.FIELD_VS_IREV; }
      else if (docMatch === null && valMatch === false) { status = 'EYES_VS_IREV'; label = STATUS_LABELS.EYES_VS_IREV; }
      else { status = 'REVIEW'; label = STATUS_LABELS.REVIEW; }
    }
    const lga = st.lgas.find(l => l.id === pu.lgaId);
    rows.push({
      puId: pu.id, code: pu.code, ward: st.wards.find(w => w.id === pu.wardId)?.name || '',
      lgaId: pu.lgaId, lga: lga?.name || '', senatorial: lga?.senatorial || '',
      status, label, docMatch, valMatch,
      eovStatus: sub.status, eovCode: sub.code, fieldHash, latestHash: latest?.docHash || null,
      obsCount: obs.length, versions: new Set(avail.map(o => o.docHash)).size,
      firstObservedAt: obs[0]?.observedAt || null, lastObservedAt: latest?.observedAt || null,
      pendingSince: sub.verifiedAt || sub.submittedAt, caseId: openCase?.id || null, caseCode: openCase?.code || null,
    });
  }
  const kpis = {
    totalMonitored: rows.length,
    observed: rows.filter(r => r.obsCount > 0).length,
    pending: rows.filter(r => r.status === 'PENDING').length,
    matched: rows.filter(r => r.status === 'MATCHED').length,
    discrepancies: rows.filter(r => !['MATCHED', 'PENDING'].includes(r.status)).length,
    docChanges: ir.cases.filter(c => ['DOCUMENT_CHANGED', 'RESULT_VALUES_CHANGED'].includes(c.type) && !['RESOLVED', 'CLOSED'].includes(c.status)).length,
    unavailable: rows.filter(r => r.status === 'UNAVAILABLE').length,
    underReview: ir.cases.filter(c => !['RESOLVED', 'CLOSED'].includes(c.status)).length,
    coveragePct: rows.length ? Math.round(rows.filter(r => r.obsCount > 0).length / rows.length * 1000) / 10 : 0,
    reconciliationPct: rows.length ? Math.round(rows.filter(r => r.status === 'MATCHED').length / rows.filter(r => r.obsCount > 0).length * 1000) / 10 : 0,
  };
  return { rows, kpis };
}
function latencyStats() {
  const st = S(); const ir = cfg();
  const byLga = {};
  const all = [];
  for (const pu of st.pus) {
    const sub = govSubFor(pu.id);
    const first = ir.observations.filter(o => o.puId === pu.id && o.available !== false).sort((a, b) => a.observedAt - b.observedAt)[0];
    if (!sub || !first) continue;
    const mins = Math.round((first.observedAt - sub.submittedAt) / 60000);
    all.push(mins);
    const lga = st.lgas.find(l => l.id === pu.lgaId)?.name || '—';
    (byLga[lga] = byLga[lga] || []).push(mins);
  }
  const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const lgas = Object.entries(byLga).map(([lga, arr]) => ({ lga, avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10, median: med(arr), max: Math.max(...arr), n: arr.length }));
  return { averageMin: all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length * 10) / 10 : 0, medianMin: med(all), maxMin: all.length ? Math.max(...all) : 0, byLga: lgas };
}
function whatChanged(windowMin = 15) {
  const st = S(); const ir = cfg();
  const since = st.meta.simNow - windowMin * 60000;
  const r = reconcileState();
  const cards = {
    newIrevUploads: ir.observations.filter(o => o.available !== false && o.version === 1 && o.observedAt >= since).length,
    newDocuments: r.rows.filter(x => x.firstObservedAt && x.firstObservedAt >= since).length,
    newDiscrepancies: ir.cases.filter(c => c.createdAt >= since).length,
    changedDocuments: ir.observations.filter(o => o.version >= 2 && o.available !== false && o.observedAt >= since).length,
    unavailable: ir.observations.filter(o => o.available === false && o.observedAt >= since).length,
    newIncidents: st.incidents.filter(i => i.createdAt >= since).length,
    newSos: st.sosEvents.filter(s => s.createdAt >= since).length,
    newVerified: st.submissions.filter(s => s.verifiedAt && s.verifiedAt >= since).length,
  };
  return { windowMin, since, cards };
}
function coverageMatrix() {
  const st = S();
  const r = reconcileState();
  const out = [];
  for (const l of st.lgas) {
    const rows = r.rows.filter(x => x.lgaId === l.id);
    out.push({
      lgaId: l.id, name: l.name, senatorial: l.senatorial,
      expected: rows.length, observed: rows.filter(x => x.obsCount > 0).length,
      pending: rows.filter(x => x.status === 'PENDING').length,
      matched: rows.filter(x => x.status === 'MATCHED').length,
      differences: rows.filter(x => !['MATCHED', 'PENDING'].includes(x.status)).length,
      observedPct: rows.length ? Math.round(rows.filter(x => x.obsCount > 0).length / rows.length * 100) : 0,
    });
  }
  return out;
}

// ---------------- review workflow ----------------
function classifyCase(cse, user, classification, reason, { escalate, secondApproval = false } = {}) {
  const st = S();
  cse = ensureCaseTimeline(cse);
  if (!CLASSIFICATIONS.includes(classification)) return { error: 'BAD_CLASSIFICATION' };
  if (!(reason || '').trim()) return { error: 'REASON_REQUIRED' };
  if (cse.status === 'RESOLVED' || cse.status === 'CLOSED') return { error: 'ALREADY_RESOLVED' };
  // §50 two-person approval: closing CRITICAL cases requires a second authorized user
  if (!secondApproval && (cse.severity === 'CRITICAL' || classification === 'POSSIBLE RESULT CHANGE')) {
    if (cse.status === 'PENDING_APPROVAL') return { error: 'AWAITING_SECOND_APPROVAL' };
    cse.reviewerId = user.id; cse.reviewerName = user.name;
    cse.classification = classification; cse.reason = reason;
    cse.status = 'PENDING_APPROVAL';
    cse.pendingApprovalBy = user.id;
    cse.updatedAt = st.meta.simNow;
    cse.timeline.push({ at: st.meta.simNow, step: 'PENDING_APPROVAL', note: `${classification} proposed by ${user.name} — a second authorized reviewer must confirm (two-person approval).` });
    audit(user, 'IREV_CASE_PROPOSED', 'irevCase', cse.id, `${cse.code} → ${classification} (awaiting second approval)`, null);
    ev({ type: 'irev.case.updated', caseId: cse.id, status: 'PENDING_APPROVAL' });
    set(() => {});
    return { ok: true, status: 'PENDING_APPROVAL', requiresSecond: true };
  }
  if (secondApproval && cse.status === 'PENDING_APPROVAL') {
    if (cse.pendingApprovalBy === user.id) return { error: 'SAME_USER', message: 'Two-person approval requires a different authorized reviewer.' };
    cse.secondApproverId = user.id; cse.secondApproverName = user.name;
    cse.timeline.push({ at: st.meta.simNow, step: 'SECOND APPROVAL', note: `Confirmed by ${user.name}.` });
  }
  cse.reviewerId = cse.reviewerId || user.id; cse.reviewerName = cse.reviewerName || user.name;
  cse.classification = classification; cse.reason = reason;
  cse.status = escalate ? 'ESCALATED' : 'RESOLVED';
  cse.updatedAt = st.meta.simNow;
  cse.timeline.push({ at: st.meta.simNow, step: escalate ? 'ESCALATED' : 'RESOLVED', note: `${classification} — ${reason} — by ${user.name}` });
  if (escalate) {
    cse.escalatedAt = st.meta.simNow;
    const esc = {
      id: uuid(), code: nextCode(st, 'escalation'),
      fromUserId: user.id, fromName: user.name, fromRole: user.roleId,
      senatorial: cse.senatorial || 'Kano State', lgaId: cse.lgaId,
      refId: cse.code, type: 'IREV_DISCREPANCY', priority: cse.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      summary: `IReV reconciliation case ${cse.code} at ${cse.puId} — ${cse.type}`,
      evidenceRef: cse.currObsId || '', currentStatus: 'ESCALATED',
      actionsTaken: 'Human review completed; discrepancy confirmed and escalated.',
      requestedAttention: 'Authorized review of the observed difference with supporting snapshots.',
      status: 'SUBMITTED', createdAt: st.meta.simNow, updatedAt: st.meta.simNow,
      updates: [{ at: st.meta.simNow, status: 'SUBMITTED', by: user.name, note: 'Escalated from IReV reconciliation review' }],
    };
    st.escalations.unshift(esc);
    notify(['director', 'operator'], `IReV case escalated — ${cse.code}`, `${cse.type} @ ${cse.puId}`, { priority: 'HIGH', link: '/central?tab=watchtower' });
  } else {
    cse.resolvedAt = st.meta.simNow;
    // close linked alert
    const al = st.irev.alerts.find(a => a.caseId === cse.id);
    if (al) al.status = 'RESOLVED';
  }
  audit(user, 'IREV_CASE_CLASSIFIED', 'irevCase', cse.id, `${cse.code} → ${classification} (${escalate ? 'ESCALATED' : 'RESOLVED'})`, null);
  ev({ type: 'irev.case.updated', caseId: cse.id, status: cse.status });
  set(() => {});
  return { ok: true, status: cse.status };
}

module.exports = { setBroadcast, buildPlan, resetAndBackfill, resetDynamic, backfill, tick, reconcileState, latencyStats, whatChanged, coverageMatrix, classifyCase, produceSnapshot, markUnavailable, upsertAlert, logEvent, cfg, SOURCE_METHODS, STATUS_LABELS, CHANGE_LABELS, CLASSIFICATIONS };
