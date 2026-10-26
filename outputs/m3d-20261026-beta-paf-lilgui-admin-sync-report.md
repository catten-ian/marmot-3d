# m3d-20261026-beta-paf-lilgui-admin-sync

## 用户目标
临时测试保留 PAF（扮演藏狐）既有 lil-gui，并让参数数量/定义与 admin 同步；支持从 admin 服务器配置拉取到 PAF，也支持把 PAF 当前配置推送到 admin 服务器。

## 实际完成

- 保留原有 PAF 调试分区：移动、扑击、猎物 AI、相机、FPV、可视化、猎物增删/复位、localStorage、导入/导出、反馈和工具操作均未移除。
- 新增「admin 全参数 / Admin tuning」分区：直接 `import` `src/admin/tuning-schema.mjs` 的 `buildTuningEntries()`，按 schema group 自动创建 folder，共 578 个条目；number 使用 schema 的 min/max/step 和单位，boolean 使用开关，enum 使用下拉，中文 label 沿用 schema。
- 新增运行时路径桥接：解析 schema source 的点分路径并写回 `PLAYER`、`FOX`、`BETA_TUNE`、`STRIKE_VOLUMES`、`SMART_*` 及地图对象等可变运行时对象；带 `toView/toStore` 的条目在面板展示和写回时转换。没有可变目标的常量条目使用本地 shadow 值，面板仍可编辑并随推送收集。
- 新增「服务器配置 / Server」分区：列出命名配置和当前 `active`，选择后只应用 schema 内键，统计未知/非法和钳制项；支持命名配置推送、重名覆盖确认、网络失败红字提示且不打断游戏。
- active API 返回运行时白名单形态（无 `beta.` 前缀）时，会映射到 schema 的 `beta.*` 条目；没有修改现有 `RUNTIME_CONFIG` 白名单机制。
- 新增纯函数契约测试覆盖：点分路径读写、toView/toStore、配置应用/mock、推送载荷、非法/未知键跳过。

## 改动文件

- `src/play/play-as-fox-debug.js`
- `src/play/paf-admin-sync.mjs`
- `tools/test-paf-admin-sync.test.cjs`

未修改版本戳、`index-public.html`、`tools/public-shell.cjs`、账号服务、Caddy 或线上服务器文件。

## 验证

- `node --check src/play/play-as-fox-debug.js src/play/paf-admin-sync.mjs tools/test-paf-admin-sync.test.cjs`：通过。
- `node --test tools/test-paf-admin-sync.test.cjs`：1/1 通过。
- `node tools/run-node-tests.cjs`：77/77 通过；22 个浏览器/CDP 项按机制跳过。
- `git diff --check`：通过。
- schema 展开检查：578 项、13 个 group、5 个 enum、12 个 boolean。

## 未完成项

- 未修改服务器运行时白名单和 admin 的 active 分发机制，按任务要求保留现状。

## 已知问题/边界

推送到服务器的配置经 admin「应用」进入 `__active__` 后，游戏启动时的运行时白名单（`RUNTIME_CONFIG`，`betaConfig` query / active 拉取）目前只覆盖 `beta.*` 子集；超出白名单的参数只在 lil-gui 本地实时生效，不会随 active 配置全局分发。本任务没有修改该白名单机制。

## Commit

实现提交：`3faec7f5ccc2d8d9883e5d9e407e4d58c83c0917`
