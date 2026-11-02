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
| `timeout --signal=TERM --kill-after=5s 55s node tools/run-node-tests.cjs` | **57/57 通过，0 失败**；runner 按既有规则跳过 22 个 browser/CDP 文件，PAF 浏览器验收另行执行如下。 |

日志：`outputs/m3d-20261025-beta-paf-improve/syntax-check.log`、`unit-tests.log`、`fox-contract-tests.log`、`node-tests.log`。

## 4. Chrome CDP 实测

命令：`timeout --signal=TERM --kill-after=5s 475s node tools/qa-paf-stage1.cjs`
结果：**退出码 0；14/14 检查通过；0 console.error / Runtime exception**。本轮结构化场景从 `2026-10-25T12:52:40.997Z` 到 `12:53:01.146Z`，约 **20.15 秒**；进程清理后正常退出，低于外层 475 秒与脚本内 480 秒上限。

- URL 覆盖 `?play-as-fox=1`，通过应用现有 `window.__enterPlayAsFox()` 进入同一模式入口；未改动受限的 `main.js`。
- 托管 Chrome：`Chrome/147.0.7727.137`，`http://127.0.0.1:18800`。
- **实际渲染后端：WebGL2；GPU：ANGLE / Mesa Intel Iris Xe Graphics (ADL GT2)；硬件加速。** `navigator.gpu` 可用只表示浏览器支持 WebGPU，本路径并未使用 WebGPU；也不是 SwiftShader/llvmpipe 软件渲染。
- 共享 Chrome 的后台 rAF 会节流，因此战斗场景使用显式 `?pafqa=1` 下的 `qa.step(1/60)` 固定步长驱动真实更新/相位/捕获循环；截图来自实际 Three.js 场景渲染。窄屏、刷新、退出重进、存储故障、断网和普通玩家路径仍走浏览器实际流程。

| 场景 | 实测结果 |
|---|---|
| A2 freeze | `wander → alert → freeze → flee`（线索丢失后最终回 wander）；本次 freeze 266.7ms；冻结逻辑位移 **0m**、朝向误差 **0°**。 |
| A3 zigzag | 近距离 2 秒内反转 **4 次**，速度中位数 **3.58m/s**，轨迹非直线。 |
| A4 轨迹回避 | 实际逃向与 0.4/0.6 加权期望方向误差 **1.20°**；相对只逃当前位置的方向偏离 **4.94°**。 |
| B1 lead + 重瞄 | 16 次试验中 **14 次具有横向速度，16/16 捕获**，最大重瞄 **8.26° < 12°**；lunge 不重瞄。此结果仅是该固定步长场景，不宣称普遍命中率。 |
| B2 垂直窗 | 平地高度差 0.0025m；高空组保持捕获开启，将水平圈设为 1.0m 以隔离高空段；进入水平圈后 airY 0.90–1.05m **全程未捕获**，低空近距对照捕获成功。 |
| E3 重生 | **60/60** 合格；最小距离 **18.10m**，最小视线偏角 **37.2°**；20 次退化另由纯逻辑测试覆盖。 |
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
- Stage 2（触屏兼容）、Stage 3（体力/冷却/顿帧/难度/计分/连击）与 Stage 4 其余工作（姿态/四足/掩体）不在本次范围。
- 本轮未发现 Stage 1 阻断性遗留问题；数值手感和普遍命中率仍需后续真人 playtest，不能用确定性 QA 替代。
- 未引入 RL/模仿学习，未改 AI 藏狐线 `observe/approach` 或其实体层。

## 6. 提交与发布状态

- 实现 commit：`43d104d4b7a186359aa65780a53aaa28281eb936`（完整 hash 在本文件更新后保留于 git 历史）。
- 初版验收报告 commit：`f9cb00906fc016731c6986b4b41215edfad5c1e0`。
- 本轮收口提交包含复测后的结构化结果、6 张截图与本报告；其本地 commit hash 在交付回复中列明。复测日志保留在上述 `outputs/m3d-20261025-beta-paf-improve/` 路径。
- **未 push、未部署；未改版本戳、Caddy、systemd 或线上文件。**

---

# Current Scope — timed range + local leaderboard

日期：2026-11-02（Asia/Shanghai）
通道 / 分支：`beta` / `codex/beta-paf-timed-range-20261102`
基线：`95c6f2acc9f78181158d60f8a004397e0e0b2a2e`（rev61）
实现 commit：`6566139`（本地；未 push、未部署）。

## 行为

