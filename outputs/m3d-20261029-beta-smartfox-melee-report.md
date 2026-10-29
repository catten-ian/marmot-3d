# m3d-20261029-beta-smartfox-melee

## 目标与实现

为 Beta 沙盒 SmartFox 增加独立近身撕咬动作。普通 Fox、stable 和 dev 路径保持原有语义；近战只在 `IS_BETA` 的 SmartFox 路径中推进。

近战公开状态为 `meleePhase` / `meleeState.phase`：`null → windup → strike → recover → null`。`SmartFox` 在前摇使用既有 wind 姿态和预警线，攻击窗口使用既有 dash 姿态并做短前移，收招使用既有 rest 姿态。已经 `pounceCommitted`、扑击待提交、恢复锁定、不可达、洞内、死亡、眩晕、撤退或逃跑时不会启动近战；已提交扑击仍由原状态机完成，不会被近战取消。

命中使用主循环已有接触伤害链路：玩家 `invuln`、测试 `godMode`、SmartFox `contactCd`、垂直重叠、`hurt`、粒子、受击音效、`recordTestLog` 和玩家 HP 更新均沿用原入口。近战只做短距离当前接触判定，不使用扑击的 swept hit；一个动作通过 `meleeHitConsumed` 最多结算一次。

## Beta 默认数值

| 参数 | 默认值 |
|---|---:|
| `smartMeleeTriggerRange` | 2.4 m |
| `smartMeleeHitRange` | 1.55 m |
| `smartMeleeWindupTime` | 0.25 s |
| `smartMeleeStrikeTime` | 0.15 s |
| `smartMeleeRecoverTime` | 0.45 s |
| `smartMeleeCooldown` | 1.1 s |
| `smartMeleeStrikeSpeed` | 2.4 m/s |

上述键已加入 `BETA_TUNE`、后台 tuning schema 和现有 runtime config 白名单（`sanitizeRuntimeValues` 按 `BETA_TUNE` 键过滤）。

## 改动文件

- `src/entities/smart-fox-core.mjs`：纯近战状态机、命中消费和当前接触判定。
- `src/entities/smart-fox.js`：Beta SmartFox 状态公开、姿态/预警、短位移和互斥门控。
- `src/main.js`：近战阶段日志与现有玩家伤害入口接入。
- `src/core/beta-tuning.js`：近战默认调参。
- `src/admin/tuning-schema.mjs`：后台参数条目和边界。
- `tools/test-smart-fox-melee.mjs`：8 项 node:test 纯逻辑覆盖。
- `tools/qa-smart-fox-melee.cjs`：真实 Chrome WebGL 桌面/触屏验收脚本。
- `outputs/m3d-20261029-beta-smartfox-melee/`：最新浏览器 JSON 与截图。

未修改资产、public shell、版本戳、stable/dev 专用文件、部署配置或其他工作树。

## Node 验证

- 改动 JS/MJS/CJS `node --check`：全部通过（7/7）。
- 新增近战纯逻辑测试：8/8 通过。
- 既有 SmartFox Beta 测试：22/22 通过。
- SmartFox 闭环、管理员 tuning、runtime config、战斗相关回归：通过。
- `node tools/run-node-tests.cjs`：**89/89 通过**；**22 个 browser/CDP 测试跳过**（脚本明确标记需要外部 Chrome/CDP，不计失败）。
- `git diff --check`：通过。

## 真实浏览器验收

最新一次运行命令为 `node tools/qa-smart-fox-melee.cjs`，结果写入 `outputs/m3d-20261029-beta-smartfox-melee/browser-report.json`，不是引用超时前 JSON。

桌面 1280×720、非 godMode、真实沙盒生成 SmartFox：

- 阶段顺序观察到 `windup → strike → recover → null`；前摇 `state=wind` 且预警可见，攻击 `state=dash`，收招 `state=rest`。
- 两个完整动作各只记录一次 `player-hit`，HP 真实变化 `100 → 88 → 76`；第二个动作在收招/冷却后再次启动。
- 范围外对照动作仍经历 `windup → strike → recover → null`，但 HP 与命中数保持不变（`startHp=64/endHp=64`，`startHits=3/endHits=3`）。
- 浏览器脚本断言：`desktopTwoRealMeleeHits`、`oncePerAction`、`hpDecreasedTwice`、`visiblePhases`、`rangeControlNoDamage`、`rangeControlActed` 均为 `true`。

触屏仿真 390×844、DPR 3、touch、CPU 4×：

- 真实近战命中 1 次，页面无 JavaScript exception/runtime error。
- `maxTouchPoints=5`、`effectiveInput=touch`，`body.scrollWidth=390`、`body.scrollHeight=844`，HUD 和触屏摇杆在视口内。
- `mobileRealMeleeHit`、`mobileHudBounds`、`mobileTouchAndDpr`、`noRuntimeErrors`、`noUnexpectedConsoleErrors` 均为 `true`。

实际渲染后端：**WebGL2 / Three.js WebGLRenderer**；Chrome 报告 renderer 为 `ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)`。

截图与 JSON：

- [browser-report.json](./browser-report.json)
- [desktop-01-windup.png](./desktop-01-windup.png)
- [desktop-02-strike.png](./desktop-02-strike.png)
- [desktop-03-recover.png](./desktop-03-recover.png)
- [desktop-04-two-hits.png](./desktop-04-two-hits.png)
- [desktop-05-out-of-range.png](./desktop-05-out-of-range.png)
- [mobile-390x844-dpr3-cpu4x.png](./mobile-390x844-dpr3-cpu4x.png)

浏览器控制台仍会看到既有远程音频资源和本地游客账号接口的 404 记录；脚本已将这些网络资源日志与 JavaScript runtime error 分开，未发现新增游戏运行时错误。

## 未完成项与已知问题

- 远程 ElevenLabs 音频清单/文件在当前本地验收源上有既有 404，游戏采用已有音频回退路径；本任务未修改音频资产或服务端。
- 22 个通用 browser/CDP 测试由 `run-node-tests.cjs` 按既有约定跳过；本任务专用真实 Chrome QA 已单独运行并保存证据。
- 本任务没有 push 或部署。

## 基线与提交

- base：`10114ebddf13fd7da9f88597af59eedac4d2e450`
- branch：`feat/beta-smartfox-melee-20261029`
- commit：`e87c9ef2be8bdf2d1c348c2b54ae6a9d4d41b35a`（本地）
- push：未执行
- deploy：未执行
- `.codex-lock/`：保留在工作树，未 stage、未提交
