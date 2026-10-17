/**
 * splat 贴图版 —— 4 张完全程序化的地表贴图（无任何外部图片资源）。
 *
 * 工厂均返回 512×512 RGBA 的 Uint8Array（长度 512*512*4），
 * 浏览器侧由 createTileTexture(THREE, data) 上传为 DataTexture；
 * Node 侧可直接断言形状与像素分布，不依赖 DOM / Canvas。
 *
 * octave / 频率一览（每张 tile 在世界里重复，tuv∈[0,1]）：
 *   grass —— value-noise FBM，k=8 octaves，基频 4/tile，+22 频率细草绒
 *   sand  —— value-noise FBM，k=6 octaves，基频 5/tile，+46 频率风成细纹 + 180 沙粒
 *   snow  —— value-noise FBM，k=5 octaves，基频 3/tile，低频冷蓝阴斑
 *   rock  —— ridged FBM，k=6 octaves，基频 4/tile，+34 频率锐利裂隙
 */

export const TEXTURE_SIZE = 512;

function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v; }

// 整数 hash（比 sin-hash 快，Node 全量生成也不卡）
function ihash(ix, iy, seed) {
  let h = (Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function sstep(t) { return t * t * (3 - 2 * t); }

/** value noise 0..1（独立 seed，避免 4 张贴图像同一块噪声） */
function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = sstep(x - xi), yf = sstep(y - yi);
  const a = ihash(xi, yi, seed), b = ihash(xi + 1, yi, seed);
  const c = ihash(xi, yi + 1, seed), d = ihash(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

function wrapIndex(i, period) { return ((i % period) + period) % period; }
/** Periodic value noise: lattice wraps at `period`, UV 0/1 edges match exactly. */
function vnoisePeriodic(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = sstep(x - xi), yf = sstep(y - yi);
  const ix0 = wrapIndex(xi, period), iy0 = wrapIndex(yi, period);
  const ix1 = wrapIndex(xi + 1, period), iy1 = wrapIndex(yi + 1, period);
  const a = ihash(ix0, iy0, seed), b = ihash(ix1, iy0, seed);
  const c = ihash(ix0, iy1, seed), d = ihash(ix1, iy1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}
/** Tileable FBM: integer base frequency per octave so UV edges wrap seamlessly. */
function fbmTile(u, v, baseFreq, octaves, seed) {
  let sum = 0, amp = 1, freq = baseFreq, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoisePeriodic(u * freq, v * freq, freq, seed + i * 97) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
/** Tileable ridged FBM（岩石锐利脊线）。 */
function ridgeTile(u, v, baseFreq, octaves, seed) {
  let sum = 0, amp = 1, freq = baseFreq, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = vnoisePeriodic(u * freq, v * freq, freq, seed + i * 131);
    sum += (1 - Math.abs(2 * n - 1)) * amp;
    norm += amp; amp *= 0.52; freq *= 2;
  }
  return sum / norm;
}

/** 常规 FBM，0..1 */
function fbm(x, y, oct, seed, lacunarity = 2.02) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(x * freq, y * freq, seed + i * 97) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 山脊噪声：0..1，峰脊处接近 1（岩石锐利边缘） */
function ridge(x, y, oct, seed) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = vnoise(x * freq, y * freq, seed + i * 131);
    sum += (1 - Math.abs(2 * n - 1)) * amp;
    norm += amp;
    amp *= 0.52;
    freq *= 2.05;
  }
  return sum / norm;
}

function mix3(c0, c1, t) {
  return [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t,
  ];
}

function makeCanvas(seed, fill) {
  const S = TEXTURE_SIZE;
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      let rgb = fill(u, v, x, y);
      const i = (y * S + x) * 4;
      data[i] = clamp255(rgb[0]);
      data[i + 1] = clamp255(rgb[1]);
      data[i + 2] = clamp255(rgb[2]);
      data[i + 3] = 255;
    }
  }
  return data;
}

