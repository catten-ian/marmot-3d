# Beta 独立数值 / 可视化后台交付报告

- 页面：根目录 `admin.html`，部署访问路径 `/marmot3d-beta/admin.html`；不在主游戏页添加入口。
- 版本：页面读取 `IS_BETA`、`CHANNEL_SHORT`、`BUILD_STAMP`；当前源码为 Beta 通道逻辑、构建戳 `rev22`。非 Beta 路径显示提醒，页面只改内存态预览，不回写游戏源码。
- 可调条目：**549 项**（含数值、枚举与布尔项），支持全局中文名 / id / 常量 / 分组搜索，逐组或全局恢复默认。

## 页面与模块清单

| 路径 | 职责 |
|---|---|
| `admin.html` | 独立入口、自包含样式与 importmap；只使用本地 Three.js 和 vendored 模块。 |
| `src/admin/main.mjs` | 版本栏、页面初始化、狐狸姿态/位置/朝向控件、时间窗口摘要、面板与预览协调。 |
| `src/admin/tuning-schema.mjs` | 549 项 schema、默认值快照、钳制、搜索、恢复、schemaVersion=1 导入导出纯函数。 |
| `src/admin/panel.mjs` | 数值列表、滑块/下拉/输入框、来源显示、配置文件导入导出和剪贴板回退。 |
| `src/admin/preview.mjs` | Three.js 实景预览、真实狐狸模型加载/回退、姿态模拟和攻击判定几何可视化。 |
| `tools/test-admin-tuning.mjs` | 钳制、schema/字段校验、导入导出往返、未知字段、恢复默认纯函数测试。 |

## 数值清单

以下范围是后台输入的合法钳制区间；角度以度显示，源常量仍按弧度存储。世界地图坐标、关卡项和布局项均纳入配置导入导出。

### 玩家 · 基础（24 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 移动速度 | `PLAYER.speed` | `src/core/config.js` | 4.8 m/s | 0.5 – 15 m/s（步长 0.05） |
| 后退速度倍率 | `PLAYER.backpedalSpeed` | `src/core/config.js` | 0.58 | 0 – 1（步长 0.005） |
| 碰撞半径 | `PLAYER.radius` | `src/core/config.js` | 0.42 m | 0.05 – 2 m（步长 0.005） |
| 碰撞高度 | `PLAYER.collisionHeight` | `src/core/config.js` | 0.54 m | 0.1 – 2 m（步长 0.005） |
| 视高 | `PLAYER.eyeHeight` | `src/core/config.js` | 0.46 m | 0.1 – 2 m（步长 0.005） |
| 生命上限 | `PLAYER.maxHp` | `src/core/config.js` | 100 | 1 – 500（步长 1） |
| 能量上限 | `PLAYER.maxEnergy` | `src/core/config.js` | 100 | 1 – 500（步长 1） |
| 身体转向速率 | `PLAYER.bodyTurnRate` | `src/core/config.js` | 10 | 0.5 – 30（步长 0.1） |
| 第一人称视野 | `PLAYER.fov.firstPerson` | `src/core/config.js` | 78 ° | 30 – 120 °（步长 0.2） |
| 第三人称视野 | `PLAYER.fov.thirdPerson` | `src/core/config.js` | 68 ° | 30 – 120 °（步长 0.2） |
| 姿态·奔跑判定速度阈值 | `PLAYER.posture.speedThreshold` | `src/core/config.js` | 0.18 | 0 – 1（步长 0.002） |
| 姿态·俯伏速率 | `PLAYER.posture.crouchRate` | `src/core/config.js` | 14 | 0 – 42（步长 0.2） |
| 姿态·起身速率 | `PLAYER.posture.standRate` | `src/core/config.js` | 6.5 | 0 – 19.5（步长 0.05） |
| 姿态·俯伏视高下降 | `PLAYER.posture.eyeDrop` | `src/core/config.js` | 0.19 m | 0 – 1 m（步长 0.002） |
| 姿态·俯伏视线下压 | `PLAYER.posture.pitchDrop` | `src/core/config.js` | 0.1 rad | 0 – 1 rad（步长 0.001） |
| 姿态·俯伏视野收窄 | `PLAYER.posture.fovNarrow` | `src/core/config.js` | 5 ° | 0 – 15 °（步长 0.05） |
| 姿态·俯伏颠簸增强 | `PLAYER.posture.bobBoost` | `src/core/config.js` | 0.7 | 0 – 2.1（步长 0.01） |
| 跳跃·起跳初速度 | `PLAYER.jump.velocity` | `src/core/config.js` | 4.1 m/s | 0 – 12 m/s（步长 0.05） |
| 跳跃·重力加速度 | `PLAYER.jump.gravity` | `src/core/config.js` | 9.8 m/s² | 0 – 30 m/s²（步长 0.1） |
| 跳跃·起跳冷却 | `PLAYER.jump.cooldown` | `src/core/config.js` | 0.35 s | 0 – 3 s（步长 0.01） |
| 跳跃·跳跃躲咬高度 | `PLAYER.jump.dodgeHeight` | `src/core/config.js` | 0.45 m | 0 – 2 m（步长 0.01） |
| 操控·转向速率 | `PLAYER.handling.turnRate` | `src/core/config.js` | 2.2 | 0 – 6.6（步长 0.02） |
| 操控·加速度 | `PLAYER.handling.accel` | `src/core/config.js` | 14 | 0 – 42（步长 0.2） |
| 操控·刹车强度 | `PLAYER.handling.brake` | `src/core/config.js` | 18 | 0 – 54（步长 0.2） |

### 玩家 · 攻击三招（42 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 推击·伤害倍率 | `PLAYER.combatWheel.tap.damageMul` | `src/core/config.js` | 1 | 0 – 5（步长 0.02） |
| 推击·消耗倍率 | `PLAYER.combatWheel.tap.costMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 推击·冷却下限 | `PLAYER.combatWheel.tap.cooldown` | `src/core/config.js` | 0.58 | 0 – 3（步长 0.01） |
| 推击·冷却倍率 | `PLAYER.combatWheel.tap.cooldownMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 推击·后摇 | `PLAYER.combatWheel.tap.recovery` | `src/core/config.js` | 0 | 0 – 2（步长 0.01） |
| 推击·追加距离 | `PLAYER.combatWheel.tap.range` | `src/core/config.js` | 0 | -1 – 5（步长 0.02） |
| 推击·范围倍率 | `PLAYER.combatWheel.tap.rangeMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 迎击·伤害倍率 | `PLAYER.combatWheel.stand.damageMul` | `src/core/config.js` | 1.8 | 0 – 5（步长 0.02） |
| 迎击·体力消耗 | `PLAYER.combatWheel.stand.cost` | `src/core/config.js` | 4 | 0 – 20（步长 0.1） |
| 迎击·冷却下限 | `PLAYER.combatWheel.stand.cooldown` | `src/core/config.js` | 0.18 | 0 – 3（步长 0.01） |
| 迎击·冷却倍率 | `PLAYER.combatWheel.stand.cooldownMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 迎击·后摇 | `PLAYER.combatWheel.stand.recovery` | `src/core/config.js` | 0.35 | 0 – 2（步长 0.01） |
| 迎击·追加距离 | `PLAYER.combatWheel.stand.range` | `src/core/config.js` | 0 | -1 – 5（步长 0.02） |
| 迎击·范围倍率 | `PLAYER.combatWheel.stand.rangeMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 迎击·眩晕时长 | `PLAYER.combatWheel.stand.stun` | `src/core/config.js` | 1.2 | 0 – 3（步长 0.01） |
| 迎击·锁定时长 | `PLAYER.combatWheel.stand.lock` | `src/core/config.js` | 0.4 | 0 – 2（步长 0.01） |
| 迎击·击退距离 | `PLAYER.combatWheel.stand.knockback` | `src/core/config.js` | 2.8 | 0 – 8（步长 0.02） |
| 扑击·伤害倍率 | `PLAYER.combatWheel.lunge.damageMul` | `src/core/config.js` | 1.45 | 0 – 5（步长 0.02） |
| 扑击·体力消耗 | `PLAYER.combatWheel.lunge.cost` | `src/core/config.js` | 4 | 0 – 20（步长 0.1） |
| 扑击·冷却下限 | `PLAYER.combatWheel.lunge.cooldown` | `src/core/config.js` | 0.18 | 0 – 3（步长 0.01） |
| 扑击·冷却倍率 | `PLAYER.combatWheel.lunge.cooldownMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 扑击·后摇 | `PLAYER.combatWheel.lunge.recovery` | `src/core/config.js` | 0.42 | 0 – 2（步长 0.01） |
| 扑击·追加距离 | `PLAYER.combatWheel.lunge.range` | `src/core/config.js` | 0.8 | -1 – 5（步长 0.02） |
| 扑击·范围倍率 | `PLAYER.combatWheel.lunge.rangeMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 扑击·位移距离 | `PLAYER.combatWheel.lunge.distance` | `src/core/config.js` | 2.8 | 0 – 8（步长 0.02） |
| 翻滚·伤害倍率 | `PLAYER.combatWheel.dodge.damageMul` | `src/core/config.js` | 0 | 0 – 3（步长 0.01） |
| 翻滚·体力消耗 | `PLAYER.combatWheel.dodge.cost` | `src/core/config.js` | 3 | 0 – 20（步长 0.1） |
| 翻滚·翻滚距离 | `PLAYER.combatWheel.dodge.distance` | `src/core/config.js` | 2.2 m | 0 – 10 m（步长 0.05） |
| 翻滚·无敌时长 | `PLAYER.combatWheel.dodge.invuln` | `src/core/config.js` | 0.42 s | 0 – 2 s（步长 0.01） |
| 翻滚·翻滚后摇 | `PLAYER.combatWheel.dodge.recovery` | `src/core/config.js` | 0.12 s | 0 – 3 s（步长 0.01） |
| 推击站立姿态·rangeMul | `PLAYER.combatWheel.tap.stand.rangeMul` | `src/core/config.js` | 0.92 | 0 – 3（步长 0.01） |
| 推击站立姿态·damageMul | `PLAYER.combatWheel.tap.stand.damageMul` | `src/core/config.js` | 0.9 | 0 – 3（步长 0.01） |
| 推击站立姿态·knockbackMul | `PLAYER.combatWheel.tap.stand.knockbackMul` | `src/core/config.js` | 1.5 | 0 – 3（步长 0.01） |
| 推击站立姿态·stunMul | `PLAYER.combatWheel.tap.stand.stunMul` | `src/core/config.js` | 1.1 | 0 – 3（步长 0.01） |
| 推击奔跑姿态·rangeMul | `PLAYER.combatWheel.tap.run.rangeMul` | `src/core/config.js` | 1.22 | 0 – 3（步长 0.01） |
| 推击奔跑姿态·damageMul | `PLAYER.combatWheel.tap.run.damageMul` | `src/core/config.js` | 1.25 | 0 – 3（步长 0.01） |
| 推击奔跑姿态·knockbackMul | `PLAYER.combatWheel.tap.run.knockbackMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 推击奔跑姿态·stunMul | `PLAYER.combatWheel.tap.run.stunMul` | `src/core/config.js` | 0.9 | 0 – 3（步长 0.01） |
| 迎击·迎击窗口 | `PLAYER.combatWheel.stand.parryWindow` | `src/core/config.js` | 0.3 s | 0 – 2 s（步长 0.01） |
| 迎击·迎击半角 | `PLAYER.combatWheel.stand.parryHalfAngle` | `src/core/config.js` | 80 ° | 0 – 180 °（步长 0.5） |
| 奔跑长按扑击阈值 | `PLAYER.combatWheel.charge.heavyHold` | `src/core/config.js` | 0.65 s | 0.1 – 2 s（步长 0.005） |
| 空中扑击伤害倍率 | `AERIAL_POUNCE_DAMAGE_MUL → PLAYER.combatWheel.aerialPounce.damageMul` | `src/core/combat-wheel.mjs` | 0.55 | 0 – 2（步长 0.01） |

