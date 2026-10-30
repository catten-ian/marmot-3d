# Marmot3D dev 审计问题修复与性能优化报告

日期：2026-10-30（Asia/Shanghai）
工作树：`/home/fame/code/marmot3d/m3d-dev-perf-fix-20261030`
分支：`fix/dev-perf-fix-20261030`；基线：`e8be6ce3ead635f8367288b49f6141b2b67d3353`
状态：源码改动及 Node 回归完成；浏览器沙盒基准和完整视觉矩阵受限，未将静态/不完整证据冒充验收通过。尚未 push、未部署。

## 1. 目标与验收条件逐项对照

| 目标 | 完成内容 | 未完成/限制 | 证据 |
|---|---|---|---|
| P1-a 静态支撑缓存、移动/dirty 失效、救援/跨层正确性 | Companion 静止帧复用已验证支撑；移动/dirty 时精确重验；失败回退上个安全点。保留 build-time bake，并让 baked recovery 优先用于初始化。 | 同环境 180 帧改后有效 RAF 样本与 5 秒 profile 未取得（见第 4 节）。 | `src/entities/props_entities.js`、`src/main.js`、`src/world/verdant-placement.mjs`；新增纯逻辑测试 38 assertions。与 `m3d-20261029-dev-mobile-placement` 的 build-time bake 互补，未回退 bake。 |
| P1-a 清隙正确且降成本 | XZ 均匀网格 broadphase + 保守 overflow；保留精确三角形 raycast narrow phase、Y 区间、各 ring probe，不用代理替换碰撞判定。 | 因浏览器目标进入 hidden 后 RAF 节流至约 1Hz，没能作有效桌面持续帧性能比较，未声称达成 30/60 FPS。 | `src/world/verdant-collision.js`；相关测试含跨层 component 和救援回退。 |
| P1-b 唯一纹理计数、auto 与预算一致、自动回退 | 纹理按 UUID/身份去重；auto 对未知/集显 WebGL2 保守降档；auto 失败显示提示并依次降档；low 仍失败则进入简化地图；手动模式仍保留失败/降档面板。 | 最终回退补丁之前，fresh auto target 选 medium 后超过 180 秒未完成，之后自动转 low 重试并最终显示‘Verdant 下载超过 180 秒’面板（低档按钮已禁用）。随后补上 auto-low 再失败时自动切至简化地图的路径并以纯逻辑测试验证；该最终补丁没有重新跑完整浏览器启动，因此当前 runtime ready 仍未确认。 | `src/core/memory-budget.mjs`、`src/world/verdant.js`、`src/main.js`；unique texture 测试。 |
| P2-1 parry 粒子颜色 | 将 parry 数值色显式转 `THREE.Color`，粒子入口归一化并测试实例色有限。 | 真实战斗触发后的截图/实机视觉未完成。 | `src/main.js`、`src/systems/effects.js`、`src/systems/particle-color.mjs`；38 assertions 中有限值检查。 |
| P2-2 sprint action-down | Keybinds 维护按键 down 状态；按当前绑定判定，blur 清状态；自定义映射可测。 | 浏览器真实键盘/触屏交互矩阵未完成。 | `src/core/keybinds.js`、`src/main.js`；action-down 默认/按下/松开/自定义绑定测试。 |
| P2-3 Food 共享资源 dispose | 只释放实体自有 geometry；缓存模型实例只释放每实例材质，不释放共享几何或纹理。 | 未执行浏览器多轮真实 GLB GPU 重建 soak。 | `src/entities/resource-disposal.mjs`、`src/entities/props_entities.js`；重复实例化-销毁逻辑模拟测试。 |
| P2-4 FPS/渲染统计 | raw RAF delta 与模拟 dt 分离；主场景统计在 render 后快照，viewmodel 分开显示并标明范围。 | 未做显示 FPS 与独立 CDP 连续样本的 ≤5% 精度验证。 | `src/main.js`，`window.__m3dLastMainRenderStats`。 |
| P2-5 UI/观察地图 | 冷却 DOM 引用缓存并仅变更时写入；sandbox panel 隐藏时不生成、可见时节流/差异更新；minimap 约 12Hz 更新并缓存输入对象。 | 屏幕阅读器 live-region 与各尺寸响应式矩阵未实测。 | `src/main.js`、`src/sandbox/panel.js`、`src/ui/minimap.js`。 |
| P3 Blob URL / DamageText | 外部 glTF 下载与 URL 生命周期纳入统一 finally 清理；DamageText LRU cap 96，活动引用避免提前驱逐释放。 | URL 中途失败注入、长时缓存 soak 未做。 | `src/world/verdant.js`、`src/systems/effects.js`。 |
| 语法/回归/提交与版本戳 | 已跑改动 JS/MJS `node --check`；Node tests 全通过；版本戳 diff 为空。 | 尚需 commit。 | 第 5、8 节。 |
| 180 帧性能、启动对照、截图矩阵 | low 与 auto 都有成功标题页记录；当前运行后端为硬件 WebGL2。 | 沙盒 180 帧有效测量、5s profile、完整矩阵截图与 manifest 未完成；启动耗时受隐藏页影响，auto 材质阶段后台暂停。 | 第 3–4 节及 `outputs/m3d-20261030-dev-perf-fix/`。 |

