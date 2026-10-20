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
