const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const labelsSource = read('src/core/version-labels.mjs')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ');
const versionSource = read('src/core/version.js')
  .replace("import { DEV_VERSION_LABEL, STABLE_VERSION_LABEL, versionBadgeLabel } from './version-labels.mjs';", labelsSource)
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ')
  .replace(/^export \{[^\n]+\};$/gm, '');

function loadVersion(search) {
  const context = vm.createContext({ URLSearchParams, location: { search }, console });
  vm.runInContext(`${versionSource}\nthis.api = { VERSION, VERSION_LABEL, IS_DEV, versionBadgeLabel, STABLE_VERSION_LABEL };`, context);
  return context.api;
}

const stableLabel = '正式版 · v1.0';
const footerSubtitle = '神经—体液调节 · 抽象玩法演示';
for (const search of ['', '?version=xxx', '?version=xxx/']) {
  const result = loadVersion(search);
  assert.equal(result.VERSION, 'stable', `${search || 'default'} routes to stable`);
  assert.equal(result.VERSION_LABEL, stableLabel, `${search || 'default'} uses the explicit stable label`);
  assert.notEqual(result.VERSION_LABEL, footerSubtitle, 'stable badge label stays distinct from the footer subtitle');
  assert.equal(result.versionBadgeLabel(result.VERSION), stableLabel, `${search || 'default'} maps to stable badge text`);
}
for (const search of ['?version=dev', '?version=dev/']) {
  const result = loadVersion(search);
  assert.equal(result.VERSION, 'dev', `${search} routes to dev`);
  assert.equal(result.VERSION_LABEL, 'DEV · A Verdant Trail 环境 + 旱獭生态', `${search} keeps the DEV identifier`);
  assert.equal(result.versionBadgeLabel(result.VERSION), result.VERSION_LABEL, `${search} maps to the DEV badge text`);
}

const mainSource = read('src/main.js');
assert.match(mainSource, /tag\.className = `version-tag \$\{IS_DEV \? 'dev' : 'stable'\}`/);
assert.match(mainSource, /: STABLE_VERSION_LABEL;/, 'stable badge uses the explicit stable label');
assert.match(mainSource, /version: VERSION_LABEL,/, 'analytics version fields use the normalized identifier');
assert.match(mainSource, /appVersion: VERSION_LABEL/, 'exported test logs use the normalized identifier');
assert.match(mainSource, /game, version: VERSION_LABEL,/, 'feedback snapshots use the normalized identifier');
const css = read('styles.css');
assert.match(css, /\.hidden\s*\{\s*display:\s*none;\s*\}/, 'global hidden utility removes layout space');
assert.match(css, /body\.touch-layout-editing #testModeBtn \{ display: inline-block;/, 'hidden utility does not break the intentional test-button editing override');
assert.match(mainSource, /tag && WANT_GS[\s\S]*?rendererStatus\.backend === 'webgpu' \? 'WebGPU'[\s\S]*?'WebGL2 兜底（非 WebGPU）'/, 'dev backend tag retains WebGPU/WebGL2 text');
assert.match(mainSource, /tag\.style\.color = rendererStatus\.backend === 'webgpu' \? '#9fe6a0' : '#ffb35a'/, 'dev backend tag retains backend-specific colors');
assert.match(mainSource, /tag\.title = rendererStatus\.gpuReason \|\| '高斯泼溅需要 WebGPURenderer'/, 'dev backend tag retains its diagnostic title');
const switchSource = read('version-switch.js');
assert.match(css, /\.version-tag\s*\{[\s\S]*?bottom:\s*20px[\s\S]*?left:\s*50%/);
assert.ok(switchSource.includes("const isDev = params.get('version')?.replace(/") && switchSource.includes(") === 'dev';"), 'switch recognizes dev/ as DEV');
assert.match(switchSource, /right:\s*'12px', bottom:\s*'10px'/);

console.log('version routing, stable/DEV badge labels, hidden utility, and switch placement: all assertions passed');
