# Beta 音量与数字输入实现报告

> 当前状态：**local-node-verified-browser-pending**。同一任务、同一 JOB 续接，保留原实现 `2275691f6824838da2ca772e175fb67a455164e1` 与报告提交 `24ce51694f1fffba44f3e1110345c5515665617f`。追加的完整音频预载/解码/ready API 已提交为 `1077bebc39f980f4765724bc30b86d2c3b69c41a`；独立审查后三项边界返修已提交为 `d95032e06adc90158fdd2b16d50b8345059d30f6`；最新测试为 65 项聚焦测试通过、99 个 Node 文件通过、22 个浏览器/CDP 文件跳过。普通游戏/沙盒/PAF 的入口等待接线由后续 preload 任务完成；本轮未改 main.js，未完成真实浏览器或完整用户验收。

以下音量部分及其 44/98 测试计数为第一阶段记录；文末“追加修复”给出本轮 API、资源覆盖和最终验证。

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


## 追加修复：完整音频预载与真实资源 ready（同一任务续接）

- 续接基线/HEAD：`24ce51694f1fffba44f3e1110345c5515665617f`，原始任务 base 仍为 `99f2d236d496971f6a702d9d41929d1cce65bd80`。
- 本轮实现、测试与证据 commit：`1077bebc39f980f4765724bc30b86d2c3b69c41a`。
- 本轮报告回填随后单独本地提交；用本文开头给出的 `git log` 命令查询报告提交 SHA。
- 验证等级：**local-node-verified-browser-pending**。
- push / PR / deploy：**未执行**；Chrome / CDP / 浏览器：**未启动**。

### 根因与资源清单

旧 `preload()` 只读取两个 manifest 和 7 首 BGM 的压缩字节，随机选择一个 combat 变体，不含 PAF BGM 和 SFX；没有保证解码完成的入口契约。首个 AudioContext 创建前无法解码。另一个问题是 SFX 播放把 manifest 缺项当作“不应加载该资源”，会挡住已知真实路径。

现在导出的 `BETA_AUDIO_RESOURCES` 是不可变的、按真实路径去重的清单，源于运行时 `SFX_ASSETS` 和 `BGM_ASSETS`。`BGM_ASSETS` 从全部 `BGM_SLOTS` 加 `BGM_TRACK_META` 的 variants 构建，BGM 运行时也直接从该映射取路径。

| 覆盖范围 | 事件/槽位 | 真实文件数 |
| --- | --- | ---: |
| 全部 SFX | swing、hit、repel、kill、berry、burst、ultimate、hurt、foxWind、jump、foxDash、rescue、helpCry、levelUp、win、lose、lowHealth | 16（repel/kill 共用一个文件） |
| 全部 BGM 槽位 | menu、explore、tension、combat、night、victory、defeat、**paf** | 8 |
| 额外 combat variants | **combat-b、combat-c**（combat 已计入槽位） | 2 |
| 合计 | 17 个 SFX 事件 + 全部曲目/变体 | **26** |

完整清单在 `outputs/m3d-20261101-beta-audio-volume-controls/readiness/inventory.json`。成功场景为 26 次资源 fetch + 2 次 manifest fetch、26 次真正 `decodeAudioData` 调用；别名不会重复取数或解码。

### API 契约

| API | 行为与返回 |
| --- | --- |
| `audio.preload({ onProgress?, retry?: false })` | 开始/复用同一轮工作。AudioContext 前取回全部真实字节，完成后返回 `ready:false`、`status:'awaiting-context'` 的快照；已有 context 时也执行全部解码。资源失败时返回显式 `failed` 快照，兼容当前 fire-and-forget 调用，不伪造成功。 |
| `audio.whenReady({ onProgress?, retry?: false })` | 入口等待 API。**仅当 26 项真实字节均保留且 26 项真实 buffer 均解码成功时 resolve**；没有 context 时保持 pending。资源失败 reject `AudioReadinessError`，其 `.state` 是失败快照。 |
| `audio.getReadiness()` | 返回新快照，包含 `supported/status/ready/total/fetched/decoded/attempt/contextState/unlocked/manifests/resources/failures`。资源条目含 path/kind/keys/fetched/decoded；失败含 path/kind/stage/message/attempts，attempts 含 URL、fetch/decode 阶段和 HTTP/超时/解码原因。 |
| `audio.preload({ retry: true })` / `audio.whenReady({ retry: true })` | 显式重试已失败项，保留所有成功字节、解码结果及成功 manifest 缓存。并发重试复用进行中的工作。入口使用后者时仍须处理 reject。 |

