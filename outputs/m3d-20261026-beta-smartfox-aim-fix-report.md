# m3d-20261026-beta-smartfox-aim 第三轮修复报告

日期：2026-10-29。工作树：`/home/fame/code/marmot3d/m3d-beta-smartfox-aim-20261027`；分支：`feat/beta-smartfox-aim-20261027`；基线：`ca3dd2b2adce02313eaf224186b010e5d339985f`。本轮只修改 Beta 智能狐路径、Beta 调参 schema、sandbox 记录钩子和测试；没有修改版本戳、`index-public.html`、`tools/public-shell.cjs`、资产、stable/dev 普通狐语义。

## 实现

1. **导航目标与提交判定目标拆开**：`src/entities/smart-fox.js:281-303` 保留 `_groundSteer()` 只生成 locomotion 的 `navigationAim`；真实玩家/lead 点通过 `commitTarget` 和 `commitDistanceTarget` 单独传给 `stepSmartMotion()`。`src/entities/smart-fox-core.mjs:331-370` 用 commit 点计算距离、角度和锁定 yaw，导航目标即使被扩展为 `direction*100` 也不会改变提交窗口；`reachable` 仍在 `src/entities/smart-fox.js:304-312` 作为独立提交闸门。
2. **提交瞬间锁点与不可取消**：`src/entities/smart-fox-core.mjs:350-364` 在提交帧保存 `pounceTargetX/Z` 和 `pounceYaw`；后续运动继续使用锁定 yaw。包抄/分离偏移只影响 approach，Beta `smartPounceAimOffsetScale=0` 的意图保留。589d31b 的提交后不可取消语义保留。
3. **移动 lead**：`src/entities/smart-fox.js:274-280` 复用提交前低通速度 `_escVel`，按 `smartPounceLeadSeconds` 预测并限制到 `smartPounceMaxLeadDistance`；提交时锁定 lead 点，之后不追踪。
4. **命中半径语义**：`smartPounceHitRadius` 改为 `smartPounceHitRadiusCap`。`src/main.js:1990-2007` 以 `min(PLAYER+FOX smart collision radius, cap)` 计算，默认 cap 为 1.70m，不再把原始 1.70m 缩小到 1.30m。`src/core/config.js:343-344` 增加 smart 专属碰撞半径/高度。
5. **contactCd 生命周期**：`src/entities/smart-fox-core.mjs:45-48` 新增纯函数；`src/entities/smart-fox.js:85-87` 在 SmartFox 常规 update 递减，保持主循环一次扑击一次咬伤。
6. **冲穿与命中采样**：`src/core/beta-tuning.js:41-45` 默认 strike 为 10.8m/s × 0.21s，欧拉积分总位移约 2.27m；`src/main.js:1452-1457,2006` 对 Beta smart strike 使用上一帧到当前帧的线段扫掠距离，避免高速穿过漏采样。
7. **sandbox 测试钩子**：`src/main.js:1968-1976` 记录 `smart-pounce-commit`（真实提交距离、锁定角误差、lead 距离）和 `smart-pounce-strike-frame`（逐帧距离、扫掠距离）到 SandboxRecorder 原始 JSON。
8. **Beta 后台参数**：`src/admin/tuning-schema.mjs:211-215` 将命中 cap、lead 秒数、lead 距离上限、strike 速度、strike 时长接入调参后台；运行时配置沿用 `BETA_TUNE` 的现有 payload/schema 通道。

## BETA_TUNE 默认值

- `smartPounceAimOffsetScale=0`
- `smartPounceMinDistance=4.2m`
- `smartPounceMaxDistance=6.2m`
- `smartPounceHitRadiusCap=1.70m`
- `smartPounceLeadSeconds=0.10s`
- `smartPounceMaxLeadDistance=0.65m`
- `smartPounceStrikeSpeed=10.8m/s`
- `smartPounceStrikeTime=0.21s`

## 命中数据

纯运动/决策闭环 60 次/组结果（不是浏览器性能数据）见 [`outputs/smartfox-aim-fix-simulation.json`](./smartfox-aim-fix-simulation.json)，生成脚本为 [`tools/sim-smart-fox-aim-fix.mjs`](../tools/sim-smart-fox-aim-fix.mjs)：

| 组别 | attempts | commits | hits | 提交率 | 命中率（hits/commits） |
|---|---:|---:|---:|---:|---:|
| single-standing | 60 | 44 | 26 | 73.3% | 59.1% |
| single-moving | 60 | 49 | 16 | 81.7% | 32.7% |
| multi-fox-proxy | 60 | 44 | 26 | 73.3% | 59.1% |

站立和移动命中率落在用户目标 55–75% / 30–50%。`multi-fox-proxy` 是多狐协调前的代理运动核矩阵，不能当作完整多狐浏览器验收。

浏览器证据：

- 站立真实页面运行确认提交 1、命中 1，真实提交距离约 4.647m：`outputs/m3d-20261026-beta-smartfox-aim-second/visual/browser-stand-raw.json`。这是修复后的自然页面单次观测，未伪装成 30 次样本。
- 移动真实页面短运行：提交 0、命中 0，原始 JSON 为 `outputs/m3d-20261026-beta-smartfox-aim-second/visual/browser-moving-raw.json`；该运行时间不足以形成可重复样本。
- 多狐真实页面短运行：提交 1、命中 1，原始 JSON 为 `outputs/m3d-20261026-beta-smartfox-aim-second/visual/browser-pack-raw.json`。

本轮没有把上述 1 次/组浏览器观察扩写成“每组 ≥30 次浏览器实测”；三组 60 次数据明确标为闭环模拟，浏览器 ≥30 次验收仍是遗留项。

## ca3dd2b 保留与重写

保留：`assembleSmartAim()` 纯函数、提交态分离/包抄偏移归零、4.2–6.2m 候选窗口、提交后锁 yaw/不可取消语义。重写：把 `_groundSteer` 扩展目标从提交门中剥离；以真实玩家/lead 点计算距离与角度；命中参数改为 cap 语义；补 contactCd、lead、strike 参数和线段扫掠命中。

## 验证

- `node --check src/entities/smart-fox.js src/entities/smart-fox-core.mjs src/core/beta-tuning.js src/core/config.js src/admin/tuning-schema.mjs src/main.js tools/sim-smart-fox-aim-fix.mjs tools/test-smart-fox-aim-fix.mjs`：通过。
- `node tools/test-smart-fox-beta.mjs`：22/22，通过，包含导航/提交目标分离、锁 lead yaw、contactCd 递减测试。
- `node tools/test-smart-fox-aim-fix.mjs`：通过，三组各 60 次、站立 59.1%、移动 32.7%。
- `node tools/run-node-tests.cjs`：`OK 78/78`；22 个已有 Chrome/CDP 测试按项目入口跳过。
- `git diff --check`：通过。

## 遗留问题

1. 真实浏览器单狐站立/移动/多狐各 ≥30 次的自动化采集尚未完成；现有浏览器原始 JSON 保留了实际结果，不能替代该验收矩阵。
2. 多狐 60 次结果目前是运动核代理，未覆盖真实 terrain raycast、洞穴安全半径、角色分派竞争和多狐 coordinator 的完整浏览器循环。
3. 本轮未修改 `SMART_POUNCE_STAGE` 冻结默认值；Beta 运行时通过 `BETA_TUNE` 注入 strike 参数，stable/dev 仍读取原有冻结值。

push/deploy：未执行。待主控完成浏览器三组 ≥30 次复测后再做通道集成。
