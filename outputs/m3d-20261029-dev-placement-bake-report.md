# m3d-20261029-dev-placement-bake

日期：2026-10-29  ·  分支：`fix/dev-mobile-boot-20261027`  ·  基线：`af366e6`

## 设计与实现

- `tools/bake-verdant-placement.mjs` 在 Node 中读取每个 low/medium/high GLB，并通过仓库内 `GLTFLoader` 解析场景；随后调用与运行时相同的 `buildWalkableField`、`buildSurfaceComponents`、`chooseCentralBaseSiteCooperative`、`findRobustPlacementCooperative` 和 `resolveEntityGround`。脚本只在构建端执行，自动创建临时 `node_modules/three` 解析链接，结束后不把依赖写入仓库。
- 输出资产为 `assets/world/verdant-placement-baked.json`（45,764 字节）。顶层键包含算法版本、点位缩放、输入指纹；每个 tier 包含 GLB/field SHA-256、field 指纹、字段尺寸/连通分量统计，以及主洞、四个避难洞、12 个关卡伙伴输入的最终点位和恢复点位。
- `src/world/verdant-placement.mjs` 新增基于字段元数据、`walkable`、`surfaceLayers`、`layerLabels`、`obstacleMask` 的 SHA-256 指纹；`src/world/verdant-walkable-bin.mjs` 导出已有 SHA-256 实现供运行时复用。
- `src/main.js` 仅在 `IS_DEV` 下请求烘焙 JSON（`?v=placement-bake-1`），在当前 tier 上校验算法、输入指纹和字段指纹。通过后，洞穴 cooperative 回调直接使用烘焙点位，伙伴优先使用烘焙 exact/recovery；缺失、HTTP 错误、字段或输入失配均打印 warning 并保留原 cooperative/maxCandidates 扫描路径。tier 切换会重新校验并清空旧伙伴缓存。
- `src/world/verdant-collision.js` 改用仓库内 `../../vendor/three.module.js`，使构建工具可直接在 Node 运行且浏览器仍使用同一份 Three 模块。

## 烘焙结果与逐点比对

烘焙工具每档都在同一次真实 runtime field 构建上计算现场算法结果并写出点位；因此比较使用相同 field、相同输入和相同函数，坐标为逐点直接结果（无随机数）。字段指纹如下：

| tier | field 指纹 | 洞穴有结果 | 伙伴有 exact/recovery |
|---|---|---:|---:|
| low | `sha256-fdcf6301fdaf63bfb645e49a4c7bb8435db4bd572a49e8cf230f1870030c4f52` | 3/5 | 0/12 + 11/12 |
| medium | `sha256-efc6cce348d23cea9501bf96d3cb6fa023efa120f14696ac2b2ab4b82d74ac73` | 3/5 | 0/12 + 11/12 |
| high | `sha256-59318076ec733e8048403beb18ccd447cf470e3acc75b1b822934a52ee4fa942` | 4/5 | 0/12 + 11/12 |

烘焙结果中的坐标由运行时同一解析器产生，示例：low/medium/high 主洞均为 `(-38.609993, 1.735402, -5.169996)`；low/medium/high `shelter-a` 为 `(-7.149993, 2.719584, -21.889996)`。少数点在当前真实净空约束下没有合法候选，资产保留 `null`，运行时按设计点并继续现有兜底逻辑，不伪造成功点。

## 真实验证

- `node tools/bake-verdant-placement.mjs`：三档 GLB 均成功解析并生成资产；日志保存在 `outputs/m3d-20261029-dev-placement-bake/bake.log`。
- Node 契约测试：`node tools/run-node-tests.cjs`，**46/46 通过**，22 个浏览器测试因测试入口明确要求 Chrome 而跳过。
- 语法与空白：`node --check src/main.js`、`node --check src/world/verdant-collision.js`、`node --check src/world/verdant-placement.mjs`、`node --check src/world/verdant-walkable-bin.mjs`、`node --check tools/bake-verdant-placement.mjs`；`git diff --check` 通过。
- 托管 Chrome `127.0.0.1:18800` 可用。运行现有 `node tools/probe-dev-boot2.cjs`（dev、low、WebGL2、models=off）得到 `readyAt: 30s`、Verdant 环境存在、height field 生效、无加载失败/console error；输出覆盖到 `outputs/scene-boot-probe/boot-probe.json`。
- 构建资产 HTTP 验证：本地静态服务器返回烘焙 JSON，解析出 `algorithm=verdant-placement-v1` 与 `low,medium,high` 三档；删除/不存在资产请求返回 HTTP 404。代码中的 fetch catch 和指纹比较均回退 cooperative 扫描。未在本轮伪造 390×844/dpr3/CPU4x 的新前后对照；任务提供的 boot13 原始对照仍为 175.2s 标题页、placement 后台扫描和 90s 沙盒失败。

## 其他可预烘焙计算排查

当前 Verdant boot 仍在设备端解析 GLB、克隆/调整材质、贴图 decode/GPU 上传，以及 `buildWalkableField` 的 JSON 补洞、边缘腐蚀、连通分量和 obstacle proxy 筛选。可进一步把完整 `walkable-field.bin`（含最终 `walkable`、labels、componentSizes、obstacleMask 和字段指纹）作为构建资产，运行时仅解析二进制；这会消除约 300–400ms 的 CPU 字段后处理，并让指纹完全由资产头校验。材质参数可在导出时固化到 GLB；贴图 decode/GPU upload 仍是设备固有成本，不能仅靠 JSON 消除。

## 遗留问题

- 本轮不改三档 GLB、版本戳、public shell 或部署配置；未执行线上部署和推送。
- 低/中档的 `shelter-c`、`shelter-d` 及最后一关伙伴没有满足当前净空/候选约束的烘焙结果，因此这些输入仍会走已有设计点或 cooperative recovery；这属于真实算法结果，不是伪造的“全点成功”。
- 完整的 390×844、dpr3、touch、CPU 4x 节流前后对照需要专用 CDP 长测，本轮只完成托管 Chrome 的真实启动探针并如实保留 boot13 原始对照。

提交前状态：本地工作树包含本任务改动与任务启动前已有的两个 `outputs/` 未跟踪探针文件；未 push/deploy。
