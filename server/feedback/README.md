# Marmot3D 玩家反馈收集服务

零第三方运行时依赖（仅 Node 内置模块），Node ≥ 18（生产为 v24，ESM `.mjs`）。

- 公开上报：`POST /marmot3d/api/feedback`（也兼容 `/api/feedback`、`/feedback` 与带尾斜杠）
- 管理接口需请求头 `Authorization: Bearer $M3D_FEEDBACK_TOKEN`
- 数据按月分片为 JSONL：`$DATA_DIR/feedback-YYYY-MM.jsonl`（一行一条）

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `M3D_FEEDBACK_TOKEN` | 是 | — | 管理令牌；缺失则拒绝启动 |
| `PORT` | 否 | `8094` | 监听端口 |
| `HOST` | 否 | `127.0.0.1` | 监听地址，建议仅本机，由 Caddy 反代 |
| `DATA_DIR` | 否 | `<repo>/data/feedback` | JSONL 数据目录 |
| `BODY_LIMIT` | 否 | `32768` | 单次上报 body 字节上限 |
| `RATE_PER_MIN` | 否 | `10` | 每个来源指纹每分钟最多上报条数 |

## 本地运行

```bash
export M3D_FEEDBACK_TOKEN='换成一个长随机令牌'
node server/feedback/server.mjs
# [feedback] listening on http://127.0.0.1:8094 ...
```

健康检查（免鉴权）：`curl http://127.0.0.1:8094/health`

## 接口

上报（公开，限流 + 严格校验）：

```bash
curl -X POST http://127.0.0.1:8094/marmot3d/api/feedback \
  -H 'Content-Type: application/json' \
  -d '{"type":"卡顿","description":"第3关明显掉帧","installId":"...","version":"dev","snapshot":{"level":3}}'
# -> 200 {"ok":true,"id":"..."}
```

管理（Bearer）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/list` | 列表 newest 优先；query：`type,version,q,handled(true/false),month(YYYY-MM),limit(<=200,默认50),before(ISO 游标)`；返回 `{items,total,nextCursor,counts}` |
| GET | `/stats` | 总量、未处理、按类型/版本、近 7/30 天 |
| GET | `/export?format=csv\|json` | 导出（CSV 带 UTF-8 BOM） |
| POST | `/:id/handled` | body `{"handled":true/false}` |
| DELETE | `/:id` | 删除一条 |

## systemd（示例）

`/etc/systemd/system/m3d-feedback.service`：

```ini
[Unit]
Description=Marmot3D feedback collector
After=network.target

[Service]
Type=simple
User=catten
WorkingDirectory=/var/www/m3d-feedback
EnvironmentFile=/etc/m3d-feedback.env
ExecStart=/usr/bin/node /var/www/m3d-feedback/server/feedback/server.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

`/etc/m3d-feedback.env`（权限 600）：

```
M3D_FEEDBACK_TOKEN=换成一个长随机令牌
PORT=8094
HOST=127.0.0.1
DATA_DIR=/var/www/m3d-feedback/data
RATE_PER_MIN=10
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now m3d-feedback
journalctl -u m3d-feedback -f
```

## Caddy 反代（必须在静态 file_server 之前匹配）

站点对 `/marmot3d/*` 用 `handle_path` + `file_server`。API 更具体，必须放在其**前面**：

```caddyfile
handle_path /marmot3d/api/* {
    reverse_proxy 127.0.0.1:8094
}
handle_path /marmot3d/* {
    root * /var/www/marmot3d
    file_server
}
```

注意 `handle_path` 会剥掉 `/marmot3d/api` 前缀，服务端对剥前缀后的 `/feedback/...` 与未剥的 `/marmot3d/api/feedback/...` 都能识别。

## 备份

只需备份 `DATA_DIR`（按月 JSONL）。写入为追加、变更为临时文件 + rename 原子替换，可直接 `rsync`/快照整个目录。

## 测试

```bash
node --test server/feedback/test.mjs
```

覆盖：health、401、上报与字段、非法输入 400、超大 413、限流 429、handled 过滤、删除、筛选、游标分页、JSON/CSV 导出（BOM/转义）、stats。
