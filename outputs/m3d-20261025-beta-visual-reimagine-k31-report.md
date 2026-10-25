# m3d-20261025-beta-visual-reimagine-k31 交付报告

- 时间：2026-10-25（Asia/Shanghai）
- JOB：`/home/fame/code/marmot3d/m3d-beta-visual-reimagine-k31-20261025`
- 分支：`codex/beta-visual-reimagine-k31-20261025`
- 基线：`c478e7e8b7ba4435fdf9895d9cba91c62999f975`
- 范围：仅本 JOB；仅 beta 表现层；未改 stable/dev、Caddy、systemd、线上文件或版本戳；未 push、未部署。

## 1. 场景理解与自主设计决策

实现前梳理了 `src/main.js` 的启动/主循环、`src/world/scene.js` 的天空/地形/光照、`src/world/props.js` 的草/岩石/洞穴，以及 `terrainHeight` 共享高度场、实例草啃食网格、模型回退和自适应渲染路径。

主要视觉问题不是缺少玩法内容，而是：地表颜色过于平；草在空间上稀薄且单片感强；摄影测量扫描块与 44 个圆锥远山叠加，地平线出现明显碎片和孔洞；场景缺少小尺度色彩及动态环境细节。

选择的方向是“风中的高原草甸”：保留低多边形角色/玩法语言，但用连续的多层山脊、较浓的云层、冷暖分离的地表色斑、交叉草叶、稀疏野花及漂浮微粒统一环境。没有修改角色造型、UI、镜头、战斗数值、碰撞体、食物点或共享高度场。

### 实现内容

1. **地形色彩**：beta 地形构建和换关时，在原顶点色中加入两尺度 `fbm` 色斑与轻微明度变化。只在初始化/换关计算，不新增逐像素噪声开销；位置 Y、法线来源和碰撞高度不变。
2. **远景重写**：beta 用 3 层连续、闭合轮廓的低面数山脊代替 44 个圆锥体；山脊不透明、参与雾，换关时混合关卡雾色。真实摄影测量资源仍正常异步加载，原 `buildBackdrop` / `loadSceneModel` 失败回退未删除；beta 不再叠加其带孔洞的边缘扫描网格，stable/dev 保持原显示。
3. **天空/雾**：beta 云量由 0.42 调至 0.52；默认雾 near 由 70 调到 60，far 仍为 420，关卡自定义雾、沙尘和洞内雾逻辑不变。
4. **草海**：仍为 26,000 个实例、原风摆 shader、原啃食 `growth` / `grazeGrid` / 恢复流程；beta 单株由 2 个三角面改为 6 个三角面的三向交叉草叶，并把散布集中到可玩区，提升近中景密度，减少外围浪费。
5. **环境细节**：beta 新增 180 株野花（茎、花各一个 `InstancedMesh`，合计两个 draw call）与 42 个低频动态微粒。微粒不参与透明排序复杂场景，不投射阴影；花与微粒均无碰撞、无交互误导。
6. **预算控制**：没有引入实时反射、后处理、贴图下载、逐帧 CPU 草矩阵重建或高细分模型；地表噪声仅初始化/换关计算。曾试验每像素地形噪声，考虑性能后撤掉并改为顶点色方案。
7. **隔离**：所有新增草叶顶点、花、微粒、山脊和雾变化均有 beta 条件；stable 使用旧 6 顶点草叶、旧散布、旧 44 个远山与原雾。

## 2. 改动文件

- `src/main.js`
  - beta 摄影测量远景继续加载但不与连续山脊叠加；
  - beta 默认 fog near；
  - beta 每帧更新环境微粒。
- `src/world/scene.js`
  - beta 地形顶点色、多层连续山脊、云层、雾及关卡山脊配色；
  - 保留 `_buildLegacyHills()` 给 stable/dev。
- `src/world/props.js`
  - beta 交叉草叶和可玩区散布；
  - 实例野花、微粒及动画更新；
  - 啃草、恢复、岩石碰撞、洞穴灯光与交互保持原实现。

