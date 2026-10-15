/**
 * WebGPU 高斯泼溅版 —— 主逻辑。
 *
 * 与主版本（index.html / WebGL）完全独立，两套代码互不影响：
 *   主版本：WebGLRenderer + 程序化地形 + 玩法系统
 *   本版本：WebGPURenderer + 摄影测量高斯泼溅 + 可行走实景
 *
 * 组合方式：
 *   地面     —— terrain-lod.glb（摄影测量网格，顶点色）铺成可行走地形
 *   远景     —— scene.spz（约 98 万高斯泼溅，实测仅 SH0 基色）铺成环状远景
 *   散布物   —— 草 / 花 / 石头（真实几何，GS 里的树没有碰撞深度）
 *
 * 为什么地面不用 GS：SPZ 里的地面同样没有可用深度，无法支撑行走；
 * 而网格有真实几何，能做高度采样与碰撞。
 */

import * as THREE from 'three';
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js';
import { SPZLoader } from 'three/addons/loaders/SPZLoader.js';
import { detectWebGPU, createRenderer, backendOf, forceWebGL } from './bootstrap.js';
import { buildGround } from './terrain.js';
import { scatterGround } from './scatter.js';
import { Walker } from './walker.js';

const $ = (id) => document.getElementById(id);

// ————————————————————————————————————————
// UI 辅助
// ————————————————————————————————————————
function setBoot(pct, step) {
  $('bootFill').style.width = pct + '%';
  if (step) $('bootStep').textContent = step;
}
function showGate(title, msg, detail, icon = '⚠') {
  $('boot').classList.add('hidden');
  $('gateIcon').textContent = icon;
  $('gateTitle').textContent = title;
  $('gateMsg').textContent = msg;
  $('gateDetail').textContent = detail || '';
  $('gate').classList.remove('hidden');
}

const state = {
  backend: 'webgpu',
  splatCount: 0,
  ready: false,
  started: false,
  showHelp: false,
};

