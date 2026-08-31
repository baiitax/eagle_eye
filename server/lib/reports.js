// reports.js — SITREP generation + data exports (JSON/CSV/XLSX)
'use strict';
const { S } = require('./store');
const { fmtWat, fmtNum, pct } = require('./util');

// ---------- aggregates ----------
function aggregates() {
  const st = S();
  const total = st.pus.length;
  const govSubs = st.submissions.filter(s => s.electionId === 'e-gov-2027');
  const submittedPu = new Set(govSubs.map(s => s.puId));
  const verifiedPu = new Set(govSubs.filter(s => s.status === 'VERIFIED').map(s => s.puId));
  const rejected = govSubs.filter(s => s.status === 'REJECTED').length;
  const disputed = govSubs.filter(s => s.status === 'DISPUTED').length;
  const pending = govSubs.filter(s => ['SUBMITTED', 'UNDER_REVIEW', 'UNVERIFIED'].includes(s.status)).length;
  const anomalies = govSubs.filter(s => s.anomalies && s.anomalies.length).length;
  const agentsOnline = st.agents.filter(a => a.online && a.dutyState !== 'DUTY_COMPLETED').length;
  const agentsOffline = st.agents.filter(a => !a.online && ['ON_DUTY', 'POLLING_MONITORING', 'RESULT_SUBMITTED', 'UNDER_REVIEW'].includes(a.dutyState)).length;
  const activeInc = st.incidents.filter(i => !['RESOLVED', 'CLOSED'].includes(i.status)).length;
  const critInc = st.incidents.filter(i => i.severity === 5 && !['RESOLVED', 'CLOSED'].includes(i.status)).length;
  const activeSos = st.sosEvents.filter(s => !['RESOLVED'].includes(s.status)).length;
  const liveStreams = st.streams.filter(s => s.status === 'LIVE').length;
  return {
    totalPu: total, submittedPu: submittedPu.size, verifiedPu: verifiedPu.size,
    reportingPct: pct(submittedPu.size, total), verifiedPct: pct(verifiedPu.size, total),
    rejected, disputed, pending, anomalies,
    agentsTotal: st.agents.length, agentsOnline, agentsOffline, liveStreams,
    activeIncidents: activeInc, criticalIncidents: critInc, activeSos,
    verificationQueue: pending,
  };
}

function lgAggregates() {
  const st = S();
  const out = {};
  for (const l of st.lgas) {
    const pus = st.pus.filter(p => p.lgaId === l.id);
    const subs = st.submissions.filter(s => s.lgaId === l.id && s.electionId === 'e-gov-2027');
    const subPu = new Set(subs.map(s => s.puId));
    const verPu = new Set(subs.filter(s => s.status === 'VERIFIED').map(s => s.puId));
    const agents = st.agents.filter(a => a.lgaId === l.id);
    out[l.id] = {
      lgaId: l.id, name: l.name, senatorial: l.senatorial, totalPu: pus.length,
      wards: new Set(pus.map(p => p.wardId)).size,
      agents: agents.length, agentsOnline: agents.filter(a => a.online).length,
      submitted: subPu.size, verified: verPu.size,
      reportingPct: pct(subPu.size, pus.length), verifiedPct: pct(verPu.size, pus.length),
      incidents: st.incidents.filter(i => i.lgaId === l.id && !['RESOLVED', 'CLOSED'].includes(i.status)).length,
      sos: st.sosEvents.filter(s => s.lgaId === l.id && s.status !== 'RESOLVED').length,
      streams: st.streams.filter(s => s.lgaId === l.id && s.status === 'LIVE').length,
      anomalies: subs.filter(s => s.anomalies?.length).length,
      pending: subs.filter(s => ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status)).length,
      healthScore: null, // computed below
    };
  }
  // ward health: operational completeness
  for (const id of Object.keys(out)) {
    const l = out[id];
    l.healthScore = Math.round(0.3 * (l.agentsOnline / Math.max(1, l.agents)) * 100 + 0.4 * l.reportingPct + 0.2 * l.verifiedPct + 0.1 * Math.max(0, 100 - l.incidents * 6 - l.sos * 10));
  }
  return out;
}

