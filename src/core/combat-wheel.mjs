// ============================================================
// 纯战斗输入选择（触屏 / 键盘 / 鼠标共用）
// ============================================================
// 攻击只有三种招式（ATTACK_MOVES）：
//   tap   推击：地面短按 / 650ms 前松手
//   stand 迎击：按住攻击键【向左滑】过阈值立即触发（空中先快落地再执行）
//   lunge 扑击：地面蓄力到阈值、或任意空中松手；1500ms 自动释放
// 翻滚(dodge)是移动动作、不是攻击：按住攻击键【向右滑】过阈值立即翻滚一次，
// 或使用页面右侧独立的翻滚键；一次按住最多触发一个方向招式（左/右闩锁互斥）。
//
// 时间单位除特别注明外均为毫秒，距离为 CSS px。
export const ATTACK_MOVES = ['tap', 'stand', 'lunge']; // 推击 / 迎击 / 扑击
export const ATTACK_DEAD_ZONE = 18;

// —— 攻击键手势时间 / 距离常量 ——
export const POUNCE_HOLD_MS = 650;        // 地面蓄力达到此阈值后松手为扑击
export const MAX_ATTACK_CHARGE_MS = 1500; // 防止蓄力无限持续；满格自动扑击
export const AERIAL_POUNCE_DAMAGE_MUL = 0.55;
export const PARRY_DRAG_THRESHOLD = 22;   // 迎击：左滑 dx ≤ -22px
export const ROLL_DRAG_THRESHOLD = 22;    // 翻滚：右滑 dx ≥ +22px
// 方向识别必须水平主导：|dx| 要明显大于 |dy|，纵向摇动不误触发迎击/翻滚。
export const GESTURE_HORIZONTAL_RATIO = 1.1;

/** Return the visible swipe affordance using the exact same threshold/axis rules as AttackGesture. */
export function resolveAttackGesturePreview({ dx = 0, dy = 0, fired = null } = {}) {
  if (fired === 'parry' || fired === 'roll') return fired;
  const x = Number(dx) || 0;
  const y = Number(dy) || 0;
  const horizontal = Math.abs(x) >= Math.abs(y) * GESTURE_HORIZONTAL_RATIO;
  if (horizontal && x <= -PARRY_DRAG_THRESHOLD) return 'parry';
  if (horizontal && x >= ROLL_DRAG_THRESHOLD) return 'roll';
  return null;
}

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/**
 * 松手结算（毫秒输入，纯函数）：
 *   - 已触发方向手势或已被真实命中打断 → null，不补招；
 *   - 空中松手总是扑击（短按会由调用方应用较低伤害倍率）；
 *   - 地面短按/早松为推击，蓄力达到阈值为扑击。
 */
export function resolveAttackRelease({ holdMs = 0, grounded = true, sprinting = false, fired = null, parried = false, interrupted = false } = {}) {
  if (interrupted || fired || parried) return null;
  const t = Math.max(0, Number(holdMs) || 0);
  if (!grounded || t >= POUNCE_HOLD_MS) return 'lunge';
  return 'tap';
}

/** 只有空中短按扑击使用弱伤害；已充满的空中扑击仍保持完整扑击倍率。 */
export function isWeakAerialPounce({ holdMs = 0, grounded = true } = {}) {
  return !grounded && Math.max(0, Number(holdMs) || 0) < POUNCE_HOLD_MS;
}

/** Advance a charge clock in milliseconds and clamp it at the forced-release limit. */
export function advanceAttackCharge(holdMs = 0, deltaMs = 0) {
  const next = Math.max(0, Number(holdMs) || 0) + Math.max(0, Number(deltaMs) || 0);
  const capped = Math.min(MAX_ATTACK_CHARGE_MS, next);
  return { holdMs: capped, progress: capped / MAX_ATTACK_CHARGE_MS, autoRelease: next >= MAX_ATTACK_CHARGE_MS };
}

/** 单次真实狐狸命中会清空蓄力并使之后到来的释放事件无效。 */
export function interruptAttackCharge(state = {}) {
  return { ...state, held: false, t: 0, pointerId: null, via: null, fired: null, interrupted: true };
}

/** 空中迎击只挂起一次；首次落地时消费并执行。 */
export function resolvePendingAerialParry(pending = false, grounded = false) {
  const execute = !!pending && !!grounded;
  return { pending: !!pending && !execute, execute };
}

/**
 * 兼容主循环旧调用：hold 单位为秒，保留 sprinting 参数以兼容旧调用。
 * cfg 可覆盖扑击阈值（秒）：{ heavyHold }（兼容旧键 { lungeHold }）。
 */
export function selectChargedMove(hold = 0, sprinting = false, cfg = {}) {
  const t = Math.max(0, Number(hold) || 0) * 1000;
  const pounceSec = clampNum(cfg.heavyHold ?? cfg.lungeHold, 0.1, Infinity, POUNCE_HOLD_MS / 1000);
  return t >= pounceSec * 1000 ? 'lunge' : 'tap';
}

