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
    s.pounceCommitted = true;
    s.pounceTime = s.pounceLockTime ?? SMART_POUNCE.lockTime;
    s.pounceYaw = s.yaw;
    s.pounceStartSpeed = Math.hypot(s.vx || 0, s.vz || 0);
  }
  if (intent === 'pounce' && pounceReady && !s.pounceCommitted && (s.pounceCooldown ?? 0) <= 0) {
    s.windupRemaining = Math.max(0, (s.windupRemaining ?? s.pounceWindup ?? SMART_POUNCE.windup) - dt);
  } else if (!s.pounceCommitted) s.windupRemaining = s.pounceWindup ?? SMART_POUNCE.windup;
  const committed = s.pounceCommitted === true;
  const aim = committed ? s.pounceYaw : desired;
  const speedTarget = committed ? (s.pounceSpeed ?? SMART_POUNCE.speed) : intent === 'observe' ? 2.4 : intent === 'recover' ? 4.8 : 6.5;
  const accel = s.acceleration ?? 18;
  const speed = Math.hypot(s.vx ?? 0, s.vz ?? 0);
  if (committed) {
    s.yaw = aim; const nextSpeed = speed + Math.max(-accel * dt, Math.min(accel * dt, speedTarget - speed));
    s.vx = Math.sin(s.yaw) * nextSpeed; s.vz = Math.cos(s.yaw) * nextSpeed;
    s.x += s.vx * dt; s.z += s.vz * dt; s.speed = nextSpeed;
  } else {
    const moved = stepFoxLocomotion({ ...s, turnVelocity: s.turnVelocity || 0 }, { x: s.x + Math.sin(aim) * 100, z: s.z + Math.cos(aim) * 100 }, dt,
      { speed: speedTarget, acceleration: accel, maxTurnSlow: s.maxTurnRate ?? 2.8 });
    Object.assign(s, moved);
  }
  if (committed) {
    s.pounceTime -= dt;
    if (s.pounceTime <= 0) { s.pounceCommitted = false; s.pounceCooldown = s.pounceCooldownDuration ?? .8; s.intent = 'recover'; s.pounceJustEnded = true; }
  }
  if (s.pounceCommitted) s.intent = 'pounce'; else if (s.intent !== 'recover') s.intent = intent;
  return s;
}
