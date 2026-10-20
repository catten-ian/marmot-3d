# babylon-rewrite smoke test（beta 1-3）

这是一个最简的手动浏览器检查页，用来确认 Babylon.js 的 importmap、模块加载、Scene、相机、灯光、地面和渲染循环能够联动。不要用 Playwright 或无头浏览器：当前沙箱无法稳定提供 WebGL 实体环境。

在项目目录启动本地 HTTP 服务：

```bash
cd /home/fame/code/marmot3d/m3d-beta-babylon
python3 -m http.server 8001 --bind 127.0.0.1
```

另开终端，用 Chrome 打开：

```bash
google-chrome http://127.0.0.1:8001/babylon-rewrite/smoke-test.html
```

页面中的 `<div id="status">` 应依次出现：

- `import @babylonjs/core OK`
- `import @babylonjs/loaders OK`
- `babylon scene + camera + light ready`
- `ground mesh ready`
- `render loop started`
- `=== smoke PASS: babylon-rewrite infra ok ===`

最后一行出现 `=== smoke PASS: babylon-rewrite infra ok ===` 才算通过。如果 CDN 无法访问，先检查浏览器控制台和网络连接，再记录为环境失败。
