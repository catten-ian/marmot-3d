# m3d-20261025-beta-paf-fpv-k31 验收报告

扮演狐狸 FPV 前爪 / 身体 cues，与 PAF 专用藏狐、土拨鼠模型返工。

- 实际任务模型：**`k3.1-pro`（`kimi-k3.1-pro`）**。
- 通道：beta；分支：`codex/beta-paf-fpv-k31-20261025`。
- 基线：`8994ab186aaa1b037b86589da9609df4b14eb528`。
- 本地提交信息：`feat(beta): 扮演狐狸FPV爪子与狐狸土拨鼠模型重做（k3.1-pro）`；hash 以 `git log -1` 为准。
- **未 push、未部署**。

## 实现

- `src/entities/paf-fpv-viewmodel.js`（新增）：参考普通土拨鼠 `ViewModel` 的下缘双爪、前向爪尖和胸腹 cue，重新制作狐狸长腕、狭掌、四趾、深色爪尖、锈棕/奶白毛色。相机坐标系稳定放置，关闭世界深度穿插；idle/walk/wind/lunge/recover 阻尼姿态与左右反相步态。胸腹仅在下缘露出，不占准星区域。
- `src/entities/paf-fox-model.js`：加宽藏狐颅骨与颊部、短三角耳、颈毛领、喉胸奶白区域、背灰/侧暖棕/腹白分层、三段蓬尾与白尾尖；四腿加入趾和爪尖。保留原 API、六相姿态混合、步频/速度关系及 `setHeadVisible`。
- `src/entities/paf-mole-model.js`：更圆的 torso/rump、短粗前后肢、四趾掘土爪、钝吻、圆耳、胡须和门齿；wander/alert/flee 姿态及逃跑步态。仍直接返回 `THREE.Group`，AI、捕获、重生契约未改。
- `src/play/play-as-fox.js`：仅接入 PAF FPV viewmodel、模式切换显隐、逐帧状态及 QA 探针。未改 FPV/TPS 相机公式、俯仰限制、扑击稳定化、触屏输入、PAF 平衡数值或 beta 入口守卫。
- `tools/test-paf-fpv-viewmodel.cjs`（新增）与 `tools/test-paf-models.cjs`：覆盖 API、双爪可见性、桌面/窄屏投影下缘约束、各动作有限性、模型轮廓/爪/毛色结构。另防止顶点色材质缺颜色属性形成黑块。
- `tools/qa-paf-fpv-managed.cjs`：输出改为 `outputs/paf-fpv-k31/`，新增移动/动作帧/窄屏双爪检查及模型近景。仅为 QA 动作截图延长第二次扑击的相位时长；前一次契约探针及生产默认值不变。

全部为程序化几何；无新素材、无新依赖。未修改普通模型文件、`index-public.html`、public shell、版本、server 或部署文件。

## 精确验证命令与结果

```text
for f in src/entities/paf-fpv-viewmodel.js src/entities/paf-fox-model.js \
  src/entities/paf-mole-model.js src/play/play-as-fox.js \
  tools/qa-paf-fpv-managed.cjs tools/test-paf-models.cjs \
  tools/test-paf-fpv-viewmodel.cjs; do node --check "$f" || exit 1; done
  → 7/7 exit 0

node --test tools/test-paf-camera.cjs tools/test-paf-models.cjs tools/test-paf-fpv-viewmodel.cjs
  → tests 22 / pass 22 / fail 0

node tools/test-procedural-fox.cjs  → all assertions passed
node tools/test-fox-pounce.cjs      → pass 8 / fail 0
node tools/test-fox-tuning.cjs      → pass 7 / fail 0
node tools/test-fox-vitals.cjs      → pass 9 / fail 0
node tools/test-fox-tactics.cjs     → pass 10 / fail 0
node tools/test-beta-contract.cjs   → all assertions passed
node tools/test-beta-fox-ai.cjs     → passed（32 drill，28 smart transitions / 20s）
node tools/test-smart-fox-beta.mjs  → pass 18 / fail 0
node tools/test-fox-repel.cjs       → pass 13 / fail 0
node tools/test-beta-tuning.mjs     → pass 6 / fail 0
node tools/test-normal-fox-sandbox.cjs → PASS
node tools/test-fox-retask.mjs      → pass 3 / fail 0

node tools/qa-paf-fpv-managed.cjs
  → 24 通过 / 0 失败；无控制台错误

git diff --check
  → exit 0
```

补充尝试的浏览器自起型旧测试受环境限制，非断言失败：

- `node tools/test-fox-types.cjs`：`Chrome debug page unavailable`。
- `node tools/test-fox-run.cjs`：`未找到 Chrome/Edge`（该脚本未使用本机 Linux Chrome 候选路径）。
- `node tools/test-fox-navigation.cjs`：`Chrome 调试页面启动失败`。

本次 PAF 视觉 QA 使用项目既有 managed Chrome/CDP 通道，不依赖上述自起浏览器路径。

## 视觉 QA

- Chrome：`147.0.7727.137`，managed CDP `http://127.0.0.1:18800`，独立标签页测后关闭。
- 后端：**WebGL2**；`ANGLE (Intel, Mesa Intel(R) Iris(R) Xe Graphics (ADL GT2), OpenGL 4.6)`。
- 桌面：1280×720；窄屏触控仿真：420×800，deviceScaleFactor 2。
- 汇总：`outputs/paf-fpv-k31/qa-result.json`，24/24 通过。
- 实际截图共 17 张，位于 `outputs/paf-fpv-k31/`：
  - `01-tps-default.png`、`02-tps-dash.png`：TPS 默认与冲刺。
  - `03-fpv-default.png`、`03b-fpv-walk.png`：FPV 待机双爪与移动步态。
  - `04-fpv-body-turned.png`、`05-fpv-look-down.png`：视线/身体解耦与低头身体 cue。
  - `06-fpv-after-pounce.png`、`06a-fpv-wind.png`、`06b-fpv-lunge.png`：扑击前、蓄力、扑击及落地稳定性。
  - `07-back-to-tps.png`：切回 TPS。
  - `08-marmot-closeup-tps.png`：场景中土拨鼠与警觉姿态。
  - `09-narrow-touch-tps.png`、`10-narrow-touch-fpv.png`：窄屏触控与双爪下缘布局。
  - `11-reenter-tps.png`：退出重进无 FPV 残留。
  - `12-models-front.png`、`13-models-side.png`、`14-models-alert-wind.png`：模型正面、侧面、藏狐蓄力/土拨鼠警觉近景。
- 人工查看确认：双爪/爪尖清晰，躯干色块已收窄下移；中央视野无遮挡；最终模型近景无毛簇黑块。

## 已知限制

1. 触屏为 CDP 仿真，未在实体触屏设备上测手感。
2. 窄屏顶部既有 HUD 文案仍较拥挤，底部既有提示也有重叠；本任务未改普通 HUD 或布局。
3. 模型保持项目现有低多边形程序化风格，无贴图毛流或外部资产。

**未 push、未部署**。
