# m3d-20261026-dev-burrow-sorrel-marmot

- 分支：`feat/dev-burrow-sorrel-marmot-20261026`
- 基线：`d266ce6`
- 通道：dev（`?version=dev`），stable/beta 通过 `IS_DEV` 保持原路径
- commit：`bb4f5a3`
- push/deploy：未 push，未部署

## 完成的代码行为

- dev 洞口配置缩小为主洞 `openingRadius=1.3 / slopeRadius=2.4`、临时洞 `0.75 / 1.35`；dev 洞口保留低矮挖土环、暗洞口和悬浮文字，移除光柱、顶环、地面亮盘、临时洞 beacon/sbeam 和夸张洞内光。
- dev 首次靠近洞口时懒加载 `burrow-main-interior.glb` / `burrow-shelter-interior.glb`；扫描材质通过 loader 强制双面，加载失败保留程序化洞穴回退。
- Verdant dev 进洞的地面解析现在允许从高度场地表下降到洞内平底，并在洞内使用地下 floor 查询，避免被 Verdant 安全回收逻辑吸回地表；天气、HUD、攻击限制和回储备继续使用既有 `game.inBurrow` 语义。
- dev 玩家第三人称模型和同伴使用 `marmot-screaming.glb`，黑色身体材质染为土拨鼠棕；加载失败或 `?models=off` 回退程序化土拨鼠。稳定版仍使用原 `marmot.glb`/程序化路径。
- dev 可采集草本异步替换为 `shrub-sorrel.glb`，目标高度约 0.4m；采食隐藏、reset 恢复和食性数值逻辑未改，加载失败回退原草本。
- 新增纯逻辑测试覆盖 dev 洞口尺寸、洞口触发区和 dev/stable 开关门控。

## 修改文件

`src/core/controls.js`, `src/core/version.js`, `src/entities/props_entities.js`, `src/main.js`, `src/world/props.js`, `src/world/underground.js`, `tools/test-dev-burrow.cjs`。

## 验证

- `node --check`：7 个改动的 `.js/.cjs` 文件全部通过。
- `node tools/test-dev-burrow.cjs`：2/2 通过。
- `node tools/run-node-tests.cjs`：基线已知 `tools/test-beta-contract.cjs` 失败 1 项；其余 37 项通过，浏览器/CDP 测试按入口规则跳过。未修改该测试或版本戳。
- `git diff --check`：通过。

## 截图矩阵

截图目录：`outputs/m3d-20261026-dev-burrow-sorrel-marmot/visual/`。

已保存 `dev-desktop-overview.png` 与 `dev-desktop-loaded.png`，但当前共享 Chrome 使用的网络命名空间拒绝本工作树新启动的本地端口（`ERR_CONNECTION_REFUSED`）；已有共享端口指向另一工作树。因此主洞/临时洞近远景、进出洞第一/第三人称、sorrel 采食、尖叫土拨鼠和 stable 隔离截图未能在本轮得到可信画面证据，不能标记为通过。截图后端原计划为 Chrome SwiftShader/WebGL；实际 dev 页面未能越过本地连接阻塞。

## 未完成项与已知问题

- 需要在能访问本工作树静态服的 Chrome/CDP 环境补齐验收矩阵截图，尤其验证扫描内景的实际尺度、朝向和玩家走出洞口的观感。
- 当前报告中的截图证据只证明启动页可被捕获，不证明视觉验收项。
- stable/beta 的素材路径和地标分支未改；仍需在可用浏览器环境做一次对照截图确认。

## 自评

代码集成、dev 门控、进洞地面逻辑、懒加载和 Node 回归已完成；视觉验收因共享浏览器网络隔离阻塞，完成度 7/10。
