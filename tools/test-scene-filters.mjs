import * as THREE from '../vendor/three.module.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCENE_FILTER_PRESETS, SCENE_FILTER_STORAGE_KEY, DEFAULT_SCENE_FILTER,
  SceneFilterSettings, normalizeSceneFilter, readSceneFilterSettings, getSceneFilterPreset,
} from '../src/core/scene-filter-settings.mjs';
import { SceneFilterRenderer } from '../src/core/scene-filter-renderer.mjs';

function memoryStorage(raw) {
  const map = new Map(raw === undefined ? [] : [[SCENE_FILTER_STORAGE_KEY, raw]]);
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map };
}

test('six distinct purposeful presets, none is default', () => {
  assert.ok(SCENE_FILTER_PRESETS.length >= 6);
  assert.equal(new Set(SCENE_FILTER_PRESETS.map((p) => p.id)).size, SCENE_FILTER_PRESETS.length);
  assert.equal(getSceneFilterPreset('missing').id, 'none');
  assert.deepEqual(DEFAULT_SCENE_FILTER, { preset: 'none', intensity: 0 });
  for (const p of SCENE_FILTER_PRESETS.slice(1)) {
    assert.ok(p.name && p.description);
    assert.ok(p.saturation !== 1 || p.contrast !== 1 || p.brightness !== 1 || p.shadowLift !== 0 || p.highlightSoftness !== 0 || p.filmic !== 0 || p.tint.some((v) => v !== 1));
  }
});

test('validation rejects old/malformed data and clamps finite boundaries', () => {
  for (const bad of [null, [], 'warm', { preset: 'old', intensity: 50 }, { preset: 'warm', intensity: NaN }, { preset: 'warm' }]) {
    assert.deepEqual(normalizeSceneFilter(bad), DEFAULT_SCENE_FILTER);
  }
  assert.deepEqual(normalizeSceneFilter({ preset: 'warm', intensity: 200 }), { preset: 'warm', intensity: 100 });
  assert.deepEqual(normalizeSceneFilter({ preset: 'warm', intensity: -1 }), DEFAULT_SCENE_FILTER);
  assert.deepEqual(normalizeSceneFilter({ preset: 'cool', intensity: 49.6 }), { preset: 'cool', intensity: 50 });
  assert.deepEqual(readSceneFilterSettings(memoryStorage('{bad json')), DEFAULT_SCENE_FILTER);
  assert.deepEqual(readSceneFilterSettings({ getItem() { throw Error('denied'); } }), DEFAULT_SCENE_FILTER);
});

test('runtime snapshot, persisted value and subscribers stay synchronized', () => {
  const storage = memoryStorage();
  const settings = new SceneFilterSettings({ storage });
  const states = []; settings.onChange((s) => states.push(s));
  settings.setPreset('natural');
  assert.deepEqual(settings.snapshot(), { preset: 'natural', intensity: 75 });
  settings.setIntensity(32);
  assert.equal(JSON.parse(storage.map.get(SCENE_FILTER_STORAGE_KEY)).intensity, 32);
  assert.deepEqual(states.at(-1), settings.snapshot());
  settings.setIntensity(0);
  assert.equal(settings.active, false);
  assert.deepEqual(settings.snapshot(), DEFAULT_SCENE_FILTER);
  settings.setPreset('legacy-blackwhite');
  assert.deepEqual(settings.snapshot(), DEFAULT_SCENE_FILTER, 'removed legacy storage falls back safely');
  settings.reset();
  assert.deepEqual(settings.snapshot(), DEFAULT_SCENE_FILTER);
  const denied = new SceneFilterSettings({ storage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  assert.doesNotThrow(() => denied.setPreset('warm'));
});

function mockRenderer() {
  const renderer = {
    capabilities: { isWebGL2: true }, toneMapping: 4, size: { x: 320, y: 200 }, renderCalls: [],
    getDrawingBufferSize(v) { return v.copy(this.size); },
    setRenderTarget(target) { this.target = target; },
    render(scene) { this.renderCalls.push({ scene, target: this.target ?? null, toneMapping: this.toneMapping }); },
  };
  return renderer;
}

test('zero/default is exact direct-render bypass and allocates no target', () => {
  const settings = new SceneFilterSettings({ storage: memoryStorage() });
  const renderer = mockRenderer();
  const filter = new SceneFilterRenderer(renderer, settings, { THREE });
  const scene = {}, camera = {};
  for (let i = 0; i < 3; i++) assert.equal(filter.render(scene, camera), false);
  assert.equal(renderer.renderCalls.length, 3);
  assert.ok(renderer.renderCalls.every((c) => c.scene === scene && c.target === null && c.toneMapping === 4));
  assert.equal(filter.debugState().allocated, false);
  assert.equal(filter.debugState().createdTargets, 0);
  filter.dispose();
});

test('active path uses one scene pass + one screen pass and releases on bypass', () => {
  const settings = new SceneFilterSettings({ storage: memoryStorage() });
  const renderer = mockRenderer(); const filter = new SceneFilterRenderer(renderer, settings, { THREE });
  const scene = {}, camera = {};
  settings.setPreset('warm');
  for (let i = 0; i < 4; i++) assert.equal(filter.render(scene, camera), true);
  assert.equal(filter.debugState().passes, 4);
  assert.equal(filter.debugState().createdTargets, 1);
  assert.equal(renderer.renderCalls.length, 8);
  assert.equal(renderer.renderCalls[0].toneMapping, 0, 'HDR scene pass is not tone mapped');
  assert.equal(renderer.renderCalls[1].toneMapping, 4, 'screen pass restores original ACES');
  renderer.size = { x: 768, y: 1024 }; filter.resize();
  assert.deepEqual(filter.debugState().targetSize, [768, 1024]);
  settings.setIntensity(0);
  assert.equal(filter.debugState().allocated, false);
  assert.equal(filter.debugState().disposedTargets, 1);
  filter.render(scene, camera);
  assert.equal(renderer.renderCalls.length, 9);
  settings.setPreset('cool'); filter.render(scene, camera);
  assert.equal(filter.debugState().createdTargets, 2);
  filter.dispose();
  assert.equal(filter.debugState().disposedTargets, 2);
});

test('initialization failure restores target/tone mapping and falls back safely', () => {
  const settings = new SceneFilterSettings({ storage: memoryStorage(JSON.stringify({ preset: 'warm', intensity: 80 })) });
  const renderer = mockRenderer();
  renderer.render = function (scene) { if (scene !== this.scene) throw Error('shader init failed'); this.renderCalls.push({ scene, target: null, toneMapping: this.toneMapping }); };
  // The second direct fallback uses the same scene, so fail only the first call.
  let first = true;
  renderer.render = function (scene) { if (first) { first = false; throw Error('shader init failed'); } this.renderCalls.push({ scene, target: null, toneMapping: this.toneMapping }); };
  const filter = new SceneFilterRenderer(renderer, settings, { THREE });
  assert.equal(filter.render({}, {}), false);
  assert.deepEqual(settings.snapshot(), DEFAULT_SCENE_FILTER);
  assert.equal(renderer.toneMapping, 4);
  assert.equal(renderer.target, null);
  assert.equal(filter.debugState().failures, 1);
  assert.equal(filter.debugState().allocated, false);
  filter.dispose();
});
