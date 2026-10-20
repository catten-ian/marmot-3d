import * as THREE from 'three';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const palette = {
  warm: new THREE.Color('#a9957d'),
  rust: new THREE.Color('#a8643b'),
  flank: new THREE.Color('#b9a080'),
  pale: new THREE.Color('#e8ddcf'),
  cream: new THREE.Color('#f0e7da'),
  gray: new THREE.Color('#777773'),
  guard: new THREE.Color('#a99b87'),
};
const mat = (color, roughness = 0.86, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const mats = {
  fur: mat('#ffffff', 0.94, { vertexColors: true }),
  creamFur: mat('#e9dfd2', 0.94),
  tawnyFur: mat('#b58c61', 0.96),
  cheek: mat('#ead9c5', 0.93),
  ear: mat('#a86236', 0.93),
  earInner: mat('#d3b99f', 0.95),
  eyeMask: mat('#66574c', 0.96),
  nose: mat('#231d19', 0.48),
  eye: mat('#211912', 0.14),
  glint: new THREE.MeshBasicMaterial({ color: '#fff8e8' }),
  mouth: mat('#2d1116', 0.78),
  tongue: mat('#c96d7b', 0.56),
  tooth: mat('#f4eddf', 0.32),
  claw: mat('#41362e', 0.58),
  tuft: mat('#9b805e', 0.97),
};

function hash3(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function furColor(x, y, z) {
  // Object-space color field: warm flanks, a grizzled dorsal saddle, pale underside,
  // and a restrained rufous nape. The exact strand pattern is intentionally stylized.
  let c = palette.warm.clone();
  if (y < -0.34) c.lerp(palette.pale, clamp((-y - 0.25) * 1.45));
  else if (y < 0.30) c.lerp(palette.flank, 0.30);
  if (y > 0.05) c.lerp(palette.gray, clamp((y - 0.04) * 1.85));
  const fleck = hash3(Math.round(x * 48), Math.round(y * 42), Math.round(z * 44));
  c.lerp(fleck > 0.55 ? palette.guard : palette.warm, Math.abs(fleck - 0.5) * (y > 0.1 ? 0.30 : 0.08));
  if (z > 0.53 && y > -0.18 && y < 0.58) c.lerp(palette.rust, clamp((z - 0.48) * 1.2) * 0.68);
  return c;
}
function organicGeometry(radius = 1, variation = 0.012) {
  const g = new THREE.SphereGeometry(radius, 48, 32);
  const p = g.getAttribute('position');
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const noise = Math.sin(x * 21 + z * 17) * Math.cos(y * 23 - z * 13);
    const d = radius * (1 + variation * noise);
    p.setXYZ(i, x * d, y * d, z * d);
    const c = furColor(x, y, z);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}
function addFurMass(group, name, position, scale, variation = 0.012) {
  const mesh = new THREE.Mesh(organicGeometry(1, variation), mats.fur);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function addEllipsoid(group, name, position, scale, material, segments = 32) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.max(16, Math.floor(segments * 0.65))), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function addSegment(group, name, a, b, radius, material) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const geometry = new THREE.CylinderGeometry(radius * 0.88, radius, d.length(), 12, 1, false);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.copy(A).add(B).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  addEllipsoid(group, `${name}-joint-a`, a, [radius, radius, radius], material, 16);
  addEllipsoid(group, `${name}-joint-b`, b, [radius * 0.88, radius * 0.88, radius * 0.88], material, 16);
  return mesh;
}
function taperedEarGeometry() {
  const rings = [
    { y: 0.00, x: 0.30, z: 0.115 },
    { y: 0.20, x: 0.34, z: 0.110 },
    { y: 0.42, x: 0.29, z: 0.095 },
    { y: 0.65, x: 0.18, z: 0.068 },
    { y: 0.82, x: 0.065, z: 0.032 },
  ];
  const radial = 12, positions = [], indices = [];
  for (const ring of rings) {
    for (let j = 0; j < radial; j++) {
      const theta = j / radial * Math.PI * 2;
      positions.push(Math.sin(theta) * ring.x, ring.y, Math.cos(theta) * ring.z);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const lower = i * radial, upper = (i + 1) * radial;
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = lower + j, b = lower + j2, c = upper + j2, d = upper + j;
      // Ring order plus upward progression gives outward-facing side normals.
      indices.push(a, b, d, b, c, d);
    }
  }
  const baseCenter = positions.length / 3;
  positions.push(0, 0, 0);
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial;
    indices.push(baseCenter, j2, j);
  }
  const apex = positions.length / 3;
  positions.push(0, 0.91, 0);
  const last = (rings.length - 1) * radial;
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial;
    indices.push(last + j, last + j2, apex);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addTriangleEar(group, side) {
  const ear = new THREE.Group();
  ear.name = `ear-${side > 0 ? 'left' : 'right'}`;
  ear.position.set(side * 0.46, 2.44, 1.03);
  ear.rotation.z = -side * 0.10;
  ear.rotation.x = -0.07;
  ear.scale.set(0.92, 0.84, 0.92);
  const shell = new THREE.Mesh(taperedEarGeometry(), mats.ear);
  shell.name = `${ear.name}-shell`;
  shell.castShadow = true; shell.receiveShadow = true;
  ear.add(shell);
  const insetShape = new THREE.Shape();
  insetShape.moveTo(-0.20, 0.12);
  insetShape.quadraticCurveTo(-0.20, 0.34, -0.01, 0.61);
  insetShape.quadraticCurveTo(0.04, 0.65, 0.08, 0.59);
  insetShape.quadraticCurveTo(0.21, 0.36, 0.20, 0.12);
  insetShape.quadraticCurveTo(0, 0.05, -0.20, 0.12);
  const innerGeo = new THREE.ShapeGeometry(insetShape, 12);
  innerGeo.translate(0, 0, 0.084);
  const inner = new THREE.Mesh(innerGeo, mats.earInner);
  inner.name = `ear-concha-${side > 0 ? 'left' : 'right'}`;
  ear.add(inner);
  group.add(ear);
}
function addTail(group) {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.10, 1.15, -0.96),
    new THREE.Vector3(0.15, 0.91, -1.35),
    new THREE.Vector3(0.18, 0.61, -1.82),
    new THREE.Vector3(0.18, 0.43, -2.28),
    new THREE.Vector3(0.18, 0.47, -2.62),
  ]);
  const radial = 18, steps = 44;
  const positions = [], colors = [], indices = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    let normal = new THREE.Vector3(1, 0, 0);
    if (Math.abs(normal.dot(tangent)) > 0.92) normal.set(0, 1, 0);
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const terminalTaper = t > 0.92 ? Math.max(0, (1 - t) / 0.08) : 1;
    const radius = (0.15 + 0.36 * Math.sin(Math.PI * Math.pow(t, 0.82))) * (1 - 0.20 * t) * terminalTaper;
    const tip = new THREE.Color('#302923'), body = furColor(0, 0.6 - t * 0.3, -0.2);
    const darkWeight = clamp((t - 0.66) / 0.34);
    const col = body.lerp(tip, darkWeight);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const p = center.clone().addScaledVector(normal, Math.cos(a) * radius).addScaledVector(binormal, Math.sin(a) * radius * 0.92);
      const rough = 1 + 0.025 * Math.sin(a * 7 + t * 49);
      positions.push(p.x * rough, p.y * rough, p.z * rough);
      const c = col.clone().multiplyScalar(0.92 + 0.14 * hash3(i, j, 9));
      colors.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < steps; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices); geo.computeVertexNormals();
  const tail = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.96, side: THREE.DoubleSide }));
  tail.name = 'bushy-tail-with-dark-tip'; tail.castShadow = true; tail.receiveShadow = true; group.add(tail);
}
function addGuardHair(group, count = 190) {
  // Small deterministic tapered clumps on the dorsal torso; geometry remains lightweight.
  let seed = 107;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const base = new THREE.ConeGeometry(0.011, 0.095, 4, 1);
  const mesh = new THREE.InstancedMesh(base, mats.tuft, count);
  mesh.name = 'procedural-dorsal-guard-hair';
  const dummy = new THREE.Object3D();
  const center = new THREE.Vector3(0, 1.26, -0.02);
  const sx = 0.72, sy = 0.64, sz = 1.30;
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const y = 0.20 + rand() * 0.75;
    const r = Math.sqrt(1 - y * y);
    const x = r * Math.cos(theta), z = r * Math.sin(theta);
    const p = new THREE.Vector3(center.x + x * sx * 1.01, center.y + y * sy * 1.01, center.z + z * sz * 1.01);
    const normal = new THREE.Vector3(x / sx, y / sy, z / sz).normalize();
    const flow = new THREE.Vector3(0, 0.22, -0.88).addScaledVector(normal, 0.65).normalize();
    dummy.position.copy(p);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), flow);
    const s = 0.70 + rand() * 0.35;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    const color = rand() > 0.46 ? '#c3b8a7' : (rand() > 0.45 ? '#d0b68f' : '#b6a68f');
    mesh.setColorAt(i, new THREE.Color(color));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false; mesh.receiveShadow = false; group.add(mesh);
}