状态为 `idle → fetching → awaiting-context → fetching/decoding → ready`；已有 context 可从 fetching 直接 decoding；失败轮次结束为 `failed`。第二轮 fetching 可以全部命中字节缓存，不代表再次发起网络请求。

`ready` 表示资源已解码，`unlocked` 和 `contextState` 描述当前音频权限/运行状态。浏览器拒绝 `resume()` 或页面隐藏时仍可能完成解码，此时 `ready:true` 且 `unlocked:false`；不会绕过 autoplay、强行 resume，或声称已可听。后续入口任务需要根据页面可见性与用户手势处理播放许可。

`preload()`、`whenReady()` 和 `getReadiness()` 均不创建或 resume AudioContext。仍由已有的 `bindUserGesture()`/调用方手势内的 `ensure()` 建立并尝试 resume；`ensure()` 在预载已经启动时自动续做解码。即使总音量为 0、音效/音乐禁用、或总开关关闭，也会照常 fetch/decode 全部资源。Stable/Dev 的 `preload()` 保留原无操作返回值 `[]`，其 readiness 为 disabled，`whenReady()` 会显式拒绝；默认输出与播放路径保留。

`onProgress` 对当前工作轮次汇报完成作业数，total=54（两个 manifest、26 次取数作业、26 次解码作业）。手势前成功取数完成为 28/54，返回状态仍未 ready；具体成功数取 `state.fetched/decoded`。回调在该轮 `preload()` settle 后解除，后续调用可重新提供回调或读取 `getReadiness()`。进度完成计数不作为入口通过条件，失败也必须查看 state。进度回调抛错或修改收到的快照不能污染内部状态或伪造 ready。

供后续入口接线任务使用的边界：在启动阶段调用 `preload()`，保留现有手势解锁，在普通游戏/沙盒/PAF 真正开始前等待 `whenReady()` 并处理 `AudioReadinessError.state`；失败后由明确的重试操作使用 `{retry:true}`。本轮没有接入任何模式的入口等待门，因此不能把纯音频层验证当作用户复现问题的完整端到端验收。

### 缓存、失败与首次播放

- URL 级字节缓存、路径级字节缓存、正在 fetch 的 Promise、SFX/BGM 解码 Promise 和成功解码结果共同复用。重复/并发调用不重复 fetch/decode；首次播放直接使用同一解码缓存。
- 非空 ArrayBuffer 才可进入真实字节缓存；HTTP 200 的空内容不是资源成功。解码成功还要得到有限正 duration 的真实 buffer，空 Promise、null、无效 buffer 和程序化 BGM 对象均不能满足 ready。
- 传给 `decodeAudioData` 的是 `bytes.slice(0)`。浏览器会转移/分离输入 ArrayBuffer，原始已取回字节必须保留，不能因 decode 消失而错误宣称已缓存。Node 替身通过实际 structuredClone transfer 模拟该语义。
- TOS 首选、现有本地路径回退保留；手势前已成功获取的本地回退字节在解码时优先复用，不再先重试失败 TOS。解码坏字节会移除对应失败字节缓存，尝试另一来源；失败不会永久缓存。
- 所有真实资源均成功时，manifest 可作为建议性元数据；manifest 不可用仍在 `manifests` 状态显式标记 failed，但不会阻止已知路径完成真实 fetch/decode。只读 manifest 成功本身不能使 ready。SFX/BGM 有缓存时都跳过 manifest 等待；没有缓存时也按已知路径尝试真实资源。
- 首次 PAF 测试先完成全部资源 ready，再切到 PAF，断言 PAF source.buffer 是缓存中的真实 PAF buffer、`procedural=false`；随后 hit/kill 也用真实缓存，未调用程序化 fallback，网络和 decode 计数均不增加。测试同时保留音效家族间隔限制，先结束 hit 再发出同组 kill。
- 当前音量映射、保护链、增益平滑、静音、隐藏页面保护、PAF/BGM 单源切换及正常资源失败后的程序化兜底保持原语义。程序化回退仍可用于失败播放，但不会被计入 ready。

### 本轮测试、审查与改动文件

| 检查 | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| 本轮修改/新增脚本 `node --check` | **5 文件** | **0** | **0** |
| 音频 ready + 增益/设置存储/数字输入/config-transfer/BGM/loading 聚焦测试 | **61 测试** | **0** | **0** |
| `node tools/run-node-tests.cjs` | **99 文件** | **0** | **22 浏览器/CDP 文件** |
| `git diff --check`、实际 diff 及 staged diff 审查 | 通过 | 0 | 0 |

