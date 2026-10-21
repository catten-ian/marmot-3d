# Beta 运行时性能基线、优化与复测报告

日期：2026-10-22（Asia/Shanghai）  
范围：仅 beta 工作树 `codex/beta-smart-fox-20261021`；未部署、未 push。  
工作树：`/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021`

## 1. 环境与方法

- OpenClaw 托管 Chrome `Chrome/147.0.7727.137`，CDP `http://127.0.0.1:18800`，协议 1.3；Linux x64，Node `v24.19.0`。
- 固定使用 `?webgl=1` 的 WebGL2，保证基线/复测后端一致；没有用本机自起 headless Chrome。测量服务器在进程内启动，端口 `8340`。
- 每个标准场景 4 秒预热、连续采样约 25 秒；桌面 `1280×720 / DPR 1`，移动模拟 `390×844 / DPR 3 / 触控`。移动模拟不是实体手机。
- 高负载场景使用第 12 关、9 狐、同伴、战斗特效、26,000 株植被实例。采样记录 rAF 帧间隔、主循环回调耗时、Long Task、JS heap 采样、`renderer.info` draw calls / triangles、render wall time；高负载场景另开 CDP CPU profile。
- 前后场景、机位、关卡、fox layout 和采样时长一致；after 标准样本执行时自适应档位为 T0。额外压力探针分开新建自有标签运行，并放在标准场景之后，不纳入标准对照表。

基线代码为 `e4a3d0b9a68f1cd83200b7c73e0c6e918d0a4baa`；优化实现为 `cf5774c1cca66c6665be486ada24eff82a3bab6f`；后续测量脚本修正提交为 `8e39398`、`157639c`、`8ebf43e`。基线脚本和数据由 `73ec5bb` 先行提交。

## 2. 基线结果

| 场景 | 画面 / 实际静态预算 | 平均 FPS | P50 / P95 帧间隔 | >20ms / >50ms 帧比例 | 最差帧 | draw calls/帧 | 三角形/帧 | render ms/帧 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 桌面 | 1280×720，DPR 1，阴影图 2048 | 58.67 | 16.7 / 19.2 ms | 2.785% / 0.340% | 160.4 ms | 585.151 | 544,462 | 4.200 |
| 移动模拟 | 390×844，DPR 3，实际 DPR 1.35，阴影图 1024 | 59.63 | 16.7 / 17.9 ms | 0.940% / 0.134% | 100.3 ms | 485.938 | 471,464 | 3.847 |
| 高负载 | 1280×720，DPR 1，第 12 关、9 狐 | 59.32 | 16.7 / 19.1 ms | 1.618% / 0.135% | 168.8 ms | 798.622 | 695,371 | 6.128 |

## 3. 热点证据与未改路径

1. 没有重复/嵌套的游戏主渲染循环。主循环递归调用一次；另一个 RAF 是植被风摆 uniform 更新，不是第二个场景渲染循环。
2. 第一人称每帧为 2 个预期 render pass：主场景与 ViewModel 独立叠加场景。`viewModel.render` 计数与主循环一致；这不是重复调用主场景。合并 pass 会改变第一人称模型的深度遮挡语义，因此本轮不冒险改造。
3. 高负载 draw calls 约 799/帧、三角形约 695k/帧、render wall time 6.128ms/帧，高于桌面常规场景。CDP profile 的有效热点位于 Three.js WebGL 渲染路径：`renderObject`、`renderBufferDirect`、`getParameters`、`updateMatrixWorld`、`setProgram`、`projectObject`。因此优化选择是运行时渲染预算控制，没有凭怀疑重写狐狸 AI/寻路或大范围改实体代码。
4. 高负载主 frame 回调均值 6.884ms、P95 9.9ms，曾出现 168ms Long Task 并重合最差帧；其后堆采样下降，但 Chrome 未提供 `gc` PerformanceObserver 类型，不能据此确认为 GC，也没有将临时对象分配认定为已证实热点。
5. 正常基线的静态 profile 已有设备/DPR/阴影预算，但没有根据持续帧时间变化。故优化在不修改 `getRenderProfile()` 的静态策略基础上增加独立的动态覆盖档位。

## 4. 优化内容与提交

### `cf5774c` — `perf(beta): add hysteretic runtime quality adaptation`

