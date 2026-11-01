# rev61 SmartFox 参数审计（浏览器专项待门禁解除）

实际路径：admin beta.* → runtimePayloadFromAdminConfig → sanitizeRuntimeValues → active/explicit/storage → BETA_TUNE → 新实例 smartTuning/smartVitals/smartRetreat 快照。已有实例不热改上限。普通 FOX 不被写回。

| key | 默认 | min..max / step | 单位 | capability | 真实消费者 |
|---|---:|---|---|---|---|
| beta.smartMaxHp | 4 | 1..40 / 1 | 生命 | runtime | createSmartFoxVitals → createSmartFoxSpawnState → 实例/血条/比例 |
| beta.smartMaxStamina | 100 | 1..300 / 1 | 体力 | runtime | createSmartFoxVitals → createSmartFoxSpawnState → 实例/血条/比例 |
| beta.smartStalkStaminaPerSec | 0 | 0..60 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartSprintStaminaPerSec | 0 | 0..60 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartPounceStaminaPerSec | 26 | 0..80 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartPounceStaminaCost | 26 | 0..100 / 1 | 体力 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartMeleeStaminaCost | 0 | 0..100 / 1 | 体力 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartHitStaminaCost | 7 | 0..40 / 0.5 | 体力 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartRestStaminaRegenPerSec | 14 | 0..60 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartRecoverStaminaRegenPerSec | 4.5 | 0..60 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartInterceptStaminaRegenPerSec | 2.5 | 0..60 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartRoamStaminaRegenPerSec | 1.2 | 0..60 / 0.5 | 体力/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartPounceRingCrawlSpeed | 1.1 | 0..5 / 0.05 | m/s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceAlignCreepSpeed | 0.75 | 0..5 / 0.05 | m/s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPackWindow | 1.2 | 0..5 / 0.05 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPackSpacing | 0.35 | 0..2 / 0.01 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPackSlotSpacing | 0.025 | 0..0.5 / 0.005 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartDebounceHold | 0.25 | 0..3 / 0.01 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartRestHpRegenRatio | 0.035 | 0..1 / 0.005 | 最大生命/s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartRestSafeHpRegenRatio | 0.16 | 0..1 / 0.01 | 最大生命/s | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRestHealTarget | 1 | 0..1 / 0.01 | 最大生命比例 | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartStaminaLockSeconds | 1.2 | 0..10 / 0.05 | s | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartLowHpThreshold | 0.5 | 0..1 / 0.01 | 生命比例 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartSpeedMulAtZeroHp | 0.72 | 0..1 / 0.01 | × | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartDamageMulAtZeroHp | 0.6 | 0..1 / 0.01 | × | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartRetreatHpRatio | 0.32 | 0..1 / 0.01 | 生命比例 | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRetreatStaminaRatio | 0.25 | 0..1 / 0.01 | 体力比例 | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRetreatHitStreak | 4 | 1..20 / 1 | 次 | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartHitStreakDecay | 6 | 0..30 / 0.5 | s | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRetreatSpeed | 10.5 | 0..30 / 0.1 | m/s | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRetreatArriveRadius | 1.5 | 0.1..10 / 0.1 | m | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRestSeconds | 7 | 0..60 / 0.5 | s | runtime | createSmartFoxRetreat → SmartFox/Fox retreat/rest_safe/hit |
| beta.smartRestMinPlayerDistance | 60 | 0..120 / 1 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceRecoverTime | 0.45 | 0..3 / 0.05 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceCooldown | 1.5 | 0..10 / 0.1 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartTeamRestHpRatio | 0.42 | 0..1 / 0.01 | 生命比例 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartTeamRestStaminaRatio | 0.2 | 0..1 / 0.01 | 体力比例 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartTeamRestFatigue | 0.86 | 0..1 / 0.01 | 疲劳比例 | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartTeamHealthyHpRatio | 0.62 | 0..1 / 0.01 | 生命比例 | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartTeamHealthyStaminaRatio | 0.35 | 0..1 / 0.01 | 体力比例 | runtime | createSmartFoxVitals → SmartFox.stepStamina/Fox.hit/HP 速度伤害倍率 |
| beta.smartTeamHoldTime | 1.5 | 0..10 / 0.1 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartTeamSwitchCooldown | 1.2 | 0..10 / 0.1 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceAimOffsetScale | 0 | 0..1 / 0.005 | × | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceMinDistance | 4.2 | 1..15 / 0.05 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceMaxDistance | 6.2 | 1..20 / 0.05 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceApproachRadius | 5 | 2..10 / 0.02 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceObserveRadius | 7 | 4..12 / 0.02 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceRingTolerance | 0.28 | 0.05..1 / 0.002 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceMemoryPenalty | 0.18 | 0..1 / 0.005 |  | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceFatiguePenalty | 0.12 | 0..1 / 0.005 |  | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceHitRadiusCap | 1.7 | 1.7..3 / 0.005 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceLeadSeconds | 0.1 | 0..0.5 / 0.002 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceMaxLeadDistance | 0.65 | 0..3 / 0.01 | m | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceStrikeSpeed | 10.8 | 2..25 / 0.1 | m/s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartPounceStrikeTime | 0.21 | 0.05..0.8 / 0.002 | s | runtime | smart-fox.js：T 快照（团队/导航/攻击） |
| beta.smartMeleeTriggerRange | 2.4 | 0.5..4 / 0.01 | m | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |
| beta.smartMeleeHitRange | 1.55 | 0.3..2.5 / 0.01 | m | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |
| beta.smartMeleeWindupTime | 0.25 | 0.2..0.6 / 0.002 | s | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |
| beta.smartMeleeStrikeTime | 0.15 | 0.1..0.3 / 0.001 | s | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |
| beta.smartMeleeRecoverTime | 0.45 | 0.2..1.5 / 0.005 | s | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |
| beta.smartMeleeCooldown | 1.1 | 0.6..4 / 0.01 | s | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |
| beta.smartMeleeStrikeSpeed | 2.4 | 0..5 / 0.02 | m/s | runtime | advanceSmartMelee/smartMeleeContactHit + SmartFox 真实位移 |

说明：这张表记录后台及生产读取链路，不把静态引用存在等同于每项浏览器验收。smartPackWindow 在动态模式不再限制两个提交者；保留兼容序列化。
