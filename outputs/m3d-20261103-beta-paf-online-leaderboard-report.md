# Marmot3D Beta PAF 在线排行榜交付报告

- task：`m3d-20261103-beta-paf-online-leaderboard`
- branch：`feat/beta-paf-online-ip-board-20261103`
- base：`f26af6946d08bc6d08225a3e840a3bef9aed0b49`
- 最终功能/验证 commit：`dfff57d5354b78c629d0653b95397fc82a2afd87`
- 本报告在后续 documentation commit 入库；最终 HEAD 同时回填共享任务板。
- 未 push、未 PR、未部署；未修改 Stable/Dev、public-shell、Caddy、systemd、线上文件或配置。

## 实际行为

- 零依赖 accounts 服务新增同源 `GET /paf/leaderboard` 与免登录 `POST /paf/scores`，兼容既有 `/marmot3d-beta/api` 和 `/api` 前缀；原账号、游客、单关最佳成绩与配置 API 未改语义。
- 服务端规范化 XFF 首个 IP/socket IP，以现有 `M3D_ACCOUNTS_SECRET`  keyed HMAC-SHA256 作为内部去重 key。公开条目仅 `rank/score/durationMs/submittedAt`，不公开 IP、XFF、key 或 hash。
- 每个 IP 仅一条当前纪录；每次有效提交均替换，包括更低分，不影响其他 IP。按 score 降序、同分按服务器 submittedAt 升序，rank 连续，total 为唯一 IP 数，limit 为 1..100。
- 独立 `paf-scores.jsonl` 启动按 key 去重加载；提交串行化，使用临时文件 + rename 原子重写当前全集。写盘失败返回 500，内存继续保留旧纪录；重启后仍仅每 IP 最新一条。
- POST 严格要求 JSON object、整数 score 0..100000、durationMs=120000；服务器生成 submittedAt。独立 body 上限与可配置 `PAF_RATE_PER_MIN` IP 限流，非法输入 400、超大 body 413、限流 429 + Retry-After。
- PAF 保留本机榜和清除本机记录，新增本机/在线切换；在线加载、空、错误、刷新/重试均使用 `textContent` 渲染。真实 `finishTimedRound` 自动提交一次，结果显示提交中、服务器排名或失败；失败保留本机成绩并可在线重试，退出和再来一局始终可用。

## 线上热修对齐

- `src/play/play-as-fox.js` 保留线上热修 `lungeTime: 0.32`，注释为“更短、更快；距离由 lungeRange 保持不变”。base 为 0.42，本 JOB 明确提交该唯一线上漂移，没有回退；`lungeRange` 未改。

## 文件

- `server/accounts/server.mjs`：IP 规范化、PAF API、HMAC key、独立当前值存储、串行原子重写、校验与限流。
- `server/accounts/paf-test.mjs`：真实 HTTP/磁盘契约及故障注入测试。
- `server/accounts/README.md`：PAF 环境变量、API、持久化和备份说明。
- `src/core/paf-online-leaderboard.mjs`：同源客户端、加载/提交状态、防重复并发 POST、重试及响应校验。
- `src/play/play-as-fox.js`：本机/在线 UI、自动提交、结果回执、重试、响应式面板与 0.32 热修。
- `tools/test-paf-online-leaderboard.mjs`：客户端状态测试。
- `tools/qa-paf-online-leaderboard.cjs`：真实 accounts + 真实 Beta `index.html` 的独立 CDP 验收。
- `outputs/m3d-20261103-beta-paf-online-leaderboard/`：34 项检查 JSON 与 6 张截图。

## 精确验证命令与结果

1. 所有改动 JS/MJS/CJS：

   ```bash
   for file in server/accounts/server.mjs server/accounts/paf-test.mjs src/core/paf-online-leaderboard.mjs src/play/play-as-fox.js tools/test-paf-online-leaderboard.mjs tools/qa-paf-online-leaderboard.cjs; do node --check "$file" || exit; done
   ```

   结果：6/6 通过。

2. 服务端、账号回归、前端状态与既有 PAF 测试：

   ```bash
   node --test server/accounts/test.mjs server/accounts/paf-test.mjs tools/test-accounts-frontend.mjs tools/test-admin-feedback-proxy.mjs tools/test-paf-leaderboard.cjs tools/test-paf-timed-range.cjs tools/test-paf-online-leaderboard.mjs
   ```

   结果：**48/48 通过，0 失败**。原始输出：`outputs/m3d-20261103-beta-paf-online-leaderboard-node-tests.txt`。其中写盘失败用例故意造成 EISDIR，日志中的服务端错误堆栈属于预期故障注入，断言确认 HTTP 非成功且旧内存纪录有效。

3. 真实浏览器端到端：

   ```bash
   CHROME_PATH=/usr/bin/google-chrome node tools/qa-paf-online-leaderboard.cjs
   ```

   结果：**34/34 通过，console error=0，page exception=0**。原始输出：`outputs/m3d-20261103-beta-paf-online-leaderboard-browser-run.txt`；完整状态：`outputs/m3d-20261103-beta-paf-online-leaderboard/qa-results.json`。

4. 差异检查：

   ```bash
   git diff --check f26af6946d08bc6d08225a3e840a3bef9aed0b49..dfff57d5354b78c629d0653b95397fc82a2afd87
   ```

   结果：通过。提交前 `git status --short` 仅另有启动器预先放置的未跟踪 `.codex-cli-write.lock/`，未提交或删除该锁。

## 浏览器证据

- 真实 accounts 服务与真实 Beta `index.html` 经同源本地转发连接；没有请求拦截、204 mock 或吞错。使用既有 `?pafqa=1` 固定步长完成真实 120000ms 轮次，第一轮用既有 QA 猎物控制入口配合真实 Space 输入得到 1 分。
- 同一 XFF/IP 第二轮真实取得 0 分：自动 POST 每轮各一次，公开榜 total 仍为 1，分数由 1 替换为 0；不是 personal-best。
- 第三个不同 IPv6 XFF 提交后 total=2，原 IP 纪录仍在，持久文件仅两条当前值。
- 故障场景实际关闭 accounts 服务后结束限时轮：在线提交诚实失败，本机已有三条纪录保留且当前轮可读到，在线重试可见；恢复同一真实服务后点击重试成功。
- 桌面结算/在线榜、390x844 失败与恢复、320x568 本机清除/在线切换均实际操作；三视口面板边界和可操作断言通过。
- 截图：`01-desktop-result-success-1280x720.png`、`02-desktop-online-board-1280x720.png`、`03-mobile-submit-failure-390x844.png`、`04-mobile-retry-success-390x844.png`、`05-mobile-online-board-390x844.png`、`06-mobile-online-board-320x568.png`。
- 启动前确认无其他任务 CDP 浏览器；仅使用独立临时 profile 和 CDP 9531，未连接共享 18800；结束已确认本轮 Chrome 无残留。

## 限制与技能记录

- 手机为桌面 Chrome 设备仿真，不是物理手机；headless WebGL 不作为硬件 GPU 或性能证据。截图人工复核确认本任务面板无裁切；未改正常游戏 UI，也未处理桌面底部既有的 BETA 文案/PAF 长提示重叠。
- 服务端契约和真实游戏入口均通过；主控独立验收、线上代理配置、部署和线上验证不在 worker 范围，本报告不代表已上线。
- 已加载 `threejs-game-director`、`threejs-qa-release` 及其 `release-checks.md`、`playtest-bot.md`；本窄改使用既有 PAF QA 入口而非新增通用 bot 框架。
