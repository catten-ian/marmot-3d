/**
 * Dev-only：把 Verdant GLB 里的真实地形的朝上三角形光栅化成高度场。
 *
 * 玩家的支撑面必须就是渲染的 ground / sand。岩石、悬崖、树根和树干是
 * 独立实体，不能用其顶面替换同一 (x,z) 的地形高度；岩石/悬崖另由障碍
 * 代理处理。否则玩家会站在地面内部看不见的“碰撞台”上。
 *
 * - 只纳入不透明实体网格；BLEND 叶片/草/灌木/水面等可穿过装饰一律排除
 *   （按材质 alphaMode + 节点/材质名双重判定）。
 * - 三角形需朝上（normal.y >= 0.35，约 70° 坡以内）才算可站立面，
 *   悬崖侧壁不会被当成地面。
 * - 节点自带缩放/旋转，统一用 matrixWorld 换到运行时坐标。
 */
import * as THREE from '../../vendor/three.module.js';
import { findNearestWalkableCell } from './verdant-fall-safety.mjs';
import { selectConnectedObstacleProxies } from './verdant-obstacles.mjs';
import { buildSurfaceComponents } from './verdant-placement.mjs';
import { resolveWalkableRaster } from './verdant-walkable-bin.mjs';

const WALK_NORMAL_Y = 0.35;
const TERRAIN_NAME_RE = /^(ground|sand)(?:[._]|$)/i;
// 名字命中即视为可穿过装饰（叶片 / 草 / 灌木 / 水 / 远景背景件）。
const FOLIAGE_RE = /(leaf|leaves|ivy|shrub|foliage|grass|fern|flower|petal|water|ocean|sea|monster|background|bacground)/i;

function isSolidMaterial(material) {
  const ms = Array.isArray(material) ? material : [material];
  return ms.some((m) => {
    if (!m) return false;
    if (m.transparent && m.blending !== THREE.NormalBlending) return false;
    if (m.transparent && /(leaf|leaves|grass|shrub|ivy|water|foliage|fern|flower)/i.test(m.name || '')) return false;
    if (m.alphaTest > 0 && /(leaf|leaves|grass|shrub|ivy|foliage|fern|flower)/i.test(m.name || '')) return false;
    return true;
  });
}

function solidName(name) {
  return !name || !FOLIAGE_RE.test(name);
}

/**
 * @param {THREE.Object3D} sceneRoot 已加载的 GLB 场景（会先 updateMatrixWorld）
 * @param {{minX,maxX,minZ,maxZ}} bounds 运行时可行走矩形
 * @param {number} cellSize 采样栅格边长（米）
 * @returns Float32Array（NaN=竖列内没有实体可站立面）+ 栅格信息
 */
