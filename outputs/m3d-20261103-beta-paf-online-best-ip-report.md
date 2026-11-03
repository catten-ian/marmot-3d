# Marmot3D Beta PAF 在线榜 / 噪声返修报告

- task：`m3d-20261103-beta-paf-online-best-ip`
- branch：`fix/beta-paf-online-best-ip-20261103`
- base/current 起点：`6492aed3a39227c6dd6c38073b7bf69d7b77cbc2`
- 本地 commit：最终 HEAD（完整 SHA 见 `git rev-parse HEAD`）
- 范围：仅 Beta PAF 在线榜、PAF 噪声纯逻辑/入口 QA、账号/PAF 测试与报告；未 push、未 PR、未 deploy，未修改 Stable/Dev/Caddy/systemd/线上文件。

## 修复结论

### A. PAF 在线榜 personal-best

- 初始线上实现是每次有效提交无条件替换同 IP 纪录；本返修改为 `score > current.score` 才原子重写。
- 新分数 `<` 或 `==` 当前最好时保留旧 JSONL 与旧内存值，返回 HTTP 200 的诚实回执：`accepted:false`、`reason:"not_better"`、`best`、当前 `rank/total/entry`。
- 新高分返回 `accepted:true`、`best`、当前 `rank/total/entry`；不同 IP 仍独立共存。
- 提交队列在串行临界区内比较和写盘；原子临时文件 + `rename` 失败不更新 Map，旧值继续生效。
- 重启仍只加载每 IP 的一条当前最好纪录；公开响应与文件不暴露明文 IP/HMAC key。
- 客户端新增 `not_better` 状态：结果文案显示“未超过个人最好”，不显示“新纪录”；该状态隐藏 retry，后续 `retry()` 只刷新在线榜，不重复提交已拒绝分数。网络错误仍保留 payload 并可重试。
- 在线榜 UI 文案改为“每个 IP 仅保留历史最高分”。

### B. PAF 噪声状态边界

- `phase === 'wind'` 不再直接使用扑击噪声：静止准备为 quiet/stand（mode=`stalk` + `quietPreparation=true`），移动且非冲刺为 `stalk`，移动且冲刺为 `sprint`。
- 只有 `phase === 'lunge'` 使用 `lunge` hearing/noise；保留 `threatening = (wind || lunge)`，因为它仍是猎物 FSM 的逃跑/zigzag 视觉与状态边界，不再决定噪声档位。
- `lungeRange` 通过集中配置的 `lungeHearingRadiusMinScale=0.8`、`lungeHearingRadiusMaxScale=1.2` 相对 `detectLunge=17` 线性映射：默认距离 `17m`，最短 `13.6m`，最长 `20.4m`，单调且可调；未散落硬编码。
- `pafNoiseConfig` 将实际 `hearingRadius`、`noiseCoef`（及 wind 的视觉兼容 `visionMode`）传入 `perceptionCue`；`cueRadii` 支持 override，不会再被固定 `cfg.detectLunge` 覆盖。
- 线上 PAF `lungeTime: 0.32` 保持不变。

## 证据与精确结果

### Node 检查

改动的 10 个 JS/MJS/CJS 文件全部 `node --check` 通过：
`server/accounts/server.mjs`、`server/accounts/paf-test.mjs`、`src/core/paf-noise.js`、`src/core/paf-online-leaderboard.mjs`、`src/core/predator-prey.js`、`src/play/play-as-fox.js`、`tools/qa-paf-online-leaderboard.cjs`、`tools/test-paf-online-leaderboard.mjs`、`tools/test-paf-touch-contract.cjs`、`tools/test-paf-pounce.cjs`。

原始记录：`outputs/m3d-20261103-beta-paf-online-best-ip-node-check.txt`。

### 相关 Node 回归

命令覆盖账号、PAF HTTP/磁盘、客户端在线榜、PAF 输入/预判/感知/时间/相机/FPV/本机榜及反馈代理：

```bash
node --test server/accounts/test.mjs server/accounts/paf-test.mjs \
  tools/test-accounts-frontend.mjs tools/test-admin-feedback-proxy.mjs \
  tools/test-paf-online-leaderboard.mjs tools/test-paf-touch-contract.cjs \
  tools/test-paf-prey-mind.cjs tools/test-paf-pounce.cjs \
  tools/test-paf-input-route.cjs tools/test-paf-timed-range.cjs \
  tools/test-paf-leaderboard.cjs tools/test-paf-camera.cjs \
  tools/test-paf-fpv-viewmodel.cjs
```

结果：**111 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo**。原始记录：`outputs/m3d-20261103-beta-paf-online-best-ip-node-tests.txt`。写盘失败用例故意制造 `EISDIR`，堆栈是预期注入，断言确认 HTTP 失败且旧值仍在。

关键契约覆盖：同 IP `1→0→1` 保留 1、`2` 才替换；不同 IP 共存；重启后文件只含当前最好；原子写失败回滚；`accepted/best/rank/total` 真实；quiet/stalk/sprint/wind/lunge 与 min/default/max hearing radius；传入 `perceptionCue` 的半径等于状态半径；拒绝提交不产生 retry POST。

### 真实 Beta 入口浏览器

```bash
CHROME_PATH=/usr/bin/google-chrome node tools/qa-paf-online-leaderboard.cjs
```

结果：**37/37 checks pass，consoleErrors=0，page exceptions=0**；覆盖真实独立 accounts 服务、真实 Beta `index.html`、1280×720 与 390×844，独立临时 Chrome profile/CDP，未连接共享 18800。证据：`outputs/m3d-20261103-beta-paf-online-leaderboard/qa-results.json` 与 6 张截图。

