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

## 续 2：预热后仍冻结的根因二判与修复

真机现象把问题进一步定位到上一轮预热实现本身：预热循环每批把新的 mesh 设为可见，却没有把上一批恢复隐藏。因此第 N 批的 `renderer.render(scene, camera)` 会重复绘制前 N 批全部 mesh；在 Verdant 大 GLB 上，预热绘制工作量随批次数累积为 O(n²)。这解释了“预热进度能到 100%，但 GPU 进程随后死亡”的形态。加载屏心跳消失的唯一业务路径是 `HUD.hideLoader()`：它会加 `loader.gone` 并由心跳定时器自删；初始启动路径在模块尾部调用它，位于预热和启动收尾之后。因此心跳消失不是预热循环主动隐藏加载屏，而是首帧同步渲染拖死前已经执行了启动收尾的隐藏动作。

本次改动在 `src/main.js` 的 `warmVerdantWebGLScene()` 中完成：

- 将批次大小降为 2，限制单次可见和绘制的 mesh 数量。
- 每批渲染后立刻把该批 mesh 隐藏；已经上传的纹理和顶点缓冲仍留在 WebGL 资源缓存中，下一批不会再次绘制旧批次。
- 每批更新加载屏为 `就绪：分批预热 WebGL 资源（当前/总数）`，并继续用 `setTimeout(0)` 让出事件循环。
- `finally` 仍恢复所有 mesh 的原始可见性，最终进入标题页时保留完整 Verdant 写实场景；没有启用简化地图，也没有修改 GLB、公共入口或版本戳。

验证结果：

- `node --check src/main.js` 通过。
- `node tools/run-node-tests.cjs`：`OK 45/45`（22 个浏览器/CDP 测试按工具约定跳过）。
- `git diff --check` 通过。

真机通过理由：任意时刻预热渲染集合最多 2 个 Verdant mesh，不再随着批次增长；每个批次之间有事件循环让出，且上传完成后的 GPU 资源不会因隐藏而被释放。这样消除了上一轮实现的 O(n²) 绘制峰值，同时保留完整场景的真实纹理、缓冲、高度场和碰撞数据。若设备仍在单个 mesh 上传时触发驱动级崩溃，剩余风险只集中在该 mesh 的单次资源上传，而不再是批次累积造成的 GPU 工作爆炸。

## 续 2：根因二判（后端路径）与修复

上一轮将 warmup 绘制集合限制为每批 2 个 mesh 后，真机仍在“就绪：分批预热 WebGL 资源”冻结，且 Chromium 121 WebView 的整个浏览器/GPU 进程被拖死。重新沿启动路径核对后发现，Verdant dev 启动在 `index.html` 只为旧 GS 路径探测 WebGPU，但 `src/main.js` 仍会无条件选择 `WebGPURenderer`；在该设备上 WebGPU 不可用，于是进入 Three.js 的 WebGPURenderer WebGL2 fallback。这个 fallback 与旧版能正常工作的经典 `WebGLRenderer` 不是同一上传/渲染路径，首个 Verdant GLB `render()` 正好落在该路径上。加载屏心跳消失仍只是渲染进程被同步 GPU 工作占住后的表现；业务代码没有在 warmup 中主动 `hideLoader()`。

本次改动：

- `src/main.js` 仅当引导结果 `window.__boot.gpuOk === true` 时才让 Verdant 使用 WebGPURenderer。
- Chromium 121、WebGL2、无 WebGPU 的内置 WebView 直接走经典 WebGLRenderer，恢复旧版已验证过的渲染后端。
- 保留上一轮每批最多 2 个 mesh、批后隐藏并让出事件循环的 warmup；完整 Verdant GLB、真实材质、高度场和碰撞仍然使用，没有简化地图、没有改三档 GLB、入口页、公共壳或版本戳。

验证：

- `node --check src/main.js`：通过。
- `node --check src/world/verdant.js`：通过。
- `node tools/run-node-tests.cjs`：`OK 45/45`（22 个浏览器/CDP 测试按工具约定跳过）。
- `git diff --check`：通过。

真机通过理由：目标 WebView 明确是 WebGL2 且没有 WebGPU；修复后它不会再创建 WebGPURenderer 的 WebGL fallback，而是使用经典 WebGLRenderer。这样首个真实 Verdant mesh 的纹理、缓冲上传和后续标题页渲染回到同一台手机旧版成功使用过的后端，同时保留分批预热的事件循环让出，避免一次性首帧上传再次锁死宿主浏览器。若页面最终仍有设备特定驱动问题，失败边界会集中在经典 WebGL 首次上传，而不是误入的 WebGPU fallback 路径。
