# m3d-20261025-beta-paf-improve — Stage 2 报告

## 目标

让「扮演藏狐」尽可能复用普通土拨鼠模式的操作方案，触屏优先：同一套共享触屏控件、同一份布局与疾跑内圈设置、同一套玩家键位方案；退出后普通模式完整恢复。

实现与 CDP 证据 commit：`902a0171607411e23f0d9c0460e9bc3637c8fd89`（`902a017`）。本报告另作本地文档提交。

## 改动文件

- `src/core/paf-input.js`（新增）：纯摇杆映射、键位方案/默认键兜底、触屏蓄力相位、`TouchControls` 输出路由快照与恢复。
- `src/play/play-as-fox.js`：删除自建 `#pafTouch/#pafStick/#pafBtns/#pafSprint/#pafPounce`；接入唯一共享 `TouchControls`；无意义动作按钮与布局入口在藏狐模式临时隐藏，退出逐项还原；攻击键短按/长按蓄力、下蹲与百分比反馈；键盘走 `Keybinds` 并保留原默认键；HUD 提示按有效输入模式切换。
- `src/main.js`：仅在藏狐进出接线、共享触控 active/touch-playing 条件及防止土拨鼠键鼠动作双份的守卫处改动。普通模式未新增监听器、几何体或逐帧几何计算。
- `src/play/play-as-fox-debug.js`：`PAF_DEFAULTS.pounceMaxCharge` 接入既有 `?pafdebug=1` lil-gui「扑击」面板。
- `tools/test-paf-input-route.cjs`（新增）：7 项纯 `node:test`。
- `outputs/m3d-20261025-beta-paf-improve-stage2/`：CDP 可复跑脚本、结构化结果与 6 张截图。

未改 `keybinds.js`、`touch-controls.js`、`touch-settings.mjs`、`touch-layout.js`、`styles.css`、HTML、版本戳、AI 藏狐实体线、服务器/部署文件；未引入依赖或资产。新输入模块只由懒加载的藏狐模块导入，普通土拨鼠玩家不加载它，也不加载调试台。

## 操作口径

- 共享摇杆 `y → throttle`，`x → -turn`；使用与普通模式一致的 0.14 径向死区、归一化和 `TouchControls.sprintThreshold`。推过内圈持续疾跑，拉回内圈恢复潜行；`fox.stalk = !fox.sprint`，二者互斥。察觉半径仍读取既有 `detectSprint` 等配置，未改数值。
- 共享攻击键：短按松手仍经过原 `windTime` 前摇后扑出；持续按住可延长 wind 蓄力，松手扑出，达到 `pounceMaxCharge=1.2s` 自动扑出。保留下蹲（0.72）和 HUD 百分比反馈；原位移、捕获窗口、后摇不变。
- 键盘攻击/移动/转向/疾跑优先 `Keybinds.isAction()`；Space、左键、Shift、W/S/A/D 与方向键继续兜底。鼠标灵敏度按普通 `controller.sensitivity / 0.0022` 比例跟随；项目没有另一项独立用户鼠标灵敏度设置。
- 路由进入/退出均先 `releaseAll()`；保存并恢复 controller、动作回调、迎击/翻滚回调、触控启停和摇杆状态，不新建第二个 `TouchControls`。

## 验证命令与精确结果

### JS 语法

```bash
node --check src/core/paf-input.js
node --check src/play/play-as-fox.js
node --check src/play/play-as-fox-debug.js
node --check src/main.js
node --check tools/test-paf-input-route.cjs
node --check outputs/m3d-20261025-beta-paf-improve-stage2/run-cdp.cjs
```

结果：**6/6 通过，0 失败**。`git diff --check` 亦通过。

### 指定既有契约

| 命令 | 结果 |
|---|---|
| `node tools/test-touch-layout.js` | 通过；输出 `all assertions passed`（脚本未打印断言总数） |
| `node tools/test-graze-grid.mjs` | **10/10 通过，0 失败** |
| `node tools/test-fox-pounce.cjs` | **8/8 通过，0 失败** |
| `node tools/test-fox-tuning.cjs` | **7/7 通过，0 失败** |
| `node tools/test-fox-vitals.cjs` | **9/9 通过，0 失败** |
| `node tools/test-fox-tactics.cjs` | **10/10 通过，0 失败** |

指定 fox 契约合计 **34/34 通过**。

### 新增纯逻辑与补充回归

```bash
node --test tools/test-paf-input-route.cjs
```

**7/7 通过，0 失败**。覆盖死区/倒置/归一化、阈值与互斥、短按/长按/最长蓄力相位、自定义键位命中和默认键回落、连续三次路由进出及当前启停状态恢复。

