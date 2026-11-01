# m3d-20261030-beta-paf-input

- Branch: `fix/beta-paf-input-20261030`
- Base SHA: `2d72774a29b7563b8628c3ee8dc8fd735fca3884`
- Channel: beta
- Job: `/home/fame/code/marmot3d/m3d-beta-paf-input-20261030`
- Delivery: local commit only; no push or deploy
- Implementation commit: `8b4c3de8b8e7cd2e40224f59a6e38778d4495c92` (local)
- Report commit: documentation follow-up commit on this branch (reported with the final delivery SHA)

## Goal and acceptance matrix

| Requirement | Result | Evidence |
|---|---|---|
| PAF FPV/TPS movement/action parity with camera-relative mapping | PASS | Shared `pafMovementFromInput`/`pafDirectionFromInput`; focused parity tests; browser W movement in TPS and FPV |
| PAF pounce reach is 1.25 using the real collision contract | PASS | `PAF_DEFAULTS.catchRadius = 1.25`; `canCatch` strict boundary tests; browser telemetry reports `catchRadius: 1.25` |
| Keyboard pounce choices W/A+W/A/D/W+D, touch equivalent, default 120° arc | PASS | Focused direction tests cover W, AW, A, D, WD, diagonal normalization, touch axes, finite fallback, configurable arc; browser A selection commits `-1.0471975516` rad (−60°) |
| Direction follows input through wind and commits to actual motion | PASS | Wind/lunge telemetry keeps committed yaw; desktop lunge position deltas match yaw and speed; touch wind/lunge telemetry keeps `0.9505471937` rad |
| Moving pounce is press-triggered and does not require hold/release | PASS | `PafPounceCharge` launches after wind time regardless of release; repeated press is rejected; touch browser sequence reaches wind → lunge → recover after a press |
| No repeated auto-trigger from held key | PASS | Keydown repeat is ignored and phase/state gate rejects re-arm; focused no-repeat test |
| Touch labels/debug text contain no stale hold-to-charge instruction | PASS | Touch screenshot and telemetry tip: `扑击按下后自动扑出`; source scan has no stale hold-charge wording |
| PAF config/debug arc parameter is clamped and exposed | PASS | `pounceArcDeg` default 120, runtime clamp 0–360, lil-gui slider, saved PAF config path remains active |
| Ordinary marmot controls and unrelated systems | PASS by scope review | Only PAF input, PAF debug, PAF tests, and PAF pounce default changed |

## Changed files

- `src/core/paf-input.js` — shared camera-relative movement/pounce direction helpers and press-based windup gate.
- `src/play/play-as-fox.js` — PAF parity movement, live wind direction selection, 1.25 reach, press-only pounce, touch copy and telemetry hook.
- `src/play/play-as-fox-debug.js` — configurable `pounceArcDeg` slider and updated pounce wording.
- `tools/test-paf-input-route.cjs` — parity, keyboard combination, touch direction, arc, press/no-repeat regression coverage.
- `tools/test-paf-pounce.cjs` — 1.25 collision reach boundary coverage.
- `outputs/m3d-20261030-beta-paf-input/` — browser screenshots and structured telemetry.

## Tests and validation

Syntax checks passed with `node --check` for every changed JS/MJS file:

- `src/core/paf-input.js`
- `src/play/play-as-fox.js`
- `src/play/play-as-fox-debug.js`
- `src/core/paf-camera.js` (read-only validation of the requested camera module)

Focused PAF command:

```text
node --test tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-pounce.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs
41 passed, 0 failed, 0 skipped
```

Full required Node runner:

```text
node tools/run-node-tests.cjs
90 PASS, 22 SKIP (browser/CDP), 0 FAIL
```

The 22 skips are the runner's browser/CDP tests and are explicitly skips, not passes. `git diff --check` also passed.

## Browser evidence

A local server and headless Chrome CDP were used for real interaction. Renderer telemetry:

