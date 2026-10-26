# m3d-20261026-beta-touch-unify

## 架构说明

BETA 的 PAF 入口现在复用主页面唯一的 `TouchControls` 实例。进入 PAF 后由 `PafInputRoute` 暂时保存普通模式的 controller/callback，调用 `releaseAll()` 清空已有指针，再把同一实例的输出路由到 PAF：

- `touchJoystick` 的 `touchAxes` → PAF 前后移动与左右转向；摇杆疾跑阈值继续由共享 TouchControls 判定。
- `touchLookZone` → PAF TPS 身体转向，FPV 视角转向。
- 共享 `attack` 按钮 → PAF 蓄力扑击，按住开始蓄力、松手进入扑击流程。
- 共享 `dodge` 按钮 → PAF 冲刺（按住有效）。
- 共享 `jump` 按钮 → PAF 第三/第一人称切换。

退出 PAF 时先恢复路由前释放指针，再恢复普通 controller、攻击/迎击/翻滚回调和按钮文案。

## 冲突解决

删除了 PAF 的 `#pafTouch`、独立摇杆、独立按钮、独立视角拖动区及其全部监听和样式。PAF 只保留 HUD/退出按钮，触屏事件始终由共享 `TouchControls` 接收，因此同一时间只有一路触屏事件处理。按钮文案和 aria-label 在 PAF 进入时切换为“扑击/冲刺/视角”，退出时按快照恢复正常语义。改动位于 PAF 模块，stable/dev 不加载该模块；主 TouchControls 普通路径未改动。

## 证据索引

- `tools/test-paf-entry.cjs`：共享路由存在、`#pafTouch`/独立 PAF 控件不存在、PAF 入口和退出契约。
- `tools/test-paf-input-route.cjs`：路由切换、指针释放、controller/callback 恢复。
- `outputs/m3d-20261026-beta-touch-unify/visual/`：截图目录已创建；当前环境未提供可用的 Chrome 实例（本机 `google-chrome` 不可启动，现有 CDP `http://127.0.0.1:18800` 在 Runtime.evaluate 阶段超时），因此真机截图证据未生成。

## 测试清单

- `node --check src/play/play-as-fox.js`
- `node --check src/main.js`
- `node --check src/core/paf-input.js`
- `node tools/test-paf-entry.cjs`
- `node tools/test-paf-input-route.cjs`
- `node tools/run-node-tests.cjs`：`OK 76/76`，浏览器/CDP 测试按现有机制跳过 22 项。
- `git diff --check`：通过。

## 自评

共享 TouchControls 路由、PAF 专属动作映射、进入/退出清理和普通语义恢复已完成；键盘/鼠标路径保留。纯 Node 契约覆盖了路由生命周期和独立 DOM 删除。

## 遗留

需要在具备可用 Chrome CDP 的环境补采 390×844 触屏正常/PAF/退出、1280×720 桌面 PAF 和 stable 对照截图，并验证实际按住扑击按钮的动作时序。
