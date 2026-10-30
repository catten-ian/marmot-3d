/** Deterministic, dependency-free smart fox decision, perception and motion primitives. */
import { stepFoxLocomotion } from '../core/fox-motion.js';
export const SMART_INTENTS = ['observe', 'approach', 'feint', 'pounce', 'recover', 'abandon'];
export const SMART_WEIGHTS = Object.freeze({
  observeBase: .26, observeUnaware: .24, observeDistance: .18,
  approachBase: .18, approachDistance: .34, approachSuspicion: .22, approachUnguarded: .08,
  feintBase: .12, feintGuard: .34, feintMemory: .28, feintInterruptions: .25,
  pounceBase: .08, pounceDistance: .44, pounceSuspicion: .2, pounceUnguarded: .12,
  pounceMemory: .34, pounceInterruptions: .28, pounceFatigue: .18,
  recoverBase: .06, recoverFatigue: .58, recoverHealth: .44, recoverInterruptions: .08,
  abandonBase: .02, abandonHealth: .62, abandonFatigue: .3, abandonClose: .04,
});
export const SMART_POUNCE = Object.freeze({ minDistance: 3, maxDistance: 7, maxAngle: 20 * Math.PI / 180, windup: .22, speed: 10.6, lockTime: .72 });
/**
 * 阶段 4：冲刺扑咬两阶段常量（新常量块，不破坏 SMART_POUNCE 既有字段名）。
 * 时序：冲刺阶段 dashStage（时长固定、速度略快于普通冲刺、显示预警线）
 *   → 扑咬前摇 windup（极短）→ 扑咬 strike（真实位移，很短，只扑近地）
 *   → 后摇 recover（硬直，给玩家反击窗口）。
 * strikeSpeed / recoverTime 与 play-as-fox 的 PAF_DEFAULTS（lungeSpeed/lungeTime/recoverTime）对齐。
 */
export const SMART_POUNCE_STAGE = Object.freeze({
  dashDuration: 0.42,   // 冲刺阶段：固定时长（不因距离变化）
  dashSpeedMul: 1.18,   // 冲刺阶段速度 = 扑击基准速度 × 该系数（略快于普通冲刺）
  windupTime: 0.10,     // 扑咬前摇：极短
  strikeTime: 0.22,     // 扑咬真实位移时长：很短（与 PAF windTime 同量级）
  strikeSpeed: 13.5,    // 与 play-as-fox lungeSpeed 对齐
  recoverTime: 0.45,    // 扑咬后摇（硬直）
  minStrikeDistance: 0, // 扑咬能覆盖的距离（近地）
  maxStrikeDistance: 1.9,
  staminaCost: 26,      // 扑咬一次性大量体力消耗（区别于冲刺阶段的持续消耗）
});
/**
 * 冲刺阶段实际位移距离（= 预警线长度）：按 stepSmartMotion 的欧拉积分逐帧模拟，
 * 与真实冲刺位移严格一致（连续积分公式与逐帧 clamp 加速有 ~10% 偏差，不能写死也不能混用）。
 */
/**
 * 阶段 5：调参台运行时覆盖层（可变，勿冻结）。
 * lil-gui 直接改这个对象，smart-fox-core 内部所有扑咬时序读取都走这里；
 * 缺省值复制自冻结常量 SMART_POUNCE_STAGE，默认值永远安全。
 */
export const SMART_POUNCE_TUNE = { ...SMART_POUNCE_STAGE };
/** 把覆盖层复位回冻结常量的默认值。 */
export function resetSmartPounceTune() { Object.assign(SMART_POUNCE_TUNE, SMART_POUNCE_STAGE); return SMART_POUNCE_TUNE; }

/** 提交门预留一次性成本与真正 dash 的持续成本；不改变原提交阈值。 */
export function smartPounceStaminaReserve(pounceStaminaPerSec, tune = SMART_POUNCE_TUNE) {
  return tune.staminaCost + pounceStaminaPerSec * tune.dashDuration;
}

/**
 * 逐帧体力扣费策略。beta 只在真正 dash 时按扑击费率收费，dash 尾帧按实际占比收费，
 * 使完整预留量与离散帧真实消耗一致；stable 永远沿用旧 committed 扣费。
 */
export function smartPounceStaminaDrainPerSec({ beta = false, committed = false, stage = null,
  remaining = 0, dt = 0, pounceRate = 0, stalkRate = 0 } = {}) {
  if (!beta) return committed ? pounceRate : stalkRate;
  if (stage === 'dash') return dt > 0 ? pounceRate * Math.min(1, Math.max(0, remaining) / dt) : pounceRate;
  return stalkRate;
}

/** Shared one-bite cooldown step; callers invoke it once per active update. */
export function stepSmartContactCooldown(current = 0, dt = 0) {
  return Math.max(0, (Number(current) || 0) - Math.max(0, Number(dt) || 0));
}

/**
 * Beta-only close bite. This state machine is deliberately independent from
 * pounce: a close action has a readable windup, a short strike and recovery.
 */
export const SMART_MELEE_PHASES = Object.freeze([null, 'windup', 'strike', 'recover']);

export function createSmartMeleeState() {
  return { phase: null, phaseTime: 0, cooldown: 0, hitConsumed: false, yaw: 0 };
}

export function cancelSmartMelee(state = {}) {
  return { ...createSmartMeleeState(), ...state, phase: null, phaseTime: 0, hitConsumed: false };
}

export function consumeSmartMeleeHit(state = {}) {
  if (state.phase !== 'strike' || state.hitConsumed) return { ...state };
  return { ...state, hitConsumed: true };
}

const meleeDuration = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;

