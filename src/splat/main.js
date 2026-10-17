/**
 * splat 贴图版场景入口（?version=splat → index.html 动态 import 本文件）。
 *
 * 与 GS 路径（src/gs/*、src/main.js）完全独立：
 *   - 不走 WebGPU / GaussianSplat，纯 WebGL1 可降级的 ShaderMaterial；
 *   - 静态只依赖纯模块（config + heightfield），three/terrain 全部动态 import，
 *     因此 config.splat.enabled=false 时本模块零成本 noop，连 canvas 都不碰；
 *   - 相机 / 轻量轨道控制 / 光照 / 远山装饰都在这里自包含装配。
 *
 * 性能预算（390×844）：地形 1 draw call + 远山 1 instanced draw call。
 */

import { config, splat } from '../core/config.js';
import { mountSplatWhenEnabled } from './runtime.js';
import { terrainHeight, terrainNormal } from './heightfield.js';

/** 开关总闸：config.splat.enabled=false 或 ?splat=0 均不放行 */
export function splatBootAllowed() {
  let enabled = false;
  mountSplatWhenEnabled(config, () => { enabled = true; });
  if (!enabled) return false;
  try {
    if (new URLSearchParams(globalThis.location.search).get('splat') === '0') return false;
  } catch (_) { /* 无 location 环境（Node 测试）按放行交给 DOM 检查 */ }
  return true;
}

// ————————————————————————————————————————
// 极简轨道控制：单指拖拽旋转 / 滚轮或双指捏合缩放（X5 触屏友好，无 addons 依赖）
// ————————————————————————————————————————
class OrbitLite {
  constructor(camera, dom, target = { x: 0, y: 2, z: 0 }) {
    this.camera = camera;
    this.dom = dom;
    this.target = target;
    this.radius = 72;
    this.azim = Math.PI * 0.25;
    this.polar = Math.PI * 0.38;
    this.minR = 6; this.maxR = 170;
    this.pointers = new Map();
    this._pinch = 0;

    dom.style.touchAction = 'none';
    this._onDown = (e) => { this.dom.setPointerCapture?.(e.pointerId); this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
    this._onMove = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      const prev = this.pointers.get(e.pointerId);
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.azim -= dx * 0.005;
        // 夹在水平线下与近天顶之间：俯仰拖动不会翻到地形背面
        this.polar = Math.max(0.18, Math.min(1.45, this.polar - dy * 0.005));
      } else if (this.pointers.size === 2) {
        const [a, b] = this.pointers.values();
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch) this.radius = Math.max(this.minR, Math.min(this.maxR, this.radius * this._pinch / d));
        this._pinch = d;
      }
    };
    this._onUp = (e) => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this._pinch = 0; };
    this._onWheel = (e) => {
      e.preventDefault();
      this.radius = Math.max(this.minR, Math.min(this.maxR, this.radius * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    dom.addEventListener('pointerdown', this._onDown);
    dom.addEventListener('pointermove', this._onMove);
    dom.addEventListener('pointerup', this._onUp);
    dom.addEventListener('pointercancel', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
  }

  /** 把相机摆到一点看向的球面上（供初始化对准某世界坐标） */
  framePoint(x, y, z, radius = this.radius) {
    this.target.x = x; this.target.y = y; this.target.z = z;
    this.radius = radius;
    // 初始取景取俯视斜角，正好越过前坡看到主峰
    this.azim = Math.PI * 0.35;
    this.polar = Math.PI * 0.42;
  }

  update() {
    const sp = Math.sin(this.polar), cp = Math.cos(this.polar);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.azim),
      this.target.y + this.radius * cp,
      this.target.z + this.radius * sp * Math.cos(this.azim)
    );
    this.camera.lookAt(this.target.x, this.target.y, this.target.z);
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this._onDown);
    this.dom.removeEventListener('pointermove', this._onMove);
    this.dom.removeEventListener('pointerup', this._onUp);
    this.dom.removeEventListener('pointercancel', this._onUp);
    this.dom.removeEventListener('wheel', this._onWheel);
  }
}

/**
 * 启动 splat 场景。config 关闭 / ?splat=0 / 无 DOM 时直接返回 {mounted:false}，
 * 不读取 canvas、不建渲染器。
 */
