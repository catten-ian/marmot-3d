/**
 * PAF 专属土拨鼠（猎物）模型（扮演藏狐模式专用）。
 *
 * 程序化生成、零资产零新依赖。造型目标：圆胖躯干、短粗四肢、小眼睛、
 * 掘土的大爪子、细长尾巴、圆耳；背深腹浅的毛色分层。
 * 与 props_entities.js 的 buildMarmotMesh 完全隔离（普通模式不受影响）。
 *
 * 兼容性：返回值就是 THREE.Group（Prey 类直接当 this.mesh 用，
 * 可 .position/.rotation.y/.visible），并在 group 上挂两个方法：
 *  - setMoleState('wander'|'alert'|'flee')：姿态差异（只做视觉，不改 AI）；
 *  - updateAnim(dt, speedNorm)：起伏与姿态阻尼。
 */
import * as THREE from 'three';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const DAMP = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// 姿态目标（纯数据）：rearUp=立起程度，pawLift=前爪抬起，earPerk=耳竖，bodyPitch 附加
export const PAF_MOLE_POSES = {
  wander: { rearUp: 0,    pawLift: 0,    earPerk: 0.25, headUp: 0 },
  alert:  { rearUp: 0.62, pawLift: 0.9,  earPerk: 1,    headUp: 0.35 },
  flee:   { rearUp: -0.1, pawLift: 0,    earPerk: 0.1,  headUp: -0.1 },
};

/** Pure visual pose target; prey AI contracts remain in play-as-fox.js. */
export function computePafMolePose(state = 'wander', speedNorm = 0) {
  const name = PAF_MOLE_POSES[state] ? state : 'wander';
  const speed = clamp(Number.isFinite(speedNorm) ? speedNorm : 0, 0, 1);
  return { ...PAF_MOLE_POSES[name], state: name, speed, gaitFrequency: 1.1 + speed * 3.2 };
}