- **攻击距离**：蓄力期间预览与实际扑击共用 `pafPouncePathAt`/`pafPounceCanCatchAt` 的同一终点和后半段命中窗。触屏只消费攻击按钮自己的 pointer；按住攻击键后，屏幕上拖（`dy < 0`）延长、下拖（`dy > 0`）缩短真实扑击距离；松开仍是唯一提交点。键鼠保持指针锁定：鼠标垂直移动同步调整距离，`PageUp`/`PageDown` 提供等价键盘控制；TPS/FPV 的视角转向仍各自保留。范围为 **3.60–7.20m**，默认 **5.67m**，每屏幕像素 **0.02m**，输入和预览均钳制；取消、暂停、blur、visibility、pointercancel、退出、multi-touch 路由恢复都会清空蓄力。
- **冲突解决**：触屏继续复用 `PafInputRoute`/共享 `TouchControls`，攻击 pointer 不抢摇杆或右侧 look pointer；PAF 屏蔽共享攻击键的旧 parry/roll 回调。普通练习模式仍可直接进入，顶部提供显式「开始 2 分钟限时挑战」按钮，不会静默把自由 PAF 变成计时。
- **计时模式**：`createPafTimedRound` 用 active-play fixed-step `dt` 累计，精确在 **120000ms** 结束；暂停、设置、隐藏态不推进。时间到先停止攻击/捕获，再显示实际分数；结果页提供「再来一局」和「退出扮演」。
- **本机榜单**：版本化键 `m3d_paf_leaderboard_v1`，默认容量 10；仅接受整数分数、有效 ISO 时间戳和正整数时长，按分数降序、时长、时间戳稳定排序。读取/写入/清除遇到损坏、拒绝或不可用存储均 fail-soft；UI 标明「仅此设备」，支持清除本机记录，不依赖服务端或账号。

## 改动文件

- `src/play/play-as-fox.js`：范围输入/同几何实际扑击、计时模式入口和结果 UI、榜单 UI、暂停/隐藏清理、QA 状态钩子。
- `src/core/paf-timed-range.mjs`：范围映射和 120000ms 计时纯模块。
- `src/core/paf-leaderboard.mjs`：版本化 localStorage 榜单纯模块。
- `tools/test-paf-timed-range.cjs`、`tools/test-paf-leaderboard.cjs`：边界、暂停/重启、取消、范围同路径、排序/容量/存储故障测试。
- `tools/qa-paf-timed-range.cjs`：私有 Chrome/CDP 真实 UI 验收，不连接共享 `18800`。
- `outputs/m3d-20261025-beta-paf-improve/07-*.png` 至 `11-*.png`、`qa-timed-range-results.json`：本轮证据。

## 验证

- 语法：所有 changed `JS/MJS/CJS` `node --check` 通过；`git diff --check` 通过。
- 纯测试：`node --test tools/test-paf-timed-range.cjs tools/test-paf-leaderboard.cjs` **8/8**；既有 `test-paf-input-route`、`test-paf-pounce`、`test-paf-entry`、`test-paf-audio-settings` 全通过。
- 全量：`timeout --signal=TERM --kill-after=5s 90s node tools/run-node-tests.cjs` **99/99 PASS**，既有规则跳过 **22** 个 browser/CDP 测试。
- 私有浏览器：`timeout --signal=TERM --kill-after=10s 180s node tools/qa-paf-timed-range.cjs` **17/17 checks PASS**，`0 console.error`、`0 Runtime.exceptionThrown`；Chrome **147.0.7727.137**，`WebGL2RenderingContext`（私有 headless 实例，renderer 字符串 `WebKit WebGL`）。覆盖桌面 TPS/FPV、键盘范围、390×844 触控真实按住-上拖-松开、计时开始、完整 **2400 × 0.05s = 120s** fixed-step round、时间到结果、刷新后榜单持久化和重启。

## 限制

- 私有 headless Chrome 的真实 rAF 在本环境会被节流，因此 120 秒浏览器轮次使用产品已暴露的 `?pafqa=1` `__playAsFox.step(0.05)` 固定步长钩子完成；这是真实 PAF 更新/渲染/榜单路径，不伪造分数，也不把该结果宣称为物理设备实玩成绩。纯测试覆盖精确边界；未声称额外的 120 秒墙钟 rAF 场景通过。
- 本轮未修改 `touch-controls.js`、`main.js`、公共 shell、版本戳、服务器或其他通道；未新增第三方依赖或资产。
