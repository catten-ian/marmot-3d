# m3d-20261030-beta-tuning-audit-remainders

日期：2026-10-30（Asia/Shanghai）  
分支：`fix/beta-tuning-audit-remainders-20261030`  
基线：`6f5c564320a4eb42448f94f9c8f1ba4c6a91257b`（build(beta) publish rev54）

## 执行边界与初始状态

已在指定 JOB 目录执行：

```text
git status --short --branch
## fix/beta-tuning-audit-remainders-20261030
git log -1 --format='%H %s'
6f5c564320a4eb42448f94f9c8f1ba4c6a91257b build(beta): publish rev54 智能狐自然扑击与PAF方向操控
```

初始工作树没有任务外脏文件，未执行 reset/clean，未改 main/dev 或其它 worktree，未 push、未部署、未开 PR。

## 改动与数据流

### P1-A：pack 群体节流三参数

- `src/core/beta-tuning.js:58-60` 增加 `smartPackWindow=1.2`、`smartPackSpacing=0.35`、`smartPackSlotSpacing=0.025`。
- `src/admin/tuning-schema.mjs:338-340` 将原 `smart.pack*` 改为 `beta.smartPack*`，来源表达式指向 `BETA_TUNE` 和 `createSmartPack` 参数。
- `src/entities/smart-fox-core.mjs:201-209` 的 `createSmartPack({window, spacing, slotSpacing}={})` 注入参数，默认值仍严格为 `1.2/0.35/0.025`；窗口过滤、最多 2 只、槽位间隔的默认语义保持不变。
- `src/main.js:568,733` 仅在 `IS_BETA` 时从 `BETA_TUNE` 传入，stable 传 `undefined`，继续使用函数默认值。

数据流：后台 `beta.smartPackWindow` → `runtimePayloadFromAdminConfig()` 去掉 `beta.` → `BETA_TUNE.smartPackWindow` → `main.js` 两个 `createSmartPack({window})` 实例化点 → `smart-fox.js:449` 的 `canCommit()`；spacing/slotSpacing 同路径。

### P1-B：defaultDebounceHold

- `src/core/beta-tuning.js:61` 增加 `smartDebounceHold=0.25`。
- `src/admin/tuning-schema.mjs:335` 将原死条目改为 `beta.smartDebounceHold`，来源指向真实调用。
- `src/entities/smart-fox.js:263` 在 beta 传 `{ hold: BETA_TUNE.smartDebounceHold }`；stable 传 `undefined`，`debounceIntent` 继续使用默认 `.25`。
- `debounceIntent` 的真实语义是：候选意图累计 `held + dt` 小于 `options.hold ?? .25` 时保持旧意图，达到阈值才切换；本次没有改变默认手感。

数据流：后台 `beta.smartDebounceHold` → `BETA_TUNE.smartDebounceHold` → `smart-fox.js:263` → `smart-fox-core.mjs:195-198` 的 `debounceIntent(options.hold)`。

### P2：后台能力诚实标注

- `src/admin/tuning-schema.mjs:36-41` 新增纯函数 `tuningCapability(entry, runtimeKeys)`，规则为 `id` 以 `beta.` 开头且去前缀键存在于 `BETA_TUNE` 才是 `runtime`，其余为 `preview`；`buildTuningEntries()` 为每项附加 `entry.capability`。没有维护 587 项硬编码清单。
- `src/admin/panel.mjs:55-58,132-138` 在工具栏加入全局说明，并给每行加入带 `aria-label` 的能力标记：`运行时生效` 或 `仅预览/导出，不影响线上对局`。
- `admin.html:36-40` 增加紧凑的颜色和排版样式。
- 当前页面实际渲染 604 行，其中 runtime 59、preview 545；runtime 集合与 `beta.* ∩ BETA_TUNE` 精确相等。
- 保存、加载、应用、重置、导入、导出流程未改；没有使用 `alert()`。

## 测试与验收证据

### 基线回归

修复前先运行 `node tools/run-node-tests.cjs`：`OK 90/90`，22 个 browser/CDP 测试跳过（需要 Chrome）。原始输出未单独保存，但命令结果已在执行记录中。

修复后运行同一 runner：`OK 91/91`，22 个 browser/CDP 测试仍跳过，未新增失败。完整输出：

- [`full-run.log`](m3d-20261030-beta-tuning-audit-remainders/full-run.log)

新增纯逻辑测试计入 91 个通过项。

### 语法

以下改动文件均通过 `node --check`：

`src/core/beta-tuning.js`、`src/entities/smart-fox-core.mjs`、`src/entities/smart-fox.js`、`src/main.js`、`src/admin/tuning-schema.mjs`、`src/admin/panel.mjs`、`tools/test-beta-tuning-defects.mjs`、`tools/test-beta-tuning-audit-remainders.mjs`。

