const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// --- version.js routing + normalized labels (labels kept for telemetry) ---
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
for (const search of ['', '?version=xxx', '?version=xxx/']) {
  const r = loadVersion(search);
  assert.equal(r.VERSION, 'stable', `${search || 'default'} routes to stable`);
  assert.equal(r.VERSION_LABEL, stableLabel, `${search || 'default'} keeps explicit telemetry label`);
}
for (const search of ['?version=dev', '?version=dev/']) {
  const r = loadVersion(search);
  assert.equal(r.VERSION, 'dev', `${search} routes to dev`);
  assert.equal(r.VERSION_LABEL, 'DEV · A Verdant Trail 环境 + 旱獭生态');
}

// --- visible badge: stable renders NONE; only dev keeps the on-screen tag ---
const mainSource = read('src/main.js');
assert.match(mainSource, /if \(IS_DEV\) \{\s*\n\s*if \(tag\) \{/, 'badge block is dev-gated');
assert.match(mainSource, /\} else if \(tag\) \{\s*\n\s*tag\.remove\(\);\s*\n\s*\}/, 'stable removes the badge element entirely');
assert.doesNotMatch(mainSource, /tag\.className = `version-tag \$\{IS_DEV \? 'dev' : 'stable'\}`/, 'old always-on stable badge is gone');
assert.match(mainSource, /version: VERSION_LABEL,/, 'analytics still records normalized version');
assert.match(mainSource, /appVersion: VERSION_LABEL/, 'test logs still record normalized version');

// --- floating corner switch is removed; switching lives in settings ---
const index = read('index.html');
assert.doesNotMatch(index, /version-switch\.js/, 'no floating version-switch script in index.html');

const settings = read('src/ui/settings.js');
assert.match(settings, /versionSwitchModel/, 'settings wires the in-panel version switch');
assert.match(settings, /_versionMarkup\(\)/, 'settings renders a version section');

// --- channel href model ---
const channelSource = read('src/core/version-switch.mjs')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function /gm, 'function ');
function loadChannels(version, pathname) {
  const context = vm.createContext({ location: { pathname, origin: 'https://www.catten.cyou' }, console });
  vm.runInContext(`${channelSource}\nthis.out = versionSwitchModel(${JSON.stringify(version)}, { pathname: ${JSON.stringify(pathname)}, origin: 'https://www.catten.cyou' });`, context);
  return context.out;
}
const fromStable = loadChannels('stable', '/marmot3d/');
const hrefs = Object.fromEntries(fromStable.options.map((o) => [o.id, o.href]));
assert.equal(hrefs.stable, 'https://www.catten.cyou/marmot3d/');
assert.equal(hrefs.beta, 'https://www.catten.cyou/marmot3d-beta/');
assert.equal(hrefs.dev, 'https://www.catten.cyou/marmot3d/?version=dev');
const fromBeta = loadChannels('beta', '/marmot3d-beta/');
assert.equal(fromBeta.options.find((o) => o.id === 'beta').current, true);
assert.equal(fromBeta.options.find((o) => o.id === 'beta').href, 'https://www.catten.cyou/marmot3d-beta/');

console.log('stable badge hidden, dev badge kept, in-settings version switch: all assertions passed');
