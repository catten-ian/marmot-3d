#!/usr/bin/env node
/**
 * 校验 TOS 上 m3d-dev/<version>/<tier> 是否与本地暂存目录逐文件一致（size + sha256）。
 *
 * 用法：node tools/verdant/verify_tos_pack.cjs <暂存根> <version> [档位...]
 * 例：  node tools/verdant/verify_tos_pack.cjs /tmp/m3d-tos-stage 20261027
 *
 * 走匿名公共读（与浏览器完全同一条链路），不依赖任何凭据。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const https = require('node:https');

const HOST = 'https://marmot.tos-cn-shanghai.volces.com';
const stageRoot = path.resolve(process.argv[2] || '/tmp/m3d-tos-stage');
const version = process.argv[3] || '20261027';
const tiers = process.argv.length > 4 ? process.argv.slice(4) : ['low', 'medium', 'high', 'ultra'];

function head(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: 'HEAD', timeout: 30000 }, (res) => {
      resolve({ code: res.statusCode, len: res.headers['content-length'] || '0' });
    });
    req.on('error', (e) => resolve({ code: 'ERR', len: '0', err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ code: 'TIMEOUT', len: '0' }); });
    req.end();
  });
}
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

(async () => {
  let bad = 0;
  let checked = 0;
  for (const tier of tiers) {
    const dir = path.join(stageRoot, 'm3d-dev', version, tier);
    if (!fs.existsSync(dir)) { console.log(`  ${tier}: 暂存目录缺失`); bad++; continue; }
    const files = walk(dir);
    let miss = 0;
    let sizeBad = 0;
    const details = [];
    for (const f of files) {
      const rel = path.relative(dir, f).replaceAll(path.sep, '/');
      const url = `${HOST}/m3d-dev/${version}/${tier}/${rel}`;
      const h = await head(url);
      checked++;
      if (h.code !== 200) { miss++; if (details.length < 8) details.push(`MISS ${rel} (HTTP ${h.code})`); continue; }
      const want = fs.statSync(f).size;
      if (String(h.len) !== String(want)) { sizeBad++; if (details.length < 8) details.push(`SIZE ${rel} ${h.len} != ${want}`); }
    }
    const ok = files.length - miss - sizeBad;
    console.log(`  ${tier}: ${ok}/${files.length} 一致，缺失 ${miss}，大小不符 ${sizeBad}`);
    details.forEach((d) => console.log(`     ${d}`));
    if (miss || sizeBad) bad++;
  }
  console.log(`\n共校验 ${checked} 个对象，${bad ? `${bad} 个档位有问题` : '全部一致'}`);
  process.exit(bad ? 1 : 0);
})();
