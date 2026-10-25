# Beta 后台应用与啃草调参报告

日期：2026-10-25

## 实现

- `src/core/runtime-config.mjs`
  - 新增 Beta 运行时载荷纯函数契约：schema 校验、Beta 白名单、有限数/布尔类型校验、非负钳制、URL 编码/解码、sessionStorage 回退读取。
  - 仅覆盖 `BETA_TUNE` 中已有键；缺失或无效载荷不会改变默认行为。
  - 支持从后台保存结构 `{values: {'beta.moveSpeedMul': ...}}` 投影为游戏运行时 `{values: {moveSpeedMul: ...}}`。
- `src/admin/panel.mjs`
  - 服务器配置列表新增“应用”按钮。
  - 应用按钮读取保存配置，生成同源 Beta 游戏 URL，并将载荷放入 `betaConfig` query；随后导航进入游戏页。
  - 仍保留“加载”（后台预览）和“删除”。
- `src/main.js`
  - Beta 游戏启动早期读取 query/sessionStorage 运行时载荷并覆盖 `BETA_TUNE` 对象。
  - 现有运行时引用因此实际读取覆盖值：`moveSpeedMul`、`sprintMoveCost`、`grassSeconds`、`grazeRate`、`grassRegrowPerSec`、`grazeRegenPerSec` 以及相关啃草半径/视高参数。
  - 非 Beta、无载荷、非法载荷均继续使用原常量。
- `tools/test-runtime-config.mjs`
  - 覆盖应用载荷 schema/白名单/非法值、运行时覆盖、默认值隔离、URL round-trip、后台 Beta 字段投影。

## 测试

执行：

```text
node --test tools/test-runtime-config.mjs tools/test-admin-tuning.mjs tools/test-admin-config-cloud.mjs
```

精确结果：16 tests，16 pass，0 fail，0 cancelled，0 skipped；耗时 81.242 ms（本次运行）。

另执行 `git diff --check`，无输出/无空白错误。

## 集成说明

在 Beta 后台“服务器上的配置”列表点击“应用”后，会请求 `/api/configs/:name`，把保存配置中的 `beta.*` 字段编码为同源游戏页 URL 的 `betaConfig` 参数并导航。游戏入口在 Beta 模式初始化时读取并验证该参数，然后覆盖运行时调参对象；由于主循环、啃草网格和啃草能量结算均引用该对象，速度倍率及啃草相关参数会在实际游戏页生效，而非仅后台预览生效。

载荷未包含 beta 字段时会被拒绝/忽略，不会改变默认常量。当前采用 query 方案，便于自动化测试和复制；实现同时提供 sessionStorage 读取回退，但本按钮优先使用 URL 载荷。

## 范围与限制

- 只修改本 worktree；未部署、未 push。
- 未修改版本戳、`index-public`、`tools/public-shell`、账号服务、Caddy。
- 应用按钮使用浏览器 `location.assign`，因此需要在可访问后台 API 的同源 Beta 页面操作。

## 本地提交

待提交后填入 commit SHA。