### 玩家 · 攻击手势常量（8 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 摇杆死区 | `ATTACK_DEAD_ZONE` | `src/core/combat-wheel.mjs` | 18 px | 0 – 64 px（步长 1） |
| 扑击蓄力阈值 | `POUNCE_HOLD_MS` | `src/core/combat-wheel.mjs` | 650 ms | 100 – 2000 ms（步长 10） |
| 蓄力上限(自动释放) | `MAX_ATTACK_CHARGE_MS` | `src/core/combat-wheel.mjs` | 1500 ms | 500 – 4000 ms（步长 50） |
| 空中短按扑击伤害倍率 | `AERIAL_POUNCE_DAMAGE_MUL` | `src/core/combat-wheel.mjs` | 0.55 | 0 – 1（步长 0.005） |
| 迎击左滑阈值 | `PARRY_DRAG_THRESHOLD` | `src/core/combat-wheel.mjs` | 22 px | 4 – 80 px（步长 1） |
| 翻滚右滑阈值 | `ROLL_DRAG_THRESHOLD` | `src/core/combat-wheel.mjs` | 22 px | 4 – 80 px（步长 1） |
| 手势水平主导比 | `GESTURE_HORIZONTAL_RATIO` | `src/core/combat-wheel.mjs` | 1.1 | 0.5 – 3（步长 0.01） |
| 迎击默认半角 | `DEFAULT_PARRY_HALF_ANGLE` | `src/core/combat-wheel.mjs` | 80 ° | 0 – 180 °（步长 0.5） |

### 判定 · 攻击体积（7 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 攻击扇形半角 | `STRIKE_VOLUMES.halfAngle` | `src/systems/combat.js` | 78 ° | 2.8648 – 180 °（步长 0.5） |
| 推击体积下沿 | `STRIKE_VOLUMES.tap.lower` | `src/systems/combat.js` | 0.06 m | -1 – 2 m（步长 0.01） |
| 推击体积上沿 | `STRIKE_VOLUMES.tap.upper` | `src/systems/combat.js` | 1.18 m | 0.1 – 3 m（步长 0.01） |
| 迎击体积下沿 | `STRIKE_VOLUMES.stand.lower` | `src/systems/combat.js` | 0.06 m | -1 – 2 m（步长 0.01） |
| 迎击体积上沿 | `STRIKE_VOLUMES.stand.upper` | `src/systems/combat.js` | 1.18 m | 0.1 – 3 m（步长 0.01） |
| 扑击体积下沿 | `STRIKE_VOLUMES.lunge.lower` | `src/systems/combat.js` | -0.15 m | -1 – 2 m（步长 0.01） |
| 扑击体积上沿 | `STRIKE_VOLUMES.lunge.upper` | `src/systems/combat.js` | 2 m | 0.1 – 3 m（步长 0.01） |

### 判定 · 可视化默认项（3 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 默认攻击显示距离 | `strikeVolumeGeometryData(range 默认值)` | `src/systems/debug-volume-data.js` | 2.4 m | 0 – 12 m（步长 0.05） |
| 攻击扇形圆弧分段数 | `strikeVolumeGeometryData(segments 默认值)` | `src/systems/debug-volume-data.js` | 20 | 4 – 128（步长 1） |
| 狐狸攻击缺省冲刺时长 | `foxAttackGeometryData(dashTime 缺省值)` | `src/systems/debug-volume-data.js` | 0.32 s | 0.05 – 2 s（步长 0.005） |

### Beta · 平衡（11 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 移动速度倍率 | `BETA_TUNE.moveSpeedMul` | `src/core/beta-tuning.js` | 1.12 | 0.5 – 2（步长 0.005） |
| 冲刺移动消耗 | `BETA_TUNE.sprintMoveCost` | `src/core/beta-tuning.js` | 5 | 0 – 20（步长 0.1） |
| 花的数量 | `BETA_TUNE.flowerCount` | `src/core/beta-tuning.js` | 4 朵 | 0 – 20 朵（步长 0.1） |
| 啃草耗时 | `BETA_TUNE.grassSeconds` | `src/core/beta-tuning.js` | 0.6 s | 0.1 – 5 s（步长 0.02） |
| 伙伴跟随速度 | `BETA_TUNE.companionFollowSpeed` | `src/core/beta-tuning.js` | 9.6 m/s | 1 – 20 m/s（步长 0.05） |
| 伙伴跟随间距 | `BETA_TUNE.companionFollowGap` | `src/core/beta-tuning.js` | 1.05 m | 0.2 – 5 m（步长 0.02） |
| 啃食视高额外下降 | `BETA_TUNE.grazeEyeDropExtra` | `src/core/beta-tuning.js` | 0.12 m | 0 – 1 m（步长 0.005） |
| 第三人称啃食视高下降 | `BETA_TUNE.thirdPersonGrazeDrop` | `src/core/beta-tuning.js` | 1.05 m | 0 – 2 m（步长 0.01） |
| 扑击锁敌距离 | `BETA_TUNE.lungeLockRange` | `src/core/beta-tuning.js` | 9 m | 1 – 20 m（步长 0.05） |
| 扑击锁敌半角 | `BETA_TUNE.lungeLockHalfAngle` | `src/core/beta-tuning.js` | 81.8182 ° | 2.8648 – 180 °（步长 0.5） |
| 吃花立即完成 | `BETA_TUNE.flowerInstant` | `src/core/beta-tuning.js` | 开 | 开 / 关 |

### 洞穴与避难（23 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 主洞 X 坐标 | `BURROW.x` | `src/core/config.js` | -52 m | -100 – 100 m（步长 1） |
| 主洞 Z 坐标 | `BURROW.z` | `src/core/config.js` | 0 m | -100 – 100 m（步长 1） |
| 主洞半径 | `BURROW.r` | `src/core/config.js` | 8.2 m | 1 – 30 m（步长 0.1） |
| 主洞停留基准 | `BURROW_AI.lingerBase` | `src/core/config.js` | 3.6 s | 0 – 20 s（步长 0.1） |
| 避难洞停留 | `BURROW_AI.lingerShelter` | `src/core/config.js` | 2.8 s | 0 – 20 s（步长 0.1） |
| 停留活动半径 | `BURROW_AI.lingerRadius` | `src/core/config.js` | 4.5 m | 0 – 30 m（步长 0.1） |
| 离洞距离阈值 | `BURROW_AI.leaveDistance` | `src/core/config.js` | 18 m | 0 – 100 m（步长 0.5） |
| 离洞记忆时长 | `BURROW_AI.exitMemory` | `src/core/config.js` | 2.4 s | 0 – 20 s（步长 0.1） |
| 近洞离开覆盖距离 | `BURROW_AI.exitNearOverride` | `src/core/config.js` | 3 m | 0 – 20 m（步长 0.1） |
| 主洞·洞口半径 | `UNDERGROUND.base.openingRadius` | `src/core/config.js` | 2.2 m | 0.2 – 10 m（步长 0.02） |
| 主洞·开口坡外缘半径 | `UNDERGROUND.base.slopeRadius` | `src/core/config.js` | 3.6 m | 0.2 – 15 m（步长 0.05） |
| 主洞·腔室半径 | `UNDERGROUND.base.chamberRadius` | `src/core/config.js` | 3 m | 0.2 – 15 m（步长 0.05） |
| 主洞·腔室深度 | `UNDERGROUND.base.chamberDepth` | `src/core/config.js` | 3.8 m | 0.2 – 20 m（步长 0.05） |
| 主洞·洞内光照强度 | `UNDERGROUND.base.lightIntensity` | `src/core/config.js` | 6.2 | 0 – 20（步长 0.1） |
| 主洞·灯光颜色值 | `UNDERGROUND.base.lightColor` | `src/core/config.js` | `0xffc978` (16,763,256) | 0 – 16,777,215（步长 1） |
| 主洞·暖光 | `UNDERGROUND.base.warmLight` | `src/core/config.js` | 开 | 开 / 关 |
| 避难洞·洞口半径 | `UNDERGROUND.shelter.openingRadius` | `src/core/config.js` | 1.05 m | 0.2 – 10 m（步长 0.02） |
| 避难洞·开口坡外缘半径 | `UNDERGROUND.shelter.slopeRadius` | `src/core/config.js` | 1.9 m | 0.2 – 15 m（步长 0.05） |
| 避难洞·腔室半径 | `UNDERGROUND.shelter.chamberRadius` | `src/core/config.js` | 1.5 m | 0.2 – 15 m（步长 0.05） |
| 避难洞·腔室深度 | `UNDERGROUND.shelter.chamberDepth` | `src/core/config.js` | 2 m | 0.2 – 20 m（步长 0.05） |
| 避难洞·洞内光照强度 | `UNDERGROUND.shelter.lightIntensity` | `src/core/config.js` | 0.28 | 0 – 20（步长 0.1） |
| 避难洞·灯光颜色值 | `UNDERGROUND.shelter.lightColor` | `src/core/config.js` | `0x8bb8c4` (9,156,804) | 0 – 16,777,215（步长 1） |
| 避难洞·暖光 | `UNDERGROUND.shelter.warmLight` | `src/core/config.js` | 关 | 开 / 关 |

