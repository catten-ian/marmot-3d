# 交付报告：m3d-20261025-beta-admin-config-save

**任务**：Beta 后台（admin.html）支持把当前调参配置**命名保存到服务器**，可列出/加载/删除；改配置默认直接应用的现有行为不变；文件导出/导入保留不动。
**分支**：`codex/beta-admin-config-20261025`（基线 `origin/beta` @ `1462c32d`）
**日期**：2026-10-25
**交付物**：本地 commit（不 push、不部署）

---

## 1. 背景事实核对

- 线上 8095 端口跑的是 `feat/accounts-guest-upgrade` 分支的 `server/accounts/server.mjs`（393 行，sha256 `a5bcd46657efb6bc250e8a5a29de15bce3fcc98c3743e0cd495571678cdc6925`），该文件不在 origin/beta。已按任务要求执行 `git checkout feat/accounts-guest-upgrade -- server/accounts/`，在该版本上增量扩展，账号/排行榜逻辑零改动。
- 体积实测（549 个调参项）：含 `detail` 的完整文件导出 **107,349 字节（已超 100KB 上限）**；仅 `values` 的精简结构 **15,655 字节**。因此服务器通道保存精简结构 `{schemaVersion, app, savedAt, values}`（与文件导出是相互独立的两条通道）。

## 2. 服务端改动（server/accounts/，零第三方依赖，仅 Node 内置模块）

`server.mjs` 新增（+约 108 行，原有逻辑不变）：

| 路由 | 行为 |
| --- | --- |
| `POST /configs` | body `{name, config}`；name trim 后 1-50 位（中英文/数字/`-`/`_`，`\p{L}\p{N}_-`，与 USERNAME 同款 unicode 规则）；config 必须是对象、序列化后 ≤100KB；同名直接覆盖；写按 IP 限流（复用 60/min 限流器，key 前缀 `cfg:`）；返回 `{ok:true, name, updatedAt, size}` |
| `GET /configs` | `{configs:[{name, updatedAt, size}]}`，按 updatedAt 倒序、名字兜底排序；列表不含 config 本体 |
| `GET /configs/:name` | `{name, updatedAt, size, config}`；名字 URL 解码（中文），非法 400，不存在 404 |
| `DELETE /configs/:name` | 幂等：`{ok:true, name, deleted:true|false}`，删不存在的名字也返回 200 |

实现要点：
- 持久化 `$DATA_DIR/configs.jsonl`（与 accounts.jsonl / scores.jsonl 同目录，默认 `data/accounts/`），启动载入内存 Map；写入沿用账号文件的**写队列 + tmp 文件 + rename 原子重写**模式；保存/删除失败时回滚内存记录。
- 载入时同名以文件最后一行生效（与 accounts.jsonl 同策略，兼容历史追加行）。
- body 读取使用独立上限 `100KB + 1KB` 信封余量（不受既有 `BODY_LIMIT=16384` 影响，账号/成绩路由仍走原 bodyLimit）。
- `routePath()` 不变，新路由自动兼容 `/marmot3d-beta/api` 与 `/api` 两个前缀。
- CORS `Allow-Methods` 增加 `DELETE`（预检已覆盖）。
- 端口默认 8095 不变；无新增环境变量、无新增依赖。
- 导出纯函数 `isValidConfigName()` 供测试。

## 3. 前端改动（纯 ESM，零依赖，无 alert/prompt/confirm）

- `src/admin/tuning-schema.mjs`（+74 行，该模块本就无 DOM/three 依赖，可直接 node:test）：新增服务器通道纯函数
  `validateConfigName` / `deriveApiBase`（`/marmot3d-beta/admin.html` → `/marmot3d-beta/api`，根部署 → `/api`）/ `configsIndexUrl` / `configItemUrl`（encodeURIComponent，中文安全）/ `needsOverwriteConfirm` / `serializeSavedConfig` / `parseSavedConfig`（复用 `parseConfigText` 的 schemaVersion+values 校验）/ `formatConfigSize` / `formatConfigTime`（均 fail-soft）。
- `src/admin/panel.mjs`（+204 行）：
  - 工具栏新增 **「保存到服务器」** 按钮，点击展开内联云配置区。
  - 内联命名表单（text input，maxlength=50）→ 前端先校验名字；列表中已存在同名时出现**内联二次确认条**（「确认覆盖 / 取消」），不使用任何浏览器阻塞弹窗。
  - 服务器配置列表：名字 + 更新时间 + 体积，每项 **「加载」**（GET 单个 → `parseSavedConfig` + 既有 `applyImport` 合并 → 重渲染面板 → `onChange(null)` 立即应用预览；沿用导入通道的 unknown/clamped 统计与 toast）和 **「删除」**（两次点击内联确认，3 秒有效）。
  - 打开面板自动拉取列表，另有「刷新列表」；所有 fetch 与 JSON 解析全部 try/catch fail-soft，错误以内联状态文字 + toast 呈现；`fetch` 不存在也安全降级。
  - 改配置默认直接应用、文件导出/导入/复制/恢复默认等既有功能与 UI 完全未动。
