# DEV Verdant 本地资源加载

DEV 页面支持把下载的 `verdant_trail.zip` 和单独的模型包合并到本地后加载。请按以下顺序操作：

1. 下载并解压 `verdant_trail.zip`。如果解压后只有 `verdant_trail.blend` 和 `textures/`，这是源文件包，`.blend` 不能被浏览器直接加载，仍需优化运行时 overlay。
2. 下载 `./release/verdant-models.zip`，把它解压到已经解压的 `verdant_trail` 文件夹并允许合并；它会创建/合并 `assets/models/marmot.glb` 和 `assets/models/fox-segmented.glb`。
3. 确认 `verdant_trail/assets/verdant/` 存在 `manifest.json`、`verdant-trail-height.json`、`verdant-trail.glb`。缺少时下载 `./release/verdant-overlay-runtime.zip` 并同样解压合并到 `verdant_trail`。
4. 打开 `https://www.catten.cyou/marmot3d/?version=dev`，点击标题页的“选择资源包文件夹”，选择 `verdant_trail` 文件夹；也可以选择包含它的外层文件夹。ZIP 必须先解压，不能直接选择 ZIP 文件。

页面会逐项显示已找到和缺少的路径。选择包含多个重复 `assets/` 副本的外层目录时会报告歧义，请改选目标 `verdant_trail` 文件夹。`verdant_trail.blend` 和 `textures/` 会被安全忽略，它们不能替代 `assets/verdant/` 优化文件。

完整运行时集合是：

- `assets/verdant/manifest.json`
- `assets/verdant/verdant-trail-height.json`
- `assets/verdant/verdant-trail.glb`
- `assets/models/marmot.glb`
- `assets/models/fox-segmented.glb`

支持 File System Access API 的 Chrome/Chromium 会记住目录并在下次访问时恢复；需要时点击“重新授权”。不支持该 API 时会退回 `webkitdirectory` 文件夹选择框。完整本地集合会优先通过 Blob URL 加载，缺少的资源继续使用服务器回退路径。

## 包文件与校验

- `release/verdant-overlay-runtime.zip`：仅三项 `assets/verdant/*` 优化运行时文件，并附中文 README 与 `SHA256SUMS`。
- `release/verdant-models.zip`：仅两项 dev 模型，并附中文 README 与 `SHA256SUMS`；不含 `.blend`、`textures/`、EXR/HDR/PNG/JPG 或其他 authoring 素材。

两个 ZIP 均由当前仓库中的运行时文件确定性生成；`release/` 已被 Git 忽略。由于主机上没有用户提供的字面 `verdant_trail.zip`，无法验证其内部目录名，只能覆盖上述嵌套目录和源文件共存场景。