// ————————————————————————————————————————
// 启动
// ————————————————————————————————————————
async function boot() {
  const canvas = $('view');

  // —— 1. WebGPU 能力检测 ——
  // ?webgl=1 可强制走 WebGL2 后端（用于无 GPU 环境下的视觉验证）
  const fb = forceWebGL();
  setBoot(4, fb ? '强制 WebGL2 模式…' : '检测 WebGPU 支持…');
  if (!fb) {
    const gpu = await detectWebGPU();
    if (!gpu.ok) {
      showGate(
        '此版本需要 WebGPU',
        '高斯泼溅在 three.js 里只能通过 WebGPURenderer 渲染。你的浏览器当前不可用 WebGPU，主游戏（WebGL 版）不受影响。',
        gpu.info + '\n\n检测结论: ' + gpu.reason +
          '\n\n提示：加 ?webgl=1 参数可强制用 WebGL2 后端打开（能看画面，但深度排序退回 CPU，会有噪点）'
      );
      return;
    }
  }

  // —— 2. 渲染器 ——
  setBoot(12, '初始化渲染器…');
  let renderer;
  try {
    renderer = await createRenderer(canvas, { forceWebGL: fb });
  } catch (e) {
    showGate(
      '渲染器初始化失败',
      '创建 WebGPURenderer 时出错。',
      (e && e.stack ? e.stack : String(e))
    );
    return;
  }
  state.backend = backendOf(renderer);
  state.forcedWebGL = fb && state.backend === 'webgl';
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  // —— 3. 场景与相机 ——
  setBoot(20, '构建场景…');
  const scene = new THREE.Scene();
  // 雾要**远端贴近天空色**，地平线附近才能完全溶掉 GS 圈的边界。
  // near 取得比较大（>60m）是为了不雾掉近处的草与地形细节。
  const skyColor = new THREE.Color(0xa9c0b2);
  scene.background = skyColor;
  scene.fog = new THREE.Fog(skyColor, 58, 230);

  const camera = new THREE.PerspectiveCamera(
    62, window.innerWidth / window.innerHeight, 0.08, 3000
  );

  // —— 4. 地形（可行走） ——
  setBoot(28, '加载可行走地形…');
  const ground = await buildGround({ tilesX: 3, tilesZ: 3 });

  // 地形坐标系：以中心为原点，XZ 取包围盒范围
  const bMinX = ground.extent.x0;
  const bMaxX = ground.extent.x0 + ground.extent.sx;
  const bMinZ = ground.extent.z0;
  const bMaxZ = ground.extent.z0 + ground.extent.sz;
  scene.add(ground.mesh);

  // —— 5. 光照 ——
  // 贴地第一人称里，主光方向不对会直接影响"能不能看清脚下的草"：
  // 这里让太阳偏高偏侧，避免地面全在阴影里。
  const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
  sun.position.set(48, 78, 32);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 260;
  const S = 90;
  sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
  sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  const hemi = new THREE.HemisphereLight(0xcfe0f0, 0x5c6647, 1.15);
  scene.add(hemi);
  const fill = new THREE.AmbientLight(0xd8e2d0, 0.42);
  scene.add(fill);

  // —— 6. 散布物 ——
  setBoot(46, '散布草地与岩石…');
  // 75×75 = 5625 m²，1.1 万株草约 2 株/m² —— 对草原来说偏稀，
  // 提到 4.2 万（约 7.5 株/m²）才连成片。近处靠裁剪半径控制开销。
  const scatter = scatterGround({
    heightAt: ground.heightAt,
    extent: ground.extent,
    grassCount: 42000,
    rockCount: 150,
    flowerCount: 2600,
    cullRadius: 34,
  });
  scene.add(scatter.group);

  // —— 7. 高斯泼溅远景 ——
  setBoot(58, '加载高斯泼溅（98 万点，约需几秒）…');
  const splatGroup = new THREE.Group();
  splatGroup.name = 'splatBackdrop';
  let splatInfo = null;
  try {
    const geo = await new SPZLoader().loadAsync('./assets/splats/scene.spz');
    const count = geo.attributes.position ? geo.attributes.position.count : 0;
    state.splatCount = count;

    // scale 按 SPZ 的真实尺度推算，让远景水平跨度对齐地形可活动范围。
    //
    // 轴向（离线探针 tools/probe-spz-axes-node.cjs 实测，务必不要凭 PLY 经验猜）：
    //   **源 Z 是竖直轴**（分层分布熵最小），源 X/Y 才是地面平面：
    //     源 X 横跨（跨度 779）、源 Y 纵深（跨度 1047，最大）。
    //   因此水平跨度必须取源 X/Y；旋转用 -π/2（见下），与 gs/world.js 一致。
    //   早期代码把源 Z 当地面纵深、旋转用 +π/2 —— 两个错叠加，地图横躺且居中错位。
    const sbb = geo.boundingBox || (geo.computeBoundingBox(), geo.boundingBox);
    const srcSpanX = Math.max(1, sbb.max.x - sbb.min.x);
    const srcSpanY = Math.max(1, sbb.max.y - sbb.min.y);
    const srcCenterX = (sbb.min.x + sbb.max.x) / 2;
    const srcCenterY = (sbb.min.y + sbb.max.y) / 2;
    // 竖直方向（源 Z）的"地面层"取低分位：max/min 会被树冠/低点拉偏，
    // p20 稳定落在草皮这一层（实测约 -7.5）。远景环按它对齐到地平线高度。
    const pa = geo.attributes.position.array;
    const zVals = new Float64Array(pa.length / 3);
    for (let i = 0, j = 0; i < pa.length; i += 3, j++) zVals[j] = pa[i + 2];
    zVals.sort();
    const groundZ = zVals[Math.floor(zVals.length * 0.2)];
    const targetSpan = Math.max(ground.extent.sx, ground.extent.sz) * 1.55;
    const baseScale = targetSpan / Math.max(srcSpanX, srcSpanY);

    // 关键：**不能 clone GaussianSplat 的 Mesh**。
    // 它的 material 是 TSL NodeMaterial，clone 时无法正确复制，
    // 后续访问属性会抛 "Cannot read properties of undefined"。
    // 正确做法是复用同一份 geometry，逐圈 new GaussianSplat(geo)，
    // 98 万点的几何体共享一份，显存不翻倍。
    // y 的取法：**压到地形底面之下**。
    // 地形 minY = 0，所以从 -2 起 —— 让远景只露出树冠与上缘，
    // 下半截埋进地平线，接缝被地形本身遮住。
    // （若按 SPZ 的世界 Y 直接摆，源场景的 Y 跨度有 ±500 单位，
    //   会导致整片远景悬浮在半空或埋到看不见。）
    // 三圈的 y 必须**拉开足够间距**（这里 5m / 13m）。
    // 之前只隔 4~6m，叠在一起时会互相穿插，
    // 表现为"地面突然穿透到地平线以下"的一大片浅色区域。
    const gy = ground.extent.minY;
    const rings = [
      { k: 1.00, y: gy - 2.0 },
      { k: 1.45, y: gy - 5.5 },
      { k: 2.05, y: gy - 13.0 },
    ];
    for (const r of rings) {
      const g = new GaussianSplat(geo);
      // 源 Z 竖直、源 Y 纵深：绕 X 轴 -90°（局部 (X,Y,Z) → 世界 (X,Z,-Y)）。
      // 与 gs/world.js 的 applyGsOrientation 保持同一方向，绝不能用 +π/2（地图会横躺）。
      g.rotation.set(-Math.PI / 2, 0, 0);
      const sc = baseScale * r.k;
      g.scale.setScalar(sc);
      // 旋转后：worldX = sc·X - sc·srcCenterX（横跨居中）
      //         worldZ = -sc·Y + sc·srcCenterY（纵深居中，注意 + 号）
      //         worldY = sc·Z + py；让地面层 groundZ 落在该圈的锚定高度 r.y
      g.position.set(
        -srcCenterX * sc,
        r.y - groundZ * sc,
        srcCenterY * sc,
      );
      g.updateMatrixWorld(true);
      splatGroup.add(g);
    }
    scene.add(splatGroup);

    splatInfo = {
      count,
      srcSpan: [+srcSpanX.toFixed(0), +srcSpanY.toFixed(0)],
      baseScale: +baseScale.toFixed(4),
      groundZ: +groundZ.toFixed(1),
      rings: rings.length,
      // 实测该 SPZ 只有 SH0（无高阶球谐），不要对外宣称有球谐光照
      shDegree: geo.getAttribute('sphericalHarmonics3') ? 3
        : geo.getAttribute('sphericalHarmonics2') ? 2
        : geo.getAttribute('sphericalHarmonics1') ? 1 : 0,
    };
  } catch (e) {
    console.warn('[gs] 高斯泼溅加载失败：', e);
    // 失败不阻断：地面 + 散布物本身也能走，只是少了远处的真实草甸
  }

  // —— 8. 控制器 ——
  const walker = new Walker(camera, canvas, {
    heightAt: ground.heightAt,
    bounds: { minX: bMinX + 3, maxX: bMaxX - 3, minZ: bMinZ + 3, maxZ: bMaxZ - 3 },
  });
  walker.setRocks(scatter.rocks);
  // 出生点：地形中心附近，找一个不太陡的地方
  const cx = (bMinX + bMaxX) / 2, cz = (bMinZ + bMaxZ) / 2;
  walker.placeAt(cx + 6, cz + 12);
  walker.yaw = Math.PI;   // 面向 -Z（场景纵深方向）

  // 太阳跟随玩家，保证阴影贴图始终覆盖视野中心
  sun.target.position.set(walker.pos.x, walker.pos.y, walker.pos.z);
  sun.position.set(walker.pos.x + 48, walker.pos.y + 78, walker.pos.z + 32);

  // —— 9. 菜单数据 ——
  setBoot(88, '就绪');
  const stats = [
    ['高斯泼溅', splatInfo ? (splatInfo.count / 10000).toFixed(1) + ' 万' : '未加载'],
    ['远景圈数', splatInfo ? splatInfo.rings + ' 圈' : '—'],
    ['草簇', (scatter.group.children[0]?.count ?? 0).toLocaleString()],
    ['可行走范围', Math.round(ground.extent.sx) + '×' + Math.round(ground.extent.sz) + 'm'],
    ['后端', state.backend === 'webgpu' ? 'WebGPU' : 'WebGL 兜底'],
  ];
  $('menuStats').innerHTML = stats
    .map(([l, v]) => `<div class="cell"><span class="v">${v}</span><span class="l">${l}</span></div>`)
    .join('');
  // 如实标注球谐阶数（该 SPZ 实测只有 SH0）
  const shTxt = splatInfo
    ? (splatInfo.shDegree > 0 ? `球谐 SH${splatInfo.shDegree}` : '球谐 SH0（仅基色）')
    : '';
  $('menuStats').insertAdjacentHTML('beforeend',
    `<div class="cell"><span class="v" style="font-size:13px">${shTxt}</span><span class="l">光照</span></div>`);

  // HUD 必须显示**实际后端**，不能显示"WebGPU"却在跑 WebGL2 —— 那是在骗用户
  $('hudMode').textContent = state.backend === 'webgpu'
    ? 'WebGPU' : 'WebGL 兜底（非 WebGPU）';
  $('hudMode').style.color = state.backend === 'webgpu' ? 'var(--ok)' : 'var(--warn)';
  if (state.backend !== 'webgpu') {
    $('bootStep').textContent = '注意：当前不是 WebGPU，深度排序退回 CPU，画面可能有噪点';
  }

  state.ready = true;
  setBoot(100, '就绪');
  setTimeout(() => $('boot').classList.add('hidden'), 260);
  $('menu').classList.remove('hidden');

  // —— 10. 交互 ——
  $('btnStart').addEventListener('click', () => {
    state.started = true;
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    walker.requestLock();
    $('hudHint').classList.remove('gone');
    $('crosshair').classList.add('on');
  });
  $('btnFree').addEventListener('click', () => {
    state.started = true;
    $('menu').classList.add('hidden');
    $('hud').classList.remove('hidden');
    $('hudHint').textContent = '自由观察：鼠标拖动无效，请点击画面锁定视角';
  });
  $('btnBack').addEventListener('click', () => { location.href = './index.html'; });
  canvas.addEventListener('click', () => {
    if (state.started) walker.requestLock();
  });
  $('gateRetry').addEventListener('click', () => location.reload());

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF') toggleFullscreen();
    if (e.code === 'KeyH') {
      state.showHelp = !state.showHelp;
      $('help').classList.toggle('hidden', !state.showHelp);
    }
  });

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  // —— 11. 主循环 ——
  let last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsT = 0;
  const hudHint = $('hudHint');

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    if (state.started) {
      walker.update(dt);
      // 草的可见性跟随玩家（按距离紧凑重排 + count 截断）
      scatter.update(walker.pos.x, walker.pos.z);
      // 阴影相机跟随，保证近处始终有阴影
      sun.target.position.set(walker.pos.x, walker.pos.y, walker.pos.z);
      sun.position.set(walker.pos.x + 48, walker.pos.y + 78, walker.pos.z + 32);

      // 首次锁定后把提示淡掉
      if (walker.locked && hudHint && !hudHint.classList.contains('gone')) {
        hudHint.classList.add('gone');
      }
      $('crosshair').classList.toggle('on', walker.locked);
    }

    renderer.render(scene, camera);

    // FPS
    fpsAcc += 1 / Math.max(dt, 1e-4); fpsN++; fpsT += dt;
    if (fpsT >= 0.5) {
      $('fps').textContent = Math.round(fpsAcc / fpsN);
      $('splats').textContent = state.splatCount
        ? (state.splatCount / 10000).toFixed(1) + '万' : '—';
      fpsAcc = 0; fpsN = 0; fpsT = 0;
    }
  }
  renderer.setAnimationLoop(frame);

  // 调试钩子
  window.__gs = { scene, camera, renderer, walker, ground, scatter, splatGroup, state, splatInfo };
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

boot().catch((e) => {
  console.error('[gs] 启动失败', e);
  showGate('启动失败', '初始化过程中发生未捕获的错误。', (e && e.stack) || String(e), '✕');
});
