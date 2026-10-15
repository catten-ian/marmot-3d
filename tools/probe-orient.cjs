/**
 * 判定 GLB 模型的正确朝向与尺度。
 *
 * 为什么必须实测：藏狐 GLB 的包围盒是
 *   X=0.933  Y=0.630  Z=0.609
 * —— **Y（高度）不是最大轴**，说明模型是横躺的。
 * 而 `normalizeModel(obj, 1.0)` 假设"最大轴是高度"，
 * 会把横躺的模型当竖立的来缩放，结果就是巨大畸形的肉块。
 *
 * 判定方法（用几何本身的语义，不靠猜）：
 *   · 找到脚底：绝大多数顶点构成的"平面"在哪
 *   · 找到朝向：源 GLB 约定 +Z 为正面，但摄影测量导出的模型常常朝 -Z
 *   · 用贴图辅助判断：把 UV 与顶点位置对齐，看贴图底部对应模型的哪一端
 *
 * 实用做法：对 6 种候选轴向各自算"归一后的可读性"，
 * 取让人看着最自然的那一个（玩家视角看的正面必须能看到脸/纹理细节）。
 *
 * 用法：node tools/probe-orient.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9471;
const URL = 'http://127.0.0.1:8123/index.html';

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
  const profile = path.join(os.tmpdir(), 'marmot-orient-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader', '--window-size=800,600', 'about:blank',
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
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout')); } }, 120000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 500));
    return r.result?.value;
  };
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/view-yaw${name}.png`, Buffer.from(s.data, 'base64'));
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 7000));

  const MODEL = process.argv[2] || './assets/models/fox.glb';
  const results = [];

  // 依次尝试 6 种轴向，每种都归一到"高度 1m"并拍照
  const CANDS = [
    { name: 'A_原样',       e: [0, 0, 0] },
    { name: 'B_X转Y(侧翻)', e: [-Math.PI / 2, 0, 0] },
    { name: 'C_Y转Z(前翻)', e: [0, 0, Math.PI / 2] },
    { name: 'D_Y转X(侧滚)', e: [0, 0, -Math.PI / 2] },
    { name: 'E_X转Z(前倒)', e: [0, 0, -Math.PI / 2] },
    { name: 'F_180度Y',     e: [0, Math.PI, 0] },
  ];

  for (const c of CANDS) {
    const info = await evalJS(`(async function(){
      const THREE = await import('/vendor/three.module.js');
      const { GLTFLoader } = await import('/vendor/addons/loaders/GLTFLoader.js');
      const g = window.__game;
      // 清场：只留一个测试对象
      if (!window.__probe) window.__probe = new THREE.Group();
      window.__probe.parent && window.__probe.parent.remove(window.__probe);
      window.__probe.clear();
      g.scene.add(window.__probe);
      window.__probe.position.set(g.camera.position.x, 0, g.camera.position.z - 3.2);

      const geo = await new GLTFLoader().loadAsync(${JSON.stringify(MODEL)});
      const obj = geo.scene;
      obj.rotation.set(${c.e[0]}, ${c.e[1]}, ${c.e[2]});
      obj.updateMatrixWorld(true);
      // 归一到"高度 1m"：这里用**竖直轴（世界 Y）**而不是"最大轴"，
      // 因为只有世界 Y 才是玩家看到的高度方向
      const b0 = new THREE.Box3().setFromObject(obj);
      const sy = b0.max.y - b0.min.y;
      const wrap = new THREE.Group();
      const inner = new THREE.Group();
      wrap.add(inner); inner.add(obj);
      if (sy > 1e-4) inner.scale.setScalar(1 / sy);
      inner.updateMatrixWorld(true);
      wrap.updateMatrixWorld(true);
      // 脚底贴到 probe 的 y=0
      const b1 = new THREE.Box3().setFromObject(wrap);
      inner.position.y -= b1.min.y;
      wrap.updateMatrixWorld(true);
      window.__probe.add(wrap);
      g.__probeWrap = wrap;

      const bb = new THREE.Box3().setFromObject(wrap);
      const sz = bb.getSize(new THREE.Vector3());
      const s2 = sz.clone().toArray().map(v => +v.toFixed(3));

      // 相机对准
      const c2 = g.camera;
      const center = bb.getCenter(new THREE.Vector3());
      c2.position.set(center.x + 1.1, center.y + 0.5, center.z + 2.2);
      c2.lookAt(center);
      c2.updateMatrixWorld(true);
      return { size: s2, scaleApplied: +(1/sy).toFixed(3), srcY: +sy.toFixed(3),
        tris: (() => { let n=0; geo.scene.traverse(o=>{if(o.isMesh){const i=o.geometry.index;n+=(i?i.count:o.geometry.attributes.position.count)/3;}}); return Math.round(n); })() };
    })()`);
    await new Promise((r) => setTimeout(r, 700));
    const idx = ['0', '45', '90', '135'][results.length % 4];
    await shot(idx);
    results.push({ ...c, ...info });
    console.log(`  ${c.name.padEnd(16)} 源Y高=${info.srcY}  归一后尺寸=${JSON.stringify(info.size)}  scale=${info.scaleApplied}`);
  }

  console.log('\n======== 判定 ========');
  console.log('  合��"体型像狐狸"的候选：长>高>宽（躯干长、站立高度居中、宽度最窄）');
  results.forEach((r) => {
    const [x, y, z] = r.size;
    // 长宽比与高宽比
    const lw = x / Math.max(z, 1e-3);
    const wh = y / Math.max(z, 1e-3);
    // 四足动物典型比例：长/高 ≈ 1.6~2.6，高/宽 ≈ 1.2~2.0
    const ok = lw >= 1.4 && lw <= 3.0 && wh >= 1.0 && wh <= 2.6;
    console.log(`  ${ok ? '✓' : ' '} ${r.name.padEnd(16)} 长/宽=${lw.toFixed(2)} 高/宽=${wh.toFixed(2)}`);
  });

  console.log('\n  截图对应: 候选0→view-yaw0.png, 候选1→view-yaw45.png, 候选2→view-yaw90.png, 候选3→view-yaw135.png');

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
