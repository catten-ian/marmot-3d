/**
 * GS 全场景（dev 版专用）：把摄影测量高斯泼溅作为**全部场景**，
 * 包括可行走地面，而不只是远景。
 *
 * 轴向（实测结论，来自 tools/probe-spz-axes.cjs，务必先读）：
 *   · **Z 是竖直轴** —— 沿 Z 切片的点数分布熵最小（2.197）、
 *     最密 6 层占 73.1%，是典型的"地面薄层 + 少量高处物体"特征
 *   · Y 是地面纵深（跨度 1047，最大）
 *   · X 是横跨（779）
 *
 * 踩过的坑：早期版本按"网格 PLY 的 XY 平面布局"推断，
 * 用 `rotation.x = π/2` 把源 Y 当竖直轴 —— **转错了轴**，
 * 地图会横躺过来，高度场完全失效。
 * 现在用 `rotation.x = -π/2`（源 Z → 世界 Y，源 Y → 世界 -Z）。
 *
 * 尺度适配（用户方案：放大地图 + 缩小原先活动范围）：
 *   实测可行走率仅 3%，最大连续开阔正方形边长 32 单位。
 *   因此把 **放大 3.4 倍** 后该区域正好铺满 110×66m，
 *   与现有玩法数值（移速 6.6m/s、冲刺距离）完全匹配，不用改手感。
 *
 * 可行走性：GS 没有网格碰撞，用**高度场**代替 ——
 * 从点云投影到 XZ 平面，按格取竖直方向的低分位作为地面高度。
 * 取低分位是关键：取平均会被树冠拉高，取最高会站在树冠上，
 * 只有低分位才稳定落在"地面/草皮"这一层。
 */

import * as THREE from 'three';
import { GaussianSplat } from 'three/addons/objects/GaussianSplat.js';
import { SPZLoader } from 'three/addons/loaders/SPZLoader.js';

/** 实测得到的最佳开阔草地中心与边长（tools/probe-gs-area.cjs） */
export const GS_AREA = {
  centerU: 2.6,      // 源 X（横跨）
  centerD: -25.7,     // 源 Y（纵深）
  side: 32,           // 实测最大连续可行走正方形边长（源单位）
  /** 放大到铺满 110×66m：110 / 32 ≈ 3.4 */
  scale: 3.4,
  /** 目标可行走范围（米）—— 与竞技场 130×78 内区相当 */
  walkW: 108,
  walkH: 65,
};

/** 源场景轴向 → three.js（源 Z 竖直、源 Y 纵深） */
export function applyGsOrientation(obj) {
  // 绕 X 轴 -90°：源 Z → 世界 +Y（竖直），源 Y → 世界 -Z（纵深翻转）
  obj.rotation.set(-Math.PI / 2, 0, 0);
  obj.updateMatrixWorld(true);
}

/**
 * 从 GS 点云建可行走高度场。
 *
 * @param geometry SPZLoader 输出的 BufferGeometry
 * @param opts.area  可行走区域（源坐标），决定裁剪范围
 * @param opts.cell  格边长（米，**放大后**的单位）
 */
