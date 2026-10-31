# TASK DONE — fix/touch-intent-corrections：按用户原意纠正触屏/攻击/沙盒功能

分支：`fix/touch-intent-corrections`（基线 `release/beta-rev2` @ `6a5d855`）
仅代码与测试改动；**未部署、未 push、未 commit**（外层审查提交）；未启动 Chrome/CDP、未下载依赖。

---

## 1. P0：第三人称相机与移动摇杆彻底解耦

- `src/core/move-facing.mjs`：`resolveTouchDrive(..., thirdPerson:true)` 仍把摇杆屏幕向量按
  **当前 cameraYaw** 换算成世界方向、即时设置 bodyYaw，但 **cameraYaw 原样回传**，删除
  `nextCameraYaw = nextYaw` 的同步逻辑与文档中“镜头始终在身后”的错误描述。
- `src/core/controls.js`：第三人称 touch-drive 分支删除 `this.yaw = drive.cameraYaw`
  （含 touchLookActive 条件版）；第三人称下镜头 yaw 只可能由 `#touchLookZone`
  （`TouchControls._applyLook`）或键鼠视角改变。左摇杆移动/转身与右手指针环视是两根独立
  pointer，Pointer + Touch/X5 双轨与 pointerRoles 按 identifier 隔离的结构原样保留。
- 第一人称行为未改（油门+连续转向/U-turn/touchLookActive 抑制回弹全部保留）。

## 2. P0：攻击只有三种招式（推击/迎击/扑击）+ 右滑翻滚

`src/core/combat-wheel.mjs` 整体重写，对外只表达 push/parry/pounce/roll：

- `ATTACK_MOVES = ['tap','stand','lunge']`（推击/迎击/扑击），删除短刺/中刺/重刺命名、
  三档蓄力升级、`selectHoldMove`、`TAP_MAX_MS/SHORT_HOLD_MAX_MS/MID_HOLD_MAX_MS`。
- 松手结算 `resolveAttackRelease({holdMs, sprinting, fired})`：
  已触方向招式 → null；**奔跑中**按住 ≥ `POUNCE_HOLD_MS`(650ms，沿用旧重刺手感) → 扑击；
  其余一切（点按、非奔跑长按）→ 推击，不存在第四种攻击。
- `AttackGesture`：左滑 `dx ≤ -22`（PARRY_DRAG_THRESHOLD）且水平主导
  （`|dx| ≥ 1.1|dy|`，GESTURE_HORIZONTAL_RATIO）→ 当帧返回 `{kind:'parry'}`；
  右滑 `dx ≥ +22`（ROLL_DRAG_THRESHOLD）同条件 → `{kind:'roll'}`。
  `fired` 闩锁：一次按住最多触发一个方向招式、各自只触发一次；事件带 pointerId/dx/dy。
- `src/core/touch-controls.js`：新增构造参数 `onRollGesture`；攻击拖动跨阈时分别回调
  `onParryGesture/onRollGesture`；松手 data 带 `fired/parried/rolled/holdMs`。
- `src/main.js`：`attackCharge.parried` 改为 `attackCharge.fired`（null|'parry'|'roll'）；
  `triggerParryGesture` 只认当前蓄力 pointerId；新增 `triggerRollGesture(ctx)`（同样校验
  pointerId/闩锁），立即 `doRoll({moved:true,dx,dy})`，方向经既有 `screenToWorldDir`
  相对相机换算，一次按住只滚一次；两者触发后松手都不补招。右侧独立翻滚键保留、未新增翻滚按钮。
- 提示条/文案：攻击提示条改为 **推击/迎击/扑击**，高亮随 sprint+按住时长变化；
  `index.html` 攻击键 aria-label、帮助面板简表与长说明、`main.js` 动态帮助（syncHelpKeys）
  与沙盒迎击练习提示全部改为真实语义；`src/core/config.js` 的 `charge` 配置只留
  `heavyHold`（奔跑扑击阈值）并修正注释；viewmodel/main 中“重刺/中刺/扑咬”玩家招式注释改 正
  （内部动画 id tap/stand/lunge/dodge 保留兼容）。

