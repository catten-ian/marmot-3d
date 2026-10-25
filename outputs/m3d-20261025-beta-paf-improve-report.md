# m3d-20261025-beta-paf-improve — Stage 1 交付报告

日期：2026-10-25（Asia/Shanghai）
通道 / 分支：`beta` / `codex/beta-paf-improve-20261025`
实现 commit hash：`43d104d4b7a186359aa65780a53aaa28281eb936`
状态：Stage 1（A1/A2/A3/A4/B1/B2/E3）完成；**未 push、未部署**。

## 1. 目标

依据 `fox-v2/PAF-IMPROVEMENT-PROPOSAL.md` §4 A/B/E 组与 §8.1，将猎物从纯距离触发、直线逃跑的移动靶升级为带多线索 suspicion、freeze、zigzag 与轨迹回避的对手；扑击加入有限 lead 重瞄、垂直捕获窗，并修复重生贴脸。A3 与 B1 同批交付。

## 2. 实现与文件清单

| 文件 | 改动 |
|---|---|
| `src/core/predator-prey.js` | 新建零依赖纯函数：A1 视锥/听觉/suspicion，A2 FSM/freeze，A3 zigzag，A4 着陆点与加权回避，B1 lead/12°/60% 锁定，B2 垂直窗，E3 重生候选与 20 次退化。预留 LOS probe，本阶段不接遮挡。 |
| `src/play/play-as-fox.js` | 七项机制接入真实 `Prey.update()`、wind/lunge 相位和捕获循环；新增参数集中在 `PAF_DEFAULTS`。freeze 清零逻辑速度，只抖视觉网格；垂直窗包含狐狸与猎物各自地形基准。`?pafqa=1` 才开放固定步长 QA 钩子。 |
| `src/play/play-as-fox-debug.js` | 新参数全部接入既有 lil-gui；调试视觉/听觉环只在既有调试台启用。未改 UI 布局/styles.css。 |
| `tools/paf-test-helper.cjs` | 从同一份 `PAF_DEFAULTS` 读取测试配置，避免复制默认值。 |
| `tools/test-paf-prey-mind.cjs` | A1/A2 纯逻辑 `node:test`。 |
| `tools/test-paf-evasion.cjs` | A3/A4 纯逻辑 `node:test`。 |
| `tools/test-paf-pounce.cjs` | B1/B2/E3 纯逻辑 `node:test`，含坡地同高/高差与 20 次退化。 |
| `tools/qa-paf-stage1.cjs` | 零依赖静态 HTTP + CDP；默认复用 `127.0.0.1:18800` 托管 Chrome，独立 target，测完关闭；整体硬上限 480s、单 CDP 调用 60s；托管不可用才自起 ANGLE/OpenGL Chrome，不强制 SwiftShader。 |
| `outputs/m3d-20261025-beta-paf-improve/` | 截图、结构化 CDP 结果与测试日志。 |
| `outputs/m3d-20261025-beta-paf-improve-report.md` | 本报告。 |

未修改 `index-public.html`、`tools/public-shell.cjs`、`src/core/version.js`、AI 藏狐线实体、`procedural-fox.js`、server/Caddy/systemd；未新增依赖或资产。

## 3. 静态检查与 Node 测试

所有命令均在 JOB 根目录执行，退出码均为 0。

| 精确命令 | 结果 |
|---|---|
| `for f in src/core/predator-prey.js src/play/play-as-fox.js src/play/play-as-fox-debug.js tools/paf-test-helper.cjs tools/test-paf-prey-mind.cjs tools/test-paf-evasion.cjs tools/test-paf-pounce.cjs tools/qa-paf-stage1.cjs; do node --check "$f"; done` | **8/8 通过** |
| `node tools/test-paf-prey-mind.cjs` | **12/12 通过，0 失败** |
| `node tools/test-paf-evasion.cjs` | **9/9 通过，0 失败** |
| `node tools/test-paf-pounce.cjs` | **14/14 通过，0 失败** |
| `node tools/test-fox-pounce.cjs` | **8/8 通过，0 失败** |
| `node tools/test-fox-tuning.cjs` | **7/7 通过，0 失败** |
| `node tools/test-fox-vitals.cjs` | **9/9 通过，0 失败** |
| `node tools/test-fox-tactics.cjs` | **10/10 通过，0 失败** |
| `node tools/test-procedural-fox.cjs` | **通过：`procedural fox: all assertions passed`** |
| `node tools/run-node-tests.cjs` | **57/57 通过，0 失败**； runner 按既有规则跳过 22 个 browser/CDP 文件，PAF 浏览器验收另行执行如下。 |

日志：`outputs/m3d-20261025-beta-paf-improve/unit-tests.log`、`node-tests.log`。