export function buildGsHeightField(geometry, {
  area = GS_AREA, scale = GS_AREA.scale, cell = 0.5,
} = {}) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const a = pos.array;

  // 源坐标 → 世界（先转轴向再缩放）
  // 世界 X = (源X - centerU) * scale
  // 世界 Z = -(源Y - centerD) * scale      （rotation.x=-90° 造成 Y 翻转）
  // 世界 Y = (源Z - 竖直基准) * scale
  const toWX = (u) => (u - area.centerU) * scale;
  const toWZ = (d) => -(d - area.centerD) * scale;

  // 先统计竖直方向基准：用低分位当"地面层"，
  // 上面的点就是树冠/建筑，需要排除。
  const heights = new Float64Array(n);
  for (let i = 0; i < n; i++) heights[i] = a[i * 3 + 2];
  const sortedH = Float64Array.from(heights).sort();
  const p20 = sortedH[Math.floor(n * 0.20)];
  const p60 = sortedH[Math.floor(n * 0.60)];
  // 地面层厚度：20%→60% 分位之间就是"贴地"的那一薄层
  const hLo = p20, hHi = p60;

  // 可行走范围（世界单位）
  const halfW = area.walkW / 2, halfH = area.walkH / 2;

  const gx = Math.max(1, Math.ceil(area.walkW / cell));
  const gz = Math.max(1, Math.ceil(area.walkH / cell));
  const grid = new Array(gx * gz);
  for (let i = 0; i < gx * gz; i++) grid[i] = [];

  // 只收集可行走范围内、且落在地面层的点
  const tmp = [];
  for (let i = 0; i < n; i++) {
    const h = a[i * 3 + 2];
    if (h < hLo || h > hHi) continue;
    const wx = toWX(a[i * 3]);
    const wz = toWZ(a[i * 3 + 1]);
    if (wx < -halfW || wx > halfW || wz < -halfH || wz > halfH) continue;
    tmp.push(wx, wz, h);
  }

  // 建索引（世界 Y 需要减去地面基准再乘 scale）
  for (let k = 0; k < tmp.length; k += 3) {
    const wx = tmp[k], wz = tmp[k + 1];
    const cx = Math.min(gx - 1, Math.max(0, Math.floor((wx + halfW) / cell)));
    const cz = Math.min(gz - 1, Math.max(0, Math.floor((wz + halfH) / cell)));
    grid[cz * gx + cx].push(tmp[k + 2]);
  }

  // 每格取中位数（中位比平均更抗离群点）
  const h = new Float32Array(gx * gz);
  const fill = new Uint8Array(gx * gz);
  for (let k = 0; k < grid.length; k++) {
    const arr = grid[k];
    if (!arr.length) { h[k] = NaN; continue; }
    arr.sort((p, q) => p - q);
    h[k] = arr[arr.length >> 1];
    fill[k] = 1;
  }

  // 空格子用邻域中位回填，保证任何位置都有合理高度（不踩空）
  for (let cz = 0; cz < gz; cz++) {
    for (let cx = 0; cx < gx; cx++) {
      const k = cz * gx + cx;
      if (fill[k]) continue;
      const pool = [];
      for (let dz = -4; dz <= 4; dz++) {
        for (let dx = -4; dx <= 4; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= gx || nz < 0 || nz >= gz) continue;
          const v = h[nz * gx + nx];
          if (!Number.isNaN(v)) pool.push(v);
        }
      }
      if (pool.length) { pool.sort((p, q) => p - q); h[k] = pool[pool.length >> 1]; fill[k] = 2; }
    }
  }
  // 仍然空的（整片区域无点）用 0
  for (let k = 0; k < h.length; k++) if (Number.isNaN(h[k])) h[k] = 0;

  // 高度基准：让地面落在 y=0 附近
  let sum = 0, cnt = 0;
  for (let k = 0; k < h.length; k++) if (fill[k] === 1) { sum += h[k]; cnt++; }
  const hBase = cnt ? sum / cnt : 0;

  /** 世界 (x,z) → 地面高度（米）。双线性 + smoothstep，走起来不台阶 */
  const heightAt = (x, z) => {
    if (x < -halfW || x > halfW || z < -halfH || z > halfH) return 0;
    const fx = (x + halfW) / cell, fz = (z + halfH) / cell;
    const cx = Math.min(gx - 2, Math.max(0, Math.floor(fx)));
    const cz = Math.min(gz - 2, Math.max(0, Math.floor(fz)));
    let tx = Math.min(1, Math.max(0, fx - cx));
    let tz = Math.min(1, Math.max(0, fz - cz));
    tx = tx * tx * (3 - 2 * tx);
    tz = tz * tz * (3 - 2 * tz);
    const h00 = h[cz * gx + cx], h10 = h[cz * gx + cx + 1];
    const h01 = h[(cz + 1) * gx + cx], h11 = h[(cz + 1) * gx + cx + 1];
    const v = (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
    return (v - hBase) * scale;
  };

  const stats = {
    sourcePoints: n,
    groundLayerPoints: tmp.length / 3,
    srcHLo: +hLo.toFixed(1), srcHHi: +hHi.toFixed(1), srcHBase: +hBase.toFixed(1),
    grid: { cell, gx, gz },
    filledCells: fill.reduce((a, b) => a + (b ? 1 : 0), 0),
    totalCells: gx * gz,
    walkW: area.walkW, walkH: area.walkH, scale,
  };

  return { heightAt, stats, _grid: h };
}

/**
 * 构建 GS 全场景。
 *
 * @returns {Promise<{group, heightAt, stats}|null>}
 */
export async function buildGsWorld({
  url = './assets/splats/scene.spz',
  area = GS_AREA,
} = {}) {
  let geo;
  try {
    geo = await new SPZLoader().loadAsync(url);
  } catch (e) {
    console.warn('[gs] SPZ 加载失败，dev 版退回程序化地形:', e);
    return null;
  }

  const count = geo.attributes.position.count;

  // 1) 建高度场（要先拿到包围盒与地基层厚度）
  const field = buildGsHeightField(geo, { area });

  // 2) 建 GS 网格
  const splat = new GaussianSplat(geo);
  applyGsOrientation(splat);

  // 3) 平移 + 缩放：以可行走区中心为原点，地面落在 y≈0
  //    源坐标 → 世界的平移量（与 heightField 的映射严格一致）
  const S = area.scale;
  const holder = new THREE.Group();
  holder.name = 'gsWorld';

  // 先转轴向，再按 heightField 的公式摆放：
  //   世界 X = (源X - centerU) * S
  //   世界 Z = -(源Y - centerD) * S
  //   世界 Y = (源Z - hBase) * S
  splat.scale.setScalar(S);
  // rotation 已经设成 -90°，所以局部坐标 (X,Y,Z) → 世界 (X, Z, -Y)*S + offset
  // offset 抵消中心偏移与高度基准
  const hBase = field.stats.srcHBase;
  splat.position.set(
    -area.centerU * S,
    -hBase * S,
    area.centerD * S,
  );
  splat.updateMatrixWorld(true);

  holder.add(splat);

  const group = new THREE.Group();
  group.name = 'gsWorld';
  group.add(holder);

  return {
    group,
    splat,
    heightAt: field.heightAt,
    stats: {
      ...field.stats,
      splatCount: count,
      shDegree: geo.getAttribute('sphericalHarmonics3') ? 3
        : geo.getAttribute('sphericalHarmonics2') ? 2
        : geo.getAttribute('sphericalHarmonics1') ? 1 : 0,
    },
  };
}
