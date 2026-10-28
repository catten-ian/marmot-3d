# m3d-20261027-dev-mobile-boot：WebView 首帧冻结修复报告

日期：2026-10-28
分支：`fix/dev-mobile-boot-20261027`

## 根因与证据链

冻结位置在 `src/world/verdant.js` 的 `onProgress('就绪：等待主线程空闲')` 之后，但这条日志并不代表场景已经完成 GPU 初始化。`loadVerdantWorld()` 返回后，`src/main.js` 才会把完整 Verdant group 挂进主场景；首次 `renderer.render(scene, camera)` 会触发 Three.js/WebGL 的懒纹理上传、顶点缓冲上传和材质初始化。

证据链如下：

1. 预计算 `walkable-field.bin` 已经把旧的 34.7 万三角形 × 16.2 万格同步栅格化移出启动路径；`verdant.js` 的 `buildWalkableField()` 完成后才发出“就绪：等待主线程空闲”。因此这次 98% 卡点不再是地形栅格化。
2. `verdant.js` 随后只等待一次 `setTimeout(0)`；主线程 JS 没有新的长循环。可见的下一阶段是 `main.js` 挂载 group 后的首帧渲染。
3. 已有移动 WebView CDP 证据 `outputs/m3d-20261027-dev-mobile-boot/visual/cdp-mobile-console.txt` 显示：进入 `verdant-module` 后多次 `Runtime.evaluate` 超时；桌面基线则能继续进入游戏。该形态与 WebGL 首帧同步资源上传阻塞渲染进程一致。
4. 用户报告的加载心跳也在首帧前停止，说明承载 JS 与定时器的渲染进程被同步 GPU/驱动工作占住，而不是业务状态机主动等待。

## 改动

- `src/main.js`
  - 新增 `warmVerdantWebGLScene(group)`：仅在触屏主输入 + WebGL/WebGL2 时启用，保持完整 Verdant 场景，不切换简化地图。
  - 首次挂载后暂时隐藏所有 mesh，每批显示 3 个 mesh，调用一次真实 `renderer.render(scene, camera)`，然后 `await setTimeout(0)` 让出事件循环；批次完成后恢复每个 mesh 原始可见性。
  - 这样纹理/缓冲上传被拆到多个事件循环回合，最后完整场景仍然可见，后续正式渲染不再承担一次性上传峰值。
  - 删除原先按 `deviceMemory <= 4` 直接切换“简化地图”的 WebView 门控；Verdant 写实场景始终是加载目标。

未修改 `index-public.html`、`tools/public-shell.cjs`、三档 GLB、线上资源或版本戳文件。

## 验证

- `node --check src/main.js`：通过。
- `node --check src/world/verdant.js`：通过。
- `node tools/run-node-tests.cjs`：`OK 45/45`。
- 本地 Chrome/CDP 复测尝试已执行；当前共享 Chrome 渲染器在旧探针页上已进入 `verdant-module` 后持续 `Runtime.evaluate` 超时，独立 headless Chrome 端口在本机环境未建立监听，因此没有把环境失败伪报成 100%。代码路径的纯 Node 合约测试与语法检查均通过。

## 为什么有理由相信真机能过

冻结的同步边界已被移到多个可让出事件循环的真实 WebGL 渲染批次中；这直接针对用户设备的 WebGL2 WebView，而不是依赖 WebGPU、设备识别或简化场景。所有 Verdant mesh 最终会恢复可见，地形高度场、碰撞和材质仍来自原写实场景。即使某一个批次较慢，后续批次仍有机会让 WebView 的定时器、看门狗和宿主消息循环继续运行，避免此前“一次首帧上传把整个渲染进程锁死”的形态。

## 残余风险

极低端设备仍可能在单个 3-mesh 批次中出现短暂卡顿；批次大小已固定为 3，且每批后强制让出事件循环。若真机仍有 GPU 驱动级崩溃，需要进一步按纹理分组或降低真实场景纹理尺寸，但当前实现不再通过简化地图规避问题。
