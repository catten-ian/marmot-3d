# Marmot3D dev E2E driven fixes report

日期：2026-10-31（本地工作树，未部署、未 push、未 commit）

本轮完成了诊断基础设施和启动/沙盒修复，但没有把任务标记为完成：移动实景仍约 1 FPS，四档角色素材尚未形成四套真实、角色来源正确的模型，默认矩阵在最终无 DPR 限制改动后尚未完整复跑。

## 已完成的代码修复

- `src/main.js`：进入沙盒复用启动期已经构建的 Verdant level-0 世界，重置可变状态、出生点和沙盒狐狸，避免重复重建整关；主循环保持每个 RAF 调用真实 `renderer.render(scene, camera)`。
- `src/ui/hud.js`：处理 loader video 的预期 `play()` 中断，避免 AbortError 冒泡；loader 隐藏路径保持 fail-soft。
- `src/models/loader.js`：加入按 active tier 的模型别名候选和原始源回退，保留本地包离线能力。
- `src/core/performance.js` 与 `src/main.js`：最终运行路径不再用移动 DPR、阴影或输入模式制造 FPS；实际 DPR 被保留，显式选择的 tier 不被设备条件替换。旧 `clampVerdantTierForDevice` 仅保留给既有纯函数测试，运行时不再调用它作隐式降档。
- 新增只读诊断工具 `tools/dev-diagnostics/probe.mjs`，以及 `tools/m3d-1080p-probe.mjs`；没有改动 `tools/e2e-smoke/`。

## 真实 WebGPU / WebGL2 A/B

浏览器由诊断工具自建，未使用共享 CDP 18800。Chrome 147、同一 Intel ANGLE GPU、同一 1920×1080 条件：

| 条件 | CSS viewport | DPR | drawingBuffer | backend | 主场景三角形 | idle / movement | console error |
|---|---:|---:|---:|---|---:|---:|---:|
| WebGL2 desktop | 1920×1080 | 1 | 1920×1080 | `webgl2` | 约 336,877 | 约 1.00 / 1.00 FPS | 0 |
| WebGPU desktop | 1920×1080 | 1 | 1920×1080 | `webgpu`，真实 adapter/device | 约 337,246–341,642 | 约 1.00 / 1.00 FPS | 0 |

证据：

- `outputs/dev-e2e-fix-evidence/diag-webgl2-desktop/summary.json`
- `outputs/dev-e2e-fix-evidence/diag-webgpu-desktop/summary.json`
- 对应 `screenshots/scene-idle.png` 和 `screenshots/scene-movement.png`

WebGPU 诊断的 `bootProbeOk=true`、`rendererStatus.backend=webgpu`；WebGL2 对照使用 `?webgl=1`，`bootProbeOk=false`、`backend=webgl2`。两者均报告硬件 ANGLE Intel 后端。结论是“移动约 1 FPS”不能归因为 WebGPU 不可用或 WebGL fallback；同一条件下两个真实后端都约 1 FPS，根因仍需继续隔离。

## 1080p 与移动证据

- 1920×1080 desktop 的 CSS 和 drawing buffer 都是 1920×1080，没有放大低分辨率画布。
- 390×844、DPR3、`mobile=true`、`maxTouchPoints=5` 的最终无 DPR 限制探针：
  - WebGPU：drawingBuffer 1170×2532，renderer pixel ratio 3，movement 约 1.16 FPS。
  - 位置在正确的 CSS 坐标 touch 探针下发生变化；先前使用设备像素坐标的探针曾导致位置不动，现已修正并记录。
  - 证据：`outputs/dev-e2e-fix-evidence/diag-webgpu-mobile-full-dpr/summary.json`。
- 真实截图显示了天空、地面、HUD、移动控件和沙盒场景；移动截图中可见大面积黑色地形缺口/低视角地面结构，仍需要视觉与几何根因修复，不能把当前 FPS 当作验收通过。

## 默认 E2E 功能回归

在最终 DPR 改动前，既有独立默认轮次均通过固定断言：

- desktop：`outputs/dev-e2e-fix-evidence/e2e-desktop-current/2026-10-31T03-11-23-487Z-local-desktop/run-result.json`，`pass=true`、loader gate true、console error 0、10 张截图。
- mobile：`outputs/dev-e2e-fix-evidence/e2e-mobile-current/2026-10-31T03-18-04-224Z-local-mobile/run-result.json`，`pass=true`、多触点 gate true、console error 0；该轮仍使用旧 profile 的 DPR clamp，因此不能代替最终无 DPR 限制复跑。

`node tools/run-node-tests.cjs` 最终结果：`OK 48/48`；其中 22 个 browser/CDP 测试按 runner 规则 SKIP，未冒充通过。所有已修改 JS/MJS 均通过 `node --check`，并通过 `git diff --check`。

## 未完成项 / 不宣称完成的原因

1. 移动有效实景 movement FPS 仍约 1 FPS，远低于 30 FPS；WebGPU 与 WebGL2 A/B 已证明这不是简单的“未选 WebGPU”。下一步必须继续单变量隔离 DPR、mobile metrics、touch 输入和 HUD/合成路径，同时保持每 RAF 真实渲染。
2. 视觉截图仍需逐张复核并修复移动截图中的黑色地形缺口/低视角问题。
3. `assets/models/tier-manifest.json` 当前仍是分档草稿；其中 high/ultra 的角色来源历史上存在错配，不能把同一模型冒充四档。必须补齐真实独立文件或明确缺失并完成运行时资源验收后，才可提交。
4. `index-public.html` 没有被修改。独立探针通过 `index.html` 验证了真实 WebGPU；默认 E2E 仍经 `index-public.html`，其报告中的 `available=true, selected=false` 不能被解释为 WebGPU 已测试。

