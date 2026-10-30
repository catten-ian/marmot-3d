// Strict difficulty QA for beta SmartFox pounce.
// Rule: no teleporting the fox, no repositioning the player. The player stands still
// and takes hits for 90 seconds; we measure REAL player HP loss, pounce commits,
// landed strikes and whiffs. Difficulty = can the fox actually threaten the player.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261030-smartfox-difficulty-qa');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 8341, CDP = 'http://127.0.0.1:18800';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.glb': 'model/gltf-binary', '.spz': 'application/octet-stream' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]); if (rel === '/') rel = '/index.html';
  const f = path.join(ROOT, path.normalize(rel).replace(/^([.][.][/\\])+/, ''));
  if (!f.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(f, (e, d) => { if (e) return res.writeHead(404).end(); res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(d); });
});
const wait = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${PORT}/index.html?version=beta&sandbox=1&webgl=1&qaDiff=${Date.now()}`;
  const tab = await fetch(`${CDP}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).then(r => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.text || 'exception');
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 200));
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(Error('timeout ' + method)); } }, 90000); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '')); return r.result?.value; };
  const shot = async n => { const x = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(x.data, 'base64')); };

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: URL });
  for (let i = 0; i < 90 && !await ev('!!window.__game'); i++) await wait(500);
  for (let i = 0; i < 40 && !await ev('!!(window.__game.game.sandbox && window.__game.game.mode==="play")'); i++) await wait(500);

  const renderer = await ev(`(()=>{const r=window.__game.renderer,gl=r.getContext(),e=gl.getExtension('WEBGL_debug_renderer_info');return {backend:gl instanceof WebGL2RenderingContext?'WebGL2':'WebGL1',renderer:e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}})()`);
  // Health probe: prove the measurement environment is not CPU-starved, otherwise
  // every gameplay number below would be an artefact of a starved browser.
  await ev(`(()=>{window.__fpsInfo={frames:0,t0:performance.now()};const t=()=>{window.__fpsInfo.frames++;requestAnimationFrame(t)};requestAnimationFrame(t);return true})()`);
  await wait(6000);
  await ev(`(()=>{const f=window.__fpsInfo;f.fps=+(f.frames/((performance.now()-f.t0)/1000)).toFixed(2);f.wallSec=+((performance.now()-f.t0)/1000).toFixed(2);return true})()`);

  // Install a passive observer: it only READS state. It never moves the fox or the player.
  await ev(`(()=>{const g=window.__game;
    window.__dq={commits:[],hits:[],hpSeries:[],intentHist:{},minDist:1e9,strikes:0,whiffs:0,started:false};
    const p=g.game.player;
    const prevCommitted={};
    const tick=()=>{const gg=window.__game,pl=gg.game.player,fs=gg.foxes().filter(f=>f.type==='smart');
      for(const f of fs){
        const k=f.slot, c=!!f.pounceCommitted;
        if(c && !prevCommitted[k]){window.__dq.commits.push({slot:k,t:+gg.game.totalTime.toFixed(2),dist:+Math.hypot(f.x-pl.x,f.z-pl.z).toFixed(2),stage:f.pounceStage,intent:f.intent});}
        prevCommitted[k]=c;
        if(f.pounceStage==='strike'){window.__dq.strikes++;}
        const d=Math.hypot(f.x-pl.x,f.z-pl.z); if(d<window.__dq.minDist)window.__dq.minDist=+d.toFixed(3);
        const it=f.intent||'?'; window.__dq.intentHist[it]=(window.__dq.intentHist[it]||0)+1;
      }
      window.__dq.hpSeries.push(+pl.hp.toFixed(2));
      requestAnimationFrame(tick);};
    requestAnimationFrame(tick); return true;})()`);

  async function scenario(name, foxCount, seconds) {
    await ev(`(async()=>{const g=window.__game;
      document.querySelector('[data-sandbox-action="clearFoxes"]')?.click();
      await new Promise(r=>setTimeout(r,300));
      g.game.player.hp=100; g.game.player.invuln=0;
      for(let i=0;i<${foxCount};i++){document.querySelector('[data-sandbox-action="spawnSmart"]')?.click();await new Promise(r=>setTimeout(r,150));}
      window.__dq={commits:[],hits:[],hpSeries:[],intentHist:{},minDist:1e9,strikes:0,whiffs:0};
      return true;})()`);
    // Measure in GAME time, not wall time: dt is capped, so wall-clock seconds
    // understate how much gameplay actually elapsed.
    const gt0 = await ev('window.__game.game.totalTime');
    const deadline = gt0 + seconds;
    let guard = 0;
    const wallStart = Date.now();
    while (guard++ < 600 && Date.now() - wallStart < 180000) {
      const gt = await ev('window.__game.game.totalTime');
      const mode = await ev('window.__game.game.mode');
      if (gt >= deadline || mode !== 'play') break;
      await wait(1000);
      await ev(`(()=>{const g=window.__game,p=g.game.player;const hits=g.testLogs.filter(x=>x.type==='player-hit');const last=hits[hits.length-1];if(last)window.__dq.hits.push({hpAfter:last.details?.hpAfter,kind:last.details?.attackKind,foxType:last.details?.foxType});return true;})()`);
    }
    await shot(name);
    return await ev(`(()=>{const g=window.__game,p=g.game.player;
      const hpSeries=window.__dq.hpSeries||[];
      const fps=window.__fpsInfo||{};
      const hpMin=hpSeries.length?Math.min(...hpSeries):p.hp;
      const commits=window.__dq.commits||[];
      return {name:${JSON.stringify(name)},foxCount:${foxCount},seconds:${seconds},
        hpStart:hpSeries[0]??p.hp,hpEnd:+p.hp.toFixed(2),hpMin:+hpMin.toFixed(2),
        totalDamage:+((hpSeries[0]??p.hp)-hpMin).toFixed(2),
        fps,
        commits:commits.length,commitDetail:commits.slice(0,40),
        hitEvents:(window.__dq.hits||[]).length,
        intentHist:window.__dq.intentHist||{},
        minDist:window.__dq.minDist,
        foxes:g.foxes().filter(f=>f.type==='smart').map(f=>({slot:f.slot,intent:f.intent,state:f.state,stage:f.pounceStage,committed:f.pounceCommitted,stamina:+(f.stamina??0).toFixed(1),hp:+(f.hp??0).toFixed(1),dist:+Math.hypot(f.x-p.x,f.z-p.z).toFixed(2),approach:f._pounceApproach?{phase:f._pounceApproach.phase,ready:f._pounceApproach.ready,round:+(f._pounceApproach.ringRadius??0).toFixed(2)}:null}))};})()`);
  }

  const scenarioSeconds = Math.max(5, Number(process.env.QA_SECONDS) || 90);
  const single = await scenario(`single-fox-${scenarioSeconds}s`, 1, scenarioSeconds);
  const triple = await scenario(`three-fox-${scenarioSeconds}s`, 3, scenarioSeconds);

  // Mobile sanity: same build must not crash or overflow at 390x844 dpr3 touch cpu4x.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await wait(1000);
  await ev(`(async()=>{const g=window.__game;document.querySelector('[data-sandbox-action="clearFoxes"]')?.click();await new Promise(r=>setTimeout(r,300));document.querySelector('[data-sandbox-action="spawnSmart"]')?.click();await new Promise(r=>setTimeout(r,400));return true;})()`);
  await wait(12000);
  await shot('mobile-390x844-dpr3-cpu4x');
  const mobile = await ev(`(()=>({innerWidth,innerHeight,dpr:devicePixelRatio,touch:navigator.maxTouchPoints,scrollW:document.body.scrollWidth,scrollH:document.body.scrollHeight,smart:window.__game.foxes().filter(f=>f.type==='smart').length,hp:+window.__game.game.player.hp.toFixed(2)}))()`);

  const report = { generatedAt: new Date().toISOString(), url: URL, renderer, single, triple, mobile, errors };
  fs.writeFileSync(path.join(OUT, 'difficulty-qa.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ renderer, errors: errors.length, single: { hp: [single.hpStart, single.hpEnd], dmg: single.totalDamage, commits: single.commits, hits: single.hitEvents, minDist: single.minDist, intent: single.intentHist }, triple: { hp: [triple.hpStart, triple.hpEnd], dmg: triple.totalDamage, commits: triple.commits, hits: triple.hitEvents, minDist: triple.minDist }, mobile, errors: errors.slice(0, 5) }, null, 2));
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {}); ws.close(); server.close();
}
main().catch(e => { console.error(e); server.close(); process.exitCode = 1; });
