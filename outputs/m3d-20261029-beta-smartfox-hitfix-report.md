# m3d-20261029-beta-smartfox-hitfix

## 用户目标与验收条件

修复 beta 通道智能狐在玩家站立不动时几乎不提交、提交后又容易擦过玩家的问题。验收要求包括完整决策链闭环仿真、提交率与命中率分别断言、Node 回归、beta 专项测试、语法检查、`git diff --check` 和本地 commit。未 push、未部署。

## 复现与测量

新增 `tools/sim-smart-fox-closed-loop.mjs`，按感知 → utility → near-band → debounce → 目标点 → `stepSmartMotion` 顺序运行 60 秒；脚本记录每次提交的时间、距离、角度、suspicion、memory、fatigue。它不创建 Three.js 场景，因此没有复刻地形 raycast、真实角色分工、障碍物集合和浏览器帧抖动；提交门在基线仿真中显式放开，用来隔离决策和运动学问题。多狐场景使用同一闭环模型，未伪造真实 pack coordinator 的角色竞争。

修复前基线证据：`outputs/smart-fox-closed-loop-baseline.json`。

| 场景 | 修复前提交 | 修复前命中 | 修复后提交 | 修复后命中 |
|---|---:|---:|---:|---:|
| 玩家面对狐狸 | 0 | 0 | 1 | 1 |
| 玩家背对狐狸 | 1 | 1 | 1 | 1 |
| 玩家被打中过一次（memory=1） | 0 | 0 | 1 | 1 |
| 多狐同场代表场景 | 0 | 0 | 1 | 1 |

修复前面对狐狸的 `suspicion=1` 会把 approach 推到 pounce 之上；修复后面对狐狸在 5.50m 提交，扫掠命中。

## 根因证据

- `src/entities/smart-fox-core.mjs:270-287` 原公式使用 approach suspicion 权重 0.22、pounce suspicion 权重 0.20，且 pounce 基础/距离优势很小；在线复刻数据在 suspicion=1 时 5.0m、5.5m、6.2m 的 pounce margin 分别为 -0.0008、-0.0029、-0.0058。
- 原 memory=1 和 fatigue≥0.1 即可翻转 pounce；原记忆延迟与衰减路径使一次受击后的 30 秒窗口很难恢复。
- `src/entities/smart-fox.js` 原接近停靠半径是 3.4m、观察半径是 7.2m，而提交窗口为 4.2–6.2m；狐狸高速穿窗时间约 0.31 秒。
- 原 `stepSmartMotion` 使用固定 0.42s dash，再进入 0.22s strike；6.2m 提交时 strike 开始距离约 4.45m，strike 只覆盖约 2.97m，带瞄准误差会擦过命中圆。
- `src/main.js:1987-2004` 原 beta 命中只检查 strike 激活帧的单点距离；高速跨越玩家时可能漏采样。
- `src/core/config.js:346-347` 原 `FOX.collisionRadius` 与 `collisionHeight` 都没有 smart 键，smart 会回退 normal。

## 实际改动

- `src/entities/smart-fox-core.mjs`：`utilityScores` 增加 beta-only 权重覆盖输入；beta 将 suspicion 倾向 pounce，降低 memory/interruption/fatigue 惩罚。未传 `betaOn` 时完全使用原 `SMART_WEIGHTS` 数值和公式。
- `src/entities/smart-fox.js`：仅 `IS_BETA` 使用新的接近/观察停靠半径；根据实际提交距离和 dash 积分反解 dash 时长，使 strike 轨迹覆盖玩家；beta 参数来自 `BETA_TUNE`。
- `src/core/beta-tuning.js`：新增 beta 智能狐提交距离、停靠半径、冲刺结束距离、memory/fatigue 惩罚调参项。
- `src/admin/tuning-schema.mjs`：把新增 beta 参数暴露到后台调参台。
- `src/main.js`：仅 beta smart fox 使用上一帧到当前帧的线段—玩家圆连续扫掠距离；stable 和普通狐仍走原单点距离语义。
- `src/core/config.js`：补 `collisionRadius.smart=1.34`、`collisionHeight.smart=0.48`，消除 smart 回退口径。
- `tools/sim-smart-fox-closed-loop.mjs`：修复前/后闭环数据采集脚本。
- `tools/test-smart-fox-closed-loop.mjs`：beta 闭环测试；提交和命中是两个独立的非零断言，防止“永远不提交”和“永远提交但全不中”。

## 验证

- `node --check src/entities/smart-fox-core.mjs src/entities/smart-fox.js src/core/beta-tuning.js src/core/config.js src/admin/tuning-schema.mjs src/main.js tools/sim-smart-fox-closed-loop.mjs tools/test-smart-fox-closed-loop.mjs`：通过。
- `node tools/run-node-tests.cjs`：通过 86/86；22 个浏览器/CDP 测试按项目规则跳过。修复前基线为 85/85。
- `node tools/test-smart-fox-beta.mjs`：20/20 通过，旧的 0.89 运动学模拟仍通过。
- `SMARTFOX_BETA=0 node tools/sim-smart-fox-closed-loop.mjs > outputs/smart-fox-closed-loop-baseline.json`：通过，生成修复前对照。
- `SMARTFOX_ASSERT=1 node tools/test-smart-fox-closed-loop.mjs`：通过；facing 场景提交率 1.0、命中率 1.0，两个断言独立执行。
- `git diff --check`：通过，无空白错误。
- 未执行线上连接；未启动浏览器真机验证。该任务的核心行为由纯函数闭环测试覆盖。

## 未完成项与已知问题

闭环脚本没有复刻真实地形 raycast、Three.js 动画帧、真实障碍物和多狐 coordinator 的全部角色竞争，因此它是决策/运动学回归证据，不是真机性能证明。真实场景仍可能因墙体、撤退、体力门或角色分工降低提交频率；这些路径保留并受 beta 门控。临时绕行是让玩家进入 3.8–6.8m 的无遮挡范围。

## 分支与交付

- 分支：`feat/beta-smartfox-hitfix-20261029`
- base SHA：`1cf74bb958b21efb2ef2ef3bd349f4ccf11046e4`
- commit：`a529727fa55a8de2f3d75aa51574e5e424cae089`
- push/deploy：未 push、未部署、未改 Caddy/systemd/线上文件。

## Codex 自评

修复覆盖了决策倾向、停靠半径、扑击几何、连续命中和 smart 碰撞口径，并有独立闭环断言。当前证据最强的是纯逻辑闭环和全量 Node 回归；浏览器/CDP 未运行，所以不能宣称已经完成真实浏览器画面验收。
