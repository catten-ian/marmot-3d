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
const OUT = path.join(ROOT, 'outputs', 'm3d-20261031-beta-paf-release-attack');
const PORT = Number(process.env.PAF_RELEASE_QA_PORT || 8381);
const CDP_PORT = Number(process.env.CDP_PORT || 9481);
const EXTERNAL = process.env.PAF_QA_CDP === 'off' ? null : (process.env.PAF_QA_CDP || 'http://127.0.0.1:18800');
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
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paf-release-qa-'));
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
      report.errors.push('[exception] ' + String(msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || '').slice(0, 500));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      report.errors.push('[console.error] ' + msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ').slice(0, 500));
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
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

const HELPERS = `(() => {
  window.__pafReleaseQa = {
    saved: null,
    prepare(viewMode = 'tps', distance = 3.3) {
      const api = window.__playAsFox, c = api.cfg;
      if (!this.saved) this.saved = { preyWander:c.preyWander, preyFlee:c.preyFlee, preyBurst:c.preyBurst };
      Object.assign(c, { preyWander:0, preyFlee:0, preyBurst:0 });
      this.scoreBase = api.score;
      api.respawnAll(2);
      api.teleport(0, -20, 0);
      const target = api.prey[0], far = api.prey[1];
      for (const p of api.prey) Object.assign(p, { vx:0, vz:0, yaw:0, state:'wander', suspicion:0, timer:999, caught:false, respawn:0 });
      target.mesh.visible = true; far.mesh.visible = true;
      target.x = 0; target.z = -20 + distance;
      far.x = 8.5; far.z = -20;
      api.setViewMode(viewMode);
      if (viewMode === 'fpv') api.setLook(0, -0.08);
      for (let i=0;i<5;i++) api.step(1/60);
      return this.state();
    },
    render() { const g=window.__game; g.renderer.render(g.scene,g.camera); },
    state() {
      const api=window.__playAsFox, p=api?.prey?.[0];
      return {
        active:!!api?.active, paused:api?.paused, phase:api?.phase, phaseT:api?.phaseT,
        progress:api?.phase==='lunge' ? api.phaseT/api.cfg.lungeTime : null,
        score:api?.score, scoreDelta:(api?.score || 0) - (this.scoreBase || 0), caught:!!p?.caught, preyX:p?.x, preyZ:p?.z,
        fox:api?.pos, yaw:api?.input?.pounceYaw, charging:api?.input?.charging,
        preview:api?.preview, memory:api?.renderMemory,
        overlay:!!document.getElementById('playAsFoxHud'),
        touchAria:document.querySelector('[data-touch-action="attack"]')?.getAttribute('aria-label') || '',
      };
    },
    async prediction() {
      const api=window.__playAsFox, p=api.prey[0], pa=await import('/src/core/paf-pounce.js'), utils=await import('/src/core/utils.js');
      return pa.pafPouncePredictionHitsTarget({
        startX:api.pos.x,startZ:api.pos.z,yaw:api.input.pounceYaw,
        lungeSpeed:api.cfg.lungeSpeed,lungeTime:api.cfg.lungeTime,lungeHeight:api.cfg.lungeHeight,
        targetX:p.x,targetZ:p.z,catchRadius:api.cfg.catchRadius,catchFoxCenter:api.cfg.catchFoxCenter,
        catchVerticalTol:api.cfg.catchVerticalTol,preyCenterHeight:api.cfg.preyCenterHeight,
        foxTerrainAt:(x,z)=>utils.terrainHeight(x,z), preyTerrainAt:()=>utils.terrainHeight(p.x,p.z),
      });
    },
    steps(n=1) { const out=[]; for(let i=0;i<n;i++){ window.__playAsFox.step(1/60); out.push(this.state()); } return out; },
    runAfterRelease(max=80) {
      const out=[];
      for (let i=0;i<max;i++) {
        window.__playAsFox.step(1/60);
        const s=this.state(); out.push(s);
        if (i > 20 && s.phase === 'idle') break;
      }
      return out;
    },
    recoverProbe() {
      const api=window.__playAsFox;
      const p=api.addPrey(); p.x=api.pos.x; p.z=api.pos.z; p.vx=p.vz=0; p.state='wander'; p.suspicion=0; p.timer=999;
      const before=api.score;
      for(let i=0;i<60 && api.phase!=='idle';i++) api.step(1/60);
      return {before, after:api.score, caught:p.caught, phase:api.phase};
    },
    pause() { window.__playAsFox.setPaused(true); this.render(); return this.state(); },
    resume() { window.__playAsFox.setPaused(false); return this.state(); },
    blur() { window.dispatchEvent(new FocusEvent('blur')); return this.state(); },
    exit() { document.getElementById('pafExit').click(); return {qa:!!window.__playAsFox, overlay:!!document.getElementById('playAsFoxHud')}; },
    previewSceneCount() {
      let n=0; window.__game.scene.traverse((o)=>{ if(o.userData?.kind==='pafPouncePreview' || o.userData?.kind==='pafPounceTargetMark') n++; }); return n;
    },
  };
})()`;

async function runKeyboardTps() {
  await navigate(1280, 720, false);
  await evalJs(HELPERS);
  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await keyDown();
  await keyDown(true); // real repeat event must not re-arm or duplicate the attack
  const held = await evalJs(`window.__pafReleaseQa.steps(40)`);
  const heldState = held.at(-1);
  const predicted = await evalJs(`window.__pafReleaseQa.prediction()`);
  await shot('1280x720-tps-hold-prediction');
  report.scenarios.tpsKeyboardHold = { before: await evalJs(`window.__pafReleaseQa.state()`), held: heldState, predicted };
  check('tps long hold beyond old windTime stays wind and does no damage',
    held.every((s) => s.phase === 'wind' && s.score === 0 && !s.caught),
    JSON.stringify({ phases:[...new Set(held.map(s=>s.phase))], score:heldState.score, caught:heldState.caught }));
  check('tps hold shows real preview with one in-range target', heldState.preview.active && heldState.preview.visibleTargetMarks === 1 && predicted.hit, JSON.stringify({preview:heldState.preview,predicted}));
  await keyUp();
  const after = await evalJs(`window.__pafReleaseQa.runAfterRelease()`);
  const firstCatch = after.find((s) => s.caught);
  const firstHalf = after.filter((s) => s.phase === 'lunge' && s.progress !== null && s.progress < 0.5);
  const beforeCatchBad = firstHalf.some((s) => s.caught || s.scoreDelta !== 0);
  const scoreSet = new Set(after.map((s) => s.score));
  const recover = await evalJs(`window.__pafReleaseQa.recoverProbe()`);
  await shot('1280x720-tps-after-release-catch');
  report.scenarios.tpsKeyboardRelease = { firstCatch, firstHalfSamples:firstHalf.length, firstHalfMaxScoreDelta:Math.max(0,...firstHalf.map(s=>s.scoreDelta)), scoreValues:[...scoreSet], recover, phases:[...new Set(after.map(s=>s.phase))] };
  check('tps release catches only once in lunge second half', !!firstCatch && firstCatch.phase === 'lunge' && firstCatch.progress >= 0.5 && firstCatch.progress <= 1 && firstHalf.length > 0 && scoreSet.size === 2 && Math.max(...after.map(s=>s.scoreDelta)) === 1, JSON.stringify({firstCatch,scoreSet}));
  check('tps first half never catches', firstHalf.length > 0 && !beforeCatchBad, JSON.stringify({samples:firstHalf.length,maxScoreDelta:Math.max(0,...firstHalf.map(s=>s.scoreDelta))}));
  check('tps recover cannot catch a new adjacent target', recover.before === recover.after && !recover.caught && recover.phase === 'idle', JSON.stringify(recover));

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await keyDown(); await keyUp();
  const quickState = await evalJs(`window.__pafReleaseQa.state()`);
  const quickRun = await evalJs(`window.__pafReleaseQa.runAfterRelease()`);
  report.scenarios.tpsQuickTap = { immediate: quickState, caught: quickRun.some((s) => s.caught), maxScoreDelta: Math.max(...quickRun.map((s)=>s.scoreDelta)) };
  check('tps quick tap attacks immediately with no old windTime requirement and once',
    quickState.phase === 'lunge' && quickState.preview.active && quickRun.some(s=>s.phase==='recover' && s.preview.active) && !quickRun.at(-1).preview.active && quickRun.some((s)=>s.caught) && Math.max(...quickRun.map((s)=>s.scoreDelta)) === 1,
    JSON.stringify(report.scenarios.tpsQuickTap));

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  const memoryBefore = await evalJs(`(() => { window.__pafReleaseQa.render(); return window.__pafReleaseQa.state().memory.geometries; })()`);
  await keyDown(); await evalJs(`window.__pafReleaseQa.steps(25)`);
  const paused = await evalJs(`window.__pafReleaseQa.pause()`);
  await evalJs(`window.__pafReleaseQa.render()`);
  const pausedPreviewCount = await evalJs(`window.__pafReleaseQa.previewSceneCount()`);
  await keyUp();
  const pausedSteps = await evalJs(`window.__pafReleaseQa.steps(8)`);
  await evalJs(`window.__pafReleaseQa.resume()`);
  report.scenarios.tpsPauseCancel = { paused, afterKeyUp: pausedSteps.at(-1), memoryBefore, memoryAfterCancel: paused.memory?.geometries };
  check('pause cancels aim, disposes preview and cannot be attacked by later release',
    paused.phase === 'idle' && paused.preview.active === false && pausedSteps.every((s)=>s.phase==='idle' && s.scoreDelta===0) && pausedPreviewCount === 0,
    JSON.stringify({...report.scenarios.tpsPauseCancel, pausedPreviewCount}));
  check('pause preview GPU geometries are disposed', paused.memory?.geometries <= memoryBefore, `before=${memoryBefore} after=${paused.memory?.geometries}`);

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await keyDown(); await evalJs(`window.__pafReleaseQa.steps(12)`);
  const blurred = await evalJs(`window.__pafReleaseQa.blur()`);
  await keyUp();
  const blurSteps = await evalJs(`window.__pafReleaseQa.steps(8)`);
  report.scenarios.blurCancel = { blurred, afterKeyUp: blurSteps.at(-1) };
  check('window blur cancels aim and later keyup cannot attack', blurred.phase==='idle' && !blurred.preview.active && blurSteps.every((s)=>s.phase==='idle' && s.scoreDelta===0), JSON.stringify(report.scenarios.blurCancel));

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await keyDown(); await evalJs(`window.__pafReleaseQa.steps(12)`);
  const settingsRect = await evalJs(`(() => { const r=document.getElementById('setBtn').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await mouseDown(settingsRect.x, settingsRect.y); await mouseUp(settingsRect.x, settingsRect.y); await wait(150);
  const settingsPaused = await evalJs(`(() => { window.__pafReleaseQa.render(); return {...window.__pafReleaseQa.state(),settingsOpen:!document.getElementById('setSheet').hidden,previewSceneCount:window.__pafReleaseQa.previewSceneCount()}; })()`);
  await keyUp(); const settingsSteps = await evalJs(`window.__pafReleaseQa.steps(8)`);
  report.scenarios.settingsCancel = { settingsPaused, afterKeyUp:settingsSteps.at(-1) };
  check('settings opening cancels aim and later release cannot attack', settingsPaused.paused && settingsPaused.settingsOpen && settingsPaused.phase==='idle' && !settingsPaused.preview.active && settingsPaused.previewSceneCount===0 && settingsSteps.every(s=>s.phase==='idle' && s.scoreDelta===0), JSON.stringify(report.scenarios.settingsCancel));
  const closeRect = await evalJs(`(() => { const r=document.getElementById('setClose').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await mouseDown(closeRect.x, closeRect.y); await mouseUp(closeRect.x, closeRect.y); await wait(100);

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await keyDown(); await evalJs(`window.__pafReleaseQa.steps(10)`);
  const exitInfo = await evalJs(`window.__pafReleaseQa.exit()`);
  await wait(200);
  const scenePreviewCount = await evalJs(`(() => { let n=0; window.__game.scene.traverse((o)=>{ if(o.userData?.kind==='pafPouncePreview' || o.userData?.kind==='pafPounceTargetMark') n++; }); return n; })()`);
  await keyUp();
  await evalJs(`window.__enterPlayAsFox()`);
  for (let i=0;i<50;i++) { await wait(100); if (await evalJs(`!!window.__playAsFox?.active`)) break; }
  const reentered = await evalJs(`({active:!!window.__playAsFox?.active,previewSceneCount:window.__pafReleaseQa.previewSceneCount()})`);
  report.scenarios.exitCleanup = { exitInfo, scenePreviewCount, reentered };
  check('exit removes PAF and preview resources; release after exit cannot attack; reentry is clean', !exitInfo.qa && !exitInfo.overlay && scenePreviewCount === 0 && reentered.active && reentered.previewSceneCount===0, JSON.stringify(report.scenarios.exitCleanup));
}

async function runMouseFpv() {
  await navigate(1280, 720, false);
  await evalJs(HELPERS);
  await evalJs(`window.__pafReleaseQa.prepare('fpv')`);
  await mouseDown(640, 360);
  await mouseDown(640, 360); // duplicate callback cannot re-arm
  const held = await evalJs(`window.__pafReleaseQa.steps(40)`);
  const predicted = await evalJs(`window.__pafReleaseQa.prediction()`);
  await shot('1280x720-fpv-hold-prediction');
  await mouseUp(640, 360);
  await mouseUp(640, 360); // duplicate release cannot commit twice
  const run = await evalJs(`window.__pafReleaseQa.runAfterRelease()`);
  const firstCatch = run.find((s)=>s.caught);
  const firstHalf = run.filter((s)=>s.phase==='lunge' && s.progress!==null && s.progress<0.5);
  await shot('1280x720-fpv-after-release-catch');
  report.scenarios.fpvMouse = { held: held.at(-1), predicted, firstCatch, firstHalfSamples:firstHalf.length, phases:[...new Set(run.map(s=>s.phase))], scores:[...new Set(run.map(s=>s.score))] };
  check('FPV mouse hold only aims and shows preview', held.every((s)=>s.phase==='wind' && s.score===0 && !s.caught) && held.at(-1).preview.active && predicted.hit, JSON.stringify({held:held.at(-1),predicted}));
  check('FPV mouse release catches once in second half', !!firstCatch && firstCatch.progress>=0.5 && firstCatch.progress<=1 && firstCatch.phase==='lunge' && firstHalf.length>0 && firstHalf.every(s=>!s.caught && s.scoreDelta===0) && new Set(run.map(s=>s.score)).size===2 && Math.max(...run.map(s=>s.scoreDelta))===1, JSON.stringify(report.scenarios.fpvMouse));
}

async function runTablet() {
  await navigate(768, 1024, false);
  await evalJs(HELPERS);
  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await keyDown();
  const held = await evalJs(`window.__pafReleaseQa.steps(35)`);
  await shot('768x1024-tps-hold-prediction');
  await keyUp();
  const run = await evalJs(`window.__pafReleaseQa.runAfterRelease()`);
  await shot('768x1024-tps-after-release-catch');
  report.scenarios.tablet768 = { held: held.at(-1), caught: run.some((s)=>s.caught), firstCatch: run.find((s)=>s.caught), maxScoreDelta:Math.max(...run.map(s=>s.scoreDelta)) };
  check('768x1024 hold preview and second-half release catch work', held.at(-1).phase==='wind' && held.at(-1).preview.active && run.find((s)=>s.caught)?.progress >= 0.5 && Math.max(...run.map(s=>s.scoreDelta))===1, JSON.stringify(report.scenarios.tablet768));
}

async function runTouch() {
  await navigate(390, 844, true);
  await evalJs(HELPERS);
  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  const rect = await touchButtonRect();
  await touchAt(rect.x, rect.y, 'touchStart');
  const held = await evalJs(`window.__pafReleaseQa.steps(40)`);
  const predicted = await evalJs(`window.__pafReleaseQa.prediction()`);
  await shot('390x844-touch-hold-prediction');
  await touchAt(rect.x, rect.y, 'touchEnd');
  const run = await evalJs(`window.__pafReleaseQa.runAfterRelease()`);
  const firstCatch = run.find((s)=>s.caught);
  const firstHalf = run.filter((s)=>s.phase==='lunge' && s.progress!==null && s.progress<0.5);
  await shot('390x844-touch-after-release-catch');
  report.scenarios.touchLong = { rect, held: held.at(-1), predicted, firstCatch, firstHalfSamples:firstHalf.length, aria: held.at(-1).touchAria, scores:[...new Set(run.map(s=>s.score))] };
  check('390x844 touch hold only aims, shows real range and updated aria', held.every((s)=>s.phase==='wind' && s.score===0 && !s.caught) && held.at(-1).preview.active && predicted.hit && /按住瞄准/.test(held.at(-1).touchAria), JSON.stringify(report.scenarios.touchLong));
  check('390x844 touch release catches once in second half', !!firstCatch && firstCatch.progress>=0.5 && firstCatch.progress<=1 && firstCatch.phase==='lunge' && firstHalf.length>0 && firstHalf.every(s=>!s.caught && s.scoreDelta===0) && new Set(run.map(s=>s.score)).size===2 && Math.max(...run.map(s=>s.scoreDelta))===1, JSON.stringify({firstCatch}));

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await touchAt(rect.x, rect.y, 'touchStart');
  await touchAt(rect.x, rect.y, 'touchEnd');
  const quick = await evalJs(`window.__pafReleaseQa.state()`);
  const quickRun = await evalJs(`window.__pafReleaseQa.runAfterRelease()`);
  report.scenarios.touchQuickTap = { immediate: quick, caught: quickRun.some((s)=>s.caught), maxScoreDelta:Math.max(...quickRun.map(s=>s.scoreDelta)) };
  check('390x844 touch quick tap attacks once without minimum hold', quick.phase==='lunge' && quick.preview.active && quickRun.some(s=>s.phase==='recover' && s.preview.active) && !quickRun.at(-1).preview.active && quickRun.some(s=>s.caught) && Math.max(...quickRun.map(s=>s.scoreDelta))===1, JSON.stringify(report.scenarios.touchQuickTap));

  await evalJs(`window.__pafReleaseQa.prepare('tps')`);
  await touchAt(rect.x, rect.y, 'touchStart');
  const cancelHeld = await evalJs(`window.__pafReleaseQa.steps(20)`);
  await touchAt(rect.x, rect.y, 'touchCancel');
  const canceled = await evalJs(`(() => { window.__pafReleaseQa.render(); return window.__pafReleaseQa.state(); })()`);
  await evalJs(`(() => { const button=document.querySelector('[data-touch-action="attack"]'); const touch=new Touch({identifier:17,target:button,clientX:${rect.x},clientY:${rect.y}}); window.dispatchEvent(new TouchEvent('touchend',{changedTouches:[touch],bubbles:true,cancelable:true})); })()`);
  const after = await evalJs(`window.__pafReleaseQa.steps(10)`);
  await shot('390x844-touch-cancel-cleanup');
  report.scenarios.touchCancel = { held:cancelHeld.at(-1), canceled, after:after.at(-1), previewSceneCount: await evalJs(`window.__pafReleaseQa.previewSceneCount()`) };
  check('touch cancel cleans preview and a later end never attacks', cancelHeld.at(-1).phase==='wind' && canceled.phase==='idle' && !canceled.preview.active && after.every(s=>s.phase==='idle' && s.scoreDelta===0), JSON.stringify(report.scenarios.touchCancel));
}

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  send = await connectCdp();
  await send('Runtime.enable'); await send('Page.enable'); await send('Input.enable').catch(()=>{});
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(()=>{});
  if (useExternal) {
    const target = await send('Target.createTarget', { url: 'about:blank', newWindow: true, background: false });
    tabTargetId = target.targetId;
    await send('Target.activateTarget', { targetId: tabTargetId });
    const attached = await send('Target.attachToTarget', { targetId: tabTargetId, flatten: true });
    sessionId = attached.sessionId;
  }
  await runKeyboardTps();
  await runMouseFpv();
  await runTablet();
  await runTouch();
  report.renderer = await evalJs(`(async () => { const g=window.__game; let rawGl=''; try { const gl=g.renderer.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info'); rawGl=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):''; } catch(e){} return {backend:g.renderer.constructor.name, rawGl, maxTouchPoints:navigator.maxTouchPoints}; })()`).catch((e)=>String(e));
  const failed = Object.entries(report.checks).filter(([,v])=>!v.pass);
  report.pass = failed.length === 0 && report.errors.length === 0;
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'qa-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass:report.pass, checks:Object.fromEntries(Object.entries(report.checks).map(([k,v])=>[k,v.pass])), screenshots:report.screenshots, out:OUT, errors:report.errors }, null, 2));
  if (!report.pass) process.exitCode = 1;
}
process.on('unhandledRejection', (error) => {
  report.errors.push(String(error?.stack || error));
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'qa-results-partial.json'), JSON.stringify(report, null, 2));
  console.error(error);
  process.exitCode = 1;
});
main().finally(() => {
  try { ws?.close(); } catch (_) {}
  try { if (tabTargetId && useExternal) fetch(`${EXTERNAL}/json/close/${tabTargetId}`).catch(()=>{}); } catch (_) {}
  try { chrome?.kill('SIGKILL'); } catch (_) {}
  server.close();
});
