# Beta 音量与数字输入实现报告

- Task ID：`m3d-20261101-beta-audio-volume-controls`
- 日期：2026-11-01
- JOB：`/home/fame/code/marmot3d/m3d-beta-audio-controls-20261101`
- Branch：`fix/beta-audio-controls-20261101`
- Base：`99f2d236d496971f6a702d9d41929d1cce65bd80`
- 实现、测试与测量证据 commit：`2275691f6824838da2ca772e175fb67a455164e1`
- 本报告随后单独本地提交，以便记录上述准确 SHA；报告提交可用 `git log -1 --format=%H -- outputs/m3d-20261101-beta-audio-volume-controls-report.md` 查询。
- push / PR / deploy：**未执行**。未操作 Caddy、systemd 或线上文件。
- Chrome / CDP / 浏览器：**未启动**。真实听感、硬件扬声器、手机浏览器及视觉验收均未完成，交主控串行验收。

## 结果与参数映射

已同时修改实际音频输出和三个控件。100% 的 Beta master 从 0.32 提高至 0.48；提高的是参考增益，默认显示百分比和音效/音乐相对比例保留。三个通道范围统一扩至 0–150%，步长 1%。Stable/Dev 仍使用原来的 0.32 master、SFX=1、BGM=0、程序化音效路径及原设置入口。

| 参数 | Before | After（Beta） |
| --- | --- | --- |
| 默认 master / SFX / BGM 显示值 | 100 / 100 / 61 | 100 / 100 / 61 |
| 三个控件、存储和导入范围 | 0–100 | 0–150，整数步长 1 |
| master 映射 | `0.32 × M/100` | `0.48 × M/100` |
| SFX 总线映射 | `S/100`，禁用为 0 | 同公式，上限 1.5 |
| BGM 总线映射 | `B/100`，禁用为 0 | 同公式，上限 1.5 |
| 默认总线 master / SFX / BGM | 0.32 / 1 / 0.61 | 0.48 / 1 / 0.61 |
| 最大总线 master / SFX / BGM | 0.32 / 1 / 1 | 0.72 / 1.5 / 1.5 |
| SFX 最大有效线性乘数（保护前） | 0.32 | 1.08 |
| BGM 轨道 trim | `0.42 × 各曲目归一增益` | 保留；PAF 为 0.42 |
| BGM fallback trim | `0.42 × 0.13723203 / (1/√3)` | 保留，继续与 PAF 参考 RMS 匹配 |

选择依据：参考增益仅提高 1.5 倍，即约 **+3.5218 dB**；默认 SFX/BGM 比例不变，默认单声源仍留有余量。上限额外提供两个串联的 1.5 倍调节，SFX 最大有效乘数较旧最大值提高 3.375 倍，约 +10.5655 dB；此值是保护前的请求增益，重叠或高峰时不会承诺相同幅度的实际输出增加。没有把默认 master 直接设为 1，也没有用压缩器 makeup 伪造默认增益。

## 输出证据与削波策略

保护链仅由 Beta 创建：

```text
SFX ─┐
     ├→ master → compressorInput → DynamicsCompressor → guardInput → WaveShaper → destination
BGM ─┘
```

- 有效压缩阈值 −3 dBFS，ratio=20:1，attack=3 ms，release=120 ms。
- 压缩器参数为 threshold=0 dB、knee=0；前级为 `10^(3/20)`，后级配对衰减，令有效阈值移至 −3 dBFS，并避免内置自动 makeup 为正常低电平额外增益。相关处理依据 Web Audio 1.0 的 DynamicsCompressor processing / Computing the makeup gain；实际浏览器实现仍需主控验证。
- 后级同时除以 32，WaveShaper 曲线以输入域 ±32 还原单位增益；65537 点曲线在 |x|≤0.9 为恒等映射，之后平滑趋近 ±0.98。超过曲线输入域也只取端点。`oversample='none'`，防止本节点重采样另增过冲。
- 正常低电平保留线性动态，保护链无主动提升；压缩器处理持续重叠，安全曲线兜底处理 attack 过冲。它不是常态失真增响器。
- 控件正增益变更使用 15 ms 时间常数平滑；0、静音和隐藏页面立即设置总线目标为 0，并取消先前自动化。页面隐藏仍 suspend；新增隐藏状态保护，设置编辑或 `ensure()` 不会把隐藏页面重新 resume。
- 保留原 SFX 家族并发/间隔限制、BGM 单源串行切换、跨场景/PAF 状态与文件失败回退路径。

真实资源通过只读下载到 `/tmp`、ffmpeg 解码为 float32 PCM，再按实际总线映射离线计算；没有播放、没有浏览器渲染。测量脚本为 `tools/audio/measure-beta-volume.mjs`，完整结果在 `outputs/m3d-20261101-beta-audio-volume-controls/offline-pcm-measurement.json`。

