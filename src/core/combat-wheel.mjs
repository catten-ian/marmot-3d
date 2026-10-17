// ============================================================
// 纯战斗输入选择（触屏 / 键盘 / 鼠标共用）
// ============================================================
// 攻击键是【唯一】的攻击 / 迎击入口（没有独立 parry 键）。
// “按住升级三招”与“左滑迎击”的协调规则：
//   tap  (< 120ms)                 轻击 → 短刺(tap)
//   tap  (< 120ms) + dx ≤ -22px    tap 窗口内左滑 → 立即迎击(stand)，不等松手，松手不再出招
//   hold 早松 (120-280ms)          短刺(tap)
//   hold 中松 (280-650ms)          中刺(stand)
//   hold 晚松 (> 650ms)            重刺(lunge)
//   hold + dx ≤ -22px             hold 期间任意时刻左滑 → 立即迎击(stand)，
//                                  parried 闩锁保证一次按住只触发一次，命中后松手不再出招
// 迎击的左滑阈值就放在本文件（PARRY_DRAG_THRESHOLD），不要散落到通用 onAction 里。
// 翻滚(dodge)是独立按键，不进这个选择器。

export const ATTACK_MOVES = ['tap', 'dodge', 'stand', 'lunge'];
export const ATTACK_DEAD_ZONE = 18;

// —— 攻击键手势时间 / 距离常量（时间为毫秒，距离为 CSS px）——
export const TAP_MAX_MS = 120;          // 点按窗口
export const SHORT_HOLD_MAX_MS = 280;   // 短刺上限：120-280ms 早松同为短刺
export const MID_HOLD_MAX_MS = 650;     // 中刺上限：280-650ms；超过为重刺
export const PARRY_DRAG_THRESHOLD = 22; // 迎击左滑阈值：dx ≤ -22px 立即迎击

const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const clampNum = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/**
 * 按住时长选招（毫秒输入，纯函数）：
 *   <280ms → tap 短刺；280-650ms → stand 中刺；≥650ms → lunge 重刺。
 * cfg 可覆盖阈值（毫秒）：{ shortHoldMs, heavyHoldMs }。
 */
export function selectHoldMove(holdMs = 0, cfg = {}) {
  const t = Math.max(0, Number(holdMs) || 0);
  const heavyMs = clampNum(cfg.heavyHoldMs, MID_HOLD_MAX_MS, Infinity, MID_HOLD_MAX_MS);
  const shortMs = clampNum(cfg.shortHoldMs, 0, heavyMs, SHORT_HOLD_MAX_MS);
  if (t >= heavyMs) return 'lunge';
  if (t >= shortMs) return 'stand';
  return 'tap';
}

/**
 * 松手结算：迎击已通过左滑即时触发后，松手不再出攻击招（返回 null）。
 */
export function resolveAttackRelease({ holdMs = 0, parried = false } = {}) {
  return parried ? null : selectHoldMove(holdMs);
}

/**
 * 兼容旧调用：hold 单位为秒；sprinting 参数已废弃（重刺不再要求奔跑姿态），
 * 仅为保持调用签名而保留。cfg 支持新键（秒）：{ shortHold, heavyHold }，
 * 同时兼容旧的 { parryHold, lungeHold }。
 */
export function selectChargedMove(hold = 0, _sprinting = false, cfg = {}) {
  const t = Math.max(0, Number(hold) || 0) * 1000;
  const shortSec = cfg.shortHold ?? cfg.parryHold ?? SHORT_HOLD_MAX_MS / 1000;
  const heavySec = cfg.heavyHold ?? cfg.lungeHold ?? MID_HOLD_MAX_MS / 1000;
  return selectHoldMove(t, { shortHoldMs: shortSec * 1000, heavyHoldMs: heavySec * 1000 });
}

/**
 * 攻击键单指手势状态机：一次按下一个实例。
 * update() 在左滑跨过 PARRY_DRAG_THRESHOLD 的那一帧返回迎击 ctx
 * （{ pointerId, tStart, tNow }），parried 闩锁保证同一次按住只 fire 一次；
 * release() 输出 { holdMs, parried, dx, dy } 供松手结算。
 */
export class AttackGesture {
  constructor(pointerId, tNow = nowMs()) {
    this.pointerId = pointerId;
    this.tStart = tNow;
    this.tNow = tNow;
    this.dx = 0;
    this.dy = 0;
    this.parried = false;
  }

  /** 拖动更新：dx 为相对按下起点的水平位移（屏幕坐标，左负右正）。跨阈值当帧返回 ctx，否则 null。 */
  update(dx = this.dx, dy = this.dy, tNow = nowMs()) {
    this.dx = Number(dx) || 0;
    this.dy = Number(dy) || 0;
    this.tNow = tNow;
    if (!this.parried && this.dx <= -PARRY_DRAG_THRESHOLD) {
      this.parried = true;
      return this.context();
    }
    return null;
  }

  context() {
    return { pointerId: this.pointerId, tStart: this.tStart, tNow: this.tNow };
  }

  /** 松手：返回按住时长（毫秒）、是否已迎击、末次位移。 */
  release(tNow = nowMs()) {
    this.tNow = tNow;
    return { holdMs: Math.max(0, tNow - this.tStart), parried: this.parried, dx: this.dx, dy: this.dy };
  }
}

// 兼容旧引用：四向手势轮盘已废弃。

// 翻滚方向：优先当前实际移动方向（速度方向），否则用身体朝向。
// 返回归一化 {x,z} 与是否朝身体后方。
export function rollDirection({ velX = 0, velZ = 0, bodyYaw = 0 } = {}) {
  const v = Math.hypot(velX, velZ);
  if (v > 0.05) return { x: velX / v, z: velZ / v, moving: true };
  return { x: -Math.sin(bodyYaw), z: -Math.cos(bodyYaw), moving: false };
}
