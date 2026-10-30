commit: 17f0fbdb6fd0af1c70ec44c9b790353b56645836

# m3d-20261030-dev-mobile-ux

工作树：`/home/fame/code/marmot3d/m3d-dev-mobile-ux-20261030`  
分支：`fix/dev-mobile-ux-20261030`  
基线：`e8be6ce3ead635f8367288b49f6141b2b67d3353`

## 1. 洞穴内景

根因是内景容器显隐使用运行时对象身份比较：`game.currentBurrow === b.pos`。洞穴定义会经过 Verdant cooperative placement 生成新的定义对象，逻辑上是同一个洞穴但身份比较脆弱，导致已进入洞穴时内景仍隐藏。改为按稳定 `id` 比较，并保留进入前近距离懒加载：`src/main.js:2034-2042`。

证据：`outputs/m3d-20261030-dev-mobile-ux/visual/03-base-mouth-topdown.png`（进入前）和 `04-base-interior.png`（进入后）；`outputs/m3d-20261030-dev-mobile-ux/qa-burrow-sorrel.json` 中“主洞 可进入”“主洞 扫描内景 GLB 已请求”“主洞 内景容器非空”均为 PASS，`inBurrow=true`，页面硬错误为空。

## 2. 小地图主洞

根因是 `minimap.js` 对超过 `VIEW_RADIUS` 的所有标记直接 return；玩家离主洞超过 34m 时主洞永远不画。主洞现在允许使用边缘投影绘制，保持其他对象的局部视野语义不变：`src/ui/minimap.js:41-51`。主洞世界坐标仍由 `main.js:2284-2289` 传入 `baseBurrow`，未复制或改写坐标。

程序化坐标校验样例见 `outputs/m3d-20261030-dev-mobile-ux/mobile-runtime.json`：主洞定义为 `{x:-38.60999313354492,z:-5.1699958801269545}`，小地图输入来自同一 `g.burrows[0]` 对象；因此坐标一致性为 0 差异。截图证据在 `visual/mobile-sandbox-390x844.png`。

## 3. FPS 显示

根因是主循环将逻辑 `dt` 截断为 50ms，再用 `1/dt` 计算 FPS。现在保留 `dt = min(rawDt, 0.05)` 给游戏逻辑，同时在 dev 通道用 raw RAF 间隔累计 `frames / elapsed`：`src/main.js:3112-3121`、`3159-3168`。沙盒面板也读取 raw frame delta：`src/main.js:2280`。

这次没有改 placement 深层缓存、Raycaster、档位降级或 CPU 热点，边界与 `m3d-20261030-dev-perf-fix` 任务保持分离。

代码回归：`outputs/m3d-20261030-dev-mobile-ux/node-tests.txt`，`node tools/run-node-tests.cjs` 为 `OK 46/46`。真实手机启动证据：`visual/mobile-sandbox-390x844.png`，CDP 参数为 390×844、DPR 3、touch、CPU 4x，运行时结构化数据在 `mobile-runtime.json`。

未完成/未验证：本次未完成真实 180 帧慢帧采样、mean/P50/P95/P99/max、5 秒 CPU profile self-time top，以及“显示 FPS 与 CDP RAF 平均值误差 ≤5%”的定量报告；因此不声称已通过这项定量验收。实现已消除恒定不低于 20 FPS 的直接计算错误。

## 4. 新草素材与醡浆花

`devOn('sorrelFood')` 的实际定义为 `IS_DEV`，dev URL 下为 true，beta/stable 为 false。原链路在 `Food` 构造器中已调用 `_loadSorrel()`，但普通草仍只有程序化材质。现在普通草异步加载 low 档 Verdant 贴图：

- `assets/verdant/tiers/low/grass_medium_02_diff_512.jpg`
- `assets/verdant/tiers/low/grass_medium_02_alpha_512.png`

加载代码和请求记录在 `src/entities/props_entities.js:21-37`、`116-123`；材质加载成功会输出 `[food] verdant grass textures loaded`。醡浆花模型仍通过 `src/entities/props_entities.js:220-229` 的 `shrub-sorrel.glb` 链路加载，成功后隐藏程序化占位物。

证据：`outputs/m3d-20261030-dev-mobile-ux/qa-burrow-sorrel.json` 中 `sorrel=12/12`，请求记录显示本地 `assets/models/shrub-sorrel.glb` HTTP 200；截图为 `visual/04-base-interior.png` 与 `visual/mobile-sandbox-390x844.png`。旧 QA 的 404 TOS 请求随后回退到本地 200，页面无未捕获异常。

未完成/未验证：本次 mobile runtime 在低档 4x 节流下采集时部分 sorrel 请求仍处于 loader 终态等待，未能在该一次 mobile 截图中单独证明 12 个实例全部已替换；桌面 CDP QA 已证明 `12/12`。

## 5. 狼扑击方向

