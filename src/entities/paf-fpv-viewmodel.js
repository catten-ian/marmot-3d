/**
 * PAF-only first-person fox forequarters.
 *
 * The ordinary marmot ViewModel establishes the useful layout: two forepaws
 * enter from the lower edge, claws point forward and a little chest is visible
 * when looking down. This module keeps that camera-relative language but uses
 * a fox's longer wrists, narrow paws, rusty guard fur and curved dark claws.
 * Geometry is procedural and no ordinary-mode model is imported or changed.
 */
import * as THREE from 'three';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export const PAF_FPV_POSES = {
  idle:    { crouch: 0.00, reach: 0.00, lift: 0.00, spread: 0.00, attack: 0.00 },
  walk:    { crouch: 0.18, reach: 0.07, lift: 0.00, spread: 0.01, attack: 0.00 },
  wind:    { crouch: 1.00, reach: -0.07, lift: -0.035, spread: 0.025, attack: 0.18 },
  lunge:   { crouch: 0.30, reach: 0.25, lift: 0.065, spread: -0.02, attack: 1.00 },
  recover: { crouch: 0.65, reach: -0.02, lift: -0.018, spread: 0.015, attack: 0.28 },
};

/** Pure pose target; finite for malformed state and distinct across actions. */
export function computePafFpvPose(state = {}) {
  const phase = PAF_FPV_POSES[state.phase] ? state.phase : 'idle';
  const speed = Number.isFinite(state.speed) ? Math.max(0, state.speed) : 0;
  const moving = phase === 'idle' && speed > 0.04;
  const key = phase === 'idle' && moving ? 'walk' : phase;
  const target = { ...PAF_FPV_POSES[key] };
  target.phase = key;
  target.speed = speed;
  target.gait = moving || phase === 'walk' ? clamp(0.35 + speed * 0.10, 0.35, 1) : 0;
  target.gaitFrequency = clamp(1.7 + speed * 0.24, 1.7, 3.4);
  return target;
}

function material(color, roughness = 0.9) {
  // The PAF camera can sit close to terrain. Like a conventional FPS
  // viewmodel, these meshes do not intersect the world's depth buffer.
  return new THREE.MeshStandardMaterial({
    color, roughness, depthTest: false, depthWrite: false,
  });
}

function mesh(parent, name, geometry, mat, position, scale) {
  const m = new THREE.Mesh(geometry, mat);
  m.name = name;
  m.position.set(...position);
  if (scale) m.scale.set(...scale);
  m.renderOrder = 10000;
  m.frustumCulled = false;
  parent.add(m);
  return m;
}

function makePaw(side, mats) {
  const paw = new THREE.Group();
  paw.name = side < 0 ? 'fpv-paw-left' : 'fpv-paw-right';

  // A fox wrist is noticeably longer and narrower than a marmot's forearm.
  const forearm = mesh(paw, 'forearm', new THREE.CapsuleGeometry(0.043, 0.22, 5, 10), mats.rust,
    [0, -0.09, 0.16], [0.90, 1, 1]);
  forearm.rotation.x = -Math.PI / 2 + 0.18;
  const sock = mesh(paw, 'cream-wrist', new THREE.CapsuleGeometry(0.038, 0.105, 4, 10), mats.cream,
    [0, -0.025, 0.025], [0.95, 1, 1]);
  sock.rotation.x = -Math.PI / 2 + 0.12;
  mesh(paw, 'palm', new THREE.SphereGeometry(1, 18, 12), mats.paw,
    [0, 0, -0.035], [0.057, 0.027, 0.086]);

  // Four long toes, with the middle pair leading; claws curve down at the tip.
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.025;
    const lead = i === 1 || i === 2 ? 1.08 : 0.93;
    const toe = mesh(paw, `toe-${i}`, new THREE.CapsuleGeometry(0.012, 0.055 * lead, 3, 8), mats.paw,
      [x, -0.002, -0.105 - (lead - 0.93) * 0.025]);
    toe.rotation.x = -Math.PI / 2;
    const claw = mesh(paw, `claw-${i}`, new THREE.ConeGeometry(0.009, 0.049 * lead, 7), mats.claw,
      [x, -0.007, -0.153 - (lead - 0.93) * 0.038]);
    claw.rotation.x = -Math.PI / 2 + 0.24;
    claw.scale.set(0.85, 1, 1);
  }
  // Fur seams break up the smooth forearm without textured assets.
  for (const x of [-0.015, 0.015]) {
    const tuft = mesh(paw, 'guard-fur', new THREE.ConeGeometry(0.012, 0.045, 5), mats.guard,
      [x, 0.012, 0.09], [0.55, 1, 0.5]);
    tuft.rotation.x = -Math.PI / 2;
  }
  return paw;
}

