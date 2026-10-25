// beta 专属玩法平衡。所有数值仅在 IS_BETA 下被 main.js 采用；
// 纯函数显式接收 betaOn 等参数，便于 node 单测，不在模块顶层依赖 DOM。
import { IS_BETA } from './version.js';

export const BETA_ACTIVE = IS_BETA;

export const BETA_TUNE = {
  moveSpeedMul: 1.12,
  sprintMoveCost: 5.0,
  flowerCount: 4,
  flowerInstant: true,
  grassSeconds: 0.6,        // 一轮啃食动作（HUD 进度条）所需秒数；只驱动动作节奏/飘字，不直接给能量
  // —— 啃环境草（growth 语义见 src/core/graze-grid.mjs）——
  grazeCoreRadius: 1.2,     // 啃食核心圈半径，单位米；圈内草株按满权重 1 被啃
  grazeHaloRadius: 3.0,     // 啃食外圈半径，单位米；权重从核心边缘线性衰减到 0
  grazeRate: 0.55,          // 每株草每秒被啃掉的 growth 量（满权重）：约 1.8s 把核心圈一株草从 1 啃到 0
  grassRegrowPerSec: 0.012, // 环境草自长速度（growth/秒）：啃光后约 83s 长满，约为啃食速度的 1/46，原地持续啃不可能刷出能量
  grazeRegenPerSec: 8.0,    // 满密度时每秒入口的草料单位；实际按前方锥内真实吃量连续折算
  grazeConeHalfAngle: Math.PI / 3, // 以身体 yaw 为中心的 120° 前方采食锥；身后草不参与
  grazeMoveSpeedMul: 0.16,
  grazeImmediateShare: 0.12, // 仅少量草料立即转化，其余进入有限口腔缓冲
  mouthCapacity: 36,
  chewPerSec: 5,
  mainBurrowChewPerSec: 12,
  temporaryBurrowChewPerSec: 7.5,
  staminaFatThreshold: 0.6,
  flowerHpTotal: 18,
  flowerStaminaTotal: 28,
  flowerRecoverySeconds: 8,
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