## 2. 实际可见行为与改动文件

- 静止 companion 不再每帧重复地面/清隙查询；移动或场景/传送 dirty 后重新精确验证，失败时维持上一安全位置。
- 自动档面对 unknown/integrated WebGL2 桌面选择保守 tier；失败后可见提示并降档重试；用户手动选档仍保留已有交互。
- parry 粒子颜色使用合法 Color；sprint 状态来自真实 down 状态；缓存模型几何不会被 Food 实例销毁。
- 统计区分 raw RAF FPS、主场景计数与 viewmodel 计数；冷却按钮、观察地图、沙盒面板减少重复 DOM/对象工作。
- 资源 URL 有统一清理路径，DamageText 缓存受限。

改动文件：
`src/core/keybinds.js`、`src/core/memory-budget.mjs`、`src/core/verdant-auto-fallback.mjs`、`src/entities/props_entities.js`、`src/entities/resource-disposal.mjs`、`src/main.js`、`src/sandbox/panel.js`、`src/systems/effects.js`、`src/systems/particle-color.mjs`、`src/ui/minimap.js`、`src/world/verdant-collision.js`、`src/world/verdant-placement.mjs`、`src/world/verdant.js`、`tools/test-dev-perf-fixes.cjs`。

## 3. 浏览器启动与性能证据

浏览器环境：本地服务 `http://127.0.0.1:8362/`、CDP `http://127.0.0.1:18800`。CDP 只操作本任务创建的 target。页面探针报告 `backend=webgl2`、`ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)`、`hardwareAccelerated=true`。因此证据是硬件 WebGL2，不是 WebGPU，也非软件渲染。

| 启动方式 | 结果 | Tier / texture estimate / JS heap | 说明 |
|---|---|---|---|
| 强制 low `?verdantTier=low&tos=0` | 47,633ms 后 ready=true、title、失败面板=false | low；96,818,517 bytes；used heap 50,354,834 bytes（总量 57,018,222） | `low-startup-verified.json`。端到端含加载、预计算、资源初始化，不应等同渲染耗时。 |
| auto 默认 `?version=dev&tos=0`（首次完成记录） | 24,239ms 后标题 ready；失败面板=false | medium；167,772,160 bytes；heap used 49,786,849 bytes | `auto-startup.json` 保存明确 tier/backend/probe，但此 target 在先前实验中运行，未作为当前源码的确定性 auto 验收。 |
| auto 当前源码 fresh target（最终 fallback patch 之前） | 210,669ms 探针时停在 `verdant-materials` 6/57；后续自动改用 low 后仍见失败面板，技术原因 `Verdant 下载超过 180 秒`、低档降档按钮 disabled | 首选 medium；失败阶段 estimate 96,818,517 bytes；探针 heap used 53,454,646 bytes | `auto-startup-fresh.json` + `auto-failure-inspection.json`。target 为 hidden，背景 video 收到 Chrome `AbortError`。之后已新增最终 auto-low→简化地图路径，但未对最终补丁重跑完整启动。 |

**内存取舍：**该 estimate 是依据贴图图像尺寸/格式的预算代理，不是真实 GPU 显存或精确设备内存。采用唯一 texture 身份去重降低重复引用造成的误拒绝，但对未知/集显仍保守降档；代价是画质可能低于硬件理论能力。当前没有真实 GPU/native 内存读数，不能声称显存精确估量或证明不存在 OOM 风险。

### Sandbox 性能对照

| 指标 | 改前审计 | 改后本轮 |
|---|---:|---:|
| mean / P50 / P95 / P99 / max | 164.4 / 156.2 / 225.8 / 259.8 / 287.3 ms | 未取得有效值 |
| >50ms 帧 | 180/180 | 未取得有效值 |
| 5 秒 CPU profile | Raycaster 链 self-time top：`getVertexPosition` 1470.0ms、`checkGeometryIntersection` 1333.1ms、`_computeIntersections` 1107.4ms、`intersectTriangle` 721.8ms | 未取得有效 profile |

尝试通过 CDP 进入沙盒并采样时，target 为 `document.visibilityState=hidden`；观测 UI 遥测显示 `1 FPS (RAF)`，而 180 帧采样无法在 10 分钟窗口内完成，之后取消了无效后台任务。该数不是有效的前台基准，故不填作改后值；未声称达成 P95 ≤33.3ms。`sandbox-hidden-observation.json`、`sandbox-measure-error.json` 与 `auto-failure-inspection.json` 保留了可复核状态。需在前台可见 target 重新运行同环境 180 帧与 5 秒 CPU profile。