export function createPafFpvViewModel() {
  const root = new THREE.Group();
  root.name = 'pafFpvFoxViewModel';
  root.visible = false;

  const mats = {
    rust: material('#9b633c'),
    guard: material('#b99a70', 0.96),
    cream: material('#e5dcc5', 0.96),
    paw: material('#cbbfa7', 0.94),
    claw: material('#332b27', 0.48),
    chest: material('#b19a78', 0.96),
    throat: material('#e8dfc9', 0.96),
  };
  const paws = new THREE.Group();
  paws.name = 'fpv-forepaws';
  const left = makePaw(-1, mats), right = makePaw(1, mats);
  paws.add(left, right);
  root.add(paws);

  const body = new THREE.Group();
  body.name = 'fpv-forequarters';
  mesh(body, 'chest', new THREE.SphereGeometry(1, 22, 14), mats.chest,
    [0, -0.435, -0.39], [0.21, 0.10, 0.22]);
  mesh(body, 'throat', new THREE.SphereGeometry(1, 18, 12), mats.throat,
    [0, -0.385, -0.405], [0.11, 0.045, 0.13]);
  for (const side of [-1, 1]) {
    mesh(body, `shoulder-${side}`, new THREE.SphereGeometry(1, 16, 12), mats.rust,
      [side * 0.15, -0.38, -0.34], [0.075, 0.075, 0.12]);
  }
  root.add(body);

  let phase = 0;
  let lookPitch = 0;
  let current = { ...PAF_FPV_POSES.idle };
  let animState = {};

  function update(dt, state = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    animState = state;
    const target = computePafFpvPose(state);
    for (const key of ['crouch', 'reach', 'lift', 'spread', 'attack']) {
      current[key] = damp(current[key], target[key], target.phase === 'lunge' ? 20 : 11, dt);
    }
    phase += dt * target.gaitFrequency * Math.PI * 2;
    const requestedPitch = Number.isFinite(state.pitch) ? clamp(state.pitch, -1.05, 0.75) : 0;
    lookPitch = damp(lookPitch, requestedPitch, 12, dt);

    const stride = Math.sin(phase) * target.gait;
    const breathe = Math.sin(phase * 0.32) * 0.003 * (1 - target.gait);
    const bob = Math.abs(Math.sin(phase)) * 0.009 * target.gait;
    // Local -Z is forward. All movement stays below the reticle (screen centre).
    paws.position.set(0, -0.275 + current.lift + breathe - bob, -0.69 - current.reach);
    paws.rotation.x = -0.05 - current.attack * 0.18 + current.crouch * 0.07;
    for (let i = 0; i < 2; i++) {
      const paw = i === 0 ? left : right;
      const side = i === 0 ? -1 : 1;
      const step = stride * side;
      paw.position.set(side * (0.165 + current.spread), Math.max(0, -step) * 0.025 * target.gait, step * 0.075 * target.gait);
      paw.rotation.set(-step * 0.14 * target.gait - current.attack * 0.12, side * current.attack * 0.08, -side * 0.055);
    }
    body.position.y = -current.crouch * 0.035 + bob * 0.35;
    body.rotation.x = current.attack * -0.12;
    // A restrained pitch response exposes more chest when looking down without
    // letting the forepaws drift into the centre of the screen when looking up.
    body.position.z = clamp(-lookPitch, 0, 1) * 0.025;
    root.rotation.z = stride * 0.006;
  }

  function setVisible(visible) { root.visible = !!visible; }
  function getDebugState() {
    return {
      visible: root.visible,
      paws: [left, right].map((p) => ({ x: p.position.x, y: p.position.y, z: p.position.z })),
      rootY: paws.position.y,
      rootZ: paws.position.z,
      pose: computePafFpvPose(animState).phase,
    };
  }
  return { root, paws, body, left, right, update, setVisible, getDebugState };
}
