/**
 * 摄影测量场景接入。
 *
 * 场景源数据（用户提供的摄影测量资产）有三个格式：
 *   · 网格 PLY —— 转成两档 GLB：
 *       terrain-lod.glb  15,110 面 / 0.36MB —— **远景实际使用**（要复制 14 份）
 *       terrain.glb      91,611 面 / 2.14MB —— 高模备用（留给"可行走地形"）
 *     两者都用 COLOR_0 顶点色（摄影测量的真实配色，比贴图更省体积）
 *   · 高斯泼溅 PLY / SPZ —— 视觉更好，但只能当**远景背景**
 *     （three.js 的 GaussianSplat 需要 WebGPU，且无法做碰撞）
 *
 * 坐标转换（实测数据）：
 *   源场景是 **XY 平面布局**（X 跨 25.3、Y 跨 25.0、Z 仅 6.8），
 *   即摄影测量给出的其实是俯视的一块地，Z 是起伏高度。
 *   three.js 是 Y 轴朝上，因此：
 *     源 X → 游戏 X
 *     源 Y → 游戏 Z（扫描纵深变地面纵深）
 *     源 Z → 游戏 Y（起伏变高度）
 *
 * 摆放策略（用户决定「只当远景，不做可行走地形」）：
 *   场景只有 25m 见方，而竞技场是 130×78m，直接放中央毫无意义；
 *   放大后沿**环形复制 6 份**围成远山，可行走地形仍用程序化生成，
 *   这样玩家无论朝哪个方向都有景，且转身不会看到空白。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
const cache = new Map();

export function loadSceneModel(url) {
  if (cache.has(url)) return cache.get(url);
  const p = new Promise((resolve) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, () => {
      console.warn('[scene] 场景模型加载失败:', url);
      resolve(null);
    });
  });
  cache.set(url, p);
  return p;
}

/**
 * 把摄影测量场景转换为 three.js 坐标。
 * 返回一个**已经居中、原点位于地面中心、朝向 +Z** 的 Group，
 * 尺度是原始的 1 倍（25m × 25m × 6.8m），便于调用方自由摆放。
 */
export async function buildSceneUnit(opts = {}) {
  const { url = './assets/models/terrain-lod.glb', tint = 0x1a1c12 } = opts;
  const scene = await loadSceneModel(url);
  if (!scene) return null;

  const unit = new THREE.Group();
  unit.add(scene);

  // 源 XY 布局 → three.js Y-up：把 Y 放到 Z，Z 翻转为高度
  scene.rotation.set(Math.PI / 2, 0, 0);
  unit.updateMatrixWorld(true);

  // 把包围盒的**底面中心**对到原点：这样调用方只需给 y 就能控制"埋多深"
  const box = new THREE.Box3().setFromObject(unit);
  const c = box.getCenter(new THREE.Vector3());
  unit.position.set(-c.x, -box.min.y, -c.z);
  unit.updateMatrixWorld(true);

  // 远景不吃光照计算太贵，也不该被阳光直射打亮
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const apply = (m) => {
      m = m.clone();
      // 顶点色已经烘进 COLOR_0
      m.vertexColors = true;
      m.roughness = 1;
      m.metalness = 0;
      // 远景略微自发光，避免因只受环境光而发闷
      m.emissive = new THREE.Color(tint);
      m.emissiveIntensity = 0.3;
      m.needsUpdate = true;
      return m;
    };
    if (Array.isArray(o.material)) o.material = o.material.map(apply);
    else if (o.material) o.material = apply(o.material);
  });

  const out = new THREE.Group();
  out.add(unit);
  return out;
}

/**
 * 沿椭圆环复制若干份，围成地平线上的远景带。
 *
 * 关键尺寸关系（实测自 src/world/scene.js 与 config.js）：
 *   · 程序化地形 = FIELD_W+300 × FIELD_H+300 = 430×378，
 *     即 X±215 / Z±189 处才到边缘，边缘之外什么都没有
 *   · 远山环在半径 215~265m
 *   · 雾 far = 420（见 world/scene.js）
 * 因此摄影测量远景必须落在**地形边缘与远山之间**（约 X±245 / Z±218），
 * 放在 172m 会整块埋进地形里完全看不见。
 *
 * 源场景是 25m 宽 × 6.8m 厚的地形块（不是薄片），
 * 直接放大 7 倍会得到 175m 宽 × 47m 厚的巨块 —— 那就是一块
 * 悬在半空的飞地。因此垂直方向要压到 0.3 左右，
 * 只取摄影测量的平面纹理与起伏暗示，铺成地平线上的一圈树林草甸。
 *
 * @param opts.count   复制份数
 * @param opts.rx/rz   椭圆环半径（X / Z）
 * @param opts.scale   水平缩放（源 25m → 25*scale）
 * @param opts.squash  垂直压扁系数
 * @param opts.y       底面高度（需与地形边缘轮廓衔接）
 * @param opts.yaw     第一份的朝向（弧度）
 * @param opts.jitter  随机扰动幅度，避免看出复制感
 */
export async function buildBackdrop(opts = {}) {
  const {
    url = './assets/models/terrain-lod.glb',
    // 份数：椭圆周长约 2π√((246²+218²)/2) ≈ 1460m，
    // 单份覆盖 25×7.4 ≈ 185m，理论需 8 份；但每份还要留角度余量、
    // 且摄影测量的有效内容不占满整块边缘，取 14 份确保 360° 无缝。
    count = 14,
    rx = 246,
    rz = 218,
    scale = 8.2,
    squash = 0.55,
    y = -1.2,
    yaw = 0,
    jitter = 0.12,
  } = opts;

  const unit = await buildSceneUnit({ url });
  if (!unit) return null;

  const ring = new THREE.Group();
  ring.name = 'backdrop';

  // 固定 seed，保证每次刷新位置一致（便于调试复现）
  let seed = 20240917;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff) * 2 - 1;
  };

  for (let i = 0; i < count; i++) {
    const a = yaw + (i / count) * Math.PI * 2;
    const piece = unit.clone(true);

    const s = scale * (1 + rnd() * jitter);
    // 水平方向随机，垂直方向跟随同一个 s（压扁后整体仍是一块薄的地形）
    piece.scale.set(s, s * squash, s);
    // 环上朝外：让每份场景的"扫描方向"径向铺开，拼成一圈带子
    piece.rotation.y = -a + Math.PI / 2 + rnd() * 0.15;
    piece.position.set(
      Math.sin(a) * rx * (1 + rnd() * jitter * 0.4),
      y + rnd() * 1.6,
      Math.cos(a) * rz * (1 + rnd() * jitter * 0.4)
    );
    ring.add(piece);
  }

  ring.userData = { rx, rz, count, scale, squash, y };
  return ring;
}

/** 场景资产是否就绪 */
export function sceneAssets() {
  return {
    terrain: true,
    gaussian: false, // SPZ/PLY-GS 需 WebGPU，暂未接入
  };
}
