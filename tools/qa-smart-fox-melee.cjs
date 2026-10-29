/* Real Chrome/WebGL acceptance for the beta SmartFox melee action. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261029-beta-smartfox-melee');
const PORT = 8700;
const CDP = 'http://127.0.0.1:18800';
const URL = `http://127.0.0.1:${PORT}/index.html?version=beta&sandbox=1&test=1&webgl=1&qaMelee=${Date.now()}`;
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.spz': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  if (rel === '/api/configs/active') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); return; }
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = { generatedAt: new Date().toISOString(), target: URL, desktop: {}, mobile: {}, errors: [] };

async function main() {
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const created = await fetch(`${CDP}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then((r) => r.json());
  const ws = new WebSocket(created.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      report.errors.push({ kind: 'exception', text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text });
    } else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      report.errors.push({ kind: 'console', text: message.params.args.map((a) => a.value ?? a.description).join(' ') });
    } else if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      report.errors.push({ kind: 'log', text: message.params.entry.text, url: message.params.entry.url || null });
    }
  };
  await new Promise((resolve) => { ws.onopen = resolve; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    ws.send(JSON.stringify({ id: callId, method, params }));
    setTimeout(() => { if (pending.has(callId)) { pending.delete(callId); reject(new Error(`timeout ${method}`)); } }, 60000);
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const until = async (expression, timeout = 15000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await evaluate(expression).catch(() => false)) return true;
      await wait(20);
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const screenshot = async (name) => {
    const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'));
  };
  const backend = () => evaluate(`(() => {
    const r=window.__game.renderer, gl=r.getContext(), ext=gl.getExtension('WEBGL_debug_renderer_info');
    return { backend: gl instanceof WebGL2RenderingContext ? 'WebGL2' : 'WebGL1',
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      version: gl.getParameter(gl.VERSION), three: r.constructor.name };
  })()`);
  const installCollector = () => evaluate(`(() => {
    const q=window.__meleeQA={ running:true, samples:[] };
    const tick=()=>{ const g=window.__game,f=g.foxes().find(x=>x.type==='smart'),p=g.game.player;
      if(f) q.samples.push({ at:+g.game.totalTime.toFixed(3), phase:f.meleePhase, state:f.state,
        hp:p.hp, distance:+Math.hypot(f.x-p.x,f.z-p.z).toFixed(3), committed:!!f.pounceCommitted,
        hitConsumed:!!f.meleeHitConsumed, warn:!!f.warn.visible, scaleY:+f.mesh.scale.y.toFixed(4),
        x:+f.x.toFixed(3), z:+f.z.toFixed(3) });
      if(q.running) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return true;
  })()`);
  const stopCollector = () => evaluate('window.__meleeQA.running=false; window.__meleeQA.samples');
  const setup = async () => {
    await until('!!window.__game && window.__game.game.sandbox && window.__game.game.mode==="play"', 45000);
    await wait(500);
    return evaluate(`(async()=>{ const g=window.__game;
      [...document.querySelectorAll('[data-sandbox-action]')].find(b=>b.dataset.sandboxAction==='clearFoxes')?.click();
      [...document.querySelectorAll('[data-sandbox-action]')].find(b=>b.dataset.sandboxAction==='spawnSmart')?.click();
      await new Promise(r=>setTimeout(r,100)); const f=g.foxes().find(x=>x.type==='smart'); if(!f) throw Error('SmartFox not spawned');
      g.controller.teleport(0,0,0); g.testState.godMode=false; g.sandboxState.godMode=false;
      g.game.player.hp=100; g.game.player.invuln=0; g.testLogs.length=0;
      g.setViewMode(false); return { foxes:g.foxes().length, smart:true, godMode:g.testState.godMode };
    })()`);
  };
  const placeNear = () => evaluate(`(()=>{ const g=window.__game,f=g.foxes().find(x=>x.type==='smart');
    g.controller.teleport(0,0,0);const v=new g.THREE.Vector3();g.controller.forwardFlat(v);
    f.x=v.x*1.2;f.z=v.z*1.2;f.yaw=Math.atan2(-f.x,-f.z);f._smartState.vx=0;f._smartState.vz=0;
    g.game.player.invuln=0; return true; })()`);

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  report.desktop.setup = await setup();
  report.desktop.backend = await backend();
  await installCollector(); await placeNear();
  await until('window.__game.foxes()[0].meleePhase==="windup"');
  report.desktop.windup = await evaluate(`(()=>{const g=window.__game,f=g.foxes()[0],point=f.mesh.position.clone();point.y+=.5;point.project(g.camera);
    return {phase:f.meleePhase,state:f.state,warn:f.warn.visible,fox:{x:f.x,z:f.z},player:{x:g.game.player.x,z:g.game.player.z},ndc:{x:point.x,y:point.y,z:point.z}};})()`);
  await screenshot('desktop-01-windup');
  await until('window.__game.foxes()[0].meleePhase==="strike"');
  report.desktop.strike = await evaluate('({phase:window.__game.foxes()[0].meleePhase,state:window.__game.foxes()[0].state,hp:window.__game.game.player.hp})');
  await screenshot('desktop-02-strike');
  await until('window.__game.foxes()[0].meleePhase==="recover"');
  report.desktop.recover = await evaluate('({phase:window.__game.foxes()[0].meleePhase,state:window.__game.foxes()[0].state,hp:window.__game.game.player.hp})');
  await screenshot('desktop-03-recover');
  await until('window.__game.testLogs.filter(x=>x.type==="player-hit"&&x.details.attackKind==="melee").length>=2', 15000);
  report.desktop.samples = await stopCollector();
  await screenshot('desktop-04-two-hits');

  // Start the control while the second action is recovering. A page-side rAF
  // observer moves the fox away only after a full no-hit action has completed.
  await evaluate(`(()=>{ const g=window.__game,f=g.foxes().find(x=>x.type==='smart'),p=g.game.player,v=new g.THREE.Vector3();
    g.controller.forwardFlat(v); f.x=p.x-v.x*2.4;f.z=p.z-v.z*2.4;f.yaw=Math.atan2(p.x-f.x,p.z-f.z);f._smartState.vx=0;f._smartState.vz=0;g.game.player.invuln=0;
    const q=window.__rangeQA={ done:false,startHp:g.game.player.hp,startHits:g.testLogs.filter(x=>x.type==='player-hit').length,phases:[] };
    const tick=()=>{ const phase=f.meleePhase; if(q.phases.at(-1)!==phase)q.phases.push(phase);
      if(phase==='strike')q.sawStrike=true;
      if(q.sawStrike&&phase==='recover')q.sawRecover=true;
      if(q.sawStrike&&q.sawRecover&&phase===null){ q.done=true;q.endHp=g.game.player.hp;
        q.endHits=g.testLogs.filter(x=>x.type==='player-hit').length;f.z=8;return; }
      requestAnimationFrame(tick); };requestAnimationFrame(tick);return true; })()`);
  await until('window.__rangeQA.done', 15000);
  report.desktop.rangeControl = await evaluate('window.__rangeQA');
  await screenshot('desktop-05-out-of-range');
  report.desktop.logs = await evaluate('window.__game.testLogs.filter(x=>x.type==="smart-melee-phase"||x.type==="player-hit")');
  report.desktop.finalSnapshot = await evaluate('window.__game.testSnapshot()');

  // Real touch emulation, DPR 3 and 4x CPU slowdown; no synthetic melee hits.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await send('Page.navigate', { url: `${URL}&mobile=1` });
  report.mobile.setup = await setup();
  report.mobile.backend = await backend();
  await installCollector(); await placeNear();
  await until('window.__game.testLogs.some(x=>x.type==="player-hit"&&x.details.attackKind==="melee")', 25000);
  await wait(500);
  report.mobile.samples = await stopCollector();
  report.mobile.hud = await evaluate(`(()=>{ const ids=['hudTop','hpText','hpBar','touchControls','touchJoystick'];
    const items=Object.fromEntries(ids.map(id=>{const el=document.getElementById(id),r=el?.getBoundingClientRect();return [id,{visible:!!el&&getComputedStyle(el).display!=='none',rect:r?{x:r.x,y:r.y,width:r.width,height:r.height}:null}]}));
    return { innerWidth,innerHeight,dpr:devicePixelRatio,maxTouchPoints:navigator.maxTouchPoints,
      bodyScrollWidth:document.body.scrollWidth,bodyScrollHeight:document.body.scrollHeight,items,
      effectiveInput:document.documentElement.dataset.inputEffective,hp:window.__game.game.player.hp,
      meleeHits:window.__game.testLogs.filter(x=>x.type==='player-hit'&&x.details.attackKind==='melee').length }; })()`);
  await screenshot('mobile-390x844-dpr3-cpu4x');
  await send('Emulation.setCPUThrottlingRate', { rate: 1 });

  const hits = report.desktop.logs.filter((x) => x.type === 'player-hit' && x.details.attackKind === 'melee');
  const starts = report.desktop.logs.filter((x) => x.type === 'smart-melee-phase' && x.details.to === 'windup');
  const firstTwoActionHits = starts.slice(0, 2).map((start) => {
    const end = report.desktop.logs.find((x) => x.type === 'smart-melee-phase' && x.details.to === 'recover' && x.elapsed >= start.elapsed);
    return hits.filter((hit) => hit.elapsed >= start.elapsed && hit.elapsed <= end.elapsed).length;
  });
  report.assertions = {
    desktopTwoRealMeleeHits: hits.length >= 2,
    oncePerAction: firstTwoActionHits.length === 2 && firstTwoActionHits.every((n) => n === 1),
    hpDecreasedTwice: hits.length >= 2 && hits[1].details.hpAfter < hits[0].details.hpAfter,
    visiblePhases: report.desktop.windup?.warn === true && report.desktop.strike?.state === 'dash' && report.desktop.recover?.state === 'rest',
    rangeControlNoDamage: report.desktop.rangeControl.startHp === report.desktop.rangeControl.endHp && report.desktop.rangeControl.startHits === report.desktop.rangeControl.endHits,
    rangeControlActed: report.desktop.rangeControl.phases.includes('windup') && report.desktop.rangeControl.phases.includes('strike') && report.desktop.rangeControl.phases.includes('recover'),
    mobileRealMeleeHit: report.mobile.hud.meleeHits >= 1,
    mobileHudBounds: report.mobile.hud.bodyScrollWidth <= 390 && report.mobile.hud.bodyScrollHeight <= 844 && report.mobile.hud.effectiveInput === 'touch',
    mobileTouchAndDpr: report.mobile.hud.maxTouchPoints >= 1 && report.mobile.hud.dpr === 3,
    noRuntimeErrors: report.errors.filter((x) => x.kind !== 'log').length === 0,
    noUnexpectedConsoleErrors: report.errors.filter((x) => x.kind !== 'log' || !(/marmot\.tos-cn-shanghai\.volces\.com\/audio\//.test(x.url || '') || /\/api\/auth\/guest$/.test(x.url || ''))).length === 0,
  };
  report.assertionDetails = { firstTwoActionHits };
  fs.writeFileSync(path.join(OUT, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ assertions: report.assertions, backend: report.desktop.backend, errors: report.errors, hits: hits.map((x) => x.details) }, null, 2));
  await fetch(`${CDP}/json/close/${created.id}`).catch(() => {});
  ws.close(); server.close();
  if (Object.values(report.assertions).some((value) => !value)) process.exitCode = 2;
}

main().catch((error) => {
  report.fatal = error.stack || String(error);
  fs.writeFileSync(path.join(OUT, 'browser-report.json'), JSON.stringify(report, null, 2));
  console.error(error); server.close(); process.exitCode = 1;
});
