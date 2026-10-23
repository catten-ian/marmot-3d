/** Dev-only A Verdant Trail scene loader and walkable height sampler. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getAssetCandidates } from './local-pack.js';
import { buildWalkableField } from './verdant-collision.js';
import { downloadVerdantPack } from './asset-downloader.mjs';

async function fetchJson(path, tier, sourceOnly = false, signal = null) {
  const errors = [];
  for (const url of getAssetCandidates(path, tier, sourceOnly)) {
    try {
      const response = await fetch(url, signal ? { signal } : undefined);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { errors.push(`${url}: ${error.message}`); }
  }
  throw new Error(`Verdant JSON fallback exhausted for ${path}: ${errors.join(' | ')}`);
}

function loadGltfCandidate(url, resourceBase, sourceOnly, tier, packManifest, onProgress, signal = null) {
  return new Promise(async (resolve, reject) => {
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((resourceUrl) => {
      if (/^(data:|blob:)/i.test(resourceUrl)) return resourceUrl;
      try {
        const logical = new URL(resourceUrl, resourceBase).href;
        return getAssetCandidates(logical, tier, sourceOnly)[0] || resourceUrl;
      } catch (_) { return resourceUrl; }
    });
    manager.onProgress = (_item, loaded, total) => onProgress?.(Math.min(0.98, loaded / Math.max(1, total)), '加载场景外置资源');
    manager.onError = (resourceUrl) => reject(new Error(`外置资源读取失败：${resourceUrl}`));
    const loader = new GLTFLoader(manager);
    const logicalPackBase = new URL('.', resourceBase).href;
    const localCandidate = /^blob:/i.test(url);
    let downloaded = null;
    const logicalUrl = new URL(resourceBase, location.href).href;
    if (!/\.gltf(?:$|[?#])/i.test(logicalUrl)) {
      (async () => {
        try {
          downloaded = await downloadVerdantPack(packManifest, { scenePath: resourceBase, baseUrl: logicalPackBase, resolveLocal: localCandidate && !sourceOnly ? (logical) => getAssetCandidates(logical, tier, false).find((candidate) => /^blob:/i.test(candidate)) || null : null, candidatesForFile: (path) => { const list = getAssetCandidates(new URL(path, resourceBase).href, tier); return localCandidate && !sourceOnly ? list : sourceOnly ? list.slice(-1) : list.filter((candidate) => !/^blob:/i.test(candidate)); }, signal, onProgress: (stats) => { try { window.__verdantLastDownloadStats = stats; } catch (_) {} onProgress?.(stats.totalBytes > 0 ? stats.doneBytes / stats.totalBytes : 0, stats.text || '加载 Verdant 资源', stats); } });
          const mapped = downloaded.urls.get(new URL(url).pathname.split('/').pop()) || url;
          manager.setURLModifier((resourceUrl) => {
            if (/^(data:|blob:)/i.test(resourceUrl)) return resourceUrl;
            const name = decodeURIComponent(new URL(resourceUrl, resourceBase).pathname.split('/').pop() || '');
            return downloaded.urls.get(name) || resourceUrl;
          });
          loader.load(mapped, (gltf) => { downloaded?.revoke(); resolve(gltf.scene); }, undefined, (error) => { downloaded?.revoke(); reject(error); });
        } catch (error) { downloaded?.revoke(); reject(error); }
      })();
      return;
    }
    try {
      downloaded = await downloadVerdantPack(packManifest, { scenePath: resourceBase, baseUrl: logicalPackBase, resolveLocal: localCandidate && !sourceOnly ? (logical) => getAssetCandidates(logical, tier, false).find((candidate) => /^blob:/i.test(candidate)) || null : null, candidatesForFile: (path) => { const list = getAssetCandidates(new URL(path, resourceBase).href, tier); return localCandidate && !sourceOnly ? list : sourceOnly ? list.slice(-1) : list.filter((candidate) => !/^blob:/i.test(candidate)); }, signal, onProgress: (stats) => { try { window.__verdantLastDownloadStats = stats; } catch (_) {} onProgress?.(stats.totalBytes > 0 ? stats.doneBytes / stats.totalBytes : 0, stats.text || '加载 Verdant 资源', stats); } });
      manager.setURLModifier((resourceUrl) => {
        if (/^(data:|blob:)/i.test(resourceUrl)) return resourceUrl;
        const name = decodeURIComponent(new URL(resourceUrl, resourceBase).pathname.split('/').pop() || '');
        return downloaded.urls.get(name) || getAssetCandidates(new URL(resourceUrl, resourceBase).href, tier, sourceOnly)[0] || resourceUrl;
      });
      const response = await fetch(url);
      if (!response.ok) throw new Error(`glTF HTTP ${response.status}`);
      const json = await response.json();
      loader.parse(json, new URL('.', logicalUrl).href, (gltf) => { downloaded?.revoke(); resolve(gltf.scene); }, (error) => { downloaded?.revoke(); reject(error); });
    } catch (error) { downloaded?.revoke(); reject(error); }
  });
}

async function loadGltf(path, tier, packManifest, onProgress, signal = null) {
  const logicalUrl = new URL(path, location.href).href;
  const resourceBase = logicalUrl;
  const candidates = getAssetCandidates(logicalUrl, tier);
  const errors = [];
  for (let i = 0; i < candidates.length; i++) {
    try {
      onProgress?.(i / Math.max(1, candidates.length), i === 0 ? '尝试本地资源包' : i === candidates.length - 1 ? '回退到同源资源' : '尝试 TOS 资源');
      const scene = await loadGltfCandidate(candidates[i], resourceBase, i === candidates.length - 1, tier, packManifest, onProgress, signal);
      return scene;
    } catch (error) { errors.push(`${candidates[i]}: ${error.message}`); if (error?.allCandidatesFailed || error?.partialBytes) break; }
  }
  throw new Error(`Verdant 场景 local → TOS → source 回退均失败：${errors.join(' | ')}`);
}

export async function loadVerdantWorld({ base = './assets/verdant/', tier = 'medium', onProgress, renderer, signal = null } = {}) {
  const root = base.endsWith('/') ? base : `${base}/`;
  onProgress?.(0.04, '读取 Verdant 清单');
  const catalog = await fetchJson(`${root}manifest.json`, tier, false, signal);
  const tierEntry = catalog.tiers?.[tier];
  if (catalog.tiers && !tierEntry) throw new Error(`Verdant 清单没有 ${tier} 档，保持手动档位不降级`);
  const manifestPath = tierEntry?.manifest ? `${root}${tierEntry.manifest}` : `${root}manifest.json`;
  const manifest = catalog.tiers ? await fetchJson(manifestPath, tier, false, signal) : catalog;
  const activeTier = manifest.export?.tier || tier;
  if (activeTier !== tier) throw new Error(`请求 ${tier} 档但清单返回 ${activeTier}，拒绝静默降档`);

  onProgress?.(0.12, '读取 Verdant 高度场');
  const heightPath = catalog.height ? `${root}${catalog.height}` : `${root}tiers/${activeTier}/${manifest.files.height}`;
  const height = await fetchJson(heightPath, activeTier, false, signal);
  onProgress?.(0.18, '读取资源完整性清单');
  const packManifestPath = `${root}tiers/${activeTier}/${manifest.packManifest || 'pack-manifest.json'}`;
  const packManifest = await fetchJson(packManifestPath, activeTier, false, signal);
  if (!Array.isArray(packManifest.files) || packManifest.files.length !== packManifest.fileCount || packManifest.tier !== activeTier) {
    throw new Error(`Verdant ${activeTier} pack-manifest 结构/档位无效`);
  }
  const scenePath = `${root}tiers/${activeTier}/${manifest.files.scene}`;
  onProgress?.(0.2, '加载 Verdant 场景');
  const scene = await loadGltf(scenePath, activeTier, packManifest, (p, label, stats) => onProgress?.(0.2 + p * 0.78, label || '加载 Verdant 场景', stats), signal);
  scene.name = 'VerdantTrailWorld';
  scene.userData.verdantTier = activeTier;
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = false; obj.receiveShadow = true;
    const apply = (material) => {
      const m = material.clone(); m.roughness = 0.94; m.metalness = 0;
      const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 4;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'alphaMap']) {
        const tex = m[key]; if (!tex) continue;
        tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = Math.min(maxAniso, 16); tex.colorSpace = key === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace; tex.needsUpdate = true;
      }
      return m;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(apply) : apply(obj.material);
  });
  const group = new THREE.Group(); group.name = 'VerdantTrailEnvironment'; group.add(scene);
  group.userData.verdantManifest = manifest; group.userData.packManifest = packManifest;
  onProgress?.(0.99, '光栅化可行走地面（地面 / 岩石 / 树根）');
  // 用真实 GLB 静态碰撞几何重建可行走高度场（导出 JSON 只采样了 ground，
  // 岩石/悬崖缺失、外缘水面为 0——真机掉底与跳不上岩石的根因）。
  const field = buildWalkableField({ scene, heightJson: height, bounds: manifest.mapping.playableBounds });
  console.info('[verdant] 可行走高度场:', field.stats);
  onProgress?.(1, 'Verdant 场景就绪');
  return {
    group, manifest, packManifest, tier: activeTier, height,
    heightAt: field.heightAt, resolveGround: field.resolveGround,
    nearestWalkable: field.nearestWalkable, fieldStats: field.stats,
    bounds: manifest.mapping.playableBounds, cellSize: field.cellSize,
  };
}
