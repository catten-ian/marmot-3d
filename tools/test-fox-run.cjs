const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9531;
const URL = 'http://127.0.0.1:8123/index.html?version=dev&webgl=1';
const OUT = path.join(ROOT, 'outputs', 'dev-gs');
fs.mkdirSync(OUT, { recursive: true });

function findChrome() {
  for (const candidate of [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)) if (fs.existsSync(candidate)) return candidate;
  return null;
}
const get = (url) => fetch(url).then((response) => response.json());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('未找到 Chrome/Edge');
  const profile = path.join(os.tmpdir(), `marmot-fox-run-${Date.now()}`);
  const chrome = spawn(chromePath, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  let result;
  try {
    let tab;
    for (let i = 0; i < 80; i++) {
      await wait(250);
      try {
        tab = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((item) => item.type === 'page');
        if (tab) break;
      } catch {}
    }
    if (!tab) throw new Error('调试页面启动失败');
    ws = new WebSocket(tab.webSocketDebuggerUrl);
    let sequence = 0;
    const pending = new Map();
    const consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const promise = pending.get(message.id);
        pending.delete(message.id);
        message.error ? promise.reject(new Error(JSON.stringify(message.error))) : promise.resolve(message.result);
        return;
      }
      if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) {
        consoleErrors.push(`[${message.params.type}] ${message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')}`);
      }
      if (message.method === 'Runtime.exceptionThrown') {
        consoleErrors.push(`[exception] ${message.params.exceptionDetails.text || 'exception'}`);
      }
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 120000);
    });
    const evaluate = async (expression) => {
      const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || '页面脚本异常');
      return response.result?.value;
    };
    const screenshot = async (name) => {
      const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(image.data, 'base64'));
    };

    await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Page.navigate', { url: URL });
    await wait(14000);

    const setup = await evaluate(`(() => {
      const game = window.__game;
      const button = document.getElementById('startBtn');
      button?.click();
      return { ready: !!game, mode: game?.game?.mode };
    })()`);
    if (!setup.ready) throw new Error('游戏未初始化');
    await wait(1400);

    const model = await evaluate(`(() => {
      const game = window.__game;
      const fox = game.foxes()[0];
      if (!fox) return { error: 'no fox' };
      const modelDetails = {
        modelLevel: fox.modelLevel,
        segmented: !!fox._segmentAnimation,
        legCount: fox._segmentAnimation?.parts.legs.length || 0,
        tailCount: fox._segmentAnimation?.parts.tails.length || 0,
      };
      if (!fox._segmentAnimation || modelDetails.legCount !== 4) return modelDetails;

      game.controller.teleport(0, 0, 0);
      game.controller.yaw = 0;
      game.controller.pitch = 0.04;
      document.querySelectorAll('.hud-top,.hud-left,.hud-right,.footbar,.crosshair,.help-btn,.fs-btn,.set-btn,.version-tag,.backend-tag,.threat,.toast,.banner').forEach((node) => { node.style.display = 'none'; });
      fox.x = game.controller.position.x;
      fox.z = game.controller.position.z - 2.8;
      fox.yaw = Math.PI;
      fox.state = 'roam';
      fox.stun = 0;
      fox.fleeing = false;
      fox.baseY = game.terrainHeight(fox.x, fox.z);
      fox.update = (dt, _p, _safe, _cfg, _burrow, terrainAt) => {
        fox._updateSegmentedFox(dt, 3.2);
        fox._applyTransform(dt, terrainAt);
      };
      fox.mesh.visible = true;
      fox._restoreVisibility();
      fox.mesh.updateMatrixWorld(true);
      return { ...modelDetails, position: [fox.x, fox.baseY, fox.z] };
    })()`);
    if (model.error) throw new Error(model.error);
    await wait(900);

    const motion = await evaluate(`(async () => {
      const fox = window.__game.foxes()[0];
      const samples = [];
      for (let i = 0; i < 18; i++) {
        samples.push(fox._segmentAnimation.parts.legs.map((leg) => +leg.object.rotation.z.toFixed(3)));
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
        await new Promise((resolve) => setTimeout(resolve, 45));
      }
      const range = [];
      for (let leg = 0; leg < 4; leg++) {
        const values = samples.map((sample) => sample[leg]);
        range.push({ min: Math.min(...values), max: Math.max(...values) });
      }
      return { samples: samples.length, range };
    })()`);
    const gait = await evaluate(`(() => {
      const fox = window.__game.foxes()[0];
      fox.x = 0; fox.z = -2.8;
      fox.baseY = window.__game.terrainHeight(fox.x, fox.z);
      fox.mesh.position.set(fox.x, fox.baseY, fox.z);
      fox.mesh.rotation.y = fox.yaw = Math.PI;
      fox._runCycle = Math.PI / 2;
      fox._runAmount = 1;
      fox._updateSegmentedFox(0, 3.2);
      fox.update = (dt, _p, _safe, _cfg, _burrow, terrainAt) => fox._applyTransform(dt, terrainAt);
      fox.mesh.updateMatrixWorld(true);
      const legs = fox._segmentAnimation.parts.legs.map((leg) => ({ fore: leg.fore, side: leg.side, swing: +leg.object.rotation.z.toFixed(3) }));
      return { legs, frontBackSeparation: Math.max(...legs.map((leg) => leg.swing)) - Math.min(...legs.map((leg) => leg.swing)) };
    })()`);
    await screenshot('dev-fox-run.png');

    const idle = await evaluate(`(() => {
      const fox = window.__game.foxes()[0];
      fox.x = 0; fox.z = -2.8; fox.baseY = window.__game.terrainHeight(fox.x, fox.z);
      fox.mesh.position.set(fox.x, fox.baseY, fox.z); fox.mesh.rotation.y = fox.yaw = Math.PI;
      fox.update = (dt, _p, _safe, _cfg, _burrow, terrainAt) => {
        fox._updateSegmentedFox(dt, 0);
        fox._applyTransform(dt, terrainAt);
      };
      return true;
    })()`);
    await wait(800);
    const idlePose = await evaluate(`window.__game.foxes()[0]._segmentAnimation.parts.legs.map((leg) => +leg.object.rotation.x.toFixed(3))`);
    await screenshot('dev-fox-idle.png');

    const movingLegsChanged = motion.range.every((leg) => leg.max - leg.min > 0.1);
    const errors = consoleErrors.filter((entry) => entry.startsWith('[error]') || entry.startsWith('[exception]'));
    result = {
      url: URL,
      mode: setup.mode,
      model,
      motion,
      gait,
      idlePose,
      assertions: {
        devPlay: setup.mode === 'play',
        fourLegsBound: model.legCount === 4,
        movingLegsChanged,
        diagonalGait: gait.frontBackSeparation > 0.8,
        noConsoleErrors: errors.length === 0,
      },
      consoleErrors,
    };
    result.pass = Object.values(result.assertions).every(Boolean);
    fs.writeFileSync(path.join(OUT, 'fox-run-report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  } finally {
    ws?.close();
    chrome.kill();
    if (result) {
      await wait(250);
      process.exit(result.pass ? 0 : 1);
    }
  }
})().catch((error) => { console.error(error.stack || error); process.exit(1); });
