# m3d-20261025-beta-paf-fpv-k3 · Stage 1 验收报告

扮演藏狐：第一人称视角 + 狐狸/土拨鼠建模重做

- 实际使用模型：**`k3`**（即用户所说的 kimi-k3-pro，上游 api.kimi.com 真实 model id），
  经本地真 LiteLLM `http://127.0.0.1:4001/v1` 路由，reasoning effort high。全程未触发 fallback。
- 通道：beta ｜ 分支：`codex/beta-paf-fpv-k3-20261025` ｜ 基线：`origin/beta` = 1462c32
- commit：随本报告一同提交，message `feat(beta): 扮演藏狐第一人称视角+狐狸与土拨鼠建模重做（k3）`，
  hash 以 `git log -1` 为准。
- **未 push、未部署**（仅 JOB 本地 commit）。

## 目标对齐（fox-v2/PAF-IMPROVEMENT-PROPOSAL.md §4 D 组 + §6 风险）

- D1：废弃 `scale.y` 压扁 → 分组姿态混合（body 下移、后躯低于前躯、腿折弯、头略抬）。
- D2 一阶段：腿摆相位/步频随速度（1.6–3.4Hz 线性插值），慢行小幅、冲刺大幅；尾巴分段跟随。
- §6 遵守：不动 AI 藏狐线、不动实体共享层、新参数全部进 `PAF_DEFAULTS` + 现有 lil-gui 台（`?pafdebug=1`）。
- A/B/C/E 组（察觉/扑击对抗/体力/难度）**未越界**，留给行为线任务。

## 改动文件清单

| 文件 | 变更 |
|------|------|
| `src/entities/paf-fox-model.js` | **新建**。PAF 专属藏狐：尖吻、大而尖三角耳（深色耳尖）、蓬松三段尾（深色尾尖）、背灰腹白顶点色分层、眼周深斑、奶白颊/腹；姿态混合 idle/stalk/wind/lunge/dash/recover；`computePafFoxPose()` 纯函数导出；API 兼容 `group/root/body/head/muzzle/ears/legs/tail/setColor/setAnimState/update`，另加 `setHeadVisible`（FPV 用） |
| `src/entities/paf-mole-model.js` | **新建**。PAF 专属土拨鼠：圆胖躯干、短粗四肢、小眼睛、掘土大爪（宽掌+三爪）、细长两节尾、圆耳、背深腹浅顶点色；返回 THREE.Group（挂 `setMoleState/updateAnim`），wander/alert/flee 姿态可读差异（警觉立起露爪、逃跑低伏） |
| `src/core/paf-camera.js` | **新建**。相机纯函数（无 THREE 依赖）：`createViewModeState/enterFpvLook/applyLookDelta(pitch 夹紧)/dampLookToward(扑击柔和锁向)/tpsCameraPose(旧口径)/fpvCameraPose(眼位+离地钳制)` |
| `src/play/play-as-fox.js` | 接入：换用两新模型；新增 FPV 参数块进 `PAF_DEFAULTS`；`V` 键（capture 阶段拦截并 `stopImmediatePropagation`，避免主线 cameraView 串扰翻转普通模式视角）+ 触屏 `#pafView` 圆钮（沿用 `#pafBtns` 风格）切换；HUD 常驻 `#pafViewTag` 视角标识 + flash 反馈；FPV 下鼠标/右半屏拖拽自由视角（pitch -55°..+40°），视线与身体解耦；FPV 隐藏头部防糊屏；扑击 wind/lunge 期视线阻尼锁向扑击方向；TPS 分支逐字保留原追尾口径；QA 钩子加 `viewMode/look/toggleView/setViewMode/setLook` |
| `src/play/play-as-fox-debug.js` | 现有 lil-gui 台新增「第一人称 / FPV」文件夹（10 个参数滑块）+ 状态「视角」+ 工具「切换视角」 |
| `tools/test-paf-camera.cjs` | **新建** `node:test`：pitch 夹紧、yaw 环绕、眼位高度、离地钳制、视线/身体解耦、TPS 旧口径一致、切换往返无残留、扑击锁定无瞬移收敛（8 用例） |
| `tools/test-paf-models.cjs` | **新建** `node:test`：狐狸 API 契约、setColor、姿态两两不同且无 NaN、蓄力后躯下压/头抬语义、步频随速度、idle≠dash 腿摆、setHeadVisible；土拨鼠 Group 兼容（position/rotation/visible）、三态姿态差异（8 用例） |
| `tools/qa-paf-fpv-managed.cjs` | **新建** CDP 实测脚本（见下） |
| `outputs/paf-fpv-k3/` | CDP 证据：11 张截图 + `qa-result.json` + `model-viewer.html`（模型多角度检视页） |