export function rasterizeColumns(sceneRoot, bounds, cellSize = 0.22) {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const nx = Math.max(8, Math.ceil(width / cellSize));
  const nz = Math.max(8, Math.ceil(depth / cellSize));
  const top = new Float32Array(nx * nz).fill(NaN);
  const layerCount = 4;
  const surfaceLayers = new Float32Array(nx * nz * layerCount).fill(NaN);
  const addLayer = (cell, y) => {
    const base = cell * layerCount;
    for (let slot = 0; slot < layerCount; slot++) {
      const old = surfaceLayers[base + slot];
      if (Number.isFinite(old) && Math.abs(old - y) < 0.12) return;
      if (!Number.isFinite(old) || y > old) {
        for (let move = layerCount - 1; move > slot; move--) surfaceLayers[base + move] = surfaceLayers[base + move - 1];
        surfaceLayers[base + slot] = y;
        return;
      }
    }
  };
  sceneRoot.updateMatrixWorld(true);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
  const mat = new THREE.Matrix4();

  let triCount = 0, usedCount = 0, meshCount = 0;

  sceneRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    // BLEND 叶片网格与名字显式属于 foliage/背景的节点整体跳过。
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (!solidName(obj.name) || !solidName(obj.parent?.name) || !mats.some(isSolidMaterial)) return;
    // A vertical column can contain both terrain and a boulder/cliff above it.
    // Only authored terrain may define the player's support height.
    if (!TERRAIN_NAME_RE.test(obj.name || '')) return;
    const geo = obj.geometry;
    const pos = geo?.attributes?.position;
    if (!pos) return;
    obj.updateWorldMatrix(true, false);
    mat.copy(obj.matrixWorld);
    const index = geo.index;
    const vCount = pos.count;
    const triTotal = index ? index.count / 3 : vCount / 3;
    // 远景背景件（背景悬崖/水面等）在可行走矩形之外，包围盒快速剔除即可。
    triCount += triTotal;
    meshCount++;

    const put = (ia, ib, ic) => {
      pA.fromBufferAttribute(pos, ia).applyMatrix4(mat);
      pB.fromBufferAttribute(pos, ib).applyMatrix4(mat);
      pC.fromBufferAttribute(pos, ic).applyMatrix4(mat);
      // 整三角形在采样矩形（外扩 1 格）之外则跳过。
      const minX = Math.min(pA.x, pB.x, pC.x), maxX = Math.max(pA.x, pB.x, pC.x);
      const minZ = Math.min(pA.z, pB.z, pC.z), maxZ = Math.max(pA.z, pB.z, pC.z);
      if (maxX < bounds.minX - cellSize || minX > bounds.maxX + cellSize
        || maxZ < bounds.minZ - cellSize || minZ > bounds.maxZ + cellSize) return;
      e1.subVectors(pB, pA); e2.subVectors(pC, pA);
      n.crossVectors(e1, e2);
      if (n.lengthSq() < 1e-12) return;
      n.normalize();
      // 只要朝上的面：悬崖竖直侧壁 / 树干侧面不提供落脚点。
      if (n.y < WALK_NORMAL_Y) return;
      usedCount++;
      const i0 = Math.max(0, Math.floor((minX - bounds.minX) / cellSize));
      const i1 = Math.min(nx - 1, Math.floor((maxX - bounds.minX) / cellSize));
      const j0 = Math.max(0, Math.floor((minZ - bounds.minZ) / cellSize));
      const j1 = Math.min(nz - 1, Math.floor((maxZ - bounds.minZ) / cellSize));
      const invNy = -1 / n.y;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          // 2x2 子采样，避免细长三角形在格心漏采。
          for (let sj = 0; sj < 2; sj++) {
            for (let si = 0; si < 2; si++) {
              const cx = bounds.minX + (i + (si + 0.5) / 2) * cellSize;
              const cz = bounds.minZ + (j + (sj + 0.5) / 2) * cellSize;
              // 三角形平面在该竖列的高度：y = a.y + ((cx-a.x)*nx + (cz-a.z)*nz)/(-ny)
              const y = pA.y + ((cx - pA.x) * n.x + (cz - pA.z) * n.z) * invNy;
              if (!pointInTriXZ(cx, cz, pA, pB, pC)) continue;
              const k = j * nx + i;
              addLayer(k, y);
              if (isNaN(top[k]) || y > top[k]) top[k] = y;
            }
          }
        }
      }
    };

    if (index) {
      for (let t = 0; t < index.count; t += 3) put(index.getX(t), index.getX(t + 1), index.getX(t + 2));
    } else {
      for (let t = 0; t < vCount; t += 3) put(t, t + 1, t + 2);
    }
  });

  return { top, surfaceLayers, layerCount, nx, nz, cellSize, bounds, stats: { meshCount, triCount, usedCount } };
}

function pointInTriXZ(px, pz, a, b, c) {
  const s1 = sign(px, pz, a, b);
  const s2 = sign(px, pz, b, c);
  const s3 = sign(px, pz, c, a);
  const hasNeg = s1 < 0 || s2 < 0 || s3 < 0;
  const hasPos = s1 > 0 || s2 > 0 || s3 > 0;
  return !(hasNeg && hasPos);
}
function sign(px, pz, a, b) {
  return (px - b.x) * (a.z - b.z) - (a.x - b.x) * (pz - b.z);
}

