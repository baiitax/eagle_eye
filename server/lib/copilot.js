// copilot.js — Situation Room Intelligence Assistant (rule-based, provenance-labelled)
'use strict';
const { S } = require('./store');
const { aggregates, lgAggregates } = require('./reports');
const { fmtWat } = require('./util');

let irevMod = null;
const irevEngine = () => {
  if (!irevMod) { try { irevMod = require('./irev'); } catch (e) { irevMod = null; } }
  return irevMod;
};

// Answer structure: sections, each with provenance: FACT | VERIFIED_DATA | UNVERIFIED_REPORT | SYSTEM_INFERENCE | HUMAN_ASSESSMENT
function answer(q) {
  const st = S();
  const ql = String(q || '').toLowerCase().trim();

  // ---- IReV Watchtower intents ----
  if (/irev|reconciliation|watchtower|became unavailable|no longer observed|changed after first observation/.test(ql)) {
    const ir = irevEngine();
    if (!ir) return { answer: 'IReV Watchtower data is not available in this session.', sections: [] };
    const rec = ir.reconcileState();
    const k = rec.kpis;
    // sitrep
    if (/sitrep|situation report|brief/.test(ql)) {
      return {
        answer: `**IReV RECONCILIATION SITREP — ${fmtWat(S().meta.simNow)}**\n\n• Monitored records: **${k.totalMonitored}**\n• IReV observed: **${k.observed}** (${k.coveragePct}% coverage)\n• Matched: **${k.matched}** (${k.reconciliationPct}% of observed)\n• Pending uploads: **${k.pending}**\n• Discrepancies: **${k.discrepancies}**\n• Document changes: **${k.docChanges}**\n• Previously observed / currently unavailable: **${k.unavailable}**\n• Cases under human review: **${k.underReview}**\n\nAll differences are reported factually — causes are never asserted without verified evidence.`,
        sections: [
          { provenance: 'FACT', text: 'Counts from the immutable snapshot archive and reconciliation engine.' },
          { provenance: 'SYSTEM_INFERENCE', text: 'Statuses are automated comparisons only — every discrepancy requires human review before any conclusion.' },
        ],
      };
    }
    // pending / no corresponding observation
    if (/how many field|no corresponding|pending|not yet available|not observed/.test(ql)) {
      const list = rec.rows.filter(r => r.status === 'PENDING').slice(0, 8).map(r => `• **${r.code}** — ${r.lga} (field captured ${fmtWat(r.pendingSince)})`).join('\n');
      return {
        answer: `**${k.pending}** field-captured polling-unit result(s) currently have **no corresponding IReV observation**.\n${list}${k.pending > 8 ? `\n…and ${k.pending - 8} more` : ''}\n\nA delay is not interpreted as wrongdoing — possible causes include connectivity, upload queues, portal delay or operational timing.`,
        sections: [{ provenance: 'DERIVED_DATA', text: 'Computed from the snapshot archive vs field submissions.' }, { provenance: 'SYSTEM_INFERENCE', text: 'Pending = observation not yet seen, never an accusation of withholding.' }],
      };
    }
    // changed after first observation
    if (/changed|version change|after first observation/.test(ql)) {
      const ir2 = ir.cfg();
      const changed = ir2.cases.filter(c => ['DOCUMENT_CHANGED', 'RESULT_VALUES_CHANGED'].includes(c.type) && !['RESOLVED', 'CLOSED'].includes(c.status)).slice(0, 8)
        .map(c => `• **${c.code}** — ${c.puId}: ${c.type} (${c.confidence} confidence) — ${c.status}`).join('\n');
      return {
        answer: `**${k.docChanges}** document-change case(s) where the IReV observation differs from a previously archived snapshot:\n${changed || 'None currently open.'}\n\nEach case preserves: previous snapshot, current snapshot, hashes, retrieval timestamps and comparison output.`,
        sections: [{ provenance: 'VERIFIED_DATA', text: 'Each case holds two or more preserved observations with timestamps.' }, { provenance: 'FACT', text: 'A changed hash means the observed content differs — it does not establish the cause.' }],
      };
    }
    // unavailable
    if (/unavailable|disappear|no longer observed|removed/.test(ql)) {
      const ir2 = ir.cfg();
      const rows = ir2.cases.filter(c => c.type === 'RESULT_DISAPPEARED' && !['RESOLVED', 'CLOSED'].includes(c.status)).slice(0, 8)
        .map(c => `• **${c.code}** — ${c.puId} (first observed per archive) — ${c.status}`).join('\n');
      return {
        answer: `**${k.unavailable}** record(s) were previously observed and are **currently not observable**.\n${rows || 'None currently.'}\n\nThe platform never states that a result was deleted: a public portal can become unavailable temporarily without any record being removed. Status: POTENTIAL REMOVAL / UNAVAILABLE RECORD — human verification required.`,
        sections: [{ provenance: 'FACT', text: 'Careful-language policy: "RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED".' }, { provenance: 'HUMAN_ASSESSMENT', text: 'Cause determination is explicitly outside automated scope.' }],
      };
    }
    // backlog by LGA
    if (/lga|backlog|district/.test(ql)) {
      const by = {};
      for (const r of rec.rows.filter(x => x.status === 'PENDING')) by[r.lga] = (by[r.lga] || 0) + 1;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l, n]) => `• **${l}**: ${n} pending`).join('\n');
      return {
        answer: `**Reconciliation backlog by LGA** (pending IReV observations):\n${top || 'No backlog — all captured results observed.'}`,
        sections: [{ provenance: 'DERIVED_DATA', text: 'Pending-observation counts grouped by LGA.' }],
      };
    }
    // complete timeline for a PU
    let m2 = ql.match(/timeline for (?:pu[- ]?)?([A-Za-z0-9\-]+)/);
    if (m2) {
      const puId = String(m2[1]).toUpperCase();
      const st = S();
      const pu = st.pus.find(p => p.id === puId) || st.pus.find(p => p.code === puId);
      if (!pu) return { answer: `I could not match "${m2[1]}" to a polling unit. Try e.g. "Show the complete timeline for PU-005-002-01".`, sections: [{ provenance: 'FACT', text: 'Geography lookup failed.' }] };
      const ir2 = ir.cfg();
      const obs = ir2.observations.filter(o => o.puId === pu.id).sort((a, b) => a.observedAt - b.observedAt);
      const rows = [];
      if (obs.length === 0) rows.push('• No IReV observation recorded yet.');
      else for (const o of obs) rows.push(`• ${fmtWat(o.observedAt)} — OBSERVATION #${o.snapshotNo} — hash ${o.docHash.slice(0, 12)}… ${o.available === false ? '(CURRENTLY NOT OBSERVED)' : '(available)'}`);
      const cse = ir2.cases.filter(c => c.puId === pu.id);
      for (const c of cse) rows.push(`• ${fmtWat(c.createdAt)} — CASE ${c.code} — ${c.type} — ${c.status}`);
      return {
        answer: `**Complete timeline for ${pu.id} (${pu.name}, ${st.lgas.find(l => l.id === pu.lgaId)?.name} LGA):**\n${rows.join('\n')}`,
        sections: [{ provenance: 'VERIFIED_DATA', text: 'Snapshot archive + case records for this polling unit.' }],
      };
    }
    // default irev status
    return {
      answer: `**IReV Watchtower status** — coverage ${k.coveragePct}% · observed ${k.observed}/${k.totalMonitored} · matched ${k.matched} · pending ${k.pending} · discrepancies ${k.discrepancies} · document changes ${k.docChanges} · unavailable ${k.unavailable} · under review ${k.underReview}.\n\nAsk me for the reconciliation SITREP, pending uploads, changed documents, or a PU timeline.`,
      sections: [{ provenance: 'DERIVED_DATA', text: 'Live reconciliation engine counters.' }],
    };
  }

  const lgas = Object.values(lgAggregates());
  const lgaByName = (n) => st.lgas.find(l => l.name.toLowerCase() === n || n.includes(l.name.toLowerCase()));

  // critical incidents in <district/lga>
  let m = ql.match(/(?:unresolved |open |active )?critical incidents? (?:in|for|at) (.+)/);
  if (m) {
    const where = m[1].trim();
    const district = st.senatorial.find(s => s.toLowerCase().includes(where.split(' ').slice(-2).join(' ')) || where.toLowerCase().includes(s.toLowerCase()));
    const lga = district ? null : lgaByName(where);
    let list = st.incidents.filter(i => i.severity === 5 && !['RESOLVED', 'CLOSED'].includes(i.status));
    if (district) list = list.filter(i => st.lgas.find(l => l.id === i.lgaId)?.senatorial === district);
    if (lga) list = list.filter(i => i.lgaId === lga.id);
    const scope = district || lga ? (district || lga.name) : where;
    if (list.length === 0) return { answer: `No unresolved Level-5 (critical) incidents in ${scope}.`, sections: [{ provenance: 'FACT', text: `Query: unresolved critical incidents in ${scope}. 0 records found.` }] };
    const body = list.slice(0, 8).map(i => {
      const lg = st.lgas.find(l => l.id === i.lgaId);
      const pu = st.pus.find(p => p.id === i.puId);
      return `• **${i.code}** — ${i.subcategory} at ${pu ? pu.name : 'unknown PU'}, ${lg ? lg.name : ''} LGA. Status: ${i.status}. Reported ${fmtWat(i.createdAt)}.`;
    }).join('\n');
    return { answer: `Found **${list.length}** unresolved critical incident(s) in ${scope}:\n${body}`, sections: [{ provenance: 'VERIFIED_DATA', text: 'Incident records from the incident-management module (as reported by field personnel and confirmed by operations).' }, { provenance: 'SYSTEM_INFERENCE', text: 'These are the incidents most likely to require immediate command attention.' }] };
  }

  // wards with > X% outstanding submissions
  m = ql.match(/wards? (?:with|that have|have) (?:more than |over |> ?)?(\d+)\s*% (?:outstanding|unsubmitted|missing)/);
  if (m) {
    const thr = parseInt(m[1], 10);
    const out = [];
    for (const l of st.lgas) {
      for (const w of st.wards.filter(x => x.lgaId === l.id)) {
        const pus = st.pus.filter(p => p.wardId === w.id);
        const subPu = new Set(st.submissions.filter(s => s.wardId === w.id && s.electionId === 'e-gov-2027').map(s => s.puId));
        const missing = pus.length - subPu.size;
        const missingPct = pus.length ? Math.round((missing / pus.length) * 100) : 0;
        if (missingPct > thr) out.push({ ward: w, lga: l, pus: pus.length, missing, missingPct });
      }
    }
    out.sort((a, b) => b.missingPct - a.missingPct);
    if (!out.length) return { answer: `No wards with more than ${thr}% outstanding result submissions.`, sections: [{ provenance: 'FACT', text: 'Derived from submission records vs configured polling units.' }] };
    const body = out.slice(0, 10).map(x => `• **${x.ward.name}** (${x.lga.name}) — ${x.missing}/${x.pus} PUs outstanding (${x.missingPct}%)`).join('\n');
    return { answer: `**${out.length}** ward(s) have more than ${thr}% outstanding result submissions:\n${body}`, sections: [{ provenance: 'DERIVED_DATA', text: 'Computed from the verified polling-unit register and current submission records.' }, { provenance: 'SYSTEM_INFERENCE', text: 'Wards at the top of this list should be prioritised for follow-up by ward coordinators.' }] };
  }

  // briefing / sitrep
  if (/briefing|situation report|sitrep|status overview/.test(ql)) {
    const ag = aggregates();
    const open = st.incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status));
    const bySev = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const i of open) bySev[i.severity]++;
    const sen = st.senatorial.map(sd => {
      const ls = lgas.filter(x => x.senatorial === sd);
      return `  • **${sd}**: ${ls.reduce((a, x) => a + x.submitted, 0)}/${ls.reduce((a, x) => a + x.totalPu, 0)} PUs reported (${ls.length ? Math.round(ls.reduce((a, x) => a + x.reportingPct, 0) / ls.length) : 0}%), ${ls.reduce((a, x) => a + x.verified, 0)} verified`;
    }).join('\n');
    const soc = st.sosEvents.filter(s => s.status !== 'RESOLVED').map(s => `• ${s.code} (${s.category}) — ${s.status}`).join('\n') || '  • None active';
    return {
      answer: `**30-MINUTE SITUATION-ROOM BRIEFING — ${fmtWat(st.meta.simNow)}**\n\n**Overall status**\n  • Reporting: ${ag.submittedPu}/${ag.totalPu} polling units (${ag.reportingPct}%)\n  • Verified: ${ag.verifiedPu} PUs (${ag.verifiedPct}%) | Rejected: ${ag.rejected} | Disputed: ${ag.disputed}\n  • Verification queue: ${ag.verificationQueue} | Data anomalies flagged: ${ag.anomalies}\n\n**Senatorial districts**\n${sen}\n\n**Field operations**\n  • Agents online: ${ag.agentsOnline} | Offline: ${ag.agentsOffline} | Live streams: ${ag.liveStreams}\n\n**Incidents & emergencies**\n  • Active incidents: ${ag.activeIncidents} (L5: ${bySev[5]}, L4: ${bySev[4]}, L3: ${bySev[3]}, L2: ${bySev[2]}, L1: ${bySev[1]})\n  • Active SOS: ${ag.activeSos}\n${soc}`,
      sections: [
        { provenance: 'VERIFIED_DATA', text: 'Verified result records only (status=VERIFIED).' },
        { provenance: 'UNVERIFIED_REPORT', text: 'Submitted-but-unreviewed figures are included in the reporting percentage as UNVERIFIED.' },
        { provenance: 'SYSTEM_INFERENCE', text: 'Priority flags are system-generated operational heuristics, not election-outcome claims.' },
      ],
    };
  }

  // LG performance
  m = ql.match(/(?:summar[iy]?ze |lg |lga )?performance (?:in|for|of) (.+)/);
  if (m || /lg performance|lga performance/.test(ql)) {
    const where = (m && m[1] || 'Kano State').trim();
    const district = st.senatorial.find(s => where.toLowerCase().includes(s.toLowerCase()));
    const lga = district ? null : lgaByName(where);
    let list = lgas;
    if (district) list = list.filter(x => x.senatorial === district);
    if (lga) list = list.filter(x => x.name === lga.name);
    list = [...list].sort((a, b) => b.healthScore - a.healthScore);
    const body = list.slice(0, 10).map(x => `• **${x.name}** — Health ${x.healthScore}/100 | Reporting ${x.reportingPct}% | Verified ${x.verifiedPct}% | Online ${x.agentsOnline}/${x.agents} | Open incidents ${x.incidents}`).join('\n');
    return { answer: `**Operational performance — ${district || (lga && lga.name) || 'Kano State'}**\n\n${body}\n\n_Operational scores only. They do not reflect or predict election outcomes._`, sections: [{ provenance: 'DERIVED_DATA', text: 'Operational health score = coverage, reporting, verification, connectivity and incident load.' }, { provenance: 'HUMAN_ASSESSMENT', text: 'Score interpretation should be validated by an analyst before operational decisions.' }] };
  }

  // verification backlog
  if (/verification backlog|pending verif|review queue/.test(ql)) {
    const q = st.submissions.filter(s => ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status));
    const byLga = {};
    for (const s of q) byLga[s.lgaId] = (byLga[s.lgaId] || 0) + 1;
    const top = Object.entries(byLga).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, n]) => `• **${st.lgas.find(l => l.id === id)?.name}**: ${n} awaiting review`).join('\n');
    return { answer: `**Verification backlog: ${q.length}** submission(s) awaiting review.\n${top}\n\nReviewers online: ${st.users.filter(u => u.roleId === 'reviewer').length} configured.`, sections: [{ provenance: 'DERIVED_DATA', text: 'Queue computed from submission statuses at query time.' }] };
  }

  // missing submissions in <lga>
  m = ql.match(/(?:polling units?|pus?) (?:with|that have)? ?(?:missing|outstanding|unsubmitted|without) (?:result )?(?:submissions?|results?)? ?(?:in|for|at) (.+)/);
  if (m) {
    const lga = lgaByName(m[1].trim());
    if (!lga) return { answer: `I could not match "${m[1].trim()}" to a Kano LGA. Try e.g. "polling units with missing submissions in Nasarawa".`, sections: [{ provenance: 'FACT', text: 'Geography lookup failed.' }] };
    const pus = st.pus.filter(p => p.lgaId === lga.id);
    const subPu = new Set(st.submissions.filter(s => s.lgaId === lga.id && s.electionId === 'e-gov-2027').map(s => s.puId));
    const missing = pus.filter(p => !subPu.has(p.id));
    const body = missing.slice(0, 10).map(p => `• **${p.code}** — ${p.name}`).join('\n');
    return { answer: `**${lga.name} LGA**: ${missing.length} of ${pus.length} polling units have no submission yet.\n${body}${missing.length > 10 ? `\n…and ${missing.length - 10} more` : ''}`, sections: [{ provenance: 'DERIVED_DATA', text: 'Compared against the configured polling-unit register.' }] };
  }

  // incidents summary
  if (/incident/.test(ql) && /summar|breakdown|overview/.test(ql)) {
    const cats = {};
    for (const i of st.incidents.filter(x => !['RESOLVED', 'CLOSED'].includes(x.status))) cats[`${i.category} / ${i.subcategory}`] = (cats[`${i.category} / ${i.subcategory}`] || 0) + 1;
    const body = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([k, n]) => `• ${k}: **${n}**`).join('\n');
    return { answer: `**Active incident summary** (${st.incidents.filter(x => !['RESOLVED', 'CLOSED'].includes(x.status)).length} open):\n${body}`, sections: [{ provenance: 'VERIFIED_DATA', text: 'Incident records as filed and acknowledged in the system.' }] };
  }

  // anomalies
  if (/anomal/.test(ql)) {
    const anom = st.submissions.filter(s => s.anomalies?.length);
    const body = anom.slice(0, 8).map(s => `• **${s.puId}** (${st.lgas.find(l => l.id === s.lgaId)?.name}) — ${s.anomalies.map(a => a.code).join(', ')} — status ${s.status}`).join('\n');
    return { answer: `**${anom.length}** submission(s) flagged by the validation engine:\n${body}\n\nAll flags are phrased as "Requires Human Review" — no accusation of misconduct is made by the system.`, sections: [{ provenance: 'SYSTEM_INFERENCE', text: 'Validation-engine flags are heuristics over data structure and consistency.' }, { provenance: 'FACT', text: 'No automatic fraud conclusions exist in this system.' }] };
  }

  // sos
  if (/sos|emergency/.test(ql)) {
    const sos = st.sosEvents.filter(s => s.status !== 'RESOLVED');
    if (!sos.length) return { answer: 'No active SOS events. All emergency signals resolved.', sections: [{ provenance: 'FACT', text: 'SOS module state at query time.' }] };
    const body = sos.map(s => `• **${s.code}** — ${s.category} at ${s.puId}, ${st.lgas.find(l => l.id === s.lgaId)?.name} LGA — ${s.status} (since ${fmtWat(s.createdAt)})`).join('\n');
    return { answer: `**Active SOS events (${sos.length})**:\n${body}`, sections: [{ provenance: 'VERIFIED_DATA', text: 'SOS events with acknowledgment trail.' }] };
  }

  // live streams
  if (/stream|live video|video wall/.test(ql)) {
    const live = st.streams.filter(s => s.status === 'LIVE');
    const body = live.slice(0, 8).map(s => `• **${s.puId}** — ${st.lgas.find(l => l.id === s.lgaId)?.name} LGA — ${s.bitrateKbps} kbps, ${s.fps} fps, ${s.viewers} viewers`).join('\n');
    return { answer: `**${live.length}** live streams active.\n${body || 'None currently.'}`, sections: [{ provenance: 'FACT', text: 'Stream telemetry from the video service.' }] };
  }

  // help
  return {
    answer: `**Situation Room Intelligence Assistant** — I can help with operational questions, for example:\n\n• "Show me all unresolved critical incidents in Kano North"\n• "Which wards have more than 20% outstanding result submissions?"\n• "Generate the 30-minute situation-room briefing"\n• "Summarize LG performance in Kano South"\n• "What is the verification backlog?"\n• "Polling units with missing submissions in Nasarawa"\n• "Incident summary" / "Active anomalies" / "Active SOS" / "Live streams"\n\nI only report from system records. I never fabricate election figures.`,
    sections: [{ provenance: 'FACT', text: 'This assistant is rule-based over system records and labels every answer with data provenance.' }],
  };
}

module.exports = { answer };
