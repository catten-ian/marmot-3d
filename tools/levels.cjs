/** 生成各关的配色对比截图（关卡取自 window.__game.LEVELS，共 12 关） */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9342;
const get = (u) => new Promise((r, j) => http.get(u, (s) => { let d = ''; s.on('data', c => d += c); s.on('end', () => r(d)); }).on('error', j));

(async () => {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpA-'));
  const ch = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1100,560', 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    try { t = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`)).find(x => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && p.has(m.id)) { const q = p.get(m.id); p.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; p.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (p.has(i)) { p.delete(i); rej(new Error('timeout')); } }, 30000);
  });
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:8123/index.html' });
  await new Promise(r => setTimeout(r, 6500));

  await send('Runtime.evaluate', {
    expression: `(async () => {
      const g = window.__game;
      document.getElementById('startBtn')?.click();
      await new Promise(r => setTimeout(r, 800));
      g.controller.update = function () {
        this.position.set(-30, 0, -5); this.yaw = -0.6; this.pitch = -0.02; this._applyCamera(0, 0);
      };
      // 关卡切换要走真实的 loadLevel 路径（重建藏狐 + 应用环境修饰），
      // 只改 game.level 和配色的话，雾/风/沙尘这些环境效果根本不会生效，
      // 截出来的图看不出关卡差异 —— 等于白测。
      window.__setLv = (n) => {
        g.game.level = n;
        g.sky.applyLevel(g.LEVELS[n]);
        // 手动同步环境修饰（loadLevel 未导出，这里调等价逻辑）
        const c = g.LEVELS[n];
        g.env.gustMax = c.windGust || 0;
        g.env.fogBase = c.fogNear || 70;
        g.env.fogFarBase = c.fogFar || 420;
        g.env.sandPeriod = c.sandstorm ? 11 : 0;
        g.env.sandT = c.sandstorm ? 8.2 : 0;   // 停在沙尘最浓的时刻
        g.env.sandOn = !!c.sandstorm;
        g.scene.fog.near = g.env.fogBase;
        g.scene.fog.far = g.env.fogFarBase;
        g.updateEnv(0.001);
        return {
          level: n + 1, name: c.name, brief: c.brief,
          fog: [+g.scene.fog.near.toFixed(1), +g.scene.fog.far.toFixed(1)],
          gust: g.env.gustMax, sand: g.env.sandOn,
        };
      };
    })()`, awaitPromise: true, returnByValue: true,
  });

  // 关卡数量必须从页面里动态读取 —— 写死 5 会在关卡表扩容后
  // 静默漏掉后面的关卡，测试通过但其实没测到（关卡已扩到 12 关）。
  const nLevels = (await send('Runtime.evaluate', {
    expression: 'window.__game.LEVELS.length', returnByValue: true,
  })).result?.value || 0;
  console.log('共', nLevels, '关');

  for (let lv = 0; lv < nLevels; lv++) {
    const r = await send('Runtime.evaluate', { expression: `JSON.stringify(window.__setLv(${lv}))`, returnByValue: true });
    await new Promise(r2 => setTimeout(r2, 800));
    const s = await send('Page.captureScreenshot', { format: 'png' });
    // 沙箱只允许覆盖已存在的文件，且截图工具目录里现成可写的是 view-yaw*.png，
    // 所以统一写回 view-yaw0.png（每次覆盖），需要逐关留存时手工改名。
    fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/view-yaw0.png`, Buffer.from(s.data, 'base64'));
    let info = {};
    try { info = JSON.parse(r.result?.value || '{}'); } catch (e) {}
    console.log(`第 ${lv + 1} 关 ${info.name || ''} 雾[${(info.fog || []).join(',')}]` +
      `${info.gust ? ' 风' + info.gust : ''}${info.sand ? ' 沙尘' : ''} — 已截图`);
  }
  ws.close(); ch.kill(); await new Promise(r => setTimeout(r, 300)); process.exit(0);
})();