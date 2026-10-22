const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const OUT = path.resolve(process.cwd(), 'outputs/control-merge-qa');
fs.mkdirSync(OUT, { recursive: true });
const base = 'http://127.0.0.1:8346/index.html?version=beta&models=off&foxmodel=off';
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let data=''; res.on('data', c => data += c); res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } }); }).on('error', reject);
});
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(url) { this.url=url; this.ws=null; this.seq=0; this.pending=new Map(); this.events=[]; }
  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', e => { const m=JSON.parse(e.data); if (m.id && this.pending.has(m.id)) { const p=this.pending.get(m.id); this.pending.delete(m.id); m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result); } else if (m.method) this.events.push(m); });
    await new Promise((resolve,reject)=>{ this.ws.addEventListener('open',resolve,{once:true}); this.ws.addEventListener('error',reject,{once:true}); });
  }
  send(method, params={}) { return new Promise((resolve,reject)=>{ const id=++this.seq; this.pending.set(id,{resolve,reject}); this.ws.send(JSON.stringify({id,method,params})); setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);reject(new Error('CDP timeout '+method));}},60000); }); }
  async eval(expr) { const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result?.value; }
  close(){ try{this.ws?.close();}catch(_){} }
}
async function main(){
  const version=await getJson('http://127.0.0.1:18800/json/version');
  const browser=new CDP(version.webSocketDebuggerUrl); await browser.connect();
  const created=await browser.send('Target.createTarget',{url:'about:blank',background:false});
  const targetId=created.targetId;
  let pageInfo;
  for(let i=0;i<60;i++){ const list=await getJson('http://127.0.0.1:18800/json/list'); pageInfo=list.find(x=>x.id===targetId && x.type==='page'); if(pageInfo) break; await sleep(250); }
  if(!pageInfo) throw new Error('new target not found');
  const page=new CDP(pageInfo.webSocketDebuggerUrl); await page.connect();
  const errors=[];
  await page.send('Runtime.enable'); await page.send('Page.enable'); await page.send('Log.enable');
  page.events=[];
  await page.send('Page.navigate',{url:base});
  let ready=false;
  for(let i=0;i<180;i++){ await sleep(500); try{ ready=await page.eval('!!window.__game && !!window.__game.controller && !!window.__game.binds'); }catch(_){} if(ready) break; }
  if(!ready) throw new Error('beta page readiness timeout >=45s');
  const startInfo=await page.eval(`(() => { const b=window.__game.binds; const c=window.__game.controller; const g=window.__game; b.setControlMode('driving'); b.setScheme('compatible'); g.enterSandbox(); c.setThirdPerson(false); c.teleport(10,10,0); c.velocity.set(0,0,0); c.externalVelocity.set(0,0,0); return {mode:g.game.mode, controlMode:b.controlMode, profile:b.controlProfile, moveMap:b.moveMap, turnMap:b.turnMap, yaw:c.yaw, position:{x:c.position.x,z:c.position.z}}; })()`);
  const sample = async (label, setup, ms=650) => {
    await page.eval(`(() => { const g=window.__game,c=g.controller; g.keys.clear(); g.touchControls?.releaseAll?.(); c.touchAxes={x:0,y:0}; c.velocity.set(0,0,0); c.externalVelocity.set(0,0,0); c.teleport(10,10,0); c.setThirdPerson(false); ${setup}; return true; })()`);
    const before=await page.eval(`(() => { const g=window.__game,c=g.controller; return {mode:g.game.mode,keys:[...g.keys],touchEnabled:c.touchEnabled,touchAxes:c.touchAxes,movementLocked:c.movementLocked,yaw:c.yaw,x:c.position.x,z:c.position.z}; })()`);
    await page.eval(`(() => { const g=window.__game,c=g.controller; for(let i=0;i<40;i++) c.update(1/60,g.keys,1,g.binds.moveMap,0,g.binds.turnMap); return true; })()`);
    await sleep(ms);
    const after=await page.eval(`(() => { const g=window.__game,c=g.controller; return {mode:g.game.mode,keys:[...g.keys],touchEnabled:c.touchEnabled,touchAxes:c.touchAxes,movementLocked:c.movementLocked,yaw:c.yaw,x:c.position.x,z:c.position.z,velocity:{x:c.velocity.x,z:c.velocity.z},moving:c.movingThisFrame}; })()`);
    const shot=await page.send('Page.captureScreenshot',{format:'png'}); const file=path.join(OUT,label+'.png'); fs.writeFileSync(file,Buffer.from(shot.data,'base64'));
    return {label,before,after,delta:{yaw:after.yaw-before.yaw,x:after.x-before.x,z:after.z-before.z},screenshot:path.resolve(file)};
  };
  const keyboardForwardTurn=await sample('keyboard-forward-right-turn', `window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',bubbles:true})); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));`);
  const keyboardBackTurn=await sample('keyboard-back-right-turn', `window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyS',bubbles:true})); window.dispatchEvent(new KeyboardEvent('keydown',{code:'KeyD',bubbles:true}));`);
  const touchRearRight=await sample('touch-rear-right-diagonal', `g.touchControls.allowMouse=true; g.touchControls.activate(); const el=document.getElementById('touchJoystick'); const r=el.getBoundingClientRect(); const id=7251; const x0=r.left+r.width/2,y0=r.top+r.height/2; el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,pointerId:id,pointerType:'mouse',clientX:x0,clientY:y0,button:0,buttons:1})); el.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerId:id,pointerType:'mouse',clientX:x0+33.6,clientY:y0+33.6,button:0,buttons:1}));`);
  const checks=await page.eval(`(() => { const g=window.__game,b=g.binds,c=g.controller; return {beta:g.isBeta, mode:b.controlMode, profile:b.controlProfile, turnMap:b.turnMap, classic: (()=>{b.setControlMode('classic'); b.setScheme('compatible'); return {turnMap:b.turnMap, moveMap:b.moveMap};})(), driving: (()=>{b.setControlMode('driving'); return {turnMap:b.turnMap, moveMap:b.moveMap};})(), touch:{uTurn: false, enabled:c.touchEnabled, thirdPerson:c.thirdPerson}, hint:(document.querySelector('#titleMoveHint')||{}).textContent||''}; })()`);
  const checksBehavior={ keyboardForwardRight:keyboardForwardTurn.delta.yaw < -0.5 && keyboardForwardTurn.delta.x > 0.3 && keyboardForwardTurn.delta.z < -0.3, keyboardBackRight:keyboardBackTurn.delta.yaw < -0.5 && keyboardBackTurn.delta.x < -0.2 && keyboardBackTurn.delta.z > 0.2, touchRearRight:touchRearRight.delta.yaw < -0.5 && touchRearRight.delta.x < -0.1 && touchRearRight.delta.z > 0.1 };
  const consoleEvents=page.events.filter(e=>e.method==='Runtime.exceptionThrown' || (e.method==='Runtime.consoleAPICalled' && e.params.type==='error') || (e.method==='Log.entryAdded' && e.params.entry?.level==='error'));
  for(const ev of consoleEvents) errors.push({method:ev.method, params:ev.params});
  const report={url:base,ready:true,started:startInfo,samples:[keyboardForwardTurn,keyboardBackTurn,touchRearRight],behaviorAssertions:checksBehavior,checks,consoleErrors:errors,notes:'Screenshots captured from the existing OpenClaw-managed Chrome CDP at 127.0.0.1:18800; this script opened and closed only its own target.'};
  fs.writeFileSync(path.join(OUT,'control-merge-report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(Object.values(checksBehavior).some(v=>!v) || errors.length) throw new Error('behavioral CDP QA assertions failed');
  page.close(); await browser.send('Target.closeTarget',{targetId}); browser.close();
}
main().catch(async e=>{ console.error(e.stack||e); process.exitCode=1; });
