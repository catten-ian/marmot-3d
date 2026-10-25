/** Managed-Chrome beta sky QA. No Chrome process is spawned; all created tabs are closed. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'beta-gameplay-qa');
fs.mkdirSync(OUT, { recursive: true });
const CDP = 'http://127.0.0.1:18800';
const started = Date.now();
const deadline = setTimeout(() => { console.error('Hard 8-minute CDP cap reached'); process.exit(2); }, 480000);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]);
  // Local static QA has no account service; stub only guest issuance to avoid unrelated 404 noise.
  if (rel === '/marmot3d-beta/api/auth/guest') {
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify({token:'qa-local-guest',user:{id:'qa-local',name:'QA 游客',guest:true}})); return;
  }
  const file = path.resolve(ROOT, '.' + (rel === '/' ? '/index.html' : path.normalize(rel)));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
async function json(url, options) { const r = await fetch(url, options); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function newTab() {
  try { return await json(`${CDP}/json/new?about:blank`, { method: 'PUT' }); }
  catch (_) { return await json(`${CDP}/json/new?about:blank`); }
}
async function closeTab(id) { if (id) await fetch(`${CDP}/json/close/${id}`).catch(() => {}); }

async function run(port, fallback) {
  const target = await newTab();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const evidence = { fallback, targetId: target.id, assetResponses: [], errors: [], exceptions: [], expectedBlockedRequests: [] };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
    const timer = setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout ' + method)); } }, 20000);
    timer.unref();
  });
  ws.onmessage = ({ data }) => {
    const m = JSON.parse(data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result || {}); return; }
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('citrus_orchard')) evidence.assetResponses.push({ url: m.params.response.url, status: m.params.response.status, mimeType: m.params.response.mimeType });
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) (evidence.httpErrors ||= []).push({url:m.params.response.url,status:m.params.response.status});
    if (m.method === 'Runtime.exceptionThrown') evidence.exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') evidence.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') evidence.errors.push(m.params.entry.text);
    if (m.method === 'Fetch.requestPaused') {
      evidence.expectedBlockedRequests.push(m.params.request.url);
      send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Aborted' }).catch(() => {});
    }
  };
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  try {
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable'); await send('Page.enable');
    if (fallback) await send('Fetch.enable', { patterns: [{ urlPattern: '*citrus_orchard_road_puresky_1k.jpg*', requestStage: 'Request' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    const url = `http://127.0.0.1:${port}/index.html?version=beta&webgl=1&models=off&qa=sky-${fallback ? 'fallback' : 'loaded'}-${Date.now()}`;
    await send('Page.navigate', { url });
    let ready = false;
    for (let i = 0; i < 50; i++) { await wait(500); ready = await evaluate(`!!window.__game && ['${fallback ? 'fallback' : 'loaded'}'].includes(window.__game.sky.skyTextureStatus.state)`).catch(() => false); if (ready) break; }
    if (!ready) {
      evidence.diagnostic = await evaluate(`({url:location.href,title:document.title,body:document.body.innerText.slice(0,2000),game:!!window.__game,sky:window.__game?.sky?.skyTextureStatus})`).catch((e) => String(e));
      console.error(JSON.stringify(evidence, null, 2));
    }
    assert.ok(ready, `sky did not reach ${fallback ? 'fallback' : 'loaded'}`);
    await evaluate(`(() => { const g=window.__game; g.game.mode='play'; document.getElementById('overlay').hidden=true; g.controller.teleport(0,0,0); g.controller.yaw=0; g.controller.pitch=0.16; g.setViewMode(false); g.foxes().forEach(f=>f.warn.visible=false); return true; })()`);
    await wait(1500);
    evidence.state = await evaluate(`(() => { const g=window.__game,s=g.sky; return { beta:g.isBeta, status:s.skyTextureStatus, background:s.scene.background?.image?.src||null, domeVisible:s.dome.visible, backgroundRotation:s.scene.backgroundRotation.toArray(), renderer:g.renderer.constructor.name, stamina:g.game.player.stamina, fat:g.game.player.fat, mouth:g.game.player.mouth, energyAlias:g.game.player.energy, objective:document.getElementById('objective').innerText, energyLabel:g.game.isBeta?document.getElementById('energyText').parentElement.innerText:null }; })()`);
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    evidence.screenshot = path.join(OUT, fallback ? 'sky-fallback.png' : 'sky-citrus-loaded.png');
    fs.writeFileSync(evidence.screenshot, Buffer.from(shot.data, 'base64'));
    assert.equal(evidence.state.beta, true);
    if (fallback) { assert.equal(evidence.state.status.state, 'fallback'); assert.equal(evidence.state.background, null); assert.equal(evidence.state.domeVisible, true); assert.ok(evidence.expectedBlockedRequests.length > 0); }
    else {
      assert.equal(evidence.state.status.state, 'loaded'); assert.match(evidence.state.background, /citrus_orchard_road_puresky_1k\.jpg/); assert.equal(evidence.state.domeVisible, false);
      assert.ok(evidence.assetResponses.some((r) => r.status === 200)); assert.deepEqual(evidence.state.backgroundRotation.slice(0, 3), [0, 0, 0]);
      if (evidence.errors.length || evidence.exceptions.length) console.error(JSON.stringify(evidence,null,2));
      assert.deepEqual(evidence.errors, []); assert.deepEqual(evidence.exceptions, []);
    }
    return evidence;
  } finally { ws.close(); await closeTab(target.id); }
}

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const loaded = await run(port, false);
    const fallback = await run(port, true);
    const result = { elapsedSeconds: (Date.now() - started) / 1000, managedChrome: CDP, loaded, fallback };
    fs.writeFileSync(path.join(OUT, 'sky-browser-evidence.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    console.log('PASS beta sky HTTP 200/orientation/no console errors + fail-soft fallback');
  } finally { server.close(); clearTimeout(deadline); }
})().catch((e) => { console.error(e); server.close(); clearTimeout(deadline); process.exitCode = 1; });
