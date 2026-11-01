# m3d-20261101-beta-model-preload

- Base: `99f2d236d496971f6a702d9d41929d1cce65bd80`
- Branch: `fix/beta-model-preload-20261101`
- Channel: Beta only

## 实现

新增统一资源进入门 `src/models/beta-resource-gate.mjs` 与 Beta 清单 `src/models/beta-resources.js`。清单使用和运行时相同的 `loadModel`、`loadSceneModel` 和 `GLTFLoader/TextureLoader` 路径，并等待真实模型、贴图解码、必需动画及 `BetaMarmotModel` rig 初始化完成：

- 玩家：`assets/models/marmot-run-stand.glb`，必须有 `Run`、`StandIdle`、`StandUp`，并实际构造/销毁一次 rig 验证初始化。
- 伙伴：同一玩家 GLB；运行时 `Companion.ready` 必须完成并绑定真实 rig。
- 狐狸：`assets/models/fox.glb` 完整几何与贴图校验；Beta 当前默认显示高保真程序化狐狸，但该 GLB 仍作为 Beta 狐狸资源门覆盖资源，避免模型切换路径首用时竞态。
- 场景远景：`assets/models/terrain-lod.glb`，必须有有效几何。
- Beta 天空贴图：`assets/sky/citrus_orchard_road_puresky_1k.jpg`，必须完成尺寸有效的贴图解码。
- PAF 玩家狐狸、PAF 猎物和 FPV 视图是同步程序化模型，没有懒加载网络资源；PAF 模式仍必须经过同一门和音频 ready。

普通开始、关卡选择开始、沙盒按钮、PAF 按钮、`?sandbox=1` 自动入口、Enter、重开/下一关最终都调用同一个 Beta gate。并发调用共享同一 Promise，成功动作只执行一次；失败显示资源类别/原因和重试按钮。重试会清理模型/场景失败缓存，成功缓存会复用。

音频入口只调用 `audio.ensure()` 后等待依赖 JOB 的公共 `audio.ready()`，本任务没有修改 `src/systems/audio.js`。如果公共方法尚未合并，Beta 会明确显示“音频资源进入门未提供 ready()”，不会伪造完成或播放程序化回退后进入。

Stable/Dev 的入口逻辑保持原路径；门只在 `IS_BETA` 生效。纯程序化 PAF 几何属于同步玩法模型，不作为网络模型加载完成的替代品；远景与天空属于实际 Beta 视觉资源并列为必需资源。

## 验证

- 全部 `src/`、`tools/` 的 JS/MJS/CJS：`node --check` 通过。
- `node tools/test-beta-resource-gate.mjs`：4/4 pass。
- `node tools/run-node-tests.cjs`：98/98 pass，22 个浏览器/CDP 测试 skip（未计入通过）。
- `git diff --check`：通过。
- 首轮未运行 Chrome/CDP；三种视口、PAF 首次真实音频、慢网与浏览器失败重试待主控与音频 JOB 串行验收。

未执行 push、PR、deploy、Caddy/systemd 或线上操作。