export function advanceSmartMelee(state = {}, input = {}, dt = 1 / 60, tune = {}) {
  const s = { ...createSmartMeleeState(), ...state };
  const step = Math.max(0, Number(dt) || 0);
  const windupTime = meleeDuration(tune.smartMeleeWindupTime, .25);
  const strikeTime = meleeDuration(tune.smartMeleeStrikeTime, .15);
  const recoverTime = meleeDuration(tune.smartMeleeRecoverTime, .45);
  const cooldownTime = Math.max(0, Number(tune.smartMeleeCooldown) || 0);
  s.cooldown = Math.max(0, (Number(s.cooldown) || 0) - step);
  s.justStarted = false;
  s.justStrikeStarted = false;
  s.justEnded = false;

  const safe = !!input.safe;
  const incapacitated = input.alive === false || !!input.stunned || !!input.retreating || !!input.fleeing;
  if (safe || incapacitated) return cancelSmartMelee(s);

  if (s.phase == null) {
    const canStart = input.distance <= (Number(tune.smartMeleeTriggerRange) || 0)
      && input.reachable !== false && !input.pounceCommitted && !input.pouncePending
      && s.cooldown <= 0;
    if (canStart) {
      s.phase = 'windup';
      s.phaseTime = windupTime;
      s.hitConsumed = false;
      s.yaw = Number.isFinite(input.targetYaw) ? input.targetYaw : (s.yaw || 0);
      s.justStarted = true;
    }
    return s;
  }

  if (s.phase === 'windup' && Number.isFinite(input.targetYaw)) s.yaw = input.targetYaw;
  s.phaseTime -= step;
  if (s.phaseTime > 0) return s;
  if (s.phase === 'windup') {
    s.phase = 'strike';
    s.phaseTime = strikeTime;
    s.hitConsumed = false;
    s.justStrikeStarted = true;
  } else if (s.phase === 'strike') {
    s.phase = 'recover';
    s.phaseTime = recoverTime;
    s.cooldown = Math.max(s.cooldown, cooldownTime);
  } else {
    s.phase = null;
    s.phaseTime = 0;
    s.hitConsumed = false;
    s.justEnded = true;
  }
  return s;
}

/** Current-contact melee test; intentionally no pounce swept-segment test. */
export function smartMeleeContactHit(input = {}, tune = {}) {
  const range = Number(tune.smartMeleeHitRange) || 0;
  return input.phase === 'strike' && input.striking === true && !input.hitConsumed
    && !input.safe && !input.invulnerable && (Number(input.contactCd) || 0) <= 0
    && input.verticalOverlap === true && Number.isFinite(input.distance)
    && range > 0 && input.distance < range;
}

export function smartPounceDashDistance(initialSpeed = 0, dashSpeed, acceleration = 18, remaining = SMART_POUNCE_TUNE.dashDuration, dt = 1 / 60) {
  let speed = initialSpeed, dist = 0, t = Math.max(0, remaining);
  // stepSmartMotion 每帧"先移动一个完整 dt、再扣剩余时长"（末帧过冲也走满 dt），
  // 这里用同样的整帧步进，保证预警线长度 = 实际位移。
  while (t > 1e-9) {
    speed += Math.max(-acceleration * dt, Math.min(acceleration * dt, dashSpeed - speed));
    dist += speed * dt;
    t -= dt;
  }
  return dist;
}
/** 撞障/受击取消扑击：当帧取消且（调用方保证）无伤害；进后摇硬直。纯函数。 */
export function cancelSmartPounce(state) {
  const s = { ...state };
  s.pounceCommitted = false;
  s.pounceStriking = false;
  s.pounceTime = 0;
  s.vx = 0; s.vz = 0;
  s.pounceStage = 'recover';
  s.pounceStageTime = SMART_POUNCE_TUNE.recoverTime;
  s.intent = 'recover';
  return s;
}
export const RECOVER_LOCK = .6;
export function smartPounceDistance(initialSpeed = 0, speed = SMART_POUNCE.speed, acceleration = 18, duration = SMART_POUNCE.lockTime) {
  const tRamp = Math.min(duration, Math.max(0, (speed - initialSpeed) / acceleration));
  return initialSpeed * tRamp + .5 * acceleration * tRamp * tRamp + speed * (duration - tRamp);
}
export function updateSmartMemory(state, dt, now, options = {}) {
  const s = { ...state };
  const delay = options.memoryDelay ?? 10;
  if (now - (s.lastInterruptionAt ?? now) >= delay) s.memory = Math.max(0, (s.memory ?? 0) - (options.memoryDecay ?? .05) * Math.max(0, dt));
  return s;
}
export function habituateDecayRate(rate, repeats) { return repeats >= 12 ? rate * 2 : rate + .1 * Math.max(0, repeats); }
// Side defaults to +1 so a fresh fox has deterministic, slot-independent behavior.
export function trackFeint(state = {}, intent, opts = {}) {
  const next = { repeats: Math.max(0, state.repeats ?? 0), side: state.side ?? 1, prevIntent: state.prevIntent };
  if (opts.reset === 'pounce' || opts.reset === 'hit') return { repeats: 0, side: next.side, prevIntent: intent };
  if (intent === 'feint' && next.prevIntent !== 'feint') {
    const side = opts.side === 1 || opts.side === -1 ? opts.side : next.side;
    next.repeats = next.repeats > 0 && side === next.side ? next.repeats + 1 : 1;
    next.side = side;
  }
  next.prevIntent = intent;
  return next;
}
export function stepInterruptionTimes(times = [], now = 0, window = 15) { return times.filter((t) => now - t < window && now >= t); }
export function debounceIntent(prev, next, held = 0, dt = 0, options = {}) {
  if (['recover', 'abandon'].includes(next) || next === 'pounce') return { intent: next, held: 0 };
  if (prev === next) return { intent: prev, held: held + dt };
  if (held + dt < (options.hold ?? .25)) return { intent: prev, held: held + dt };
  return { intent: next, held: 0 };
}
export function createSmartPack() {
  return { lastCommitAt: -Infinity, commits: [], canCommit(slot, now, coordination = 1) {
    if (coordination <= 0) return true;
    this.commits = this.commits.filter((c) => now - c.at < 1.2);
    return this.commits.length < 2 && now - this.lastCommitAt >= .35 + ((slot % 3) * .025);
  }, recordCommit(slot, now) { this.commits.push({ slot, at: now }); this.lastCommitAt = now; } };
}
export function flankBias(self, peers, player, coordination = 0) {
  if (!coordination) return 0;
  const others = (peers || []).filter((p) => p !== self && !p.pounceCommitted);
  if (!others.length) return ((self.slot || 0) % 2 ? 1 : -1) * .35 * coordination;
  const side = others.reduce((sum, p) => sum + Math.sign((p.x-player.x)*(self.z-player.z)-(p.z-player.z)*(self.x-player.x)), 0);
  return (side > 0 ? -1 : 1) * .55 * coordination;
}
/**
 * 组装智能狐的运动目标点。提交扑击时可单独衰减战术偏移，
 * 使最终锁定点仍以玩家当前位置为准；非扑击意图保留包抄/分离行为。
 */
