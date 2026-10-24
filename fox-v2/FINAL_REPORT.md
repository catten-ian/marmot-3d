# 藏狐 v2 改造报告

## 阶段 1：藏狐生理层 —— 体力条 / 血量影响 / 休息回血

### 设计口径（用户拍板）
- **体力耗尽 ≠ 被驱退**：体力只是"能不能冲刺/扑咬"的开关，见底后只能慢行/休息，不会被判定为已驱退。
- 静止休息缓慢回血 + 回体力（回血慢，玩家节奏上仍打得动狐狸）。
- 被土拨鼠攻击同时扣血和扣一部分体力。
- 血条低 → 速度与伤害下降。
- 慢行不耗体力；冲刺/扑咬耗体力。
- 本阶段不允许玩家打死狐狸，但机制上保留 hp 归零分支（死亡/平衡是阶段 2）。

### 新增 `FOX.vitals` 字段与取值（src/core/config.js）
| 字段 | 值 | 说明 |
|---|---|---|
| maxStamina | 100 | 体力上限 |
| stalkStaminaPerSec | 0 | 慢行/潜行接近：不耗体力 |
| sprintStaminaPerSec | 18 | 冲刺持续消耗/秒 |
| pounceStaminaPerSec | 26 | 扑咬冲刺阶段消耗/秒（阶段 1 冲刺统一按此值） |
| restStaminaPerSec | 14 | 休息回体力/秒 |
| restHpRegenRatio | 0.035 | 休息回血/秒（占 maxHp 比例） |
| hitStaminaCost | 7 | 每次受击额外扣体力 |
| staminaLockSeconds | 1.2 | 体力见底后禁止冲刺的锁定时长 |
| lowHpThreshold | 0.5 | 低于此血量比例开始影响速度/伤害 |
| speedMulAtZeroHp | 0.72 | 零血时的速度倍率下限 |
| damageMulAtZeroHp | 0.6 | 零血时的伤害倍率下限 |

### 体力收支表（哪个状态扣多少 / 回多少）
| 状态 | 体力/秒 | 血量/秒 |
|---|---|---|
| dash（普通狐冲刺 / 智能狐 pounceCommitted） | −26（pounceStaminaPerSec） | 0 |
| rest（冲刺后喘息 / recover / abandon） | +14 | +3.5% maxHp |
| roam / wind / circle / linger / abandon 移动 | 0（stalk=0） | 0 |
| 受击（一次性） | −7 | −damage |

唯一收支入口是纯函数 `stepStamina(state, dt, options)`（src/core/fox-motion.js），
返回 `{stamina, locked, exhausted, hp}` 新值，不改传入对象。

### 低血速度/伤害倍率曲线
hpRatio 与倍率（低血阈值 0.5，线性插值）：
| hpRatio | 速度倍率 | 伤害倍率 |
|---|---|---|
| 1.0 | 1.00 | 1.00 |
| 0.75 | 1.00 | 1.00 |
| 0.5 | 1.00 | 1.00 |
| 0.25 | 0.86 | 0.80 |
| 0.0 | 0.72 | 0.60 |

速度倍率作用于普通狐地面移动（`update()` 里 `speed`）与冲刺速度（`FOX.dashSpeed × dashSpeedMul` 处）；
伤害倍率作用于狐狸打玩家的结算点（src/main.js 接触伤害 `damage` 处）。

### 体力不足时的行为
- **普通狐**：`_beginDash()` 入口处守卫 —— `staminaLocked > 0` 或 `!canSprint(stamina, sprintStaminaPerSec, dashTime)` 时不冲刺，落到 `state='rest'`（timer ≥ 0.6s），清掉 combo 账本与预警线。覆盖 wind→dash、drill、combo 各路径。
- **智能狐**：`stepSmartMotion` 的 `options.commitAllowed` 追加 `staminaLocked <= 0 && canSprint(stamina, pounceStaminaPerSec, pounceLockTime)`，体力不足时永不提交扑击，狐狸继续走 observe/approach/feint 等非扑击意图。
- 体力见底（drain 到 0）置 `exhausted` 且 `locked = 1.2s`，locked 期间即使休息回了点体力也不允许冲刺（防抖动）。

### 体力条显示
- 独立 `buildStaminaBar()`（结构与血条一致：group → bg + userData.fill，左锚收缩，不缩放 group）。
- 颜色暖金 `0xe0b34a`（血条 `0xd8735a`），位置在血条下方：`baseY + 1.38 × scale`（血条 1.55 × scale）。
- 只在 `stamina < maxStamina − 0.5` 时显示，避免画面 clutter；flee/死亡/sandbox dummy 时隐藏。
- `_updateStaminaBar()` 与 `_updateHpBar()` 同款 lookAt billboard。

