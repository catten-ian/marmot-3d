/**
 * v1.1 新功能测试：
 *   1. 左键攻击（含首次点击不被吞）
 *   2. 全屏模式（API 存在性 + resize 同步）
 *   3. 同伴呼救箭头指示
 *   4. 站立/俯伏姿态 —— 重点验证"站起到一半开始奔跑"的连续性
 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9350;
const URL = process.argv[2] || 'http://127.0.0.1:8200/index.html';
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpV11-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const pageErrors = []; const consoleErrs = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; pageErrors.push(d.exception?.description || d.text); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrs.push(m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); } }, 30000);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise(r => setTimeout(r, 6500));

  const expr = `(async () => {
    const g = window.__game;
    const out = {};
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    document.getElementById('startBtn')?.click();
    await sleep(900);

    // ---------- 1. 左键攻击 ----------
    // 派发真实的 mousedown/mouseup 到 canvas
    const canvas = document.getElementById('scene');
    const fire = (type, btn = 0) => canvas.dispatchEvent(
      new MouseEvent(type, { button: btn, bubbles: true, cancelable: true }));
    // 先确保在洞外，否则会被安全区拦截攻击
    g.controller.teleport(-10, 0, 0);
    await sleep(300);
    const e0 = g.game.player.energy;
    fire('mousedown'); await sleep(60); fire('mouseup');
    await sleep(250);
    out.leftClickAttack = {
      energyBefore: +e0.toFixed(2),
      energyAfter: +g.game.player.energy.toFixed(2),
      consumed: +(e0 - g.game.player.energy).toFixed(2),
      worked: (e0 - g.game.player.energy) > 0.5,
    };

    // 按住持续攻击（连击）
    const e1 = g.game.player.energy;
    fire('mousedown');
    await sleep(1200);
    fire('mouseup');
    await sleep(150);
    out.holdAttack = {
      consumed: +(e1 - g.game.player.energy).toFixed(2),
      multiHit: (e1 - g.game.player.energy) > 5,
    };

    // ---------- 2. 全屏 API ----------
    out.fullscreen = {
      apiExists: typeof document.documentElement.requestFullscreen === 'function',
      exitApi: typeof document.exitFullscreen === 'function',
      fsBtnPresent: !!document.getElementById('fsBtn'),
      bodyHasClass: document.body.classList.contains('fullscreen'),
    };

    // ---------- 3. 同伴呼救箭头 ----------
    // 把同伴放到玩家正后方（视野外），触发边缘指示
    g.companion.x = g.controller.position.x;
    g.companion.z = g.controller.position.z - 20;
    g.controller.yaw = Math.PI; // 面向 -z，同伴在背后? 调整到正后
    g.controller.yaw = 0;       // forward = -z，同伴在 -z 即正前方 -> 改为反向
    g.controller.yaw = Math.PI; // forward = +z，同伴在 -z = 背后
    await sleep(500);
    const marks = [...document.querySelectorAll('.threat-mark')]
      .filter(m => m.style.display !== 'none');
    out.companionArrow = {
      visibleMarks: marks.length,
      helpMarks: marks.filter(m => m.dataset.kind === 'help').length,
      labels: marks.map(m => m.dataset.label).filter(Boolean),
      rescuedFlag: g.game.friend.rescued,
    };

    // ---------- 4. 姿态：连续性核心测试 ----------
    const samples = [];
    const snap = () => ({
      crouch: +g.controller.crouch.toFixed(4),
      camY: +g.camera.position.y.toFixed(4),
      fov: +g.camera.fov.toFixed(2),
    });

    // A) 站立基准
    g.controller.teleport(0, 0, 0);
    await sleep(600);
    out.postureStand = snap();

    // B) 开始奔跑，采样上升过程
    g.keys.add('KeyW');
    const rise = [];
    for (let i = 0; i < 8; i++) { await sleep(80); rise.push(snap()); }
    g.keys.clear();
    out.postureRise = rise;

    // C) 关键测试：站起到一半时再次奔跑
    // 先静止让它站起到中途（约一半），然后立刻再跑
    await sleep(260);           // 起身进行到一半左右
    const midStand = snap();
    g.keys.add('KeyW');        // 中途反向：应从当前值继续趴下，不能跳变
    await sleep(70);
    const justAfter = snap();
    await sleep(90);
    const aBitAfter = snap();
    g.keys.clear();
    out.postureMidSwitch = {
      atMidStand: midStand,
      justAfterReverse: justAfter,
      aBitAfterReverse: aBitAfter,
      // 反向后 crouch 应继续上升（变大），而不是瞬间跳到 1 或掉回 0
      smoothReverse: justAfter.crouch > midStand.crouch
        && justAfter.crouch < 0.95
        && Math.abs(justAfter.crouch - midStand.crouch) < 0.5,
    };

    // D) 停下后重新站起，采样下降过程
    const fallBack = [];
    for (let i = 0; i < 10; i++) { await sleep(110); fallBack.push(snap()); }
    out.postureStandUp = fallBack;

    // E) 递增性检查：整个上升序列必须单调不减
    const rises = out.postureRise.map(s => s.crouch);
    out.monotonicRise = rises.every((v, i) => i === 0 || v >= rises[i - 1] - 1e-6);
    const falls = out.postureStandUp.map(s => s.crouch);
    out.monotonicFall = falls.every((v, i) => i === 0 || v <= falls[i - 1] + 1e-6);

    // F) 结束时应回到站立（crouch ≈ 0，视高恢复）
    await sleep(900);
    out.postureFinal = snap();
    out.returnedToStand = Math.abs(out.postureFinal.crouch) < 0.02;

    // G) 冲突检查：不得在任意时刻出现 NaN / undefined
    const allVals = [...rises, ...falls].concat([midStand.crouch, justAfter.crouch]);
    out.noNaN = allVals.every(v => Number.isFinite(v));
    out.crouchRange = { min: Math.min(...allVals), max: Math.max(...allVals) };

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  console.log('\n页面异常:', pageErrors.length);
  pageErrors.slice(0, 5).forEach(e => console.log('  ' + String(e).slice(0, 300)));
  console.log('控制台错误:', consoleErrs.length);
  consoleErrs.slice(0, 5).forEach(e => console.log('  ' + String(e).slice(0, 300)));

  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();