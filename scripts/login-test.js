// login-test.js — exercises the enhanced glass login UI (no pre-seeded session)
let jsdomMod;
try { jsdomMod = require('jsdom'); }
catch (e) {
  try { jsdomMod = require('/tmp/uitest/node_modules/jsdom'); }
  catch (e2) { console.error('jsdom not found — run: npm install (repo) or cd /tmp/uitest && npm install jsdom'); process.exit(1); }
}
const { JSDOM, VirtualConsole } = jsdomMod;
const BASE = 'http://localhost:3000';
function canvasMock(){const g={addColorStop(){}};return{fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},arc(){},fillText(){},closePath(){},save(){},restore(){},scale(){},translate(){},rotate(){},clearRect(){},drawImage(){},rect(){},setLineDash(){},createLinearGradient:()=>g,createRadialGradient:()=>g,createPattern:()=>g,measureText:()=>({width:10}),set fillStyle(v){},set strokeStyle(v){},set lineWidth(v){},set font(v){},set textAlign(v){},set globalAlpha(v){}};}
let pass=0, fail=0;
const ok=(name,cond,extra='')=>{ if(cond){pass++;console.log('  ✓ '+name);} else {fail++;console.log('  ✗ FAIL '+name+(extra?' — '+extra:''));} };

(async()=>{
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message.split('\n')[0]));
  vc.on('error',(...a)=>errors.push(String(a[0]).slice(0,160)));
  const html=await fetch(BASE+'/central').then(r=>r.text());
  const dom=new JSDOM(html,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window;
  w.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
  w.EventSource=class{constructor(u){}close(){}};
  w.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
  w.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
  w.requestAnimationFrame=(fn)=>setTimeout(fn,50);
  w.cancelAnimationFrame=(t)=>clearTimeout(t);
  w.scrollTo=function(){};
  w.addEventListener('error',e=>errors.push('winerr: '+(e.message||'')));
  const $=(s,r)=>w.document.querySelector(s);
  const $$=(s,r)=>Array.from((r||w.document).querySelectorAll(s));
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const waitFor=async(fn,timeout=6000)=>{ const t0=Date.now(); while(Date.now()-t0<timeout){ try{ const v=fn(); if(v) return v; }catch(e){} await sleep(150); } return null; };
  await sleep(2600);

  console.log('== GLASS LOGIN RENDERS ==');
  ok('login card present', !!$('.login-card'));
  ok('glass styling applied', !!$('.secure-pill') && !!$('#pwtoggle') && !!$('#remember'));
  ok('brand block', w.document.body.textContent.includes('EYES OF VICTORY') && w.document.body.textContent.includes('SECURE CONNECTION'));
  ok('input icons', $$('.step1 .inp-wrap .inp-ic').length===2);
  ok('demo quick-fill chip', !!$('#qfill'));
  ok('preloader removed', !$('#ev-preloader'));

  console.log('== INTERACTIONS ==');
  // password toggle
  const lp=$('#lp'); ok('pw type starts password', lp.type==='password');
  $('#pwtoggle').click(); ok('pw toggle reveals', lp.type==='text');
  $('#pwtoggle').click(); ok('pw toggle hides again', lp.type==='password');
  // quick-fill
  $('#qfill').click();
  ok('quick-fill sets agent id', $('#lu').value==='director');
  ok('quick-fill sets password', $('#lp').value==='Director@123!');
  // wrong password → shake + human error
  $('#lp').value='wrong';
  $('#lbtn').click(); await sleep(900);
  ok('wrong password shows error', w.document.body.textContent.includes('Invalid username or password'));
  ok('shake class applied', $('.login-card').classList.contains('shake'));
  ok('button restored', $('#lbtn').textContent.includes('SECURE LOGIN'));
  // correct password → OTP step
  $('#lp').value='Director@123!';
  $('#lbtn').click(); await sleep(900);
  ok('moves to MFA step', $('.step2').style.display==='block');
  ok('6 OTP boxes', $$('#otpboxes input').length===6);
  ok('demo TOTP pill shown', $('#otpshow').textContent.includes('DEMO OTP'));
  ok('countdown timer present', !!$('#otptimer'));
  ok('timer matches TOTP 30s rotation (M2)', /^0:[0-3]\d$/.test($('#otptimer').textContent), 'got: '+$('#otptimer').textContent);
  ok('resend disabled initially', $('#resend').classList.contains('disabled'));
  // type OTP via boxes (read the demo code from the pill)
  const codeMatch = $('#otpshow').textContent.match(/(\d{6})/);
  ok('code extractable', !!codeMatch);
  const inputs=$$('#otpboxes input');
  // VERIFY disabled until 6 digits
  ok('verify disabled while incomplete', $('#mbtn').disabled===true);
  // incomplete submit path — Enter key in an empty box (routes through doVerify)
  inputs[2].dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  await sleep(250);
  ok('incomplete shows visible error', !!$('#autherr') && $('#autherr').style.display==='block' && w.document.body.textContent.includes('all 6 digits'));
  // wrong code → VISIBLE error via auto-submit on 6th digit + attempts + clear
  '999999'.split('').forEach((ch,i)=>{ inputs[i].value=ch; inputs[i].dispatchEvent(new w.Event('input',{bubbles:true})); });
  ok('hidden #lc synced to boxes', $('#lc').value==='999999');
  await sleep(1000);
  ok('wrong OTP blocked with visible error', !!$('#autherr') && $('#autherr').style.display==='block' && w.document.body.textContent.includes('Incorrect verification code'));
  ok('attempts remaining shown', w.document.body.textContent.includes('attempts remaining'));
  ok('boxes cleared on failure', $$('#otpboxes input').every(x=>x.value===''));
  ok('login screen still present after failure', !!$('#mbtn') && !$('.app'));
  // one-click demo fill → authenticated transition screen, then shell
  $('#fillcode').click(); await sleep(500);
  ok('AUTHENTICATED transition screen replaces OTP', w.document.body.textContent.includes('AUTHENTICATED') && w.document.body.textContent.includes('SECURE SESSION ESTABLISHED') && !$('#otpboxes'));
  await sleep(1800);
  ok('USE DISPLAYED CODE auto-authenticates', !!$('.app') && !!$('#sidebar'));
  ok('director dashboard content', w.document.body.textContent.includes('CENTRAL OPERATIONAL HEALTH') || w.document.body.textContent.includes('Polling units'));
  // ---- fresh sessions (sign-out navigates to the landing page by design) ----
  async function bootFresh() {
    const html2=await fetch(BASE+'/central').then(r=>r.text());
    const vc2=new VirtualConsole();
    let closed2=false;
    vc2.on('jsdomError',e=>{ if(!closed2) errors.push('d2: '+e.message.split('\n')[0]); });
    const dom2=new JSDOM(html2,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc2});
    const w2=dom2.window;
    w2.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
    w2.EventSource=class{constructor(u){}close(){}};
    w2.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w2.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w2.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w2.cancelAnimationFrame=(t)=>clearTimeout(t);
    w2.scrollTo=function(){};
    const $2=(s2)=>w2.document.querySelector(s2);
    const $$2=(s2)=>Array.from(w2.document.querySelectorAll(s2));
    await sleep(2400);
    const close2=()=>{ closed2=true; dom2.window.close(); };
    return {w2,$2,$$2,dom2,close2};
  }
  // scenario A: manual correct typing auto-submits on the 6th digit
  {
    const {w2,$2,$$2,dom2,close2}=await bootFresh();
    $2('#qfill').click();
    $2('#lbtn').click(); await sleep(1000);
    ok('session A: MFA screen', $2('.step2').style.display==='block');
    const cm=$2('#otpshow').textContent.match(/(\d{6})/);
    const ins=$$2('#otpboxes input');
    cm[1].split('').forEach((ch,i)=>{ ins[i].value=ch; ins[i].dispatchEvent(new w2.Event('input',{bubbles:true})); });
    await sleep(2000);
    ok('auto-submit on 6th digit authenticates', !!$2('.app') && !!$2('#sidebar'));
    close2();
  }
  // scenario B: MFA_LOCKED after 3 bad codes → returns to sign-in with clear message
  {
    const {w2,$2,$$2,dom2,close2}=await bootFresh();
    $2('#qfill').click();
    $2('#lbtn').click(); await sleep(1000);
    ok('session B: MFA screen', $2('.step2').style.display==='block');
    for (let attempt=1; attempt<=3; attempt++) {
      const ins=$$2('#otpboxes input');
      ins.forEach(x=>{ x.value=''; x.classList.remove('filled'); });
      '888888'.split('').forEach((ch,i)=>{ ins[i].value=ch; ins[i].dispatchEvent(new w2.Event('input',{bubbles:true})); });
      await sleep(900);
    }
    await sleep(1800);
    ok('MFA_LOCKED after 3 bad codes → back to sign-in', $2('.step1').style.display==='block' && w2.document.body.textContent.includes('Too many incorrect codes'));
    ok('login button restored', !!$2('#lbtn') && !$2('#lbtn').disabled);
    close2();
  }
  // ---- scenario C: blocked localStorage (sandboxed-iframe / privacy mode) ----
  {
    const html3=await fetch(BASE+'/central').then(r=>r.text());
    const vc3=new VirtualConsole();
    let closed3=false;
    vc3.on('jsdomError',e=>{ if(!closed3) errors.push('d3: '+e.message.split('\n')[0]); });
    const dom3=new JSDOM(html3,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc3,beforeParse(w3){
      Object.defineProperty(w3,'localStorage',{configurable:true,get(){throw new w3.DOMException('Access denied','SecurityError');}});
    }});
    const w3=dom3.window;
    w3.fetch=(i,o)=>fetch(String(i).startsWith('http')?String(i):BASE+String(i),o);
    w3.EventSource=class{constructor(u){}close(){}};
    w3.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w3.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w3.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w3.cancelAnimationFrame=(t)=>clearTimeout(t);
    w3.scrollTo=function(){};
    const $3=(s2)=>w3.document.querySelector(s2);
    await sleep(2400);
    ok('storage-blocked: login renders', !!$3('#lbtn'));
    $3('#qfill').click();
    $3('#lbtn').click(); await sleep(1000);
    ok('storage-blocked: OTP screen', $3('.step2').style.display==='block');
    $3('#fillcode').click(); await sleep(2800);
    ok('storage-blocked: authenticates into shell', !!$3('.app') && !!$3('#sidebar'));
    closed3=true; dom3.window.close();
  }
  // ---- scenario D: network failure on verify → visible error + RETRY succeeds ----
  {
    const html4=await fetch(BASE+'/central').then(r=>r.text());
    const vc4=new VirtualConsole();
    let closed4=false;
    vc4.on('jsdomError',e=>{ if(!closed4) errors.push('d4: '+e.message.split('\n')[0]); });
    const dom4=new JSDOM(html4,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc4});
    const w4=dom4.window;
    let failNextMfa=true;
    const realFetch4=global.fetch;
    w4.fetch=(i,o)=>{
      const url=String(i).startsWith('http')?String(i):BASE+String(i);
      if (failNextMfa && url.includes('/api/auth/mfa')) { failNextMfa=false; return Promise.reject(new TypeError('Failed to fetch')); }
      return realFetch4(url,o);
    };
    w4.EventSource=class{constructor(u){}close(){}};
    w4.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w4.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w4.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w4.cancelAnimationFrame=(t)=>clearTimeout(t);
    w4.scrollTo=function(){};
    const $4=(s2)=>w4.document.querySelector(s2);
    const $$4=(s2)=>Array.from(w4.document.querySelectorAll(s2));
    await sleep(2400);
    $4('#qfill').click();
    $4('#lbtn').click(); await sleep(1000);
    const cm=$4('#otpshow').textContent.match(/(\d{6})/);
    const ins=$$4('#otpboxes input');
    cm[1].split('').forEach((ch,i)=>{ ins[i].value=ch; ins[i].dispatchEvent(new w4.Event('input',{bubbles:true})); });
    await sleep(1000);
    ok('network fail: visible error + code preserved', $4('#autherr').style.display==='block' && w4.document.body.textContent.includes('could not reach the server') && $$4('#otpboxes input').every(x=>x.value!==''));
    ok('network fail: RETRY button', $4('#mbtn').textContent.includes('RETRY'));
    $4('#mbtn').click(); await sleep(2200);
    ok('network fail: retry authenticates', !!$4('.app'));
    closed4=true; dom4.window.close();
  }
  // ---- scenario E: portal data load fails after auth → visible recovery screen (never frozen) ----
  {
    const html5=await fetch(BASE+'/central').then(r=>r.text());
    const vc5=new VirtualConsole();
    let closed5=false;
    vc5.on('jsdomError',e=>{ if(!closed5) errors.push('d5: '+e.message.split('\n')[0]); });
    const dom5=new JSDOM(html5,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc5});
    const w5=dom5.window;
    const realFetch5=global.fetch;
    w5.fetch=(i,o)=>{
      const url=String(i).startsWith('http')?String(i):BASE+String(i);
      // let auth through, but kill the portal data load
      if (url.includes('/api/bootstrap') || url.includes('/api/overview')) return Promise.reject(new TypeError('Failed to fetch'));
      return realFetch5(url,o);
    };
    w5.EventSource=class{constructor(u){}close(){}};
    w5.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w5.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w5.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w5.cancelAnimationFrame=(t)=>clearTimeout(t);
    w5.scrollTo=function(){};
    const $5=(s2)=>w5.document.querySelector(s2);
    await sleep(2400);
    $5('#qfill').click();
    $5('#lbtn').click(); await sleep(1000);
    $5('#fillcode').click(); await sleep(1200);
    ok('scenario E: auth succeeded (transition shown)', w5.document.body.textContent.includes('AUTHENTICATED'));
    // apiBoot retries 3x with backoff (~4-6s) then recovery UI appears
    await sleep(8000);
    ok('scenario E: recovery screen with RETRY (no frozen transition)', w5.document.body.textContent.includes('COMMAND DATA UNAVAILABLE') && !!$5('#bretry') && !$5('#otpboxes'));
    closed5=true; dom5.window.close();
  }
  // ---- scenario F: /api/me hiccup on first attempt → retry recovers permissions ----
  {
    const html6=await fetch(BASE+'/central').then(r=>r.text());
    const vc6=new VirtualConsole();
    let closed6=false;
    vc6.on('jsdomError',e=>{ if(!closed6) errors.push('d6: '+e.message.split('\n')[0]); });
    const dom6=new JSDOM(html6,{url:BASE+'/central',runScripts:'dangerously',resources:'usable',pretendToBeVisual:true,virtualConsole:vc6});
    const w6=dom6.window;
    const realFetch6=global.fetch;
    let meFailures=0;
    w6.fetch=(i,o)=>{
      const url=String(i).startsWith('http')?String(i):BASE+String(i);
      if (url.includes('/api/me') && meFailures < 1) { meFailures++; return Promise.reject(new TypeError('Failed to fetch')); }
      return realFetch6(url,o);
    };
    w6.EventSource=class{constructor(u){}close(){}};
    w6.HTMLCanvasElement.prototype.getContext=function(){return canvasMock();};
    w6.HTMLCanvasElement.prototype.toDataURL=function(){return 'data:image/png;base64,AAAA';};
    w6.requestAnimationFrame=(fn)=>setTimeout(fn,50);
    w6.cancelAnimationFrame=(t)=>clearTimeout(t);
    w6.scrollTo=function(){};
    const $6=(s2)=>w6.document.querySelector(s2);
    const $$6=(s2)=>Array.from(w6.document.querySelectorAll(s2));
    await sleep(2400);
    $6('#qfill').click();
    $6('#lbtn').click(); await sleep(1000);
    $6('#fillcode').click(); await sleep(2600);
    ok('scenario F: dashboard renders despite /api/me hiccup', !!$6('.app') && !!$6('#sidebar'));
    ok('scenario F: role permissions restored (nav present)', $$6('#sidebar .nav-item[data-nav]').length >= 10);
    closed6=true; dom6.window.close();
  }
  ok('no runtime errors', errors.length===0, errors.slice(0,4).join(' // '));

  console.log('\nRESULT: '+pass+' passed, '+fail+' failed');
  dom.window.close();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('HARNESS FAILURE:', e.stack.split('\n').slice(0,4).join('\n')); process.exit(1); });
