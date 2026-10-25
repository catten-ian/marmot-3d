# m3d-20261025-beta-viewbtn-adjust 验收报告

日期：2026-10-25

分支：`codex/beta-viewbtn-adjust-20261025`

基线：`1462c32d9f3d62e6897a88244b93d2eba8979bd7`

## 目标与结论

用户要求调整原有的 `#viewBtn`（第一/第三人称切换），支持位置、大小、透明度，而不是新增重复视角卡。

已完成并验收通过：

- 删除重复的 `#viewModeCard` / `hudViewMode`。
- 原 `#viewBtn` 接入 beta 既有布局系统，支持选择、拖动、单项缩放、透明度、X/Y 百分比和持久化。
- 正常态真实点击可切换视角；编辑态真实点击只选中，不切换视角；拖动路径保持可用。
- V 键的 `cameraView -> setViewMode` 路径未改动。
- 默认位在右上、设置键左侧；移动安全区位置保持不变，桌面端与设置键间距为 8px。
- 文案宽度不冻结；旧存档中的 `cards.hudViewMode` 被安全忽略。

本次只补验收缺口，未重做前两次提交。最终视觉矩阵 **9/9 scenes passed，behaviorBad=0，pageErrors=0，consoleErrors=0**。没有未完成验收项。

## 提交

- `f930c1e` `fix(beta): 删除重复的视角状态卡 #viewModeCard（hudViewMode）`
- `574f79e` `feat(beta): 原视角按钮 #viewBtn 接入布局系统（透明度/大小/位置可调）`
- `f865a82` `fix(beta): 保持视角按钮实玩可点击`，包含本次行为修复、回归测试和最终视觉证据。

**未 push，未 deploy；未修改线上文件、Caddy 或 systemd。**

## 接入机制与本次根因修复

既有实现以 `CARDS` 中的 `hudViewBtn` 复用卡片的位置、缩放、透明度和持久化通路，并以 `BUTTON_CARDS` 区分按钮型卡片：不设置固定宽度或 `pointer-events:none`，默认位通过 `_measureCard()` 从 CSS 实测。beta 之外的渠道不接管此按钮。

本次诊断发现：退出编辑后，全屏开始/暂停 `.overlay`（`z-index:40`）位于普通 `#viewBtn`（`z-index:22`）之上，第一次点击实际落在遮罩而非按钮，因此三个视口的 `normalClickSwitchesView` 都为 false。

修复位于 `styles-beta-addon.css`：

- `body.beta-version:not(.touch-layout-editing) .view-btn` 使用 `z-index:50`，保证非编辑态点击直达按钮。
- 桌面 `@media (min-width:861px)` 下设置 `right:132px`，让按钮右缘与设置键左缘保留 8px。
- 移动端仍使用 `styles.css` 的 `right:calc(118px + var(--safe-right))`，不覆盖安全区规则。
- 编辑态 capture-phase 选中/阻止 click 和 pointer drag 逻辑不改，继续 select-only。

`src/ui/touch-layout.js` 仅同步层级说明注释；`tools/test-viewbtn-layout.cjs` 新增桌面位置及遮罩层级回归断言。

## 改动文件

前序功能提交：`src/main.js`、`src/ui/touch-layout.js`、`src/ui/view-mode-card.js`（删除）、`src/core/config-transfer.mjs`、`styles-beta-addon.css`、`tools/test-config-transfer.cjs`、`tools/test-viewbtn-layout.cjs`。

本次缺口提交：

- `styles-beta-addon.css`
- `src/ui/touch-layout.js`（注释）
- `tools/test-viewbtn-layout.cjs`
- `outputs/m3d-20261025-beta-viewbtn-adjust/capture-viewbtn-visual.cjs`
- `outputs/m3d-20261025-beta-viewbtn-adjust/visual/`（manifest 与 9 张截图）
- 本报告随后单独提交。

未触碰 `index-public.html`、`tools/public-shell.cjs` 的 `VERSION_STAMP`、`src/core/version.js` 的 `BUILD_STAMP`。

## 验证命令与真实结果

### JavaScript 语法

```sh
node --check src/main.js
node --check src/ui/touch-layout.js
node --check src/core/config-transfer.mjs
node --check tools/test-viewbtn-layout.cjs
node --check tools/test-config-transfer.cjs
```

