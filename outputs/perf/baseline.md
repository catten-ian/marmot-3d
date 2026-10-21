# Beta 运行时性能基线

- 采集时间：2026-10-22（Asia/Shanghai）。
- 范围：分支 `codex/beta-smart-fox-20261021`，被测代码 tip `e4a3d0b`；只测 beta（`?version=beta`）。
- 浏览器：OpenClaw 托管 Chrome `Chrome/147.0.7727.137`，CDP `http://127.0.0.1:18800`，协议 1.3；本机 Linux x64，Node `v24.19.0`。
- 后端：WebGL2 强制 `?webgl=1`，非 WebGPU。内嵌静态服务器由 `tools/perf-managed.cjs` 在进程内启动，端口 `8340`。每个场景只创建/关闭本次自有标签。
- 每场景：4 秒预热后连续记录约 25 秒；测量 rAF 回调开始间隔、主 frame JS 回调耗时、Long Task、堆使用趋势、渲染器 `renderer.info` 的调用/三角形和 render wall time。高负载路径额外开启 CDP Profiler。
- 截图：`baseline-desktop.png`、`baseline-mobile.png`、`baseline-heavy.png`（共 3 张）。

## 场景与测量值

| 场景 | 视口 / 输入 | profile (DPR / 阴影图) | 活动狐 | 平均 FPS | P50 / P95 帧间隔 | >20 ms / >50 ms | 最差帧 | draw calls/帧 | 三角形/帧 | render ms/帧 |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 桌面 | 1280×720，DPR 1，WebGL2 | 1 / 2048，阴影开，AA 开 | 6 | 58.67 | 16.7 / 19.2 ms | 2.785% / 0.340% | 160.4 ms | 585.2 | 544,462 | 4.20 |
| 移动模拟 | 390×844，DPR 3，触摸模拟 | 1.35 / 1024，阴影开，AA 关 | 6 | 59.63 | 16.7 / 17.9 ms | 0.940% / 0.134% | 100.3 ms | 485.9 | 471,464 | 3.85 |
| 高负载 | 1280×720，DPR 1，WebGL2 | 1 / 2048，阴影开，AA 开 | 9（第 12 关） | 59.32 | 16.7 / 19.1 ms | 1.618% / 0.135% | 168.8 ms | 798.6 | 695,371 | 6.13 |

说明：移动端是托管 Chrome 的设备/触控模拟，不是实体手机，不能代替真实移动 GPU 测试。应用实际 DPR 1.35，Canvas 526×1139。高负载画面同时有 9 只狐狸、默认 26,000 株植被实例、同伴和周期战斗特效；为避免死亡结束场景，测量使用测试态无敌并将环境阵风置零（未改生产玩法配置）。AI 保持运行。相机固定于开阔场地，机位为第一人称。

## 热点证据与检查

- `renderer.info` 在桌面/移动/高负载场景均测得 **2 次 render pass/帧**；同时 `ViewModel.render` 计数持续增长。源码显示这是一遍主场景 + 第一人称 ViewModel 独立场景叠加，并非意外重复游戏循环。
- `requestAnimationFrame` 回调计数中，主循环 `frame` 和 `Scenery` 风摆回调各自持续一次；主循环尾部只递归调度一个 `frame`。`orientationchange` 是事件触发的单次 resize，沙盒进入是一次性延迟回调。没有发现重复/嵌套主渲染循环或每帧重复 resize。
- 高负载绘制成本较桌面基线增加：draw call +36.5%，三角形 +27.7%，提交 render wall time 4.20→6.13 ms/帧；DPR 1 下仍有 26,000 个草实例（实例化绘制）。
- 高负载 CDP CPU 采样热点主要在 Three.js WebGL 渲染：`renderObject`、`WebGLRenderer.renderBufferDirect`、`getParameters`、`updateMatrixWorld`、`projectObject`、`setProgram`。这是渲染工作量的实测证据；没有据此擅自减少植被或全局画质。
- 高负载主 `frame` JS 回调均值 6.88 ms，P95 9.9 ms；最高 167.2 ms。Long Task 观测到一个 168 ms 任务，与最差帧/长回调重合；其后的 500 ms 堆样本下降约 6.6 MB。该组合与 GC/堆整理相符，但 Chrome 未提供 `gc` PerformanceObserver 类型，单次堆采样不能证明该任务就是 GC，因此暂不把长帧归因于 GC，也不以此为由改玩法/AI。
- 真实业务的 `Fox` 每帧导航/碰撞代码存在临时集合/对象构造，但当前 CDP CPU Top 20 未将其识别为主热点；GC 事件级采集也不可用。故这轮基线没有“凭怀疑重写”该路径，后续若处理需再做定向 profile/A-B。
- 三场景无浏览器 console error、Runtime exception 或 Log error。FPS 接近 60 Hz；桌面与高负载 P95 帧间隔约 19 ms，仍有少量 >50 ms 的孤立长帧，基线未满足稳定 60 FPS。

## 逐场景 JSON 与复现

- 汇总：`outputs/perf/baseline.json`
- 桌面：`outputs/perf/baseline-desktop.json`
- 移动：`outputs/perf/baseline-mobile.json`
- 高负载（含 CPU profile 与逐帧数据）：`outputs/perf/baseline-heavy.json`
- 复现命令：`node tools/perf-managed.cjs --tag=baseline`

初始回归：`node tools/run-node-tests.cjs` → `OK 30/30`（22 个浏览器/CDP 用例按项目约定 skip）；`node tools/public-shell.cjs --check` → rev14 校验通过；`node tools/test-beta-contract.cjs` → 全部断言通过。
