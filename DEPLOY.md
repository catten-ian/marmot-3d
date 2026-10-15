# 在线部署

- 正式版（稳定版）：https://www.catten.cyou/marmot3d/
- 旧版（5 关原版）：https://www.catten.cyou/marmot3d/?version=old
- 旧版静态资源走独立路径 `/marmot3d-old/*`，与新版缓存键隔离，避免 CDN 串资源。

## 运行

纯静态站点（ES module，需经 HTTP 访问，不能直接双击 index.html）：

```bash
node tools/serve.cjs 8200      # 零依赖
# 或
python3 -m http.server 8200
```

打开 http://127.0.0.1:8200/

three.js 已本地化到 `vendor/`，可完全离线运行。

## 版本开关

- 默认：稳定版（浆果采食）
- `index.html?version=dev`：旱獭生态学实验版（GS 全场景，需 WebGPU，不支持时自动回退 WebGL2/程序化场景）
- `?gs=1 / ?gs=0`：强制开关高斯泼溅全场景；`?models=off`：回退程序化模型