### 狐狸 · 基础（27 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 蓄力触发距离 | `FOX.windRange` | `src/core/config.js` | 9.2 m | 1 – 25 m（步长 0.1） |
| 冲刺速度 | `FOX.dashSpeed` | `src/core/config.js` | 14.5 m/s | 2 – 30 m/s（步长 0.1） |
| 感知半径 | `FOX.roamRange` | `src/core/config.js` | 52 m | 5 – 120 m（步长 0.5） |
| 逃跑速度 | `FOX.fleeSpeed` | `src/core/config.js` | 5.8 m/s | 1 – 15 m/s（步长 0.05） |
| 逃跑时间上限 | `FOX.fleeMaxTime` | `src/core/config.js` | 4 s | 0.5 – 10 s（步长 0.02） |
| 地面攻击盒高度 | `FOX.groundAttackHeight` | `src/core/config.js` | 0.4 m | 0.05 – 2 m（步长 0.005） |
| 操控·冲刺最大转向 | `FOX.handling.maxTurnRate` | `src/core/config.js` | 0.78 | 0 – 2.34（步长 0.01） |
| 操控·转向加速度 | `FOX.handling.turnAccel` | `src/core/config.js` | 1.6 | 0 – 4.8（步长 0.02） |
| 操控·蓄力转向速率 | `FOX.handling.windTurnRate` | `src/core/config.js` | 1.1 | 0 – 3.3（步长 0.01） |
| 操控·蓄力转向加速度 | `FOX.handling.windTurnAccel` | `src/core/config.js` | 3.8 | 0 – 11.4（步长 0.05） |
| 操控·低速转向速率 | `FOX.handling.maxTurnSlow` | `src/core/config.js` | 2.8 | 0 – 8.4（步长 0.02） |
| 操控·转向速度衰减 | `FOX.handling.turnSpeedK` | `src/core/config.js` | 0.16 | 0 – 1（步长 0.002） |
| 操控·最小转向速率 | `FOX.handling.minTurnRate` | `src/core/config.js` | 0.28 | 0 – 1（步长 0.002） |
| 操控·行走转向加速度 | `FOX.handling.locomotionTurnAccel` | `src/core/config.js` | 3.8 | 0 – 11.4（步长 0.05） |
| 操控·行走加速度 | `FOX.handling.locomotionAccel` | `src/core/config.js` | 14 | 0 – 42（步长 0.2） |
| 操控·刹车插值 | `FOX.handling.brakeLerp` | `src/core/config.js` | 2.8 | 0 – 8.4（步长 0.02） |
| 操控·恢复期速度上限 | `FOX.handling.recoverySpeedMax` | `src/core/config.js` | 2.8 | 0 – 8.4（步长 0.02） |
| 后摇·普通 | `FOX.recovery.normal` | `src/core/config.js` | 1.15 s | 0 – 4 s（步长 0.02） |
| 后摇·疾冲 | `FOX.recovery.fast` | `src/core/config.js` | 0.9 s | 0 – 4 s（步长 0.02） |
| 后摇·跃扑 | `FOX.recovery.leap` | `src/core/config.js` | 1.05 s | 0 – 4 s（步长 0.02） |
| 后摇·连冲 | `FOX.recovery.combo` | `src/core/config.js` | 1.2 s | 0 – 4 s（步长 0.02） |
| 后摇·被格挡 | `FOX.recovery.blocked` | `src/core/config.js` | 0.9 s | 0 – 4 s（步长 0.02） |
| 程序化毛色·normal | `FOX.proceduralColors.normal` | `src/core/config.js` | `0xc4763a` (12,875,322) | 0 – 16,777,215（步长 1） |
| 程序化毛色·pup | `FOX.proceduralColors.pup` | `src/core/config.js` | `0xc4763a` (12,875,322) | 0 – 16,777,215（步长 1） |
| 程序化毛色·fast | `FOX.proceduralColors.fast` | `src/core/config.js` | `0xd9c294` (14,271,124) | 0 – 16,777,215（步长 1） |
| 程序化毛色·heavy | `FOX.proceduralColors.heavy` | `src/core/config.js` | `0x9c8770` (10,258,288) | 0 – 16,777,215（步长 1） |
| 程序化毛色·boss | `FOX.proceduralColors.boss` | `src/core/config.js` | `0x6b4c31` (7,031,857) | 0 – 16,777,215（步长 1） |

### 狐狸 · 类型表（48 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 普通狐·血量 | `FOX.types.normal.hp` | `src/core/config.js` | 3 | 1 – 40（步长 0.1） |
| 普通狐·速度倍率 | `FOX.types.normal.speed` | `src/core/config.js` | 1 | 0.2 – 3（步长 0.01） |
| 普通狐·蓄力倍率 | `FOX.types.normal.wind` | `src/core/config.js` | 1 | 0.2 – 3（步长 0.01） |
| 普通狐·质量(抗击退) | `FOX.types.normal.mass` | `src/core/config.js` | 1 | 0.1 – 3（步长 0.01） |
| 普通狐·击退倍率 | `FOX.types.normal.knockbackMul` | `src/core/config.js` | 1 | 0 – 3（步长 0.01） |
| 普通狐·体型缩放 | `FOX.types.normal.scale` | `src/core/config.js` | 1 | 0.3 – 2.5（步长 0.01） |
| 幼狐·血量 | `FOX.types.pup.hp` | `src/core/config.js` | 2 | 1 – 40（步长 0.1） |
| 幼狐·速度倍率 | `FOX.types.pup.speed` | `src/core/config.js` | 0.88 | 0.2 – 3（步长 0.01） |
| 幼狐·蓄力倍率 | `FOX.types.pup.wind` | `src/core/config.js` | 1.1 | 0.2 – 3（步长 0.01） |
| 幼狐·质量(抗击退) | `FOX.types.pup.mass` | `src/core/config.js` | 1.15 | 0.1 – 3（步长 0.01） |
| 幼狐·击退倍率 | `FOX.types.pup.knockbackMul` | `src/core/config.js` | 1.05 | 0 – 3（步长 0.01） |
| 幼狐·体型缩放 | `FOX.types.pup.scale` | `src/core/config.js` | 0.62 | 0.3 – 2.5（步长 0.01） |
| 疾行狐·血量 | `FOX.types.fast.hp` | `src/core/config.js` | 2 | 1 – 40（步长 0.1） |
| 疾行狐·速度倍率 | `FOX.types.fast.speed` | `src/core/config.js` | 1.2 | 0.2 – 3（步长 0.01） |
| 疾行狐·蓄力倍率 | `FOX.types.fast.wind` | `src/core/config.js` | 0.8 | 0.2 – 3（步长 0.01） |
| 疾行狐·质量(抗击退) | `FOX.types.fast.mass` | `src/core/config.js` | 0.85 | 0.1 – 3（步长 0.01） |
| 疾行狐·击退倍率 | `FOX.types.fast.knockbackMul` | `src/core/config.js` | 1.1 | 0 – 3（步长 0.01） |
| 疾行狐·体型缩放 | `FOX.types.fast.scale` | `src/core/config.js` | 0.88 | 0.3 – 2.5（步长 0.01） |
| 厚皮狐·血量 | `FOX.types.heavy.hp` | `src/core/config.js` | 6 | 1 – 40（步长 0.1） |
| 厚皮狐·速度倍率 | `FOX.types.heavy.speed` | `src/core/config.js` | 0.78 | 0.2 – 3（步长 0.01） |
| 厚皮狐·蓄力倍率 | `FOX.types.heavy.wind` | `src/core/config.js` | 1.15 | 0.2 – 3（步长 0.01） |
| 厚皮狐·质量(抗击退) | `FOX.types.heavy.mass` | `src/core/config.js` | 0.6 | 0.1 – 3（步长 0.01） |
| 厚皮狐·击退倍率 | `FOX.types.heavy.knockbackMul` | `src/core/config.js` | 0.62 | 0 – 3（步长 0.01） |
| 厚皮狐·体型缩放 | `FOX.types.heavy.scale` | `src/core/config.js` | 1.2 | 0.3 – 2.5（步长 0.01） |
| 狐首领·血量 | `FOX.types.boss.hp` | `src/core/config.js` | 18 | 1 – 40（步长 0.1） |
| 狐首领·速度倍率 | `FOX.types.boss.speed` | `src/core/config.js` | 1.1 | 0.2 – 3（步长 0.01） |
| 狐首领·蓄力倍率 | `FOX.types.boss.wind` | `src/core/config.js` | 0.9 | 0.2 – 3（步长 0.01） |
| 狐首领·质量(抗击退) | `FOX.types.boss.mass` | `src/core/config.js` | 0.38 | 0.1 – 3（步长 0.01） |
| 狐首领·击退倍率 | `FOX.types.boss.knockbackMul` | `src/core/config.js` | 0.38 | 0 – 3（步长 0.01） |
| 狐首领·体型缩放 | `FOX.types.boss.scale` | `src/core/config.js` | 1.6 | 0.3 – 2.5（步长 0.01） |
| 普通狐·碰撞半径 | `FOX.collisionRadius.normal` | `src/core/config.js` | 1.28 m | 0.1 – 3 m（步长 0.01） |
| 普通狐·碰撞高度 | `FOX.collisionHeight.normal` | `src/core/config.js` | 0.48 m | 0.1 – 2 m（步长 0.005） |
| 幼狐·碰撞半径 | `FOX.collisionRadius.pup` | `src/core/config.js` | 1.03 m | 0.1 – 3 m（步长 0.01） |
| 幼狐·碰撞高度 | `FOX.collisionHeight.pup` | `src/core/config.js` | 0.34 m | 0.1 – 2 m（步长 0.005） |
| 疾行狐·碰撞半径 | `FOX.collisionRadius.fast` | `src/core/config.js` | 1.28 m | 0.1 – 3 m（步长 0.01） |
| 疾行狐·碰撞高度 | `FOX.collisionHeight.fast` | `src/core/config.js` | 0.4 m | 0.1 – 2 m（步长 0.005） |
| 厚皮狐·碰撞半径 | `FOX.collisionRadius.heavy` | `src/core/config.js` | 1.53 m | 0.1 – 3 m（步长 0.01） |
| 厚皮狐·碰撞高度 | `FOX.collisionHeight.heavy` | `src/core/config.js` | 0.52 m | 0.1 – 2 m（步长 0.005） |
| 狐首领·碰撞半径 | `FOX.collisionRadius.boss` | `src/core/config.js` | 1.78 m | 0.1 – 3 m（步长 0.01） |
| 狐首领·碰撞高度 | `FOX.collisionHeight.boss` | `src/core/config.js` | 0.68 m | 0.1 – 2 m（步长 0.005） |
| 狐首领·接触距离 | `FOX.contact.boss` | `src/core/config.js` | 2.2 m | 0.3 – 5 m（步长 0.02） |
| 厚皮狐·接触距离 | `FOX.contact.heavy` | `src/core/config.js` | 1.95 m | 0.3 – 5 m（步长 0.02） |
| 幼狐·接触距离 | `FOX.contact.pup` | `src/core/config.js` | 1.45 m | 0.3 – 5 m（步长 0.02） |
| 默认·接触距离 | `FOX.contact.default` | `src/core/config.js` | 1.7 m | 0.3 – 5 m（步长 0.02） |
| 狐首领·伤害 | `FOX.damage.boss` | `src/core/config.js` | 22 | 0 – 60（步长 1） |
| 厚皮狐·伤害 | `FOX.damage.heavy` | `src/core/config.js` | 18 | 0 – 60（步长 1） |
| 幼狐·伤害 | `FOX.damage.pup` | `src/core/config.js` | 8 | 0 – 60（步长 1） |
| 默认·伤害 | `FOX.damage.default` | `src/core/config.js` | 12 | 0 – 60（步长 1） |

