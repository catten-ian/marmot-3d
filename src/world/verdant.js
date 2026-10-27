/** Dev-only A Verdant Trail scene loader and walkable height sampler. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getAssetCandidates } from './local-pack.js';
import { buildWalkableField } from './verdant-collision.js';
import { parseWalkableFieldBin } from './verdant-walkable-bin.mjs';
import { createProgressReporter, fetchWithFailover, parseGltfReferences, sourceLabelOf } from './verdant-progress.mjs';
import { exceedsMemoryBudget, getMemorySnapshot } from '../core/memory-budget.mjs';

/** 单个下载源首字节无响应的上限：超过即判定该源故障，切下一个源。 */
const SOURCE_STALL_MS = 8000;
/** 传输中途无字节的上限：超过即判定该源卡死。 */
const SOURCE_IDLE_MS = 60000;

async function fetchJson(path, tier, sourceOnly = false, signal = null) {
  const errors = [];
  for (const url of getAssetCandidates(path, tier, sourceOnly)) {
    try {
      const init = {};
      if (signal) init.signal = signal;
      // 清单类 JSON 走条件验证（ETag → 304 零字节）：内容永远新鲜，且未变时不重下。
      if (/^https?:/i.test(url)) init.cache = 'no-cache';
      const response = await fetch(url, init);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) { errors.push(`${url}: ${error.message}`); }
  }
  throw new Error(`Verdant JSON fallback exhausted for ${path}: ${errors.join(' | ')}`);
}

/**
 * 用统一候选链（本地资源包 → 火山 TOS → 同源服务器）下载一个资源，
 * 逐块回报字节进度；单源首字节超时即换下一个源。
 */
async function downloadAsset(url, { tier, signal, size, reporter, cache }) {
  const candidates = getAssetCandidates(url, tier);
  const result = await fetchWithFailover(candidates, {
    signal,
    stallMs: SOURCE_STALL_MS,
    idleMs: SOURCE_IDLE_MS,
    expectedSize: size || 0,
    cache: cache || '',
    onOpen: ({ totalBytes }) => { reporter.setTotal(totalBytes || size || 0); },
    onChunk: (bytes) => {
      reporter.addBytes(bytes);
      reporter.publish({ currentPath: url });
      // 字节心跳：让 index.html 的看门狗知道网络仍在传输，避免误判停滞。
      globalThis.__m3dByteHeartbeat?.({
        url, loaded: reporter.doneBytes, total: reporter.totalBytes, lengthComputable: true,
      });
    },
    onSwitch: ({ from, to }) => {
      reporter.publish({ text: `${sourceLabelOf(from)} 无响应，切换到${sourceLabelOf(to)}`, sourceLabel: sourceLabelOf(to) });
    },
  });
  if (!reporter.totalBytes) reporter.setTotal(result.totalBytes || size || 0);
  return result;
}

/**
 * 加载场景资产。
 *
 * - GLB（low/medium/high）：场景自包含，贴图与 buffer 全部内嵌；
 *   下载整个 GLB 即可，进度即该文件的真实字节。
 * - glTF（ultra）：场景引用外部 buffer 与贴图；先取 glTF 清单，
 *   再按清单只下载**被引用到**的那些文件（pack-manifest 里另有约 1.1GB 未引用资源，
 *   全量下载既慢又没必要），最后把外部资源指向本地 blob。
 *   blob 路径失败时回退到原生加载（由 GLTFLoader 直接回源），保证不因改写而彻底失败。
 */