| 资源 / 指标 | 旧默认 | Beta 默认 | 最大配置（保护前） |
| --- | ---: | ---: | ---: |
| PAF RMS | 0.0112508312 | 0.0168762467 | 0.0622484511 |
| PAF 峰值 | 0.0720407789 | 0.1080611684 | 0.3985862769 |
| hit RMS | 0.0210197277 | 0.0315295915 | 0.0709415808 |
| hit 峰值 | 0.3148107529 | 0.4722161293 | **1.0624862909** |

- PAF 源 RMS 为 0.137232034996，与代码已有参考 0.13723203 相差约 5e−9。PAF 与 hit 的默认 RMS 均实测计算提升 1.5 倍，+3.5218 dB，证明对实际文件样本有效；是否达到用户期望的主观响度留待听感验收。
- PAF SHA-256：`b70f5931cfe8ec1eb33fa420bd5a7a5d7b04f2fea397031a0aa22cf58b0137f7`。
- hit SHA-256：`95df28e52a84c2e877afea91e603e634694218efdc9612f894103acab2e5994a`。
- 最大配置 hit 若没有保护会超过满量程；即使完全忽略压缩器降低量、仅离线应用安全曲线，峰值也降为 **0.9695044853**，RMS 为 0.0706869305。
- 用 18 个家族并发名额各代表一条同相满幅文件音效，再叠加最高 BGM trim（tension=1.88）构造压力输入：旧默认为 5.91412992、新默认/旧 100% 配置为 8.87119488、新最大配置为 **20.292768**。这些是人工最坏相位信号，并非实测游戏内容；程序化一次事件可以有多个振荡器，因此 18 也不是全局振荡器硬上限。
- 新默认和新最大配置的压缩器静态曲线估算输出峰值分别为 0.80333947 和 0.83727296，**不代表已渲染 WebAudio compressor DSP**。Node 另对实际生成的 Float32 曲线及其插值测试，包含 ±20.292768、±1000 等输入；即使绕过压缩器降低量，峰值仍≤0.9800001（含 Float32 容差）。

风险边界：最大配置下持续大量同相声源会触发整体增益降低，可能压缩动态；安全曲线在过冲时也会产生非线性谐波，不能宣称完全无失真。0.98 是本节点样本峰值保护，不能代替设备重采样后的 true-peak 或硬件扬声器测试。需主控在真实浏览器检查 reduction、实测输出峰值、密集战斗动态和听感；本轮未以常态削波或重失真制造响度。

复测离线数据：从 `TOS_AUDIO_BASE` 下的 `elevenlabs/bgm/paf.mp3` 与 `elevenlabs/sfx/hit.mp3` 下载至本地后运行：

```bash
node tools/audio/measure-beta-volume.mjs /tmp/m3d-audio-volume-paf.mp3 /tmp/m3d-audio-volume-hit.mp3
```

## 交互与兼容性

- 总音量、音效音量、音乐音量各有原 slider 和新的 `type=number`，均 min=0、max=150、step=1。数字框 `inputmode=numeric`，保留原生键盘步进；44px 最小高度、16px 字号和可见焦点样式已写入 CSS，尚未进行视觉验收。
- 有效范围内整数在 `input` 时即时写入 Audio、localStorage、slider、output 和 `aria-valuetext`；slider 反向更新数字框。
- 空值、符号/小数输入中状态只保留草稿，不将其转成 0；小数、负数、越界有限数字在 blur / change / Enter 提交时四舍五入至整数并钳制。空值、NaN、Infinity、指数语法、十六进制、无法表示为有限数的超长文本恢复最后有效值。Enter 阻止默认行为与继续冒泡。
- 数字草稿无效时标记 `aria-invalid`，output 始终反映仍生效的值；提交后恢复有效状态。原生 number 控件对非法文本的浏览器清空行为仍待浏览器验收。
- 继续使用 `marmot3d.audio.beta.v1` 和配置 `schemaVersion=1`；未丢弃旧存储、未进行强制覆盖或重置。旧百分比保持原数值，旧 100% master 现在对应 0.48，明确享受 +3.52 dB 的参考提升。若需近似旧平衡，可用 master=67%。
- 合法 0 从存储、导入到运行时均保留。非法运行时音量 patch 保留当前值，不覆盖成默认值。读取缺失、损坏 JSON、null、数组时安全回退；禁用存储不会抛错。
- `normalizeAudioVolume` 是共同范围与 step 规则；存储、Audio.setSettings、数字控件和导入导出均使用。`sanitizeAudio` 已去掉独立 100 上限，新 125/150 可往返，非法类型/非有限数被忽略并警告，有限越界值被钳制并警告。
- 旧存储中的普通十进制数值字符串仍兼容；导入文件仍严格要求 number 类型，保留原有严格性。旧小数百分比归一为整数以匹配 step。
- 0 音量、总开关、SFX/BGM 开关、隐藏页面、手势解锁、加载失败的程序化回退和 PAF/普通场景 BGM 切换均有纯逻辑/替身测试覆盖，真实自动播放策略和时序仍交浏览器验收。

