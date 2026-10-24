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
export function foxSeparation(self, peers, range = 1.8) {
  let x = 0, z = 0;
  for (const p of peers || []) { if (p === self) continue; const dx=self.x-p.x,dz=self.z-p.z,d=Math.hypot(dx,dz); if (d>0 && d<range) { x+=dx/d*(range-d); z+=dz/d*(range-d); } }
  return { x, z };
}

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

export function utilityScores(input = {}) {
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
    observe: SMART_WEIGHTS.observeBase + (1 - suspicion) * SMART_WEIGHTS.observeUnaware + (1 - d) * SMART_WEIGHTS.observeDistance,
    approach: SMART_WEIGHTS.approachBase + d * SMART_WEIGHTS.approachDistance + suspicion * SMART_WEIGHTS.approachSuspicion + (1 - guard) * SMART_WEIGHTS.approachUnguarded,
    feint: SMART_WEIGHTS.feintBase + guard * SMART_WEIGHTS.feintGuard + memory * SMART_WEIGHTS.feintMemory + interruptions * SMART_WEIGHTS.feintInterruptions,
    pounce: SMART_WEIGHTS.pounceBase + d * SMART_WEIGHTS.pounceDistance + suspicion * SMART_WEIGHTS.pounceSuspicion + (1 - guard) * SMART_WEIGHTS.pounceUnguarded
      - memory * SMART_WEIGHTS.pounceMemory - interruptions * SMART_WEIGHTS.pounceInterruptions - fatigue * SMART_WEIGHTS.pounceFatigue,
    recover: SMART_WEIGHTS.recoverBase + fatigue * SMART_WEIGHTS.recoverFatigue + (1 - health) * SMART_WEIGHTS.recoverHealth + interruptions * SMART_WEIGHTS.recoverInterruptions,
    abandon: SMART_WEIGHTS.abandonBase + (1 - health) * SMART_WEIGHTS.abandonHealth + fatigue * SMART_WEIGHTS.abandonFatigue + (distance < 4 ? SMART_WEIGHTS.abandonClose : 0),
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
  const desired = Math.atan2(dx, dz);
  if (s.pounceCooldown > 0) s.pounceCooldown = Math.max(0, s.pounceCooldown - dt);
  const angle = Math.abs(wrapAngle(desired - s.yaw));
  const pounceReady = distance >= (s.pounceMinDistance ?? SMART_POUNCE.minDistance)
    && distance <= (s.pounceMaxDistance ?? SMART_POUNCE.maxDistance)
    && angle <= (s.pounceMaxAngle ?? SMART_POUNCE.maxAngle);
  if (intent === 'pounce' && pounceReady && !s.pounceCommitted && (s.pounceCooldown ?? 0) <= 0
    && (s.windupRemaining ?? 0) <= 0 && options.commitAllowed !== false) {
    // 阶段 4：进入两阶段扑咬的"冲刺阶段"（dashStage）——时长固定、速度略快、预警线由调用方显示。
    s.pounceCommitted = true;
    s.pounceStage = 'dash';
    s.pounceStageTime = s.pounceDashDuration ?? SMART_POUNCE_TUNE.dashDuration;
    s.pounceDashSpeed = (s.pounceSpeed ?? SMART_POUNCE.speed) * (s.pounceDashSpeedMul ?? SMART_POUNCE_TUNE.dashSpeedMul);
    // pounceTime 保留为"整个扑咬（冲刺+前摇+扑击）"的总倒计时，供旧调用方/冷却参考。
    s.pounceTime = s.pounceStageTime + SMART_POUNCE_TUNE.windupTime + SMART_POUNCE_TUNE.strikeTime;
    s.pounceYaw = s.yaw;
    s.pounceStartSpeed = Math.hypot(s.vx || 0, s.vz || 0);
    s.pounceStriking = false;
  }
  if (intent === 'pounce' && pounceReady && !s.pounceCommitted && (s.pounceCooldown ?? 0) <= 0) {
    s.windupRemaining = Math.max(0, (s.windupRemaining ?? s.pounceWindup ?? SMART_POUNCE.windup) - dt);
  } else if (!s.pounceCommitted) s.windupRemaining = s.pounceWindup ?? SMART_POUNCE.windup;
  const committed = s.pounceCommitted === true;
  const aim = committed ? s.pounceYaw : desired;
  // 动作集对齐（阶段 4）：慢行=stalk、冲刺=sprint 的速度语义可由调用方按 FOX.ACTIONS 传入。
  const stalkSpeed = options.stalkSpeed ?? 2.4;
  const sprintSpeed = options.sprintSpeed ?? 6.5;
  const recoverSpeed = options.recoverSpeed ?? 4.8;
  const accel = s.acceleration ?? 18;
  const speed = Math.hypot(s.vx ?? 0, s.vz ?? 0);
  const strikeSpeed = s.pounceStrikeSpeed ?? SMART_POUNCE_TUNE.strikeSpeed;
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
        s.pounceStageTime = SMART_POUNCE_TUNE.strikeTime;
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
    const speedTarget = intent === 'observe' ? stalkSpeed : intent === 'recover' ? recoverSpeed : sprintSpeed;
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
export function assignRoles(foxes, player, prev = {}, now = 0, options = {}) {
  const hold = options.holdTime ?? 1.5;
  const out = {};
  const eligible = [];
  for (const f of foxes || []) {
    if (!f) continue;
    const slot = f.slot ?? 0;
    const pe = prev[slot];
    const hpRatio = f.maxHp ? f.hp / f.maxHp : 1;
    const injured = hpRatio < (options.retreatHpRatio ?? 0.45)
      || f.retreating || f.state === 'rest_safe' || f.state === 'dead' || (f.hp ?? 1) <= 0;
    if (injured) {
      out[slot] = { role: 'retreat', since: pe?.role === 'retreat' ? pe.since : now };
    } else eligible.push(f);
  }
  if (!eligible.length) return out;
  const scored = eligible.map((f) => {
    const d = Math.hypot(f.x - player.x, f.z - player.z);
    const hpRatio = f.maxHp ? f.hp / f.maxHp : 1;
    const staminaRatio = f.maxStamina ? f.stamina / f.maxStamina : 1;
    return { f, score: d - hpRatio * 2 - staminaRatio * 2 };
  }).sort((a, b) => a.score - b.score || ((a.f.slot ?? 0) - (b.f.slot ?? 0)));
  let striker = scored[0].f;
  for (const { f } of scored) {
    const pe = prev[f.slot ?? 0];
    if (pe?.role === 'striker' && now - pe.since < hold) { striker = f; break; }
  }
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