## 3. P1：摇杆“疾跑触发范围”可调（真实内圈大小）

- 新增 `src/core/touch-settings.mjs`：`SPRINT_STICK_THRESHOLD=0.78`、范围 0.55–0.95、
  `clampSprintThreshold`。
- `src/core/touch-controls.js`：删除硬编码常量，改为实例 `sprintThreshold` +
  `setSprintThreshold(v)`（立即生效，已推杆时当场重算疾跑态）；疾跑判定与
  `#touchJoystick` 上的 CSS 变量 `--stick-sprint-radius = 阈值 × maxStick(48px)` 同源；
  不改变外圈位置、最大行程与移动速度。
- `src/ui/touch-layout.js`：删除 `STICK_CORE_DEFAULTS` 与装饰内圈滑块/持久化；
  布局数据 `joystick = { sprintThreshold }`，设置面板新增“疾跑触发范围 (55-95%)”滑块，
  拖动即时回调 TouchControls 并写入既有 `marmot.touch-layout.v1`；恢复默认同步复位阈值。
  旧存档缺字段补 0.78，旧 `joystick.coreSize/coreOpacity` 字段直接忽略。
- `index.html`：删除 `<span class="stick-core">`；`styles.css` 删除 `.stick-core` 整段，
  `.stick-sprint-ring` 改为按 px 变量定径（fallback 37.44px=0.78×48）。
- `src/main.js`：TouchLayout 构造后 `setSprintThreshold(layout...)` 并接 `onSprintThreshold`。

## 4. P1：只让现有「沙盒控制」按钮可调，浮动按钮全删

- `src/sandbox/panel.js`：删除 `SANDBOX_TOUCH_ACTIONS`、`setupSandboxTouchLayer()`
  及浮动层创建；`#testPanel` 内原有沙盒工具（无敌/计时/迎击练习/生成狐狸等）原样保留。
- `src/ui/touch-layout.js`：可调整集合由“7 战斗键 + 7 浮动沙盒键”改为
  “7 战斗键 + 1 个 `sandboxControl`”，元素即 index.html 既有的 `#testModeBtn`
  （沙盒中文字“沙盒控制”，点击照常开/关 `#testPanel`）；删除 `collectSandboxButtons()`。
  编辑态可拖动/调大小/透明度（捕获阶段拦截点击，非编辑态完全透传原 onclick）；
  默认位置与旧 CSS（左下）一致；非 test/沙盒时按钮仍 `hidden`，仅布局编辑时由
  `body.touch-layout-editing #testModeBtn{display:inline-block}` 临时显示以便调整。
- `src/main.js` 删除 `collectSandboxButtons()` 调用；`styles.css` 删除
  `.sandbox-touch-layer*` 全部规则，新增 `#testModeBtn` 的布局变量/编辑态样式。

## 5. P1：迎击练习复位崩溃（SANDBOX-1）

- 新增 `src/sandbox/drill.js`：纯函数 `drillRespawnPose({px,pz,yaw,dist})`（坐标必须在
  setTimeout 之前捕获）与 `resetDrillFox(f)`（hp/maxHp、state='roam'、knockbackVX/VZ、
  leap 清零）。
- `src/main.js scheduleDrillReset()` 不再引用未定义变量 `p`，350ms 后稳定复位
  血量/状态/击退速度。

---

## 改动文件