### 其它接入点
- `hit()`：普通狐与 sandbox dummy 两个分支都在扣血的同时扣 `hitStaminaCost` 体力（dummy 分支其余逻辑未动）。
- `respawnAt()`：复位时体力回满、`staminaLocked = 0`。
- `dispose()`：释放 staminaBar。
- `SmartFox.update()`：接入同一 `stepStamina`（`this.state==='rest'` 为 resting，pounceCommitted 为 drain）。

### 新增/修改文件
- `src/core/config.js`：新增 `FOX.vitals`
- `src/core/fox-motion.js`：新增 `canSprint` / `hpSpeedMultiplier` / `hpDamageMultiplier` / `stepStamina`
- `src/entities/fox.js`：体力字段、体力条、stepStamina 接入、_beginDash 守卫、低血速度倍率、hit/respawnAt/dispose
- `src/entities/smart-fox.js`：stepStamina 接入、commitAllowed 体力守卫、体力条更新
- `src/entities/smart-fox-core.mjs`：未改（体力纯函数放 fox-motion.js，决策权重本阶段不动）
- `src/main.js`：狐狸打玩家伤害乘 `hpDamageMultiplier`
- `tools/test-fox-vitals.cjs`：新增（run-node-tests.cjs 为自动发现 tools/test-* 文件，无需注册条目）
- `tools/run-node-tests.cjs`：未改（自动发现机制）

### 测试项与结果（tools/test-fox-vitals.cjs，9 项全过）
1. FOX.vitals 存在且方向正确
2. canSprint 足够/不足/保底 0.1s
3. hpSpeedMultiplier 阈值=1、零血=0.72、单调递减
4. hpDamageMultiplier 阈值=1、零血=0.6、单调递减
5. stepStamina 冲刺 1s 按 18/s 消耗
6. stepStamina 休息 1s 回 14 体力 + 3.5% maxHp 血量（封顶 100%）
7. 体力到 0 → exhausted=true、locked=1.2
8. locked 期间即使回了体力也不允许冲刺
9. 纯函数：不修改传入对象

`node tools/run-node-tests.cjs`：OK 37/37（22 个浏览器/CDP 测试按惯例跳过）。

### 验证清单
- node --check：config.js / fox-motion.js / fox.js / smart-fox.js / smart-fox-core.mjs / main.js 全过
- node tools/run-node-tests.cjs：37/37 PASS
- grep stepStamina / stamina：接入点齐全

## 阶段 2：驱退口径改造 —— 狐狸自主撤退 / 撤退即驱退 / 允许打死但玩家打不死

### 新的驱退语义（与旧语义对照）

| 维度 | 旧口径（阶段 1 及之前） | 新口径（本阶段） |
|---|---|---|
| 驱退触发 | `hp <= 0` 由 `hitFox()` 强塞：打空血 → 强制 `startFleeing()` | 狐狸**自主**判断（血量/体力/连被打），`_enterRetreat()` 主动撤 |
| 驱退计数时点 | 打空血的那一帧 | 狐狸撤到休息点、**进入 `rest_safe` 的那一刻**（去休息 = 被驱退） |
| `hp <= 0` 的含义 | 不会死，转身逃跑后重生（增援） | **真死**：`state='dead'`，不 flee、不 respawn、不再参与更新 |
| 玩家胜利路径 | 打空血 | **逼退**（设计上玩家几乎打不死：它剩一截血就自己撤了） |
| 撤退还击 | 逃跑中不可互动 | 撤退/休息中可被命中但**不退出撤退**、不重置计数 |

### 撤退触发条件与优先级

纯函数 `shouldRetreat({hpRatio, staminaRatio, hitStreak, state}, FOX.retreat)`（`src/core/fox-motion.js`），
在 `Fox.update()` 每帧由狐狸自身状态求值，**不经外部受击逻辑**：

1. `state` 为 `wind` / `dash`（攻击流程中）→ 永不撤退（最高优先级，否决项）
2. `state` 为 `retreat` / `rest_safe` / `dead` → 不重复触发
3. `hpRatio ≤ 0.45`（`FOX.retreat.hpRatio`）→ 撤退
4. `staminaRatio ≤ 0.25`（`FOX.retreat.staminaRatio`）→ 撤退
5. `hitStreak ≥ 4`（连续被打，脱战 6s 后衰减清零）→ 撤退
6. 迎击练习狐（`drillCtx`）不撤退，由复位机制接管

休息点选择（`chooseRestPoint` 纯函数）：优先"离玩家 ≥16m 的洞穴口背玩家一侧"，
否则沿背离玩家方向推 26m，均夹在活动场边界内。

### `rest_safe` 流程与时长

