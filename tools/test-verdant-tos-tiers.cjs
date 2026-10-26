#!/usr/bin/env node
/**
 * 契约测试：Verdant 四档必须全部优先走火山 TOS，而不是回源到慢服务器。
 *
 * 纯 Node，无浏览器、无 CDP、无网络：
 *  - 断言 index.html 的 TOS 版本前缀与 local-pack.js 的兜底版本一致
 *  - 断言 getAssetCandidates 对四档都把 TOS URL 排在同源服务器之前
 *  - 断言 TOS 候选 URL 形如 <base>/m3d-dev/<version>/<tier>/assets/...
 *  - 断言 stable/beta 通道不引用 TOS（dev-only 隔离）
 *
 * 用法：node tools/test-verdant-tos-tiers.cjs
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const TIERS = ['low', 'medium', 'high', 'ultra'];
const failures = [];
function check(name, cond, detail = '') {
  if (cond) console.log(`  PASS ${name}`);
  else { console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

(async () => {
  console.log('Verdant TOS 档位契约');

  // 1) index.html 的 TOS 配置
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const verMatch = html.match(/__VERDANT_TOS__[\s\S]*?version:\s*'(\d+)'/);
  check('index.html 存在 TOS version', !!verMatch);
  const version = verMatch ? verMatch[1] : '';
  console.log(`  info TOS version = ${version}`);
  check('TOS base 指向 marmot 桶', /marmot\.tos-cn-shanghai\.volces\.com/.test(html));
  check('TOS 配置仍是 dev-only（stable 不引用）', html.includes('stable/beta 不加载 verdant 代码'));

  // 2) local-pack.js 的兜底版本必须与 index.html 一致，否则 localStorage 回退会指向旧包
  const lp = fs.readFileSync(path.join(root, 'src', 'world', 'local-pack.js'), 'utf8');
  const fallbacks = [...lp.matchAll(/version:\s*'(\d+)'/g)].map((m) => m[1]);
  const fallbackVersions = [...new Set(fallbacks)];
  check('local-pack.js 兜底版本唯一', fallbackVersions.length === 1, fallbackVersions.join(','));
  check(
    'local-pack.js 兜底版本 == index.html 版本',
    fallbackVersions.length === 1 && fallbackVersions[0] === version,
    `local-pack=${fallbackVersions.join(',')} index.html=${version}`,
  );

  // 3) 四档候选顺序：TOS 必须在同源之前
  globalThis.location = new URL('https://www.catten.cyou/marmot3d/?version=dev');
  globalThis.window = { __VERDANT_TOS__: { baseUrl: 'https://marmot.tos-cn-shanghai.volces.com', version } };
  const mod = await import(path.join(root, 'src', 'world', 'local-pack.js'));

  for (const tier of TIERS) {
    const scene = `https://www.catten.cyou/marmot3d/assets/verdant/tiers/${tier}/verdant-trail-${tier}.glb`;
    const candidates = mod.getAssetCandidates(scene, tier);
    check(`${tier}: 至少两个候选（含 TOS + 同源兜底）`, candidates.length >= 2, String(candidates.length));
    const first = candidates[0] || '';
    const isTos = first.startsWith('https://marmot.tos-cn-shanghai.volces.com/');
    check(`${tier}: 首选候选是 TOS`, isTos, first);
    check(`${tier}: TOS URL 前缀正确`, first.includes(`/m3d-dev/${version}/${tier}/assets/`), first);
    check(`${tier}: 同源服务器仅作末位兜底`, candidates.at(-1).includes('/marmot3d/assets/'), candidates.at(-1));
  }

  // 4) 非场景类资源（高度场 / 档位清单 / 公共模型）也必须走 TOS
  const others = [
    ['height', 'https://www.catten.cyou/marmot3d/assets/verdant/verdant-trail-height.json'],
    ['catalog', 'https://www.catten.cyou/marmot3d/assets/verdant/manifest.json'],
    ['model', 'https://www.catten.cyou/marmot3d/assets/models/marmot.glb'],
  ];
  for (const [label, url] of others) {
    const first = mod.getAssetCandidates(url, 'low')[0] || '';
    check(`${label}: 首选候选是 TOS`, first.startsWith('https://marmot.tos-cn-shanghai.volces.com/'), first);
  }

  // 5) stable/beta 不应加载 Verdant 代码 —— dev 开关门控
  const versionJs = fs.readFileSync(path.join(root, 'src', 'core', 'version.js'), 'utf8');
  check('version.js 导出 IS_DEV', /export const IS_DEV/.test(versionJs));
  const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  check('main.js 的 Verdant 入口由 devOn 门控', /devOn\('verdantWorld'\)/.test(mainJs));

  // 6) 生成器自指一致性（pack-manifest 声明的 manifest 大小必须等于实际）
  const verdant = path.join(root, 'assets', 'verdant');
  const catalog = JSON.parse(fs.readFileSync(path.join(verdant, 'manifest.json'), 'utf8'));
  for (const tier of TIERS) {
    const entry = catalog.tiers?.[tier];
    check(`${tier}: catalog 有条目`, !!entry);
    if (!entry) continue;
    const tierDir = path.join(verdant, 'tiers', tier);
    const pack = JSON.parse(fs.readFileSync(path.join(tierDir, 'pack-manifest.json'), 'utf8'));
    check(`${tier}: pack-manifest tier 字段正确`, pack.tier === tier, pack.tier);
    check(`${tier}: pack-manifest fileCount 自洽`, pack.files.length === pack.fileCount);
    const self = pack.files.find((f) => f.path === `manifest-${tier}.json`);
    const real = fs.statSync(path.join(tierDir, `manifest-${tier}.json`)).size;
    check(`${tier}: pack-manifest 自指大小正确`, !!self && self.size === real, self ? `${self.size} vs ${real}` : '缺自指条目');
    const scenePath = path.join(verdant, entry.scene);
    check(`${tier}: 场景文件存在`, fs.existsSync(scenePath), scenePath);
    if (fs.existsSync(scenePath)) {
      // catalog.sha256 始终是场景文件本身的哈希；catalog.bytes 对 low/medium/high 也是场景文件大小，
      // 但 ultra 的 bytes 是整包大小（.gltf 极小，体积在 .bin 与贴图上），只能按 sha256 校验。
      const sha = require('node:crypto').createHash('sha256').update(fs.readFileSync(scenePath)).digest('hex');
      check(`${tier}: 场景 sha256 与 catalog 一致`, sha === entry.sha256, `${sha.slice(0, 12)} vs ${String(entry.sha256).slice(0, 12)}`);
      if (tier !== 'ultra') {
        check(`${tier}: 场景大小与 catalog 一致`, fs.statSync(scenePath).size === entry.bytes, `${fs.statSync(scenePath).size} vs ${entry.bytes}`);
      }
    }
  }

  console.log(failures.length ? `\nFAILED ${failures.length}: ${failures.join('; ')}` : '\nOK');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  process.exit(1);
});
