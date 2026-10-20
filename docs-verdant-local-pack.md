# DEV Verdant 本地资源包

部署后从 `./release/verdant-dev-pack/` 下载并解压 `verdant-dev-pack.zip`（或直接复制该目录）。打开 `index.html?version=dev`，在标题页点击“选择资源包文件夹”，选择**资源包根目录**，也就是能看到 `assets/` 文件夹的目录。

资源包必须包含：

- `assets/verdant/manifest.json`
- `assets/verdant/verdant-trail-height.json`
- `assets/verdant/verdant-trail.glb`
- `assets/models/marmot.glb`
- `assets/models/fox-segmented.glb`

推荐使用 HTTPS 或 `http://localhost` 的 Chrome/Chromium。支持 File System Access API 的浏览器会记住目录并在下次访问时检查读取权限；需要时点击“重新授权”。不支持该 API 时，页面会退回 `webkitdirectory` 文件夹选择框，普通文件选择不会持久化。ZIP 不能直接在页面内选择，必须先解压。

页面会显示已找到和缺少的每个文件。完整包在刷新后优先从本地 Blob URL 读取 Verdant 地形和 dev 模型；不完整包会对缺少的文件逐项提示，并继续从服务器 URL 回退加载。未选择本地包时，原有服务器加载路径保持不变。

## 生成与校验

本次包只复制现有运行时资产，未修改 canonical 文件。源文件 SHA-256、大小和压缩结果记录在 `release/verdant-dev-pack/SHA256SUMS.txt`。压缩使用 ZIP Deflate；没有使用需要额外浏览器解码器的格式。
