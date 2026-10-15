/**
 * GS 版截图：强制 WebGL2 后端（headless 无 WebGPU），验证真实画面。
 *
 * 这只能验证**场景组装与视觉**，不能验证 WebGPU 渲染路径 ——
 * 两者用的是同一个 GaussianSplat 数据与着色逻辑，所以画面内容可信，
 * 但帧率与深度排序质量在真机上才会不同。
 *
 * 用法：node tools/shot-gs.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9391;
const URL = 'http://127.0.0.1:8123/gs.html?webgl=1';

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
  const profile = path.join(os.tmpdir(), 'marmot-gsshot-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--window-size=1280,720', 'about:blank',
  ], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { t = (await get(`http://127.0.0.1:${PORT}/json/list`)).find((x) => x.type === 'page'); if (t) break; } catch (e) {}
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const logs = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const q = pend.get(m.id); pend.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
      logs.push('[' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    }
  });
  const send = (me, pa = {}) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method: me, params: pa }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 180000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 400));
    return r.result?.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    // 沙箱只允许覆盖已存在的文件
    fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/view-yaw${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('  截图: view-yaw' + name + '.png');
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  console.log('等待初始化（WebGL2 后端下 SPZ 解析约需 1~2 秒）…');
  await new Promise((r) => setTimeout(r, 14000));

  const st = await evalJS(`(function(){
    return {
      gate: !document.getElementById('gate').classList.contains('hidden'),
      gateTitle: document.getElementById('gateTitle').textContent,
      menu: !document.getElementById('menu').classList.contains('hidden'),
      bootStep: document.getElementById('bootStep').textContent,
      hasGs: typeof window.__gs === 'object',
      hudMode: document.getElementById('hudMode').textContent,
    };
  })()`);
  console.log('页面状态: ' + JSON.stringify(st, null, 1));
  if (!st.hasGs) {
    console.log('未初始化成功，无法截图。控制台:');
    logs.slice(0, 10).forEach((l) => console.log('  ' + l.slice(0, 200)));
    ws.close(); chrome.kill(); await new Promise((r) => setTimeout(r, 300)); process.exit(1);
  }

  const info = await evalJS(`(function(){
    const g = window.__gs;
    const c = g.camera;
    let splatTris = 0, meshes = 0;
    g.scene.traverse(o => { if (o.isMesh || o.isInstancedMesh) meshes++; });
    return {
      backend: g.state.backend,
      splatCount: g.state.splatCount,
      splatInfo: g.splatInfo,
      splatChildren: g.splatGroup ? g.splatGroup.children.length : 0,
      meshes,
      walker: g.walker.pos.toArray().map(v => +v.toFixed(2)),
      groundSize: [g.ground.extent.size.x, g.ground.extent.size.z].map(v => +v.toFixed(0)),
      groundY: { min: +g.ground.extent.minY.toFixed(2), max: +g.ground.extent.maxY.toFixed(2) },
      hAtCenter: +g.ground.heightAt(
        g.ground.extent.x0 + g.ground.extent.sx / 2,
        g.ground.extent.z0 + g.ground.extent.sz / 2).toFixed(2),
      splatY: g.splatGroup.children.map(o => +o.position.y.toFixed(1)),
      splatScale: g.splatGroup.children.map(o => +o.scale.x.toFixed(3)),
      grassVisible: g.scatter.group.children[0] ? g.scatter.group.children[0].count : 0,
      camPos: c.position.toArray().map(v => +v.toFixed(2)),
      fog: [g.scene.fog.near, g.scene.fog.far],
    };
  })()`);
  console.log('场景信息: ' + JSON.stringify(info, null, 1));

  await shot(0);   // 菜单

  // 进游戏（否则菜单会挡住整个画面）
  await evalJS(`(function(){
    document.getElementById('btnFree').click();
    return 'entered';
  })()`);
  await new Promise((r) => setTimeout(r, 1500));

  // 平视：看草和近处细节
  await evalJS(`(function(){
    const g = window.__gs;
    const e = g.ground.extent;
    g.walker.placeAt(e.x0 + e.sx * 0.5, e.z0 + e.sz * 0.55);
    g.walker.yaw = Math.PI;
    g.walker.pitch = -0.08;
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 1400));
  await shot(45);

  // 站上高处的俯瞰视角
  await evalJS(`(function(){
    const g = window.__gs;
    const e = g.ground.extent;
    // 找一个较高的点站上去
    let best = e.minY, bx = 0, bz = 0;
    for (let i = 0; i < 300; i++) {
      const x = e.x0 + e.sx * ((i * 37) % 100) / 100;
      const z = e.z0 + e.sz * ((i * 61) % 100) / 100;
      const h = g.ground.heightAt(x, z);
      if (h > best) { best = h; bx = x; bz = z; }
    }
    g.walker.placeAt(bx, bz);
    g.walker.pitch = -0.16;
    return { best: +best.toFixed(1) };
  })()`);
  await new Promise((r) => setTimeout(r, 1400));
  await shot(90);

  // 转向另一个方向，检查 360° 都有内容
  await evalJS(`(function(){ window.__gs.walker.yaw += Math.PI * 0.6; window.__gs.walker.pitch = 0.02; return 'ok'; })()`);
  await new Promise((r) => setTimeout(r, 1400));
  await shot(135);

  console.log('\n控制台 error/warning: ' + logs.length);
  logs.slice(0, 10).forEach((l) => console.log('  ' + l.slice(0, 200)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
