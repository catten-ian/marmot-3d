# Marmot3D BETA 账号 + 排行榜服务

零第三方运行时依赖（仅 Node 内置模块），Node ≥ 18（生产 v22，ESM）。

- 路径前缀：`/marmot3d-beta/api`（也兼容 `/api`）
- 游客可直接游玩和上报单关成绩；游客升级账号保留原 uid 和历史成绩。
- 密码：scrypt 加盐哈希，不存明文；令牌：`payload.HMAC-SHA256`，无状态校验，改名即失效。
- 存储：`$DATA_DIR/accounts.jsonl`、`scores.jsonl`、`configs.jsonl`（分数仅追加，读取时按玩家取最佳；命名配置同名原子覆盖）。

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `M3D_ACCOUNTS_SECRET` | 是 | — | 令牌 HMAC 签名密钥；缺失拒绝启动 |
| `PORT` | 否 | `8095` | 监听端口 |
| `HOST` | 否 | `127.0.0.1` | 监听地址，建议仅本机由 Caddy 反代 |
| `DATA_DIR` | 否 | `<repo>/data/accounts` | JSONL 目录 |
| `LEVEL_COUNT` | 否 | `12` | 关卡总数（校验 level 下标） |
| `MAX_TOTAL_TIME` | 否 | `86400` | 单次成绩用时上限（秒，防作弊） |
| `BODY_LIMIT` / `RATE_PER_MIN` | 否 | `16384` / `60` | body 上限 / 每玩家每分钟写次数（游客创建每 IP 10/min；登录、注册、升级每 IP 20/min） |
| `M3D_FEEDBACK_URL` | 否 | `http://127.0.0.1:8094` | 账号服务端访问反馈服务的地址，不下发浏览器 |
| `M3D_FEEDBACK_TOKEN` | 反馈代理必填 | — | 反馈服务管理令牌，仅账号服务端持有；缺失时反馈代理返回 503，不影响账号/排行/配置 |

## API

游客 / 注册 / 登录 / 升级（公开入口按 IP 限流）：

```
POST /auth/guest      无需令牌 -> 200 {"token":"...","user":{"id":"...","name":"游客-xxxx","guest":true}}
POST /auth/register  {"username":"土拨鼠","password":"≥6位"}
POST /auth/login     {"username":"...","password":"..."}
POST /auth/upgrade  Bearer（仅游客） {"username":"...","password":"≥6位"}
-> 200 {"token":"<bearer>","user":{"id":"...","name":"...","guest":false}}
   # upgrade 重名 409、字段非法 400、无效令牌 401、已是正式账号 400
   # 升级前后 uid 不变；升级后须换用新令牌，旧游客令牌因 name 改变而失效。
POST /auth/register / POST /auth/login -> 200 {"token":"<bearer>","user":{"id","name"}}
   # 注册重名 409，凭证错误 401
GET  /auth/me        Bearer -> {"user":{"id","name","guest":false|true}} / 401
```

Beta 后台用户反馈（需要有效账号会话；兼容 `/marmot3d-beta/api` 与 `/api` 前缀）：

```
GET /admin/feedback/list?type=&version=&q=&handled=&month=&limit=&before=
GET /admin/feedback/stats
```

浏览器先调用 `POST /auth/login`，之后仅把账号会话 token 发给这两个路由。服务端先用 `authUser`
校验会话，再以 `Authorization: Bearer $M3D_FEEDBACK_TOKEN` 请求本机反馈服务；只转发上列白名单
query，不转发浏览器提供的其他参数或请求体。内部反馈令牌不出现在响应中。反馈服务未配置、拒绝、
不可达或超时均返回可读错误；账号会话无效仍返回 401。部署时把反馈令牌加入账号服务的私有
环境文件（权限 600），不要写入静态页面、仓库或报告。

成绩（上报与查询需有效令牌，游客/正式账号均可；只接受“更快”的最佳）：

```
POST /scores   Bearer
  {"kind":"level","level":0,"time":42.5,"hits":1,"boosts":0,"ultimates":0,"version":"beta-rev17"}
-> 200 {"ok":true,"accepted":true,"best":42.5}  # 未更快则 accepted:false
```

排行榜（公开）/ 我的成绩（游客或正式账号令牌）：

```
GET /leaderboard?kind=level&level=0&limit=50    # 单关榜，按用时升序
-> {"kind","total","items":[{"rank","name","time","hits","boosts","ultimates","version","createdAt"}]}
GET /scores/mine  Bearer -> {"levels":{"0":42.5},"full":null}
GET /health -> {"ok":true}
```

Beta 后台命名调参配置（公开读；写按 IP 共享限流；与文件导出/导入相互独立）：

```
POST   /configs        {"name":"啃草方案_v1","config":{ ... }}   # 同名直接覆盖
-> 200 {"ok":true,"name":"啃草方案_v1","updatedAt":"...","size":15693}
   # name：trim 后 1-50 位，中英文/数字/连字符/下划线，否则 400
   # config：JSON 对象；序列化后 ≤100KB，否则 413（精简 values 结构默认约 16KB）
GET    /configs        -> {"configs":[{"name","updatedAt","size"}]}   # 按 updatedAt 倒序
GET    /configs/:name  -> {"name","updatedAt","size","config":{...}}  # 不存在 404
DELETE /configs/:name  -> {"ok":true,"name","deleted":true|false}     # 幂等，不存在也 200
```

config 本体为 Beta 后台精简结构 `{schemaVersion:1, app:"marmot3d-beta-admin", savedAt, values:{...}}`；
不含文件导出里的 `detail` 人类可读注释（默认值下完整导出约 107KB，会超过 100KB 上限）。
持久化为 `$DATA_DIR/configs.jsonl`，每个配置一行（原子重写，历史追加行在载入时以后写者为准）。

本版产品榜单仅使用 `kind=level` 单关榜。`kind=full` 的规范化和旧榜读取分支为后端兼容保留，不作为本版产品接口使用。

账号 JSONL 正式账号记录包含 `id/name/salt/hash/createdAt`，游客记录包含 `id/name/guest:true/createdAt`（不含密码材料）。旧记录缺少 `guest` 字段按正式账号读取并加入登录名索引；游客不进入登录名索引。升级在原记录写入新用户名及 scrypt `salt/hash`，设为 `guest:false` 并原子重写账号文件。成绩仍通过 `uid` 关联，无需迁移；榜单按当前用户记录的名称展示。

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
M3D_FEEDBACK_URL=http://127.0.0.1:8094
# M3D_FEEDBACK_TOKEN 必须与反馈服务私有环境一致；在此文件中设置，不要提交真实值。
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

- 备份 `DATA_DIR` 三个 JSONL（accounts / scores / configs）即可。
- `node --test server/accounts/test.mjs`：游客创建限流、游客单关上报与最快记录、升级冲突/校验/正式账号拒绝、uid 与成绩继承、旧令牌失效、新账号登录、旧账号兼容，以及原注册/登录/成绩/路由断言；并覆盖 `/configs` 的保存/列表/读取/同名覆盖/删除/100KB 上限/持久化重载。
- `node --test tools/test-admin-feedback-proxy.mjs`：使用临时账号目录、临时签名/反馈令牌和真实临时 mock HTTP 服务，覆盖未登录/错误账号 401、登录代理成功、白名单参数、令牌不泄漏、下游 503/超时和未配置 503。