export function assembleSmartAim({ player, self, intent, separation = { x: 0, z: 0 }, flank = 0, offsetScale = 1, pounceOffsetScale = 1, observeRadius = 7.2 } = {}) {
  const p = player || { x: 0, z: 0 };
  const me = self || { x: 0, z: 0 };
  const dx = p.x - me.x, dz = p.z - me.z;
  const distance = Math.hypot(dx, dz) || 1;
  const toP = Math.atan2(dx, dz);
  const ux = -dx / distance, uz = -dz / distance;
  let x = p.x, z = p.z;
  if (intent === 'observe') { x += ux * observeRadius; z += uz * observeRadius; }
  const scale = intent === 'pounce' ? pounceOffsetScale : offsetScale;
  return {
    x: x + (separation.x + Math.cos(toP) * flank * 2) * scale,
    z: z + (separation.z - Math.sin(toP) * flank * 2) * scale,
    distance, toP,
  };
}

export function foxSeparation(self, peers, range = 1.8) {
  let x = 0, z = 0;
  for (const p of peers || []) { if (p === self) continue; const dx=self.x-p.x,dz=self.z-p.z,d=Math.hypot(dx,dz); if (d>0 && d<range) { x+=dx/d*(range-d); z+=dz/d*(range-d); } }
  return { x, z };
}


export const SMART_PHASES = ['observe', 'approach', 'wind', 'pounce', 'recover'];
export const SMART_PHASE_MIN = { observe: 0.35, approach: 0.35, wind: 0.55, pounce: 0.72, recover: 1.15 };
export const SMART_POUNCE_COOLDOWN = 1.2;


/** Beta-only approach/align/reposition controller for the pounce commit ring. */
export const SMART_POUNCE_APPROACH_PHASES = Object.freeze(['approach', 'align', 'backoff', 'commit']);
export function createSmartPounceApproachState() {
  return { phase: 'approach', phaseTime: 0, side: 1, missed: 0 };
}
export function advanceSmartPounceApproach(state = {}, input = {}, dt = 1 / 60, tune = {}) {
  const s = { ...createSmartPounceApproachState(), ...state };
  const step = Math.max(0, Number(dt) || 0);
  s.phaseTime += step;
  if (input.committed) { s.phase = 'commit'; return s; }
  if (input.recover || input.meleeActive || input.safe) { s.phase = 'approach'; s.phaseTime = 0; return s; }
  const min = Number(tune.smartPounceMinDistance) || SMART_POUNCE.minDistance;
  const max = Number(tune.smartPounceMaxDistance) || SMART_POUNCE.maxDistance;
  const d = Number(input.distance) || 0;
  const angle = Math.abs(Number(input.angle) || 0);
  const maxAngle = Number(input.maxAngle) || SMART_POUNCE.maxAngle;
  const ring = (min + max) * 0.5;
  const tolerance = Number(tune.smartPounceRingTolerance) || 0.28;
  // 状态语义（Beta 提交环）：
  // - approach：太远或环内未对正 → 朝玩家行进（朝向天然对正），由速度控制避免冲穿。
  // - backoff：太近 → 后退拉开，避免贴脸到无法形成提交角。
  // - align：环内且已对正 → 具备提交条件。
  // 关键修正：旧实现在「环内但未对正」时先进入 align 并冻结速度，
  // 而冻结时朝向又朝环上停靠点（而非玩家），于是角度永远收敛不了 → 永久 0 次提交。
  if (d > max + tolerance) { s.phase = 'approach'; s.phaseTime = 0; s.missed = 0; }
  else if (d < min - tolerance) { s.phase = 'backoff'; s.phaseTime = 0; s.missed += step; }
  else if (angle > maxAngle) { s.phase = 'approach'; s.missed = 0; }
  else { s.phase = 'align'; s.missed = 0; }
  s.ringRadius = ring;
  s.ready = s.phase === 'align' && d >= min && d <= max && angle <= maxAngle;
  return s;
}


