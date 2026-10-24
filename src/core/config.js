/**
 * 全局配置与关卡表
 * 数值内核移植自 2D 原版《土拨鼠大作战·闯关爆发版》，单位换算为米。
 */

// —— 世界尺度 ——
// 原版战场 1040 x 590 像素，按 1 像素 ≈ 0.125m 换算为米制竞技场。
export const FIELD_W = 130;
export const FIELD_H = 78;

// 静态站点可在部署时填写反馈接收地址；留空时使用本地离线队列。
export const FEEDBACK = { endpoint: '' };

export const BURROW = { x: -52, z: 0, r: 8.2 }; // 兼容旧调用的主洞定义（安全区/回储备/缓压）

// 地下空间（两段式：小开口竖井 + 底部略宽腔室）。
// openingRadius 洞口/井壁上口；slopeRadius 洞口外挖掘坡的外缘（贴近 opening，形成陡壁而非缓土碗）；
// chamberRadius 底部腔室半径（略大于开口，井壁向下微微扩开）；chamberDepth 腔室深度。
export const UNDERGROUND = {
  base: { openingRadius: 2.2, slopeRadius: 3.6, chamberRadius: 3.0, chamberDepth: 3.8, warmLight: true, lightColor: 0xffc978, lightIntensity: 6.2 },
  shelter: { openingRadius: 1.05, slopeRadius: 1.9, chamberRadius: 1.5, chamberDepth: 2.0, warmLight: false, lightColor: 0x8bb8c4, lightIntensity: 0.28 },
};

// 洞穴布局：BURROW 保留为主洞兼容别名；其余为临时避难洞。
// 坐标刻意避开现有刷点、浆果点和岩石，运行时统一经 scalePoint/scaleRadius 缩放。
export const BURROWS = [
  { id: 'base', type: 'base', x: BURROW.x, z: BURROW.z, r: BURROW.r, regenMul: 1, label: '大本营', ...UNDERGROUND.base },
  { id: 'shelter-a', type: 'shelter', x: -12, z: -25, r: 3.15, regenMul: 0.18, label: '临时避难洞', ...UNDERGROUND.shelter },
  { id: 'shelter-b', type: 'shelter', x: 18, z: 13, r: 3.15, regenMul: 0.18, label: '临时避难洞', ...UNDERGROUND.shelter },
  { id: 'shelter-c', type: 'shelter', x: 40, z: 32, r: 3.0, regenMul: 0.18, label: '临时避难洞', ...UNDERGROUND.shelter },
  { id: 'shelter-d', type: 'shelter', x: -34, z: 28, r: 3.0, regenMul: 0.18, label: '临时避难洞', ...UNDERGROUND.shelter },
];

export const BURROW_AI = {
  lingerBase: 3.6,
  lingerShelter: 2.8,
  lingerRadius: 4.5,
  leaveDistance: 18,
  exitMemory: 2.4,
  exitNearOverride: 3.0,
};

