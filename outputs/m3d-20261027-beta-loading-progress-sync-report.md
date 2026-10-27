# m3d-20261027 beta loading progress sync report

- Implementation commit: `5b6c0f043f17b8c6076511eba7bce127d900b5` (`feat(beta): sync cinematic loading progress UI`)
- This report is committed in a follow-up `feat(beta): finalize loading sync report` commit.
- Baseline: `1762cb1` (beta rev40)
- Branch: `feat/beta-loading-progress-sync`

## 改动文件

- `index-public.html`
  - 仅替换 `#loader` 区块及其紧邻的早期内联脚本。
  - 加入 `loaderVideo`、scrim、BETA 品牌、扫光进度条、百分比和字节信息元素。
  - beta 页面恒 cinematic；`?loadquality=mobile|desktop` 保留强制选择，其他情况按窄屏、粗指针和省流模式选择视频源。
  - 视频加载错误隐藏视频并回退 classic 样式。
  - 加入 12 秒无进度看门狗提示，收到 `app:boot-progress` 后恢复。
- `styles-beta-addon.css`
  - 加入 beta 专属 cinematic/classic loader 样式，选择器限定在 `#loader.loader`。
- `src/ui/hud.js`
  - `setLoading(pct, label, byteStats)` 支持单调进度、中文阶段标签、字节格式化、速度/缓存/来源信息和 `app:boot-progress` 事件。
  - 保持既有单参数调用兼容。
  - 加入 `beginLoadingSession()`，负责重置进度并重播视频；`hideLoader()` 在退场后暂停视频。
- `src/main.js`
  - 各启动阶段加入中文标签。
  - 接入音频预取进度到 70%～86% 区间。
  - canvas 的 `webglcontextlost` / `webglcontextrestored` 增加可见提示和 console 留证。
- `src/systems/audio.js`
  - `preload({ onProgress })` 对两个 manifest 和七个 BGM 预取作业逐项报告 `{done,total,label}`。
  - 保留现有预取架构；当前音频预取以文件计数为主，字节字段留空。
- `assets/video/`
  - `dev-loading.mp4`：4,187,501 bytes
  - `dev-loading-mobile.mp4`：1,975,856 bytes
  - `dev-loading-poster.jpg`：18,275 bytes
  - `dev-loading-poster-mobile.jpg`：19,093 bytes
- `tools/test-loading-progress.test.cjs`
  - 新增 node:test 契约：单调不回退、标签、字节格式化、mock fetch 音频聚合、看门狗、质量选择/错误回退脚本。
- `tools/test-beta-contract.cjs`
  - 明确允许 beta `index-public.html` 的 loader 区块相对 canonical shell 独立；其余 public shell 仍严格与生成结果同步，并校验 BETA loader 结构。

## 验证结果

- 所有改动 JavaScript `node --check` 通过；`index-public.html` 内联早期脚本提取后 `node --check` 通过。
- `node tools/test-loading-progress.test.cjs`：5/5 通过。
- `node tools/run-node-tests.cjs`：`OK 79/79`；22 个浏览器/CDP 测试按既有 runner 环境跳过。
- `git diff --check`：通过。
- `index-public.html` 的提交 diff：`77 insertions(+), 23 deletions(-)`，改动范围仅在原 loader 区块到开发测试面板注释之前；没有修改 `index.html`、`styles.css`、`tools/public-shell.cjs`、`src/core/version.js` 或版本戳。

## 体积影响评估

视频和 poster 合计 6,200,725 bytes，约 5.91 MiB（十进制约 6.20 MB）。桌面首次加载会请求约 4.19 MB 视频，移动/窄屏、省流或粗指针设备选择约 1.98 MB 移动视频；poster 约 37 KB。`preload="none"` 和早期质量选择避免同时请求两份视频。视频失败时只保留经典 loader，不阻塞游戏启动。

## 图形渲染重置调查与边界

context loss 通常由浏览器/GPU 驱动重置、显存压力、设备切换或长时间初始化期间的资源竞争触发；音频预取本身不直接操作 WebGL，但同时进行的网络、解码和场景初始化可能提高主线程/显存压力。此次改动只增加事件留证、暂停状态和恢复后的尺寸刷新，没有重构 renderer。若再次出现，应结合 `[renderer] WebGL context lost` 日志、浏览器 GPU 日志和设备/驱动信息判断根因。

当前音频进度报告按 9 个预取作业计数；由于既有 `_fetchBetaBytes()` 使用 `arrayBuffer()`，没有为进度显示重构读取架构，因此不会报告真实流式字节。HUD 已支持真实 `doneBytes/totalBytes`、速度和缓存态，后续其他资源加载器可直接复用。