```json
{"backend":"WebGL2","renderer":"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver"}
```

Desktop (1280×720):

- TPS before/after movement captured in `desktop-tps-before.png` and `desktop-paf-after.png`; W moved z from `-6` to `-5.875`.
- FPV captured in `desktop-fpv-after-view.png`.
- Holding A while pressing Space produced wind telemetry at `pounceYaw = -1.0471975516` rad, the configured −60° arc edge. Lunge samples retained that yaw and moved by approximately `(-0.5846, +0.3375)` per sample, consistent with the committed direction and configured speed.
- `desktop-paf-wind.png` and `desktop-paf-after.png` capture before/after action state.

Mobile emulation (390×844 CSS pixels, DPR3; screenshots are 1170×2532 PNG):

- `mobile-390x844-tps-before.png` and `mobile-390x844-during-after.png`.
- Real touch joystick and attack dispatch reached `idle → wind → lunge → recover`.
- Touch joystick direction produced wind/lunge `pounceYaw = 0.9505471937` rad and retained it through lunge.
- Touch route was active (`touch-mode touch-playing paf-touch-route`), and the rendered help text was `左下摇杆移动 · 冲刺切换潜行 · 扑击按下后自动扑出（潜行）`.
- No console errors were recorded.

Structured data is in [`browser-telemetry.json`](./m3d-20261030-beta-paf-input/browser-telemetry.json); desktop-only early readback is in [`browser-telemetry-desktop.json`](./m3d-20261030-beta-paf-input/browser-telemetry-desktop.json). Screenshots are in the same directory.

## Unverified items

- Browser evidence used headless Chrome with SwiftShader WebGL2. A hardware accelerated desktop GPU path and a physical phone were not available in this environment.
- The browser sequence exercised W and A on desktop plus a continuous touch joystick direction; every listed keyboard combination is covered by deterministic direction-contract tests.
- The existing repository PAF FPV harness was also inspected; its older touch-button assumptions do not match the current shared touch layout, so its unrelated tracked artifacts were reverted. The dedicated run above is the authoritative evidence for this change.

## 2026-10-31 追加契约：按住瞄准、松开扑击、后半段命中

本轮沿用同一 JOB，基于 rev58 base `e1d6c0774cb7af387fd9e7c2c6559f8c5b388d8e`。新契约取代旧的“按下即触发 / windTime 到点自动扑出”：按住只进入 wind 预备并显示预测范围，松开才启动一次 lunge；旧 `windTime` 调参项已移除，固定后半段窗口不暴露面板旋钮。

改动文件：

- `src/core/paf-input.js`：`PafPounceCharge` 改为带 pointer identity 的 press/hold/release/cancel 闸门；重复回调、多指、无关 release 均不发招；新增 `pafPounceActiveAt`、`pafPouncePathAt`、`pafPouncePreviewSegment`，统一后半段窗口和真实路径端点。
- `src/play/play-as-fox.js`：键盘、鼠标左键、TouchControls 攻击统一 hold/release；blur、暂停、设置暂停、退出会取消预备并清理预览；预览使用真实 lunge 半段扫掠胶囊和目标环标记；实际 `canCatch` 仅在 `pafPounceActiveAt(...)` 为真时结算；HUD/触控 aria 更新为“按住瞄准/显示范围，松开扑击”。预览几何与标记在释放、取消、退出时 dispose。
- `src/play/play-as-fox-debug.js`：移除已不再有运行时意义的旧 windTime 面板项。
- `tools/test-paf-input-route.cjs`：旧按下自动扑出断言改为新 hold/release、超旧 windTime 不自动攻击、release 去重、pointer identity、后半段边界和路径一致性断言。
- `tools/test-paf-entry.cjs`：独立触控 DOM 约束改为只检查 DOM id，允许共享纯逻辑函数名。
- `outputs/m3d-20261030-beta-paf-input-report.md`：追加本轮契约、实现和证据。

