# Marmot3D Beta PAF wind 噪声范围修复报告

- 日期：2026-11-05
- 工作树：`/home/fame/code/marmot3d/_int_beta_rev63_paf_online_20261103`
- 基线 HEAD：`2928ea09f5e458c3988d1b4d08a4f45968608bd9`
- 实现 commit：`dd76f827bb2c068ae4c4c0669fba09fa7da4a4c5`
- 边界：只在本工作树修改并本地提交；未 push、未部署，未修改 Caddy、systemd、线上文件或其他 worktree。

## 根因

`src/core/paf-noise.js` 原先把 `phase === 'wind'` 视为 `threatening`。只要蓄力期间实际移动，`threatening && !quietPreparation` 就直接选择 `CUE_MODE.LUNGE`，所以潜行移动和疾行移动的 `hearingRadius/noiseCoef` 都错误地变成扑击档。静止蓄力虽然走了准备档，但无法覆盖移动蓄力。

运行时 `play-as-fox.js` 的 `groundSpeed` 是本帧实际位移速度，`sprint` 是疾行输入/状态；因此“是否安静准备”必须由真实 `groundSpeed` 判定，不能由 wind 或单独按住 sprint 键覆盖。

## 改动

- `src/core/paf-noise.js`
  - 明确用 `abs(groundSpeed) >= 0.02` 判定真实地面移动；wind 静止使用准备档，wind 潜行移动使用 stalk，wind 疾行移动使用 sprint。
  - `phase === 'lunge'` 才使用 lunge 噪声与扑击听觉半径；wind 永不返回 lunge 噪声模式。
  - 保留 wind 移动时既有的视觉威胁档（独立 `visionMode`），避免改变其他 perception 行为。
  - 保留/恢复 `lungeRange` 对 lunge hearing radius 的线性缩放；默认范围仍返回 `detectLunge`。
- `src/core/predator-prey.js`
  - 支持独立的 `visionMode`、`hearingRadius`、`noiseCoef` 覆盖，使视觉威胁与听觉噪声档位分离。
- `tools/test-paf-touch-contract.cjs`
  - 回归覆盖 idle quiet、wind quiet、wind stalk/moving、wind sprint、lunge；断言 mode、hearingRadius、noiseCoef，并明确断言 wind 不等于 lunge。
  - 保留 lungeRange min/default/max 单调性及 perception cue 半径契约断言。

`src/play/play-as-fox.js` 未改动；既定 `lungeTime: 0.32` 与 `lungeRange` 输入/预览路径保持不变。

## 测试结果

- 语法检查通过：
  - `node --check src/core/paf-noise.js src/core/predator-prey.js src/play/play-as-fox.js tools/test-paf-touch-contract.cjs`
- PAF 聚焦纯逻辑：
  - `node --test tools/test-paf-touch-contract.cjs tools/test-paf-evasion.cjs tools/test-paf-prey-mind.cjs tools/test-paf-pounce.cjs tools/test-paf-input-route.cjs tools/test-paf-camera.cjs tools/test-paf-rock-collision.cjs tools/test-paf-models.cjs tools/test-paf-fpv-viewmodel.cjs tools/test-paf-admin-sync.test.cjs`
  - **83/83 通过，0 失败**。
- 全量 Node runner：
  - `node tools/run-node-tests.cjs`
  - **106/106 通过，0 失败**；22 个既有 browser/CDP 测试按 runner 规则跳过。
- 真实 PAF 在线入口 QA：
  - `CHROME_PATH=/usr/bin/google-chrome node tools/qa-paf-online-leaderboard.cjs`
  - 噪声阶段检查通过：wind quiet=`stalk/0.9/0.12`、wind stalk=`stalk/3/0.45`、wind sprint=`sprint/9/1`、lunge=`lunge/17/1.5`；无 console error/page exception。
  - QA 随后在既有 `first-auto-submit` 排行榜等待处失败（`tools/qa-paf-online-leaderboard.cjs:199`），不是噪声断言失败；测试生成的既有 `qa-results.json` 已恢复，未纳入本任务改动。

## 限制

- 本轮没有宣称完整浏览器排行榜流程通过；失败点属于现有在线提交 harness 的后续阶段。
- 22 个浏览器/CDP 用例仍按项目 runner 规则跳过，需外层浏览器流水线单独验收。
- 工作树原有未跟踪 `.codex-noise-fix.lock/` 已保留且未 stage。