export function sampleWalkableGround(samples, referenceY = null, layerTolerance = 0.28) {
  const values = (samples || []).filter(Number.isFinite);
  if (!values.length) return Number.isFinite(referenceY) ? referenceY : 0;
  let best = values;
  let bestCount = 0;
  let bestReferenceDistance = Infinity;
  for (const center of values) {
    const layer = values.filter((y) => Math.abs(y - center) <= layerTolerance);
    const sortedLayer = layer.slice().sort((a, b) => a - b);
    const mid = Math.floor(sortedLayer.length / 2);
    const median = sortedLayer.length % 2 ? sortedLayer[mid] : (sortedLayer[mid - 1] + sortedLayer[mid]) * 0.5;
    const refDistance = Number.isFinite(referenceY) ? Math.abs(median - referenceY) : 0;
    if (layer.length > bestCount || (layer.length === bestCount && refDistance < bestReferenceDistance)) {
      best = layer; bestCount = layer.length; bestReferenceDistance = refDistance;
    }
  }
  const sorted = best.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

export function stepGroundY(currentY, targetY, dt, maxRate = 3.2) {
  if (!Number.isFinite(targetY)) return currentY;
  if (!Number.isFinite(currentY)) return targetY;
  const maxStep = Math.max(0, maxRate * Math.max(0, dt));
  return currentY + Math.max(-maxStep, Math.min(maxStep, targetY - currentY));
}

export function advanceDrillState(state = {}, input = {}, dt = 1 / 60) {
  const s = { phase: 'approach', phaseTime: 0, cooldown: 0, ...state };
  const step = Math.max(0, Number(dt) || 0);
  s.phaseTime += step;
  s.cooldown = Math.max(0, (s.cooldown || 0) - step);
  const minDwell = { approach: 0.25, wind: input.windDuration ?? 0.55, pounce: 0.35, recover: 1.2 }[s.phase] ?? 0.25;
  const canLeave = s.phaseTime >= minDwell;
  const enter = (phase) => { s.phase = phase; s.phaseTime = 0; };
  if (s.phase === 'approach') {
    if (canLeave && input.inRange && input.reachable !== false && s.cooldown <= 0) enter('wind');
  } else if (s.phase === 'wind') {
    if (input.reachable === false) { if (canLeave) enter('approach'); }
    else if (canLeave) enter('pounce');
  } else if (s.phase === 'pounce') {
    if (input.pounceFinished) { enter('recover'); s.cooldown = Math.max(s.cooldown, 1.2); }
  } else if (s.phase === 'recover') {
    if (canLeave && s.cooldown <= 0) enter('approach');
  }
  return s;
}

/**
 * Hysteretic single-fox attack state machine.  Distances/reachability are sampled
 * once per frame, but transitions are admitted only after the current phase's
 * minimum dwell time.  A committed pounce always completes, then enters recover
 * and a cooldown, so an edge-of-threshold target cannot retrigger the warning.
 */
export function advanceSmartState(state = {}, input = {}, dt = 1 / 60) {
  const s = { phase: 'observe', phaseTime: 0, cooldown: 0, pounceTime: 0, ...state };
  const step = Math.max(0, Number(dt) || 0);
  s.phaseTime += step;
  s.cooldown = Math.max(0, (s.cooldown || 0) - step);
  const minTime = SMART_PHASE_MIN[s.phase] ?? 0.35;
  const reachable = input.reachable !== false;
  const candidate = !!input.candidatePounce;
  const safe = !!input.safe;
  const canLeave = s.phaseTime >= minTime;
  const enter = (phase) => { s.phase = phase; s.phaseTime = 0; };

  if (s.phase === 'pounce' && !input.motionCommitted) {
    s.pounceTime = Math.max(0, (s.pounceTime || SMART_PHASE_MIN.pounce) - step);
    if (s.pounceTime <= 0) { enter('recover'); s.cooldown = Math.max(s.cooldown, SMART_POUNCE_COOLDOWN); }
  } else if (safe && s.phase !== 'recover') {
    enter('recover');
  } else if (s.phase === 'wind') {
    if (!reachable && canLeave) enter('approach');
    else if (reachable && canLeave) { enter('pounce'); s.pounceTime = SMART_PHASE_MIN.pounce; }
  } else if (s.phase === 'recover') {
    if (canLeave && s.cooldown <= 0) enter(candidate ? 'wind' : 'approach');
  } else if (s.phase === 'observe' || s.phase === 'approach') {
    if (candidate && reachable && s.cooldown <= 0 && canLeave) enter('wind');
    else if (!candidate && s.phase === 'observe' && canLeave) enter('approach');
    else if (candidate && !reachable && s.phase === 'observe' && canLeave) enter('approach');
  }
  s.intent = s.phase === 'wind' ? 'observe' : s.phase;
  s.warn = s.phase === 'wind';
  return s;
}

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function separationVector(position, neighbors = [], minDistance = 1.8, strength = 2.4) {
  let x = 0, z = 0;
  for (const n of neighbors || []) {
    const dx = position.x - n.x, dz = position.z - n.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-5 || d >= minDistance) continue;
    const w = (minDistance - d) / minDistance;
    x += (dx / d) * w; z += (dz / d) * w;
  }
  const len = Math.hypot(x, z);
  if (!len) return { x: 0, z: 0 };
  const scale = Math.min(strength, len * strength);
  return { x: x / len * scale, z: z / len * scale };
}

export function isSegmentReachable(start, target, obstacles = [], clearance = 0.8) {
  const ax = start.x, az = start.z, bx = target.x, bz = target.z;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  for (const o of obstacles || []) {
    const r = Math.max(0, Number(o.r) || 0) + clearance;
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / len2)) : 0;
    const px = ax + dx * t - o.x, pz = az + dz * t - o.z;
    if (px * px + pz * pz < r * r) return false;
  }
  return true;
}

const wrapAngle = (a) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

