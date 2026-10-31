# m3d-20261028-dev-audit-fixall — DEV 审计 12 项修复报告

## 目标与边界

本轮在 `00e4267`（第一轮 loading progress 修复）上继续修复审计报告 DEV-01 至 DEV-12。工作树为 `/home/fame/code/marmot3d/m3d-dev-mobile-boot-20261027`，分支为 `fix/dev-mobile-boot-20261027`。本轮没有 push、部署，也没有修改 `index-public.html`、`tools/public-shell.cjs`、三档 GLB 或 CACHE_STAMP 类版本戳变量。

## 逐项结果

### DEV-01（高）材质/挂载/首帧长阻塞

- `src/world/verdant.js:120-223, 330-345` 保留解析、材质逐 mesh 让出与贴图队列；`src/main.js:561-571, 708-711` 将中央基地和洞穴候选搜索接到 cooperative placement；`src/world/verdant-placement.mjs:335-390` 提供分批搜索；`src/world/burrows.js:59-83` 逐洞穴让出事件循环。
- 预热、首帧和阶段进度仍由第一轮路径驱动；`src/main.js:3084` 在实际首个 `renderer.render()` 返回后设置 `__m3dFirstFrameAt`。
- 结果：启动期布局不再强制走完整同步搜索链；本轮没有设备 profiler，因此“每个同步块 ≤200ms”只能由代码分批路径保证，无法宣称真实硬件测量通过。

### DEV-02（高）沙盒进入 171 秒阻塞

- `src/main.js:1123-1210` 将 `loadLevel()` 设为 async，重置玩家、逐只创建狐狸、食物重建、伙伴 placement 分段让出；`src/main.js:1099, 3120` 启动/沙盒路径等待 cooperative load。
- 进度遮罩沿用 `hud.setLoading`，伙伴/洞穴/狐狸阶段都有状态更新；错误仍走现有 fail-soft 路径。
- 结果：没有单次 `Array.from(...makeFox)` 或同步 placement 全链路；无 Chrome 可用，所以没有伪造“171 秒窗口已实测消失”的结论。

### DEV-03（高）看门狗阶段过滤与假首帧

- `index.html:347-352, 371, 395-399` 在 `bootFail()` 设置取消标志、调用 `__m3dBootCancel`，看门狗覆盖 Verdant module/download/parse/materials/rasterize/ready 阶段，并在取消后短路；首帧只认 main 中真实 render 返回后的时间戳。
- `src/main.js:457-460` 在 boot 已取消时停止 Verdant boot gate；启动 promise 的取消/迟到结果由 attempt cancelled 路径收敛。
- 证据：`node tools/run-node-tests.cjs` 的 `test-verdant-watchdog.cjs` 通过。

### DEV-04（中）部分字节后不切源

- `src/world/verdant-progress.mjs:211-252` 中途断流后从下一候选源重新完整请求，不拼接半截响应；通过 `onDiscard()` 回滚已计入的字节。
- `src/world/verdant.js:37-55` 接入丢弃进度和切源提示；signal abort 仍优先抛出，不会错误切源。
- 证据：`test-verdant-loader-progress.cjs`、`test-verdant-download.cjs` 通过。

### DEV-05（高）GPU/纹理预算与移动档位保护

- `src/core/memory-budget.mjs:7-54` 增加 `deviceMemory`、移动设备、最大纹理尺寸和纹理像素估算；`exceedsMemoryBudget()` 同时判断 JS heap 与纹理预算。
- `src/world/verdant.js:55-71, 151-178` 在 decode 前读取 PNG/JPEG header，按尺寸和预算决定 resize，避免原尺寸 bitmap probe；解析后再检查 texture/GPU 预算。
- `src/main.js:213-214, 277-300, 436` 记录 renderer 最大纹理尺寸并使用设备保护；`src/core/performance.js:67-85` 对移动 high/ultra 硬收敛到 low，移动 medium 在低内存/非 WebGPU 时也收敛。
- 结果：没有引入 alert；超预算走现有降档/程序化回退提示。

### DEV-06（中）本地包恢复顶层阻塞与 Object URL

- `src/main.js:118-130, 489-495` 删除顶层 `await restoreLocalPack()`，恢复与 renderer/首屏并行，仅在进入 Verdant 前最多短等待；状态回调显示恢复过程。
- `src/world/local-pack.js:34-51, 157-195, 276-285` 改为只保存 FileSystem handles，`prepareLocalAsset()` 在实际资源被 loader 请求时才创建 Object URL；`replaceActive()` 在替换 active 包前统一 revoke 旧 URL；恢复有 AbortController 和取消状态。
- `src/ui/settings.js:163, 269-270` 提供“取消恢复”按钮；切档 loading 时档位按钮 disabled。
- 验证边界：本地 File System Access API 需要真实 Chromium 授权，本轮自建 Chrome 无法启动，未宣称端到端授权恢复实测。

### DEV-07（中）沙盒入口 AudioContext 解锁

- `src/main.js:1495, 1541, 2445, 2527` 将 `audio.ensure()` 接到沙盒标题按钮、开始游戏、触屏/笔首个真实动作和已有鼠标入口；失败显示静音提示，后续动作仍可重试。

### DEV-08（低）context restored 贴图健康检查

