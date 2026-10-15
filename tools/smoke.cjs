/**
 * 无头冒烟测试：通过 CDP 加载游戏页面，捕获所有控制台错误与页面异常，
 * 并检查核心子系统是否成功初始化。
 */
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:8123/index.html';
const PORT = 9333;
const SHOT = process.argv[3] || 'shot.png';

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(d));
    }).on('error', rej);
  });
}

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1600,900',
    '--enable-logging=stderr', '--v=0',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  chrome.stderr.on('data', (c) => (stderr += c));

  // 等待 devtools 端口就绪
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) { /* retry */ }
  }
  if (!target) {
    console.log('FAIL: 无法连接 CDP\n' + stderr.slice(-2000));
    chrome.kill(); process.exit(1);
  }

  // Node 22 内置全局 WebSocket，无需安装 ws 依赖
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  ws.binaryType = 'nodebuffer';
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const pageErrors = [];
  const failedReqs = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const t = msg.params.type;
      if (t === 'error' || t === 'warning') {
        const text = msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
        consoleErrors.push(`[${t}] ${text}`);
      }
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      pageErrors.push(d.exception?.description || d.text || 'unknown exception');
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') consoleErrors.push(`[log:${e.source}] ${e.text} ${e.url || ''}`);
    }
    if (msg.method === 'Network.loadingFailed') {
      failedReqs.push(msg.params.errorText + ' ' + (msg.params.type || ''));
    }
  });

  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 30000);
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 7000));

  // 注入探测脚本：检查子系统
  const probe = `(() => {
    const g = window.__game;
    if (!g) return { ok: false, why: 'window.__game 未定义 —— main.js 可能执行失败' };
    const r = g.renderer;
    return {
      ok: true,
      foxes: g.foxes().length,
      level: g.game.level,
      mode: g.game.mode,
      sceneChildren: g.scene.children.length,
      triangles: r.info.render.triangles,
      drawCalls: r.info.render.calls,
      geometries: r.info.memory.geometries,
      textures: r.info.memory.textures,
      camY: +g.camera.position.y.toFixed(2),
      playerPos: [+g.controller.position.x.toFixed(1), +g.controller.position.z.toFixed(1)],
      loaderHidden: document.getElementById('loader').classList.contains('gone'),
      overlayVisible: !document.getElementById('overlay').hidden,
      panelHasStart: !!document.getElementById('startBtn'),
    };
  })()`;

  const probeRes = await send('Runtime.evaluate', { expression: probe, returnByValue: true, awaitPromise: false });
  const probeVal = probeRes.result?.value;

  // 截图
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));

  // 模拟：点击开始按钮（绕过 pointer lock），推进几帧，验证 update 不报错
  const sim = await send('Runtime.evaluate', {
    expression: `(async () => {
      const g = window.__game;
      const errs = [];
      window.addEventListener('error', e => errs.push(e.message));
      const origErr = console.error;
      console.error = (...a) => { errs.push(a.map(String).join(' ')); origErr(...a); };

      document.getElementById('startBtn')?.click();
      await new Promise(r => setTimeout(r, 1200));

      const s1 = {
        mode: g.game.mode,
        camY: +g.camera.position.y.toFixed(3),
        loaderGone: document.getElementById('loader').classList.contains('gone'),
        overlayHidden: document.getElementById('overlay').hidden,
      };

      // 移动 + 攻击
      g.keys.add('KeyW'); g.keys.add('Space');
      await new Promise(r => setTimeout(r, 1500));
      const moved = { x: +g.controller.position.x.toFixed(1), z: +g.controller.position.z.toFixed(1) };
      g.keys.clear();

      // J 爆发
      window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyJ'}));
      await new Promise(r => setTimeout(r, 300));
      const afterJ = { boost: +g.game.boost.toFixed(2) };

      // K 大招：先蓄满
      g.game.charge = 100;
      window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyK'}));
      await new Promise(r => setTimeout(r, 300));
      const afterK = { overdrive: +g.game.overdrive.toFixed(2) };

      // 传送到一个藏狐面前，验证攻击能命中
      // 注意：出生点在洞穴内（安全区），洞内不可攻击 —— 必须先移到洞外
      const fox = g.foxes().find(f => f.hp > 0);
      let hitTest = null;
      if (fox) {
        g.controller.teleport(fox.x, fox.z - 2, 0);
        g.controller.yaw = Math.atan2(-(fox.x - g.controller.position.x), -(fox.z - g.controller.position.z));
        await new Promise(r => setTimeout(r, 250)); // 等一帧同步 inBurrow
        const inBurrowAtFox = g.game.inBurrow;
        const hpBefore = fox.hp;
        g.keys.add('Space');
        await new Promise(r => setTimeout(r, 400));
        g.keys.clear();
        hitTest = { inBurrowAtFox, hpBefore, hpAfter: +fox.hp.toFixed(2), damaged: fox.hp < hpBefore };
      }

      // 传送到浆果旁，验证采食
      g.controller.teleport(-28, -22, 0);
      await new Promise(r => setTimeout(r, 600));
      const berry = { foodCount: g.game.foodCount, energy: +g.game.player.energy.toFixed(1) };

      // 洞外 K 大招
      g.controller.teleport(-10, 0, 0);
      await new Promise(r => setTimeout(r, 250));
      g.game.charge = 100;
      window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyK'}));
      await new Promise(r => setTimeout(r, 300));
      const afterK2 = { inBurrow: g.game.inBurrow, overdrive: +g.game.overdrive.toFixed(2) };

      // 暂停 / 恢复
      window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyP'}));
      await new Promise(r => setTimeout(r, 300));
      const paused = g.game.mode;
      window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyP'}));
      await new Promise(r => setTimeout(r, 300));

      return { s1, moved, afterJ, afterK, hitTest, berry, afterK2, paused,
        finalMode: g.game.mode, errs };
    })()`,
    returnByValue: true, awaitPromise: true,
  });
  const simVal = sim.result?.value;

  await new Promise((r) => setTimeout(r, 800));
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(SHOT.replace('.png', '-play.png'), Buffer.from(shot2.data, 'base64'));

  console.log('=========== 冒烟测试结果 ===========');
  console.log('URL:', URL);
  console.log('\n[子系统探测]');
  console.log(JSON.stringify(probeVal, null, 2));
  console.log('\n[交互模拟]');
  console.log(JSON.stringify(simVal, null, 2));
  console.log('\n[页面异常] ' + pageErrors.length);
  pageErrors.forEach((e) => console.log('  ' + e.slice(0, 400)));
  console.log('\n[控制台 error/warning] ' + consoleErrors.length);
  consoleErrors.slice(0, 25).forEach((e) => console.log('  ' + e.slice(0, 400)));
  console.log('\n[加载失败] ' + failedReqs.length);
  failedReqs.slice(0, 10).forEach((e) => console.log('  ' + e));

  ws.close();
  chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})();