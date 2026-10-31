/**
 * 跑全部可在纯 Node 下执行的 tools/test-*.cjs / tools/test-*.js 逻辑测试。
 * 依赖 Chrome CDP / 本地服务器截图的浏览器测试在此环境不可用，
 * 列出为 SKIP 而不是失败（由外层浏览器流水线负责）。
 *
 * 用法：node tools/run-node-tests.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const toolsDir = __dirname;
const root = path.resolve(toolsDir, '..');
const files = fs.readdirSync(toolsDir)
  .filter((f) => /^test-.*\.(cjs|js)$/.test(f))
  .sort();

const isBrowserTest = (file) => {
  const src = fs.readFileSync(path.join(toolsDir, file), 'utf8');
  return /remote-debugging-port|chrome\.exe|msedge\.exe|findChrome/.test(src);
};

let pass = 0;
const failed = [];
const skipped = [];
for (const file of files) {
  if (isBrowserTest(file)) { skipped.push(file); console.log(`SKIP ${file} (browser/CDP)`); continue; }
  const r = spawnSync(process.execPath, [path.join(toolsDir, file)], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) { pass++; console.log(`PASS ${file}`); }
  else {
    failed.push(file);
    console.log(`FAIL ${file}\n${(r.stdout || '')}${(r.stderr || '')}`);
  }
}
const total = pass + failed.length;
if (failed.length) { console.log(`FAILURES: ${failed.length}, OK ${pass}/${total}`); process.exit(1); }
console.log(`\n${skipped.length} browser/CDP tests skipped (need Chrome): ${skipped.join(', ')}`);
console.log(`OK ${total}/${total}`);
