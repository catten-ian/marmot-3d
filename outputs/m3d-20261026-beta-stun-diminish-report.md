# m3d-20261026-beta-stun-diminish 报告

## 范围与机制

- 分支 `feat/beta-stun-diminish-20261026`，基线 `f229db7` / rev36；仅修改指定 JOB 工作树。
- Beta 每只狐狸独立维护眩晕历史时钟、施加/结束时间戳及递减层级；在 `Fox.hit` 中，保留原有 boss 系数后，仅对最终 `stun` 应用递减，不改变伤害、击退和死亡判定。`IS_BETA` 守卫了时钟推进及递减入口，stable/dev 保持原来的直接赋值路径。
- 窗口内再次受晕每层乘 `0.55`；首次为原始时长。超出窗口不再叠层，距最近施加/结束达到 4 秒且当前未眩晕时清空层级。时长钳在下限，且不会超过本次原始时长。
- 默认普通基础平 A 原始眩晕 0.6 秒，连续施加为 **0.6 → 0.33 → 0.1815 → 0.15（下限）** 秒。基础平 A 单测使用真实站立姿态倍率（0.66 秒），验证第二次眩晕短于 0.58 秒冷却、第三击前出现行动窗口。
- 智能狐生成点仅在 Beta 显式传 `hp: 4`，未改 `FOX.types.normal.hp`。保留原有主动撤退、rest_safe 回血和受击规避逻辑。无撤退保护的理论四次单位伤害序列为 4 → 3 → 2 → 1 → 0，证明可被击败。

## 参数与后台链路

| BETA_TUNE 字段 | 默认值 | 含义 |
|---|---:|---|
| `stunDiminishWindow` | 3.0 s | 窗口内再次眩晕叠加递减层 |
| `stunDiminishFactor` | 0.55 | 每层时长系数 |
| `stunDiminishFloor` | 0.15 s | 最短递减时长 |
| `stunDiminishResetSeconds` | 4.0 s | 停止被晕后清零层级 |

后台“数值总览”增加对应 `beta.*` 四项。`tools/test-runtime-config.mjs` 覆盖 admin 投影 → active endpoint 读取 → schema 校验 → `BETA_TUNE` 运行时覆盖链路，无新增第三方依赖，也没有修改线上 active 配置。

## 验证清单

- `node --check`：`src/core/beta-tuning.js`、`src/entities/fox.js`、`src/main.js`、`src/admin/tuning-schema.mjs`、新增测试均通过。
- `node tools/run-node-tests.cjs`：**77/77 通过，0 新增失败**；原有 22 个浏览器/CDP 测试由 runner 按规则跳过。
- `git diff --check`：通过。
- `tools/test-stun-diminish.mjs`：连续递减、下限、超出窗口不再叠层、4 秒清零、stable/dev 旁路、真实基础平 A 间隔模拟、Beta 智能狐 hp=4 且普通狐默认不变。
- `tools/test-admin-tuning.mjs` / `tools/test-runtime-config.mjs`：后台条目、默认值和 active 配置端到端覆盖。

## CDP 证据

静态服务：`node tools/serve.cjs 8324`。CDP：`http://127.0.0.1:18800`。

- **Beta URL 含 `?version=beta`**：`.../?version=beta&sandbox=1&webgl=1&hififox=off&stunqa=...`，进入真实沙盒后读取运行时对象。截图见 `outputs/m3d-20261026-beta-stun-diminish/visual/`。
- `beta-runtime-evidence.json`：智能狐 `hp=4, maxHp=4`；理论四次单位伤害归零。
- 同一 JSON 的眩晕采样采用 production `combatStats().stun`、`Fox.hit` 和 60 Hz `Fox.update` 推进平 A 间隔；`damage=0/knockback=0` 用于隔离眩晕机制，并避免狐狸在验证窗口内提前死亡/撤退。实测施加值 `0.6 → 0.33 → 0.1815 → 0.15`，下一次命中前行动间隙依次扩展到 `0.024 → 0.294 → 0.443` 秒；随后进入 `retreat`，最终与玩家距离 `10.961m`，证明恢复行动并逃离。未声称这是带伤害的极限击杀竞速测试。
- 截图索引：
  - `beta-sandbox-ready.png`：Beta 自由沙盒；
  - `beta-smartfox-hp4.png`：运行时生成的智能狐；
  - `beta-stun-diminish.png`：近距离普通狐首击场景；
  - `beta-stun-diminish-after.png`：递减序列结束后的场景。
- `stable-runtime-evidence.json`：无参 `/` 下 `beta=false`，普通狐默认 6；临时构造但未加入 foxes 的 SmartFox 为 `hp=maxHp=6`。`stable-root.png` 为无参标题页截图。

## 自评与遗留

- 自评：**9/10**。满足 Beta 隔离、四参数后台链路、智能狐 4 血、纯函数/全量测试和真实运行时状态证据；核心递减与行动间隙已验证。
- 遗留：CDP 递减序列是隔离变量后的运行时模拟，不是完整鼠标连点追击录像；智能狐“正常操作通常打不死”依赖既有撤退/回血，已通过既有测试和逻辑复用保证，但本次未做长时人机操作统计。未 push、未部署、未改线上/Caddy/systemd、版本戳或 vendor。
