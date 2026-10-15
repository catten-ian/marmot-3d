/**
 * 姿态连续性专项（干净环境）。
 * 直接驱动 controller，不受其他测试脚本的 monkey-patch 污染。
 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9363;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpPos-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
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
  await new Promise(r => setTimeout(r, 7000));

  const expr = `(() => {
    const g = window.__game;
    const c = g.controller;
    const map = g.binds.moveMap;
    const dt = 1 / 60;
    const K = (codes) => new Set(codes);
    const run = (n, keys) => { for (let i = 0; i < n; i++) c.update(dt, keys, 1, map); };

    c.teleport(0, 0, 0);
    run(40, new Set());                 // 稳定在站立
    const stand = +c.crouch.toFixed(4);

    // 跑 1 秒 -> 俯伏
    run(60, K([map.forward]));
    const crouchFull = +c.crouch.toFixed(4);

    // 停下站起 12 帧（约 0.2s，起身更慢，应在半程附近）
    const trail = [];
    for (let i = 0; i < 12; i++) { run(1, new Set()); trail.push(+c.crouch.toFixed(4)); }
    const midStand = +c.crouch.toFixed(4);

    // 在"站起到一半"时立刻反向奔跑 —— 关键连续性测试
    run(3, K([map.forward]));
    const after3 = +c.crouch.toFixed(4);
    run(6, K([map.forward]));
    const after9 = +c.crouch.toFixed(4);

    // 单调性
    const riseMono = trail.every((v, i) => i === 0 || v <= trail[i-1] + 1e-6);

    // 反向必须平滑：不能跳变（单帧变化不应超过 crouchRate*dt 的合理量级）
    const frame1Delta = Math.abs(after3 - midStand);
    run(60, new Set());
    const finalStand = +c.crouch.toFixed(4);

    return {
      stand, crouchFull, midStand, after3, after9, finalStand,
      riseTrail: trail,
      riseMono,
      // 反向后应继续朝 1 上升（数值变大），且幅度连续
      reverseRising: after3 > midStand && after9 >= after3,
      noJump: frame1Delta < 0.35,
      smoothReverse: after3 > midStand && after3 < 0.98 && frame1Delta < 0.35,
      returnedToStand: Math.abs(finalStand) < 0.02,
    };
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  console.log('页面异常:', pageErrors.length);
  pageErrors.slice(0, 3).forEach(e => console.log('  ' + String(e).slice(0, 250)));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();