async function loadSceneAsset({ scenePath, tier, packManifest, onProgress, signal }) {
  const sceneUrl = new URL(scenePath, location.href).href;
  const sceneName = decodeURIComponent(sceneUrl.split('/').pop() || '');
  const sizeByPath = new Map((packManifest?.files || []).map((file) => [String(file?.path || ''), Number(file?.size) || 0]));
  const sceneSize = sizeByPath.get(sceneName) || 0;
  const isGltf = /\.gltf(?:$|[?#])/i.test(sceneUrl);

  // 场景进度：只统计场景资产本身的总字节，HUD 用它算「已下 / 总 / 剩余 / 速度」。
  const reporter = createProgressReporter({
    onProgress: (stats) => {
      const pct = stats.totalBytes > 0 ? Math.min(1, stats.doneBytes / stats.totalBytes) : 0;
      onProgress?.(pct, stats.text || '加载 Verdant 资源', stats);
    },
  });

  const manager = new THREE.LoadingManager();
  let parseItems = 0;
  let parseDone = 0;
  let parseReject = null;
  let parseMemoryError = null;
  const checkMemory = (extraBytes = 0) => exceedsMemoryBudget({ snapshot: getMemorySnapshot(), extraBytes });
  const stopForMemory = (extraBytes = 0) => {
    if (!checkMemory(extraBytes) || parseMemoryError) return;
    parseMemoryError = new Error('Verdant 解析触及内存保留线，已主动停止以保护浏览器');
    parseReject?.(parseMemoryError);
  };
  const reportParse = (text = '解析 Verdant 场景素材') => {
    const total = Math.max(parseItems, parseDone);
    const fraction = total ? Math.min(1, parseDone / total) : 0;
    onProgress?.(fraction, `${text} ${parseDone}/${total || '?'}${total ? '' : ''}`, { phase: 'parse', doneItems: parseDone, totalItems: total });
  };
  manager.onStart = (_url, itemsLoaded, itemsTotal) => { parseItems = Math.max(parseItems, itemsTotal || 0); reportParse(); };
  manager.onProgress = (_url, itemsLoaded, itemsTotal) => { parseItems = Math.max(parseItems, itemsTotal || 0); parseDone = Math.max(parseDone, itemsLoaded || 0); stopForMemory(); reportParse(); };
  manager.onLoad = () => { parseDone = Math.max(parseDone, parseItems); reportParse(); };
  manager.onError = () => {};
  manager.setURLModifier((resourceUrl) => {
    if (/^(data:|blob:)/i.test(resourceUrl)) return resourceUrl;
    try {
      const logical = new URL(resourceUrl, sceneUrl).href;
      return getAssetCandidates(logical, tier)[0] || resourceUrl;
    } catch (_) { return resourceUrl; }
  });
  const loader = new GLTFLoader(manager);

  const parseScene = (data, path) => new Promise((resolve, reject) => {
    parseItems = 0; parseDone = 0; parseMemoryError = null; parseReject = reject; reportParse();
    if (checkMemory(data?.byteLength || 0)) { stopForMemory(data?.byteLength || 0); return; }
    const originalCreateImageBitmap = globalThis.createImageBitmap;
    let activeDecodes = 0; const decodeQueue = [];
    const restoreDecodeLimit = () => { if (globalThis.createImageBitmap === limitedCreateImageBitmap) globalThis.createImageBitmap = originalCreateImageBitmap; };
    const drain = () => {
      while (activeDecodes < 3 && decodeQueue.length) {
        const { args, resolve: ok, reject: fail } = decodeQueue.shift(); activeDecodes++;
        Promise.resolve().then(() => originalCreateImageBitmap(...args)).then(ok, fail).finally(() => { activeDecodes--; drain(); });
      }
    };
    const limitedCreateImageBitmap = (...args) => new Promise((resolve, reject) => { decodeQueue.push({ args, resolve, reject }); drain(); });
    if (typeof originalCreateImageBitmap === 'function') { try { globalThis.createImageBitmap = limitedCreateImageBitmap; } catch (_) {} }
    try {
      loader.parse(data, path, (gltf) => {
        restoreDecodeLimit(); parseReject = null;
        if (parseMemoryError) { reject(parseMemoryError); return; }
        stopForMemory(); if (parseMemoryError) { reject(parseMemoryError); return; }
        reportParse('解析 Verdant 场景素材'); resolve(gltf.scene);
      }, (error) => { restoreDecodeLimit(); parseReject = null; reject(error); });
    } catch (error) { restoreDecodeLimit(); parseReject = null; reject(error); }
  });

  if (!isGltf) {
    // GLB 自包含：一次流式下载即可拿到全部进度。
    const result = await downloadAsset(sceneUrl, { tier, signal, size: sceneSize, reporter });
    reporter.publish({ cached: result.cached, sourceLabel: sourceLabelOf(result.url) });
    const bytes = result.bytes;
    // streamUrl 已在需要时拼成紧凑 Uint8Array；仅在存在偏移/尾部空间时复制，避免常态峰值翻倍。
    const arrayBuffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const scene = await parseScene(arrayBuffer, new URL('.', sceneUrl).href);
    // 解析器接管 GLB 数据后不再保留下载缓冲引用。
    return scene;
  }

  // glTF：先取清单（小文件，单独统计），再按引用下载外部资源。
  const manifestReporter = createProgressReporter({
    onProgress: (stats) => onProgress?.(0, stats.text || '读取 Verdant 场景清单', stats),
  });
  const gltfResult = await downloadAsset(sceneUrl, { tier, signal, size: sceneSize, reporter: manifestReporter, cache: 'no-cache' });
  const json = JSON.parse(new TextDecoder().decode(gltfResult.bytes));
  const references = parseGltfReferences(json);
  const depBytes = references.reduce((sum, reference) => sum + (sizeByPath.get(reference) || 0), 0);
  reporter.setTotal(sceneSize + depBytes);
  reporter.addBytes(gltfResult.bytes.byteLength);

  const blobUrls = [];
  const blobs = new Map();
  for (const reference of references) {
    const referenceUrl = new URL(reference, new URL('.', sceneUrl).href).href;
    const result = await downloadAsset(referenceUrl, { tier, signal, size: sizeByPath.get(reference) || 0, reporter });
    const blobUrl = URL.createObjectURL(new Blob([result.bytes]));
    blobUrls.push(blobUrl);
    blobs.set(reference, blobUrl);
  }

  // 把外部资源改写为本地 blob，GLTFLoader 直接从内存读，不再回源。
  const rewritten = {
    ...json,
    buffers: (json.buffers || []).map((buffer) => (blobs.has(buffer.uri) ? { ...buffer, uri: blobs.get(buffer.uri) } : buffer)),
    images: (json.images || []).map((image) => (blobs.has(image.uri) ? { ...image, uri: blobs.get(image.uri) } : image)),
  };

  try {
    return await parseScene(rewritten, new URL('.', sceneUrl).href);
  } catch (error) {
    // blob 路径失败 → 交回原生加载（GLTFLoader 自己按 URL 候选链回源），不因改写而彻底失败。
    console.warn('[verdant] blob 资源改写失败，回退原生加载:', error?.message || error);
    return await parseScene(json, new URL('.', sceneUrl).href);
  } finally {
    for (const blobUrl of blobUrls) URL.revokeObjectURL(blobUrl);
  }
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
  const scene = await loadSceneAsset({ scenePath, tier: activeTier, packManifest, onProgress, signal });
  scene.name = 'VerdantTrailWorld';
  scene.userData.verdantTier = activeTier;
  await new Promise((resolve) => setTimeout(resolve, 0));
  const materialMeshes = []; scene.traverse((obj) => { if (obj.isMesh) materialMeshes.push(obj); });
  const materialTotal = materialMeshes.length;
  for (let index = 0; index < materialTotal; index++) {
    const obj = materialMeshes[index];
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
    onProgress?.((index + 1) / Math.max(1, materialTotal), `准备 Verdant 材质与贴图 ${index + 1}/${materialTotal}`, { phase: 'materials', doneItems: index + 1, totalItems: materialTotal });
    if ((index & 3) === 3) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const group = new THREE.Group(); group.name = 'VerdantTrailEnvironment'; group.add(scene);
  group.userData.verdantManifest = manifest; group.userData.packManifest = packManifest;
  await new Promise((resolve) => setTimeout(resolve, 0));
  onProgress?.(0, '光栅化：下载地形数据 0 MB', { phase: 'rasterize', doneItems: 0, totalItems: 1 });
  let precomputed = null;
  const canUsePrecomputed = ['low', 'medium', 'high'].includes(activeTier);
  const fieldPath = `${root}tiers/${activeTier}/walkable-field.bin`;
  if (canUsePrecomputed) {
    const fieldUrl = new URL(fieldPath, location.href).href;
    const expectedBounds = manifest.mapping.playableBounds;
    const expected = {
      nx: Math.max(8, Math.ceil((expectedBounds.maxX - expectedBounds.minX) / 0.22)),
      nz: Math.max(8, Math.ceil((expectedBounds.maxZ - expectedBounds.minZ) / 0.22)),
      cellSize: 0.22, layerCount: 4, bounds: expectedBounds,
    };
    const failures = [];
    for (const candidate of getAssetCandidates(fieldUrl, activeTier)) {
      try {
        const reporter = createProgressReporter({ onProgress: (stats) => {
          const mb = (stats.doneBytes / 1048576).toFixed(2), total = stats.totalBytes ? `/${(stats.totalBytes / 1048576).toFixed(2)} MB` : ' MB';
          onProgress?.(stats.totalBytes ? Math.min(0.9, stats.doneBytes / stats.totalBytes * 0.9) : 0, `光栅化：下载地形数据 ${mb}${total}`, { phase: 'rasterize', doneItems: stats.doneBytes, totalItems: stats.totalBytes || 1 });
        }});
        const result = await fetchWithFailover([candidate], {
          signal, stallMs: SOURCE_STALL_MS, idleMs: SOURCE_IDLE_MS, cache: 'no-cache',
          onOpen: ({ totalBytes }) => reporter.setTotal(totalBytes),
          onChunk: (bytes) => {
            reporter.addBytes(bytes); reporter.publish({ currentPath: fieldUrl });
            globalThis.__m3dByteHeartbeat?.({ url: fieldUrl, loaded: reporter.doneBytes, total: reporter.totalBytes, lengthComputable: true });
          },
        });
        const parsed = parseWalkableFieldBin(result.bytes, { expected });
        precomputed = parsed;
        console.info('[verdant] 预计算可行走地形:', { source: sourceLabelOf(candidate), url: candidate, bytes: result.bytes.byteLength, stats: parsed.stats });
        break;
      } catch (error) {
        failures.push(`${candidate}: ${error?.message || error}`);
      }
    }
    if (!precomputed) console.warn('[verdant] 预计算可行走地形候选全部不可用，回退设备端栅格化:', failures.join(' | '));
  } else {
    console.info('[verdant] ultra 档无离线可行走地形，使用设备端栅格化');
  }
  onProgress?.(0.92, precomputed ? '光栅化：重建可行走地形网格' : '光栅化可行走地形 0/1', { phase: 'rasterize', doneItems: precomputed ? 0.92 : 0, totalItems: 1 });
  // JSON 由渲染 ground 直接射线生成，是玩家支撑高度的权威数据源；其余派生网格仍在运行时构建。
  const field = buildWalkableField({ scene, heightJson: height, bounds: manifest.mapping.playableBounds, precomputed });
  console.info('[verdant] 可行走高度场:', field.stats);
  onProgress?.(1, precomputed ? '光栅化：地形数据就绪 1/1' : '光栅化可行走地形 1/1', { phase: 'rasterize', doneItems: 1, totalItems: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  onProgress?.(1, 'Verdant 场景就绪', { phase: 'ready' });
  return {
    group, manifest, packManifest, tier: activeTier, height,
    heightAt: field.heightAt, resolveGround: field.resolveGround,
    nearestWalkable: field.nearestWalkable, hasPlacementClearance: field.hasPlacementClearance, obstacleProxies: field.obstacleProxies,
    placementField: field, fieldStats: field.stats,
    bounds: manifest.mapping.playableBounds, cellSize: field.cellSize,
  };
}
