# Beta rev20 UI/显示类 bug 修复报告（8 项）

分支 `codex/beta-uifix-20261024`，基线 `e52d8cd`（release/beta-rev20）。共 9 个 commit（`38226c5`..`d329583`）。
自测：所有改动文件 `node --check` 通过；`node tools/run-node-tests.cjs` **OK 44/44**（22 个浏览器/CDP 测试按惯例 SKIP）。
未 push、未部署、未 bump shell 戳（`?v=rev20` 不动，并有测试锁定）、未起浏览器、未装依赖、无新增构建步骤、无 `alert()`、localStorage 全部 try/catch。

## 1. 网页标题显示当前版本
- 根因：代码从未设置 `document.title`。
- 改动：`src/core/version-mode.mjs:18` 新增纯函数 `documentTitleFor(version)`（beta→`土拨鼠大作战 3D · Beta`，dev→`… · Dev`，stable→`null` 不动静态标题）；`src/main.js:451` 启动时按结果设置，stable 分支不触碰标题，保证 stable 不被污染。
- 自测：`tools/test-version-title.cjs` 3 项断言通过。

## 2. 设置面板显示 GPU/后端/是否硬件加速
- 改动：新增 `src/core/gpu-info.mjs`（纯函数 `readGpuInfo(renderer)`/`isSoftwareRenderer`，经典 WebGLRenderer 走 `WEBGL_debug_renderer_info` 的 `UNMASKED_RENDERER_WEBGL`，WebGPURenderer 家族走 `backend.isWebGPUBackend`/`adapter.info`；SwiftShader/llvmpipe/software/Microsoft Basic Render Driver 判软件渲染；任何异常 fail-soft 为"不可用"）。
- `src/ui/settings.js:210` 新增"图形 / 渲染"只读区（`gpuInfoProvider` 为 null 时整块不渲染，stable/dev 零风险）；`src/main.js:2433` 注入 `() => renderer`（复用既有渲染器，不建第二个 context）。
- 样式用 inline（避免 styles.css 的 `?v=` 缓存戳导致线上不可见，见 commit `068081d`）。
- 自测：`tools/test-gpu-info.cjs` 4 项（独显/软件渲染/异常不抛/WebGPU 家族）。

## 3. 伤害飘字更小
- 改动：`src/systems/effects.js:236` `DAMAGE_TEXT_FONT_SIZE` 34→26。
- 说明：改动前 34px 粗体数字在 1280 宽桌面上占比偏大、窄屏更抢眼；26px 约为原 76%，桌面与窄屏都更克制。`damageTextCanvasSize`/`estimatedDamageTextWidth`/`_texture` 均引用该常量，随动无需改；全库无残留写死的 34（`grep` 确认）。
- 自测：`tools/test-damage-text-size.cjs`（FOV 补偿与画布尺寸断言）在套件中通过。

## 4. HUD 单卡片 X/Y 数字输入
- 改动：`src/ui/touch-layout.js`：
  - 纯函数 `normalizedToPercent`（:117）/ `percentToNormalized`（:127，非法→null、越界 clamp、5 位小数取整消除浮点尾巴）；
  - `setCardPositionPercent(id,x,y)`（:598）走与拖动相同的 `_safeCardCenter` 安全区夹紧，内部仍存 0..1；
  - 触屏版 `settingsMarkup`（:625）与键鼠版 `keyboardSettingsMarkup`（:648）都加 X/Y number 输入（0–100%）；
  - `bindSettings`（:677）input 120ms 防抖 + change 即时应用；`_syncEditor`（:771-776）负责行显隐与数值同步（拖动/恢复默认经 apply→_syncEditor 自动刷新；正在输入的框不打断）。
- 现有拖动/不透明度/摇杆/动作按钮逻辑未动。
- 自测：`tools/test-touch-layout-cards.test.cjs` 新增 3 项（换算/非法输入/往返一致）通过。
- 不确定点：本树不存在任务提到的 `_cardEditorHtml` 符号（行号/符号已漂移），实际编辑面板是 `settingsMarkup`/`keyboardSettingsMarkup` 两分支，已按要求保持两者一致。