根因是预警线方向、模型当前 yaw 和 dash 向量分别取值，缺少同一份“本次攻击锁定方向”。现在增加 `attackHeadingYaw`，蓄力期间同步朝向，`_beginDash()` 用它生成 `dashDirX/Z`，预警线也使用同一 heading：

- `src/entities/fox.js:169-171`
- `src/entities/fox.js:647-714`
- `src/entities/fox.js:995-1005`
- `src/entities/fox.js:1134-1142`

因此普通狼 wind 结束时满足：预警线角度 = `attackHeadingYaw`，实际冲刺向量 = `(sin(attackHeadingYaw), cos(attackHeadingYaw))`，模型 yaw 同步为同一角度。

未完成/未验证：本次未完成真实手机连续帧采集和角度差结构化证明（<10°），也未输出 wind 起止 yaw 与 dash 位移向量数据；该项需主控继续用 sandbox drill/CDP 补采。

## 回归与隔离

- 改动文件：`src/main.js`、`src/ui/minimap.js`、`src/entities/props_entities.js`、`src/entities/fox.js`。
- 四个改动文件均通过 `node --check`。
- `node tools/run-node-tests.cjs`：`OK 46/46`。
- 未修改 `index-public.html`、`index.html`、`tools/public-shell.cjs`。
- 未改 placement 深层优化；未改 beta/stable 资源与部署配置。
- stable 通道隔离证据来自 `qa-burrow-sorrel.json`：`isDev=false`、稳定版保留 `beam/cap`、无 `interiorGroup`。
- 未 push、未部署。

## 6. 本次续作：dev low/mobile 双草层

在现有 17f0fbd 基础上，仅继续 dev 通道。`Scenery` 在 dev Verdant/fallback low 路径同时保留原有程序化草（`Scenery._buildGrass()`，26,000 instances），并增加独立的本地贴图草层（`Scenery._buildTexturedGrass()`，900 instances）。贴图草不是 `Food` 采食点，明确写入：`grassKind: "textured"`、`edible: false`、`betaGrassEating.compatible: true`、`enabled: false`。这样当前装饰草不会被采食逻辑误收集，但未来接入 beta 草食语义时有稳定类别/兼容标记可复用；现有 `Food`/醡浆花采食链保持不变。

加载路径全部为仓库本地，失败只记录 warning 并保留程序化草：

- `assets/verdant/tiers/low/grass_medium_02_diff_512.jpg` — 31,523 bytes，SHA-256 `9b850a7f917a10050b26a03e871f912a417ae795bb05edacc781c20bb63352e3`
- `assets/verdant/tiers/low/grass_medium_02_alpha_512.png` — 42,537 bytes，SHA-256 `12c1c772d023c0c78abc3e4eaae1dd9dd6e24d5e0fc4b7a98ecec730742b481d`

## 7. Poly Haven API 研究与授权

已查阅 Poly Haven API 页面（2026-10-30；页面标注更新日期 2026-07-18）：API 对商业使用免费开放，资产为 CC0；若使用 live API，页面要求向用户明确说明资产来自 Poly Haven，并示例请求带唯一 User-Agent。`GET /assets` 元数据包含下载/缩略图信息与 `files_hash`。研究结论是本任务不引入运行时远程依赖：现有仓库内 Verdant low 草贴图已足够，且本地加载可离线、可复现、可 fail-soft。Poly Haven API 仅作为未来补充资产的研究入口，不在本次 dev 代码中请求。

参考：`https://polyhaven.com/our-api`（页面标注 API 公共免费、资产 CC0、需 attribution/User-Agent，访问日期 2026-10-30）。

## 8. 本次验证证据

- `node --check`：`src/world/props.js`、`src/entities/props_entities.js`、`src/main.js`、`src/ui/minimap.js`、`src/entities/fox.js` 均通过。
- `node tools/run-node-tests.cjs`：`OK 47/47`（原基线 46/46 以上；新增 `test-dev-grass-assets.cjs`）。
- 真实 managed Chrome/CDP dev low：`outputs/m3d-20261030-dev-mobile-ux/grass-browser-qa.json`。在 390×844、DPR 3 及 1280×720 两个视口采集；运行时读到程序化草 `count=26000`、贴图草 `count=900`，贴图 map 为本地 `assets/verdant/tiers/low/grass_medium_02_diff_512.jpg`、alpha map 存在；两个贴图请求 HTTP 200；console errors 为空。
- 截图：`visual/grass-dev-low-mobile-390x844-dpr3.png`、`visual/grass-dev-low-desktop-1280x720.png`。

未完成/未验证：本次 managed Chrome 的 `webgl=1` low probe 走的是 dev fallback（`verdant=false`），因此没有把 WebGPU Verdant GLB 内部植被与新增层拆开做 GPU 级别计数；但 dev low 实际运行时已证明两种草层均存在、贴图路径成功、无 console error。原有洞穴、小地图、raw RAF FPS、普通草/醡浆花、狼方向修复证据继续沿用第 1–5 节，未改动其逻辑。
