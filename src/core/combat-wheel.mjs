// ============================================================
// 纯战斗输入选择（触屏 / 键盘 / 鼠标共用）
// ============================================================
// 攻击只有三种招式（ATTACK_MOVES）：
//   tap   推击：点按 / 普通松手（非奔跑长按也落回推击，不存在第四种攻击）
//   stand 迎击：按住攻击键【向左滑】过阈值立即触发（正面接住狐狸冲刺时反打）
//   lunge 扑击：仅【奔跑中】长按达到扑击阈值，松手时触发
// 翻滚(dodge)是移动动作、不是攻击：按住攻击键【向右滑】过阈值立即翻滚一次，
// 或使用页面右侧独立的翻滚键；一次按住最多触发一个方向招式（左/右闩锁互斥）。
//
// 时间单位除特别注明外均为毫秒，距离为 CSS px。
export const ATTACK_MOVES = ['tap', 'stand', 'lunge']; // 推击 / 迎击 / 扑击
export const ATTACK_DEAD_ZONE = 18;

// —— 攻击键手势时间 / 距离常量 ——
export const POUNCE_HOLD_MS = 650;        // 奔跑长按扑击阈值（沿用既有手感）
export const PARRY_DRAG_THRESHOLD = 22;   // 迎击：左滑 dx ≤ -22px
export const ROLL_DRAG_THRESHOLD = 22;    // 翻滚：右滑 dx ≥ +22px
// 方向识别必须水平主导：|dx| 要明显大于 |dy|，纵向摇动不误触发迎击/翻滚。
export const GESTURE_HORIZONTAL_RATIO = 1.1;

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/**
 * 松手结算（毫秒输入，纯函数）：
 *   - 本次按住已触发过左滑迎击或右滑翻滚（fired 非空）→ null，松手不补招；
 *   - 奔跑中长按达到扑击阈值 → 'lunge'（扑击）；
 *   - 其他一切情况（点按、早松、非奔跑长按）→ 'tap'（推击）。
 */
export function resolveAttackRelease({ holdMs = 0, sprinting = false, fired = null, parried = false } = {}) {
  if (fired || parried) return null;
  const t = Math.max(0, Number(holdMs) || 0);
  if (sprinting && t >= POUNCE_HOLD_MS) return 'lunge';
  return 'tap';
}

/**
 * 兼容主循环旧调用：hold 单位为秒，sprinting 为当前是否奔跑姿态。
 * cfg 可覆盖扑击阈值（秒）：{ heavyHold }（兼容旧键 { lungeHold }）。
 * 非奔跑时无论按多久都只返回推击 'tap'。
 */
export function selectChargedMove(hold = 0, sprinting = false, cfg = {}) {
  const t = Math.max(0, Number(hold) || 0) * 1000;
  const pounceSec = clampNum(cfg.heavyHold ?? cfg.lungeHold, 0.1, Infinity, POUNCE_HOLD_MS / 1000);
  return sprinting && t >= pounceSec * 1000 ? 'lunge' : 'tap';
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
    const horizontal = Math.abs(this.dx) >= Math.abs(this.dy) * GESTURE_HORIZONTAL_RATIO;
    if (horizontal && this.dx <= -PARRY_DRAG_THRESHOLD) {
      this.fired = 'parry';
      return this.context('parry');
    }
    if (horizontal && this.dx >= ROLL_DRAG_THRESHOLD) {
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