- `src/main.js:3053` 在 `webglcontextrestored` 后异步调用 `revalidateTextures()`；`src/models/loader.js:404-431` 只遍历已缓存模型，剥离确认尺寸无效的贴图并回退 geometry-only。
- 证据边界：未能注入真实 context loss/restore；代码路径和 `test-models.cjs`（因无 Chrome 按工具约定 skip）之外没有硬件注入证据，报告不把它写成真机通过。

### DEV-09（低）切档并发请求取消

- `src/main.js:609-649` 每次切档递增 request id、abort 旧 controller、把 signal 传入 Verdant loader；旧结果会 dispose，旧进度不会覆盖新请求，`finally` 只清理当前请求状态。
- `src/ui/settings.js:154-156` 通过 `verdantQuality.loading` 禁用档位按钮，避免 in-flight 重复点击。

### DEV-10（低）档位显示数字与 manifest 漂移

- `src/world/verdant-tier-metadata.mjs:1-16` 从 runtime `assets/verdant/manifest.json` 的 `faces/packBytes` 生成展示行；`src/main.js:2665-2672` 异步刷新设置数据。
- `tools/test-verdant-tier-metadata.cjs:1-17` 校验四档存在、面数与 manifest 一致、大小非空；`test-verdant-tier-metadata.cjs` 通过。

### DEV-11（中）WebGPU 第二次探测无超时

- `index.html:325-330` 首次 probe 使用 `retainDevice:true`、10 秒 deadline 与 AbortController，并把 adapter/device 放入 `window.__boot.gpuProbe`。
- `src/core/renderer.js:20-36, 67-143` 复用 probe device；探测、WebGPURenderer init、WebGL2 兼容 init 都使用同一 deadline，超时/失败 dispose 后确定性走 WebGPU 优先的 WebGL2/经典 WebGL fallback。
- 保留既有契约：能用 WebGPU 时仍优先 `WebGPURenderer`，真实 backend 仍如实上报。

### DEV-12（低）模型加载终态 deadline

- `src/models/loader.js:27-28, 209-244, 251-343` 增加 60 秒终态 deadline；超时将状态设为 `timeout`、删除 pending cache entry、resolve(null)，迟到 GLTF 回调释放 geometry/material；清理后可重新调用触发重试。
- 15 秒仍是软提示，不取消正常慢加载；allSettled 不会永久 pending。

## 改动文件

- `index.html`
- `src/core/memory-budget.mjs`
- `src/core/renderer.js`
- `src/main.js`
- `src/models/loader.js`
- `src/ui/settings.js`
- `src/world/burrows.js`
- `src/world/local-pack.js`
- `src/world/verdant-placement.mjs`
- `src/world/verdant-progress.mjs`
- `src/world/verdant.js`
- `src/world/verdant-tier-metadata.mjs`
- `tools/test-verdant-tier-metadata.cjs`
- `outputs/m3d-20261028-dev-audit-fixall-report.md` 及本目录实测证据

## 验证命令与结果

- `node --check`：所有修改/新增 JS、MJS 文件通过，包括 `index.html` 内 module 逻辑对应的源码文件。
- `git diff --check`：通过，新增行 LF。
- 临时备份 `index-public.html` → `node tools/public-shell.cjs` → `node tools/run-node-tests.cjs` → 恢复原字节：`OK 46/46`，22 个 browser/CDP 测试按工具约定 skip；未删测试或弱化断言。
- `cmp -s index-public.html <(git show HEAD:index-public.html)`：通过，受限 public shell 未保留改动。

## 自建 Chrome / 时间线证据

已在 JOB 启动静态服务 8360，并按要求使用独立 Chrome，不连接 `127.0.0.1:18800`。尝试过：

- `google-chrome --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --remote-debugging-port=9230 --user-data-dir=/tmp/m3d-fixall-chrome ...`
- 9231 加 `--no-zygote --single-process --disable-crash-reporter`
- 9232 unsafe SwiftShader；9233 headless=old

Chrome 均未在探测窗口内提供 CDP endpoint；9231 明确 `Segmentation fault (core dumped)`。完整 stdout/stderr、命令与服务日志在 `outputs/m3d-20261028-dev-audit-fixall/chrome-*.{stdout,stderr}`、`chrome-startup-failure.md`。结构化边界记录为 `timeline.json`，内容为 blocked；没有标题页/沙盒/进度序列，因此没有伪造“无 >10s 停顿”或“可玩”结论。

审计基线的标题页约 123 秒、沙盒约 171 秒无响应；本轮已把识别出的同步扫描和沙盒 reset 链拆为 cooperative/async 路径，但真实秒级对比需在能启动 Chromium 的环境复测。

## 已知遗留

- 本轮没有真实 WebView/Chromium 的 context-loss 注入、AudioContext 授权和沙盒按键 playtest 证据，代码路径已接入，需主控或设备环境复测。
- `index-public.html` 必须由主控在集成/发版时重新运行 `tools/public-shell.cjs` 生成；worker 未改它。
- 任何极端 GPU driver 在 WebGPURenderer 内部迟到的异步任务仍由 renderer 自身负责最终回收；本轮在 deadline catch 中已主动 dispose 并释放 retained device。

## 分支与提交

- 分支：`fix/dev-mobile-boot-20261027`
- 基线：`00e4267`
- commit：最终本地提交（commit hash 以交付时 `git rev-parse --short HEAD` 为准；提交信息为 `fix(dev): close audit gaps DEV-01 through DEV-12`）
- 当前状态：本轮改动已本地 commit；禁止 push/deploy。
