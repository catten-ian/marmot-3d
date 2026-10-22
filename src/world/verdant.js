/** Dev-only A Verdant Trail scene loader and walkable height sampler. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

function bilinearHeight(data, x, z) {
  const n = data.gridSize;
  const b = data.bounds;
  const tx = THREE.MathUtils.clamp((x - b.minX) / Math.max(1e-6, b.maxX - b.minX), 0, 1);
  const tz = THREE.MathUtils.clamp((z - b.minZ) / Math.max(1e-6, b.maxZ - b.minZ), 0, 1);
  // Export grid rows follow source Y (runtime X), columns follow source X (runtime Z).
  const gx = tx * (n - 1);
  const gz = tz * (n - 1);
  const i0 = Math.floor(gx), j0 = Math.floor(gz);
  const i1 = Math.min(n - 1, i0 + 1), j1 = Math.min(n - 1, j0 + 1);
  const fx = gx - i0, fz = gz - j0;
  const at = (i, j) => data.heights[j * n + i] || 0;
  const a = at(i0, j0) * (1 - fx) + at(i1, j0) * fx;
  const c = at(i0, j1) * (1 - fx) + at(i1, j1) * fx;
  return a * (1 - fz) + c * fz;
}

function loadGltf(url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    }, reject);
  });
}

export async function loadVerdantWorld({ base = './assets/verdant/', onProgress, resolveAsset, renderer } = {}) {
  const root = base.endsWith('/') ? base : `${base}/`;
  onProgress?.(0.04, '读取 Verdant 清单');
  const readJson = async (path) => {
    const local = resolveAsset ? await resolveAsset(path) : null;
    if (local) return fetch(local).then((r) => r.json());
    return fetch(path, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(`resource HTTP ${r.status}`); return r.json(); });
  };
  const asset = async (path) => (resolveAsset ? await resolveAsset(path) : null) || path;
  const manifest = await readJson(`${root}manifest.json`);
  onProgress?.(0.12, '读取 Verdant 地形');
  const height = await readJson(`${root}${manifest.files.height}`);
  onProgress?.(0.2, '加载 Verdant 场景');
  const scene = await loadGltf(await asset(`${root}${manifest.files.scene}`), (p) => onProgress?.(0.2 + p * 0.78, '加载 Verdant 场景'));
  scene.name = 'VerdantTrailWorld';
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false;
    obj.receiveShadow = true;
    const apply = (material) => {
      const m = material.clone();
      m.roughness = 0.94;
      m.metalness = 0;
      const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'alphaMap']) {
        const tex = m[key];
        if (!tex) continue;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(maxAniso, 8);
        tex.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
      }
      return m;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(apply) : apply(obj.material);
  });
  const group = new THREE.Group();
  group.name = 'VerdantTrailEnvironment';
  group.add(scene);
  group.userData.verdantManifest = manifest;
  onProgress?.(1, 'Verdant 场景就绪');
  return {
    group,
    manifest,
    height,
    heightAt: (x, z) => bilinearHeight(height, x, z),
    bounds: manifest.mapping.playableBounds,
  };
}
