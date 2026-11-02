/**
 * Real-browser acceptance for the 2026-10-31 PAF release-attack contract.
 *
 * It drives the production PAF mode in Chrome through CDP keyboard, mouse and touch
 * events. The ?pafqa=1 fixed-step hook is used only to make rAF-independent timing
 * assertions; the rendered page, production input listeners, PAF state machine,
 * scene geometry and HUD are all real. This is not a standalone DOM fixture.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261101-beta-paf-touch', process.env.PAF_BASELINE ? 'baseline' : process.env.PAF_CANCEL_ONLY ? 'cancel' : 'after');
const PORT = Number(process.env.PAF_RELEASE_QA_PORT || 8397);
const CDP_PORT = Number(process.env.CDP_PORT || 9497);
const EXTERNAL = null; // This harness owns its private Chrome; never attach to shared CDP.
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const report = {
  startedAt: new Date().toISOString(), target: null, cdp: {}, renderer: {}, scenarios: {}, checks: {}, screenshots: [], errors: [],
};
let seq = 0;
let ws = null;
let sessionId = null;
let tabTargetId = null;
let chrome = null;
let useExternal = false;
let privateProfile;
report.events = []; report.httpErrors = []; report.consoleErrors = []; report.exceptions = [];

function fail(message) {
  report.errors.push(String(message && message.stack || message));
  throw message instanceof Error ? message : new Error(message);
}
async function getJson(url) { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).json(); }
async function connectCdp() {
  let ver = null;
  if (EXTERNAL) {
    try { ver = await getJson(`${EXTERNAL}/json/version`); } catch (_) {}
  }
  if (ver) {
    useExternal = true;
    report.cdp.managed = true;
    report.cdp.endpoint = EXTERNAL;
    report.cdp.browser = ver.Browser;
    ws = new WebSocket(ver.webSocketDebuggerUrl);
  } else {
    useExternal = false;
    report.cdp.managed = false;
    report.cdp.endpoint = `local:${CDP_PORT}`;
    const profile = privateProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'paf-release-qa-'));
    chrome = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu-blocklist', '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--window-size=1280,720', 'about:blank',
    ], { stdio: 'ignore' });
    let target = null;
    for (let i = 0; i < 60; i++) {
      await wait(250);
      try { target = (await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`)).find((t) => t.type === 'page'); } catch (_) {}
      if (target) break;
    }
    if (!target) fail('local Chrome CDP unavailable');
    report.cdp.browser = 'local headless Chrome';
    ws = new WebSocket(target.webSocketDebuggerUrl);
  }
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error('CDP websocket open failed')), { once: true });
    setTimeout(() => reject(new Error('CDP websocket timeout')), 5000);
  });
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const item = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      report.exceptions.push(msg.params); report.errors.push('[exception] ' + String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '').slice(0, 500));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      report.consoleErrors.push(msg.params); report.errors.push('[console.error] ' + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 500));
    } else if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
      report.httpErrors.push(msg.params.response);
    } else if (msg.method === 'Network.loadingFailed') { report.httpErrors.push(msg.params); }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    if (method.startsWith('Input.')) report.events.push({at:Date.now(), method, params});
    const id = ++seq;
    pending.set(id, { resolve, reject });
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 60000);
  });
}
let send;

async function evalJs(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 55000 });
  if (result.exceptionDetails) fail(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function setViewport(width, height, mobile) {
  await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: mobile ? 5 : 1 });
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile,
  });
}
async function navigate(width, height, mobile) {
  await setViewport(width, height, mobile);
  const url = `http://127.0.0.1:${PORT}/index.html?version=beta&webgl=1&play-as-fox=1&pafqa=1&releaseqa=${Date.now()}`;
  report.target = url;
  if (tabTargetId) await send('Target.activateTarget', { targetId: tabTargetId });
  await send('Page.bringToFront').catch(() => {});
  await send('Page.navigate', { url });
  for (let i = 0; i < 160; i++) {
    await wait(250);
    if (await evalJs(`!!(window.__game && window.__enterPlayAsFox)`).catch(() => false)) break;
    if (i === 159) fail('page boot timeout');
  }
  await evalJs(`window.__enterPlayAsFox()`);
  for (let i = 0; i < 100; i++) {
    await wait(100);
    if (await evalJs(`!!window.__playAsFox?.active`).catch(() => false)) break;
    if (i === 99) fail('PAF entry timeout');
  }
  await wait(500);
}
async function shot(name) {
  await evalJs(`(() => { const g=window.__game; g?.renderer?.render(g.scene,g.camera); })()`).catch(() => {});
  const image = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(image.data, 'base64'));
  report.screenshots.push(`${name}.png`);
}
const keyDown = (autoRepeat = false) => send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, autoRepeat });
const keyUp = () => send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
const mouseDown = (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
const mouseUp = (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
async function touchAt(x, y, type) {
  const touchPoints = type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 17, radiusX: 1, radiusY: 1, force: 1 }];
  await send('Input.dispatchTouchEvent', { type, touchPoints });
}
async function touchButtonRect() {
  return evalJs(`(() => { const r=document.querySelector('[data-touch-action="attack"]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height}; })()`);
}
async function assert(condition, detail) {
  if (!condition) fail(detail || 'assertion failed');
}
function check(name, condition, detail) {
  report.checks[name] = { pass: !!condition, detail: detail || '' };
  if (!condition) report.errors.push(`FAILED ${name}: ${detail || ''}`);
}

async function state() {
  return evalJs(`(() => { const a=window.__playAsFox, g=window.__game; const objects=[];g.scene.traverse(o=>{if(o.userData.kind==='pafPouncePreview')objects.push({kind:o.type,color:o.children[0]?.material?.color?.getHexString(),opacity:o.children[0]?.material?.opacity});});return {phase:a.phase,phaseT:a.phaseT,pos:a.pos,look:a.look,input:a.input,preview:a.preview,noise:a.noise,score:a.score,objects,cameraDirection:g.camera.getWorldDirection(new (g.camera.position.constructor)()).toArray(),touch:g.touchControls ? null : document.body.className}; })()`);
}
async function touches(type, pts) {
  await send('Input.dispatchTouchEvent', { type, touchPoints:pts.map(p=>({...p,radiusX:2,radiusY:2,force:1})) });
}
async function steps(n) { return evalJs(`(() => {for(let i=0;i<${n};i++)window.__playAsFox.step(1/60);})()`); }
async function rect(selector) { return evalJs(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`); }
async function naturalHunt() {
  await evalJs(`window.__playAsFox.setViewMode('tps')`);
  const held=new Set(), trace=[];
  const key=async(code,on)=>{if(held.has(code)===on)return;on?held.add(code):held.delete(code);await send('Input.dispatchKeyEvent',{type:on?'keyDown':'keyUp',code,key:code==='Space'?' ':code.slice(3).toLowerCase()});};
  const scoreStart=await evalJs('window.__playAsFox.score');let success=null;
  for(let i=0;i<220;i++) {
    const s=await evalJs(`(()=>{const a=window.__playAsFox;return {pos:a.pos,phase:a.phase,score:a.score,preview:a.preview,prey:a.prey.filter(p=>!p.caught).map(p=>({x:p.x,z:p.z,vx:p.vx,vz:p.vz,state:p.state}))};})()`);
    trace.push(s);
    if(i%20===0)console.log('natural hunt',i,'score',s.score,'phase',s.phase);
    if(s.score>scoreStart){success=s;break;}
    if(s.phase==='idle'||s.phase==='wind') {
      const target=s.prey.sort((a,b)=>Math.hypot(a.x-s.pos.x,a.z-s.pos.z)-Math.hypot(b.x-s.pos.x,b.z-s.pos.z))[0];
      const dist=Math.hypot(target.x-s.pos.x,target.z-s.pos.z);
      const yaw=Math.atan2(target.x+(target.vx||0)*.32-s.pos.x,target.z+(target.vz||0)*.32-s.pos.z);
      let delta=yaw-s.pos.yaw;while(delta>Math.PI)delta-=2*Math.PI;while(delta<-Math.PI)delta+=2*Math.PI;
      if(s.phase==='wind') {
        // Holding Space creates the real prediction. Release only when its
        // existing target marker confirms a hit; no prey or geometry is changed.
        if(s.preview.visibleTargetMarks>0) {
          await Promise.all([...held].map(code=>key(code,false)));
        } else {
          await Promise.all([key('KeyA',delta>.08),key('KeyD',delta<-.08),key('KeyW',false),key('ShiftLeft',false)]);
        }
      } else if(dist>=2.4&&dist<4.9&&Math.abs(delta)<.16) {
        // Avoid a point-blank 5.67m overshoot. Start a real hold, then use the
        // wind-phase prediction above instead of guessing before it exists.
        await Promise.all([...held].map(code=>key(code,false)));
        await key('Space',true);
      } else {
        await Promise.all([key('KeyA',delta>.10),key('KeyD',delta<-.10),key('KeyW',Math.abs(delta)<1.2),key('ShiftLeft',dist>10)]);
      }
    }
    await steps(4);
  }
  for(const code of [...held])await key(code,false);
  if(success)await shot('1280x720-natural-catch-preview');
  await steps(65);const complete=await state();
  report.scenarios.naturalHunt={scoreStart,success,complete,trace};
  check('natural untuned hunt catches prey and clears preview after full recovery',!!success&&success.preview.active&&complete.phase==='idle'&&!complete.preview.active,JSON.stringify({success,complete}));
}
async function desktopRegression() {
  await navigate(1280,720,false);
  const key=(type,code)=>send('Input.dispatchKeyEvent',{type,code,key:code==='KeyW'?'w':' ',windowsVirtualKeyCode:code==='KeyW'?87:32});
  await key('keyDown','KeyW'); await keyDown(); const before=await state();await steps(45);const hold=await state();
  await keyUp();const released=await state();await key('keyUp','KeyW');await steps(65);const complete=await state();
  check('desktop keyboard hold still moves, never auto launches, release keeps preview through recovery',hold.phase==='wind'&&Math.hypot(hold.pos.x-before.pos.x,hold.pos.z-before.pos.z)>.5&&released.phase==='lunge'&&released.preview.active&&complete.phase==='idle'&&!complete.preview.active,JSON.stringify({before,hold,released,complete}));
  await evalJs(`window.__playAsFox.setViewMode('fpv')`);
  await mouseDown(640,360);await steps(30);const mouseHold=await state();await mouseUp(640,360);const mouseReleased=await state();await steps(65);const mouseComplete=await state();
  check('desktop FPV mouse hold/release and completion retain action semantics',mouseHold.phase==='wind'&&mouseHold.preview.active&&mouseReleased.phase==='lunge'&&mouseReleased.preview.active&&mouseComplete.phase==='idle'&&!mouseComplete.preview.active,JSON.stringify({mouseHold,mouseReleased,mouseComplete}));
  await keyDown();await evalJs(`window.__playAsFox.setPaused(true)`);await keyUp();await evalJs(`window.__playAsFox.setPaused(false)`);await steps(5);const pause=await state();
  check('PAF pause cancels and stale release cannot relaunch',pause.phase==='idle'&&!pause.preview.active&&!pause.input.charging,JSON.stringify(pause));
  report.scenarios.desktop={before,hold,released,complete,mouseHold,mouseReleased,mouseComplete,pause};
  await naturalHunt();
  report.desktopDomEvents=await evalJs('window.__touchTrace');
}
async function run() {
  await new Promise(resolve=>server.listen(PORT,'127.0.0.1',resolve));
  send=await connectCdp(); await send('Runtime.enable');await send('Page.enable');await send('Network.enable');await send('Emulation.setFocusEmulationEnabled',{enabled:true});
  await send('Page.addScriptToEvaluateOnNewDocument', {source:`window.__touchTrace=[];for(const type of ['touchstart','touchmove','touchend','touchcancel','pointerdown','pointermove','pointerup','pointercancel'])window.addEventListener(type,e=>window.__touchTrace.push({type,at:performance.now(),target:e.target.id||e.target.dataset?.touchAction,pointerId:e.pointerId,changed:e.changedTouches&&Array.from(e.changedTouches,t=>({id:t.identifier,x:t.clientX,y:t.clientY})),touches:e.touches&&Array.from(e.touches,t=>t.identifier)}),true);`});
  await navigate(390,844,true);
  if (process.env.PAF_HUNT_ONLY) {
    await naturalHunt();
    report.pass = Object.values(report.checks).every(c => c.pass) && report.errors.length === 0;
    return;
  }
  await evalJs(`window.__playAsFox.setViewMode('fpv')`);
  const joy=await rect('#touchJoystick'), attack=await rect('[data-touch-action="attack"]');
  // Verify hit-testing against the actual layout, rather than dispatching to a DOM element.
  report.layout=await evalJs(`({joy:document.elementFromPoint(${joy.x},${joy.y})?.outerHTML, attack:document.elementFromPoint(${attack.x},${attack.y})?.outerHTML, look:document.elementFromPoint(285,380)?.outerHTML})`);
  const m={...joy,id:1}, l={x:285,y:380,id:2}, a={...attack,id:3};
  if(process.env.PAF_CANCEL_ONLY) {
    // One initial touch consumes native pointerId=2. Move then owns pointerId=3,
    // deliberately colliding with the attack Touch identifier=3.
    await touches('touchStart',[a]);await touches('touchCancel',[]);
    await touches('touchStart',[m]);m.y-=24;await touches('touchMove',[m]);
    await touches('touchStart',[m,l]);await touches('touchStart',[m,l,a]);
    await touches('touchEnd',[m]);const canceledMove=await state();
    check('releasing movement preserves another finger attack with a colliding native pointer ID',canceledMove.phase==='wind'&&canceledMove.input.chargeHeld&&canceledMove.input.pointers.move===null&&canceledMove.input.pointers.roles.includes('look')&&canceledMove.input.pointers.roles.includes('button:attack'),JSON.stringify(canceledMove));
    await touches('touchCancel',[]);const canceledAll=await state();
    check('subsequent attack cancel clears all pointers and preview',canceledAll.phase==='idle'&&!canceledAll.preview.active&&canceledAll.input.pointers.roles.length===0,JSON.stringify(canceledAll));
    report.domEvents=await evalJs('window.__touchTrace');
    report.renderer=await evalJs(`(()=>{const r=window.__game.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {backend:r.constructor.name,rawGl:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),maxTouchPoints:navigator.maxTouchPoints};})()`);
    report.expectedStaticApiErrors=report.httpErrors.filter(e=>e.status===404&&/\/api\/(configs\/active|auth\/guest)$/.test(new URL(e.url).pathname));
    report.unexpectedHttpErrors=report.httpErrors.filter(e=>!report.expectedStaticApiErrors.includes(e));
    report.pass=Object.values(report.checks).every(c=>c.pass)&&report.errors.length===0&&report.unexpectedHttpErrors.length===0;
    return;
  }
  const initial=await state(); await touches('touchStart',[a]);await steps(12);const stationary=await state();
  check('stationary preparation quieter than stalking',stationary.noise?.hearingRadius < 3 && stationary.noise?.noiseCoef < .45,JSON.stringify(stationary.noise));
  await touches('touchCancel',[]);const cancel=await state();
  check('touchcancel cancels instead of committing',cancel.phase==='idle'&&!cancel.preview.active,JSON.stringify(cancel));
  await steps(65);
  await touches('touchStart',[m]); m.y-=24; await touches('touchMove',[m]);
  await touches('touchStart',[m,l]);await touches('touchStart',[m,l,a]);
  const before=await state(); l.x+=35;l.y-=20;await touches('touchMove',[m,l,a]);await steps(12);
  const held=await state();await shot('390x844-fpv-hold');
  check('three-finger hold continues moving',held.phase==='wind'&&Math.hypot(held.pos.x-before.pos.x,held.pos.z-before.pos.z)>.12,JSON.stringify({before,held}));
  check('FPV right drag turns right and upward drag raises pitch',held.look.yaw<before.look.yaw-.1 && held.look.pitch>before.look.pitch+.04,JSON.stringify({before:before.look,after:held.look}));
  await touches('touchEnd',[m]);const moveReleased=await state();
  check('releasing joystick does not release attack through compatibility pointer ID collision',moveReleased.phase==='wind'&&moveReleased.input.chargeHeld&&moveReleased.input.pointers.roles.includes('button:attack')&&moveReleased.input.pointers.roles.includes('look'),JSON.stringify(moveReleased));
  await touches('touchStart',[m,l,a]);
  const steerBefore=await state(); m.x+=12;await touches('touchMove',[m,l,a]);await steps(8);const steered=await state();
  check('joystick steering and FPV heading remain coupled while charging',steered.pos.yaw<steerBefore.pos.yaw-.01 && Math.abs(steered.look.yaw-steered.pos.yaw)<1e-6,JSON.stringify({steerBefore,steered}));
  const dx=held.pos.x-before.pos.x, dz=held.pos.z-before.pos.z;
  check('FPV movement follows visible heading and camera world orientation matches look',
    (dx*Math.sin(held.look.yaw)+dz*Math.cos(held.look.yaw))/Math.hypot(dx,dz)>.98 && Math.abs(Math.atan2(held.cameraDirection[0],held.cameraDirection[2])-held.look.yaw)<1e-6 && Math.abs(Math.asin(held.cameraDirection[1])-held.look.pitch)<1e-6,JSON.stringify({before,held}));
  check('preview is translucent light blue',held.objects[0]?.color==='9fd8ff'&&held.objects[0]?.opacity===.28,JSON.stringify(held.objects));
  // Release only attack: move and look stay down.
  await touches('touchEnd',[a]);const released=await state();await shot('390x844-fpv-release-in-flight');
  report.scenarios.fpv={initial,stationary,cancel,before,held,steered,released};
  check('release commits current heading and configured physical speed', Math.abs(released.input.pounceYaw-released.pos.yaw)<1e-6 && Math.abs(Math.hypot(released.pos.x-released.preview.path.startX,released.pos.z-released.preview.path.startZ)/released.phaseT-released.preview.path.lungeSpeed)<1e-5,JSON.stringify(released));
  check('release keeps preview through flight',released.phase==='lunge'&&released.preview.active,JSON.stringify(released));
  l.x+=12;await touches('touchMove',[m,l]);const remaining=await state();
  check('attack release leaves joystick and look independent',remaining.input.touch.throttle>0&&remaining.look.yaw<released.look.yaw&&remaining.input.pointers.roles.includes('move')&&remaining.input.pointers.roles.includes('look')&&!remaining.input.pointers.roles.includes('button:attack'),JSON.stringify(remaining));
  const pitchBefore=remaining.look.pitch;
  l.x-=20;l.y+=400;await touches('touchMove',[m,l]);const pitchBottom=await state();
  l.y-=20;await touches('touchMove',[m,l]);const pitchReturn=await state();
  check('left/down look, configured pitch clamp and immediate reverse work with joystick held',pitchBottom.look.yaw>remaining.look.yaw&&Math.abs(pitchBottom.look.pitch+55*Math.PI/180)<1e-6&&pitchReturn.look.pitch>pitchBottom.look.pitch+.04&&pitchReturn.input.pointers.roles.includes('move'),JSON.stringify({pitchBefore,pitchBottom,pitchReturn}));
  // Restore a useful ground-facing view through the same real drag path.
  l.y+=(pitchReturn.look.pitch+.15)/.0045;await touches('touchMove',[m,l]);
  await touches('touchEnd',[]); await steps(45); const completed=await state();await shot('390x844-fpv-completed');
  check('completed recovery removes preview',completed.phase==='idle'&&!completed.preview.active,JSON.stringify(completed));
  report.scenarios.fpv.completed=completed;
  await evalJs(`window.__playAsFox.setViewMode('tps')`);await touches('touchStart',[a]);await steps(3);await shot('390x844-tps-hold');await touches('touchEnd',[]);const tpsReleased=await state();await shot('390x844-tps-release-in-flight');await steps(60);await shot('390x844-tps-completed');
  check('TPS release lifecycle matches FPV',tpsReleased.phase==='lunge'&&tpsReleased.preview.active&&!(await state()).preview.active,JSON.stringify(tpsReleased));
  await touches('touchStart',[m,l,a]); await evalJs(`window.dispatchEvent(new FocusEvent('blur'))`);const blurred=await state();await touches('touchEnd',[]);await steps(5);const afterBlur=await state();
  check('blur clears charge and all held motion',blurred.phase==='idle'&&!blurred.preview.active&&afterBlur.input.touch.throttle===0&&afterBlur.input.pointers.roles.length===0,JSON.stringify({blurred,afterBlur}));
  await touches('touchStart',[m,l,a]);await evalJs(`document.getElementById('pafExit').click()`);await touches('touchEnd',[]);await evalJs(`window.__enterPlayAsFox()`);await wait(150);const reentered=await state();
  check('exit and reentry have no pointer or preview residue',reentered.phase==='idle'&&!reentered.preview.active&&reentered.input.touch.throttle===0&&reentered.input.pointers.roles.length===0,JSON.stringify(reentered));
  report.scenarios.cleanup={blurred,afterBlur,reentered};
  report.domEvents=await evalJs('window.__touchTrace');
  report.mobileRenderer=await evalJs(`(()=>{const r=window.__game.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {backend:r.constructor.name,rawGl:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),maxTouchPoints:navigator.maxTouchPoints};})()`);
  await desktopRegression();
  report.renderer=await evalJs(`(()=>{const r=window.__game.renderer,gl=r.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {backend:r.constructor.name,rawGl:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),maxTouchPoints:navigator.maxTouchPoints};})()`);
  report.expectedStaticApiErrors=report.httpErrors.filter(e=>e.status===404&&/\/api\/(configs\/active|auth\/guest)$/.test(new URL(e.url).pathname));
  report.unexpectedHttpErrors=report.httpErrors.filter(e=>!report.expectedStaticApiErrors.includes(e));
  report.pass=Object.values(report.checks).every(c=>c.pass)&&report.errors.length===0&&report.unexpectedHttpErrors.length===0;
}
run().catch(e=>{report.errors.push(String(e.stack||e));report.pass=false;}).finally(async()=>{
  report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(OUT,'qa-results.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,checks:report.checks,errors:report.errors,httpErrors:report.httpErrors,out:OUT},null,2));
  ws?.close();chrome?.kill('SIGTERM');server.close();
  if(chrome)await new Promise(resolve=>chrome.once('exit',resolve));
  if(privateProfile)fs.rmSync(privateProfile,{recursive:true,force:true});
  process.exit(report.pass?0:1);
});
