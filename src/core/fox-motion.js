import { FOX } from './config.js';

export function foxRecoverySeconds(type, mode) {
  if (mode === 'leap') return FOX.recovery.leap;
  if (mode === 'combo') return FOX.recovery.combo;
  return type === 'fast' ? FOX.recovery.fast : FOX.recovery.normal;
}

/** Bounded angular acceleration; returns the new heading and angular velocity. */
export function stepFoxTurn(yaw, targetYaw, turnVelocity, dt, maxRate, acceleration) {
  let delta = targetYaw - yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (dt <= 0 || Math.abs(delta) < 1e-7) return { yaw: yaw + delta, turnVelocity: 0 };
  const wanted = Math.sign(delta) * Math.min(maxRate, Math.abs(delta) / dt);
  const maxChange = acceleration * dt;
  const nextVelocity = turnVelocity + Math.max(-maxChange, Math.min(maxChange, wanted - turnVelocity));
  const step = Math.max(-Math.abs(delta), Math.min(Math.abs(delta), nextVelocity * dt));
  const reached = Math.sign(step) === Math.sign(delta) && Math.abs(step) >= Math.abs(delta) - 1e-7;
  return { yaw: yaw + step, turnVelocity: reached ? 0 : nextVelocity };
}

/** Shared non-attack locomotion: bounded acceleration and speed-dependent arc steering. */
export function foxMaxTurnRate(speed, options = {}) {
  return Math.max(options.minTurnRate ?? FOX.handling.minTurnRate,
    (options.maxTurnSlow ?? FOX.handling.maxTurnSlow) /
      (1 + (options.turnSpeedK ?? FOX.handling.turnSpeedK) * Math.max(0, speed)));
}
export function stepFoxLocomotion(state, target, dt, options = {}) {
  const speedTarget = Math.max(0, options.speed ?? 0);
  const accel = options.acceleration ?? 14;
  const speed = Math.hypot(state.vx || 0, state.vz || 0);
  const nextSpeed = speed + Math.max(-accel * dt, Math.min(accel * dt, speedTarget - speed));
  const targetYaw = Math.atan2(target.x - state.x, target.z - state.z);
  const maxRate = foxMaxTurnRate(speed, options);
  const turn = stepFoxTurn(state.yaw, targetYaw, state.turnVelocity || 0, dt,
    maxRate,
    options.turnAcceleration ?? FOX.handling.locomotionTurnAccel);
  return { x: state.x + Math.sin(turn.yaw) * nextSpeed * dt,
    z: state.z + Math.cos(turn.yaw) * nextSpeed * dt,
    yaw: turn.yaw, turnVelocity: turn.turnVelocity,
    vx: Math.sin(turn.yaw) * nextSpeed, vz: Math.cos(turn.yaw) * nextSpeed, speed: nextSpeed };
}

/** Pure local-navigation direction used by normal and smart foxes. */
export function steerGroundDirection(wantX, wantZ, speed, position, obstacles = [], bounds = { hw: Infinity, hh: Infinity }, slot = 0, yaw = 0) {
  const wantedLen = Math.hypot(wantX, wantZ);
  if (wantedLen < 1e-5 || speed <= 0) return null;
  let vx = wantX / wantedLen, vz = wantZ / wantedLen;
  const margin = Math.min(7, bounds.hw * .16, bounds.hh * .16);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  if (position.x < -bounds.hw + margin) vx += (1 - clamp01((position.x + bounds.hw) / margin)) * 1.5;
  if (position.x > bounds.hw - margin) vx -= (1 - clamp01((bounds.hw - position.x) / margin)) * 1.5;
  if (position.z < -bounds.hh + margin) vz += (1 - clamp01((position.z + bounds.hh) / margin)) * 1.5;
  if (position.z > bounds.hh - margin) vz -= (1 - clamp01((bounds.hh - position.z) / margin)) * 1.5;
  const clearance = Math.max(1.2, speed * .45);
  obstacles.forEach((o, i) => {
    const ox = position.x - o.x, oz = position.z - o.z, d = Math.hypot(ox, oz), avoid = o.r + clearance;
    if (d >= avoid) return;
    const nx = d > 1e-4 ? ox / d : Math.sin(yaw), nz = d > 1e-4 ? oz / d : Math.cos(yaw), inward = vx * nx + vz * nz;
    if (inward >= 0) return;
    vx -= nx * inward; vz -= nz * inward;
    const side = ((slot + i) & 1) ? 1 : -1;
    if (Math.hypot(vx, vz) < 1e-4) { vx = -nz * side; vz = nx * side; }
    const urgency = clamp01((avoid - d) / Math.max(clearance, .01));
    vx -= nz * side * urgency * .28; vz += nx * side * urgency * .28;
    const len = Math.hypot(vx, vz) || 1; vx /= len; vz /= len;
  });
  const len = Math.hypot(vx, vz) || 1;
  return { x: vx / len, z: vz / len };
}

