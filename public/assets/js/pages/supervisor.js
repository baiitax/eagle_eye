// supervisor.js — SUPERVISORY VERIFICATION PORTAL (EC8A review, dual control)
'use strict';
(async () => {
  const { user: me, b, o } = await bootPortal('Supervisory Verification Portal', 'Supervisor', { username: 'supervisor', password: 'Supervisor@123!' });
  const bootstrap = b; let ov = o;
  const qs = new URLSearchParams(location.search);
  let tab = qs.get('tab') || 'queue';
  let queue = [], filter = '';

  const NAV = [
    { id: 'queue', label: 'Review Queue', ico: '≡' },
    { id: 'review', label: 'EC8A Review', ico: '🔍' },
    { id: 'dual', label: 'Dual Control', ico: '👥' },
    { id: 'approved', label: 'Approved', ico: '✓' },
    { id: 'rejected', label: 'Rejected', ico: '✕' },
    { id: 'disputed', label: 'Disputed', ico: '⚖' },
    { id: 'analytics', label: 'Analytics', ico: '∿' },
    { id: 'audit', label: 'Audit', ico: '◉', perm: 'audit.view' },
  ];
  const shell = initShell({ title: 'Supervisor', nav: NAV, active: tab, me, sim: ov.sim, portalTag: 'VERIFICATION PORTAL', onNav: setTab });
  function setTab(id) { tab = id; history.replaceState(null, '', `/supervisor?tab=${id}`); render(); }
  const liveRefresh = debounce(() => { refresh(); render(); }, 900);
  shell.onLive(liveRefresh);
  async function refresh() { try { ov = await API.get('/api/overview'); } catch (e) {} }

  async function loadQueue() {
    const res = await API.get('/api/results?election=e-gov-2027&limit=200');
    queue = res.rows.filter(r => ['SUBMITTED', 'UNDER_REVIEW', 'UNVERIFIED'].includes(r.status));
    if (qs.get('sub') && tab === 'queue') { openReview(qs.get('sub')); qs.delete('sub'); }
  }

  function render() { shell.main.innerHTML = ''; RENDERS[tab] ? RENDERS[tab]() : rQueue(); }

  // ---------- queue ----------
  function rQueue() {
    const k = ov.kpis;
    shell.main.appendChild(el(`<div class="kpis">
      ${kpiCard('Awaiting review', fmtN(k.pending), { cls: 'warn' })}
      ${kpiCard('Verified today', fmtN(k.verifiedPu), { cls: 'ok' })}
      ${kpiCard('Rejected', fmtN(k.rejected))}
      ${kpiCard('Disputed', fmtN(k.disputed), { cls: 'alert' })}
      ${kpiCard('Anomaly-flagged', fmtN(k.anomalies), { sub: 'dual-control candidate', cls: k.anomalies ? 'warn' : '' })}
      ${kpiCard('Avg review time', '—', { sub: 'per submission' })}
    </div>
    <div class="panel"><div class="ph"><span class="t">PENDING REVIEW</span><span class="sp"></span>
      <select class="inp" style="width:150px" id="qf"><option value="">All</option><option value="anomaly">Anomaly-flagged only</option></select>
    </div><div class="pb flat" id="qbody"><span class="dim small">Loading…</span></div></div>`));
    const draw = () => {
      const rows = filter === 'anomaly' ? queue.filter(r => r.anomalies?.length) : queue;
      const t = dataTable({
        cols: [
          { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'Ward', key: 'ward' }, { label: 'LGA', key: 'lga' },
          { label: 'Agent', key: 'agent' }, { label: 'Age', key: 'submittedAt', render: r => timeAgoWat(r.submittedAt, ov.sim.now) },
          { label: 'Flags', key: 'anomalies', render: r => r.anomalies?.length ? `<span class="badge l3">⚠ ${r.anomalies.length}</span>` : '—' },
          { label: 'Status', key: 'status', render: r => statusBadge(r.status) },
          { label: '', key: 'id', render: r => `<button class="btn sm primary" data-open="${r.id}">Review →</button>` },
        ],
        rows, sortable: true, pageSize: 15,
      });
      t.setTitle(`${rows.length} submission(s) in queue`);
      $('#qbody').innerHTML = ''; $('#qbody').appendChild(t.el);
      $$('[data-open]', $('#qbody')).forEach(x => x.onclick = () => openReview(x.dataset.open));
    };
    $('#qf').onchange = () => { filter = $('#qf').value; draw(); };
    draw();
  }

  // ---------- review screen (split) ----------
  async function openReview(id) {
    shell.main.innerHTML = '';
    shell.main.appendChild(el(`<div class="small muted mb12">← <a href="#" id="backq">Back to queue</a></div>`));
    $('#backq').onclick = (e) => { e.preventDefault(); setTab('queue'); };
    const sub = await API.get('/api/results/' + id);
    const cands = sub.candidates || [];
    const itemsById = Object.fromEntries(sub.items.map(i => [i.candidateId, i.votes]));
    const wrap = el(`<div class="grid2" style="align-items:start">
      <div class="panel"><div class="ph"><span class="t">📄 ORIGINAL EC8A DOCUMENT</span><span class="sub">immutable evidence · SHA-256 ${(sub.evidence?.[0]?.sha256 || '').slice(0, 14)}…</span></div>
      <div class="pb"><div id="docbox"><span class="dim small">Rendering document…</span></div></div></div>
      <div>
        <div class="panel"><div class="ph"><span class="t">EXTRACTED RESULT DATA</span><span class="sp"></span>${statusBadge(sub.status)}</div>
        <div class="pb">
          <div class="small muted mb12"><b>${esc(sub.election?.name || sub.electionId)}</b><br>
            ${esc(sub.pu?.name || sub.puId)} · ${esc(sub.ward)} · ${esc(sub.lga)} LGA<br>
            Agent: ${esc(sub.agentId)} · GPS ${sub.pu?.lat}, ${sub.pu?.lon} · Submitted ${fmtWatShort(sub.submittedAt)}</div>
          <table class="tbl"><tr><th>Candidate</th><th>Party</th><th class="num">Votes</th><th class="num">OCR conf.</th></tr>
          ${cands.map(c => { const v = itemsById[c.id] ?? 0; const conf = (sub.ocr?.confidences || [])[cands.indexOf(c)] ?? null;
            return `<tr><td class="small">${esc(c.name)}</td><td><span style="color:${c.color}">${esc(c.party)}</span></td><td class="num mono">${fmtN(v)}</td>
            <td class="num" style="color:${conf == null ? '#566781' : conf < 75 ? '#f59e0b' : conf < 90 ? '#fcd34d' : '#4ade80'}">${conf == null ? '—' : conf + '%'}</td></tr>`; }).join('')}
          <tr><td class="small muted">Total valid votes</td><td></td><td class="num mono"><b>${fmtN(sub.validVotes)}</b></td><td></td></tr>
          <tr><td class="small muted">Rejected ballots</td><td></td><td class="num mono">${fmtN(sub.rejected)}</td><td></td></tr>
          <tr><td class="small muted">Accredited</td><td></td><td class="num mono">${fmtN(sub.accredited)}</td><td></td></tr>
          <tr><td class="small muted">Registered</td><td></td><td class="num mono">${fmtN(sub.registered)}</td><td></td></tr></table>
          ${(sub.anomalies || []).length ? `<div class="mt12">${sub.anomalies.map(a => `<div class="badge l3 mb12">⚠ ${esc(a.label)} — ${esc(a.detail)}</div>`).join('')}</div>` : ''}
        </div></div>
        ${sub.review && sub.review.requiresSecond ? dualPanel(sub) : reviewActions(sub, cands)}
        <div class="panel mt12"><div class="ph"><span class="t">CHAIN OF CUSTODY</span></div>
        <div class="pb"><div class="feed" style="max-height:180px">
          ${(sub.custodies || []).map(c => `<div class="item"><span class="t">${fmtWatShort(c.at)}</span><span class="tx"><b>${esc(c.step)}</b> ${esc(c.note || '')} <span class="dim">(${esc(c.by)})</span></span></div>`).join('')}
          ${(sub.evidence || []).map(e => `<div class="item"><span class="t">${fmtWatShort(e.capturedAt)}</span><span class="tx">EVIDENCE ${esc(e.kind)} · SHA-256 ${esc(e.sha256.slice(0, 18))}… · ${fmtN(e.sizeBytes)} bytes · ${e.pages} page(s)</span></div>`).join('')}
        </div></div></div>
        ${sub.versions?.length ? `<div class="panel mt12"><div class="ph"><span class="t">VERSION HISTORY</span></div><div class="pb small">
          ${sub.versions.map(v => `<div class="mb12"><b>VERSION ${v.no}</b> — ${esc(v.reason)} · by ${esc(v.by)} · ${fmtWatShort(v.at)}<br><span class="muted">Approved by ${esc(v.approvedBy)} (four-eyes)</span></div>`).join('')}</div></div>` : ''}
      </div>
    </div>`);
    shell.main.appendChild(wrap);
    // render document
    const docbox = $('#docbox', wrap);
    const ev = sub.evidence?.[0];
    if (ev && ev.dataUrl) {
      docbox.innerHTML = `<img src="${ev.dataUrl}" style="width:100%;border-radius:6px;border:1px solid var(--line2)"><div class="small muted mt8">Original capture preserved unmodified. Processed previews never replace the original.</div>`;
    } else {
      const cv = el('<canvas width="640" height="380" style="width:100%;border-radius:6px;border:1px solid var(--line2)"></canvas>');
      docbox.appendChild(cv);
      drawEc8a(cv, {
        pu: sub.puId, ward: sub.ward, lga: sub.lga, election: sub.election?.name || '',
        candidates: cands.map(c => ({ name: c.name, party: c.party, votes: itemsById[c.id] ?? 0 })),
        valid: sub.validVotes, rejected: sub.rejected, accredited: sub.accredited, registered: sub.registered,
        page: 1, docId: ev?.sha256?.slice(0, 12) || sub.id.slice(0, 10),
      });
      docbox.appendChild(el('<div class="small muted mt8">Simulated EC8A reconstruction (SIM submissions carry no image — LIVE submissions store the original capture).</div>'));
    }
  }
  function dualPanel(sub) {
    const d = el(`<div class="panel" style="border-color:#78350f"><div class="ph"><span class="t">👥 DUAL-CONTROL VERIFICATION REQUIRED</span></div>
      <div class="pb small">
        <div class="muted mb12">First review: <b>${esc(sub.review.reviewerName)}</b> at ${fmtWatShort(sub.review.at)} — flagged for independent second review.<br>
        A <b>different</b> supervisor must confirm. Both identities and timestamps are preserved.</div>
        <div class="row">
          <button class="btn success" data-sec="CONFIRM">✓ Confirm (second reviewer)</button>
          <button class="btn danger" data-sec="DECLINE">✕ Decline → dispute</button>
        </div>
      </div></div>`);
    $$('[data-sec]', d).forEach(btn => btn.onclick = async () => {
      try {
        const res = await API.post(`/api/results/${sub.id}/second-review`, { action: btn.dataset.sec, reason: btn.dataset.sec === 'DECLINE' ? 'Second reviewer declined confirmation' : '' });
        toast('Dual control complete', `Submission now ${res.status}`);
        openReview(sub.id);
      } catch (e) { toast('Dual control', e.message, 'high'); }
    });
    return d;
  }
  function reviewActions(sub, cands) {
    const d = el(`<div class="panel mt12"><div class="ph"><span class="t">SUPERVISOR DECISION</span></div>
      <div class="pb"><div class="row" style="flex-wrap:wrap">
        <button class="btn success" data-act="APPROVE">✓ APPROVE</button>
        <button class="btn danger" data-act="REJECT">✕ REJECT</button>
        <button class="btn" data-act="REQUEST_CLARIFICATION">? Request clarification</button>
        <button class="btn warn" data-act="FLAG_SECOND_REVIEW">👥 Flag for second review</button>
        <button class="btn" data-act="MARK_DISPUTED" style="border-color:#4c1d95">⚖ Mark disputed</button>
      </div></div></div>`);
    $$('[data-act]', d).forEach(btn => btn.onclick = () => {
      const act = btn.dataset.act;
      const needReason = ['REJECT', 'MARK_DISPUTED'].includes(act);
      if (needReason || act === 'REQUEST_CLARIFICATION' || act === 'FLAG_SECOND_REVIEW') {
        const m = modal({
          title: `Confirm ${act.replace(/_/g, ' ').toLowerCase()}`,
          body: () => el(`<div>
            <div class="small muted mb12">${needReason ? 'A documented reason is mandatory and becomes part of the audit trail.' : 'Add an optional note for the record.'}</div>
            <label class="fl">Reason / note${needReason ? ' *' : ''}</label>
            <textarea class="inp" id="reason" rows="3" placeholder="${needReason ? 'e.g. Illegible document capture' : 'Optional note'}"></textarea>
            ${act === 'FLAG_SECOND_REVIEW' ? '<div class="small muted mt8">A different supervisor must independently confirm before this result can be VERIFIED.</div>' : ''}
          </div>`),
          actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Confirm action', cls: act === 'APPROVE' ? 'success' : act === 'REJECT' ? 'danger' : 'primary', onClick: async () => {
            const reason = $('#reason').value.trim();
            if (needReason && !reason) return toast('Reason required', 'Rejections and disputes require a documented reason.', 'high');
            try {
              const res = await API.post(`/api/results/${sub.id}/verify`, { action: act, reason, requireSecond: act === 'FLAG_SECOND_REVIEW' ? true : undefined });
              toast('Review recorded', `${sub.puId} → ${res.status}`);
              refresh(); openReview(sub.id);
            } catch (e) { toast('Review failed', e.message, 'high'); }
          } }],
        });
      } else {
        API.post(`/api/results/${sub.id}/verify`, { action: act }).then(res => { toast('Approved', `${sub.puId} → ${res.status}`); refresh(); openReview(sub.id); }).catch(e => toast('Review failed', e.message, 'high'));
      }
    });
    return d;
  }

  // ---------- lists ----------
  async function rList(status, title) {
    const res = await API.get(`/api/results?election=e-gov-2027&status=${status}&limit=200`);
    const t = dataTable({
      cols: [
        { label: 'PU', key: 'puId', cls: 'mono' }, { label: 'LGA', key: 'lga' }, { label: 'Agent', key: 'agent' },
        { label: 'Valid', key: 'validVotes', cls: 'num' }, { label: 'Submitted', key: 'submittedAt', render: r => fmtWatShort(r.submittedAt) },
        { label: '', key: 'id', render: r => `<button class="btn sm" data-open="${r.id}">Open</button>` },
      ],
      rows: res.rows, sortable: true, pageSize: 20,
    });
    t.setTitle(title);
    shell.main.appendChild(t.el);
    $$('[data-open]', shell.main).forEach(x => x.onclick = () => openReview(x.dataset.open));
  }
  function rApproved() { rList('VERIFIED', 'APPROVED SUBMISSIONS'); }
  function rRejected() { rList('REJECTED', 'REJECTED SUBMISSIONS'); }
  function rDisputed() { rList('DISPUTED', 'DISPUTED SUBMISSIONS'); }

  // ---------- dual control list ----------
  function rDual() {
    const rows = ov.queue.filter(s => s.anomalies?.length);
    shell.main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">👥 TWO-PERSON VERIFICATION</span><span class="sub">high-risk & disputed results require two independent reviewers</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>PU</th><th>LGA</th><th>Election</th><th>Flags</th><th></th></tr>
    ${rows.map(s => `<tr><td class="mono">${esc(s.puId)}</td><td>${esc(s.lga)}</td><td>${esc(s.election)}</td><td>${s.anomalies.map(a => `<span class="badge l3">${esc(a)}</span>`).join(' ')}</td><td><button class="btn sm primary" data-open="${s.id}">Review →</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No anomaly-flagged submissions pending</td></tr>'}
    </table></div></div>`));
    $$('[data-open]', shell.main).forEach(x => x.onclick = () => openReview(x.dataset.open));
  }

  // ---------- analytics ----------
  function rAnalytics() {
    shell.main.appendChild(el(`<div class="grid3" id="sgrid"><span class="dim small">Loading…</span></div>`));
    (async () => {
      const ver = await API.get('/api/analytics/timeseries?metric=verifications&bucket=30');
      const revs = (await API.get('/api/verification/stats')).rows;
      const lbl = ver.series.map(p => { const d = new Date(p.t + 3600e3); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; });
      const acts = { APPROVE: 0, REJECT: 0, DISPUTE: 0, FLAG_SECOND_REVIEW: 0, REQUEST_CLARIFICATION: 0 };
      revs.forEach(r => { if (acts[r.action] != null) acts[r.action]++; });
      const byReviewer = {};
      revs.forEach(r => byReviewer[r.reviewer] = (byReviewer[r.reviewer] || 0) + 1);
      $('#sgrid').innerHTML = `
        <div class="panel"><div class="ph"><span class="t">Verifications per 30 min</span></div><div class="pb chart-box">${lineChart({ series: [{ data: ver.series.map(p => p.count), color: '#22c55e' }], labels: lbl, h: 150, color: '#22c55e' })}</div></div>
        <div class="panel"><div class="ph"><span class="t">Review actions</span></div><div class="pb chart-box">${donutChart({ segments: [{ label: 'Approved', value: acts.APPROVE, color: '#22c55e' }, { label: 'Rejected', value: acts.REJECT, color: '#ef4444' }, { label: 'Disputed', value: acts.DISPUTE, color: '#a78bfa' }, { label: 'Flagged 2nd review', value: acts.FLAG_SECOND_REVIEW, color: '#f59e0b' }], w: 220, h: 160, centerLabel: 'reviews', centerValue: revs.length })}</div></div>
        <div class="panel"><div class="ph"><span class="t">Reviewer workload</span></div><div class="pb chart-box">${barChart({ data: Object.values(byReviewer), labels: Object.keys(byReviewer).map(n => n.split(' ')[0]), h: 150, color: '#38bdf8' })}</div></div>`;
    })();
  }

  // ---------- audit ----------
  function rAudit() {
    shell.main.appendChild(el('<div class="panel"><div class="ph"><span class="t">VERIFICATION AUDIT TRAIL</span></div><div class="pb flat" id="abody"><span class="dim small">Loading…</span></div></div>'));
    API.get('/api/audit?limit=120').then(res => {
      const rows = res.rows.filter(a => a.action.startsWith('RESULT'));
      const t = dataTable({
        cols: [
          { label: 'Time', key: 'createdAt', render: r => `<span class="mono small">${fmtWat(r.createdAt)}</span>` },
          { label: 'User', key: 'username' }, { label: 'Action', key: 'action', render: r => `<span class="badge s-submitted">${esc(r.action)}</span>` },
          { label: 'PU', key: 'objectId', cls: 'mono' }, { label: 'Detail', key: 'detail', render: r => `<span class="muted small">${esc((r.detail || '').slice(0, 60))}</span>` },
          { label: 'IP', key: 'ip', cls: 'mono' },
        ],
        rows, sortable: true, pageSize: 25,
      });
      t.setTitle(`${rows.length} verification-related records`);
      $('#abody').innerHTML = ''; $('#abody').appendChild(t.el);
    });
  }

  const RENDERS = { queue: rQueue, review: () => rQueue(), dual: rDual, approved: rApproved, rejected: rRejected, disputed: rDisputed, analytics: rAnalytics, audit: rAudit };
  await loadQueue();
  render();
})();