| 文件 | 说明 |
| --- | --- |
| `src/core/move-facing.mjs` | TP 摇杆不回写 cameraYaw，注释改正 |
| `src/core/controls.js` | TP 分支删除 `this.yaw = drive.cameraYaw` |
| `src/core/combat-wheel.mjs` | 重写：推击/迎击/扑击 + 右滑翻滚手势闩锁（水平主导、左右互斥） |
| `src/core/touch-settings.mjs` | **新增** 疾跑阈值常量/clamp（0.55–0.95，默认 0.78） |
| `src/core/touch-controls.js` | onRollGesture、可调疾跑阈值、档位环 px 同源、松手 fired 数据 |
| `src/ui/touch-layout.js` | 删浮动沙盒键/摇杆装饰内圈；加 `#testModeBtn` 调控与疾跑阈值滑块 |
| `src/sandbox/panel.js` | 删除浮动层与 SANDBOX_TOUCH_ACTIONS |
| `src/sandbox/drill.js` | **新增** 迎击练习复位纯 helper |
| `src/main.js` | 三招语义、onRollGesture/triggerRollGesture、提示条文案、阈值接线、drill 修复、帮助文案 |
| `src/core/config.js` | charge 只留 heavyHold（奔跑扑击阈值），注释改正 |
| `src/systems/viewmodel.js` | 玩家招式注释“扑咬”→“扑击” |
| `index.html` | 删 stick-core；攻击键 aria/帮助文案改正确语义 |
| `styles.css` | 删 stick-core/sandbox-touch-layer；sprint-ring 按 px 变量；testModeBtn 可调样式 |
| `tools/test-combat-wheel.cjs` `tools/test-attack-parry.js` `tools/test-tps-drive.cjs` | 按新语义/新沙盒结构重写 |
| `tools/test-touch-pointers.cjs` `tools/test-sprint-threshold.cjs` `tools/test-drill-reset.cjs` | **新增** |

## 测试结果

- `node --check`：src 下全部 .js/.mjs 与改动/新增测试文件通过。
- `node tools/run-node-tests.cjs` → **OK 15/15**（22 个 Chrome/CDP 用例按环境约束 SKIP，由外层设备/浏览器验证）：
  - `test-touch-drive.cjs` PASS（第一人称跑圈/U-turn 不回归）
  - `test-move-facing.cjs` PASS
  - `test-tps-drive.cjs` PASS（70 项：TP 各方向 cameraYaw 恒不变、controls.js 静态契约、
    FP 不回归、沙盒唯一入口 #testModeBtn 的接管/点击透传/拖动/尺寸透明度/旧存档兼容/源码静态检查）
  - `test-combat-wheel.cjs` PASS（三招集合严格 3 个、非奔跑长按仍推击、奔跑 650ms 扑击、
    左右阈值/闩锁互斥/水平主导、rollDirection）
  - `test-attack-parry.js` PASS（左滑迎击一次不补招、右滑翻滚一次不补招、±21/±22 边界、斜向不触发）
  - `test-touch-pointers.cjs` PASS（Touch/X5 路径：look/move/attack 三指角色互不顶替、
    右手 look 持续有效、attack 手势只认本 pointerId、touchLookActive 松手与 releaseAll 复位、
    阈值实时调整与 clamp、档位环 px=阈值×48）
  - `test-sprint-threshold.cjs` PASS（默认 0.78、clamp、旧存档补默认/忽略装饰字段、
    持久化、恢复默认、阈值两侧 sprint 判定、环半径 26.40/37.44/45.60px、CSS fallback 一致）
  - `test-drill-reset.cjs` PASS（正前方坐标/NaN 防御/狐狸血量状态击退清零/源码不再引用 p）
  - `test-touch-layout.js` PASS（调整开关门控+自动暂停不回归）
  - 其余既有：combat-realism、cooldown-overlay、feedback、multi-burrow、procedural-fox、underground-burrow 全 PASS。
- `git diff --check`：通过（无空白错误）。

---

## 调查项答复（本轮只调查、未实现）

### A. 可选狐狸作为玩家角色：当前不存在

- `?procfox=1` 只在 `src/entities/fox.js:25-28` 切换**敌方狐狸**的程序化模型
  （另有 `?hififox=off`、dev 版 `?foxmodel=off` 也都只影响敌人外观）。
- 玩家第一人称是 `src/systems/viewmodel.js` 的土拨鼠爪子；第三人称玩家身体
  `src/main.js:273 buildMarmotMesh()`（`src/entities/props_entities.js:402`），也是旱獭。
- 全仓未发现角色选择 UI/设置项/URL 开关，未发现玩家狐狸的网格、移动/攻击动画切换。
  缺失清单（若以后要做）：玩家可选网格与第三/第一人称表现、狐狸步态/攻击动画映射、
  碰撞与相机参数复核、选择入口与持久化。本轮未实现。