聚焦命令：

```bash
node --test tools/test-audio-readiness.test.cjs tools/test-audio-system.cjs tools/test-audio-tos-preload.test.cjs tools/test-paf-audio-settings.test.cjs tools/test-beta-audio-volume-controls.test.cjs tools/test-config-transfer.cjs tools/test-bgm-overhaul.test.cjs tools/test-bgm-flow.test.cjs tools/test-bgm-single-source.test.cjs tools/test-loading-progress.test.cjs
node tools/run-node-tests.cjs
```

新增 ready 文件含 **12 个测试**：完整不可变清单、手势前 fetch/手势后 decode 及转移输入保留、并发/重复、首次 PAF 真实缓存、fetch 失败/重试、decode 失败/重试、200 空字节、提前取回的本地回退复用及 advisory manifest 失败、静音/隐藏页面仍准备资源、拒绝 autoplay 与非 Beta 无操作、进度回调隔离、空/无效 decode 结果拒绝。

未删除测试，未放宽旧语义：原“只解码 menu”加强为“全部 26 项解码且 menu 不重复请求”；原“PAF 排除”按新需求改为 PAF 和三个 combat 变体全部必须包含；loading 的完成序列仍精确逐项断言，资源清单扩充后为 1…28，且额外断言尚未 decode 时 ready=false。loading 测试改用实际模块 import，避免原 VM 删除 imports 后丢失 META 与产生跨 realm ArrayBuffer 问题；其他 HUD/loader 断言保留。

调试期间新增测试首次为 9 pass / 1 fail / 0 skip，失败来自测试连续发出同组 hit/kill，触发既有间隔限制；改为模拟 hit 结束后再发 kill，未改限流实现。第一次全量为 98 文件 pass / 1 fail / 22 skip，失败为 loading 的旧 VM 替身缺少 META；改成实际模块加载并更新完整作业序列后，最终结果为上表。最终日志在 `outputs/m3d-20261101-beta-audio-volume-controls/readiness/`，本轮没有将 skipped 计入通过。

本轮文件：

- `src/systems/audio.js`：完整资源清单、ready API/状态、fetch/decode 幂等与失败重试、解码字节副本、运行时缓存直达与 advisory manifest。
- `tools/test-audio-readiness.test.cjs`：新增 12 个测试。
- `tools/test-audio-tos-preload.test.cjs`、`tools/test-bgm-overhaul.test.cjs`、`tools/test-loading-progress.test.cjs`：完整覆盖及进度契约测试更新。
- `outputs/m3d-20261101-beta-audio-volume-controls/readiness/`：`focused-tests.txt`、`node-tests.txt`、`syntax-checks.txt`、`inventory.json`。
- 本报告追加与当前状态说明。

除上述范围外没有修改源码；尤其未改 main.js、音量 UI/CSS、SmartFox、录制/黑匣子、public shell、index-public.html 或版本戳。原 `.codex-cli-write.lock.d/` 保留未跟踪、未 stage；未操作其他工作树。

### 追加修复的待验收项

1. 后续 preload 任务在普通游戏、沙盒和 PAF 入口串行接上 `whenReady()`，处理失败、重试、用户手势及 `unlocked` 状态；本轮仅提供音频系统契约和 Node 证据。
2. 主控串行用真实浏览器确认实际资源 HTTP/CORS/解码、第一次 PAF 的 SFX/BGM 实际走真实缓存、快速连续点击和跨模式切换。
3. 在真实手机验证首次解锁、后台恢复、静音仍完整准备资源及加载失败重试。
4. 测量全部解码的加载耗时、移动端内存及瞬时解码负载。按仓库 BGM manifest 时长合计约 897.488 秒，以 48 kHz/双声道/float32 估算，仅 BGM PCM 约 **328.67 MiB**，尚未包含 SFX、压缩字节与浏览器开销；这是覆盖全部曲目的成本估计，并非实测内存。全量解码是否适合目标手机需由主控验证。
5. 延续第一阶段的真实增益/削波动态、控件/移动视口和听感验收。Node 使用可控解码替身验证契约，不能代替真实浏览器解码、实际扬声器或完整用户验收。


## 独立审查返修：程序化事件、当前快照与 manifest 重试（2026-11-01）

状态：**local-node-verified-browser-pending**。本轮从 `538e2849cb4741ca8e9a2d90fffe3d8cd4f12181` 继续，保留此前所有提交，原始 base 为 `99f2d236d496971f6a702d9d41929d1cce65bd80`。实现、回归与测试证据 commit：`d95032e06adc90158fdd2b16d50b8345059d30f6`；报告随后单独本地提交。

