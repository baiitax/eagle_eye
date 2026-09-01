// central20-test.js — drives CENTRAL SITUATION ROOM 2.0
let jsdomMod;
try { jsdomMod = require('jsdom'); }
catch (e) {
  try { jsdomMod = require('/tmp/uitest/node_modules/jsdom'); }
  catch (e2) { console.error('jsdom not found — run: npm install (repo) or cd /tmp/uitest && npm install jsdom'); process.exit(1); }
}
const { JSDOM, VirtualConsole } = jsdomMod;
const BASE = 'http://localhost:3000';
function canvasMock(){const g={addColorStop(){}};return{fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},fillText(){},closePath(){},save(){},restore(){},scale(){},translate(){},rotate(){},clearRect(){},drawImage(){},rect(){},setLineDash(){},createLinearGradient:()=>g,createRadialGradient:()=>g,createPattern:()=>g,measureText:()=>({width:10}),set fillStyle(v){},set strokeStyle(v){},set lineWidth(v){},set font(v){},set textAlign(v){},set globalAlpha(v){}};}
async function apiLogin(u,p){
  const l=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})}).then(r=>r.json());
  const m=await fetch(BASE+'/api/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:l.challenge,code:l.mfaCode})}).then(r=>r.json());
  const me=await fetch(BASE+'/api/me',{headers:{Authorization:'Bearer '+m.token}}).then(r=>r.json());
  return {token:m.token,me};
}
let pass=0, fail=0;
const ok=(name,cond,extra='')=>{ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ FAIL '+name+(extra?' — '+extra:''));} };

(async()=>{
  {
    const l=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'superadmin',password:'Admin@123!'})}).then(r=>r.json());
    const m=await fetch(BASE+'/api/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:l.challenge,code:l.mfaCode})}).then(r=>r.json());
    await fetch(BASE+'/api/admin/simulation',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+m.token},body:JSON.stringify({action:'scenario',value:'RESULTS'})});
    console.log('(simulation reset to Collation Phase)');
  }
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message.split('\n')[0]));
  vc.on('error',(...a)=>errors.push(String(a[0]).slice(0,140)));
  const auth=await apiLogin('director','Director@123!');
  const html=await fetch(BASE+'/central').then(r=>r.text());
  const dom=new JSDOM(html,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.localStorage.setItem('ndc_token',auth.token);w.localStorage.setItem('ndc_user',JSON.stringify(auth.me.user));w.localStorage.setItem('ndc_perms',JSON.stringify(auth.me.permissions));}});
  const w=dom.window;
  w.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
  w.EventSource=class{constructor(u){}close(){}};
  w.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
  w.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
  w.requestAnimationFrame=(fn)=>setTimeout(fn,50);
  w.cancelAnimationFrame=(t)=>clearTimeout(t);
  w.addEventListener('error',e=>errors.push('winerr: '+(e.message||'')));
  const $=(s,r)=>w.document.querySelector(s);
  const $$=(s,r)=>Array.from((r||w.document).querySelectorAll(s));
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const clickSel=async(s)=>{const el=$(s);if(!el)return false;el.click();await sleep(150);return true;};
  const navTo=async(id)=>{const b=$$('#sidebar .nav-item[data-nav]').find(x=>x.dataset.nav===id);if(!b){console.log('   (nav item missing: '+id+')');return false;}b.click();await sleep(600);return true;};
  const bodyText=()=>w.document.body.textContent.replace(/\s+/g,' ');
  await sleep(2800);

  console.log('== DASHBOARD 2.0 ==');
  ok('master system status strip (§80)', bodyText().includes('MASTER SYSTEM STATUS') && bodyText().includes('SYSTEM'));
  ok('operational health score (§5)', bodyText().includes('CENTRAL OPERATIONAL HEALTH') && $$('.health-bars .hb').length===7);
  ok('mode buttons + banner (§77)', $$('[data-mode]').length===3 && bodyText().includes('ELECTION DAY MODE'));
  ok('IReV command card on dashboard (§12)', bodyText().includes('IReV WATCHTOWER') && bodyText().includes('Pending IReV'));
  ok('what changed cards (§10)', $$('#irevrow .wc-card').length>=6);
  ok('rotating panels strip (§61)', bodyText().includes('ROTATING PANELS') && $$('[data-rot]').length===6);
  ok('critical alerts panel', bodyText().includes('CRITICAL ALERTS'));

  console.log('== API: CENTRAL HEALTH (§5, §45, §46) ==');
  const h=await fetch(BASE+'/api/central/health',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('7 health components', h.components.length===7);
  ok('score 0-100', h.score>=0 && h.score<=100);
  ok('sources present', h.sources.length===10);
  ok('mode reported', h.mode==='ELECTION_DAY');
  ok('bottlenecks array', Array.isArray(h.bottlenecks));

  console.log('== API: EVENT FEED (§9) ==');
  const feed=await fetch(BASE+'/api/central/eventfeed',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('merged feed events', feed.total>0 && feed.rows.length>0);
  ok('multiple event types', feed.types.length>=4);
  const feed2=await fetch(BASE+'/api/central/eventfeed?type=IREV',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('type filter works', feed2.rows.every(r=>r.type==='IREV'));

  console.log('== UI: LIVE EVENT FEED view ==');
  ok('feed view renders', await navTo('feed') && $$('#fbody .feed .item').length>0 && !!$('#ftype'));

  console.log('== UI: RESULT FLOW (§14-15) ==');
  ok('result flow stages', await navTo('resultflow') && bodyText().includes('RESULT FLOW VISUALIZATION') && bodyText().includes('EXPECTED') && bodyText().includes('RECONCILED'));
  ok('bottleneck panel (§45)', bodyText().includes('OPERATIONAL BOTTLENECKS'));

  console.log('== UI: DISCREPANCY COMMAND (§20) ==');
  ok('discrepancy cards', await navTo('discrepancies') && bodyText().includes('Total cases') && bodyText().includes('High priority'));
  ok('case drill', await (async()=>{const c=$('#dbody [data-case]'); if(!c) return true; c.click(); await sleep(600); return bodyText().includes('HASHES');})());
  const ov=$('.overlay'); if(ov){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== UI: TASKS (§34) ==');
  ok('task board', await navTo('tasks') && bodyText().includes('TASK BOARD'));
  ok('create task', await (async()=>{const b=$('#newtask'); if(!b) return false; b.click(); await sleep(200); return !!$('#ttitle');})());
  ok('task persists', await (async()=>{
    $('#ttitle').value='Review discrepancy cases'; $('#tpri').value='HIGH'; $('#tdetail').value='Harness task';
    const btn=$$('.overlay .mf .btn').find(x=>x.textContent.includes('Create task')); if(!btn) return false;
    btn.click(); await sleep(600);
    const tasks=await fetch(BASE+'/api/tasks',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
    return tasks.rows.some(t=>t.title==='Review discrepancy cases' && t.code.startsWith('TSK'));
  })());

  console.log('== UI: COMMUNICATIONS (§32-33) ==');
  ok('comms centre', await navTo('comms') && bodyText().includes('COMMAND COMMUNICATIONS') && !!$('#ctarget'));
  ok('broadcast + ack tracking', await (async()=>{
    $('#ctarget').value='SUPERVISOR'; $('#cmsg').value='Priority instruction: reconcile all pending uploads.';
    await clickSel('#csend'); await sleep(600);
    const msgs=await fetch(BASE+'/api/communications',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
    const m=msgs.rows.find(x=>x.body.includes('Priority instruction'));
    if(!m) return false;
    const ack=await fetch(BASE+'/api/communications/'+m.id+'/ack',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({})}).then(r=>r.json());
    return ack.status==='ACKNOWLEDGED' && ack.acks>=1;
  })());

  console.log('== UI: SHIFTS (§35-36) ==');
  ok('shift schedule', await navTo('shifts') && bodyText().includes('CONTROL ROOM SHIFTS') && bodyText().includes('SHIFT A'));
  ok('handover generation', await (async()=>{
    $('#hnotes').value='Open cases tracked'; $('#hwatch').value='Watch the IReV change cases';
    await clickSel('#hgen'); await sleep(700);
    return bodyText().includes('SHIFT HANDOVER REPORT') && bodyText().includes('Verification backlog');
  })());
  const ov2=$('.overlay'); if(ov2){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}
  ok('handover stored + ack', await (async()=>{
    const sh=await fetch(BASE+'/api/shifts',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
    if(!sh.handover.length) return false;
    const ack=await fetch(BASE+'/api/shifts/handover/'+sh.handover[0].id+'/ack',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({})}).then(r=>r.json());
    return ack.ok===true;
  })());

  console.log('== REPORT VERSIONING (§56-58) ==');
  ok('report history view', await navTo('reporthistory') && bodyText().includes('REPORT VERSION CONTROL'));
  ok('generate → versioned id', await (async()=>{
    $('#rtype').value='CENTRAL_SITREP';
    await clickSel('#genrep'); await sleep(700);
    const reps=await fetch(BASE+'/api/reports/generated',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
    return reps.rows.length>0 && /^SITREP-2027-\d{6}$/.test(reps.rows[0].code) && reps.rows[0].version>=1;
  })());

  console.log('== MAP VIEW SWITCHER (§7) ==');
  ok('map view pills', await navTo('map') && $$('#mvseg .is').length===5);
  ok('irev view shading', await (async()=>{const b=$$('#mvseg .is').find(x=>x.dataset.v==='irev'); if(!b) return false; b.click(); await sleep(500); return bodyText().includes('IReV view');})());
  ok('incident view', await (async()=>{const b=$$('#mvseg .is').find(x=>x.dataset.v==='incidents'); if(!b) return false; b.click(); await sleep(500); return bodyText().includes('Incident view');})());

  console.log('== WALL PRIORITY FILTERS + ROTATION (§29) ==');
  ok('video priority filters', await navTo('wall') && $$('[data-vf]').length===5);

  console.log('== AGENT LIFECYCLE (§31) ==');
  ok('agent lifecycle bar', await navTo('agents') && bodyText().includes('AGENT LIFECYCLE') && bodyText().includes('DUTY COMPLETE'));

  console.log('== MODE SWITCH (§77-79) ==');
  ok('mode endpoint + switch', await (async()=>{
    const sup=await apiLogin('superadmin','Admin@123!');
    const m=await fetch(BASE+'/api/central/mode',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sup.token},body:JSON.stringify({mode:'POST_ELECTION'})}).then(r=>r.json());
    const ok1=m.ok===true && m.mode==='POST_ELECTION';
    await fetch(BASE+'/api/central/mode',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sup.token},body:JSON.stringify({mode:'ELECTION_DAY'})});
    return ok1;
  })());
  ok('mode RBAC (director blocked)', await (async()=>{
    const r=await fetch(BASE+'/api/central/mode',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({mode:'ELECTION_DAY'})}).then(r=>r.status);
    return r===403;
  })());

  console.log('== MOBILE COMMAND (§62) ==');
  {
    const sAuth=await apiLogin('chiefanalyst','Chief@123!');
    const sHtml=await fetch(BASE+'/mobile').then(r=>r.text());
    const vc2=new VirtualConsole(); const errs2=[];
    vc2.on('jsdomError',e=>errs2.push(e.message.split('\n')[0]));
    vc2.on('error',(...a)=>errs2.push(String(a[0]).slice(0,120)));
    const dom2=new JSDOM(sHtml,{url:BASE+'/mobile',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc2,beforeParse(x){x.localStorage.setItem('ndc_token',sAuth.token);x.localStorage.setItem('ndc_user',JSON.stringify(sAuth.me.user));x.localStorage.setItem('ndc_perms',JSON.stringify(sAuth.me.permissions));}});
    const w2=dom2.window;
    w2.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
    w2.EventSource=class{constructor(u){}close(){}};
    w2.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w2.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w2.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w2.cancelAnimationFrame=(t)=>clearTimeout(t);
    w2.addEventListener('error',e=>errs2.push('winerr: '+(e.message||'')));
    await sleep(3000);
    const t2=w2.document.body.textContent.replace(/\s+/g,' ');
    ok('mobile command renders', t2.includes('MOBILE COMMAND') && t2.includes('ACTIVE SOS') && t2.includes('CASES IN REVIEW'));
    ok('mobile runtime clean', errs2.length===0, errs2.slice(0,3).join(' // '));
    dom2.window.close();
  }

  console.log('== SEARCH EXTENSION (§69) ==');
  {
    const cases=await fetch(BASE+'/api/irev/cases',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
    if(cases.rows.length){
      const q=cases.rows[0].code;
      const res=await fetch(BASE+'/api/search?q='+q,{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
      ok('search finds discrepancy case', res.results.some(r=>r.type==='IREV_CASE'));
    } else ok('search finds discrepancy case (no cases in state)', true);
  }

  console.log('== ROLES (§49) ==');
  {
    const su=await apiLogin('superadmin','Admin@123!');
    const users=await fetch(BASE+'/api/admin/users',{headers:{Authorization:'Bearer '+su.token}}).then(r=>r.json());
    ok('five new central roles', ['chiefanalyst','resultmanager','irevanalyst','incidentcommander','comms'].every(r=>users.rows.some(u=>u.roleId===r)));
  }

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  console.log('runtime errors:', errors.length?errors.slice(0,6).join(' // '):'none');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
