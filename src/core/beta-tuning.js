// beta 专属玩法平衡。所有数值仅在 IS_BETA 下被 main.js 采用；
// 纯函数显式接收 betaOn 等参数，便于 node 单测，不在模块顶层依赖 DOM。
import { IS_BETA } from './version.js';
import { PLAYER } from './config.js';

export const BETA_ACTIVE = IS_BETA;

export const BETA_TUNE = {
  moveSpeedMul: 1.07, // 普通移速略降；stable/dev 不经过此倍率。
  sprintMoveCost: 5.0,
  runMoveCost: 0.8, // 普通奔跑（非疾跑）移动消耗；stable/dev 保持既有常量。
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
  grazeImmediateShare: 0.35, // 35% 草料立即转化，其余进入有限口腔缓冲
  mouthCapacity: 120,
  chewPerSec: 5,
  // 口腔消化速度阈值：玩家普通无 Shift/非摇杆内圈速度（PLAYER.speed 经 Beta 移速倍率）。
  chewRunSpeedThreshold: PLAYER.speed * 1.07,
  chewRunRateRatio: 0.25, // 达到普通奔跑阈值时保留的咀嚼速率比例。
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
  // —— 智能狐扑击命中校准（仅 Beta）——
  smartPounceAimOffsetScale: 0, // 提交态不把分离/包抄偏移带入最终瞄准点
  smartPounceMinDistance: 4.2,
  smartPounceMaxDistance: 6.2,
  smartPounceApproachRadius: 5.0,
  smartPounceObserveRadius: 7.0,
  smartPounceRingTolerance: 0.28,
  smartPounceRingCrawlSpeed: 1.1, // 接近提交环时的爬行速度上限（避免全速冲穿环窗口）
  smartPounceAlignCreepSpeed: 0.75, // align 阶段允许的低速微调，使「进环 + 转正」可同时成立
  smartPounceMemoryPenalty: 0.18,
  smartPounceFatiguePenalty: 0.12,
  smartPounceHitRadiusCap: 1.7, // 命中半径上限；默认不小于原始 1.70m 接触半径
  smartPounceLeadSeconds: 0.1,
  smartPounceMaxLeadDistance: 0.65,
  smartPounceStrikeSpeed: 10.8,
  smartPounceStrikeTime: 0.21, // 总位移约 2.27m，保留前摇和可闪避窗口
  // —— 智能狐独立近身撕咬（仅 Beta）——
  smartMeleeTriggerRange: 2.4,
  smartMeleeHitRange: 1.55, // 当前水平接触距离；不复用扑击 swept hit
  smartMeleeWindupTime: 0.25,
  smartMeleeStrikeTime: 0.15,
  smartMeleeRecoverTime: 0.45,
  smartMeleeCooldown: 1.1, // 从进入 recover 起计，避免贴身连续无间隔扣血
  smartMeleeStrikeSpeed: 2.4, // 攻击段约 0.36m 短位移
  // —— 眩晕递减（仅 Beta）——
  stunDiminishWindow: 3.0,       // 上次施加/结束后，窗口内再次命中会递减
  stunDiminishFactor: 0.55,      // 每层眩晕时长倍率
  stunDiminishFloor: 0.15,       // 递减后的最短眩晕时长（秒）
  stunDiminishResetSeconds: 4.0, // 停止被晕后超过此时长，递减层数清零
  // —— BGM（仅 Beta）——
  bgmCombatLatchSeconds: 35, // 被狐狸击中后 combat BGM 保持秒数；每次受击刷新
};

/**
 * Movement drain per second. In Beta, the explicit sprint setting describes
 * sprint movement itself, so it takes precedence over boost/overdrive travel
 * rates. Those rates remain unchanged while not sprinting. Stable/dev retain
 * their original constants and priority exactly.
 */
export function resolveMovementCostPerSecond({
  betaOn = BETA_ACTIVE,
  sprinting = false,
  boost = 0,
  overdrive = 0,
  tune = BETA_TUNE,
} = {}) {
  if (betaOn && sprinting) return tune.sprintMoveCost;
  if (overdrive > 0) return 4;
  if (boost > 0) return 4.8;
  if (sprinting) return betaOn ? tune.sprintMoveCost : 3.4;
  return betaOn ? tune.runMoveCost : 1.6;
}

/** 空闲达到清零时间后，立即清掉实例上的递减层与时间戳。 */
export function expireStunDiminution(state = {}, now = 0, resetSeconds = BETA_TUNE.stunDiminishResetSeconds) {
  const lastAppliedAt = Number.isFinite(state.lastAppliedAt) ? state.lastAppliedAt : -Infinity;
  const lastEndedAt = Number.isFinite(state.lastEndedAt) ? state.lastEndedAt : -Infinity;
  const eventAt = Math.max(lastAppliedAt, lastEndedAt);
  if (!Number.isFinite(eventAt) || now - eventAt < Math.max(0, Number(resetSeconds) || 0)) return state;
  return { ...state, level: 0, lastAppliedAt: -Infinity, lastEndedAt: -Infinity };
}

/**
 * 计算 Beta 眩晕递减后的时长。
 * `state` 可直接保存在狐狸实例上，返回值包含下一层级和事件时间，便于下一次命中继续计算。
 * stable/dev 调用方不应进入此函数；传 betaOn=false 时保持原始时长。
 */
export function stepStunDiminution(baseDuration, state = {}, { betaOn = BETA_ACTIVE, now = 0, tune = BETA_TUNE } = {}) {
  const base = Math.max(0, Number(baseDuration) || 0);
  if (!betaOn) return { duration: base, level: 0, lastAppliedAt: now, lastEndedAt: state.lastEndedAt ?? -Infinity };
  const previousLevel = Math.max(0, Math.floor(Number(state.level) || 0));
  const lastAppliedAt = Number.isFinite(state.lastAppliedAt) ? state.lastAppliedAt : -Infinity;
  const lastEndedAt = Number.isFinite(state.lastEndedAt) ? state.lastEndedAt : -Infinity;
  const eventAt = Math.max(lastAppliedAt, lastEndedAt);
  const elapsed = now - eventAt;
  const reset = Math.max(0, Number(tune.stunDiminishResetSeconds) || 0);
  const window = Math.max(0, Number(tune.stunDiminishWindow) || 0);
  const active = Number(state.currentStun) > 0;
  let level = 0;
  const hasHistory = Number.isFinite(lastAppliedAt) || Number.isFinite(lastEndedAt);
  if (active) level = previousLevel + 1;
  else if (elapsed < reset) {
    if (elapsed <= window) level = hasHistory ? previousLevel + 1 : 0; // 首次眩晕不打折
    else level = previousLevel; // 窗口外不再叠层，但保留旧层直到清零时间
  }
  const factor = Math.max(0, Number(tune.stunDiminishFactor) || 0);
  const floor = Math.max(0, Number(tune.stunDiminishFloor) || 0);
  const duration = level > 0 ? Math.min(base, Math.max(floor, base * (factor ** level))) : base;
  return { duration, level, lastAppliedAt: now, lastEndedAt };
}


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
