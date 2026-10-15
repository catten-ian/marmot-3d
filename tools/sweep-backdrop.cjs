/**
 * 远景参数扫描：一次会话内遍历多组 (radius, scaleY, sinkY, scale)，
 * 每个组合从 4 个方向各拍一张，输出到 tools/sweep/。
 *
 * 用途：手工试参数太慢且容易来回震荡，一次扫完直接看图挑。
 * 用法：node tools/sweep-backdrop.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9361;
// 注意：不要新建子目录 —— 沙箱可能拒绝写入新目录，直接落在 tools/ 下
const OUT = 'D:/gam3/3d/marmot-3d/tools';
const BASE = 'http://127.0.0.1:8123/index.html';

// 待扫描的组合：注意 scaleY 是**垂直压扁系数**
// 通过命令行参数选组：node tools/sweep-backdrop.cjs B D
const ALL = {
  A: { name: 'A', radius: 110, scale: 7.0, scaleY: 0.30, sink: -2.0 },
  B: { name: 'B', radius: 130, scale: 8.0, scaleY: 0.40, sink: -3.0 },
  C: { name: 'C', radius: 110, scale: 7.0, scaleY: 0.60, sink: -4.5 },
  D: { name: 'D', radius: 130, scale: 8.0, scaleY: 0.85, sink: -6.5 },
  E: { name: 'E', radius: 150, scale: 9.0, scaleY: 0.55, sink: -5.0 },
  F: { name: 'F', radius: 100, scale: 6.5, scaleY: 0.75, sink: -5.5 },
};
const COMBOS = (process.argv.slice(2).filter(a => ALL[a])).map(a => ALL[a]);

const YAWS = [0, 90, 180, 270];

function findChrome() {
  for (const c of [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ]) if (fs.existsSync(c)) return c;
  return null;
}
const get = (u) => fetch(u, { headers: { Host: '127.0.0.1' } }).then((r) => r.json());

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-sweep-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { t = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 60000);
  });

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: BASE });
  await new Promise((r) => setTimeout(r, 7000));

  // 进游戏
  await send('Runtime.evaluate', {
    expression: "(function(){const b=[...document.querySelectorAll('button')].find(x=>/开始|进入|start/i.test(x.textContent));if(b)b.click();return !!b;})()",
    returnByValue: true,
  });
  await new Promise((r) => setTimeout(r, 3500));

  // 隐藏 HUD，避免文字干扰看图
  await send('Runtime.evaluate', {
    expression: "(function(){const ids=['hud','ui','overlay','hudRoot'];for(const i of ids){const e=document.getElementById(i);if(e)e.style.opacity='0';}document.querySelectorAll('.panel,#panel,.banner,.toast').forEach(e=>e.style.display='none');})()",
    returnByValue: true,
  });

  for (const c of COMBOS) {
    const applied = await send('Runtime.evaluate', {
      expression: `(function(){const g=window.__game;const b=g.backdrop();if(!b)return 'no-backdrop';
        const R=${c.radius}, S=${c.scale}, SY=${c.scaleY}, SK=${c.sink};
        b.children.forEach((p,i)=>{
          const n=b.children.length;
          const a=i/n*Math.PI*2;
          const s=S*(1+(i%3-1)*0.10);
          p.scale.set(s, s*SY, s);
          p.position.set(Math.sin(a)*R, SK + (i%2?0.9:-0.5), Math.cos(a)*R);
        });
        return 'ok';})()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 700));
    for (const y of YAWS) {
      await send('Runtime.evaluate', {
        expression: `(function(){const g=window.__game;g.controller.position.x=0;g.controller.position.z=0;g.controller.yaw=${y}*Math.PI/180;g.controller.pitch=0.02;})()`,
        returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 500));
      const s = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, `view-yaw${y}.png`), Buffer.from(s.data, 'base64'));
    }
    console.log(`组合 ${c.name} (r=${c.radius} s=${c.scale} sy=${c.scaleY} sink=${c.sink}) → ${applied.result?.value}`);
  }

  console.log('输出目录:', OUT);
  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
