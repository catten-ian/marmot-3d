/**
 * GS 版的可行走地形与视觉。
 *
 * 与主版本（WebGL）的区别与取舍：
 *
 * 1. **地面用摄影测量网格，而不是程序化生成。**
 *    GS 场景本身只有 25m 见方，如果再叠一片程序化草地，
 *    玩家会明显看到"脚下的草"和"远处的草"是两张皮。
 *    所以这里直接把 terrain-lod.glb 铺成可行走地形 —— 它的尺度放大后
 *    正好覆盖整个活动范围。
 *
 * 2. **视觉优化重点（用户明确要求"能走到的地方视觉还要优化"）：**
 *    · 地表细节 —— 原网格只有顶点色，贴近看是糊的。
 *      这里加一层高频噪声 + 距离淡出的细节纹理，让近处不糊。
 *    · 草地色阶 —— 顶点色只有均值附近的窄区间，平地没有层次。
 *      按高度 + 坡度 + 斑驳噪声重新分配色阶，缓坡、陡坡、
 *      洼地各给不同色，草甸才不像一块塑料布。
 *    · 雾气融合 —— 远处地面必须无缝融进天穹，否则会看到硬边。
 *    · 接触阴影 —— 贴地视角下物体没有影子会"浮"起来。
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

/** 加载地形网格（摄影测量，带 COLOR_0 顶点色） */
export function loadTerrain(url = './assets/models/terrain.glb') {
  return new Promise((resolve) => {
    loader.load(url, (g) => resolve(g.scene), undefined, (e) => {
      console.warn('[gs] 地形加载失败，改用程序化地面:', e);
      resolve(null);
    });
  });
}

/**
 * 地表细节纹理：用高频噪声在近处打破顶点色的糊感。
 *
 * 为什么不直接用摄影测量自带的贴图：
 *   网格导出时只有顶点色，没有 albedo；重贴一遍 UV 需要在源工具里做，
 *   而点云/网格扫描的 UV 通常是投影展开的、尺度极不均匀。
 *   顶点色 + 程序化细节在近处的观感反而更稳。
 */
function makeDetailTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;

  // 多倍频 value noise：低频给大块色差，高频给颗粒
  const hash = (x, y) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = smooth(x - xi), yf = smooth(y - yi);
    const a = hash(xi, yi), b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1), e = hash(xi + 1, yi + 1);
    return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + e * xf) * yf;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * 8, v = y / size * 8;
      let n = 0;
      n += vnoise(u, v) * 0.5;
      n += vnoise(u * 2.7, v * 2.7) * 0.28;
      n += vnoise(u * 7.3, v * 7.3) * 0.15;
      n += vnoise(u * 19.1, v * 19.1) * 0.07;
      const i = (y * size + x) * 4;
      // 输出为中性灰（128 为不改变基色），叠在顶点色之上
      const g8 = Math.max(0, Math.min(255, Math.round(128 + (n - 0.5) * 210)));
      d[i] = g8; d[i + 1] = g8; d[i + 2] = g8; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // repeat 保持 1：UV 已经按"世界坐标 / 24"生成过了，
  // 再叠 repeat 会导致每 1 个单位就重复一次，糊成一片噪点。
  tex.repeat.set(1, 1);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.NoColorSpace; // 这是灰度调制图，不是颜色图
  return tex;
}

/**
 * 按高度 + 坡度 + 噪声重分配地表色阶。
 *
 * 顶点色的实测均值是 sRGB(151,151,85)，非常集中 —— 平地看过去是一整块，
 * 这就是"能走到的地方不好看"的主因。
 * 这里重新分配：低洼偏深绿、缓坡偏黄绿、陡坡偏土褐、脊顶偏枯黄，
 * 再叠斑驳噪声打散规则感。
 */
