/**
 * Beta 后台「数值总览」的 schema 与纯函数内核。
 *
 * 本模块不依赖 DOM / three，可在纯 Node 下被 node:test 直接测试。
 * 数值默认值从游戏真实常量模块读取（只读引用，绝不写回源对象），
 * 调整只发生在本页的预览态副本上（见 createTuningState）。
 */
import { PLAYER, FOX, BURROW, UNDERGROUND, BURROWS, BURROW_AI, LEVELS, BERRY_POINTS, SPAWN_POINTS, ROCKS, BERRY_RADIUS, BERRY_ENERGY, BERRY_CHARGE,
  COMPANION_FOLLOW_SPEED, COMPANION_CATCH_DIST, RESCUE_DIST, SOCIAL_RANGE,
  FIELD_W, FIELD_H } from '../core/config.js';
import { BETA_TUNE } from '../core/beta-tuning.js';
import {
  ATTACK_DEAD_ZONE, POUNCE_HOLD_MS, MAX_ATTACK_CHARGE_MS,
  AERIAL_POUNCE_DAMAGE_MUL, PARRY_DRAG_THRESHOLD, ROLL_DRAG_THRESHOLD,
  GESTURE_HORIZONTAL_RATIO, DEFAULT_PARRY_HALF_ANGLE,
} from '../core/combat-wheel.mjs';
import {
  SMART_POUNCE, SMART_PHASE_MIN, SMART_POUNCE_COOLDOWN, RECOVER_LOCK, SMART_WEIGHTS,
} from '../entities/smart-fox-core.mjs';
import { STRIKE_VOLUMES } from '../systems/combat.js';

/** 导出文件的 schema 版本；导入时校验。 */
export const ADMIN_SCHEMA_VERSION = 1;

function describeEntry(entry) {
  const unit = entry.unit ? `单位：${entry.unit}。` : '单位：无量纲。';
  const range = entry.kind === 'number' && Number.isFinite(entry.min) && Number.isFinite(entry.max) ? `范围：${entry.min}～${entry.max}。` : '';
  const direction = entry.kind === 'boolean' ? '开启会启用该机制，关闭会停用该机制。' : entry.kind === 'enum' ? '切换选项会改变该机制采用的行为模式。' : '调大通常增强或延长该项效果，调小通常减弱或缩短该项效果；请结合预览确认。';
  const danger = /角度|范围|距离|半径|碰撞|锁定|速度|冷却|伤害|体力|蓄力|前摇|后摇|高度/.test(entry.label) ? '危险组合：过大的范围、速度、锁定时间叠加过小的冷却或前摇，可能造成无可躲避或重复命中；过小的碰撞高度或范围可能漏判。' : '危险组合：与同组倍率、冷却和碰撞参数叠加时请避免超出预期。';
  return `含义：${entry.label}（来源 ${entry.source}）。${unit}${range}${direction}关联机制：${entry.group}与游戏运行时同名来源共同决定预览中的数值、时间线和辅助体积。${danger}`;
}


const deg = (r) => r * 180 / Math.PI;

/**
 * 单项数值条目：
 *   id     面板内唯一键（点分路径，如 'fox.attacks.normal.dashTime'）
 *   group  分组名（中文）
 *   label  中文名
 *   file   来源文件
 *   source 来源常量表达式（对账用）
 *   kind   'number' | 'enum' | 'boolean'
 *   def    默认值（数字 / 字符串 / 布尔）
 *   min/max/step  number 类型的滑块范围
 *   options       enum 类型的可选值
 *   unit   展示单位（可选）
 *   toView/toStore  可选的展示换算（如弧度→角度）
 */
function num(id, group, label, file, source, def, { min, max, step, unit, toView, toStore } = {}) {
  const v = { id, group, label, file, source, kind: 'number', def };
  if (toView && toStore) {
    v.toView = toView; v.toStore = toStore;
    v.viewDef = toView(def);
    if (min != null) v.min = toView(min);
    if (max != null) v.max = toView(max);
    v.step = step ?? autoStep(toView(max ?? def * 3) - toView(min ?? 0));
  } else {
    v.viewDef = def;
    if (min != null) v.min = min;
    if (max != null) v.max = max;
    v.step = step ?? autoStep((max ?? def * 3) - (min ?? 0));
  }
  if (v.min == null) v.min = 0;
  if (v.max == null) v.max = Math.max(v.viewDef * 3, v.min + 1);
  if (unit) v.unit = unit;
  return v;
}
function autoStep(span) {
  if (!Number.isFinite(span) || span <= 0) return 0.01;
  const raw = span / 200;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const nice = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return nice * mag;
}
function en(id, group, label, file, source, def, options) {
  return { id, group, label, file, source, kind: 'enum', def, viewDef: def, options };
}
function bool(id, group, label, file, source, def) {
  return { id, group, label, file, source, kind: 'boolean', def, viewDef: def };
}

const F_CONFIG = 'src/core/config.js';
const F_WHEEL = 'src/core/combat-wheel.mjs';
const F_BETA = 'src/core/beta-tuning.js';
const F_SMART = 'src/entities/smart-fox-core.mjs';
const F_COMBAT = 'src/systems/combat.js';