// —— 主角基准参数（米制）——
export const PLAYER = {
  eyeHeight: 0.46, // 土拨鼠视角：贴地低机位
  radius: 0.42,
  speed: 4.8, // m/s：接近旱獭短距离奔跑速度；疾行倍率后仍保留玩法余量
  backpedalSpeed: 0.58, // 纯后退速度相对前进速度；适用于键盘与触屏摇杆
  bodyTurnRate: 10, // 第三人称身体朝向的指数平滑速率（每秒）
  collisionHeight: 0.54, // 玩家用于接触判定的简化躯干高度（米）
  maxHp: 100,
  maxEnergy: 100,

  /**
   * 姿态：静止站立 ↔ 奔跑俯伏（土拨鼠四足奔跑时会压低身体）。
   *
   * rate 用的是指数插值系数（越大越快），且起身慢于趴下：
   * 生物从伏地起身需要更多肌肉做功，这与直觉一致，也让姿态更有生物感。
   * 关键：因为 crouch 是连续标量而非布尔状态，
   * "站起到一半时开始奔跑"会自然地从当前值继续趴下，不会跳变。
   */
  posture: {
    speedThreshold: 0.18, // 速度超过基准的 18% 即判为奔跑
    crouchRate: 14, // 趴下：干脆利落
    standRate: 6.5, // 起身：稍缓
    eyeDrop: 0.19, // 俯伏时视高下降（米）
    pitchDrop: 0.1, // 俯伏时视线下压（弧度）
    fovNarrow: 5, // 俯伏时视野收窄（度），冲刺更专注
    bobBoost: 0.7, // 俯伏时颠簸增强
  },

  /**
   * 跳跃。土拨鼠是挖掘动物，采用短促小跳；碰撞通过双方垂直区间重叠判断。
   * 峰值高度 = v²/(2g)，v=4.1 时约 0.86m；滞空时间约 0.84s，
   * 足以从贴地扑咬（攻击盒高 0.4m）上方跳过，但跃扑仍能覆盖空中轨迹。
   */
  jump: {
    velocity: 4.1, // 起跳初速度 m/s；峰值约 0.86m
    gravity: 9.8, // 重力加速度 m/s²
    cooldown: 0.35, // 两次起跳最小间隔，防止连点刷跳
    dodgeHeight: 0.45, // 脚底越过此高度即可躲开贴地扑咬（不给无条件无敌）
  },
  // 玩家横向转向/刹车基线，用于保证狐狸高速时明显更难急停。
  handling: { turnRate: 2.2, accel: 14, brake: 18 },
  // 玩法手感抽象：攻击键“按住升级”三招 + 独立翻滚的伤害、冲量、无敌与后摇。
  fov: { firstPerson: 78, thirdPerson: 68 },
  combatWheel: {
    tap: {
      damageMul: 1, costMul: 1, cooldown: 0.58, cooldownMul: 1, recovery: 0,
      // range 是米制追加距离，rangeMul 在原姿态/增益范围上乘算；默认保持原判定。
      range: 0, rangeMul: 1,
      // 推击在站立 / 奔跑两种姿态下的范围与伤害分档：
      // 站立：短距离、高击退（把扑来的狐狸顶开）；奔跑：更长前伸、更高伤害、击退略低。
      stand: { rangeMul: 0.92, damageMul: 0.9, knockbackMul: 1.5, stunMul: 1.1 },
      run:   { rangeMul: 1.22, damageMul: 1.25, knockbackMul: 1.0, stunMul: 0.9 },
    },
    dodge: { damageMul: 0, cost: 3, distance: 2.2, invuln: 0.42, recovery: 0.12 },
    stand: { damageMul: 1.8, cost: 4, stun: 1.2, lock: 0.4, knockback: 2.8,
      range: 0, rangeMul: 1, cooldown: 0.18, cooldownMul: 1, recovery: 0.35,
      // 迎击（攻击键按住左滑）：在狐狸冲刺接触前的短暂窗口内正面迎上，抵消伤害并反打。
      parryWindow: 0.3, parryHalfAngle: 80 * Math.PI / 180 },
    // 扑击：地面长按攻击键达到 heavyHold 秒后松手触发；空中短按也会结算为弱化扑击。
    lunge: { damageMul: 1.45, cost: 4, distance: 2.8,
      range: 0.8, rangeMul: 1, cooldown: 0.18, cooldownMul: 1, recovery: 0.42 },
    // 攻击只有三种招式：推击(tap) / 迎击(stand，按住左滑) / 扑击(lunge，奔跑长按)。
    // heavyHold = 奔跑长按扑击阈值（秒）；非奔跑长按不产生第四招，松手落回推击。
    charge: { heavyHold: 0.65 },
  },
};

/** 默认移动键映射（兼容方案使用；实际由 keybinds 模块提供） */
export const DEFAULT_MOVE_MAP = {
  forward: 'KeyW', forwardAlt: 'ArrowUp',
  back: 'KeyS', backAlt: 'ArrowDown',
  left: 'KeyA', leftAlt: 'ArrowLeft',
  right: 'KeyD', rightAlt: 'ArrowRight',
};

// —— 浆果 / 伙伴 / 藏狐 ——
export const BERRY_RADIUS = 0.75;
export const BERRY_ENERGY = 20;
export const BERRY_CHARGE = 8;