function attachActionReadyRuntime(root) {
  // Runtime contract is additive metadata and identity pivots; the pivots are at the origin so
  // grouping preserves the already-reviewed visual placement. Visual meshes remain procedural
  // Three.js objects, while nodes/sockets/colliders give later animation and picking code stable IDs.
  const byName = new Map();
  root.traverse((obj) => { if (obj.name) byName.set(obj.name, obj); });
  const find = (name) => byName.get(name) || null;
  const makePivot = (id, members = [], parent = root, worldPosition = [0, 0, 0]) => {
    root.updateMatrixWorld(true);
    const pivot = new THREE.Group();
    pivot.name = `${id}__pivot`;
    pivot.userData.sculptPartId = id;
    pivot.userData.pivotWorldPosition = [...worldPosition];
    pivot.position.fromArray(worldPosition);
    parent.add(pivot);
    parent.updateMatrixWorld(true);
    const inversePivotWorld = pivot.matrixWorld.clone().invert();
    for (const name of members) {
      const obj = typeof name === 'string' ? find(name) : name;
      if (!obj || obj === pivot || obj === root || obj.parent === pivot) continue;
      obj.updateWorldMatrix(true, false);
      const worldMatrix = obj.matrixWorld.clone();
      if (obj.parent) obj.parent.remove(obj);
      pivot.add(obj);
      const localMatrix = inversePivotWorld.clone().multiply(worldMatrix);
      localMatrix.decompose(obj.position, obj.quaternion, obj.scale);
      obj.updateMatrix();
    }
    pivot.updateMatrixWorld(true);
    return pivot;
  };
  const nodes = { root };
  const meshes = {};
  const sockets = {};
  const colliders = {};
  const destructionGroups = {};
  const socket = (id, pivot, position = [0, 0, 0]) => {
    const s = new THREE.Object3D();
    s.name = `${id}__socket`;
    s.position.set(...position);
    pivot.add(s);
    sockets[`${id}:socket`] = s;
    return s;
  };
  const register = (id, pivot, colliderType = 'capsule') => {
    nodes[id] = pivot;
    pivot.userData.sculptPartId = id;
    pivot.userData.actionProfile = {
      animationRole: id === 'root' ? 'root' : 'static-part',
      pivot: { mode: id === 'root' ? 'semantic-root' : 'component', localPosition: [0, 0, 0], axis: [0, 1, 0] },
      transformChannels: { translate: true, rotate: true, scale: true, visibility: true },
      collider: { type: colliderType, isTrigger: false },
    };
    colliders[id] = { type: colliderType, offset: [0, 0, 0], scale: [1, 1, 1], isTrigger: false };
    destructionGroups[id] = [pivot];
    socket(id, pivot);
    return pivot;
  };
  register('root', root, 'compound');

  // Semantic pivots preserve each moved component's world matrix and expose stable local origins.
  const earL = register('ear-l', makePivot('ear-l', ['ear-left'], root, [0.46, 2.44, 1.03]));
  const earR = register('ear-r', makePivot('ear-r', ['ear-right'], root, [-0.46, 2.44, 1.03]));
  register('ear-concha-l', find('ear-concha-left') || earL, 'none');
  register('ear-concha-r', find('ear-concha-right') || earR, 'none');

  const muzzleMembers = [
    'short-wide-cream-muzzle', 'cream-cheek--1', 'cream-cheek-1',
    'dark-periocular-mask--1', 'dark-periocular-mask-1', 'dark-eye--1', 'dark-eye-1',
    'eye-catchlight--1', 'eye-catchlight-1', 'black-rhinarium', 'dark-open-mouth',
    'lower-jaw', 'pink-tongue', 'small-canine--1', 'small-canine-1',
  ];
  const muzzlePivot = makePivot('muzzle', muzzleMembers, root, [0, 1.82, 1.58]);
  register('muzzle', muzzlePivot);
  register('nose', find('black-rhinarium') || muzzlePivot, 'sphere');
  register('open-mouth', find('dark-open-mouth') || muzzlePivot, 'sphere');
  register('jaw', find('lower-jaw') || muzzlePivot, 'capsule');
  register('tongue', find('pink-tongue') || muzzlePivot, 'capsule');
  register('eye-l', find('dark-eye-1') || muzzlePivot, 'sphere');
  register('eye-r', find('dark-eye--1') || muzzlePivot, 'sphere');
  register('eye-glint-l', find('eye-catchlight-1') || muzzlePivot, 'sphere');
  register('eye-glint-r', find('eye-catchlight--1') || muzzlePivot, 'sphere');
  register('canine-l', find('small-canine-1') || muzzlePivot, 'cone');
  register('canine-r', find('small-canine--1') || muzzlePivot, 'cone');
  const headPivot = register('head', makePivot('head', ['broad-square-head', earL, earR, muzzlePivot], root, [0, 2.03, 1.18]));

  const torsoMembers = ['long-deep-torso', 'warm-nape-and-shoulders', 'cream-throat-and-chest-bib', 'procedural-dorsal-guard-hair'];
  const torsoPivot = register('torso', makePivot('torso', torsoMembers, root, [0, 1.26, -0.02]));
  register('chest', find('cream-throat-and-chest-bib') || torsoPivot, 'capsule');
  const legGroup = (id, members) => register(id, makePivot(id, members), 'capsule');
  const foreL = register('foreleg-l', makePivot('foreleg-l', ['fore-upper-leg-1', 'fore-lower-leg-1', 'fore-lower-leg-1-joint-a', 'fore-lower-leg-1-joint-b'], root, [0.49, 0.86, 0.72]), 'capsule');
  const foreR = register('foreleg-r', makePivot('foreleg-r', ['fore-upper-leg--1', 'fore-lower-leg--1', 'fore-lower-leg--1-joint-a', 'fore-lower-leg--1-joint-b'], root, [-0.49, 0.86, 0.72]), 'capsule');
  const hindL = register('hindleg-l', makePivot('hindleg-l', ['hind-thigh-1', 'hind-shank-upper-1', 'hind-shank-upper-1-joint-a', 'hind-shank-upper-1-joint-b', 'hind-hock-1', 'hind-hock-1-joint-a', 'hind-hock-1-joint-b'], root, [0.49, 0.87, -0.79]), 'capsule');
  const hindR = register('hindleg-r', makePivot('hindleg-r', ['hind-thigh--1', 'hind-shank-upper--1', 'hind-shank-upper--1-joint-a', 'hind-shank-upper--1-joint-b', 'hind-hock--1', 'hind-hock--1-joint-a', 'hind-hock--1-joint-b'], root, [-0.49, 0.87, -0.79]), 'capsule');
  register('forepaw-l', find('forepaw-1') || foreL, 'sphere');
  register('forepaw-r', find('forepaw--1') || foreR, 'sphere');
  register('hindpaw-l', find('hindpaw-1') || hindL, 'sphere');
  register('hindpaw-r', find('hindpaw--1') || hindR, 'sphere');
  const tailPivot = register('tail', makePivot('tail', ['bushy-tail-with-dark-tip'], root, [0.10, 1.15, -0.96]), 'capsule');
  register('tail-tip', find('bushy-tail-with-dark-tip') || tailPivot, 'sphere');

  root.traverse((obj) => {
    if (obj.isMesh && obj.name) {
      obj.userData.explodeWithParent = true;
      obj.userData.sculptMeshName = obj.name;
      meshes[obj.name] = obj;
    }
  });
  root.userData.sculptRuntime = {
    version: '1.0',
    nodes, meshes, sockets, colliders, destructionGroups,
    coordinateSystem: root.userData.coordinateSystem,
    clickable: true,
    explodable: true,
    note: 'Identity pivots and runtime metadata are procedural; hidden anatomy and fur remain approximate.',
  };
  root.userData.actionReady = true;
  return root;
}

