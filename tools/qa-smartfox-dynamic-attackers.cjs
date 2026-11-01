/** Real local Beta production smoke: dynamic SmartFox attackers, no main.js changes. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261030-beta-smartfox-team', 'headless', 'dynamic-attackers', 'changes-requested');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8359, CDP_PORT = 19359, BASE = `http://127.0.0.1:${PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.glb':'model/gltf-binary', '.spz':'application/octet-stream', '.mp3':'audio/mpeg', '.woff2':'font/woff2', '.ico':'image/x-icon' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, BASE); let rel = decodeURIComponent(u.pathname); if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type':MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' }); res.end(data); });
});
let chrome, ws, seq = 0; const pending = new Map(); const errors = [];
async function send(method, params = {}) { const id = ++seq; return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, 120000); pending.set(id, { resolve:(v) => { clearTimeout(timer); resolve(v); }, reject:(e) => { clearTimeout(timer); reject(e); } }); ws.send(JSON.stringify({ id, method, params })); }); }
async function ev(expression) { const r = await send('Runtime.evaluate', { expression, returnByValue:true, awaitPromise:true, userGesture:true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result?.value; }
async function until(expression, tries = 120) { for (let i = 0; i < tries; i++) { if (await ev(expression).catch(() => false)) return; await wait(250); } throw new Error(`not ready: ${expression}`); }
async function shot(name) { const r = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:false }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, 'base64')); }
async function main() {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const profile = path.join(OUT, '.chrome-dynamic-profile');
  chrome = spawn('/usr/bin/google-chrome', [`--remote-debugging-port=${CDP_PORT}`, '--remote-allow-origins=*', '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`, 'about:blank'], { stdio:'ignore' });
  let tabs;
  for (let i = 0; i < 100; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (tabs.length) break; } catch {} await wait(200); }
  if (!tabs?.length) throw new Error('Chrome CDP unavailable');
  const target = tabs.find((t) => t.type === 'page') || tabs[0]; ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ')); };
  await new Promise((r) => { ws.onopen = r; }); await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false });
  const summaries = [];
  for (const foxCount of [4, 8]) {
    const url = `${BASE}/index.html?version=beta&sandbox=1&test=1&webgl=1&dynamic=${Date.now()}`;
    await send('Page.navigate', { url }); await until('!!window.__game'); await until('window.__game.game.sandbox===true&&window.__game.game.mode==="play"');
    const result = await ev(`(() => {
      const g=window.__game; g.qaPaused=true; document.querySelector('[data-sandbox-action="clearFoxes"]')?.click();
      const dt=1/60, press=(code)=>window.dispatchEvent(new KeyboardEvent('keydown',{code,bubbles:true})), release=(code)=>window.dispatchEvent(new KeyboardEvent('keyup',{code,bubbles:true}));
      // Normal production locomotion only: leave the burrow exclusion zone; no
      // teleport, HP writes, forced commits, frozen AI or relaxed hit volumes.
      press('KeyD'); for(let i=0;i<180;i++)g.qaStep(dt); release('KeyD');
      press('KeyW'); let setupSteps=0; while(g.controller.position.x < -30 && setupSteps<18*60){g.qaStep(dt);setupSteps++;} release('KeyW');
      // Spawn the whole measured group before advancing combat. Earlier versions
      // let the first foxes fight during 1.5 s turns, invalidating hpBefore.
      for(let i=0;i<${foxCount};i++)document.querySelector('[data-sandbox-action="spawnSmart"]')?.click();
      const p=g.game.player,foxes=g.foxes().filter(f=>f.type==='smart'),hpBefore=p.hp,maxHp=p.maxHp??100,startMode=g.game.mode,godMode=!!g.testState.godMode;
      const previous=new Map(foxes.map(f=>[f.slot,{commit:false,strike:false,melee:false,contactCd:f.contactCd||0}]));const events=[];let peakConcurrentPounces=0,peakAttackRoles=0,hitLogCursor=g.testLogs.length;
      for(let tick=0;tick<6*60 && g.game.mode==='play';tick++){
        g.qaStep(dt);const frameHits=g.testLogs.slice(hitLogCursor).filter(e=>e.type==='player-hit');hitLogCursor=g.testLogs.length;
        peakConcurrentPounces=Math.max(peakConcurrentPounces,foxes.filter(f=>f.alive!==false&&f.pounceCommitted).length);peakAttackRoles=Math.max(peakAttackRoles,foxes.filter(f=>f._role==='striker'||f._role==='flanker').length);
        for(const f of foxes){const prev=previous.get(f.slot),commit=!!f.pounceCommitted,strike=!!f.pounceStriking,melee=!!f.meleeStriking,contactCd=f.contactCd||0;if(commit&&!prev.commit)events.push({t:+g.game.totalTime.toFixed(3),type:'commit',slot:f.slot,role:f._role});if(strike&&!prev.strike)events.push({t:+g.game.totalTime.toFixed(3),type:'pounceStrike',slot:f.slot,role:f._role});if(melee&&!prev.melee)events.push({t:+g.game.totalTime.toFixed(3),type:'meleeStrike',slot:f.slot,role:f._role});
          // main.js sets this fox's contactCd only after its real contactHit.
          // Correlate that jump with the same production frame's player-hit log.
          if(contactCd>prev.contactCd+.5&&frameHits.length){const hit=frameHits.shift();events.push({t:+g.game.totalTime.toFixed(3),type:'hit',slot:f.slot,attackKind:hit.details.attackKind,damage:hit.details.damage,hpBefore:hit.details.hpBefore,hpAfter:hit.details.hpAfter,preventedByGodMode:hit.details.preventedByGodMode});}
          previous.set(f.slot,{commit,strike,melee,contactCd});}
      }
      // Keep the measured end state paused for the matching screenshot; the
      // next navigation resets the sandbox. Do not let wall-clock frames add
      // unrecorded hits between the JSON snapshot and its PNG.
      const commits=events.filter(e=>e.type==='commit'),pounceStrikes=events.filter(e=>e.type==='pounceStrike'),meleeStrikes=events.filter(e=>e.type==='meleeStrike'),hitEvents=events.filter(e=>e.type==='hit');
      let peakWindowCommits=0;for(const e of commits)peakWindowCommits=Math.max(peakWindowCommits,commits.filter(c=>Math.abs(c.t-e.t)<1.2).length);
      const realAttackers=[...new Set(events.filter(e=>['commit','pounceStrike','meleeStrike'].includes(e.type)).map(e=>e.slot))];
      const perFox=foxes.map(f=>({slot:f.slot,commits:commits.filter(e=>e.slot===f.slot).length,pounceStrikes:pounceStrikes.filter(e=>e.slot===f.slot).length,meleeStrikes:meleeStrikes.filter(e=>e.slot===f.slot).length,hits:hitEvents.filter(e=>e.slot===f.slot).length,hp:f.hp,maxHp:f.maxHp,stamina:f.stamina,maxStamina:f.maxStamina,state:f.state,role:f._role,dead:!!f.dead,retreating:!!f.retreating}));
      return {foxCount:${foxCount},setupSteps,packDynamic:!!g.sandboxState.smartPack.dynamicAttackers,hpBefore,maxHp,hpAfter:p.hp,startMode,gameMode:g.game.mode,godMode,realAttackers,committers:[...new Set(commits.map(e=>e.slot))],pounceStrikers:[...new Set(pounceStrikes.map(e=>e.slot))],meleeStrikers:[...new Set(meleeStrikes.map(e=>e.slot))],hitters:[...new Set(hitEvents.map(e=>e.slot))],hitEvents,peakConcurrentPounces,peakAttackRoles,peakWindowCommits,events,perFox,foxes:perFox};
    })()`);
    result.consoleErrors = errors.slice(); result.assertions = { validFullHpLivingStart:result.hpBefore===result.maxHp&&result.hpBefore>0&&result.startMode==='play'&&!result.godMode, productionPackDynamic:result.packDynamic, moreThanTwoRealAttackers:result.realAttackers.length > 2, realProductionHit:result.hitEvents.length>0&&result.hitEvents.some(e=>!e.preventedByGodMode&&e.hpAfter<e.hpBefore), consoleErrorZero:errors.length === 0 };
    result.renderer = await ev(`(()=>{const r=window.__game.renderer,gl=r.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {backend:r.constructor.name,version:gl.getParameter(gl.VERSION),renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};})()`);
    result.softwareRendering = /swiftshader|llvmpipe|software/i.test(JSON.stringify(result.renderer));
    fs.writeFileSync(path.join(OUT, `browser-${foxCount}fox.json`), JSON.stringify(result, null, 2)); await shot(`browser-${foxCount}fox`); summaries.push(result);
  }
  fs.writeFileSync(path.join(OUT, 'browser-commands.txt'), 'node tools/qa-smartfox-dynamic-attackers.cjs\n# Local-only static server; Beta sandbox; /usr/bin/google-chrome headless with SwiftShader.\n');
  console.log(JSON.stringify(summaries.map((r) => ({ foxCount:r.foxCount, realAttackers:r.realAttackers, committers:r.committers, pounceStrikers:r.pounceStrikers, meleeStrikers:r.meleeStrikers, peakWindowCommits:r.peakWindowCommits, hitEvents:r.hitEvents, hp:[r.hpBefore,r.hpAfter], renderer:r.renderer, assertions:r.assertions })), null, 2));
  if (summaries.some((r) => Object.values(r.assertions).some((v) => !v))) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { try { ws?.close(); } catch {} if (chrome) { chrome.kill('SIGTERM'); await new Promise((resolve) => { if (chrome.exitCode !== null || chrome.signalCode) return resolve(); const timer=setTimeout(resolve,2000); chrome.once('exit',()=>{clearTimeout(timer);resolve();}); }); } await new Promise((r) => server.close(r)); try { fs.rmSync(path.join(OUT, '.chrome-dynamic-profile'), { recursive:true, force:true, maxRetries:5, retryDelay:100 }); } catch {} });
