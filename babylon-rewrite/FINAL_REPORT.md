## Stage 1 (importmap)
- 加 @babylonjs/core + @babylonjs/loaders esmsh 入口
- importmap 三件套（core、loaders、core/）
- esmsh 探活 HTTP 200 ✅
- tools/probe-babylon.html 准备 headless 验

## Stage 3 (cleanup)
- 删 src/babylon/compat.js (syncBabylonCamera)
- 删 src/world/scene.js 底部 BabylonWorld 类（重复）
- src/babylon/index.js 删 compat 重导出
- src/main.js 删 syncBabylonCamera import
- Sky 类保留 + @deprecated 标注（供 three-legacy 用）
- 验证 grep syncBabylonCamera 无结果

## Stage 2 (GLB loader)
- 新 `src/babylon/loader.js`：`preloadGameModelsBabylon` + `loadBabylonGLB` + `addContainerToScene`
- `src/babylon/index.js` 加 loader 重导出
- `src/main.js` Babylon 初始化分支调 `preloadGameModelsBabylon`
- 用 `SceneLoader.LoadAssetContainerAsync` 异步加载 `.glb`
- GLB 资产：`marmot.glb` / `fox-segmented.glb` / `terrain.glb`
- 老 three `loader.js` 保留作回滚（不在 Babylon 路径调用）


## Stage 4 (entity migration)
- `src/entities/babylon-{player,fox,companion,burrow}.js` 全新建
- `src/entities/index.js` 重导出
- `src/main.js` Babylon 初始化路径调 `new` 4 类实体
- fox 4 种类型程序化颜色：normal=#a04927, fast=#d2a364, heavy=#5e4a3a, boss=#1f140e
- fox 优先使用 Stage 2 preloaded GLB；无 GLB 时回退程序化圆柱
- burrow 首跑占位（torus rim），mesh 几何化留给 V1.1
- 不动 UI 文案/布局（Stage 5 才做）

## Stage 5 (HUD decoupling)
- `src/ui/hud.js` 完全重写为纯 DOM overlay：无 three / Babylon import
- 保持 class name = `HUD`（`main.js` import 不改）
- 保持所有现有 public method 签名（`setLoading` / `hideLoader` / `say` / `banner` / `hurtFlash` / `flashScreen` / `setInteractPrompt` / `update` / `updateThreats` / `setPerfHint` / `showPanel` / `hidePanel`）
- 保持 UI 文案与布局不动
- 保持既有 DOM ID（`hpBar` / `toast` / `objective` / `loaderFill` 等）不动
- `styles.css` 不动
