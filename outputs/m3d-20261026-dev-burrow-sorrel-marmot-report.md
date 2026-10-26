# m3d-20261026-dev-burrow-sorrel-marmot — 交付与部署报告

- 任务：`m3d-20261026-dev-burrow-sorrel-marmot`
- 通道：**dev**（`?version=dev`）
- feature 分支：`feat/dev-burrow-sorrel-marmot-20261026`（worktree `m3d-dev-burrow-assets-20261026`）
- dev 集成树：`/home/fame/code/marmot3d/_int_dev_verdant`（分支 `dev-verdant-tier-snapshot-20261026`）
- 最终 commit：`528e5ee`
- 状态：**已合并、已 push、已部署**

## 一、交付内容（用户可见行为）

1. **主洞 / 临时洞扫描内景**：首次靠近时懒加载 `burrow-main-interior.glb`（20.5MB / 171k 面）与
   `burrow-shelter-interior.glb`（25.9MB / 215k 面），扫描材质强制双面；加载失败保留程序化洞穴回退。
2. **dev 洞口更朴素**：洞口缩小为主洞 `openingRadius 1.3 / slopeRadius 2.4`、临时洞 `0.75 / 1.35`；
   移除光柱、顶环、地面亮盘、临时洞 beacon/sbeam 与夸张洞内光，只保留土堆 + 暗洞口 + 悬浮文字。
3. **Verdant dev 可进洞**：地面解析允许从高度场地表下降到洞内平底，洞内改用地下 floor 查询，
   不再被 Verdant 安全回收逻辑吸回地表。洞内语义（不能攻击 / 回储备 / 天气抑制）沿用既有 `game.inBurrow`。
4. **尖叫土拨鼠**：第三人称玩家与同伴改用 `marmot-screaming.glb`（带骨骼站姿），黑色身体材质运行时
   染为土拨鼠棕；加载失败或 `?models=off` 回退程序化土拨鼠。
5. **sorrel 灌木**：可采集草本异步替换为 `shrub-sorrel.glb`（目标高度约 0.4m）；采食隐藏、reset 恢复、
   食性数值逻辑未改。
6. **stable / beta 零影响**：三个新开关全部 `IS_DEV` 守卫 —— `scannedBurrows` / `screamingMarmot` /
   `sorrelFood`；stable 保留原光柱 + 顶环地标，且无扫描内景容器。

## 二、主控合并前修掉的两个 P0（本次部署的关键价值）

### P0-1：feature 分支 dev 页面模块加载失败（`bddaa93`）

- 现象：`src/main.js:582` 使用 `USE_REAL_MODELS`，但第 82 行的 import **未包含该符号**，
  导致 dev 整个模块加载失败，页面显示「模块加载失败 USE_REAL_MODELS is not defined」。
- 为什么上一轮没发现：`node --check` 只做语法解析，查不出未定义标识符，因此上一轮
  37 项 Node 测试全绿、报告写「只差截图」也照样漏掉。
- 修复：import 补入 `USE_REAL_MODELS`；并新增 `tools/scan-undefined-refs.cjs`
  静态扫描「模块级常量未导入」这一类缺陷（全树扫描 64 文件，收敛后真缺陷仅此一处）。

### P0-2：线上 dev 当时已经崩溃（`2f53249`）

- 现象：dev 集成树 `src/world/verdant-fall-safety.mjs` 里 `resolveGroundedY` **导出了两次**
  （L82 / L121），ES 模块同名导出是 SyntaxError；`src/core/controls.js` 正好 import 该模块。
- 线上实测（部署前）：`https://www.catten.cyou/marmot3d/?version=dev` 显示
  「模块加载失败 Identifier 'resolveGroundedY' has already been declared」，`__game` 未定义。
- 来源：`b3a60d5` 快照合并时把该函数追加了两次（`e6c51be` 已加过一次）。
- 修复：删掉重复的第二个定义。全树 `node --check` 体检确认无其他语法失败文件。
- **本次部署同时修复了线上已存在的崩溃。**

## 三、验证证据

### 截图验收（`tools/qa-dev-burrow-managed.cjs`，托管 Chrome CDP 18800）—— 25/25 PASS

证据目录：`outputs/m3d-20261026-dev-burrow-sorrel-marmot/visual/`

