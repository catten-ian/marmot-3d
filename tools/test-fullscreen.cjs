/** 全屏模式专项测试：验证按钮、API 调用链、resize 同步、body class */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9352;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpFS-'));
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
    await sleep(800);

    const btn = document.getElementById('fsBtn');
    out.initial = {
      btnExists: !!btn,
      text: btn?.textContent,
      title: btn?.title,
      hasOnclick: !!(btn?.onclick),
      hasActiveClass: btn?.classList.contains('active'),
      rendererSize: [g.renderer.domElement.width, g.renderer.domElement.height],
      fov: g.camera.fov,
    };

    // 桩化 requestFullscreen：真实全屏在无头环境不可用。
    // 关键：要同时改写 document.fullscreenElement，否则 syncFullscreenUI
    // 读不到状态，UI 不会更新 —— 那样测出来的失败是桩的问题，不是代码的问题。
    const origRequest = document.documentElement.requestFullscreen;
    const origExit = document.exitFullscreen;
    let requestCalls = 0, exitCalls = 0;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true, writable: true, value: null,
    });

    document.documentElement.requestFullscreen = function () {
      requestCalls++;
      document.fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };
    document.exitFullscreen = function () {
      exitCalls++;
      document.fullscreenElement = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    };

    // 1) 点按钮进入全屏
    btn.click();
    await sleep(300);
    out.afterEnter = {
      requestCalls,
      exitCalls,
      text: btn.textContent,
      title: btn.title,
      active: btn.classList.contains('active'),
      bodyClass: document.body.classList.contains('fullscreen'),
    };

    // 2) 再点一次退出
    btn.click();
    await sleep(300);
    out.afterExit = {
      requestCalls, exitCalls,
      text: btn.textContent,
      active: btn.classList.contains('active'),
      bodyClass: document.body.classList.contains('fullscreen'),
    };

    // 3) F11 键：应走我们的 API 而不是浏览器默认
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F11', bubbles: true, cancelable: true }));
    await sleep(300);
    out.afterF11 = {
      requestCalls, exitCalls,
      bodyClass: document.body.classList.contains('fullscreen'),
      fovUnchanged: g.camera.fov === out.initial.fov,
    };

    // 4) resize 同步：改变视口后 renderer 与 camera 应跟随
    const beforeW = g.renderer.domElement.width;
    window.dispatchEvent(new Event('resize'));
    await sleep(200);
    out.resizeSync = {
      canvasMatchesViewport:
        g.renderer.domElement.clientWidth === window.innerWidth,
      aspect: +g.camera.aspect.toFixed(3),
      expectedAspect: +(window.innerWidth / window.innerHeight).toFixed(3),
    };

    // 还原
    document.documentElement.requestFullscreen = origRequest;
    document.exitFullscreen = origExit;
    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  console.log('\n页面异常:', pageErrors.length);
  pageErrors.slice(0, 5).forEach(e => console.log('  ' + String(e).slice(0, 250)));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();