结果：5/5 通过，全部 exit code 0，无输出。

### 新增 focused node:test

```sh
node tools/test-viewbtn-layout.cjs
```

结果：`tests 9`，`pass 9`，`fail 0`，`cancelled 0`，`skipped 0`，`todo 0`。

### 项目 Node 测试入口

```sh
node tools/run-node-tests.cjs
```

结果：`OK 55/55`，即可运行测试文件 55 passed / 0 failed。另有 22 个 browser/CDP 测试由项目 runner 按既有策略标记 SKIP，不计为失败。

### 最终视觉捕获

```sh
CDP_BASE=http://127.0.0.1:18800 node outputs/m3d-20261025-beta-viewbtn-adjust/capture-viewbtn-visual.cjs http://127.0.0.1:8231/index.html?version=beta outputs/m3d-20261025-beta-viewbtn-adjust/visual
```

真实最终输出：

```json
{
  "scenes": "9/9 passed",
  "behaviorBad": 0,
  "pageErrors": 0,
  "consoleErrors": 0
}
```

使用 managed Chrome `Chrome/147.0.7727.137`，通过 `http://127.0.0.1:18800` 创建独立 tab 并在结束后关闭；未启动额外 SwiftShader Chrome。manifest 生成时间 `2026-10-25T13:28:49.979Z`。

## 最终视觉矩阵

所有截图位于 `outputs/m3d-20261025-beta-viewbtn-adjust/visual/`。

| 视口 | 场景与文件 | 预期 / 实测 | 结果 |
|---|---|---|---|
| 390x844 | 默认 `390x844-1-default.png` | 右上、设置左侧、不裁切、无重复卡；view right=272，set left=280 | PASS |
| 390x844 | 调整 `390x844-2-adjusted.png` | opacity=.55、scale=1.2、中心=60%/18%，不裁切 | PASS |
| 390x844 | 编辑 `390x844-3-editing.png` | 选中描边；编辑点击不切视角；下拉含 `hudViewBtn` | PASS |
| 768x1024 | 默认 `768x1024-1-default.png` | view right=650，set left=658；同一行、不裁切、无重复卡 | PASS |
| 768x1024 | 调整 `768x1024-2-adjusted.png` | opacity=.55、scale=1.2、中心=60%/18%，不裁切 | PASS |
| 768x1024 | 编辑 `768x1024-3-editing.png` | 选中描边；编辑点击不切视角；下拉含 `hudViewBtn` | PASS |
| 1280x720 | 默认 `1280x720-1-default.png` | view right=1148，set left=1156；修正设置键左右关系 | PASS |
| 1280x720 | 调整 `1280x720-2-adjusted.png` | opacity=.55、scale=1.2、中心=60%/18%，不裁切 | PASS |
| 1280x720 | 编辑 `1280x720-3-editing.png` | 选中描边；编辑点击不切视角；下拉含 `hudViewBtn` | PASS |

行为矩阵：三个视口的 `editingSuppressedClick=true`、`editingActive=true`、`exitedEditing=true`、`normalClickSwitchesView=true`；退出编辑后的正常点击均使标签从“第一人称”变为“第三人称”。因此 `behaviorBad=0`。

完整数值、缩放/位置/透明度断言与错误数组见 `visual/manifest.json`。

## 渲染后端

- 实测 WebGL：`ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)`。
- WebGPU adapter：`no-adapter`；`backendTag` 为 null。
- 本次证据是真实页面 WebGL 渲染，不宣称 WebGPU，也未使用自行启动的 SwiftShader 浏览器。

## 未完成项 / 已知问题

- 本任务验收项均已关闭，无已知行为或视觉阻塞。
- 22 个独立 browser/CDP 测试未由 Node 总入口运行，状态为 runner 的既有 SKIP，不是本次失败。
- 未 push、未部署；线上 beta 不会因为本地提交自动更新。

## Codex 自评

保留既有功能提交，只修复了实际点击被遮罩拦截及桌面默认位置两个验收问题；使用真实 managed Chrome 重建全部 9 张截图和 manifest，未修改捕获断言、未伪造结果。Node 语法、focused 测试、项目 Node 入口均通过。