/** 汇总全部可调数值（默认值在游戏常量加载时快照一次）。 */
export function buildTuningEntries() {
  const e = [];
  const G_PLAYER = '玩家 · 基础';
  const P = 'PLAYER';
  e.push(num('player.speed', G_PLAYER, '移动速度', F_CONFIG, `${P}.speed`, PLAYER.speed, { min: 0.5, max: 15, unit: 'm/s' }));
  e.push(num('player.backpedalSpeed', G_PLAYER, '后退速度倍率', F_CONFIG, `${P}.backpedalSpeed`, PLAYER.backpedalSpeed, { min: 0, max: 1 }));
  e.push(num('player.radius', G_PLAYER, '碰撞半径', F_CONFIG, `${P}.radius`, PLAYER.radius, { min: 0.05, max: 2, unit: 'm' }));
  e.push(num('player.collisionHeight', G_PLAYER, '碰撞高度', F_CONFIG, `${P}.collisionHeight`, PLAYER.collisionHeight, { min: 0.1, max: 2, unit: 'm' }));
  e.push(num('player.eyeHeight', G_PLAYER, '视高', F_CONFIG, `${P}.eyeHeight`, PLAYER.eyeHeight, { min: 0.1, max: 2, unit: 'm' }));
  e.push(num('player.maxHp', G_PLAYER, '生命上限', F_CONFIG, `${P}.maxHp`, PLAYER.maxHp, { min: 1, max: 500, step: 1 }));
  e.push(num('player.maxEnergy', G_PLAYER, '能量上限', F_CONFIG, `${P}.maxEnergy`, PLAYER.maxEnergy, { min: 1, max: 500, step: 1 }));
  e.push(num('player.bodyTurnRate', G_PLAYER, '身体转向速率', F_CONFIG, `${P}.bodyTurnRate`, PLAYER.bodyTurnRate, { min: 0.5, max: 30 }));
  e.push(num('player.fov.firstPerson', G_PLAYER, '第一人称视野', F_CONFIG, `${P}.fov.firstPerson`, PLAYER.fov.firstPerson, { min: 30, max: 120, unit: '°' }));
  e.push(num('player.fov.thirdPerson', G_PLAYER, '第三人称视野', F_CONFIG, `${P}.fov.thirdPerson`, PLAYER.fov.thirdPerson, { min: 30, max: 120, unit: '°' }));
  for (const [k, label, unit] of [
    ['speedThreshold', '奔跑判定速度阈值', ''], ['crouchRate', '俯伏速率', ''], ['standRate', '起身速率', ''],
    ['eyeDrop', '俯伏视高下降', 'm'], ['pitchDrop', '俯伏视线下压', 'rad'], ['fovNarrow', '俯伏视野收窄', '°'], ['bobBoost', '俯伏颠簸增强', ''],
  ]) e.push(num(`player.posture.${k}`, G_PLAYER, `姿态·${label}`, F_CONFIG, `${P}.posture.${k}`, PLAYER.posture[k], { min: 0, unit }));
  for (const [k, label, unit, max] of [
    ['velocity', '起跳初速度', 'm/s', 12], ['gravity', '重力加速度', 'm/s²', 30],
    ['cooldown', '起跳冷却', 's', 3], ['dodgeHeight', '跳跃躲咬高度', 'm', 2],
  ]) e.push(num(`player.jump.${k}`, G_PLAYER, `跳跃·${label}`, F_CONFIG, `${P}.jump.${k}`, PLAYER.jump[k], { min: 0, max, unit }));
  for (const [k, label] of [['turnRate', '转向速率'], ['accel', '加速度'], ['brake', '刹车强度']])
    e.push(num(`player.handling.${k}`, G_PLAYER, `操控·${label}`, F_CONFIG, `${P}.handling.${k}`, PLAYER.handling[k], { min: 0 }));

  const G_WHEEL = '玩家 · 攻击三招';
  const CW = `${P}.combatWheel`;
  for (const move of ['tap', 'stand', 'lunge']) {
    const w = PLAYER.combatWheel[move];
    const moveLabel = { tap: '推击', stand: '迎击', lunge: '扑击' }[move];
    for (const [k, label, max] of [
      ['damageMul', '伤害倍率', 5], ['cost', '体力消耗', 20], ['costMul', '消耗倍率', 3],
      ['cooldown', '冷却下限', 3], ['cooldownMul', '冷却倍率', 3], ['recovery', '后摇', 2],
      ['range', '追加距离', 5], ['rangeMul', '范围倍率', 3],
      ['stun', '眩晕时长', 3], ['lock', '锁定时长', 2], ['knockback', '击退距离', 8],
      ['distance', '位移距离', 8], ['invuln', '无敌时长', 2],
    ]) {
      if (w[k] == null) continue;
      e.push(num(`wheel.${move}.${k}`, G_WHEEL, `${moveLabel}·${label}`, F_CONFIG, `${CW}.${move}.${k}`, w[k], { min: k === 'range' ? -1 : 0, max }));
    }
  }
  for (const [k, label, min, max, unit] of [
    ['damageMul', '伤害倍率', 0, 3, ''], ['cost', '体力消耗', 0, 20, ''],
    ['distance', '翻滚距离', 0, 10, 'm'], ['invuln', '无敌时长', 0, 2, 's'], ['recovery', '翻滚后摇', 0, 3, 's'],
  ]) e.push(num(`wheel.dodge.${k}`, G_WHEEL, `翻滚·${label}`, F_CONFIG, `${CW}.dodge.${k}`, PLAYER.combatWheel.dodge[k], { min, max, unit }));
  for (const posture of ['stand', 'run']) {
    const s = PLAYER.combatWheel.tap[posture];
    const pl = posture === 'stand' ? '站立' : '奔跑';
    for (const k of ['rangeMul', 'damageMul', 'knockbackMul', 'stunMul'])
      e.push(num(`wheel.tap.${posture}.${k}`, G_WHEEL, `推击${pl}姿态·${k}`, F_CONFIG, `${CW}.tap.${posture}.${k}`, s[k], { min: 0, max: 3 }));
  }
  for (const [k, label] of [['parryWindow', '迎击窗口'], ['parryHalfAngle', '迎击半角']]) {
    const v = PLAYER.combatWheel.stand[k];
    if (k === 'parryHalfAngle') e.push(num(`wheel.stand.${k}`, G_WHEEL, `迎击·${label}`, F_CONFIG, `${CW}.stand.${k}`, v, { min: 0, max: Math.PI, toView: deg, toStore: (d) => d * Math.PI / 180, unit: '°' }));
    else e.push(num(`wheel.stand.${k}`, G_WHEEL, `迎击·${label}`, F_CONFIG, `${CW}.stand.${k}`, v, { min: 0, max: 2, unit: 's' }));
  }
  e.push(num('wheel.charge.heavyHold', G_WHEEL, '奔跑长按扑击阈值', F_CONFIG, `${CW}.charge.heavyHold`, PLAYER.combatWheel.charge.heavyHold, { min: 0.1, max: 2, unit: 's' }));

  const G_GESTURE = '玩家 · 攻击手势常量';
  e.push(num('gesture.deadZone', G_GESTURE, '摇杆死区', F_WHEEL, 'ATTACK_DEAD_ZONE', ATTACK_DEAD_ZONE, { min: 0, max: 64, step: 1, unit: 'px' }));
  e.push(num('gesture.pounceHoldMs', G_GESTURE, '扑击蓄力阈值', F_WHEEL, 'POUNCE_HOLD_MS', POUNCE_HOLD_MS, { min: 100, max: 2000, step: 10, unit: 'ms' }));
  e.push(num('gesture.maxChargeMs', G_GESTURE, '蓄力上限(自动释放)', F_WHEEL, 'MAX_ATTACK_CHARGE_MS', MAX_ATTACK_CHARGE_MS, { min: 500, max: 4000, step: 50, unit: 'ms' }));
  e.push(num('gesture.aerialPounceDamageMul', G_GESTURE, '空中短按扑击伤害倍率', F_WHEEL, 'AERIAL_POUNCE_DAMAGE_MUL', AERIAL_POUNCE_DAMAGE_MUL, { min: 0, max: 1 }));
  e.push(num('gesture.parryDragThreshold', G_GESTURE, '迎击左滑阈值', F_WHEEL, 'PARRY_DRAG_THRESHOLD', PARRY_DRAG_THRESHOLD, { min: 4, max: 80, step: 1, unit: 'px' }));
  e.push(num('gesture.rollDragThreshold', G_GESTURE, '翻滚右滑阈值', F_WHEEL, 'ROLL_DRAG_THRESHOLD', ROLL_DRAG_THRESHOLD, { min: 4, max: 80, step: 1, unit: 'px' }));
  e.push(num('gesture.horizontalRatio', G_GESTURE, '手势水平主导比', F_WHEEL, 'GESTURE_HORIZONTAL_RATIO', GESTURE_HORIZONTAL_RATIO, { min: 0.5, max: 3 }));
  e.push(num('gesture.defaultParryHalfAngle', G_GESTURE, '迎击默认半角', F_WHEEL, 'DEFAULT_PARRY_HALF_ANGLE', DEFAULT_PARRY_HALF_ANGLE, { min: 0, max: Math.PI, toView: deg, toStore: (d) => d * Math.PI / 180, unit: '°' }));
  e.push(num('wheel.aerialPounce.damageMul', G_WHEEL, '空中扑击伤害倍率', F_WHEEL, 'AERIAL_POUNCE_DAMAGE_MUL → PLAYER.combatWheel.aerialPounce.damageMul', AERIAL_POUNCE_DAMAGE_MUL, { min: 0, max: 2 }));

  const G_STRIKE = '判定 · 攻击体积';
  e.push(num('strike.halfAngle', G_STRIKE, '攻击扇形半角', F_COMBAT, 'STRIKE_VOLUMES.halfAngle', STRIKE_VOLUMES.halfAngle, { min: 0.05, max: Math.PI, toView: deg, toStore: (d) => d * Math.PI / 180, unit: '°' }));
  for (const move of ['tap', 'stand', 'lunge']) {
    const ml = { tap: '推击', stand: '迎击', lunge: '扑击' }[move];
    e.push(num(`strike.${move}.lower`, G_STRIKE, `${ml}体积下沿`, F_COMBAT, `STRIKE_VOLUMES.${move}.lower`, STRIKE_VOLUMES[move].lower, { min: -1, max: 2, unit: 'm' }));
    e.push(num(`strike.${move}.upper`, G_STRIKE, `${ml}体积上沿`, F_COMBAT, `STRIKE_VOLUMES.${move}.upper`, STRIKE_VOLUMES[move].upper, { min: 0.1, max: 3, unit: 'm' }));
  }

  const G_GEOMETRY = '判定 · 可视化默认项';
  e.push(num('geometry.strike.defaultRange', G_GEOMETRY, '默认攻击显示距离', 'src/systems/debug-volume-data.js', 'strikeVolumeGeometryData(range 默认值)', 2.4, { min: 0, max: 12, unit: 'm' }));
  e.push(num('geometry.strike.segments', G_GEOMETRY, '攻击扇形圆弧分段数', 'src/systems/debug-volume-data.js', 'strikeVolumeGeometryData(segments 默认值)', 20, { min: 4, max: 128, step: 1 }));
  e.push(num('geometry.fox.defaultDashTime', G_GEOMETRY, '狐狸攻击缺省冲刺时长', 'src/systems/debug-volume-data.js', 'foxAttackGeometryData(dashTime 缺省值)', 0.32, { min: 0.05, max: 2, unit: 's' }));

  const G_BETA = 'Beta · 平衡';
  for (const [k, label, min, max, unit] of [
    ['moveSpeedMul', '移动速度倍率', 0.5, 2, ''],
    ['sprintMoveCost', '疾跑移动体力消耗', 0, 20, '体力/s'],
    ['runMoveCost', '奔跑移动体力消耗', 0, 20, '体力/s'],
    ['flowerCount', '花的数量', 0, 20, '朵'],
    ['grassSeconds', '啃草耗时', 0.1, 5, 's'],
    ['grazeCoreRadius', '环境草核心圈半径', 0.1, 8, 'm'],
    ['grazeHaloRadius', '环境草外圈半径', 0.2, 12, 'm'],
    ['grazeRate', '环境草啃食速率', 0.01, 3, 'growth/s'],
    ['grassRegrowPerSec', '环境草再生速率', 0, 0.2, 'growth/s'],
    ['grazeRegenPerSec', '满密度啃草储备收益', 0, 30, '/s'],
    ['grazeMoveSpeedMul', '吃草移动速度倍率', 0, 2, ''],
    ['mouthCapacity', '口中食物储备上限', 0, 500, '单位'],
    ['chewPerSec', '站立吃草咀嚼速率', 0, 30, '单位/s'],
    ['chewRunSpeedThreshold', '口腔消化奔跑速度阈值', 0, 20, 'm/s'],
    ['chewRunRateRatio', '奔跑时口腔消化速率比例', 0, 1, '×'],
    ['mainBurrowChewPerSec', '主洞咀嚼速率', 0, 60, '单位/s'],
    ['temporaryBurrowChewPerSec', '临时洞咀嚼速率', 0, 60, '单位/s'],

    ['flowerHpTotal', '花朵生命回复总量', 0, 100, '生命'],
    ['flowerStaminaTotal', '花朵体力回复总量', 0, 100, '体力'],
    ['flowerRecoverySeconds', '花朵回复时长', 0, 60, 's'],
    ['companionFollowSpeed', '伙伴跟随速度', 1, 20, 'm/s'],
    ['companionFollowGap', '伙伴跟随间距', 0.2, 5, 'm'],
    ['grazeEyeDropExtra', '啃食视高额外下降', 0, 1, 'm'],
    ['thirdPersonGrazeDrop', '第三人称啃食视高下降', 0, 2, 'm'],
    ['lungeLockRange', '扑击锁敌距离', 1, 20, 'm'],
    ['stunDiminishWindow', '眩晕递减窗口', 0, 20, 's'],
    ['stunDiminishFactor', '眩晕递减倍率', 0, 1, '×'],
    ['bgmCombatLatchSeconds', '受击后战斗BGM保持', 5, 120, 's'],
    ['stunDiminishFloor', '眩晕递减下限', 0, 5, 's'],
    ['stunDiminishResetSeconds', '眩晕递减清零时间', 0, 30, 's'],
  ]) e.push(num(`beta.${k}`, G_BETA, label, F_BETA, `BETA_TUNE.${k}`, BETA_TUNE[k], { min, max, unit }));
  e.push(num('beta.grazeImmediateShare', G_BETA, '吃草即时转化率', F_BETA, 'BETA_TUNE.grazeImmediateShare', BETA_TUNE.grazeImmediateShare, { min: 0, max: 1, toView: (v) => v * 100, toStore: (v) => v / 100, unit: '%' }));
  e.push(num('beta.staminaFatThreshold', G_BETA, '体力转储备阈值', F_BETA, 'BETA_TUNE.staminaFatThreshold', BETA_TUNE.staminaFatThreshold, { min: 0, max: 0.99, toView: (v) => v * 100, toStore: (v) => v / 100, unit: '%' }));
  e.push(num('beta.grazeConeHalfAngle', G_BETA, '吃草锥半角', F_BETA, 'BETA_TUNE.grazeConeHalfAngle', BETA_TUNE.grazeConeHalfAngle, { min: 0, max: Math.PI, toView: deg, toStore: (v) => v * Math.PI / 180, unit: '°' }));
  e.push(num('beta.lungeLockHalfAngle', G_BETA, '扑击锁敌半角', F_BETA, 'BETA_TUNE.lungeLockHalfAngle', BETA_TUNE.lungeLockHalfAngle, { min: 0.05, max: Math.PI, toView: deg, toStore: (d) => d * Math.PI / 180, unit: '°' }));
  e.push(num('beta.smartPounceAimOffsetScale', G_BETA, '智能狐扑击战术偏移倍率', F_BETA, 'BETA_TUNE.smartPounceAimOffsetScale', BETA_TUNE.smartPounceAimOffsetScale, { min: 0, max: 1, unit: '×' }));
  e.push(num('beta.smartPounceMinDistance', G_BETA, '智能狐扑击最小提交距离', F_BETA, 'BETA_TUNE.smartPounceMinDistance', BETA_TUNE.smartPounceMinDistance, { min: 1, max: 15, unit: 'm' }));
  e.push(num('beta.smartPounceMaxDistance', G_BETA, '智能狐扑击最大提交距离', F_BETA, 'BETA_TUNE.smartPounceMaxDistance', BETA_TUNE.smartPounceMaxDistance, { min: 1, max: 20, unit: 'm' }));
  e.push(num('beta.smartPounceApproachRadius', G_BETA, '智能狐扑击接近停靠半径', F_BETA, 'BETA_TUNE.smartPounceApproachRadius', BETA_TUNE.smartPounceApproachRadius, { min: 2, max: 10, unit: 'm' }));
  e.push(num('beta.smartPounceObserveRadius', G_BETA, '智能狐观察停靠半径', F_BETA, 'BETA_TUNE.smartPounceObserveRadius', BETA_TUNE.smartPounceObserveRadius, { min: 4, max: 12, unit: 'm' }));
  e.push(num('beta.smartPounceDashEndDistance', G_BETA, '智能狐冲刺结束距离', F_BETA, 'BETA_TUNE.smartPounceDashEndDistance', BETA_TUNE.smartPounceDashEndDistance, { min: 0.5, max: 4, unit: 'm' }));
  e.push(num('beta.smartPounceMemoryPenalty', G_BETA, '智能狐记忆抑制系数', F_BETA, 'BETA_TUNE.smartPounceMemoryPenalty', BETA_TUNE.smartPounceMemoryPenalty, { min: 0, max: 1 }));
  e.push(num('beta.smartPounceFatiguePenalty', G_BETA, '智能狐疲劳抑制系数', F_BETA, 'BETA_TUNE.smartPounceFatiguePenalty', BETA_TUNE.smartPounceFatiguePenalty, { min: 0, max: 1 }));

  e.push(num('beta.smartPounceHitRadiusCap', G_BETA, '智能狐扑击命中半径上限', F_BETA, 'BETA_TUNE.smartPounceHitRadiusCap', BETA_TUNE.smartPounceHitRadiusCap, { min: 1.7, max: 3, unit: 'm' }));
  e.push(num('beta.smartPounceLeadSeconds', G_BETA, '智能狐移动目标提前量', F_BETA, 'BETA_TUNE.smartPounceLeadSeconds', BETA_TUNE.smartPounceLeadSeconds, { min: 0, max: 0.5, unit: 's' }));
  e.push(num('beta.smartPounceMaxLeadDistance', G_BETA, '智能狐提前量距离上限', F_BETA, 'BETA_TUNE.smartPounceMaxLeadDistance', BETA_TUNE.smartPounceMaxLeadDistance, { min: 0, max: 3, unit: 'm' }));
  e.push(num('beta.smartPounceStrikeSpeed', G_BETA, '智能狐扑击速度', F_BETA, 'BETA_TUNE.smartPounceStrikeSpeed', BETA_TUNE.smartPounceStrikeSpeed, { min: 2, max: 25, unit: 'm/s' }));
  e.push(num('beta.smartPounceStrikeTime', G_BETA, '智能狐扑击位移时长', F_BETA, 'BETA_TUNE.smartPounceStrikeTime', BETA_TUNE.smartPounceStrikeTime, { min: 0.05, max: 0.8, unit: 's' }));
  e.push(bool('beta.flowerInstant', G_BETA, '吃花立即完成', F_BETA, 'BETA_TUNE.flowerInstant', BETA_TUNE.flowerInstant));

  const G_BURROW = '洞穴与避难';
  for (const [k, label, min, max, unit] of [['x', '主洞 X 坐标', -100, 100, 'm'], ['z', '主洞 Z 坐标', -100, 100, 'm'], ['r', '主洞半径', 1, 30, 'm']])
    e.push(num(`burrow.${k}`, G_BURROW, label, F_CONFIG, `BURROW.${k}`, BURROW[k], { min, max, unit }));
  for (const [k, label, min, max, unit] of [
    ['lingerBase', '主洞停留基准', 0, 20, 's'], ['lingerShelter', '避难洞停留', 0, 20, 's'],
    ['lingerRadius', '停留活动半径', 0, 30, 'm'], ['leaveDistance', '离洞距离阈值', 0, 100, 'm'],
    ['exitMemory', '离洞记忆时长', 0, 20, 's'], ['exitNearOverride', '近洞离开覆盖距离', 0, 20, 'm'],
  ]) e.push(num(`burrowAI.${k}`, G_BURROW, label, F_CONFIG, `BURROW_AI.${k}`, BURROW_AI[k], { min, max, unit }));
  for (const [space, cfg] of Object.entries(UNDERGROUND)) {
    for (const [k, label, min, max, unit] of [
      ['openingRadius', '洞口半径', 0.2, 10, 'm'], ['slopeRadius', '开口坡外缘半径', 0.2, 15, 'm'],
      ['chamberRadius', '腔室半径', 0.2, 15, 'm'], ['chamberDepth', '腔室深度', 0.2, 20, 'm'],
      ['lightIntensity', '洞内光照强度', 0, 20, ''],
    ]) e.push(num(`underground.${space}.${k}`, G_BURROW, `${space === 'base' ? '主洞' : '避难洞'}·${label}`, F_CONFIG, `UNDERGROUND.${space}.${k}`, cfg[k], { min, max, unit }));
    e.push(num(`underground.${space}.lightColor`, G_BURROW, `${space === 'base' ? '主洞' : '避难洞'}·灯光颜色值`, F_CONFIG, `UNDERGROUND.${space}.lightColor`, cfg.lightColor, { min: 0, max: 0xffffff, step: 1 }));
    e.push(bool(`underground.${space}.warmLight`, G_BURROW, `${space === 'base' ? '主洞' : '避难洞'}·暖光`, F_CONFIG, `UNDERGROUND.${space}.warmLight`, cfg.warmLight));
  }

  const G_FOX = '狐狸 · 基础';
  e.push(num('fox.windRange', G_FOX, '蓄力触发距离', F_CONFIG, 'FOX.windRange', FOX.windRange, { min: 1, max: 25, unit: 'm' }));
  e.push(num('fox.dashSpeed', G_FOX, '冲刺速度', F_CONFIG, 'FOX.dashSpeed', FOX.dashSpeed, { min: 2, max: 30, unit: 'm/s' }));
  e.push(num('fox.roamRange', G_FOX, '感知半径', F_CONFIG, 'FOX.roamRange', FOX.roamRange, { min: 5, max: 120, unit: 'm' }));
  e.push(num('fox.fleeSpeed', G_FOX, '逃跑速度', F_CONFIG, 'FOX.fleeSpeed', FOX.fleeSpeed, { min: 1, max: 15, unit: 'm/s' }));
  e.push(num('fox.fleeMaxTime', G_FOX, '逃跑时间上限', F_CONFIG, 'FOX.fleeMaxTime', FOX.fleeMaxTime, { min: 0.5, max: 10, unit: 's' }));
  e.push(num('fox.groundAttackHeight', G_FOX, '地面攻击盒高度', F_CONFIG, 'FOX.groundAttackHeight', FOX.groundAttackHeight, { min: 0.05, max: 2, unit: 'm' }));
  for (const [k, label] of [['maxTurnRate', '冲刺最大转向'], ['turnAccel', '转向加速度'], ['windTurnRate', '蓄力转向速率'], ['windTurnAccel', '蓄力转向加速度'], ['maxTurnSlow', '低速转向速率'], ['turnSpeedK', '转向速度衰减'], ['minTurnRate', '最小转向速率'], ['locomotionTurnAccel', '行走转向加速度'], ['locomotionAccel', '行走加速度'], ['brakeLerp', '刹车插值'], ['recoverySpeedMax', '恢复期速度上限']])
    e.push(num(`fox.handling.${k}`, G_FOX, `操控·${label}`, F_CONFIG, `FOX.handling.${k}`, FOX.handling[k], { min: 0 }));
  for (const [k, label] of [['normal', '普通'], ['fast', '疾冲'], ['leap', '跃扑'], ['combo', '连冲'], ['blocked', '被格挡']])
    e.push(num(`fox.recovery.${k}`, G_FOX, `后摇·${label}`, F_CONFIG, `FOX.recovery.${k}`, FOX.recovery[k], { min: 0, max: 4, unit: 's' }));

  e.push(bool('fox.useProcedural', G_FOX, '启用程序化狐狸', F_CONFIG, 'FOX.useProcedural', FOX.useProcedural));
  for (const [type, color] of Object.entries(FOX.proceduralColors))
    e.push(num(`fox.proceduralColor.${type}`, G_FOX, `程序化毛色·${type}`, F_CONFIG, `FOX.proceduralColors.${type}`, color, { min: 0, max: 0xffffff, step: 1 }));

  const G_FOXT = '狐狸 · 类型表';
  const TYPE_LABEL = { normal: '普通狐', pup: '幼狐', fast: '疾行狐', heavy: '厚皮狐', boss: '狐首领' };
  for (const type of Object.keys(FOX.types)) {
    const t = FOX.types[type];
    const tl = TYPE_LABEL[type] || type;
    for (const [k, label, min, max] of [['hp', '血量', 1, 40], ['speed', '速度倍率', 0.2, 3], ['wind', '蓄力倍率', 0.2, 3], ['mass', '质量(抗击退)', 0.1, 3], ['knockbackMul', '击退倍率', 0, 3], ['scale', '体型缩放', 0.3, 2.5]])
      e.push(num(`foxType.${type}.${k}`, G_FOXT, `${tl}·${label}`, F_CONFIG, `FOX.types.${type}.${k}`, t[k], { min, max }));
  }
  for (const key of Object.keys(FOX.collisionRadius)) {
    const tl = TYPE_LABEL[key] || key;
    e.push(num(`foxCol.${key}.radius`, G_FOXT, `${tl}·碰撞半径`, F_CONFIG, `FOX.collisionRadius.${key}`, FOX.collisionRadius[key], { min: 0.1, max: 3, unit: 'm' }));
    e.push(num(`foxCol.${key}.height`, G_FOXT, `${tl}·碰撞高度`, F_CONFIG, `FOX.collisionHeight.${key}`, FOX.collisionHeight[key], { min: 0.1, max: 2, unit: 'm' }));
  }
  for (const key of Object.keys(FOX.damage)) {
    const tl = TYPE_LABEL[key] || (key === 'default' ? '默认' : key);
    e.push(num(`foxDamage.${key}`, G_FOXT, `${tl}·伤害`, F_CONFIG, `FOX.damage.${key}`, FOX.damage[key], { min: 0, max: 60, step: 1 }));
  }

  const G_ATK = '狐狸 · 攻击档案';
  for (const type of Object.keys(FOX.attacks)) {
    const a = FOX.attacks[type];
    const tl = TYPE_LABEL[type] || type;
    e.push(en(`foxAtk.${type}.mode`, G_ATK, `${tl}·行为模式`, F_CONFIG, `FOX.attacks.${type}.mode`, a.mode, ['straight', 'leap', 'circle', 'combo']));
    for (const [k, label, min, max, unit] of [
      ['windMul', '蓄力时长倍率', 0.2, 3, ''], ['dashTime', '冲刺持续', 0.05, 2, 's'],
      ['turnRate', '冲刺转向速率', 0, 3, 'rad/s'], ['windLeadTime', '预瞄提前量', 0, 2, 's'],
      ['dashSpeedMul', '冲刺速度倍率', 0.2, 3, ''], ['circleTime', '绕行时长', 0.2, 4, 's'],
      ['lureChance', '虚晃概率', 0, 1, ''], ['leapHeight', '跃扑高度', 0, 3, 'm'],
      ['comboCount', '连冲段数', 1, 6, '段'],
    ]) {
      if (a[k] == null) continue;
      e.push(num(`foxAtk.${type}.${k}`, G_ATK, `${tl}·${label}`, F_CONFIG, `FOX.attacks.${type}.${k}`, a[k], { min, max, step: k === 'comboCount' ? 1 : undefined, unit }));
    }
  }

  const G_SMART = '狐狸 · 智能 AI 扑击';
  e.push(num('smart.pounce.minDistance', G_SMART, '扑击最小距离', F_SMART, 'SMART_POUNCE.minDistance', SMART_POUNCE.minDistance, { min: 0.5, max: 15, unit: 'm' }));
  e.push(num('smart.pounce.maxDistance', G_SMART, '扑击最大距离', F_SMART, 'SMART_POUNCE.maxDistance', SMART_POUNCE.maxDistance, { min: 1, max: 25, unit: 'm' }));
  e.push(num('smart.pounce.maxAngle', G_SMART, '扑击最大角度', F_SMART, 'SMART_POUNCE.maxAngle', SMART_POUNCE.maxAngle, { min: 0.02, max: Math.PI / 2, toView: deg, toStore: (d) => d * Math.PI / 180, unit: '°' }));
  e.push(num('smart.pounce.windup', G_SMART, '扑击前摇', F_SMART, 'SMART_POUNCE.windup', SMART_POUNCE.windup, { min: 0, max: 2, unit: 's' }));
  e.push(num('smart.pounce.speed', G_SMART, '扑击速度', F_SMART, 'SMART_POUNCE.speed', SMART_POUNCE.speed, { min: 1, max: 25, unit: 'm/s' }));
  e.push(num('smart.pounce.lockTime', G_SMART, '扑击锁定时长', F_SMART, 'SMART_POUNCE.lockTime', SMART_POUNCE.lockTime, { min: 0.1, max: 3, unit: 's' }));
  e.push(num('smart.pounceCooldown', G_SMART, '扑击冷却', F_SMART, 'SMART_POUNCE_COOLDOWN', SMART_POUNCE_COOLDOWN, { min: 0, max: 5, unit: 's' }));
  e.push(num('smart.recoverLock', G_SMART, '恢复锁定', F_SMART, 'RECOVER_LOCK', RECOVER_LOCK, { min: 0, max: 3, unit: 's' }));
  for (const k of Object.keys(SMART_PHASE_MIN)) {
    const pl = { observe: '观察', approach: '接近', wind: '蓄力', pounce: '扑击', recover: '恢复' }[k] || k;
    e.push(num(`smart.phaseMin.${k}`, G_SMART, `相位最短停留·${pl}`, F_SMART, `SMART_PHASE_MIN.${k}`, SMART_PHASE_MIN[k], { min: 0, max: 3, unit: 's' }));
  }

  for (const [k, value] of Object.entries(SMART_WEIGHTS))
    e.push(num(`smart.weight.${k}`, G_SMART, `AI 意图权重·${k}`, F_SMART, `SMART_WEIGHTS.${k}`, value, { min: 0, max: 2 }));
  // smart-fox-core.mjs 中的默认参数（函数参数默认值，无具名导出常量）。
  e.push(num('smart.memoryDelay', G_SMART, '中断记忆衰减延迟', F_SMART, 'updateSmartMemory(options.memoryDelay 默认值)', 10, { min: 0, max: 60, unit: 's' }));
  e.push(num('smart.memoryDecay', G_SMART, '中断记忆衰减速度', F_SMART, 'updateSmartMemory(options.memoryDecay 默认值)', 0.05, { min: 0, max: 1 }));
  e.push(num('smart.viewRange', G_SMART, '默认感知距离', F_SMART, 'updatePerception(input.viewRange 默认值)', 28, { min: 1, max: 100, unit: 'm' }));
  e.push(num('smart.detectionRate', G_SMART, '默认警觉上升速度', F_SMART, 'updatePerception(input.detectionRate 默认值)', 1.8, { min: 0, max: 10 }));
  e.push(num('smart.decayRate', G_SMART, '默认警觉衰减速度', F_SMART, 'updatePerception(input.decayRate 默认值)', 0.48, { min: 0, max: 5 }));
  e.push(num('smart.pounceAcceleration', G_SMART, '扑击加速度', F_SMART, 'stepSmartMotion(options.acceleration 默认值)', 18, { min: 0, max: 60, unit: 'm/s²' }));
  e.push(num('smart.defaultSeparationDistance', G_SMART, '群体分离距离', F_SMART, 'separationVector(minDistance 默认值)', 1.8, { min: 0, max: 10, unit: 'm' }));
  e.push(num('smart.defaultSeparationStrength', G_SMART, '群体分离强度', F_SMART, 'separationVector(strength 默认值)', 2.4, { min: 0, max: 10 }));
  e.push(num('smart.defaultDebounceHold', G_SMART, '意图切换确认时间', F_SMART, 'debounceIntent(options.hold 默认值)', 0.25, { min: 0, max: 3, unit: 's' }));
  e.push(num('smart.defaultWalkableLayerTolerance', G_SMART, '地面层采样容差', F_SMART, 'sampleWalkableGround(layerTolerance 默认值)', 0.28, { min: 0, max: 2, unit: 'm' }));
  e.push(num('smart.defaultGroundStepRate', G_SMART, '地面高度跟随速率', F_SMART, 'stepGroundY(maxRate 默认值)', 3.2, { min: 0, max: 15, unit: 'm/s' }));
  e.push(num('smart.packWindow', G_SMART, '群体出击提交窗口', F_SMART, 'createSmartPack.canCommit 1.2 秒窗口', 1.2, { min: 0, max: 5, unit: 's' }));
  e.push(num('smart.packSpacing', G_SMART, '群体出击最小间隔', F_SMART, 'createSmartPack.canCommit 0.35 秒间隔', 0.35, { min: 0, max: 2, unit: 's' }));
  e.push(num('smart.packSlotSpacing', G_SMART, '群体槽位间隔增量', F_SMART, 'createSmartPack.canCommit 0.025 秒增量', 0.025, { min: 0, max: 0.5, unit: 's' }));

  // 配置导出中其余数值叶子：关卡表、洞穴/避难洞布局、刷新点和岩石障碍。
  // 这些值也参与总览/JSON 导入导出，确保配置文件中没有丢失地图和平衡参数。
  const G_WORLD = '世界 · 关卡与布局';
  const labelFor = (key) => ({
    count: '数量', speed: '速度', goal: '采食目标', time: '限时', wind: '蓄力基准', reinforce: '增援间隔',
    fogNear: '雾近端', fogFar: '雾远端', windGust: '阵风强度', lureBias: '虚晃倍率', sunIntensity: '阳光强度',
    ambient: '环境光强', x: 'X 坐标', z: 'Z 坐标', r: '半径', regenMul: '恢复倍率',
    openingRadius: '洞口半径', slopeRadius: '坡缘半径', chamberRadius: '腔室半径', chamberDepth: '腔室深度',
    lightIntensity: '洞穴灯光强度',
  })[key] || key;
  const addTree = (obj, path, sourceRoot, levelName = '') => {
    if (typeof obj === 'number' && Number.isFinite(obj)) {
      const leaf = path.split('.').at(-1);
      const id = `world.${path}`;
      const pointCollection = path.split('.')[0];
      const isPointArray = ['BERRY_POINTS', 'SPAWN_POINTS', 'ROCKS'].includes(pointCollection);
      const isCoord = ['x', 'z'].includes(leaf) || (isPointArray && ['0', '1'].includes(leaf));
      const isTime = /time|wind|reinforce/i.test(leaf) && !/windGust/i.test(leaf);
      const color = /color$/i.test(leaf);
      const unit = color ? '' : isCoord || /Radius|Depth|^r$/i.test(leaf) ? 'm' : isTime ? 's' : '';
      const min = color ? 0 : isCoord ? -150 : obj < 0 ? Math.min(-1, obj * 2) : 0;
      const max = color ? 0xffffff : isCoord ? 150 : Math.max(obj * 3, obj + 1);
      const parts = path.split('.');
      let display = labelFor(leaf);
      if (['BERRY_POINTS', 'SPAWN_POINTS', 'ROCKS'].includes(pointCollection)) {
        const item = Number(parts[1]) + 1;
        const axis = parts[2] === '0' ? 'X' : parts[2] === '1' ? 'Z' : parts[2] === '2' ? '半径' : `值${Number(parts[2]) + 1}`;
        const prefix = pointCollection === 'BERRY_POINTS' ? '浆果点' : pointCollection === 'SPAWN_POINTS' ? '狐狸刷新点' : '岩石';
        display = `${prefix}${item}·${axis}`;
      } else if (parts.includes('friend')) {
        const axis = parts.at(-1) === '0' ? 'X' : 'Z';
        display = `伙伴位置·${axis}`;
      }
      e.push(num(id, G_WORLD, `${levelName ? `${levelName}·` : ''}${display}`, F_CONFIG, path, obj, { min, max, step: color ? 1 : undefined, unit }));
      return;
    }
    if (typeof obj === 'boolean') {
      const parts = path.split('.');
      const leaf = parts.at(-1);
      e.push(bool(`world.${path}`, G_WORLD, `${levelName ? `${levelName}·` : ''}${labelFor(leaf)}`, F_CONFIG, path, obj));
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((v, i) => addTree(v, `${path}.${i}`, sourceRoot, levelName));
      return;
    }
    if (obj && typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'friend') { // 坐标数组逐项命名
          addTree(value, `${path}.friend`, sourceRoot, levelName);
        } else if (key === 'types' || key === 'sky' || key === 'grass' || key === 'fog' || key === 'sun' || key === 'name' || key === 'brief' || key === 'label' || key === 'id' || key === 'type') {
          continue;
        } else {
          const nextLevel = path === 'LEVELS' && key === 'name' ? String(value) : levelName;
          addTree(value, path ? `${path}.${key}` : key, sourceRoot, nextLevel);
        }
      }
    }
  };
  BURROWS.slice(1).forEach((burrow, i) => addTree(burrow, `BURROWS.${i + 1}`, 'BURROWS'));
  // Levels: retain Chinese name in label and keep exact path/index as source.
  LEVELS.forEach((level, i) => {
    const title = `第${i + 1}关 ${level.name || ''}`.trim();
    for (const [key, value] of Object.entries(level)) {
      if (['name', 'brief', 'types', 'sky', 'grass', 'fog', 'sun', 'friend'].includes(key)) {
        if (key === 'friend') addTree(value, `LEVELS.${i}.friend`, 'LEVELS', title);
        continue;
      }
      addTree(value, `LEVELS.${i}.${key}`, 'LEVELS', title);
    }
  });
  addTree(BERRY_POINTS, 'BERRY_POINTS', 'BERRY_POINTS');
  addTree(SPAWN_POINTS, 'SPAWN_POINTS', 'SPAWN_POINTS');
  addTree(ROCKS, 'ROCKS', 'ROCKS');

  const G_MISC = '其它 · 浆果与伙伴';
  e.push(num('misc.berryRadius', G_MISC, '浆果拾取半径', F_CONFIG, 'BERRY_RADIUS', BERRY_RADIUS, { min: 0.1, max: 3, unit: 'm' }));
  e.push(num('misc.berryEnergy', G_MISC, '浆果回能量', F_CONFIG, 'BERRY_ENERGY', BERRY_ENERGY, { min: 0, max: 100, step: 1 }));
  e.push(num('misc.berryCharge', G_MISC, '浆果蓄力充能', F_CONFIG, 'BERRY_CHARGE', BERRY_CHARGE, { min: 0, max: 50, step: 1 }));
  e.push(num('misc.companionFollowSpeed', G_MISC, '伙伴跟随速度(基准)', F_CONFIG, 'COMPANION_FOLLOW_SPEED', COMPANION_FOLLOW_SPEED, { min: 1, max: 20, unit: 'm/s' }));
  e.push(num('misc.companionCatchDist', G_MISC, '伙伴追上距离', F_CONFIG, 'COMPANION_CATCH_DIST', COMPANION_CATCH_DIST, { min: 0.3, max: 6, unit: 'm' }));
  e.push(num('misc.rescueDist', G_MISC, '救援距离', F_CONFIG, 'RESCUE_DIST', RESCUE_DIST, { min: 0.3, max: 6, unit: 'm' }));
  e.push(num('misc.socialRange', G_MISC, '社交范围', F_CONFIG, 'SOCIAL_RANGE', SOCIAL_RANGE, { min: 0.5, max: 8, unit: 'm' }));
  e.push(num('misc.fieldW', G_MISC, '场地宽', F_CONFIG, 'FIELD_W', FIELD_W, { min: 20, max: 300, unit: 'm' }));
  e.push(num('misc.fieldH', G_MISC, '场地高', F_CONFIG, 'FIELD_H', FIELD_H, { min: 20, max: 300, unit: 'm' }));

  for (const entry of e) entry.help = describeEntry(entry);
  return e;
}