export async function bootSplat() {
  // —— 0. 开关必须在任何 DOM / three 访问之前短路 ——
  if (!splatBootAllowed()) return { mounted: false, reason: 'disabled' };
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { mounted: false, reason: 'no-dom' };
  }

  const canvas = document.getElementById(splat.canvasId);
  if (!canvas) return { mounted: false, reason: 'no-canvas' };

  let THREE;
  try {
    THREE = await import('three');
  } catch (e) {
    return { mounted: false, reason: 'three-load-failed', error: String(e) };
  }
  // —— 1. 优先 Three/WebGL2，旧 X5 上 Three r186 会因没有 WebGL2 失败；
  // 此时换成同一批程序化数据驱动的轻量原生 WebGL1 绘制器。——
  let renderer;
  let webgl1Fallback = false;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch (webgl2Error) {
    try {
      const { WebGL1SplatRenderer } = await import('./webgl1-fallback.js');
      renderer = new WebGL1SplatRenderer(THREE, canvas);
      webgl1Fallback = true;
    } catch (fallbackError) {
      const hint = document.getElementById('perfHint');
      if (hint) hint.textContent = 'WebGL 不可用，splat 贴图场景未启动';
      return { mounted: false, reason: 'webgl-failed', error: `${webgl2Error}; ${fallbackError}` };
    }
  }
  document.documentElement.classList.add('splat-mode');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (!webgl1Fallback) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
  }

  // —— 2. 场景：天蓝色 + 远景雾 ——
  const scene = new THREE.Scene();
  const sky = new THREE.Color(splat.fog.color);
  scene.background = sky;
  scene.fog = new THREE.Fog(splat.fog.color, splat.fog.near, splat.fog.far);

  // —— 3. 相机 ——
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1200);

  // —— 4. 光照：半球（天蓝/草绿）+ 太阳（方向 0.3,0.8,0.4，色 0xfff4e0）——
  const hemi = new THREE.HemisphereLight(splat.hemi.sky, splat.hemi.ground, splat.hemi.intensity);
  scene.add(hemi);
  const sunDir = new THREE.Vector3(splat.sun.dir.x, splat.sun.dir.y, splat.sun.dir.z).normalize();
  const sun = new THREE.DirectionalLight(splat.sun.color, splat.sun.intensity);
  sun.position.copy(sunDir).multiplyScalar(120);
  scene.add(sun);

  // —— 5. 地形（shader 内 4 通道 splat 混合；WebGL1 回退仍只有 1 draw call）——
  let terrain, mountains = null;
  if (webgl1Fallback) {
    terrain = renderer.terrain;
  } else {
    const { buildSplatTerrain, buildMountains } = await import('./terrain.js');
    terrain = buildSplatTerrain(THREE);
    scene.add(terrain.mesh);

    // 远山装饰在 WebGL2 路径使用一个 InstancedMesh / 一个 draw call。
    mountains = buildMountains(THREE);
    scene.add(mountains);
  }

  // —— 7. 相机初始取景：低地沙草交界看向主峰 ——
  const controls = new OrbitLite(camera, renderer.domElement);
  controls.framePoint(splat.peaks[0].x * 0.5, 2.4, splat.peaks[0].z * 0.5, 78);

  // 演示 heightfield 复用：把相机目标点地面高度/法线暴露给调试
  const groundY = terrainHeight(controls.target.x, controls.target.z);
  const groundN = terrainNormal(controls.target.x, controls.target.z);

  // —— 8. 自适应尺寸 ——
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  // —— 9. UI：隐藏加载层、打角标 ——
  const loader = document.getElementById('loader');
  if (loader) loader.style.display = 'none';
  const tag = document.getElementById('versionTag');
  if (tag) tag.textContent = 'SPLAT · 贴图版场景（4 通道混合）';
  const backend = document.getElementById('backendTag');
  if (backend) {
    backend.textContent = webgl1Fallback ? 'WebGL1 · splat textures' : 'WebGL2 · splat textures';
    backend.classList.remove('hidden');
  }

  // ?splatdebug=1：把权重图 canvas 暴露 + 挂到窗口（不进正常渲染路径）
  let debugCanvas = null;
  try {
    if (new URLSearchParams(location.search).get('splatdebug') === '1') {
      const { paintSplatCanvas } = await import('./splat-painter.js');
      debugCanvas = terrain.painted.canvas || paintSplatCanvas(terrain.painted);
    }
  } catch (_) { /* ignore */ }

  const ctx = {
    mounted: true,
    renderer, scene, camera, controls, terrain, mountains, webgl1Fallback,
    groundY, groundNormal: groundN, debugCanvas,
    dispose() {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
    },
  };
  if (typeof globalThis !== 'undefined') globalThis.__splat = ctx;
  return ctx;
}

// 浏览器中由 index.html 动态 import 后自动启动；Node 下（无 window）不自动跑。
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bootSplat().catch((error) => {
    console.error('[splat] scene initialization failed', error);
    const hint = document.getElementById('perfHint');
    if (hint) hint.textContent = 'splat 场景初始化失败';
  });
}
