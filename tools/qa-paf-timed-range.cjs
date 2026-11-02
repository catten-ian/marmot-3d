const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs', 'm3d-20261025-beta-paf-improve');
const PORT = Number(process.env.PAF_TIMED_QA_PORT || 8397);
const CDP_PORT = Number(process.env.PAF_TIMED_QA_CDP_PORT || 9497);
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
fs.mkdirSync(OUT, { recursive: true });
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end('Forbidden');
  fs.readFile(file, (error, data) => {
    if (error) return res.writeHead(404).end('404');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const report = { startedAt: new Date().toISOString(), cdp: { endpoint: `http://127.0.0.1:${CDP_PORT}`, private: true }, renderer: {}, scenarios: {}, screenshots: [], consoleErrors: [], exceptions: [], checks: {} };
let chrome; let ws; let send; let seq = 0; let target;
function check(name, value, detail = '') { report.checks[name] = { pass: !!value, detail }; if (!value) throw new Error(`${name}: ${detail}`); }
async function json(url) { const res = await fetch(url); return res.json(); }
async function evalJs(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 55000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  return result.result.value;
}
async function screenshot(name) {
  const image = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(image.data, 'base64'));
  report.screenshots.push(`${name}.png`);
}
async function waitFor(expression, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evalJs(expression).catch(() => false)) return true; await wait(250); }
  return false;
}
async function viewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}
async function navigate(mobile, suffix = '') {
  await viewport(mobile ? 390 : 1280, mobile ? 844 : 720, mobile);
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html?version=beta&webgl=1&play-as-fox=1&pafqa=1&timedqa=${Date.now()}${suffix}` });
  check('boot', await waitFor('!!window.__enterPlayAsFox', 30000));
  await evalJs('window.__enterPlayAsFox()');
  check('paf-entry', await waitFor('!!window.__playAsFox?.active', 20000));
  await wait(500);
}
async function mouseClick(selector) {
  const rect = await evalJs(`(() => { const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', buttons: 0, clickCount: 1 });
}
async function touch(type, x, y, id = 41) {
  const touchPoints = type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id, radiusX: 1, radiusY: 1, force: 1 }];
  await send('Input.dispatchTouchEvent', { type, touchPoints });
}

