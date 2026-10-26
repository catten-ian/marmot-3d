/* Stage 2 移动触摸 CDP 验收；默认复用 127.0.0.1:18800 托管 Chrome。 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const ROOT = path.resolve(__dirname, '../..');
const OUT = __dirname;
const PORT = 8332;
const EXTERNAL = process.env.PAF_QA_CDP === 'off' ? null : (process.env.PAF_QA_CDP || 'http://127.0.0.1:18800');
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const CDP_PORT = 9232;
const wait = ms => new Promise(r => setTimeout(r, ms));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.woff2':'font/woff2', '.spz':'application/octet-stream', '.webp':'image/webp', '.ico':'image/x-icon' };
const server = http.createServer((req,res)=>{
  const rel=decodeURIComponent(req.url.split('?')[0]);
  const file=path.join(ROOT,path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if(!file.startsWith(ROOT)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);});
});
const report={startedAt:new Date().toISOString(),scenarios:{},checks:{},errors:[],screenshots:[]};
async function main(){
 await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
 let chrome,ws,tabTargetId,sessionId,useExternal=false;
 const cleanup=async()=>{try{if(useExternal&&tabTargetId)await fetch(`${EXTERNAL}/json/close/${tabTargetId}`,{signal:AbortSignal.timeout(2000)});}catch{}try{ws?.close();}catch{}try{chrome?.kill('SIGKILL');}catch{}server.close();server.closeAllConnections?.();};
 const timeout=setTimeout(()=>{report.errors.push('overall timeout');fs.writeFileSync(path.join(OUT,'cdp-results.json'),JSON.stringify(report,null,2));cleanup().finally(()=>process.exit(2));},300000);
 try{
  let ver;
  if(EXTERNAL){try{const r=await fetch(`${EXTERNAL}/json/version`,{signal:AbortSignal.timeout(3000)});if(r.ok)ver=await r.json();}catch{}}
  useExternal=!!ver;
  if(useExternal)ws=new WebSocket(ver.webSocketDebuggerUrl);else{
   const profile=fs.mkdtempSync(path.join(os.tmpdir(),'paf-stage2-'));
   chrome=spawn(CHROME,['--headless=new','--no-sandbox','--disable-gpu-blocklist','--use-gl=angle','--use-angle=gl',`--remote-debugging-port=${CDP_PORT}`,`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{stdio:'ignore'});
   let target;for(let i=0;i<60;i++){await wait(250);try{target=(await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find(t=>t.type==='page');}catch{}if(target)break;}
   if(!target)throw new Error('CDP unavailable');ws=new WebSocket(target.webSocketDebuggerUrl);
  }
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});setTimeout(()=>rej(new Error('ws timeout')),5000);});
  let seq=0;const pending=new Map();
  ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails?.exception?.description||m.params.exceptionDetails?.text||'exception');});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});const msg={id,method,params};if(sessionId)msg.sessionId=sessionId;ws.send(JSON.stringify(msg));setTimeout(()=>{if(pending.has(id)){pending.delete(id);reject(new Error('timeout '+method));}},45000);});
  if(useExternal){const t=await send('Target.createTarget',{url:'about:blank',newWindow:true,background:false});tabTargetId=t.targetId;const a=await send('Target.attachToTarget',{targetId:tabTargetId,flatten:true});sessionId=a.sessionId;}
  report.cdp={managed:useExternal,browser:ver?.Browser||'local Chrome'};
  const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,timeout:40000});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  const shot=async name=>{const s=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(OUT,name+'.png'),Buffer.from(s.data,'base64'));report.screenshots.push(name+'.png');};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setUserAgentOverride',{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/147 Mobile Safari/537.36'});
  const navigate=async()=>{await send('Page.navigate',{url:`http://127.0.0.1:${PORT}/index.html?webgl=1&pafqa=1&t=${Date.now()}`});for(let i=0;i<200;i++){await wait(200);if(await evalJS('!!(window.__game&&window.__enterPlayAsFox)').catch(()=>false))return;}throw new Error('boot timeout');};
  const enter=async()=>{await evalJS('window.__enterPlayAsFox()');for(let i=0;i<100;i++){await wait(100);if(await evalJS('!!window.__playAsFox?.active').catch(()=>false))return;}throw new Error('enter timeout');};
  const exit=async()=>{await evalJS("document.getElementById('pafExit')?.click()");await wait(180);};
  const waitIdle=async()=>{for(let i=0;i<40;i++){if(await evalJS("__playAsFox?.phase==='idle'"))return;await wait(60);}throw new Error('pounce did not return idle');};
  const touch=async(type,points=[])=>send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({x:p.x,y:p.y,id:p.id??i+1,radiusX:2,radiusY:2,force:1}))});
  const tap=async(x,y,id=9)=>{await touch('touchStart',[{x,y,id}]);await wait(45);await touch('touchEnd',[]);};
  const drag=async(points,id=1,hold=45)=>{await touch('touchStart',[{...points[0],id}]);for(const p of points.slice(1)){await wait(hold);await touch('touchMove',[{...p,id}]);}};
  const end=async()=>touch('touchEnd',[]);
  const center=async sel=>evalJS(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,left:r.left,top:r.top}})()`);
  await navigate();
  await evalJS(`(()=>{localStorage.clear();localStorage.setItem('marmot.input-mode.v1','touch');localStorage.setItem('marmot.settings.touchLayoutAdjust','1');})()`);
  await navigate();await wait(600);
  await evalJS("document.getElementById('startBtn').click()");await wait(500);
  report.scenarios.normalInitial=await evalJS(`(()=>({mode:__game.game.mode,touch:__game.touchControls.controller.touchEnabled,display:getComputedStyle(document.getElementById('touchControls')).display,attack:!!document.querySelector('[data-touch-action="attack"]')}))()`);
  // 普通模式真实编辑：拖动摇杆，随后在既有设置面板调整大小/疾跑环并保存。
  await evalJS("document.getElementById('touchLayoutEntry').click()");await wait(200);
  const editBefore=await center('#touchJoystick');
  await drag([editBefore,{x:130,y:650},{x:140,y:640}],1,70);await end();await wait(150);
  report.scenarios.normalEdit=await evalJS(`(()=>({editing:document.body.classList.contains('touch-layout-editing'),rect:(()=>{const r=document.getElementById('touchJoystick').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,width:r.width}})()}))()`);
  await evalJS("document.getElementById('touchLayoutEntry').click();document.getElementById('setBtn').click()");await wait(250);
  await evalJS(`(()=>{const sel=document.getElementById('layoutSelected');sel.value='joystick';sel.dispatchEvent(new Event('change',{bubbles:true}));const scale=document.getElementById('layoutJoystickScale');scale.value='1.25';scale.dispatchEvent(new Event('input',{bubbles:true}));const sprint=document.getElementById('layoutSprintThreshold');sprint.value='0.70';sprint.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-layout-save]').click();document.getElementById('setClose').click();})()`);
  await wait(300);
  const normalLayout=await evalJS(`(()=>{const r=document.getElementById('touchJoystick').getBoundingClientRect();return{centerX:r.left+r.width/2,centerY:r.top+r.height/2,width:r.width,threshold:__game.touchControls.sprintThreshold,stored:JSON.parse(localStorage.getItem('marmot.touch-layout.v1')).joystick}})()`);
  report.scenarios.normalLayout=normalLayout;await shot('01-marmot-custom-layout');
  await enter();await wait(450);
  report.scenarios.foxShared=await evalJS(`(()=>{const root=document.getElementById('touchControls'),j=document.getElementById('touchJoystick'),r=j.getBoundingClientRect(),a=document.querySelector('[data-touch-action="attack"]');return{rootDisplay:getComputedStyle(root).display,joystickVisible:r.width>0,attackVisible:a.getBoundingClientRect().width>0&&getComputedStyle(a).display!=='none',attackText:a.textContent.trim(),noPafStick:!document.getElementById('pafStick'),noPafBtns:!document.getElementById('pafBtns'),hiddenActions:[...root.querySelectorAll('[data-touch-action]')].filter(e=>e.dataset.touchAction!=='attack').every(e=>getComputedStyle(e).display==='none'),layoutEntryHidden:getComputedStyle(document.getElementById('touchLayoutEntry')).display==='none',centerX:r.left+r.width/2,centerY:r.top+r.height/2,width:r.width,threshold:__game.touchControls.sprintThreshold,route:__playAsFox.input.routeActive,tip:document.getElementById('pafTip').textContent}})()`);
  const F=report.scenarios.foxShared;
  report.checks.layoutConsistency=Math.abs(F.centerX-normalLayout.centerX)<1&&Math.abs(F.centerY-normalLayout.centerY)<1&&Math.abs(F.width-normalLayout.width)<1&&F.threshold===normalLayout.threshold;
  await shot('02-fox-shared-layout');
  // 斜向但处于内圈：前进 + 右转，保持潜行。
  const jc=await center('#touchJoystick');const scale=normalLayout.stored.scale;const max=48*scale;
  const p0=await evalJS('__playAsFox.pos');
  await drag([jc,{x:jc.x+max*.5,y:jc.y-max*.42}],3,100);await wait(220);
  report.scenarios.joystickStalk=await evalJS(`(()=>({input:__playAsFox.input,sprint:__playAsFox.sprint,stalk:__playAsFox.stalk,pos:__playAsFox.pos,tip:document.getElementById('pafTip').textContent,axes:{...__game.touchControls.controller.touchAxes}}))()`);
  report.scenarios.joystickStalk.delta={z:report.scenarios.joystickStalk.pos.z-p0.z,yaw:report.scenarios.joystickStalk.pos.yaw-p0.yaw};
  // 推过同一内圈 -> 冲刺；拉回 -> 潜行。
  await touch('touchMove',[{x:jc.x,y:jc.y-max*.98,id:3}]);await wait(150);
  report.scenarios.joystickSprint=await evalJS(`(()=>({sprint:__playAsFox.sprint,stalk:__playAsFox.stalk,input:__playAsFox.input,ring:document.getElementById('touchJoystick').classList.contains('stick-sprint'),tip:document.getElementById('pafTip').textContent}))()`);
  await shot('03-fox-sprint-ring');
  await touch('touchMove',[{x:jc.x,y:jc.y-max*.4,id:3}]);await wait(120);
  report.scenarios.joystickBackToStalk=await evalJS(`(()=>({sprint:__playAsFox.sprint,stalk:__playAsFox.stalk,input:__playAsFox.input,ring:document.getElementById('touchJoystick').classList.contains('stick-sprint')}))()`);
  await end();
  // 共享攻击键：长按 500ms 仍在蓄力且有下蹲/百分比反馈，松手真实扑出。
  const ac=await center('[data-touch-action="attack"]');
  await touch('touchStart',[{x:ac.x,y:ac.y,id:4}]);await wait(500);
  report.scenarios.attackHolding=await evalJS(`(()=>({phase:__playAsFox.phase,input:__playAsFox.input,tip:document.getElementById('pafTip').textContent}))()`);
  await shot('04-fox-charge-hold');await end();await wait(70);
  report.scenarios.attackReleased=await evalJS(`(()=>({phase:__playAsFox.phase,input:__playAsFox.input}))()`);
  await waitIdle();
  await tap(ac.x,ac.y,5);await wait(270);
  report.scenarios.attackShort=await evalJS(`(()=>({phase:__playAsFox.phase,input:__playAsFox.input}))()`);
  await wait(650);
  // 按住攻击时退出：release 不得泄漏到普通模式。
  await touch('touchStart',[{x:ac.x,y:ac.y,id:6}]);await wait(80);await exit();await end();await wait(200);
  report.scenarios.afterExit=await evalJS(`(()=>{const root=document.getElementById('touchControls');return{foxGone:!window.__playAsFox,routeRestored:__game.touchControls.controller===__game.controller,allButtonsRestored:[...root.querySelectorAll('[data-touch-action]')].every(e=>e.style.display===''),attackText:document.querySelector('[data-touch-action="attack"]').textContent.trim(),layoutEntry:document.getElementById('touchLayoutEntry').style.display,roles:__game.touchControls.pointerRoles.size,move:{...__game.touchControls.move},touchSprint:__game.controller.touchSprint,threshold:__game.touchControls.sprintThreshold,bodyFox:document.body.classList.contains('play-as-fox')}})()`);
  // 普通模式编辑态仍可进入/退出。
  await evalJS("document.getElementById('touchLayoutEntry').click()");await wait(100);
  const editingRestored=await evalJS("document.body.classList.contains('touch-layout-editing')");
  await evalJS("document.getElementById('touchLayoutEntry').click()");await wait(100);
  report.scenarios.afterExit.editingRestored=editingRestored;
  await evalJS("document.getElementById('startBtn').click()");await wait(250);
  // 普通模式实玩态摇杆与内圈仍可响应，并完全复位。
  const nc=await center('#touchJoystick');
  await drag([nc,{x:nc.x,y:nc.y-max*.95}],7,70);await wait(80);
  report.scenarios.normalTouchAfterExit=await evalJS(`(()=>({axes:{...__game.controller.touchAxes},sprint:__game.controller.touchSprint,roles:__game.touchControls.pointerRoles.size}))()`);
  await end();await wait(100);
  report.scenarios.normalTouchAfterExit.released=await evalJS(`(()=>({axes:{...__game.controller.touchAxes},sprint:__game.controller.touchSprint,roles:__game.touchControls.pointerRoles.size}))()`);
  await shot('05-marmot-restored');
  // 连续进出三次。
  report.scenarios.reentry=[];
  for(let i=0;i<3;i++){await enter();await wait(120);report.scenarios.reentry.push(await evalJS(`(()=>({active:__playAsFox.active,route:__playAsFox.input.routeActive,noPaf:!document.getElementById('pafStick'),roles:__game.touchControls.pointerRoles.size}))()`));await exit();report.scenarios.reentry[i].restored=await evalJS('__game.touchControls.controller===__game.controller&&__game.touchControls.pointerRoles.size===0&&!document.body.classList.contains("play-as-fox")');}
  // 刷新 + 更窄屏，布局存档不变，路由重新干净建立。
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:1,mobile:true});
  await navigate();await wait(500);await enter();await wait(350);
  report.scenarios.narrowRefresh=await evalJS(`(()=>{const r=document.getElementById('touchJoystick').getBoundingClientRect();return{width:innerWidth,root:getComputedStyle(document.getElementById('touchControls')).display,sharedVisible:r.width>0,noPaf:!document.getElementById('pafStick'),scale:__game.touchControls.joystickScale,threshold:__game.touchControls.sprintThreshold,stored:JSON.parse(localStorage.getItem('marmot.touch-layout.v1')).joystick,route:__playAsFox.input.routeActive}})()`);
  await shot('06-narrow-refresh');
  report.renderer=await evalJS(`(async()=>{const r=__game.renderer;let info={backend:'未知',gpu:'未知',acceleration:'未知'};try{const{readGpuInfo}=await import('/src/core/gpu-info.mjs');info=readGpuInfo(r);}catch(e){info.error=String(e)}let rawGl='';try{const gl=r.getContext?.();const ext=gl?.getExtension('WEBGL_debug_renderer_info');rawGl=ext?String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)):'';}catch{}return{...info,rawGl,webgpuAvailable:!!navigator.gpu};})()`);
  const S=report.scenarios,C=report.checks;
  C.normalSharedVisible=S.normalInitial.touch&&S.normalInitial.display!=='none';
  C.normalLayoutEdited=S.normalEdit.editing&&normalLayout.stored.scale===1.25&&normalLayout.threshold===.7;
  C.foxUsesShared=F.rootDisplay!=='none'&&F.joystickVisible&&F.attackVisible&&F.noPafStick&&F.noPafBtns&&F.hiddenActions&&F.layoutEntryHidden&&F.route;
  C.stalkMoveTurn=S.joystickStalk.input.touch.throttle>0.3&&S.joystickStalk.input.touch.turn<-.3&&S.joystickStalk.stalk&&!S.joystickStalk.sprint&&S.joystickStalk.delta.z>0&&S.joystickStalk.delta.yaw<0;
  C.sprintMutualExclusion=S.joystickSprint.sprint&&!S.joystickSprint.stalk&&S.joystickSprint.ring&&S.joystickSprint.tip.includes('冲刺');
  C.returnToStalk=!S.joystickBackToStalk.sprint&&S.joystickBackToStalk.stalk&&!S.joystickBackToStalk.ring;
  C.holdCharge=S.attackHolding.phase==='wind'&&S.attackHolding.input.charging&&S.attackHolding.input.chargeHeld&&S.attackHolding.input.crouchScale<.8&&S.attackHolding.tip.includes('蓄力');
  C.releasePounce=['lunge','recover'].includes(S.attackReleased.phase)&&!S.attackReleased.input.charging;
  C.shortPounce=['lunge','recover'].includes(S.attackShort.phase);
  const A=S.afterExit;C.exitRestores=A.foxGone&&A.routeRestored&&A.allButtonsRestored&&A.layoutEntry===''&&A.roles===0&&!A.touchSprint&&A.threshold===.7&&!A.bodyFox&&A.editingRestored&&A.attackText.includes('攻击');
  C.normalTouchWorks=S.normalTouchAfterExit.sprint&&S.normalTouchAfterExit.axes.mag>.7&&S.normalTouchAfterExit.released.roles===0&&!S.normalTouchAfterExit.released.sprint&&S.normalTouchAfterExit.released.axes.mag===0;
  C.reentry3=S.reentry.length===3&&S.reentry.every(x=>x.active&&x.route&&x.noPaf&&x.restored);
  C.narrowRefresh=S.narrowRefresh.width===360&&S.narrowRefresh.root!=='none'&&S.narrowRefresh.sharedVisible&&S.narrowRefresh.noPaf&&S.narrowRefresh.scale===1.25&&S.narrowRefresh.threshold===.7&&S.narrowRefresh.route;
  report.pass=Object.values(C).every(Boolean)&&report.errors.length===0;
 }catch(e){report.errors.push(e?.stack||String(e));report.pass=false;}finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'cdp-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));clearTimeout(timeout);await cleanup();if(!report.pass)process.exitCode=1;}
}
main();