/**
 * 攻击键单指手势状态机：一次按下一个实例，pointerId 归属手指。
 * update() 返回跨阈值当帧的事件 { kind: 'parry' | 'roll', pointerId, tStart, tNow, dx, dy }：
 *   dx ≤ -PARRY_DRAG_THRESHOLD 且水平主导 → 'parry'（迎击）
 *   dx ≥ +ROLL_DRAG_THRESHOLD 且水平主导  → 'roll'（翻滚）
 * fired 闩锁保证一次按住最多触发一个方向招式，且只触发一次。
 * release() 输出 { holdMs, fired, parried, rolled, dx, dy } 供松手结算。
 */
export class AttackGesture {
  constructor(pointerId, tNow = nowMs()) {
    this.pointerId = pointerId;
    this.tStart = tNow;
    this.tNow = tNow;
    this.dx = 0;
    this.dy = 0;
    this.fired = null; // null | 'parry' | 'roll'
  }

  get parried() { return this.fired === 'parry'; }
  get rolled() { return this.fired === 'roll'; }

  /** 拖动更新：dx 相对按下起点的水平位移（左负右正），dy 竖直位移（下正上负）。 */
  update(dx = this.dx, dy = this.dy, tNow = nowMs()) {
    this.dx = Number(dx) || 0;
    this.dy = Number(dy) || 0;
    this.tNow = tNow;
    if (this.fired) return null; // 闩锁：本次按住已出过一个方向招式
    const preview = resolveAttackGesturePreview({ dx: this.dx, dy: this.dy });
    if (preview === 'parry') {
      this.fired = 'parry';
      return this.context('parry');
    }
    if (preview === 'roll') {
      this.fired = 'roll';
      return this.context('roll');
    }
    return null;
  }

  context(kind = this.fired) {
    return {
      kind,
      pointerId: this.pointerId,
      tStart: this.tStart,
      tNow: this.tNow,
      dx: this.dx,
      dy: this.dy,
    };
  }

  /** 松手：返回按住时长（毫秒）、已触发的方向招式、末次位移。 */
  release(tNow = nowMs()) {
    this.tNow = tNow;
    return {
      holdMs: Math.max(0, tNow - this.tStart),
      fired: this.fired,
      parried: this.parried,
      rolled: this.rolled,
      dx: this.dx,
      dy: this.dy,
    };
  }
}

// 翻滚方向：优先当前实际移动方向（速度方向），否则用身体朝向。
// 返回归一化 {x,z} 与是否朝身体后方。
export function rollDirection({ velX = 0, velZ = 0, bodyYaw = 0 } = {}) {
  const v = Math.hypot(velX, velZ);
  if (v > 0.05) return { x: velX / v, z: velZ / v, moving: true };
  return { x: -Math.sin(bodyYaw), z: -Math.cos(bodyYaw), moving: false };
}

// ============================================================
// 攻击门控 / 迎击判定（纯函数，供 Node 测试与主循环共用）
// ============================================================

/**
 * 出招门控：只拦冷却与洞穴。
 * 站立/静止观察（observing）不再阻塞攻击 —— 站立也必须能短按推击，
 * 连续短按在冷却结束后按攻击节奏稳定触发。
 */
export function strikeGateOpen({ attackCD = 0, inBurrow = false } = {}) {
  return !(attackCD > 0) && !inBurrow;
}

/** 狐狸攻击有效窗口：只有 dash（正在发动的攻击）可被迎击。 */
export const FOX_ATTACK_STATE = 'dash';
export const DEFAULT_PARRY_HALF_ANGLE = 80 * Math.PI / 180;

/**
 * 振刀式迎击判定（纯函数）：只有成功抵住狐狸正在发动的攻击才算成功。
 *   timing        玩家输入时机：迎击窗口仍在（输入过早窗口已过期 / 过晚未开都不算）
 *   foxAttacking  狐狸处于攻击有效窗口（dash）；空闲/巡逻/蓄力(wind)/喘息(rest)都不算
 *   inRange       接触距离内
 *   facing        狐狸从玩家正面（攻击朝向 ±parryHalfAngle）冲来
 * 全部满足才 success；reason 给出首个失败原因，便于测试与调试。
 */
export function resolveParryOutcome({
  parryWindowT = 0, foxState = '', dist = Infinity, reach = 0,
  facingDot = -1, parryHalfAngle = DEFAULT_PARRY_HALF_ANGLE,
} = {}) {
  const timing = parryWindowT > 0;
  const foxAttacking = foxState === FOX_ATTACK_STATE;
  const inRange = dist <= reach;
  const facing = facingDot >= Math.cos(parryHalfAngle);
  const success = timing && foxAttacking && inRange && facing;
  let reason = 'success';
  if (!success) {
    reason = !timing ? 'timing'
      : !foxAttacking ? 'fox-not-attacking'
        : !inRange ? 'out-of-range'
          : 'not-facing';
  }
  return { success, timing, foxAttacking, inRange, facing, reason };
}
