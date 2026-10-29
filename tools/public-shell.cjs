/** Generate the beta public entry from index.html, changing only deployed URLs. */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_BASE = '/marmot3d-beta';
const VERSION_STAMP = 'rev50';

function replaceOnce(source, pattern, replacement, label) {
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Could not transform ${label}`);
  return next;
}

function generatePublicShell(source) {
  let html = source;
  html = html.replace(/((?:href|src)=")\.\/assets\//g, `$1${PUBLIC_BASE}/assets/`);
  html = replaceOnce(html, /href="\.\/styles\.css"/, `href="${PUBLIC_BASE}/styles.css?v=${VERSION_STAMP}"`, 'stylesheet URL');
  // 追加样式表：新文件本批首次出现、无旧缓存，同样挂当前戳保持口径一致。
  html = replaceOnce(html, /href="\.\/styles-beta-addon\.css"/, `href="${PUBLIC_BASE}/styles-beta-addon.css?v=${VERSION_STAMP}"`, 'beta addon stylesheet URL');
  html = html.replace(/"\.\/vendor\//g, `"${PUBLIC_BASE}/vendor/`);
  // 加载页内联早期脚本里的 JS 字符串视频路径同样转绝对（否则触发残留相对路径检查）。
  html = html.replace(/'\.\/assets\/video\//g, `'${PUBLIC_BASE}/assets/video/`);
  html = html.replace(/(['"])\.\/src\/([^'"]+)\1/g,
    (_match, quote, resource) => `${quote}${PUBLIC_BASE}/src/${resource}?v=${VERSION_STAMP}${quote}`);

  if (html.includes('./assets/') || html.includes('./vendor/') || html.includes('./src/')) {
    throw new Error('Unconverted relative beta resource path remains in index.html');
  }
  if ((html.match(/<\/body>/g) || []).length !== 1) throw new Error('Expected exactly one closing body tag');
  // 版本切换已移入设置面板（设置 → 版本），不再注入右下角浮动脚本
  // （旧的 /marmot3d-beta/version-switch.js 在发布目录本就不存在，是 404 死链）。
  return html;
}

if (require.main === module) {
  const sourcePath = path.join(ROOT, 'index.html');
  const outputPath = path.join(ROOT, 'index-public.html');
  const expected = generatePublicShell(fs.readFileSync(sourcePath, 'utf8'));
  if (process.argv.includes('--check')) {
    const actual = fs.readFileSync(outputPath, 'utf8');
    if (actual !== expected) {
      console.error(`${path.relative(ROOT, outputPath)} is stale; run node tools/public-shell.cjs`);
      process.exitCode = 1;
    } else {
      console.log(`Validated ${path.relative(ROOT, outputPath)} against index.html (${VERSION_STAMP})`);
    }
  } else {
    fs.writeFileSync(outputPath, expected);
    console.log(`Generated ${path.relative(ROOT, outputPath)} from index.html (${VERSION_STAMP})`);
  }
}

module.exports = { generatePublicShell, PUBLIC_BASE, VERSION_STAMP };