确定性验证：

- `node --check src/core/paf-input.js src/play/play-as-fox.js src/play/play-as-fox-debug.js`：通过。
- `node --test tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-pounce.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs`：45 passed, 0 failed, 0 skipped。
- `node tools/run-node-tests.cjs`：94/94 passed；22 browser/CDP tests skipped（需要 Chrome），0 failed。skip 未计入通过。
- `git diff --check`：通过。

后半段边界已明确覆盖：归一化 `t=0`、`0.25`、`0.499999` 不命中，`t=0.5` 和 `t=1` 允许进入现有 `canCatch` 几何，`t>1` 不命中；recover 不再调用命中。一次攻击通过目标 `caught` 状态只结算一次，预览阶段不改 HP/score/猎物状态。静止目标的预测语义是释放时刻及攻击路径不变则后半段命中；释放后猎物自主移动属于时间语义变化，不算预览错误。

视觉矩阵：本环境存在外部 Chrome CDP，但现有 `tools/qa-paf-stage1.cjs` 和 `tools/qa-paf-fpv-managed.cjs` 仍等待 rev58 的旧“按下自动 lunge”时序，启动后分别停在旧场景/导航等待，已中止以避免伪造证据；本轮没有把 synthetic fixture 当作实机通过。390×844、768×1024、1280×720 的真实 TPS/FPV/触控截图和“按住无捕获、松开攻击”的实机证据因此未验证，记录为阻塞项，不能宣称视觉验收通过。

资源清理：预览 group、CapsuleGeometry、材质和目标环在每次释放/取消/暂停/退出时移除并 dispose；TouchControls 仍由共享 route 管理，退出先 `releaseAll()` 再 restore，避免重复监听或跨次输入残留。未修改 `src/main.js`、智能狐 AI、rig/动画、public shell、版本戳或其他工作树；push/deploy 未执行。

本轮本地实现 commit：交付时 `git rev-parse HEAD`；push/deploy 未执行。

## 2026-11-01 继续交付：共享真实命中几何与浏览器验收矩阵

本轮保留此前本地提交 `ad2729756589e84a443d47c71e62c2fd56e2970d`，继续沿用 rev58 base `e1d6c0774cb7af387fd9e7c2c6559f8c5b388d8e`。用户新契约仍明确取代报告前半部分记录的旧“按下自动扑出”行为：按住只预备/瞄准并显示真实预测范围，松开才启动一次 lunge；伤害/捕获只允许归一化进度 `0.5 <= t <= 1`。

### 本轮审查发现与实现

- `ad272975` 已有 hold/release 输入闸门和后半段窗口，但预览目标标识仍另写近似采样，且实际 lunge 逐帧积分、命中直接使用当前位置，与预览的解析路径不是同一条实现路径。
- 新增 `src/core/paf-pounce.js`，把固定后半段窗口、解析路径、腾空高度、预览扫掠段、真实命中和预测目标判定集中为 PAF 专用纯函数。`pafPounceCanCatchAt()` 内部强制 `0.5 <= t <= 1`，并直接复用现有 `predator-prey.canCatch` 的严格水平半径、地形基准、中心高度和垂直窗口，不新增第二套碰撞规则。
- `src/play/play-as-fox.js` 的实际 lunge 移动、腾空高度和捕获现在都调用上述共享函数；方向仍沿用最后有效预览的 `lungeYaw`，距离仍为 `lungeSpeed * lungeTime`，半径和垂直参数仍来自同一运行时 `cfg`。既有边界 clamp、岩石 push-out、recover、分数和猎物 AI 流程保留。
- 预览目标标识改为调用共享预测谓词；黄色 3D 扫掠胶囊对应后半段路径和 `catchRadius`。绿色可命中目标环改为猎物上方、朝向相机的高亮环，避免 TPS 下被狐狸自身遮住。释放、取消、暂停、设置打开、blur、退出继续移除并 dispose 预览几何/材质/标记。
- `src/core/paf-input.js` 仅重导出共享纯函数，保留 `PafPounceCharge` 的唯一输入状态机和 pointer identity；没有另造输入系统，也没有新增 beta tuning 旋钮。
- `tools/test-paf-pounce.cjs` 新增共享几何和明确边界测试；`tools/qa-paf-release-attack.cjs` 是新的真实页面 CDP 验收脚本，使用 keydown/repeat/keyup、鼠标 press/release 和真实 touch start/end/cancel，不再假设按下自动 lunge。`?pafqa=1` 固定步长只控制真实生产 PAF 实例的更新时间，不是 synthetic fixture。

