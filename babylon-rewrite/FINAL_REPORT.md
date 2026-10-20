# babylon-rewrite 总报告

## 概要

- 起点：2026-10-19 22:13（阶段任务记录的起始时间）
- 完成：2026-10-20 23:45（Stage 6 文件完成时间以本次 commit 为准）
- worktree：`m3d-beta-babylon/`
- 分支：`babylon-rewrite`
- Stage 1-6 总 commits：6 个阶段 commit
- Stage 1-5 累计变更：15 个文件，`+431 / -96` 行（净增 335 行）

本轮把 Babylon.js 接入做成可回退的渲染宿主：Babylon 负责 canvas、场景、相机、灯光和渲染循环；既有 Three.js 游戏逻辑仍保留在原路径中。GLB 预加载、四类 Babylon 实体和纯 DOM HUD 已接入，Stage 6 只增加手动基础设施检查页与报告。

## Stage 1 · importmap + esmsh CDN

- commit：`3342d8a`
- 改动：`index.html` 增加 `@babylonjs/core`、`@babylonjs/loaders` 和 `@babylonjs/core/` 的 esm.sh importmap；增加 `tools/probe-babylon.html`；初始化本报告。
- 验证：esm.sh HTTP 200；入口解析为 `es2022/core.mjs`。

## Stage 2 · GLB 接 Babylon SceneLoader

- commit：`f2ecee1`
- 改动：新建 `src/babylon/loader.js`，通过 `SceneLoader.LoadAssetContainerAsync` 加载 GLB；`src/babylon/index.js` 重导出 loader；`src/main.js` 后台预加载 `marmot.glb`、`fox-segmented.glb`、`terrain.glb`。
- 验证：`AssetContainer` 预加载按资源独立捕获错误，成功时返回 container、rootName、meshCount，失败时记录 `err` 并继续其他资源。

## Stage 3 · cleanup（删 compat + World 重复类）

- commit：`71e449d`
- 改动：删除 `src/babylon/compat.js`；删除 `src/world/scene.js` 中重复的 `BabylonWorld`；`src/babylon/index.js` 删除 compat 重导出；`src/main.js` 删除 `syncBabylonCamera` 依赖；`Sky` 保留并标注 `@deprecated`，供 legacy Three 路径使用。
- 验证：`syncBabylonCamera` 无残留；Babylon renderer 集中在 `src/babylon/renderer.js`。

## Stage 4 · 实体迁移

- commit：`d6db476`
- 改动：新建 `src/entities/babylon-player.js`、`babylon-fox.js`、`babylon-companion.js`、`babylon-burrow.js`；`src/entities/index.js` 重导出；`src/main.js` 创建四类 Babylon 实体。
- 四类实体：player、fox、companion、burrow。
- fox：支持 `normal`、`fast`、`heavy`、`boss` 四种颜色；优先使用 Stage 2 预加载 GLB，失败时使用程序化圆柱回退。
- burrow：首跑使用 torus rim 占位；更完整洞穴几何留给后续版本。
- 验证：四个实体模块已通过 Node 语法检查。

## Stage 5 · HUD 解耦

- commit：`302bbf3`
- 改动：`src/ui/hud.js` 重写为纯 DOM overlay，不再导入 Three.js 或 Babylon.js；保留 `HUD` 类、既有 public method 签名、DOM ID、文案和布局。
- 保留接口：`setLoading`、`hideLoader`、`say`、`banner`、`hurtFlash`、`flashScreen`、`setInteractPrompt`、`update`、`updateThreats`、`setPerfHint`、`showPanel`、`hidePanel`。
- 验证：HUD 模块及前 5 阶段涉及 Babylon/entity JavaScript 文件均通过 Node 语法检查。

## Stage 6 · 验证 + 总报告

- commit：本次提交
- 改动：`babylon-rewrite/smoke-test.html`、`babylon-rewrite/smoke-test-instructions.md`、本文件。
- 跑了什么：确认前 5 阶段 commit 全部存在；读取 Babylon renderer、loader、index、实体和 HUD；执行全部要求的 `node --check`；准备浏览器手动 smoke 流程。
- 手动 smoke：待用户在有图形环境的 Chrome 中运行；沙箱不执行 Playwright、无头浏览器或 e2e。

## 怎么验

1. 查看阶段历史：

   ```bash
   git log --oneline refs/heads/babylon-rewrite -15
   ```

   应看到 Stage 1-5 的五个 commit，以及本次 Stage 6 commit。

2. 做静态语法检查：

   ```bash
   node --check src/babylon/renderer.js
   node --check src/babylon/loader.js
   node --check src/entities/babylon-player.js
   node --check src/entities/babylon-fox.js
   node --check src/entities/babylon-companion.js
   node --check src/entities/babylon-burrow.js
   node --check src/ui/hud.js
   ```

3. 做浏览器 smoke：按 [`smoke-test-instructions.md`](./smoke-test-instructions.md) 启动 `python3 -m http.server 8001 --bind 127.0.0.1`，再用 Chrome 打开 `smoke-test.html`。status 最后一行必须是 `=== smoke PASS: babylon-rewrite infra ok ===`。

4. 检查 Stage 1-5 累计 diff：相对 Stage 1 父提交为 15 个文件、`431 insertions`、`96 deletions`；各阶段提交分别记录了 importmap、loader、cleanup、entity、HUD 的改动。

## 还剩什么

- Rapier 物理延后。
- Havok / Cannon 延后。
- GLB 分级回退（L0/L1/L2）仍只在老 Three 路径。
- 老 Three 路由仍保留作回滚。
- UI 真运行测试仍需要本地图形环境，沙箱不跑 Playwright。
- Babylon 实体目前是首跑脚手架，完整 gameplay 状态同步和洞穴几何仍待后续版本。

## 风险

- 阶段 commit 操作依赖 `danger-full-access` 工作环境；本报告只记录结果，不改变旧阶段实现。
- esm.sh CDN 不可达时，浏览器 importmap 和 GLB 相关模块无法加载；需在浏览器控制台确认网络错误。
- Babylon 7.54.3 与旧 Three.js 行为可能存在相机、材质、坐标和资源生命周期差异，需要在真实浏览器中继续调校。
- Stage 6 的 smoke 页面验证的是 Babylon 基础设施和渲染循环，不等于完整游戏关卡、实体行为或 HUD 交互已完成验收。
