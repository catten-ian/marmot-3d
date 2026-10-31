import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { CdpConnection, CdpSession } from '../e2e-smoke/cdp.ts';
import { createStaticServer } from '../e2e-smoke/server.ts';
import { createProfileDir, freePort, portListening, safeRmProfile, sleep } from '../e2e-smoke/util.ts';
import { chromePidsForProfile } from '../e2e-smoke/chrome.ts';

const argv = new Set(process.argv.slice(2));
const backend = argv.has('--webgpu') ? 'webgpu' : 'webgl2';
const touchCss = argv.has('--touch-css');
const noShadows = argv.has('--no-shadows');
const halfPixel = argv.has('--half-pixel');
const timing = argv.has('--timing');
const small = argv.has('--720');
const css390 = argv.has('--css390');
const touchOnly = argv.has('--touch-only');
const noTouch = argv.has('--no-touch');
const mobile = argv.has('--mobile');
const viewport = mobile ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, maxTouchPoints: 5 } : (css390 ? { width: 390, height: 844, deviceScaleFactor: 3, mobile: false, maxTouchPoints: 0 } : (small ? { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, maxTouchPoints: 0 } : { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, maxTouchPoints: 0 }));
const output = path.resolve(process.argv.find((x) => x.startsWith('--output='))?.slice(9) || `outputs/dev-e2e-fix-evidence/diag-${backend}-${mobile ? 'mobile' : 'desktop'}`);
fs.mkdirSync(path.join(output, 'screenshots'), { recursive: true });
const staticPort = await freePort(18432), cdpPort = await freePort(18822), profile = createProfileDir();
const server = createStaticServer(process.cwd(), staticPort);
const chromeArgs = [
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage',
  '--disable-background-networking', '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--disable-default-apps', '--disable-extensions',
  '--disable-breakpad', '--disable-crash-reporter', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling,TimerThrottlingForHiddenFrames,ThrottleDisplayNoneAndVisibility,UseEcoQoSForBackgroundProcess', '--force-device-scale-factor=1', '--no-proxy-server',
  '--enable-gpu', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=gl', '--kiosk',
  'about:blank',
];
if (backend === 'webgpu') chromeArgs.push('--enable-unsafe-webgpu', '--enable-features=Vulkan');
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/tmp', LANG: process.env.LANG || 'C.UTF-8' };
for (const k of ['DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR']) if (process.env[k]) env[k] = process.env[k];
const chrome = spawn('/usr/bin/google-chrome', chromeArgs, { stdio: 'ignore', env, detached: true });
let browser, page, targetId, sessionId;
const consoleEvents = [];
const off = { listener: null };
try {
  if (!chrome.pid) throw new Error('Chrome did not start');
  let version;
  for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${cdpPort}/json/version`); if (r.ok) { version = await r.json(); break; } } catch {} await sleep(100); }
  if (!version) throw new Error('Timed out waiting for isolated Chrome CDP');
  browser = await CdpConnection.connect(version.webSocketDebuggerUrl);
  ({ targetId } = await browser.send('Target.createTarget', { url: 'about:blank' }));
  ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
  page = new CdpSession(browser, sessionId);
  off.listener = browser.listen((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === 'Runtime.consoleAPICalled') consoleEvents.push({ type: m.params.type, text: (m.params.args || []).map((x) => x.value ?? x.description ?? '').join(' ').slice(0, 1200) });
    if (m.method === 'Runtime.exceptionThrown') consoleEvents.push({ type: 'exception', text: m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || 'exception' });
    if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') consoleEvents.push({ type: 'log-error', text: m.params.entry.text });
  });
  await page.send('Runtime.enable'); await page.send('Log.enable'); await page.send('Page.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.deviceScaleFactor, mobile: viewport.mobile, screenWidth: viewport.width, screenHeight: viewport.height });
  if ((mobile || touchOnly) && !noTouch) await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5, configuration: 'desktop' });
  await page.send('Page.bringToFront');
  const url = `http://127.0.0.1:${staticPort}/index.html?version=dev&verdantTier=low&tos=0${backend === 'webgl2' ? '&webgl=1' : ''}`;
  await page.send('Page.navigate', { url });
  await browser.send('Target.activateTarget', { targetId });
  await page.send('Page.bringToFront');
  await page.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const bootDeadline = Date.now() + 180000;
  let initial;
  while (Date.now() < bootDeadline) {
    await sleep(500);
    try {
      initial = await page.evaluate(`(()=>({started:!!window.__game,ready:!!window.__m3dFirstFrameAt,sandbox:window.__game?.game?.sandbox===true,mode:window.__game?.game?.mode,loaderGone:!!document.querySelector('#loader.gone'),button:document.querySelector('#sandboxEntryBtn.sandbox-entry')?.getBoundingClientRect().toJSON?.()||null}))()`);
      if (initial.started && initial.ready && !initial.sandbox && initial.mode === 'title' && initial.loaderGone && initial.button) break;
    } catch {}
  }
  if (!(initial?.started && initial.ready && !initial.sandbox && initial.mode === 'title' && initial.loaderGone && initial.button)) throw new Error(`Timed out waiting for title page: ${JSON.stringify(initial)}`);
  const button = initial.button;
  if (mobile) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 7, x: button.x * (touchCss ? 1 : viewport.deviceScaleFactor), y: button.y * (touchCss ? 1 : viewport.deviceScaleFactor), radiusX: 1, radiusY: 1, force: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: button.x + button.width / 2, y: button.y + button.height / 2, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: button.x + button.width / 2, y: button.y + button.height / 2, button: 'left', clickCount: 1 });
  }
  const sandboxDeadline = Date.now() + 30000;
  while (Date.now() < sandboxDeadline) {
    await sleep(250);
    try {
      initial = await page.evaluate(`(()=>({started:!!window.__game,ready:!!window.__m3dFirstFrameAt,sandbox:window.__game?.game?.sandbox===true,mode:window.__game?.game?.mode,loaderGone:!!document.querySelector('#loader.gone')}))()`);
      if (initial.started && initial.ready && initial.sandbox && initial.mode === 'play' && initial.loaderGone) break;
    } catch {}
  }
  if (!(initial?.started && initial.ready && initial.sandbox && initial.mode === 'play' && initial.loaderGone)) throw new Error(`Timed out waiting for live sandbox: ${JSON.stringify(initial)}`);
  if (timing) await page.evaluate(`(()=>{const r=window.__game?.renderer;if(!r||r.__diagWrapped)return;const o=r.render.bind(r);window.__renderTimes=[];r.render=(...a)=>{const t=performance.now();const v=o(...a);window.__renderTimes.push(performance.now()-t);return v};r.__diagWrapped=true})()`);
  if (halfPixel) await page.evaluate(`(()=>{const r=window.__game?.renderer;if(r){r.setPixelRatio(0.5);r.setSize(innerWidth,innerHeight,false)} return r?.getPixelRatio?.()})()`);
  if (noShadows) await page.evaluate(`(()=>{const r=window.__game?.renderer;if(r?.shadowMap) r.shadowMap.enabled=false; return !!r?.shadowMap&&!r.shadowMap.enabled})()`);
  await page.evaluate(`(()=>{window.__diagSamples={idle:[],movement:[]};window.__diagPhase='idle';let last=null;function tick(t){if(last!==null){const dt=t-last;if(window.__diagPhase)window.__diagSamples[window.__diagPhase].push({dt,stats:window.__m3dLastMainRenderStats||null,pos:window.__game?.controller?.position?{x:window.__game.controller.position.x,y:window.__game.controller.position.y,z:window.__game.controller.position.z}:null,mode:window.__game?.game?.mode,visibility:document.visibilityState})}last=t;requestAnimationFrame(tick)}requestAnimationFrame(tick)})()`);
  const snapshot = async (name) => {
    const ev = await page.evaluate(`(()=>{const c=document.querySelector('#scene'),r=window.__game?.renderer,s=window.__game?.rendererStatus?.(),a=window.__boot?.gpuProbe?.adapter;let adapterInfo=null;try{adapterInfo=a?.info||null}catch{}return {backend:s?.backend||null,rendererStatus:s||null,webgpu:{available:!!navigator.gpu,bootProbeOk:window.__boot?.gpuOk===true,adapter:adapterInfo},viewport:{css:[innerWidth,innerHeight],devicePixelRatio,emulatedMobile:${mobile},coarsePointer:matchMedia('(pointer: coarse)').matches,maxTouchPoints:navigator.maxTouchPoints||0},canvas:{css:[c?.clientWidth||0,c?.clientHeight||0],drawingBuffer:[c?.width||0,c?.height||0],rendererPixelRatio:r?.getPixelRatio?.()||null},mainRenderStats:window.__m3dLastMainRenderStats||null,camera:{x:window.__game?.camera?.position?.x,y:window.__game?.camera?.position?.y,z:window.__game?.camera?.position?.z},controller:{x:window.__game?.controller?.position?.x,y:window.__game?.controller?.position?.y,z:window.__game?.controller?.position?.z,grounded:window.__game?.controller?.grounded},mode:window.__game?.game?.mode,sandbox:window.__game?.game?.sandbox===true,activeTier:window.__VERDANT_ACTIVE_TIER__||null,firstFrameAt:window.__m3dFirstFrameAt,visible:document.visibilityState}})()`);
    const shot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 45000);
    const file = `scene-${name}.png`; fs.writeFileSync(path.join(output, 'screenshots', file), Buffer.from(shot.data, 'base64'));
    return { ...ev, screenshot: `screenshots/${file}` };
  };
  const idleStart = Date.now(); await sleep(8000); const idle = await snapshot('idle');
  await page.evaluate("window.__diagPhase='movement'");
  let inputEvidence;
  if (!mobile && !touchOnly) {
    await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 }); inputEvidence = { input: 'CDP KeyW down' };
  } else {
    const center = await page.evaluate(`(()=>{const r=document.querySelector('#touchJoystick')?.getBoundingClientRect();return r?{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}:null})()`);
    if (!center) throw new Error('Touch joystick is missing');
    const scale = touchCss ? 1 : viewport.deviceScaleFactor;
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: center.x * scale, y: center.y * scale, radiusX: 1, radiusY: 1, force: 1 }] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: center.x * scale, y: (center.y - center.h * 0.7) * scale, radiusX: 1, radiusY: 1, force: 1 }] });
    inputEvidence = { input: 'CDP touch joystick forward', coordinateMode: touchCss ? 'CSS' : 'device-pixels', cssCenter: center, deviceScaleFactor: scale };
  }
  const movementStart = Date.now();
  let keepTouch = null;
  if (mobile) { keepTouch = setInterval(() => { page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: inputEvidence.cssCenter.x * (touchCss ? 1 : viewport.deviceScaleFactor), y: (inputEvidence.cssCenter.y - inputEvidence.cssCenter.h * 0.7) * (touchCss ? 1 : viewport.deviceScaleFactor), radiusX: 1, radiusY: 1, force: 1 }] }).catch(() => {}); }, 100); }
  await sleep(10000);
  if (keepTouch) clearInterval(keepTouch);
  const movement = await snapshot('movement');
  if (!mobile && !touchOnly) await page.send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
  else await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.evaluate("window.__diagPhase=null");
  const sampleData = await page.evaluate(`(()=>({idle:window.__diagSamples?.idle||[],movement:window.__diagSamples?.movement||[]}))()`);
  const summary = (rows) => { const dts=rows.map((x)=>x.dt).filter(Number.isFinite); const mean=dts.length?dts.reduce((a,b)=>a+b,0)/dts.length:0; const sorted=[...dts].sort((a,b)=>a-b); const p=(q)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(q*(sorted.length-1)))]:null; return {samples:dts.length,meanDtMs:mean,p50DtMs:p(.5),p95DtMs:p(.95),maxDtMs:dts.length?Math.max(...dts):null,averageFps:mean?1000/mean:0,trianglesObserved:[...new Set(rows.map((x)=>x.stats?.triangles).filter(Number.isFinite))],positionStart:rows[0]?.pos||null,positionEnd:rows.at(-1)?.pos||null}; };
  const cdpGpu = await page.send('SystemInfo.getInfo').catch(() => null);
  const renderTiming = await page.evaluate(`window.__renderTimes||[]`);
  const result = { task: 'm3d-20261030-dev-e2e-driven-fixes', capturedAt: new Date().toISOString(), command: `node tools/dev-diagnostics/probe.mjs --${backend}${mobile ? ' --mobile' : ''}${touchCss ? ' --touch-css' : ''} --output=${path.relative(process.cwd(), output)}`, chrome: version.Browser, url, requestedBackend: backend, viewport, inputEvidence, firstFrameAndBoot: initial, idleWallMs: Date.now() - idleStart, movementWallMs: Date.now() - movementStart, renderTiming, idle, movement, frameRate: { idle: summary(sampleData.idle), movement: summary(sampleData.movement) }, cdpGpu, consoleEvents };
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ output, requestedBackend: backend, selectedBackend: movement.backend, viewport: movement.viewport, canvas: movement.canvas, gpu: movement.webgpu, triangles: movement.mainRenderStats?.triangles, idleFps: result.frameRate.idle.averageFps, movementFps: result.frameRate.movement.averageFps, movementSamples: result.frameRate.movement.samples, consoleErrors: consoleEvents.filter((x) => ['error','exception','log-error'].includes(x.type)).length, screenshot: movement.screenshot }, null, 2));
} finally {
  if (off.listener) browser?.listen && off.listener();
  try { if (browser && targetId) await browser.send('Target.closeTarget', { targetId }, undefined, 3000); } catch {}
  try { await browser?.send('Browser.close', {}, undefined, 3000); } catch {}
  browser?.close();
  if (chrome.pid) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch {} await sleep(400); try { process.kill(-chrome.pid, 'SIGKILL'); } catch {} }
  const remaining = chromePidsForProfile(profile); if (remaining.length) for (const pid of remaining) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  try { server.closeAllConnections?.(); } catch {}
  await new Promise((resolve) => server.close(() => resolve()));
}