### B. 技术栈（worktree 实测）

- 无 `package.json` / `tsconfig.json` / `vite.config.*`，无任何 `.ts/.tsx` 源文件，
  依赖中无 `@dimforge/rapier3d-compat`（全仓 grep 无 rapier）。
- 这是**原生 JavaScript ES modules 静态站点**：Three.js 本地放在 `vendor/`
  （three.module/core/webgpu/tsl），importmap 直引；有 glTF/GLB 资产与 GLTFLoader
  （`src/models/loader.js`）；dev/GS 路线用本地 three/webgpu，稳定路线 WebGLRenderer。
  未做 TypeScript/Vite/Rapier 迁移，也不建议在本轮引入构建。

### C. D 全程序 audit（`m3d-pull-cam-diag/PULL_CAM_DIAGNOSIS.md`，基线 7e504e2，24 条）现状

| 报告项 | 现状（本任务结束时） |
| --- | --- |
| CAM-1 P0 第一人称边跑边拉视角弹回 | `6a5d855` 已加 `touchLookActive` 抑制回弹与串扰；本轮未改该路径，测试保持通过。 |
| 第三人称摇杆同步带动镜头（用户本轮实际反馈，报告未单列） | **本轮已修**：move-facing 原样返回 cameraYaw，controls.js TP 分支不再写 this.yaw。 |
| SANDBOX-1 P1 迎击练习复位引用未定义 `p` | **本轮已修**（drill.js + scheduleDrillReset）。 |
| COMBAT-1 P1 迎击站定锁不住摇杆 | 当前 HEAD 复核**已锁定**：main 每帧 `controller.movementLocked = attackMoveLock>0`，controls.update 在并入 touchAxes 后清零 mx/mz/velocity（含摇杆与疾跑）。非本轮改动，已加注释说明。 |
| TOUCH-2 P1 移动端设置/帮助不暂停 | **仍在**：SettingsUI/helpBtn 开关面板不调 pause()（仅“进入布局拖动编辑”会自动暂停）。本轮未改。 |
| BOOT-1 P1 无 WebGL 探测/兜底 | **仍在**：稳定版 `main.js` 仍直接 `new THREE.WebGLRenderer(...)`，无 try/catch 与失败页。 |
| FEEDBACK-1 P1 反馈无 endpoint | **仍在**，详见下节。 |
| FOX-1/FOX-2 P1/P2 高保真敌狐无 LOD、无步态（约 27 万面/200+ draw call） | **仍在**，本轮未动；`?procfox=1/?hififox=off` 可手动对比。 |
| CAM-2/3/4/5/6/7、TOUCH-1/3、COMBAT-2/3/4、BURROW-1/2、FOX-3/4、CACHE-1 等 P2/P3 | 未在本轮范围内，未改，状态同报告。 |

### D. 用户反馈能否被看到：当前不能（未入 Marmot 服务器）

- `src/core/config.js:12` `FEEDBACK.endpoint = ''`；`src/ui/feedback.js submitFeedback()`
  在 endpoint 为空时只写入 localStorage 离线队列（key `m3d_feedback_queue`，上限 20 条），
  界面仍提示“已记录，感谢反馈”；没有重发/flush 逻辑，服务端无从读取。
- 任务书所述公网 `GET https://www.catten.cyou/api/feedback` 返回 401，且那是英文站的
  `/api/*` 路由，不是本项目的反馈接收端；本仓库也没有对应的服务端/Caddy 反馈路由配置。
  结论：截至核查，用户在游戏里提交的反馈只存在自己设备本地，**Marmot 服务器上看不到**。
  本轮按要求未改服务器后端与 endpoint。

## 未做事项与提醒

- 未部署/未 push/未 commit、未启动浏览器、未安装依赖；视觉与真机手感（22px 左右滑阈值、
  0.55–0.95 滑块手感、#testModeBtn 默认位置）请外层设备验证。
- 空文件 `tools/test-move-facing.cjs.new`（0 字节，基线遗留）不被测试运行器匹配，未处理。
