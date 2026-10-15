/** 粒子池专项测试：验证消失的粒子不会残留为空中悬浮色块 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9353;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpPt-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { target = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(t => t.type === 'page'); if (target) break; } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const pageErrors = [];
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return; }
    if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; pageErrors.push(d.exception?.description || d.text); }
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

    const P = g.particles;
    const THREE = Object.getPrototypeOf(P.mesh).constructor;
    const dummy = new (P.mesh.matrixWorld.constructor)();

    // 读出所有实例的缩放，统计"可见粒子数"
    const countVisible = () => {
      let n = 0;
      const m = new P.mesh.matrix.constructor();
      for (let i = 0; i < P.mesh.count; i++) {
        P.mesh.getMatrixAt(i, m);
        // 提取缩放分量（近似：矩阵行列式的立方根）
        const sx = Math.hypot(m.elements[0], m.elements[1], m.elements[2]);
        if (sx > 1e-4) n++;
      }
      return n;
    };

    // 触发大量粒子（模拟 K 大招 + 击杀）
    P.burst(0, 1, 0, { r: 1, g: 0.8, b: 0.6 }, 60, 2);
    await sleep(120);
    out.afterBurst = {
      items: P.items.length,
      meshCount: P.mesh.count,
      visibleInstances: countVisible(),
    };

    // 等粒子全部消散
    for (let i = 0; i < 40 && P.items.length > 0; i++) await sleep(100);
    await sleep(300);

    out.afterFade = {
      items: P.items.length,
      meshCount: P.mesh.count,
      visibleInstances: countVisible(),
      fullyCleared: P.items.length === 0 && P.mesh.count === 0 && countVisible() === 0,
    };

    // 再次触发，验证 count 不会累积增长
    P.burst(5, 1, 5, { r: 1, g: 0.5, b: 0.5 }, 30, 1.5);
    await sleep(100);
    const peak = P.mesh.count;
    for (let i = 0; i < 40 && P.items.length > 0; i++) await sleep(100);
    await sleep(300);
    out.noAccumulation = {
      peakCount: peak,
      afterCount: P.mesh.count,
      afterVisible: countVisible(),
      noGrowth: P.mesh.count <= peak,
    };

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  console.log('\n页面异常:', pageErrors.length);
  pageErrors.slice(0, 3).forEach(e => console.log('  ' + String(e).slice(0, 250)));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();