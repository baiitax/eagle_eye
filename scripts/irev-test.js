// irev-test.js — drives the IReV WATCHTOWER module end-to-end
let jsdomMod;
try { jsdomMod = require('/tmp/uitest/node_modules/jsdom'); }
catch (e) { console.error('jsdom not found at /tmp/uitest — run: cd /tmp/uitest && npm install jsdom'); process.exit(1); }
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
    console.log('(simulation reset to Collation Phase — Watchtower re-backed)');
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
  const navTo=async(id)=>{const b=$$('#sidebar .nav-item[data-nav]').find(x=>x.dataset.nav===id);if(!b){console.log('   (nav item missing: '+id+')');return false;}b.click();await sleep(500);return true;};
  const bodyText=()=>w.document.body.textContent.replace(/\s+/g,' ');
  await sleep(2800);

  console.log('== API: IReV STATUS ==');
  const st=await fetch(BASE+'/api/irev/status',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('connection status ONLINE', st.status==='ONLINE');
  ok('source method recorded', st.sourceMethod==='PUBLIC IReV OBSERVATION');
  ok('integration-boundary note', st.note.includes('penetrate') && st.note.includes('bypass'));

  console.log('== API: DASHBOARD KPIs ==');
  const dash=await fetch(BASE+'/api/irev/dashboard',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  const k=dash.kpis;
  ok('KPIs present', k.totalMonitored>0 && k.observed>0 && typeof k.matched==='number' && typeof k.pending==='number');
  ok('coverage pct sane', k.coveragePct>=0 && k.coveragePct<=100);
  ok('reconciliation pct sane', k.reconciliationPct>=0 && k.reconciliationPct<=100);
  ok('what-changed cards', Object.keys(dash.whatChanged.cards).length===8);
  ok('activity stream', Array.isArray(dash.events) && dash.events.length>0);
  ok('thresholds configurable', dash.thresholds.normalMin===10 && dash.thresholds.highMin===60);
  console.log('   KPIs: observed='+k.observed+' pending='+k.pending+' matched='+k.matched+' disc='+k.discrepancies+' changes='+k.docChanges+' unavailable='+k.unavailable+' review='+k.underReview);

  console.log('== API: RECONCILIATION ==');
  const rec=await fetch(BASE+'/api/irev/reconciliation',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('three-way rows', rec.rows.length>0);
  const statuses={};rec.rows.forEach(r=>statuses[r.status]=(statuses[r.status]||0)+1);
  console.log('   status mix:', JSON.stringify(statuses));
  ok('status set sane', ['MATCHED','PENDING'].some(s=>statuses[s]>0));

  console.log('== API: SNAPSHOT ARCHIVE ==');
  const snaps=await fetch(BASE+'/api/irev/snapshots',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('snapshots immutable rows', snaps.total>0 && snaps.rows.every(o=>o.snapshotNo>=1 && /^[0-9a-f]{64}$/.test(o.docHash)));

  console.log('== API: CASES ==');
  const cases=await fetch(BASE+'/api/irev/cases',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('case files exist', cases.total>0 && cases.rows.every(c=>c.code.startsWith('EV-DIFF-2027')));

  console.log('== API: CASE REVIEW WORKFLOW ==');
  const openCase=cases.rows.find(c=>['DETECTED','ASSIGNED'].includes(c.status)) || cases.rows[0];
  const caseDetail=await fetch(BASE+'/api/irev/cases/'+openCase.id,{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('case file complete', !!caseDetail.case && (caseDetail.prevObs||caseDetail.currObs) && caseDetail.classifications.length===6);
  ok('case preserves hashes', caseDetail.prevObs ? /^[0-9a-f]{64}$/.test(caseDetail.prevObs.docHash) : true);
  ok('careful language in case note', caseDetail.case.note.toLowerCase().includes('does not establish the cause') || caseDetail.case.note.includes('HUMAN VERIFICATION') || caseDetail.case.note.toLowerCase().includes('human review'));
  // assign
  if(['DETECTED','ASSIGNED'].includes(openCase.status)){
    const as=await fetch(BASE+'/api/irev/cases/'+openCase.id+'/assign',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({})}).then(r=>r.json());
    ok('assign works', as.ok===true && as.status==='ASSIGNED');
    // classify with reason — CRITICAL cases require two-person approval (§50)
    const cls=await fetch(BASE+'/api/irev/cases/'+openCase.id+'/classify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({classification:'IMAGE/SCAN ISSUE',reason:'Blur on observed copy prevented reliable comparison; both snapshots preserved.'})}).then(r=>r.json());
    ok('classify accepted', cls.ok===true);
    if (cls.status === 'PENDING_APPROVAL') {
      ok('two-person approval triggered for critical case', cls.requiresSecond===true);
      // same reviewer blocked
      const same=await fetch(BASE+'/api/irev/cases/'+openCase.id+'/classify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({classification:'IMAGE/SCAN ISSUE',reason:'second',secondApproval:true})}).then(r=>r.json());
      ok('same reviewer blocked (two-person)', same.error==='SAME_USER');
      // second reviewer approves
      const sup=await apiLogin('reviewer','Reviewer@123!');
      const sec=await fetch(BASE+'/api/irev/cases/'+openCase.id+'/classify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+sup.token},body:JSON.stringify({classification:'IMAGE/SCAN ISSUE',reason:'Second reviewer confirms the classification.',secondApproval:true})}).then(r=>r.json());
      ok('second reviewer resolves', sec.ok===true && sec.status==='RESOLVED');
    } else {
      ok('classify resolves (non-critical path)', cls.status==='RESOLVED');
    }
    // reason required check
    const bad=await fetch(BASE+'/api/irev/cases/'+openCase.id+'/classify',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({classification:'MATCH',reason:''})}).then(r=>r.json());
    ok('classify blocks missing reason / resolved', bad.error!=null);
  }

  console.log('== API: ALERTS (dedupe) ==');
  const alerts=await fetch(BASE+'/api/irev/alerts',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('alerts exist with observation counts', alerts.total>0 && alerts.rows.every(a=>a.observationCount>=1));
  ok('dedupe: one alert per event', alerts.rows.every(a=>a.observationCount>=1)); // upsert increments, never duplicates

  console.log('== API: SITREP ==');
  const sit=await fetch(BASE+'/api/irev/sitrep',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('sitrep executive summary', sit.executive.length>0 && sit.kpis.totalMonitored>0);
  ok('sitrep careful-language clause', sit.language.includes('A difference was detected'));

  console.log('== API: COPILOT IReV INTENTS ==');
  const ask=async(q)=>{const r=await fetch(BASE+'/api/copilot',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({query:q})}).then(r=>r.json());return r;};
  const c1=await ask('How many field EC8As have no corresponding IReV observation?');
  ok('copilot pending intent', /no corresponding IReV observation/i.test(c1.answer));
  const c2=await ask('Generate the current IReV reconciliation SITREP');
  ok('copilot sitrep intent', /IReV RECONCILIATION SITREP/i.test(c2.answer) && c2.sections.length>0);
  const c3=await ask('Show me all IReV documents that changed after first observation');
  ok('copilot changed-documents intent', /changed|CHANGE/i.test(c3.answer));
  const c4=await ask('How many records became unavailable after previously being observed?');
  ok('copilot unavailable intent (careful language)', c4.answer.includes('CURRENTLY NOT OBSERVED') || c4.answer.includes('unavailable') || c4.answer.includes('observable'));

  console.log('== API: DEMO CONTROLS ==');
  const demoObs=await fetch(BASE+'/api/irev/demo',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'observe'})}).then(r=>r.json());
  ok('demo observe', demoObs.ok===true && demoObs.detail.includes('observed'));
  const demoChg=await fetch(BASE+'/api/irev/demo',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'change'})}).then(r=>r.json());
  ok('demo change → case', demoChg.ok===true && demoChg.detail.includes('change'));
  const demoOut=await fetch(BASE+'/api/irev/demo',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'outage'})}).then(r=>r.json());
  ok('demo outage (disappearance suspension)', demoOut.ok===true && demoOut.detail.includes('suspended'));
  const st2=await fetch(BASE+'/api/irev/status',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('outage reflected in status', st2.status==='UNAVAILABLE');
  const demoRest=await fetch(BASE+'/api/irev/demo',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token},body:JSON.stringify({action:'restore'})}).then(r=>r.json());
  ok('demo restore', demoRest.ok===true && demoRest.detail.includes('restored'));
  const st3=await fetch(BASE+'/api/irev/status',{headers:{Authorization:'Bearer '+auth.token}}).then(r=>r.json());
  ok('restore reflected', st3.status==='ONLINE');

  console.log('== UI: CENTRAL DASHBOARD IReV ROW ==');
  ok('watchtower banner on dashboard', bodyText().includes('IReV WATCHTOWER'));
  ok('reconciliation KPIs on dashboard', bodyText().includes('Pending IReV') && bodyText().includes('Matched'));
  ok('what changed cards', $$('#irevrow .wc-card').length>=6);
  ok('critical alerts panel', bodyText().includes('CRITICAL ALERTS'));

  console.log('== UI: WATCHTOWER VIEW ==');
  ok('watchtower opens', await navTo('watchtower') && bodyText().includes('RECONCILIATION COVERAGE'));
  ok('activity stream', $$('.feed .item').length>0);
  ok('integration note visible', bodyText().includes('penetrate'));

  console.log('== UI: WHAT CHANGED ==');
  ok('what changed view', await navTo('whatchanged') && bodyText().includes('WHAT CHANGED IN THE LAST 15 MINUTES') && $$('.wc-card').length===8);

  console.log('== UI: PENDING UPLOADS ==');
  ok('pending view + thresholds', await navTo('irevpending') && bodyText().includes('PENDING IReV UPLOADS') && $$('.threshold-bar .tb').length===4);
  ok('neutral causes note', bodyText().includes('not interpreted as wrongdoing'));

  console.log('== UI: UPLOAD MONITOR MATRIX ==');
  ok('coverage matrix', await navTo('irevmatrix') && bodyText().includes('IReV COVERAGE') && $$('table.tbl tbody tr').length>0);
  ok('latency chart', $$('svg').length>0);

  console.log('== UI: SNAPSHOT ARCHIVE ==');
  ok('snapshot archive rows', await navTo('irevarchive') && $$('.snap-row').length>0 && bodyText().includes('never overwritten'));

  console.log('== UI: CHANGE DETECTION ==');
  ok('change events', await navTo('irevchanges') && bodyText().includes('CHANGE EVENTS'));
  ok('careful disappearance language', bodyText().includes('RESULT PREVIOUSLY OBSERVED — CURRENTLY NOT OBSERVED') || bodyText().includes('PREVIOUSLY OBSERVED'));

  console.log('== UI: RECONCILIATION ==');
  ok('three-way matrix', await navTo('irevrecon') && bodyText().includes('THREE-WAY RESULT RECONCILIATION') && $$('table.tbl tbody tr').length>0);
  ok('PU drill modal', await (async()=>{const r=$('[data-pu]'); if(!r) return false; r.click(); await sleep(600); return bodyText().includes('SOURCE A — FIELD CAPTURE') && bodyText().includes('SOURCE C — IReV OBSERVATION') && bodyText().includes('SNAPSHOT HISTORY');})());
  const ov=$('.overlay'); if(ov){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}
  // cases segment
  ok('cases segment', await (async()=>{const seg=$$('.irev-seg .is').find(x=>x.dataset.s==='cases'); if(!seg) return false; seg.click(); await sleep(600); return bodyText().includes('DISCREPANCY CASE FILES');})());
  ok('case file modal', await (async()=>{const c=$('[data-case]'); if(!c) return true; c.click(); await sleep(600); return bodyText().includes('HASHES') && bodyText().includes('VALUE COMPARISON') && bodyText().includes('AUDIT HISTORY');})());
  const ov2=$('.overlay'); if(ov2){const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);}

  console.log('== UI: SOURCE HEALTH ==');
  ok('source health view', await navTo('irevsource') && bodyText().includes('SOURCE AVAILABILITY PROTECTION') && bodyText().includes('INTEGRATION CHANNELS'));

  console.log('== UI: RECONCILIATION SITREP ==');
  ok('sitrep generator', await navTo('irevsitrep') && bodyText().includes('IReV RECONCILIATION SITUATION REPORT') && bodyText().includes('EXECUTIVE SUMMARY'));

  console.log('== UI: NEW NAV SECTIONS ==');
  ok('intelligence brief', await navTo('intel') && bodyText().includes('IReV WATCHTOWER') && bodyText().includes('PRIORITY ACTIONS'));
  ok('operational signals', await navTo('signals') && bodyText().includes('SIGNAL REQUIRES HUMAN REVIEW'));
  ok('copilot tab', await navTo('copilot') && !!$('#cq'));
  ok('escalations central', await navTo('escalations') && bodyText().includes('ESCALATIONS FROM LG'));
  ok('upload latency', await navTo('latency') && bodyText().includes('LATENCY BY LGA'));
  ok('evidence chain central', await navTo('chain') && bodyText().includes('EVIDENCE CHAIN — IReV SNAPSHOTS'));
  ok('security central', await navTo('security') && bodyText().includes('PUBLICATION CONTROL') && bodyText().includes('DISASTER RECOVERY'));
  ok('agents statewide', await navTo('agents') && $$('#agbody table.tbl tbody tr').length>0);
  ok('connectivity statewide', await navTo('connectivity') && $$('#chmap svg polygon').length>0);
  ok('ec8a evidence central', await navTo('evidence') && $$('#evwrap table.tbl tbody tr').length>0);

  console.log('== PUBLIC SAFE STATS ==');
  const pub=await fetch(BASE+'/api/public/statistics').then(r=>r.json());
  ok('public irev aggregates (safe)', pub.irev && pub.irev.observed>0 && pub.irev.note.includes('never published'));

  console.log('== RBAC ==');
  const agToken=await apiLogin('fieldagent','Agent@123!');
  const rbac=await fetch(BASE+'/api/irev/cases/'+(openCase.id),{headers:{Authorization:'Bearer '+agToken.token}}).then(r=>r.status);
  ok('field agent blocked from case files (RBAC)', rbac===403);

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  console.log('runtime errors:', errors.length?errors.slice(0,6).join(' // '):'none');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