/** 条目 id → entry 索引。 */
export function indexEntries(entries) {
  const map = new Map();
  for (const e of entries) map.set(e.id, e);
  return map;
}

/** 以「存储单位」（源码单位，如弧度）表示的默认值表。 */
export function defaultValues(entries) {
  const out = {};
  for (const e of entries) out[e.id] = e.def;
  return out;
}

/** 钳制/规整一个「存储单位」值；非法输入返回默认值。 */
export function clampStored(entry, value) {
  if (entry.kind === 'boolean') return value === true || value === 'true' || value === 1;
  if (entry.kind === 'enum') return entry.options.includes(value) ? value : entry.def;
  const n = Number(value);
  if (!Number.isFinite(n)) return entry.def;
  return Math.min(entry.toStore ? entry.toStore(entry.max) : entry.max, Math.max(entry.toStore ? entry.toStore(entry.min) : entry.min, n));
}

/** 存储值 → 面板展示值。 */
export function toView(entry, stored) {
  return entry.toView ? entry.toView(stored) : stored;
}
/** 面板展示值 → 存储值（含钳制）。 */
export function toStored(entry, viewValue) {
  if (entry.kind !== 'number') return clampStored(entry, viewValue);
  const n = Number(viewValue);
  if (!Number.isFinite(n)) return entry.def;
  const clampedView = Math.min(entry.max, Math.max(entry.min, n));
  return entry.toStore ? entry.toStore(clampedView) : clampedView;
}