function sitrep(scope, ref) {
  const st = S();
  const ag = aggregates();
  const base = {
    generatedAt: st.meta.simNow,
    generatedAtWat: fmtWat(st.meta.simNow),
    scope, ref: ref || 'Kano State',
    platform: st.config.platformName,
    disclaimer: 'UNOFFICIAL MONITORING DATA — DEMO SIMULATION. NOT INEC OFFICIAL RESULTS.',
    phase: phaseNow(),
    kpis: ag,
  };
  if (scope === 'lg') {
    const lgas = lgAggregates();
    const lg = Object.values(lgas).find(x => x.name === ref);
    base.detail = lg ? { ...lg, wards: st.wards.filter(w => w.lgaId === lg.lgaId).length } : null;
    base.lgas = Object.values(lgas);
  } else if (scope === 'senatorial') {
    const lgas = Object.values(lgAggregates()).filter(x => x.senatorial === ref);
    base.lgas = lgas;
    base.detail = {
      totalPu: lgas.reduce((a, x) => a + x.totalPu, 0),
      submitted: lgas.reduce((a, x) => a + x.submitted, 0),
      verified: lgas.reduce((a, x) => a + x.verified, 0),
      reportingPct: pct(lgas.reduce((a, x) => a + x.submitted, 0), lgas.reduce((a, x) => a + x.totalPu, 0)),
      verifiedPct: pct(lgas.reduce((a, x) => a + x.verified, 0), lgas.reduce((a, x) => a + x.totalPu, 0)),
      incidents: lgas.reduce((a, x) => a + x.incidents, 0),
      sos: lgas.reduce((a, x) => a + x.sos, 0),
    };
  } else {
    base.lgas = Object.values(lgAggregates());
    base.senatorial = st.senatorial.map(sd => {
      const lgas = Object.values(lgAggregates()).filter(x => x.senatorial === sd);
      return { name: sd, totalPu: lgas.reduce((a, x) => a + x.totalPu, 0), submitted: lgas.reduce((a, x) => a + x.submitted, 0), verified: lgas.reduce((a, x) => a + x.verified, 0), reportingPct: pct(lgas.reduce((a, x) => a + x.submitted, 0), lgas.reduce((a, x) => a + x.totalPu, 0)), verifiedPct: pct(lgas.reduce((a, x) => a + x.verified, 0), lgas.reduce((a, x) => a + x.totalPu, 0)), incidents: lgas.reduce((a, x) => a + x.incidents, 0), sos: lgas.reduce((a, x) => a + x.sos, 0) };
    });
    base.incidentSummary = {};
    for (const i of st.incidents) {
      const k = `${i.category}/${i.subcategory}`;
      base.incidentSummary[k] = (base.incidentSummary[k] || 0) + 1;
    }
    base.verification = {
      queue: st.submissions.filter(s => ['SUBMITTED', 'UNDER_REVIEW'].includes(s.status)).length,
      reviewed: st.reviews.length,
      avgReviewMin: st.reviews.length ? Math.round(st.reviews.reduce((a, r) => a + (r.at - (st.submissions.find(x => x.id === r.submissionId)?.submittedAt || r.at)), 0) / st.reviews.length / 60000) : null,
      anomalies: ag.anomalies,
    };
  }
  return base;
}

function phaseNow() {
  const st = S();
  const h = new Date(st.meta.simNow + 3600e3).getUTCHours() + new Date(st.meta.simNow + 3600e3).getUTCMinutes() / 60;
  if (h < 8) return 'PRE-OPENING';
  if (h < 14) return 'VOTING';
  if (h < 18) return 'COLLATION';
  return 'POST-ELECTION';
}