### 狐狸 · 攻击档案（27 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 幼狐·行为模式 | `FOX.attacks.pup.mode` | `src/core/config.js` | `leap` | `straight` / `leap` / `circle` / `combo` |
| 幼狐·蓄力时长倍率 | `FOX.attacks.pup.windMul` | `src/core/config.js` | 1.12 | 0.2 – 3（步长 0.01） |
| 幼狐·冲刺持续 | `FOX.attacks.pup.dashTime` | `src/core/config.js` | 0.34 s | 0.05 – 2 s（步长 0.005） |
| 幼狐·冲刺转向速率 | `FOX.attacks.pup.turnRate` | `src/core/config.js` | 0.42 rad/s | 0 – 3 rad/s（步长 0.01） |
| 幼狐·跃扑高度 | `FOX.attacks.pup.leapHeight` | `src/core/config.js` | 0.9 m | 0 – 3 m（步长 0.01） |
| 普通狐·行为模式 | `FOX.attacks.normal.mode` | `src/core/config.js` | `straight` | `straight` / `leap` / `circle` / `combo` |
| 普通狐·蓄力时长倍率 | `FOX.attacks.normal.windMul` | `src/core/config.js` | 1.2 | 0.2 – 3（步长 0.01） |
| 普通狐·冲刺持续 | `FOX.attacks.normal.dashTime` | `src/core/config.js` | 0.76 s | 0.05 – 2 s（步长 0.005） |
| 普通狐·冲刺转向速率 | `FOX.attacks.normal.turnRate` | `src/core/config.js` | 0.42 rad/s | 0 – 3 rad/s（步长 0.01） |
| 普通狐·预瞄提前量 | `FOX.attacks.normal.windLeadTime` | `src/core/config.js` | 0.75 s | 0 – 2 s（步长 0.01） |
| 疾行狐·行为模式 | `FOX.attacks.fast.mode` | `src/core/config.js` | `straight` | `straight` / `leap` / `circle` / `combo` |
| 疾行狐·蓄力时长倍率 | `FOX.attacks.fast.windMul` | `src/core/config.js` | 0.85 | 0.2 – 3（步长 0.01） |
| 疾行狐·冲刺持续 | `FOX.attacks.fast.dashTime` | `src/core/config.js` | 0.68 s | 0.05 – 2 s（步长 0.005） |
| 疾行狐·冲刺转向速率 | `FOX.attacks.fast.turnRate` | `src/core/config.js` | 0.16 rad/s | 0 – 3 rad/s（步长 0.01） |
| 疾行狐·预瞄提前量 | `FOX.attacks.fast.windLeadTime` | `src/core/config.js` | 0.35 s | 0 – 2 s（步长 0.01） |
| 厚皮狐·行为模式 | `FOX.attacks.heavy.mode` | `src/core/config.js` | `circle` | `straight` / `leap` / `circle` / `combo` |
| 厚皮狐·蓄力时长倍率 | `FOX.attacks.heavy.windMul` | `src/core/config.js` | 1.3 | 0.2 – 3（步长 0.01） |
| 厚皮狐·冲刺持续 | `FOX.attacks.heavy.dashTime` | `src/core/config.js` | 0.65 s | 0.05 – 2 s（步长 0.005） |
| 厚皮狐·冲刺转向速率 | `FOX.attacks.heavy.turnRate` | `src/core/config.js` | 0.28 rad/s | 0 – 3 rad/s（步长 0.01） |
| 厚皮狐·绕行时长 | `FOX.attacks.heavy.circleTime` | `src/core/config.js` | 1.15 s | 0.2 – 4 s（步长 0.01） |
| 厚皮狐·虚晃概率 | `FOX.attacks.heavy.lureChance` | `src/core/config.js` | 0.55 | 0 – 1（步长 0.005） |
| 狐首领·行为模式 | `FOX.attacks.boss.mode` | `src/core/config.js` | `combo` | `straight` / `leap` / `circle` / `combo` |
| 狐首领·蓄力时长倍率 | `FOX.attacks.boss.windMul` | `src/core/config.js` | 1.08 | 0.2 – 3（步长 0.01） |
| 狐首领·冲刺持续 | `FOX.attacks.boss.dashTime` | `src/core/config.js` | 0.42 s | 0.05 – 2 s（步长 0.005） |
| 狐首领·冲刺转向速率 | `FOX.attacks.boss.turnRate` | `src/core/config.js` | 0.38 rad/s | 0 – 3 rad/s（步长 0.01） |
| 狐首领·冲刺速度倍率 | `FOX.attacks.boss.dashSpeedMul` | `src/core/config.js` | 1.1 | 0.2 – 3（步长 0.01） |
| 狐首领·连冲段数 | `FOX.attacks.boss.comboCount` | `src/core/config.js` | 3 段 | 1 – 6 段（步长 1） |

### 狐狸 · 智能 AI 扑击（53 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 扑击最小距离 | `SMART_POUNCE.minDistance` | `src/entities/smart-fox-core.mjs` | 3 m | 0.5 – 15 m（步长 0.05） |
| 扑击最大距离 | `SMART_POUNCE.maxDistance` | `src/entities/smart-fox-core.mjs` | 7 m | 1 – 25 m（步长 0.1） |
| 扑击最大角度 | `SMART_POUNCE.maxAngle` | `src/entities/smart-fox-core.mjs` | 20 ° | 1.1459 – 90 °（步长 0.2） |
| 扑击前摇 | `SMART_POUNCE.windup` | `src/entities/smart-fox-core.mjs` | 0.22 s | 0 – 2 s（步长 0.01） |
| 扑击速度 | `SMART_POUNCE.speed` | `src/entities/smart-fox-core.mjs` | 10.6 m/s | 1 – 25 m/s（步长 0.1） |
| 扑击锁定时长 | `SMART_POUNCE.lockTime` | `src/entities/smart-fox-core.mjs` | 0.72 s | 0.1 – 3 s（步长 0.01） |
| 扑击冷却 | `SMART_POUNCE_COOLDOWN` | `src/entities/smart-fox-core.mjs` | 1.2 s | 0 – 5 s（步长 0.02） |
| 恢复锁定 | `RECOVER_LOCK` | `src/entities/smart-fox-core.mjs` | 0.6 s | 0 – 3 s（步长 0.01） |
| 相位最短停留·观察 | `SMART_PHASE_MIN.observe` | `src/entities/smart-fox-core.mjs` | 0.35 s | 0 – 3 s（步长 0.01） |
| 相位最短停留·接近 | `SMART_PHASE_MIN.approach` | `src/entities/smart-fox-core.mjs` | 0.35 s | 0 – 3 s（步长 0.01） |
| 相位最短停留·蓄力 | `SMART_PHASE_MIN.wind` | `src/entities/smart-fox-core.mjs` | 0.55 s | 0 – 3 s（步长 0.01） |
| 相位最短停留·扑击 | `SMART_PHASE_MIN.pounce` | `src/entities/smart-fox-core.mjs` | 0.72 s | 0 – 3 s（步长 0.01） |
| 相位最短停留·恢复 | `SMART_PHASE_MIN.recover` | `src/entities/smart-fox-core.mjs` | 1.15 s | 0 – 3 s（步长 0.01） |
| AI 意图权重·observeBase | `SMART_WEIGHTS.observeBase` | `src/entities/smart-fox-core.mjs` | 0.26 | 0 – 2（步长 0.01） |
| AI 意图权重·observeUnaware | `SMART_WEIGHTS.observeUnaware` | `src/entities/smart-fox-core.mjs` | 0.24 | 0 – 2（步长 0.01） |
| AI 意图权重·observeDistance | `SMART_WEIGHTS.observeDistance` | `src/entities/smart-fox-core.mjs` | 0.18 | 0 – 2（步长 0.01） |
| AI 意图权重·approachBase | `SMART_WEIGHTS.approachBase` | `src/entities/smart-fox-core.mjs` | 0.18 | 0 – 2（步长 0.01） |
| AI 意图权重·approachDistance | `SMART_WEIGHTS.approachDistance` | `src/entities/smart-fox-core.mjs` | 0.34 | 0 – 2（步长 0.01） |
| AI 意图权重·approachSuspicion | `SMART_WEIGHTS.approachSuspicion` | `src/entities/smart-fox-core.mjs` | 0.22 | 0 – 2（步长 0.01） |
| AI 意图权重·approachUnguarded | `SMART_WEIGHTS.approachUnguarded` | `src/entities/smart-fox-core.mjs` | 0.08 | 0 – 2（步长 0.01） |
| AI 意图权重·feintBase | `SMART_WEIGHTS.feintBase` | `src/entities/smart-fox-core.mjs` | 0.12 | 0 – 2（步长 0.01） |
| AI 意图权重·feintGuard | `SMART_WEIGHTS.feintGuard` | `src/entities/smart-fox-core.mjs` | 0.34 | 0 – 2（步长 0.01） |
| AI 意图权重·feintMemory | `SMART_WEIGHTS.feintMemory` | `src/entities/smart-fox-core.mjs` | 0.28 | 0 – 2（步长 0.01） |
| AI 意图权重·feintInterruptions | `SMART_WEIGHTS.feintInterruptions` | `src/entities/smart-fox-core.mjs` | 0.25 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceBase | `SMART_WEIGHTS.pounceBase` | `src/entities/smart-fox-core.mjs` | 0.08 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceDistance | `SMART_WEIGHTS.pounceDistance` | `src/entities/smart-fox-core.mjs` | 0.44 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceSuspicion | `SMART_WEIGHTS.pounceSuspicion` | `src/entities/smart-fox-core.mjs` | 0.2 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceUnguarded | `SMART_WEIGHTS.pounceUnguarded` | `src/entities/smart-fox-core.mjs` | 0.12 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceMemory | `SMART_WEIGHTS.pounceMemory` | `src/entities/smart-fox-core.mjs` | 0.34 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceInterruptions | `SMART_WEIGHTS.pounceInterruptions` | `src/entities/smart-fox-core.mjs` | 0.28 | 0 – 2（步长 0.01） |
| AI 意图权重·pounceFatigue | `SMART_WEIGHTS.pounceFatigue` | `src/entities/smart-fox-core.mjs` | 0.18 | 0 – 2（步长 0.01） |
| AI 意图权重·recoverBase | `SMART_WEIGHTS.recoverBase` | `src/entities/smart-fox-core.mjs` | 0.06 | 0 – 2（步长 0.01） |
| AI 意图权重·recoverFatigue | `SMART_WEIGHTS.recoverFatigue` | `src/entities/smart-fox-core.mjs` | 0.58 | 0 – 2（步长 0.01） |
| AI 意图权重·recoverHealth | `SMART_WEIGHTS.recoverHealth` | `src/entities/smart-fox-core.mjs` | 0.44 | 0 – 2（步长 0.01） |
| AI 意图权重·recoverInterruptions | `SMART_WEIGHTS.recoverInterruptions` | `src/entities/smart-fox-core.mjs` | 0.08 | 0 – 2（步长 0.01） |
| AI 意图权重·abandonBase | `SMART_WEIGHTS.abandonBase` | `src/entities/smart-fox-core.mjs` | 0.02 | 0 – 2（步长 0.01） |
| AI 意图权重·abandonHealth | `SMART_WEIGHTS.abandonHealth` | `src/entities/smart-fox-core.mjs` | 0.62 | 0 – 2（步长 0.01） |
| AI 意图权重·abandonFatigue | `SMART_WEIGHTS.abandonFatigue` | `src/entities/smart-fox-core.mjs` | 0.3 | 0 – 2（步长 0.01） |
| AI 意图权重·abandonClose | `SMART_WEIGHTS.abandonClose` | `src/entities/smart-fox-core.mjs` | 0.04 | 0 – 2（步长 0.01） |
| 中断记忆衰减延迟 | `updateSmartMemory(options.memoryDelay 默认值)` | `src/entities/smart-fox-core.mjs` | 10 s | 0 – 60 s（步长 0.2） |
| 中断记忆衰减速度 | `updateSmartMemory(options.memoryDecay 默认值)` | `src/entities/smart-fox-core.mjs` | 0.05 | 0 – 1（步长 0.005） |
| 默认感知距离 | `updatePerception(input.viewRange 默认值)` | `src/entities/smart-fox-core.mjs` | 28 m | 1 – 100 m（步长 0.2） |
| 默认警觉上升速度 | `updatePerception(input.detectionRate 默认值)` | `src/entities/smart-fox-core.mjs` | 1.8 | 0 – 10（步长 0.05） |
| 默认警觉衰减速度 | `updatePerception(input.decayRate 默认值)` | `src/entities/smart-fox-core.mjs` | 0.48 | 0 – 5（步长 0.02） |
| 扑击加速度 | `stepSmartMotion(options.acceleration 默认值)` | `src/entities/smart-fox-core.mjs` | 18 m/s² | 0 – 60 m/s²（步长 0.2） |
| 群体分离距离 | `separationVector(minDistance 默认值)` | `src/entities/smart-fox-core.mjs` | 1.8 m | 0 – 10 m（步长 0.05） |
| 群体分离强度 | `separationVector(strength 默认值)` | `src/entities/smart-fox-core.mjs` | 2.4 | 0 – 10（步长 0.05） |
| 意图切换确认时间 | `debounceIntent(options.hold 默认值)` | `src/entities/smart-fox-core.mjs` | 0.25 s | 0 – 3 s（步长 0.01） |
| 地面层采样容差 | `sampleWalkableGround(layerTolerance 默认值)` | `src/entities/smart-fox-core.mjs` | 0.28 m | 0 – 2 m（步长 0.01） |
| 地面高度跟随速率 | `stepGroundY(maxRate 默认值)` | `src/entities/smart-fox-core.mjs` | 3.2 m/s | 0 – 15 m/s（步长 0.05） |
| 群体出击提交窗口 | `createSmartPack.canCommit 1.2 秒窗口` | `src/entities/smart-fox-core.mjs` | 1.2 s | 0 – 5 s（步长 0.02） |
| 群体出击最小间隔 | `createSmartPack.canCommit 0.35 秒间隔` | `src/entities/smart-fox-core.mjs` | 0.35 s | 0 – 2 s（步长 0.01） |
| 群体槽位间隔增量 | `createSmartPack.canCommit 0.025 秒增量` | `src/entities/smart-fox-core.mjs` | 0.025 s | 0 – 0.5 s（步长 0.002） |

