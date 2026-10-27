# m3d-20261027-dev-mobile-boot

## 根因分级

- **实测：70% 后主线程被 Verdant GLB 解析/纹理准备占满。** CDP 移动视口（390×844、iPhone UA、`?version=dev&webgl=1&models=off&verdantTier=high`）观察到资源字节进度到 `70%` 后，页面仍显示“加载 Verdant 资源”，连续 `Runtime.evaluate` 超时，无法取得 `__game` 或首帧。证据见 `visual/mobile-high-report.json` 与 `visual/cdp-mobile-console.txt`。
- **推断：真实低端/无 WebGPU 手机在同一阶段更容易因 GLB 解码和纹理上传造成长时间卡顿或渲染进程压力。** 本地 CDP 使用软件 WebGL，不能等价于 iPhone GPU；因此把这部分标为推断，没有把模拟器超时直接等同于真机崩溃。
- **白屏：未能在本地 CDP 复现 HTML 静态层消失。** 现有静态 loader 在 JS 执行前即可显示；本轮修复只增加 dev 首帧诊断，不改静态 loader 结构。

## 修法

- `src/core/performance.js` 新增纯函数 `clampVerdantTierForDevice`：dev 调用侧对移动端 high/ultra 强制降到 low；移动端 medium 在无 WebGPU或低内存/低核数时降到 low；无 WebGPU 桌面端的 ultra 降到 high；极低资源设备降到 low。
- `src/main.js` 将档位保护接入 `autoVerdantTier()`，并在 dev 移动端、无 WebGPU、`deviceMemory <= 4` 时绕过大 GLB，直接进入程序化简化地图，同时给出 HUD 提示，避免 70% 后同步解码压垮主线程。
- `src/main.js` 增加 renderer、Verdant、布景、道具、控制、玩家、实体和首帧阶段标记；70% 后显示更细的启动进度。
- `index.html` 增加 dev-only 首帧看门狗：主模块启动后 10 秒没有首帧时显示“渲染器尚未产出首帧”，并建议重新加载后选择低档。beta/stable 直接跳过该逻辑。
- `isTouchPrimary()` 对移动 UA 直接识别，覆盖移动模拟器和部分内置浏览器不报告触点数的情况。

## 证据索引

- `outputs/m3d-20261027-dev-mobile-boot/visual/mobile-high-report.json`：CDP 移动模拟阶段/进度/连续求值超时记录。
- `outputs/m3d-20261027-dev-mobile-boot/visual/cdp-mobile-console.txt`：同一轮 CDP 运行输出。

本轮 CDP 页面在 70% 后主线程忙于解析，`Page.captureScreenshot` 也超时，因此没有生成可信的“卡死后截图”；没有用其他运行的截图冒充本轮证据。

## 测试清单

- `node --check src/main.js`
- `node --check src/core/performance.js`
- `node tools/test-verdant-tier-guard.cjs`：通过，覆盖移动 high/ultra、无 WebGPU medium、WebGPU medium、桌面 ultra 和极低资源分支。
- `git diff --check`：通过。
- `node tools/run-node-tests.cjs`：新增测试未失败；全量结果为 `41` 个通过、`2` 个预存失败、浏览器测试按脚本规则跳过。预存失败已用 HEAD 复核：`test-beta-contract.cjs` 的 beta 相对视频路径检查、`test-verdant.cjs` 的 low 高度文件尺寸哈希不一致。

## 自评

修复覆盖了移动端档位兜底、70% 后可观测阶段、首帧无响应提示和无 WebGPU 低内存安全回退；改动只在 dev Verdant 路径生效。CDP 已确认原始 70% 卡顿形态，修复后的移动安全分支受 UA/触点模拟限制未能在同一 managed target 中取得稳定截图，故保留为代码走查加纯函数测试结论。

## 遗留

- 真机 Safari/Chrome 的 GPU 进程崩溃无法由页面 JavaScript 捕获；当前能提供的是首帧超时提示。
- 若后续需要手机继续使用 Verdant 写实场景，应提供小于当前 low GLB 的专用 mobile tier，或把 GLB 解析迁移到 Worker。

## 2026-10-27 续查：解析卡死根因、真实进度与内存余量

### 根因结论（带对比数据）

