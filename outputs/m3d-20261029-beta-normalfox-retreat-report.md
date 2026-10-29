# m3d-20261029-beta-normalfox-retreat

- base: `10114ebddf13fd7da9f88597af59eedac4d2e450` (rev50)
- branch: `fix/beta-normalfox-retreat-20261029`
- local commit recorded below; not pushed and not deployed

## 根因

静态检查确认普通狐在 `src/entities/fox.js:1020-1035` 进入撤退时调用 `chooseRestPoint`。旧选择逻辑在 `src/core/fox-motion.js:185-210` 只把洞穴半径外移 `b.r + 3.5`。运行时 `burrowDefs` 来自缩放后的洞穴定义；同一文件 `src/entities/fox.js:960-968` 的 `_groundSteer` 将洞穴作为 `b.r + 2.5` 的障碍，再由 `src/core/fox-motion.js:48-75` 追加 `clearance = max(1.2, speed * .45)`。普通狐撤退速度为 6 m/s，故 shelter-b 的旧目标约在洞口外 6.65 m，而导航避让带至少约为 `3.15 + 2.5 + 2.7 = 8.35 m`；加上到达半径 1.5 m 后目标仍不可达。实测证据 `normal-fox-fullhp-live.json` 的旧休息点 `{x:24.407,z:14.780}` 与 22 秒绕行轨迹吻合。到达判断在 `fox.js:730` 只检查目标半径，目标本身被 steering 推开，所以永远不能进入 `rest_safe`。同时 `hit()` 在 `fox.js:1306-1327` 对 `retreating` 锁最低 HP 1，形成长期无敌和无驱退反馈。

## 修复策略

1. `chooseRestPoint` 增加 beta 显式障碍输入：目标点至少避开每个导航障碍的 `obstacle.r + speed*.45 + arriveRadius + 0.35`，并尝试背玩家方向、两侧和反向四个固定候选；每次撤退只选择一次，不逐帧抖动。候选会夹在边界内，并避开岩石/洞穴。
2. `Fox._navigationObstacles` (`fox.js:960-968`) 复用与 `_groundSteer` 相同的障碍半径，避免选择器和移动器口径漂移。
3. beta-only `stepRetreatProgress` (`fox-motion.js:248-256`) 记录实际目标距离；`fox.js:731-741` 在 1.75 秒无进展或 18 秒总时限时，从狐狸当前真实位置进入一次 `rest_safe`，不瞬移、不伪造位置到达。入口携带 `arrival|stalled|timeout` 原因；stable/dev 不启用进度兜底。
4. beta 主控回调 `main.js:1684-1695` 在非正常到达时显示“威胁已解除 · 已安全撤退”，计数和日志仍只发生一次；休息回血与归队仍由既有 `stepRestSafe/exitRestSafe` 完成。

## 可见行为

狐狸从 HP 6 连续受击到 HP 1 后进入 `retreat`，向可达目标真实移动；到达目标或 beta 有界兜底后进入 `rest_safe`，驱退提示/计数恰好一次，HP 在休息期间回血，休息结束回到 `roam`，不再永久锁 HP 1。

## 测试

- `node --check src/core/fox-motion.js src/entities/fox.js src/main.js`: 通过。
- `node --test tools/test-fox-repel.cjs`: **19/19 通过，0 跳过**。新增覆盖：beta 导航余量、停滞/超时迁移；保留原有撤退、驱退计数一次、回血、归队、逃跑/重生语义。
- `node --test tools/test-normal-fox-sandbox.cjs tools/test-fox-tactics.cjs`: **11/11 通过**。
- `node tools/run-node-tests.cjs`: **88/88 通过**；**22 个浏览器/CDP 测试跳过**，原因是 runner 启动独立 Chrome 调试页失败（环境错误 `Chrome 调试页面启动失败`）。
- `git diff --check`: 通过。

## Chrome/WebGL 复验

产物：

- [browser-retreat.json](browser-retreat.json)
- [browser-retreat.png](browser-retreat.png)

通过已有 Chrome CDP `127.0.0.1:18800` 打开本地同源 beta 页面，渲染后端为 `WebGLRenderer`，GL vendor 为 `WebKit`。在页面中创建满血 6 的非 dummy 普通狐，按 1.25 伤害逐次命中并在每次命中后运行真实 `Fox.update` 导航循环；未调用 `_enterRestSafe` 冒充到达。时间线关键点：第 4 次命中后 `hp=1,state=retreat,retreating=true,restPoint={x:28.06,z:14.68}`；约 33.75 秒时进入 `rest_safe`，约 34.75 秒时 `totalRepels=1`；随后 HP 1.42→6.0 回满，约 39.75 秒回到 `roam`，`retreating=false`，之后持续 roam。JSON 中 `errors=[]`，`totalRepels` 全程只为 1。

这次 CDP 复验使用了页面内 Fox 类和真实导航/状态机；由于现有共享 Chrome 页面暴露的 `foxes` 集合不是可写的主循环数组，攻击阶段用 CDP 页面内的 `Fox.hit` 代替 DOM 鼠标注入，故主控仍需独立执行一次真实鼠标端到端复验。此前独立导航 runner 的失败已原样保留为环境限制，不把这次逻辑复验冒充线上鼠标验收。

## stable/dev 对照

- 选择器在未传入 beta 障碍列表时保留原有纯函数分支；`Fox._enterRetreat` 仅在 `IS_BETA` 传入障碍。
- 停滞/超时分支由 `IS_BETA` 守卫；stable/dev 不改变撤退状态机、HP 口径、驱退回调或 SmartFox 文件。
- 未修改 `smart-fox.js`、`smart-fox-core.mjs`、版本戳、shell、资产和部署配置。

## 未完成项

主控需要在其真实线上 Chrome 同源场景复跑一次“沙盒生成非 dummy → 真实鼠标连续攻击 → 观察 30 秒以上”的最终人工验收；本工作树未推送、未部署、未改 Caddy/systemd。
