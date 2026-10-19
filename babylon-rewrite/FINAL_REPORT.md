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
