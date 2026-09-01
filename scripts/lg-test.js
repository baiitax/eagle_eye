// lg-test.js — drives the EYES OF VICTORY LG SUPERVISOR portal through all views
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
  const auth=await apiLogin('lgcoord','LGCoord@123!');
  const html=await fetch(BASE+'/lg').then(r=>r.text());
  const dom=new JSDOM(html,{url:BASE+'/lg',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.localStorage.setItem('ndc_token',auth.token);w.localStorage.setItem('ndc_user',JSON.stringify(auth.me.user));w.localStorage.setItem('ndc_perms',JSON.stringify(auth.me.permissions));}});
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
  const navTo=async(id)=>{const b=$$('#sidebar .nav-item[data-nav]').find(x=>x.dataset.nav===id);if(!b){console.log('   (nav item missing: '+id+')');return false;}b.click();await sleep(400);return true;};
  const bodyText=()=>w.document.body.textContent.replace(/\s+/g,' ');
  await sleep(2600);

  console.log('== BOOT: SECURITY CHECK ==');
  ok('security check modal (§6)', bodyText().includes('SECURITY CHECK') && bodyText().includes('Device authorization'));
  ok('proceed button closes', await (async()=>{const b=$$('.overlay .mf .btn').find(x=>x.textContent.includes('Proceed to LG Command')); if(!b) return false; b.click(); await sleep(400); return !$('.overlay');})());

  console.log('== DASHBOARD ==');
  ok('assigned LG scoped', bodyText().includes('ASSIGNED LG: NASARAWA'));
  ok('KPI cards', $$('.kpis .kpi').length>=8);
  ok('operational health hero', bodyText().includes('LG OPERATIONAL HEALTH') && $$('.health-bars .hb').length===6);
  ok('live map', $$('#dashmap svg polygon').length>0);
  ok('incident feed', !!$('#incfeed'));
  ok('live timeline feed', !!$('#tlfeed'));
  ok('ward status table', $$('table.tbl tbody tr').length>0);

  console.log('== MAP ==');
  ok('command map + filters', await navTo('map') && $$('#bigmap svg polygon').length>0 && $$('#filters .chip').length===4);

  console.log('== WALL MODE ==');
  ok('wall opens', await navTo('wall') && !!$('.wall-mode'));
  ok('wall KPIs', $$('.wall-mode .wm-kpi').length===6);
  ok('wall ward strip', $$('.wall-mode .wm-strip .s').length>0);
  await clickSel('#wmexit'); await sleep(150);

  console.log('== NOTIFICATIONS / TASKS ==');
  ok('alert centre with ACK', await navTo('notifications') && ($$('[data-ack]').length>0 || bodyText().includes('No alerts')));
  ok('tasks from signals', await navTo('tasks') && ($$('.signal-card').length>0 || bodyText().includes('nominal')));

  console.log('== WARDS ==');
  ok('wards table', await navTo('wards') && $$('table.tbl tbody tr').length>0);
  ok('ward command view drill', await (async()=>{const r=$('[data-w]'); if(!r) return false; r.click(); await sleep(700); return bodyText().includes('WARD COMMAND VIEW') && $$('#wmap svg polygon').length>0;})());
  ok('ward timeline', $$('#wtl .item').length>0 || bodyText().includes('No ward events'));
  ok('ward PU list', $$('#wpulist table.tbl tbody tr').length>0);
  await navTo('wards');

  console.log('== POLLING UNITS + DRILL ==');
  ok('PU table', await navTo('pus') && $$('#pubody table.tbl tbody tr').length>0);
  ok('PU profile panel', await (async()=>{const b=$('#pubody [data-pu]'); if(!b) return false; b.click(); await sleep(400); return bodyText().includes('POLLING UNIT PROFILE') && bodyText().includes('Assigned agent');})());
  ok('PU panel actions', !!$('#puactions [data-t]'));
  const ovc=$('.overlay'); if(ovc){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== AGENTS ==');
  ok('agent monitoring', await navTo('agents') && bodyText().includes('AGENT MONITORING'));
  ok('agent rows', $$('#agbody table.tbl tbody tr').length>0);
  ok('agent command profile', await (async()=>{const b=$('#agbody [data-ag]'); if(!b) return false; b.click(); await sleep(500); return bodyText().includes('AGENT COMMAND PROFILE') && bodyText().includes('AGENT TIMELINE');})());
  const ova=$('.overlay'); if(ova){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== CONNECTIVITY ==');
  ok('network health', await navTo('connectivity') && $$('#connmap svg polygon').length>0);
  ok('synchronization panel', bodyText().includes('SYNCHRONIZATION'));

  console.log('== RESULTS ==');
  ok('results command', await navTo('results') && bodyText().includes('RESULT PROGRESS MATRIX'));
  ok('matrix rows', $$('#matrix table.tbl tbody tr').length>0);
  ok('submission modal + EC8A', await (async()=>{const b=$('#subbody [data-open]'); if(!b) return true; b.click(); await sleep(500); const has = bodyText().includes('RESULT RECORD'); const evB=$('#sbox [data-ev]'); if(evB){evB.click(); await sleep(400);} return has && (bodyText().includes('EC8A VIEWER') || !evB);})());
  const ovr=$('.overlay'); if(ovr){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}
  const ovr2=$('.overlay'); if(ovr2){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== QUEUE / EVIDENCE / DISPUTES ==');
  ok('review queue', await navTo('queue') && bodyText().includes('REVIEW QUEUE'));
  ok('evidence centre', await navTo('evidence') && bodyText().includes('Documents received') && $$('#evwrap table.tbl tbody tr').length>0);
  ok('disputes view', await navTo('disputes') && bodyText().includes('DISPUTES'));

  console.log('== INCIDENTS ==');
  ok('incident command', await navTo('incidents') && bodyText().includes('LIVE INCIDENT FEED'));
  ok('incident map', await navTo('incmap') && $$('#incmap svg polygon').length>0);

  console.log('== SOS ==');
  ok('SOS command', await navTo('sos') && bodyText().includes('SOS EVENTS'));

  console.log('== VIDEO ==');
  ok('video wall', await navTo('video') && !!$('#vw'));

  console.log('== ANALYTICS ==');
  ok('analytics sub-tabs', await navTo('analytics') && $$('#ansub .as').length===5);
  ok('reporting charts', $$('#anbox svg').length>0);
  ok('results charts + ward comparison', await (async()=>{const b=$$('#ansub .as').find(x=>x.dataset.s==='results'); if(!b) return false; b.click(); await sleep(700); return $$('#anbox svg').length>=2;})());
  ok('verification sub-tab', await (async()=>{const b=$$('#ansub .as').find(x=>x.dataset.s==='verification'); if(!b) return false; b.click(); await sleep(700); return $$('#anbox svg').length>=1;})());
  ok('connectivity sub-tab', await (async()=>{const b=$$('#ansub .as').find(x=>x.dataset.s==='connectivity'); if(!b) return false; b.click(); await sleep(700); return $$('#anbox svg').length>=2;})());

  console.log('== INTELLIGENCE ==');
  ok('brief sections', await navTo('brief') && bodyText().includes('CURRENT SITUATION') && bodyText().includes('PRIORITY ACTIONS'));
  ok('signals engine', await navTo('signals') && bodyText().includes('SYSTEM SIGNAL — REQUIRES REVIEW'));
  ok('copilot', await navTo('copilot') && !!$('#cq'));
  ok('copilot answers', await (async()=>{ $('#cq').value='Which wards have the highest reporting backlog?'; await clickSel('#cbtn'); await sleep(800); return $$('#chat .item').length>=3;})());

  console.log('== REPORTS ==');
  ok('SITREP generator', await navTo('sitrep') && bodyText().includes('GENERATE LG SITREP') && bodyText().includes('LGA Operational Status'));
  ok('lgcoord: exports hidden (RBAC)', !$$('#sidebar .nav-item[data-nav]').some(x=>x.dataset.nav==='exports'));

  console.log('== GOVERNANCE ==');
  ok('evidence chain', await navTo('chain') && bodyText().includes('EVIDENCE CHAIN'));
  ok('security posture', await navTo('security') && bodyText().includes('WHAT LG SUPERVISORS CANNOT DO'));

  console.log('== ESCALATION ==');
  ok('escalation form', await (async()=>{const b=$('#escalatebtn'); if(!b) return false; b.click(); await sleep(300); return bodyText().includes('ESCALATE (structured case)') && !!$('#eRef');})());
  ok('escalation sent → ESC code', await (async()=>{
    $('#eRef').value='INC-2027-000888'; $('#ePri').value='HIGH'; $('#eSum').value='LG harness escalation test';
    const btn=$$('.overlay .mf .btn').find(x=>x.textContent.includes('SEND ESCALATION'));
    if(!btn) return false; btn.click(); await sleep(600);
    return bodyText().includes('Escalation sent');
  })());
  const escApi=await fetch(BASE+'/api/escalations',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('escalation stored', escApi.rows.length>0 && escApi.rows[0].code.startsWith('ESC-'));
  const tlApi=await fetch(BASE+'/api/lg/timeline?lga=Nasarawa',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('LG timeline endpoint returns events', Array.isArray(tlApi.rows) && tlApi.rows.length>0);

  console.log('== RBAC + DEMO (lgsupervisor vs lgcoord) ==');
  const demoForb=await fetch(BASE+'/api/lg/demo/simulate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'result'})}).then(r=>r.status);
  ok('lgcoord blocked from demo (RBAC)', demoForb===403);
  // lgsupervisor second DOM
  {
    const sAuth=await apiLogin('lgsupervisor','LGSuper@123!');
    const sHtml=await fetch(BASE+'/lg').then(r=>r.text());
    const vc2=new VirtualConsole(); const errs2=[];
    vc2.on('jsdomError',e=>errs2.push(e.message.split('\n')[0]));
    vc2.on('error',(...a)=>errs2.push(String(a[0]).slice(0,120)));
    const dom2=new JSDOM(sHtml,{url:BASE+'/lg',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc2,beforeParse(x){x.localStorage.setItem('ndc_token',sAuth.token);x.localStorage.setItem('ndc_user',JSON.stringify(sAuth.me.user));x.localStorage.setItem('ndc_perms',JSON.stringify(sAuth.me.permissions));}});
    const w2=dom2.window;
    w2.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
    w2.EventSource=class{constructor(u){}close(){}};
    w2.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w2.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w2.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w2.cancelAnimationFrame=(t)=>clearTimeout(t);
    w2.addEventListener('error',e=>errs2.push('winerr: '+(e.message||'')));
    await sleep(2800);
    const $2=(s)=>w2.document.querySelector(s);
    const $$2=(s)=>Array.from(w2.document.querySelectorAll(s));
    const nav2=async(id)=>{const b=$$2('#sidebar .nav-item[data-nav]').find(x=>x.dataset.nav===id);if(!b)return false;b.click();await sleep(500);return true;};
    ok('lgsupervisor: demo button', !!$2('#demobtn'));
    ok('lgsupervisor: exports nav', await nav2('exports') && $$2('[data-exp]').length>=12);
    ok('lgsupervisor: audit nav', await nav2('audit') && $$2('#abody table.tbl tbody tr').length>0);
    ok('lgsupervisor: system health', await nav2('health') && $$2('.kpis .kpi').length>=8);
    ok('lgsupervisor runtime clean', errs2.length===0, errs2.slice(0,3).join(' // '));
    // demo simulate works server-side
    const demoOk=await fetch(BASE+'/api/lg/demo/simulate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sAuth.token},body:JSON.stringify({action:'incident'})}).then(r=>r.json());
    ok('lgsupervisor demo simulate works', demoOk.ok===true && !!demoOk.detail);
    dom2.window.close();
  }
  // new roles exist
  const users=await fetch(BASE+'/api/admin/users',{headers:{Authorization:'Bearer '+(await apiLogin('superadmin','Admin@123!')).token}}).then(r=>r.json());
  ok('three LG roles present', ['lgsupervisor','lganalyst','lgtech'].every(r=>users.rows.some(u=>u.roleId===r)));

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  console.log('runtime errors:', errors.length?errors.slice(0,6).join(' // '):'none');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