### 世界 · 关卡与布局（267 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| X 坐标 | `BURROWS.1.x` | `src/core/config.js` | -12 m | -150 – 150 m（步长 1） |
| Z 坐标 | `BURROWS.1.z` | `src/core/config.js` | -25 m | -150 – 150 m（步长 1） |
| 半径 | `BURROWS.1.r` | `src/core/config.js` | 3.15 m | 0 – 9.45 m（步长 0.02） |
| 恢复倍率 | `BURROWS.1.regenMul` | `src/core/config.js` | 0.18 | 0 – 1.18（步长 0.005） |
| 洞口半径 | `BURROWS.1.openingRadius` | `src/core/config.js` | 1.05 m | 0 – 3.15 m（步长 0.01） |
| 坡缘半径 | `BURROWS.1.slopeRadius` | `src/core/config.js` | 1.9 m | 0 – 5.7 m（步长 0.02） |
| 腔室半径 | `BURROWS.1.chamberRadius` | `src/core/config.js` | 1.5 m | 0 – 4.5 m（步长 0.02） |
| 腔室深度 | `BURROWS.1.chamberDepth` | `src/core/config.js` | 2 m | 0 – 6 m（步长 0.02） |
| warmLight | `BURROWS.1.warmLight` | `src/core/config.js` | 关 | 开 / 关 |
| lightColor | `BURROWS.1.lightColor` | `src/core/config.js` | `0x8bb8c4` (9,156,804) | 0 – 16,777,215（步长 1） |
| 洞穴灯光强度 | `BURROWS.1.lightIntensity` | `src/core/config.js` | 0.28 | 0 – 1.28（步长 0.005） |
| X 坐标 | `BURROWS.2.x` | `src/core/config.js` | 18 m | -150 – 150 m（步长 1） |
| Z 坐标 | `BURROWS.2.z` | `src/core/config.js` | 13 m | -150 – 150 m（步长 1） |
| 半径 | `BURROWS.2.r` | `src/core/config.js` | 3.15 m | 0 – 9.45 m（步长 0.02） |
| 恢复倍率 | `BURROWS.2.regenMul` | `src/core/config.js` | 0.18 | 0 – 1.18（步长 0.005） |
| 洞口半径 | `BURROWS.2.openingRadius` | `src/core/config.js` | 1.05 m | 0 – 3.15 m（步长 0.01） |
| 坡缘半径 | `BURROWS.2.slopeRadius` | `src/core/config.js` | 1.9 m | 0 – 5.7 m（步长 0.02） |
| 腔室半径 | `BURROWS.2.chamberRadius` | `src/core/config.js` | 1.5 m | 0 – 4.5 m（步长 0.02） |
| 腔室深度 | `BURROWS.2.chamberDepth` | `src/core/config.js` | 2 m | 0 – 6 m（步长 0.02） |
| warmLight | `BURROWS.2.warmLight` | `src/core/config.js` | 关 | 开 / 关 |
| lightColor | `BURROWS.2.lightColor` | `src/core/config.js` | `0x8bb8c4` (9,156,804) | 0 – 16,777,215（步长 1） |
| 洞穴灯光强度 | `BURROWS.2.lightIntensity` | `src/core/config.js` | 0.28 | 0 – 1.28（步长 0.005） |
| X 坐标 | `BURROWS.3.x` | `src/core/config.js` | 40 m | -150 – 150 m（步长 1） |
| Z 坐标 | `BURROWS.3.z` | `src/core/config.js` | 32 m | -150 – 150 m（步长 1） |
| 半径 | `BURROWS.3.r` | `src/core/config.js` | 3 m | 0 – 9 m（步长 0.02） |
| 恢复倍率 | `BURROWS.3.regenMul` | `src/core/config.js` | 0.18 | 0 – 1.18（步长 0.005） |
| 洞口半径 | `BURROWS.3.openingRadius` | `src/core/config.js` | 1.05 m | 0 – 3.15 m（步长 0.01） |
| 坡缘半径 | `BURROWS.3.slopeRadius` | `src/core/config.js` | 1.9 m | 0 – 5.7 m（步长 0.02） |
| 腔室半径 | `BURROWS.3.chamberRadius` | `src/core/config.js` | 1.5 m | 0 – 4.5 m（步长 0.02） |
| 腔室深度 | `BURROWS.3.chamberDepth` | `src/core/config.js` | 2 m | 0 – 6 m（步长 0.02） |
| warmLight | `BURROWS.3.warmLight` | `src/core/config.js` | 关 | 开 / 关 |
| lightColor | `BURROWS.3.lightColor` | `src/core/config.js` | `0x8bb8c4` (9,156,804) | 0 – 16,777,215（步长 1） |
| 洞穴灯光强度 | `BURROWS.3.lightIntensity` | `src/core/config.js` | 0.28 | 0 – 1.28（步长 0.005） |
| X 坐标 | `BURROWS.4.x` | `src/core/config.js` | -34 m | -150 – 150 m（步长 1） |
| Z 坐标 | `BURROWS.4.z` | `src/core/config.js` | 28 m | -150 – 150 m（步长 1） |
| 半径 | `BURROWS.4.r` | `src/core/config.js` | 3 m | 0 – 9 m（步长 0.02） |
| 恢复倍率 | `BURROWS.4.regenMul` | `src/core/config.js` | 0.18 | 0 – 1.18（步长 0.005） |
| 洞口半径 | `BURROWS.4.openingRadius` | `src/core/config.js` | 1.05 m | 0 – 3.15 m（步长 0.01） |
| 坡缘半径 | `BURROWS.4.slopeRadius` | `src/core/config.js` | 1.9 m | 0 – 5.7 m（步长 0.02） |
| 腔室半径 | `BURROWS.4.chamberRadius` | `src/core/config.js` | 1.5 m | 0 – 4.5 m（步长 0.02） |
| 腔室深度 | `BURROWS.4.chamberDepth` | `src/core/config.js` | 2 m | 0 – 6 m（步长 0.02） |
| warmLight | `BURROWS.4.warmLight` | `src/core/config.js` | 关 | 开 / 关 |
| lightColor | `BURROWS.4.lightColor` | `src/core/config.js` | `0x8bb8c4` (9,156,804) | 0 – 16,777,215（步长 1） |
| 洞穴灯光强度 | `BURROWS.4.lightIntensity` | `src/core/config.js` | 0.28 | 0 – 1.28（步长 0.005） |
| 第1关 初出洞穴·数量 | `LEVELS.0.count` | `src/core/config.js` | 2 | 0 – 6（步长 0.02） |
| 第1关 初出洞穴·速度 | `LEVELS.0.speed` | `src/core/config.js` | 7.2 | 0 – 21.6（步长 0.1） |
| 第1关 初出洞穴·采食目标 | `LEVELS.0.goal` | `src/core/config.js` | 4 | 0 – 12（步长 0.05） |
| 第1关 初出洞穴·限时 | `LEVELS.0.time` | `src/core/config.js` | 115 s | 0 – 345 s（步长 1） |
| 第1关 初出洞穴·蓄力基准 | `LEVELS.0.wind` | `src/core/config.js` | 0.76 s | 0 – 2.28 s（步长 0.01） |
| 第1关 初出洞穴·增援间隔 | `LEVELS.0.reinforce` | `src/core/config.js` | 8 s | 0 – 24 s（步长 0.1） |
| 第1关 初出洞穴·伙伴位置·X | `LEVELS.0.friend.0` | `src/core/config.js` | 48 | 0 – 144（步长 0.5） |
| 第1关 初出洞穴·伙伴位置·Z | `LEVELS.0.friend.1` | `src/core/config.js` | 22 | 0 – 66（步长 0.2） |
| 第1关 初出洞穴·阳光强度 | `LEVELS.0.sunIntensity` | `src/core/config.js` | 1.9 | 0 – 5.7（步长 0.02） |
| 第1关 初出洞穴·环境光强 | `LEVELS.0.ambient` | `src/core/config.js` | 0.42 | 0 – 1.42（步长 0.005） |
| 第2关 双翼包抄·数量 | `LEVELS.1.count` | `src/core/config.js` | 3 | 0 – 9（步长 0.02） |
| 第2关 双翼包抄·速度 | `LEVELS.1.speed` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第2关 双翼包抄·采食目标 | `LEVELS.1.goal` | `src/core/config.js` | 5 | 0 – 15（步长 0.05） |
| 第2关 双翼包抄·限时 | `LEVELS.1.time` | `src/core/config.js` | 125 s | 0 – 375 s（步长 1） |
| 第2关 双翼包抄·蓄力基准 | `LEVELS.1.wind` | `src/core/config.js` | 0.7 s | 0 – 2.1 s（步长 0.01） |
| 第2关 双翼包抄·增援间隔 | `LEVELS.1.reinforce` | `src/core/config.js` | 7.2 s | 0 – 21.6 s（步长 0.1） |
| 第2关 双翼包抄·伙伴位置·X | `LEVELS.1.friend.0` | `src/core/config.js` | 56 | 0 – 168（步长 0.5） |
| 第2关 双翼包抄·伙伴位置·Z | `LEVELS.1.friend.1` | `src/core/config.js` | 19 | 0 – 57（步长 0.2） |
| 第2关 双翼包抄·阳光强度 | `LEVELS.1.sunIntensity` | `src/core/config.js` | 1.85 | 0 – 5.55（步长 0.02） |
| 第2关 双翼包抄·环境光强 | `LEVELS.1.ambient` | `src/core/config.js` | 0.4 | 0 – 1.4（步长 0.005） |
| 第3关 持续应战·数量 | `LEVELS.2.count` | `src/core/config.js` | 4 | 0 – 12（步长 0.05） |
| 第3关 持续应战·速度 | `LEVELS.2.speed` | `src/core/config.js` | 8.6 | 0 – 25.8（步长 0.1） |
| 第3关 持续应战·采食目标 | `LEVELS.2.goal` | `src/core/config.js` | 6 | 0 – 18（步长 0.05） |
| 第3关 持续应战·限时 | `LEVELS.2.time` | `src/core/config.js` | 140 s | 0 – 420 s（步长 2） |
| 第3关 持续应战·蓄力基准 | `LEVELS.2.wind` | `src/core/config.js` | 0.66 s | 0 – 1.98 s（步长 0.005） |
| 第3关 持续应战·增援间隔 | `LEVELS.2.reinforce` | `src/core/config.js` | 6.5 s | 0 – 19.5 s（步长 0.05） |
| 第3关 持续应战·伙伴位置·X | `LEVELS.2.friend.0` | `src/core/config.js` | 58 | 0 – 174（步长 0.5） |
| 第3关 持续应战·伙伴位置·Z | `LEVELS.2.friend.1` | `src/core/config.js` | 24 | 0 – 72（步长 0.2） |
| 第3关 持续应战·虚晃倍率 | `LEVELS.2.lureBias` | `src/core/config.js` | 1.3 | 0 – 3.9（步长 0.01） |
| 第3关 持续应战·阳光强度 | `LEVELS.2.sunIntensity` | `src/core/config.js` | 2 | 0 – 6（步长 0.02） |
| 第3关 持续应战·环境光强 | `LEVELS.2.ambient` | `src/core/config.js` | 0.38 | 0 – 1.38（步长 0.005） |
| 第4关 雾锁黄昏·数量 | `LEVELS.3.count` | `src/core/config.js` | 4 | 0 – 12（步长 0.05） |
| 第4关 雾锁黄昏·速度 | `LEVELS.3.speed` | `src/core/config.js` | 9 | 0 – 27（步长 0.1） |
| 第4关 雾锁黄昏·采食目标 | `LEVELS.3.goal` | `src/core/config.js` | 6 | 0 – 18（步长 0.05） |
| 第4关 雾锁黄昏·限时 | `LEVELS.3.time` | `src/core/config.js` | 150 s | 0 – 450 s（步长 2） |
| 第4关 雾锁黄昏·蓄力基准 | `LEVELS.3.wind` | `src/core/config.js` | 0.62 s | 0 – 1.86 s（步长 0.005） |
| 第4关 雾锁黄昏·增援间隔 | `LEVELS.3.reinforce` | `src/core/config.js` | 6 s | 0 – 18 s（步长 0.05） |
| 第4关 雾锁黄昏·伙伴位置·X | `LEVELS.3.friend.0` | `src/core/config.js` | 57 | 0 – 171（步长 0.5） |
| 第4关 雾锁黄昏·伙伴位置·Z | `LEVELS.3.friend.1` | `src/core/config.js` | 19 | 0 – 57（步长 0.2） |
| 第4关 雾锁黄昏·雾近端 | `LEVELS.3.fogNear` | `src/core/config.js` | 12 | 0 – 36（步长 0.1） |
| 第4关 雾锁黄昏·雾远端 | `LEVELS.3.fogFar` | `src/core/config.js` | 68 | 0 – 204（步长 1） |
| 第4关 雾锁黄昏·阳光强度 | `LEVELS.3.sunIntensity` | `src/core/config.js` | 1.35 | 0 – 4.05（步长 0.02） |
| 第4关 雾锁黄昏·环境光强 | `LEVELS.3.ambient` | `src/core/config.js` | 0.52 | 0 – 1.56（步长 0.005） |
| 第5关 群狐来袭·数量 | `LEVELS.4.count` | `src/core/config.js` | 6 | 0 – 18（步长 0.05） |
| 第5关 群狐来袭·速度 | `LEVELS.4.speed` | `src/core/config.js` | 9.4 | 0 – 28.2（步长 0.1） |
| 第5关 群狐来袭·采食目标 | `LEVELS.4.goal` | `src/core/config.js` | 7 | 0 – 21（步长 0.1） |
| 第5关 群狐来袭·限时 | `LEVELS.4.time` | `src/core/config.js` | 160 s | 0 – 480 s（步长 2） |
| 第5关 群狐来袭·蓄力基准 | `LEVELS.4.wind` | `src/core/config.js` | 0.6 s | 0 – 1.8 s（步长 0.005） |
| 第5关 群狐来袭·增援间隔 | `LEVELS.4.reinforce` | `src/core/config.js` | 5.7 s | 0 – 17.1 s（步长 0.05） |
| 第5关 群狐来袭·伙伴位置·X | `LEVELS.4.friend.0` | `src/core/config.js` | 57 | 0 – 171（步长 0.5） |
| 第5关 群狐来袭·伙伴位置·Z | `LEVELS.4.friend.1` | `src/core/config.js` | 19 | 0 – 57（步长 0.2） |
| 第5关 群狐来袭·虚晃倍率 | `LEVELS.4.lureBias` | `src/core/config.js` | 1.2 | 0 – 3.6（步长 0.01） |
| 第5关 群狐来袭·阳光强度 | `LEVELS.4.sunIntensity` | `src/core/config.js` | 1.8 | 0 – 5.4（步长 0.02） |
| 第5关 群狐来袭·环境光强 | `LEVELS.4.ambient` | `src/core/config.js` | 0.36 | 0 – 1.36（步长 0.005） |
| 第6关 风口疾行·数量 | `LEVELS.5.count` | `src/core/config.js` | 5 | 0 – 15（步长 0.05） |
| 第6关 风口疾行·速度 | `LEVELS.5.speed` | `src/core/config.js` | 10.2 | 0 – 30.6（步长 0.1） |
| 第6关 风口疾行·采食目标 | `LEVELS.5.goal` | `src/core/config.js` | 7 | 0 – 21（步长 0.1） |
| 第6关 风口疾行·限时 | `LEVELS.5.time` | `src/core/config.js` | 165 s | 0 – 495 s（步长 2） |
| 第6关 风口疾行·蓄力基准 | `LEVELS.5.wind` | `src/core/config.js` | 0.56 s | 0 – 1.68 s（步长 0.005） |
| 第6关 风口疾行·增援间隔 | `LEVELS.5.reinforce` | `src/core/config.js` | 5.4 s | 0 – 16.2 s（步长 0.05） |
| 第6关 风口疾行·伙伴位置·X | `LEVELS.5.friend.0` | `src/core/config.js` | 60 | 0 – 180（步长 0.5） |
| 第6关 风口疾行·伙伴位置·Z | `LEVELS.5.friend.1` | `src/core/config.js` | 22 | 0 – 66（步长 0.2） |
| 第6关 风口疾行·阵风强度 | `LEVELS.5.windGust` | `src/core/config.js` | 7.5 | 0 – 22.5（步长 0.1） |
| 第6关 风口疾行·虚晃倍率 | `LEVELS.5.lureBias` | `src/core/config.js` | 1.1 | 0 – 3.3（步长 0.01） |
| 第6关 风口疾行·阳光强度 | `LEVELS.5.sunIntensity` | `src/core/config.js` | 1.7 | 0 – 5.1（步长 0.02） |
| 第6关 风口疾行·环境光强 | `LEVELS.5.ambient` | `src/core/config.js` | 0.44 | 0 – 1.44（步长 0.005） |
| 第7关 沙尘掩埋·数量 | `LEVELS.6.count` | `src/core/config.js` | 6 | 0 – 18（步长 0.05） |
| 第7关 沙尘掩埋·速度 | `LEVELS.6.speed` | `src/core/config.js` | 10 | 0 – 30（步长 0.1） |
| 第7关 沙尘掩埋·采食目标 | `LEVELS.6.goal` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第7关 沙尘掩埋·限时 | `LEVELS.6.time` | `src/core/config.js` | 175 s | 0 – 525 s（步长 2） |
| 第7关 沙尘掩埋·蓄力基准 | `LEVELS.6.wind` | `src/core/config.js` | 0.55 s | 0 – 1.65 s（步长 0.005） |
| 第7关 沙尘掩埋·增援间隔 | `LEVELS.6.reinforce` | `src/core/config.js` | 5.2 s | 0 – 15.6 s（步长 0.05） |
| 第7关 沙尘掩埋·伙伴位置·X | `LEVELS.6.friend.0` | `src/core/config.js` | 58 | 0 – 174（步长 0.5） |
| 第7关 沙尘掩埋·伙伴位置·Z | `LEVELS.6.friend.1` | `src/core/config.js` | 26 | 0 – 78（步长 0.2） |
| 第7关 沙尘掩埋·雾近端 | `LEVELS.6.fogNear` | `src/core/config.js` | 16 | 0 – 48（步长 0.2） |
| 第7关 沙尘掩埋·雾远端 | `LEVELS.6.fogFar` | `src/core/config.js` | 110 | 0 – 330（步长 1） |
| 第7关 沙尘掩埋·sandstorm | `LEVELS.6.sandstorm` | `src/core/config.js` | 开 | 开 / 关 |
| 第7关 沙尘掩埋·虚晃倍率 | `LEVELS.6.lureBias` | `src/core/config.js` | 1.4 | 0 – 4.2（步长 0.02） |
| 第7关 沙尘掩埋·阳光强度 | `LEVELS.6.sunIntensity` | `src/core/config.js` | 1.55 | 0 – 4.65（步长 0.02） |
| 第7关 沙尘掩埋·环境光强 | `LEVELS.6.ambient` | `src/core/config.js` | 0.5 | 0 – 1.5（步长 0.005） |
| 第8关 群狐围攻·数量 | `LEVELS.7.count` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第8关 群狐围攻·速度 | `LEVELS.7.speed` | `src/core/config.js` | 10.6 | 0 – 31.8（步长 0.1） |
| 第8关 群狐围攻·采食目标 | `LEVELS.7.goal` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第8关 群狐围攻·限时 | `LEVELS.7.time` | `src/core/config.js` | 190 s | 0 – 570 s（步长 2） |
| 第8关 群狐围攻·蓄力基准 | `LEVELS.7.wind` | `src/core/config.js` | 0.54 s | 0 – 1.62 s（步长 0.005） |
| 第8关 群狐围攻·增援间隔 | `LEVELS.7.reinforce` | `src/core/config.js` | 5 s | 0 – 15 s（步长 0.05） |
| 第8关 群狐围攻·伙伴位置·X | `LEVELS.7.friend.0` | `src/core/config.js` | 58 | 0 – 174（步长 0.5） |
| 第8关 群狐围攻·伙伴位置·Z | `LEVELS.7.friend.1` | `src/core/config.js` | 26 | 0 – 78（步长 0.2） |
| 第8关 群狐围攻·boss | `LEVELS.7.boss` | `src/core/config.js` | 开 | 开 / 关 |
| 第8关 群狐围攻·虚晃倍率 | `LEVELS.7.lureBias` | `src/core/config.js` | 1.2 | 0 – 3.6（步长 0.01） |
| 第8关 群狐围攻·阳光强度 | `LEVELS.7.sunIntensity` | `src/core/config.js` | 1.65 | 0 – 4.95（步长 0.02） |
| 第8关 群狐围攻·环境光强 | `LEVELS.7.ambient` | `src/core/config.js` | 0.45 | 0 – 1.45（步长 0.005） |
| 第9关 逆风回巢·数量 | `LEVELS.8.count` | `src/core/config.js` | 6 | 0 – 18（步长 0.05） |
| 第9关 逆风回巢·速度 | `LEVELS.8.speed` | `src/core/config.js` | 10.4 | 0 – 31.2（步长 0.1） |
| 第9关 逆风回巢·采食目标 | `LEVELS.8.goal` | `src/core/config.js` | 7 | 0 – 21（步长 0.1） |
| 第9关 逆风回巢·限时 | `LEVELS.8.time` | `src/core/config.js` | 170 s | 0 – 510 s（步长 2） |
| 第9关 逆风回巢·蓄力基准 | `LEVELS.8.wind` | `src/core/config.js` | 0.56 s | 0 – 1.68 s（步长 0.005） |
| 第9关 逆风回巢·增援间隔 | `LEVELS.8.reinforce` | `src/core/config.js` | 5.2 s | 0 – 15.6 s（步长 0.05） |
| 第9关 逆风回巢·伙伴位置·X | `LEVELS.8.friend.0` | `src/core/config.js` | 56 | 0 – 168（步长 0.5） |
| 第9关 逆风回巢·伙伴位置·Z | `LEVELS.8.friend.1` | `src/core/config.js` | 27 | 0 – 81（步长 0.2） |
| 第9关 逆风回巢·阵风强度 | `LEVELS.8.windGust` | `src/core/config.js` | 11 | 0 – 33（步长 0.1） |
| 第9关 逆风回巢·阳光强度 | `LEVELS.8.sunIntensity` | `src/core/config.js` | 1.65 | 0 – 4.95（步长 0.02） |
| 第9关 逆风回巢·环境光强 | `LEVELS.8.ambient` | `src/core/config.js` | 0.43 | 0 – 1.43（步长 0.005） |
| 第10关 浓雾伏击·数量 | `LEVELS.9.count` | `src/core/config.js` | 7 | 0 – 21（步长 0.1） |
| 第10关 浓雾伏击·速度 | `LEVELS.9.speed` | `src/core/config.js` | 10.6 | 0 – 31.8（步长 0.1） |
| 第10关 浓雾伏击·采食目标 | `LEVELS.9.goal` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第10关 浓雾伏击·限时 | `LEVELS.9.time` | `src/core/config.js` | 180 s | 0 – 540 s（步长 2） |
| 第10关 浓雾伏击·蓄力基准 | `LEVELS.9.wind` | `src/core/config.js` | 0.58 s | 0 – 1.74 s（步长 0.005） |
| 第10关 浓雾伏击·增援间隔 | `LEVELS.9.reinforce` | `src/core/config.js` | 5 s | 0 – 15 s（步长 0.05） |
| 第10关 浓雾伏击·伙伴位置·X | `LEVELS.9.friend.0` | `src/core/config.js` | 59 | 0 – 177（步长 0.5） |
| 第10关 浓雾伏击·伙伴位置·Z | `LEVELS.9.friend.1` | `src/core/config.js` | 24 | 0 – 72（步长 0.2） |
| 第10关 浓雾伏击·雾近端 | `LEVELS.9.fogNear` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第10关 浓雾伏击·雾远端 | `LEVELS.9.fogFar` | `src/core/config.js` | 54 | 0 – 162（步长 0.5） |
| 第10关 浓雾伏击·虚晃倍率 | `LEVELS.9.lureBias` | `src/core/config.js` | 1.65 | 0 – 4.95（步长 0.02） |
| 第10关 浓雾伏击·阳光强度 | `LEVELS.9.sunIntensity` | `src/core/config.js` | 1.35 | 0 – 4.05（步长 0.02） |
| 第10关 浓雾伏击·环境光强 | `LEVELS.9.ambient` | `src/core/config.js` | 0.5 | 0 – 1.5（步长 0.005） |
| 第11关 沙暴突围·数量 | `LEVELS.10.count` | `src/core/config.js` | 7 | 0 – 21（步长 0.1） |
| 第11关 沙暴突围·速度 | `LEVELS.10.speed` | `src/core/config.js` | 10.8 | 0 – 32.4（步长 0.1） |
| 第11关 沙暴突围·采食目标 | `LEVELS.10.goal` | `src/core/config.js` | 8 | 0 – 24（步长 0.1） |
| 第11关 沙暴突围·限时 | `LEVELS.10.time` | `src/core/config.js` | 185 s | 0 – 555 s（步长 2） |
| 第11关 沙暴突围·蓄力基准 | `LEVELS.10.wind` | `src/core/config.js` | 0.58 s | 0 – 1.74 s（步长 0.005） |
| 第11关 沙暴突围·增援间隔 | `LEVELS.10.reinforce` | `src/core/config.js` | 4.8 s | 0 – 14.4 s（步长 0.05） |
| 第11关 沙暴突围·伙伴位置·X | `LEVELS.10.friend.0` | `src/core/config.js` | 58 | 0 – 174（步长 0.5） |
| 第11关 沙暴突围·伙伴位置·Z | `LEVELS.10.friend.1` | `src/core/config.js` | 29 | 0 – 87（步长 0.2） |
| 第11关 沙暴突围·雾近端 | `LEVELS.10.fogNear` | `src/core/config.js` | 14 | 0 – 42（步长 0.2） |
| 第11关 沙暴突围·雾远端 | `LEVELS.10.fogFar` | `src/core/config.js` | 96 | 0 – 288（步长 1） |
| 第11关 沙暴突围·sandstorm | `LEVELS.10.sandstorm` | `src/core/config.js` | 开 | 开 / 关 |
| 第11关 沙暴突围·阵风强度 | `LEVELS.10.windGust` | `src/core/config.js` | 6.5 | 0 – 19.5（步长 0.05） |
| 第11关 沙暴突围·虚晃倍率 | `LEVELS.10.lureBias` | `src/core/config.js` | 1.25 | 0 – 3.75（步长 0.01） |
| 第11关 沙暴突围·阳光强度 | `LEVELS.10.sunIntensity` | `src/core/config.js` | 1.5 | 0 – 4.5（步长 0.02） |
| 第11关 沙暴突围·环境光强 | `LEVELS.10.ambient` | `src/core/config.js` | 0.48 | 0 – 1.48（步长 0.005） |
| 第12关 草原守望者·数量 | `LEVELS.11.count` | `src/core/config.js` | 9 | 0 – 27（步长 0.1） |
| 第12关 草原守望者·速度 | `LEVELS.11.speed` | `src/core/config.js` | 11.2 | 0 – 33.6（步长 0.1） |
| 第12关 草原守望者·采食目标 | `LEVELS.11.goal` | `src/core/config.js` | 9 | 0 – 27（步长 0.1） |
| 第12关 草原守望者·限时 | `LEVELS.11.time` | `src/core/config.js` | 205 s | 0 – 615 s（步长 2） |
| 第12关 草原守望者·蓄力基准 | `LEVELS.11.wind` | `src/core/config.js` | 0.58 s | 0 – 1.74 s（步长 0.005） |
| 第12关 草原守望者·增援间隔 | `LEVELS.11.reinforce` | `src/core/config.js` | 4.6 s | 0 – 13.8 s（步长 0.05） |
| 第12关 草原守望者·伙伴位置·X | `LEVELS.11.friend.0` | `src/core/config.js` | 60 | 0 – 180（步长 0.5） |
| 第12关 草原守望者·伙伴位置·Z | `LEVELS.11.friend.1` | `src/core/config.js` | 28 | 0 – 84（步长 0.2） |
| 第12关 草原守望者·boss | `LEVELS.11.boss` | `src/core/config.js` | 开 | 开 / 关 |
| 第12关 草原守望者·雾近端 | `LEVELS.11.fogNear` | `src/core/config.js` | 15 | 0 – 45（步长 0.2） |
| 第12关 草原守望者·雾远端 | `LEVELS.11.fogFar` | `src/core/config.js` | 105 | 0 – 315（步长 1） |
| 第12关 草原守望者·sandstorm | `LEVELS.11.sandstorm` | `src/core/config.js` | 开 | 开 / 关 |
| 第12关 草原守望者·阵风强度 | `LEVELS.11.windGust` | `src/core/config.js` | 7.5 | 0 – 22.5（步长 0.1） |
| 第12关 草原守望者·虚晃倍率 | `LEVELS.11.lureBias` | `src/core/config.js` | 1.4 | 0 – 4.2（步长 0.02） |
| 第12关 草原守望者·阳光强度 | `LEVELS.11.sunIntensity` | `src/core/config.js` | 1.5 | 0 – 4.5（步长 0.02） |
| 第12关 草原守望者·环境光强 | `LEVELS.11.ambient` | `src/core/config.js` | 0.46 | 0 – 1.46（步长 0.005） |
| 浆果点1·X | `BERRY_POINTS.0.0` | `src/core/config.js` | -28 m | -150 – 150 m（步长 1） |
| 浆果点1·Z | `BERRY_POINTS.0.1` | `src/core/config.js` | -24 m | -150 – 150 m（步长 1） |
| 浆果点2·X | `BERRY_POINTS.1.0` | `src/core/config.js` | -14 m | -150 – 150 m（步长 1） |
| 浆果点2·Z | `BERRY_POINTS.1.1` | `src/core/config.js` | 8 m | -150 – 150 m（步长 1） |
| 浆果点3·X | `BERRY_POINTS.2.0` | `src/core/config.js` | -4 m | -150 – 150 m（步长 1） |
| 浆果点3·Z | `BERRY_POINTS.2.1` | `src/core/config.js` | -32 m | -150 – 150 m（步长 1） |
| 浆果点4·X | `BERRY_POINTS.3.0` | `src/core/config.js` | 10 m | -150 – 150 m（步长 1） |
| 浆果点4·Z | `BERRY_POINTS.3.1` | `src/core/config.js` | 20 m | -150 – 150 m（步长 1） |
| 浆果点5·X | `BERRY_POINTS.4.0` | `src/core/config.js` | 30 m | -150 – 150 m（步长 1） |
| 浆果点5·Z | `BERRY_POINTS.4.1` | `src/core/config.js` | 12 m | -150 – 150 m（步长 1） |
| 浆果点6·X | `BERRY_POINTS.5.0` | `src/core/config.js` | 44 m | -150 – 150 m（步长 1） |
| 浆果点6·Z | `BERRY_POINTS.5.1` | `src/core/config.js` | -24 m | -150 – 150 m（步长 1） |
| 浆果点7·X | `BERRY_POINTS.6.0` | `src/core/config.js` | 32 m | -150 – 150 m（步长 1） |
| 浆果点7·Z | `BERRY_POINTS.6.1` | `src/core/config.js` | 30 m | -150 – 150 m（步长 1） |
| 浆果点8·X | `BERRY_POINTS.7.0` | `src/core/config.js` | 16 m | -150 – 150 m（步长 1） |
| 浆果点8·Z | `BERRY_POINTS.7.1` | `src/core/config.js` | -18 m | -150 – 150 m（步长 1） |
| 浆果点9·X | `BERRY_POINTS.8.0` | `src/core/config.js` | -22 m | -150 – 150 m（步长 1） |
| 浆果点9·Z | `BERRY_POINTS.8.1` | `src/core/config.js` | 26 m | -150 – 150 m（步长 1） |
| 浆果点10·X | `BERRY_POINTS.9.0` | `src/core/config.js` | 4 m | -150 – 150 m（步长 1） |
| 浆果点10·Z | `BERRY_POINTS.9.1` | `src/core/config.js` | 0 m | -150 – 150 m（步长 1） |
| 浆果点11·X | `BERRY_POINTS.10.0` | `src/core/config.js` | 50 m | -150 – 150 m（步长 1） |
| 浆果点11·Z | `BERRY_POINTS.10.1` | `src/core/config.js` | 28 m | -150 – 150 m（步长 1） |
| 浆果点12·X | `BERRY_POINTS.11.0` | `src/core/config.js` | -34 m | -150 – 150 m（步长 1） |
| 浆果点12·Z | `BERRY_POINTS.11.1` | `src/core/config.js` | -6 m | -150 – 150 m（步长 1） |
| 狐狸刷新点1·X | `SPAWN_POINTS.0.0` | `src/core/config.js` | 50 m | -150 – 150 m（步长 1） |
| 狐狸刷新点1·Z | `SPAWN_POINTS.0.1` | `src/core/config.js` | -28 m | -150 – 150 m（步长 1） |
| 狐狸刷新点2·X | `SPAWN_POINTS.1.0` | `src/core/config.js` | 46 m | -150 – 150 m（步长 1） |
| 狐狸刷新点2·Z | `SPAWN_POINTS.1.1` | `src/core/config.js` | 30 m | -150 – 150 m（步长 1） |
| 狐狸刷新点3·X | `SPAWN_POINTS.2.0` | `src/core/config.js` | 26 m | -150 – 150 m（步长 1） |
| 狐狸刷新点3·Z | `SPAWN_POINTS.2.1` | `src/core/config.js` | -32 m | -150 – 150 m（步长 1） |
| 狐狸刷新点4·X | `SPAWN_POINTS.3.0` | `src/core/config.js` | 56 m | -150 – 150 m（步长 1） |
| 狐狸刷新点4·Z | `SPAWN_POINTS.3.1` | `src/core/config.js` | 4 m | -150 – 150 m（步长 1） |
| 狐狸刷新点5·X | `SPAWN_POINTS.4.0` | `src/core/config.js` | 22 m | -150 – 150 m（步长 1） |
| 狐狸刷新点5·Z | `SPAWN_POINTS.4.1` | `src/core/config.js` | 32 m | -150 – 150 m（步长 1） |
| 狐狸刷新点6·X | `SPAWN_POINTS.5.0` | `src/core/config.js` | 38 m | -150 – 150 m（步长 1） |
| 狐狸刷新点6·Z | `SPAWN_POINTS.5.1` | `src/core/config.js` | -18 m | -150 – 150 m（步长 1） |
| 狐狸刷新点7·X | `SPAWN_POINTS.6.0` | `src/core/config.js` | -8 m | -150 – 150 m（步长 1） |
| 狐狸刷新点7·Z | `SPAWN_POINTS.6.1` | `src/core/config.js` | 34 m | -150 – 150 m（步长 1） |
| 狐狸刷新点8·X | `SPAWN_POINTS.7.0` | `src/core/config.js` | 0 m | -150 – 150 m（步长 1） |
| 狐狸刷新点8·Z | `SPAWN_POINTS.7.1` | `src/core/config.js` | -34 m | -150 – 150 m（步长 1） |
| 岩石1·X | `ROCKS.0.0` | `src/core/config.js` | -20 m | -150 – 150 m（步长 1） |
| 岩石1·Z | `ROCKS.0.1` | `src/core/config.js` | -14 m | -150 – 150 m（步长 1） |
| 岩石1·半径 | `ROCKS.0.2` | `src/core/config.js` | 3.4 | 0 – 10.2（步长 0.05） |
| 岩石2·X | `ROCKS.1.0` | `src/core/config.js` | 8 m | -150 – 150 m（步长 1） |
| 岩石2·Z | `ROCKS.1.1` | `src/core/config.js` | 26 m | -150 – 150 m（步长 1） |
| 岩石2·半径 | `ROCKS.1.2` | `src/core/config.js` | 4.1 | 0 – 12.3（步长 0.05） |
| 岩石3·X | `ROCKS.2.0` | `src/core/config.js` | 34 m | -150 – 150 m（步长 1） |
| 岩石3·Z | `ROCKS.2.1` | `src/core/config.js` | -8 m | -150 – 150 m（步长 1） |
| 岩石3·半径 | `ROCKS.2.2` | `src/core/config.js` | 3 | 0 – 9（步长 0.02） |
| 岩石4·X | `ROCKS.3.0` | `src/core/config.js` | -30 m | -150 – 150 m（步长 1） |
| 岩石4·Z | `ROCKS.3.1` | `src/core/config.js` | 16 m | -150 – 150 m（步长 1） |
| 岩石4·半径 | `ROCKS.3.2` | `src/core/config.js` | 3.6 | 0 – 10.8（步长 0.05） |
| 岩石5·X | `ROCKS.4.0` | `src/core/config.js` | 18 m | -150 – 150 m（步长 1） |
| 岩石5·Z | `ROCKS.4.1` | `src/core/config.js` | -26 m | -150 – 150 m（步长 1） |
| 岩石5·半径 | `ROCKS.4.2` | `src/core/config.js` | 2.7 | 0 – 8.1（步长 0.02） |
| 岩石6·X | `ROCKS.5.0` | `src/core/config.js` | 42 m | -150 – 150 m（步长 1） |
| 岩石6·Z | `ROCKS.5.1` | `src/core/config.js` | 20 m | -150 – 150 m（步长 1） |
| 岩石6·半径 | `ROCKS.5.2` | `src/core/config.js` | 3.3 | 0 – 9.9（步长 0.02） |
| 岩石7·X | `ROCKS.6.0` | `src/core/config.js` | -2 m | -150 – 150 m（步长 1） |
| 岩石7·Z | `ROCKS.6.1` | `src/core/config.js` | 34 m | -150 – 150 m（步长 1） |
| 岩石7·半径 | `ROCKS.6.2` | `src/core/config.js` | 3.8 | 0 – 11.4（步长 0.05） |
| 岩石8·X | `ROCKS.7.0` | `src/core/config.js` | 26 m | -150 – 150 m（步长 1） |
| 岩石8·Z | `ROCKS.7.1` | `src/core/config.js` | 34 m | -150 – 150 m（步长 1） |
| 岩石8·半径 | `ROCKS.7.2` | `src/core/config.js` | 2.4 | 0 – 7.2（步长 0.02） |
| 岩石9·X | `ROCKS.8.0` | `src/core/config.js` | -44 m | -150 – 150 m（步长 1） |
| 岩石9·Z | `ROCKS.8.1` | `src/core/config.js` | -26 m | -150 – 150 m（步长 1） |
| 岩石9·半径 | `ROCKS.8.2` | `src/core/config.js` | 4.4 | 0 – 13.2（步长 0.05） |
| 岩石10·X | `ROCKS.9.0` | `src/core/config.js` | 50 m | -150 – 150 m（步长 1） |
| 岩石10·Z | `ROCKS.9.1` | `src/core/config.js` | -14 m | -150 – 150 m（步长 1） |
| 岩石10·半径 | `ROCKS.9.2` | `src/core/config.js` | 3.2 | 0 – 9.6（步长 0.02） |
| 岩石11·X | `ROCKS.10.0` | `src/core/config.js` | -36 m | -150 – 150 m（步长 1） |
| 岩石11·Z | `ROCKS.10.1` | `src/core/config.js` | -34 m | -150 – 150 m（步长 1） |
| 岩石11·半径 | `ROCKS.10.2` | `src/core/config.js` | 3.6 | 0 – 10.8（步长 0.05） |
| 岩石12·X | `ROCKS.11.0` | `src/core/config.js` | 12 m | -150 – 150 m（步长 1） |
| 岩石12·Z | `ROCKS.11.1` | `src/core/config.js` | -6 m | -150 – 150 m（步长 1） |
| 岩石12·半径 | `ROCKS.11.2` | `src/core/config.js` | 2.2 | 0 – 6.6（步长 0.02） |

