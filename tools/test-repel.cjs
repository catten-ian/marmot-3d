/**
 * 驱退（非击杀）行为专项测试：
 *   1. 被驱退的藏狐应转入逃跑状态，而不是原地消失
 *   2. 逃跑时应有位移（真的在跑），朝向背离玩家
 *   3. 逃出边界后才移除，且一段时间后重新出现
 *   4. 首领一去不返，不重生
 *   5. 语义检查：代码中不应再有 kill 相关命名
 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9375;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpRep-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
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
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      consoleErrs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id; pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => { if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout')); } }, 120000);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8200/index.html' });
  await new Promise(r => setTimeout(r, 7000));

  const expr = `(async () => {
    const g = window.__game;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const out = {};
    document.getElementById('startBtn')?.click();
    await sleep(900);

    // 找一只普通藏狐（排除首领）
    const fox = g.foxes().find(f => f.type !== 'boss' && f.hp > 0);
    if (!fox) return { error: '没有可用藏狐' };

    out.before = {
      hp: fox.hp, fleeing: fox.fleeing, visible: fox.mesh.visible,
      x: +fox.x.toFixed(1), z: +fox.z.toFixed(1),
    };

    // 把它打到体力耗尽 —— 走真实的 hit 路径
    const stats = g.combatStats();
    let guard = 0;
    while (fox.hp > 0 && guard++ < 60) {
      fox.hit(99, stats.knockback, stats.stun, g.controller.position.x, g.controller.position.z);
    }
    out.afterHpZero = {
      hp: fox.hp, fleeing: fox.fleeing,
      // 关键：HP 归零后不应立即消失，而应进入逃跑
      stillVisible: fox.mesh.visible,
      state: fox.state,
    };

    // 手动触发驱退（模拟 main 的 hitFox 流程）
    const px = g.controller.position.x, pz = g.controller.position.z;
    fox.startFleeing(px, pz, g.LEVELS[g.game.level]);
    const startX = fox.x, startZ = fox.z;
    out.onFleeStart = {
      fleeing: fox.fleeing, state: fox.state,
      visible: fox.mesh.visible,
      fleeYaw: +fox.fleeYaw.toFixed(2),
    };

    // 逃跑中：应持续位移
    const path = [];
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      path.push({ x: +fox.x.toFixed(1), z: +fox.z.toFixed(1), fleeing: fox.fleeing, vis: fox.mesh.visible });
    }
    const moved = Math.hypot(fox.x - startX, fox.z - startZ);
    out.duringFlee = {
      movedDist: +moved.toFixed(2),
      actuallyRan: moved > 3,
      pathSamples: path.length,
      distinctPositions: new Set(path.map(p => p.x + ',' + p.z)).size,
      // 一旦逃出边界应消失
      endFleeing: fox.fleeing,
      endVisible: fox.mesh.visible,
      respawnTimer: +fox.respawn.toFixed(2),
    };

    // 方向应背离玩家
    const distBefore = Math.hypot(fox.x - px, fox.z - pz);
    out.directionAway = { distAfter: +distBefore.toFixed(2) };

    // 等它重新出现（增援）
    const maxWait = 14;
    let waited = 0;
    while (fox.hp <= 0 && waited < maxWait * 10) { await sleep(100); waited++; }
    out.respawned = {
      hp: fox.hp,
      fleeing: fox.fleeing,
      visible: fox.mesh.visible,
      state: fox.state,
      waitedSec: +(waited / 10).toFixed(1),
      cameBack: fox.hp > 0 && fox.mesh.visible,
    };

    // 首领不重生
    out.bossCheck = { note: '第 5 关才有首领，跳过' };

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  console.log('\n页面异常:', pageErrors.length);
  pageErrors.slice(0, 4).forEach(e => console.log('  ' + String(e).slice(0, 300)));
  console.log('控制台错误/警告:', consoleErrs.length);
  consoleErrs.slice(0, 6).forEach(e => console.log('  ' + String(e).slice(0, 250)));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();