## 5. 设置里显示当前版本号
- 改动：`src/core/version.js:35` 新增 `export const BUILD_STAMP = 'rev20'`（与 index-public.html 现有 `?v=rev20` 一致，未升戳）与 `CHANNEL_SHORT`；`src/ui/settings.js:373` 版本区顶部只读行"当前版本：Beta · rev20"。
- 构建戳只在 beta 显示（stable/dev shell 本无 `?v=` 戳，避免把 beta 戳显示到 stable）。
- 自测：`test-version-title.cjs` 断言 public shell 只有一个戳且与 BUILD_STAMP 相等。

## 6. 视角切换键可重绑
- 改动：`src/core/keybinds.js`：ACTIONS 新增 `{ id:'cameraView', label:'切换视角', type:'system' }`；COMPAT/OPTIMIZED 默认 `KeyV`（自定义旧存档经 `{...COMPAT, ...data.custom}` 自动补 KeyV）；describe()/findConflicts/重绑 UI 自动生效。
- `src/main.js`：删除硬编码 `e.code==='KeyV'`，改 `binds.isAction(e.code,'cameraView')`（:2251，仍仅 play 态）；`viewBtn.title` 用 `viewKeyLabel`+`refreshViewKeyHint()`（:371-379，`syncHelpKeys` 里随绑定刷新，:2660）；帮助面板 `<kbd>V</kbd>` 改 `keys('cameraView','V')`（:2714）；标题页"按 V 切换"改 `bindText(binds,'cameraView','V')`（:1141）。
- `src/ui/settings.js:286` 顺带修复：空绑定一律显示"鼠标左键"的旧逻辑仅限 attack，其他动作未绑定时显示"—"（否则旧自定义存档缺新动作会误标）。
- 触屏 viewBtn 行为不变；外接键盘走同一 keydown 路径。
- 自测：`tools/test-keybind-cameraview.cjs` 4 项（动作定义/双方案默认/冲突检测/改键与恢复默认）。

## 7. 暂停面板可收起、保持暂停
- 改动：`src/main.js`：暂停面板新增"收起面板（保持暂停）"按钮（:1336），点击仅 `hud.hidePanel()`，`game.mode` 保持 `'pause'`，并 `showPauseMini()`（:1287）创建顶部悬浮"已暂停 · 点击继续"按钮（inline 样式，原因同上）；点击=resume()。
- `hidePauseMini()` 在 resume/title/finish/retryLevel/startPlay/pause 全部调用（:1050/1125/1258/1276/1317/1353），切关/重试/回标题/死亡结算均清理，无 DOM/监听泄漏（控件自身随元素移除）。
- 键盘暂停键（P/Esc）与 Enter 在收起态走既有 `mode==='pause' → resume()` 分支；触屏暂停按钮原本被 `isActive()` 拦住，`src/core/touch-controls.js` 给 pause 动作开口子、main.js onAction 改为暂停/恢复切换（commit `d329583`）。
- 设置/帮助面板逻辑未动：设置打开时不重复暂停（isPlaying 为 false），关闭不误恢复。
- 自测：静态推演 + `node --check`；无纯函数可抽（DOM 逻辑），真机 CDP 复核留给主代理。

## 8. 避难洞标签穿透岩石
- 改动：`src/world/props.js` `buildBurrowLabel`：`depthTest:false→true`，保留 `depthWrite:false`，并移除 `renderOrder = 20` 置顶。
- 确认全库仅此一处构建避难洞标签（grep `buildBurrowLabel`/临时避难洞），狐狸血条、交互提示等有意常显的 sprite 未动。
- 遗留：未做真机验证；若个别角度标签被地形整体挡死，最小补救是"仅被实体遮挡时隐藏"（保留 depthTest:true，把标签 y 位置微抬或给地形参与遮挡的阈值），但按任务要求优先直接验证 depthTest:true。

## stable/dev 零回归保证
- 标题：stable 返回 null 不触碰；dev 仅加后缀。
- GPU 信息/版本行：设置面板为通用组件，三通道均渲染且 fail-soft；beta 戳只在 IS_BETA 显示。
- cameraView/暂停收起/卡片输入/伤害字号/标签深度均为通用行为修复，不改变任何 IS_BETA 专属数据分支；keybinds 对 stable/dev 仅新增一个默认 KeyV 动作（此前 V 在 stable/dev 也是硬编码生效，行为等价）。
