# Marmot3D BETA 账号 + 排行榜服务

零第三方运行时依赖（仅 Node 内置模块），Node ≥ 18（生产 v22，ESM）。

- 路径前缀：`/marmot3d-beta/api`（也兼容 `/api`）
- 密码：scrypt 加盐哈希，不存明文；令牌：`payload.HMAC-SHA256`，无状态校验，改名即失效。
- 存储：`$DATA_DIR/accounts.jsonl`、`scores.jsonl`（分数仅追加，读取时按玩家取最佳）。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `M3D_ACCOUNTS_SECRET` | 是 | — | 令牌 HMAC 签名密钥；缺失拒绝启动 |
| `PORT` | 否 | `8095` | 监听端口 |
| `HOST` | 否 | `127.0.0.1` | 监听地址，建议仅本机由 Caddy 反代 |
| `DATA_DIR` | 否 | `<repo>/data/accounts` | JSONL 目录 |
| `LEVEL_COUNT` | 否 | `12` | 关卡总数（校验 level 下标） |
| `MAX_TOTAL_TIME` | 否 | `86400` | 单次成绩用时上限（秒，防作弊） |
| `BODY_LIMIT` / `RATE_PER_MIN` | 否 | `16384` / `60` | body 上限 / 每玩家每分钟写次数（登录注册每 IP 20/min） |

## API

注册 / 登录（公开，限流）：

```
POST /auth/register  {"username":"土拨鼠","password":"≥6位"}
POST /auth/login     {"username":"...","password":"..."}
-> 200 {"token":"<bearer>","user":{"id","name"}}   # 注册重名 409，凭证错误 401
GET  /auth/me        Authorization: Bearer *** {"user":{...}} / 401
```

成绩（写需登录；只接受“更快”的最佳）：

```
POST /scores   Bearer
  {"kind":"level","level":0,"time":42.5,"hits":1,"boosts":0,"ultimates":0,"version":"beta-rev17"}
  {"kind":"full","time":523.1, ... }            # 全通关竞速（无 level）
-> 200 {"ok":true,"accepted":true,"best":42.5}  # 未更快则 accepted:false
```

排行榜（公开）/ 我的成绩（登录）：

```
GET /leaderboard?kind=level&level=0&limit=50    # 单关榜，按用时升序
GET /leaderboard?kind=full                      # 全通关竞速榜
-> {"kind","total","items":[{"rank","name","time","hits","boosts","ultimates","version","createdAt"}]}
GET /scores/mine  Bearer -> {"levels":{"0":42.5},"full":523.1}
GET /health -> {"ok":true}
```

## systemd（示例）

`/etc/systemd/system/m3d-accounts.service`：

```ini
[Unit]
Description=Marmot3D beta accounts & leaderboard
After=network.target

[Service]
Type=simple
User=catten
WorkingDirectory=/var/www/m3d-accounts
EnvironmentFile=/etc/m3d-accounts.env
ExecStart=/usr/bin/node /var/www/m3d-accounts/server/accounts/server.mjs
Restart=always
RestartSec=2
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

`/etc/m3d-accounts.env`（600）：

```
M3D_ACCOUNTS_SECRET=<openssl rand -base64 32>
PORT=8095
HOST=127.0.0.1
DATA_DIR=/var/www/m3d-accounts/data
LEVEL_COUNT=12
```

## Caddy（必须在 `handle_path /marmot3d-beta/*` 之前）

```caddyfile
handle_path /marmot3d-beta/api/* {
    reverse_proxy 127.0.0.1:8095
}
handle_path /marmot3d-beta/* {
    root * /var/www/marmot3d-beta
    file_server
}
```

## 备份与测试

- 备份 `DATA_DIR` 两个 JSONL 即可。
- `node --test server/accounts/test.mjs`：注册/重名/非法输入、登录与 401、令牌校验、成绩校验与防作弊上限、仅取更快、单关/全通关榜单顺序、我的成绩。
