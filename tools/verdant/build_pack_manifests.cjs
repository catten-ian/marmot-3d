#!/usr/bin/env node
/**
 * 生成每个档位的 tier-local pack-manifest.json，并回写 manifest-<tier>.json 的统计字段。
 *
 * 用法：node tools/verdant/build_pack_manifests.cjs [assets/verdant 根目录] [版本前缀，如 20261027]
 *
 * 自指错位修复（重要）：
 *   pack-manifest 里包含 manifest-<tier>.json 自己的 size/sha，而 manifest-<tier>.json
 *   又要写回 stats.packBytes / packFileCount / fileSha256 —— 两者互为因果。
 *   旧实现先算 entries 再改 manifest，导致 manifest 自己的条目永远差几个字节（实测 low 差 24B），
 *   客户端按 SHA-256 校验本地包时必然失败。
 *   现在改为不动点迭代：改 manifest → 重算 entries → 再改 manifest，直到 manifest 内容不再变化。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(process.argv[2] || 'assets/verdant');
const version = process.argv[3] || '20261027';
const TIERS = ['low', 'medium', 'high', 'ultra'];

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function md5(file) { return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex'); }
function walk(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function contentType(file) {
  if (file.endsWith('.gltf')) return 'model/gltf+json';
  if (file.endsWith('.bin')) return 'application/octet-stream';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.hdr')) return 'image/vnd.radiance';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
function entriesFor(dir) {
  return walk(dir)
    .filter((p) => !p.endsWith('pack-manifest.json'))
    .map((file) => ({
      path: path.relative(dir, file).replaceAll(path.sep, '/'),
      size: fs.statSync(file).size,
      sha256: sha(file),
      md5: md5(file),
      contentType: contentType(file),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

let failed = false;
for (const tier of TIERS) {
  const dir = path.join(root, 'tiers', tier);
  const manifestPath = path.join(dir, `manifest-${tier}.json`);
  if (!fs.existsSync(manifestPath)) { console.error(`SKIP ${tier}: 缺少 ${manifestPath}`); failed = true; continue; }

  const original = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let current = original;
  let entries = entriesFor(dir);
  let total = entries.reduce((n, x) => n + x.size, 0);

  // 不动点迭代：写回 manifest 后重算 entries，直到 manifest 内容稳定。
  for (let pass = 0; pass < 12; pass++) {
    const next = JSON.parse(JSON.stringify(current));
    next.packManifest = 'pack-manifest.json';
    next.stats = next.stats || {};
    next.stats.packBytes = total;
    next.stats.packFileCount = entries.length;
    next.stats.fileSha256 = sha(path.join(dir, current.files.scene));
    const text = JSON.stringify(next, null, 2) + '\n';
    if (text === fs.readFileSync(manifestPath, 'utf8')) { current = next; break; }
    fs.writeFileSync(manifestPath, text);
    current = next;
    entries = entriesFor(dir);
    total = entries.reduce((n, x) => n + x.size, 0);
  }

  const out = {
    format: 1,
    pack: `m3d-dev/${version}/${tier}`,
    tier,
    generatedAt: new Date().toISOString().slice(0, 10),
    totalBytes: total,
    fileCount: entries.length,
    files: entries,
  };
  fs.writeFileSync(path.join(dir, 'pack-manifest.json'), JSON.stringify(out, null, 2) + '\n');

  // 最终自检：manifest 自己这一条必须与磁盘一致。
  const self = entries.find((f) => f.path === `manifest-${tier}.json`);
  const selfReal = fs.statSync(manifestPath).size;
  const ok = self && self.size === selfReal;
  if (!ok) failed = true;
  console.log(`${tier}: ${entries.length} 文件, ${total} 字节, 自指${ok ? 'OK' : '错位!'}`);
}
process.exit(failed ? 1 : 0);
