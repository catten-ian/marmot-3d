# dev CDP E2E smoke

零依赖、完全程序化的 Node 24 + TypeScript strip-mode CDP 冒烟工具。它自己启动隔离的 `/usr/bin/google-chrome`、使用独立 CDP 端口和临时 profile；不会连接托管浏览器 `18800`，也不会调用 LLM/AI API。

## 用法

完整默认矩阵（一条命令，按顺序运行 local desktop/mobile 与 official desktop/mobile；继续运行失败项，退出码在全部通过时为 0）：

```bash
node tools/e2e-smoke/suite.ts
```

它会产出 `outputs/m3d-20261030-dev-e2e-smoke/m3d-20261030-dev-e2e-smoke-report.md` 与 `suite-result.json`。可传入 timing 参数对整套矩阵做快速迭代；省略参数时严格使用 120000/15000/10000 ms 默认值。

单轮运行：

```bash
node tools/e2e-smoke/run.ts --target=local --device=desktop
node tools/e2e-smoke/run.ts --target=local --device=mobile
node tools/e2e-smoke/run.ts --target=official --device=desktop
node tools/e2e-smoke/run.ts --target=official --device=mobile
```

迭代时可用 `--load-wait-ms`、`--settle-ms`、`--move-ms` 缩短等待；生产脚本默认分别为 120000 / 15000 / 10000 ms。可用 `--output`、`--static-port`、`--cdp-port` 覆盖输出目录和端口。

### 两段式等待（可自定义）

当页面加载较慢、固定的 settle 死线不够用时，可把点击沙盒入口后的等待拆成**两段独立配置**：

```bash
node tools/e2e-smoke/run.ts --target=local --device=desktop \
  --settle-in-ms=90000 --settle-after-ms=10000
```

- `--settle-in-ms`（第一段）：从点击沙盒入口起，等待加载遮罩退场（进入沙盒就绪）的**上限**。就绪后**立即**进入第二段，不再耗尽预算。
- `--settle-after-ms`（第二段）：就绪之后，再固定静置一段时长，用于采集稳定的 idle 帧率。

只给其中一个也可以，另一个使用默认值（第一段 120000ms、第二段 15000ms）。

**兼容性**：不带这两个参数时走单段模式，等待行为与旧版逐字一致——跑满固定的 `--settle-ms` 死线，不会提前退出。闸门判定在两种模式下完全相同，不会因为放宽等待而把失败算成通过。

实际生效的调度会如实写进 `suite-result.json`（`settleMode` / `settleStage1Ms` / `settleStage2Ms`）和 Markdown 报告的 `Wait schedule` 行，不再写死 “120s/15s/10s”。

每轮在 `outputs/m3d-20261030-dev-e2e-smoke/<timestamp>-<target>-<device>/` 产出 `run-result.json`、`report.md`、`screenshots/*.png` 和 `screenshots/manifest.json`。截图节点包括 loading、title、sandbox-click、sandbox-enter、pointer-lock、idle-end、jump-5s、movement-end（若某阶段失败，仍保留可用截图）。

闸门包括 HTTP 可达、标题页沙盒入口、`window.__game.game.sandbox === true && mode === 'play'`、实际 Verdant 档位 low、非零 RAF、无致命控制台/未捕获异常；手机另验证摇杆与跳跃的双指序列和页面 `touchstart` 同时触点证据。GPU 名称/厂商和后端尽力从游戏 renderer 与 `WEBGL_debug_renderer_info` 读取；CDP 与 Linux `/proc` 无法可靠提供 GPU 利用率时明确写“不可得”。

## 设计

- `cdp.ts`: 原生 WebSocket CDP 请求/事件分发。
- `server.ts`: 只监听 `127.0.0.1` 的静态服务器，支持 MIME、HEAD、Range，映射 `/marmot3d-beta/*` 到仓库根。
- `chrome.ts`: 隔离 Chrome 启停、Target attach、清理。
- `input.ts`: 按真实 DOM 矩形中心注入鼠标和多点触摸。
- `metrics.ts`: Performance metrics、`performance.memory`、Chrome 进程树 RSS/CPU、boot stage 时间线。
- `plan.ts`: 等待调度解析（单段/两段、预算与校验），纯函数便于契约测试。
- `report.ts`: Markdown / JSON / screenshot manifest。
- `suite.ts`: 顺序执行四种 target/device 组合并汇总整体报告。

在本环境中实际验收时，dev Verdant 首屏载入可在数秒内到达标题；点击沙盒后页面会继续执行“寻找安全站位”协作搜索，截图/报告会保留该中间阶段。完整默认 15 秒 settle 仍可能不足以让此仓库当前低档场景完成进入沙盒；这会使 `enteredSandbox` 闸门如实失败而不会被算作通过。此时可用 `--settle-in-ms` / `--settle-after-ms` 两段式等待，把“等就绪”和“就绪后静置”分别调到足够长，再复测该闸门。