### 其它 · 浆果与伙伴（9 项）

| 中文名 | 常量 / 字段 | 来源文件 | 默认值 | 范围 / 选项 |
|---|---|---|---:|---|
| 浆果拾取半径 | `BERRY_RADIUS` | `src/core/config.js` | 0.75 m | 0.1 – 3 m（步长 0.01） |
| 浆果回能量 | `BERRY_ENERGY` | `src/core/config.js` | 20 | 0 – 100（步长 1） |
| 浆果蓄力充能 | `BERRY_CHARGE` | `src/core/config.js` | 8 | 0 – 50（步长 1） |
| 伙伴跟随速度(基准) | `COMPANION_FOLLOW_SPEED` | `src/core/config.js` | 7.2 m/s | 1 – 20 m/s（步长 0.05） |
| 伙伴追上距离 | `COMPANION_CATCH_DIST` | `src/core/config.js` | 1.5 m | 0.3 – 6 m（步长 0.02） |
| 救援距离 | `RESCUE_DIST` | `src/core/config.js` | 1.9 m | 0.3 – 6 m（步长 0.02） |
| 社交范围 | `SOCIAL_RANGE` | `src/core/config.js` | 2.4 m | 0.5 – 8 m（步长 0.02） |
| 场地宽 | `FIELD_W` | `src/core/config.js` | 130 m | 20 – 300 m（步长 1） |
| 场地高 | `FIELD_H` | `src/core/config.js` | 78 m | 20 – 300 m（步长 1） |