## 3. 前后对比证据

证据目录：`outputs/visual-reimagine/`。基线通过 `git archive c478e7e8...` 解到 `/tmp` 后由 8124 端口独立静态服务运行，没有覆盖或清理其他工作树；改造版由本 JOB 的 8123 端口运行。

| 同机位场景 | 基线 | 改造后 |
|---|---|---|
| 菜单 | `before-title.png` | `clean-acceptance-title.png` |
| 实战/地形/远岭 | `before-vista.png` | `clean-acceptance-vista.png` |
| 洞穴与环境光 | `before-burrow.png` | `clean-acceptance-burrow.png` |
| 程序化藏狐可见性 | `before-fox.png` | `clean-acceptance-fox.png` |
| 触屏菜单/实战 | 基线未另拍窄屏 | `acceptance-mobile-title.png`、`acceptance-mobile-play.png` |

最直观差异：基线 `before-vista.png` 中扫描碎片横穿天空且后方为圆锥山；改造后 `clean-acceptance-vista.png` 地平线连续，草更饱满，远岭融入雾，色斑与环境细节提供层次。截图已实际查看验收，不以“脚本跑完”替代视觉检查。

机器可读数据：

- 基线：草实例 26,000；每株 6 顶点；44 个圆锥远山；摄影远景可见；fog `70/420`。
- 改造：草实例仍为 26,000；每株 18 顶点；野花 180 + 180 实例；微粒 42；3 层山脊；摄影资源已加载但不叠加；fog `60/420`。
- 相同实战机位 `drawCalls=25`、`triangles=2856`，基线与改造一致（该计数只代表该帧可见物，非全场总几何量）。
- 见 `before-report.json`、`final-acceptance-report.json`、`clean-acceptance-report.json`。

## 4. 性能影响

同机位、相同 75 帧采样方式、headless Chrome + SwiftShader 软件渲染：

| 测量 | 基线 | 改造后 |
|---|---:|---:|
| 平均帧间隔 | 776.86 ms | 652.86 ms |
| P95 帧间隔 | 833.30 ms | 683.40 ms |
| 实战 draw calls | 25 | 25 |
| 实战 triangles | 2,856 | 2,856 |
| 单株草几何 | 6 顶点 | 18 顶点 |

原始输出：`before-desktop-performance.log`、`after-desktop-performance.log`。

**解读限制**：这是共享机器上的软件 GPU，绝对帧时间极慢且受其他进程影响，不能等同于玩家独显 FPS，也不能据此宣称真实设备加速 16%。可以确认的是：草株几何上限增加约 3 倍，但实例数和啃草 CPU 路径不变；新增野花只有两个实例 draw call，微粒只有一个 points draw call；山脊从 44 个独立对象降为 3 个；隐藏重复摄影远景消除了大量远景绘制。没有获得可靠的真实 GPU 前后帧率，因此性能风险仍保留，见第 7 节。

## 5. 验证命令与真实结果

### 语法与现有 Node 测试

```text
$ node --check src/main.js
(exit 0，无输出)
$ node --check src/world/scene.js
(exit 0，无输出)
$ node --check src/world/props.js
(exit 0，无输出)
$ node tools/run-node-tests.cjs
PASS ...（逐项输出见 outputs/visual-reimagine/node-tests-final2.log）
OK 57/57
22 browser/CDP tests skipped (need Chrome)
$ git diff --check
(exit 0，无输出)
```

### 可执行视觉 / CDP 验收

使用本机已有 Playwright Core 驱动 `/opt/google/chrome/chrome`（Playwright 本身通过 CDP 控制页面），真实加载 8123 静态服务并截图。

```text
$ node /tmp/clean-acceptance.cjs
base.mode = title
base.beta = true
grass = 26000; grassVertices = 18
flowerGroups = [180,180]; fireflies = 42
ridgeLayers = 3; backdropLoaded = true; backdropVisible = false
play.mode = play; drawCalls = 25; triangles = 2856; foxes = 2
movement = 0.192
fox.visible = true; fox.realVisible = false
errors = []
http = []
checks = 全部 true
```

