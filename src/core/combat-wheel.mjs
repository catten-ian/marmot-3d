// Pure combat-input selection shared by touch and keyboard.
// 攻击键升级：点按→推击(tap)；按住蓄力跨过 parryHold→迎击(stand)；
// 跨过 lungeHold→扑咬(lunge)。翻滚(dodge)是独立按键，不进这个选择器。
export const ATTACK_MOVES = ['tap', 'dodge', 'stand', 'lunge'];
export const ATTACK_DEAD_ZONE = 18;

// hold: 本次攻击键按住时长（秒）；sprinting: 当前是否奔跑姿态；cfg: PLAYER.combatWheel.charge
export function selectChargedMove(hold = 0, sprinting = false, cfg = { parryHold: 0.28, lungeHold: 0.58 }) {
  const t = Math.max(0, Number(hold) || 0);
  if (t >= (cfg.lungeHold ?? 0.58) && sprinting) return 'lunge'; // 扑咬仅奔跑
  if (t >= (cfg.parryHold ?? 0.28)) return 'stand';             // 迎击站/跑皆可
  return 'tap';                                                 // 推击
}

// 兼容旧引用：四向手势轮盘已废弃。

// 翻滚方向：优先当前实际移动方向（速度方向），否则用身体朝向。
// 返回归一化 {x,z} 与是否朝身体后方。
export function rollDirection({ velX = 0, velZ = 0, bodyYaw = 0 } = {}) {
  const v = Math.hypot(velX, velZ);
  if (v > 0.05) return { x: velX / v, z: velZ / v, moving: true };
  return { x: -Math.sin(bodyYaw), z: -Math.cos(bodyYaw), moving: false };
}
