# m3d-20261030-beta-smartfox-blackbox

Implemented on `feat/beta-smartfox-blackbox-20261030`, based on `fe32c13` (Beta rev56). No push or deploy was performed.

The Beta sandbox now keeps a bounded SmartFox black-box stream during ordinary play. The panel button `一键捕获智能狐异常` arms a capture with the previous 20 seconds and then records the following 5 seconds. The description is optional and defaults to an empty string. Completion exports a local JSON package and submits the same bounded payload through the existing feedback queue; both paths are fail-soft.

## Files changed

- `src/sandbox/smartfox-blackbox.mjs`: bounded recorder, schema, sanitization, seedable RNG, detectors, replay, A/B comparison, local export.
- `src/main.js`: Beta guarded recorder creation, input/fox/AI/state telemetry wiring, one-button capture, local export and feedback queue submission.
- `src/sandbox/panel.js`: one-button capture and status UI.
- `tools/test-smartfox-blackbox.mjs`: recorder window, schema bounds, fail-soft export, replay, A/B, and detector fixtures.
- `tools/smartfox-blackbox.cjs`: analysis CLI and SVG keyframe/contact-sheet output.
- `outputs/m3d-20261030-beta-smartfox-blackbox/*`: synthetic analysis evidence and rendered SVG artifacts.

## Package contract

Format: `marmot3d-beta-smartfox-blackbox`, version `1`.

- `caseId`, `capturedAt`, and `window` (`preSeconds: 20`, `postSeconds: 5`, relative capture/start/end).
- `build` and `effectiveConfig` snapshots, including the Beta build label and SmartFox tuning snapshot.
- `rngSeed` and `initialScene` (player, level, sandbox flag, and current SmartFox initial state at capture).
- `inputStream` with timestamped keyboard/touch state and player pose.
- `foxTrajectories` and `frames` with timestamped positions, yaw, state, intent, HP, and pounce flags.
- `aiDecisions` and `eventLog`, including AI telemetry, state transitions, pounce commits, and capture events.
- `analysis` containing a logic trace, event timeline, and anomaly findings.
- Payload is sanitized to remove credential-like/personal fields and bounded to 2 MiB, 1,800 frames, and 5,000 events.

The existing `SandboxRecorder` and feedback queue remain available unchanged; the new recorder is additive.

The main-control review found one real recording defect in the original `fe32c13` delivery: the blackbox `pounce-commit` event wrote `lockAngleError: 0`. That made the detector's configurable `maxLockError` criterion unreachable for real captures; only the distance criterion could fire. The fix computes the commit distance, target yaw, and wrapped absolute lock error once at pounce commit time, then records the measured radian value in the blackbox event. The result is wrapped to `[0, π]` and is shared with the existing sandbox event calculation.

The blackbox path is now independent of `sandboxRecorder`. SmartFox events, fox frames, and AI decisions are recorded whenever the blackbox exists, even if the other recorder is absent. Fox IDs come from the blackbox recorder's own object identity map; the existing sandbox recorder ID behavior is unchanged.

The new regression test uses two pounce commits at distances `3.4 m` and `4.1 m` (both above the `2.2 m` distance threshold) with lock errors `0.8` and `0.7 rad` (both above the `0.55 rad` threshold), and proves `detectWastedPounces()` reports the anomaly. The same test also guards the production recording source against the old hardcoded zero. Running it against an extracted `fe32c13` tree failed (`5 pass, 1 fail`); running it on this fix passed (`6 pass, 0 fail`).

Placeholder audit: the only detector or replay relevant placeholder field found was the blackbox pounce event's `lockAngleError: 0`, and it is fixed. No other hardcoded `0`, `null`, or empty values written into the blackbox package were detector or replay inputs: the random seed call uses `seed: null` intentionally to request a generated seed, the empty description is optional user metadata, `targetId: 'player'` is a real semantic label, and boolean/zero-valued telemetry fields are live state values.


## Replay and A/B evidence

`replaySmartFoxPackage()` injects the recorded seed, initial snapshot, effective config, and input stream into a caller supplied production-step callback. `mulberry32` provides the package-scoped deterministic RNG. Replaying the same fixture twice produced identical traces (`compareReplayTraces().identical === true`) in `tools/test-smartfox-blackbox.mjs`. `compareBlackBoxPackages()` reports build stamps, trace equality, anomaly sets, and event-count deltas for before/after A/B runs of the same case.

This replay promise applies only to the explicitly supported Beta sandbox SmartFox scenario and the same build/update path. It does not promise bit-exact results for arbitrary levels, arbitrary builds, or different browsers/platforms.

## Detectors and synthetic fixtures

All three detectors have configurable thresholds and are exercised with synthetic data. Synthetic output is marked `synthetic: true` and is never presented as user-observed evidence.

1. `no-progress-oscillation`: minimum span 2.5 s, per-step movement distance 0.08 m, and 4 alternating yaw changes (fixture overrides are tested).
2. `repeated-reorientation`: yaw change above 0.12 rad, at least 3 repeats, within a 6 s window.
3. `wasted-invalid-pounce`: pounce distance below 2.2 m, lock-angle error above 0.55 rad, at least 2 attempts.

## Rendered evidence

Generated with `node tools/smartfox-blackbox.cjs --synthetic --out outputs/m3d-20261030-beta-smartfox-blackbox`:

