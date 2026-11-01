/** Legacy entity wiring diagnostics (state injection), NOT normal-combat acceptance.
 * Kept as a diagnostic only. Output isolated from old evidence; gated by BROWSER_HOLD. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
// Respect the task-owned browser hold before opening a server or touching CDP.
const BROWSER_HOLD = '/home/fame/codex-runs/m3d-20261030-beta-smartfox-team/BROWSER_HOLD';
if (fs.existsSync(BROWSER_HOLD)) {
  console.error(`BROWSER_HOLD present: ${BROWSER_HOLD}; no Chrome/CDP experiment started`);
  process.exit(2);
}
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261030-beta-smartfox-team', 'rev61-audit', 'vitals-admin-pending');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8337, CDP_PORT = 19337;
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
  await nav(`${BASE}/admin.html?version=beta`);await until(`!!document.querySelector('[data-id="beta.smartMaxHp"]')`);
  await ev(`(()=>{const q=document.querySelector('.search');q.value='智能狐';q.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const edits={ 'beta.smartMaxHp':8,'beta.smartMaxStamina':160,'beta.smartPounceStaminaCost':13,'beta.smartMeleeStaminaCost':5,'beta.smartHitStaminaCost':11,'beta.smartRoamStaminaRegenPerSec':6,'beta.smartRetreatHpRatio':.8,'beta.smartRestMinPlayerDistance':70,'beta.smartRestSafeHpRegenRatio':.2,'beta.smartRestHealTarget':.8,'beta.smartRestSeconds':11 };
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
  await nav(gameUrl);await until(`!!window.__game`);await until(`window.__game.game.sandbox===true&&window.__game.game.mode==='play'`);await wait(1200);
  states.renderer=await ev(`(()=>{const g=window.__game,r=g.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {backend:r.constructor.name,webglVersion:gl.getParameter(gl.VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),profile:g.renderProfile()};})()`);
  states.spawn=await ev(`(async()=>{const g=window.__game;g.qaPaused=true;document.querySelector('[data-sandbox-action="clearFoxes"]').click();g.controller.teleport(0,0,0);await new Promise(r=>setTimeout(r,100));document.querySelector('[data-sandbox-action="spawnSmart"]').click();const f=g.foxes().find(x=>x.type==='smart');return {hp:f.hp,maxHp:f.maxHp,stamina:f.stamina,maxStamina:f.maxStamina,staminaLocked:f.staminaLocked,hitStreak:f.hitStreak,retreating:f.retreating,state:f.state,dead:f.dead,initialHpSource:f.initialHpSource,vitals:f.smartVitals,retreat:f.smartRetreat,restMin:f.smartRestMinPlayerDistance,hpFill:f.hpBar.userData.fill.scale.x,staminaFill:f.staminaBar.userData.fill.scale.x};})()`);
  assert('explicitUrlSpawnFullCustom',states.spawn.hp===8&&states.spawn.maxHp===8&&states.spawn.stamina===160&&states.spawn.maxStamina===160,states.spawn);
  assert('spawnCleanAndBarsFull',states.spawn.staminaLocked===0&&states.spawn.hitStreak===0&&!states.spawn.retreating&&states.spawn.state==='roam'&&!states.spawn.dead&&states.spawn.hpFill===1&&states.spawn.staminaFill===1,states.spawn);
  await shot('sandbox-spawn');
  states.idle=await ev(`(()=>{const g=window.__game,f=g.foxes()[0],p={x:100,z:100,yaw:0,facingYaw:0};const samples=[];for(let i=0;i<300;i++){f.update(1/60,p,false,{speed:1,wind:1},g.burrows,g.terrainHeight,null,null);if(i===0||i===299)samples.push({frame:i,hp:f.hp,stamina:f.stamina,state:f.state,intent:f.intent,retreating:f.retreating});}return samples;})()`);
  assert('firstFrameAndFiveIdleSecondsNoRecoverOrRetreat',states.idle.every(x=>x.state!=='rest'&&x.state!=='rest_safe'&&!x.retreating&&x.intent!=='recover'&&x.hp===8),states.idle);
  states.multi=await ev(`(()=>{const g=window.__game;document.querySelector('[data-sandbox-action="spawnSmart"]').click();const fs=g.foxes().filter(f=>f.type==='smart');fs[0].stamina=17;fs[0].hp=5;return fs.map(f=>({hp:f.hp,maxHp:f.maxHp,stamina:f.stamina,maxStamina:f.maxStamina}));})()`);
  assert('multipleSpawnsDoNotShareState',states.multi[1].hp===8&&states.multi[1].stamina===160&&states.multi[0].stamina===17,states.multi);
  states.behavior=await ev(`(()=>{const g=window.__game,f=g.foxes()[0],p={x:0,z:0,yaw:0,facingYaw:0};f.hp=8;f.stamina=160;f.state='roam';f.intent='observe';f._role='flanker';f._lastHitAt=-Infinity;f._evadeUntil=0;const beforeHit=f.stamina;f.hit(0,0,0,1,0);const afterHit=f.stamina;f.hitStreak=0;f._sinceHit=Infinity;f.state='roam';f.intent='observe';f._lastHitAt=-Infinity;f._evadeUntil=0;f.retreating=false;const beforeRegen=f.stamina;f.update(1,{x:100,z:100,yaw:0},false,{speed:1,wind:1},g.burrows,g.terrainHeight,null,null);const afterRegen=f.stamina;f.state='roam';f.intent='observe';f.retreating=false;f._lastHitAt=-Infinity;f._evadeUntil=0;f.hp=6;f.stamina=160;f.update(1/60,p,false,{speed:1,wind:1},g.burrows,g.terrainHeight,null,null);const retreat={state:f.state,retreating:f.retreating,restPoint:f.restPoint,min:f.smartRestMinPlayerDistance,hpRatio:f.hp/f.maxHp,threshold:f.smartRetreat.hpRatio};f.state='rest_safe';f.retreating=true;f.timer=11;f.hp=2;f.update(1,p,false,{speed:1,wind:1},g.burrows,g.terrainHeight,null,null);const safeRest={hp:f.hp,maxHp:f.maxHp,timer:f.timer,state:f.state};f.hp=0;f.state='dead';f.retreating=false;f.fleeing=false;for(let i=0;i<600;i++)f.update(1/60,p,false,{speed:1,wind:1},g.burrows,g.terrainHeight,null,null);const death={hp:f.hp,state:f.state,retreating:f.retreating,fleeing:f.fleeing,respawn:f.respawn};return {beforeHit,afterHit,hitCost:beforeHit-afterHit,beforeRegen,afterRegen,regen:afterRegen-beforeRegen,retreat,safeRest,death};})()`);
  assert('realHitCostUsesAdminValue',states.behavior.hitCost===11,states.behavior);
  assert('realRoamRegenUsesAdminValue',Math.abs(states.behavior.regen-6)<1e-6,states.behavior);
  assert('realRetreatThresholdAndFarPoint',states.behavior.retreat.retreating&&states.behavior.retreat.hpRatio<=.8&&states.behavior.retreat.min===70&&Math.hypot(states.behavior.retreat.restPoint.x,states.behavior.retreat.restPoint.z)>=70,states.behavior.retreat);
  assert('safeRestHealRateAndTarget',Math.abs(states.behavior.safeRest.hp-3.6)<1e-6,states.behavior.safeRest);
  assert('deadDoesNotHealOrRespawn',states.behavior.death.hp===0&&states.behavior.death.state==='dead'&&!states.behavior.death.fleeing,states.behavior.death);
  states.actionCosts=await ev(`(()=>{const g=window.__game,f=g.foxes()[0];f.x=35;f.z=25;f._smartState.x=35;f._smartState.z=25;f.hp=f.maxHp;f.stamina=100;f.state='roam';f.retreating=false;f.fleeing=false;f.hitStreak=0;f._sinceHit=Infinity;f._evadeUntil=0;f._lastHitAt=-Infinity;f._role='striker';f._recoverLock=0;f.pounceCommitted=true;f.pounceStage='windup';f.intent='pounce';f._smartState={...f._smartState,x:f.x,z:f.z,yaw:f.yaw,vx:0,vz:0,pounceCommitted:true,pounceStage:'windup',pounceStageTime:.001,pounceStrikeTime:.21,pounceStrikeSpeed:10.8,pounceRecoverTime:.45,pounceYaw:0,pounceCooldown:0};const pounceBefore=f.stamina;f.update(1/60,{x:35,z:21,yaw:0,facingYaw:0},false,{speed:1,wind:1},[],g.terrainHeight,null,null);const pounceAfter=f.stamina;f.pounceCommitted=false;f.pounceStage=null;f.state='roam';f.intent='observe';f._role='interceptor';f.meleePhase='windup';f.meleeStriking=false;f._meleeState={phase:'windup',phaseTime:.001,cooldown:0,hitConsumed:false,yaw:0};f.stamina=100;f.update(1/60,{x:35,z:27.3,yaw:0,facingYaw:0},false,{speed:1,wind:1},[],g.terrainHeight,null,null);return {pounceBefore,pounceAfter,pounceCost:pounceBefore-pounceAfter,pounceConfigured:f.smartVitals.pounceStaminaCost,meleeConfigured:f.smartVitals.meleeStaminaCost,meleeAfter:f.stamina,meleePhase:f.meleePhase,meleeJustStarted:f._meleeState.justStrikeStarted};})()`);
  assert('actualSmartFoxPounceCostUsesRuntime',states.actionCosts.pounceCost===13,states.actionCosts);
  assert('actualSmartFoxMeleeCostUsesRuntime',states.actionCosts.meleeAfter===95&&states.actionCosts.meleePhase==='strike',states.actionCosts);
  states.hotSpawn=await ev(`(async()=>{const {BETA_TUNE}=await import('./src/core/beta-tuning.js');const {applyRuntimeValues}=await import('./src/core/runtime-config.mjs');const g=window.__game,old=g.foxes()[0];applyRuntimeValues({smartMaxHp:10,smartMaxStamina:200},BETA_TUNE);document.querySelector('[data-sandbox-action="spawnSmart"]').click();const fresh=g.foxes().filter(f=>f.type==='smart').at(-1);return {old:{maxHp:old.maxHp,maxStamina:old.maxStamina},fresh:{hp:fresh.hp,maxHp:fresh.maxHp,stamina:fresh.stamina,maxStamina:fresh.maxStamina}};})()`);
  assert('newSpawnUsesNewValuesWithoutPartialHotUpdate',states.hotSpawn.old.maxHp===8&&states.hotSpawn.old.maxStamina===160&&states.hotSpawn.fresh.hp===10&&states.hotSpawn.fresh.stamina===200,states.hotSpawn);
  states.consoleErrors=errors.slice();assert('consoleErrorZero',errors.length===0,errors);
  states.assertions=assertions;states.localOnly=true;states.chrome={binary:'/usr/bin/google-chrome',headless:true,softwareRendering:/swiftshader|llvmpipe|software/i.test(JSON.stringify(states.renderer))};
  fs.writeFileSync(path.join(OUT,'state-assertions.json'),JSON.stringify(states,null,2));
  fs.writeFileSync(path.join(OUT,'active-config.local-only.json'),JSON.stringify(active,null,2));
  fs.writeFileSync(path.join(OUT,'commands.txt'),`node tools/qa-smartfox-vitals-admin.cjs\n# Embedded local-only static/API service: ${BASE}\n# Chrome: /usr/bin/google-chrome --headless=new --disable-gpu --use-gl=swiftshader --enable-unsafe-swiftshader\n# Explicit Beta sandbox URL is recorded in state-assertions.json\n`);
  console.log(JSON.stringify({ok:true,output:OUT,renderer:states.renderer,assertions:Object.fromEntries(Object.entries(assertions).map(([k,v])=>[k,v.pass])),consoleErrors:errors.length},null,2));
}
main().catch((error)=>{states.assertions=assertions;states.consoleErrors=errors;states.fatal=error.stack;fs.writeFileSync(path.join(OUT,'state-assertions.json'),JSON.stringify(states,null,2));console.error(error);process.exitCode=1;}).finally(async()=>{try{ws?.close();}catch{}if(chrome)chrome.kill('SIGTERM');await new Promise((r)=>server.close(r));try { fs.rmSync(path.join(OUT,'.chrome-profile'),{recursive:true,force:true,maxRetries:5,retryDelay:100}); } catch {}});
