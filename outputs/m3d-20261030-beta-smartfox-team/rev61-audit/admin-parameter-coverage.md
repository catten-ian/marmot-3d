# rev61 SmartFox 参数审计（本地浏览器专项证据另见 runtime-browser/）

实际路径：admin beta.* → runtimePayloadFromAdminConfig → sanitizeRuntimeValues → active/explicit/storage → BETA_TUNE → 新实例 smartTuning/smartVitals/smartRetreat 快照。已有实例不热改上限；接触判定 main.js 读本页激活时 BETA_TUNE。普通 FOX 不被展开写回。

| key | 默认 | min..max / step | 单位 | capability | 真实读取（行号以本轮代码为准） |
|---|---:|---|---|---|---|
| beta.smartMaxHp | 4 | 1..40 / 1 | 生命 | runtime | src/core/beta-tuning.js:129 |
| beta.smartMaxStamina | 100 | 1..300 / 1 | 体力 | runtime | src/core/beta-tuning.js:130 |
| beta.smartStalkStaminaPerSec | 0 | 0..60 / 0.5 | 体力/s | runtime | src/core/beta-tuning.js:131 |
| beta.smartSprintStaminaPerSec | 0 | 0..60 / 0.5 | 体力/s | runtime | src/core/beta-tuning.js:132 |
| beta.smartPounceStaminaPerSec | 26 | 0..80 / 0.5 | 体力/s | runtime | src/core/beta-tuning.js:133 |
| beta.smartPounceStaminaCost | 26 | 0..100 / 1 | 体力 | runtime | src/core/beta-tuning.js:134 |
| beta.smartMeleeStaminaCost | 0 | 0..100 / 1 | 体力 | runtime | src/core/beta-tuning.js:135 |
| beta.smartHitStaminaCost | 7 | 0..40 / 0.5 | 体力 | runtime | src/core/beta-tuning.js:140 |
| beta.smartRestStaminaRegenPerSec | 14 | 0..60 / 0.5 | 体力/s | runtime | src/core/beta-tuning.js:138；src/entities/smart-fox.js:192 |
| beta.smartRecoverStaminaRegenPerSec | 4.5 | 0..60 / 0.5 | 体力/s | runtime | src/entities/smart-fox.js:193 |
| beta.smartInterceptStaminaRegenPerSec | 2.5 | 0..60 / 0.5 | 体力/s | runtime | src/entities/smart-fox.js:194 |
| beta.smartRoamStaminaRegenPerSec | 1.2 | 0..60 / 0.5 | 体力/s | runtime | src/entities/smart-fox.js:195 |
| beta.smartPounceRingCrawlSpeed | 1.1 | 0..5 / 0.05 | m/s | runtime | src/entities/smart-fox.js:421 |
| beta.smartPounceAlignCreepSpeed | 0.75 | 0..5 / 0.05 | m/s | runtime |  |
| beta.smartPackWindow | 1.2 | 0..5 / 0.05 | s | runtime | src/main.js:570；src/main.js:759 → createSmartPack（动态模式不设两个提交者上限；window 仅清理窗口事件） |
| beta.smartPackSpacing | 0.35 | 0..2 / 0.01 | s | runtime | src/main.js:570；src/main.js:759 → createSmartPack（动态模式不设两个提交者上限；window 仅清理窗口事件） |
| beta.smartPackSlotSpacing | 0.025 | 0..0.5 / 0.005 | s | runtime | src/main.js:570；src/main.js:759 → createSmartPack（动态模式不设两个提交者上限；window 仅清理窗口事件） |
| beta.smartDebounceHold | 0.25 | 0..3 / 0.01 | s | runtime | src/entities/smart-fox.js:289 |
| beta.smartRestHpRegenRatio | 0.035 | 0..1 / 0.005 | 最大生命/s | runtime | src/core/beta-tuning.js:139 |
| beta.smartRestSafeHpRegenRatio | 0.16 | 0..1 / 0.01 | 最大生命/s | runtime | src/core/beta-tuning.js:177 |
| beta.smartRestHealTarget | 1 | 0..1 / 0.01 | 最大生命比例 | runtime | src/core/beta-tuning.js:178 |
| beta.smartStaminaLockSeconds | 1.2 | 0..10 / 0.05 | s | runtime | src/core/beta-tuning.js:141 |
| beta.smartLowHpThreshold | 0.5 | 0..1 / 0.01 | 生命比例 | runtime | src/core/beta-tuning.js:142 |
| beta.smartSpeedMulAtZeroHp | 0.72 | 0..1 / 0.01 | × | runtime | src/core/beta-tuning.js:143 |
| beta.smartDamageMulAtZeroHp | 0.6 | 0..1 / 0.01 | × | runtime | src/core/beta-tuning.js:144 |
| beta.smartRetreatHpRatio | 0.32 | 0..1 / 0.01 | 生命比例 | runtime | src/core/beta-tuning.js:170 |
| beta.smartRetreatStaminaRatio | 0.25 | 0..1 / 0.01 | 体力比例 | runtime | src/core/beta-tuning.js:171 |
| beta.smartRetreatHitStreak | 4 | 1..20 / 1 | 次 | runtime | src/core/beta-tuning.js:172 |
| beta.smartHitStreakDecay | 6 | 0..30 / 0.5 | s | runtime | src/core/beta-tuning.js:173 |
| beta.smartRetreatSpeed | 10.5 | 0..30 / 0.1 | m/s | runtime | src/core/beta-tuning.js:175 |
| beta.smartRetreatArriveRadius | 1.5 | 0.1..10 / 0.1 | m | runtime | src/core/beta-tuning.js:174 |
| beta.smartRestSeconds | 7 | 0..60 / 0.5 | s | runtime | src/core/beta-tuning.js:176 |
| beta.smartRestMinPlayerDistance | 60 | 0..120 / 1 | m | runtime | src/entities/smart-fox.js:49 → Fox._enterRetreat/stepSmartRetreatNavigation 实际距离校验 |
| beta.smartPounceRecoverTime | 0.45 | 0..3 / 0.05 | s | runtime | src/core/beta-tuning.js:136 |
| beta.smartPounceCooldown | 1.5 | 0..10 / 0.1 | s | runtime | src/core/beta-tuning.js:137 |
| beta.smartTeamRestHpRatio | 0.42 | 0..1 / 0.01 | 生命比例 | runtime | src/entities/smart-fox.js:244 |
| beta.smartTeamRestStaminaRatio | 0.2 | 0..1 / 0.01 | 体力比例 | runtime | src/entities/smart-fox.js:245 |
| beta.smartTeamRestFatigue | 0.86 | 0..1 / 0.01 | 疲劳比例 | runtime | src/entities/smart-fox.js:246 |
| beta.smartTeamHealthyHpRatio | 0.62 | 0..1 / 0.01 | 生命比例 | runtime | src/entities/smart-fox.js:247 |
| beta.smartTeamHealthyStaminaRatio | 0.35 | 0..1 / 0.01 | 体力比例 | runtime | src/entities/smart-fox.js:248 |
| beta.smartTeamHoldTime | 1.5 | 0..10 / 0.1 | s | runtime | src/entities/smart-fox.js:240 |
| beta.smartTeamSwitchCooldown | 1.2 | 0..10 / 0.1 | s | runtime | src/entities/smart-fox.js:241 |
| beta.smartPounceAimOffsetScale | 0 | 0..1 / 0.005 | × | runtime | src/entities/smart-fox.js:329；src/entities/smart-fox.js:390 |
| beta.smartPounceMinDistance | 4.2 | 1..15 / 0.05 | m | runtime | src/entities/smart-fox.js:70；src/entities/smart-fox.js:418；src/entities/smart-fox-core.mjs:285 |
| beta.smartPounceMaxDistance | 6.2 | 1..20 / 0.05 | m | runtime | src/entities/smart-fox.js:70；src/entities/smart-fox.js:296；src/entities/smart-fox.js:418；src/entities/smart-fox-core.mjs:286 |
| beta.smartPounceApproachRadius | 5 | 2..10 / 0.02 | m | runtime | src/entities/smart-fox.js:284；src/entities/smart-fox.js:293；src/entities/smart-fox.js:308 |
| beta.smartPounceObserveRadius | 7 | 4..12 / 0.02 | m | runtime | src/entities/smart-fox.js:308；src/entities/smart-fox.js:333 |
| beta.smartPounceRingTolerance | 0.28 | 0.05..1 / 0.002 | m | runtime | src/entities/smart-fox-core.mjs:291 |
| beta.smartPounceMemoryPenalty | 0.18 | 0..1 / 0.005 |  | runtime | src/entities/smart-fox.js:280 |
| beta.smartPounceFatiguePenalty | 0.12 | 0..1 / 0.005 |  | runtime | src/entities/smart-fox.js:280 |
| beta.smartPounceHitRadiusCap | 1.7 | 1.7..3 / 0.005 | m | runtime | src/main.js:2084 → main.js swept contact（新打开游戏的配置；无实例热改） |
| beta.smartPounceLeadSeconds | 0.1 | 0..0.5 / 0.002 | s | runtime | src/entities/smart-fox.js:401 |
| beta.smartPounceMaxLeadDistance | 0.65 | 0..3 / 0.01 | m | runtime | src/entities/smart-fox.js:401 |
| beta.smartPounceStrikeSpeed | 10.8 | 2..25 / 0.1 | m/s | runtime | src/entities/smart-fox.js:448 |
| beta.smartPounceStrikeTime | 0.21 | 0.05..0.8 / 0.002 | s | runtime | src/entities/smart-fox.js:451 |
| beta.smartMeleeTriggerRange | 2.4 | 0.5..4 / 0.01 | m | runtime | src/entities/smart-fox-core.mjs:104 |
| beta.smartMeleeHitRange | 1.55 | 0.3..2.5 / 0.01 | m | runtime | src/entities/smart-fox.js:575；src/entities/smart-fox-core.mjs:140；src/main.js:2083 |
| beta.smartMeleeWindupTime | 0.25 | 0.2..0.6 / 0.002 | s | runtime | src/entities/smart-fox.js:525；src/entities/smart-fox.js:526；src/entities/smart-fox-core.mjs:90 |
| beta.smartMeleeStrikeTime | 0.15 | 0.1..0.3 / 0.001 | s | runtime | src/entities/smart-fox-core.mjs:91 |
| beta.smartMeleeRecoverTime | 0.45 | 0.2..1.5 / 0.005 | s | runtime | src/entities/smart-fox-core.mjs:92 |
| beta.smartMeleeCooldown | 1.1 | 0.6..4 / 0.01 | s | runtime | src/entities/smart-fox-core.mjs:93 |
| beta.smartMeleeStrikeSpeed | 2.4 | 0..5 / 0.02 | m/s | runtime | src/entities/smart-fox.js:438；src/entities/smart-fox.js:439；src/entities/smart-fox.js:440；src/entities/smart-fox.js:441；src/entities/smart-fox.js:442 |

说明：62 项是后台/生产读取对账；没有把静态引用等同于每项均经过浏览器逐一动态验收。浏览器实际测上限、一次性扑击/受击消耗、恢复、阈值、70m 远撤及回血目标。默认值没有改动。内部 preserveCurrentHp/requireDepletion 是 Beta SmartFox 行为守卫，不新增服务端 schema。
