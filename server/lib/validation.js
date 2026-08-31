// validation.js — automated result validation engine (neutral language, human-review flags)
'use strict';
const { uuid } = require('./util');

// ctx: { existing: submissions for same PU+election, dupHash: bool }
function validateSubmission(sub, ctx = {}) {
  const flags = [];
  const add = (code, label, severity, detail) => flags.push({ code, label, severity, detail });

  for (const it of sub.items) {
    if (it.votes == null || isNaN(it.votes)) add('MISSING_VALUE', 'Missing value', 'HIGH', `No vote figure recorded for ${it.candidateId}`);
    if (it.votes < 0) add('NEGATIVE_VALUE', 'Negative value', 'HIGH', `Negative vote figure recorded for ${it.candidateId}`);
  }

  const vSum = sub.items.reduce((a, b) => a + (b.votes || 0), 0);
  if (sub.validVotes != null && vSum !== sub.validVotes) {
    add('MATH_MISMATCH', 'Data anomaly detected', 'HIGH',
      `Candidate totals (${vSum.toLocaleString()}) do not reconcile with recorded valid votes (${(sub.validVotes || 0).toLocaleString()}). Requires human review.`);
  }
  if (sub.rejected != null && sub.validVotes != null && sub.totalBallots != null) {
    if (sub.validVotes + sub.rejected !== sub.totalBallots) {
      add('TOTALS_INCONSISTENT', 'Data anomaly detected', 'HIGH',
        `Valid votes + rejected ballots do not equal total ballots. Requires human review.`);
    }
  }
  if (sub.accredited != null && sub.registered != null && sub.accredited > sub.registered) {
    add('ACCREDITATION_MISMATCH', 'Data anomaly detected', 'HIGH',
      `Accredited voters (${sub.accredited.toLocaleString()}) exceed registered voters (${sub.registered.toLocaleString()}). Requires human review.`);
  }
  if (sub.accredited != null && vSum > sub.accredited) {
    add('IMPOSSIBLE_TOTAL', 'Data anomaly detected', 'HIGH',
      `Candidate totals exceed accredited voters. Requires human review.`);
  }
  if (sub.ocr && Array.isArray(sub.ocr.confidences)) {
    if (sub.ocr.confidences.some(c => c < 75)) {
      add('OCR_UNCERTAIN', 'OCR uncertainty', 'MEDIUM',
        `One or more extracted figures has low OCR confidence (${Math.min(...sub.ocr.confidences)}%). Human confirmation required.`);
    }
  }
  if (ctx.existing && ctx.existing.length > 0) {
    add('DUPLICATE_SUBMISSION', 'Possible duplicate submission', 'MEDIUM',
      'Another submission already exists for this polling unit and election. Requires human review.');
  }
  if (ctx.dupHash) {
    add('DOCUMENT_FINGERPRINT', 'Suspicious document duplication', 'HIGH',
      'The uploaded document fingerprint matches another submission. Requires human review.');
  }

  const sevScore = flags.reduce((a, f) => a + (f.severity === 'HIGH' ? 3 : f.severity === 'MEDIUM' ? 2 : 1), 0);
  return {
    flags,
    passed: flags.length === 0,
    score: Math.max(0, 100 - sevScore * 8),
    checkedAt: Date.now(),
    language: 'NEUTRAL', // never "fraud"
  };
}

// simulated OCR extraction for the agent app (client calls, then confirms)
function simulateOcr(candidates, seed) {
  let s = seed || 42;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  return candidates.map(c => ({
    candidateId: c.candidateId,
    name: c.name,
    party: c.partyCode,
    votes: c.votes,
    confidence: +(84 + rnd() * 15).toFixed(1),
    matched: rnd() > 0.06,
  }));
}

module.exports = { validateSubmission, simulateOcr };