export const COMPANION_FOLLOW_SPEED = 7.2;
export const COMPANION_CATCH_DIST = 1.5;
export const RESCUE_DIST = 1.9;
export const SOCIAL_RANGE = 2.4;

/**
 * 藏狐的攻击模式档案。
 *
 * 原版只有一种攻击：直线蓄力 → 直线冲刺。玩家一旦学会"看到红线就侧移"，
 * 所有藏狐都变成同一个可预测的靶子，战斗很快变单调。
 *
 * 这里给每种藏狐分配**行为不同**的攻击模式，让"看动作猜意图"重新成为玩法核心。
 * 首要设计约束：**每种模式都必须能被预警线读出来** —— 否则玩家无从应对，
 * 只是在随机挨打，难度上升但体验不涨。
 *
 * mode       行为模式，见 fox.js 的状态机
 * windMul    蓄力时长倍率（1 = 用关卡的 wind 值）
 * dashTime   冲刺持续秒数；真实冲刺距离 = dashSpeed × dashTime × dashSpeedMul，
 *            **必须与预警线长度一致**，否则玩家会失去"线到头了就该躲完了"的信任
 * turnRate   冲刺中可修正朝向的速率（弧度/秒）：0 = 方向锁死（好躲）；
 *            大 = 追踪玩家（难躲，所以 windMul 也要相应加长，给玩家反应时间）
 * windLeadTime 蓄力时仅按近期玩家移动速度估计冲刺方向的提前量（秒）；0 = 不预瞄
 * dashSpeedMul 冲刺速度倍率
 * circleTime 绕行阶段时长（'circle' 模式）
 * lureChance 虚晃概率（'circle' 模式）：蓄力中途放弃并重新绕行
 * leapHeight 跃扑的起跳高度（'leap' 模式）：必须明显高于 PLAYER.jump.dodgeHeight
 * comboCount 连冲段数（'combo' 模式）
 */
const FOX_ATTACKS = {
  // 幼狐：短距低跃扑；用垂直碰撞区间判断是否真正碰到玩家。
  // 冲刺距 = dashSpeed × (dashTime + 0.22 腾空)，仍须覆盖 windRange 与接触半径。
  pup: {
    mode: 'leap', windMul: 1.12, dashTime: 0.34, turnRate: 0.42,
    leapHeight: 0.9, label: '跃扑',
  },
  // 普通狐：适度追踪 + 有限移动预瞄；加长蓄力和冲刺，让线索可读、横移仍能躲。
  // 14.5 × 0.76 ≈ 11.0m，预警线按此真实最大距离绘制。
  normal: {
    mode: 'straight', windMul: 1.2, dashTime: 0.76, turnRate: 0.42, windLeadTime: 0.75,
    label: '直线冲刺',
  },
  // 疾行狐：蓄力仍更短，极弱追踪与更短预瞄；适度延长预警补偿追踪。
  // 14.5 × 0.68 ≈ 9.9m，是全场最远的一击
  fast: {
    mode: 'straight', windMul: 0.85, dashTime: 0.68, turnRate: 0.16, windLeadTime: 0.35,
    label: '疾冲',
  },
  // 厚皮狐：绕行 + 虚晃，从侧面反复试探才真的冲 —— 「难以预判会从哪一侧来」。
  // 14.5 × 0.65 ≈ 9.4m
  heavy: {
    mode: 'circle', windMul: 1.3, dashTime: 0.65, turnRate: 0.28,
    circleTime: 1.15, lureChance: 0.55, label: '绕行虚晃',
  },
  // 首领：三段连冲，每段都能微调方向 —— 「必须连续躲三次，不能一躲了事」。
  // 单段 14.5 × 0.42 × 1.1 ≈ 6.7m，三段连冲保留压迫感。
  boss: {
    mode: 'combo', windMul: 1.08, dashTime: 0.42, turnRate: 0.38,
    comboCount: 3, dashSpeedMul: 1.1, label: '三段连冲',
  },
};

/**
 * 狐狸类型表。
 *
 * 设计原则（对应玩家需求）：
 *   · **同类区分主要靠体型**，不靠颜色 —— 幼狐与成狐毛色相同，仅体型更小，
 *     这样玩家不会产生"颜色=威胁等级"的错误直觉。
 *   · **特殊种类才允许毛色辅助识别** —— 沙黄(疾行狐)、灰褐(厚皮狐)、
 *     深褐(首领) 都是现实中真实存在的毛色，不是虚构的青紫色。
 *   · 体型差异要拉开：幼狐 0.62 ~ 首领 1.6，肉眼可辨。
 */
