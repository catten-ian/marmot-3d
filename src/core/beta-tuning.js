// beta 专属玩法平衡。所有数值仅在 IS_BETA 下被 main.js 采用；
// 纯函数显式接收 betaOn 等参数，便于 node 单测，不在模块顶层依赖 DOM。
import { IS_BETA } from './version.js';

export const BETA_ACTIVE = IS_BETA;

export const BETA_TUNE = {
  moveSpeedMul: 1.12,
  sprintMoveCost: 5.0,
  flowerCount: 4,
  flowerInstant: true,
  grassSeconds: 0.6,        // 啃一棵草所需秒数（正式版 FORAGE.grassSeconds=1.4，beta 明显缩短）
  companionFollowSpeed: 9.6,
  companionFollowGap: 1.05,
  grazeEyeDropExtra: 0.12,
  thirdPersonGrazeDrop: 1.05,
  lungeLockRange: 9.0,
  lungeLockHalfAngle: Math.PI / 2.2,
};

/**
 * 扑击(lunge)自动锁敌：选前方半角内距离最近的有效目标，返回其朝向 yaw。
 * 无合适目标返回 null（沿用原 attackYaw）。纯函数，不访问 DOM/three。
 */
export function resolveLungeLockYaw(px, pz, baseYaw, foxes, {
  range = BETA_TUNE.lungeLockRange,
  halfAngle = BETA_TUNE.lungeLockHalfAngle,
} = {}) {
  let best = null, bestD = Infinity;
  for (const f of foxes) {
    if (!f || f.alive === false || (typeof f.hp === 'number' && f.hp <= 0)) continue;
    const dx = f.x - px, dz = f.z - pz;
    const d = Math.hypot(dx, dz);
    if (!(d <= range) || d < 1e-4) continue;
    const yaw = Math.atan2(-dx, -dz);
    const diff = Math.abs(wrapPi(yaw - baseYaw));
    if (diff > halfAngle) continue;
    if (d < bestD) { bestD = d; best = yaw; }
  }
  return best;
}

function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** beta 吃花是否本帧立即完成（kind==='flower' 且开关开）。 */
export function betaFlowerCompletesImmediately(kind, {
  betaOn = BETA_ACTIVE,
  instant = BETA_TUNE.flowerInstant,
} = {}) {
  return betaOn && instant && kind === 'flower';
}
