const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function loadModule() {
  const src = readFileSync(path.join(__dirname, '../src/entities/marmot-rig.js'), 'utf8')
    .replace(/export const/g, 'const').replace(/export function/g, 'function');
  const body = `${src}\nmodule.exports={MARMOT_CLIPS,SPRINT_THRESHOLD,marmotClipForState,animationTransition,marmotFallbackDecision};`;
  const mod = { exports: {} }; new Function('module', 'exports', body)(mod, mod.exports); return mod.exports;
}
const rig = loadModule();

test('marmot clip mapping covers all gameplay states and sprint boundary', () => {
  assert.equal(rig.marmotClipForState('idle'), 'Idle');
  assert.equal(rig.marmotClipForState('follow', 0.05), 'Run');
  assert.equal(rig.marmotClipForState('follow', rig.SPRINT_THRESHOLD), 'Sprint');
  assert.equal(rig.marmotClipForState({ mode: 'rest' }), 'Rest');
  assert.equal(rig.marmotClipForState({ mode: 'eat' }), 'Bite');
  assert.equal(rig.marmotClipForState({ mode: 'groom' }), 'Groom');
  assert.equal(rig.marmotClipForState({ mode: 'jump' }), 'Jump');
  assert.equal(rig.marmotClipForState({ mode: 'alert' }), 'Stand');
});

test('animation transition fades only when clip changes', () => {
  assert.deepEqual(rig.animationTransition('Idle', 'Idle'), { changed: false, from: 'Idle', to: 'Idle', fade: 0 });
  const t = rig.animationTransition('Idle', 'Run', 0.2);
  assert.equal(t.changed, true); assert.equal(t.from, 'Idle'); assert.equal(t.to, 'Run'); assert.equal(t.fade, 0.2);
});

test('fallback chooses rig, then static, then procedural', () => {
  assert.equal(rig.marmotFallbackDecision({ rigAvailable: true, clipsAvailable: true }), 'rig');
  assert.equal(rig.marmotFallbackDecision({ rigAvailable: true, clipsAvailable: false }), 'static');
  assert.equal(rig.marmotFallbackDecision({ rigAvailable: false, clipsAvailable: false, staticAvailable: false }), 'procedural');
});

test('loader and beta companion contracts are wired', () => {
  const loader = readFileSync(path.join(__dirname, '../src/models/loader.js'), 'utf8');
  const props = readFileSync(path.join(__dirname, '../src/entities/props_entities.js'), 'utf8');
  assert.match(loader, /SkeletonUtils\.js/);
  assert.match(loader, /gltf\.animations/);
  assert.match(props, /marmot-rig\.glb/);
  assert.match(props, /IS_BETA/);
  assert.match(props, /AnimationMixer/);
  assert.match(props, /metalness = 0\.08/);
});
