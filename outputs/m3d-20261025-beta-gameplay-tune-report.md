# m3d-20261025 beta 玩法调优交付报告

- 通道：**beta**；分支：`codex/beta-gameplay-tune-20261025`
- 基线：`1462c32d9f3d62e6897a88244b93d2eba8979bd7`（origin/beta rev26）
- 工作树：`/home/fame/code/marmot3d/m3d-beta-gameplay-tune-20261025`
- 日期：2026-10-25（Asia/Shanghai）
- 实现 HEAD：`c3056a78edd99d2196a254ac2791b96a230ac852`；本报告及最终日志另作文档提交。

> **没有 push，没有部署，没有修改线上文件、Caddy 或 systemd。** 未改 `index-public.html`、`tools/public-shell.cjs` 的 `VERSION_STAMP`、`src/core/version.js` 的 `BUILD_STAMP`。未新增第三方运行时依赖，未删除测试或放宽断言。保留了任务开始时已有的 `src/main.js` 修改和未跟踪的 `src/sandbox/recorder.js`。

## 1. 需求验收总表

### A：狐狸与战斗（保留既有 `40b3365`，未重做）

- **A1 rest_safe 真回血：完成。** `stepRestSafe()` 按 `FOX.retreat.regenPerSec` 回血并封顶；`fox.js` 应用返回 HP，且避免与普通休息回血重复。普通狐 6 秒撤退休息可回到满血。
- **A2 普通狐更耐打：完成。** normal HP `3→6`、heavy `6→9`；撤退线 `0.45→0.32`，最强常规迎击两下不会打死或打跑。
- **A3 多狐可造成伤害：完成。** 沙盒不再默认开启 godMode；增加常驻无敌状态徽标。每狐接触冷却独立 `0.9s`，玩家受击全局无敌仅 `0.12s`，避免多狐伤害被长无敌帧吞掉。翻滚/迎击无敌不变。
- **A4 普通狐不可打死、首领一去不返：完成。** HP 归零先逃跑；非 boss 按增援计时重生，boss 不重生。恢复旧版“驱退”计数与文案。

### B：beta 沙盒操作录制（非视频）

- **完成。** 沙盒面板可开始/停止、查看可读战斗摘要、导出 JSON；记录玩家出招、命中、受伤、跳跃、翻滚、爆发、大招、视角、采食、12Hz 位姿抽样，以及狐狸状态迁移和增援。
- 格式为 `marmot-3d-action-recording` v1，含开始元数据、相对时间事件、按狐伤害账本和时间线。上限 4000 条，超限丢弃最旧事件；重新开始会清空上一段。它是观测记录，不承诺无 seed 随机 AI 的确定性回放。
- 保留既有音频、导入/导出与沙盒行为；录制器仅在 `IS_BETA` 下创建。修复了初始化顺序导致的 `sandboxRecorder` TDZ 启动错误。

### C / D：原始采食、交互和移动要求

- **C1 洞内不能吃草：完成。** beta 两种洞内均禁止采食；不存在绕过口腔的洞内壁直接回体力。
- **C2 采花回血且降低储备收益：完成并由追加需求取代即时收益。** 花朵不再直接给一批储备，而是在 8 秒内渐缓恢复固定总量 18 HP + 28 体力；奔跑不中断，体力部分服从脂肪转化。
- **C3 吃草显著减速：完成。** beta 啃草姿态移速倍率 `0.16`，叠加普通移速倍率。
- **C4/C5 跳跃与攻击打断采食、蓄力不打断：完成。** 跳跃及实际攻击释放调用中断；按住蓄力期间仍可采食。
- **C6 底部显示“啃草中”：完成。** beta 不再显示“危险”作为啃草标签。
- **C7 可采花时“采集”并变色：完成。** 触屏按钮、键盘提示和技能条同步。
- **D1 普通移速略降：完成。** beta `moveSpeedMul` 从 `1.12` 调至 `1.07`。
- **D2 移动键范围放宽：完成。** beta 摇杆缩放 `0.5–1.8`；stable/dev 保持 `0.7–1.4`。

### 17:01 / 17:03 追加及 17:14 / 17:15 更正

