# Beta 后台应用配置服务端化报告

日期：2026-10-26
分支：`release/beta-feedback-rev29`，基线 `140497c`

## 方案选型

账号服务原有 `/configs` 只支持命名配置的保存、列表、读取、删除，没有“当前生效”字段或标记 API。本轮在仓库内账号服务增加独立槽位 `__active__`，仍写入 `configs.jsonl` 并通过原子重写持久化；该槽位不出现在命名配置列表。后台列表每条的“应用”先读取该命名配置，再 POST 到 active 槽位，不再跳转游戏页。这样“选这条配置应用”闭环成立，且对全部 Beta 网站实例共享。

## API 端点清单

- `GET /marmot3d-beta/api/configs`：命名配置列表（不含 active 槽位）。
- `POST /marmot3d-beta/api/configs`：保存命名配置，原有接口。
- `GET /marmot3d-beta/api/configs/:name`：读取命名配置，原有接口。
- `POST /marmot3d-beta/api/configs/active`：请求体 `{name, config}`，持久化当前生效 Beta runtime payload。
- `GET /marmot3d-beta/api/configs/active`：Beta 游戏启动读取当前生效 payload；没有配置返回 404。

Beta 启动请求超时上限 2 秒（实现默认 1500ms、最大 2000ms）；失败、404、schema/白名单校验失败回退默认。query `betaConfig` 仍保留为显式调试 fallback，不再由后台应用按钮使用。

## Caddy 需要补的配置

若现有 Caddy 未代理该路径，在对应 Beta 站点中加入（放在静态 `file_server` 规则之前）：

```caddyfile
handle_path /marmot3d-beta/api/* {
    reverse_proxy 127.0.0.1:8095
}
```

若站点已有统一 API 代理，只需确认 `/marmot3d-beta/api/*` 原样到 8095，且不要被静态文件规则吞掉。Caddy、服务器进程和部署未在本任务修改。

## 测试结果

- `node --check src/main.js src/core/runtime-config.mjs src/admin/panel.mjs server/accounts/server.mjs`：通过。
- `node --test tools/test-admin-config-cloud.mjs server/accounts/test.mjs`：通过（含 active 读写契约）。
- `node --test tools/test-runtime-config.mjs`：仓库既有断言失败：测试第 21 行期望 `BETA_TUNE.moveSpeedMul === 1.12`，当前基线源码默认值为 `1.07`，与本次改动无关；未改测试或默认值。
- `git diff --check`：通过。

## 部署 checklist（主控执行）

1. 合并本提交到 Beta 集成树，部署 `server/accounts/server.mjs`、`src/core/runtime-config.mjs`、`src/main.js`、`src/admin/panel.mjs` 及前端静态资源。
2. 确认账号服务 8095 使用同一 `DATA_DIR`，确保 `configs.jsonl` 可写并备份。
3. 按上文加入/核对 Caddy API 代理，reload Caddy；不要把 8095 暴露到公网。
4. 通过 Beta 后台保存两条命名配置，逐条点“应用”，确认 `GET /marmot3d-beta/api/configs/active` 返回最后一次选择。
5. 打开多个 Beta 网站实例，确认启动读取相同 active 配置；停止账号服务后确认游戏仍能启动并回退默认/调试 query。
6. 不执行本地以外的部署或 push；本提交未修改账号服务生产进程、Caddy、版本戳、`index-public.html`、`tools-public-shell`。