- `admin.html`（+23 行）：仅追加 `.cloud-*` 暗色样式；容器由 panel.mjs 自建，无需额外 HTML 节点。
- `src/admin/main.mjs` **未改**：既有 `onChange` 回调已经负责 `preview.refreshTuning()` 与窗口摘要刷新，加载服务器配置后预览即时更新。

## 4. 测试

### 服务端（扩展 `server/accounts/test.mjs`，10 个新用例，共 24 项全过）
覆盖：配置名校验；空列表与 `/marmot3d-beta/api` 前缀可达；保存→列表→读取往返（中文名字 URL 编码、trim、size）；同名覆盖（updatedAt/size 变化、列表仅一条、旧名保存前 404）；非法名字/config 非对象/非法 JSON/未转义保留字符 → 400/4xx；config 超 100KB → 413 且不落盘；DELETE 幂等与删除后 404；列表按 updatedAt 倒序；CORS 预检含 DELETE；`configs.jsonl` 落盘 + 追加同名旧记录后重启「最后一行生效」。

```
▶ 命名调参配置 /configs（10 项全 ✔）
ℹ tests 24  ℹ pass 24  ℹ fail 0
```

### 前端纯逻辑（新增 `tools/test-admin-config-cloud.mjs`，8 项；与既有 `tools/test-admin-tuning.mjs` 5 项合计 13 项全过）
覆盖：配置名规则（与服务端一致）；API 基址推导（beta/根/二级前缀）；URL 拼装与中文编码；同名覆盖判断；精简结构序列化→`parseSavedConfig`→`applyImport` 往返（含弧度/角度换算项与布尔项）；默认值下整包 < 100KB；非法 schemaVersion/缺 values/循环引用拒绝；体积与时间格式化 fail-soft。

```
ℹ tests 13  ℹ pass 13  ℹ fail 0
```

### node --check
5 个改动/新增的 .mjs 全部 `node --check` 通过。

### 真实 HTTP 端到端冒烟（临时 DATA_DIR + 18095 端口，进程退出即清理）
前端真实 `serializeSavedConfig` 产物（15,693 字节）打真实服务：
```
POST 200 {"ok":true,"name":"冒烟方案_v1","updatedAt":"…","size":15693}
LIST 1 …
GET one speed= 11.3 ver= 1
OVERWRITE 200
BADNAME 400
DELETE 200 {"ok":true,"name":"冒烟方案_v1","deleted":true}
FILES [ 'configs.jsonl' ]
```

## 5. 文件清单

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `server/accounts/server.mjs` | 新（源自 feat/accounts-guest-upgrade，+configs） | 线上 393 行版本的超集，账号/排行逻辑未改 |
| `server/accounts/test.mjs` | 新（+10 用例） | 共 24 项测试 |
| `server/accounts/README.md` | 新（文档同步） | configs API / configs.jsonl / 备份 / 测试说明 |
| `src/admin/panel.mjs` | 改 | 工具栏按钮 + 命名表单 + 覆盖确认 + 列表/加载/删除 |
| `src/admin/tuning-schema.mjs` | 改 | 服务器通道纯函数（无 DOM 依赖） |
| `admin.html` | 改 | 仅追加 `.cloud-*` 样式 23 行 |
| `tools/test-admin-config-cloud.mjs` | 新 | 前端纯逻辑 node:test 8 项 |

未触碰：`index-public.html`、`tools/public-shell.cjs`、`src/core/version.js`、stable/dev 专属文件；无第三方依赖；端口仍 8095；未 push、未部署、未改 Caddy/systemd。

## 6. 部署侧备注（供主控部署时参考，本任务不执行）

- 服务端上线后 `configs.jsonl` 自动在现有 `DATA_DIR` 中创建，无需迁移；备份对象由两个 JSONL 变为三个。
- Caddy 反代现有 `handle_path /marmot3d-beta/api/*` 对 DELETE 方法天然透传，无需改配置。
- 前端使用同源绝对路径（推导为 `/marmot3d-beta/api/configs`），跟随 admin.html 部署即可。
