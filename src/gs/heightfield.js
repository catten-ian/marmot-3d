/**
 * 全 GS 沉浸模式：从高斯泼溅点云建**高度场**，实现行走。
 *
 * 核心矛盾与解法：
 *   GS 只有一堆带颜色/协方差的点，**没有网格、没有可靠深度**，
 *   所以 three.js 的 Raycaster 对它不可靠，常规的"射线打地面求交"行不通。
 *   但点云里地面区域的点，其**高度分布有明确众数**——
 *   也就是说可以反过来：把点云投影到 XZ 平面，
 *   对每个格子统计点的 Y，取低分位（地面附近的点）作为该格的地面高度。
 *
 * 为什么取低分位而不是平均/最高：
 *   · 平均 → 会被树冠、灌木拉高，人会"陷进地里"或浮在半空
 *   · 最高 → 变成树的顶端，人会站在树冠上
 *   · 低分位（P10~P20）→ 稳定落在"地面/草皮"这一层，
 *     稀疏区回退到邻域最小值，保证任何位置都有合理高度
 *
 * 这也是"全 GS 沉浸"能同时保住真实观感与可行走性的关键。
 */

/**
 * 从 GS 几何体建高度场索引。
 *
 * @param geometry SPZLoader 解析出的 BufferGeometry（有 position 属性）
 * @param opts.cell    格子边长（米，源坐标系）。0.8 足够细
 * @param opts.quantile 取分位数（0.1~0.25 较合适）
 * @param opts.filterH 忽略高于地面多少倍跨度的点（滤掉树冠）
 */
export function buildHeightFieldFromSplat(geometry, {
  cell = 0.8,
  quantile = 0.18,
  filterH = null,
} = {}) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const arr = pos.array;

  // —— 第一遍：求范围 ——
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = arr[i * 3], y = arr[i * 3 + 1], z = arr[i * 3 + 2];
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const spanY = (y1 - y0) || 1;
  // 树冠等高处：默认取地面以上 12% 跨度
  const hLimit = filterH ?? (y0 + spanY * 0.12);

  const gx = Math.max(1, Math.ceil((x1 - x0) / cell));
  const gz = Math.max(1, Math.ceil((z1 - z0) / cell));
  /** @type {number[][]} 每格收集地面附近的 Y */
  const buckets = new Array(gx * gz);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];

  // —— 第二遍：按格收集低位点 ——
  for (let i = 0; i < n; i++) {
    const y = arr[i * 3 + 1];
    if (y > hLimit) continue;         // 滤掉树冠/高层点
    const cx = Math.min(gx - 1, Math.max(0, Math.floor((arr[i * 3] - x0) / cell)));
    const cz = Math.min(gz - 1, Math.max(0, Math.floor((arr[i * 3 + 2] - z0) / cell)));
    buckets[cz * gx + cx].push(y);
  }

  // —— 第三遍：每格排序取分位数 + 邻域回退 ——
  const h = new Float32Array(gx * gz);
  const filled = new Uint8Array(gx * gz);
  for (let k = 0; k < buckets.length; k++) {
    const a = buckets[k];
    if (!a.length) { h[k] = NaN; continue; }
    a.sort((p, q) => p - q);
    h[k] = a[Math.min(a.length - 1, Math.floor(a.length * quantile))];
    filled[k] = 1;
  }

  // 邻域回退：空格子与边缘格子用最近的已填充格补上
  const sampleFilled = (x, z) => {
    const cx = Math.min(gx - 1, Math.max(0, Math.floor((x - x0) / cell)));
    const cz = Math.min(gz - 1, Math.max(0, Math.floor((z - z0) / cell)));
    const v = h[cz * gx + cx];
    return Number.isNaN(v) ? y0 : v;
  };

  // 标记仍为空的格子 → 用邻域最低的已填充值
  for (let cz = 0; cz < gz; cz++) {
    for (let cx = 0; cx < gx; cx++) {
      const k = cz * gx + cx;
      if (filled[k]) continue;
      let best = Infinity;
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= gx || nz < 0 || nz >= gz) continue;
          const v = h[nz * gx + nx];
          if (!Number.isNaN(v) && v < best) best = v;
        }
      }
      h[k] = Number.isFinite(best) ? best : y0;
      filled[k] = 2;   // 2 = 由邻域回填
    }
  }

  /**
   * 采样高度：格内取平均（多个点落在同一格，滤掉抖动），
   * 邻格之间用双线性插值，让行走更顺滑（不做插值会有 0.8m 的台阶感）。
   */
  const heightAt = (x, z) => {
    const fx = (x - x0) / cell;
    const fz = (z - z0) / cell;
    if (fx < 0 || fz < 0 || fx > gx - 1 || fz > gz - 1) return y0;
    const cx = Math.min(gx - 2, Math.max(0, Math.floor(fx)));
    const cz = Math.min(gz - 2, Math.max(0, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - cx));
    const tz = Math.min(1, Math.max(0, fz - cz));
    const h00 = h[cz * gx + cx], h10 = h[cz * gx + cx + 1];
    const h01 = h[(cz + 1) * gx + cx], h11 = h[(cz + 1) * gx + cx + 1];
    // smoothstep 权重的双线性，避免格边处出现折线
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    return (h00 * (1 - sx) + h10 * sx) * (1 - sz) + (h01 * (1 - sx) + h11 * sx) * sz;
  };

  return {
    heightAt,
    stats: {
      points: n,
      cell, gx, gz,
      spanX: +(x1 - x0).toFixed(1),
      spanY: +spanY.toFixed(1),
      spanZ: +(z1 - z0).toFixed(1),
      minX: +x0.toFixed(1), minZ: +z0.toFixed(1),
      hMin: +y0.toFixed(1), hMax: +y1.toFixed(1),
      hLimit: +hLimit.toFixed(1),
      groundCells: filled.reduce((a, b) => a + (b ? 1 : 0), 0),
      totalCells: gx * gz,
    },
    _raw: h,
  };
}
