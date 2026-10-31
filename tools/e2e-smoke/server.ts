import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
const MIME: Record<string, string> = {
  '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml',
  '.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.hdr':'application/octet-stream','.exr':'application/octet-stream','.wasm':'application/wasm',
  '.mp4':'video/mp4','.webm':'video/webm','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon',
};

export function rewritePublishedAssetUrl(originalUrl:string, staticPort:number) {
  try {
    const url=new URL(originalUrl);
    if(url.origin!=='https://marmot.tos-cn-shanghai.volces.com')return null;
    const assetIndex=url.pathname.indexOf('/assets/');
    let mapped=assetIndex>=0?url.pathname.slice(assetIndex):'';
    if(!mapped&&/\/low\/walkable-field\.bin$/.test(url.pathname))mapped='/assets/verdant/tiers/low/walkable-field.bin';
    if(!mapped.startsWith('/assets/'))return null;
    return `http://127.0.0.1:${staticPort}${mapped}${url.search}`;
  } catch { return null; }
}

export function createStaticServer(root: string, port: number) {
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index-public.html';
      // The public shell's import map intentionally uses the beta mount prefix; alias it to repo root.
      if (rel.startsWith('/marmot3d-beta/')) rel = rel.slice('/marmot3d-beta'.length);
      const file = path.resolve(root, `.${rel}`);
      if (file !== root && !file.startsWith(`${root}${path.sep}`)) { res.writeHead(403).end('Forbidden'); return; }
      fs.stat(file, (error, stat) => {
        if (error || !stat.isFile()) { res.writeHead(404, { 'Content-Type':'text/plain; charset=utf-8' }).end('Not found'); return; }
        let start = 0, end = stat.size - 1, status = 200;
        const range = req.headers.range;
        if (range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
          if (!m) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
          if (m[1]) start = Number(m[1]);
          if (m[2]) end = Math.min(Number(m[2]), stat.size - 1);
          if (!m[1] && m[2]) start = Math.max(0, stat.size - Number(m[2]));
          if (start > end || start >= stat.size) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end(); return; }
          status = 206;
        }
        const headers: Record<string,string> = {
          'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Accept-Ranges':'bytes','Content-Length':String(end - start + 1),'Cache-Control':'no-cache',
          'X-Content-Type-Options':'nosniff',
        };
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
        res.writeHead(status, headers);
        if (req.method === 'HEAD') { res.end(); return; }
        if (req.method !== 'GET') { res.end(); return; }
        fs.createReadStream(file, { start, end }).pipe(res);
      });
    } catch { res.writeHead(400).end('Bad request'); }
  });
  server.listen(port, '127.0.0.1');
  return server;
}