### 确定性测试与语法

对全部本轮修改/新增 JS/MJS/CJS 执行：

```text
node --check src/core/paf-pounce.js
node --check src/core/paf-input.js
node --check src/play/play-as-fox.js
node --check tools/test-paf-pounce.cjs
node --check tools/qa-paf-release-attack.cjs
```

结果：5/5 通过，0 失败。

PAF 聚焦命令：

```text
node --test tools/test-paf-input-route.cjs tools/test-paf-pounce.cjs tools/test-paf-camera.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs tools/test-paf-evasion.cjs tools/test-paf-prey-mind.cjs tools/test-paf-audio-settings.test.cjs
```

结果：**73 passed，0 failed，0 skipped**。覆盖 keyboard/mouse/touch 共用语义的纯逻辑、超旧 windTime 不自动攻击、quick tap release、repeat/release/pointer 去重、pause/settings 输入闸门、方向/相机、碰撞、猎物 evasion、音频和设置契约。

后半段明确边界：`t=0`、`0.25`、`0.5-1e-9` 不命中；满足几何时 `t=0.5`、`0.9`、`1` 可命中；`t=1+1e-9` 不命中。运行时 recover 不进入命中分支，浏览器另用 recover 期间紧贴的新猎物验证无捕获、分数不变。

全量命令：

```text
node tools/run-node-tests.cjs
```

结果：**94/94 个 Node 测试文件通过，0 failed；22 个 browser/CDP 测试文件 skipped**。这些 skip 没有计入通过；真实浏览器验收由下方独立 QA 命令完成，不以 skip 代替。

### 真实 Chrome 行为与视觉矩阵

执行：

```text
node tools/qa-paf-release-attack.cjs
```

结果：**18/18 browser checks passed，0 console/runtime errors，9 张最终截图**。结构化结果：[`qa-results.json`](./m3d-20261031-beta-paf-release-attack/qa-results.json)。使用本地真实 `index.html?version=beta&webgl=1&play-as-fox=1&pafqa=1` 和生产 PAF 场景；不是独立 fixture。

| 场景 | 按住/取消实测 | 松开与后半段实测 | 截图 |
|---|---|---|---|
| 1280×720 TPS 键盘 | 40 个固定步长及真实 rAF 后仍为 `wind`；记录 hold `phaseT=0.7667`，`score=0`、未捕获、预览和目标标记存在；keyboard repeat 无重武装 | 前半段 9 个采样均无伤害；首次捕获 `t=0.7142857`，一次攻击分数仅 `0→1`；quick tap 立即进入 lunge 且只结算一次 | `1280x720-tps-hold-prediction.png`、`1280x720-tps-after-release-catch.png` |
| 1280×720 FPV 鼠标 | 长按只瞄准，重复 mouse down 不重复攻击；预览和范围内目标环可见 | 前半段 6 个采样无伤害，首次捕获 `t=0.7142857`；重复 mouse up 后仍只结算一次 | `1280x720-fpv-hold-prediction.png`、`1280x720-fpv-after-release-catch.png` |
| 768×1024 TPS 键盘 | 35 个固定步长保持 `wind`，无捕获，预览存在 | 首次捕获 `t=0.7142857`，`scoreDelta=1` | `768x1024-tps-hold-prediction.png`、`768x1024-tps-after-release-catch.png` |
| 390×844 触控（DPR2） | 真实 CDP touch 长按保持 `wind`，无伤害，预览存在；aria 为“扑击：按住瞄准并显示范围，松开扑击” | 前半段 9 个采样无伤害，首次捕获 `t=0.7142857`；quick tap 只攻击/结算一次；touch cancel 后 stale touchend 保持 idle | `390x844-touch-hold-prediction.png`、`390x844-touch-after-release-catch.png`、`390x844-touch-cancel-cleanup.png` |

