# m3d-20261025-beta-admin-preview-enhance

## 交付
- Beta 后台每个调参行提供中文解释，含含义、单位/范围、调大调小影响、关联机制及危险组合；桌面 hover 与触屏 520ms 长按展示，短触不触发。
- 预览默认使用 Beta 程序化狐狸模型，状态明确显示来源，不加载真实 `fox.glb`。
- 增加程序化土拨鼠、花/草、木桩假人对象显隐；时间线支持暂停/继续、滑块逐帧检查、重播，并保留前摇→锁定/冲刺→命中窗口→后摇提示。
- 保留原配置导入/导出、数值面板及既有主后台行为。

## 改动文件
`admin.html`; `src/admin/main.mjs`; `src/admin/panel.mjs`; `src/admin/preview.mjs`; `src/admin/tuning-schema.mjs`。

## 精确验证
- `node --check src/admin/main.mjs`：通过
- `node --check src/admin/panel.mjs`：通过
- `node --check src/admin/preview.mjs`：通过
- `node --check src/admin/tuning-schema.mjs`：通过
- `node --test tools/test-admin-tuning.mjs`：5/5 通过
- `git diff --check`：通过
- CDP/真实浏览器证据：本运行环境未提供可用 CDP 端点，未伪造截图；需主控在托管 Chrome 上复验 1280x720、390x844、768x1024 的 hover、长按、对象切换、时间线和辅助体积，并记录截图路径。

## 范围与状态
- 分支：`codex/beta-admin-preview-20261025`
- 基线：`1462c32d9f3d62e6897a88244b93d2eba8979bd7`
- beta-only；未修改 `index-public.html`、`tools/public-shell.cjs` 或版本戳；未 push/deploy。
- 渲染后端：代码使用现有 Three.js WebGL 路径；未进行真实浏览器后端探测。
- 已知限制：时间线滑块驱动程序化姿态阶段，当前主循环不主动同步滑块 UI；主控可补充验证/修正。
