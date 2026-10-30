// Render-independent SmartFox difficulty harness (v2).
// Why: the sandbox renders at ~1-6 FPS here (dt capped at 50 ms), so wall-clock
// observation advances game time far too slowly to judge AI behaviour.
// This drives fox.update() directly with a fixed dt and a motionless player,
// recording every commit/strike/damage event and the full commit gate each step.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261030-smartfox-difficulty-qa');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8357, CDP = process.env.QA_CDP || 'http://127.0.0.1:18888';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel === '/') rel = '/index.html';
  const f = path.join(ROOT, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!f.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(f, (e, d) => { if (e) return res.writeHead(404).end(); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d); });
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

async function main() {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${PORT}/index.html?version=beta&sandbox=1&webgl=1&ff=${Date.now()}`;
  const tab = await fetch(`${CDP}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200)); };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(Error('timeout ' + method)); } }, 120000); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  // Disable the HTTP cache: an ES-module cache would otherwise keep serving the
  // pre-fix code and silently invalidate every measurement.
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 480, height: 270, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 120 && !await ev('!!window.__game'); i++) await wait(500);
  for (let i = 0; i < 40 && !await ev('!!(window.__game.game.sandbox && window.__game.game.mode==="play")'); i++) await wait(500);

  const renderer = await ev(`(()=>{try{const r=window.__game.renderer,gl=r.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {backend:gl instanceof WebGL2RenderingContext?'WebGL2':'WebGL1',renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}}catch(e){return {error:String(e)}}})()`);

  const simSeconds = Math.max(1, Number(process.env.QA_SECONDS) || 20);
  const result = await ev(`(() => {
  try {
    const g = window.__game;
    document.querySelector('[data-sandbox-action="clearFoxes"]')?.click();
    // Freeze only the normal RAF-driven tick and walk the player out of the
    // title/sandbox base's exclusion radius using the production keyboard input
    // and update path. This changes position through normal locomotion; no
    // actor is teleported and no fox is spawned closer than its normal 9m ring.
    g.qaPaused = true;
    const p = g.game.player, dt = 1 / 60;
    const press = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    const release = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    press('KeyD');
    for (let j = 0; j < 180; j++) g.qaStep(dt);
    release('KeyD');
    press('KeyW');
    let setupSteps = 0;
    while (g.controller.position.x < -30 && setupSteps < 18 * 60) { g.qaStep(dt); setupSteps++; }
    release('KeyW');
    const setup = { steps: setupSteps, gameTime: +g.game.totalTime.toFixed(3), playerX: +g.controller.position.x.toFixed(3), playerZ: +g.controller.position.z.toFixed(3) };
    const foxCount = Math.max(1, ${Math.max(1, Number(process.env.QA_FOXES) || 1)});
    for (let i = 0; i < foxCount; i++) {
      document.querySelector('[data-sandbox-action="spawnSmart"]')?.click();
      if (i + 1 < foxCount) {
        const turnRight = g.binds.turnMap?.right || g.binds.turnMap?.rightAlt;
        if (turnRight) { press(turnRight); for (let j = 0; j < 90; j++) g.qaStep(dt); release(turnRight); }
        else for (let j = 0; j < 90; j++) g.qaStep(dt);
      }
    }
    const foxes = g.foxes().filter(f => f.type === 'smart');
    const N = Math.ceil(${simSeconds} / dt);
    p.hp = ${Math.max(1, Number(process.env.QA_HP) || 100)}; p.invuln = 0;
    const hpBefore = p.hp, gameTimeBefore = g.game.totalTime, hitsBefore = g.game.hits || 0;
    const start = { player: { x:p.x, z:p.z, controllerX:g.controller.position.x, controllerZ:g.controller.position.z }, foxes:foxes.map(f=>({slot:f.slot,x:f.x,z:f.z,yaw:f.yaw,distance:Math.hypot(f.x-p.x,f.z-p.z)})) };
    const stats = new Map(foxes.map(f => [f, { committed: !!f.pounceCommitted, striking: !!f.pounceStriking }]));
    const events = [], log = [];
    let minDist = Infinity, hpLast = p.hp;
    for (let i = 0; i < N && g.game.mode === 'play'; i++) {
      g.qaStep(dt);
      const now = g.game.totalTime;
      for (const f of foxes) {
        const prev = stats.get(f) || { committed: false, striking: false };
        const committed = !!f.pounceCommitted, striking = !!f.pounceStriking;
        const d = Math.hypot(f.x - p.x, f.z - p.z);
        const toP = Math.atan2(p.x - f.x, p.z - f.z);
        const angle = Math.abs(Math.atan2(Math.sin(toP - f.yaw), Math.cos(toP - f.yaw)));
        minDist = Math.min(minDist, d);
        if (committed && !prev.committed) events.push({ t: +now.toFixed(3), type: 'commit', slot: f.slot, role: f._role || null, distance: +d.toFixed(3), angle: +angle.toFixed(4), phase: f._pounceApproach?.phase || null });
        if (striking && !prev.striking) events.push({ t: +now.toFixed(3), type: 'strike', slot: f.slot, role: f._role || null, distance: +d.toFixed(3), hp: +p.hp.toFixed(2) });
        if (!committed && prev.committed) events.push({ t: +now.toFixed(3), type: 'commitEnd', slot: f.slot, distance: +d.toFixed(3), stage: f.pounceStage || null });
        stats.set(f, { committed, striking });
      }
      if (p.hp < hpLast - 1e-6) {
        events.push({ t: +now.toFixed(3), type: 'hit', hpBefore: +hpLast.toFixed(2), hpAfter: +p.hp.toFixed(2), gameHits: g.game.hits || 0 });
        hpLast = p.hp;
      }
      if (i % 30 === 0) log.push({ t: +now.toFixed(3), hp: +p.hp.toFixed(2), mode: g.game.mode,
        foxes: foxes.map(f => ({ slot: f.slot, role: f._role, intent: f.intent, stage: f.pounceStage, speed:f.speed, yaw:f.yaw,
          ground:f._groundSteer(p.x-f.x,p.z-f.z,1.5,g.burrows), distance: +Math.hypot(f.x-p.x,f.z-p.z).toFixed(3), angle: +Math.abs(Math.atan2(Math.sin(Math.atan2(p.x-f.x,p.z-f.z)-f.yaw),Math.cos(Math.atan2(p.x-f.x,p.z-f.z)-f.yaw))).toFixed(3) })) });
    }
    g.qaPaused = false;
    const roleCounts = foxes.reduce((a, f) => { const key = f._role || 'unknown'; a[key] = (a[key] || 0) + 1; return a; }, {});
    return { ok: true, gameTimeBefore: +gameTimeBefore.toFixed(3), gameTimeAfter: +g.game.totalTime.toFixed(3),
      gameTimeAdvanced: +(g.game.totalTime-gameTimeBefore).toFixed(3), hpBefore, hpAfter: +p.hp.toFixed(2),
      setup, start, gameHitsBefore: hitsBefore, gameHitsAfter: g.game.hits || 0, hitEvents: events.filter(e=>e.type==='hit').length,
      minDist: Number.isFinite(minDist) ? +minDist.toFixed(3) : null, events, log, roleCounts,
      finalMode: g.game.mode, foxes: foxes.map(f => ({slot:f.slot,role:f._role,intent:f.intent,stage:f.pounceStage,
        committed:!!f.pounceCommitted,stamina:+(f.stamina||0).toFixed(1),distance:+Math.hypot(f.x-p.x,f.z-p.z).toFixed(3),
        approach:f._pounceApproach?{phase:f._pounceApproach.phase,ready:!!f._pounceApproach.ready}:null})) };
  } catch (e) { window.__game.qaPaused = false; return { error: String(e && e.stack ? e.stack : e).slice(0, 600) }; }
})()`);

  fs.writeFileSync(path.join(OUT, 'fastforward.json'), JSON.stringify({ renderer, ...result }, null, 2));
  const summary = { renderer, errors: errors.length, ok: result.ok, error: result.error, gameTime: [result.gameTimeBefore, result.gameTimeAfter], gameTimeAdvanced: result.gameTimeAdvanced, minDist: result.minDist, commits: (result.events || []).filter(e => e.type === 'commit').length, strikes: (result.events || []).filter(e => e.type === 'strike').length, hp: [result.hpBefore, result.hpAfter], hitEvents: result.hitEvents, gameHits: [result.gameHitsBefore, result.gameHitsAfter], roleCounts: result.roleCounts, events: (result.events || []).slice(0, 25), final: result.foxes };
  console.log('--- sampled production game frames');
  console.log(JSON.stringify(result.log || [], null, 2));
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {}); ws.close(); server.close();
}
main().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