该 clean 验收只对本地静态服务本来就没有的可选 API/音频请求做了网络夹具：`/marmot3d-beta/api/**` 返回 QA 游客 JSON，`/assets/audio/**` 返回 204；游戏场景、模型、交互和渲染没有 mock。这样隔离外部依赖后，console error、page error、HTTP 失败均为 0。

另一次不 mock 外部依赖的桌面 + 390×844 触屏验收：

```text
$ node /tmp/qa-finale.cjs
桌面：title -> play，移动距离 0.192，洞口 4 盏灯光，程序化藏狐可见。
触屏：mode=play，touch=true，canvas=[390,844]。
checks.betaOnly/started/playerMoved/grassInstanced/foxVisible/mobilePlay 全 true。
consoleErrors：本地可选 API 与 MP3 404（基线同样存在，详见已知风险）。
```

stable 隔离实跑：

```text
$ node /tmp/stable-check.cjs
isBeta=false
grassVertices=6
flowers=false
fireflies=false
hills=44
fog=70
```

### 验收工具问题

`node tools/smoke.cjs ...` 与 `CHROME_PATH=/opt/google/chrome/chrome node tools/visual-regression.cjs ...` 在本机新建 headless Chrome 时无法稳定连接调试端口，分别得到“无法连接 CDP”和“调试页面启动失败”。失败日志保留在 `before-smoke.log`、`visual-regression.log`。随后改用上述可执行 Playwright/CDP 流程，完成了真实页面、截图、交互和错误采集，未把工具启动失败记为通过。

## 6. 可玩性 / 回退确认

- `terrainHeight`、地形 Y 位移、岩石 `rockColliders`、竞技场边界、藏狐与食物点位均未改。
- 啃草仍操作同一个 26,000 实例网格，生长/恢复/能量结算函数未改。
- 洞穴井壁、暖光、冷色天光和 underground 压暗路径未改；截图包含洞穴视角。
- 第一人称移动、藏狐可见、触屏进入游戏均已真实执行。
- 真实资源加载及狐狸/模型的现有回退代码未删除；beta 仅决定摄影远景是否叠加显示。
- stable 实跑验证旧几何和旧环境路径。

## 7. 未完成项与已知风险

1. **真实硬件 GPU 性能未测**：当前只有 SwiftShader 数据。低端移动设备上，26,000 × 6 三角面的草地仍可能增加顶点/填充压力；已有自适应 DPR/阴影降级保留，但没有新增草密度档位。
2. **本地默认静态服务有外部依赖 404**：游客 API 与 `menu/explore/tension/helpCry` 音频在纯静态 QA 服务上 404，浏览器会记 resource error；基线有相同问题。它们不是本次场景修改引入，已有音频回退未改。隔离这些依赖后的 clean 验收 console/page errors 为 0。
3. **真实 GLB 角色截图未纳入本次最终证据**：最终截图使用 `models=off&foxmodel=off` 聚焦程序化场景及回退；真实资源加载路径未改，纯 Node 模型/回退相关测试通过。额外默认 URL 探测无 page error，但没有把它当作真实 GLB 角色可见性验收。
4. **摄影测量远景 beta 默认不显示**：这是为了消除扫描孔洞与重复远景的明确视觉决策，不是资源删除；若后续希望重新展示，应先修补扫描边缘或做封闭远景网格，而不是直接恢复叠加。
5. **未扩展美术到角色、UI 和镜头**：本轮集中在程序化环境，角色造型、HUD、FOV 和战斗反馈保持原样。
6. **未做全部 12 关人工视觉巡检**：换关配色仍走原 `applyLevel`，但本轮截图重点覆盖第一关、洞口和触屏；特殊沙尘关只保留原逻辑，未逐关美术验收。

## 8. 交付边界

未改 Caddy/systemd/版本戳，未编辑线上文件，未 push、未部署。仅允许并执行 JOB 内本地提交；`.codex-lock/` 保持原样且未纳入提交。