export const FOX = {
  useProcedural: false,
  proceduralColors: { normal: 0xc4763a, pup: 0xc4763a, fast: 0xd9c294, heavy: 0x9c8770, boss: 0x6b4c31 },
  types: {
    normal: { hp: 3, speed: 1.0, wind: 1.0, mass: 1.0, knockbackMul: 1, label: '', scale: 1.0 },
    // 幼狐：毛色同 normal，仅体型 62%，血量更低、速度略慢
    pup: { hp: 2, speed: 0.88, wind: 1.1, mass: 1.15, knockbackMul: 1.05, label: '幼狐', scale: 0.62 },
    fast: { hp: 2, speed: 1.2, wind: 0.8, mass: 0.85, knockbackMul: 1.1, label: '疾行狐', scale: 0.88 },
    heavy: { hp: 6, speed: 0.78, wind: 1.15, mass: 0.6, knockbackMul: 0.62, label: '厚皮狐', scale: 1.2 },
    boss: { hp: 18, speed: 1.1, wind: 0.9, mass: 0.38, knockbackMul: 0.38, label: '狐首领', scale: 1.6 },
  },
  /** 每种类型的攻击模式（行为差异的来源，见文件上方 FOX_ATTACKS） */
  // attackOf 已移到本对象末尾（需引用 FOX_ATTACKS，故不能用箭头属性提前声明）
  roamRange: 52, // 感知半径
  /**
   * 进入蓄力的距离。
   *
   * 这是全场最关键的一个数，必须与「冲刺距离 + 接触半径」匹配：
   * 藏狐在 windRange 处开始蓄力，冲 dashSpeed × dashTime 米后停下，
   * 若 dashSpeed × dashTime < windRange - contact，它就**停在玩家碰不到的地方**，
   * 玩家站着不动永远不会被抓到 —— 预警线也就成了纯装饰，
   * 整局失去紧张感（这是实测发现的老问题，见 tools/test-attacks.cjs）。
   *
   * 现在的配平原则：
   *   冲刺距离按各类型 dashTime 与 dashSpeedMul 计算；所有类型都须覆盖
   *   windRange(9.2) - 接触半径，给玩家预警与躲避空间。
   *   首领以三段连冲提供持续压迫，而非单次超高速冲刺。
   */
  windRange: 9.2,
  dashSpeed: 14.5,
  // 狐狸高速冲刺不应拥有玩家级别的急转与急刹能力。
  handling: {
    maxTurnRate: 0.78, turnAccel: 1.6, windTurnRate: 1.1, windTurnAccel: 3.8,
    // Ground steering capacity falls with speed; minTurnRate permits slow pivots.
    maxTurnSlow: 2.8, turnSpeedK: 0.16, minTurnRate: 0.28, locomotionTurnAccel: 3.8, locomotionAccel: 14,
    brakeLerp: 2.8, recoverySpeedMax: 2.8,
  },
  recovery: { normal: 1.15, fast: 0.9, leap: 1.05, combo: 1.2, blocked: 0.9 },
  /**
   * 藏狐生理参数：体力与血量对机动/输出的影响。
   *
   * 关键口径：**体力耗尽 ≠ 被驱退**。
   * 体力只是"能不能冲刺/扑咬"的开关；见底后藏狐只能慢行或休息，
   * 但不会被系统判定为已驱退（驱退口径见阶段 2）。
   */
  vitals: {
    maxStamina: 100,
    /** 慢行（潜行接近）：不消耗体力 —— 用户明确要求 */
    stalkStaminaPerSec: 0,
    /** 冲刺（直线突进）：持续消耗 */
    sprintStaminaPerSec: 18,
    /** 扑咬的冲刺阶段：比普通冲刺更费 */
    pounceStaminaPerSec: 26,
    /** 静止休息：每秒恢复体力 */
    restStaminaPerSec: 14,
    /** 静止休息：每秒恢复血量，占 maxHp 的比例（**要慢**） */
    restHpRegenRatio: 0.035,
    /** 受击时额外扣体力（与伤害同时发生） */
    hitStaminaCost: 7,
    /** 体力见底后，多久不允许再冲刺（防止抖动） */
    staminaLockSeconds: 1.2,
    /** 血量比例低于此值开始影响速度与伤害 */
    lowHpThreshold: 0.5,
    /** 血量归零时的速度倍率（最低） */
    speedMulAtZeroHp: 0.72,
    /** 血量归零时的伤害倍率（最低） */
    damageMulAtZeroHp: 0.6,
  },
  groundAttackHeight: 0.4,
  /**
   * 被驱退后的逃跑。
   * 藏狐是被吓跑的，不是被杀 —— 所以它必须有一个可见的逃跑过程，
   * 而不是原地消失。
   *
   * 参数权衡：速度要明显快于玩家（8.4 vs 6.6），显得"逃得掉，但得趁早下手"；
   * 逃跑时间上限要足够跑出玩家视野（约 1.5 秒 × 8.4 ≈ 13m），
   * 否则玩家看到的是"淡出"而不是"跑掉"，语义又错了。
   * 到上限仍未跑出边界的（角落），强制离场以免原地抖动。
   */
  fleeSpeed: 5.8,
  fleeMaxTime: 4.0,
  /**
   * 自主撤退（阶段 2 驱退口径）：何时撤是狐狸自己的判断，不由受击逻辑强塞。
   * 触发条件（满足其一，且不在 wind/dash 攻击流程中）：
   *   血量比例 ≤ hpRatio / 体力比例 ≤ staminaRatio / 连续被打 ≥ hitStreak 次。
   * 撤到休息点进入 rest_safe 的那一刻计入驱退数（撤退即驱退）；
   * 休息结束（计时到或血回满）后重新参战，可再次被驱退计数。
   * hp ≤ 0 是真死：不逃、不重生 —— 但正常路径打不到那一步，因为它早就撤了。
   */
  retreat: {
    /** 血量比例低于此值 → 主动撤退（明显高于 vitals.lowHpThreshold 的致死区） */
    hpRatio: 0.45,
    /** 体力比例低于此值 → 主动撤退 */
    staminaRatio: 0.25,
    /** 短时间内连续被打这么多次 → 判断形势不利，撤退 */
    hitStreak: 4,
    /** 超过这么久没再挨打 → hitStreak 清零（脱战衰减） */
    hitStreakDecay: 6,
    /** 距休息点多近算到达 */
    arriveRadius: 1.5,
    /** 撤退移动速度：比慢行快（有逃跑感），但不冲刺、不耗体力 */
    speed: 6.0,
    /** 休息时长（秒）：首领明显更长（不该频繁撤退），普通狐短一些 */
    restSeconds: { normal: 6, pup: 4.5, fast: 5, heavy: 7, boss: 12, smart: 7 },
  },
  // 接触判定：土拨鼠体型小，接触距离相应放大到体型的一半以上才合理
  contact: { boss: 2.2, heavy: 1.95, pup: 1.45, default: 1.7 },
  // 水平接触按双方半径相加，与旧 contact 触发距离完全等价；可在调试面板中独立调节。
  collisionRadius: { normal: 1.28, pup: 1.03, fast: 1.28, heavy: 1.53, boss: 1.78 },
  collisionHeight: { normal: 0.48, pup: 0.34, fast: 0.4, heavy: 0.52, boss: 0.68 },
  damage: { boss: 22, heavy: 18, pup: 8, default: 12 },
  /** 攻击模式档案（定义在本文件上方 FOX_ATTACKS） */
  attacks: FOX_ATTACKS,
  /** 取某类型的攻击档案，新增类型漏配时回退到 normal */
  attackOf(type) { return FOX_ATTACKS[type] || FOX_ATTACKS.normal; },
};

