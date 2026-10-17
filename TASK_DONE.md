# feat/tps-drive 完成说明

## 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `src/core/move-facing.mjs` | `resolveTouchDrive` 新增 `thirdPerson=false` 入口参数与 `cameraYaw` 输出字段；第三人称分支：屏幕摇杆方向经当前 cameraYaw 旋转成世界方向（`wx=cos·x+sin·y, wz=sin·x−cos·y`），bodyYaw 即时取 `atan2(wx,-wz)`，cameraYaw 同步，throttle=min(1,mag)，dead zone 0.14 保留；后拉自然映射 cameraYaw+π，不走 U-turn。第一人称分支一字未动（默认 false，旧调用/旧单测兼容）。`classifyMoveFacing` / `thirdPersonStrafeTarget` / `firstPersonStrafeTarget` 未动。 |
| `src/core/controls.js` | 触屏驱动调用处传 `thirdPerson: this.thirdPerson`；第三人称下消费 `drive.cameraYaw` 同步 `this.yaw`（镜头与身体同转）；第一人称路径不变。`moveX/moveZ` 口径未改。 |
| `src/sandbox/panel.js` | 新增并导出 `SANDBOX_TOUCH_ACTIONS`（7 个：refill / clearStress / charge / resetFood / spawnOne / spawnGroup / clearFoxes）；启动时创建 `#sandboxTouchLayer` 浮动按钮层（挂 body，全部带 `data-sandbox-action`，非编辑态点击走原 `onAction`）。测试面板侧栏内的原按钮与迎击练习等开关全部保留。 |
| `src/ui/touch-layout.js` | 新增 `SANDBOX_ACTIONS` / 标签 / 尺寸；统一用 `ALL_IDS` 管理战斗键 + 沙盒键（id 互不冲突）；沙盒按钮默认竖排于屏幕左侧摇杆上方（横屏为摇杆右侧一行，避开摇杆/编辑入口）；`defaultLayout` / `_normalize`（旧存档自动补沙盒默认值）/ `apply` / 选中 / 尺寸+透明度 / 拖动全部覆盖沙盒键；设置下拉分「战斗动作 / 沙盒控制」两组；新增幂等的 `collectSandboxButtons()`，供面板晚于布局构造时补绑（按钮编辑绑定抽成 `_bindButton`）。 |
| `src/main.js` | `setupSandboxPanel(...)` 之后调用 `touchLayout.collectSandboxButtons()`（不改任何函数签名 / onAction）。 |
| `styles.css` | `.sandbox-touch-layer` 样式：默认隐藏，`body.sandbox-active` 或 `body.touch-layout-editing` 时显示；按钮复用 `--touch-button-size/scale/opacity` 变量，编辑态虚线轮廓、选中实线、拖动高亮。 |
| `tools/test-tps-drive.cjs` | 新增纯 Node 验收测试（不启动浏览器），见下。 |
| `index.html` | 未改：核查后其中没有任何沙盒按钮（沙盒按钮全部由 panel.js 生成），战斗键的 `data-touch-action` 标记一个未动。 |

## 测试结果

- 新增 `tools/test-tps-drive.cjs`：**OK 107/107**
  - A 部分（真实导入 `resolveTouchDrive`）：
    - `{thirdPerson:true,x:1,y:0}` → bodyYaw≈π/2、cameraYaw≈π/2、throttle≈1；
    - `{x:0,y:1}` → bodyYaw≈0、cameraYaw≈0；
    - `{x:.7,y:.7}` → bodyYaw≈π/4、cameraYaw≈π/4、throttle=推杆距离；
    - 横推左、镜头转 90° 后各方向、后拉掉头(±π)、连续两帧横推、dead zone、throttle 线性/截断；
    - 第一人称回归：横推仍按 2.7 rad/s 连续转 bodyYaw、纯横推油门 0.82、后拉 U-turn 保留、默认（不传 thirdPerson）行为不变。
  - B 部分（最小 DOM 桩实例化真实 `TouchLayout` + `setupSandboxPanel`）：
    - 战斗键 7 个、沙盒键 7 个全部接管且 id 不冲突；沙盒默认位置在左侧且高于摇杆、纵向不重叠；
    - 面板晚于构造创建浮动层后 `collectSandboxButtons()` 正确补绑；
    - 编辑态点击沙盒键→选中并拦截点击（不触发 onAction），非编辑态点击透传 onAction；
    - 鼠标拖动改位置、单键尺寸/透明度变量生效、设置面板含两组选项、旧存档（仅战斗键）载入后保留自定义值并补齐沙盒默认值。
- 纯 Node 可跑的既有测试全部通过：**OK 8/8**（test-combat-realism / test-cooldown-overlay / test-feedback / test-move-facing / test-multi-burrow / test-procedural-fox / test-underground-burrow / test-tps-drive）。
- `node --check` 通过：`src/core/move-facing.mjs`、`src/core/controls.js`、`src/sandbox/panel.js`、`src/ui/touch-layout.js`、`src/main.js`、`tools/test-tps-drive.cjs`。

## 已知遗留 / 风险

1. **第三人称后拉为即时掉头**：按任务实现要点（U-turn 分支只在 `!thirdPerson` 走，bodyYaw 即时取 atan2、cameraYaw 同步），后拉现在瞬时转到 cameraYaw+π（语义上仍是“朝镜头后方掉头”），没有旧模型的平滑阻尼。若实测觉得 180° 跳变突兀，可只在 `controls.js` 消费侧对 cameraYaw 加阻尼（目标值口径不变），不需要改本任务测试。
2. **第三人称推杆时镜头与身体同转**：未推杆时右侧拖动视角仍可自由环视；一旦推杆，镜头立即回到身体正后方，这是“滑向哪跑向哪 + cameraYaw 同步”要求的直接结果。
3. `tools/test-combat-wheel.cjs` 在基线提交 `7e504e2` 上就已失败（它 import 的 `selectAttackMove` / `selectAttackMoveFromInput` 已在上一笔 combat-wheel 重构中移除，现 API 为 `selectChargedMove` / `rollDirection`）。按任务约束未改 `src/core/combat-wheel.mjs` 及其测试，留给负责战斗轮盘的下一位。
4. 22 个 CDP 测试（test-action-layout 等）本环境按任务禁令未启动 Chrome，浏览器截图验证由外层完成。
5. 沙盒浮动按钮在沙盒进行中常驻屏幕（桌面也显示，等价于过去侧栏按钮的快捷入口）；侧栏「测试工具」面板内的同一套按钮保留，鼠标调试不受影响。横屏极低高度下 7 个竖排默认位可能被安全区夹紧，用户可在编辑模式自行排布（与战斗键既有行为一致）。
