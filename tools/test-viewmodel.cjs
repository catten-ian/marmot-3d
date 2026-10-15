/** viewmodel 专项诊断：爪子到底在哪、有没有渲染出来 */
const { spawn } = require('child_process');
const http = require('http'); const os = require('os'); const path = require('path'); const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9362;
const get = (u) => new Promise((res, rej) => http.get(u, (r) => { let d = ''; r.on('data', c => d += c); r.on('end', () => res(d)); }).on('error', rej));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpVM-'));
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
  await new Promise(r => setTimeout(r, 7000));

  const expr = `(async () => {
    const g = window.__game;
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    document.getElementById('startBtn')?.click();
    await sleep(900);
    const vm = g.viewModel;
    const out = {};

    // 计算爪子世界坐标与相机投影位置
    const THREE = g.camera.constructor === Object ? null : null;
    const project = (obj) => {
      obj.updateWorldMatrix(true, false);
      const v = new g.camera.position.constructor();
      v.setFromMatrixPosition(obj.matrixWorld);
      // 转 NDC
      const p = v.clone().project(vm.camera);
      return {
        world: [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)],
        ndc: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)],
        onScreen: p.z < 1 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1,
      };
    };

    out.camera = {
      pos: [0, 0, 0],
      fov: vm.camera.fov,
      near: vm.camera.near, far: vm.camera.far,
      aspect: +vm.camera.aspect.toFixed(3),
      rotation: [vm.camera.rotation.x, vm.camera.rotation.y, vm.camera.rotation.z],
    };
    out.root = {
      pos: [+vm.root.position.x.toFixed(3), +vm.root.position.y.toFixed(3), +vm.root.position.z.toFixed(3)],
      visible: vm.root.visible,
      scale: [vm.root.scale.x, vm.root.scale.y, vm.root.scale.z],
    };

    const lPaw = vm.paws.userData.left;
    const rPaw = vm.paws.userData.right;
    out.paws = {
      groupPos: [+vm.paws.position.x.toFixed(3), +vm.paws.position.y.toFixed(3), +vm.paws.position.z.toFixed(3)],
      leftVisible: lPaw.visible,
      leftWorld: project(lPaw),
      rightWorld: project(rPaw),
      childMeshes: lPaw.children.length,
    };

    const lLeg = vm.legs.userData.left;
    out.legs = {
      groupPos: [+vm.legs.position.x.toFixed(3), +vm.legs.position.y.toFixed(3), +vm.legs.position.z.toFixed(3)],
      leftWorld: project(lLeg),
      visible: lLeg.visible,
    };

    // 渲染一次看看三角形数
    g.renderer.render(vm.scene, vm.camera);
    out.vmTriangles = g.renderer.info.render.triangles;
    out.vmCalls = g.renderer.info.render.calls;

    return out;
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  console.log(JSON.stringify(r.result?.value, null, 1));
  ws.close(); chrome.kill();
  await new Promise(r => setTimeout(r, 300));
  process.exit(0);
})();