export function utilityScores(input = {}) {
  const beta = input.betaOn === true;
  const weights = beta ? { ...SMART_WEIGHTS, approachSuspicion: input.approachSuspicionWeight ?? 0.10, pounceSuspicion: input.pounceSuspicionWeight ?? 0.36, pounceBase: input.pounceBaseWeight ?? 0.14, pounceDistance: input.pounceDistanceWeight ?? 0.50, pounceMemory: input.pounceMemoryPenalty ?? 0.18, pounceInterruptions: input.pounceInterruptionPenalty ?? 0.16, pounceFatigue: input.pounceFatiguePenalty ?? 0.12 } : SMART_WEIGHTS;
  const distance = Number.isFinite(input.distance) ? input.distance : 20;
  const d = clamp(1 - distance / 24);
  const facing = clamp((Number.isFinite(input.playerFacing) ? input.playerFacing : 0.5));
  const guard = clamp(input.guard ? 1 : 0);
  const fatigue = clamp(input.fatigue ?? 0);
  const health = clamp(input.health ?? 1);
  const interruptions = clamp((input.interruptions ?? 0) / 3);
  const memory = clamp((input.memory ?? 0) / 3);
  const suspicion = clamp(input.suspicion ?? 0);
  const scores = {
    observe: weights.observeBase + (1 - suspicion) * weights.observeUnaware + (1 - d) * weights.observeDistance,
    approach: weights.approachBase + d * weights.approachDistance + suspicion * weights.approachSuspicion + (1 - guard) * weights.approachUnguarded,
    feint: weights.feintBase + guard * weights.feintGuard + memory * weights.feintMemory + interruptions * weights.feintInterruptions,
    pounce: weights.pounceBase + d * weights.pounceDistance + suspicion * weights.pounceSuspicion + (1 - guard) * weights.pounceUnguarded
      - memory * weights.pounceMemory - interruptions * weights.pounceInterruptions - fatigue * weights.pounceFatigue,
    recover: weights.recoverBase + fatigue * weights.recoverFatigue + (1 - health) * weights.recoverHealth + interruptions * weights.recoverInterruptions,
    abandon: weights.abandonBase + (1 - health) * weights.abandonHealth + fatigue * weights.abandonFatigue + (distance < 4 ? weights.abandonClose : 0),
  };
  scores.feint *= input.feintScale ?? 1;
  for (const key of SMART_INTENTS) scores[key] = Number(scores[key].toFixed(6));
  const topIntent = SMART_INTENTS.slice().sort((a, b) => scores[b] - scores[a])[0];
  return { scores, topIntent };
}

export function updatePerception(state, input = {}, dt = 1 / 60) {
  const next = { ...state };
  const distance = Number.isFinite(input.distance) ? input.distance : 99;
  const viewDot = Number.isFinite(input.viewDot) ? input.viewDot : -1;
  const inCone = distance <= (input.viewRange ?? 28) && viewDot >= Math.cos(Math.PI / 3);
  const postureFactor = input.guard ? 0.72 : (input.running ? 1.0 : 0.86);
  const distanceFactor = clamp(1 - distance / (input.viewRange ?? 28));
  const signal = inCone ? postureFactor * (0.35 + distanceFactor * 0.65) : 0;
  const rise = input.detectionRate ?? 1.8;
  const decay = input.decayRate ?? 0.48;
  next.suspicion = clamp((next.suspicion ?? 0) + (signal * rise - decay) * dt);
  next.lastSeen = inCone && signal > 0 ? (next.lastSeen ?? 0) + dt : next.lastSeen ?? 0;
  next.inCone = inCone;
  return next;
}

export function applyInterruption(memory, kind = 'parry') {
  const next = { ...memory };
  if (kind === 'damage') {
    next.health = clamp((next.health ?? 1) - 0.35);
    next.interruptions = (next.interruptions ?? 0) + 1;
    next.memory = clamp((next.memory ?? 0) + 1, 0, 3);
  } else {
    next.interruptions = (next.interruptions ?? 0) + 1;
    next.memory = clamp((next.memory ?? 0) + 1, 0, 3);
  }
  return next;
}

