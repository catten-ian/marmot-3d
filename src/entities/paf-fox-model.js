/**
 * PAF 专属藏狐模型（扮演藏狐模式玩家本体）。
 *
 * 程序化生成、零资产零新依赖。造型目标：修长体型、尖吻、大而尖的三角耳、
 * 蓬松大尾（尾尖深色）、短而结实的四肢、背灰腹白的毛色分层与面部斑纹。
 * 工具手法参考 tibetan-fox.js（只读参考，已按需复制精简，本文件独立演化）。
 *
 * API 与 createProceduralFox() 对齐：group/root/body/head/muzzle/ears/legs/tail/
 * setColor/setAnimState/update，另加 setHeadVisible（FPV 下隐藏头部防糊屏）。
 *
 * 姿态系统（替代旧的 scale.y 压扁）：
 *  - computePafFoxPose() 纯函数给出各姿态目标参数（body 下移、后躯低于前躯、
 *    腿折弯、头略抬），update() 内做阻尼混合；
 *  - 腿摆相位/步频随速度变化，尾巴分段跟随摆动。
 */
import * as THREE from 'three';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const DAMP = (cur, target, lambda, dt) => cur + (target - cur) * (1 - Math.exp(-lambda * dt));

// —— 姿态表（纯数据，computePafFoxPose 的输出目标）——
// bodyY: 整体下移；bodyPitch: 正=低头前倾；hipDrop: 后躯额外下压；
// headPitch: 头部相对补偿（正=抬头）；legBend: 静态折腿量；tailLow: 尾下垂；tailWag: 尾摆幅度。
export const PAF_FOX_POSES = {
  idle:    { bodyY: 0,     bodyPitch: 0,     hipDrop: 0,     headPitch: 0.04, legBend: 0.06, tailLow: 0.30, tailWag: 0.12 },
  stalk:   { bodyY: -0.14, bodyPitch: 0.10,  hipDrop: 0.05,  headPitch: 0.16, legBend: 0.50, tailLow: 0.55, tailWag: 0.05 },
  wind:    { bodyY: -0.12, bodyPitch: 0.26,  hipDrop: 0.22,  headPitch: 0.34, legBend: 0.85, tailLow: 0.42, tailWag: 0 },
  lunge:   { bodyY: 0.03,  bodyPitch: -0.22, hipDrop: -0.05, headPitch: -0.06, legBend: 0.32, tailLow: -0.30, tailWag: 0 },
  dash:    { bodyY: 0.01,  bodyPitch: -0.06, hipDrop: 0,     headPitch: 0.02, legBend: 0.12, tailLow: -0.12, tailWag: 0.16 },
  recover: { bodyY: -0.07, bodyPitch: 0.07,  hipDrop: 0.06,  headPitch: 0.12, legBend: 0.28, tailLow: 0.48, tailWag: 0.06 },
};

/**
 * 姿态目标纯函数：给定 {anim, speed} 返回混合目标与步态参数。
 * 各姿态输出互不相同；任何输入下不产生 NaN。
 */
export function computePafFoxPose(state = {}) {
  const anim = typeof state.anim === 'string' ? state.anim : 'idle';
  const base = PAF_FOX_POSES[anim] || PAF_FOX_POSES.idle;
  const speed = Number.isFinite(state.speed) ? Math.max(0, state.speed) : 0;
  const moving = anim === 'dash' || anim === 'stalk' || speed > 0.05;
  // 步频 1.6–3.4Hz 随地面速度线性插值（提案 D2 建议 1.6–3.0，上限略放给冲刺）
  const gaitFreq = moving ? clamp(1.6 + speed * 0.28, 1.6, 3.4) : 0;
  // 摆幅：慢行小幅、冲刺大幅
  const gaitAmp = !moving ? 0 : anim === 'dash' ? 0.62 : anim === 'stalk' ? 0.20 : 0.32;
  return { ...base, anim, speed, moving, gaitFreq, gaitAmp };
}

