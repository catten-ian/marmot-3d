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
