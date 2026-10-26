# m3d-20261026-beta-k31-scene-merge — K3.1 场景修复选择性合并报告

## 结果

- 基线：`17ca387`（beta rev34）；源提交：`c879516`。
- 仅手工摘取场景修复到 `src/main.js`、`src/world/scene.js`；未 cherry-pick 源提交。
- 天空：保留 rev34 现有 pure-sky 纹理加载路径、天空 shader/uniform 和云量 `0.42`；未改 `src/world/props.js`。
- **视觉验收未完成**：本地 8200 静态服可启动，但对 job 树页面的 CDP `Runtime.evaluate` / `Page.captureScreenshot` 未能在时限内返回；独立 headless Chrome 未成功启用调试端口。因而此提交不宣称已证明截图逐像素天空一致、地平线视觉改善或 stable/dev 截图零差异。`outputs/m3d-20261026-beta-k31-scene-merge/visual/` 预留但无截图。

## 源提交 hunk 处置

### `src/main.js`

| 源 hunk | 处置 | 说明 |
|---|---|---|
| `buildBackdrop().then`：Beta 下 `root.visible = false` | 合并 | 只对 Beta 隐藏扫描网格 backdrop；stable/dev 保持原状。由程序化地形/地平线继续绘制，修复 backdrop 网格孔洞。 |
| `env.fogBase` 默认值 `70 → IS_BETA ? 60 : 70` | 合并 | Beta 场景雾 near 调整为 60，stable/dev 仍为 70。 |
| `applyEnvModifiers` 无关卡覆盖时的雾 near fallback | 合并 | fallback 改为 `(IS_BETA ? 60 : 70)`；关卡显式 `fogNear` 仍优先。 |
| `frame()` 中 `if (IS_BETA) scenery.update(dt)` | 排除 | 源提交里的 `Scenery.update()` 只更新 `fireflies` 的旋转、透明度、垂直浮动；该装饰依赖的 `props.js` 改动整体排除，且不被地形/地平线修复依赖。目标 `Scenery` 也没有此方法，故不加调用以避免运行时异常。 |

### `src/world/scene.js`

| 源 hunk | 处置 | 说明 |
|---|---|---|
| `terrainHeight` 导入同时引入 `fbm` | 合并 | 仅地形斑驳着色使用；目标 rev34 已有 `IS_BETA` 导入，不重复改动。 |
| `Sky` 构造中的雾 near `70 → IS_BETA ? 60 : 70` | 合并 | 初始场景雾近裁剪距离按 Beta 60 / 其他版本 70 设置，far 维持 420。 |
| Dome `cloudiness` `0.42 → 0.52` | 排除 | 保持 rev34 pure sky 云量 0.42；天空 shader 与 uniform 未修改。 |
| `_buildTerrain()` 的 FBM 斑驳、Beta roughness `0.98` | 合并 | 两项均受 `IS_BETA` 限定；stable/dev 仍使用原颜色计算与 roughness 0.96。 |
| `_buildHills()` Beta 连续山脊 | 合并 | Beta 走三层低多边形连续山脊；新增 `_buildLegacyHills()` 保留非 Beta 原锥体远山路径。 |
| `applyLevel()` 的 FBM 颜色重算与远山调色板 | 合并 | Beta 的地形颜色与生成时公式保持一致，避免换关后颜色被覆盖；非 Beta 保留原逻辑。 |
| rev34 与 K3.1 基线差异中的 pure-sky 纹理状态/加载器变化 | 跳过 | 这是源分支与 rev34 的基线漂移，而不是本次需要移植的地形 hunk；保留 rev34 当前 `skyTextureStatus`、`_loadCitrusSky()` 与纹理资源加载代码。 |

### `src/world/props.js` 与排除项

源提交的 6 个 `props.js` hunk 全部排除：草叶几何、草地散布范围、采食查询 API/参数、`Scenery.update()` 及 firefly/wildflower 构建调用和方法均未移植。避免引入用户排除的花朵及其它非本次场景修复改动。源提交改动文件中无 `src/entities/` 土拨鼠/狐狸模型文件；未发现应另行移植的动物模型改动。源分支相对 rev34 的其它跨基线差异也未采用。

## 隔离检查

- `src/main.js` 的 backdrop 与雾 near 改动均 Beta 条件化；stable/dev 值和 backdrop 可见性保持原分支行为。
- `scene.js` 地形颜色、roughness、山脊路径按 `IS_BETA` 分流；非 Beta 继续调用旧山体构建/调色逻辑。
- 纯天空纹理与 Dome shader/uniform 不在本次 diff 中；雾属于场景雾设置。
- 未改 `index-public.html`、版本戳、`vendor/`、测试、第三方依赖或部署配置。

## 验证

| 检查 | 结果 |
|---|---|
| `node --check src/main.js` | 通过 |
| `node --check src/world/scene.js` | 通过 |
| `node tools/run-node-tests.cjs` | `OK 75/75`，无失败；22 个需 Chrome/CDP 的浏览器测试按脚本标记为 SKIP |
| `git diff --check` | 通过 |
| Beta 桌面/移动截图、孔洞前后对比、天空逐像素比较 | 未完成；CDP/Headless 页面截图超时，未生成证据文件 |
| stable `/` 与 dev `?version=dev` 截图差异 | 未完成；仅完成条件分支代码审查，不能作为截图零差异证据 |
| stable/dev 与 `index-public.html`、版本戳、`vendor/` 是否有改动 | 无此类改动 |

## 证据索引

- 代码差异：`src/main.js`、`src/world/scene.js`。
- 测试输出：本次运行 `node tools/run-node-tests.cjs` 的终端记录（75/75，无失败，22 项浏览器测试跳过）。
- 视觉目录：`outputs/m3d-20261026-beta-k31-scene-merge/visual/`（当前为空；截图采集未成功）。

## 自评与遗留

- 选择性移植：**9/10**。移植范围 Beta 隔离，跨基线 pure-sky 路径保留，排除项未带入。
- 总体验收：**未完全通过**。代码检查和 Node 测试通过；视觉验收是缺项，而非通过项。
- 遗留：在可用的本地 Chrome/CDP 会话中补采 1280×720 与 390×844 Beta、stable、dev 截图；用相同视角/冻结天空时间对比 rev34 与合并版天空像素，并检查远景孔洞和无花状态。补证前不要把 pure-sky 像素级一致、孔洞视觉修复或 stable/dev 截图零差异当作已验证结论。
- 未 push、未部署。
