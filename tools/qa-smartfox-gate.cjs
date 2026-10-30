// Pinpoint why beta SmartFox never commits a pounce.
// Prints EVERY gate of the commit condition each sample, from inside the real game loop.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261030-smartfox-difficulty-qa');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8351, CDP = 'http://127.0.0.1:18800';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel === '/') rel = '/index.html';
  const f = path.join(ROOT, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!f.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(f, (e, d) => { if (e) return res.writeHead(404).end(); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d); });
});
const wait = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${PORT}/index.html?version=beta&sandbox=1&webgl=1&gate=${Date.now()}`;
  const tab = await fetch(`${CDP}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ({ data }) => { const m = JSON.parse(data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200)); };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(Error('timeout ' + method)); } }, 60000); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 90 && !await ev('!!window.__game'); i++) await wait(500);
  for (let i = 0; i < 40 && !await ev('!!(window.__game.game.sandbox && window.__game.game.mode==="play")'); i++) await wait(500);

  // Put the player in open ground (not against the map edge) so we measure AI, not clamping.
  await ev(`(async()=>{const g=window.__game;
    document.querySelector('[data-sandbox-action="clearFoxes"]')?.click();
    await new Promise(r=>setTimeout(r,300));
    g.controller.teleport(0,0,0);
    await new Promise(r=>setTimeout(r,300));
    document.querySelector('[data-sandbox-action="spawnSmart"]')?.click();
    await new Promise(r=>setTimeout(r,500));
    g.game.player.hp=100;
    return true;})()`);

  // Sample every animation frame with the full commit gate decomposed.
  // Sample at 4 Hz with compact tuples only. A per-frame object dump made the
  // page unresponsive and caused the CDP evaluate to time out.
  await ev(`(()=>{const g=window.__game;
    window.__gate=[];
    window.__gtimer=setInterval(()=>{const gg=window.__game,p=gg.game.player,fs=gg.foxes().filter(f=>f.type==='smart');
      for(const f of fs){
        const s=f._smartState||{},ap=f._pounceApproach||{};
        const dx=p.x-f.x,dz=p.z-f.z,d=Math.hypot(dx,dz);
        const toP=Math.atan2(dx,dz);
        const ang=Math.abs(Math.atan2(Math.sin(toP-f.yaw),Math.cos(toP-f.yaw)));
        window.__gate.push([
          +gg.game.totalTime.toFixed(2), +d.toFixed(2), +ang.toFixed(3),
          f.intent, ap.phase, ap.ready?1:0,
          +(s.windupRemaining??-1).toFixed(3), +(s.pounceCooldown??-1).toFixed(2),
          f._role||'-', +f._age.toFixed(1), +(f._cautiousUntil??-1).toFixed(1),
          +(f._recoverLock??0).toFixed(2), +f.stamina.toFixed(0), f.staminaLocked?1:0,
          +(f._evadeUntil??0).toFixed(2), f.pounceCommitted?1:0, +f.speed.toFixed(2),
        ]);
      }
    }, 250);
    return true})()`);

  const t0 = Date.now();
  while (Date.now() - t0 < 120000) { await wait(3000); }
  const data = await ev(`(()=>{clearInterval(window.__gtimer);return {gate:window.__gate.slice(-300), total:window.__gate.length}})()`);
  fs.writeFileSync(path.join(OUT, 'gate-trace.json'), JSON.stringify(data, null, 2));
  const g = data.gate || [];
  console.log('samples:', data.total);
  console.log('t\td\tang\tintent\tphase\tready\twindup\tcd\trole\tage\tcaut\tlock\tstam\tsLock\tevade\tcomm\tspeed');
  for (const s of g.filter((_, i) => i % 4 === 0).slice(0, 60)) console.log(s.join('\t'));
  console.log('errors:', errors.length);
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {}); ws.close(); server.close();
}
main().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
