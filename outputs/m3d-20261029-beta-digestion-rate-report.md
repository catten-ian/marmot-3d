# m3d-20261029-beta-digestion-rate 验收报告

## 任务与验收条件对照

- 速度阈值：Beta 默认 `BETA_TUNE.chewRunSpeedThreshold = PLAYER.speed * 1.07 = 5.136 m/s`。`PLAYER.speed` 在 `src/core/config.js` 中为 4.8 m/s；`src/main.js` 用 `speedMul *= BETA_TUNE.moveSpeedMul`（默认 1.07）驱动普通移动，并在 `p.speed = Math.hypot(controller.velocity.x, controller.velocity.z)` 记录当前水平速度。
- 键鼠“奔跑”对应：不按 Shift 时 `sprinting` 为 false，控制器使用普通 `speedMul`；按 Shift 会在 `src/main.js` 中乘 1.42，速度超过阈值后停止消化。
- 触屏“奔跑”对应：`src/core/touch-controls.js` 在摇杆行程 `move.mag >= sprintThreshold` 时设置 `controller.touchSprint`；因此摇杆不出内圈属于普通移动，使用阈值内的减速消化，进入内圈的疾跑速度超过阈值后停止消化。
- 静止时速率保持 `BETA_TUNE.chewPerSec`。
- 阈值内速率按当前速度线性下降；达到阈值仍可消化，速率为 `chewRunRateRatio`（默认 0.25）乘 `chewPerSec`。
- 当前速度大于阈值时 `chewed = 0`，口中储备、stamina、fat 都不变。
- base/shelter 洞内仍分别使用 `mainBurrowChewPerSec` / `temporaryBurrowChewPerSec`，不受速度规则影响。
- grazing 仍暂停洞外口腔消化。
- `src/main.js` 仍只在 `IS_BETA` 分支调用 `chewMouth`；stable/dev 的 `p.energy` 静止回补路径未改动。

## 实际改动

- `src/core/stamina.mjs`：新增纯函数 `resolveMouthChewRate`；扩展 `chewMouth` 接收当前速度、阈值和奔跑下限比例；保留洞内和 grazing 语义。
- `src/core/beta-tuning.js`：新增 `chewRunSpeedThreshold`、`chewRunRateRatio` 两个 Beta 调参键。
- `src/main.js`：Beta 咀嚼调用传入 `p.speed`。
- `src/admin/tuning-schema.mjs`：后台加入两个数值条目。
- `tools/test-beta-digestion-rate.mjs`：新增 7 个 node:test 契约测试，覆盖静止、阈值内单调下降、阈值边界、疾跑/boost/overdrive 超阈值、洞内、grazing。

## 后台调参

- `beta.chewRunSpeedThreshold`：口腔消化奔跑速度阈值，单位 m/s。默认 5.136；当前速度小于或等于此值可消化，大于此值完全停止。
- `beta.chewRunRateRatio`：达到阈值时的口腔消化速率比例，范围 0～1，默认 0.25。改为 0 会让阈值处速率为 0；改大则阈值处仍保留更多消化速度。显式后台载荷会通过现有 runtime-config 白名单即时写入 `BETA_TUNE`。

## 验证

- `node --check src/core/stamina.mjs src/core/beta-tuning.js src/main.js src/admin/tuning-schema.mjs tools/test-beta-digestion-rate.mjs`：通过。
- `node --test tools/test-beta-digestion-rate.mjs`：7/7 通过。
- `node --test tools/test-stamina.mjs tools/test-runtime-config.mjs tools/test-admin-tuning.mjs`：22/22 通过。
- `node tools/run-node-tests.cjs`：入口报告 `OK 88/88`；其中 22 个需要 Chrome/CDP 的浏览器测试按项目入口跳过，无失败。
- `git diff --check`：通过，行尾为 LF。

## 未完成项与已知问题

- 未做视觉验证及原因：本次改动是 Beta 纯数值/纯逻辑和后台 schema，没有渲染或 UI 布局变化；验收以 node 契约和全量 node 测试为主。
- 当前速度取控制器水平速度，不含 `externalVelocity` 阵风分量；这是现有 `p.speed` 的定义，也避免外力造成消化阈值误判。
- 旧的无 `speed` 纯函数调用仍保留 `running: true` 的停止兼容行为；Beta 主循环已传入实际速度。

## 版本与发布状态

- 工作树：`/home/fame/code/marmot3d/m3d-beta-digestion-rate-20261029`
- 分支：`feat/beta-digestion-rate-20261029`
- base SHA：`d817cea031a4728d4706f7297b70b9a804753fb3`
- commit hash：bc54d52e3ab546b5f95674bed91090928a6a1c6a（实现提交）
- push/deploy：未 push，未部署；未改 Caddy/systemd/线上文件，未改 stable/dev 分支或版本戳/public shell。

## Codex 自评

已完成目标行为、后台参数接入、纯逻辑抽取、契约测试和全量验收。风险主要是移动速度调参与消化阈值是两个独立后台键；若运营修改 `beta.moveSpeedMul`，需要同步评估或调整 `beta.chewRunSpeedThreshold`。
