/**
 * 机制说明的独立中文数据源。参数默认值/范围由 tuning-schema 实时注入，
 * 这里只维护机制、联动、风险和 schema 之外的实际运行参数，避免两处默认值漂移。
 */
export const MECHANISM_GUIDES = [
  {
    id: 'fox', title: '狐狸 AI：感知、追击、扑咬与撤退',
    groups: ['狐狸 · 基础', '狐狸 · 类型表', '狐狸 · 攻击档案', '狐狸 · 智能 AI 扑击'],
    sources: 'src/entities/fox.js · src/entities/smart-fox.js · src/entities/smart-fox-core.mjs · src/core/fox-motion.js · src/core/config.js',
    overview: '普通狐狸沿 roam → wind（预警/蓄力）→ dash（冲刺）→ rest 循环，攻击档案再分出直线、跃扑、绕行虚晃与连冲。智能狐只在测试沙盒使用：120°感知锥累积怀疑度，效用权重选择观察、接近、虚晃、扑击、恢复或放弃；协同层限制同窗口出击数量并安排包抄。玩家在洞内时 safe 会阻止攻击。',
    workflow: ['先固定狐狸类型和关卡速度，再调 wind/dash/recovery，确认预警线长度与真实位移一致。', '智能狐扑咬是 dashStage（冲刺）→ windup（极短前摇）→ strike（仅此阶段结算接触伤害）→ recover；撞障或受击取消进入后摇。', '体力不足会锁定冲刺；低血、低体力或连续受击触发 retreat，抵达休息点进入 rest_safe，回血回体力后才重新参战。'],
    risks: ['最小扑击距离大于最大距离会直接失去可扑击区间；角度过小、前摇过短且速度过高会显著压缩反应窗口。', '恢复和冷却都接近零会造成连续压迫；协同窗口/间隔放宽到极端时，多狐可能同时出击。', ' retreat 阈值过高会让狐狸几乎不交战，过低则可能让撤退机制难以观察。修改后应分别验证命中、撞障取消、撤退归队和洞穴安全。'],
    extra: [
      { name: 'SMART_POUNCE_STAGE.dashDuration / dashSpeedMul', def: '0.42 s / 1.18', range: '秒 / 倍率', up: '冲刺覆盖更远或更快，预警线同步变长', down: '逼近距离与冲刺消耗下降', link: '与 SMART_POUNCE.speed、加速度、staminaCost 联动', risk: '必须跑预警线和真实位移一致性测试' },
      { name: 'SMART_POUNCE_STAGE.windupTime / strikeTime / strikeSpeed', def: '0.10 s / 0.22 s / 13.5 m/s', range: '秒 / 秒 / 米每秒', up: '分别延长前摇、延长伤害位移窗口、提高扑咬速度', down: '缩短对应窗口或降低扑咬覆盖', link: 'strike 才是伤害阶段；recoverTime 决定硬直', risk: '前摇与 strike 同时过短会难以闪避，位移过长可能越过目标' },
      { name: 'SMART_POUNCE_STAGE.staminaCost', def: '26', range: '体力点，一次性扣除', up: '减少连续扑咬次数，更容易触发体力撤退', down: '允许更频繁扑咬', link: '还会消耗 dashStage 的持续体力并检查锁定状态', risk: '调低时需同时检查冷却与群体出击间隔' },
      { name: 'FOX.retreat.hpRatio / staminaRatio / hitStreak', def: '0.45 / 0.25 / 4 次', range: '比例 / 比例 / 次数', up: '更早因血量/体力/受击撤退', down: '撤退更晚或需要更多受击', link: '与 restSeconds、arriveRadius、rest_safe 回血联动', risk: '高阈值会频繁结束战斗；低阈值需验证不会卡在不撤退状态' },
      { name: 'FOX.vitals.staminaLockSeconds / restStaminaPerSec', def: '1.2 s / 14 点每秒', range: '秒 / 体力点每秒', up: '分别延长冲刺锁定、加快休息恢复', down: '缩短锁定、减慢恢复', link: '与 stalk/sprint/pounce 消耗和撤退阈值共同决定节奏', risk: '恢复过快且锁定过短会削弱体力机制存在感' },
    ],
  },
  {
    id: 'forage', title: '啃草、环境草与储备收益', groups: ['Beta · 平衡'],
    sources: 'src/core/beta-tuning.js · src/core/graze-grid.mjs · src/world/props.js · src/main.js',
    overview: '每株环境草的 growth 是 0 到 1 的连续密度：1 完好，0 啃光。核心圈距离权重为 1，核心到外圈之间线性衰减，外圈边界为 0。每帧真实吃量 eaten 与满圈产能 capacity 的比值决定收益密度，因此草越稀疏，储备恢复越少，不再有二值阈值断崖。',
    workflow: ['grassSeconds 只控制一轮啃食动作/HUD 进度与飘字节奏；实际储备是在按住啃食时按 grazeRegenPerSec × density × dt 逐帧增加。', '啃食速率逐帧扣 growth，regrowGrass 对所有未满草株缓慢加回；没有草或全部啃光时密度为 0。', '花是否立即完成由 flowerInstant 控制；扑击锁敌与伙伴跟随也在此 schema 分组，但不属于环境草产能公式。'],
    risks: ['核心圈必须小于外圈才有渐变环；相等或核心更大时 grazeWeight 在核心外直接归零。', '啃食和收益同时提高而再生也接近啃食速度，可能形成原地无限刷储备。', '修改后验证满草、稀疏草、秃地、场地边缘以及吃完后等待再生；不要只看 HUD 一轮耗时。'],
    extra: [],
  },
  {
    id: 'burrow', title: '洞穴、临时避难所与安全判定', groups: ['洞穴与避难'],
    sources: 'src/world/underground.js · src/world/burrows.js · src/core/config.js · src/main.js · src/entities/fox.js',
    overview: '主洞和 shelter 临时洞都走 burrowVolumeAt：水平位置需落在 slopeRadius 内，玩家高度还必须低于地表 0.18 m 且不高于洞底上方 0.7 m。仅站在洞口地表装饰上不算安全。进入后 game.inBurrow 阻止狐狸接触伤害、改变天气与光照；静止时按各洞 regenMul 回储备，临时洞恢复明显低于主洞。',
    workflow: ['BURROW 是主洞兼容别名，BURROWS 另含临时洞坐标、半径和恢复倍率；UNDERGROUND 控制可见坡面、井口、腔室和灯光。', '玩家进洞时狐狸进入 linger，主洞/避难洞有不同停留时间，之后 abandon 离开；出洞记忆 exitMemory 抑制立刻重新警觉。', '洞口、坡缘、腔室半径是几何参数，BURROW.r/BURROWS.r 另用于布局与 AI 绕行/停留，并非同一判定。'],
    risks: ['只改视觉腔室而不改位置或安全体积测试，可能出现“看似进洞却仍受伤”。', 'slopeRadius 大于腔室和开口很多会扩大地下可行走区域；深度过浅可能无法满足地下高度门槛。', '恢复倍率、离洞距离和记忆时间组合不当，可造成无限安全恢复或狐狸长期堵洞。需逐洞实测进入、离开、AI 停留和天气切换。'],
    extra: [],
  },
  {
    id: 'player', title: '玩家移动、战斗与资源', groups: ['玩家 · 基础', '玩家 · 攻击三招', '玩家 · 攻击手势常量', '判定 · 攻击体积', '判定 · 可视化默认项'],
    sources: 'src/core/config.js · src/core/combat-wheel.mjs · src/systems/combat.js · src/main.js',
    overview: '移动由基础速度、后退倍率、加减速和姿态共同决定；跳跃采用初速度与重力，脚底超过 dodgeHeight 才能躲贴地扑咬，不是无条件无敌。攻击三招包含推击、迎击和扑击，各有伤害、体力、范围、冷却、后摇与击退；迎击窗口和半角决定正面格挡，翻滚另有独立无敌时间。',
    workflow: ['先确认单位：速度 m/s、距离 m、时间 s；手势阈值 ms/px；源码弧度在面板显示为度。', '伤害结算同时受招式倍率、姿态倍率和攻击体积约束；击退还会受狐狸类型质量/击退倍率影响。', '资源包括生命、储备/能量以及各招 cost。移动消耗与静止恢复在主循环处理，储备不足时应验证攻击和冲刺是否仍可执行。'],
    risks: ['无敌长于后摇与冷却之和可能形成连续无敌；高击退配长眩晕会让狐狸无法进入正常撤退流程。', '攻击体积下沿高于上沿、范围极大或锁敌角过宽都会造成隔空命中。', '碰撞半径与视高不是同一概念；调整视高/FOV 不应被当作改变伤害判定。每次修改至少验证地面、空中、正面迎击和无敌帧边界。'],
    extra: [],
  },
  {
    id: 'world', title: '世界、关卡与布局', groups: ['世界 · 关卡与布局'],
    sources: 'src/core/config.js · src/core/utils.js · src/world/props.js',
    overview: '此表由 LEVELS、临时洞、浆果点、狐狸刷新点和岩石的真实数值叶子生成。关卡速度与蓄力还会乘狐狸类型和攻击档案倍率，因此这里的默认值不是最终战斗时序。坐标与半径运行时会经过统一世界缩放。',
    workflow: ['关卡 count/goal/time 控制同屏数量、采食目标和限时；reinforce 控制驱退后的增援。', '雾近端/远端、阳光、环境光和阵风属于环境表现或天气机制，不与狐狸感知距离自动等价。', '点位编辑要同时看刷怪、拾取、洞穴和岩石的相互间距。'],
    risks: ['把 speed/wind 与狐狸档案同时推到极端会叠加，而不是覆盖。', '雾远端小于近端、岩石覆盖洞口、刷点与障碍重叠都需要实关验证。布局坐标没有自动避障保证。'],
    extra: [],
  },
  {
    id: 'misc', title: '浆果、伙伴与场地', groups: ['其它 · 浆果与伙伴'],
    sources: 'src/core/config.js · src/main.js',
    overview: '浆果拾取半径、回能量和蓄力充能是不同字段；伙伴跟随有基础速度与 Beta 倍率/间距两套来源，追上距离不等于救援距离。场地宽高会影响统一缩放和漫游边界。',
    workflow: ['先用单颗浆果验证拾取半径与收益，再观察伙伴追赶、被困救援和社交范围。', '场地尺寸变化后要重新检查所有布局点位，而非只检查边缘。'],
    risks: ['拾取半径过大可能隔障碍吸取；伙伴间距过近容易重叠，过远会频繁追赶。场地尺寸与固定点位组合可能把对象挤到边界。'],
    extra: [],
  },
  {
    id: 'view', title: '视角、HUD 与触控布局', groups: [],
    sources: 'src/main.js · src/ui/touch-layout.js · src/ui/view-mode-card.js · src/ui/settings.js',
    overview: 'viewBtn 在第一/第三人称间切换并更新文字、aria-pressed 和提示，偏好以 marmot3d.viewMode.v1 保存。第一/第三人称 FOV 的调参项位于“玩家 · 基础”。触控布局使用 marmot.touch-layout.v1，分别保存整体/单项缩放、透明度、按钮与 HUD 卡片位置、摇杆和疾跑阈值；应用时按安全区和实际控件尺寸夹紧。',
    workflow: ['设置面板可调节整体大小/透明度，选择单个按钮或卡片后调单项大小/透明度与卡片 X/Y；进入拖动编辑可摆位置，保存后刷新仍保留。', '旧存档采用浅合并与逐组规范化：缺失的整体、按钮、卡片或摇杆字段回退默认；attackCoreSize/attackCoreOpacity 兼容迁移到 attack 按钮。非法存档读取失败则回退默认。'],
    risks: ['透明度只是视觉，不改变按钮命中；透明度过低仍需保证可辨识。缩放和位置会联动安全区夹紧，不能只按百分比判断最终位置。', '修改 HUD 卡片位置后在横屏、竖屏、刘海安全区和桌面窄屏复测；恢复默认会覆盖本机自定义布局。'],
    extra: [
      { name: 'viewBtn / marmot3d.viewMode.v1', def: '第一人称；可切第三人称', range: 'first-person / third-person', up: '不适用；按钮切换视角', down: '不适用；不是数值参数', link: '与 PLAYER.fov、身体朝向、啃食第三人称视高下降联动', risk: '验证 storage 不可用时仍可切换，只是不持久化' },
      { name: 'touchLayout.scale / opacity', def: '由 TouchLayout.defaultLayout 提供', range: '整体缩放 0.75–1.3；透明度 0.35–1', up: '控件更大或更不透明', down: '控件更小或更透明', link: '与单项 scale/opacity 相乘，按钮透明度应用时下限 0.18', risk: '小尺寸、低透明叠加会难以发现和点击' },
      { name: 'touchLayout.cards.*.x / y', def: '按卡片类型与安全区布局', range: '归一化 0–1；设置界面按百分比输入', up: '分别向右或向下移动', down: '分别向左或向上移动', link: '最终位置受卡片尺寸、scale、窗口和安全区夹紧', risk: '需覆盖横竖屏及旧存档缺字段场景' },
    ],
  },
  {
    id: 'audio', title: '音频：总线、音量、加载与回退', groups: [],
    sources: 'src/systems/audio.js · src/ui/settings.js · src/main.js',
    overview: 'Beta 使用 master、SFX、BGM 三条 WebAudio 总线，SFX/BGM 汇入 master。设置存于 marmot3d.audio.beta.v1；音量均按 0–100% 钳制。主总线以旧合成器 0.32 为参考输出，因此 master 100% 保持既有平衡。AudioContext 在用户手势后创建/恢复，页面隐藏时挂起。',
    workflow: ['SFX 先读取本地 manifest，再按需加载和解码 MP3；不存在、404、网络或解码失败会回退程序化音效，并有限流/并发限制。', 'BGM 有 menu、explore、tension、combat、victory、defeat 六种槽位，按游戏状态选择并交叉淡变；缺文件时回退程序化三角波旋律，暂停可淡出到静默。', '这里描述的是当前本地资源与回退实现，不包含尚未合入的在线音乐生成或 TOS 功能。'],
    risks: ['总音量与分总线音量相乘，双重拉高可能削波，双重拉低会误判资源缺失。', '静音测试要区分 enabled 开关、音量 0、浏览器自动播放限制和文件回退；资源修改后检查 manifest 路径完全一致。'],
    extra: [
      { name: 'AUDIO_DEFAULTS.masterVolume', def: '100（%）', range: '0–100%', up: '提高音乐和音效总输出', down: '同时降低两路输出，0 为静音', link: '主增益为 0.32 × masterVolume / 100', risk: '与分总线高音量叠加后检查削波' },
      { name: 'AUDIO_DEFAULTS.sfxVolume / sfxEnabled', def: '100（%）/ true', range: '0–100% / 布尔', up: '提高音效或开启音效', down: '降低音效；关闭开关直接静音 SFX 总线', link: '仍受 masterVolume 与全局 enabled 影响', risk: '排障时先区分开关与音量' },
      { name: 'AUDIO_DEFAULTS.bgmVolume / bgmEnabled', def: '38（%）/ true', range: '0–100% / 布尔', up: '提高音乐或开启音乐', down: '降低音乐；关闭开关使 BGM 总线为 0', link: '切换状态和场景交叉淡变，存储键同音频设置', risk: '关闭后再开启应恢复当前期望槽位，而非重复叠放' },
    ],
  },
  {
    id: 'admin', title: '调参后台：实时预览、保存与导入导出', groups: [],
    sources: 'src/admin/main.mjs · src/admin/panel.mjs · src/admin/tuning-schema.mjs · server/accounts/server.mjs',
    overview: '滑块/数字输入改变 state.values 后立即刷新本页 3D 预览和时序摘要；不会写回源码，也不等于修改线上游戏常量。每个条目包含 id、中文名、来源、默认值、类型、范围和单位，角度类在界面显示为度、存储仍为弧度。',
    workflow: ['“导出配置/复制”生成含 detail 的人类可读 JSON；“导入配置”校验 schemaVersion，只合并 values，未知字段忽略，越界值钳制并恢复预览。', '“保存到服务器”使用不含 detail 的精简 JSON，按 1–50 位名字保存到账号服务 configs.jsonl；同名需内联确认覆盖，可列表刷新、加载或两次点击删除。', '服务器保存和文件导出是两条独立通道：前者便于命名读取，后者便于留档/传输。加载服务器配置与导入文件一样只改当前预览，不写回源文件。'],
    risks: ['schemaVersion 不匹配或 JSON 非对象会拒绝导入；不能把任意旧配置当作无条件覆盖。数值范围是面板安全边界，不保证任意组合都有良好玩法。', '配置接口当前沿用既有公开读写和限流行为，反馈代理则使用账号会话，两者鉴权语义不同。服务器单配置含信封上限 100KB，因此精简结构不带 detail。', '验证顺序建议：实时预览 → 导出备份 → 服务器命名保存 → 刷新后加载比对 → 在真实游戏构建中另行落实并回归。'],
    extra: [
      { name: 'ADMIN_SCHEMA_VERSION', def: '1', range: '整数 schema 版本', up: '仅结构有兼容迁移策略时才应升级', down: '不应手工降低来绕过校验', link: '导入、文件导出和服务器精简保存共同使用', risk: '不匹配会明确拒绝，不可当作游戏平衡数值' },
      { name: 'CONFIG_MAX_BYTES / CONFIG_NAME_RE', def: '100 KB / 1–50 位合法配置名', range: '服务端硬限制；中英文、数字、-、_', up: '扩大上限需评估存储与请求体限制', down: '缩小上限会更早拒绝大配置', link: '与 BODY_LIMIT、精简 values、同名覆盖联动', risk: '不要为了绕过上限而删除必要 values；导入导出仍保留' },
    ],
  },
];