/**
 * 关卡配置（12 关）。新增/删减关卡后，HUD 与各界面经 LEVELS.length 自动跟随，
 * 不要在别处硬编码关卡总数。
 *
 * 设计原则：**每关有一个新的"要解决的问题"，而不只是数字变大。**
 * 只加 count/speed/goal 的关卡表，玩到第 4 关就会觉得重复 ——
 * 所以后期关卡引入环境修饰（雾、风、沙尘、补给点分布）与目标侧重变化。
 *
 * 字段说明：
 *   count        同屏藏狐数
 *   speed/wind   藏狐接近速度 / 蓄力基准时长（秒）
 *   goal         需要采食（恢复能量）的次数
 *   time         限时（秒）
 *   reinforce    驱退后重新出现的增援间隔（秒）
 *   friend       伙伴被困位置 [x, z]
 *   boss         是否有首领（首领被驱退才算击败）
 *   types        本关藏狐类型池（不填则按关卡推断）
 *   fog/fogFar   雾的近端与远端距离 —— 能见度的核心参数
 *   windGust     环境阵风强度（米/秒² 的横向推力），0 = 无风
 *   sandstorm    沙尘：周期性降低能见度（雾的周期性加成）
 *   lureBias     虚晃倾向倍率（>1 让厚皮狐更爱骗人）
 *
 * 每一关的 `brief` 会显示在关卡开场提示里，必须说清"这关要学什么"。
 */