- 新增低开销控制器：定长 typed-array 环形窗口；每 500ms 汇总最近 3 秒帧时间，忽略超过 250ms 的挂起/调试停顿。
- 当窗口平均帧间隔 ≥20.5ms 或 P95 ≥24ms 持续累计 4 秒，逐级降档；当平均 ≤17.5ms 且 P95 ≤20.5ms 持续 8 秒，逐级恢复。每次切换至少间隔 6 秒，一次只变一级，避免瞬时掉帧触发和反复抖动。
- T0 原始设备预算；T1 DPR ×0.85（下限 0.75）；T2 阴影图边长减半（不低于 512）；T3 关闭主实时阴影。桌面触发序列示例：DPR `1→0.85`、阴影图 `2048→1024`、最后关闭阴影；移动预算按既有 profile 同比例逐级调整。恢复时反向逐级复位。
- resize 与设置输入模式切换均重新以静态 profile 为基准叠加当前动态档位，避免动态预算被覆盖。阴影图变化时释放旧贴图并标记重绘。
- 当前档位通过 HUD FPS 提示、`window.__game.adaptivePerformance()`、`window.__game.adaptiveTransitions` 与 console 切换日志诊断。
- 将迟滞和静态预算不变的逻辑测试合并进现有渲染器消费者测试，不增加 Node 测试用例总数。

### 测量工具提交

- `8e39398` 将扰动性的压力探针排在标准三场景之后，避免影响常规测量顺序。
- `157639c` 将压力画面截图延后至最高降档附近，以直接检查阴影关闭档。
- `8ebf43e` 增加仅运行压力探针的选项，方便复查最高档和恢复，不必重复标准采样。

## 5. 同脚本标准复测对比

标准 after 数据来自 `clean-final.json`，与 baseline 的后端、尺寸、采样时长、关卡和机位一致。百分比为 `(after / baseline - 1) × 100%`；比例变化可能受单次 Chrome/OS 调度与 60Hz 垂直同步影响，不能仅凭这组数据将差异全归功于控制器（标准样本期间 T0，没有触发质量变化）。

| 场景 | 平均 FPS | P95 帧时 | >20ms | >50ms | 最差帧 | draw calls/帧 | 三角形/帧 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 桌面 | 58.67 → 60.00（+2.27%） | 19.2 → 17.4ms（-9.38%） | 2.785% → 0.067%（-97.59%） | 0.340% → 0（-100%） | 160.4 → 20.2ms | 585.151 → 569.360（-2.70%） | 544,462 → 532,905（-2.12%） |
| 移动模拟 | 59.63 → 60.00（+0.62%） | 17.9 → 17.4ms（-2.79%） | 0.940% → 0（-100%） | 0.134% → 0（-100%） | 100.3 → 19.1ms | 485.938 → 485.719（-0.05%） | 471,464 → 471,875（+0.09%） |
| 高负载 | 59.32 → 60.04（+1.21%） | 19.1 → 17.4ms（-8.90%） | 1.618% → 0.266%（-83.56%） | 0.135% → 0（-100%） | 168.8 → 25.7ms | 798.622 → 799.031（+0.05%） | 695,371 → 695,747（+0.05%） |

标准复测三种场景均未跨过帧时间门槛，档位保持 T0；无 console error、未捕获异常或 Log error。移动模拟达到约 60 FPS（高于要求的 30 FPS），桌面达到 60 FPS。最差帧及长帧比例在这次复测明显较低，但这不是自适应降档产生的：该次样本没有发生降档，且单次运行不能证明系统调度/长任务已被优化。draw calls、三角形和 render ms 基本持平，说明未通过无证据地削减场景负载换取结果。

## 6. 自适应触发与视觉检查

受控探针在自有标签中以 70ms 周期执行约 32ms 主线程忙循环，持续 19 秒，模拟明确的持续掉帧；这不是自然游戏负载或 GPU 基准。探针记录帧平均值/P95 和档位变化：