/** 双线性采样导出 JSON 高度（与 verdant.js 原 bilinearHeight 同构）。 */
function sampleJsonHeight(height, x, z) {
  const n = height.gridSize, b = height.bounds;
  const tx = THREE.MathUtils.clamp((x - b.minX) / Math.max(1e-6, b.maxX - b.minX), 0, 1);
  const tz = THREE.MathUtils.clamp((z - b.minZ) / Math.max(1e-6, b.maxZ - b.minZ), 0, 1);
  const gx = tx * (n - 1), gz = tz * (n - 1);
  const i0 = Math.floor(gx), j0 = Math.floor(gz);
  const i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
  const fx = gx - i0, fz = gz - j0;
  const at = (i, j) => height.heights[j * n + i] || 0;
  const a = at(i0, j0) * (1 - fx) + at(i1, j0) * fx;
  const c = at(i0, j1) * (1 - fx) + at(i1, j1) * fx;
  return a * (1 - fz) + c * fz;
}

/** Build conservative, opt-in circle proxies for named cliffs/boulders. */
/** Build a small, exact vertical clearance query for candidate placement points. */
function createPlacementClearance(sceneRoot) {
  const meshes = [];
  const box = new THREE.Box3();
  sceneRoot.updateMatrixWorld(true);
  sceneRoot.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || !solidName(obj.name) || !solidName(obj.parent?.name)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (!mats.some(isSolidMaterial)) return;
    obj.geometry.computeBoundingBox?.();
    if (!obj.geometry.boundingBox) return;
    box.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    meshes.push({ obj, bounds: box.clone() });
  });
  const ray = new THREE.Raycaster();
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(0, 1, 0);
  const offsets = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  // Conservative uniform-grid broadphase; exact triangle ray tests remain the narrow phase.
  const cellSize = 2, bins = new Map(), broadphaseOverflow = [];
  const key = (i, j) => `${i},${j}`;
  for (const item of meshes) {
    const b = item.bounds;
    const i0 = Math.floor(b.min.x / cellSize), i1 = Math.floor(b.max.x / cellSize);
    const j0 = Math.floor(b.min.z / cellSize), j1 = Math.floor(b.max.z / cellSize);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 256) { broadphaseOverflow.push(item); continue; }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = key(i, j); let list = bins.get(k); if (!list) bins.set(k, list = []); list.push(item);
    }
  }
  return ({ x, z, y, radius = 0, height = 1.5 }) => {
    for (const [dx, dz] of offsets) {
      const px = x + dx * radius * 0.78, pz = z + dz * radius * 0.78;
      origin.set(px, y + 0.055, pz);
      ray.set(origin, direction); ray.near = 0; ray.far = Math.max(0, height - 0.055);
      const candidates = bins.get(key(Math.floor(px / cellSize), Math.floor(pz / cellSize))) || [];
      for (const item of candidates.concat(broadphaseOverflow)) {
        const b = item.bounds;
        if (px < b.min.x || px > b.max.x || pz < b.min.z || pz > b.max.z
          || b.max.y <= y + 0.08 || b.min.y >= y + height) continue;
        if (ray.intersectObject(item.obj, false).length) return false;
      }
    }
    return true;
  };
}