/** 新建预览态：默认值的副本。 */
function syncContactPreviewAliases(values) {
  // 仅供 3D 预览旧接触环读取：不是 schema 条目，不产生旋钮，也不参与配置导出。
  // 与 main.js 的真实命中公式一致：玩家半径 + 对应狐狸碰撞半径。
  for (const type of Object.keys(FOX.collisionRadius))
    values[`foxContact.${type}`] = values['player.radius'] + (values[`foxCol.${type}.radius`] ?? values['foxCol.normal.radius']);
  values['foxContact.default'] = values['player.radius'] + values['foxCol.normal.radius'];
}

export function createTuningState(entries) {
  const state = { values: defaultValues(entries), dirty: new Set() };
  syncContactPreviewAliases(state.values);
  return state;
}

/** 设置一个展示值，返回实际存储值。 */
export function setViewValue(entriesById, state, id, viewValue) {
  const entry = entriesById.get(id);
  if (!entry) return null;
  const stored = toStored(entry, viewValue);
  state.values[id] = stored;
  syncContactPreviewAliases(state.values);
  if (Object.is(stored, entry.def)) state.dirty.delete(id);
  else state.dirty.add(id);
  return stored;
}

/** 恢复某分组（或全部）到默认。返回被重置的 id 列表。 */
export function resetGroup(state, entries, group = null) {
  const reset = [];
  for (const e of entries) {
    if (group && e.group !== group) continue;
    state.values[e.id] = e.def;
    state.dirty.delete(e.id);
    reset.push(e.id);
  }
  syncContactPreviewAliases(state.values);
  return reset;
}

