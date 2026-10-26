#!/usr/bin/env node
/**
 * 生成火山 TOS 上传暂存目录 + 根级 pack-manifest.json（format 2，路径相对包根）。
 *
 * 用法：node tools/verdant/build_tos_pack.cjs [assets/verdant 根] [版本前缀 20261027] [输出目录]
 *
 * 目录结构（与客户端 getAssetCandidates 的拼接规则一致）：
 *   <stage>/m3d-dev/<version>/<tier>/
 *     pack-manifest.json                      ← 根级清单（format 2，路径以 assets/ 开头）
 *     assets/models/*.glb                     ← 公共模型（每档重复一份）
 *     assets/verdant/manifest.json            ← 档位清单目录
 *     assets/verdant/verdant-trail-height.json
 *     assets/verdant/tiers/<tier>/**          ← 该档专属资产
 *
 * 客户端拼 URL 的规则是 packRoot(tier)=<base>/m3d-dev/<ver>/<tier>/ 加 assets/ 之后的相对路径，
 * 所以包根必须把 assets/ 完整放在 <tier>/ 下面，否则 404。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const verdantRoot = path.resolve(process.argv[2] || 'assets/verdant');
const version = process.argv[3] || '20261027';
const outRoot = path.resolve(process.argv[4] || path.join('/tmp', 'm3d-tos-stage', version));
const repoRoot = path.resolve(path.join(verdantRoot, '..', '..'));
const modelsDir = path.join(repoRoot, 'assets', 'models');
const TIERS = ['low', 'medium', 'high', 'ultra'];

function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function contentType(file) {
  if (file.endsWith('.gltf')) return 'model/gltf+json';
  if (file.endsWith('.bin')) return 'application/octet-stream';
  if (file.endsWith('.json')) return 'application/json';
  if (file.endsWith('.jpg') || file.endsWith('.jpeg')) return 'image/jpeg';
  if (file.endsWith('.hdr')) return 'image/vnd.radiance';
  if (file.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
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

const manifest = { format: 2, version, generatedAt: new Date().toISOString().slice(0, 10), tiers: {} };
let grandTotal = 0;

for (const tier of TIERS) {
  const tierSrc = path.join(verdantRoot, 'tiers', tier);
  const packRoot = path.join(outRoot, 'm3d-dev', version, tier);
  const files = [];

  // 1) 该档专属资产
  const tierFiles = walk(tierSrc);
  for (const src of tierFiles) {
    const rel = path.relative(tierSrc, src).replaceAll(path.sep, '/');
    const dst = path.join(packRoot, 'assets', 'verdant', 'tiers', tier, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.linkSync(src, dst);
    files.push({ path: `assets/verdant/tiers/${tier}/${rel}`, size: fs.statSync(src).size, sha256: sha(src), contentType: contentType(src) });
  }

  // 2) 档位清单目录 + 高度场
  for (const [rel, src] of [
    ['assets/verdant/manifest.json', path.join(verdantRoot, 'manifest.json')],
    ['assets/verdant/verdant-trail-height.json', path.join(verdantRoot, 'verdant-trail-height.json')],
  ]) {
    const dst = path.join(packRoot, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.linkSync(src, dst);
    files.push({ path: rel, size: fs.statSync(src).size, sha256: sha(src), contentType: contentType(src) });
  }

  // 3) 公共模型（运行时按 tier 前缀找，所以每档都要放一份）
  for (const src of walk(modelsDir)) {
    const rel = path.relative(modelsDir, src).replaceAll(path.sep, '/');
    const dst = path.join(packRoot, 'assets', 'models', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.linkSync(src, dst);
    files.push({ path: `assets/models/${rel}`, size: fs.statSync(src).size, sha256: sha(src), contentType: contentType(src) });
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  grandTotal += totalBytes;
  const packManifest = {
    format: 2,
    pack: `m3d-dev/${version}/${tier}`,
    tier,
    generatedAt: manifest.generatedAt,
    totalBytes,
    fileCount: files.length,
    files,
  };
  fs.writeFileSync(path.join(packRoot, 'pack-manifest.json'), JSON.stringify(packManifest, null, 2) + '\n');
  manifest.tiers[tier] = { pack: packManifest.pack, fileCount: files.length, totalBytes };
  console.log(`${tier}: ${files.length} 文件, ${(totalBytes / 1e6).toFixed(1)} MB -> ${packRoot}`);
}

fs.mkdirSync(outRoot, { recursive: true });
fs.writeFileSync(path.join(outRoot, 'tos-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`合计 ${(grandTotal / 1e6).toFixed(1)} MB`);
console.log(`清单 ${path.join(outRoot, 'tos-manifest.json')}`);
console.log(`暂存目录 ${outRoot}`);
