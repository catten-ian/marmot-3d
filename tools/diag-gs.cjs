/**
 * GS 版几何自检：不看画面，直接量。
 *
 * 为什么需要：headless 下迭代截图 → 看图 → 猜哪里错，循环太慢且容易误判。
 * 这里把每一层的实际世界变换与高度都打出来，一次定位问题。
 *
 * 检查项：
 *   1. 每个地形 tile 的 world matrix 与包围盒（是否都躺平、都贴地）
 *   2. heightAt 在若干采样点的值 vs 对应 tile 顶点的真实 Y（是否一致）
 *   3. 玩家放在中心时，脚下地面高度与玩家 y 是否吻合
 *   4. GS 三圈的世界包围盒与 y
 *   5. 草的实例位置是否落在地面上
 *
 * 用法：node tools/diag-gs.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9411;
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
  const profile = path.join(os.tmpdir(), 'marmot-diag-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox',
    '--window-size=800,600', 'about:blank',
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
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout')); } }, 180000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 600));
    return r.result?.value;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 13000));

  const ready = await evalJS('typeof window.__gs === "object"');
  if (!ready) {
    console.log('页面未初始化');
    ws.close(); chrome.kill(); await new Promise((r) => setTimeout(r, 300)); process.exit(1);
  }

  const d = await evalJS(`(async function(){
    const THREE = await import('/vendor/three.webgpu.js');
    const g = window.__gs;

    const gm = g.ground.mesh;
    const e = g.ground.extent;

    // 1. 地形 tiles
    const tiles = [];
    gm.children.forEach((t, i) => {
      t.updateMatrixWorld(true);
      let found = null;
      t.traverse(o => { if (!found && o.isMesh) found = o; });
      
      let box = null;
      if (found) {
        found.geometry.computeBoundingBox();
        const b = found.geometry.boundingBox.clone();
        b.applyMatrix4(found.matrixWorld);
        box = { min: b.min.toArray().map(v=>+v.toFixed(1)), max: b.max.toArray().map(v=>+v.toFixed(1)) };
      }
      tiles.push({
        i,
        pos: t.position.toArray().map(v=>+v.toFixed(2)),
        rotDeg: [t.rotation.x, t.rotation.y, t.rotation.z].map(v=>+(v*180/Math.PI).toFixed(0)),
        scale: t.scale.toArray().map(v=>+v.toFixed(2)),
        box,
      });
    });

    // 2. heightAt vs 玩家落地高度
    const probes = [];
    const cx = e.x0 + e.sx/2, cz = e.z0 + e.sz/2;
    for (let i = 0; i < 12; i++) {
      const x = e.x0 + e.sx * ((i*17)%100)/100;
      const z = e.z0 + e.sz * ((i*43)%100)/100;
      probes.push({ x:+x.toFixed(1), z:+z.toFixed(1), h:+g.ground.heightAt(x,z).toFixed(2) });
    }

    // 3. 玩家站在中心：模拟 update 后 y 应该等于 heightAt
    g.walker.placeAt(cx, cz);
    g.walker.update(1/60);
    const walkerAfterUpdate = g.walker.pos.toArray().map(v=>+v.toFixed(2));

    // 4. GS 圈
    const splats = g.splatGroup.children.map((s, i) => {
      s.updateMatrixWorld(true);
      return { i, pos: s.position.toArray().map(v=>+v.toFixed(1)),
        scale: +s.scale.x.toFixed(3),
        rotDeg: [s.rotation.x, s.rotation.y, s.rotation.z].map(v=>+(v*180/Math.PI).toFixed(0)) };
    });

    // 5. 草：取前 5 个实例的世界位置 + 地面高度
    const grass = g.scatter.group.children.find(c => c.isInstancedMesh);
    const m = new THREE.Matrix4();
    const grassSamples = [];
    if (grass) {
      for (let i = 0; i < 5; i++) {
        grass.getMatrixAt(i*7, m);
        const x = m.elements[12], z = m.elements[14], y = m.elements[13];
        grassSamples.push({ x:+x.toFixed(1), z:+z.toFixed(1), y:+y.toFixed(2),
          ground:+g.ground.heightAt(x, z).toFixed(2) });
      }
    }

    return {
      extent: { x0:+e.x0.toFixed(1), z0:+e.z0.toFixed(1),
                sx:+e.sx.toFixed(1), sz:+e.sz.toFixed(1),
                minY:+e.minY.toFixed(1), maxY:+e.maxY.toFixed(1),
                tiles: e.tiles, tileSpan: e.tileSpan.map(v=>+v.toFixed(1)) },
      tiles, probes, walkerAfterUpdate, splats, grassSamples,
      grassCount: grass ? grass.count : 0,
    };
  })()`);

  console.log('======== 地形范围 ========');
  console.log('  ' + JSON.stringify(d.extent));
  console.log('\n======== 地形 tiles 的实际变换 ========');
  console.log('  #   position              rot(XYZ°)        scale');
  for (const t of d.tiles) {
    console.log('  ' + String(t.i).padStart(2) +
      '  ' + JSON.stringify(t.pos).padEnd(21) +
      ' ' + JSON.stringify(t.rotDeg).padEnd(16) +
      ' ' + JSON.stringify(t.scale) +
      (t.box ? '  y[' + t.box.min[1] + '..' + t.box.max[1] + '] x[' + t.box.min[0] + '..' + t.box.max[0] + ']' : ''));
  }

  console.log('\n======== heightAt 采样 ========');
  d.probes.forEach((p) => console.log('  (' + String(p.x).padStart(6) + ', ' + String(p.z).padStart(6) + ') → ' + String(p.h).padStart(7)));

  console.log('\n======== 玩家落地高度 ========');
  console.log('  走一帧后的位置: ' + JSON.stringify(d.walkerAfterUpdate));
  console.log('  （y 应 ≈ heightAt(cx,cz) + 眼高，不应出现 ±10m 级偏差）');

  console.log('\n======== GS 三圈 ========');
  d.splats.forEach((s) => console.log('  #' + s.i + ' pos=' + JSON.stringify(s.pos) +
    ' scale=' + s.scale + ' rot=' + JSON.stringify(s.rotDeg)));

  console.log('\n======== 草的贴地 ========');
  console.log('  可见草株数: ' + d.grassCount);
  d.grassSamples.forEach((g) => console.log('  (' + String(g.x).padStart(6) + ', ' + String(g.z).padStart(6) +
    ')  y=' + String(g.y).padStart(6) + '  地面=' + String(g.ground).padStart(6) +
    '  差=' + (g.y - g.ground).toFixed(2)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