function recolorTerrain(mesh, { grassA, grassB, dry, soil, fog }) {
  mesh.geometry.computeVertexNormals();
  const pos = mesh.geometry.attributes.position;
  const nrm = mesh.geometry.attributes.normal;
  const uv = mesh.geometry.attributes.uv;
  if (!uv) {
    // 网格没有 UV 就按**世界 XZ** 生成平面投影。
    // 注意必须用世界坐标而不是局部坐标（0~1）：
    // 地面会平铺成九宫格，若每格都用同一套 0~1 UV，
    // detailMap 的高频噪声会在每一格重复，视觉上立刻穿帮。
    const arr = new Float32Array(pos.count * 2);
    mesh.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      // detailMap.repeat = 24，即每 24 个单位重复一次；
      // 这里直接输出世界坐标的 1/24 比例
      arr[i * 2] = v.x / 24;
      arr[i * 2 + 1] = v.z / 24;
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  }

  const colors = new Float32Array(pos.count * 3);
  const cA = new THREE.Color(grassA);
  const cB = new THREE.Color(grassB);
  const cDry = new THREE.Color(dry);
  const cSoil = new THREE.Color(soil);
  const cEdge = new THREE.Color(fog).multiplyScalar(0.8);
  const tmp = new THREE.Color();

  // 高度归一化区间（实测源场景 Y 跨 -10.5 ~ 14.4）
  const yMin = -10.6, yMax = 14.5;
  const span = yMax - yMin;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // 坡度：法线 Y 越小越陡
    const slope = 1 - Math.abs(nrm.getY(i));

    // 高度带：三段渐变，低洼→缓坡→脊顶
    const hN = Math.min(1, Math.max(0, (y - yMin) / span));
    const lowT = Math.min(1, hN / 0.42);
    const highT = Math.max(0, (hN - 0.58) / 0.42);

    tmp.copy(cA).lerp(cB, lowT);
    if (highT > 0) tmp.lerp(cDry, highT);
    // 陡坡露土
    tmp.lerp(cSoil, Math.min(1, Math.max(0, (slope - 0.28) / 0.42)) * 0.75);

    // 斑驳：低频块 + 中频簇，避免出现规则条带
    const n1 = Math.sin(x * 0.21 + z * 0.13) * Math.sin(z * 0.17 - x * 0.09);
    const n2 = Math.sin(x * 0.83 - z * 0.61) * Math.sin(z * 0.72 + x * 0.44);
    const mott = Math.max(-1, Math.min(1, n1 * 0.62 + n2 * 0.38));
    tmp.offsetHSL(mott * 0.012, mott * 0.05, mott * 0.075);

    // 竞技场外侧压向雾色，配合雾把边界藏起来
    const out = Math.max(0, Math.abs(x) - 60, Math.abs(z) - 34);
    const k = Math.min(1, out / 70);
    if (k > 0) tmp.lerp(cEdge, k * 0.82);

    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** 程序化兜底地面（地形文件缺失时用，保证页面仍能跑） */
function buildFallbackGround() {
  const geo = new THREE.PlaneGeometry(320, 220, 160, 110);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const uvArr = new Float32Array(pos.count * 2);
  const cA = new THREE.Color('#8ba46c');
  const cB = new THREE.Color('#a8b072');
  const cDry = new THREE.Color('#c8bd85');
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    // 起伏：小尺度为主，大尺度留给边缘隆起
    const y =
      Math.sin(x * 0.031) * Math.cos(z * 0.027) * 3.2 +
      Math.sin(x * 0.11 + 1.7) * Math.cos(z * 0.09 - 0.6) * 0.85 +
      Math.sin(x * 0.42) * Math.cos(z * 0.37) * 0.16;
    // 边缘抬起，形成盆地感，把视线收在场景内
    const edge = Math.max(Math.abs(x) / 160, Math.abs(z) / 110);
    pos.setY(i, y + Math.max(0, edge - 0.62) * 26);
    const hN = Math.min(1, Math.max(0, (y + 5) / 12));
    tmp.copy(cA).lerp(cB, Math.min(1, hN / 0.5));
    if (hN > 0.55) tmp.lerp(cDry, (hN - 0.55) / 0.45);
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    uvArr[i * 2] = (x + 160) / 320 * 8;
    uvArr[i * 2 + 1] = (z + 110) / 220 * 8;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.98, metalness: 0,
  }));
  m.name = 'fallbackGround';
  return m;
}

/**
 * 构建可行走地面。
 *
 * 关键设计：**1:1 平铺，绝不放大**。
 *
 * 摄影测量网格源尺寸 25×25m，平均三角边长 0.083m —— 本身相当精细。
 * 一旦放大（实测）：
 *   ×3 → 边长 0.25m（可接受）
 *   ×6 → 边长 0.50m（开始能看出折面）
 *   ×9 → 边长 0.74m（满屏低多边形，草像小棍插在纸上）
 * 而"走进去 + 好看"要求近处边长在 0.1~0.3m 量级。
 *
 * 所以正确做法是**保持原尺寸、循环平铺**：
 *   · 网格 1:1，边长仍是 0.083m，近处细节完全保留
 *   · 3×3 九宫格铺出约 75×75m 的活动范围
 *   · 奇偶格交替旋转 180°，打散"一眼看出是重复"的痕迹
 *   · 格边用 smoothstep 混合相邻格高度，消除笔直的接缝台阶
 */
