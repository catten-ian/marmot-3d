# m3d-20261030-beta-smartfox-blackbox

Implemented on `feat/beta-smartfox-blackbox-20261030`, based on `708472c1b855500096e0978ea239220f3f022593` (Beta rev56). No push or deploy was performed.

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
- `node tools/test-feedback.cjs`: pass; offline enqueue and queue flush regression behavior preserved.
- `node tools/test-smartfox-blackbox.mjs`: 5 pass, 0 fail.
- `node tools/run-node-tests.cjs`: **93 pass, 0 fail, 22 skipped** (all skips are browser/CDP tests; skips are not counted as passes). No physical-device testing was performed.

## Limitations

Replay is intentionally limited to the Beta free sandbox SmartFox scenario and the same build/update path. It does not guarantee arbitrary-level replay, arbitrary-build compatibility, cross-browser bit identity, or physical-device behavior. The first version exports JSON/SVG evidence and does not require video. Detector findings are heuristics with configurable thresholds and require human review; synthetic fixtures are labeled and cannot be treated as observed player anomalies. This feature instruments and reproduces behavior; it does not claim to make foxes smarter or change AI balance.

Commit: exact final hash is returned in the delivery message; this report is included in that local commit.