export function stepSmartMotion(state, target, dt = 1 / 60, intent = state.intent || 'observe', options = {}) {
  const s = { ...state };
  s.pounceJustEnded = false;
  const dx = target.x - s.x, dz = target.z - s.z;
  const distance = Math.hypot(dx, dz) || 1;
  const navDesired = Math.atan2(dx, dz);
  // Navigation may be steered around obstacles and expanded to a long direction
  // vector. Commit geometry must instead use the real player and the separately
  // supplied, frame-locked lead point.
  const commitTarget = options.commitTarget || target;
  const distanceTarget = options.commitDistanceTarget || commitTarget;
  const commitDx = commitTarget.x - s.x, commitDz = commitTarget.z - s.z;
  const commitDesired = Math.atan2(commitDx, commitDz);
  const commitDistance = Math.hypot(distanceTarget.x - s.x, distanceTarget.z - s.z) || 1;
  if (s.pounceCooldown > 0) s.pounceCooldown = Math.max(0, s.pounceCooldown - dt);
  const angle = Math.abs(wrapAngle(commitDesired - s.yaw));
  const pounceReady = commitDistance >= (s.pounceMinDistance ?? SMART_POUNCE.minDistance)
    && commitDistance <= (s.pounceMaxDistance ?? SMART_POUNCE.maxDistance)
    && angle <= (s.pounceMaxAngle ?? SMART_POUNCE.maxAngle);
  if (intent === 'pounce' && pounceReady && !s.pounceCommitted && (s.pounceCooldown ?? 0) <= 0
    && (s.windupRemaining ?? 0) <= 0 && options.commitAllowed !== false) {
    // 阶段 4：进入两阶段扑咬的"冲刺阶段"（dashStage）——时长固定、速度略快、预警线由调用方显示。
    s.pounceCommitted = true;
    s.pounceStage = 'dash';
    s.pounceStageTime = s.pounceDashDuration ?? SMART_POUNCE_TUNE.dashDuration;
    s.pounceDashSpeed = (s.pounceSpeed ?? SMART_POUNCE.speed) * (s.pounceDashSpeedMul ?? SMART_POUNCE_TUNE.dashSpeedMul);
    // pounceTime 保留为"整个扑咬（冲刺+前摇+扑击）"的总倒计时，供旧调用方/冷却参考。
    const strikeTime = s.pounceStrikeTime ?? SMART_POUNCE_TUNE.strikeTime;
    s.pounceTime = s.pounceStageTime + SMART_POUNCE_TUNE.windupTime + strikeTime;
    s.pounceYaw = commitDesired;
    s.pounceTargetX = commitTarget.x;
    s.pounceTargetZ = commitTarget.z;
    s.pounceStartSpeed = Math.hypot(s.vx || 0, s.vz || 0);
    s.pounceStriking = false;
  }
  if (intent === 'pounce' && pounceReady && !s.pounceCommitted && (s.pounceCooldown ?? 0) <= 0) {
    s.windupRemaining = Math.max(0, (s.windupRemaining ?? s.pounceWindup ?? SMART_POUNCE.windup) - dt);
  } else if (!s.pounceCommitted) {
    // 前摇计时只在意图离开 pounce 时重置。
    // 旧实现是「一旦本帧未就绪就立刻重置为满值」，导致智能狐在进环过程中
    // 反复把 windup 拉回 0.22s，提交条件 (windupRemaining <= 0) 永远无法满足
    // → 实测 0 次扑击提交。只要还在扑击意图中，就保留已累积的前摇进度。
    if (intent !== 'pounce') s.windupRemaining = s.pounceWindup ?? SMART_POUNCE.windup;
    else if (s.windupRemaining == null) s.windupRemaining = s.pounceWindup ?? SMART_POUNCE.windup;
  }
  const committed = s.pounceCommitted === true;
  const aim = committed ? s.pounceYaw : navDesired;
  // 动作集对齐（阶段 4）：慢行=stalk、冲刺=sprint 的速度语义可由调用方按 FOX.ACTIONS 传入。
  const stalkSpeed = options.stalkSpeed ?? 2.4;
  const sprintSpeed = options.sprintSpeed ?? 6.5;
  const recoverSpeed = options.recoverSpeed ?? 4.8;
  const accel = options.locomotionAcceleration ?? s.acceleration ?? 18;
  const speed = Math.hypot(s.vx ?? 0, s.vz ?? 0);
  const strikeSpeed = s.pounceStrikeSpeed ?? SMART_POUNCE_TUNE.strikeSpeed;
  const strikeTime = s.pounceStrikeTime ?? SMART_POUNCE_TUNE.strikeTime;
  const endPounce = () => {
    // 扑击段结束 → 后摇硬直（recover）：不可移动/攻击/再扑，给玩家反击窗口。
    s.pounceCommitted = false;
    s.pounceStriking = false;
    s.pounceStage = 'recover';
    s.pounceStageTime = SMART_POUNCE_TUNE.recoverTime;
    s.pounceCooldown = s.pounceCooldownDuration ?? .8;
    s.intent = 'recover';
    s.pounceJustEnded = true;
    s.vx = 0; s.vz = 0; s.speed = 0;
  };
  if (committed) {
    s.yaw = aim; // 全程锁定提交时的朝向（不可取消语义不变）
    if (s.pounceStage === 'dash') {
      // 冲刺阶段：固定时长，速度 = 扑击基准 × dashSpeedMul（略快于普通冲刺）
      const nextSpeed = speed + Math.max(-accel * dt, Math.min(accel * dt, (s.pounceDashSpeed ?? SMART_POUNCE.speed) - speed));
      s.vx = Math.sin(s.yaw) * nextSpeed; s.vz = Math.cos(s.yaw) * nextSpeed;
      s.x += s.vx * dt; s.z += s.vz * dt; s.speed = nextSpeed;
      s.pounceStageTime -= dt;
      if (s.pounceStageTime <= 0) {
        // 冲刺阶段固定时长结束 → 极短前摇。扑咬一旦提交不可取消（语义同 589d31b），
        // 冲刺阶段本就朝玩家冲刺（提交距离 3~7m、冲刺位移 ~5m），结束时必然够近。
        s.pounceStage = 'windup';
        s.pounceStageTime = SMART_POUNCE_TUNE.windupTime;
        s.vx = 0; s.vz = 0; s.speed = 0;
      }
    } else if (s.pounceStage === 'windup') {
      // 扑咬前摇：极短，原地不动
      s.pounceStageTime -= dt;
      if (s.pounceStageTime <= 0) {
        s.pounceStage = 'strike';
        s.pounceStageTime = strikeTime;
        s.pounceStriking = true;
        s.pounceStrikeStarted = true; // 供调用方扣一次性体力
      }
    } else {
      // 扑咬 strike：真实位移（不是瞬移），只扑近地，激活帧内由调用方做水平命中判定
      s.pounceStage = 'strike';
      s.pounceStriking = true;
      s.vx = Math.sin(s.yaw) * strikeSpeed; s.vz = Math.cos(s.yaw) * strikeSpeed;
      s.x += s.vx * dt; s.z += s.vz * dt; s.speed = strikeSpeed;
      s.pounceStageTime -= dt;
      if (s.pounceStageTime <= 0) endPounce();
    }
    if (s.pounceCommitted) s.pounceTime -= dt;
  } else if (s.pounceStage === 'recover' && (s.pounceStageTime ?? 0) > 0) {
    // 后摇硬直：不能移动/攻击/再扑
    s.vx = 0; s.vz = 0; s.speed = 0;
    s.pounceStageTime -= dt;
    if (s.pounceStageTime <= 0) s.pounceStage = null;
    s.intent = 'recover';
  } else {
    const speedTarget = Number.isFinite(options.speedTarget) ? Math.max(0, options.speedTarget) : ((options.locomotionIntent ?? intent) === 'observe' ? stalkSpeed : (options.locomotionIntent ?? intent) === 'recover' ? recoverSpeed : sprintSpeed);
    const moved = stepFoxLocomotion({ ...s, turnVelocity: s.turnVelocity || 0 }, { x: s.x + Math.sin(aim) * 100, z: s.z + Math.cos(aim) * 100 }, dt,
      { speed: speedTarget, acceleration: accel, maxTurnSlow: s.maxTurnRate ?? 2.8 });
    Object.assign(s, moved);
  }
  if (s.pounceCommitted) s.intent = 'pounce'; else if (s.intent !== 'recover') s.intent = intent;
  if (s.pounceStage !== 'strike') s.pounceStriking = false;
  return s;
}

