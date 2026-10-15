/**
 * 极简静态服务器（零依赖）。
 * Python 的 http.server 在当前沙箱环境下会 STATUS_DLL_INIT_FAILED，
 * 改用 Node 实现，避免依赖系统运行时。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// 站点根目录是本文件的上一级（项目根），而不是 tools/ 本身
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.argv[2]) || 8200;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  // 防目录穿越
  const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`→ http://${HOST}:${PORT}/`);
});

server.on('error', (e) => {
  console.error('Server error:', e.message);
  process.exit(1);
});