const palette = {
  back: new THREE.Color('#6f5433'),     // 背深棕
  flank: new THREE.Color('#96794d'),
  belly: new THREE.Color('#e8dcc0'),    // 腹浅
};
function hash3(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function moleFurColor(x, y, z) {
  let c = palette.flank.clone();
  if (y > 0.1) c.lerp(palette.back, clamp((y - 0.1) * 1.7));
  else if (y < -0.2) c.lerp(palette.belly, clamp((-y - 0.2) * 1.8));
  const fleck = hash3(Math.round(x * 36), Math.round(y * 30), Math.round(z * 34));
  c.multiplyScalar(0.92 + 0.16 * fleck);
  return c;
}
function moleFurGeometry() {
  const g = new THREE.SphereGeometry(1, 24, 18);
  const p = g.getAttribute('position');
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const c = moleFurColor(x, y, z);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
const sharedBodyGeo = moleFurGeometry();

const mat = (color, roughness = 0.95, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

export function createPafMoleModel(options = {}) {
  const group = new THREE.Group();
  group.name = 'pafMoleRoot';
  const furBase = new THREE.Color(options.color ?? 0x9a7c4e);

  const mats = {
    fur: mat('#ffffff', 0.96, { vertexColors: true }),
    plain: furBase.clone(),
    belly: mat('#e8dcc0', 0.95),
    dark: mat('#3a2c1e', 0.8),
    eye: mat('#1d1410', 0.2),
    nose: mat('#c98a7a', 0.55),
    claw: mat('#e6d9c2', 0.6),
    tail: mat('#8a6a45', 0.9),
  };
  mats.plain = mat(furBase.getHex(), 0.95);

  const addMesh = (parent, name, geo, material, pos = [0, 0, 0], scale = null) => {
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.position.set(...pos);
    if (scale) m.scale.set(...scale);
    m.castShadow = true;
    parent.add(m);
    return m;
  };

  const BODY_Y = 0.30;
  const bodyG = new THREE.Group();
  bodyG.name = 'body';
  bodyG.position.y = BODY_Y;
  group.add(bodyG);

  // 圆胖躯干（顶点色：背深腹浅）
  addMesh(bodyG, 'torso', sharedBodyGeo, mats.fur, [0, 0.035, -0.035], [0.30, 0.265, 0.355]);
  addMesh(bodyG, 'belly', new THREE.SphereGeometry(1, 18, 14), mats.belly, [0, -0.065, 0.075], [0.225, 0.175, 0.26]);
  addMesh(bodyG, 'rump', sharedBodyGeo, mats.fur, [0, -0.015, -0.24], [0.265, 0.225, 0.22]);

  // 头：小眼睛、圆耳、短吻 + 粉鼻
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.17, 0.275);
  bodyG.add(head);
  addMesh(head, 'skull', new THREE.SphereGeometry(1, 20, 14), mats.plain, [0, 0, 0], [0.16, 0.125, 0.135]);
  for (const side of [-1, 1]) {
    addMesh(head, `cheek-${side}`, new THREE.SphereGeometry(1, 12, 10), mats.belly,
      [side * 0.085, -0.035, 0.085], [0.075, 0.065, 0.07]);
  }
  addMesh(head, 'snout', new THREE.SphereGeometry(1, 14, 10), mats.belly, [0, -0.035, 0.135], [0.083, 0.055, 0.09]);
  addMesh(head, 'nose', new THREE.SphereGeometry(1, 10, 8), mats.nose, [0, -0.012, 0.215], [0.028, 0.020, 0.016]);
  // Blunt marmot incisors and whiskers, not a pointed fox muzzle.
  for (const side of [-1, 1]) {
    addMesh(head, `incisor-${side}`, new THREE.BoxGeometry(0.015, 0.028, 0.012), mats.claw,
      [side * 0.009, -0.074, 0.19]);
    for (let w = 0; w < 2; w++) {
      const whisker = addMesh(head, `whisker-${side}-${w}`, new THREE.CylinderGeometry(0.0018, 0.0018, 0.13, 4), mats.dark,
        [side * 0.105, -0.025 + w * 0.018, 0.16]);
      whisker.rotation.z = side * (Math.PI / 2 + 0.18 - w * 0.28);
    }
  }
  const ears = [];
  for (const side of [-1, 1]) {
    const ear = addMesh(head, `ear-${side}`, new THREE.SphereGeometry(1, 12, 10), mats.plain, [side * 0.125, 0.095, -0.018], [0.050, 0.052, 0.032]);
    ears.push(ear);
    addMesh(head, `eye-${side}`, new THREE.SphereGeometry(0.021, 10, 8), mats.eye, [side * 0.080, 0.025, 0.116]);
  }

  // 前爪：短粗前肢 + 掘土大爪（宽掌 + 三根爪）
  const frontPaws = [];
  for (const side of [-1, 1]) {
    const paw = new THREE.Group();
    paw.name = `front-paw-${side}`;
    paw.position.set(side * 0.205, -0.13, 0.19);
    bodyG.add(paw);
    addMesh(paw, 'arm', new THREE.CylinderGeometry(0.045, 0.055, 0.14, 8), mats.plain, [0, -0.05, 0]);
    addMesh(paw, 'palm', new THREE.SphereGeometry(1, 14, 10), mats.plain, [0, -0.13, 0.035], [0.088, 0.045, 0.10]);
    for (let c = -1.5; c <= 1.5; c++) {
      addMesh(paw, `toe-${c}`, new THREE.SphereGeometry(1, 10, 8), mats.plain,
        [c * 0.036, -0.135, 0.102], [0.025, 0.025, 0.05]);
      const claw = addMesh(paw, `claw-${c}`, new THREE.ConeGeometry(0.012, 0.075, 7), mats.claw, [c * 0.036, -0.139, 0.151]);
      claw.rotation.x = Math.PI / 2 - 0.35;
    }
    frontPaws.push(paw);
  }
  // 后肢：短粗
  for (const side of [-1, 1]) {
    addMesh(bodyG, `hind-${side}`, new THREE.SphereGeometry(1, 14, 10), mats.plain, [side * 0.18, -0.13, -0.17], [0.11, 0.12, 0.13]);
    addMesh(bodyG, `hindpaw-${side}`, new THREE.SphereGeometry(1, 12, 8), mats.plain, [side * 0.18, -0.235, -0.07], [0.075, 0.04, 0.125]);
  }
  // 细长尾巴（两节）
  const tailBase = new THREE.Group();
  tailBase.name = 'tail';
  tailBase.position.set(0, -0.06, -0.33);
  bodyG.add(tailBase);
  addMesh(tailBase, 't0', new THREE.CylinderGeometry(0.018, 0.026, 0.16, 6), mats.tail, [0, 0, -0.07]).rotation.x = Math.PI / 2 - 0.25;
  const tailTip = new THREE.Group();
  tailTip.position.set(0, 0.02, -0.14);
  tailBase.add(tailTip);
  addMesh(tailTip, 't1', new THREE.CylinderGeometry(0.008, 0.016, 0.14, 6), mats.tail, [0, 0, -0.06]).rotation.x = Math.PI / 2 - 0.15;

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // —— 姿态（纯视觉，由 Prey 状态驱动，不改 AI）——
  let state = 'wander';
  let cur = { ...PAF_MOLE_POSES.wander };
  let bob = Math.random() * 10;

  group.setMoleState = (s) => { if (PAF_MOLE_POSES[s]) state = s; };
  group.getMoleState = () => state;
  group.updateAnim = (dt, speedNorm = 0) => {
    if (!(dt > 0)) return;
    const t = computePafMolePose(state, speedNorm);
    for (const k of ['rearUp', 'pawLift', 'earPerk', 'headUp']) cur[k] = DAMP(cur[k], t[k], 8, dt);
    const speed = t.speed;
    bob += dt * (3 + speed * 14);

    // 立起（警觉）/ 压低（逃跑）
    bodyG.rotation.x = -cur.rearUp * 0.62 + (state === 'flee' ? 0.10 : 0);
    bodyG.position.y = BODY_Y + cur.rearUp * 0.10 + (speed > 0.05 ? Math.abs(Math.sin(bob)) * 0.02 * speed : 0);
    head.rotation.x = -cur.headUp - cur.rearUp * -0.35;
    // 前爪抬起（警觉时胸前合拢）
    const pawStep = Math.sin(bob * 1.5) * speed * 0.38;
    frontPaws[0].rotation.x = -cur.pawLift * 1.15 + pawStep;
    frontPaws[1].rotation.x = -cur.pawLift * 1.15 - pawStep;
    // 耳朵竖起：略外张 + 变挺
    ears[0].rotation.z = 0.15 + cur.earPerk * 0.3;
    ears[1].rotation.z = -0.15 - cur.earPerk * 0.3;
    ears[0].scale.y = ears[1].scale.y = 0.05 * (1 + cur.earPerk * 0.35);
    // 尾巴跟随
    tailBase.rotation.y = Math.sin(bob * 0.7) * 0.12;
    tailTip.rotation.y = Math.sin(bob * 0.7 - 0.8) * 0.2;
  };

  return group;
}