export const LEVELS = [
  {
    name: '初出洞穴',
    brief: '学会爆发与反击',
    count: 2,
    speed: 7.2,
    goal: 4,
    time: 115,
    wind: 0.76,
    reinforce: 8,
    friend: [48, 22],
    types: ['normal'],
    sky: ['#8fa8c4', '#c9d8dd'],
    grass: ['#93a978', '#718f65'],
    fog: '#93a4a8',
    sun: '#fff3d4',
    sunIntensity: 1.9,
    ambient: 0.42,
  },
  {
    name: '双翼包抄',
    brief: '狐狸蓄力较短就冲，靠拉开距离比靠反应更快',
    count: 3,
    speed: 8.0,
    goal: 5,
    time: 125,
    wind: 0.7,
    reinforce: 7.2,
    friend: [56, 19],
    types: ['normal'],
    sky: ['#93a9bd', '#d3d6c8'],
    grass: ['#9cac70', '#778c58'],
    fog: '#9aa596',
    sun: '#ffeec6',
    sunIntensity: 1.85,
    ambient: 0.40,
  },
  {
    name: '持续应战',
    brief: '注意狐狸接近时的走位，利用预警线判断出手时机',
    count: 4,
    speed: 8.6,
    goal: 6,
    time: 140,
    wind: 0.66,
    reinforce: 6.5,
    friend: [58, 24],
    types: ['normal'],
    lureBias: 1.3,
    sky: ['#b0a679', '#e0d3a0'],
    grass: ['#a6a46a', '#838d5f'],
    fog: '#b0a684',
    sun: '#ffe4a8',
    sunIntensity: 2.0,
    ambient: 0.38,
  },
  {
    // 新机制：视野受限。藏狐会先消失在雾里再贴近，
    // 逼玩家依赖"地面预警线 + 边缘威胁箭头"而不是靠眼睛盯着。
    name: '雾锁黄昏',
    brief: '雾很浓，看不见藏狐 —— 盯住地面的红色预警线',
    count: 4,
    speed: 9.0,
    goal: 6,
    time: 150,
    wind: 0.62,
    reinforce: 6.0,
    friend: [57, 19],
    types: ['normal'],
    fog: '#9aa8ad',
    fogNear: 12,
    fogFar: 68,
    sun: '#e8d9c0',
    sunIntensity: 1.35,
    ambient: 0.52,
    sky: ['#8b9aa4', '#b6c0c4'],
    grass: ['#84937a', '#64735f'],
  },
  {
    name: '群狐来袭',
    brief: '六只围攻，蓄满按 K 清出空间',
    count: 6,
    speed: 9.4,
    goal: 7,
    time: 160,
    wind: 0.6,
    reinforce: 5.7,
    friend: [57, 19],
    types: ['normal'],
    lureBias: 1.2,
    sky: ['#a99a78', '#d8c79a'],
    grass: ['#a39877', '#827c62'],
    fog: '#a89a7c',
    sun: '#ffd79a',
    sunIntensity: 1.8,
    ambient: 0.36,
  },
  {
    // 新机制：阵风。周期性横风会推动玩家，冲刺距离与躲闪窗口都被改变，
    // 迫使玩家"顺着风躲"而不是原地按键。
    name: '风口疾行',
    brief: '横风会推着你走，躲闪要顺着风借力',
    count: 5,
    speed: 10.2,
    goal: 7,
    time: 165,
    wind: 0.56,
    reinforce: 5.4,
    friend: [60, 22],
    types: ['normal'],
    windGust: 7.5,
    lureBias: 1.1,
    sky: ['#9db4c0', '#cfd9d6'],
    grass: ['#8fa87e', '#6c8562'],
    fog: '#a3b4b8',
    sun: '#e6f0ea',
    sunIntensity: 1.7,
    ambient: 0.44,
  },
  {
    // 新机制：沙尘。周期性把能见度压到很低，是「雾锁黄昏」的强化版。
    name: '沙尘掩埋',
    brief: '沙尘会周期性地吞掉视野，预警线是你唯一的依靠',
    count: 6,
    speed: 10.0,
    goal: 8,
    time: 175,
    wind: 0.55,
    reinforce: 5.2,
    friend: [58, 26],
    types: ['normal'],
    fog: '#c2ab84',
    fogNear: 16,
    fogFar: 110,
    sandstorm: true,
    lureBias: 1.4,
    sky: ['#c9b489', '#e6d5ab'],
    grass: ['#b09c6c', '#8a7a55'],
    sun: '#ffe0a8',
    sunIntensity: 1.55,
    ambient: 0.5,
  },
  {
    name: '群狐围攻',
    brief: '保持观察预警线，连续躲避来袭的狐狸',
    count: 8,
    speed: 10.6,
    goal: 8,
    time: 190,
    wind: 0.54,
    reinforce: 5,
    friend: [58, 26],
    boss: true,
    types: ['normal'],
    lureBias: 1.2,
    sky: ['#6f8087', '#aeb9b6'],
    grass: ['#839286', '#596d69'],
    fog: '#75858a',
    sun: '#dfe8ee',
    sunIntensity: 1.65,
    ambient: 0.45,
  },
  {
    name: '逆风回巢',
    brief: '强阵风会持续改变走位，先稳住方向再应对来袭的狐狸',
    count: 6,
    speed: 10.4,
    goal: 7,
    time: 170,
    wind: 0.56,
    reinforce: 5.2,
    friend: [56, 27],
    types: ['normal'],
    windGust: 11,
    sky: ['#84979c', '#c6d0c2'],
    grass: ['#899876', '#64745e'],
    fog: '#91a19b', sun: '#e8e2c8', sunIntensity: 1.65, ambient: 0.43,
  },
  {
    name: '浓雾伏击',
    brief: '低能见度中靠预警线判断出手时机',
    count: 7,
    speed: 10.6,
    goal: 8,
    time: 180,
    wind: 0.58,
    reinforce: 5.0,
    friend: [59, 24],
    types: ['normal'],
    fog: '#879494', fogNear: 8, fogFar: 54,
    lureBias: 1.65,
    sky: ['#77868a', '#a6b2af'],
    grass: ['#798775', '#596857'],
    sun: '#d5dfd7', sunIntensity: 1.35, ambient: 0.5,
  },
  {
    name: '沙暴突围',
    brief: '沙尘与横风交替出现，利用平静窗口采食、救援并拉开距离',
    count: 7,
    speed: 10.8,
    goal: 8,
    time: 185,
    wind: 0.58,
    reinforce: 4.8,
    friend: [58, 29],
    types: ['normal'],
    fog: '#b9a27c', fogNear: 14, fogFar: 96,
    sandstorm: true, windGust: 6.5, lureBias: 1.25,
    sky: ['#b9a276', '#ddc99d'],
    grass: ['#a3956a', '#7c7354'],
    sun: '#f1d19a', sunIntensity: 1.5, ambient: 0.48,
  },
  {
    name: '草原守望者',
    brief: '最终考验：高压与沙尘同时施压，保住伙伴并回洞',
    count: 9,
    speed: 11.2,
    goal: 9,
    time: 205,
    wind: 0.58,
    reinforce: 4.6,
    friend: [60, 28],
    boss: true,
    types: ['normal'],
    fog: '#9a9582', fogNear: 15, fogFar: 105,
    sandstorm: true, windGust: 7.5, lureBias: 1.4,
    sky: ['#777e7b', '#b5b4a5'],
    grass: ['#888d72', '#5d6b58'],
    sun: '#e8d5ad', sunIntensity: 1.5, ambient: 0.46,
  },
];