- `retreat`：以 `FOX.retreat.speed = 6.0`（快于慢行、慢于冲刺、不耗体力）跑向休息点，距 `< 1.5m` 到达
- 到达 → `enterRestSafe()`：`state='rest_safe'`、`repelCounted=true`，**仅当本回合首次进入时**调用
  `this.onRepelled(this)`（方式 A 回调，`main.js` 的 `wireRepelCallback` 注入：
  `levelRepels++` / `totalRepels++` / `charge +18` / `energy +8` / `audio.repel()` /
  `'威胁已解除'` 飘字 / `colRepel` 粒子 / `recordTestLog('fox-repelled')`）
- `rest_safe` 中静止休息：复用阶段 1 `stepStamina` 的 `resting=true` 分支回血回体力
- 休息时长（`FOX.retreat.restSeconds`）：normal 6s / pup 4.5s / fast 5s / heavy 7s / **boss 12s** / smart 7s；
  计时到**或血回满**→ `exitRestSafe()` 回 `roam`，`repelCounted` 复位（下次撤退可再计数）

### 死亡路径（为什么玩家打不死）

`hp <= 0` → `resolveHitState` 返回 `'dead'`：隐藏 mesh/warn/双条，不 flee、不 respawn。
正常路径打不死的原因：撤退阈值 `hpRatio 0.45` 远高于致死区，狐狸在血量还剩近一半时就已撤离战斗，
玩家没有持续输出的窗口；打死只发生在"撤退前被爆发伤害瞬间清空"的理论路径。
`hitFox()` 中 `hp<=0` 只做死亡表现（飘字/粒子/音效/`recordTestLog('fox-died')`），**不计驱退**。
关卡通关目标本就为"采食 + 伙伴到家 + 回洞"，不依赖驱退数，故狐狸真死不会卡关。

### 智能狐对齐

- `SmartFox.update()` 顶部新增 `shouldRetreat` 硬阈值检查：满足即 `_enterRetreat()` 并交回普通狐狸逻辑
- `retreating` / `rest_safe` / `dead` 状态整体回落到 `Fox.update()`（撤退移动、休息回血、死亡表现复用）
- 效用层的 `recover` / `abandon` 意图本就偏向低血/疲劳撤离（权重未动，阶段 4 的活）；
  硬阈值兜底保证低血智能狐**更早**转入真正的撤退并入 `rest_safe` 计数，而不是等 `hp≤0`
- 休息结束一并清零 `fatigue`

### 文案改动前后对照

| 位置 | 改前 | 改后 |
|---|---|---|
| 标题面板 | "你不会真的杀死藏狐。把它们打到体力耗尽后，它们会夹着尾巴转身逃跑……" | "你几乎打不死藏狐 —— 它会自己判断形势，血量体力见底就撤到远处躲起来回血。**逼退**它才算解决威胁。" |
| 帮助页 | "**驱退不等于杀死**：藏狐体力耗尽后会转身逃向草地边缘……" | "**逼退不等于杀死**：藏狐察觉形势不利会主动撤到安全处休息回血，休息够了再回来。你要做的不是把它打死，是把它**逼退**。" |
| `hitFox` 注释 | "体力耗尽 = 被驱退。它不会死，而是转身逃跑。" | 新口径注释：驱退由 rest_safe 回调计数，hp≤0 是真死、不计驱退 |

全仓 `grep 体力耗尽` 仅剩两处"体力耗尽 ≠ 被驱退"的否定式注释（符合口径）。

### 测试项与结果（tools/test-fox-repel.cjs，12 项全过）

1. `FOX.retreat` 配置存在且方向正确（首领休息 > 普通狐）
2. 血量健康+体力充足+蓄力/冲刺中 → 不撤退
3. 血量低 + 空闲 → 撤退
4. 体力低 + 空闲 → 撤退
5. 连被打 ≥ 阈值 → 撤退；血量健康 → 不撤退
6. 撤退/休息/死亡中不重复触发
7. `chooseRestPoint` 优先选远离玩家的洞穴
8. 无洞穴 → 背离玩家方向且夹在边界内
9. `enterRestSafe` 计数恰好一次（连续进入不重复）
10. `stepRestSafe` 计时到/血回满 → done
11. `exitRestSafe` 回 `roam` 且 `repelCounted` 复位（可再计数）
12. `resolveHitState`：`hp≤0 → 'dead'`（非 flee）；完整撤退循环串联

`node tools/run-node-tests.cjs`：OK 38/38（22 个浏览器/CDP 测试按惯例跳过）。

### 验证清单

- `node --check`：fox.js / main.js / smart-fox.js / config.js / fox-motion.js / drill.js 全过
- `node tools/run-node-tests.cjs`：38/38 PASS
- `grep levelRepels src/main.js`：自增仅出现在 `wireRepelCallback` 一处
- `grep startFleeing`：main.js 已无调用；fox.js 保留为 legacy 兜底（不再有触发方）