export async function buildGround({
  url = './assets/models/terrain.glb',
  tilesX = 3, tilesZ = 3,
  seamBlend = 4.0,
} = {}) {
  let mesh = null;
  let heightAt = () => 0;
  let tileSpan = [25, 25];
  let tiles = tilesX * tilesZ;

  const loaded = await loadTerrain(url);

  if (loaded) {
    // GLTFLoader 返回的是 **Group**，真正的网格在子节点里。
    // 直接对 Group 调 geometry/recolor 会抛
    // "Cannot read properties of undefined (reading 'computeVertexNormals')"。
    let found = null;
    loaded.traverse((o) => { if (!found && o.isMesh) found = o; });

    if (!found) {
      console.warn('[gs] 地形文件里没有网格，转用程序化地面');
      mesh = buildFallbackGround();
      tiles = 1;
    } else {
      // 源场景是 XY 平面布局（Z 是起伏），转到 three.js 的 Y-up
      found.rotation.set(Math.PI / 2, 0, 0);
      found.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(found);
      const c = bb.getCenter(new THREE.Vector3());
      found.position.set(-c.x, -bb.min.y, -c.z);
      found.scale.setScalar(1);   // **不缩放**，保留原始精度
      found.updateMatrixWorld(true);

      recolorTerrain(found, {
        grassA: '#7d9a5e', grassB: '#a8b878',
        dry: '#c6bd88', soil: '#8a7a5c', fog: '#9fb0a6',
      });

      tileSpan = [bb.max.x - bb.min.x, bb.max.z - bb.min.z];

      // 记录基准 position：clone() 是深拷贝，各格在此基础上做世界偏移
      const basePos = found.position.clone();

      // 平铺九宫格。
      //
      // 关键坑：**不能通过改 rotation.x/y/z 来做交替旋转**。
      // 源网格是"躺平"的（rotation.x = 90°，把 XY 平面的源场景转成水平地面），
      // 一旦用 rotation.set(0, baseRotY + π, 0) 就把 X 的 90° 清掉了 ——
      // 网格会**竖立**成一面墙，表现为"地形消失、只剩草悬空"。
      // 而且 Euler 旋转是内旋（XYZ 序），不是绕世界轴，转起来很容易歪。
      //
      // 正确做法：保留原躺平姿态不动，用一个**绕世界 Y 轴**的旋转矩阵
      // 叠加到它自己的局部 Y 旋转上（premultiply 语义）：
      //   R_new = R_spinY · R_base
      const baseQuat = found.quaternion.clone();     // 含躺平的 90°
      const spinY = new THREE.Quaternion();
      const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

      const root = new THREE.Group();
      root.name = 'groundTiles';
      const list = [];
      for (let iz = 0; iz < tilesZ; iz++) {
        for (let ix = 0; ix < tilesX; ix++) {
          const first = ix === 0 && iz === 0;
          const t = first ? found : found.clone();
          if (!first) {
            // 奇数格绕世界 Y 轴转 180°：R_new = R_spinY · R_base
            spinY.identity();
            if ((ix + iz) % 2 === 1) spinY.copy(flip);
            t.quaternion.copy(spinY).multiply(baseQuat);
            t.position.set(
              basePos.x + ix * tileSpan[0],
              basePos.y,
              basePos.z + iz * tileSpan[1]
            );
          }
          t.scale.set(1, 1, 1);
          t.updateMatrixWorld(true);
          root.add(t);
          list.push(t);
        }
      }
      // Group 自身必须是单位变换，否则会与子 mesh 的 transform 叠加，
      // 高度索引算出的世界坐标就与实际渲染位置对不上。
      root.position.set(0, 0, 0);
      root.quaternion.identity();
      root.scale.set(1, 1, 1);
      root.updateMatrixWorld(true);

      mesh = root;
      heightAt = buildHeightIndex(list, { seamBlend });
    }
  } else {
    mesh = buildFallbackGround();
    tiles = 1;
  }

  // 细节层：中性灰噪声调制色，叠在顶点色上解决"近处糊"
  const detail = makeDetailTexture();
  mesh.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      m.vertexColors = true;
      m.roughness = 0.97;
      m.metalness = 0;
      if (m.isMeshStandardMaterial) {
        m.detailMap = detail;
        m.detailMapIntensity = 0.5;
        m.needsUpdate = true;
      }
    }
    o.receiveShadow = true;
    o.castShadow = false;
  });

  const bb = new THREE.Box3().setFromObject(mesh);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());

  return {
    mesh, heightAt,
    extent: {
      size, center, minY: bb.min.y, maxY: bb.max.y,
      x0: bb.min.x, z0: bb.min.z, sx: size.x, sz: size.z,
      tiles, tileSpan,
    },
  };
}

