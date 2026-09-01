// public-test.js — drives EYES OF VICTORY — ELECTION OBSERVATORY 2.0 (public, no auth)
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
  console.log('== PUBLIC API (no auth) ==');
  const k=await fetch(BASE+'/api/public/kpis').then(r=>r.json());
  ok('kpis shape + disclaimer', k.kpis.totalPu>0 && k.disclaimer.includes('UNOFFICIAL MONITORING DATA') && k.sources.field.kind==='MONITORING DATA' && k.sources.irev.kind==='IReV OBSERVATION');
  ok('lifecycle + phase', ['PRE_ELECTION','ELECTION_DAY','POST_ELECTION'].includes(k.lifecycle));
  const act=await fetch(BASE+'/api/public/activity?limit=10').then(r=>r.json());
  ok('public activity feed (LGA-level)', act.rows.length>0 && act.rows.every(r=>r.loc && !r.puId) && act.note.includes('no agent identity'));
  const wards=await fetch(BASE+'/api/public/wards').then(r=>r.json());
  ok('public ward profiles', wards.rows.length>0 && 'coveragePct' in wards.rows[0]);
  const puCode = wards.rows[0] ? null : null;
  // PU public profile via reconciliation rows
  const rec=await fetch(BASE+'/api/public/reconciliation').then(r=>r.json());
  ok('public reconciliation (no votes published)', rec.rows.length>0 && rec.disclaimer.includes('no vote figures'));
  const puProfile=await fetch(BASE+'/api/public/pus/'+rec.rows[0].code).then(r=>r.json());
  ok('PU public monitoring record', puProfile.pu && puProfile.monitoring && puProfile.monitoring.reconciliation);
  const search=await fetch(BASE+'/api/public/search?q=Tarauni').then(r=>r.json());
  ok('public search (Tarauni)', search.results.some(r=>r.type==='LGA' && r.stats));
  const exports=await fetch(BASE+'/api/public/export?type=kpis&format=json').then(r=>r.json());
  ok('open-data export kpis', exports.rows.length>0 && exports.generatedAt);
  const csv=await fetch(BASE+'/api/public/export?type=lgas&format=csv').then(r=>r.text());
  ok('open-data export csv', csv.includes('lga,senatorial'));
  const docs=await fetch(BASE+'/api/public/api-docs').then(r=>r.json());
  ok('api docs', docs.endpoints.length>=10 && docs.terms.includes('Never exposed'));
  const corr=await fetch(BASE+'/api/public/corrections').then(r=>r.json());
  ok('corrections endpoint', Array.isArray(corr.rows));

  console.log('== CORRECTIONS + REPORTS WORKFLOW (admin side) ==');
  {
    const pio=await apiLogin('pio','PIO@123!');
    const c=await fetch(BASE+'/api/admin/public/corrections',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pio.token},body:JSON.stringify({original:'Reporting stated 89%',corrected:'Reporting corrected to 88.4%',reason:'One LGA re-counted duplicate submissions.',affected:'Kano North LGAs'})}).then(r=>r.json());
    ok('correction published by PIO', c.code && c.code.startsWith('CORR-'));
    const rep=await fetch(BASE+'/api/reports/generate',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pio.token},body:JSON.stringify({type:'CENTRAL_SITREP'})}).then(r=>r.json());
    const pub=await fetch(BASE+'/api/admin/reports/'+rep.id+'/publish',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pio.token},body:JSON.stringify({title:'Election Day Situation Report — Collation Phase'})}).then(r=>r.json());
    ok('report published', pub.status==='PUBLISHED');
    const pubReports=await fetch(BASE+'/api/public/reports').then(r=>r.json());
    ok('public reports list shows published', pubReports.rows.some(r=>r.id===rep.id && r.title.includes('Collation Phase')));
    const corr2=await fetch(BASE+'/api/public/corrections').then(r=>r.json());
    ok('correction visible publicly', corr2.rows.some(r=>r.code===c.code));
  }

  console.log('== UI (jsdom, public) ==');
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message.split('\n')[0]));
  vc.on('error',(...a)=>errors.push(String(a[0]).slice(0,140)));
  const html=await fetch(BASE+'/public').then(r=>r.text());
  const dom=new JSDOM(html,{url:BASE+'/public',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;
  w.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
  w.EventSource=class{constructor(u){}close(){}};
  w.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
  w.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
  w.requestAnimationFrame=(fn)=>setTimeout(fn,50);
  w.cancelAnimationFrame=(t)=>clearTimeout(t);
  w.addEventListener('error',e=>errors.push('winerr: '+(e.message||'')));
  w.scrollTo=function(){};
  const $=(s,r)=>w.document.querySelector(s);
  const $$=(s,r)=>Array.from((r||w.document).querySelectorAll(s));
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const nav=async(id)=>{
    const a=$$('#nav [data-n]').find(x=>x.dataset.n===id);
    if(!a){
      // sub-views are reached through in-page links per the spec's navigation structure — use hash routing
      w.location.hash = '#'+id;
      w.dispatchEvent(new w.HashChangeEvent('hashchange'));
      await sleep(700);
      return true;
    }
    a.click();await sleep(700);return true;
  };
  const bodyText=()=>w.document.body.textContent.replace(/\s+/g,' ');
  await sleep(2600);

  console.log('-- HOME (§3, §59) --');
  ok('hero', bodyText().includes('THE ELECTION, AS IT HAPPENS.'));
  ok('CTA buttons', bodyText().includes('LIVE ELECTION MONITOR') && bodyText().includes('EXPLORE RESULTS'));
  ok('live status cards (7)', $$('.kpis .kpi').length>=7);
  ok('source + status + last updated', bodyText().includes('MONITORING DATA') && bodyText().includes('last updated'));
  ok('lifecycle banner', bodyText().includes('LIVE MONITORING ACTIVE') || bodyText().includes('POST-ELECTION RECONCILIATION ACTIVE') || bodyText().includes('ELECTION MONITORING STARTS'));
  ok('home map polygons', $$('#homemap svg polygon').length>0);
  ok('what changed feed', bodyText().includes('WHAT CHANGED?'));
  ok('IReV watch + explanation', bodyText().includes('IReV WATCH') && bodyText().includes('does not automatically establish wrongdoing'));
  ok('why trust pillars', bodyText().includes('INDEPENDENT MONITORING') && bodyText().includes('EVIDENCE RECONCILIATION') && bodyText().includes('TRANSPARENT METHODOLOGY'));
  ok('permanent footer disclaimer', bodyText().includes('should not be interpreted as official election results'));

  console.log('-- LIVE / MAP --');
  ok('live view', await nav('live') && bodyText().includes('ELECTION DAY LIVE'));
  ok('map view + legend', await nav('map') && $$('#bigmap svg polygon').length>0 && bodyText().includes('NO DATA YET') && bodyText().includes('never imply political party performance'));
  ok('map filters + search', $$('#mfilters .chip').length===3 && !!$('#msearch'));
  ok('LGA profile modal', await (async()=>{
    // find an LGA via public search then open profile through search input
    $('#msearch').value='Nasarawa';
    $('#msearch').dispatchEvent(new w.Event('input',{bubbles:true}));
    await sleep(900);
    const hasModal = $$('.overlay').length>0 && bodyText().includes('LGA ELECTION MONITORING PROFILE');
    const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);
    return hasModal;
  })());
  ok('ward modal + PU record', await (async()=>{
    // direct: LGA profile → wards → PU profile
    const pu=rec.rows[0];
    const m=puProfileModal ? true : true;
    // use search path
    $('#msearch').value=pu.code;
    $('#msearch').dispatchEvent(new w.Event('input',{bubbles:true}));
    await sleep(900);
    const hasPu = $$('.overlay').length>0 && bodyText().includes('POLLING UNIT MONITORING RECORD');
    const x=$$('.overlay .mf .btn').pop(); if(x)x.click(); await sleep(150);
    return hasPu;
  })());
  function puProfileModal(){}

  console.log('-- RESULTS (§11-15) --');
  ok('results observatory', await nav('results') && bodyText().includes('RESULT OBSERVATORY') && bodyText().includes('no "winner" is ever declared prematurely'));
  ok('status legend', bodyText().includes('RECONCILED') && bodyText().includes('UNDER REVIEW') && bodyText().includes('PENDING'));
  ok('result table rows', $$('#rtable table.tbl tbody tr').length>0);
  ok('filters', !!$('#rq') && !!$('#rlga') && !!$('#rstatus'));

  console.log('-- IReV WATCH (§16-19) --');
  ok('irev overview', await nav('irev') && bodyText().includes('What does IReV Watch mean?') && bodyText().includes('Document changes observed'));
  ok('change monitor', $$('#cf .small').length>0 || bodyText().includes('No public changes yet'));
  ok('never-deleted language', bodyText().includes('never means a record was deleted'));

  console.log('-- KANO (§27-28) --');
  ok('kano dashboard', await nav('kano') && bodyText().includes('KANO STATE — LIVE MONITORING') && bodyText().includes('SENATORIAL DISTRICTS'));
  ok('kano LGA list', $$('#klgas table.tbl tbody tr').length>0);

  console.log('-- INCIDENTS (§20-23) --');
  ok('incident monitor', await nav('incidents') && bodyText().includes('ELECTION INCIDENT MONITOR') && bodyText().includes('never published as established facts'));
  ok('categories + byLga', $$('#il .small').length>0 && $$('#icats .small').length>0);
  ok('incident map (ward/LGA level)', await nav('incmap') && $$('#imap svg polygon').length>0 && bodyText().includes('ward/LGA level only'));

  console.log('-- STATISTICS (§24-26) --');
  ok('stats + donut + bars', await nav('stats') && $$('#donut svg').length>0 && $$('#lgbars svg').length>0);
  ok('district + state tables', bodyText().includes('STATISTICS BY SENATORIAL DISTRICT') && bodyText().includes('STATISTICS BY STATE'));
  ok('not political performance', bodyText().includes('never political performance indicators'));

  console.log('-- REPORTS / TRANSPARENCY / MEDIA / API --');
  ok('reports list incl. published', await nav('reports') && bodyText().includes('Election Day Situation Report — Collation Phase'));
  ok('transparency index', await nav('transparency') && bodyText().includes('METHODOLOGY FLOW') && bodyText().includes('PUBLICATION'));
  ok('methodology + status legend', await nav('methodology') && bodyText().includes('DATA STATUS LEGEND') && bodyText().includes('VERIFIED'));
  ok('data sources (official vs independent)', await nav('sources') && bodyText().includes('OFFICIAL ELECTION RESULTS') && bodyText().includes('INDEPENDENT MONITORING INFORMATION'));
  ok('verification process', await nav('verification') && bodyText().includes('AUTOMATED SIGNAL → HUMAN REVIEW'));
  ok('corrections centre shows published correction', await nav('corrections') && bodyText().includes('CORRECTION NOTICE') && bodyText().includes('Reporting corrected to 88.4%'));
  ok('privacy policy', await nav('privacy') && bodyText().includes('agent information is protected'));
  ok('media data desk', await nav('desk') && $$('[data-exp]').length===10);
  ok('api docs table', await nav('api') && $$('#apibody table.tbl tbody tr').length>=10);
  ok('search view', await nav('search') && !!$('#sq'));

  console.log('-- MOBILE BOTTOM NAV + LOW DATA --');
  {
    Object.defineProperty(w, 'innerWidth', { value: 700, configurable: true });
    w.dispatchEvent(new w.Event('resize'));
    await sleep(300);
    ok('mobile bottom nav visible', $('#bnav').style.display==='flex' && $$('#bnav .bn2').length===6);
    Object.defineProperty(w, 'innerWidth', { value: 1400, configurable: true });
    w.dispatchEvent(new w.Event('resize'));
    await sleep(200);
    ok('bottom nav hidden on desktop', $('#bnav').style.display==='none');
    // low data mode
    await nav('map');
    await $('#lowdata').click(); await sleep(400);
    ok('low data mode swaps map for table', bodyText().includes('Low data mode — text coverage table') && $$('#lgtbl table.tbl tbody tr').length>0);
    await $('#lowdata').click(); await sleep(300);
  }

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  console.log('runtime errors:', errors.length?errors.slice(0,6).join(' // '):'none');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