// —— 毛色 ——
const palette = {
  tan: new THREE.Color('#ad8a61'),      // 暖棕侧腹
  gray: new THREE.Color('#77786e'),     // 背部银灰（藏狐灰调）
  cream: new THREE.Color('#efe6d4'),    // 腹侧奶白
  rust: new THREE.Color('#a06234'),     // 锈棕（耳背/颈背）
  guard: new THREE.Color('#c7bba4'),
};
function hash3(x, y, z) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function furColor(x, y, z) {
  // 单位球对象空间：腹白、背灰、侧暖棕，带细碎斑
  let c = palette.tan.clone();
  if (y < -0.25) c.lerp(palette.cream, clamp((-y - 0.25) * 1.6));
  else if (y > 0.12) c.lerp(palette.gray, clamp((y - 0.12) * 1.5));
  const fleck = hash3(Math.round(x * 40), Math.round(y * 36), Math.round(z * 38));
  c.lerp(fleck > 0.55 ? palette.guard : palette.tan, Math.abs(fleck - 0.5) * (y > 0.1 ? 0.3 : 0.08));
  return c;
}

const mat = (color, roughness = 0.94, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const mats = {
  fur: mat('#ffffff', 0.96, { vertexColors: true }),   // 顶点色载体（setColor 调 color 作乘色）
  cream: mat('#efe6d4', 0.95),
  rust: mat('#98613d', 0.94),
  dark: mat('#4a382c', 0.9),                            // 吻尖/尾尖/斑纹
  earInner: mat('#e3cdb2', 0.96),
  nose: mat('#231d19', 0.5),
  eye: mat('#1f1712', 0.18),
  glint: new THREE.MeshBasicMaterial({ color: '#fff6e2' }),
  legLower: mat('#d9cbb4', 0.95),
  paw: mat('#c7b99e', 0.95),
  claw: mat('#352c26', 0.55),
  ruff: mat('#a8916f', 0.96),
};

/** 带顶点毛色的有机椭球几何（单位球 → 调用方 scale）。 */
function furGeometry(widthSeg = 28, heightSeg = 20, variation = 0.012) {
  const g = new THREE.SphereGeometry(1, widthSeg, heightSeg);
  const p = g.getAttribute('position');
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const noise = Math.sin(x * 19 + z * 15) * Math.cos(y * 21 - z * 11);
    const d = 1 + variation * noise;
    p.setXYZ(i, x * d, y * d, z * d);
    const c = furColor(x, y, z);
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}
const sharedFurGeo = furGeometry();

function addMesh(parent, name, geo, material, pos = [0, 0, 0], scale = null) {
  const m = new THREE.Mesh(geo, material);
  m.name = name;
  m.position.set(...pos);
  if (scale) m.scale.set(...scale);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function addFurMass(parent, name, pos, scale) {
  return addMesh(parent, name, sharedFurGeo, mats.fur, pos, scale);
}
function addEllipsoid(parent, name, pos, scale, material, seg = 20) {
  return addMesh(parent, name, new THREE.SphereGeometry(1, seg, Math.max(12, Math.floor(seg * 0.7))), material, pos, scale);
}

/** 渐收三角耳壳（复制自 tibetan-fox.js 的手法，尺寸本文件自定）。 */
function taperedEarGeometry() {
  const rings = [
    { y: 0.00, x: 0.30, z: 0.12 },
    { y: 0.22, x: 0.33, z: 0.11 },
    { y: 0.46, x: 0.27, z: 0.09 },
    { y: 0.70, x: 0.16, z: 0.06 },
    { y: 0.88, x: 0.05, z: 0.025 },
  ];
  const radial = 10, positions = [], indices = [];
  for (const ring of rings) {
    for (let j = 0; j < radial; j++) {
      const t = j / radial * Math.PI * 2;
      positions.push(Math.sin(t) * ring.x, ring.y, Math.cos(t) * ring.z);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    const lo = i * radial, hi = (i + 1) * radial;
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      indices.push(lo + j, lo + j2, hi + j, lo + j2, hi + j2, hi + j);
    }
  }
  const baseC = positions.length / 3;
  positions.push(0, 0, 0);
  for (let j = 0; j < radial; j++) indices.push(baseC, (j + 1) % radial, j);
  const apex = positions.length / 3;
  positions.push(0, 1.0, 0);
  const last = (rings.length - 1) * radial;
  for (let j = 0; j < radial; j++) indices.push(last + j, last + (j + 1) % radial, apex);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
const sharedEarGeo = taperedEarGeometry();

function buildEar(head, side) {
  const ear = new THREE.Group();
  ear.name = `ear-${side > 0 ? 'l' : 'r'}`;
  ear.position.set(side * 0.115, 0.14, -0.035);
  ear.rotation.z = -side * 0.12;
  ear.rotation.x = -0.10;
  // 大而尖的三角耳（藏狐标志性）：壳几何高约 1，耳高 0.34，竖立于颅顶
  addMesh(ear, 'shell', sharedEarGeo, mats.rust, [0, 0, 0], [0.225, 0.24, 0.34]);
  const innerShape = new THREE.Shape();
  innerShape.moveTo(-0.16, 0.06);
  innerShape.quadraticCurveTo(-0.15, 0.32, 0, 0.55);
  innerShape.quadraticCurveTo(0.15, 0.32, 0.16, 0.06);
  innerShape.quadraticCurveTo(0, 0.0, -0.16, 0.06);
  const innerGeo = new THREE.ShapeGeometry(innerShape, 8);
  addMesh(ear, 'concha', innerGeo, mats.earInner, [0, 0.022, 0.036], [0.59, 0.28, 1]);
  // 耳尖深色（独立几何，避免组缩放错位）
  addMesh(ear, 'tip', new THREE.ConeGeometry(0.024, 0.055, 6), mats.dark, [0, 0.202, 0], null);
  head.add(ear);
  return ear;
}

function buildLeg(body, name, x, z, hind) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(x, hind ? -0.03 : -0.05, z);
  body.add(pivot);
  if (hind) {
    // 大腿（毛团）+ 小腿 + 爪
    addEllipsoid(pivot, 'thigh', [0, -0.10, -0.02], [0.085, 0.13, 0.11], mats.rust, 16);
  } else {
    addMesh(pivot, 'upper', new THREE.CylinderGeometry(0.045, 0.055, 0.24, 8), mats.rust, [0, -0.12, 0]);
  }
  const knee = new THREE.Group();
  knee.name = `${name}-knee`;
  knee.position.set(0, -0.24, hind ? -0.02 : 0);
  pivot.add(knee);
  addMesh(knee, 'lower', new THREE.CylinderGeometry(0.032, 0.042, 0.20, 8), mats.legLower, [0, -0.10, 0]);
  addEllipsoid(knee, 'paw', [0, -0.22, 0.04], [0.060, 0.042, 0.10], mats.paw, 14);
  for (let toe = -1; toe <= 1; toe++) {
    addEllipsoid(knee, `toe-${toe}`, [toe * 0.028, -0.224, 0.105], [0.020, 0.022, 0.044], mats.legLower, 10);
    const claw = addMesh(knee, `claw-${toe}`, new THREE.ConeGeometry(0.009, 0.042, 6), mats.claw,
      [toe * 0.028, -0.229, 0.142]);
    claw.rotation.x = Math.PI / 2 - 0.22;
  }
  return { pivot, knee, hind };
}

function buildTail(body) {
  const tail = new THREE.Group();
  tail.name = 'tail';
  tail.position.set(0, 0.06, -0.50);
  body.add(tail);
  // 三段链式蓬松尾：根部暖棕 → 中段 → 尾尖深褐
  const segs = [];
  const segDef = [
    { len: 0.22, r: [0.105, 0.09, 0.14], m: mats.rust },
    { len: 0.23, r: [0.135, 0.115, 0.16], m: mats.fur },
    { len: 0.19, r: [0.105, 0.09, 0.13], m: mats.cream },
  ];
  let parent = tail;
  for (let i = 0; i < segDef.length; i++) {
    const g = new THREE.Group();
    g.name = `tail-seg-${i}`;
    if (i > 0) g.position.set(0, 0.01, -segDef[i - 1].len);
    parent.add(g);
    const d = segDef[i];
    const geo = i === 1 ? sharedFurGeo : new THREE.SphereGeometry(1, 16, 12);
    addMesh(g, 'plume', geo, d.m, [0, 0, -d.len / 2], d.r);
    segs.push(g);
    parent = g;
  }
  tail.userData.segs = segs;
  return tail;
}

export function createPafFoxModel(options = {}) {
  const group = new THREE.Group();
  group.name = 'pafFoxRoot';
  const BODY_Y = 0.55;                       // 站立时躯干中心高度（四爪贴地 y=0，面朝 +Z）

  const body = new THREE.Group();
  body.name = 'body';
  body.position.y = BODY_Y;
  group.add(body);

  // 躯干：修长体型 + 胸部 + 腹部奶白贴块
  addFurMass(body, 'torso', [0, 0.02, -0.04], [0.255, 0.235, 0.47]);
  addFurMass(body, 'chest', [0, 0.015, 0.30], [0.235, 0.245, 0.25]);
  addEllipsoid(body, 'belly-cream', [0, -0.13, 0.02], [0.17, 0.12, 0.34], mats.cream, 18);
  // Dense neck ruff and silver saddle give the Tibetan fox its heavy-coated
  // outline rather than the narrow waist of a red fox.
  addFurMass(body, 'neck-ruff', [0, 0.14, 0.37], [0.225, 0.205, 0.20]);
  addEllipsoid(body, 'throat-bib', [0, -0.015, 0.48], [0.125, 0.19, 0.075], mats.cream, 18);
  for (const side of [-1, 1]) {
    const shoulderTuft = addMesh(body, `shoulder-ruff-${side}`, new THREE.ConeGeometry(0.075, 0.20, 7), mats.ruff,
      [side * 0.205, 0.04, 0.29]);
    shoulderTuft.rotation.z = side * 1.25;
    addEllipsoid(body, `haunch-${side}`, [side * 0.14, -0.055, -0.32], [0.115, 0.16, 0.17], mats.rust, 16);
  }
  // 后躯（独立分组，蓄力时额外下压）
  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.position.set(0, -0.01, -0.30);
  body.add(hips);
  addFurMass(hips, 'rump', [0, 0.03, -0.06], [0.21, 0.21, 0.22]);

  // 头
  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.235, 0.49);
  body.add(head);
  // Broad, almost square cranium and flared cheek ruffs are the key Tibetan
  // fox facial cues; the tapered muzzle remains canine rather than feline.
  addFurMass(head, 'skull', [0, 0.015, 0.015], [0.185, 0.14, 0.15]);
  addEllipsoid(head, 'cheek-l', [0.125, -0.045, 0.085], [0.075, 0.070, 0.080], mats.cream, 16);
  addEllipsoid(head, 'cheek-r', [-0.125, -0.045, 0.085], [0.075, 0.070, 0.080], mats.cream, 16);
  for (const side of [-1, 1]) {
    const ruff = addMesh(head, `cheek-ruff-${side}`, new THREE.ConeGeometry(0.047, 0.135, 6), mats.ruff,
      [side * 0.175, -0.035, 0.045]);
    ruff.rotation.z = side * 1.35;
    const brow = addEllipsoid(head, `brow-${side}`, [side * 0.080, 0.075, 0.139], [0.067, 0.018, 0.022], mats.rust, 12);
    brow.rotation.z = -side * 0.14;
  }
  // Short, tapered snout under the broad face.
  const muzzle = new THREE.Group();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, -0.055, 0.16);
  head.add(muzzle);
  const muzzleGeo = new THREE.CylinderGeometry(0.040, 0.080, 0.19, 12);
  addMesh(muzzle, 'snout', muzzleGeo, mats.cream, [0, 0, 0.055], null).rotation.x = Math.PI / 2 - 0.08;
  addEllipsoid(muzzle, 'nose', [0, 0.006, 0.155], [0.037, 0.026, 0.025], mats.nose, 12);
  // 面部深色斑（眼周 + 吻侧）
  addEllipsoid(head, 'mask-l', [0.085, 0.045, 0.135], [0.055, 0.035, 0.03], mats.dark, 12);
  addEllipsoid(head, 'mask-r', [-0.085, 0.045, 0.135], [0.055, 0.035, 0.03], mats.dark, 12);
  for (const side of [-1, 1]) {
    const eye = addEllipsoid(head, `eye-${side}`, [side * 0.092, 0.045, 0.148], [0.024, 0.019, 0.016], mats.eye, 12);
    eye.rotation.z = side * 0.12;
    addEllipsoid(head, `glint-${side}`, [side * 0.088, 0.052, 0.162], [0.006, 0.005, 0.004], mats.glint, 8);
  }
  const ears = [buildEar(head, 1), buildEar(head, -1)];

  // 四肢：前 ×2 / 后 ×2
  const legs = [
    buildLeg(body, 'leg-fl', 0.115, 0.27, false),
    buildLeg(body, 'leg-fr', -0.115, 0.27, false),
    buildLeg(body, 'leg-hl', 0.13, -0.28, true),
    buildLeg(body, 'leg-hr', -0.13, -0.28, true),
  ];

  const tail = buildTail(body);
  const tailSegs = tail.userData.segs;

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // —— 运行时状态 ——
  let animState = { anim: 'idle', speed: 0 };
  let cur = { ...PAF_FOX_POSES.idle };
  let walkPhase = 0;

  const DEFAULT_COLORS = { fur: '#ffffff', rust: '#98613d', legLower: '#d9cbb4', paw: '#c7b99e' };
  const setColor = (hex) => {
    // hex 作为乘色 tint（默认 0xffffff 保持原配色），派生色 = 默认色 × tint
    const tint = new THREE.Color(hex);
    mats.fur.color.copy(tint);
    mats.rust.color.set(DEFAULT_COLORS.rust).multiply(tint);
    mats.legLower.color.set(DEFAULT_COLORS.legLower).multiply(tint);
    mats.paw.color.set(DEFAULT_COLORS.paw).multiply(tint);
  };
  const setAnimState = (state = {}) => {
    animState = { anim: state.anim || 'idle', speed: Number.isFinite(state.speed) ? state.speed : animState.speed };
  };
  /** FPV 下隐藏头部（眼位在头内，避免糊屏）；身体保留，低头可见自身躯干。 */
  const setHeadVisible = (v) => { head.visible = !!v; };

  const update = (dt) => {
    if (!(dt > 0)) return;
    const target = computePafFoxPose(animState);
    const L = 10;
    for (const k of ['bodyY', 'bodyPitch', 'hipDrop', 'headPitch', 'legBend', 'tailLow', 'tailWag']) {
      cur[k] = DAMP(cur[k], target[k], L, dt);
    }
    // 步态相位：步频随速度
    walkPhase += dt * target.gaitFreq * Math.PI * 2;
    const amp = target.gaitAmp;

    // 躯干姿态：整体下移 + 前倾/后仰；后躯额外下压（蓄力时后躯低于前躯）
    const bob = target.moving && target.anim === 'dash' ? Math.abs(Math.sin(walkPhase)) * 0.02 : 0;
    body.position.y = BODY_Y + cur.bodyY + bob;
    body.rotation.x = cur.bodyPitch;
    hips.position.y = -0.01 - cur.hipDrop;
    hips.rotation.x = -cur.hipDrop * 0.6;
    // 头：身体前倾时抬头补偿
    head.rotation.x = -cur.bodyPitch * 0.55 - cur.headPitch * 0.4;
    head.rotation.y = Math.sin(walkPhase * 0.23) * 0.03;

    // 腿：对角步态 + 静态折弯
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const diag = (i === 0 || i === 3) ? 0 : Math.PI;
      const swing = Math.sin(walkPhase + diag) * amp * (leg.hind ? 1.15 : 1);
      leg.pivot.rotation.x = swing + (leg.hind ? cur.legBend * 0.35 : -cur.legBend * 0.25);
      // 折腿：前膝向后、后膝（跗关节）向前顶
      const bend = cur.legBend + Math.max(0, leg.hind ? swing : -swing) * 0.7;
      leg.knee.rotation.x = leg.hind ? bend * 0.9 : -bend * 0.9;
    }

    // 尾：分段跟随摆动 + 姿态性抬/垂
    for (let i = 0; i < tailSegs.length; i++) {
      const s = tailSegs[i];
      s.rotation.y = Math.sin(walkPhase * 0.5 - i * 0.7) * cur.tailWag;
      s.rotation.x = (i === 0 ? 0.5 : 0.12) - cur.tailLow * (i === 0 ? 0.9 : 0.25);
    }
  };

  setColor(options.color ?? 0xffffff);
  return {
    group, root: group, body, head, muzzle, ears,
    legs: legs.map((l) => l.pivot), tail,
    setColor, setAnimState, setHeadVisible, update,
  };
}