```bash
node tools/test-touch-pointers.cjs
node tools/test-touch-drive.cjs
node --test tools/test-touch-layout-cards.test.cjs
node --test tools/test-paf-pounce.cjs tools/test-paf-evasion.cjs tools/test-paf-prey-mind.cjs
```

结果：前两项均 `all assertions passed`；layout cards **5/5**；Stage 1 PAF 纯测试合计 **35/35**，全部 0 失败。

## 本地静态 HTTP + Chrome CDP（真实移动触摸模拟）

复跑命令：

```bash
node outputs/m3d-20261025-beta-paf-improve-stage2/run-cdp.cjs
```

环境：本地静态 HTTP `127.0.0.1:8332`；托管 Chrome `147.0.7727.137`，CDP `127.0.0.1:18800`；`Emulation.setTouchEmulationEnabled(maxTouchPoints=5)` + Android 移动 UA + 移动视口，触摸输入使用 `Input.dispatchTouchEvent`。覆盖 390×844、360×740、刷新、普通模式真实布局编辑/保存、连续进出 3 次。

结构化结果：`outputs/m3d-20261025-beta-paf-improve-stage2/cdp-results.json`；最终 **`pass=true`，14/14 检查通过，浏览器异常 0**。

关键实测值：

- 普通模式拖动摇杆到 `(140,640)`、缩放 1.25、阈值 0.70 并保存；藏狐模式仍为 `(140,640)`、宽 140px、阈值 0.70，读写同一 `marmot.touch-layout.v1`。
- 藏狐共享 `#touchControls` 为 `block`，摇杆和攻击键可见；无 `#pafStick/#pafBtns`，其它动作和布局入口隐藏。
- 斜向输入 `throttle=0.4200`、`turn=-0.5`，潜行且实际 z 位移为正、yaw 右转；0.98 行程触发疾跑且 HUD 显示「冲刺（易被发现）」；拉回 0.40 恢复潜行。
- 攻击键按住约 500ms 仍为 wind，`chargeHeld=true`、下蹲 scale 0.72、HUD 有蓄力百分比；松手进入 lunge。短按同样经过前摇进入 lunge。
- 按住攻击时退出再松手，普通 controller/动作按钮文案/编辑入口/阈值均恢复，pointer role 为 0；普通实玩摇杆与疾跑环再次实测并复位。连续进出 3 次均干净。
- 360×740 刷新后缩放 1.25、阈值 0.70 和布局存档保持，路由重新干净建立。

截图：

1. `01-marmot-custom-layout.png`
2. `02-fox-shared-layout.png`
3. `03-fox-sprint-ring.png`
4. `04-fox-charge-hold.png`
5. `05-marmot-restored.png`
6. `06-narrow-refresh.png`

均位于 `outputs/m3d-20261025-beta-paf-improve-stage2/`；已人工查看共享布局、蓄力反馈、普通恢复及窄屏截图。

### 渲染后端（实际检测）

- backend：**WebGL2**
- GPU：**ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)**
- acceleration：**硬件加速**
- `navigator.gpu` 可用不等于本次使用 WebGPU；本次 renderer 明确不是 WebGPU，也不是软件渲染。

## 遗留问题 / 说明

- 产品功能无已知阻断遗留。藏狐内不开放布局编辑入口（避免拖动控件与实玩输入争抢），但同一份既有布局完整生效；普通模式编辑态已实测不受影响。
- 旧 `tools/qa-paf-stage1.cjs` 的 narrow 场景仍查询本 Stage 按要求删除的 `#pafStick/#pafTouch`，因此未把它作为 Stage 2 浏览器通过条件；未删除或弱化该旧脚本。Stage 1 的指定 Node 契约及补充 PAF 纯测试均通过，Stage 2 新 CDP 已覆盖替代触屏口径。
- 首次 CDP 脚本两处时序（上一后摇未结束就短按、标题态测普通实玩摇杆）已修正并完整重跑；最终报告仅采用第二轮全绿结果，未改产品断言来制造通过。
- 未使用 fallback 模型，未进行模型切换。

## 提交与边界

- 实现/证据 commit：`902a0171607411e23f0d9c0460e9bc3637c8fd89`
- commit message：`feat(beta): 扮演藏狐操作兼容普通模式（触屏复用共享布局+键位跟随）`
- 工作树原有的 `.codex-lock/` 未跟踪、未提交。
- **未 push、未部署**；未改 Caddy/systemd/线上文件，未改其它通道工作树。
