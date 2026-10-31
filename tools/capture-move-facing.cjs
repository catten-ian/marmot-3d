const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const chromePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const port = Number(process.env.CDP_PORT || 9223);
const outDir = path.resolve('outputs/move-facing');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
  }).on('error', reject);
});

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'move-facing-'));
  const chrome = process.env.CDP_PORT ? null : spawn(chromePath, [
    '--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader',
    '--use-gl=swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let target;
    for (let i = 0; i < 80; i++) {
      await wait(250);
      try { target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page'); } catch (_) {}
      if (target) break;
    }
    if (!target) throw new Error('Chrome DevTools page did not start');
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(JSON.stringify(message.error)));
      else callbacks.resolve(message.result);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      ws.send(JSON.stringify({ id: requestId, method, params }));
      setTimeout(() => {
        if (pending.has(requestId)) { pending.delete(requestId); reject(new Error(`${method} timeout`)); }
      }, 30000);
    });
    const evaluate = async (expression) => send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:8700/' });
    await wait(12000);
    await evaluate(`(() => {
      const g = window.__game;
      if (!g) throw new Error('game debug API missing');
      document.getElementById('startBtn')?.click();
      g.setViewMode(true);
      g.controller.teleport(0, 0, 0);
      return true;
    })()`);
    await wait(3000);

    const captureViewport = async (width, height, suffix) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 1, mobile: width < 600,
      });
      await wait(1500);
      for (const [name, key] of [['forward', 'KeyW'], ['left', 'KeyA'], ['right', 'KeyD'], ['back', 'KeyS']]) {
        await evaluate(`(() => {
          const g = window.__game;
          g.keys.clear();
          g.controller.teleport(0, 0, 0);
          g.keys.add('${key}');
          return true;
        })()`);
        await wait(900);
        const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const file = path.join(outDir, `${suffix}-${name}.png`);
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
        console.log(file);
      }
    };
    await captureViewport(390, 844, 'mobile');
    await captureViewport(1280, 720, 'desktop');
    await evaluate('window.__game.keys.clear()');
  } finally {
    if (ws) ws.close();
    chrome?.kill('SIGTERM');
    await wait(500);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
