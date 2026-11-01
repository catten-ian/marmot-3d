/** Local-only runtime acceptance. Scene initialization is explicit; combat uses real inputs. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');
// Respect the task-owned browser hold before opening a server or touching CDP.
const BROWSER_HOLD = '/home/fame/codex-runs/m3d-20261030-beta-smartfox-team/BROWSER_HOLD';
if (fs.existsSync(BROWSER_HOLD)) {
  console.error(`BROWSER_HOLD present: ${BROWSER_HOLD}; no Chrome/CDP experiment started`);
  process.exit(2);
}
// The shared 18800 service is never connected here. Other task-owned Chrome
// experiments must finish before this private QA can start.
const competingChrome = execFileSync('ps', ['-eo', 'args'], { encoding:'utf8' }).split('\n')
  .filter(line => /^\S*(?:chrome|chromium)(?:\s|$)/.test(line.trim())
    && /--remote-debugging-port=/.test(line) && !/--remote-debugging-port=18800(?:\s|$)/.test(line));
if (competingChrome.length) {
  console.error('Another private Chrome QA is active; no browser started:', competingChrome.join('\n'));
  process.exit(2);
}
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261030-beta-smartfox-team', 'rev61-audit', 'runtime-browser');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8338, CDP_PORT = 19338;
const BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.spz':'application/octet-stream', '.mp3':'audio/mpeg', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const configs = new Map(); let active = null;
async function body(req) { const chunks=[]; for await (const c of req) chunks.push(c); try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { return {}; } }
function json(res, status, value) { res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(value)); }
const server = http.createServer(async (req,res) => {
  const u = new URL(req.url, BASE);
  if (u.pathname.startsWith('/api/')) {
    if (u.pathname === '/api/configs' && req.method === 'GET') return json(res,200,{configs:[...configs.values()].map(({name,updatedAt,size})=>({name,updatedAt,size}))});
    if (u.pathname === '/api/configs' && req.method === 'POST') { const b=await body(req); const size=Buffer.byteLength(JSON.stringify(b.config)); const item={name:b.name,config:b.config,updatedAt:new Date().toISOString(),size}; configs.set(b.name,item); return json(res,200,{ok:true,...item}); }
    if (u.pathname === '/api/configs/active' && req.method === 'GET') return active ? json(res,200,{name:'__active__',config:active}) : json(res,404,{error:'no active'});
    if (u.pathname === '/api/configs/active' && req.method === 'POST') { const b=await body(req); active=b.config; return json(res,200,{ok:true}); }
    if (u.pathname.startsWith('/api/configs/') && req.method === 'GET') { const name=decodeURIComponent(u.pathname.slice('/api/configs/'.length)); const item=configs.get(name); return item ? json(res,200,item) : json(res,404,{error:'not found'}); }
    return json(res,404,{error:'local QA API route not found'});
  }
  let rel=decodeURIComponent(u.pathname); if (rel==='/') rel='/index.html';
  const file=path.join(ROOT,path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return json(res,403,{error:'forbidden'});
  fs.readFile(file,(err,data)=>{ if(err){res.writeHead(404);res.end('404');return;} res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data); });
});
let chrome, ws, seq=0; const pending=new Map(); const errors=[]; const assertions={}; const states={};
async function send(method,params={}) { const id=++seq; return new Promise((resolve,reject)=>{ const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`timeout ${method}`));},60000); pending.set(id,{resolve:(v)=>{clearTimeout(timer);resolve(v);},reject:(e)=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params})); }); }
async function ev(expression) { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true}); if(r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text); return r.result?.value; }
async function shot(name) { const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); fs.writeFileSync(path.join(OUT,`${name}.png`),Buffer.from(r.data,'base64')); }
async function until(expression, tries=120) { for(let i=0;i<tries;i++){ if(await ev(expression).catch(()=>false)) return true; await wait(250); } throw new Error(`not ready: ${expression}`); }
async function nav(url) { await send('Page.navigate',{url}); await wait(500); }
function assert(name,value,detail=null){ assertions[name]={pass:!!value,detail}; if(!value) throw new Error(`assertion ${name}: ${JSON.stringify(detail)}`); }
async function main(){
  await new Promise((r)=>server.listen(PORT,'127.0.0.1',r));
  const profile=path.join(OUT,'.chrome-profile');
  chrome=spawn('/usr/bin/google-chrome',[`--remote-debugging-port=${CDP_PORT}`,'--remote-allow-origins=*','--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--use-gl=swiftshader','--enable-unsafe-swiftshader',`--user-data-dir=${profile}`,'about:blank'],{stdio:'ignore'});
  let tabs;
  for(let i=0;i<100;i++){ try{tabs=await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();if(tabs.length)break;}catch{} await wait(200); }
  if(!tabs?.length) throw new Error('Chrome CDP unavailable');
  const target=tabs.find(t=>t.type==='page')||tabs[0];
  ws=new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage=(event)=>{const m=JSON.parse(event.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails?.exception?.description||m.params.exceptionDetails?.text);else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description??'').join(' '));};
  await new Promise((r)=>ws.onopen=r);
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  async function boot(payload = null) {
    const query = payload ? '&betaConfig='+encodeURIComponent(encodeURIComponent(JSON.stringify(payload))) : '';
    await nav(`${BASE}/index.html?version=beta&sandbox=1&test=1&webgl=1${query}`);
    await until('!!window.__game'); await until('window.__game.game.sandbox===true&&window.__game.game.mode==="play"');
    return ev(`(()=>{const g=window.__game;g.qaPaused=true;document.querySelector('[data-sandbox-action="clearFoxes"]').click();
      const press=c=>window.dispatchEvent(new KeyboardEvent('keydown',{code:c,bubbles:true})),release=c=>window.dispatchEvent(new KeyboardEvent('keyup',{code:c,bubbles:true}));
      press('KeyD');for(let i=0;i<180;i++)g.qaStep(1/60);release('KeyD');press('KeyW');let n=0;while(g.controller.position.x < -30&&n<1080){g.qaStep(1/60);n++;}release('KeyW');
      return {hp:g.game.player.hp,godMode:g.testState.godMode,mode:g.game.mode,inBurrow:g.game.inBurrow,x:g.controller.position.x,z:g.controller.position.z};})()`);
  }
  async function idleBirth(label, expectedHp, expectedStamina) {
    const r=await ev(`(async()=>{const g=window.__game,{SmartFox}=await import('./src/entities/smart-fox.js');
      const p=g.controller.position, x=p.x<0?65:-65,z=p.z<0?35:-35;
      // Initial QA scene placement of a NEW production entity, never teleport a live actor.
      const f=new SmartFox(g.scene,x,z,0,100);g.foxes().push(f);
      const snap=()=>({hp:f.hp,maxHp:f.maxHp,stamina:f.stamina,maxStamina:f.maxStamina,staminaLocked:f.staminaLocked,hitStreak:f.hitStreak,state:f.state,intent:f.intent,pounceCommitted:f.pounceCommitted,pounceStage:f.pounceStage,meleePhase:f.meleePhase,retreating:f.retreating,dead:f.dead,hpFill:f.hpBar.userData.fill.scale.x,staminaFill:f.staminaBar.userData.fill.scale.x});
      const birth=snap(), samples=[];for(let i=0;i<300;i++){g.qaStep(1/60);if(i===0||i===299)samples.push(snap());}
      const initialPose={x,z,playerX:p.x,playerZ:p.z};document.querySelector('[data-sandbox-action="clearFoxes"]').click();
      document.querySelector('[data-sandbox-action="spawnSmart"]').click();document.querySelector('[data-sandbox-action="spawnSmart"]').click();
      const fs=g.foxes(), multi=fs.map(f=>({hp:f.hp,maxHp:f.maxHp,stamina:f.stamina,maxStamina:f.maxStamina}));
      return {birth,samples,initialPose,multi,distinctSnapshots:fs[0].smartVitals!==fs[1].smartVitals&&fs[0].smartTuning!==fs[1].smartTuning,playerHp:g.game.player.hp};})()`);
    states[label]=r;
    assert(label+'FullBirth',[r.birth,...r.multi].every(x=>x.hp===expectedHp&&x.maxHp===expectedHp&&x.stamina===expectedStamina&&x.maxStamina===expectedStamina),r);
    assert(label+'IdleClean',r.samples.every(x=>x.hp===expectedHp&&x.stamina===expectedStamina&&!x.retreating&&!x.dead&&!x.pounceCommitted&&x.pounceStage!=='recover'&&x.intent!=='recover'&&!['retreat','rest_safe'].includes(x.state)),r);
    assert(label+'CleanFlags',r.birth.staminaLocked===0&&r.birth.hitStreak===0&&r.birth.hpFill===1&&r.birth.staminaFill===1&&r.distinctSnapshots,r);
    await shot(label+'-birth');
  }
  states.defaultStart=await boot(); await idleBirth('default',4,100);
  await nav(`${BASE}/admin.html?version=beta`);await until(`!!document.querySelector('[data-id="beta.smartMaxHp"]')`);
  await ev(`(()=>{const q=document.querySelector('.search');q.value='智能狐';q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const edits={ 'beta.smartMaxHp':8,'beta.smartMaxStamina':160,'beta.smartPounceStaminaCost':13,'beta.smartMeleeStaminaCost':5,'beta.smartHitStaminaCost':11,'beta.smartRoamStaminaRegenPerSec':6,'beta.smartRecoverStaminaRegenPerSec':6,'beta.smartRestStaminaRegenPerSec':6,'beta.smartInterceptStaminaRegenPerSec':6,'beta.smartRetreatHpRatio':.8,'beta.smartRestMinPlayerDistance':70,'beta.smartRestSafeHpRegenRatio':.2,'beta.smartRestHealTarget':1,'beta.smartRestSeconds':11 };
  states.adminEdit=await ev(`(()=>{const edits=${JSON.stringify(edits)};for(const [id,value] of Object.entries(edits)){const row=document.querySelector('[data-id="'+id+'"]');const n=row.querySelector('input[type=number]');n.value=value;n.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('[data-id="beta.smartMaxHp"]').scrollIntoView({block:'center'});return Object.fromEntries(Object.keys(edits).map(id=>[id,{value:document.querySelector('[data-id="'+id+'"] input[type=number]').value,runtime:document.querySelector('[data-id="'+id+'"] .tune-capability').textContent,group:document.querySelector('[data-id="'+id+'"]').closest('section').querySelector('h3').textContent}]));})()`);
  await wait(300);await shot('admin-group');
  await ev(`document.querySelector('[data-act="cloud"]').click()`);await until(`!document.querySelector('.cloud-box').hidden`);
  await ev(`(()=>{const n=document.querySelector('.cloud-name');n.value='vitals_qa';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.cloud-form').requestSubmit();})()`);
  await until(`!!document.querySelector('.cloud-item-name')`, 40); const cloudStatus = await ev(`document.querySelector('.cloud-status').textContent`); await until(`!!document.querySelector('.cloud-apply')`);
  await ev(`document.querySelector('.cloud-apply').click()`);await until(`document.querySelector('.cloud-status').textContent.includes('已应用')`);
  states.adminActivation=await ev(`({status:document.querySelector('.cloud-status').textContent,saved:document.querySelector('.cloud-item-name').textContent})`);
  assert('adminGroupAndRuntime',Object.values(states.adminEdit).every(x=>x.group==='智能狐 · 生命/体力/恢复/撤退'&&x.runtime==='运行时生效'),states.adminEdit);
  assert('adminSavedAndActivatedLocally',/已保存|已应用/.test(states.adminActivation.status),states.adminActivation);
  await shot('admin-activated');
  assert('localActiveContainsValues',active?.values?.smartMaxHp===8&&active?.values?.smartMaxStamina===160&&active?.values?.smartPounceStaminaCost===13,active?.values&&Object.fromEntries(Object.entries(active.values).filter(([k])=>k.startsWith('smart'))));
  const encoded=encodeURIComponent(JSON.stringify(active));
  const gameUrl=`${BASE}/index.html?version=beta&sandbox=1&test=1&webgl=1&betaConfig=${encodeURIComponent(encoded)}`;
  states.gameUrl=gameUrl;
  states.activeStart=await boot(); // No explicit query: verify local saved active is really fetched.
  states.renderer=await ev(`(()=>{const g=window.__game,r=g.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {backend:r.constructor.name,webglVersion:gl.getParameter(gl.VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),profile:g.renderProfile()};})()`);
  await idleBirth('activeCustom',8,160);
  // UI-generated fox, real AI battle. Only read transitions/resources.
  states.action=await ev(`(()=>{const g=window.__game;document.querySelector('[data-sandbox-action="clearFoxes"]').click();document.querySelector('[data-sandbox-action="spawnSmart"]').click();const f=g.foxes()[0],events=[];let before={stage:f.pounceStage,stamina:f.stamina};
    for(let tick=0;tick<600&&g.game.player.hp>12;tick++){g.qaStep(1/60);const stage=f.pounceStage,delta=f.stamina-before.stamina;
      if(before.stage==='windup'&&stage==='strike')events.push({tick,type:'pounceCost',amount:-delta,configured:f.smartVitals.pounceStaminaCost});
      if(stage==='recover'&&before.stage!=='recover')events.push({tick,type:'legitimateRecover',stamina:f.stamina});
      if(delta>0&&delta<1)events.push({tick,type:'regen',rate:delta*60,role:f._role,state:f.state});
      before={stage,stamina:f.stamina};}
    return {events,hp:g.game.player.hp,foxHp:f.hp,configured:f.smartVitals};})()`);
  assert('realPounceCost13',states.action.events.some(e=>e.type==='pounceCost'&&Math.abs(e.amount-13)<1e-6),states.action);
  assert('legitimateAttackRecoverAllowed',states.action.events.some(e=>e.type==='legitimateRecover'),states.action);
  assert('realRecovery6PerSecond',states.action.events.some(e=>e.type==='regen'&&Math.abs(e.rate-6)<1e-6),states.action);
  await shot('custom-real-attack-recover');

  // Real tap via keyboard against a new production SmartFox in its initial QA scene pose.
  // This does not change an existing actor's HP, position, stamina or state.
  async function hurtAndObserve(label, overrides, waitTicks=1500) {
    states[label+'Start']=await boot({schemaVersion:1,values:overrides});
    const r=await ev(`(async()=>{const g=window.__game,{SmartFox}=await import('./src/entities/smart-fox.js'),p=g.controller.position,yaw=g.controller.yaw;
      const f=new SmartFox(g.scene,p.x-Math.sin(yaw)*1.6,p.z-Math.cos(yaw)*1.6,0,0);g.foxes().push(f);
      const birth={hp:f.hp,maxHp:f.maxHp,stamina:f.stamina,maxStamina:f.maxStamina,x:f.x,z:f.z};
      const press=c=>window.dispatchEvent(new KeyboardEvent('keydown',{code:c,bubbles:true})),release=c=>window.dispatchEvent(new KeyboardEvent('keyup',{code:c,bubbles:true}));
      press('Space');g.qaStep(1/60);release('Space');
      const afterInput={hp:f.hp,stamina:f.stamina,state:f.state,hitStreak:f.hitStreak};
      const events=[],trace=[];let prev=f.state,prevHp=f.hp;
      for(let tick=0;tick<${waitTicks};tick++){g.qaStep(1/60);if(f.state!==prev||f.hp!==prevHp){events.push({tick,state:f.state,hp:f.hp,stamina:f.stamina,resolution:f.retreatResolution,restPoint:f.restPoint,progress:f._retreatProgress,distance:Math.hypot(f.x-g.game.player.x,f.z-g.game.player.z)});prev=f.state;prevHp=f.hp;}if(tick%60===0)trace.push({tick,x:f.x,z:f.z,hp:f.hp,state:f.state,retreating:f.retreating,restPoint:f.restPoint,resolution:f.retreatResolution,progress:f._retreatProgress});}
      return {birth,afterInput,events,trace,final:{hp:f.hp,state:f.state,dead:f.dead,stamina:f.stamina},rest:f.smartRetreat,obstacles:f._navigationObstacles(g.burrows||[]),playerHp:g.game.player.hp};})()`);
    states[label]=r;return r;
  }
  const retreat=await hurtAndObserve('hurtRetreatHeal',{smartMaxHp:8,smartMaxStamina:160,smartHitStaminaCost:11,smartRetreatHpRatio:.95,smartRestMinPlayerDistance:70,smartRestSafeHpRegenRatio:.2,smartRestHealTarget:1},1200);
  assert('realInputHitAndCost',retreat.afterInput.hp<retreat.birth.hp&&Math.abs(retreat.birth.stamina-retreat.afterInput.stamina-11)<1e-6,retreat);
  assert('realConfiguredRetreat',retreat.events.some(e=>e.state==='retreat')&&retreat.rest.hpRatio===.95,retreat);
  assert('realFarArrivalThenHeal',retreat.events.some(e=>e.state==='rest_safe'&&e.distance>=70)&&retreat.events.some(e=>e.state==='rest_safe'&&e.hp>retreat.afterInput.hp),retreat);
  await shot('real-far-retreat-heal');
  const low=await hurtAndObserve('lowHealTarget',{smartMaxHp:8,smartRestHealTarget:.1,smartRetreatHpRatio:.95,smartRestMinPlayerDistance:60},900);
  assert('lowTargetNeverReducesCurrentHp',low.events.some(e=>e.state==='rest_safe')&&low.events.every(e=>e.hp>=low.afterInput.hp),low);
  const dead=await hurtAndObserve('realDeath',{smartMaxHp:1},600);
  assert('realInputDeathNoRevive',dead.afterInput.hp===0&&dead.final.hp===0&&dead.final.state==='dead'&&dead.trace.every(s=>s.hp===0),dead);
  await shot('real-death-persists');
  states.consoleErrors=errors.slice();assert('consoleErrorZero',errors.length===0,errors);
  states.assertions=assertions;states.localOnly=true;states.chrome={binary:'/usr/bin/google-chrome',headless:true,softwareRendering:/swiftshader|llvmpipe|software/i.test(JSON.stringify(states.renderer))};
  fs.writeFileSync(path.join(OUT,'state-assertions.json'),JSON.stringify(states,null,2));
  fs.writeFileSync(path.join(OUT,'active-config.local-only.json'),JSON.stringify(active,null,2));
  fs.writeFileSync(path.join(OUT,'commands.txt'),'node tools/qa-smartfox-runtime-acceptance.cjs\n# Local-only service :8338; private CDP :19338; no shared 18800.\n');
  console.log(JSON.stringify({ok:true,output:OUT,assertions:Object.fromEntries(Object.entries(assertions).map(([k,v])=>[k,v.pass])),consoleErrors:errors.length},null,2));
}
main().catch((error)=>{states.assertions=assertions;states.consoleErrors=errors;states.fatal=error.stack;fs.writeFileSync(path.join(OUT,'state-assertions.json'),JSON.stringify(states,null,2));console.error(error);process.exitCode=1;}).finally(async()=>{try{ws?.close();}catch{}if(chrome)chrome.kill('SIGTERM');await new Promise((r)=>server.close(r));});
