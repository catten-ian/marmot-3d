# Beta PAF 音频与设置修复报告

- 任务：`m3d-20261030-beta-paf-audio`
- 通道：Beta only；未修改 Dev/Stable 通道源码。
- 基线：`add51438f16976c952a39840c2f609849bf1827b`
- 用户发布决定（2026-10-30 17:44）：允许 push/deploy，剩余 PAF 测试不再继续，Beta 不再要求 CDP 验收。

## 实际改动

1. `src/systems/audio.js`
   - TOS/local 网络、非 2xx、超时和解码失败后进入程序回退音乐；失败结果不永久污染缓存。
   - 回退期间允许显式/冷却后的重试，网络恢复后可切回真实 MP3。
   - 以公开 180 秒 PAF 文件的解码样本 RMS `0.13723203` 标定程序三角波增益；这是可测的样本电平匹配，不宣称 RMS 与 LUFS 等价。
   - PAF 设置暂停/恢复接入音频状态，退出 PAF 恢复标题音乐。
2. `src/play/play-as-fox.js`
   - PAF 中恢复共享设置按钮及面板层级。
   - 设置面板暂停只冻结 PAF 更新并清理输入、蓄力和 pointer lock；恢复不触碰普通模式暂停状态。
3. `src/main.js` + `src/core/settings-pause.mjs`
   - 共享设置面板按当前模式路由到 PAF 或普通游戏暂停钩子。
4. 新增 Node 契约测试和 CDP 证据脚本；浏览器证据位于 `outputs/m3d-20261030-beta-paf-audio/`。

## OpenClaw 独立验证

- `node tools/run-node-tests.cjs`：**91/91 通过**；22 个 browser/CDP 脚本由 runner 跳过，不计为通过。
- 既有 focused tests：PAF 音频/设置 5/5，TOS preload 7/7；后续全量回归亦全部通过。
- 真实 Chromium 已有证据（不是本轮发布前置条件）：
  - PAF MP3 解码并播放，`AudioContext=running`，时长 `180.0359s`。
  - 同时阻断 TOS 与 local 后进入 `procedural-fallback`，目标 gain `0.099830996`。
  - 解除阻断并重试后恢复 `elevenlabs-buffer`。
  - 390×844 手机仿真中设置面板打开且 PAF `paused=true`。
  - Runtime exception：空。

## 明确未完成/已豁免项

- 桌面设置 CDP 脚本的 open/close 记录仍为 `hidden=true, paused=false`，没有据此宣称桌面交互通过。
- 未继续补桌面设置交互、完整输入 bleed 或更多浏览器矩阵；用户已明确豁免剩余 PAF 测试和 Beta CDP 发布门槛。
- 未做实体手机、听感主观评价或 LUFS 等值验证。
- 多狐自然扑击专项属于既有 rev54 限制，不在本任务中声称解决。

## 发布边界

- 本报告对应 feature 本地提交；集成、rev55 版本戳、push 和部署由 OpenClaw 主控在唯一 Beta integration worktree 串行执行。
- worker 未 push、未部署、未改 public shell、线上文件或系统服务。