取消/清理也在真实页面通过：暂停、设置面板打开和 window blur 都把预备取消为 idle，后续 release 不发招且分数不变；退出后 PAF/HUD 和场景预览对象数为 0，重进 PAF 的预览对象数仍为 0。暂停前后渲染内存几何计数均为 714，场景预览对象数为 0；代码路径对 capsule、材质和目标环逐一 dispose。

预测时间语义：标记表示当前瞄准时刻、目标保持静止且释放后路径/垂直条件不变时的真实后半段命中区域；释放后猎物自主移动造成的变化不算预测错误。预览本身不会修改 score/猎物 caught 状态，区域外目标也不会被预览捕获。

### 提交、范围与剩余限制

- 本轮实现/QA/证据本地提交：`084eb91cec8b7fd2112ecfed70ff41a04b382eb6`（`fix(beta-paf): unify pounce prediction and release QA`）。
- 本报告为随后的 documentation-only 本地提交；最终 HEAD 由交付回复列明。
- 改动仅限 PAF 输入/共享扑击逻辑、PAF 运行时、相关 Node/真实浏览器 QA、测试和 outputs。未修改 `src/main.js`、SmartFox、rig/动画、public shell、版本戳、Caddy/systemd 或其他工作树；stable/dev 未改。
- 浏览器渲染器为 **WebGLRenderer / ANGLE Vulkan SwiftShader (Subzero)**，即软件渲染；未验证硬件 GPU 或物理手机。触控为 Chrome 移动仿真和真实 CDP touch 事件。
- 早期失败的 `qa-results-partial.json` 仅为调试过程产物，不作为通过证据、未 stage；最终 `qa-results.json` 才是本轮结果。
- `git diff --check` / staged diff check 通过；`.codex-lock.d/` 与 `.codex-cli-write.lock` 保留且未 stage。push、PR、deploy 均未执行。
- 主控独立复核尚未执行，本报告不宣称主控验收已通过。

## 2026-11-01 本轮触屏 / FPV / 扑击预览修复

本节取代此前“松开即销毁预览”和“wind 禁止移动”的记录。本轮唯一工作区为 `/home/fame/code/marmot3d/m3d-beta-paf-input-20261030`，分支 `fix/beta-paf-input-20261030`，启动 HEAD 为 `c3d017601541155336813848edf239662cf5d96d`。启动时的 `.codex-cli-write.lock`、`.codex-lock.d/` 及旧 `outputs/m3d-20261031-beta-paf-release-attack/qa-results-partial.json` 均保留且不 stage；没有 reset/clean/stash。指定任务板 `/home/fame/.openclaw/tasks/marmot3d/active/m3d-20261030-beta-paf-input.md` 在本机不存在，未创建替代任务板。RUN 目录可读写。

### 审计与前后行为

实现前已审计 PAF 主循环、输入适配、相机/扑击纯函数、共享 TouchControls/TouchLayout、PAF debug、`styles.css`、现有 PAF Node 测试和浏览器 QA。基线 PAF 聚焦测试为 **73 passed / 0 failed / 0 skipped**；它们未覆盖本次多指、俯仰、移动蓄力和持续预览缺陷。审计记录见 `outputs/m3d-20261101-beta-paf-touch/audit.json`。真实页面修复前截图与输入轨迹保存在该目录的 `baseline/`，不是人工 fixture。

