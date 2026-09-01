// scripts/apitest.js — quick end-to-end API test harness
const B = process.env.B || 'http://localhost:3000';
async function req(method, path, body, token) {
  const r = await fetch(B + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return { status: r.status, json: JSON.parse(text) }; } catch { return { status: r.status, json: null, text }; }
}
async function login(username, password) {
  const l = await req('POST', '/api/auth/login', { username, password });
  const m = await req('POST', '/api/auth/mfa', { challenge: l.json.challenge, code: l.json.mfaCode });
  return { token: m.json.token, user: m.json.user };
}
(async () => {
  const sup = await login('supervisor', 'Supervisor@123!');
  console.log('login supervisor ok:', !!sup.token);

  // status distribution
  let r = await req('GET', '/api/results?election=e-gov-2027&limit=500', null, sup.token);
  const c = {};
  r.json.rows.forEach(x => c[x.status] = (c[x.status] || 0) + 1);
  console.log('status distribution:', JSON.stringify(c));

  // verify a pending submission
  const pending = await req('GET', '/api/results?election=e-gov-2027&status=SUBMITTED&limit=1', null, sup.token);
  const sid = pending.json.rows[0].id;
  const v = await req('POST', `/api/results/${sid}/verify`, { action: 'APPROVE', reason: '' }, sup.token);
  console.log('verify result:', v.status, JSON.stringify(v.json).slice(0, 120));
  const detail = await req('GET', `/api/results/${sid}`, null, sup.token);
  console.log('status now:', detail.json.status, '| custody chain:', detail.json.custodies.map(x => x.step).join(' → '));

  // reject flow with reason requirement
  const p2 = await req('GET', '/api/results?election=e-gov-2027&status=SUBMITTED&limit=1', null, sup.token);
  const sid2 = p2.json.rows[0].id;
  const noReason = await req('POST', `/api/results/${sid2}/verify`, { action: 'REJECT', reason: '' }, sup.token);
  console.log('reject without reason →', noReason.status, noReason.json.error);
  const withReason = await req('POST', `/api/results/${sid2}/verify`, { action: 'REJECT', reason: 'Illegible document capture' }, sup.token);
  console.log('reject with reason →', withReason.status, withReason.json.status);

  // dual control: flag for second review, then confirm with different reviewer
  // (any SUBMITTED row qualifies — do not depend on anomaly rows existing this early in the sim)
  const p3 = await req('GET', '/api/results?election=e-gov-2027&status=SUBMITTED&limit=1', null, sup.token);
  if (!p3.json.rows || !p3.json.rows.length) throw new Error('no SUBMITTED rows for dual-control flow (sim not advanced?)');
  const sid3 = p3.json.rows[0].id;
  const flag = await req('POST', `/api/results/${sid3}/verify`, { action: 'FLAG_SECOND_REVIEW', reason: 'Anomaly — dual control' }, sup.token);
  console.log('flag second review:', flag.status, flag.json.requiresSecond);
  const rev2 = await login('reviewer2', 'Reviewer@123!');
  const sameCheck = await req('POST', `/api/results/${sid3}/second-review`, { action: 'CONFIRM' }, sup.token);
  console.log('same reviewer blocked:', sameCheck.status, sameCheck.json.error);
  const conf = await req('POST', `/api/results/${sid3}/second-review`, { action: 'CONFIRM' }, rev2.token);
  console.log('second confirm →', conf.status, conf.json.status);

  // correction with four-eyes
  const dir = await login('director', 'Director@123!');
  const p4 = await req('GET', '/api/results?election=e-gov-2027&status=VERIFIED&limit=1', null, sup.token);
  const sid4 = p4.json.rows[0].id;
  const d4 = await req('GET', `/api/results/${sid4}`, null, sup.token);
  const cand = d4.json.items[0].candidateId;
  const corr = await req('POST', `/api/results/${sid4}/correct`, { reason: 'Transcription correction', changes: [{ candidateId: cand, votes: d4.json.items[0].votes + 2 }] }, dir.token);
  console.log('correction proposed:', corr.status, corr.json.status, 'changeId:', !!corr.json.changeId);
  const approve = await req('POST', `/api/changes/${corr.json.changeId}/approve`, {}, sup.token);
  console.log('four-eyes approve:', approve.status, 'version:', approve.json.version);

  // copilot queries
  for (const q of ['Show me all unresolved critical incidents in Kano North', 'Which wards have more than 20% outstanding result submissions?', 'What is the verification backlog?', 'Polling units with missing submissions in Nasarawa']) {
    const a = await req('POST', '/api/copilot', { query: q }, dir.token);
    console.log('\nQ:', q, '\nA:', a.json.answer.split('\n').slice(0, 3).join(' | '));
  }

  // agent flow
  const ag = await login('fieldagent', 'Agent@123!');
  const ad = await req('GET', '/api/agent/dashboard', null, ag.token);
  console.log('\nagent dashboard:', ad.status, ad.json.agent?.dutyState, ad.json.assignment?.pu?.id, '| elections:', ad.json.elections?.length);

  // incident create (agent)
  const inc = await req('POST', '/api/incidents', { category: 'SECURITY', subcategory: 'Intimidation', severity: 4, description: 'Reports of voter intimidation near the queue.' }, ag.token);
  console.log('incident created:', inc.status, inc.json.code);

  // SOS
  const sos = await req('POST', '/api/sos', { category: 'THREAT', note: 'Demo test SOS' }, ag.token);
  console.log('sos created:', sos.status, sos.json.code);
  const ack = await req('POST', `/api/sos/${sos.json.id}/ack`, { note: 'LG control acknowledging' }, dir.token);
  console.log('sos ack:', ack.status, ack.json.status);

  // audit trail check
  const au = await req('GET', '/api/audit?limit=5', null, dir.token); // RBAC: director holds audit.view
  console.log('\naudit recent:', au.json.rows.map(x => x.username + ':' + x.action).join(' | '));
  console.log('\nALL TESTS DONE');
})().catch(e => { console.error('TEST FAILURE', e); process.exit(1); });
