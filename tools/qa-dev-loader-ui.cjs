/**
 * 加载器 UI 验收（脚本渲染，不连 CDP）。
 *
 * 用真实 index.html 的 loader DOM + 真实 styles.css + 真实 src/ui/hud.js，
 * 在 headless Chrome CLI 里渲染并截图，然后断言：
 *   1) 字节/速度/剩余确实显示在加载页上（不是只有百分比）；
 *   2) 右下角没有白色渐变块（8c5f678 的 position:relative 修复生效）。
 *
 * 第 2 项做 A/B：同一份 DOM/CSS，只把 .loader.cinematic .loader-track 的
 * position:relative 去掉重渲染，断言修复前后右下角亮像素差异显著，
 * 证明这条 CSS 确实是白块的成因、也确实是修复。
 *
 * 走 file:// + --allow-file-access-from-files：本机 Chrome 连 http://127.0.0.1
 * 会挂住，file:// 稳定；页面以仓库根为相对基准，引用的是真实源文件。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'outputs/m3d-20261027-dev-loader-restore/visual');
const CHROME = process.env.CHROME_BIN || 'google-chrome';

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---------------------------------------------------------------- PNG 解码
// 只为像素断言服务：Node 自带 zlib，不引第三方依赖。
// 支持 Chrome 截图常见的 8bit RGB/RGBA、非隔行。

const zlib = require('node:zlib');

function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG');
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`不支持的颜色类型 ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride); pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = value & 0xff;
    }
  }
  return { width, height, channels, data: out };
}

/** 统计「在 broken 里接近纯白、在 fixed 里不是」的像素——即修复所消除的白块。 */
function whiteBlockPixels(broken, fixed, { threshold = 200 } = {}) {
  const { width, height, channels, data: bd } = broken;
  const fd = fixed.data;
  const xs = [];
  const ys = [];
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const bWhite = bd[i] >= threshold && bd[i + 1] >= threshold && bd[i + 2] >= threshold;
      if (!bWhite) continue;
      const fWhite = fd[i] >= threshold && fd[i + 1] >= threshold && fd[i + 2] >= threshold;
      if (fWhite) continue;
      count++; xs.push(x); ys.push(y);
    }
  }
  if (!count) return { count: 0, bbox: null };
  return {
    count,
    bbox: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
  };
}



/** 从 index.html 抽 loader 容器，避免测试页与线上 DOM 漂移。 */
function extractLoaderMarkup() {
  const html = read('index.html');
  const start = html.indexOf('<div id="loader"');
  const end = html.indexOf('</div>\n<script>', start);
  if (start < 0 || end < 0) throw new Error('无法从 index.html 定位 loader 区块');
  const markup = html.slice(start, end + '</div>'.length);
  // dev 的 cinematic 模式是运行时加类；测试页必须显式加上，否则测的是经典加载器。
  return markup.replace('class="loader"', 'class="loader cinematic"');
}

function buildHarness({ cssHref, loaderMarkup }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>loader-ui-qa</title>
<link rel="stylesheet" href="${cssHref}">
<style>
html,body{margin:0;padding:0;background:#0c120f;height:100%;overflow:hidden}
/* 关闭 loaderFade 入场动画：截图若落在动画起点会拿到 opacity:0 的全黑帧，
   渲染结果不确定、像素断言不可信。 */
.loader.cinematic .loader-hud{animation:none !important;}
</style>
</head>
<body>
${loaderMarkup}
<script type="module">
import { HUD } from './src/ui/hud.js';
const hud = new HUD();
// 模拟一次真实下载中的进度回报：字节、总量、剩余、速度、来源。
hud.setLoading(62, '加载 Verdant 场景', {
  doneBytes: 268435456,
  totalBytes: 1073741824,
  remainingBytes: 805306368,
  speedBytesPerSecond: 12582912,
  sourceLabel: 'TOS',
});
</script>
</body></html>`;
}

function chrome(args, label) {
  const r = spawnSync(CHROME, args, { encoding: 'utf8', timeout: 90000 });
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0 && r.signal) throw new Error(`${label}: 被 ${r.signal} 终止`);
  return r;
}

const CHROME_BASE = [
  '--headless=old', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
  '--single-process', '--no-zygote', '--disable-crash-reporter', '--disable-breakpad',
  '--no-first-run', '--disable-background-networking', '--allow-file-access-from-files',
  '--hide-scrollbars',
];

function shoot(pagePath, outPath, width, height) {
  const r = chrome([...CHROME_BASE,
    `--user-data-dir=/tmp/qa-loader-${width}x${height}-${path.basename(outPath, '.png')}`,
    `--window-size=${width},${height}`,
    `--screenshot=${outPath}`,
    `file://${pagePath}`,
  ], 'screenshot');
  if (!fs.existsSync(outPath)) {
    throw new Error(`截图未生成 ${outPath}\n${r.stderr || ''}`);
  }
  return outPath;
}

