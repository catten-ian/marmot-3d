/**
 * 把狐狸拍进画面 —— 视觉验证的**唯一可靠手段**。
 *
 * 上一轮的教训：属性检查（visible / 包围盒 / 贴图像素）全部"正常"，
 * 但画面里是一坨横躺的畸形肉块。**属性证明不了模型是否正确**。
 *
 * 关键做法（上一版脚本的错法）：
 *   ✗ 改 camera.position —— 主循环每帧用 controller.update 覆盖白改
 *   ✓ **把狐狸搬到玩家正前方**，让主循环自己渲染它
 *
 * 同时把玩家传送到场地中央、暂停 AI，确保狐狸不会跑掉。
 *
 * 用法：node tools/shot-fox2.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9481;
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
  const profile = path.join(os.tmpdir(), 'marmot-fox2-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--enable-unsafe-swiftshader',
    '--window-size=1000,640', 'about:blank',
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
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error('timeout ' + me)); } }, 120000);
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 500));
    return r.result?.value;
  };
  // 像素统计：判断"狐狸到底画出来没有"，不靠肉眼猜。
  // 做法：直接在页面里把 canvas 画到 2D canvas，统计中心区域的非黑像素。
  const probePixels = async () => evalJS(`(function(){
    const src = document.getElementById('scene');
    const W = 200, H = 130;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const cx = c.getContext('2d');
    // 取画面中央区域（正对狐狸的地方）
    const sx = Math.floor(src.width * 0.25), sy = Math.floor(src.height * 0.15);
    const sw = Math.floor(src.width * 0.5), sh = Math.floor(src.height * 0.55);
    cx.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    let lit = 0, sum = 0, maxv = 0;
    const hist = {};
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i+1] + d[i+2]) / 3;
      sum += v;
      if (v > maxv) maxv = v;
      if (v > 28) lit++;                     // 非黑像素占比
      const key = d[i] + ',' + d[i+1] + ',' + d[i+2];
      hist[key] = (hist[key] || 0) + 1;
    }
    const total = d.length / 4;
    // 主色（排除 UI 干扰，取像素最多的颜色）
    const top = Object.entries(hist).sort((a,b)=>b[1]-a[1]).slice(0,3)
      .map(([k,v]) => k + ':' + (v/total*100).toFixed(0) + '%');
    return { litRatio: +(lit/total).toFixed(3), avg: +(sum/total).toFixed(1),
      max: maxv, topColors: top };
  })()`);

  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/view-yaw${name}.png`, Buffer.from(s.data, 'base64'));
    const px = await probePixels();
    const hasFox = px.litRatio > 0.02;
    console.log('  截图 view-yaw' + name + '.png   非黑像素=' +
      (px.litRatio * 100).toFixed(1) + '%  平均亮度=' + px.avg +
      '  最亮=' + px.max + (hasFox ? '  ← 有内容 ✅' : '  ← 全黑 ❌ 没画出来'));
    if (px.topColors.length) console.log('      主色: ' + px.topColors.join('  '));
    return px;
  };

  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: URL });
  await new Promise((r) => setTimeout(r, 7000));

  // 进游戏
  await evalJS(`(function(){
    const b=[...document.querySelectorAll('button')].find(x=>/开始|进入|start/i.test(x.textContent));
    if(b)b.click(); return !!b;
  })()`);
  await new Promise((r) => setTimeout(r, 3000));

  // 关掉所有会遮挡视线的面板
  await evalJS(`(function(){
    document.querySelectorAll('.panel,#panel,.banner,.toast,.teach,.brief')
      .forEach(e => e.style.display = 'none');
    return 'ok';
  })()`);

  // 把玩家 + 狐狸一起摆到场地中央，狐狸在玩家正前方 2.6m
  const setup = await evalJS(`(function(){
    const g = window.__game;
    // 关键教训：teleport(x, z) 只设 XZ，**Y 会被主循环按地形重算**。
    // 所以不能假设玩家在 y=0 —— 上一版把狐狸放在 y≈0 而相机在 y=-2.46，
    // 结果狐狸落到屏幕下方之外（NDC y=-1.26），画面里当然看不到。
    // 正确做法：等主循环跑几帧把玩家落到地形上，再按**玩家视高**摆狐狸。
    g.controller.teleport(0, 0, 0);
    g.controller.yaw = 0;              // yaw=0 面向 +Z
    g.controller.pitch = -0.05;

    // 冻结狐狸 AI 的**移动**，但保留 mesh 变换更新
    const fox = g.foxes()[0];
    if (!fox) return { err: 'no fox' };
    fox.update = (dt, p, safe, cfg, burrow, terrainAt) => {
      fox.mesh.position.set(fox.x, fox.baseY, fox.z);
      fox.mesh.rotation.y = fox.yaw;
    };
    // 记下玩家真实视高（主循环会填）
    g.__placeFox = () => {
      const cam = g.camera;
      const eye = cam.position.y;
      // 狐狸放在玩家正前方 2.8m，脚底踩在它自己的地面上
      fox.x = cam.position.x;
      fox.z = cam.position.z + 2.8;
      // 关键：**必须用玩家脚下的地面高度**，而不是让狐狸自己落地。
      // 上一版让狐狸自己算 baseY（= +0.19），而相机在 -2.46，
      // 两者差 2.65m —— 狐狸直接落到屏幕下方之外，怎么调都拍不到。
      // 玩家脚下的地面 = 相机 y − 视高。
      const EYE = 0.46;
      fox.baseY = eye - EYE;
      fox.mesh.position.set(fox.x, fox.baseY, fox.z);
      fox.mesh.rotation.y = Math.PI;      // 面朝玩家
      fox.mesh.updateMatrixWorld(true);
      return { eye: +eye.toFixed(2), foxY: +fox.baseY.toFixed(2) };
    };
    return { ok: true, foxLevel: fox.modelLevel, foxReal: !!fox.realModel };
  })()`);
  console.log('场景布置: ' + JSON.stringify(setup));
  // 让主循环先把玩家落到地形上
  await new Promise((r) => setTimeout(r, 1500));
  const placed = await evalJS('JSON.stringify(window.__game.__placeFox())');
  console.log('  玩家视高 ' + placed);
  await new Promise((r) => setTimeout(r, 600));

  // —— 关键诊断：渲染前后对比，确认它到底在不在画面里 ——
  const diag = await evalJS(`(async function(){
    const THREE = await import('/vendor/three.module.js');
    const g = window.__game;
    const f = g.foxes()[0];
    f.mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(f.mesh);
    const sz = box.getSize(new THREE.Vector3());
    const ctr = box.getCenter(new THREE.Vector3());

    // 相机投影到屏幕坐标，确认它在画面内
    const p = ctr.clone().project(g.camera);
    const inFrustum = p.x > -1 && p.x < 1 && p.y > -1 && p.y < 1 && p.z < 1;

    // 层级链：mesh 下有没有 realModel？realModel 的 worldMatrix 是否有效？
    const chain = [];
    let o = f.mesh;
    let depth = 0;
    while (o && depth < 6) {
      chain.push({
        name: o.name || o.type,
        visible: o.visible,
        scale: o.scale.toArray().map(v=>+v.toFixed(3)),
        pos: o.position.toArray().map(v=>+v.toFixed(2)),
        childMeshes: (()=>{let n=0;o.traverse(x=>{if(x.isMesh)n++;});return n;})(),
      });
      o = o.children[0];
      depth++;
    }
    // 材质检查
    const mats = [];
    f.mesh.traverse(o => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m) { mats.push({ err: 'null material' }); return; }
      mats.push({
        name: o.name, type: m.type, visible: o.visible,
        worldY: +o.getWorldPosition(new THREE.Vector3()).y.toFixed(2),
        opacity: m.opacity, transparent: m.transparent,
        color: m.color ? '#'+m.color.getHexString() : null,
        mapSize: m.map && m.map.image ? [m.map.image.width, m.map.image.height] : null,
        matWorldScale: (()=>{const v=new THREE.Vector3();o.getWorldScale(v);return v.toArray().map(x=>+x.toFixed(2));})(),
      });
    });
    return {
      meshWorld: f.mesh.position.toArray().map(v=>+v.toFixed(2)),
      boxMin: box.min.toArray().map(v=>+v.toFixed(2)),
      boxMax: box.max.toArray().map(v=>+v.toFixed(2)),
      boxSize: sz.toArray().map(v=>+v.toFixed(2)),
      ndc: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(3)],
      inFrustum,
      camPos: g.camera.position.toArray().map(v=>+v.toFixed(2)),
      dist: +g.camera.position.distanceTo(box.getCenter(new THREE.Vector3())).toFixed(2),
      chain, mats,
      realVisible: f.realModel ? f.realModel.visible : null,
      procVisible: f.proceduralMesh.visible,
      renderInfo: { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles },
    };
  })()`);
  console.log('\n======== 渲染诊断 ========');
  console.log('  mesh 世界位置: ' + JSON.stringify(diag.meshWorld));
  console.log('  包围盒: ' + JSON.stringify(diag.boxMin) + ' → ' + JSON.stringify(diag.boxMax));
  console.log('  尺寸: ' + JSON.stringify(diag.boxSize));
  console.log('  NDC: ' + JSON.stringify(diag.ndc) + '  在视锥内: ' + diag.inFrustum);
  console.log('  相机: ' + JSON.stringify(diag.camPos) + '  距离: ' + diag.dist + 'm');
  console.log('  真实模型可见: ' + diag.realVisible + '   程序化可见: ' + diag.procVisible);
  console.log('  本帧绘制: ' + diag.renderInfo.calls + ' 次调用 / ' + diag.renderInfo.tris + ' 三角面');
  console.log('  层级链:');
  diag.chain.forEach((n, i) => console.log('    ' + '  '.repeat(i) + '· ' + n.name +
    ' 可见=' + n.visible + ' 缩放=' + JSON.stringify(n.scale) + ' 位置=' + JSON.stringify(n.pos) +
    ' 网格数=' + n.childMeshes));
  console.log('  材质:');
  diag.mats.forEach(m => console.log('    ' + JSON.stringify(m)));

  // —— 清场：隐藏除狐狸外的一切 ——
  // 目的是排除"被别的物体挡住 / 深度冲突"这类干扰，
  // 让判断只剩"这个模型本身能不能画出来"。
  await evalJS(`(function(){
    const g = window.__game;
    const fox = g.foxes()[0];
    g.scene.children.forEach((c) => {
      let inFoxChain = false;
      let o = c;
      while (o) { if (o === fox.mesh) { inFoxChain = true; break; } o = o.parent; }
      c.visible = inFoxChain;
    });
    if (fox.proceduralMesh) fox.proceduralMesh.visible = false;
    if (fox.realModel) fox.realModel.visible = true;
    if (fox.hpBar) fox.hpBar.visible = false;
    if (fox.warn) fox.warn.visible = false;
    return 'cleared';
  })()`);

  // 正对狐狸拍
  await evalJS(`(function(){
    const g = window.__game;
    g.__placeFox();
    g.controller.yaw = 0; g.controller.pitch = -0.06;
    g.camera.updateMatrixWorld(true);
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot(0);

  // 侧后方 45°
  await evalJS(`(function(){
    const g = window.__game;
    g.controller.yaw = Math.PI * 0.25;
    g.controller.pitch = -0.12;
    g.camera.updateMatrixWorld(true);
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot(45);

  // 俯视：确认它是"站着的"而不是"躺着的"
  await evalJS(`(function(){
    const g = window.__game;
    g.__placeFox();
    g.controller.yaw = 0; g.controller.pitch = -0.45;
    g.camera.updateMatrixWorld(true);
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot(90);

  // 让程序化模型显示出来做对照（真实模型隐藏）
  await evalJS(`(function(){
    const g = window.__game;
    g.__placeFox();
    const f = g.foxes()[0];
    f.proceduralMesh.visible = true;
    if (f.realModel) f.realModel.visible = false;
    g.controller.yaw = 0; g.controller.pitch = -0.06;
    g.camera.updateMatrixWorld(true);
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  await shot(135);
  console.log('  （第 4 张是程序化模型，用于与真实模型对比大小）');

  console.log('\n控制台 error/warning: ' + logs.length);
  logs.slice(0, 6).forEach((l) => console.log('  ' + l.slice(0, 200)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