/** 全局搜索过滤：按中文名 / 常量名 / 来源 / id 匹配（大小写不敏感）。 */
export function filterEntries(entries, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) =>
    e.label.toLowerCase().includes(q)
    || e.id.toLowerCase().includes(q)
    || e.source.toLowerCase().includes(q)
    || e.group.toLowerCase().includes(q));
}

/** 导出：人类可读 JSON（含 schemaVersion 与来源标注）。纯函数。 */
export function serializeConfig(entries, state) {
  const byGroup = {};
  for (const e of entries) {
    const v = state.values[e.id];
    if (!byGroup[e.group]) byGroup[e.group] = {};
    byGroup[e.group][e.id] = { value: v, default: e.def, label: e.label, source: e.source, file: e.file, modified: !Object.is(v, e.def) };
  }
  return {
    schemaVersion: ADMIN_SCHEMA_VERSION,
    app: 'marmot3d-beta-admin',
    exportedAt: new Date().toISOString(),
    groups: Object.keys(byGroup),
    values: Object.fromEntries(entries.map((e) => [e.id, state.values[e.id]])),
    detail: byGroup,
  };
}

/**
 * 解析导入文本。返回 { ok, error?, data? }。
 * 只接受 serializeConfig 产出的结构（或至少含 schemaVersion + values 对象）。
 */