- **前方采食、耗尽与稀疏减速：完成。** 使用既有连续 growth 网格，不重做已合并的 graze-sparse。以 `controller.bodyYaw` 为中心的 120° 前锥过滤草株；后方草不受影响。耗尽时无产出，保留 regrowth；实际草料按前锥局部真实密度连续下降。
- **有限口腔缓冲：完成。** 啃草仅 12% 立即进入代谢，88% 进入容量 36 的口腔；超出容量明确记为 spill。洞外站立且不啃草、不奔跑时以 5/s 自动咀嚼。
- **两种洞都只咀嚼，主洞更快：完成。** 主洞 `base` 12/s，临时洞 `shelter` 7.5/s；唯一区别是配置咀嚼速率。空口腔产出严格为 0，不存在独立直接回体力路径。
- **体力与不可逆脂肪：完成。** beta 规范状态为 `p.stamina`，UI 为“体力值”；`installEnergyAlias()` 保留 `p.energy` 双向兼容。体力 ≤60% 不转脂肪，60%–100% 线性增加转化比例，100% 时全部转脂肪；无任何脂肪转回体力路径。HUD 同时显示脂肪储备与口中草料。
- **采花渐缓恢复：完成。** 固定总量、线性下降至零的速率积分，移动/奔跑独立；营养经同一 `applyNutrition()`。
- **关卡脂肪目标：完成。** 12 关均有 `fatGoal`（24–54），beta 完成条件改为脂肪达到本关目标，stable/dev 仍用旧食物计数。
- **指定 citrus 天空：完成。** 只使用 `citrus_orchard_road_puresky_8k` 的 1K 派生图，不使用 kloofendal 或其他 HDRI；beta 限定、加载失败保留程序化渐变，详见第 4 节。

## 2. 实现结构与兼容性

- 纯逻辑：`src/core/stamina.mjs` 提供体力夹取、energy alias、脂肪曲线、营养守恒、入口/口腔、咀嚼及花朵恢复；`src/core/graze-grid.mjs` 提供连续网格和前锥查询。
- 配置：`src/core/beta-tuning.js` 集中保存前锥、密度产能、口腔、咀嚼、脂肪、花朵、移动参数；洞口身份沿用 `game.currentBurrow.type` 的 `base` / `shelter`。
- 运行时：`src/main.js` 仅在 beta 接入新代谢；非 beta 保留原静止/洞内恢复。花朵恢复每帧先结算 HP，再走共同营养入口。
- 目标：`src/core/objectives.js` 根据 beta 标志选择脂肪或旧食物目标；`src/ui/hud.js` 显示对应文案。
- 数值守恒：口腔溢出显式丢弃；体力上限截断的部分转脂肪；脂肪自身容量截断记为 overflow，不会反向回体力。
- stable/dev：新天空、录制器、新代谢、beta 移速/交互/文案均有 beta 守卫；版本检测与 stable 进度契约测试通过。

## 3. 本地提交

| Commit | 内容 |
|---|---|
| `40b3365fc576163ec646c0bedd16db6bf77e3681` | A 组狐狸/战斗平衡（任务开始时已存在，保留） |
| `a9bc667c67cca222d90da757a7c94ae68a671d9d` | 前锥采食与口腔/体力/脂肪纯逻辑及测试 |
| `b9aac5e7b8a5dd83703ef9bcb5f04be77ddf2ced` | 运行时代谢、采花、脂肪目标、HUD、沙盒录制器 |
| `6fc4fdb116cfbcdd301dc22cb69c79d9ebf07ee7` | 指定 citrus 1K 天空、程序化回退、浏览器证据 |
| `c3056a78edd99d2196a254ac2791b96a230ac852` | 采食打断、提示/配色、移速与触控范围收尾 |

## 4. 天空资产与真实浏览器证据

### 精确来源与派生

- Verdant/TOS 包：`/home/fame/marmot3d-assets/assets.7z`
- 包内源路径：`assets/citrus_orchard_road_puresky_8k.exr`
- 源：`8192×4096`，EXR，`271,693,799` bytes；SHA-256 `13ca6ad7cd6acb3e598be1468c6a14b8c2f95514168c100db3126abdb68e87e5`
- 运行时：`assets/sky/citrus_orchard_road_puresky_1k.jpg`
- 派生：`1024×512`，JPEG sRGB quality 92，`46,141` bytes；SHA-256 `9fcebaa8f6d91ec76300c71820869ee4d0abd4959c4f1c3f0b972564f3560511`
- 转换：OpenCV `INTER_AREA`、exposure 0.7、Reinhard、IEC sRGB transfer。元数据固定在 `assets/sky/citrus_orchard_road_puresky_1k.json`。
- 未把多 MB 的 4K/8K 资源放进仓库。

### 加载、朝向及回退

- `src/world/scene.js` 使用项目已有 `THREE.TextureLoader`，设置 `SRGBColorSpace` 与 `EquirectangularReflectionMapping`。
- 仅 beta procedural map 加载；加载成功前保留渐变 dome，成功后隐藏 dome；失败时状态为 `fallback` 并恢复 dome。
- `backgroundRotation=[0,0,0]`，截图地平线朝上、方向正确；实测渲染器为 **WebGLRenderer**，证明 WebGL2 路径可用。
- stable/dev 不进入该 beta 加载分支，原天空行为不变。

### Managed Chrome（非自启 SwiftShader）

命令：`node tools/qa-beta-sky-managed.cjs`，连接 `http://127.0.0.1:18800`，使用 Target.createTarget/closeTarget，单轮 122.166 秒（低于 8 分钟上限）。为避免无关 guest-account 静态服务 404 噪音，harness 仅 stub 本地游客账号签发。

