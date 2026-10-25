# m3d-20261025-beta-audio-tos-preload 交付报告

日期：2026-10-25  
分支：`codex/beta-audio-tos-20261025`  
基线：`1462c32d9f3d62e6897a88244b93d2eba8979bd7`  
实现 commit：`c43e3e4097e0ffb091797f6fedf285c5a6849da3`

## 实现内容

- beta 的 BGM、SFX 与两份 manifest 统一按 `TOS URL -> 本地相对路径` 顺序加载。
- 网络异常、非 2xx、响应读取/JSON 解析失败、超时均进入下一候选；音频 `decodeAudioData` 失败也会用本地字节重试。
- BGM 超时 15 秒，SFX 超时 8 秒。超时同时 abort 请求并进行 Promise race，不依赖请求方必须响应 abort。
- 新增按候选 URL 缓存的 `_audioBytesCache`，保留原 `_manifestCache` 与解码后 `_loadBuffer` 缓存接口；失败结果也缓存，避免同一资源反复请求远端。
- 页面初始化在 `IS_BETA` 门控内立即低优先级预取 BGM/SFX manifest 和 `bgm/menu.mp3`，不创建 AudioContext、不等待用户手势。
- 首次手势设置 title/menu 状态，创建并 resume AudioContext，从预取字节 decode 并进入现有 BgmManager；后续 play 场景切换逻辑不变。
- stable/dev 不调用 preload；原非 beta manifest/buffer 分支保留，新增测试确认不触碰 TOS。

## 改动文件

- `src/systems/audio.js`：TOS 候选、超时/回退、字节缓存、启动预取、首次手势 menu 请求。
- `src/main.js`：仅在 beta 启动时调用 `audio.preload()`。
- `tools/test-audio-system.cjs`：将两条旧本地成功加载断言更新为 TOS 成功加载断言。
- `tools/test-audio-tos-preload.test.cjs`：新增 7 个无真实网络测试。
- `outputs/m3d-20261025-beta-audio-tos-preload-report.md`：本报告。

未修改 `audio-pan.mjs`、HTML/public shell、版本文件、音频二进制或第三方依赖。

## 验证命令与真实输出

### 语法检查

```sh
node --check src/systems/audio.js
node --check src/main.js
node --check tools/test-audio-system.cjs
node --check tools/test-audio-tos-preload.test.cjs
```

真实结果：四条命令均退出 0，无 stdout/stderr。`git diff --check` 同样退出 0。

### 原音频测试

```sh
node tools/test-audio-system.cjs
```

真实输出：

```text
✔ beta audio buses, percent clamp, settings persistence round trip
✔ all 17 legacy SFX names map and file/failure/offline decision is pure
✔ static SFX file wins; missing/failing audio silently calls procedural fallback
✔ BGM slots cover all six moods and switch through a timed crossfade
✔ BGM manifest 缺失时走程序化回退而不是静默无声
✔ same-family SFX concurrency and interval limits are enforced
✔ provider scripts safely skip when no environment keys are present
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

结果：**7 通过 / 0 失败**。

### 新增 TOS/预取纯逻辑测试

```sh
node --test tools/test-audio-tos-preload.test.cjs
```

真实输出：

```text
✔ beta URL candidates put TOS before the unchanged local path
✔ network errors fall back from TOS to local bytes
✔ non-2xx manifest responses fall back to the local manifest
✔ decodeAudioData failure retries with local bytes
✔ request timeout falls back to local bytes
✔ startup prefetch runs without a gesture and gesture decodes cached menu bytes
✔ non-beta preload and buffer loading never touch TOS
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

结果：**7 通过 / 0 失败**。fetch 全部为桩，未访问真实网络。

### 项目 Node 测试套件

```sh
node tools/run-node-tests.cjs
```

最终真实输出摘要：

```text
PASS test-audio-system.cjs
PASS test-audio-tos-preload.test.cjs
PASS test-beta-contract.cjs
...
22 browser/CDP tests skipped (need Chrome): test-action-layout.cjs, test-attack.cjs, test-attacks.cjs, test-body-view.cjs, test-dev-gs.cjs, test-dev-turn.cjs, test-ecology.cjs, test-fixes.cjs, test-fox-navigation.cjs, test-fox-run.cjs, test-fox-types.cjs, test-fullscreen.cjs, test-glb.cjs, test-gs.cjs, test-jump-physics.cjs, test-models.cjs, test-particles.cjs, test-posture.cjs, test-repel.cjs, test-v11.cjs, test-v12.cjs, test-viewmodel.cjs
OK 55/55
```

结果：**55 通过 / 0 失败 / 22 个 browser/CDP 文件跳过**。跳过项是 runner 对浏览器测试的既定分流，不计入 55 个 Node 测试文件。

## 未完成项

- 无代码或逻辑测试未完成项。
- 未执行真实浏览器自动播放/发声与公网 TOS 端到端测试；本任务按要求以注入 fetch 桩验证，未部署、未 push。

## 已知问题 / 风险

- AudioContext 按浏览器自动播放策略在首次手势创建，因此 decode 在首次手势后执行；执行的是预取字节，不会重新 fetch menu。真实设备上的解码耗时仍取决于浏览器和文件大小。
- 未做真实浏览器听感、CORS 或首屏性能测量；TOS 公网 200/CORS 前置条件采用任务提供的已验证信息。

## 自评

**9/10**。需求中的 beta 门控、TOS 优先、本地兜底、四类失败回退、手势前预取、手势后复用字节及非 beta 隔离均有自动化覆盖，项目 Node 套件全绿。扣分仅因未进行真实浏览器发声和首屏性能验证。