| 档位变化 | 时间戳（页面时钟） | 触发窗口平均 / P95 | 生效质量 |
|---|---:|---:|---|
| T0 → T1 | 13,039ms | 18.07 / 33.3ms | DPR 0.85× |
| T1 → T2 | 19,039ms | 18.97 / 33.4ms | 阴影图 1024² |
| T2 → T3 | 25,040ms | 18.41 / 33.3ms | 实时阴影关闭 |
| T3 → T2 | 36,307ms | 16.67 / 16.8ms | 恢复 1024² 阴影图 |
| T2 → T1 | 44,307ms | 16.67 / 16.7ms | DPR 保持降档，阴影图恢复原预算 |
| T1 → T0 | 52,307ms | 16.67 / 16.7ms | DPR 1、阴影图 2048²、阴影恢复 |

结束诊断为 T0，`pixelRatio=1`、`shadowMapSize=2048`、`shadows=true`。压力截图的诊断确认 T3（`pixelRatio=0.85`、`shadows=false`）；视觉检查可见分辨率稍软且投影消失，HUD/角色仍可辨、画面无黑屏或材质缺失。该视觉退化只发生在持续实测掉帧的最高档，属于动态档位行为；恢复截图可见阴影返回。正常三场景不降档，维持原有视觉预算。

## 7. 测试、复现与截图

### 开始 / 结束测试

- 开始（优化前）：`node tools/run-node-tests.cjs` → `OK 30/30`；22 个浏览器/CDP 测试按项目设置 skip。`node tools/public-shell.cjs --check` → rev14 校验通过；`node tools/test-beta-contract.cjs` → 全部断言通过。
- 结束（最终工作树）：`node tools/run-node-tests.cjs` → `OK 30/30`（22 个浏览器/CDP 测试 skip）；`node tools/public-shell.cjs --check` → rev14 校验通过；`node tools/test-beta-contract.cjs` → 全部断言通过。
- 以下改动文件均通过 `node --check`：`src/core/performance.js`、`src/main.js`、`src/world/scene.js`、`tools/perf-managed.cjs`、`tools/test-graphics-renderer-consumer.cjs`。

### 复现命令

```bash
node tools/perf-managed.cjs --tag=baseline
node tools/perf-managed.cjs --tag=clean-final
node tools/perf-managed.cjs --tag=adaptive-check --probe-adaptive --only-adaptive
```

测量器只通过 `http://127.0.0.1:18800` 创建本次自有 Chrome 标签并在结束时关闭。标准采样和压力探针均已完成；没有遗留本次 `8340` 页面标签。

### 关键截图（绝对路径）

基线：
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/baseline-desktop.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/baseline-mobile.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/baseline-heavy.png`

标准复测：
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/clean-final-desktop.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/clean-final-mobile.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/clean-final-heavy.png`

压力探针最高降档与恢复：
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/adaptive-check-adaptive-stressed.png`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/adaptive-check-adaptive-recovered.png`

机器可读对比及逐帧原始数据：
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/comparison.json`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/baseline.json` 与 `baseline-{desktop,mobile,heavy}.json`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/clean-final.json` 与 `clean-final-{desktop,mobile,heavy}.json`
- `/home/fame/code/marmot3d/marmot-3d/m3d-beta-smart-fox-20261021/outputs/perf/adaptive-check-adaptive-probe.json`

## 8. 尚未验证 / 后续建议

- 只验证了强制 WebGL2，未量化默认 WebGPU 路径；WebGPU 不同 GPU/驱动的 render pass 和瓶颈可能不同。
- 移动结果来自托管 Chrome 设备模拟，不能代替真实 Android/iOS GPU 与功耗/温控数据。
- 自适应实测是可控的主线程忙循环触发，不是自然场景持续 GPU 饱和。证明了档位触发、阴影贴图/全局阴影切换与恢复，不代表真实游戏掉帧一定会得到相同幅度的 FPS 增益；标准运行档位保持 T0。
- 本机不支持 GC PerformanceObserver；一次 Long Task 与堆变化不能确认为 GC。可在支持 GC 事件的浏览器或用 DevTools allocation timeline 针对性复测。
- 这一轮没有证据支持改 LOD、KTX2 或 Draco：高负载 profile 首要采样在 Three.js 的遍历、材质/参数与 draw path，而非加载/解码。下一步优先记录各物体类别的 draw-call 贡献、相机视锥外对象和材质切换；若后续证明网格面数/远处狐狸绘制占主导，再做 LOD/frustum A/B。只有网络传输或纹理解码被量化为加载瓶颈时，才评估 KTX2/Draco 的收益与新增解码成本。
