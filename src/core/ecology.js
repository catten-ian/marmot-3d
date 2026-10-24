/**
 * 旱獭生态学数据（dev / beta 版启用）。
 *
 * 资料要点（用于把数值机制与真实生态挂钩）：
 *   · 典型草食动物，耐饥渴
 *   · 主食为沙草料、禾本科植物的叶茎、豆科植物的花
 *   · 食物选择随季节变化：
 *       早春 → 冷蒿等
 *       晚春初夏 → 草类为主食
 *       夏末 → 偏向草本植物
 *   · 冬眠前与早春进食最强烈（为储备能量过冬）
 *   · 偏好富含脂肪的植物，尤其含亚油酸的植物
 *   · 饲养条件下更杂食，偏好含水量高的多汁饲料
 *
 * 说明：这些是**玩法设计依据**，不是营养学定量结论。
 * 玩家在游戏中看到的是"采食某种草本植物"，而不是激素或营养素的数值。
 */

/**
 * 关卡按五季循环映射。
 * 每关 4~8 份食物，从对应季节的适口植物中取样。
 * name 会显示在采食提示里，让玩家知道这个季节吃的是什么。
 */
export const SEASON_FOODS = [
  {
    season: '早春',
    seasonNote: '冬眠后刚醒，进食最强烈，为开春储备能量',
    // 早春：冷蒿为主，此时嫩芽初生、蛋白质高
    plants: [
      { key: 'coldwormwood', name: '冷蒿嫩芽', color: 0x8fa05a, leaf: 0x6d7f43, moisture: 'high' },
      { key: 'alfalfa', name: '苜蓿新叶', color: 0x7fa04e, leaf: 0x5d7a38, moisture: 'high' },
      { key: 'sainfoin', name: '红三叶草', color: 0x93a355, leaf: 0x6b8038, moisture: 'high' },
      { key: 'poaceae_spring', name: '早春禾草', color: 0x9aae62, leaf: 0x748c42, moisture: 'mid' },
    ],
  },
  {
    season: '晚春',
    seasonNote: '草类开始成为主食，营养充足',
    plants: [
      { key: 'sedge', name: '沙草', color: 0x86a35c, leaf: 0x66814a, moisture: 'mid' },
      { key: 'poaceae', name: '禾本科嫩叶', color: 0x8faa5f, leaf: 0x6b8546, moisture: 'mid' },
      { key: 'alfalfa2', name: '苜蓿花', color: 0x9c8f4e, leaf: 0x6f8040, moisture: 'high' },
      { key: 'vetch', name: '野豌豆', color: 0x7f9a54, leaf: 0x5f783c, moisture: 'high' },
      { key: 'poaceae_a', name: '早熟禾草', color: 0x94ad64, leaf: 0x708a48, moisture: 'mid' },
    ],
  },
  {
    season: '初夏',
    seasonNote: '草类主食期，茎叶最茂盛',
    plants: [
      { key: 'sedge2', name: '羊草', color: 0x7f9c56, leaf: 0x627c44, moisture: 'mid' },
      { key: 'poaceae_b', name: '冰草', color: 0x8aa75e, leaf: 0x66834a, moisture: 'mid' },
      { key: 'alfalfa3', name: '紫花苜蓿', color: 0x8b9b52, leaf: 0x64783c, moisture: 'high' },
      { key: 'millet', name: '谷子', color: 0x9aab5f, leaf: 0x738546, moisture: 'mid' },
      { key: 'poaceae_c', name: '赖草', color: 0x87a45a, leaf: 0x638046, moisture: 'mid' },
      { key: 'clover', name: '白三叶', color: 0x8aa55c, leaf: 0x677f42, moisture: 'high' },
    ],
  },
  {
    season: '夏末',
    seasonNote: '偏向草本植物，储备即将开始积累',
    plants: [
      { key: 'sedge3', name: '寸草', color: 0x83974f, leaf: 0x627541, moisture: 'mid' },
      { key: 'poaceae_d', name: '马唐', color: 0x8c9c52, leaf: 0x687744, moisture: 'mid' },
      { key: 'herb_a', name: '蒿属草本', color: 0x7d8f4a, leaf: 0x5e6f3b, moisture: 'mid' },
      { key: 'alfalfa4', name: '晚花苜蓿', color: 0x8f9150, leaf: 0x6a703e, moisture: 'high' },
      { key: 'poaceae_e', name: '鹅观草', color: 0x94a259, leaf: 0x6f7845, moisture: 'mid' },
      { key: 'herb_b', name: '马齿苋', color: 0x6f9450, leaf: 0x53703d, moisture: 'high' },
      { key: 'poaceae_f', name: '稗草', color: 0x8a9c54, leaf: 0x667541, moisture: 'mid' },
    ],
  },
  {
    season: '冬眠前',
    seasonNote: '野生采集以草本与种子为主；栽培种子/谷物仅作近人环境的可选补充',
    plants: [
      { key: 'flax', name: '亚麻（富亚油酸）', color: 0xa8a05c, leaf: 0x7c8a44, moisture: 'mid', linoleic: true },
      { key: 'sunflower', name: '向日葵籽（近人环境补充）', color: 0xb0a054, leaf: 0x74843c, moisture: 'low', linoleic: true, cultivated: true },
      { key: 'sainfoin2', name: '红三叶草穗', color: 0x8c8a4a, leaf: 0x646c3a, moisture: 'mid' },
      { key: 'flax2', name: '胡麻（富亚油酸）', color: 0x9c9a58, leaf: 0x74844a, moisture: 'mid', linoleic: true },
      { key: 'poaceae_g', name: '老根草', color: 0x8b8f4d, leaf: 0x64693b, moisture: 'low' },
      { key: 'vetch2', name: '冬巢豆', color: 0x84924c, leaf: 0x60703a, moisture: 'mid' },
      { key: 'corn', name: '玉米粒（近人环境补充）', color: 0xb2a256, leaf: 0x7a8440, moisture: 'mid', linoleic: true, cultivated: true },
      { key: 'poaceae_h', name: '芒颖草', color: 0x8d914c, leaf: 0x656b3c, moisture: 'low' },
    ],
  },
];