export function estimatePlayerVelocity(motion, p, dt, maxSpeed = 6.8, blendRate = 8) {
  const state = motion || { x: p.x, z: p.z, vx: 0, vz: 0 };
  if (dt > 0) {
    const blend = 1 - Math.exp(-dt * blendRate);
    const measuredVX = Math.max(-maxSpeed, Math.min(maxSpeed, (p.x - state.x) / dt));
    const measuredVZ = Math.max(-maxSpeed, Math.min(maxSpeed, (p.z - state.z) / dt));
    state.vx += (measuredVX - state.vx) * blend;
    state.vz += (measuredVZ - state.vz) * blend;
  }
  state.x = p.x;
  state.z = p.z;
  return state;
}

export function straightWindAimYaw({ foxX, foxZ, player, motion, mode, leadTime }) {
  const lead = mode === 'straight' ? (leadTime || 0) : 0;
  return Math.atan2(player.x + (motion?.vx || 0) * lead - foxX,
    player.z + (motion?.vz || 0) * lead - foxZ);
}

export function dashFrictionFactor(dt) {
  return Math.exp(-FOX.handling.brakeLerp * Math.max(0, dt));
}

export function beginFoxRecovery(vx, vz) {
  const speed = Math.hypot(vx, vz);
  const cap = FOX.handling.recoverySpeedMax;
  if (speed <= cap || speed < 1e-8) return { vx, vz };
  const scale = cap / speed;
  return { vx: vx * scale, vz: vz * scale };
}

export function stepFoxRecovery(timer, vx, vz, dt) {
  const drag = dashFrictionFactor(dt);
  const nextTimer = Math.max(0, timer - dt);
  const velocity = beginFoxRecovery(vx * drag, vz * drag);
  return {
    timer: nextTimer,
    state: nextTimer > 0 ? 'rest' : 'roam',
    vx: nextTimer > 0 ? velocity.vx : 0,
    vz: nextTimer > 0 ? velocity.vz : 0,
  };
}

// ---------- 体力（stamina）纯函数：唯一收支入口 ----------

/** 体力是否足以发起一次冲刺/扑咬。 */
export function canSprint(stamina, staminaPerSec, dt = 0) {
  // 需要至少留够这一段时间的消耗
  return stamina > staminaPerSec * Math.max(dt, 0.1);
}

/** 低血量对速度的倍率：血量 ≥ 阈值 → 1；血量 → 0 → speedMulAtZeroHp。 */
export function hpSpeedMultiplier(hpRatio, vitals) {
  const t = Math.max(0, Math.min(1, hpRatio / vitals.lowHpThreshold));
  return vitals.speedMulAtZeroHp + (1 - vitals.speedMulAtZeroHp) * t;
}

/** 低血量对伤害的倍率（与速度同理，但地板更低）。 */
export function hpDamageMultiplier(hpRatio, vitals) {
  const t = Math.max(0, Math.min(1, hpRatio / vitals.lowHpThreshold));
  return vitals.damageMulAtZeroHp + (1 - vitals.damageMulAtZeroHp) * t;
}

/**
 * 每帧的体力收支（纯函数：不修改传入对象，返回新值）。
 * 静止休息时 resting=true → regenPerSec 生效，同时按 hpRegenRatio 缓慢回血；
 * 否则按 drainPerSec 消耗（可为 0，例如慢行不耗体力）。
 * 体力见底 → exhausted=true 且 locked=staminaLockSeconds（locked>0 期间不可冲刺）。
 * @returns {{stamina:number, locked:number, exhausted:boolean, hp:number}}
 */
export function stepStamina(state, dt, options = {}) {
  const maxStamina = options.maxStamina ?? FOX.vitals.maxStamina;
  const lockSeconds = options.staminaLockSeconds ?? FOX.vitals.staminaLockSeconds;
  let stamina = state.stamina ?? maxStamina;
  let hp = state.hp ?? options.maxHp ?? 0;
  let locked = Math.max(0, (state.locked ?? 0) - Math.max(0, dt));
  let exhausted = false;
  if (options.resting) {
    stamina = Math.min(maxStamina, stamina + (options.regenPerSec ?? 0) * dt);
    const maxHp = options.maxHp ?? hp;
    hp = Math.min(maxHp, hp + maxHp * (options.hpRegenRatio ?? 0) * dt);
  } else {
    stamina = Math.max(0, stamina - (options.drainPerSec ?? 0) * dt);
    if (stamina <= 0 && (options.drainPerSec ?? 0) > 0) {
      exhausted = true;
      locked = lockSeconds;
    }
  }
  return { stamina, locked, exhausted, hp };
}