function dumpDom(pagePath) {
  const r = chrome([...CHROME_BASE,
    `--user-data-dir=/tmp/qa-loader-dom-${path.basename(pagePath)}`,
    '--virtual-time-budget=3000', '--dump-dom',
    `file://${pagePath}`,
  ], 'dump-dom');
  return r.stdout || '';
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const loaderMarkup = extractLoaderMarkup();

  // 修复版 CSS：线上真实样式。
  fs.writeFileSync(path.join(OUT, 'fixed.css'), read('styles.css'));
  // 回归版 CSS：仅移除 8c5f678 加的 position:relative，用于 A/B 证明该修复是必要的。
  const broken = read('styles.css').replace(
    /(\.loader\.cinematic \.loader-track\s*\{[^}]*?)\bposition:\s*relative;/,
    '$1',
  );
  if (broken === read('styles.css')) throw new Error('未能构造回归版 CSS（A/B 对照失效）');
  fs.writeFileSync(path.join(OUT, 'broken.css'), broken);

  // 页面放在仓库根下，file:// 相对路径即可引用真实 styles.css 与 src/ui/hud.js。
  const pages = {};
  for (const [name, css] of [['fixed', 'fixed.css'], ['broken', 'broken.css']]) {
    const file = path.join(ROOT, `.qa-loader-${name}.html`);
    // harness 放在仓库根，CSS 在 outputs/.../visual/ 下，路径必须按真实位置写，
    // 否则样式表 404，两张截图都是无样式页，像素断言会假通过。
    fs.writeFileSync(file, buildHarness({
      cssHref: `./outputs/m3d-20261027-dev-loader-restore/visual/${css}`,
      loaderMarkup,
    }));
    pages[name] = file;
  }

  const sizes = [[1440, 900], [390, 844]];
  const shots = [];
  try {
    for (const [w, h] of sizes) {
      for (const name of ['fixed', 'broken']) {
        const out = path.join(OUT, `${name}__${w}x${h}.png`);
        shoot(pages[name], out, w, h);
        shots.push(out);
      }
    }
    const dom = dumpDom(pages.fixed);
    const bytesMatch = dom.match(/id="loaderBytes"[^>]*>([^<]*)</);
    const bytesText = bytesMatch ? bytesMatch[1].trim() : '';
    fs.writeFileSync(path.join(OUT, 'dom-loaderBytes.txt'), bytesText + '\n');
    if (!bytesText) throw new Error('加载页没有渲染出字节信息');
    if (!/\/s/.test(bytesText)) throw new Error(`字节信息里没有速度：${bytesText}`);
    console.log('loader-bytes 文本:', JSON.stringify(bytesText));
  } finally {
    for (const file of Object.values(pages)) { try { fs.unlinkSync(file); } catch (_) {} }
  }

  // ---- 像素断言：修复必须真的消掉右下角白块 ----
  const pixelResults = [];
  for (const [w, h] of sizes) {
    const fixed = decodePng(fs.readFileSync(path.join(OUT, `fixed__${w}x${h}.png`)));
    const broken = decodePng(fs.readFileSync(path.join(OUT, `broken__${w}x${h}.png`)));
    const block = whiteBlockPixels(broken, fixed);
    const box = block.bbox;
    const blockHeight = box ? box.y1 - box.y0 + 1 : 0;
    pixelResults.push({ size: `${w}x${h}`, whiteBlockPixels: block.count, bbox: box, blockHeight });
    console.log(`  [${w}x${h}] broken 独有的近白像素 = ${block.count}` +
      (box ? `，包围盒高 ${blockHeight}px` : ''));
    if (w >= 1000) {
      // 桌面尺寸：白块必须被明确消除，且是一根竖直渐变条（不是零星噪点）。
      if (block.count < 100) {
        throw new Error(`白块像素过少（${block.count}），断言无法区分真修复与渲染差异`);
      }
      if (blockHeight < 40) {
        throw new Error(`白块高度只有 ${blockHeight}px，不像竖直渐变条，断言可能测错对象`);
      }
    }
  }

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    task: 'm3d-20261027-dev-loader-restore',
    method: 'headless chrome CLI (--headless=old --screenshot/--dump-dom) 脚本渲染，无 CDP',
    sizes, shots: shots.map((p) => path.relative(ROOT, p)),
    pixelResults,
  }, null, 2));
  console.log('截图:', shots.map((p) => path.relative(ROOT, p)).join(', '));
  console.log('OK: 加载页显示字节/速度');
}

main();