| 用户要求 | 原行为 | 本轮行为 |
|---|---|---|
| 按住与松手后的范围 | 黄色实体 3D capsule，只有 wind 可见，松手立即 dispose | `#9fd8ff` / opacity `0.28`；wind 随角色和朝向移动，释放锁定起点，lunge 与完整 recover 保留，返回 idle 才移除并 dispose；命中和落空共用同一生命周期 |
| 实际几何 | capsule 只表达水平包络，未裁掉腾空高度不允许命中的部分 | 朝向相关的前向扫掠区域；从后半段路径生成，使用实际严格水平半径、地形、腾空高度和垂直窗口裁剪，填充区每个网格顶点与三角中心都须通过同一个捕获谓词；保守网格略去边缘，不扩大半径 |
| FPV 触屏视角 | 右拖回调反号、pitch 丢失，wind 自动回正对抗手势；移动方向与视线分离 | 修正 yaw 符号并接入 pitch；触屏 FPV 的身体/前进朝向跟随 look，摇杆横轴继续坦克转向，纵轴前后移动；wind 不抢手势，腾空仍按锁定路径飞行，look 指持有时允许自由观察 |
| 静止准备噪声 | wind 与腾空共用 `17m / 1.5` 最高噪声 | 静止 wind 使用独立 `hearRadiusPrepare=0.9m`、`noiseCoefPrepare=0.12`，并钳到潜行参数的一半以内；默认潜行为 `3m / 0.45`。实际位移速度 `<0.02m/s` 才属于静止准备；移动 wind 与 lunge 保留 `17m / 1.5`，冲刺保留 `9m / 1.0`，恢复沿用潜行/冲刺档 |
| 按住不中断移动 | drive 和 steering 只允许 idle | idle、wind 都使用同一坦克式 drive；攻击 pointer 只控制 charge；释放时取当前有效朝向与当前位置，速度仍为原 `13.5m/s`、腾空 `0.42s`，没有继承额外加速、扩大半径或冻结角色 |
| cancel/blur/退出 | 普通 releaseAll 可能先提交攻击；兼容 pointerId 与 touch identifier 可能误撞；普通暂停遮罩可遮住 PAF | PAF 路由独立接收取消回调；仅 PAF 的 Touch Events 路径忽略兼容 pointer 结束事件；取消不会提交；blur/hidden 清空键和触控，退出先取消再恢复路由；PAF CSS 按真实 `.overlay` 类隐藏普通暂停遮罩 |

静止准备仍可被猎物视觉感知，不等于隐身。移动准备和实际扑击没有获得安静奖励。预览是目标保持当前位置时的预测，目标随后自主移动/逃跑会改变结果；填充区域没有强制捕获副作用。范围在 recover 中保留作为本次攻击覆盖的回顾，recover 不再执行捕获。目标高亮在恢复期隐藏，已捕获目标不继续显示标记。

### 改动文件与边界