只读未动：`procedural-fox.js`、`props_entities.js`、`tibetan-fox.js`、`fox.js`、`smart-fox*.mjs/js`、
`index-public.html`、`tools/public-shell.cjs`、`src/core/version.js`。无新依赖、无新资产文件。

## 验证命令与精确结果

```
node --check src/play/play-as-fox.js src/play/play-as-fox-debug.js src/core/paf-camera.js \
  src/entities/paf-fox-model.js src/entities/paf-mole-model.js \
  tools/qa-paf-fpv-managed.cjs tools/test-paf-camera.cjs tools/test-paf-models.cjs
  → 全部通过（逐个执行，均 exit 0）

node --test tools/test-paf-camera.cjs tools/test-paf-models.cjs
  → tests 16 / pass 16 / fail 0

node tools/test-procedural-fox.cjs   → procedural fox: all assertions passed
node tools/test-fox-pounce.cjs       → pass 8 / fail 0
node tools/test-fox-tuning.cjs       → pass 7 / fail 0
node tools/test-fox-vitals.cjs       → pass 9 / fail 0
node tools/test-fox-tactics.cjs      → pass 10 / fail 0

node tools/qa-paf-fpv-managed.cjs    → 21 通过 / 0 失败（outputs/paf-fpv-k3/qa-result.json）
```

## CDP 实测（Chrome 147.0.7727.137）

本机直接新起 Chrome 在此环境会因子进程僵死挂起（GPU 进程初始化卡住），故按环境适配
连接已有自动化 Chrome（`http://127.0.0.1:18800`），`Target.createTarget` 开独立标签页、
测完关闭，不影响其它标签；`PAF_QA_CDP=off` 可回退自起 headless。

- 渲染后端（实测检测）：**WebGL2**（ANGLE / Mesa Intel Iris Xe，OpenGL 4.6，硬件渲染，非软件）。
- 证据截图（`outputs/paf-fpv-k3/`）：
  - `01-tps-default` / `02-tps-dash`：默认第三人称，新藏狐（尖耳、大尾、深色尾尖）可辨认；
  - `03-fpv-default` / `04-fpv-body-turned`：FPV 无糊屏无穿模；身体 A 键转向而视线不动（解耦）；
  - `05-fpv-look-down`：FPV 低头可见自身躯干（头部隐藏），无"摄像机在模型内部"糊屏；
  - `06-fpv-after-pounce`：扑击后 FPV 稳定（相位 wind→lunge→recover 完整推进、视线连续无 NaN）；
  - `07-back-to-tps`：V 键切回，HUD 标识复位；
  - `08-marmot-closeup-tps`：新土拨鼠（圆胖、大爪、圆耳）近景可辨认；
  - `09/10-narrow-touch-*`：窄屏 420×800 触屏仿真，「视角」圆钮可见、点击切换、FPV 高亮反馈；
  - `11-reenter-tps`：Esc 退出后重进，视角复位第三人称（无残留状态）。

## 遗留问题

1. 共享自动化 Chrome 存在前台竞争（其它任务线也在用），QA 脚本已用 reactivate + 游戏内时间
   探针规避；单点 wall-clock 计时类断言在该环境下不可靠，已从套件中移除（由转向+相位硬证据替代）。
2. 触屏 FPV 自由视角（右半屏拖拽）已通过仿真环境验证接管逻辑，但真实触屏手感未实测。
3. 狐狸模型为程序化低多边形风格，与场景整体风格一致；若后续要更强辨识度可考虑
   毛簇 InstancedMesh（tibetan-fox.js 的 addGuardHair 手法，本阶段未做）。
4. 底部提示条与旧有 HUD 文案在窄屏下轻微重叠（基线已存在，非本次引入）。
