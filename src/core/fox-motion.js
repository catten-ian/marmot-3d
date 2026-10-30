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
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const finiteNonNegative = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, value) : fallback;
  const maxStamina = finiteNonNegative(options.maxStamina ?? FOX.vitals.maxStamina);
  const lockSeconds = finiteNonNegative(options.staminaLockSeconds ?? FOX.vitals.staminaLockSeconds);
  let stamina = Math.min(maxStamina, finiteNonNegative(state?.stamina, maxStamina));
  let hp = finiteNonNegative(state?.hp, finiteNonNegative(options.maxHp));
  const maxHp = finiteNonNegative(options.maxHp ?? hp);
  let locked = Math.max(0, finiteNonNegative(state?.locked) - safeDt);
  let exhausted = false;
  const drainPerSec = finiteNonNegative(options.drainPerSec);
  const regenByState = options.regenPerSecByState && typeof options.regenPerSecByState === 'object'
    ? options.regenPerSecByState : {};
  const stateRegen = finiteNonNegative(regenByState[options.regenState]);
  const regenPerSec = finiteNonNegative(options.resting ? (options.regenPerSec ?? 0) : stateRegen);
  const regenAllowed = options.regenAllowed !== false;
  if (drainPerSec > 0) {
    stamina = Math.max(0, stamina - drainPerSec * safeDt);
    if (stamina <= 0 && !options.resting) {
      exhausted = true;
      locked = Math.max(locked, lockSeconds);
    }
  } else if (regenAllowed) {
    stamina = Math.min(maxStamina, stamina + regenPerSec * safeDt);
  }
  // Health is deliberately tied to resting only; combat locomotion and recovery
  // can restore stamina but never restore health.
  if (options.resting) {
    const hpRate = finiteNonNegative(options.hpRegenRatio);
    hp = Math.min(maxHp, hp + maxHp * hpRate * safeDt);
  }
  return { stamina: Number.isFinite(stamina) ? Math.max(0, Math.min(maxStamina, stamina)) : 0,
    locked: Number.isFinite(locked) ? Math.max(0, locked) : 0, exhausted,
    hp: Number.isFinite(hp) ? Math.max(0, Math.min(maxHp, hp)) : 0 };
}

// ---------- 自主撤退（阶段 2 驱退口径）纯函数 ----------

/**
 * 狐狸自己是否该撤退（纯函数）。撤退是狐狸自己的判断，不是受击逻辑强塞。
 * 触发：血量低 / 体力低 / 短时间连续被打；攻击流程（wind/dash）中不撤退，
 * 已在撤退/休息/死亡状态下也不重复触发。
 */
export function shouldRetreat({ hpRatio = 1, staminaRatio = 1, hitStreak = 0, state = 'roam' } = {}, cfg = FOX.retreat) {
  if (state === 'wind' || state === 'dash') return false;           // 攻击流程中不撤退
  if (state === 'retreat' || state === 'rest_safe' || state === 'dead') return false;
  if (hpRatio <= cfg.hpRatio) return true;
  if (staminaRatio <= cfg.staminaRatio) return true;
  if ((hitStreak ?? 0) >= cfg.hitStreak) return true;
  return false;
}

/**
 * 选休息点（纯函数）：优先"玩家不在附近"的洞穴口旁，否则沿背离玩家方向推到安全距离。
 * 返回 {x, z}，已夹进活动场边界。
 */