| 证据 | 内容 |
| --- | --- |
| `01-base-mouth-third.png` | 主洞第三人称外观（朴素土堆 + 小洞口 + 文字） |
| `02-base-mouth-fpv.png` | 主洞第一人称外观 |
| `03-base-mouth-topdown.png` | 主洞俯视（确认无光柱/顶环/亮盘） |
| `04-base-interior.png` | 主洞扫描内景 |
| `05-shelter-mouth-third.png` | 临时洞外观 |
| `06-shelter-interior.png` | 临时洞扫描内景 |
| `07-third-person-screaming-marmot.png` | 第三人称尖叫土拨鼠 |
| `08-stable-isolation.png` | stable 通道隔离对照（保留原地标） |
| `qa-result.json` | 25 项断言结果 + 网络请求 + 控制台错误采样 |

断言覆盖：dev 通道生效、洞口无 beam/cap/beacon/sbeam、保留 labelSprite、具备 interiorGroup、
主洞/临时洞均可进入（`inBurrow=true`）、内景 GLB 已请求且容器非空、可退出（`inBurrow=false`）、
sorrel 替换率 12/12、同伴真模型（`geometry-only`）、第三人称玩家真模型接管
（`playerBody.visible=false`）、stable `IS_DEV=false` 且保留光柱/顶环、stable 无内景容器、
页面无未捕获异常。

### 回归

- `node tools/run-node-tests.cjs`：**OK 40/41**。唯一失败 `test-beta-contract.cjs`
  （`Unconverted relative beta resource path remains in index.html`）为**基线既有**：
  `origin/dev` 与合并基点 `d266ce6` 的 `index.html` 同样含相对 beta 资源路径，
  本次合并未改 `index.html`（除 dev 戳）与 `index-public.html`。未修改该测试或放宽断言。
- `node --check`：`src/` + `tools/` 全树语法体检通过（除基线既有的 `tools/test-attacks.cjs`，
  其在 `d266ce6` 与 `origin/dev` 中同样失败，与本次无关）。
- 合并预演 `git merge-tree` exit=0，**零冲突**。

## 四、合并与发布

- 合并：`15474d8`（`--no-ff`）把 feature 分支并入 dev 集成树；零冲突。
- 版本戳：`528e5ee` 把 dev 入口 `index.html` 的戳从 `m20261026verdant1` bump 到 `m20261026burrow1`。
  **未改** `index-public.html` / `tools/public-shell.cjs`（beta public shell 不受影响）。
- push：`b3a60d5..528e5ee` → `origin/dev-verdant-tier-snapshot-20261026`。
  直连 GitHub 两次 TLS 断连 / 连接超时，改用已实测可用的 mihomo 代理（`http://127.0.0.1:7890`，
  实测 github HTTP 200 / 2.2s）后一次成功。
- 部署目录：`/var/www/m3d-releases/dev-burrow-sorrel-202610262343`
- 原子切换：`/var/www/marmot3d` → `dev-burrow-sorrel-202610262343`；
  回滚点 `/var/www/m3d-releases/.last-dev-link` 已写入同路径。
- 磁盘：服务器仅剩 826M，发布目录 2.8G。沿用上次 dev 发布的做法 ——
  先 `cp -al` 硬链接复制上一版（**0.015 秒、零额外磁盘**），再按路径 rsync 覆盖改动文件。
  部署后服务器剩余 775M。

### 部署过程踩坑（已修正）

首次 rsync 命令写成多源 + 尾部斜杠：

```
rsync -az index.html src/ assets/models/ tools/ outputs/.../ $NEW/
```

rsync 会把每个源的**内容平铺**进目标根 —— `src/main.js` 落到 `$NEW/main.js`、
`assets/models/*.glb` 落到 `$NEW/*.glb`、`tools/` 落到 `$NEW/*.cjs`，
而 `$NEW/src/` 仍是旧版（硬链接原件）。服务器端校验（戳已更新但 `src/main.js` 仍旧、
`resolveGroundedY` 仍为 2）及时发现，**未造成线上影响**（软链尚未切换）。
修正：改用 `rsync -azR ./src/ ./assets/models/ ...`（`-R` 保留目录结构），重建目录后重传，
复核通过才切换软链。

## 五、遗留与建议

1. `tools/test-beta-contract.cjs` 基线失败（beta public shell 相对路径）——与本任务无关，
   建议单独立项修复，否则 dev 线上回归永远是 40/41。
2. `tools/test-attacks.cjs` 语法错误（基线既有）——同样建议单独立项。
3. `node --check` 查不出未定义标识符，建议把 `tools/scan-undefined-refs.cjs` 纳入常规门禁。
4. 服务器磁盘 97%（775M 可用），后续 dev 发布前建议先清理旧 `m3d-releases` 目录。
5. `dev-verdant-tier-snapshot-20261026` 已是 dev 实际发布线（`origin/dev` 落后于它），
   建议后续把该快照分支同步回 `origin/dev`，避免长期分叉。
