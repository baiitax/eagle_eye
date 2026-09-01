// agent-test.js — drives the EYES OF VICTORY Field Agent app through every screen & flow
// Usage: node scripts/agent-test.js  (requires a running server on :3000 and jsdom installed at /tmp/uitest)
const path = require('path');
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
  // reset simulation to a fresh Collation Phase so duty gates are in the expected state
  {
    const l=await fetch(BASE+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'superadmin',password:'Admin@123!'})}).then(r=>r.json());
    const m=await fetch(BASE+'/api/auth/mfa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({challenge:l.challenge,code:l.mfaCode})}).then(r=>r.json());
    await fetch(BASE+'/api/admin/simulation',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+m.token},body:JSON.stringify({action:'scenario',value:'RESULTS'})});
    console.log('(simulation reset to Collation Phase)');
  }
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message.split('\n')[0]));
  vc.on('error',(...a)=>errors.push(String(a[0]).slice(0,140)));
  const auth=await apiLogin('fieldagent','Agent@123!');
  const html=await fetch(BASE+'/agent').then(r=>r.text());
  const dom=new JSDOM(html,{url:BASE+'/agent',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.localStorage.setItem('ndc_token',auth.token);w.localStorage.setItem('ndc_user',JSON.stringify(auth.me.user));w.localStorage.setItem('ndc_perms',JSON.stringify(auth.me.permissions));}});
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
  const clickSel=async(s)=>{const el=$(s);if(!el)return false;el.click();await sleep(120);return true;};
  const navTab=async(v)=>{const b=$$('#pnav .bn').find(x=>x.dataset.v===v);if(!b)return false;b.click();await sleep(250);return true;};
  await sleep(2600);

  console.log('== HOME ==');
  const bodyText=()=>w.document.body.textContent.replace(/\s+/g,' ');
  ok('brand EYES OF VICTORY', bodyText().includes('EYES OF VICTORY'));
  ok('duty status card', bodyText().includes('DUTY STATUS'));
  ok('connectivity section', bodyText().includes('CONNECTIVITY'));
  ok('battery section', bodyText().includes('BATTERY'));
  ok('phase stepper', !!$('.phase-track') && $$('.ph-step').length===6);
  ok('6 primary actions', $$('.agent-grid .agent-btn').length===6);
  ok('current tasks', bodyText().includes('CURRENT TASKS'));
  ok('sync status', bodyText().includes('SYNC STATUS'));
  ok('recent activity', bodyText().includes('RECENT ACTIVITY'));
  ok('floating SOS button', !!$('#floatSos'));

  console.log('== REPORT tab ==');
  ok('report tab opens', await navTab('report') && bodyText().includes('SUBMIT RESULT') && bodyText().includes('REPORT INCIDENT'));

  console.log('== EVIDENCE tab ==');
  ok('evidence tab opens', await navTab('evidence') && bodyText().includes('CAPTURE EVIDENCE'));
  ok('evidence filters', $$('#evfilter .sg').length===5);
  await sleep(600);
  ok('evidence grid renders (cards or empty state)', !!$('#evbox') && ($$('.ev-card').length>0 || bodyText().includes('No evidence captured yet')));

  console.log('== ACTIVITY tab ==');
  ok('activity tab opens', await navTab('activity'));
  ok('submissions listed (or empty state)', $$('#pbody .sub-row').length>0 || bodyText().includes('No submissions yet'));
  const firstSub = $('#pbody .sub-row');
  if (firstSub) { firstSub.click(); await sleep(600);
    ok('submission detail loads', bodyText().includes('Verification history') || bodyText().includes('Original evidence') || bodyText().includes('Submitted values'));
    await clickSel('#sback'); await sleep(150);
  }
  const tseg=$$('.act-seg .as').find(x=>x.dataset.t==='timeline'); if(tseg){tseg.click();await sleep(250);}
  ok('PU event timeline renders', $$('#pbody .feed .item').length>0);
  const iseg=$$('.act-seg .as').find(x=>x.dataset.t==='incidents'); if(iseg){iseg.click();await sleep(250);}

  console.log('== PROFILE tab ==');
  ok('profile tab opens', await navTab('profile'));
  ok('profile menu items', $$('.profile-menu .pm').length>=10);

  console.log('== RESULT FLOW ==');
  await navTab('report');
  await clickSel('#pbody [data-go="resultflow"]'); await sleep(300);
  ok('step1 confirm location', bodyText().includes('Confirm location') && !!$('#wel'));
  $('#wel').value = $('#wel option').value;
  await clickSel('#wnext'); await sleep(150);
  ok('step2 data entry', bodyText().includes('Result data entry'));
  $$('#pbody [data-ci]').forEach(i=>i.value='100');
  $('#wvalid').value='400'; $('#wrej').value='5'; $('#wacc').value='450'; $('#wreg').value='600';
  await clickSel('#wnext2'); await sleep(150);
  ok('step3 OCR cross-check', bodyText().includes('OCR cross-check') && bodyText().includes('CONFIDENCE'));
  await clickSel('#wnext3'); await sleep(150);
  // low-confidence fields require explicit human confirmation — that is spec behaviour
  if ($('#lowconf')) { await clickSel('#lowconf'); await clickSel('#wnext3'); await sleep(150); }
  ok('step4 EC8A capture', bodyText().includes('Capture EC8A pages'));
  await clickSel('#cap1'); await sleep(400);
  ok('camera modal opens', !!$('#vf'));
  await clickSel('#shutter'); await sleep(200);
  ok('page captured', bodyText().includes('SHA-256'));
  await clickSel('#wnext4'); await sleep(150);
  ok('step5 review', bodyText().includes('Review before submission'));
  // spec 18: figures entered (500) do not reconcile with valid votes (400) -> DATA CHECK REQUIRED
  ok('math validation — DATA CHECK REQUIRED', bodyText().includes('DATA CHECK REQUIRED') && !!$('#wcorrect') && !!$('#wsubmitnote'));
  await clickSel('#wsubmitnote'); await sleep(200);
  $('#expnote').value='Figures entered exactly as written on the EC8A — submitting with explanation.';
  const submitWithExp = $$('.overlay .mf .btn').find(b=>b.textContent.includes('Submit with explanation'));
  if (submitWithExp) submitWithExp.click(); else $('#wsubmit') && $('#wsubmit').click();
  await sleep(900);
  const submitOutcome = bodyText().toLowerCase().includes('already exists')
    ? 'duplicate guard (409 modal)'
    : bodyText().includes('Result submitted successfully') && /EVR-2027-/.test(bodyText())
      ? 'success with EVR submission ID'
      : null;
  ok('submission outcome ('+submitOutcome+')', !!submitOutcome);

  console.log('== INCIDENT FLOW ==');
  const ov=$('.overlay'); if(ov){ const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(200);}
  await navTab('home');
  await clickSel('#pbody .agent-btn:nth-child(2)'); await sleep(200);
  ok('WHAT HAPPENED grid', bodyText().includes('WHAT HAPPENED') && $$('.cat-card').length===10);
  $('.cat-card').click(); await sleep(150);
  ok('incident detail step', !!$('#idesc'));
  $('#idesc').value='Test incident description from harness';
  await clickSel('#inext'); await sleep(150);
  ok('incident review step', bodyText().includes('INCIDENT REVIEW'));
  await clickSel('#isend'); await sleep(700);
  ok('INC confirmation screen', bodyText().includes('Incident submitted') && /INC-2027-/.test(bodyText()));

  console.log('== SOS SCREEN ==');
  await navTab('home');
  await clickSel('#floatSos'); await sleep(200);
  ok('SOS hold-to-activate', bodyText().includes('HOLD 3s') && !!$('#holdbtn') && !!$('#holdring'));
  ok('SOS categories', $$('#soscat option').length===5);

  console.log('== FIELD REPORT ==');
  await navTab('report');
  const fr=$('#pbody [data-go="fieldreport"]'); fr.click(); await sleep(200);
  ok('structured questions', $$('#frqs [data-qi]').length>=3);
  $$('#frqs .seg [data-v="OBSERVED"]').slice(0,2).forEach(s=>s.click());
  await clickSel('#frsend'); await sleep(500);

  console.log('== MESSAGES ==');
  await navTab('profile');
  await clickSel('#pbody [data-go="messages"]'); await sleep(300);
  ok('messages screen', !!$('#msgtarget') && !!$('#msgtext'));
  $('#msgtext').value='Field test message from harness';
  await clickSel('#msgsend'); await sleep(400);
  const msgRes=await fetch(BASE+'/api/messages',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('message stored server-side', msgRes.rows.some(m=>m.body.includes('Field test message')));

  console.log('== SYNC CENTRE ==');
  await navTab('profile');
  await clickSel('#pbody [data-go="sync"]'); await sleep(200);
  ok('sync centre renders', bodyText().includes('SYNC CENTRE') && !!$('#syncnow'));

  console.log('== SECURITY ==');
  await navTab('profile');
  await clickSel('#pbody [data-go="security"]'); await sleep(200);
  ok('security centre', bodyText().includes('SECURITY CENTRE') && bodyText().includes('Device authorization') && !!$('#lockacc'));

  console.log('== SETTINGS / HELP / CONTACTS / PERFORMANCE / MAP / DEVICE ==');
  await navTab('profile');
  await clickSel('#pbody [data-go="settings"]'); await sleep(150);
  ok('settings switches', $$('#pbody .sw').length===3 && bodyText().includes('Change PIN'));
  await navTab('profile');
  await clickSel('#pbody [data-go="help"]'); await sleep(150);
  ok('help accordions', $$('.help-sec').length===8);
  await navTab('profile');
  await clickSel('#pbody [data-go="contacts"]'); await sleep(150);
  ok('contacts groups', bodyText().includes('OPERATIONAL CONTACTS') && bodyText().includes('Supervisor'));
  await navTab('profile');
  await clickSel('#pbody [data-go="performance"]'); await sleep(150);
  ok('performance tiles', bodyText().includes('MY PERFORMANCE') && $$('.stat-tile').length===6);
  await navTab('profile');
  await clickSel('#pbody [data-go="map"]'); await sleep(400);
  ok('mini map renders', $$('#mymap svg polygon').length>0);
  await navTab('profile');
  await clickSel('#pbody [data-go="device"]'); await sleep(150);
  ok('device screen', bodyText().includes('DEVICE & REGISTRATION') && bodyText().includes('Status'));

  console.log('== DUTY SUMMARY ==');
  await navTab('profile');
  await clickSel('#pbody [data-go="dutysummary"]'); await sleep(200);
  ok('field duty summary', bodyText().includes('FIELD DUTY SUMMARY') && bodyText().includes('Results submitted') && !!$('#dcomplete'));

  console.log('== BACKEND API CHECKS ==');
  const dv=await fetch(BASE+'/api/agent/device',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('device endpoint integrity', dv.integrity && dv.integrity.deviceAuthorized===true);
  const ev=await fetch(BASE+'/api/agent/evidence',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('agent evidence list', Array.isArray(ev.rows));
  const fr2=await fetch(BASE+'/api/reports/field',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({type:'Harness check',answers:{},note:'ok'})}).then(r=>r.json());
  ok('field report endpoint 201', fr2.id!=null);
  const frs=await fetch(BASE+'/api/export?type=verification&format=json',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.status);
  ok('agent blocked from exports (RBAC)', frs===403);

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  console.log('runtime errors:', errors.length?errors.slice(0,6).join(' // '):'none');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