## 4. Chrome CDP 实测

命令：`node tools/qa-paf-stage1.cjs`
结果：**退出码 0；14/14 检查通过；0 console.error / Runtime exception**。本轮耗时约 96 秒，低于 480 秒硬上限。

- URL 覆盖 `?play-as-fox=1`，通过应用现有 `window.__enterPlayAsFox()` 进入同一模式入口；未改动受限的 `main.js`。
- 托管 Chrome：`Chrome/147.0.7727.137`，`http://127.0.0.1:18800`。
- **实际渲染后端：WebGL2；GPU：ANGLE / Mesa Intel Iris Xe Graphics (ADL GT2)；硬件加速。** `navigator.gpu` 可用只表示浏览器支持 WebGPU，本路径并未使用 WebGPU；也不是 SwiftShader/llvmpipe 软件渲染。
- 共享 Chrome 的后台 rAF 会节流，因此战斗场景使用显式 `?pafqa=1` 下的 `qa.step(1/60)` 固定步长驱动真实更新/相位/捕获循环；截图来自实际 Three.js 场景渲染。窄屏、刷新、退出重进、存储故障、断网和普通玩家路径仍走浏览器实际流程。

| 场景 | 实测结果 |
|---|---|
| A2 freeze | `wander → alert → freeze → flee`（线索丢失后最终回 wander）；本次 freeze 266.7ms；冻结逻辑位移 **0m**、朝向误差 **0°**。 |
| A3 zigzag | 近距离 2 秒内反转 **3 次**，速度中位数 **3.93m/s**，轨迹非直线。 |
| A4 轨迹回避 | 实际逃向与 0.4/0.6 加权期望方向误差 **1.20°**；相对只逃当前位置的方向偏离 **4.94°**。 |
| B1 lead + 重瞄 | **16/16 横向对抗试验捕获**，最大重瞄 **8.14° < 12°**；lunge 不重瞄。此结果仅是该固定步长场景，不宣称普遍命中率。 |
| B2 垂直窗 | 平地高度差 0.0025m；高空组保持捕获开启，将水平圈设为 1.0m 以隔离高空段；进入水平圈后 airY 0.90–1.05m **全程未捕获**，低空近距对照捕获成功。 |
| E3 重生 | **60/60** 合格；最小距离 **18.09m**，最小视线偏角 **35.9°**；20 次退化另由纯逻辑测试覆盖。 |
| 窄屏 | 390×844，触控 class 与摇杆均有效，见截图。 |
| 刷新 / 退出重进 | 均通过；重进后 8 只猎物，退出时 HUD 销毁，同页重进成功。 |
| 故障路径 | localStorage get/set/remove 全抛时仍可进入并扑击；离线后模式保持 active 且相位推进。 |
| 调参台 | 既有 lil-gui 正常，递归检查 92 个 controller，新参数代表项全部存在。 |
| 普通玩家 | 不带 `pafqa/pafdebug`：无 `qa.step`、无 lil-gui、无 `paf-debug-view` 几何体。 |

结构化结果：`outputs/m3d-20261025-beta-paf-improve/qa-results.json`
运行日志：`outputs/m3d-20261025-beta-paf-improve/qa-run.log`

截图：

1. `outputs/m3d-20261025-beta-paf-improve/01-paf-freeze-desktop.png`
2. `outputs/m3d-20261025-beta-paf-improve/02-zigzag-field.png`
3. `outputs/m3d-20261025-beta-paf-improve/03-pounce.png`
4. `outputs/m3d-20261025-beta-paf-improve/04-narrow-touch.png`
5. `outputs/m3d-20261025-beta-paf-improve/05-after-refresh.png`
6. `outputs/m3d-20261025-beta-paf-improve/06-paf-debug.png`

## 5. 遗留问题 / 边界

- 按 Stage 1 边界，不接真实 LOS/岩石遮挡；仅保留可插拔 probe。听觉为全向代理，不是声学传播模拟。
- 参数是建议书起点，仍需后续真人手感灰度；确定性 QA 的命中数不是普遍难度承诺。
- Stage 2（体力/冷却/顿帧/难度/计分/连击）与 Stage 3（姿态/四足/掩体）不在本次范围。
- 未引入 RL/模仿学习，未改 AI 藏狐线 `observe/approach` 或其实体层。

## 6. 提交与发布状态

- 实现 commit：`43d104d4b7a186359aa65780a53aaa28281eb936`（完整 hash 在本文件更新后保留于 git 历史）。
- 本报告在实现提交后填入准确实现 hash，并有单独的本地报告提交。
- **未 push、未部署；未改版本戳、Caddy、systemd 或线上文件。**