- [contact-sheet.svg](./m3d-20261030-beta-smartfox-blackbox/contact-sheet.svg)
- [keyframe-000.svg](./m3d-20261030-beta-smartfox-blackbox/keyframe-000.svg)
- [keyframe-001.svg](./m3d-20261030-beta-smartfox-blackbox/keyframe-001.svg)
- [keyframe-002.svg](./m3d-20261030-beta-smartfox-blackbox/keyframe-002.svg)
- [logic-trace.json](./m3d-20261030-beta-smartfox-blackbox/logic-trace.json)
- [event-timeline.json](./m3d-20261030-beta-smartfox-blackbox/event-timeline.json)
- [anomalies.json](./m3d-20261030-beta-smartfox-blackbox/anomalies.json)

These are synthetic SVG renders from recorded trajectory fixtures, not real user evidence. No WebM upload is required.

## Validation

- `node --check` passed for every changed JS/MJS/CJS file.
- `node tools/test-sandbox-recorder.mjs`: 2 pass, 0 fail.
- `node tools/test-feedback.cjs`: **30 assertions passed, 0 failures**; offline enqueue and queue flush regression behavior preserved (the script reports `feedback tests passed`).
- `node tools/test-smartfox-blackbox.mjs`: **6 pass, 0 fail, 0 skipped**.
- `node tools/run-node-tests.cjs`: **93 pass, 0 fail, 22 skipped** (all skips are browser/CDP tests; skips are not counted as passes).

## Limitations

Replay is intentionally limited to the Beta free sandbox SmartFox scenario and the same build/update path. It does not guarantee arbitrary-level replay, arbitrary-build compatibility, cross-browser bit identity, or physical-device behavior. The first version exports JSON/SVG evidence and does not require video. Detector findings are heuristics with configurable thresholds and require human review; synthetic fixtures are labeled and cannot be treated as observed player anomalies. This feature instruments and reproduces behavior; it does not claim to make foxes smarter or change AI balance.

Base SHA: `e1d6c0774cb7af387fd9e7c2c6559f8c5b388d8e`

Commit: `0becec9` (local only; push/deploy not executed).


## Rev58 用户实测缺陷返工（2026-10-31）

### 复现与根因证据

用户现场本次没有生成记录：下载目录无 `sf-*.json`/SmartFox 异常包，浏览器离线暂存无 smartfox black-box 条目，反馈服务器最后写入仍为 2026-10-26（7 条旧反馈，smartfox-anomaly_count=0）。该现场证据未用 synthetic fixture 冒充。

在修复前 rev58 的 `finalizeCapture()` 上构造明确 `synthetic:true` 的最大负载（1800 frames + 1800 input + 5000 events，原始字段各约 350 bytes，包明显超过 2 MiB），测得 finalize 约 **13,849 ms**，完成期间反复 `JSON.stringify`、`filter`、`analyzeBlackBox`，并出现约 38 MB heap 增长；这是逐条 shift 的 O(n²) 主线程阻塞机制。较轻负载（约 600-byte telemetry）也测得 640 ms。问题不是单纯缺少 HUD 提示：重复序列化循环可阻塞 renderer，导致 post5 后无法及时 ready/export。

### 修复

- `finalizeCapture()` 先分析一次，再按时间顺序以有界二分裁剪候选数据，仅在最终必要时做极少量 fallback 裁剪；保持 format/version/schema、pre20/post5、脱敏及 2 MiB/1800 frames/5000 events 限制，不通过清空数据或关闭分析达标。
- 完成阶段使用幂等 guard，连续点击不会重复 finalize/export。
- 正常 tick 完成后明确提示“记录完成，可下载智能狐异常包”；下载失败不丢 `lastPackage`，面板提供“重试下载异常包”；反馈失败/超时提示本机保留并沿用离线队列自动重试。
- 新增最坏负载、完成状态和重复 capture 回归测试。

### 性能与契约证据

同一 synthetic 最坏负载修复后 finalize **约 62 ms**（本次测试再次运行约 87 ms，均 <1000 ms），最终 JSON **约 2,096,738 bytes**，仍保留 431 frames、433 input、1801 events，非空且分析仍执行。原始上限未放宽。

命令与结果：

- 分别对 `src/main.js`、`src/sandbox/smartfox-blackbox.mjs`、`src/sandbox/panel.js`、`src/sandbox/state.js`、`tools/test-smartfox-blackbox.mjs` 执行 `node --check`：通过。
- `outputs/m3d-20261030-beta-smartfox-blackbox/finalize-benchmark.json`：synthetic 前后 benchmark 记录，明确非用户证据。
- Chrome 147 实际 Beta sandbox 页面：点击后 6.9 秒附近 `status.ready=true` 且界面显示“异常包已生成，可在本机下载”；主线程/页面持续响应。renderer 为 WebGL2 + ANGLE SwiftShader（软件渲染，非硬件 GPU）。未完成下载文件落盘/哈希核验及显式下载失败重试实测，相关行为仅由 fail-soft 单测与代码路径验证。
- 浏览器首次 run 使用 sandbox 页面时确认计时器因冻结在 0.1 秒步进，造成等待 5 秒逻辑时间超过 9 秒墙钟；现以捕获墙钟 post5 到期兜底，正常更新/tick 中 finalize（不改游戏 timer）。
- `node tools/test-smartfox-blackbox.mjs`：**9 pass / 0 fail / 0 skip**。
- `node tools/run-node-tests.cjs`：**94 pass / 0 fail / 22 browser/CDP skipped**；skip 不计通过，较 rev58 基线 93/93 增加 1 项。
- `git diff --check`：通过。

真实浏览器/实际 Beta sandbox 页面已验证完成状态与响应性（软件渲染）；实际下载文件落盘、大小/哈希及下载失败后的浏览器重试仍未验证。用户现场仍是失败证据，修复后的 synthetic/browser 测试不能替代用户实测。未执行 push/deploy。