// —— grass：绿基色 + 暗斑噪声（k=8 octaves）——
export function makeGrassTexture() {
  const DARK = [44, 68, 28], MID = [92, 132, 54], LIGHT = [134, 168, 84];
  return makeCanvas(11, (u, v, ix, iy) => {
    const patch = fbmTile(u, v, 4, 8, 11);          // 暗斑/亮斑，8 octave
    const velvet = fbmTile(u, v, 22, 3, 71);      // 草绒高频
    const t = 0.15 + patch * 0.75 + (velvet - 0.5) * 0.18;
    let c = t < 0.55 ? mix3(DARK, MID, t / 0.55) : mix3(MID, LIGHT, (t - 0.55) / 0.45);
    const speck = ihash(ix % TEXTURE_SIZE, iy % TEXTURE_SIZE, 23);
    if (speck > 0.965) c = c.map((q) => q * 0.72);  // 零星深色草孔
    else if (speck < 0.03) c = c.map((q) => q * 1.12); // 浅色草尖
    return c;
  });
}

// —— sand：黄基色 + 细纹（风成 ripple + 细沙粒）——
export function makeSandTexture() {
  const LOW = [186, 160, 104], MID = [222, 202, 144], HI = [244, 228, 178];
  return makeCanvas(31, (u, v, ix, iy) => {
    const patch = fbmTile(u, v, 5, 6, 31);          // 块面色差，6 octave
    const drift = fbmTile(u, v, 3, 3, 53);
    const ripple = 0.5 + 0.5 * Math.sin((u * 46 + drift * 8) * Math.PI * 2); // 细纹
    const grain = ihash(ix % TEXTURE_SIZE, iy % TEXTURE_SIZE, 41);                 // 沙粒
    const t = patch * 0.62 + ripple * 0.26 + (grain - 0.5) * 0.12;
    return t < 0.5 ? mix3(LOW, MID, t * 2) : mix3(MID, HI, (t - 0.5) * 2);
  });
}

// —— snow：白 + 冷蓝阴影（低频阴斑 + 偶发晶点）——
export function makeSnowTexture() {
  const SHADOW = [196, 212, 234], WHITE = [246, 249, 253], CRYSTAL = [255, 255, 255];
  return makeCanvas(51, (u, v, ix, iy) => {
    const patch = fbmTile(u, v, 3, 5, 51);          // 冷蓝阴斑，5 octave
    const grain = fbmTile(u, v, 40, 2, 93);
    let t = 0.25 + patch * 0.65 + (grain - 0.5) * 0.1;
    let c = t < 0.5 ? mix3(SHADOW, WHITE, t * 2) : mix3(WHITE, CRYSTAL, (t - 0.5) * 2);
    if (ihash(ix % TEXTURE_SIZE, iy % TEXTURE_SIZE, 67) > 0.9975) c = CRYSTAL;     // 雪面闪晶
    return c;
  });
}

// —— rock：灰 + 锐利边缘（ridged FBM + 高频裂隙）——
export function makeRockTexture() {
  const DARK = [88, 86, 84], MID = [126, 124, 121], LIGHT = [158, 156, 152];
  return makeCanvas(71, (u, v) => {
    const strata = fbmTile(u, v, 4, 6, 71);         // 岩层块面，6 octave
    const ridgeN = ridgeTile(u, v, 5, 6, 83);   // 脊线锐边
    const crackN = vnoisePeriodic(u * 34, v * 34, 34, 97);       // 裂隙噪声
    const crack = crackN > 0.82 ? 0.45 : 1.0;        // 锐利暗缝
    let t = strata * 0.6 + ridgeN * 0.4;
    let c = t < 0.5 ? mix3(DARK, MID, t * 2) : mix3(MID, LIGHT, (t - 0.5) * 2);
    c = c.map((q) => q * crack * (0.92 + ridgeN * 0.18));
    return c;
  });
}

/** 一次生成 4 张：{ grass, sand, snow, rock } */
export function makeAllTextures() {
  return {
    grass: makeGrassTexture(),
    sand: makeSandTexture(),
    snow: makeSnowTexture(),
    rock: makeRockTexture(),
  };
}

/**
 * 浏览器侧：Uint8Array → THREE.DataTexture（POT 512，RepeatWrapping，
 * WebGL1 也能走完整 mip 链；颜色贴图标记 sRGB，权重感交给 splat 通道）。
 */
export function createTileTexture(THREE, data, size = TEXTURE_SIZE) {
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace; // 自定义 shader 手动混合，字节色直出避免双重 sRGB
  tex.needsUpdate = true;
  return tex;
}

// —— 契约别名（tools/test-splatmap.cjs 使用的工厂名）——
export const createGrassTexture = makeGrassTexture;
export const createSandTexture = makeSandTexture;
export const createSnowTexture = makeSnowTexture;
export const createRockTexture = makeRockTexture;
