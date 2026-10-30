# Beta rev57 审计遗留旋钮接线与后台能力标记发布记录

- 日期：2026-10-30
- 通道：Beta only；Dev/Stable 未发布、未修改。
- 来源任务：`m3d-20261030-beta-tuning-audit-remainders`
- 来源分支：`fix/beta-tuning-audit-remainders-20261030`（base `6f5c564` = rev54）
- 合并提交：`76fc113`
- 发布提交：`97357c2`
- 版本戳：`rev57`

## 内容

### 接线修复（此前为死旋钮）
- `smart.packWindow` / `smart.packSpacing` / `smart.packSlotSpacing`：`createSmartPack` 由字面量改为可注入 `{window, spacing, slotSpacing}`，由 `BETA_TUNE.smartPack*` 传入。默认值 1.2 / 0.35 / 0.025 行为不变。
- `smart.defaultDebounceHold` → `beta.smartDebounceHold`，经 `debounceIntent` 的 `options.hold` 真正生效（`smart-fox.js`）。默认 0.25 行为不变。
- 后台条目 id 由 `smart.*` 改为 `beta.*`，使其进入 `runtimePayloadFromAdminConfig` 的运行时投影（`id.slice(5)`），并通过 `sanitizeRuntimeValues` 的 `BETA_TUNE` 白名单。

### 后台能力标记
- `tuning-schema.mjs` 新增 `tuningCapability(entry)`：`beta.` 前缀且存在于 `BETA_TUNE` → `runtime`，否则 `preview`。
- `panel.mjs` 与 `admin.html` 增加「运行时生效」/「仅预览/导出，不影响线上对局」标记与图例。

## 主控独立复核（不采信 worker 自述）

- 差异逐文件审阅：`smart-fox-core.mjs`（注入点）、`smart-fox.js`（hold 接线）、`beta-tuning.js`（4 新键）、`main.js`（两处 `createSmartPack` 调用）、`tuning-schema.mjs` / `panel.mjs` / `admin.html`（能力标记）。
- 运行时链路核实：`applyRuntimeConfigWithPrecedence` 在 `src/main.js:96` 模块顶层 await 完成，早于 `:568` 的 `createSmartPack` 读取 `BETA_TUNE` → 后台应用顺序正确，参数确可注入。
- 投影链路核实：`runtimePayloadFromAdminConfig` 走 `id.startsWith('beta.') → slice(5)`；`sanitizeRuntimeValues` 以 `BETA_TUNE` 为白名单底座，4 个新键已在 `BETA_TUNE` → 可通过。
- `coordinator` 门控（`sandboxState.active ? sandboxState.smartPack : null`）经比对为 rev54 既有设计，两版该行逐字相同，本次 diff 未触碰 → 非本次引入。
- 幽灵旋钮探测器 allowlist 删除 3 行系**转正**而非弱化：原注释为「字面量内嵌、自动扫描无法确认」，接线后测试反而**要求**这些条目必须有运行时消费者。
- 新增测试文件确实被 runner 收录（runner 正则含 `.mjs`，收录 113 个；`test-beta-tuning-audit-remainders.mjs` 与 `test-beta-tuning-defects.mjs` 均在其中）。
- 禁改文件未触碰：`index-public.html` / `index.html` / `src/core/version.js` / `tools/public-shell.cjs`（版本戳改动由主控在集成树执行，不在 feature 树）。
- 改动文件全部落在 Beta 允许范围，未误改 stable/dev 通道文件。

## 验证

- feature 树：改动文件 `node --check` 全通过；`node --test tools/test-beta-tuning-audit-remainders.mjs` 4/4；全量 `node tools/run-node-tests.cjs` **91/91**。
- 集成树（升版后）：改动文件 `node --check` 全通过；`node tools/test-beta-contract.cjs` 通过；`node tools/public-shell.cjs --check` 通过；全量 `node tools/run-node-tests.cjs` **93/93**；`git diff --check` 通过。
- 版本戳：`index-public.html` 6 处 rev57、0 处 rev56；`src/core/version.js` `BUILD_STAMP = 'rev57'`；`tools/public-shell.cjs` `VERSION_STAMP = 'rev57'`。
- 22 个 browser/CDP 脚本按 runner 规则跳过，不计通过；未做实体手机与硬件 GPU 验收。

## 推送

- `origin/integ/beta-rev46` = `97357c2ad4455a9962b92bfc86ee2d77f9eec902`，与本地 `ls-remote` 一致。
- 推送使用 `git -c http.proxy= -c https.proxy=` 直连，绕开仓库内已失效的 `127.0.0.1:7890` 代理配置。

## 部署与回滚

- 当前：`/var/www/marmot3d-beta -> /var/www/m3d-releases/beta-rev57-tuning-audit-202610302251`
- 回滚：`/var/www/.last-beta-link` 内容为 `/var/www/m3d-releases/beta-rev56-paf-tank-roll-202610302010`
- 磁盘 95%（剩 1.2G）→ 采用 rev56 硬链接克隆（`cp -al`）而非复制式克隆；10 个部署文件先 `rm` 断链再覆盖，避免写穿旧 release。
- 覆盖前后 rev56 关键文件哈希逐个比对未变，rev56 回滚点完好。
- 暂存文件 SHA-256 与 rev57 目录内文件、线上文件三方全部一致后才用临时 symlink + `mv -T` 原子切链，临时链接已清理。
- 公网 `https://www.catten.cyou/marmot3d-beta/index-public.html` 与 `/admin.html` 返回 200；公网 `src/core/version.js` 返回 `BUILD_STAMP = 'rev57'`。

## 保留限制

- 22 个 browser/CDP 测试跳过，未做真实浏览器交互与实体手机触控验收。
- 未做硬件 GPU / WebGPU 与弱网验收。
- 智能狐群体节流参数在真实关卡中的实际影响面仍受既有 `sandboxState.active` 门控约束（本次未改动该门控）。
