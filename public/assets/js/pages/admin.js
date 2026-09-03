// admin.js — SUPER ADMINISTRATION PORTAL
'use strict';
(async () => {
  const { user: me, b, o } = await bootPortal('Super Administration Portal', 'Administrator', { username: 'superadmin', password: 'Admin@123!' });
  const bootstrap = b; let ov = o;
  let tab = 'dashboard';

  const NAV = [
    { id: 'dashboard', label: 'Dashboard', ico: '◈', section: 'Governance' },
    { id: 'users', label: 'Users', ico: '👤' },
    { id: 'roles', label: 'Roles & Permissions', ico: '🔐' },
    { id: 'agents', label: 'Agent Assignment', ico: '🎖' },
    { id: 'devices', label: 'Device Management', ico: '📱' },
    { id: 'elections', label: 'Elections', ico: '🗳', section: 'Configuration' },
    { id: 'geography', label: 'Geography', ico: '🗺' },
    { id: 'candidates', label: 'Candidates & Parties', ico: '🏛' },
    { id: 'config', label: 'System Configuration', ico: '⚙' },
    { id: 'security', label: 'Security', ico: '🛡', section: 'Operations' },
    { id: 'audit', label: 'Audit', ico: '◉' },
    { id: 'health', label: 'System Health', ico: '📊' },
    { id: 'sim', label: 'Simulation Control', ico: '🎬' },
    { id: 'integrations', label: 'Integrations', ico: '🔌' },
  ];
  const shell = initShell({ title: 'Admin', nav: NAV, active: tab, me, sim: ov.sim, portalTag: 'ADMINISTRATION', onNav: setTab });
  function setTab(id) { tab = id; render(); }
  async function refresh() { try { ov = await API.get('/api/overview'); } catch (e) {} }

  function render() { shell.main.innerHTML = ''; RENDERS[tab] ? RENDERS[tab]() : rDashboard(); }

  function rDashboard() {
    const k = ov.kpis;
    shell.main.appendChild(el(`<div class="kpis">
      ${kpiCard('Users', fmtN(bootstrap.users.length), { sub: 'accounts configured' })}
      ${kpiCard('Agents', fmtN(k.agentsTotal), { sub: 'field operatives' })}
      ${kpiCard('Devices', '—', { sub: 'registered endpoints' })}
      ${kpiCard('Polling units', fmtN(k.totalPu), { sub: 'configured' })}
      ${kpiCard('Active elections', fmtN(bootstrap.elections.filter(e => e.status === 'ACTIVE').length), { cls: 'ok' })}
      ${kpiCard('Audit records', '—', { sub: 'immutable log' })}
    </div>
    <div class="grid2">
      <div class="panel"><div class="ph"><span class="t">PENDING CORRECTIONS (four-eyes)</span><span class="sub">require second authorization</span></div>
      <div class="pb" id="chgbox"><span class="dim small">Loading…</span></div></div>
      <div class="panel"><div class="ph"><span class="t">SYSTEM ANNOUNCEMENT</span><span class="sub">broadcast to all roles</span></div>
      <div class="pb">
        <div class="small muted mb12" id="curann">Current: ${esc(ov.config.announcement)}</div>
        <textarea class="inp" id="ann" rows="3" placeholder="New announcement…"></textarea>
        <div class="row mt12"><button class="btn primary" id="annsend">Publish announcement</button><label class="flex"><input type="checkbox" id="anncrit"> Critical priority</label></div>
      </div></div>
    </div>`));
    API.get('/api/admin/changes').then(res => {
      $('#chgbox').innerHTML = res.rows.length ? res.rows.map(c => `
        <div class="panel mb12"><div class="pb small">
          <b>${esc(c.puId)}</b> (${esc(c.lga)}) — proposed by ${esc(c.proposedByName)}<br>
          <span class="muted">“${esc(c.reason)}” · changes: ${JSON.stringify(c.changes)}</span>
          <div class="row mt8"><button class="btn success sm" data-app="${c.id}">✓ Approve (second authorizer)</button></div>
        </div></div>`).join('') : '<div class="empty small">No pending corrections</div>';
      $$('[data-app]', $('#chgbox')).forEach(x => x.onclick = async () => {
        try { await API.post(`/api/changes/${x.dataset.app}/approve`, {}); toast('Correction applied', 'New version recorded'); refresh(); render(); }
        catch (e) { toast('Approval failed', e.message, 'high'); }
      });
    }).catch(() => { $('#chgbox').innerHTML = '<div class="empty small">—</div>'; });
    $('#annsend').onclick = async () => {
      await API.post('/api/admin/announcement', { text: $('#ann').value, critical: $('#anncrit').checked });
      toast('Announcement published', 'Delivered to all roles');
      refresh(); render();
    };
  }

  function rUsers() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">USER MANAGEMENT</span><span class="sp"></span><button class="btn primary sm" id="newuser">＋ Create user</button></div>
    <div class="pb flat"><table class="tbl"><tr><th>Username</th><th>Name</th><th>Role</th><th>Scope</th><th>Status</th><th>MFA</th><th>Last login</th><th></th></tr>
    ${bootstrap.users.map(u => `<tr><td class="mono">${esc(u.username)}</td><td>${esc(u.name)}</td><td>${esc(u.roleName)}</td><td class="small muted">${u.scope ? esc(u.scope.lga || u.scope.senatorial || '') : 'statewide'}</td>
    <td>${u.status === 'ACTIVE' ? '<span class="badge s-verified">ACTIVE</span>' : '<span class="badge s-rejected">DISABLED</span>'}</td>
    <td>${u.totpEnrolled ? '<span class="badge s-verified">TOTP</span>' : (u.mfa ? '✓' : '—')}</td>
    <td class="small muted">${u.lastLoginAt ? fmtWatShort(u.lastLoginAt) : 'never'}</td>
    <td><button class="btn sm" data-edit="${u.id}">Manage</button></td></tr>`).join('')}
    </table></div></div>`);
    shell.main.appendChild(wrap);
    $('#newuser', wrap).onclick = () => {
      const m = modal({
        title: 'Create user',
        body: () => el(`<div>
          <label class="fl">Username</label><input class="inp" id="nu">
          <label class="fl">Full name</label><input class="inp" id="nn">
          <label class="fl">Password</label><input class="inp" id="np" type="text">
          <label class="fl">Role</label><select class="inp" id="nr">${bootstrap.roles.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</select>
          <label class="fl">Scope (optional: LGA name or senatorial district)</label><input class="inp" id="nsc" placeholder="e.g. Nasarawa">
        </div>`),
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create', cls: 'primary', onClick: async () => {
          const scope = $('#nsc').value.trim();
          const isSen = bootstrap.senatorial.includes(scope);
          await API.post('/api/admin/users', { username: $('#nu').value.trim(), name: $('#nn').value.trim(), password: $('#np').value, roleId: $('#nr').value, scope: scope ? (isSen ? { senatorial: scope } : { lga: scope }) : {} });
          toast('User created', $('#nu').value);
          location.reload();
        } }],
      });
    };
    $$('[data-edit]', wrap).forEach(x => x.onclick = () => {
      const u = bootstrap.users.find(y => y.id === x.dataset.edit);
      const m = modal({
        title: `Manage ${u.username}`,
        body: () => el(`<div>
          <div class="small muted mb12">${esc(u.name)} · ${esc(u.roleName)} · ${u.totpEnrolled ? 'TOTP MFA enrolled' : 'no TOTP'}</div>
          <label class="fl">Status</label><select class="inp" id="ust"><option value="ACTIVE" ${u.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option><option value="DISABLED" ${u.status === 'DISABLED' ? 'selected' : ''}>DISABLED</option></select>
          <label class="fl">Role</label><select class="inp" id="url">${bootstrap.roles.map(r => `<option value="${r.id}" ${r.id === u.roleId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
          <label class="fl">Reset password (optional)</label><input class="inp" id="upw" type="text" placeholder="min 8 chars · letters + numbers">
          <div class="small dim mt4">Password changes sign the user out of all sessions (M2).</div>
          <div class="row mt8"><button class="btn sm warn" id="urevoke">⛔ REVOKE ALL SESSIONS</button></div>
        </div>`),
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save', cls: 'primary', onClick: async () => {
          $('#urevoke', m.body).onclick = async () => {
            const r = await API.post('/api/admin/users/' + u.id + '/revoke-sessions', {});
            toast('Sessions revoked', `${r.revoked} session(s) signed out — audited.`);
          };
          const body = { status: $('#ust').value, roleId: $('#url').value };
          if ($('#upw').value) body.password = $('#upw').value;
          await API.patch(`/api/admin/users/${u.id}`, body);
          toast('User updated', u.username);
          location.reload();
        } }],
      });
    });
  }

  function rRoles() {
    const perms = [...new Set(bootstrap.roles.flatMap(r => r.permissions))];
    shell.main.appendChild(el(`<div class="panel"><div class="ph"><span class="t">ROLES & GRANULAR PERMISSIONS</span><span class="sub">strict RBAC — enforced server-side on every endpoint</span></div>
    <div class="pb flat"><table class="tbl"><tr><th>Role</th>${perms.map(p => `<th style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:8.5px">${esc(p)}</th>`).join('')}</tr>
    ${bootstrap.roles.map(r => `<tr><td><b>${esc(r.name)}</b></td>${perms.map(p => `<td class="center"><input type="checkbox" data-role="${r.id}" data-p="${esc(p)}" ${r.permissions.includes(p) ? 'checked' : ''}></td>`).join('')}</tr>`).join('')}
    </table></div></div>`));
    shell.main.appendChild(el('<div class="small muted">Changes apply immediately. Backend authorization never relies on frontend permissions alone.</div>'));
    $$('[data-role]', shell.main).forEach(cb => cb.onchange = async () => {
      const role = bootstrap.roles.find(r => r.id === cb.dataset.role);
      const permsList = $$(`[data-role="${role.id}"]`, shell.main).filter(x => x.checked).map(x => x.dataset.p);
      try {
        await API.patch(`/api/admin/roles/${role.id}`, { permissions: permsList });
        toast('Role updated', `${role.name} — ${permsList.length} permissions`);
      } catch (e) { toast('Error', e.message, 'high'); }
    });
  }

  function rAgents() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">AGENT ASSIGNMENT ENGINE</span><span class="sub">Agent → PU → Ward → LGA → Senatorial · reassignments are audit-logged</span><span class="sp"></span>
    <select class="inp" style="width:170px" id="alga"><option value="">All LGAs</option>${bootstrap.lgas.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
    <input class="inp" style="width:170px" id="aq" placeholder="Search agent…"></div>
    <div class="pb flat" id="abody"><span class="dim small">Loading…</span></div></div>`);
    shell.main.appendChild(wrap);
    const load = debounce(async () => {
      const p = new URLSearchParams({ limit: '100' });
      if ($('#alga', wrap).value) p.set('lga', $('#alga', wrap).value);
      if ($('#aq', wrap).value) p.set('q', $('#aq', wrap).value);
      const res = await API.get('/api/agents?' + p.toString());
      $('#abody', wrap).innerHTML = `<table class="tbl"><tr><th>Code</th><th>Name</th><th>PU</th><th>LGA</th><th>Duty</th><th></th></tr>
      ${res.rows.map(a => `<tr><td class="mono">${esc(a.code)}</td><td>${esc(a.name)}</td><td class="mono">${esc(a.puId)}</td><td>${esc(a.lga)}</td><td>${statusBadge(a.dutyState)}</td>
      <td><button class="btn sm" data-reassign="${a.id}">Reassign</button></td></tr>`).join('')}</table>`;
      $$('[data-reassign]', wrap).forEach(x => x.onclick = () => {
        const agent = res.rows.find(a => a.id === x.dataset.reassign);
        const m = modal({
          title: `Reassign ${agent.code} — ${agent.name}`,
          body: () => el(`<div>
            <div class="small muted mb12">Currently at <b>${esc(agent.puId)}</b> (${esc(agent.lga)}). Reassignment prevents unauthorized changes and creates an audit record.</div>
            <label class="fl">New polling unit</label>
            <select class="inp" id="npu">${bootstrap.lgas.map(l => `<optgroup label="${esc(l.name)}">${bootstrap.pus.filter(p => p.lgaId === l.id).slice(0, 30).map(p => `<option value="${p.id}">${esc(p.code)} — ${esc(p.name)}</option>`).join('')}</optgroup>`).join('')}</select>
          </div>`),
          actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Reassign (audited)', cls: 'primary', onClick: async () => {
            try {
              await API.post(`/api/admin/agents/${agent.id}/assign`, { puId: $('#npu').value });
              toast('Agent reassigned', `${agent.code} → ${$('#npu').value}`);
              load();
            } catch (e) { toast('Reassignment blocked', e.message, 'high'); }
          } }],
        });
      });
    }, 300);
    ['alga', 'aq'].forEach(id => $('#' + id, wrap).addEventListener('input', load));
    load();
  }

  function rDevices() {
    const wrap = el('<div class="panel"><div class="ph"><span class="t">DEVICE MANAGEMENT</span><span class="sub">register · approve · revoke · lock</span></div><div class="pb flat" id="db"><span class="dim small">Loading…</span></div></div>');
    shell.main.appendChild(wrap);
    API.get('/api/admin/devices').then(res => {
      $('#db', wrap).innerHTML = `<table class="tbl"><tr><th>Agent</th><th>Model</th><th>OS</th><th>IMEI</th><th>Status</th><th></th></tr>
      ${res.rows.map(d => `<tr><td>${esc(d.agent || '—')}</td><td>${esc(d.model)}</td><td>${esc(d.os)}</td><td class="mono">${esc(d.imei)}</td><td>${statusBadge(d.status)}</td>
      <td>${['APPROVED', 'REVOKED', 'LOCKED'].filter(s => s !== d.status).map(s => `<button class="btn sm ${s === 'REVOKED' || s === 'LOCKED' ? 'danger' : 'success'}" data-s="${s}" data-id="${d.id}">${s.toLowerCase()}</button>`).join(' ')}</td></tr>`).join('')}
      </table>`;
      $$('[data-s]', wrap).forEach(x => x.onclick = async () => {
        await API.post(`/api/admin/devices/${x.dataset.id}/status`, { status: x.dataset.s });
        toast('Device updated', x.dataset.s);
        render();
      });
    });
  }

  function rElections() {
    const wrap = el(`<div class="panel"><div class="ph"><span class="t">ELECTION CONFIGURATION</span><span class="sp"></span><button class="btn primary sm" id="newe">＋ New election</button></div>
    <div class="pb flat"><table class="tbl"><tr><th>Name</th><th>Type</th><th>Scope</th><th>Date</th><th>Status</th><th>Candidates</th><th></th></tr>
    ${bootstrap.elections.map(e => `<tr><td>${esc(e.name)}</td><td>${esc(e.type)}</td><td>${esc(e.scope)}</td><td>${esc(e.date)}</td><td>${statusBadge(e.status)}</td><td class="num">${bootstrap.candidates.filter(c => c.electionId === e.id).length}</td>
    <td>${e.status === 'ACTIVE' ? `<button class="btn sm warn" data-close="${e.id}">Close</button>` : `<button class="btn sm success" data-act="${e.id}">Activate</button>`}</td></tr>`).join('')}
    </table></div></div>`);
    shell.main.appendChild(wrap);
    $$('[data-act], [data-close]', wrap).forEach(x => x.onclick = async () => {
      await API.patch(`/api/admin/elections/${x.dataset.act || x.dataset.close}`, { status: x.dataset.act ? 'ACTIVE' : 'CLOSED' });
      toast('Election updated'); location.reload();
    });
    $('#newe', wrap).onclick = () => {
      const m = modal({
        title: 'Create election',
        body: () => el(`<div>
          <label class="fl">Name</label><input class="inp" id="ename" placeholder="e.g. Kano LG Elections 2028">
          <label class="fl">Type</label><select class="inp" id="etype">${['GOVERNORSHIP', 'PRESIDENTIAL', 'SENATE', 'HOUSE_OF_REPS', 'STATE_ASSEMBLY', 'LG'].map(t => `<option>${t}</option>`).join('')}</select>
          <label class="fl">Scope</label><input class="inp" id="escope" value="Kano State">
          <div class="small muted mt8">Candidates can be added after creation.</div>
        </div>`),
        actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Create', cls: 'primary', onClick: async () => {
          await API.post('/api/admin/elections', { name: $('#ename').value, type: $('#etype').value, scope: $('#escope').value });
          toast('Election created'); location.reload();
        } }],
      });
    };
  }

  function rGeography() {
    shell.main.appendChild(el(`<div class="kpis">
      ${kpiCard('LGAs', '44')}${kpiCard('Wards', '504')}${kpiCard('Polling units', fmtN(ov.kpis.totalPu))}
      ${kpiCard('Senatorial districts', '3', { sub: 'Central · North · South' })}
    </div>
    <div class="panel"><div class="ph"><span class="t">GEOGRAPHIC HIERARCHY</span><span class="sub">Country → State → Senatorial → LGA → Ward → PU · Kano is the first deployment, not a hard-coded limit</span><span class="sp"></span>
    <select class="inp" style="width:170px" id="glga"><option value="">All LGAs</option>${bootstrap.lgas.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></div>
    <div class="pb flat" id="gbody"></div></div>`));
    const draw = () => {
      const lga = $('#glga').value;
      const pus = lga ? bootstrap.pus.filter(p => p.lgaId === lga) : bootstrap.pus.slice(0, 80);
      const rows = pus.map(p => ({ ...p, ward: bootstrap.wards.find(w => w.id === p.wardId)?.name, lga: bootstrap.lgas.find(l => l.id === p.lgaId)?.name }));
      const t = dataTable({
        cols: [
          { label: 'Code', key: 'code', cls: 'mono' }, { label: 'Name', key: 'name' }, { label: 'Ward', key: 'ward' }, { label: 'LGA', key: 'lga' },
          { label: 'Lat', key: 'lat', cls: 'num' }, { label: 'Lon', key: 'lon', cls: 'num' },
          { label: '', key: 'code', render: r => `<button class="btn sm" data-rn="${r.code}">Rename</button>` },
        ],
        rows, sortable: true, pageSize: 25,
      });
      t.setTitle(lga ? `Polling units — ${bootstrap.lgas.find(l => l.id === lga)?.name}` : 'Polling units (first 80)');
      $('#gbody').innerHTML = ''; $('#gbody').appendChild(t.el);
      $$('[data-rn]', $('#gbody')).forEach(x => x.onclick = () => {
        const pu = rows.find(r => r.code === x.dataset.rn);
        const m = modal({
          title: `Rename ${pu.code}`,
          body: () => el(`<label class="fl">New name</label><input class="inp" id="rn" value="${esc(pu.name)}">`),
          actions: [{ label: 'Cancel', cls: 'ghost' }, { label: 'Save (audited)', cls: 'primary', onClick: async () => {
            await API.patch(`/api/admin/pus/${pu.code}`, { name: $('#rn').value });
            toast('PU renamed'); draw();
          } }],
        });
      });
    };
    $('#glga').onchange = draw;
    draw();
  }

  function rCandidates() {
    shell.main.appendChild(el(`<div class="grid2">
      <div class="panel"><div class="ph"><span class="t">PARTIES</span><span class="sub">fictional demo parties</span></div>
      <div class="pb flat"><table class="tbl"><tr><th>Code</th><th>Name</th></tr>
      ${bootstrap.parties.map(p => `<tr><td><span class="badge" style="border-color:${p.color};color:${p.color}">${esc(p.code)}</span></td><td>${esc(p.name)}</td></tr>`).join('')}</table></div></div>
      <div class="panel"><div class="ph"><span class="t">CANDIDATES</span><span class="sub">active elections</span></div>
      <div class="pb flat" style="max-height:500px;overflow:auto"><table class="tbl"><tr><th>Election</th><th>Candidate</th><th>Party</th></tr>
      ${bootstrap.candidates.map(c => { const e = bootstrap.elections.find(x => x.id === c.electionId); const p = bootstrap.parties.find(x => x.id === c.partyId);
        return `<tr><td class="small muted">${esc((e?.name || '').slice(0, 34))}</td><td>${esc(c.name)}</td><td><span style="color:${p?.color}">${esc(p?.code)}</span></td></tr>`; }).join('')}</table></div></div>
    </div>
    <div class="small muted mt8">All party and candidate records are fictional demonstration data. No fictional candidate results are ever presented as real election results.</div>`));
  }

  function rConfig() {
    shell.main.appendChild(el(`<div class="grid2">
      <div class="panel"><div class="ph"><span class="t">BRANDING & PLATFORM CONFIGURATION</span></div>
      <div class="pb">
        <label class="fl">Organisation name</label><input class="inp" id="c1" value="${esc(ov.config.orgName)}">
        <label class="fl">Platform name</label><input class="inp" id="c2" value="${esc(ov.config.platformName)}">
        <label class="fl">Tagline</label><input class="inp" id="c3" value="${esc(ov.config.tagline)}">
        <label class="fl">State / deployment</label><input class="inp" id="c4" value="${esc(ov.config.stateName)}">
        <div class="mt12"><button class="btn primary" id="savecfg">Save configuration (four-eyes note)</button></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">ELECTION PARAMETERS</span></div>
      <div class="pb">
        <label class="fl">Election day</label><input class="inp" id="c5" value="${esc(ov.config.electionDayWat)}">
        <label class="fl">Poll open (WAT)</label><input class="inp" id="c6" value="${esc(ov.config.pollOpen)}">
        <label class="fl">Poll close (WAT)</label><input class="inp" id="c7" value="${esc(ov.config.pollClose)}">
        <label class="fl">Evidence retention (days)</label><input class="inp" id="c8" type="number" value="${ov.config.retentionDays || 730}">
        <div class="small muted mt8">Critical election evidence is archived rather than deleted. Deletion requires authorization, reason, confirmation and an audit log.</div>
      </div></div>
    </div>`));
    $('#savecfg').onclick = async () => {
      await API.patch('/api/admin/config', { orgName: $('#c1').value, platformName: $('#c2').value, tagline: $('#c3').value, stateName: $('#c4').value, electionDayWat: $('#c5').value, pollOpen: $('#c6').value, pollClose: $('#c7').value, retentionDays: +$('#c8').value });
      toast('Configuration saved', 'Audited');
      refresh(); render();
    };
  }

  function rSecurity() {
    shell.main.appendChild(el(`<div class="grid3">
      <div class="panel"><div class="ph"><span class="t">AUTHENTICATION</span></div><div class="pb small">
        <div class="flex mb12"><span>MFA enforced</span><span class="right"><b style="color:#4ade80">✓ ON</b></span></div>
        <div class="flex mb12"><span>Password hashing</span><span class="right"><b>scrypt + salt</b></span></div>
        <div class="flex mb12"><span>Session TTL</span><span class="right"><b>12 h</b></span></div>
        <div class="flex mb12"><span>Brute-force lockout</span><span class="right"><b>5 fails / 5 min</b></span></div>
        <div class="flex"><span>Device binding</span><span class="right"><b>✓ agent devices</b></span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">API SECURITY</span></div><div class="pb small">
        <div class="flex mb12"><span>Rate limiting</span><span class="right"><b>400 req/min</b></span></div>
        <div class="flex mb12"><span>RBAC on every endpoint</span><span class="right"><b style="color:#4ade80">✓</b></span></div>
        <div class="flex mb12"><span>JWT/session rotation</span><span class="right"><b>✓</b></span></div>
        <div class="flex mb12"><span>IP/device anomaly monitoring</span><span class="right"><b>✓</b></span></div>
        <div class="flex"><span>Secrets management</span><span class="right"><b>env vault</b></span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">EVIDENCE SECURITY</span></div><div class="pb small">
        <div class="flex mb12"><span>SHA-256 fingerprints</span><span class="right"><b style="color:#4ade80">✓</b></span></div>
        <div class="flex mb12"><span>Immutable originals</span><span class="right"><b style="color:#4ade80">✓</b></span></div>
        <div class="flex mb12"><span>Chain of custody</span><span class="right"><b style="color:#4ade80">✓</b></span></div>
        <div class="flex mb12"><span>Anti-duplication</span><span class="right"><b style="color:#4ade80">✓ multi-level</b></span></div>
        <div class="flex"><span>Access & modification history</span><span class="right"><b style="color:#4ade80">✓</b></span></div>
      </div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">ACTIVE SESSIONS & ANOMALIES</span></div>
    <div class="pb small muted">Session store is in-memory for the prototype; production uses a replicated session service with device fingerprinting. IP/device anomaly events appear in the audit centre.</div></div>`));
  }

  function rAudit() {
    const wrap = el('<div class="panel"><div class="ph"><span class="t">IMMUTABLE AUDIT LOG</span><span class="sp"></span><input class="inp" style="width:200px" id="aq" placeholder="Search…"><button class="btn sm" id="aexp">Export</button></div><div class="pb flat" id="abody"><span class="dim small">Loading…</span></div></div>');
    shell.main.appendChild(wrap);
    const load = debounce(async () => {
      const res = await API.get('/api/audit?limit=120&q=' + encodeURIComponent($('#aq', wrap).value));
      const t = dataTable({
        cols: [
          { label: 'Time', key: 'createdAt', render: r => `<span class="mono small">${fmtWat(r.createdAt)}</span>` },
          { label: 'User', key: 'username' }, { label: 'Action', key: 'action', render: r => `<span class="badge s-submitted">${esc(r.action)}</span>` },
          { label: 'Object', key: 'objectId', cls: 'mono' }, { label: 'Detail', key: 'detail', render: r => `<span class="muted small">${esc((r.detail || '').slice(0, 60))}</span>` },
          { label: 'IP', key: 'ip', cls: 'mono' }, { label: 'Device', key: 'device', render: r => `<span class="muted small">${esc((r.device || '').slice(0, 24))}</span>` },
        ],
        rows: res.rows, sortable: true, pageSize: 30,
      });
      t.setTitle(`${res.total} records`);
      $('#abody', wrap).innerHTML = ''; $('#abody', wrap).appendChild(t.el);
    }, 300);
    $('#aq', wrap).addEventListener('input', load);
    $('#aexp', wrap).onclick = () => window.open('/api/export?type=audit&format=xlsx', '_blank');
    load();
  }

  function rHealth() {
    shell.main.appendChild(el('<div id="hw"><span class="dim small">Loading…</span></div>'));
    API.get('/api/system/health').then(h => {
      const svc = (n, v) => `<div class="kpi ${v === 'HEALTHY' ? 'ok' : v === 'CRITICAL' ? 'alert' : 'warn'}"><div class="l">${n}</div><div class="v" style="font-size:15px">${v}</div></div>`;
      $('#hw').innerHTML = `<div class="kpis">${svc('API', h.api)}${svc('Database', h.db)}${svc('Storage', h.storage)}${svc('Queue', h.queue)}${svc('WebSocket', h.websocket)}${svc('Video', h.video)}${svc('SMS', h.sms)}${svc('Notifications', h.notification)}</div>
      <div class="grid3">
        <div class="panel"><div class="ph"><span class="t">CPU</span></div><div class="pb"><div class="pbar"><div class="fill" style="width:${h.cpu}%"></div></div><b>${Math.round(h.cpu)}%</b></div></div>
        <div class="panel"><div class="ph"><span class="t">Memory</span></div><div class="pb"><div class="pbar"><div class="fill green" style="width:${h.memory}%"></div></div><b>${Math.round(h.memory)}%</b></div></div>
        <div class="panel"><div class="ph"><span class="t">API latency</span></div><div class="pb"><div class="pbar"><div class="fill amber" style="width:${Math.min(100, h.responseMs)}%"></div></div><b>${Math.round(h.responseMs)}ms</b></div></div>
      </div>`;
    });
  }

  function rSim() {
    shell.main.appendChild(el(`<div class="grid2">
      <div class="panel"><div class="ph"><span class="t">ELECTION-DAY SIMULATION</span><span class="sub">demonstrate the whole situation room without real data</span></div>
      <div class="pb">
        <div class="small muted mb12">Current: <b>${esc(ov.sim.scenario)}</b> · ${fmtWat(ov.sim.now)} · speed ${ov.sim.speed}× ${ov.sim.paused ? '(paused)' : ''}</div>
        <div class="row mb12" style="flex-wrap:wrap">
          ${Object.keys({ MORNING: 1, VOTING: 1, RESULTS: 1, EVENING: 1, NIGHT: 1 }).map(s => `<button class="btn ${ov.sim.scenario === s ? 'primary' : ''}" data-sc="${s}">${s.charAt(0) + s.slice(1).toLowerCase()}</button>`).join('')}
        </div>
        <label class="fl">Simulation speed</label>
        <select class="inp" id="spd"><option value="1">1× real time</option><option value="10">10×</option><option value="30">30×</option><option value="60">60×</option><option value="300">300×</option></select>
        <div class="row mt12"><button class="btn" id="pse">${ov.sim.paused ? '▶ Resume' : '⏸ Pause'}</button><button class="btn danger" id="rset">↺ Full reset (back to Collation Phase)</button></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">SCENARIOS</span></div>
      <div class="pb small muted" style="line-height:1.8">
        <b>Opening Phase (08:10)</b> — agents activate and check in; first incidents.<br>
        <b>Voting Phase (11:40)</b> — full field coverage; streams live; incidents flowing.<br>
        <b>Collation Phase (16:20)</b> — results arriving; verification queue active; SOS + critical incidents.<br>
        <b>Evening Phase (19:05)</b> — most results in; disputes forming.<br>
        <b>Post-Election (22:10)</b> — duty completion; archival; final reporting.<br><br>
        Every scenario instantly regenerates the full day's activity — dashboards, feeds, queues and the public portal all react together.
      </div></div>
    </div>`));
    $('#spd').value = String(ov.sim.speed);
    $('#spd').onchange = async () => { await API.post('/api/admin/simulation', { action: 'speed', value: +$('#spd').value }); toast('Speed updated', $('#spd').value + '×'); };
    $('#pse').onclick = async () => { await API.post('/api/admin/simulation', { action: 'pause', value: !ov.sim.paused }); location.reload(); };
    $$('[data-sc]').forEach(b => b.onclick = async () => {
      await API.post('/api/admin/simulation', { action: 'scenario', value: b.dataset.sc });
      toast('Scenario loaded', b.dataset.sc);
      setTimeout(() => location.reload(), 600);
    });
    $('#rset').onclick = () => confirmBox('Reset simulation', 'Wipes all dynamic election data and regenerates the Collation Phase scenario. Users and configuration are kept.', async () => {
      await API.post('/api/admin/simulation', { action: 'reset' });
      toast('Simulation reset');
      setTimeout(() => location.reload(), 600);
    }, 'Reset', 'danger');
  }

  function rIntegrations() {
    shell.main.appendChild(el(`<div class="grid3">
      <div class="panel"><div class="ph"><span class="t">SMS / MESSAGING</span></div><div class="pb small muted">
        <div class="flex mb12"><span>Termii / Twilio (SMS)</span><span class="right">status: DEGRADED</span></div>
        <div class="flex mb12"><span>WhatsApp Business API</span><span class="right">status: configured</span></div>
        <div class="flex"><span>Email (SMTP/relay)</span><span class="right">status: HEALTHY</span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">VIDEO PIPELINE</span></div><div class="pb small muted">
        <div class="flex mb12"><span>Ingest: WebRTC → RTMP</span><span class="right">simulated</span></div>
        <div class="flex mb12"><span>Transcode: adaptive bitrate HLS</span><span class="right">simulated</span></div>
        <div class="flex"><span>Delivery: signed URLs + DRM</span><span class="right">simulated</span></div>
      </div></div>
      <div class="panel"><div class="ph"><span class="t">GIS STACK</span></div><div class="pb small muted">
        <div class="flex mb12"><span>PostGIS + GeoJSON</span><span class="right">schema-ready</span></div>
        <div class="flex mb12"><span>Mapbox / MapLibre</span><span class="right">adapter-ready</span></div>
        <div class="flex"><span>Spatial indexing</span><span class="right">GiST planned</span></div>
      </div></div>
    </div>
    <div class="panel mt12"><div class="ph"><span class="t">WEBHOOKS & EVENT BUS</span></div><div class="pb small muted">
      The prototype ships with SSE realtime events. Production webhook targets (response teams, partner observers) register at <code>/api/integrations/webhooks</code> with signed payloads and replay support.</div></div>`));
  }

  const RENDERS = { dashboard: rDashboard, users: rUsers, roles: rRoles, agents: rAgents, devices: rDevices, elections: rElections, geography: rGeography, candidates: rCandidates, config: rConfig, security: rSecurity, audit: rAudit, health: rHealth, sim: rSim, integrations: rIntegrations };
  render();
})();
