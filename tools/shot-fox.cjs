/**
 * 狐狸模型视觉验证 —— 近距离对准截图。
 *
 * 为什么必须看画面：之前的验证只查了 `visible` 属性与包围盒尺寸，
 * 全都"正常"，但用户实际看到的是**狐狸根本不存在**。
 * 属性正常 ≠ 渲染正常。可能的原因（属性查不出来）：
 *   · 材质完全透明（opacity 0 / alphaTest 不匹配）
 *   · 贴图是空的但 map 存在（渲染成全黑或全白）
 *   · 面朝向错误 / 缩放极端（缩成一点）
 *   · 被 depthTest 或 renderOrder 挡掉
 *   · 颜色与背景完全一致（草绿狐狸在草地上）
 *
 * 所以这里直接把相机怼到狐狸脸上拍图，逐项排查。
 *
 * 用法：node tools/shot-fox.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

const PORT = 9461;
const URL = 'http://127.0.0.1:8123/index.html';

function findChrome() {
  for (const c of [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean)) if (fs.existsSync(c)) return c;
  return null;
}
const get = (u) => fetch(u, { headers: { Host: '127.0.0.1' } }).then((r) => r.json());

(async () => {
  const CHROME = findChrome();
  if (!CHROME) { console.log('未找到 Chrome/Edge'); process.exit(1); }
  const profile = path.join(os.tmpdir(), 'marmot-fox-' + Date.now());
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
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`D:/gam3/3d/marmot-3d/tools/view-yaw${name}.png`, Buffer.from(s.data, 'base64'));
    console.log('  截图 view-yaw' + name + '.png');
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

  // —— 1. 深度检查狐狸的渲染状态 ——
  console.log('======== 狐狸渲染状态深度检查 ========');
  const deep = await evalJS(`(async function(){
    const THREE = await import('/vendor/three.module.js');
    const g = window.__game;
    const f = g.foxes()[0];
    if (!f) return { err: 'no fox' };

    const info = { type: f.type, modelLevel: f.modelLevel,
      procVisible: f.proceduralMesh ? f.proceduralMesh.visible : null,
      realPresent: !!f.realModel,
      meshWorldPos: f.mesh.position.toArray().map(v=>+v.toFixed(2)),
      meshScale: f.mesh.scale.toArray().map(v=>+v.toFixed(3)),
      meshes: [] };

    // 真实模型：世界包围盒
    if (f.realModel) {
      f.realModel.updateMatrixWorld(true);
      const wb = new THREE.Box3().setFromObject(f.realModel);
      info.realWorldBox = { min: wb.min.toArray().map(v=>+v.toFixed(2)),
                            max: wb.max.toArray().map(v=>+v.toFixed(2)) };
      f.realModel.traverse((o) => {
        if (!o.isMesh) return;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        const m = ms[0];
        const rec = {
          name: o.name || '(未命名)',
          visible: o.visible,
          matType: m ? m.type : 'null',
          opacity: m ? m.opacity : null,
          transparent: m ? m.transparent : null,
          side: m ? m.side : null,
          colorHex: m && m.color ? '#' + m.color.getHexString() : null,
          hasMap: !!(m && m.map),
          mapImage: null,
          mapSize: null,
          emissiveHex: m && m.emissive ? '#' + m.emissive.getHexString() : null,
          depthTest: m ? m.depthTest : null,
          renderOrder: o.renderOrder,
        };
        if (m && m.map && m.map.image) {
          const img = m.map.image;
          rec.mapSize = [img.width || 0, img.height || 0];
          rec.mapImage = img.constructor ? img.constructor.name : typeof img;
          // 贴图是否真的有像素数据
          try {
            if (img.width > 1) {
              const c = document.createElement('canvas');
              c.width = 4; c.height = 4;
              const cx = c.getContext('2d');
              cx.drawImage(img, 0, 0, 4, 4);
              const d = cx.getImageData(0, 0, 4, 4).data;
              // 统计是否全黑 / 全白
              let black=0, white=0;
              for (let i=0;i<d.length;i+=4){ if(d[i]<8&&d[i+1]<8&&d[i+2]<8)black++; if(d[i]>248&&d[i+1]>248&&d[i+2]>248)white++; }
              rec.mapBlackRatio = +(black/16).toFixed(2);
              rec.mapWhiteRatio = +(white/16).toFixed(2);
              rec.mapSample = [d[0], d[1], d[2]];
            }
          } catch (e) { rec.mapReadErr = String(e.message||e); }
        }
        info.meshes.push(rec);
      });
    }

    // 程序化模型的可见性（对照）
    if (f.proceduralMesh) {
      const pb = new THREE.Box3().setFromObject(f.proceduralMesh);
      info.procWorldBox = { min: pb.min.toArray().map(v=>+v.toFixed(2)),
                            max: pb.max.toArray().map(v=>+v.toFixed(2)) };
    }

    // 相机能否看到它
    const frustum = new THREE.Frustum();
    frustum.setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(g.camera.projectionMatrix, g.camera.matrixWorldInverse));
    const pb2 = new THREE.Box3();
    if (f.realModel) pb2.setFromObject(f.realModel);
    else if (f.proceduralMesh) pb2.setFromObject(f.proceduralMesh);
    info.inFrustum = frustum.intersectsBox(pb2);
    info.distToCamera = +g.camera.position.distanceTo(f.mesh.position).toFixed(2);
    return info;
  })()`);

  if (deep.err) { console.log('  错误: ' + deep.err); }
  else {
    console.log('  类型=' + deep.type + '  级别=' + deep.modelLevel);
    console.log('  程序化可见=' + deep.procVisible + '  真实模型存在=' + deep.realPresent);
    console.log('  mesh 世界位置=' + JSON.stringify(deep.meshWorldPos) + '  缩放=' + JSON.stringify(deep.meshScale));
    if (deep.realWorldBox) {
      console.log('  真实模型世界包围盒: ' + JSON.stringify(deep.realWorldBox.min) + ' → ' + JSON.stringify(deep.realWorldBox.max));
    }
    if (deep.procWorldBox) {
      console.log('  程序化包围盒:     ' + JSON.stringify(deep.procWorldBox.min) + ' → ' + JSON.stringify(deep.procWorldBox.max));
    }
    console.log('  在视锥内=' + deep.inFrustum + '  距相机=' + deep.distToCamera + 'm');
    console.log('  网格清单:');
    for (const m of deep.meshes) {
      console.log('    · ' + m.name + ' 可见=' + m.visible + ' 材质=' + m.matType);
      console.log('        颜色=' + m.colorHex + ' 不透明=' + (m.transparent ? '透明' : '是') +
        ' opacity=' + m.opacity + ' 双面=' + (m.side === 2) +
        ' 发光=' + m.emissiveHex + ' 深度测试=' + m.depthTest + ' 渲染序=' + m.renderOrder);
      if (m.hasMap) {
        console.log('        贴图=' + m.mapImage + ' ' + JSON.stringify(m.mapSize) +
          (m.mapBlackRatio !== undefined ? ' 全黑比例=' + m.mapBlackRatio + ' 全白比例=' + m.mapWhiteRatio + ' 采样=' + JSON.stringify(m.mapSample) : ''));
        if (m.mapReadErr) console.log('        贴图读取失败: ' + m.mapReadErr);
      } else {
        console.log('        贴图: 无');
      }
    }
  }

  // —— 2. 把相机怼到狐狸脸上拍图 ——
  console.log('\n======== 近距离截图 ========');
  await evalJS(`(function(){
    const g = window.__game;
    const f = g.foxes()[0];
    // 冻结 AI，防止它跑掉导致拍不到
    f.update = () => {};
    f.x = 0; f.z = 0;
    // 相机放到它前方 3m，略高于视高，正对它
    const c = g.camera;
    c.position.set(0, 1.1, -3.2);
    c.lookAt(0, f.mesh.position.y + 0.55, 0);
    c.updateMatrixWorld(true);
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await shot(0);

  // 再退远一点看全身
  await evalJS(`(function(){
    const g = window.__game;
    const c = g.camera;
    c.position.set(2.6, 1.6, -4.4);
    c.lookAt(0, g.foxes()[0].mesh.position.y + 0.5, 0);
    c.updateMatrixWorld(true);
    return 'ok';
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await shot(45);

  // 顶视：确认它有没有被地面遮住（y 是否在地面之下）
  await evalJS(`(function(){
    const g = window.__game;
    const f = g.foxes()[0];
    const c = g.camera;
    c.position.set(0, f.mesh.position.y + 3.2, 0.01);
    c.lookAt(0, f.mesh.position.y, 0);
    c.updateMatrixWorld(true);
    return { foxY: +f.mesh.position.y.toFixed(2) };
  })()`);
  await new Promise((r) => setTimeout(r, 900));
  await shot(90);

  console.log('\n控制台 error/warning: ' + logs.length);
  logs.slice(0, 8).forEach((l) => console.log('  ' + l.slice(0, 200)));

  ws.close(); chrome.kill();
  await new Promise((r) => setTimeout(r, 300));
  process.exit(0);
})();