export function createTibetanFox() {
  const root = new THREE.Group();
  root.name = 'Tibetan fox — procedural quadruped';
  root.userData.coordinateSystem = { up: '+Y', forward: '+Z', animalLeft: '+X' };
  root.userData.approximation = 'Stylized code-only reconstruction; hidden underside, ear backs, paw pads and exact joint anatomy are approximate.';

  // Primary body masses, positioned so the paw soles meet y=0.
  addFurMass(root, 'long-deep-torso', [0, 1.26, -0.02], [0.73, 0.65, 1.32], 0.014);
  addFurMass(root, 'warm-nape-and-shoulders', [0, 1.43, 0.82], [0.70, 0.73, 0.61], 0.016);
  addEllipsoid(root, 'cream-throat-and-chest-bib', [0, 1.20, 0.95], [0.48, 0.60, 0.46], mats.creamFur);

  // Broad, almost square face; the blunt muzzle deliberately has little forward projection.
  addFurMass(root, 'broad-square-head', [0, 2.03, 1.18], [0.69, 0.55, 0.48], 0.008);
  addEllipsoid(root, 'short-wide-cream-muzzle', [0, 1.82, 1.59], [0.56, 0.29, 0.36], mats.cheek, 40);
  for (const side of [-1, 1]) {
    addEllipsoid(root, `cream-cheek-${side}`, [side * 0.37, 1.86, 1.48], [0.28, 0.23, 0.20], mats.cheek, 28);
    addEllipsoid(root, `dark-periocular-mask-${side}`, [side * 0.43, 2.08, 1.54], [0.17, 0.12, 0.085], mats.eyeMask, 24);
    const eye = addEllipsoid(root, `dark-eye-${side}`, [side * 0.43, 2.09, 1.58], [0.105, 0.083, 0.075], mats.eye, 28);
    eye.rotation.z = side * 0.10;
    addEllipsoid(root, `eye-catchlight-${side}`, [side * 0.43 - 0.025, 2.118, 1.647], [0.022, 0.020, 0.012], mats.glint, 16);
    addTriangleEar(root, side);
  }
  // Rounded triangular nose pad.
  const noseShape = new THREE.Shape();
  noseShape.moveTo(-0.16, 0.045); noseShape.quadraticCurveTo(-0.14, 0.13, 0, 0.105);
  noseShape.quadraticCurveTo(0.14, 0.13, 0.16, 0.045); noseShape.quadraticCurveTo(0.11, -0.07, 0, -0.10);
  noseShape.quadraticCurveTo(-0.11, -0.07, -0.16, 0.045);
  const noseGeo = new THREE.ExtrudeGeometry(noseShape, { depth: 0.10, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.025, bevelThickness: 0.025 });
  noseGeo.translate(0, 0, -0.05);
  const nose = new THREE.Mesh(noseGeo, mats.nose); nose.name = 'black-rhinarium'; nose.position.set(0, 1.91, 1.88); nose.castShadow = true; root.add(nose);

  // The open mouth is visible in the front reference; depth, teeth count and wetness are approximate.
  addEllipsoid(root, 'dark-open-mouth', [0, 1.56, 1.81], [0.42, 0.17, 0.055], mats.mouth, 32);
  addEllipsoid(root, 'lower-jaw', [0, 1.46, 1.70], [0.43, 0.15, 0.20], mats.creamFur, 32);
  addEllipsoid(root, 'pink-tongue', [0, 1.52, 1.87], [0.19, 0.075, 0.045], mats.tongue, 24);
  for (const side of [-1, 1]) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 8), mats.tooth);
    tooth.name = `small-canine-${side}`; tooth.position.set(side * 0.24, 1.64, 1.87); tooth.rotation.x = Math.PI; tooth.castShadow = true; root.add(tooth);
  }

  // Four short legs, with pale distal fur and compact paws. Hock bends are inferred from side view.
  for (const side of [-1, 1]) {
    const x = side * 0.49;
    addEllipsoid(root, `fore-upper-leg-${side}`, [x, 0.78, 0.72], [0.19, 0.42, 0.22], mats.tawnyFur, 28);
    addSegment(root, `fore-lower-leg-${side}`, [x, 0.55, 0.72], [x, 0.20, 0.74], 0.145, mats.creamFur);
    addEllipsoid(root, `forepaw-${side}`, [x, 0.12, 0.84], [0.23, 0.13, 0.34], mats.creamFur, 24);
    // Hind thigh, bent stifle and forward-set hock.
    addEllipsoid(root, `hind-thigh-${side}`, [x, 0.87, -0.79], [0.28, 0.39, 0.40], mats.tawnyFur, 28);
    addSegment(root, `hind-shank-upper-${side}`, [x, 0.73, -0.83], [x, 0.43, -0.60], 0.17, mats.ear);
    addSegment(root, `hind-hock-${side}`, [x, 0.43, -0.60], [x, 0.19, -0.40], 0.125, mats.creamFur);
    addEllipsoid(root, `hindpaw-${side}`, [x, 0.12, -0.30], [0.24, 0.13, 0.33], mats.creamFur, 24);
  }
  addTail(root);
  addGuardHair(root, 88);
  attachActionReadyRuntime(root);
  return root;
}