---

## 阶段 3：战术层 —— 包抄 / 协作 / 受伤就撤

### 1. 包抄槽位分配规则

- **逃跑轴估计**：每只智能狐对玩家位移速度做一阶低通（`dt*3` 增益）得到 `_escVel`，速度 >0.5 m/s 时取 `atan2(vx,vz)` 为 `escapeAxis`；玩家基本不动时退化为"远离本狐"方向。
- **槽位生成** `flankSlots(count, escapeAxis, player, radius=6)`：以逃跑轴正后方（180°）为基准，按 60° 步长向两侧对称展开 —— 3 只狐 → 180° / 120° / 240°，全部落在逃跑轴后半球，绝不挤在玩家前进正面。
  ```
              玩家 → 逃跑方向
        槽2(240°)  槽0(180°)  槽1(120°)
              ← 狐从侧后方收拢
  ```
- **槽位认领** `assignFlankSlot(self, peers, slots)`：未被同伴 `flankSlotIndex` 占用的槽位中挑最近的，自己上一轮占过的槽位有 1.5m 粘性偏置（不来回跳）；无可用槽位返回 `null` → 退回原直追半径，不崩。
- `approach` 意图下目标点改为分到的槽位；到槽位 1.3m 内降级为 `observe` 等时机。`observe`/`approach` 的权重与既有半径行为未动。

### 2. 角色派发表（`assignRoles`，复用 `createSmartPack` 之上）

| 角色 | 职责 | 切换条件 | 粘性 |
|---|---|---|---|
| striker | 主攻，独占扑咬提交权（`commitAllowed` 只有它为 true） | 距玩家近 + 血量体力最足者 | 1.5s 内不换人 |
| flanker | 绕逃跑轴侧后槽位 | 非主攻者按 slot 交替 | 1.5s |
| distractor | 正面施压，不提交扑咬 | 非主攻者按 slot 交替 | 1.5s |
| retreat | 撤退回血 | 血量<45% / retreating / rest_safe / dead | 即时 |

效果：玩家同一时刻只面对一次有威胁的扑咬（`canCommit` 错峰仍在，角色门控在其之上叠加，不重写）。

### 3. 受伤撤退触发与恢复流程

1. `hit()` 记录 `_lastHitAt = _age`；
2. 下一帧 `forcedRetreat({lastHitAt}, {now, window:0.05})` 硬规则触发（覆盖 utility 打分，未改 `SMART_WEIGHTS`）→ 进入 0.45s **侧向甩开**窗口：意图强制 `recover`，目标点 = 背离玩家方向 ± 75° 侧移，不直线背逃；
3. 甩开结束 → `_enterRetreat()` 走阶段 2 的 retreat → `rest_safe` 回血链路（驱退计数不变）；
4. 从 `rest_safe` 归队 → 8s **谨慎期**（`_cautiousUntil`），期间不提交扑咬。

### 4. 复用的既有机制

- `createSmartPack` 错峰提交（未重写，仅叠加 striker 门控）
- `flankBias` / `foxSeparation`：侧向偏置与防挤分离原样保留
- `memory` / `hitStreak` / `interruptions` / `trackFeint`：惯性与记忆照旧
- 阶段 2 `shouldRetreat` / `_enterRetreat` / `rest_safe` 链路
- `Fox.slot`：角色派发与槽位占用的稳定身份

### 5. 测试项与结果

`tools/test-fox-tactics.cjs`（12 项，已注册进 `run-node-tests.cjs` 的自动发现）：

- `flankSlots`：数量正确 / 角度互不重叠 / 全在逃跑轴后半球（3 只=120°/180°/240°）/ 单只=正后方 / count=0 返回空
- `assignFlankSlot`：两狐不同槽、占位避让、粘性保持、无槽返回 null
- `assignRoles`：唯一 striker、伤员与撤退中=retreat、同输入两次结果相同、holdTime 内不换主攻 / 超时允许换、单只=striker、空数组不崩
- `forcedRetreat`：刚被打 true / 未被打 false / 旧受击 false

`node tools/run-node-tests.cjs`：OK 39/39（22 个浏览器/CDP 测试按惯例跳过）。

### 验证清单

- `node --check`：smart-fox-core.mjs / smart-fox.js / main.js 全过
- `node tools/run-node-tests.cjs`：39/39 PASS
- `grep flankSlots|assignFlankSlot|assignRoles|forcedRetreat src/entities/smart-fox-core.mjs`：四个导出均在
- observe/approach 权重与 `SMART_WEIGHTS`、普通狐 `Fox` 追击逻辑均未改