## 测试与审查

最终状态：

| 检查 | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| 改动 JS/MJS/CJS 的 `node --check` | 10 文件 | 0 | 0 |
| 音频/控件/配置/BGM 聚焦 `node --test` | 44 测试 | 0 | 0 |
| `node tools/run-node-tests.cjs` | 98 文件 | 0 | **22 浏览器/CDP 文件** |
| `git diff --check` 与 staged diff 检查 | 通过 | 0 | 0 |
| 离线真实资源 PCM 测量脚本 | 运行成功 | 0 | 0 |

聚焦命令：

```bash
node --test tools/test-beta-audio-volume-controls.test.cjs tools/test-audio-system.cjs tools/test-audio-tos-preload.test.cjs tools/test-paf-audio-settings.test.cjs tools/test-config-transfer.cjs tools/test-bgm-overhaul.test.cjs tools/test-bgm-flow.test.cjs tools/test-bgm-single-source.test.cjs
node tools/run-node-tests.cjs
```

新增 7 个测试覆盖增益映射与非 Beta 保持原行为、完整保护拓扑与曲线插值边界、旧存储及无效输入、静音/隐藏前后及首次隐藏解锁、v1 配置往返、数字草稿纯逻辑、三个控件真实绑定函数的事件同步/持久化/ARIA。现有测试仅更新新范围/增益预期并补齐保护节点替身；未删测试，未把 skip 算通过。

首轮聚焦运行曾为 43 pass / 1 fail / 0 skip，原因是旧 BGM 单源测试的 AudioContext 替身缺少新节点；补齐替身后最终复测为上表结果。完整日志保留最终结果，早期失败原因在此记录。

22 个 skipped 文件：`test-action-layout.cjs`、`test-attack.cjs`、`test-attacks.cjs`、`test-body-view.cjs`、`test-dev-gs.cjs`、`test-dev-turn.cjs`、`test-ecology.cjs`、`test-fixes.cjs`、`test-fox-navigation.cjs`、`test-fox-run.cjs`、`test-fox-types.cjs`、`test-fullscreen.cjs`、`test-glb.cjs`、`test-gs.cjs`、`test-jump-physics.cjs`、`test-models.cjs`、`test-particles.cjs`、`test-posture.cjs`、`test-repel.cjs`、`test-v11.cjs`、`test-v12.cjs`、`test-viewmodel.cjs`。

已审查完整实现、测试及 staged diff；没有修改 main.js、SmartFox、模型/动画、黑匣子/录制、Stable/Dev 入口、index-public.html、public shell 或版本戳，也未写入其他工作树。既有 `.codex-cli-write.lock.d/` 保留且未 stage。

## 改动文件

- `src/systems/audio.js`：Beta 参考增益、范围归一、保护链、增益平滑与隐藏状态保护。
- `src/ui/settings.js`：三个数字框、纯草稿解析、双向绑定与 ARIA。
- `src/core/config-transfer.mjs`：配置导入改用共同范围及整数 step，消除旧 100 clamp。
- `styles.css`：数字框布局、触控尺寸和焦点/草稿样式。
- `tools/test-beta-audio-volume-controls.test.cjs`：新增 7 项逻辑、总线和控件适配器测试。
- `tools/test-audio-system.cjs`、`tools/test-audio-tos-preload.test.cjs`、`tools/test-bgm-single-source.test.cjs`、`tools/test-config-transfer.cjs`、`tools/test-paf-audio-settings.test.cjs`：预期值与节点替身更新。
- `tools/audio/measure-beta-volume.mjs`：可重复离线 PCM 测量，无播放。
- `outputs/m3d-20261101-beta-audio-volume-controls/`：`focused-tests.txt`、`node-tests.txt`、`syntax-checks.txt`、`offline-pcm-measurement.json`。
- 本报告。

## 待主控串行浏览器验收

1. Beta 三个数字框、键盘上下键/Enter/失焦、空值与非法文本/指数/负数/超大值，确认浏览器原生 number 行为、slider 双向同步、output/ARIA、即时生效及重载后保留。
2. 移动视口布局、实际手机数字键盘、44px 操作区域、焦点与字体；本轮未做视觉或手机浏览器验收。
3. 用真实 AudioContext / OfflineAudioContext 渲染测量默认、旧 100% 存储、最大配置的实际增益、compressor reduction 与峰值；密集 SFX+BGM、延迟瞬态和保护器动态/听感。
4. 0 音量、总静音、各类禁用、隐藏期间编辑/恢复、首次手势和浏览器自动播放限制。
5. 真实资源失败后的回退、PAF 进入/暂停/退出、普通场景切换及 BGM 不重叠；新上限导入导出和旧配置回读。
6. 对 Stable/Dev 入口做浏览器冒烟，确认默认输出与原设置维持原行为。
