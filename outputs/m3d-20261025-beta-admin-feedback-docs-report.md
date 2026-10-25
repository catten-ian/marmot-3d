# m3d-20261025-beta-admin-feedback-docs 交付报告

日期：2026-10-25
通道：beta
基线：`2d30d7a93dcc48522ffd810a8e6bcc13adb6cafe`
范围：本地源码与测试；未 push、未部署、未修改 Caddy/systemd，未访问生产 secrets。

## 实现

### 用户反馈与服务端鉴权

- `admin.html` 新增“数值调参 / 用户反馈 / 机制说明”三个工作区，保留原调参和 3D 预览状态。
- `src/admin/feedback-panel.mjs` 使用同源账号 API 登录，用户名预填 `catten`，密码为 password input，仅在登录请求体中提交；成功/失败后立即清空，不写 storage。
- 会话沿用 `m3d.beta.session.v1` 与现有 `accounts-session` 辅助函数，仅保存 token 和公开用户信息。存储不可用时退化为内存会话；401 清除失效会话，网络故障不清空，退出登录明确清除。
- 已登录视图展示总数、未处理、近 7/30 天和分类统计；列表展示时间、类型、描述、版本、关卡/快照摘要、安装标识和处理状态。支持刷新、类型/状态/关键词筛选、20/50/100 条分页、上一页/下一页及错误状态。
- `server/accounts/server.mjs` 新增 `GET /admin/feedback/list` 和 `GET /admin/feedback/stats`，兼容 `/marmot3d-beta/api` 与 `/api` 的 `routePath` 前缀。
- 服务端先以 `authUser(req)` 校验账号会话，再使用服务端 `M3D_FEEDBACK_TOKEN` 请求 `M3D_FEEDBACK_URL` 的 `/list` 或 `/stats`。列表只转发 `type/version/q/handled/month/limit/before`，统计不转发 query。
- 内部 Bearer token 仅存在于服务端请求头；响应有 JSON 类型/2MB 大小校验，若下游文本包含内部令牌则拒绝转发。未配置/地址非法返回 503 配置错误；下游非 2xx、连接失败和超时 fail-soft，不返回下游敏感正文。

鉴权链路：

```text
admin.html 密码输入（仅当次请求）
  -> 同源 POST /marmot3d-beta/api/auth/login
  <- 无状态账号会话 token（按现有约定保存，不保存密码）
admin.html GET /marmot3d-beta/api/admin/feedback/{list,stats}
  Authorization: Bearer <账号会话 token>
  -> 账号服务 authUser 校验
  -> GET M3D_FEEDBACK_URL/{list,stats}
     Authorization: Bearer <仅服务端 M3D_FEEDBACK_TOKEN>
  <- 校验后的 JSON（不包含内部反馈 token）
```

### 中文机制说明

- `src/admin/mechanism-docs-data.mjs` 是独立中文数据模块，覆盖狐狸 AI（感知/预警/追逐/两阶段扑咬/撤退/体力/协同）、环境草、洞穴、移动战斗、世界布局、伙伴、视角/HUD/触控、音频及后台自身。
- `src/admin/mechanism-docs.mjs` 提供机制与参数两级折叠、全文搜索、参数/来源/默认值/范围/调大/调小/联动/风险表格。
- 参数表由 `buildTuningEntries()` 实时生成，不在长文中复制 554 项默认值，避免 schema 漂移。所有 schema 分组和参数均有完整性测试保证恰好覆盖一次。
- `src/admin/tuning-schema.mjs` 补入已有 `BETA_TUNE` 环境草字段：核心/外圈半径、啃食速率、慢再生和满密度储备收益；原保存、导入导出与实时预览路径未改动。
- 音频文档只描述当前 `src/systems/audio.js` 的本地 manifest/MP3、三总线、音量、懒加载和程序化回退，没有引入未合入功能。

## 文件

- 修改：`admin.html`
- 修改：`server/accounts/server.mjs`
- 修改：`server/accounts/README.md`
- 修改：`src/admin/main.mjs`
- 修改：`src/admin/tuning-schema.mjs`
- 新增：`src/admin/feedback-panel.mjs`
- 新增：`src/admin/mechanism-docs.mjs`
- 新增：`src/admin/mechanism-docs-data.mjs`
- 新增：`tools/test-admin-feedback-proxy.mjs`
- 新增：`tools/test-admin-mechanism-docs.mjs`
- 修改测试描述：`tools/test-admin-config-cloud.mjs`
- 浏览器检查截图：`outputs/admin-feedback-desktop.png`、`outputs/admin-feedback-mobile.png`、`outputs/admin-mechanism-docs-desktop.png`

## 验证

- 所有改动 `.js/.mjs` 均执行 `node --check`。
- `node --test server/accounts/test.mjs`：通过（24 项，含 suites 内子测试）。
- `node --test tools/test-admin-config-cloud.mjs`：通过（8 项）。
- `node --test tools/test-admin-tuning.mjs`：通过（5 项）。
- `node --test tools/test-admin-feedback-proxy.mjs`：通过（4 项）。
- `node --test tools/test-admin-mechanism-docs.mjs`：通过（4 项）。
- 代理测试使用临时目录、临时账号签名、临时反馈 token 和真实临时 HTTP mock；覆盖未登录/错误账号 401、已登录列表/统计成功、前缀兼容、白名单 query、token 不泄漏、下游 503、超时和未配置 503，不访问生产服务。
- 无头 Chrome（1440×1000 与 390×844）验证三视图、文档搜索/折叠、登录失败、mock 登录成功、密码清空、会话内容、反馈渲染和退出；无页面异常，移动端无横向溢出。浏览器数据均为 mock。
- `git diff --check` 通过；禁止文件、stable/dev 专属逻辑、配置保存行为均未改动。

## 尚未执行的部署步骤与环境要求

本任务按要求没有部署。线上启用前需由部署人员：

1. 将本次提交同步到 beta 静态目录和账号服务代码目录，并按既有流程重启账号服务。
2. 在账号服务私有环境（建议权限 600）设置 `M3D_FEEDBACK_TOKEN`，值必须与反馈服务一致；真实值不得进入仓库或报告。
3. `M3D_FEEDBACK_URL` 可保持默认 `http://127.0.0.1:8094`，仅在不同部署拓扑下显式修改。`M3D_ACCOUNTS_SECRET` 仍按原要求配置。
4. 确认现有反向代理已把 `/marmot3d-beta/api/*` 转到账号服务 8095；本任务未改 Caddy。
5. 部署后用真实账号执行登录、反馈列表/统计、失效会话与反馈服务停机恢复检查。账号服务缺反馈配置时只影响反馈视图，账号/排行/命名配置继续可用。

本地预览：`http://127.0.0.1:8200/admin.html`（临时静态服务，不是 beta 部署）。