- **正常路径 PASS：** `citrus_orchard_road_puresky_1k.jpg` HTTP **200**，MIME `image/jpeg`；状态 `loaded`、背景 URL 正确、`domeVisible=false`、mapping 303、colorSpace `srgb`；console errors **0**、exceptions **0**。
- **故障路径 PASS：** 拦截同一 JPG 请求；状态 `fallback` / `texture-load-failed`，背景为空、`domeVisible=true`；console errors **0**、exceptions **0**。创建的 targets 均关闭。
- 正常截图：`outputs/beta-gameplay-qa/sky-citrus-loaded.png`
- 回退截图：`outputs/beta-gameplay-qa/sky-fallback.png`
- 原始证据：`outputs/beta-gameplay-qa/sky-browser-evidence.json`

## 5. 最终验证（真实命令与结果）

### 语法

对基线至 HEAD 的全部 22 个变更 JS/MJS/CJS 文件逐个执行 `node --check`，**22/22 通过**。原始输出：`outputs/beta-gameplay-qa/final-syntax.txt`。

```bash
git diff --name-only 1462c32d9f3d62e6897a88244b93d2eba8979bd7..HEAD \
  | grep -E '\.(js|mjs|cjs)$' | while read -r f; do node --check "$f"; done
```

### 项目 Node 测试入口

```bash
node tools/run-node-tests.cjs
```

结果：**OK 59/59，0 fail**；运行器另列 **22 个 legacy browser/CDP tests skipped (need Chrome)**。原始输出：`outputs/beta-gameplay-qa/final-node-tests.txt`。这些 skip 是 Node 入口的既有分类，不将 skip 计入 pass。

### 追加需求 focused node:test

```bash
node --test tools/test-stamina.mjs tools/test-graze-grid.mjs \
  tools/test-objectives.mjs tools/test-sandbox-recorder.mjs \
  tools/test-beta-gameplay-contract.mjs tools/test-beta-sky.mjs
```

结果：**25 tests，25 pass，0 fail，0 skipped**。覆盖口腔容量/溢出/站立咀嚼、两种洞只咀嚼且主洞更快、空口零恢复、60%–100% 脂肪曲线、花朵固定总量/渐缓/奔跑独立、稀疏速度下降、前锥/耗尽/再生、脂肪目标、录制和天空静态契约。原始输出：`outputs/beta-gameplay-qa/final-focused-tests.txt`。

### 触控与 beta 契约

```bash
node tools/test-touch-layout.js
node tools/test-touch-layout-cards.test.cjs
node tools/test-beta-contract.cjs
```

- touch-layout：**全部断言通过**。
- touch-layout-cards：**5 tests，5 pass，0 fail**。
- beta-contract：**通过**（beta 入口、版本检测、独立全解锁、stable progression）。前两项原始输出：`outputs/beta-gameplay-qa/final-touch-tests.txt`。

## 6. 变更文件

- 核心：`src/core/beta-tuning.js`、`src/core/config.js`、`src/core/fox-motion.js`、`src/core/graze-grid.mjs`、`src/core/objectives.js`、`src/core/stamina.mjs`。
- 运行时/实体：`src/main.js`、`src/entities/fox.js`、`src/world/props.js`、`src/world/scene.js`。
- UI/录制：`src/sandbox/panel.js`、`src/sandbox/recorder.js`、`src/ui/hud.js`、`src/ui/touch-layout.js`、`styles.css`。
- 天空：`assets/sky/citrus_orchard_road_puresky_1k.jpg`、`assets/sky/citrus_orchard_road_puresky_1k.json`。
- 测试/QA：`tools/qa-beta-sky-managed.cjs`、`tools/test-beta-gameplay-contract.mjs`、`tools/test-beta-sky.mjs`、`tools/test-fox-repel.cjs`、`tools/test-graze-grid.mjs`、`tools/test-objectives.mjs`、`tools/test-sandbox-recorder.mjs`、`tools/test-stamina.mjs`。
- 报告/证据：本报告；`outputs/beta-gameplay-qa/` 下正常/回退截图、浏览器 JSON、最终 syntax/node/focused/touch 四份日志。

## 7. 已知限制与未关闭项

- **功能需求无已知未关闭项。** 上述追加与更正均已实现并有对应测试。
- 浏览器实测针对指定天空正常/失败路径及同屏 HUD；没有把 22 个 legacy browser/CDP 测试包装成已通过，也未声称做过全关卡人工通关。
- 操作录制是事件/位姿观测与 JSON 导出，不是视频或确定性回放，这是本需求的设计边界。
- `.codex-lock/` 是未跟踪的本地工具状态，不属于交付，不提交。
- **最终状态：仅本地提交；nothing was pushed or deployed。**