/** Every campaign level now uses the single normal Tibetan fox species. */
export function typesForLevel(_index) {
  return ['normal'];
}

// 浆果与藏狐刷新点位（米制，绕开洞穴）
export const BERRY_POINTS = [
  [-28, -24], [-14, 8], [-4, -32], [10, 20], [30, 12], [44, -24],
  [32, 30], [16, -18], [-22, 26], [4, 0], [50, 28], [-34, -6],
];

export const SPAWN_POINTS = [
  [50, -28], [46, 30], [26, -32], [56, 4], [22, 32], [38, -18],
  [-8, 34], [0, -34],
];

// 岩石障碍物（圆形碰撞体）
export const ROCKS = [
  [-20, -14, 3.4], [8, 26, 4.1], [34, -8, 3.0], [-30, 16, 3.6],
  [18, -26, 2.7], [42, 20, 3.3], [-2, 34, 3.8], [26, 34, 2.4],
  [-44, -26, 4.4], [50, -14, 3.2], [-36, -34, 3.6], [12, -6, 2.2],
];

/**
 * 运行时点位缩放（GS 全场景用）。
 *
 * 需求是"放大地图 + 缩小原先活动范围来适配原先大小"。
 * 上面的点位/边界常量都被多个模块静态 import，无法直接改，
 * 所以这里维护一个**运行时缩放系数**，并把所有"读点位"的地方
 * 统一走 scalePoint()。
 *
 * 稳定版系数为 1，行为与原来完全一致。
 */