- `src/core/paf-input.js`：修正触屏 yaw/pitch 接线，PAF cancel 与兼容 pointer 隔离守卫随路由启用/还原；无输入时不重复叠加非零 yaw。
- `src/core/paf-pounce.js`：样式、生命周期、方向性水平包络、地形填充网格；实际捕获与填充预览共用 `pafPounceCatchSample` / `pafPounceCatchSampleHits`，内部保持既有 `canCatch` 严格半径/垂直窗口与固定后半段时间窗口。
- `src/core/paf-noise.js`：PAF 专用静止准备噪声策略和对既有感知积分器的参数适配，不修改共享 predator-prey/SmartFox 逻辑。
- `src/core/touch-controls.js`：可选 cancel 回调与 PAF 路由的 pointer 命名空间守卫；没有 PAF 路由/取消回调时仍走原普通模式 release 回调。
- `src/play/play-as-fox.js`：移动蓄力、释放方向、FPV 手势、预览生命周期/固定 GPU 缓冲复用、取消清理、PAF 专用遮罩 CSS、只读 QA 状态。桌面键鼠的方向选择、hold/release、repeat 去重和 wind 相机回正语义保留。
- `src/play/play-as-fox-debug.js`：显示与实际相同的噪声半径；攻击辅助线改为有朝向的水平包络，填充区另通过垂直判定；增加静止准备参数说明。
- `tools/test-paf-touch-contract.cjs`：8 个新增测试，覆盖静止/移动/腾空噪声、几何/垂直裁剪、生命周期、非零朝向 fallback、实际 TouchControls 三角色并行/取消/还原和普通模式兼容。
- `tools/qa-paf-touch-input.cjs`：独立私有 Chrome/CDP + 本地静态服务，真实生产页面多指事件、键鼠、自然追猎及截图/错误/事件轨迹。
- `tools/qa-paf-release-attack.cjs`：原 quick-tap 断言改为新规格的“飞行和恢复期预览仍在，完成后消失”，捕获/一次计分断言保留。该旧脚本有 teleport/静止猎物 fixture，本轮不执行它作为通过证据。
- 本报告及 `outputs/m3d-20261101-beta-paf-touch/`：本轮审计、基线、最终截图与 JSON。

未修改 TouchLayout、全局 `styles.css`、`src/main.js`、index-public.html、public shell、version stamp、dev、SmartFox、Caddy 或 systemd。没有 push、PR、deploy 或线上配置操作。没有降低画质、限帧、跳渲染或修改猎物速度/捕获半径来促成通过。

### 确定性验证

所有 9 个修改/新增 JS/CJS 文件逐一 `node --check` 通过，0 失败。精确文件清单及结果：`/home/fame/codex-runs/m3d-20261030-beta-paf-input/touch-syntax-final-20261101.log`。

```text
node --test tools/test-paf-input-route.cjs tools/test-paf-pounce.cjs tools/test-paf-camera.cjs tools/test-paf-entry.cjs tools/test-paf-rock-collision.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs tools/test-paf-evasion.cjs tools/test-paf-prey-mind.cjs tools/test-paf-audio-settings.test.cjs tools/test-paf-touch-contract.cjs
81 passed, 0 failed, 0 skipped

node tools/run-node-tests.cjs
95/95 Node test files passed, 0 failed; 22 browser/CDP test files skipped
```

22 个 skip 不计入通过。日志在 RUN 的 `touch-focused-final-20261101.log`、`touch-node-final-20261101.log`。共享接线回归在真正的 TouchControls 类和最小 DOM 桩上驱动 touchstart/move/end/cancel，并确认恢复普通 controller/回调后，普通取消和 releaseAll 仍发原有 release；PAF 兼容 pointer 结束事件不能释放同号的另一根 touch。

### 最终真实页面验收

执行命令：

```text
node tools/qa-paf-touch-input.cjs
PAF_CANCEL_ONLY=1 PAF_RELEASE_QA_PORT=8398 CDP_PORT=9498 node tools/qa-paf-touch-input.cjs
```

结果：主矩阵 **20/20 passed**，补充最终代码上的 pointer identity / cancel **2/2 passed**，合计 **22 个浏览器检查通过、0 失败**。主矩阵日志：`/home/fame/codex-runs/m3d-20261030-beta-paf-input/touch-browser-final-20261101.log`；补充日志：同目录 `touch-cancel-final-20261101.log`。

证据目录：`outputs/m3d-20261101-beta-paf-touch/`。