## 4. 验证命令与结果

- `node --check` 对所有本次修改的 `.js`/`.mjs`：通过（逐文件执行）。
- `node tools/test-dev-perf-fixes.cjs`：`38 assertions passed`，含 auto tier failure 降档序列和 low 失败转简化场景。
- `node tools/run-node-tests.cjs`：`OK 47/47`；22 个 browser/CDP 测试按脚本约定跳过（需要 Chrome），非通过项。
- `git diff --check`：通过。
- `git diff -- index-public.html index.html`：空；boot/rev 版本戳未改。
- HTTP/CDP 环境探测：8362 与 18800 均返回 200。

## 5. 视觉/场景 × 尺寸矩阵

已从强制 low、标题已就绪 target 采集标题页四个尺寸：`title__320x568.png`、`title__390x844.png`、`title__1280x720.png`、`title__1920x1080.png`，并写入 `visual/manifest.json`；manifest 明确记录 backend=webgl2。启动页/沙盒/战斗特效尺寸截图本轮未完成，受浏览器 target hidden/后台节流影响；未将旧审计图片或不匹配本次源码的图冒充本轮证据。场景视觉和屏幕阅读器 live-region 行为仍需前台 CDP/人工验证。

## 6. 未完成项与已知问题

1. **P1-a 量化性能验收未完成**：改后 sandbox frame series/profile 无有效前台数据；可能的缓存命中纯逻辑测试通过，但真实 raycast 占比下降未测。复现：前台启动本地 dev 页面，进入沙盒，保留页面可见，再采样 180 RAF 和 5 秒 profile。
2. **P1-b auto 当前源码完整启动未能确认**：最终 auto 启动未能确认：最终 fallback patch 前 fresh target 在后台由 medium 超时后自动退 low，仍因 180 秒超时显示失败面板；已增加 auto-low 失败后进入简化地图，但未用浏览器重测最终 ready/提示。较早 ready-medium 记录不替代最终验收。
3. 启动耗时记录均受本地缓存、CDP 拦截或浏览器媒体策略影响，不外推线上 cold-cache/弱网体验。背景视频 AbortError 只在后台 target 观察到。
4. 启动页/沙盒/战斗特效截图矩阵、真实 parry/sprint 操作、触屏与屏幕阅读器验证未做；标题页四尺寸截图已保存在 `outputs/m3d-20261030-dev-perf-fix/visual/`。
5. Blob URL fault injection、DamageText 长时 LRU soak、重复 GLB dispose GPU/native 资源 soak、10–15 分钟 soak、实体弱网/手机/WebGPU、GPU query 精确计时均未做。
6. 自动降档 medium→low 在最后补丁前曾于后台浏览器观测到，但 auto-low 也失败并出现面板；现已添加 auto-low→简化地图的纯逻辑/代码路径，最终补丁的浏览器 ready/提示尚未实测。

## 7. 资源/证据目录

审计只读参考：`/home/fame/code/marmot3d/m3d-dev-perf-audit-20261029/outputs/m3d-20261029-dev-perf-audit-report.md`（第 4、5、7 节已对照）。本轮浏览器脚本与结果位于 `outputs/m3d-20261030-dev-perf-fix/`。本轮证据目录里 404 的 walkable-field.bin 触发了设备端栅格化回退；日志显示 PT done 约 1.14–1.16s。该结果不是 Raycaster 游戏循环性能数据。auto fresh target 加载媒体材质阶段长停滞，最终 180 秒硬超时；更早的 auto ready 仅保留为历史样本。

## 8. 提交状态、自评

- 分支：`fix/dev-perf-fix-20261030`
- base SHA：`e8be6ce3ead635f8367288b49f6141b2b67d3353`
- implementation commit：`47e9f49f9bcd415959a8a78b4ce8a91b085f6687`（源码、回归测试与报告首版）；最终报告修订作为后续本地提交记录。
- push / deploy：未 push、未部署；未触及 beta/main/release、线上服务或账号服务。
- 起始工作树检查：分支正确、HEAD 等于基线；无已跟踪脏改动。发现未跟踪 `.codex-lock.d/` 与本任务输出目录，按要求未清理。
- **Codex 自评：**代码修复覆盖审计所列 P1/P2/P3 路径且纯逻辑回归良好，但 P1-a 的实际性能收益及 P1-b 最终自动回退用户路径仍缺关键浏览器前台验证；只完成标题页四尺寸截图，完整场景×尺寸矩阵缺失，因此整体验收不应判为完全通过。
- **没有实测支撑的结论：**sandbox 目标帧率达成、Raycaster profile 热点已消失、auto 最终自动路径一定能 ready、parry 实际画面、真实设备 GPU/native 内存安全、LRU/URL 长时间无泄漏、真实弱网/移动设备表现。
