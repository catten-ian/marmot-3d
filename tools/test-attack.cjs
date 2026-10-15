/** 专注验证左键攻击：模拟 pointerlockchange 后的完整输入链路 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9351;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpAtk-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 30000);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8200/index.html' });
  await new Promise(r => setTimeout(r, 6500));

  const expr = `(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const out = {};
    document.getElementById('startBtn')?.click();
    await sleep(900);

    // 强制进入"已锁定"状态（无头环境无法真正 requestPointerLock）
    // 用 getter 覆写，让控制器认为鼠标已捕获
    let lockedValue = true;
    Object.defineProperty(g.controller, 'locked', {
      configurable: true,
      get: () => lockedValue,
    });
    out.lockedForced = g.controller.locked;

    // 场景一：已锁定时单击
    g.controller.teleport(-10, 0, 0);   // 洞外，避免安全区拦截
    await sleep(350);
    const canvas = document.getElementById('scene');
    const fire = (t) => canvas.dispatchEvent(new MouseEvent(t, { button: 0, bubbles: true, cancelable: true }));

    let e = g.game.player.energy;
    fire('mousedown'); await sleep(80); fire('mouseup');
    await sleep(300);
    out.singleClick = {
      before: +e.toFixed(2), after: +g.game.player.energy.toFixed(2),
      worked: (e - g.game.player.energy) > 0.5,
    };

    // 场景二：按住连击
    await sleep(600);
    e = g.game.player.energy;
    fire('mousedown');
    await sleep(1500);
    const midEnergy = g.game.player.energy;
    fire('mouseup');
    await sleep(200);
    out.holdClick = {
      consumed: +(e - g.game.player.energy).toFixed(2),
      multiHit: (e - midEnergy) > 4,
    };

    // 场景三：未锁定时首次点击 -> 应记录 pendingClickAttack
    lockedValue = false;
    g.controller.crouch = 0;
    e = g.game.player.energy;
    fire('mousedown');
    await sleep(100);
    out.unlockedClick = { afterFirst: +g.game.player.energy.toFixed(2) };
    // 模拟锁定成功回调
    lockedValue = true;
    g.controller.onLockChange(true);
    await sleep(300);
    out.unlockedClick.afterLock = +g.game.player.energy.toFixed(2);
    out.unlockedClick.pendingAttackFired = (e - g.game.player.energy) > 0.5;

    // 场景四：与空格攻击行为一致（对照）
    await sleep(400);
    lockedValue = true;
    e = g.game.player.energy;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    await sleep(200);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));
    await sleep(200);
    out.spaceAttack = {
      consumed: +(e - g.game.player.energy).toFixed(2),
      worked: (e - g.game.player.energy) > 0.5,
    };

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();