import * as THREE from 'three';
import { loadModel, resetModelLoadCache } from './loader.js';
import { loadSceneModel, resetSceneModelCache } from './scene.js';

export const BETA_RESOURCE_MANIFEST = Object.freeze([
  { id: 'player-marmot', url: './assets/models/marmot-run-stand.glb', kind: 'model', consumers: ['player', 'companion'], requiredClips: ['Run', 'StandIdle', 'StandUp'] },
  { id: 'fox', url: './assets/models/fox.glb', kind: 'model' },
  { id: 'terrain-backdrop', url: './assets/models/terrain-lod.glb', kind: 'scene' },
  { id: 'citrus-sky', url: 'assets/sky/citrus_orchard_road_puresky_1k.jpg', kind: 'texture' },
]);

function validateModel(record, spec) {
  if (!record || record.level !== 'full' || !record.textured) throw new Error(`${spec.id}: 模型或贴图未完整就绪`);
  if (spec.requiredClips?.some((name) => !record.animations?.some((clip) => clip.name === name && clip.duration > 0 && clip.tracks?.length))) {
    throw new Error(`${spec.id}: 缺少必需动画`);
  }
}

export function createBetaResourceSpecs() {
  return BETA_RESOURCE_MANIFEST.map((spec) => ({
    ...spec,
    load: () => spec.kind === 'scene' ? loadSceneModel(spec.url) : spec.kind === 'texture' ? loadBetaSkyTexture() : loadModel(spec.url, spec.id === 'fox' ? 'fox' : 'marmot'),
    reset: () => { if (spec.kind === 'scene') resetSceneModelCache(spec.url); else if (spec.kind === 'model') resetModelLoadCache(spec.url); },
    validate: (value) => spec.kind === 'scene'
      ? (!value ? Promise.reject(new Error(`${spec.id}: 场景模型为空`)) : undefined)
      : spec.kind === 'texture'
        ? (!(value?.image?.width > 1 && value?.image?.height > 1) ? Promise.reject(new Error(`${spec.id}: 贴图未解码`)) : undefined)
        : validateModel(value, spec),
  }));
}

export function loadBetaSkyTexture() {
  const url = 'assets/sky/citrus_orchard_road_puresky_1k.jpg';
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}