const has = (entry, pattern) => pattern.test(`${entry.label} ${entry.id}`);
/** 每个 schema 参数都给出方向说明；具体机制与危险组合由所属 guide 补充。 */
export function parameterEffect(entry) {
  const label = entry.label;
  if (entry.kind === 'boolean') return { up: '开启该机制或视觉选项', down: '关闭该机制或视觉选项', link: '按来源字段参与当前机制，不改变无关系统', risk: '开关后做一次进入/退出和刷新验证' };
  if (entry.kind === 'enum') return { up: `切换模式（可选：${entry.options.join(' / ')}）`, down: '不存在数值大小；按模式语义选择', link: '决定状态机使用的行为分支', risk: '切换后验证该模式的完整进入与退出路径' };
  if (has(entry, /冷却|cooldown/i)) return { up: '两次动作间隔更长，操作/攻击频率降低', down: '动作更密集，资源与动画压力增大', link: '与后摇、无敌、体力和最短相位共同限频', risk: '接近 0 时重点验证连发与状态重入' };
  if (has(entry, /后摇|恢复锁定|最短停留|停留|记忆|耗时|前摇|蓄力|冲刺持续|时长|时间|time|windup|recovery|linger|exitMemory/i)) return { up: '延长对应动作、状态或记忆窗口', down: '缩短窗口，节奏更快', link: '与冷却、动画、预警和状态机退出条件联动', risk: '过短可能跳过可反应窗口，过长可能显得失控或卡态' };
  if (has(entry, /伤害|damage/i)) return { up: '提高对应攻击或类型的伤害', down: '降低伤害，需要更多次命中', link: '与姿态倍率、攻击体积、生命和撤退阈值联动', risk: '高伤害可能绕过预期的多轮交战节奏' };
  if (has(entry, /消耗|cost/i)) return { up: '单次或持续资源消耗增加', down: '资源消耗减少，可更频繁执行', link: '与能量/体力上限、恢复、冷却和收益共同决定续航', risk: '零消耗叠加短冷却可能破坏资源约束' };
  if (has(entry, /速度|speed|velocity|accel|brake/i)) return { up: '移动、转向或对应速度过程更快', down: '对应过程更慢', link: '与距离、时长、加速度、碰撞和预警线联动', risk: '高速下检查穿透、转向和实际位移；零值检查停滞' };
  if (has(entry, /半径|范围|距离|视距|range|radius|distance|reach|threshold|间距/i)) return { up: '扩大对应距离、触发范围或间隔', down: '缩小对应距离、触发范围或间隔', link: '与碰撞半径、角度、位置和目标筛选共同生效', risk: '检查最小/最大区间反转、隔空触发与目标重叠' };
  if (has(entry, /击退|knockback/i)) return { up: '命中后的位移或抗击退效果增强', down: '击退效果减弱', link: '与狐狸质量、击退倍率、阻力和场地边界联动', risk: '极端值可能把目标推入障碍或连续控制' };
  if (has(entry, /生命|血量|maxHp|hp/i)) return { up: '提高生命或相关血量阈值', down: '降低生命或相关血量阈值', link: '与伤害、恢复、撤退比例共同决定交战轮次', risk: '阈值类参数调高可能更早撤退，并非单纯更耐打' };
  if (has(entry, /能量|储备|体力|energy|stamina|regen|再生|恢复/i)) return { up: '提高对应资源量、收益或恢复速度', down: '降低对应资源量、收益或恢复速度', link: '与移动/攻击消耗、草密度和洞穴恢复倍率联动', risk: '验证满载、耗尽和持续恢复，防止无限资源' };
  if (has(entry, /权重|weight/i)) return { up: '提高该因素在效用评分中的影响', down: '降低该因素影响，0 可移除该项贡献', link: '不是概率；与其他意图得分比较后选择最高项', risk: '单项极高会压制其他意图，需观察完整决策分布' };
  if (has(entry, /数量|count|段数/i)) return { up: '增加对象、敌人或动作段数', down: '减少数量或动作段数', link: '与刷新、性能、目标和协同节奏联动', risk: '大数量检查性能与拥挤，段数需整数' };
  if (has(entry, /坐标|\.x$|\.z$/i)) return { up: '沿该坐标轴正方向移动布局点', down: '沿该坐标轴负方向移动布局点', link: '与半径、地形、障碍和世界缩放共同决定最终位置', risk: '移动后检查洞口、刷点、岩石与边界间距' };
  if (has(entry, /颜色|color/i)) return { up: '提高十进制颜色数值（不是线性变亮）', down: '降低十进制颜色数值', link: '以 0x000000–0xffffff RGB 数值参与渲染', risk: '按 RGB 验证颜色，不要当普通强度滑块理解' };
  if (has(entry, /光照|强度|Intensity|ambient/i)) return { up: '提高对应光照或环境强度', down: '降低强度，画面更暗或影响更弱', link: '与颜色、雾、洞穴压暗和渲染设置联动', risk: '极端值检查过曝、全黑与洞内外切换' };
  if (has(entry, /倍率|Mul|scale|Rate|rate|比例/i)) return { up: '提高对应倍率、缩放或速率', down: '降低对应倍率、缩放或速率', link: '通常与基础值或其他档案倍率相乘，而非替换', risk: '同时修改基础值和倍率会叠加，需记录最终值' };
  if (has(entry, /透明度|opacity/i)) return { up: '更不透明', down: '更透明', link: '与整体透明度及单项透明度相乘', risk: '只改变显示，不改变交互命中区域' };
  return { up: `提高「${label}」的数值或强度`, down: `降低「${label}」的数值或强度`, link: `按 ${entry.source} 参与「${entry.group}」机制`, risk: '在默认值附近小步修改，并验证最小值、默认值和最大值' };
}

export function defaultText(entry) {
  const value = entry.viewDef ?? entry.def;
  if (entry.kind === 'boolean') return value ? '开（true）' : '关（false）';
  return String(value);
}

export function rangeText(entry) {
  if (entry.kind === 'enum') return entry.options.join(' / ');
  if (entry.kind === 'boolean') return 'true / false';
  return `${entry.min}–${entry.max}${entry.unit ? ` ${entry.unit}` : ''}，步长 ${entry.step}`;
}

export function buildMechanismDocs(entries) {
  return MECHANISM_GUIDES.map((guide) => ({
    ...guide,
    parameters: entries.filter((entry) => guide.groups.includes(entry.group)).map((entry) => ({
      id: entry.id, group: entry.group, name: entry.label, source: entry.source, file: entry.file,
      def: defaultText(entry), range: rangeText(entry), ...parameterEffect(entry),
    })),
  }));
}