## 攻击范围 / 时间窗可视化覆盖

- **狐狸扑击（智能 AI）**：`SMART_POUNCE` 的最小/最大距离扇形、最大角度、扑击速度与锁定时长轨迹；前摇、锁定、冷却用预览叠层时间条展示。
- **FOX_ATTACKS 冲刺**：按所选类型的 `mode / dashTime / dashSpeedMul / leapHeight` 和 `FOX.dashSpeed` 画冲刺轨迹、跃扑抛高与终点攻击盒。
- **攻击判定体积**：由 `src/systems/combat.js` 的 `STRIKE_VOLUMES` 和 `src/systems/debug-volume-data.js` 的几何数据约定显示扑击扇形、垂直上下沿；包括可调狐狸碰撞圆柱和接触半径环。
- **攻击预警与锁敌**：显示 `FOX.windRange` 蓄力距离环及 Beta `BETA_TUNE.lungeLockRange / lungeLockHalfAngle` 锁敌扇形。
- **实时数值反馈**：狐狸类型缩放、冲刺速度驱动姿态步频/冲刺轨迹；调整距离、角度、碰撞半径、蓄力/冲刺/恢复时间后重建预览几何/摘要。

## 可视化截图说明（未启动浏览器）

预期画面为深色草地与网格地面上的狐狸模型，左上叠层提供 idle / walk / dash / pounce 切换、类型选择、X/Z 与朝向控件及图例：红/橙色为狐狸冲刺路径、攻击扇区/碰撞体，淡黄色为蓄力距离，浅蓝为扑击锁敌范围。界面右侧/左侧为可搜索的分组数值清单。按任务约束未启动浏览器，未生成真实截图文件。

