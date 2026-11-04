# Beta rev64 安全与标题入口修复报告

- 任务：`m3d-20261105-beta-rev64-security-ui-fixes`
- 起点：`afedcc43ceabb9f311ba3cedf473f88007f61184`；实现提交：`d6b577d8d9276563951e06119295e34e7f6e1a3f`。本报告作为后续独立提交，避免提交哈希自引用。
- 仅在指定工作树本地实现与测试；**未 push，未部署**，未修改线上配置、Caddy、systemd、线上榜单或版本戳。未跟踪的 `.codex-beta-fix.lock/` 保留。

## 改动与契约

1. 配置控制面：配置应用、保存、删除要求有效 Bearer，并由服务端 `M3D_CONFIG_ADMIN_USERS` 按账号名判定角色，缺省为反馈管理员配置或 `catten`；不信任请求里的管理员字段。配置公开读取不变。后台写入携带现有登录会话。allowlist 名称禁止公开注册或游客升级；启用前必须确认已有同名账号属于管理员，缺失账号需安全预置，不能依赖公开注册。CORS 默认仅允许 `https://www.catten.cyou`，其他合法跨域 origin 须通过 `M3D_ALLOWED_ORIGINS` 显式配置；未验证线上实际配置。
2. PAF：浏览器开始限时回合前调用 `POST /paf/runs` 获得签名凭证；提交 `POST /paf/scores` 增加 `runTicket`。服务器检查签名、15 分钟有效期、IP HMAC 绑定、服务器经过至少 120 秒及一次性状态；无票、篡改凭证、提前提交、跨 IP、过期及重放会拒绝。进程重启使未提交凭证失效，已消费后的失败请求不能保证可重试。沿用现有免账号的命名提交规则、历史匿名条目读取、每 IP 最佳成绩与排序；IP 去重/绑定不是成绩证明。
3. Runtime：客户端 URL、缓存、active 配置和服务端写入共享有限数值边界；拒绝非法类型、非有限值、越界和部分跨字段非法组合，合并 active 与 query 时再次检查。旧的低级 sanitization 接口仍会钳制供内部调用；外部 payload 使用严格校验。
4. 标题入口：将战役开始和选关按钮移到标题前部，保留沙盒及藏狐入口和面板滚动；添加 DOM 顺序与 CSS 静态契约测试。未处理第 5 项提示条/摇杆重叠。
5. 会话：令牌默认 12 小时 TTL，服务端校验签发时间和 token version；`POST /auth/logout` 持久化递增版本并撤销该用户旧令牌。游客升级保留 UID 和成绩，改名使旧令牌失效。登出请求网络失败时客户端仍清除本地会话，但服务端撤销无法保证，需要重新登录后重试或等待过期。

## 验证

- 所有修改的 JS/MJS 文件执行 `node --check` 通过。
- 服务端账号、PAF、runtime、UI、前端契约定向测试通过；含授权/未授权、过期/撤销、游客升级、裸提交、提前提交、签名篡改、跨 IP、重放及数值极值测试。PAF 原子回滚测试故意触发的 EISDIR 日志属于预期。
- `node tools/run-node-tests.cjs`：106/106 测试文件通过；22 个浏览器/CDP 文件由 runner 跳过。另单独运行 `server/accounts/test.mjs` 和 `server/accounts/paf-test.mjs`。
- 尝试本地 Chrome 视觉回归，页面加载停在 78%，未能验证真实标题首屏。`tools/test-title-entry.mjs` 仅验证源文本中的 DOM 顺序及响应式 CSS 规则，**不是 390×844 / 1280×720 的实际浏览器布局测量**；两种视口仍需人工或可正常加载资源的浏览器流水线验收。

## 剩余限制

- **PAF 尚不具备可信成绩证明**：攻击者可通过 HTTP 领取合法票据，等待两分钟，再自报任意符合字段范围的分数和完成时间；签名不覆盖也不能验证这两个客户端字段。因此本次仅阻断无凭证和即时裸提交，并未完成“不能接受任意客户端自报高分/完成时间”的强保证。需要可信服务端模拟、可验证事件或其他权威计分方案；现有排行榜不应视为防作弊榜单。
- 反向代理必须正确设置可信客户端 IP；服务端沿用既有 `X-Forwarded-For` 处理，直接暴露服务可能允许伪造该头。此机制不提供身份或成绩证明。
- 本工作树未发现用户所指 rev64 只读审计报告的明确文件路径，因此依据任务描述及本地源码和测试核对，不能声称核对过该外部报告。

## 文件

- 服务端及文档：`server/accounts/server.mjs`、`server/accounts/README.md`、`server/accounts/test.mjs`、`server/accounts/paf-test.mjs`。
- 前端：`src/admin/feedback-panel.mjs`、`src/admin/panel.mjs`、`src/core/accounts-api.mjs`、`src/core/paf-online-leaderboard.mjs`、`src/core/runtime-config.mjs`、`src/main.js`、`src/play/play-as-fox.js`、`styles.css`。
- 测试：`tools/test-admin-feedback-proxy.mjs`、`tools/test-paf-online-leaderboard.mjs`、`tools/test-runtime-config.mjs`、`tools/test-title-entry.mjs`。
- 本报告：`outputs/m3d-20261105-beta-rev64-security-ui-fixes-report.md`。
