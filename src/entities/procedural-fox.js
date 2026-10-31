import * as THREE from 'three';

export function createProceduralFox(options = {}) {
  const group = new THREE.Group();
  group.name = 'proceduralFoxRoot';
  const materials = {
    fur: new THREE.MeshLambertMaterial({ color: options.color ?? 0xc4763a }),
    light: new THREE.MeshLambertMaterial({ color: 0xf0dfc5 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x633d2a }),
  };
  const geometry = {
    body: new THREE.SphereGeometry(0.43, 10, 8),
    head: new THREE.SphereGeometry(0.23, 10, 8),
    muzzle: new THREE.ConeGeometry(0.105, 0.34, 8),
    ear: new THREE.ConeGeometry(0.095, 0.29, 7),
    leg: new THREE.CylinderGeometry(0.055, 0.075, 0.43, 7),
    tail: new THREE.ConeGeometry(0.22, 0.76, 9),
    tip: new THREE.SphereGeometry(0.19, 8, 7),
  };
  const mesh = (g, m, parent, pos, scale) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(...pos);
    if (scale) o.scale.set(...scale);
    parent.add(o);
    return o;
  };
  const body = new THREE.Group();
  group.add(body);
  mesh(geometry.body, materials.fur, body, [0, 0.67, 0], [0.58, 0.32, 0.92]);
  mesh(geometry.body, materials.light, body, [0, 0.48, 0.02], [0.4, 0.14, 0.67]);
  const head = new THREE.Group();
  head.position.set(0, 0.82, 0.72);
  body.add(head);
  mesh(geometry.head, materials.fur, head, [0, 0, 0.08], [0.38, 0.34, 0.4]);
  const muzzle = mesh(geometry.muzzle, materials.light, head, [0, -0.07, 0.42]);
  muzzle.rotation.x = Math.PI / 2;
  for (const x of [-0.22, 0.22]) {
    const ear = mesh(geometry.ear, materials.fur, head, [x, 0.3, -0.01]);
    ear.rotation.z = -x * 1.1;
  }
  const legs = [];
  for (const x of [-0.29, 0.29]) for (const z of [-0.55, 0.58]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.57, z);
    body.add(pivot);
    mesh(geometry.leg, materials.dark, pivot, [0, -0.2, 0]);
    legs.push(pivot);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.72, -0.72);
  body.add(tail);
  const plume = mesh(geometry.tail, materials.fur, tail, [0, 0.02, -0.36]);
  plume.rotation.x = -Math.PI / 2;
  mesh(geometry.tip, materials.light, tail, [0, 0.03, -0.69], [0.8, 0.8, 1.25]);
  let anim = 'idle', speed = 1, phase = 0;
  const setColor = (hex) => {
    materials.fur.color.set(hex);
    const base = new THREE.Color(hex);
    materials.dark.color.copy(base).multiplyScalar(0.52);
    materials.light.color.setHSL(0.09, 0.3, Math.min(0.9, base.getHSL({}).l + 0.42));
  };
  const setAnimState = (state = {}) => {
    anim = state.anim || 'idle'; speed = state.speed ?? 1; phase = state.phase ?? phase;
  };
  const update = (dt) => {
    phase += dt * Math.max(0.1, speed) * (anim === 'dash' ? 12 : 6);
    const amp = anim === 'idle' ? 0.025 : anim === 'dash' ? 0.85 : 0.58;
    legs.forEach((leg, i) => { leg.rotation.x = Math.sin(phase + ((i === 0 || i === 3) ? 0 : Math.PI)) * amp; });
    body.position.y = anim === 'idle' ? Math.sin(phase * 0.4) * 0.012 : Math.abs(Math.sin(phase * 2)) * 0.035;
    body.rotation.x = anim === 'dash' ? -0.18 : 0;
    tail.rotation.x = anim === 'dash' ? -0.45 : 0;
    tail.rotation.y = Math.sin(phase * 0.55) * (anim === 'idle' ? 0.12 : 0.22);
  };
  setColor(options.color ?? 0xc4763a);
  return { group, root: group, body, head, muzzle, ears: head.children.filter((o) => o.geometry === geometry.ear), legs, tail, setColor, setAnimState, update };
}
