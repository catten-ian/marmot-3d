/**
 * 扮演藏狐（PAF）· 猎物感知 / 逃跑对抗 / 扑击预判的纯函数集合（Stage 1）。
 *
 * 对应 fox-v2/PAF-IMPROVEMENT-PROPOSAL.md 的 A1/A2/A3/A4/B1/B2/E3：
 *  - A1 多线索察觉（距离衰减 × 视锥 × 速度/姿态系数 + 全向听觉代理）与 suspicion 累积/衰减
 *  - A2 freeze/tremble 中间态的触发条件、时长与 FSM 迁移
 *  - A3 近距离 zigzag：偏角、反转周期（±20% 随机）、速度系数
 *  - A4 轨迹回避：扑击预测着陆点 + 当前位置/着陆点加权逃离方向
 *  - B1 wind 期间 lead 提前量预测、≤12° 限时重瞄护栏、wind 60% 锁定
 *  - B2 捕获垂直窗口
 *  - E3 重生防贴脸（距离 / 视野锥约束 + 20 次退化取最远候选）
 *
 * 约定：
 *  - 本文件零依赖、不碰 three/DOM/地形，所有输入显式传入，便于 node:test 单测；
 *    真实 LOS / 岩石遮挡本阶段不接，perceptionCue 的 inCone 由调用方给出，
 *    未来接入遮挡查询时只需把 inCone 替换为 inCone && hasLineOfSight(...)。
 *  - 朝向约定与 play-as-fox.js 一致：yaw=0 朝 +z，方向向量 (sin yaw, cos yaw)。
 *  - cfg 即 PAF_DEFAULTS 运行时副本；角度参数在 cfg 中以"度"存储（lil-gui 友好），
 *    本模块入口统一换算。
 */

export const TAU = Math.PI * 2;

/** 玩家当前给猎物的线索档位：潜行 / 冲刺 / 扑击（wind+lunge 同属最高威胁档）。 */
export const CUE_MODE = Object.freeze({ STALK: 'stalk', SPRINT: 'sprint', LUNGE: 'lunge' });

const D2R = Math.PI / 180;
export const deg2rad = (d) => d * D2R;