export function buildObstacleProxies(sceneRoot, bounds, maxProxies = 24) {
  if (!sceneRoot || !bounds) return [];
  sceneRoot.updateMatrixWorld(true);
  const out = [];
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  sceneRoot.traverse((obj) => {
    if (out.length >= maxProxies || !obj.isMesh || !obj.geometry) return;
    const name = String(obj.name || '');
    // Background cliffs are scenery, not blockers. Keep only authored boulders
    // and near-field cliff meshes; callers must explicitly opt in after QA.
    if (!/(boulder|cliff)/i.test(name) || /background/i.test(name)) return;
    obj.geometry.computeBoundingBox?.();
    if (!obj.geometry.boundingBox) return;
    box.copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
    if (box.max.x < bounds.minX || box.min.x > bounds.maxX
      || box.max.z < bounds.minZ || box.min.z > bounds.maxZ) return;
    box.getCenter(center); box.getSize(size);
    const radius = Math.max(0.25, Math.min(6, Math.hypot(size.x, size.z) * 0.28));
    out.push({
      id: name, x: center.x, z: center.z, radius,
      minY: box.min.y, maxY: box.max.y,
    });
  });
  return out;
}

/**
 * 合并 GLB 光栅高度与导出 JSON 高度，并构建：
 *   - 双线性 heightAt（NaN 竖列回退最近实体面，保证永不漏底）
 *   - resolveGround(x,z) → { y, walkable }（water/边缘 walkable=false）
 *   - nearestWalkable(x,z,radius)（出生点吸附）
 */
