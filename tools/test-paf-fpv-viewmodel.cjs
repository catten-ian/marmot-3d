/** Focused PAF fox FPV forepaw/model placement and pose tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let THREE, fpv;
test.before(async () => {
  THREE = await import('../vendor/three.module.js');
  globalThis.__THREE = THREE;
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/entities/paf-fpv-viewmodel.js'), 'utf8')
    .replace("import * as THREE from 'three';", 'const THREE = globalThis.__THREE;');
  fpv = await import(`data:text/javascript,${encodeURIComponent(src)}`);
});

function finiteTransforms(root) {
  root.traverse((o) => {
    for (const v of [...o.position.toArray(), ...o.scale.toArray(), ...o.quaternion.toArray()]) {
      assert.ok(Number.isFinite(v), `${o.name || o.type} has a non-finite transform`);
    }
  });
}

test('FPV API and fox-specific forepaw/claw geometry are complete', () => {
  const vm = fpv.createPafFpvViewModel();
  for (const key of ['root', 'paws', 'body', 'left', 'right', 'update', 'setVisible']) assert.ok(vm[key], key);
  assert.equal(vm.root.name, 'pafFpvFoxViewModel');
  assert.equal(vm.left.children.filter((o) => o.name.startsWith('claw-')).length, 4);
  assert.equal(vm.right.children.filter((o) => o.name.startsWith('toe-')).length, 4);
  assert.ok(vm.left.getObjectByName('cream-wrist'));
  assert.equal(vm.root.visible, false);
  vm.setVisible(true);
  assert.equal(vm.root.visible, true);
});

test('desktop and narrow projection keep both palms below the reticle', () => {
  for (const aspect of [1280 / 720, 420 / 800]) {
    const camera = new THREE.PerspectiveCamera(78, aspect, 0.05, 100);
    camera.updateMatrixWorld(true);
    const vm = fpv.createPafFpvViewModel();
    vm.setVisible(true);
    vm.update(1 / 60, { phase: 'idle', speed: 0, pitch: -0.1 });
    vm.root.updateMatrixWorld(true);
    const projected = [vm.left, vm.right].map((paw) => {
      const p = paw.getObjectByName('palm').getWorldPosition(new THREE.Vector3()).project(camera);
      return { x: p.x, y: p.y, z: p.z };
    });
    for (const p of projected) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
      assert.ok(p.y < -0.25 && p.y > -1, `palm crosses reticle or leaves screen: ${JSON.stringify(p)} @ ${aspect}`);
      assert.ok(Math.abs(p.x) < 0.95, `palm clipped horizontally: ${JSON.stringify(p)} @ ${aspect}`);
    }
    assert.ok(projected[0].x < 0 && projected[1].x > 0);
  }
});

test('idle/walk/wind/lunge/recover poses are distinct and finite', () => {
  const states = [
    { phase: 'idle', speed: 0 }, { phase: 'idle', speed: 5 },
    { phase: 'wind', speed: 0 }, { phase: 'lunge', speed: 13.5 }, { phase: 'recover', speed: 0 },
  ];
  const poses = states.map(fpv.computePafFpvPose);
  assert.equal(new Set(poses.map((p) => p.phase)).size, 5);
  for (const p of poses) for (const [key, value] of Object.entries(p)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), key);
  }
  const vm = fpv.createPafFpvViewModel();
  for (const state of states) {
    for (let i = 0; i < 45; i++) vm.update(1 / 60, { ...state, pitch: -0.4 });
    finiteTransforms(vm.root);
  }
  assert.notDeepEqual(vm.getDebugState().paws, fpv.createPafFpvViewModel().getDebugState().paws);
});

test('malformed state cannot introduce NaN or a visible TPS viewmodel', () => {
  const vm = fpv.createPafFpvViewModel();
  vm.update(Number.NaN, { phase: 'bad', speed: Number.NaN, pitch: Number.POSITIVE_INFINITY });
  finiteTransforms(vm.root);
  assert.equal(vm.root.visible, false);
  assert.equal(fpv.computePafFpvPose({ speed: Number.NaN }).speed, 0);
});
