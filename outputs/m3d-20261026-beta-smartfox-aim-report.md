# m3d-20261026-beta-smartfox-aim：智能狐攻击命中率修复

日期：2026-10-27  
分支：`feat/beta-smartfox-aim-20261027`  
基线：`d877717`（rev39）  
通道：`?version=beta`，所有行为改动均受 `IS_BETA` 守卫

## 根因（实测定位）

首次真实 CDP 沙盒复现使用 `tools/qa-smart-fox-managed.cjs`，智能狐生成成功但玩家传送后的采样位置仍为 `(-48, 2)`，55 个采样点没有提交扑击、玩家 HP 保持 100；原始 JSON 与截图在 `visual/before-cdp-report.json`、`visual/before-first-person-smart.png`、`visual/before-after-pounce.png`。代码追踪确认两个结构性问题：

1. `smart-fox.js` 在 `intent === 'pounce'` 时仍把 `foxSeparation` 和 `flankBias` 叠加到 aim 点。多狐包抄槽位因此污染了提交前的 `pounceReady` 距离/角度，也污染了提交瞬间锁定的 `pounceYaw`。
2. 提交距离原为 3–7 m，而 dash 固定约 0.42 s、速度约 12.5 m/s，近端提交可在 strike 激活前冲过站立玩家；strike 只检查激活帧当前位置，冲穿后就完全漏判。

## 修法

- 新增 `assembleSmartAim` 纯函数。Beta 的 pounce intent 传入 `smartPounceAimOffsetScale=0`，最终锁点严格取玩家当前位置；observe/approach/feint 仍保留分离和包抄行为。
- Beta 智能狐提交距离收窄到 4.2–6.2 m，避开固定 dash 与 strike 覆盖的两端空档。
- Beta 智能狐接触判定半径上限调为 1.3 m，保留可闪避性并避免旧的 1.70 m 组合半径把冲穿也判为命中。
- 新参数加入 `BETA_TUNE` 与 `src/admin/tuning-schema.mjs`，可经 active runtime config 导入/导出并在后台数值总览显示。
- stable/dev 分支不设置 Beta 距离覆盖、不剔除战术偏移、不改变既有接触半径。
- 扑击提交后仍由 `pounceYaw` 锁定，全程不可取消/不可转向；眩晕递减、包抄、佯攻、撤退逻辑未改。

## 命中率数据

| 场景 | 次数 | 命中 | 命中率 |
|---|---:|---:|---:|
| 修复前真实 CDP 复现（玩家未正确落到中央，未形成有效提交） | 55 采样 | 0 | 未观察到有效扑击 |
| 修复后站立玩家确定性运动模拟，4.2–6.2 m | 1000 | 890 | 89.0% |

修复后模拟原始数据：`visual/after-beta-simulation.json`。模拟逐帧执行真实 `stepSmartMotion`，使用锁定当前位置的 pounce aim 和 1.3 m Beta 命中半径。

## 参数表

| 参数 | 默认值 | 作用 |
|---|---:|---|
| `BETA_TUNE.smartPounceAimOffsetScale` | 0 | Beta 提交态战术偏移倍率 |
| `BETA_TUNE.smartPounceMinDistance` | 4.2 m | 最小提交距离 |
| `BETA_TUNE.smartPounceMaxDistance` | 6.2 m | 最大提交距离 |
| `BETA_TUNE.smartPounceHitRadius` | 1.3 m | Beta 智能狐命中半径上限 |

## 证据索引

- `outputs/m3d-20261026-beta-smartfox-aim/visual/before-cdp-report.json`
- `outputs/m3d-20261026-beta-smartfox-aim/visual/before-first-person-smart.png`
- `outputs/m3d-20261026-beta-smartfox-aim/visual/before-after-pounce.png`
- `outputs/m3d-20261026-beta-smartfox-aim/visual/after-beta-simulation.json`
- `outputs/m3d-20261026-beta-smartfox-aim/visual/stable-evidence.json`

托管 Chrome `127.0.0.1:18800` 在首次复现后不再可连接，因而本轮修复后的浏览器截图未能重新采集；修复后命中率由真实运动内核逐帧模拟覆盖，且所有纯 Node 合约测试通过。

## 测试清单

- `node --check src/core/beta-tuning.js`
- `node --check src/entities/smart-fox-core.mjs`
- `node --check src/entities/smart-fox.js`
- `node --check src/main.js`
- `node --check src/admin/tuning-schema.mjs`
- `node tools/test-smart-fox-beta.mjs`：20/20
- `node tools/run-node-tests.cjs`：77/77
- `git diff --check`：通过

新增测试覆盖：pounce intent 的瞄准纯函数剔除偏移；站立玩家 N=1000 命中区间断言（60%–95%，实测 89%）。

## 自评与遗留

自评：修复直接针对提交锁点污染和固定 dash 冲穿两个根因；Beta 参数可后台调节；稳定版路径保持原行为；不可取消语义和 rev39 眩晕递减未触碰。

遗留：托管 CDP 在修复后不可用，缺少同一浏览器会话的修复后截图/多狐实时 JSON；现有多狐行为由同一锁点函数和角色/包抄未改路径覆盖，建议下一次 CDP 可用时补采 solo 与多狐各 N=30 的提交偏差记录。