(async () => {
  try {
    await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'paf-timed-qa-'));
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu-blocklist', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, '--no-first-run', '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { target = (await json(`http://127.0.0.1:${CDP_PORT}/json/list`)).find((item) => item.type === 'page'); } catch (_) {} if (target) break; await wait(250); }
  if (!target) throw new Error('private Chrome target unavailable');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result); return; }
    if (message.method === 'Runtime.exceptionThrown') report.exceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'exception');
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') report.consoleErrors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' '));
  });
  send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 60000); });
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');

  await navigate(false);
  report.renderer = await evalJs(`(() => { const r=window.__game?.renderer; const gl=r?.getContext?.(); return { renderer:r?.constructor?.name, context:gl?.constructor?.name, webgl2:!!gl?.texStorage2D, vendor:gl?.getParameter?.(gl.VENDOR), rendererString:gl?.getParameter?.(gl.RENDERER) }; })()`);
  await evalJs('window.__playAsFox.toggleView()');
  check('desktop-fpv', await evalJs('window.__playAsFox.viewMode') === 'fpv');
  await evalJs('window.__playAsFox.toggleView()');
  check('desktop-tps', await evalJs('window.__playAsFox.viewMode') === 'tps');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  const defaultRange = await evalJs('window.__playAsFox.pounceRange');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 33 });
  const extendedRange = await evalJs('window.__playAsFox.pounceRange');
  check('desktop-keyboard-range', extendedRange > defaultRange, `${defaultRange} -> ${extendedRange}`);
  check('desktop-preview-visible', await evalJs('window.__playAsFox.preview.active'));
  await screenshot('07-desktop-range-preview');
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
  report.scenarios.desktop = { defaultRange, extendedRange, phaseAfterRelease: await evalJs('window.__playAsFox.phase'), viewMode: await evalJs('window.__playAsFox.viewMode') };

  await navigate(true, '&touch=1');
  const attackRect = await evalJs(`(() => { const r=document.querySelector('[data-touch-action="attack"]').getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  await touch('touchStart', attackRect.x, attackRect.y);
  const touchBase = await evalJs('window.__playAsFox.pounceRange');
  await touch('touchMove', attackRect.x, attackRect.y - 100);
  const touchExtended = await evalJs('window.__playAsFox.pounceRange');
  check('touch-drag-range', touchExtended > touchBase, `${touchBase} -> ${touchExtended}`);
  check('touch-preview-visible', await evalJs('window.__playAsFox.preview.active'));
  await screenshot('08-touch-range-release');
  await touch('touchEnd', attackRect.x, attackRect.y - 100);
  check('touch-release-lunge', await waitFor('window.__playAsFox.phase === "lunge"', 3000));
  report.scenarios.touch = { touchBase, touchExtended, phaseAfterRelease: await evalJs('window.__playAsFox.phase'), width: await evalJs('innerWidth'), height: await evalJs('innerHeight') };

  await navigate(false, '&timed=1');
  await mouseClick('#pafTimedStart');
  check('timed-start', await waitFor('window.__playAsFox.mode === "timed" && window.__playAsFox.timed.status === "running"', 3000));
  await screenshot('09-timed-start');
  const startState = await evalJs('window.__playAsFox.timed');
  // The product already exposes ?pafqa=1 -> __playAsFox.step(dt), so the full
  // 120-second round is advanced through the real PAF fixed-step update rather
  // than fabricating a score or writing leaderboard storage from the harness.
  await evalJs('for (let i = 0; i < 2400; i++) window.__playAsFox.step(0.05); true');
  const endState = await evalJs('({ timed:window.__playAsFox.timed, score:window.__playAsFox.score, resultVisible:!document.querySelector("#pafTimedResult").hidden, resultText:document.querySelector("#pafTimedResult")?.textContent || "" })');
  check('timed-exact-end', endState.timed.status === 'finished' && endState.timed.elapsedMs === 120000 && endState.timed.remainingMs === 0, JSON.stringify(endState.timed));
  check('timed-result-visible', endState.resultVisible && /限时结束/.test(endState.resultText));
  check('timed-score-number', Number.isInteger(endState.score) && endState.score >= 0);
  await screenshot('10-timed-result');
  await mouseClick('#pafTimedResultExit');
  check('exit-clean', await waitFor('!window.__playAsFox && !document.querySelector("#playAsFoxHud")', 5000));

  await navigate(false, '&reload=1');
  await mouseClick('#pafLeaderboardToggle');
  const boardText = await evalJs('document.querySelector("#pafLeaderboard")?.textContent || ""');
  check('leaderboard-persistence-after-reload', /本机限时排行榜/.test(boardText) && /0/.test(boardText), boardText);
  check('leaderboard-local-label', /仅此设备/.test(boardText));
  await screenshot('11-leaderboard-after-reload');
  await mouseClick('#pafTimedStart');
  check('timed-restart', await waitFor('window.__playAsFox.mode === "timed" && window.__playAsFox.timed.status === "running" && window.__playAsFox.score === 0', 3000));
  await mouseClick('#pafExit');
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'qa-timed-range-results.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ pass: true, checks: Object.keys(report.checks).length, renderer: report.renderer, consoleErrors: report.consoleErrors.length, exceptions: report.exceptions.length }, null, 2));
  } catch (error) {
  report.finishedAt = new Date().toISOString();
  report.errors = [...(report.errors || []), error.stack || String(error)];
  fs.writeFileSync(path.join(OUT, 'qa-timed-range-results.json'), JSON.stringify(report, null, 2));
  console.error(error.stack || error);
  process.exitCode = 1;
} finally {
  try { ws?.close(); } catch (_) {}
  try { chrome?.kill('SIGKILL'); } catch (_) {}
  server.close(); server.closeAllConnections?.();
}

})();