/** 角度归一到 [-π, π]。 */
export function normAngle(a) {
  let x = a;
  while (x > Math.PI) x -= TAU;
  while (x < -Math.PI) x += TAU;
  return x;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** 从 (dx, dz) 求 yaw（yaw=0 → +z）。 */
export function yawTo(dx, dz) { return Math.atan2(dx, dz); }

/**
 * 狐狸是否在猎物视锥内。
 * @param {number} preyYaw 猎物当前朝向
 * @param {number} toX 猎物→狐狸 x
 * @param {number} toZ 猎物→狐狸 z
 * @param {number} halfAngleRad 视锥半角（弧度）
 * @param {() => boolean} [losProbe] 预留遮挡探针（本阶段恒视为可见）
 */
export function inViewCone(preyYaw, toX, toZ, halfAngleRad, losProbe = null) {
  if (losProbe) {
    try { if (!losProbe()) return false; } catch { return false; } // 探针失败按保守不可见？保持 fail-soft
  }
  return Math.abs(normAngle(yawTo(toX, toZ) - preyYaw)) <= halfAngleRad;
}

/**
 * 距离衰减：半径 inner 比例以内为满强度，外圈线性衰减到 0。
 * 比起从零距离线性衰减，平台区保证"对齐现有三档半径"的手感不缩圈。
 */
export function distanceFalloff(d, radius, inner) {
  if (!(radius > 0)) return 0;
  if (d <= radius * inner) return 1;
  if (d >= radius) return 0;
  return clamp((radius - d) / (radius * (1 - inner)), 0, 1);
}

/** 各线索档位的视觉 / 听觉半径（m）。视觉对齐旧三档；听觉为全向代理。 */
export function cueRadii(mode, p) {
  switch (mode) {
    case CUE_MODE.LUNGE:
      return { vision: p.visionRadiusLunge, hearing: p.detectLunge };
    case CUE_MODE.SPRINT:
      return { vision: p.detectSprint, hearing: p.hearRadiusSprint };
    case CUE_MODE.STALK:
    default:
      return { vision: p.detectStalk, hearing: p.hearRadiusStalk };
  }
}

/** 视觉速度系数（潜行 < 冲刺 < 扑击）。 */
export function visionSpeedCoef(mode, p) {
  if (mode === CUE_MODE.LUNGE) return p.speedCoefLunge;
  if (mode === CUE_MODE.SPRINT) return p.speedCoefSprint;
  return p.speedCoefStalk;
}

/** 听觉噪声系数（冲刺/扑击噪声更大）。 */
export function hearingNoiseCoef(mode, p) {
  if (mode === CUE_MODE.LUNGE) return p.noiseCoefLunge;
  if (mode === CUE_MODE.SPRINT) return p.noiseCoefSprint;
  return p.noiseCoefStalk;
}

/**
 * A1 单帧线索强度。
 * @param {{dist:number, inCone:boolean, mode:string}} input
 * @param {object} p cfg
 * @returns {{visionR:number, hearR:number, visual:number, hearing:number, gain:number, perceived:boolean}}
 */
export function perceptionCue(input, p) {
  const { dist, inCone, mode } = input;
  const { vision: visionR, hearing: hearR } = cueRadii(mode, p);
  // 视觉贡献 = 距离衰减 × 视锥系数（锥外为 0）× 速度系数
  const visual = inCone
    ? p.visionRate * distanceFalloff(dist, visionR, p.visionFalloffInner) * visionSpeedCoef(mode, p)
    : 0;
  // 听觉贡献 = 全向，半径内即计入；冲刺/扑击噪声系数更高
  const hearing = p.hearRate
    * distanceFalloff(dist, hearR, p.hearFalloffInner)
    * hearingNoiseCoef(mode, p);
  const gain = visual + hearing;
  return { visionR, hearR, visual, hearing, gain, perceived: gain > 1e-9 };
}

/** A1 suspicion 积分：感知到线索则累积，离开感知后线性衰减。 */
export function stepSuspicion(s, gain, perceived, dt, p) {
  if (perceived) return clamp(s + gain * dt, 0, p.suspicionFlee + 1);
  return Math.max(0, s - p.suspicionDecay * dt);
}

/** A2 冻结时长：[freezeMin, freezeMax] 均匀随机（秒）。 */
export function rollFreezeDuration(p, rng = Math.random) {
  return p.freezeMin + rng() * (p.freezeMax - p.freezeMin);
}

/**
 * A2 是否允许进入 freeze（而非直接逃）：
 * 远处（视觉半径 60%–100% 距离带）、玩家低速（潜行）、未进入 wind/lunge。
 */
export function canFreeze(input, p) {
  const { dist, mode, threatening, perceived } = input;
  if (threatening || mode !== CUE_MODE.STALK) return false;
  if (perceived === false) return false; // 线索已丢失不该冻结
  const r = p.detectStalk;
  return dist >= r * p.freezeBandMin && dist <= r * p.freezeBandMax;
}

/**
 * A1+A2 猎物心智状态机单步推进（纯函数，返回新 mind，不改输入对象）。
 *
 * 状态：wander → alert → freeze → flee；任一状态下 wind/lunge 或
 * 距离 < 档位半径×fleeCommit 立即 flee（跳过冻结）。
 *
 * @param {{state:string, suspicion:number, timer:number}} mind
 * @param {{dist:number, inCone:boolean, mode:string, threatening:boolean}} input
 * @param {number} dt
 * @param {object} p cfg
 * @param {() => number} [rng]
 * @returns {{state:string, suspicion:number, timer:number, cue:object}}
 */
export function stepPreyMind(mind, input, dt, p, rng = Math.random) {
  const m = mind || { state: 'wander', suspicion: 0, timer: 0 };
  const cue = perceptionCue(input, p);
  const suspicion = stepSuspicion(m.suspicion || 0, cue.gain, cue.perceived, dt, p);
  const { dist, mode, threatening } = input;
  const tierR = cueRadii(mode, p).vision;
  // wind/lunge 或过近都必须在"确实感知到线索"前提下才立即 flee，
  // 避免听不到看不见的远处猎物被白惊飞（旧码的立即 flee 同样位于 detect 半径内）。
  const immediate = cue.perceived && (threatening || dist < tierR * p.fleeCommit);

  const goWander = () => ({ state: 'wander', suspicion, timer: rng() * 2, cue });
  const goFlee = () => ({ state: 'flee', suspicion, timer: 0, cue });

  if (immediate) return goFlee();

  switch (m.state) {
    case 'flee':
      // 离开全部感知且 suspicion 衰减归零才回到游荡（带回滞）
      if (!cue.perceived && suspicion <= 0) return goWander();
      return { state: 'flee', suspicion, timer: 0, cue };
    case 'freeze': {
      const timer = (m.timer || 0) - dt;
      if (suspicion >= p.suspicionFlee || timer <= 0) return goFlee();
      return { state: 'freeze', suspicion, timer, cue };
    }
    case 'alert': {
      if (suspicion >= p.suspicionFlee) return goFlee();
      if (suspicion < p.suspicionAlert) return goWander(); // 线索衰减，解除警觉
      const timer = (m.timer || 0) - dt;
      if (timer > 0) return { state: 'alert', suspicion, timer, cue };
      // alert 停留结束：合格则先冻结，否则直接逃
      if (canFreeze({ ...input, perceived: cue.perceived }, p)) {
        return { state: 'freeze', suspicion, timer: rollFreezeDuration(p, rng), cue };
      }
      return goFlee();
    }
    case 'wander':
    default:
      if (suspicion >= p.suspicionAlert) {
        return { state: 'alert', suspicion, timer: p.alertTime, cue };
      }
      return { state: 'wander', suspicion, timer: m.timer || 0, cue };
  }
}

/**
 * A3 zigzag 是否应当启用：距离 < zigzagDistance 或玩家处于 wind/lunge。
 */
export function zigzagActive(dist, threatening, p) {
  return threatening || dist < p.zigzagDistance;
}

/** 单条 zigzag 腿的持续时间：基础带内均匀随机后叠加 ±zigzagJitter 抖动并钳到允许包络。 */
export function rollZigzagPeriod(p, rng = Math.random) {
  const base = p.zigzagPeriodMin + rng() * (p.zigzagPeriodMax - p.zigzagPeriodMin);
  const jittered = base * (1 + (rng() * 2 - 1) * p.zigzagJitter);
  return clamp(jittered, p.zigzagPeriodMin * (1 - p.zigzagJitter), p.zigzagPeriodMax * (1 + p.zigzagJitter));
}

/** 本条腿偏角大小（弧度）：zigzagAngleMin–zigzagAngleMax 度均匀随机。 */
export function rollZigzagAngle(p, rng = Math.random) {
  return deg2rad(p.zigzagAngleMin + rng() * (p.zigzagAngleMax - p.zigzagAngleMin));
}

/**
 * A3 zigzag 相位推进（纯函数）。
 * @param {{active:boolean, sign:number, timer:number, angle:number}} zz 上一帧相位
 * @param {boolean} active 本帧是否应启用
 * @returns {{active:boolean, sign:number, angle:number, timer:number, flipped:boolean}}
 *   sign=±1 侧向，angle=偏角大小，flipped 表示本帧发生了反转
 */
export function stepZigzag(zz, active, dt, p, rng = Math.random) {
  if (!active) return { active: false, sign: 0, angle: 0, timer: 0, flipped: false };
  if (!zz || !zz.active) {
    return {
      active: true,
      sign: rng() < 0.5 ? -1 : 1,
      angle: rollZigzagAngle(p, rng),
      timer: rollZigzagPeriod(p, rng),
      flipped: false,
    };
  }
  let { sign, angle, timer } = zz;
  let flipped = false;
  timer -= dt;
  if (timer <= 0) {
    sign = -sign;
    angle = rollZigzagAngle(p, rng);
    timer = rollZigzagPeriod(p, rng);
    flipped = true;
  }
  return { active: true, sign, angle, timer, flipped };
}

function norm2(x, z) {
  const l = Math.hypot(x, z);
  return l > 1e-9 ? { x: x / l, z: z / l, ok: true } : { x: 0, z: 0, ok: false };
}

/**
 * A4 预测扑击着陆点 = fox.pos + dir(yaw) × lungeSpeed × lungeTime × landingPredict。
 * wind 期间 yaw 用当前朝向（含重瞄），lunge 期间用锁定的 lungeYaw。
 */
export function predictLandingPoint(foxX, foxZ, yaw, p) {
  const reach = p.lungeSpeed * p.lungeTime * p.landingPredict;
  return { x: foxX + Math.sin(yaw) * reach, z: foxZ + Math.cos(yaw) * reach };
}

/**
 * A4 轨迹回避：逃离"当前狐狸位置"与"预测着陆点"两个威胁源的加权归一方向。
 * 某一威胁源与猎物重合（零向量）时其权重自动让给另一源；两者都重合则返回 ok:false，
 * 由调用方回退到原逃向。
 */
export function evadeVector(preyX, preyZ, foxX, foxZ, landX, landZ, p) {
  const a = norm2(preyX - foxX, preyZ - foxZ);
  const b = norm2(preyX - landX, preyZ - landZ);
  let wa = p.evadeCurrentWeight;
  let wb = p.evadeLandingWeight;
  if (!a.ok) wa = 0;
  if (!b.ok) wb = 0;
  const wsum = wa + wb;
  if (wsum <= 1e-9) return { x: 0, z: 0, yaw: 0, ok: false };
  const vx = (wa * a.x + wb * b.x) / wsum;
  const vz = (wa * a.z + wb * b.z) / wsum;
  const n = norm2(vx, vz);
  return { x: n.x, z: n.z, yaw: yawTo(n.x, n.z), ok: n.ok };
}

/**
 * B1 lead 目标点 = 猎物当前位置 + 猎物速度 × leadTime。
 */
export function leadTarget(preyX, preyZ, vx, vz, leadTime) {
  return { x: preyX + vx * leadTime, z: preyZ + vz * leadTime };
}

/** B1 提前量时间 = wind 剩余 + lungeTime × leadLungeFraction。 */
export function windLeadTime(windRemaining, p) {
  return Math.max(0, windRemaining) + p.lungeTime * p.leadLungeFraction;
}

/**
 * B1 wind 期间有限重瞄（纯函数）。
 *  - wind 前 windRetargetFrac（60%）允许向期望朝向做指数阻尼缓转；
 *  - 相对 wind 起始朝向的总修正量被钳在 ±windRetargetDeg（12°）内（防自动瞄准）；
 *  - 超过锁定点后原样返回（lunge 期间调用方也不再调用，零微调）。
 *
 * @returns {number} 新的 yaw
 */
export function retargetWindYaw(arg, p) {
  const { startYaw, yaw, desiredYaw, progress, dt } = arg;
  if (progress > p.windRetargetFrac) return yaw;
  const maxA = deg2rad(p.windRetargetDeg);
  const target = startYaw + clamp(normAngle(desiredYaw - startYaw), -maxA, maxA);
  const t = 1 - Math.exp(-p.windRetargetDamp * dt);
  let next = yaw + normAngle(target - yaw) * t;
  const fromStart = normAngle(next - startYaw);
  if (Math.abs(fromStart) > maxA) next = startYaw + Math.sign(fromStart) * maxA;
  return next;
}

/** 从一组 {x,z} 目标中选离狐狸水平距离最近者（已捕获的由调用方过滤）。 */
export function nearestTarget(foxX, foxZ, list) {
  let best = null;
  let bestD = Infinity;
  for (const it of list) {
    const d = Math.hypot(it.x - foxX, it.z - foxZ);
    if (d < bestD) { bestD = d; best = it; }
  }
  return best ? { target: best, dist: bestD } : null;
}

/**
 * B2 捕获判定：水平半径 + 垂直窗口同时满足。
 * 垂直：|foxTerrainY + fox.airY + catchFoxCenter − (preyTerrainY + preyCenterHeight)| < catchVerticalTol。
 * 腾空越过猎物头顶（airY≈1.05）时不命中。
 */
export function canCatch(dx, dz, foxAirY, preyTerrainY, p, foxTerrainY = 0) {
  const d = Math.hypot(dx, dz);
  if (!(d < p.catchRadius)) return false;
  const foxCatchY = foxTerrainY + foxAirY + p.catchFoxCenter;
  const preyCenterY = preyTerrainY + p.preyCenterHeight;
  return Math.abs(foxCatchY - preyCenterY) < p.catchVerticalTol;
}

/** E3 重生候选点：旧公式（随机角度 + 随机半径，clamp 到边界内）。 */
export function respawnCandidate(bounds, rng = Math.random) {
  const a = rng() * TAU;
  const r = 8 + rng() * Math.min(bounds.hw, bounds.hh) * 0.7;
  return {
    x: clamp(Math.cos(a) * r, -bounds.hw + 2, bounds.hw - 2),
    z: clamp(Math.sin(a) * r, -bounds.hh + 2, bounds.hh - 2),
  };
}

/**
 * E3 候选点是否满足防贴脸约束：
 * 距玩家 ≥ respawnMinDist，且不在玩家视线中心 ±respawnViewDeg 内。
 */
export function isRespawnOk(cx, cz, foxX, foxZ, foxYaw, p) {
  const dist = Math.hypot(cx - foxX, cz - foxZ);
  if (dist < p.respawnMinDist) return false;
  const ang = Math.abs(normAngle(yawTo(cx - foxX, cz - foxZ) - foxYaw));
  return ang > deg2rad(p.respawnViewDeg);
}

/**
 * E3 选重生点：最多尝试 respawnAttempts 次，首个合格候选即采用；
 * 全部失败则退化取离玩家最远的候选点（保证总能重生）。
 *
 * @returns {{x,z,ok:boolean,attempts:number,dist:number}}
 */
export function pickRespawnPoint(bounds, fox, p, rng = Math.random) {
  const attempts = Math.max(1, Math.round(p.respawnAttempts || 20));
  let best = null;
  let bestD = -Infinity;
  for (let i = 0; i < attempts; i++) {
    const c = respawnCandidate(bounds, rng);
    const d = Math.hypot(c.x - fox.x, c.z - fox.z);
    if (d > bestD) { bestD = d; best = c; }
    if (isRespawnOk(c.x, c.z, fox.x, fox.z, fox.yaw, p)) {
      return { x: c.x, z: c.z, ok: true, attempts: i + 1, dist: d };
    }
  }
  return { x: best.x, z: best.z, ok: false, attempts, dist: bestD };
}