### 修复与 API 契约补充

1. `_dispatchSfx()` 对没有真实 asset path 的事件直接调用原程序化音效，仍调用 `ensure()` 并保留限流与定时释放。`companionAlarm` 不请求 undefined、不读取 SFX manifest、不进入真实资源 ready 清单。回归通过原 `_companionAlarm()` 调度三个音符，精确核对频率、时长、波形、增益、pan、调度时间与 reservation 释放；测试禁用无关 menu BGM，断言网络请求和 decode 均为零。已有全局 preload 若已启动，`ensure()` 仍按既定语义继续资源准备。
2. `preload()` **进行中调用仍返回同一个 Promise**；完成轮次后、无需新工作时返回 `Promise.resolve(getReadiness())`，因此反映最新 ready、contextState、unlocked 和资源状态，也避免调用者修改旧快照污染下一次结果。不会重复 fetch/decode；失败仍显式返回 failed/ready:false。旧测试中的“完成后仍返回首轮 Promise”按本次要求改为严格比较当前快照，同时额外断言内部工作 Promise 仍为首轮，全部进行中的身份断言、缓存计数和 whenReady 共享断言保留。
3. `{retry:true}` 的工作判定包括 failed manifest，即使 26 项真实资源已经 ready，仍可重试失败 manifest。成功 manifest、全部成功字节及 decoded buffers 继续复用。回归设置 BGM manifest 成功、SFX manifest 失败，资源仍 ready；恢复后显式 retry 只新增一次 SFX manifest 请求、不增加 decode，并保留全部 buffer。此后重复 retry 不新增请求。manifest 继续为 advisory，不将其成功当作资源 ready 条件。

资源覆盖仍为 **26 个真实文件**：16 个 SFX 文件覆盖 17 个事件（repel/kill 别名），8 个 BGM 槽位包含 PAF，另有 combat-b/combat-c。原先的首次 PAF 真实缓存播放、零音量仍加载解码、失败与重试、手势前仅 fetch/手势后 decode、跨场景 BGM、Stable/Dev 和保护链测试继续通过。本轮不改变音量参数、削波保护、设置或资源清单。

### 验证证据与精确计数

| 检查 | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| 修复前：新增回归所在 readiness 文件 | 13 测试 | 3 测试 | 0 |
| 最终：原 61 项聚焦集合 + 4 项新增回归 | **65 测试** | **0** | **0** |
| 其中 readiness 文件 | **16 测试** | **0** | **0** |
| 完整 `node tools/run-node-tests.cjs` | **99 文件** | **0** | **22 浏览器/CDP 文件** |
| 累计相对原始 base 改动脚本 `node --check` | **13 文件** | **0** | **0** |
| 其中本轮改动脚本 `node --check` | **2 文件** | **0** | **0** |

聚焦集合仍使用前文完整的十文件命令，没有删测试。新增四项分别验证原程序化告警无网络请求、完成后的当前快照、失败快照不变成功、资源 ready 后的 manifest 重试恢复。修复前有三项回归按预期失败；失败保持测试当时即通过。最终 65 项全部通过，skipped 未计入通过。

证据目录：`outputs/m3d-20261101-beta-audio-volume-controls/readiness-review/`，包含 `before-fix-regressions.txt`（修复前）、`focused-tests.txt`（最终）、`node-tests.txt`（最终）、`syntax-checks.txt`（累计 13 文件）。保存日志时仅清理行末空白以通过 diff 检查，未改变结果。

本轮实际改动仅：`src/systems/audio.js`、`tools/test-audio-readiness.test.cjs`、上述四个输出文件及本报告。已审查实际代码、测试与 staged diff，并执行 `git diff --check` 与 `git diff --cached --check`。仅 stage 本任务文件；`.codex-cli-write.lock.d/` 仍未跟踪且未 stage。未修改 main.js、UI/CSS、Stable/Dev 设置、其他工作树或其他禁止区域。

后续普通游戏/沙盒/PAF 的入口接线、真实浏览器控件/资源/解码与解锁检查、实际听感和削波动态、移动视口及移动端解码内存/耗时验收均**尚未完成**，继续由主控串行完成。Node 解码替身不能代替真实浏览器和用户验收。本轮 **Chrome/CDP/浏览器未启动；push/PR/deploy 未执行；Caddy/systemd/线上写未执行**。