export function parseConfigText(text) {
  let data;
  try { data = JSON.parse(text); } catch (err) { return { ok: false, error: `JSON 解析失败：${err.message}` }; }
  if (!data || typeof data !== 'object') return { ok: false, error: '导入内容不是 JSON 对象' };
  if (data.schemaVersion !== ADMIN_SCHEMA_VERSION) return { ok: false, error: `schemaVersion 不匹配：期望 ${ADMIN_SCHEMA_VERSION}，实际 ${data.schemaVersion}` };
  if (!data.values || typeof data.values !== 'object' || Array.isArray(data.values)) return { ok: false, error: '缺少 values 对象' };
  return { ok: true, data };
}

/**
 * 把导入的 values 合并进当前 state：
 *  - 未知字段忽略并记录到 ignored
 *  - 非法值钳制到合法范围并记录到 clamped
 * 返回 { applied, ignored, clamped }（均为 id 列表 / {id, from, to} 列表）。
 */
export function applyImport(entries, entriesById, state, data) {
  const applied = [];
  const ignored = [];
  const clamped = [];
  for (const [id, raw] of Object.entries(data.values || {})) {
    const entry = entriesById.get(id);
    if (!entry) { ignored.push(id); continue; }
    const stored = clampStored(entry, raw);
    if (!Object.is(stored, raw) && !(entry.kind === 'number' && Number(raw) === stored)) clamped.push({ id, from: raw, to: stored });
    state.values[id] = stored;
    if (Object.is(stored, entry.def)) state.dirty.delete(id);
    else state.dirty.add(id);
    applied.push(id);
  }
  syncContactPreviewAliases(state.values);
  return { applied, ignored, clamped };
}

