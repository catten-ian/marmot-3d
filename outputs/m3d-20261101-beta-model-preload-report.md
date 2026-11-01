# m3d-20261101-beta-model-preload — 返修报告

- JOB：`/home/fame/code/marmot3d/m3d-beta-model-preload-20261101`
- 分支：`fix/beta-model-preload-20261101`；通道：Beta only。
- 原始 base：`99f2d236d496971f6a702d9d41929d1cce65bd80`。
- 返修起点：`0059d7d4eeec4b0a73e9e429b2672f359994dcd3`。
- 返修提交：包含本报告的 `fix(beta): repair entry batches and retryable rig readiness` 提交；最终 SHA 以 `git rev-parse HEAD` 和交付消息为准。

## 本轮修复与 before/after

1. 旧 main 在 `await gate.enter()` 后独立运行 action，实际绕过去重。现在 main 将 action 包含在传给 gate 的回调中，同时共享本批 `betaEntryAttempt`。同批点击/Enter 只执行第一个 action；批次 finally 清除，后续重开、下一关、退出后再进入均可运行。移除全局永久 `entered` 标志。下一关与重试关卡也显式接入统一门；暂停/恢复不经过资源门。
2. 恢复 Stable/Dev `startPlay()` 的同步 `audio.ensure()`。Beta 在入口调用栈中同步 ensure，然后由门等待音频 `ready()`。未改音频实现；当前 JOB 未集成音频 JOB，公共契约不存在时明确失败，绝不假装音频成功。
3. Companion 原来没有 ready。新增仅 Beta 使用的 `ready` / `ensureReady()` / `resetReady()`，等待实际 `_loadRealModel()` 完成实例挂载、BetaMarmotModel 构建、材质设置和尺寸验证。pending 共享同一 Promise，失败保留为 reject，显式重试才清除失败初始化状态；成功复用当前实例。
4. 玩家初始化改为可调用的 `ensurePlayerRig()`，失败 reject/空实例/rig 构造异常后可重新实例化；成功后复用并且只 attach 一次。清单不再制造一个额外的临时 rig，而是等待场景实际使用的玩家和伙伴 rig。
5. 门缓存每个已 validate 成功的资源。失败重试只 reset 失败资源，音频失败不会清除或重新 load 已成功模型。所有并行初始化 settle 后才暴露本次失败，避免旧 pending 实例和重试实例交叠。rig 初始化失败时只驱逐失败 GLB 缓存，保留已经成功解析的 GLB。
6. 初始化失败会清理实例自身的材质/骨骼资源，Beta 伙伴的失败清理保留 URL 缓存共享几何。没有改变模型高度、动画参数、玩法或画质。主入口失败面板对错误文本转义，加载遮罩在成功/失败时关闭，重试回调保留第一条进入意图。

## 资源清单与运行时对应

| URL / 类型 | 消费者及 ready 条件 |
| --- | --- |
| `./assets/models/marmot-run-stand.glb` / model | 玩家、伙伴；同一 `loadModel`/`instantiate` URL 缓存；完整模型及贴图判定，Run/StandIdle/StandUp 有有效 tracks；额外等待两个实际实例的 rig 初始化 |
| `./assets/models/fox.glb` / model | Fox 的 GLB 路径；同一 `loadModel`；完整模型及贴图判定。Beta 默认高保真狐狸是现有同步程序化模型，本轮没有改变该默认 |
| `./assets/models/terrain-lod.glb` / scene | 原有 backdrop；同一 `loadSceneModel` 缓存和 GLTFLoader，必须存在有效几何。原有 Beta backdrop 隐藏策略未改动 |
| `assets/sky/citrus_orchard_road_puresky_1k.jpg` / texture | Beta 天空；相同 URL 和 TextureLoader，要求已解码的有效图像尺寸 |

PAF 玩家藏狐、猎物土拨鼠、FPV 模型，以及主场景食物/植物/岩石/洞穴和同步 CanvasTexture，均为现有同步构造资源；没有给它们新增网络回退。PAF 的模式模块仍由原模式入口 import，创建函数内部同步初始化 PAF 模型。调参 GUI 的动态 import 为显式 debug URL 的工具，不是普通玩家的必需模型资源。未被 Beta 运行路径使用的 `marmot.glb`、`marmot-rig.glb`、`marmot-screaming.glb`、`fox-segmented.glb`、高模 `terrain.glb` 不标记为 Beta 必需项。

普通开始/选关使用 startPlay，沙盒按钮和 URL 自动沙盒使用 enterSandbox，PAF 使用 enterPlayAsFox，下一关/关卡重试显式进入统一门，Enter 和重开复用这些入口。普通开始与选关的原业务回调参数/关卡逻辑保持原样。

## 失败语义与缓存

资源未 fulfilled 或 validate 失败都不得 enter；模型 null、geometry-only、动画缺失、初始化异常、音频 ready reject 不视作 ready。失败面板显示资源 ID/错误及“重试”。成功项保留，失败项显式 reset；音频仍按公共 `audio.ready()` 契约重新请求。没有通过 HTTP 200、固定 sleep、polling 或 timeout fallback 宣称成功。

音频 JOB 只读参考。该 JOB 当前文件提供的 readiness 命名与本任务要求的 `audio.ready()` 仍需主控串行对齐，本文不声称已完成跨 JOB 集成。未修改 `src/systems/audio.js` 或音频 JOB 文件，也未为音频创建假 ready。

## Node 验证与范围

- 改动的 7 个 JS/MJS/CJS：逐个 `node --check`，7 pass / 0 fail / 0 skip。
- `node tools/test-beta-resource-gate.mjs`：15 pass / 0 fail / 0 skip。
- `node tools/test-marmot-rig.test.cjs`：6 pass / 0 fail / 0 skip。
- `node tools/run-node-tests.cjs`：98 个脚本 pass / 0 fail / 22 个 browser/CDP 脚本 skip。skip 未计入 pass。
- `git diff --check`：通过；审查原始 base 到本次工作内容的 diff，限定本 JOB 的 main、models、Companion ready、测试和报告。
- 过程中完整 runner 曾因旧 marmot-rig 静态测试断言旧函数形态而出现 1 个脚本失败；已更新为新的真实空实例失败与初始化入口形态，最终完整 runner 无失败。

聚焦测试执行 gate 逻辑，并以 VM/依赖注入执行真实 main 包装函数、startPlay、玩家初始化函数和 Companion ready 方法。覆盖同批并发/后续顺序、模型和音频 pending/reject、失败重试、成功缓存复用、玩家 reject/空实例/rig 构造失败后成功、伙伴失败后成功、清单 URL/类型及玩家伙伴共享、URL 自动沙盒回调、Stable/Dev ensure 顺序、失败实例清理。依赖注入的 rig/loader 测试不是浏览器 glTF/GPU/听感验收。

## 仍待主控浏览器与音频串行验收

保持 pending：1280×720、768×1024、390×844；普通游戏/自由沙盒/PAF 三模式首次进入和退出重进；PAF 首次真实音频；慢网、资源失败和显式重试；实际骨骼动画/贴图/接地/触控/HUD/内存生命周期。首轮未启动 Chrome、CDP 或浏览器。未执行 push、PR、deploy、Caddy/systemd 或线上文件操作。任务锁目录保持未跟踪。