const POINT_SCALE = { k: 1, cx: 0, cz: 0 };

/**
 * 设置点位缩放。
 * @param k    线性缩放系数（1 = 原样）
 * @param cx   缩放中心（目标范围的中心，米）
 * @param cz   同上
 */
export function setPointScale(k, cx = 0, cz = 0) {
  POINT_SCALE.k = k;
  POINT_SCALE.cx = cx;
  POINT_SCALE.cz = cz;
}
export function getPointScale() { return POINT_SCALE.k; }

/** 把一个点位按缩放系数与中心映射到新的活动范围 */
export function scalePoint(p) {
  const { k, cx, cz } = POINT_SCALE;
  if (k === 1) return p;
  return [cx + p[0] * k, cz + p[1] * k];
}

/** 供需要原点坐标的场合（如洞穴位置）使用 */
export function scaleCoord(v, axis) {
  const { k, cx, cz } = POINT_SCALE;
  if (k === 1) return v;
  return (axis === 'x' ? cx : cz) + v * k;
}

/** 半径只做线性缩放，不受中心影响 */
export function scaleRadius(r) {
  return r * POINT_SCALE.k;
}

/** 活动范围半宽/半高（缩放后） */
export function fieldHalf() {
  return { hw: FIELD_W / 2 * POINT_SCALE.k, hh: FIELD_H / 2 * POINT_SCALE.k };
}

/**
 * 玩家移动边界（缩放后，含场外缓冲）。
 * 稳定版与历史值 FIELD_W/2+12、FIELD_H/2+12 完全一致；
 * GS 版缓冲随系数同比缩小，避免边界超出可行走高度场过多。
 */
export function moveBounds(pad = 12) {
  const k = POINT_SCALE.k;
  return { hw: (FIELD_W / 2 + pad) * k, hh: (FIELD_H / 2 + pad) * k };
}

/**
 * 藏狐游荡/逃跑判定边界（缩放后）。
 * 历史值写死 ±74 / ±44（略大于内场 ±65 / ±39），这里按同一比例缩放，
 * 否则 GS 版狐狸会跑出缩小后的活动场、增援判定也会失真。
 */
export function roamBounds() {
  const k = POINT_SCALE.k;
  return { hw: 74 * k, hh: 44 * k };
}
