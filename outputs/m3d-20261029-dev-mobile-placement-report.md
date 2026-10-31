# m3d-20261029-dev-mobile-placement 修复报告

## 目标与边界

- 通道：dev；工作树：`/home/fame/code/marmot3d/m3d-dev-mobile-boot-20261027`
- 分支：`fix/dev-mobile-boot-20261027`
- 基线：`44b0c2d58c9b1e319788c199d63fad478fff582a2`
- 目标：消除手机端“寻找安全站位”长时间假死、重复扫描观感，并检查 dev 启动链路。
- 未修改：`index-public.html`、`tools/public-shell.cjs`、版本戳、beta/main 逻辑、GLB/mp3 资产；未 push/deploy。

## 复现与测量

按任务要求启动了本地静态服务 8360，并尝试独立 Chrome 参数：`--headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --remote-debugging-port=9260 --user-data-dir=/tmp/m3d-mobile-chrome-*`。该 Chrome 在本机没有建立 CDP 监听（`curl 127.0.0.1:9260/json/version` 返回连接失败），stderr 保存在 `outputs/m3d-20261029-chrome.stderr`；因此没有伪造手机端标题页耗时或 placement 扫描数据。

随后使用托管 Chrome `127.0.0.1:18800` 创建了独立 target，设置 390×844、DPR 3、触摸、CPU throttling 5、4G（150ms/200KB/s）。托管浏览器与当前静态服务所在网络命名空间隔离，访问 `127.0.0.1:8360` 和主机局域网地址均返回 `ERR_CONNECTION_REFUSED`。该 target 已关闭，没有接触已有标签。尝试记录在 `outputs/m3d-20261029-mobile-pre.json`；它明确是连接失败证据，不是运行时通过结果。

可重复的算法测量使用真实 `findRobustPlacementCooperative`，257×257、0.22m 网格（与运行时场地采样规模一致的上界模型），结果保存在 `outputs/m3d-20261029-placement-benchmark.json`：旧的 16m 半径逐格矩形约 21,025 个候选；修复后移动预算 2,048 候选，实际步长将扫描上界降为 1,369 个候选，进度回调 15 次，Node 测量 20.73ms。此项是算法上界/回归证据，不冒充真机秒数。

## 全面检查结论

| 严重级 | 问题与证据 | 处理 |
|---|---|---|
| P0 | `findRobustPlacement(Cooperative)` 在 0.22m 网格、16m 半径下最多约 21k 个格点；每个候选可能执行 13 个支撑探针、层匹配和 `hasClearance`。无效场地时会完整扫描。代码原为 `src/world/verdant-placement.mjs:201-239`。手机 CPU 放大后会长时间占满主线程。 | 增加确定性的 `boundedSearchStep`，默认上限 4096；dev 启动/伙伴路径传入 2048。 |
| P0 | 中央基地 cooperative 全场按 stride 4 扫描，失败后又进入普通 placement；多个洞穴依次重复。原路径没有候选预算。 | 中央基地也按预算自适应步长（dev 2048），普通路径同样受预算限制；失败路径有界。 |
| P1 | 进度回调每 256 个候选上报 `99 + p * 0.4`，每个洞穴/恢复搜索重新从 99.x 开始，导致数值回跳和“反复加载”观感。原调用在 `src/main.js:561-564, 599-602`。 | 显示 `已扫描/总候选`，每 64 个候选让出一次；按 5 个洞穴聚合并用 `Math.max` 保证单调。 |
| P1 | 伙伴恢复路径在无效移动后可再次全场搜索；原同步和 cooperative 调用均未限制候选数。 | 两条伙伴恢复路径都传入 2048 上限；正常帧仍先走局部 `resolveEntityGround`。 |
| P2 | WebGPU 10s 兜底、移动 auto 档锁 low、材质/光栅化/预热让出、沙盒入口异步化和看门狗已存在于基线 44b0c2d；此前审计报告与现有代码均显示这些修复已接入。当前环境无法完成同一页面的 CDP 运行复测。 | 保留，不扩大改动范围；在报告中明确运行时证据缺口。 |

## 实施改动

- `src/world/verdant-placement.mjs:193-198`：新增 `boundedSearchStep`，按矩形候选数计算最小安全步长，避免无界扫描。
- `src/world/verdant-placement.mjs:201-214, 304-338`：同步/cooperative 普通 placement 接受 `maxCandidates`；cooperative 进度按真实总候选显示，64 个候选让出事件循环。
- `src/world/verdant-placement.mjs:249-255, 347-385`：中央基地同步/cooperative 搜索使用有界步长，进度显示 `已检查/总候选`。
- `src/main.js:535-542`：dev placement 统一预算 2048，并新增跨洞穴单调进度汇总。
- `src/main.js:570-573, 590-611`：基地、避难洞和伙伴恢复路径接入预算；伙伴进度不再回退。
- `src/main.js:720-721`：洞穴总数按 `BURROWS.length` 聚合，开始新一轮 placement 时重置进度。

算法没有简化地图，也没有删除失败判定：仍使用真实 `surfaceLayers`、连通组件、支撑环、障碍和 clearance；只在候选规模超预算时使用确定性稀疏采样。

## 修复前后对照

| 项目 | 修复前 | 修复后 |
|---|---:|---:|
| 16m、0.22m 网格普通搜索候选上界 | 约 21,025 | 由预算控制，dev ≤ 2,048（本模型实际 1,369） |
| cooperative 进度 | 每 256 个；每次新搜索回到 99.x | 每 64 个；显示 `n/total`；跨洞穴单调 |
| 中央基地候选预算 | stride 4 但无总量上限 | dev ≤ 2,048，自适应步长 |
| 伙伴恢复 | 可完整扫描 14m 搜索区 | dev ≤ 2,048；正常帧局部解析优先 |
| 真机/托管 Chrome 标题页耗时 | 未取得（环境连接失败） | 未宣称；待主控/真机复测 |

## 验证

- `node --check src/main.js`：通过。
- `node --check src/world/verdant-placement.mjs`：通过。
- `git diff --check`：通过。
- `node tools/run-node-tests.cjs`：**OK 46/46**；22 个 browser/CDP 测试按 runner 规则跳过。
- 算法 benchmark：`outputs/m3d-20261029-placement-benchmark.json`。
- 独立 Chrome/托管 Chrome 尝试与失败证据：`outputs/m3d-20261029-chrome.*`、`outputs/m3d-20261029-mobile-pre.json`。

桌面 28.4s 标题、沙盒 4.0s 的通过基线来自任务提供的 2026-10-28 实测；本轮没有把它重新冒充为当前运行时测量。手机仿真端到端复测仍需要能访问工作树静态服务的 Chrome/WebView 环境。

## 交付状态

本地提交前将再次核对 diff 并只提交本任务源码与报告/证据文件；禁止 push/deploy。主控发布前应在可访问本地服务的托管 Chrome 或真机上复测：标题页进入、5 个洞穴的扫描遍数/候选数、伙伴恢复和沙盒入口。

遗留风险：稀疏采样会降低极端碎片化地形上找到最优点的概率；真实地形仍保留原有 clearance/支撑校验，找不到时沿用现有定义，不生成简化地图。若真机仍慢，应继续采集实际 field 的 `nx/nz/componentSizes` 和每次 `hasPlacementClearance` 耗时，再调 2048 预算或增加空间索引。