// —— 阶段 3：战术层（包抄站位 / 角色分工 / 受伤即撤）——

/**
 * 给 N 只狐分配绕行站位槽位（相对玩家逃跑轴）。
 * 槽位以"逃跑轴正后方(180°)"为基准向两侧对称展开（步长 60°），
 * 即 3 只狐 → 180° / 120° / 240°，全部落在逃跑轴的后半球，绝不挤在玩家正面。
 * 返回 [{ index, angle, x, z }]，angle 采用项目统一的 atan2(dx, dz) 偏航约定。
 */
export function flankSlots(count, escapeAxis, player, radius = 6) {
  const n = Math.max(0, Math.floor(count));
  if (!n || !player) return [];
  const mid = (n - 1) / 2;
  const step = n > 1 ? Math.PI / 3 : 0;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const angle = escapeAxis + Math.PI + (i - mid) * step;
    slots.push({
      index: i, angle,
      x: player.x + Math.sin(angle) * radius,
      z: player.z + Math.cos(angle) * radius,
    });
  }
  return slots;
}

/**
 * 这只狐应该去哪个槽位：在未被同伴占用的槽位里挑离自己最近的，
 * 并对自己上一轮占过的槽位给粘性偏置（避免槽位间来回跳）。
 * 同伴通过各自的 `flankSlotIndex` 字段声明占用；没有可用槽位返回 null（退回直追，不崩）。
 */
export function assignFlankSlot(self, peers, slots) {
  if (!slots || !slots.length) return null;
  const claimed = new Set();
  for (const p of peers || []) {
    if (p === self) continue;
    const idx = p.flankSlotIndex;
    if (Number.isInteger(idx) && idx >= 0 && idx < slots.length) claimed.add(idx);
  }
  let best = null;
  let bestScore = Infinity;
  for (const s of slots) {
    if (claimed.has(s.index)) continue;
    const d = Math.hypot(s.x - self.x, s.z - self.z);
    const score = s.index === self.flankSlotIndex ? d - 1.5 : d;
    if (score < bestScore) { bestScore = score; best = s.index; }
  }
  return best;
}

/**
 * 角色派发：返回 { slot: { role, since } }。
 *  - retreat    ：已残血 / 撤退中 / 休息中 / 死亡
 *  - striker    ：距玩家近且血量体力最足者，独占扑咬提交权
 *  - flanker / distractor ：其余交替（包抄 / 正面牵制），不提交扑咬
 * 粘性：`prev` 中未过 `holdTime` 的角色优先保留，避免每帧乱跳。
 */
export const SMART_TEAM_TUNE = Object.freeze({
  minFoxesForMultiAttackers: 3,
  maxAttackers: 2,
  restHpRatio: 0.42,
  restStaminaRatio: 0.2,
  restFatigue: 0.86,
  healthyHpRatio: 0.62,
  healthyStaminaRatio: 0.35,
  holdTime: 1.5,
  switchCooldown: 1.2,
  interceptorRadius: 7.5,
});

const finiteRatio = (value, fallback = 1) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;

/**
 * Deterministic pack roles. The legacy path remains one striker plus flanker /
 * distractor. Beta enables a bounded attacker budget: healthy foxes get the
 * striker/flanker slots, while exhausted or surplus foxes rest or intercept.
 */