export async function buildWalkableField({ scene, heightJson, bounds, cellSize = 0.22, edgeMargin = 0.7, precomputed = null, onProgress = null }) {
  const __t0 = Date.now();
  const __pt = (m) => console.info('PT ' + m + ' ' + (Date.now() - __t0) + 'ms');
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const yieldRows = async (j, total, label) => {
    if ((j & 7) === 0) { onProgress?.(Math.min(0.9, j / Math.max(1, total)), label); await pause(); }
  };
  const raster = resolveWalkableRaster({
    precomputed, bounds, cellSize, layerCount: 4,
    rasterize: () => rasterizeColumns(scene, bounds, cellSize),
    warn: (message) => console.warn(`[verdant] ${message}`),
  });
  const { top, surfaceLayers, layerCount, nx, nz, stats } = raster;
  const obstacleProxies = buildObstacleProxies(scene, bounds);
  __pt('rasterize');
  onProgress?.(0.15, '光栅化：准备可行走网格');
  await pause();

  // 1) 用导出 JSON（与渲染 ground 同一次射线导出）填补光栅遗漏。
  let jsonFilled = 0;
  for (let j = 0; j < nz; j++) {
    await yieldRows(j, nz, `光栅化：填充地形网格 ${j}/${nz}`);
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!isNaN(top[k])) continue;
      const cx = bounds.minX + (i + 0.5) * cellSize;
      const cz = bounds.minZ + (j + 0.5) * cellSize;
      const h = sampleJsonHeight(heightJson, cx, cz);
      if (h > 1e-4) { top[k] = h; jsonFilled++; }
    }
  }

  __pt('jsonfill');
  // 2) 两轮补洞：仅当 3×3 邻域多数有值时取邻域均值，消掉单格采样缝隙。
  for (let pass = 0; pass < 2; pass++) {
    const snapshot = Float32Array.from(top);
    for (let j = 0; j < nz; j++) {
      await yieldRows(j, nz, `光栅化：补洞 ${pass + 1}/2 · ${j}/${nz}`);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!isNaN(snapshot[k])) continue;
        let sum = 0, cnt = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const jj = j + dj, ii = i + di;
          if (jj < 0 || jj >= nz || ii < 0 || ii >= nx) continue;
          const v = snapshot[jj * nx + ii];
          if (!isNaN(v)) { sum += v; cnt++; }
        }
        if (cnt >= 5) top[k] = sum / cnt;
      }
    }
  }

  __pt('fillholes');
  // 3) 可行走掩膜：实体掩膜再按 edgeMargin 腐蚀一圈，边缘留安全带。
  const solid = new Uint8Array(nx * nz);
  for (let k = 0; k < top.length; k++) solid[k] = isNaN(top[k]) ? 0 : 1;
  const erode = Math.max(1, Math.round(edgeMargin / cellSize));
  const walkable = Uint8Array.from(solid);
  for (let r = 0; r < erode; r++) {
    const snap = Uint8Array.from(walkable);
    for (let j = 0; j < nz; j++) {
      await yieldRows(j, nz, `光栅化：安全边界 ${r + 1}/${erode} · ${j}/${nz}`);
      for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (!snap[k]) continue;
      if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1
        || !snap[k - 1] || !snap[k + 1] || !snap[k - nx] || !snap[k + nx]) walkable[k] = 0;
      }
    }
  }

  __pt('mask');
  onProgress?.(0.92, '光栅化：建立可行走区域');
  await pause();
  const idxAt = (x, z) => [
    THREE.MathUtils.clamp(Math.floor((x - bounds.minX) / cellSize), 0, nx - 1),
    THREE.MathUtils.clamp(Math.floor((z - bounds.minZ) / cellSize), 0, nz - 1),
  ];

  function heightAt(x, z) {
    // This JSON is raycast from the shipped visual ground, so it is the exact
    // shared datum. Mesh rasterization is retained for coverage/connectivity;
    // interpolating its coarser cells here would reintroduce height drift.
    return sampleJsonHeight(heightJson, x, z);
  }

  function resolveGround(x, z) {
    if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
      return { y: heightAt(x, z), walkable: false };
    }
    const [i, j] = idxAt(x, z);
    return { y: heightAt(x, z), walkable: walkable[j * nx + i] === 1 };
  }

  function nearestWalkable(x, z) {
    // 正常站位是 O(1)；无效竖列、越界或救援时全场精确找最近可行走列，
    // 不再返回 moved=-1 的无效点让玩家继续掉落。
    return findNearestWalkableCell({ x, z, nx, nz, cellSize, bounds, walkable, top, heightAt });
  }

  await pause();
  let solidCount = 0, walkCount = 0;
  let minWalkableY = Infinity, maxWalkableY = -Infinity;
  for (let k = 0; k < top.length; k++) {
    if (solid[k]) solidCount++;
    if (walkable[k]) {
      walkCount++;
      if (Number.isFinite(top[k])) {
        minWalkableY = Math.min(minWalkableY, top[k]);
        maxWalkableY = Math.max(maxWalkableY, top[k]);
      }
    }
  }

  const centerIndex = idxAt((bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2);
  const obstacleSelection = selectConnectedObstacleProxies({
    proxies: obstacleProxies, walkable, nx, nz, bounds,
    start: { i: centerIndex[0], j: centerIndex[1] }, minReachableRatio: 0.995,
  });
  const safeObstacleProxies = obstacleSelection.proxies;
  const components = buildSurfaceComponents({
    surfaceLayers, walkable, nx, nz, cellSize, layerCount,
  });
  const mainComponent = components.sizes.reduce((best, size, index, all) => size > (all[best] || 0) ? index : best, -1);

  return {
    heightAt, resolveGround, nearestWalkable, bounds, cellSize, nx, nz,
    top, walkable, surfaceLayers, layerCount, layerLabels: components.labels, componentSizes: components.sizes, mainComponent,
    hasPlacementClearance: createPlacementClearance(scene),
    obstacleProxies: safeObstacleProxies, obstacleMask: obstacleSelection.mask,
    stats: { ...stats, jsonFilled, solidCells: solidCount, walkableCells: walkCount, totalCells: nx * nz, minWalkableY: Number.isFinite(minWalkableY) ? minWalkableY : null, maxWalkableY: Number.isFinite(maxWalkableY) ? maxWalkableY : null, walkableRatio: walkCount / (nx * nz), obstacleCandidates: obstacleProxies.length, obstacleProxies: safeObstacleProxies.length, obstacleRejected: obstacleSelection.rejected, obstacleReachableRatio: obstacleSelection.baselineReachable ? obstacleSelection.reachable / obstacleSelection.baselineReachable : 0 },
    __ms: (() => { __pt('done'); return Date.now()-__t0; })(),
  };
}
