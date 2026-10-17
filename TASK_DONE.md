# feat/dodge-consol — 翻滚键合并 + 调整键开关化 + 调整时自动暂停

## 改动文件清单

- `index.html`
  - 删除摇杆轮盘上固定的小翻滚键 `<button class="stick-dodge" data-touch-action="dodge">`（不可拖动调整的那个）。右侧动作栏大翻滚键保留，全页只剩 1 个 `data-touch-action="dodge"`。
  - `<html>` 增加默认属性 `data-touch-adjust-enabled="false"`，防首屏闪现调整键。
  - `#touchLayoutEntry` 增加 `data-touch-adjust="entry"` 标记。
- `styles.css`
  - 整段删除 `.stick-dodge` / `.stick-dodge b` / `.stick-dodge.pressed` 样式。
  - 新增 `[data-touch-adjust-enabled="false"] [data-touch-adjust] { display:none !important; }`：总开关关闭时隐藏所有调整键（画面编辑入口 + 设置里的 `.layout-actions` 按钮组）。
  - 新增 `body.touch-layout-editing #overlay { display:none !important; }` 与调整态 `z-index:41`：自动暂停后暂停面板不会盖住按键拖动。
  - 新增 `.touch-adjust-settings` / `.touch-adjust-toggle` 开关样式。
- `src/ui/touch-layout.js`
  - 新增 localStorage 开关：key `marmot.settings.touchLayoutAdjust`（`'1'`/`'0'`，默认 OFF），导出 `touchAdjustEnabled()` / `setTouchAdjustStored(on)`。
  - 新增 `setPauseHooks({pause,resume,isPaused})`、`setAdjustEnabled(on)`；构造时把开关状态同步到 `<html data-touch-adjust-enabled>`。
  - `setEditing(true)` 在开关关闭时被拒绝（强制回 false，且不触发暂停）；开关在编辑中被关掉会立即退出编辑。
  - `_startEditing()`：未暂停则调 `pause()` 并记住 `_pausedByEditor`；调整前已暂停则不重复暂停。
  - `_stopEditing()`：仅当暂停由本次调整发起时才调 `resume()`，否则保持原暂停态。
  - 删除关于摇杆固定 `.stick-dodge` 的过时注释；`ACTIONS` 中 `'dodge'` 保留（右侧大键仍可调整）；`settingsMarkup()` 的 `.layout-actions` 加 `data-touch-adjust="actions"`。
- `src/ui/settings.js`
  - 设置面板新增「触屏布局调整」区块与复选框「启用触屏布局调整」，change 时调 `touchLayout.setAdjustEnabled()`（持久化 + 可见性 + 编辑态联动）。
  - `close()` 时若正在拖动编辑则自动 `setEditing(false)`（点外部/完成关闭面板即退出调整并恢复游戏）。
- `src/main.js`
  - 构造后注入暂停钩子：`pause()` / `game.mode==='pause' 时 resume()` / `isPaused = game.mode!=='play'`，不改动既有 pause 按钮、ESC、失焦、pointerlock 暂停路径。
  - 键盘 Pause 动作（P/Esc）分支：若正在调整，优先 `setEditing(false)` 退出并恢复游戏。
- `tools/test-touch-layout.js`（新增）
  - 纯 Node（最小 DOM shim 加载 ESM）：静态校验（只有 1 个 dodge、无 stick-dodge、CSS/属性标记齐全）；默认 OFF 拒绝进入编辑且不暂停；ON 后进入编辑自动暂停、退出自动恢复；调整前已暂停则进出都不动暂停；编辑中关开关强制退出并恢复；持久化辅助函数。
- `tools/test-action-layout.cjs`
  - 既有 CDP 回归：进入 editing 的 setup 先 `window.__layout.setAdjustEnabled(true)`，适配新总开关（本环境无 Chrome，未实际执行，仅 node --check）。

## 测试结果

- `node --check`：src/main.js、src/ui/settings.js、src/ui/touch-layout.js、tools/test-touch-layout.js、tools/test-action-layout.cjs 全部通过。
- `node tools/test-touch-layout.js`：全部断言通过。
- `tools/test-*.cjs` 全量跑：通过 7 个（test-combat-realism、test-cooldown-overlay、test-feedback、test-move-facing、test-multi-burrow、test-procedural-fox、test-underground-burrow）。
  其余失败/超时在改动前的 pristine HEAD（`git archive` 到 /tmp 后）上结果完全一致，均为环境问题：本机无 Chrome/Edge（glb/models/fullscreen/gs/dev 等 CDP 用例）、需要本地服务器、以及 Node v24 下既有测试自身语法/导出漂移（如 test-attacks.cjs 模板串语法错误、test-combat-wheel.cjs `selectAttackMove is not a function`）。本次改动零回归。

## 已知遗留

- 浏览器内触屏交互与可视效果（开关隐藏/显示、拖动轮廓、暂停面板遮挡）未在本机用 Chrome 截图验证（任务禁止启动 CDP），仅做了静态/CSS 逻辑与 Node 层验证，截图由外层 view_image 完成。
- test-action-layout.cjs 按新开关更新但未能在本机实跑（无 Chrome）。
- 调整态下触屏暂停键的点击会被编辑器的选中逻辑拦截（调整中不触发 pause 动作）；退出调整后恢复正常，符合预期。
