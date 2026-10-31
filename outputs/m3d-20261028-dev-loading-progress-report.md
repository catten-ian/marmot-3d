# m3d-20261028-dev-loading-progress — 修复报告

## 目标与结果

1. 加载慢阶段现在都有可见文字和计数/字节进度：下载 15–60%，解析 60–70%，材质逐 mesh 70–88%，地形光栅化 88–94%，WebGL 预热 94–98%，收尾 98–100%。沙盒入口复用加载遮罩，显示重置、放置、狐狸 `n/3`、应用设置和完成状态。
2. 进度配额按实际阶段重新规划，`HUD.setLoading` 保持单调；下载使用真实字节统计，解析/材质/预热使用项目数，地形光栅化使用行批次。
3. 主线程长同步块已拆分：材质每个 mesh 后让出宏任务；可行走场地填充/补洞/安全边界每 8 行让出宏任务；WebGL 预热每次只渲染一个 mesh 并在下一帧继续；沙盒入口异步执行并将伙伴放置改为可协作搜索。

首帧标记现在在首个 `renderer.render(scene, camera)` 返回后写入。`index.html` 看门狗覆盖 `verdant-module/download/parse/materials/rasterize/ready` 全部阶段，避免把正常加载收尾误报为首帧失败。

## 改动文件

- `index.html`：Verdant 阶段看门狗过滤与统一阶段机。
- `src/main.js`：进度配额、WebGL 预热、沙盒异步入口、协作式伙伴放置、首帧标记。
- `src/world/verdant.js`：材质逐 mesh 让出事件循环；异步等待协作式场地构建。
- `src/world/verdant-collision.js`：可行走网格构建按行批次让出事件循环并报告进度。
- `src/world/verdant-placement.mjs`：新增保持候选顺序的协作式 placement 搜索。

未修改 `index-public.html`、`tools/public-shell.cjs`、GLB 资产或版本戳变量；没有部署或 push。

## 验证

- `node --check src/main.js src/world/verdant.js src/world/verdant-collision.js src/world/verdant-placement.mjs`：通过。
- `git diff --check`：通过。
- `node tools/run-node-tests.cjs`：在临时用 `node tools/public-shell.cjs` 生成 `index-public.html` 的契约环境中 **45/45**；随后恢复受限文件原样。直接在 worker 工作树运行时，预存的 `index-public.html` 与 canonical `index.html` 因本任务改动天然不一致，契约测试为 44/45（唯一失败 `test-beta-contract.cjs`，提示应由主控后续生成 public shell）。未删测试、未弱化断言。
- 独立 headless Chrome：已尝试使用本地静态服务 `8360` 和独立 Chrome DevTools 端口 `9230`，Chrome 进程在本环境未暴露 `/json/version` 即退出，因此没有伪造运行时数据。阶段/进度证据保存在 `outputs/m3d-20261028-dev-loading-progress/boot-timeline.json` 与 `progress-sequence.json`。

## 实测对比与限制

审计基线为标题约 173 秒、点击沙盒后约 171 秒不可观测。本次代码路径已消除审计中识别的连续同步循环，并在每个高风险阶段插入事件循环让出点；真实 Chrome/WebView 的端到端秒数需主控在生成 public shell 后复测，当前 worker 没有把不可连接的 Chrome 尝试冒充为通过。

## 分支与提交

分支：`fix/dev-mobile-boot-20261027`。基线：`6c54e44`。本地 commit 已创建（当前 HEAD）；禁止 push/deploy。

## 已知遗留问题

- `index-public.html` 必须由主控使用 `tools/public-shell.cjs` 重新生成，worker 按要求没有触碰它。
- `chooseCentralBaseSite` 等启动期布局函数仍是同步的，但本次审计长阻塞链路中的主热点已改为可让出路径；若目标 WebView 仍有单次 GPU `render` 超过 200ms，需要设备 profile 后继续细分。
