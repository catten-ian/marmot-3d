/**
 * 狐狸导航回归：覆盖直线追近时绕岩、洞穴禁入、场地边界回避、冲刺撞障碍收招。
 * 用法：CHROME_PATH=/path/to/chrome node tools/test-fox-navigation.cjs [URL]
 * 前置：node tools/serve.cjs 8201
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const URL = process.argv[2] || 'http://127.0.0.1:8201/index.html?models=off';
const PORT = 9600 + (process.pid % 400);
const CHROME_CANDIDATES = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'];
const findChrome = () => CHROME_CANDIDATES.filter(Boolean).find((p) => fs.existsSync(p));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const get = (url) => fetch(url).then((r) => r.json());

function stopChrome(chrome) {
  if (!chrome || chrome.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    try { process.kill(-chrome.pid, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
  }
}

let chromeProcess;
(async () => {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('未找到 Chrome/Edge，请设置 CHROME_PATH');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marmot-fox-nav-'));
  const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--enable-unsafe-swiftshader', 'about:blank'],
  { stdio: 'ignore', detached: process.platform !== 'win32' });
  chromeProcess = chrome;

  let target;
  for (let i = 0; i < 80; i++) {
    await wait(250);
    try { target = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((t) => t.type === 'page'); if (target) break; } catch {}
  }
  if (!target) throw new Error('Chrome 调试页面启动失败');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id); pending.delete(message.id);
      message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.exception?.description || message.params.text);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); } }, 120000);
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || '页面脚本异常');
    return result.result?.value;
  };

  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
  await send('Runtime.enable'); await send('Page.enable'); await send('Page.navigate', { url: URL });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(500);
    try { if (await evaluate('!!window.__game?.FoxClass')) { ready = true; break; } } catch {}
  }
  if (!ready) throw new Error('游戏初始化超时');

  const result = await evaluate(`(async () => {
    const g = window.__game, { FOX, ROCKS, BURROW, roamBounds, scalePoint, scaleRadius } = await import('/src/core/config.js');
    const flat = () => 0;
    const level = { wind: 0.7, speed: 8.5, reinforce: 8 };
    const make = (x, z, type = 'normal', slot = 0) => new g.FoxClass(g.scene, x, z, type, 3, slot);
    const out = {};

    // 从岩石正后方追向玩家，检查能绕开而不穿模，且身体朝向实际位移。
    const rockFox = make(-20, -32, 'normal', 0);
    const p = { x: -20, z: 10 };
    let minRock = Infinity, lateral = 0, headingDot = 1;
    const rock = ROCKS[0];
    const [rx, rz] = scalePoint(rock);
    const rockRadius = scaleRadius(rock[2]) + 0.72 * rockFox.cfg.scale;
    for (let i = 0; i < 105; i++) {
      const x0 = rockFox.x, z0 = rockFox.z;
      rockFox.update(1 / 60, p, false, level, BURROW, flat);
      const dx = rockFox.x - x0, dz = rockFox.z - z0, moved = Math.hypot(dx, dz);
      if (moved > 1e-5) headingDot = Math.min(headingDot,
        (dx * Math.sin(rockFox.yaw) + dz * Math.cos(rockFox.yaw)) / moved);
      minRock = Math.min(minRock, Math.hypot(rockFox.x - rx, rockFox.z - rz));
      lateral = Math.max(lateral, Math.abs(rockFox.x + 20));
    }
    out.rockDetour = { minDistance: +minRock.toFixed(2), required: +rockRadius.toFixed(2), lateral: +lateral.toFixed(2), headingDot: +headingDot.toFixed(3), pass: minRock >= rockRadius - 0.02 && lateral > 0.8 && headingDot > 0.8 };
    rockFox.dispose(g.scene);

    // 避开洞口，不把藏狐引入玩家安全区。
    const caveFox = make(BURROW.x, BURROW.z - 18, 'fast', 1);
    const [bx, bz] = scalePoint([BURROW.x, BURROW.z]);
    const caveRadius = scaleRadius(BURROW.r) + 2.5;
    let minCave = Infinity;
    for (let i = 0; i < 100; i++) {
      caveFox._moveGround(0, 1, 5, 1 / 60, BURROW);
      const d = Math.hypot(caveFox.x - bx, caveFox.z - bz);
      minCave = Math.min(minCave, d);
      caveFox._resolveObstacleOverlaps(BURROW);
    }
    out.caveAvoidance = { minDistance: +minCave.toFixed(2), required: +caveRadius.toFixed(2), pass: minCave >= caveRadius - 0.02 };
    caveFox.dispose(g.scene);

    // 靠近场地外边时，即使目标向外，走向也应转回活动场。
    const edgeFox = make(roamBounds().hw - 1, 0, 'heavy', 2);
    const edgeStart = edgeFox.x;
    edgeFox._moveGround(1, 0, 1, 0.1, null);
    out.edgeAvoidance = { startX: edgeStart, endX: +edgeFox.x.toFixed(2), pass: edgeFox.x < edgeStart };
    edgeFox.dispose(g.scene);

    // 冲刺撞岩时不能持续顶着障碍，必须被推出并结束冲刺。
    const dashFox = make(-20, -8, 'boss', 3);
    dashFox.state = 'dash'; dashFox.timer = 0.8; dashFox.yaw = Math.PI;
    dashFox.dashDirX = 0; dashFox.dashDirZ = -1;
    dashFox.update(0.2, { x: -20, z: 0 }, false, level, BURROW, flat);
    const dashDist = Math.hypot(dashFox.x - rx, dashFox.z - rz);
    out.dashCollision = { state: dashFox.state, distance: +dashDist.toFixed(2), required: +(scaleRadius(rock[2]) + 0.72 * dashFox.cfg.scale).toFixed(2), warningVisible: dashFox.warn.visible, pass: dashFox.state === 'rest' && dashDist >= scaleRadius(rock[2]) + 0.72 * dashFox.cfg.scale - 0.02 && !dashFox.warn.visible };
    dashFox.dispose(g.scene);
    return out;
  })()`);

  let pass = errors.length === 0;
  for (const [name, check] of Object.entries(result)) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(check)}`);
    pass = pass && check.pass;
  }
  if (errors.length) console.log('页面异常:', errors);
  ws.close(); stopChrome(chrome); chromeProcess = null;
  process.exit(pass ? 0 : 1);
})().catch((error) => {
  console.error(error.stack || error);
  stopChrome(chromeProcess);
  process.exit(1);
});