export function assignRoles(foxes, player, prev = {}, now = 0, options = {}) {
  const hold = Math.max(0, Number(options.holdTime ?? (options.betaTeam ? SMART_TEAM_TUNE.holdTime : 1.5)) || 0);
  const cooldown = Math.max(0, Number(options.switchCooldown ?? (options.betaTeam ? SMART_TEAM_TUNE.switchCooldown : 0)) || 0);
  const betaTeam = options.betaTeam === true;
  const out = {};
  const eligible = [];
  for (const f of foxes || []) {
    if (!f) continue;
    const slot = f.slot ?? 0;
    const pe = prev[slot];
    const hpRatio = finiteRatio(f.maxHp ? f.hp / f.maxHp : 1);
    const staminaRatio = finiteRatio(f.maxStamina ? f.stamina / f.maxStamina : 1);
    const fatigue = finiteRatio(f.fatigue, 0);
    const hardRetreat = hpRatio < (options.retreatHpRatio ?? 0.45)
      || f.retreating || f.state === 'rest_safe' || f.state === 'dead' || (f.hp ?? 1) <= 0;
    const needsRest = betaTeam && !hardRetreat && (hpRatio <= (options.restHpRatio ?? SMART_TEAM_TUNE.restHpRatio)
      || staminaRatio <= (options.restStaminaRatio ?? SMART_TEAM_TUNE.restStaminaRatio)
      || fatigue >= (options.restFatigue ?? SMART_TEAM_TUNE.restFatigue)
      || f.state === 'rest');
    if (hardRetreat) {
      out[slot] = { role: 'retreat', since: pe?.role === 'retreat' ? pe.since : now };
    } else if (needsRest) {
      out[slot] = { role: 'rest', since: pe?.role === 'rest' ? pe.since : now };
    } else {
      eligible.push(f);
    }
  }
  if (!eligible.length) return out;

  const scored = eligible.map((f) => {
    const d = Math.hypot((f.x ?? 0) - (player?.x ?? 0), (f.z ?? 0) - (player?.z ?? 0));
    const hpRatio = finiteRatio(f.maxHp ? f.hp / f.maxHp : 1);
    const staminaRatio = finiteRatio(f.maxStamina ? f.stamina / f.maxStamina : 1);
    const fatigue = finiteRatio(f.fatigue, 0);
    // Lower is better: nearby, healthy, rested foxes lead the pack.
    const score = d - hpRatio * 4 - staminaRatio * 2 - (1 - fatigue) * 1.5;
    return { f, score };
  }).sort((a, b) => a.score - b.score || ((a.f.slot ?? 0) - (b.f.slot ?? 0)));

  const attackerBudget = betaTeam
    ? Math.min(Math.max(1, Number(options.maxAttackers ?? SMART_TEAM_TUNE.maxAttackers) || 1),
      eligible.length >= (options.minFoxesForMultiAttackers ?? SMART_TEAM_TUNE.minFoxesForMultiAttackers) ? 2 : 1)
    : 1;
  const healthy = betaTeam ? scored.filter(({ f }) => {
    const hp = finiteRatio(f.maxHp ? f.hp / f.maxHp : 1);
    const stamina = finiteRatio(f.maxStamina ? f.stamina / f.maxStamina : 1);
    const fatigue = finiteRatio(f.fatigue, 0);
    return hp >= (options.healthyHpRatio ?? SMART_TEAM_TUNE.healthyHpRatio)
      && stamina >= (options.healthyStaminaRatio ?? SMART_TEAM_TUNE.healthyStaminaRatio)
      && fatigue <= (options.healthyFatigue ?? 0.72);
  }) : scored;
  // If enough healthy foxes exist, only that pool may take attack slots. If
  // the pack is universally depleted, the deterministic full pool still gives
  // it one available attacker rather than deadlocking the encounter.
  const ranked = healthy.length >= attackerBudget ? healthy : scored;
  const selected = [];
  const held = ranked.filter(({ f }) => {
    const pe = prev[f.slot ?? 0];
    return pe && (pe.role === 'striker' || (betaTeam && pe.role === 'flanker'))
      && now - pe.since < hold + cooldown;
  }).sort((a, b) => ((prev[a.f.slot ?? 0]?.since ?? 0) - (prev[b.f.slot ?? 0]?.since ?? 0)) || (a.f.slot - b.f.slot));
  for (const entry of held) {
    if (selected.length >= attackerBudget) break;
    selected.push(entry.f);
  }
  for (const { f } of ranked) {
    if (selected.length >= attackerBudget || selected.includes(f)) continue;
    selected.push(f);
  }

  if (!betaTeam) {
    const striker = selected[0];
    const strikerSlot = striker.slot ?? 0;
    out[strikerSlot] = { role: 'striker', since: prev[strikerSlot]?.role === 'striker' ? prev[strikerSlot].since : now };
    eligible.filter((f) => f !== striker)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .forEach((f, i) => {
        const slot = f.slot ?? 0;
        const pe = prev[slot];
        let role = i % 2 === 0 ? 'flanker' : 'distractor';
        if ((pe?.role === 'flanker' || pe?.role === 'distractor') && now - pe.since < hold) role = pe.role;
        out[slot] = { role, since: pe?.role === role ? pe.since : now };
      });
    return out;
  }

  selected.forEach((f, index) => {
    const slot = f.slot ?? 0;
    const previous = prev[slot];
    const role = index === 0 ? 'striker' : 'flanker';
    out[slot] = { role, since: previous?.role === role ? previous.since : now };
  });
  eligible.filter((f) => !selected.includes(f))
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
    .forEach((f, index) => {
      const slot = f.slot ?? 0;
      const previous = prev[slot];
      // Interceptors get a stable blocking assignment; they do not enter the
      // pounce commit ring and remain visibly represented in telemetry.
      const role = 'interceptor';
      out[slot] = { role, since: previous?.role === role ? previous.since : now, index };
    });
  return out;
}

/** Stable blocking point ahead of the marmot's escape direction. */
export function teamInterceptPoint(player = {}, fox = {}, escapeVelocity = { x: 0, z: 0 }, index = 0, radius = SMART_TEAM_TUNE.interceptorRadius) {
  const vx = Number(escapeVelocity.x) || 0, vz = Number(escapeVelocity.z) || 0;
  const speed = Math.hypot(vx, vz);
  const axis = speed > 0.5 ? Math.atan2(vx, vz) : Math.atan2((fox.x ?? 0) - (player.x ?? 0), (fox.z ?? 0) - (player.z ?? 0));
  const side = (index % 2 ? -1 : 1) * Math.PI / 5;
  const angle = axis + side;
  return { x: (player.x ?? 0) + Math.sin(angle) * radius, z: (player.z ?? 0) + Math.cos(angle) * radius, angle, radius };
}

/**
 * 刚被打过 → 强撤退倾向（硬规则，覆盖 utility 打分，不改 SMART_WEIGHTS）。
 * state: { lastHitAt }；options: { now, window }（window 内受过击即 true）。
 */
export function forcedRetreat(state = {}, options = {}) {
  const now = options.now ?? 0;
  const window = options.window ?? 0.6;
  if (!Number.isFinite(state.lastHitAt)) return false;
  return now - state.lastHitAt <= window;
}