### 幽灵旋钮探测器

`node --test tools/test-beta-tuning-defects.mjs`：5/5 通过；旧的三条 `smart.pack*` allowlist 已删除，探测器通过真实 `BETA_TUNE`/运行时代码消费者确认它们，不靠 allowlist。输出：

- [`defects.log`](m3d-20261030-beta-tuning-audit-remainders/defects.log)

### 新增先红后绿测试

测试文件：[`test-beta-tuning-audit-remainders.mjs`](../../tools/test-beta-tuning-audit-remainders.mjs)。覆盖：

1. pack 注入参数、窗口清理、最多两只、间隔阈值和默认等价；
2. debounce hold 注入和默认等价；
3. 后台投影、sanitize、apply、非法/非 beta 丢弃和默认对象隔离；
4. UI capability 集合精确判定。

修复前日志（临时还原基线源文件后运行，随后已恢复补丁）：

- [`red-before-fix.log`](m3d-20261030-beta-tuning-audit-remainders/red-before-fix.log)；因基线没有 `tuningCapability` 导出而失败，记录为红。

修复后日志：

- [`green-after-fix.log`](m3d-20261030-beta-tuning-audit-remainders/green-after-fix.log)，4/4 通过。

### stable 零变化

- stable 分支路径在 `main.js:568,733` 传 `undefined`，`createSmartPack` 使用同一组默认值；`smart-fox.js:263` stable 不传 options，`debounceIntent` 使用原 `.25` 默认。
- `node --test tools/test-smart-fox-beta.mjs tools/test-smart-fox-closed-loop.mjs`：27/27 通过，包含 debounce、错峰、closed-loop stable 对照；输出：[`stable-smartfox.log`](m3d-20261030-beta-tuning-audit-remainders/stable-smartfox.log)。
- 新测试也逐项断言 `createSmartPack()` 默认行为与旧硬编码相等，`debounceIntent()` 不传 options 时仍为默认 hold。

### 版本戳零变化

`git diff -- index-public.html index.html src/core/version.js tools/public-shell.cjs` 输出为空；证据文件：[`version-diff.txt`](m3d-20261030-beta-tuning-audit-remainders/version-diff.txt)，大小 0 字节。

### UI 视觉

通过本地静态服务和托管 Chrome CDP 渲染 `admin.html`：

- [`admin__390x844.png`](m3d-20261030-beta-tuning-audit-remainders/visual/admin__390x844.png)
- [`admin__1280x720.png`](m3d-20261030-beta-tuning-audit-remainders/visual/admin__1280x720.png)
- [`manifest.json`](m3d-20261030-beta-tuning-audit-remainders/visual/manifest.json)

两种尺寸均读取到 604 行、59 runtime、545 preview；能力图例完整。视觉检查结论：标记可读，无文字重叠、裁切、输入控件或按钮遮挡，aria 标记存在。

## 文件清单

源码/测试：

- `src/core/beta-tuning.js`
- `src/entities/smart-fox-core.mjs`
- `src/entities/smart-fox.js`
- `src/main.js`
- `src/admin/tuning-schema.mjs`
- `src/admin/panel.mjs`
- `admin.html`
- `tools/test-beta-tuning-defects.mjs`
- `tools/test-beta-tuning-audit-remainders.mjs`

报告和证据：`outputs/m3d-20261030-beta-tuning-audit-remainders-report.md`、`outputs/m3d-20261030-beta-tuning-audit-remainders/` 下日志、截图和 manifest。

## 未完成项与已知限制

- 22 个 browser/CDP runner 测试按既有要求跳过，没有把跳过计为通过；本次仅对 admin 页面做了托管 Chrome CDP 截图和 DOM 计数，没有运行完整游戏浏览器回归矩阵。
- 没有线上 active config、真实账号服务或线上对局遥测；runtime 投影验证是纯逻辑闭环，不代表线上部署已验证。
- 没有改审计报告所列其它非本任务死旋钮，也没有借机调整扑击距离、角度、体力、碰撞等默认玩法值。

## 提交状态

实现提交：`c0dc4813cd9277c166923f0021703550c122e776`。状态：未 push、未部署。

## 自评

P1-A、P1-B、P2、纯逻辑先红后绿、稳定默认等价、全量 Node 回归、版本戳检查和 admin 视觉截图均有实测支撑。没有实测支撑的结论仅包括线上后台服务实际接收/发布配置、线上 Beta 游戏读取 active config，以及 22 个需要 Chrome 的完整游戏/CDP 测试。
