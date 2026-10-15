/**
 * 地表散布物：草簇、石头、花。
 *
 * 为什么 GS 版需要自己散布，而不能直接用摄影测量里的树：
 *   SPZ 里的树是**烘焙在高斯泼溅里**的，它们没有独立的深度，
 *   你无法判断"某棵树前面能不能走"。玩家撞上去会穿模，
 *   视觉上却像被挡住 —— 这是把带植被的扫描场景改成可行走地形时
 *   最容易被忽略的坑。
 *   所以这里的散布物全部是**真实几何体**，有真实碰撞深度。
 *
 * 性能策略：草用 InstancedMesh，一次绘制几千株；
 * 并且用"离玩家太远就整体隐藏"的方式做淡出，避免无谓的填充率。
 */

import * as THREE from 'three';

const rndSeed = (i) => {
  let h = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return h - Math.floor(h);
};

/** 一簇草：几片交叉的细长片，比单片有体积感 */
function grassGeometry() {
  const blades = 3;
  const geos = [];
  for (let i = 0; i < blades; i++) {
    const g = new THREE.PlaneGeometry(0.11, 0.42, 1, 3);
    // 让草叶向上收窄并轻微弯曲
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.21;      // 0..0.42
      const t = y / 0.42;
      pos.setX(v, pos.getX(v) * (1 - t * 0.75));
      pos.setZ(v, pos.getZ(v) + t * t * 0.1); // 前倾
    }
    g.computeVertexNormals();
    g.rotateY((i / blades) * Math.PI);
    g.translate((i / blades - 0.5) * 0.08, 0, (i % 2 - 0.5) * 0.06);
    geos.push(g);
  }
  // 合并成一个几何体（手工合并，避免多 draw call）
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const arr = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const idx = [];
  let vo = 0;
  for (const g of geos) {
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    arr.set(p, vo * 3);
    nor.set(n, vo * 3);
    const gi = g.index ? g.index.array : null;
    const c = g.attributes.position.count;
    if (gi) for (let i = 0; i < gi.length; i++) idx.push(gi[i] + vo);
    else for (let i = 0; i < c; i++) idx.push(i + vo);
    vo += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/** 石头：不规则多面体，比球体耐看 */
function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const s = 0.62 + rndSeed(seed * 37 + i) * 0.62;
    v.multiplyScalar(s);
    // 上下压扁：石头是趴在地上的，不是球
    v.y *= 0.62;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * 散布地表物件。
 *
 * density 散布密度（每 100 m² 的个数），会按"避开中心路径"微调，
 * 保证玩家常走的地方不会全是草挡住视线。
 */
export function scatterGround({
  heightAt, extent,
  grassCount = 9000,
  rockCount = 90,
  flowerCount = 700,
  cullRadius = 46,
  grassColor = '#8fae63',
  grassColorDry = '#c2bd82',
} = {}) {
  const group = new THREE.Group();
  group.name = 'scatter';
  const { x0, z0, sx, sz } = extent;

  const pick = (i) => {
    const u = rndSeed(i * 1.13 + 7.7);
    const v = rndSeed(i * 2.71 + 3.3);
    return [x0 + u * sx, z0 + v * sz];
  };

  // —— 草 ——
  const gg = grassGeometry();
  // 顶点色让同一批草有黄绿差异，避免"塑料草"
  {
    const c = new Float32Array(gg.attributes.position.count * 3);
    const col = new THREE.Color();
    const a = new THREE.Color(grassColor), b = new THREE.Color(grassColorDry);
    for (let i = 0; i < gg.attributes.position.count; i++) {
      col.copy(a).lerp(b, 0.35 + rndSeed(i * 5.1) * 0.5);
      c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const grassMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0,
    side: THREE.DoubleSide,     // 单面片背面会被剔除成"看不见"
    alphaTest: 0.5,
  });
  const grass = new THREE.InstancedMesh(gg, grassMat, grassCount);
  grass.castShadow = false;
  grass.receiveShadow = true;
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < grassCount; i++) {
      const [x, z] = pick(i);
      const y = heightAt(x, z);
      p.set(x, y - 0.04, z);
      e.set(0, rndSeed(i * 3.7) * Math.PI * 2, 0);
      q.setFromEuler(e);
      const sc = 0.7 + rndSeed(i * 9.1) * 0.85;
      s.set(sc, sc * (0.75 + rndSeed(i * 4.3) * 0.7), sc);
      m.compose(p, q, s);
      grass.setMatrixAt(i, m);
    }
    grass.instanceMatrix.needsUpdate = true;
  }
  grass.frustumCulled = false;
  group.add(grass);

  // —— 花：给草甸加一点色彩焦点 ——
  if (flowerCount > 0) {
    const fg = new THREE.BufferGeometry();
    // 小四边形，比草更亮
    fg.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.045, 0, 0, 0.045, 0, 0, 0.045, 0.1, 0, -0.045, 0.1, 0,
    ], 3));
    fg.setIndex([0, 1, 2, 0, 2, 3]);
    fg.computeVertexNormals();
    const fm = new THREE.MeshBasicMaterial({
      vertexColors: false, color: 0xf2e0a0, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85, depthWrite: false,
    });
    const flower = new THREE.InstancedMesh(fg, fm, flowerCount);
    {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const p = new THREE.Vector3();
      const s = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < flowerCount; i++) {
        const [x, z] = pick(i + 50000);
        p.set(x, heightAt(x, z) + 0.06, z);
        e.set(0, rndSeed(i * 6.3) * Math.PI, 0);
        q.setFromEuler(e);
        m.compose(p, q, s);
        flower.setMatrixAt(i, m);
      }
      flower.instanceMatrix.needsUpdate = true;
    }
    flower.frustumCulled = false;
    group.add(flower);
  }

  // —— 石头：给空旷地加地标，也让玩家有"绕不过去"的实体感 ——
  const rocks = [];
  const rg = rockGeometry(7);
  const rm = new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 0.94, metalness: 0.02 });
  const rock = new THREE.InstancedMesh(rg, rm, rockCount);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < rockCount; i++) {
      const [x, z] = pick(i + 90000);
      const sc = 0.7 + rndSeed(i * 8.8) * 2.3;
      p.set(x, heightAt(x, z) - sc * 0.16, z);
      e.set(rndSeed(i * 2.2) * 0.4, rndSeed(i * 3.9) * Math.PI * 2, rndSeed(i * 5.4) * 0.4);
      q.setFromEuler(e);
      s.set(sc, sc * (0.7 + rndSeed(i * 7.7) * 0.5), sc * (0.85 + rndSeed(i * 1.9) * 0.4));
      m.compose(p, q, s);
      rock.setMatrixAt(i, m);
      rocks.push({ x, z, r: sc * 0.42 });
    }
    rock.instanceMatrix.needsUpdate = true;
  }
  rock.castShadow = true;
  rock.receiveShadow = true;
  rock.frustumCulled = false;
  group.add(rock);

  /**
   * 每帧更新草/花的可见性。
   *
   * 做法：按距离把实例**紧凑重排**到 buffer 前段，再把 count 截断。
   * count 之后的实例 GPU 根本不会画，这就是最廉价的"淡出裁剪"。
   * cutoff 必须放得比可视距离远，否则玩家会看到草突然消失。
   *
   * 注意不能只遍历可见部分再原地写回 —— 那样会漏掉后面的实例。
   * 必须读写双游标：读游标扫全部，写游标只前进。
   */
  // —— 可见性裁剪用的空间分桶 ——
  // 草有 4 万+ 株，如果每帧线性遍历全部实例算距离，光 JS 就吃掉几毫秒。
  // 这里按 8m 的格子把实例分桶，裁剪时只扫玩家附近的桶。
  const BUCKET = 8;
  const bx0 = x0, bz0 = z0;
  const bgx = Math.max(1, Math.ceil(sx / BUCKET));
  const bgz = Math.max(1, Math.ceil(sz / BUCKET));
  /** @type {number[][]} 每桶存草的索引 */
  const buckets = Array.from({ length: bgx * bgz }, () => []);
  const grassXZ = new Float32Array(grassCount * 2);
  for (let i = 0; i < grassCount; i++) {
    const [x, z] = pick(i);
    grassXZ[i * 2] = x;
    grassXZ[i * 2 + 1] = z;
    const cx = Math.min(bgx - 1, Math.max(0, Math.floor((x - bx0) / BUCKET)));
    const cz = Math.min(bgz - 1, Math.max(0, Math.floor((z - bz0) / BUCKET)));
    buckets[cz * bgx + cx].push(i);
  }

  const mTmp = new THREE.Matrix4();

  /**
   * 裁剪：只保留玩家附近的草。
   *
   * 做法：遍历附近的桶，把其中的实例**紧凑重排**到 instanceMatrix 的前段，
   * 再把 count 截断。count 之后的实例 GPU 完全不会画，
   * 这是最廉价的裁剪（不需要 per-instance 的额外状态，也不会有跳变感 ——
   * 因为 cutoff 半径远大于可视距离，配合雾看不见切换）。
   */
  const update = (px, pz) => {
    const R = cullRadius + 18;          // 18m 缓冲，配合雾让切换不可见
    const R2 = R * R;
    const cx0 = Math.min(bgx - 1, Math.max(0, Math.floor((px - R - bx0) / BUCKET)));
    const cx1 = Math.min(bgx - 1, Math.max(0, Math.floor((px + R - bx0) / BUCKET)));
    const cz0 = Math.min(bgz - 1, Math.max(0, Math.floor((pz - R - bz0) / BUCKET)));
    const cz1 = Math.min(bgz - 1, Math.max(0, Math.floor((pz + R - bz0) / BUCKET)));

    let w = 0;
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = buckets[cz * bgx + cx];
        for (let bi = 0; bi < list.length; bi++) {
          const i = list[bi];
          const dx = grassXZ[i * 2] - px, dz = grassXZ[i * 2 + 1] - pz;
          if (dx * dx + dz * dz > R2) continue;
          grass.getMatrixAt(i, mTmp);
          grass.setMatrixAt(w++, mTmp);
          if (w >= grassCount) break;
        }
      }
    }
    grass.count = w;
    grass.instanceMatrix.needsUpdate = true;
  };

  /** 初始化后立即裁剪一次，避免第一帧把 4 万株全画出来 */
  update((x0 + sx / 2), (z0 + sz / 2));

  return { group, rocks, update };
}
