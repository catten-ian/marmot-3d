/**
 * 战斗数值内核 —— 严格移植自 2D 原版的 combatStats()。
 *
 * 设计意图（游戏化抽象，非生理定量结论）：
 *   - 应急爆发 boost     ：短时资源动员，攻击 +2、范围 +40、攻速提升
 *   - 持续动员 cortisol  ：较慢的分级调节，达 25/60 分档给攻击加成
 *   - 协同大招 overdrive ：蓄满后的范围冲击，强力但结束后疲劳
 *   - 应激负荷 stress ≥75 ：过载惩罚，伤害 -25%、移速 -18%、攻速下降
 *   - 疲劳 fatigue / 储备见底 weak：双向下调压力
 */
import { clamp } from '../core/utils.js';
import { devOn } from '../core/version.js';
import { HERBIVORE } from '../core/ecology.js';

export function verticalHitOverlap(aBottom, aHeight, bBottom, bHeight) {
  return aBottom < bBottom + bHeight && bBottom < aBottom + aHeight;
}

// 三维近战体：水平仍是前方扇形，垂直则是从脚边到头顶的短柱体。
// 这些值刻意比旧 dot=0.34 更宽容，但不会覆盖身后或远处目标。
export const STRIKE_VOLUME = {
  halfAngle: 78 * Math.PI / 180,
  lower: 0.06,
  upper: 1.18,
};

export function strikeVolumeHit({ forward, lateral, playerBottom, targetBottom, targetHeight, range }) {
  const d = Math.hypot(forward, lateral);
  if (d > range) return false;
  // 距离几乎为零时没有可靠的水平朝向差，允许命中；仍必须通过垂直区间。
  if (d > 1e-6 && forward / d < Math.cos(STRIKE_VOLUME.halfAngle)) return false;
  const clawBottom = playerBottom + STRIKE_VOLUME.lower;
  const clawTop = playerBottom + STRIKE_VOLUME.upper;
  return verticalHitOverlap(clawBottom, clawTop - clawBottom, targetBottom, targetHeight);
}

export function foxAttackVerticalHit({ playerBottom, playerHeight, foxBottom, foxHeight, groundAttackHeight, mode, state }) {
  if (state !== 'dash') return false;
  // 普通冲刺是低位扑咬/擦撞，不随大型模型的耳尖高度抬高攻击盒。
  // 跃扑则采用狐狸真实腾空后的类型碰撞盒，仍能覆盖玩家空中轨迹。
  const attackHeight = mode === 'leap' ? foxHeight : groundAttackHeight;
  return verticalHitOverlap(playerBottom, playerHeight, foxBottom, attackHeight);
}

export function combatStats(g) {
  const p = g.player;
  const tier = g.cortisol >= 60 ? 2 : g.cortisol >= 25 ? 1 : 0;
  const boost = g.boost > 0;
  const ultimate = g.overdrive > 0;
  // dev 版「耐饥渴」：储备见底的判定线更低
  const weakThreshold = devOn('famineTolerance') ? HERBIVORE.weakThreshold : 8;
  const overloaded = p.stress >= 75;
  const weak = p.energy < weakThreshold;

  let damage = 1 + (boost ? 2 : 0) + (tier > 0 ? 1 : 0) + (ultimate ? 5 : 0);
  // 原版 90px ≈ 11m，但原版是俯视图贴图、视觉距离短。
  // 第一人称下土拨鼠视角距离感被放大，这里按可玩性重新标定：
  // 常态 2.4m（土拨鼠前爪可及范围），爆发 +1.1m，大招 +2.2m。
  let range = 2.4 + (boost ? 1.1 : 0) + tier * 0.35 + (ultimate ? 2.2 : 0);
  let cooldown = 0.58 * (boost ? 0.55 : 1) * (tier > 0 ? 0.9 : 1) * (ultimate ? 0.45 : 1);
  let speedMul =
    (boost ? 1.55 : 1) * (1 + tier * 0.04) * (ultimate ? 1.4 : 1);

  if (overloaded) { damage *= 0.75; cooldown *= 1.25; speedMul *= 0.82; }
  if (g.fatigue > 0) { speedMul *= 0.8; cooldown *= 1.3; }
  // 储备见底：dev 版耐饥渴 → 惩罚几乎可以忽略
  if (weak) {
    const sMul = devOn('famineTolerance') ? HERBIVORE.weakSpeedMul : 0.62;
    const dMul = devOn('famineTolerance') ? HERBIVORE.weakDamageMul : 0.8;
    speedMul *= sMul;
    damage *= dMul;
  }

  return {
    damage,
    range,
    cooldown: Math.max(0.18, cooldown),
    speedMul,
    knockback: 1.6 + (boost ? 1.1 : 0) + tier * 0.2 + (ultimate ? 1.6 : 0),
    stun: 0.6 + (boost ? 0.85 : 0) + tier * 0.1 + (ultimate ? 1.2 : 0),
    tier,
    overloaded,
    weak,
  };
}

export const BOOST = { duration: 4, cooldown: 12, cost: 15, minEnergy: 20 };
export const ULT = {
  duration: 5, cooldown: 24, cost: 25, radius: 11,
  invuln: 1.1, stressAdd: 16, hitDamage: 6,
};
export const STRIKE_COST = { base: 2, boost: 3.5, overdrive: 3 };

/** J —— 短时应急爆发 */
export function burst(g, say) {
  if (g.overdrive > 0) { say('大招正在生效，无需再开 J。', 1.5); return false; }
  if (g.boostCD > 0) { say(`J 冷却 ${Math.ceil(g.boostCD)} 秒。`, 1.3); return false; }
  if (g.player.energy < BOOST.minEnergy) {
    say('储备不足 20，先采食或回洞休息。', 1.5); return false;
  }
  g.player.energy -= BOOST.cost;
  g.boost = BOOST.duration;
  g.boostCD = BOOST.cooldown;
  g.boosts++;
  return true;
}

/** K —— 蓄满后的协同大招 */
export function ultimate(g, say) {
  if (g.charge < 100) {
    say(`蓄力 ${Math.round(g.charge)}/100，攻击命中、驱退和采食都能积累。`, 2.3);
    return false;
  }
  if (g.overdrive > 0 || g.overCD > 0) { say('K 大招冷却中。', 1.3); return false; }
  if (g.player.energy < ULT.cost) { say('大招需要 25 储备，先采食。', 1.5); return false; }
  g.player.energy -= ULT.cost;
  g.player.stress = clamp(g.player.stress + ULT.stressAdd, 0, 100);
  g.player.invuln = Math.max(g.player.invuln, ULT.invuln);
  g.overdrive = ULT.duration;
  g.overCD = ULT.cooldown;
  g.boost = 0;
  g.charge = 0;
  g.ultimates++;
  // 全屏白闪由调用方（main.js doUltimate → hud.flashScreen()）负责，
  // 这里不再维护无人消费的 g.flash 数值。
  return true;
}

/** E —— 救援 / 陪伴缓压（陪伴降低应激负荷，不直接回血） */
export function interact(g, say) {
  const f = g.friend;
  if (!f.rescued && !f.saved) { say('靠近被困伙伴，按 E 救援。', 1.4); return; }
  if (f.saved && g.inBurrow && g.socialCD <= 0) {
    g.social = 9;
    g.socialCD = 13;
    say('陪伴缓压：应激负荷下降，不直接回血。');
    return;
  }
  if (f.saved) say('回到洞穴内再使用 E 陪伴。', 1.4);
  else say('靠近被困伙伴再按 E。', 1.3);
}
