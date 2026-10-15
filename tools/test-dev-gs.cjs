const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
// 用动态端口，避免上一轮残留的 headless Chrome 仍占着固定调试端口导致假失败
const PORT = 9500 + (process.pid % 400);
const URL = 'http://127.0.0.1:8123/index.html?version=dev&webgl=1';
const OUT = path.join(ROOT, 'outputs', 'dev-gs');
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  for (const c of [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)) if (fs.existsSync(c)) return c;
  return null;
}
const get = (url) => fetch(url).then((r) => r.json());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('未找到 Chrome/Edge');
  const profile = path.join(os.tmpdir(), `marmot-gs-vr-${Date.now()}`);
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  try {
    let tab;
    for (let i = 0; i < 80; i++) {
      await wait(250);
      try { tab = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (tab) break; } catch {}
    }
    if (!tab) throw new Error('调试页面启动失败');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    let seq = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        consoleErrors.push(`[${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
      }
      if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push('[exception] ' + (msg.params.exceptionDetails.text || 'exception'));
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++seq; pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 120000);
    });
    const evalJS = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本异常');
      return result.result?.value;
    };
    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: URL });
    // dev 页要预加载较大的分段狐狸 GLB，主线程会被占用较久；
    // 不能死等固定时长，轮询直到 window.__game 就绪（最多 90s）。
    let ready = false;
    for (let i = 0; i < 90; i++) {
      await wait(1000);
      ready = await evalJS('!!window.__game').catch(() => false);
      if (ready) break;
    }
    await wait(800); // 就绪后再给一帧 settle

    const initial = await evalJS(`(() => {
      const g = window.__game;
      const tag = document.getElementById('backendTag');
      const gs = g?.scene?.children?.find(x => x.name === 'gsWorld');
      return {
        ready: !!g, dev: g?.isDev, backend: tag?.textContent || '',
        rendererBackend: g?.renderer?.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2',
        gsPresent: !!gs, gsVisible: !!gs?.visible,
        terrainVisible: !!g?.scenery?.terrain?.visible,
        hillsVisible: !!g?.scenery?.hills?.visible,
        heightFieldActive: g?.heightFieldActive?.() ?? false,
        heightAtStart: g?.terrainHeight?.(g.controller.position.x, g.controller.position.z) ?? null,
        playerY: g?.controller?.position?.y,
      };
    })()`);
    if (!initial.ready) throw new Error('主游戏未初始化');

    const titleShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, 'dev-title-1280x720.png'), Buffer.from(titleShot.data, 'base64'));
    const playState = await evalJS(`(() => {
      const g = window.__game;
      const button = document.getElementById('startBtn')
        || [...document.querySelectorAll('button')].find(x => /开始|进入草原|继续|start/i.test(x.textContent));
      button?.click();
      return { mode: g.game.mode };
    })()`);
    await wait(900);
    const playShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, 'dev-play-1280x720.png'), Buffer.from(playShot.data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await wait(350);
    const narrowShot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, 'dev-play-390x844.png'), Buffer.from(narrowShot.data, 'base64'));

    const state = await evalJS(`(() => {
      const g = window.__game;
      return {
        mode: g.game.mode,
        heightFieldActive: g.isDev,
        position: g.controller.position.toArray(),
        sceneChildren: g.scene.children.map(x => x.name).filter(Boolean),
      };
    })()`);
    const errors = consoleErrors.filter((x) => x.startsWith('[error]') || x.startsWith('[exception]'));
    const report = {
      url: URL, generatedAt: new Date().toISOString(), initial, playState, state, consoleErrors,
      pass: initial.ready && initial.dev === true && initial.rendererBackend === 'webgl2'
        && initial.backend.includes('WebGL2') && initial.gsPresent && initial.gsVisible
        && !initial.terrainVisible && !initial.hillsVisible
        && Number.isFinite(initial.heightAtStart) && Number.isFinite(initial.playerY)
        && playState.mode === 'play' && state.mode === 'play' && errors.length === 0,
    };
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  } finally {
    ws?.close();
    chrome.kill();
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
