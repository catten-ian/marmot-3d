/** 跳跃物理精确验证：用固定步长驱动，绕开帧率影响 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9361;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpJmp-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
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
  await new Promise(r => setTimeout(r, 7000));

  // 用固定 dt 直接驱动控制器，模拟 60fps，精确测量跳跃曲线
  const expr = `(() => {
    const g = window.__game;
    const c = g.controller;
    const J = { velocity: 3.8, gravity: 14, cooldown: 0.35, dodgeHeight: 0.34 };
    c.teleport(0, 0, 0);

    // 手动步进：先让地面稳定
    const dt = 1 / 60;
    for (let i = 0; i < 30; i++) c.update(dt, new Set(), 1, g.binds.moveMap);

    const y0 = c.position.y;
    c.jump();
    const curve = [];
    let airTime = 0;
    let maxAir = 0;
    let landedAt = -1;
    for (let step = 0; step < 120; step++) {
      c.update(dt, new Set(), 1, g.binds.moveMap);
      const h = c.airHeight;
      if (h > maxAir) maxAir = h;
      curve.push(+h.toFixed(3));
      if (!c.grounded) airTime += dt;
      else if (landedAt < 0 && step > 2) landedAt = step;
    }
    return {
      startY: +y0.toFixed(3),
      finalY: +c.position.y.toFixed(3),
      finalGrounded: c.grounded,
      maxAir: +maxAir.toFixed(3),
      theoreticalPeak: +(J.velocity * J.velocity / (2 * J.gravity)).toFixed(3),
      dodgeHeight: J.dodgeHeight,
      canDodge: maxAir > J.dodgeHeight,
      airTime: +airTime.toFixed(3),
      theoreticalAirTime: +(2 * J.velocity / J.gravity).toFixed(3),
      landedAtStep: landedAt,
      curveHead: curve.slice(0, 40),
    };
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();