- `after/qa-results.json`：主矩阵完整场景、计数、方向/速度/相机/噪声状态、渲染后端、错误与 80 条实际 CDP Input 命令；另记录页面收到的 62 条移动端及 2 条桌面原生 pointer/touch 事件。
- `cancel/qa-results.json`：补充最终取消验证，8 条 CDP 输入命令及 18 条页面原生事件。轨迹明确显示移动 native `pointerId=3` 的释放与攻击 Touch `identifier=3` 同号，但攻击仍 held/wind；随后真实 `touchCancel` 产生 pointercancel 并清空全部角色和预览。单指取消的命名空间守卫另有 Node 测试，CDP touchCancel 本身只接受取消全部触点。
- `baseline/qa-results.json` 与 `baseline/*.png`：启动前行为和初步 CDP 轨迹；初版单指 touchEnd 参数随后依据浏览器实际 emitted 事件修正，最终矩阵使用被释放手指列表，不用初版 release 断言作为通过证据。
- `after/390x844-fpv-hold.png`、`after/390x844-fpv-release-in-flight.png`、`after/390x844-fpv-completed.png`：390×844 CSS px / DPR2 的真实 FPV 页面，分别为按住、松手腾空、完成。截图 PNG 为 780×1688；飞行截图 HUD 明确为“扑击！”，范围仍可见，完成图不再有范围。
- `after/390x844-tps-hold.png`、`after/390x844-tps-release-in-flight.png`、`after/390x844-tps-completed.png`：同窄屏真实 TPS 对照。
- `after/1280x720-natural-catch-preview.png`：正常游戏追猎成功截图。只使用实际 CDP 键盘输入潜行/冲刺、转向和松手扑击；没有 teleport、猎物位置/速度修改、强制命中或半径调大。真实 score 从 0 到 1，首次记录成功时为 `lunge` 且预览 active；随后完成恢复为 idle / preview=false。

主矩阵还验证：三指并行；蓄力移动位移与可见朝向一致；真实相机 world direction 与 yaw/pitch 一致；上下左右 look、−55° pitch 下界和夹紧后立即反向；松开摇杆不释放攻击；仅松开攻击后摇杆与 look 保留；释放后的实际路径速度保持 13.5m/s；静止准备与移动/腾空噪声；落空的完整清理；blur、暂停与退出重进无 held pointer/preview 残留；桌面键盘和鼠标 hold/release 不回归。新 quick-tap 规格没有削弱捕获和一次计分断言。

两次运行均为 **0 console errors、0 Runtime exceptions、0 非预期 HTTP errors**。静态服务不提供后台 API：主矩阵记录 4 个预期 404，补充运行记录 2 个预期 404，均只涉及 `/api/configs/active` 和 `/marmot3d-beta/api/auth/guest`，完整响应保存在 JSON 中，没有隐去或当作资源成功。

渲染后端均为 **WebGLRenderer / ANGLE Vulkan SwiftShader Device (Subzero)**；移动端 `maxTouchPoints=5`，桌面 `maxTouchPoints=0`。这是私有 headless Chrome 的软件渲染和触控仿真，不是物理手机。主服务/CDP 为 8397/9497，补充服务/CDP 为 8398/9498；未连接共享 18800。终审 `ss` 确认四个自管端口均无监听，未剩余私有 Chrome 进程，脚本删除了各自临时 profile。`git diff --check` 通过。

中间追猎策略未抓到猎物及初版方向断言的失败记录保留在 RUN；最终运行仅修正 QA 输入策略和左拖方向预期，游戏参数与断言要求没有放宽。本轮需求没有剩余未实现项；下方是环境验证限制。

### 剩余限制

物理手机、多指触控硬件及硬件 GPU 未验证；Chrome 触控仿真和 SwiftShader 软件渲染不能作为真实手机或硬件 GPU 通过。范围采用保守的离散地形网格和 65 个有效时间采样，因此边缘略有阶梯/内缩；没有扩大真实攻击范围。猎物模型截图中的“仅几何（贴图不可用）”提示是本环境现有资源表现，本轮未改模型或渲染预算。

独立浏览器与静态服务由脚本创建、关闭；私有临时 profile 删除。最终交付仅本地提交，提交 SHA 在交付回复中给出。主控独立验收未执行，不宣称已获主控验收。