export function chooseRestPoint({ foxX, foxZ, playerX, playerZ, burrows = [], bounds, obstacles = [], clearance = null }, cfg = FOX.retreat) {
  const margin = 4;
  const hw = (bounds?.hw ?? 74) - margin;
  const hh = (bounds?.hh ?? 44) - margin;
  const clampX = (v) => Math.max(-hw, Math.min(hw, v));
  const clampZ = (v) => Math.max(-hh, Math.min(hh, v));
  // _groundSteer expands each obstacle by speed*.45, and arrival still needs to
  // be outside that band.  The old b.r+3.5 offset was inside it for shelter-b.
  const navClearance = clearance ?? Math.max(1.2, (cfg.speed ?? FOX.retreat.speed) * .45);
  const targetGap = navClearance + (cfg.arriveRadius ?? FOX.retreat.arriveRadius) + .35;
  // Preserve the pre-beta pure selection semantics when no navigation map is
  // supplied. Beta passes the explicit obstacle list below.
  if (!(obstacles || []).length) {
    let best = null, bestD = Infinity;
    for (const b of burrows || []) {
      const dp = Math.hypot(b.x - playerX, b.z - playerZ);
      if (dp < 16) continue;
      const df = Math.hypot(b.x - foxX, b.z - foxZ);
      if (df < bestD) { bestD = df; best = b; }
    }
    if (best) {
      const a = Math.atan2(best.x - playerX, best.z - playerZ);
      return { x: clampX(best.x + Math.sin(a) * ((best.r || 0) + 3.5)),
        z: clampZ(best.z + Math.cos(a) * ((best.r || 0) + 3.5)) };
    }
    const ax0 = foxX - playerX, az0 = foxZ - playerZ, d0 = Math.hypot(ax0, az0) || 1;
    return { x: clampX(playerX + (ax0 / d0) * 26), z: clampZ(playerZ + (az0 / d0) * 26) };
  }
  const usable = (x, z) => {
    if (Math.abs(x) > hw || Math.abs(z) > hh) return false;
    return (obstacles || []).every((o) => Math.hypot(x - o.x, z - o.z) >= (o.r || 0) + targetGap);
  };
  const distFromPlayer = (x, z) => Math.hypot(x - playerX, z - playerZ);
  const candidates = [];
  for (const b of burrows || []) {
    const dp = distFromPlayer(b.x, b.z);
    if (dp < 16) continue; // 玩家就在洞口，那里不安全
    const df = Math.hypot(b.x - foxX, b.z - foxZ);
    const away = Math.atan2(b.x - playerX, b.z - playerZ);
    const base = (b.r || 0) + 2.5 + targetGap;
    // Try away-from-player first, then fixed side alternatives if another rock or
    // the boundary blocks the first ray.  Selection remains one-shot per retreat.
    for (const side of [0, -0.65, 0.65, Math.PI]) {
      const a = away + side;
      const x = clampX(b.x + Math.sin(a) * base);
      const z = clampZ(b.z + Math.cos(a) * base);
      if (usable(x, z)) candidates.push({ x, z, df, preferred: side === 0 });
    }
  }
  candidates.sort((a, b) => (b.preferred - a.preferred) || (a.df - b.df));
  if (candidates[0]) return { x: candidates[0].x, z: candidates[0].z };

  const ax = foxX - playerX, az = foxZ - playerZ;
  const d = Math.hypot(ax, az) || 1;
  const dist = 26;
  const fallback = { x: clampX(playerX + (ax / d) * dist), z: clampZ(playerZ + (az / d) * dist) };
  if (usable(fallback.x, fallback.z)) return fallback;
  // Last resort stays within the active field and is still a real target; the
  // beta caller's bounded progress guard handles an unusual fully boxed-in map.
  return fallback;
}

/** Bounded progress bookkeeping for beta retreat navigation. */
export function stepRetreatProgress({ elapsed = 0, stall = 0, lastDistance = Infinity } = {}, distance, dt, options = {}) {
  const nextElapsed = elapsed + Math.max(0, dt);
  const improved = distance < lastDistance - (options.progressEpsilon ?? 0.05);
  const nextStall = improved ? 0 : stall + Math.max(0, dt);
  const timeout = options.timeout ?? 18;
  const stallLimit = options.stallLimit ?? 1.75;
  return { elapsed: nextElapsed, stall: nextStall, lastDistance: Math.min(lastDistance, distance), improved,
    stalled: nextStall >= stallLimit, timedOut: nextElapsed >= timeout };
}

/**
 * 进入 rest_safe 的纯状态迁移。justCounted 只在"本回合首次进入"时为 true ——
 * 调用方据此恰好触发一次驱退计数，连续多帧停留不会重复计数。
 */
export function enterRestSafe(state = {}, restSeconds = 6) {
  const justCounted = !state.repelCounted;
  return { state: 'rest_safe', timer: restSeconds, repelCounted: true, justCounted };
}

/**
 * 休息计时推进（纯函数）：推进计时器，并按 FOX.retreat.regenPerSec 实际回复生命，
 * 上限为 maxHp × restHealTarget。计时到或回到目标血量 → done=true。
 * @returns {{timer:number, hp:number, done:boolean}}
 */
export function stepRestSafe({ timer = 0, hp = 0, maxHp = 1 } = {}, dt = 0, cfg = FOX.retreat) {
  const next = Math.max(0, timer - Math.max(0, dt));
  const target = maxHp * (cfg.restHealTarget ?? 1);
  const healed = Math.min(target, hp + maxHp * (cfg.regenPerSec ?? 0) * Math.max(0, dt));
  return { timer: next, hp: healed, done: next <= 0 || healed >= target };
}

/** 休息结束、重新参战的纯状态迁移：repelCounted 复位，允许下次撤退再计数。 */
export function exitRestSafe() {
  return { state: 'roam', retreating: false, restPoint: null, repelCounted: false, hitStreak: 0 };
}

/**
 * 血量归零后的命运（恢复 d088054 之前旧口径，纯函数）：
 * 所有狐狸都先"夹尾逃跑"离场（flees=true）；区别只在是否增援回来 ——
 *   · boss 首领：一去不返（respawns=false）；
 *   · 其余类型（普通/幼/疾行/厚皮/智能）：过段时间在出生点附近重新出现（respawns=true）。
 * 调用方据此决定是否在离场计时结束后 respawnAt。
 */
export function defeatFate(type) {
  return type === 'boss'
    ? { flees: true, respawns: false }
    : { flees: true, respawns: true };
}

/**
 * 离场后的增援倒计时（纯函数）：
 *   · 会增援的类型（非 boss）：倒数，到 0 → shouldRespawn=true，由调用方 respawnAt；
 *   · boss：永不倒数、永不重生。
 */
export function stepDefeatCooldown(type, respawn, dt) {
  const fate = defeatFate(type);
  if (!fate.respawns) return { respawn, shouldRespawn: false };
  const next = Math.max(0, respawn - Math.max(0, dt));
  return { respawn: next, shouldRespawn: next <= 0 };
}