/**
 * 能量换算（dev 版专用）。
 *
 * 「耐饥渴」的实现：同样的奔跑/攻击动作，储备消耗比正式版低；
 * 恢复速度更快。数值仍是玩法设计，不是营养学结论。
 */
export const HERBIVORE = {
  /** 草本采食的基础恢复量（正式版浆果为 20） */
  baseEnergy: 24,
  /** 多汁饲料额外加成（资料：偏好含水量高的多汁饲料） */
  juicyBonus: 8,
  /** 富含亚油酸的食物额外加成（资料：偏好富含脂肪的植物） */
  linoleicBonus: 12,
  /** 移动消耗倍率：耐饥渴 → 大幅降低 */
  moveCostMul: 0.62,
  /** 攻击消耗倍率 */
  attackCostMul: 0.7,
  /** 静止恢复倍率 */
  regenMul: 1.9,
  /** 洞内休息恢复倍率 */
  burrowRegenMul: 1.35,
  /** 见底阈值：草食动物耐饥渴，很低储备也能继续战斗 */
  weakThreshold: 4,
  /** 见底惩罚：耐饥渴 → 几乎不惩罚（正式版为 0.62 移速 / 0.8 伤害） */
  weakSpeedMul: 0.9,
  weakDamageMul: 0.94,
};

export const FORAGE = {
  grassSeconds: 1.4, flowerSeconds: 0.6, berrySeconds: 1.2,
  emergencyMul: 0.3, emergencyRadius: 12, committedRadius: 16,
  leaveGrace: 0.18, regrowGrass: 30, regrowFlower: Infinity,
};

export function stepForageProgress(progress, dt, { inRange, emergency, kind = 'grass' } = {}) {
  if (!inRange) return 0;
  const seconds = kind === 'flower' ? FORAGE.flowerSeconds : kind === 'berry' ? FORAGE.berrySeconds : FORAGE.grassSeconds;
  const rate = (1 / seconds) * (emergency ? FORAGE.emergencyMul : 1);
  return Math.max(0, Math.min(1, progress + Math.max(0, dt) * rate));
}

export function isForagingEmergency({ inBurrow, sprinting, recentlyHit, foxes = [] } = {}, { emergencyRadius = FORAGE.emergencyRadius, committedRadius = FORAGE.committedRadius } = {}) {
  if (inBurrow) return false;
  if (sprinting || recentlyHit) return true;
  return foxes.some((f) => {
    if (!f?.alive) return false;
    const d = Math.hypot(f.x || 0, f.z || 0);
    if (d < emergencyRadius) return true;
    return d < committedRadius && (f.pounceCommitted || f.state === 'dash' || f.state === 'wind');
  });
}

export function chooseFlowerIndices(pointCount, levelIndex, opts = {}) {
  const count = Math.max(0, Math.min(pointCount, opts.count ?? (pointCount >= 6 ? 2 : 1)));
  if (!count) return [];
  const out = [];
  let cursor = Math.abs((levelIndex | 0) * 7 + 3) % pointCount;
  for (let n = 0; n < count * 3 && out.length < count; n++) {
    const i = (cursor + n * 5) % pointCount;
    if (!out.some((v) => v === i || Math.abs(v - i) <= 1)) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

export function energyOfFlower() { return 40; }

/** 把某关的食物点位映射成具体植物（稳定取样，不随机，保证可复现） */
export function plantsForLevel(levelIndex, pointCount) {
  const season = seasonForLevel(levelIndex);
  const out = [];
  for (let i = 0; i < pointCount; i++) {
    // 栽培种子只作为稀少的近人环境补充，不应主导野生草原采食点。
    const wildPlants = season.plants.filter((plant) => !plant.cultivated);
    const selected = i % 5 === 4
      ? season.plants.filter((plant) => plant.cultivated)[Math.floor(i / 5) % 2] || wildPlants[i % wildPlants.length]
      : wildPlants[i % wildPlants.length];
    out.push(selected);
  }
  return out;
}

export function seasonForLevel(levelIndex) {
  const index = ((levelIndex % SEASON_FOODS.length) + SEASON_FOODS.length) % SEASON_FOODS.length;
  return SEASON_FOODS[index];
}

/** 该植物提供的储备量 */
export function energyOfPlant(plant) {
  let e = HERBIVORE.baseEnergy;
  if (plant.moisture === 'high') e += HERBIVORE.juicyBonus;
  if (plant.linoleic) e += HERBIVORE.linoleicBonus;
  return e;
}

/** 采食时的提示文案 */
export function eatLine(plant) {
  if (plant.linoleic) return `采食 ${plant.name} · 富亚油酸 储备 +${energyOfPlant(plant)}`;
  if (plant.moisture === 'high') return `采食 ${plant.name} · 多汁 储备 +${energyOfPlant(plant)}`;
  return `采食 ${plant.name} · 储备 +${energyOfPlant(plant)}`;
}
