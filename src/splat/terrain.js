/**
 * splat 贴图版 —— 程序化地形 mesh（单 mesh / 单 draw call）。
 *
 * PlaneGeometry 细分 → 顶点用 heightfield.terrainHeight 抬升 →
 * computeVertexNormals → rotateX(-90°) 落地；
 * 材质是自写 ShaderMaterial（见 shaders.js），4 通道 splat 权重图
 * 由 DataTexture 直传，4 张程序化地表贴图各占一个 sampler。
 *
 * 仅浏览器侧加载（main.js 在 config.splat.enabled 放行后动态 import），
 * Node 测试不加载本文件。
 */

import * as THREE from 'three';
import { splat } from '../core/config.js';
import { terrainHeight } from './heightfield.js';
import { SPLAT_VERTEX_SHADER, SPLAT_FRAGMENT_SHADER } from './shaders.js';
import { paintSplatMap } from './splat-painter.js';
import { makeAllTextures, createTileTexture } from './textures.js';

/** 权重缓冲 → DataTexture（线性采样，ClampToEdge：全场只采一次） */
export function createSplatDataTexture(painted) {
  const tex = new THREE.DataTexture(
    painted.data, painted.size, painted.size,
    THREE.RGBAFormat, THREE.UnsignedByteType
  );
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; // 权重图不做 mip，避免跨级时权重串带
  tex.colorSpace = THREE.NoColorSpace; // 这是权重，不是颜色
  tex.needsUpdate = true;
  return tex;
}

/**
 * 构建 splat 地形。
 * @returns {{mesh:THREE.Mesh, painted:object, textures:object}}
 */
export function buildSplatTerrain() {
  const { fieldW, fieldH, segX, segZ, mapSize, tileRepeat, sun } = splat;

  // —— 1. 几何：平面 → 高度场 → 法线 ——
  const geo = new THREE.PlaneGeometry(fieldW, fieldH, segX, segZ);
  // 先旋转到 XZ 平面，再在真实世界 (x,z) 坐标采高度，
  // 确保几何与按世界坐标生成的 splat 图逐点对齐。
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // —— 2. splat 4 通道权重图（1024²，Uint8ClampedArray → DataTexture）——
  const painted = paintSplatMap(mapSize, fieldW, fieldH);
  const uSplat = createSplatDataTexture(painted);

  // —— 3. 4 张程序化地表贴图（512²，各 0 外部资源）——
  const tiles = makeAllTextures();
  const textures = {
    grass: createTileTexture(THREE, tiles.grass),
    sand: createTileTexture(THREE, tiles.sand),
    snow: createTileTexture(THREE, tiles.snow),
    rock: createTileTexture(THREE, tiles.rock),
  };

  // —— 4. shader 材质（地形全场唯一材质）——
  const material = new THREE.ShaderMaterial({
    vertexShader: SPLAT_VERTEX_SHADER,
    fragmentShader: SPLAT_FRAGMENT_SHADER,
    uniforms: {
      uSplat: { value: uSplat },
      uGrass: { value: textures.grass },
      uSand: { value: textures.sand },
      uSnow: { value: textures.snow },
      uRock: { value: textures.rock },
      uRepeat: { value: tileRepeat },
      uSunDir: { value: new THREE.Vector3(sun.dir.x, sun.dir.y, sun.dir.z).normalize() },
    },
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'splat-terrain';
  mesh.frustumCulled = false;
  return { mesh, painted, textures, geometry: geo, material };
}

/**
 * 远山装饰：单个 InstancedMesh（5-8 个低多边形圆锥，1 个 instanced draw call）。
 * 放在场外雾里，只做剪影；高度 ~30m。
 */
export function buildMountains() {
  const { count, height, radius, distance } = splat.mountains;
  const geo = new THREE.ConeGeometry(radius, height, 5, 1);
  const mat = new THREE.MeshLambertMaterial({ color: 0x7d8a99, flatShading: true });
  const inst = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + 0.37;
    const d = distance + (i % 2) * 14;
    p.set(Math.cos(ang) * d, height / 2 - 6, Math.sin(ang) * d);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang * 2.3);
    const k = 0.85 + ((i * 37) % 10) / 30;
    s.set(k, 1 + ((i * 13) % 8) / 20, k);
    m.compose(p, q, s);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;
  inst.name = 'splat-mountains';
  return inst;
}
