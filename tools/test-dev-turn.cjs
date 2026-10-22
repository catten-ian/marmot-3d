const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.argv[2] || 'http://127.0.0.1:8200/index.html';
const failures = [];

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function main() {
  const debugPort = 9471;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpTurn-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu',
    '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      target = JSON.parse(await get(`http://127.0.0.1:${debugPort}/json/list`))
        .find((item) => item.type === 'page');
      if (target) break;
    } catch (_) {}
  }
  if (!target) throw new Error('Chrome debug page unavailable');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('CDP timeout'));
      }
    }, 60000);
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    });
    return result.result.value;
  };
  const navigate = async (url, label, isDev) => {
    await send('Page.navigate', { url });
    for (let i = 0; i < 90; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const ready = await evaluate(`!!window.__game?.controller && window.__game.isDev === ${isDev}`);
        if (ready) return;
      } catch (_) {}
    }
    throw new Error(`${label}: matching game version initialization timed out`);
  };
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  await send('Runtime.enable');
  await send('Page.enable');

  const runChecks = async (url, label, isDev) => {
    await navigate(url, label, isDev);
    const result = await evaluate(`(() => {
      const g = window.__game;
      const b = g.binds;
      const c = g.controller;
      const checks = [];
      const check = (name, ok, extra = '') => checks.push({ name, ok: !!ok, extra: String(extra) });
      const exercise = (keys) => {
        c.teleport(0, 0, 0);
        c.velocity.set(0, 0, 0);
        const before = { yaw: c.yaw, x: c.position.x, z: c.position.z };
        c.update(0.1, new Set(keys), 1, b.moveMap, 0, b.turnMap);
        return { yaw: c.yaw - before.yaw, dx: c.position.x - before.x, dz: c.position.z - before.z };
      };

      b.setScheme('optimized');
      const optimizedA = exercise(['KeyA']);
      check('optimized A turns left without strafing',
        optimizedA.yaw > 0.1 && Math.abs(optimizedA.dx) < 1e-6 && Math.abs(optimizedA.dz) < 1e-6,
        JSON.stringify(optimizedA));
      const optimizedD = exercise(['KeyD']);
      check('optimized D turns right without strafing',
        optimizedD.yaw < -0.1 && Math.abs(optimizedD.dx) < 1e-6 && Math.abs(optimizedD.dz) < 1e-6,
        JSON.stringify(optimizedD));
      const arrows = exercise(['ArrowLeft']);
      check('optimized ArrowLeft remains lateral movement',
        Math.abs(arrows.yaw) < 1e-9 && Math.abs(arrows.dx) > 0.01,
        JSON.stringify(arrows));

      b.setScheme('compatible');
      const compatibleA = exercise(['KeyA']);
      check('compatible A remains lateral movement',
        Math.abs(compatibleA.yaw) < 1e-9 && Math.abs(compatibleA.dx) > 0.01,
        JSON.stringify(compatibleA));

      b.setKey('left', 'KeyJ');
      const customA = exercise(['KeyA']);
      const customJ = exercise(['KeyJ']);
      check('custom A no longer turns or moves',
        Math.abs(customA.yaw) < 1e-9 && Math.abs(customA.dx) < 1e-6,
        JSON.stringify(customA));
      check('custom binding still controls lateral movement', Math.abs(customJ.dx) > 0.01,
        JSON.stringify(customJ));

      b.setScheme('optimized');
      const rows = b.describe();
      check('settings show turn labels only for dev optimized',
        g.isDev ? rows.some((row) => row.id === 'turnLeft' && row.keys.includes('A'))
          && rows.some((row) => row.id === 'turnRight' && row.keys.includes('D'))
          : rows.every((row) => row.id !== 'turnLeft' && row.id !== 'turnRight'));
      if (!g.isDev) {
        const stableA = exercise(['KeyA']);
        check('stable optimized A remains lateral movement',
          Math.abs(stableA.yaw) < 1e-9 && Math.abs(stableA.dx) > 0.01,
          JSON.stringify(stableA));
        check('stable optimized scheme has no turn mapping', (!b.turnMap || (!b.turnMap.left && !b.turnMap.right)));
      } else {
        check('dev optimized scheme maps A/D to turning',
          b.turnMap.left === 'KeyA' && b.turnMap.right === 'KeyD'
          && b.moveMap.left == null && b.moveMap.right == null);
      }
      return checks;
    })()`);
    for (const item of result || []) {
      console.log(`${item.ok ? 'PASS' : 'FAIL'} [${label}] ${item.name}${item.extra ? `: ${item.extra}` : ''}`);
      if (!item.ok) failures.push(`${label}: ${item.name}`);
    }
  };

  await runChecks(`${BASE}?version=dev&webgl=1`, 'dev', true);
  const stableChecks = await evaluate(`(async () => {
    const source = await fetch('/src/core/keybinds.js').then((response) => response.text());
    const checks = [];
    const check = (name, ok) => checks.push({ name, ok: !!ok });
    check('stable optimized scheme retains A/D movement when IS_DEV is false',
      source.includes("left: IS_DEV ? null : 'KeyA'")
      && source.includes("right: IS_DEV ? null : 'KeyD'"));
    check('dev optimized legacy turning is explicit and beta mode is independently selectable',
      source.includes("version === 'dev' && scheme === 'optimized'")
      && source.includes("version === 'beta' && normalizeControlMode(controlMode) === 'driving'"));
    check('turn actions are hidden outside dev optimized scheme',
      source.includes('IS_DEV && this.scheme === \'optimized\''));
    return checks;
  })()`);
  for (const item of stableChecks || []) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} [stable] ${item.name}${item.extra ? `: ${item.extra}` : ''}`);
    if (!item.ok) failures.push(`stable: ${item.name}`);
  }
  ws.close();
  spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], {
    stdio: 'ignore', windowsHide: true,
  });
  if (failures.length) {
    console.error(`\\n${failures.length} regression assertion(s) failed`);
    process.exitCode = 1;
  } else {
    console.log('\\nAll dev-turn regression assertions passed');
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