因此本地树保留当前诊断和修复，未创建本地 commit，也没有 push/deploy。任务仍未闭环。

## 2026-10-31 continuation: controlled 15 FPS audit

本轮先复核了上一轮「1080p WebGL2/WebGPU 约 1 FPS」的测量口径。原始诊断探针使用 `?sandbox=1` 自动进沙盒，且 1920×1080 窗口超出物理屏幕内容区；同一页面的 `renderer.render()` 包装计时中位数约 2 ms，而 RAF 间隔稳定约 1000 ms。改为真实标题按钮点击、`Page.bringToFront`/`Target.activateTarget`/active lifecycle，并以 kiosk 全屏窗口重跑后，1080p 不再被 1 Hz 节流。诊断工具仍只读使用 `tools/e2e-smoke/`，只修正本任务新增的 `tools/dev-diagnostics/probe.mjs`。

受控结果（每轮单独 Chrome，单变量、同场景、同视角采样，未限帧、未跳渲染）如下：

| 轮次 | CSS / DPR / drawingBuffer | 输入/后端 | movement FPS | 主场景三角形 | console error |
|---|---|---|---:|---:|---:|
| `current-webgl2-desktop-kiosk` | 1920×1080 / 1 / 1920×1080 | WebGL2，真实点击 | 36.77 | 322,399 | 0 |
| `current-webgpu-desktop-kiosk` | 1920×1080 / 1 / 1920×1080 | WebGPU，`bootProbeOk=true`，真实 adapter/device | 31.51 | 322,768 | 0 |
| `current-webgpu-css390-dpr3` | 390×844 / 3 / 1170×2532 | WebGPU，CSS 移动尺寸、DPR3、无 Chrome mobile/touch scheduler | 26.49 | 319,246 | 0 |
| `current-webgl2-css390-dpr3` | 390×844 / 3 / 1170×2532 | WebGL2，CSS 移动尺寸、DPR3、无 Chrome mobile/touch scheduler | 29.56 | 322,399 | 0 |

以上四轮截图均逐张检查：天空、户外地面、草植、HUD、准星和沙盒角色可见，没有黑屏或空场景；截图路径分别在对应轮次的 `screenshots/scene-movement.png`。主场景没有通过 blanket 植被隐藏或降低 DPR 来取得 FPS。

同一 Chrome 147 headful 环境的严格 CDP mobile/touch 对照仍被浏览器仿真层节流：`current-webgl2-mobile-kiosk`（390×844、DPR3、`mobile=true`、`maxTouchPoints=5`）movement 约 1.08 FPS；`current-webgl2-mobile-keeptouch` 同样约 1.09 FPS；而把唯一变量改成 `mobile=false`/不启用 touch emulation、仍保持 390×844、DPR3 时为 29.56 FPS。`document.visibilityState` 始终为 `visible`，渲染计时没有对应的 1 秒工作量，说明该 1 Hz 是 Chrome mobile/touch 仿真调度伪影，不是应用渲染瓶颈。默认 mobile E2E 仍按固定工具复跑并通过所有既有 gates；其采样中的约 1 FPS 不能作为真实设备 FPS 结论。严格 mobile/touch 仿真 ≥15 的独立验收仍是当前环境 blocker，已如实保留。

## 本轮最终验证命令

- `node tools/dev-diagnostics/probe.mjs --webgl2 --output=outputs/dev-e2e-fix-evidence/current-webgl2-desktop-kiosk`
- `node tools/dev-diagnostics/probe.mjs --webgpu --output=outputs/dev-e2e-fix-evidence/current-webgpu-desktop-kiosk`
- `node tools/dev-diagnostics/probe.mjs --webgl2 --css390 --output=outputs/dev-e2e-fix-evidence/current-webgl2-css390-dpr3`
- `node tools/dev-diagnostics/probe.mjs --webgpu --css390 --output=outputs/dev-e2e-fix-evidence/current-webgpu-css390-dpr3`
- `node tools/e2e-smoke/run.ts --target=local --device=desktop --load-wait-ms=120000 --settle-ms=15000 --move-ms=10000 --output=outputs/m3d-20261030-dev-e2e-smoke-final`
- `node tools/e2e-smoke/run.ts --target=local --device=mobile --load-wait-ms=120000 --settle-ms=15000 --move-ms=10000 --output=outputs/m3d-20261030-dev-e2e-smoke-final3`
- `node tools/run-node-tests.cjs` → `OK 48/48`，22 个 browser/CDP 测试按 runner 规则 SKIP
- `node --check`：所有本轮修改 JS/MJS 通过
- `git diff --check`：通过

本轮新增应用修复：`src/core/touch-controls.js` 仅在触摸事件 `cancelable` 时调用 `preventDefault()`，消除 Chrome intervention 产生的 console error；默认 mobile E2E 现在 `noFatalPageErrors=true` 且 multi-touch gate 通过。四档角色素材仍未补齐，列为后续，不阻塞已验证的性能与输入修复。最终 30 FPS 仍是总目标；本轮以受控 15 FPS 桌面/移动显示指标达成，严格 Chrome mobile/touch 仿真验收待环境调度问题解除后独立复跑。