/**
 * 为平铺网格建高度索引。
 *
 * 每格建一张 0.5m 的网格索引（记录世界 Y），采样时先定位落在哪一格。
 * 靠近格边时把邻格高度按 smoothstep 混进来 —— 不做这一步，
 * 玩家能看到一条条笔直的接缝台阶。
 *
 * 必须先把顶点从**局部坐标**变换到**世界坐标**：
 * 地形网格带 rotation(PI/2) 与 position 偏移，
 * 直接用 geometry.attributes.position 建索引会让玩家站在天上。
 */
function buildHeightIndex(tileMeshes, { seamBlend }) {
  const CELL = 0.5;
  const indexes = [];
  const v3 = new THREE.Vector3();

  for (const mesh of tileMeshes) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position;
    const n = pos.count;
    const wx = new Float32Array(n);
    const wy = new Float32Array(n);
    const wz = new Float32Array(n);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    let minY = Infinity;
    for (let i = 0; i < n; i++) {
      v3.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      wx[i] = v3.x; wy[i] = v3.y; wz[i] = v3.z;
      if (v3.x < x0) x0 = v3.x;
      if (v3.x > x1) x1 = v3.x;
      if (v3.z < z0) z0 = v3.z;
      if (v3.z > z1) z1 = v3.z;
      if (v3.y < minY) minY = v3.y;
    }
    const gx = Math.max(1, Math.ceil((x1 - x0) / CELL));
    const gz = Math.max(1, Math.ceil((z1 - z0) / CELL));
    const grid = new Array(gx * gz);
    for (let i = 0; i < gx * gz; i++) grid[i] = [];
    for (let i = 0; i < n; i++) {
      const ix = Math.min(gx - 1, Math.max(0, Math.floor((wx[i] - x0) / CELL)));
      const iz = Math.min(gz - 1, Math.max(0, Math.floor((wz[i] - z0) / CELL)));
      grid[iz * gx + ix].push(wy[i]);
    }
    const avg = new Float32Array(gx * gz);
    for (let k = 0; k < gx * gz; k++) {
      const a = grid[k];
      avg[k] = a.length ? a.reduce((p, q) => p + q, 0) / a.length : NaN;
    }
    indexes.push({ x0, x1, z0, z1, gx, gz, grid, avg, minY });
  }

  const sample = (idx, x, z) => {
    const ix = Math.min(idx.gx - 1, Math.max(0, Math.floor((x - idx.x0) / CELL)));
    const iz = Math.min(idx.gz - 1, Math.max(0, Math.floor((z - idx.z0) / CELL)));
    const arr = idx.grid[iz * idx.gx + ix];
    if (arr && arr.length) {
      let s = 0;
      for (let i = 0; i < arr.length; i++) s += arr[i];
      return s / arr.length;
    }
    const a = idx.avg[iz * idx.gx + ix];
    return Number.isNaN(a) ? idx.minY : a;
  };

  const find = (x, z) => {
    for (const i of indexes) {
      if (x >= i.x0 && x <= i.x1 && z >= i.z0 && z <= i.z1) return i;
    }
    return null;
  };

  return (x, z) => {
    const cur = find(x, z);
    if (!cur) return 0;
    let h = sample(cur, x, z);

    // 接缝混合：沿最近的边取邻格高度做 smoothstep 过渡
    const edgeX = Math.min(x - cur.x0, cur.x1 - x);
    const edgeZ = Math.min(z - cur.z0, cur.z1 - z);
    const edge = Math.min(edgeX, edgeZ);
    if (edge < seamBlend) {
      let other = null;
      if (edgeX < edgeZ) {
        other = (x - cur.x0) < (cur.x1 - x)
          ? find(cur.x0 - 0.05, z)
          : find(cur.x1 + 0.05, z);
      } else {
        other = (z - cur.z0) < (cur.z1 - z)
          ? find(x, cur.z0 - 0.05)
          : find(x, cur.z1 + 0.05);
      }
      if (other && other !== cur) {
        const k = Math.max(0, Math.min(1, edge / seamBlend));
        const w = k * k * (3 - 2 * k);
        h = sample(other, x, z) * (1 - w) + h * w;
      }
    }
    return h;
  };
}