- 历史可用版本 `72ca91f` 的单文件 `assets/verdant/verdant-trail.glb` 已是 52,825,048 bytes（约 50.4 MiB）；当前 low 文件工作树为 52,817,932 bytes（约 50.4 MiB，线上清单显示约 37.1 MiB 是压缩传输值）。因此“45 MB 以前正常、现在不能加载”不是单纯文件字节数增加。
- 解析路径的关键回归在 `3f0ea63` loader-restore 后：流式下载先保存 chunks，再 `concatChunks`，随后 GLB 路径无条件 `arrayBuffer.slice`。当 Uint8Array 已经是紧凑 buffer 时这会再复制一份完整 GLB；本次改为在 buffer 完整覆盖时直接传原 ArrayBuffer，仅在有 byteOffset/尾部空间时复制。
- GLB 解析后的重负载是 54 mesh、63 贴图和约 34.7 万面地形。旧 loader 只在 `loader.parse` 回调后一次性遍历材质；本次诊断确认 70% 后主线程连续被 GLTFLoader 解析、图片解码和材质准备占用，符合此前 CDP 的 Runtime.evaluate 超时证据。`buildWalkableField` 的光栅化仍是同步 CPU 工作，但它发生在解析/材质完成之后，不是“70% 停住”的唯一根因。
- `LoadingManager` 的 item 计数现在用于解析阶段；`createImageBitmap` 在 dev Verdant parse 期间通过队列限制为最多 3 个并发。解析完成后不保留下载 bytes 的额外 slice 引用。可用 `performance.memory` 时，以 82% heap 或 heap limit 减 256 MiB 中较低值作为保留线，触线走既有失败面板。

### 改动文件

- `src/world/verdant.js`：解析阶段 LoadingManager 计数、3 路图片解码背压、内存预算检查、无副本 GLB 传递；材质按 mesh 分批并在批次间让出事件循环；光栅化前后让出事件循环并发送阶段事件。
- `src/main.js`：把下载/解析/材质/光栅化/就绪映射到 46–70/70–82/82–90/90–98/98–100，使用 `Math.max` 保证百分比单调，标签携带 `done/total` 计数。
- `src/core/memory-budget.mjs`：纯逻辑内存快照、预算和触线判定。
- `tools/test-verdant-memory-progress.cjs`：纯逻辑预算、缺失 memory 容错和单调进度测试。

### 测试结果

- `node --check src/main.js src/world/verdant.js tools/test-verdant-memory-progress.cjs`：通过。
- `node tools/test-verdant-tier-guard.cjs`：通过。
- `node tools/test-verdant-memory-progress.cjs`：通过，覆盖进度单调性、预算触线和无 performance.memory 环境。
- `node tools/run-node-tests.cjs`：42 个通过、2 个失败；失败仍为预存 `test-beta-contract.cjs`（beta 相对视频路径）与 `test-verdant.cjs`（low 高度哈希/尺寸，当前实际 GLB 52,817,932 bytes 对测试期望 38,941,216）。
- `git diff --check`：通过。

### 实测证据与边界

- 改动前的 headless/CDP 证据仍是本报告前章：移动视口到 70% 后连续 Runtime.evaluate 超时，无法取得首帧；该运行使用软件 WebGL，不能代表 iPhone GPU。
- 本续查已具备可观测事件序列：下载事件落在 46–70；解析事件为 `解析 Verdant 场景素材 n/63`（以 LoadingManager 实际 itemTotal 为准）；材质事件为 `准备 Verdant 材质与贴图 n/54`；光栅化为 `0/1 → 1/1`。`main.js` 对每个事件做单调夹紧。
- 本地 headless Chrome 的改动后完整 low/默认两轮、启动总耗时和 `performance.memory` 峰值尚未取得稳定数据；软件 WebGL 解析常因主线程长任务超过 CDP 评估窗口。这是未完成项，不能把旧基线数字冒充改后实测。

### 未完成项与已知边界

- `performance.memory` 只在 Chromium 特定环境可用，Safari/iOS 通常不可见；背压仍可限制图片解码并发，但无法直接读取 GPU 纹理显存。
- `buildWalkableField` 的三角形光栅化尚未 Worker 化；如果真机仍在该阶段长时间无响应，下一步应把光栅化移到 Worker，并保持主线程只接收分块进度。
- 未改版本戳、index-public.html、beta/stable 文件，也未部署。
