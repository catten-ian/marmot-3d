# m3d-20261028-beta-bgm-flow — beta BGM 切换体验修复报告

- task ID：`m3d-20261028-beta-bgm-flow`
- 通道：beta；分支：`feat/beta-bgm-flow`
- 基线：`bf664ca82f347412030cb5092fd8460f11aa71c8`（origin/beta，rev46）
- push/deploy：未执行；仅本地 commit。

## 六项用户要求与证据

1. **渐入渐出**：`src/systems/audio.js` 的 `BgmManager` 使用顺序 hand-off。旧轨普通淡出 1.5s，combat/victory/defeat/paf 紧急淡出 0.65s；新轨从 `resolveBgmStartOffset()` 返回的 intro 偏移启动，增益从 0 平滑淡入 1.1s。`rampGainSmooth()` 优先使用 WebAudio `setValueCurveAtTime`，注入式 FakeAudioParam 使用线性回退。
2. **切换不要太频繁**：`BgmStateMachine` 默认非紧急槽位最小驻留 10s；tension 进入需威胁条件连续 1.5s，退出需条件消失连续 4s。测试覆盖 dwell 与迟滞。
3. **奔跑默认 graze，真正发现狐狸才 alert**：beta 主循环只把 `BGM_THREAT_STATES`（alert/stalk/chase/wind/dash/pounce）或 `pounceCommitted` 作为主动威胁，22m 内仅存在狐狸不会触发 tension。`graze→explore`、`alert→tension` 的别名集中在 `BGM_SLOT_ALIASES`/`resolveBgmSlot`；当前没有 graze.mp3/alert.mp3，使用现有曲目。
4. **受击后长时间 combat**：狐狸命中玩家时写入 `game.lastPlayerHitAt` 并刷新 `game.bgmCombatUntil = game.totalTime + BGM_COMBAT_LATCH_SECONDS`，常量为 55s；闩锁结束后状态机先保持 tension/alert 观察 4s，再允许回 explore/graze。
5. **同刻只有一首 BGM**：旧轨淡出期间新轨只保存在 `pending`，必须等旧 `AudioBufferSourceNode.ended` 后才启动；单音源序列化屏障与 generation 失效机制保留。现有单音源契约 7/7 通过，新增 FakeAudioContext 测试验证 `maxActive === 1`。
6. **衔接更自然**：淡出完成后才启动新轨、使用每曲 intro 偏移和归一化增益、平滑曲线淡入；过渡中多次 request 会清理旧 pending 并收敛到最新 generation。combat 变体选择逻辑保持 rev46 行为。

## 改动文件

- `src/systems/audio.js`：beta 槽位别名、主动威胁判定、BGM 状态机、combat 闩锁参数、平滑顺序 hand-off 与紧急淡出。
- `src/main.js`：beta 每帧传递狐狸主动状态、最近威胁状态、时间、combatUntil/lastPlayerHitAt；玩家受击刷新 combat 闩锁；狐狸扫描保持 O(狐狸数)。
- `tools/test-bgm-flow.test.cjs`：新增节流、迟滞、combat 观察、主动威胁判定、顺序淡出淡入和单音源测试。
- `tools/test-bgm-single-source.test.cjs`、`tools/test-audio-system.cjs`：将原先 40ms 硬切断言更新为新的顺序平滑交接契约，未删除测试场景或放宽单音源断言。

## 验证

- `node --check src/main.js src/systems/audio.js src/systems/bgm-tracks.mjs tools/test-bgm-flow.test.cjs tools/test-bgm-single-source.test.cjs tools/test-audio-system.cjs`：通过。
- `git diff --check`：通过。
- `node tools/test-bgm-flow.test.cjs`：3/3 通过。
- `node tools/test-bgm-single-source.test.cjs`：7/7 通过。
- `node tools/test-bgm-overhaul.test.cjs`：4/4 通过。
- `node tools/test-audio-system.cjs`：7/7 通过。
- `node tools/run-node-tests.cjs`：`OK 85/85`；22 个浏览器/CDP 测试按 runner 规则跳过。
- stable/dev 契约保持通过；`Audio({isBeta:false})` 不创建 beta BGM manager。

## 已知边界

- 资产目录没有 `graze.mp3`/`alert.mp3`，当前通过集中别名映射复用 `explore.mp3`/`tension.mp3`；以后替换曲目只需改映射/资产清单。
- 淡出期间新请求不会并行播放；旧轨 `ended` 后才启动最新 pending。若最新目标在加载中失效，generation 会丢弃过期 buffer，随后只保留最新目标。
- 本次没有改 `index-public.html`、`tools/public-shell.cjs`、版本戳、GLB 或 mp3 资产；未执行部署或 push。

## 交付

- 本地 commit：当前分支 HEAD，commit message 为 `fix(beta): smooth and throttle BGM state flow`；最终 hash 由交付时 `git rev-parse HEAD` 核验。
- 工作树仍保留任务启动时已有的 `.codex-lock/` 未跟踪锁目录，未纳入 commit。
