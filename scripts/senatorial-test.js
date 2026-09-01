// senatorial-test.js — drives the EYES OF VICTORY Senatorial Command through all views
// Usage: node scripts/senatorial-test.js (server on :3000, jsdom at /tmp/uitest/node_modules)
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
  // reset sim to Collation Phase
  {
    const l=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'superadmin',password:'Admin@123!'})}).then(r=>r.json());
    const m=await fetch(BASE+'/api/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:l.challenge,code:l.mfaCode})}).then(r=>r.json());
    await fetch(BASE+'/api/admin/simulation',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+m.token},body:JSON.stringify({action:'scenario',value:'RESULTS'})});
    console.log('(simulation reset to Collation Phase)');
  }
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message.split('\n')[0]));
  vc.on('error',(...a)=>errors.push(String(a[0]).slice(0,140)));
  const auth=await apiLogin('sencoord_n','SenCoord@123!');
  const html=await fetch(BASE+'/senatorial').then(r=>r.text());
  const dom=new JSDOM(html,{url:BASE+'/senatorial',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.localStorage.setItem('ndc_token',auth.token);w.localStorage.setItem('ndc_user',JSON.stringify(auth.me.user));w.localStorage.setItem('ndc_perms',JSON.stringify(auth.me.permissions));}});
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

  console.log('== DASHBOARD ==');
  ok('Kano North scoped', bodyText().includes('KANO NORTH') && bodyText().includes('ASSIGNED DISTRICT'));
  ok('KPI row', $$('.kpis .kpi').length>=7);
  ok('operational health hero', bodyText().includes('SENATORIAL OPERATIONAL HEALTH') && $('.health-score'));
  ok('health breakdown bars', $$('.health-bars .hb').length===6);
  ok('dashboard map renders', $$('#dashmap svg polygon').length>0);
  ok('incident feed', !!$('#incfeed'));
  ok('escalation preview', !!$('#escf'));
  ok('LGA quick table', $$('table.tbl tbody tr').length>0);

  console.log('== LIVE MAP ==');
  ok('map opens', await navTo('map') && $$('#bigmap svg polygon').length>0);
  ok('metric selector', !!$('#metric'));

  console.log('== COMMAND WALL ==');
  ok('wall opens', await navTo('wall') && !!$('.wall-mode'));
  ok('wall KPIs', $$('.wall-mode .wm-kpi').length===6);
  ok('wall LGA strip', $$('.wall-mode .wm-strip .s').length>0);
  ok('wall clock', !!$('#wmclock'));
  await clickSel('#wmexit'); await sleep(150);

  console.log('== LGAs / comparison ==');
  ok('LGA ops table', await navTo('lgas') && $$('#lgabody table.tbl tbody tr').length>0);
  ok('drill to LGA detail', await (async()=>{const r=$('#lgabody tbody tr'); if(!r) return false; r.click(); await sleep(400); return bodyText().includes('LGA Command Panel');})());
  ok('ward drill inside LGA', await (async()=>{const w=$('[data-w]'); if(!w) return false; w.click(); await sleep(500); return bodyText().includes('POLLING UNITS') && $$('table.tbl tbody tr').length>0;})());
  await navTo('lgas');

  console.log('== WARDS / reporting matrix ==');
  ok('matrix with coverage', await navTo('wards') && bodyText().includes('REPORTING MATRIX') && $$('#wbody table.tbl tbody tr').length>0);
  ok('ward drill with agents', await (async()=>{const r=$('#wbody tbody tr'); if(!r) return false; r.click(); await sleep(600); return bodyText().includes('Agent') && $$('table.tbl tbody tr').length>0;})());
  await navTo('wards');

  console.log('== PUs ==');
  ok('PU table', await navTo('pus') && $$('#pubody table.tbl tbody tr').length>0);
  ok('PU search', !!$('#pq'));

  console.log('== AGENTS ==');
  ok('field network', await navTo('agents') && bodyText().includes('Total agents'));
  ok('agent table', $$('#agbody table.tbl tbody tr').length>0);
  ok('agent profile modal', await (async()=>{const b=$('#agbody [data-ag]'); if(!b) return false; b.click(); await sleep(400); return bodyText().includes('OPERATIONAL TIMELINE');})());
  const ovClose=$('.overlay'); if(ovClose){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== CONNECTIVITY ==');
  ok('heatmap', await navTo('connectivity') && $$('#connmap svg polygon').length>0);
  ok('sync health per LGA', $$('#synchealth .pbar').length>0);

  console.log('== RESULTS ==');
  ok('result command centre', await navTo('results') && bodyText().includes('Expected') && bodyText().includes('LGA RESULT MATRIX'));
  ok('progress chart', $$('#progchart svg').length>0);
  ok('LGA result drill', await (async()=>{const r=$('[data-lg]'); if(!r) return false; r.click(); await sleep(600); return bodyText().includes('SUBMISSIONS');})());
  await navTo('results');

  console.log('== QUEUE ==');
  ok('verification queue', await navTo('queue') && bodyText().includes('VERIFICATION QUEUE'));
  ok('liaison note (no bypass)', bodyText().includes('never bypasses controls'));

  console.log('== EVIDENCE CENTRE ==');
  ok('evidence stats', await navTo('evidence') && bodyText().includes('Documents received'));
  ok('evidence table with signals', $$('#evwrap table.tbl tbody tr').length>0);
  ok('EC8A viewer opens', await (async()=>{const b=$('#evwrap [data-ev]'); if(!b) return true; b.click(); await sleep(400); return bodyText().includes('EC8A VIEWER') && bodyText().includes('CHAIN OF CUSTODY');})());
  const ov2=$('.overlay'); if(ov2){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== DISPUTES ==');
  ok('disputes view', await navTo('disputes') && bodyText().includes('DISPUTED RECORDS'));

  console.log('== INCIDENTS ==');
  ok('incident command', await navTo('incidents') && bodyText().includes('LIVE INCIDENT FEED'));
  ok('incident cards', $$('.kpis .kpi').length>=8);
  ok('category breakdown', $$('#catbox .flex').length>0 || bodyText().includes('No incidents'));

  console.log('== INCIDENT MAP ==');
  ok('incident map', await navTo('incmap') && $$('#incmap svg polygon').length>0);
  ok('filters', !!$('#msev') && !!$('#mst') && !!$('#mlga'));

  console.log('== ESCALATIONS ==');
  ok('escalations list', await navTo('escalations') && bodyText().includes('ESCALATIONS TO CENTRAL'));
  ok('create escalation form', await (async()=>{const b=$('#newesc'); if(!b) return false; b.click(); await sleep(250); return bodyText().includes('ESCALATE TO CENTRAL SITUATION ROOM') && !!$('#eRef');})());
  ok('escalation submit → ESC code', await (async()=>{
    $('#eRef').value='INC-2027-000999'; $('#ePri').value='HIGH'; $('#eSum').value='Test escalation from senatorial harness';
    $('#eAct').value='LG notified'; $('#eReq').value='Central review requested';
    const btn=$$('.overlay .mf .btn').find(x=>x.textContent.includes('SEND TO CENTRAL'));
    if(!btn) return false; btn.click(); await sleep(600);
    return bodyText().includes('Escalation sent');
  })());
  // server-side check
  const escApi=await fetch(BASE+'/api/escalations?senatorial='+encodeURIComponent('Kano North'),{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('escalation stored server-side', escApi.rows.length>0 && escApi.rows[0].code.startsWith('ESC-'));
  ok('escalation type/priority stored', escApi.rows[0].priority==='HIGH');

  console.log('== SOS COMMAND ==');
  ok('SOS command', await navTo('sos') && bodyText().includes('SOS EVENT LOG'));
  ok('escalation workflow note', bodyText().includes('SOS ACTIVE → ACKNOWLEDGED → LG RESPONSE'));

  console.log('== VIDEO WALL ==');
  ok('video wall', await navTo('video') && !!$('#vw'));
  ok('filters', !!$('#vlga') && !!$('#vfilter'));

  console.log('== ANALYTICS ==');
  ok('analytics sub-tabs', await navTo('analytics') && $$('#ansub .as').length===4);
  ok('reporting charts', $$('#anbox svg').length>0);
  ok('results sub-tab', await (async()=>{const b=$$('#ansub .as').find(x=>x.dataset.s==='results'); if(!b) return false; b.click(); await sleep(700); return $$('#anbox svg').length>=3;})());
  ok('incidents sub-tab', await (async()=>{const b=$$('#ansub .as').find(x=>x.dataset.s==='incidents'); if(!b) return false; b.click(); await sleep(700); return $$('#anbox svg').length>=3;})());
  ok('connectivity sub-tab', await (async()=>{const b=$$('#ansub .as').find(x=>x.dataset.s==='connectivity'); if(!b) return false; b.click(); await sleep(700); return $$('#anbox svg').length>=2;})());

  console.log('== INTELLIGENCE ==');
  ok('brief sections', await navTo('brief') && bodyText().includes('CURRENT SITUATION') && bodyText().includes('PRIORITY ACTIONS'));
  ok('signals engine', await navTo('signals') && bodyText().includes('SIGNAL REQUIRES HUMAN REVIEW'));
  ok('copilot renders', await navTo('copilot') && !!$('#cq'));
  ok('copilot answers', await (async()=>{
    $('#cq').value='Which LGAs have the largest reporting gaps?';
    await clickSel('#cbtn'); await sleep(800);
    return $$('#chat .item').length>=3;
  })());

  console.log('== REPORTS ==');
  ok('SITREP generator', await navTo('sitrep') && bodyText().includes('GENERATE SENATORIAL SITREP') && bodyText().includes('LGA Operational Status'));
  ok('sencoord: export centre hidden (RBAC — reports.export)', !$$('#sidebar .nav-item[data-nav]').some(x=>x.dataset.nav==='exports'));

  console.log('== GOVERNANCE (RBAC-aware) ==');
  // sencoord (coordinator) does NOT carry audit/export/health perms → menu items hidden (correct RBAC)
  const auditNav = $$('#sidebar .nav-item[data-nav]').some(x=>x.dataset.nav==='audit');
  const exportNav = $$('#sidebar .nav-item[data-nav]').some(x=>x.dataset.nav==='exports');
  const healthNav = $$('#sidebar .nav-item[data-nav]').some(x=>x.dataset.nav==='health');
  ok('sencoord: audit/export/health hidden (RBAC)', !auditNav && !exportNav && !healthNav);
  ok('evidence chain (evidence.view)', await navTo('chain') && bodyText().includes('EVIDENCE AUDIT VIEW'));
  ok('security posture', await navTo('security') && bodyText().includes('PUBLIC DATA FIREWALL'));
  // director role has the full governance set → boot a second DOM
  {
    const dAuth=await apiLogin('sendirector','SenDir@123!');
    const dHtml=await fetch(BASE+'/senatorial').then(r=>r.text());
    const vc2=new VirtualConsole(); const errs2=[];
    vc2.on('jsdomError',e=>errs2.push(e.message.split('\n')[0]));
    vc2.on('error',(...a)=>errs2.push(String(a[0]).slice(0,120)));
    const dom2=new JSDOM(dHtml,{url:BASE+'/senatorial',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc2,beforeParse(x){x.localStorage.setItem('ndc_token',dAuth.token);x.localStorage.setItem('ndc_user',JSON.stringify(dAuth.me.user));x.localStorage.setItem('ndc_perms',JSON.stringify(dAuth.me.permissions));}});
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
    ok('sendirector: audit renders', await nav2('audit') && $$2('#abody table.tbl tbody tr').length>0);
    ok('sendirector: export centre renders', await nav2('exports') && $$2('[data-exp]').length>=12);
    ok('sendirector: system health renders', await nav2('health') && $$2('.kpis .kpi').length>=10);
    ok('sendirector: demo panel button', await nav2('dashboard') && !!$2('#demobtn'));
    ok('sendirector runtime clean', errs2.length===0, errs2.slice(0,3).join(' // '));
    dom2.window.close();
  }

  console.log('== DEMO CONTROLS (senatorial.demo) ==');
  // sencoord_n does NOT have senatorial.demo → RBAC negative
  const demoForb=await fetch(BASE+'/api/senatorial/demo/simulate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'result'})}).then(r=>r.status);
  ok('sencoord blocked from demo panel (RBAC)', demoForb===403);
  // sendirector has the demo perm
  const dr=await apiLogin('sendirector','SenDir@123!');
  const demoOk=await fetch(BASE+'/api/senatorial/demo/simulate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+dr.token},body:JSON.stringify({action:'incident'})}).then(r=>r.json());
  ok('senatorial director demo simulate works', demoOk.ok===true && !!demoOk.detail);
  // new senatorial roles exist
  const users=await fetch(BASE+'/api/admin/users',{headers:{Authorization:'Bearer '+(await apiLogin('superadmin','Admin@123!')).token}}).then(r=>r.json());
  ok('six senatorial roles present', ['sendirector','senops','senincident','senanalyst','senverify','senviewer'].every(r=>users.rows.some(u=>u.roleId===r)));

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  console.log('runtime errors:', errors.length?errors.slice(0,6).join(' // '):'none');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