## 遗留与后续建议

1. `fox.glb` 无游戏内的动作骨骼片段；预览用程序化倾斜/弹跳表现姿态，不是原生动画。若后续提供带 idle/walk/run/pounce 动画的模型，可接入 AnimationMixer。
2. 时间摘要中的狐狸档案前摇按第 1 关 `wind` × 狐狸类型 `wind` × 攻击档案 `windMul` 计算作参照；实战关卡不同，因此摘要是可读的配置参考，不代表某一具体战局。
3. 配置范围是后台编辑钳制护栏，不修改源码常量，也不向稳定版/开发版游戏写入配置；后续如要“应用到运行游戏”，需要另行设计 Beta 专属、可撤销的配置注入接口与持久化策略。
4. 页面每次访问使用内存默认值；导入导出文件为唯一的显式留存方式。未使用 localStorage。
5. `tools/run-node-tests.cjs` 现有 `test-beta-contract.cjs` 失败与本改动无关：测试期望从 `index.html` 生成公共 shell，而基线 `index-public.html` 固定为 rev22、生成器仍为 rev21。按要求未改 shell 戳或公共 shell。

## 检查记录

- 新增 JS 的 `node --check`：通过。
- 新增纯函数测试：5/5 通过。
- 全量 Node 测试：其余 45 项通过（浏览器/CDP 用例按仓库约定跳过），1 项现有 Beta shell 基线戳不一致失败；未启动浏览器。
- 禁用调用：未发现 `alert(`；未引入外网/CDN；未改 `index-public.html` / 版本戳、Caddy、部署脚本。
- Git commit：待提交后填写。
