# m3d-20261026-beta-admin-paf

日期：2026-10-26。工作树：`fix/beta-admin-paf-20261026`，基线 `17ca387`。

## 根因与修法

PAF Stage 2 合并把旧的独立 `pafTouch` 状态与已弃用的 `PafInputRoute` 片段同时留下，`src/play/play-as-fox.js` 在 `createPlayAsFox` 作用域重复声明 `touch`。浏览器动态 import 因 `SyntaxError: Identifier 'touch' has already been declared` 失败，入口 Promise 被拒绝，主界面继续运行土拨鼠路径。

修复为单一独立 PAF HUD 输入状态：移除弃用的 `PafInputRoute`/`touchRoute` 状态和每帧共享 TouchControls 映射，保留 PAF 自己的摇杆、冲刺和扑击按钮；PAF 键鼠监听、相机、HUD 与退出回调继续由 `play-as-fox.js` 管理。主线只增加 Beta 普通奔跑消耗读取，stable/dev 仍走 `1.6`。

## 数值变更与链路

- `BETA_TUNE.grazeImmediateShare`: `0.12 → 0.35`；后台按百分比显示 35%。
- `BETA_TUNE.mouthCapacity`: `36 → 120`；后台新增口中食物储备上限。
- 新增 `BETA_TUNE.runMoveCost = 0.8`；Beta 非疾跑移动消耗使用它，stable/dev 保持硬编码 `1.6`。
- 后台新增：疾跑/普通奔跑消耗、吃草移动倍率、口腔上限、即时转化率、吃草锥半角、咀嚼速率（站立/主洞/临时洞）、脂肪阈值、花朵生命/体力总量和回复时长。
- 运行时链路：`tuning-schema.mjs → serializeSavedConfig → runtimePayloadFromAdminConfig → POST /api/configs/active → fetchActiveBetaConfig → validateRuntimePayload（以 BETA_TUNE 为白名单）→ applyRuntimeValues(BETA_TUNE)`。

## 证据索引

- 后台总览：`visual/admin-beta-overview.png`；CDP 读数见 `visual/admin-paf-e2e.json`，包含全部 28 个 Beta 条目，默认 mouthCapacity=120。
- active 配置端到端：`visual/admin-paf-e2e.json`，POST mouthCapacity=240/runMoveCost=0.55 后，游戏运行时读到 240/0.55。
- PAF 修复后截图：`visual/paf-after-fix-enter.png`；退出截图：`visual/paf-after-fix-exit.png`；状态与错误：`visual/paf-after-fix-cdp.json`。
- 修复前对比：`visual/paf-after-click-before-fix.png` 与 `visual/paf-before-fix-console.json`，记录 SyntaxError 与仍留在土拨鼠界面。
- stable 基线截图：`visual/stable-root.png`（既有 stable 标题画面基线，未修改 stable 路径）。

## 测试

- 所有修改文件通过 `node --check`；`git diff --check` 通过。
- `node tools/run-node-tests.cjs`：`OK 76/76`，22 个需要 Chrome 的既有浏览器测试按 harness 规则 SKIP。
- 新增/更新纯测试：`tools/test-paf-entry.cjs`、`test-admin-tuning.mjs`、`test-runtime-config.mjs`、`test-stamina.mjs`、`test-beta-tuning.mjs`。

## 自评与遗留

自评：完成后台新增键、百分比/角度展示、active 配置运行时覆盖、Beta 数值调整和 PAF 入口修复；未修改 `src/world/scene.js`，`main.js` 仅改体力消耗行，未触及 backdrop/fog 区域。CDP 已验证 active 配置读数和修复前语法错误；共享 Chrome 在长时间模型加载下对自动点击状态有抖动，保留了独立状态 JSON 与截图证据。

遗留：未部署、未 push；未改 `index-public.html`、版本戳或 vendor。