/** 导出→导入 往返等价性检查辅助（测试用）：序列化后再合并应得到相同 values。 */
export function roundTrip(entries, entriesById, state) {
  const text = JSON.stringify(serializeConfig(entries, state));
  const parsed = parseConfigText(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const fresh = createTuningState(entries);
  const res = applyImport(entries, entriesById, fresh, parsed.data);
  for (const e of entries) {
    if (!Object.is(fresh.values[e.id], state.values[e.id])) return { ok: false, error: `往返不一致：${e.id}` };
  }
  return { ok: true, ...res };
}

// ---------------- 服务器命名配置（保存/加载/删除）纯逻辑 ----------------
// 说明：服务端单配置上限 100KB。含 detail 的完整导出在默认值时已约 107KB，
// 因此服务器通道只存 {schemaVersion, app, savedAt, values} 精简结构（约 16KB），
// 与文件导出通道相互独立；parseConfigText 同样接受该结构。

/** 配置名规则：1-50 位，中英文/数字/连字符/下划线（与服务端 CONFIG_NAME_RE 一致）。 */
export const CONFIG_NAME_RE = /^[\p{L}\p{N}_\-]{1,50}$/u;

/** 校验并规范化配置名（trim）。返回 {ok, name} 或 {ok:false, error}。 */
export function validateConfigName(input) {
  const name = typeof input === 'string' ? input.trim() : '';
  if (!name) return { ok: false, error: '请输入配置名字' };
  if (!CONFIG_NAME_RE.test(name)) return { ok: false, error: '名字限 1-50 位，可用中英文/数字/连字符/下划线' };
  return { ok: true, name };
}

/**
 * 由当前页面路径推导 API 基址。
 * /marmot3d-beta/admin.html -> /marmot3d-beta/api
 * 其它部署（/x/admin.html）-> /x/api；根路径（/admin.html）-> /api。
 */
export function deriveApiBase(pathname) {
  const p = String(pathname || '/');
  const m = /^(.*\/marmot3d-beta)(?:\/|$)/u.exec(p);
  let prefix;
  if (m) prefix = m[1];
  else if (/(^|\/)admin\.html$/u.test(p)) prefix = p.replace(/admin\.html$/u, '').replace(/\/$/u, '');
  else prefix = p.replace(/\/[^/]*$/u, '');
  return `${prefix}/api`;
}

/** 配置列表/保存地址。 */
export function configsIndexUrl(base) { return `${base}/configs`; }
/** 单个配置地址（名字经 URL 编码，支持中文）。 */
export function configItemUrl(base, name) { return `${base}/configs/${encodeURIComponent(name)}`; }

/** 列表中已存在同名配置时，保存前需要内联确认覆盖。纯判断。 */
export function needsOverwriteConfirm(existingNames, name) {
  const n = typeof name === 'string' ? name.trim() : '';
  for (const x of existingNames || []) if (x === n) return true;
  return false;
}

/** 服务器配置精简序列化（与文件导出共用 schemaVersion/values 语义）。 */
export function serializeSavedConfig(entries, state, at = new Date().toISOString()) {
  return {
    schemaVersion: ADMIN_SCHEMA_VERSION,
    app: 'marmot3d-beta-admin',
    savedAt: at,
    values: Object.fromEntries(entries.map((e) => [e.id, state.values[e.id]])),
  };
}

/** 解析服务器取回的配置对象。返回 {ok, data?, error?}。 */
export function parseSavedConfig(config) {
  let text;
  try { text = JSON.stringify(config); } catch { return { ok: false, error: '配置内容无法序列化' }; }
  return parseConfigText(text);
}

/** 字节数展示。 */
export function formatConfigSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '';
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

/** ISO 时间展示（失败回退原值）。 */
export function formatConfigTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || '');
  try { return d.toLocaleString('zh-CN', { hour12: false }); } catch { return String(iso); }
}