// ---------- exports ----------
function toCsv(rows) {
  if (!rows.length) return '';
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const head = Object.keys(rows[0]);
  return [head.join(','), ...rows.map(r => head.map(h => esc(r[h])).join(','))].join('\n');
}

// minimal ZIP (STORE) + XLSX writer — no external deps
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(entries) {
  const chunks = []; const central = []; let offset = 0;
  const enc = new TextEncoder();
  for (const e of entries) {
    const name = enc.encode(e.name), data = e.data;
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    chunks.push(lh, Buffer.from(name), data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0, 14); ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, Buffer.from(name));
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, end]);
}
function xmlEscape(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function toXlsx(rows, sheetName = 'Data') {
  if (!rows.length) rows = [{ empty: '' }];
  const cols = Object.keys(rows[0]);
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
  const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  xml += `<row r="1">` + cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr"><is><t>${xmlEscape(c)}</t></is></c>`).join('') + `</row>`;
  rows.forEach((r, ri) => {
    xml += `<row r="${ri + 2}">` + cols.map((c, i) => `<c r="${colName(i)}${ri + 2}" t="inlineStr"><is><t>${xmlEscape(r[c])}</t></is></c>`).join('') + `</row>`;
  });
  xml += '</sheetData></worksheet>';
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="' + xmlEscape(sheetName).slice(0, 28) + '" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(ct) },
    { name: '_rels/.rels', data: Buffer.from(rels) },
    { name: 'xl/workbook.xml', data: Buffer.from(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(wbRels) },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(xml) },
  ];
  return zipStore(entries);
}

function exportRows(type) {
  const st = S();
  const lgaName = (id) => st.lgas.find(l => l.id === id)?.name || '';
  const wardName = (id) => st.wards.find(w => w.id === id)?.name || '';
  if (type === 'results') {
    return st.submissions.map(s => ({
      id: s.id, election: st.elections.find(e => e.id === s.electionId)?.name || s.electionId, pu: s.puId,
      ward: wardName(s.wardId), lga: lgaName(s.lgaId), senatorial: s.senatorial,
      agent: s.agentId, status: s.status, registered: s.registered, accredited: s.accredited,
      valid: s.validVotes, rejected: s.rejected, total: s.totalBallots,
      anomalies: (s.anomalies || []).map(a => a.code).join(';'), submittedAt: fmtWat(s.submittedAt),
    }));
  }
  if (type === 'incidents') {
    return st.incidents.map(i => ({
      id: i.code, category: i.category, subcategory: i.subcategory, level: i.severity,
      status: i.status, pu: i.puId || '', ward: wardName(i.wardId), lga: lgaName(i.lgaId),
      description: i.description, createdAt: fmtWat(i.createdAt),
    }));
  }
  if (type === 'verification') {
    return st.reviews.map(r => {
      const sub = st.submissions.find(s => s.id === r.submissionId);
      return { id: r.id, submission: r.submissionId, pu: sub?.puId || '', reviewer: r.reviewerName, action: r.action, reason: r.reason || '', at: fmtWat(r.at), secondReviewer: r.secondReviewerId || '' };
    });
  }
  if (type === 'agents') {
    return st.agents.map(a => ({
      code: a.code, name: a.name, pu: a.puId, ward: wardName(a.wardId), lga: lgaName(a.lgaId),
      senatorial: a.senatorial, dutyState: a.dutyState, online: a.online ? 'YES' : 'NO',
      network: a.network, battery: a.battery, phone: a.phone,
    }));
  }
  if (type === 'audit') {
    return st.audit.map(a => ({ id: a.id, username: a.username, action: a.action, objectType: a.objectType, objectId: a.objectId, detail: a.detail, ip: a.ip, createdAt: fmtWat(a.createdAt) }));
  }
  if (type === 'sitrep') {
    const ag = aggregates();
    return Object.entries(ag).map(([k, v]) => ({ metric: k, value: v }));
  }
  return [];
}

module.exports = { aggregates, lgAggregates, sitrep, toCsv, toXlsx, exportRows, phaseNow };