入口关键观测：

- 按住攻击静止：`phase=wind`、mode=`stalk`、quiet radius `0.9`；按住并潜行移动：`stalk` radius `3`；按住并冲刺移动：`sprint` radius `9`；松开进入真实 `lunge`：默认 radius `17`。
- 真实 lungeRange 档位：min `13.6`、default `17`、max `20.4`，严格递增。
- 在线榜真实服务：页面首轮提交 `0` 成功；同 IP 通过真实服务提交 `1` 接受；页面下一轮 `0` 收到 `not_better` 且 `best=1`、榜仍为 `1`；不同 IPv6 IP 的 `0` 共存；账号服务关闭时页面显示失败并保留本机成绩，恢复后 retry 成功。
- 页面异常、console error、桌面/移动结果面板与在线榜布局检查均为 0/通过。

## 限制与交付边界

- 浏览器使用 headless Chrome 设备仿真，不等同物理手机/GPU 性能测试；入口仍是真实 Beta 页面和真实本地 accounts HTTP 服务，不是独立模块替代。
- 主控需独立复验、合并和部署；本 worker 不代表线上已部署，也未修改线上数据。
- 任务板按协议追加交付记录并移动至 `review/`；不标记 accepted/deploy。

## 2026-11-03 23:00 新增需求交付

### 名字规范与数据模型

- PAF 名字统一由 `src/core/paf-name.mjs` 校验：先 `trim`，长度按 Unicode code point 计数，允许 `\p{L}` Unicode 字母、`\p{N}` 数字和 `_`，长度 5–24；拒绝空白、控制字符、其它标点及空名字。客户端结果页和 `src/core/paf-online-leaderboard.mjs` 校验，服务端 `server/accounts/server.mjs` 再次独立校验，不信任客户端。
- 线上 `paf-scores.jsonl` 继续以服务端规范化 IP 的 HMAC key 去重，每个 key 只有一条记录；记录现在包含 `name`、`score`、固定 `durationMs=120000`、`completionMs`、服务器 `submittedAt`。旧行缺少名字/完成时间时兼容加载，完成时间按 120000ms，旧匿名记录公开显示为“匿名玩家”，不暴露 key/IP。
- 线上名字在当前记录集合中唯一；同名返回 HTTP 409 `code=name_taken`。同一 IP 一旦绑定名字，提交其它名字返回 HTTP 409 `code=ip_name_mismatch`，不会静默改名。相同 IP 仍只有 `score >` 才替换，低分/平分保留旧记录；原子写失败不更新内存。
- 本地榜保持同一浏览器存储，允许多个不同名字并存；同名更优候选先返回 `needsConfirmation`，只有明确点击“确认替换本机记录”才覆盖；低分/平分保留旧记录。版本 1 旧记录可读取并继续保留。

### 排序、UI 与模式切换

- 服务端与本地统一按 `score` 降序、同分 `completionMs` 升序（最后一只捕获越早越前）、`submittedAt` 升序及稳定 key/name 兜底排序；公开条目/结果回执带 `name` 与 `completionMs`，客户端可验证。
- 限时结果不再自动提交：必须输入有效名字后点击“提交排行榜”；无效名在结果面板内明确提示。结果页支持本机同名替换确认、线上冲突诚实报错/重试。
- PAF 限时排行榜面板加入桌面/移动均可用的 `×` 关闭按钮，带可访问名称 `关闭排行榜`，按钮 `type=button`，不会触发提交。
- 结果页新增“继续沙盒模式（非限时模式）”；点击会销毁限时 PAF 状态并进入主游戏真实 `game.sandbox=true`、`game.mode=play`，不发起再次提交、不污染线上限时榜。原有“再来一局”“退出扮演”保留。
- 既有噪声修复、`lungeTime: 0.32`、同 IP personal-best 逻辑未回退。

### 精确验证

- 改动的 JS/MJS/CJS 共 **12/12 `node --check` 通过**（含 `src/core/paf-name.mjs`、PAF UI/客户端、账号服务、契约测试和真实入口 QA）。
- 相关 Node 回归：**115 pass / 0 fail / 0 skipped / 0 cancelled / 0 todo**。
- 真实 Beta 独立浏览器：`CHROME_PATH=/usr/bin/google-chrome node tools/qa-paf-online-leaderboard.cjs`，**46 checks pass，consoleErrors=0，page exceptions=0**；覆盖真实本地 accounts 服务、真实 Beta 页面、1280×720 与 390×844、名字必填/非法名、有效提交、线上同 IP 高/低/平分、同分完成时间、同名/替换语义、排行榜 X 关闭、结果页三个选项及继续沙盒真实状态。浏览器证据：`outputs/m3d-20261103-beta-paf-online-leaderboard-v2/qa-results.json` 及同目录截图。
- Node 证据命令输出由本次运行产生；原有 noise/personal-best 证据未删除并已在本次 115 项回归与入口 QA 中重新覆盖。
- `git diff --check` 通过；未 push、未 PR、未 deploy，未修改 Stable/Dev/Caddy/systemd/线上文件。

### 限制

- 浏览器 QA 使用 headless Chrome 设备仿真，不替代物理手机/GPU 性能测试；服务端和页面均为本工作树本地真实实例。
- 线上旧匿名行在用户首次以更高分、合法名字提交时才会获得名字；低/平分旧匿名行会诚实保留并显示“匿名玩家”。
