const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  generatePublicShell, PUBLIC_BASE, VERSION_STAMP,
} = require('./public-shell.cjs');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const canonical = read('index.html');
const publicShell = read('index-public.html');
const loaderBlock = (html) => html.match(/<!-- ========== 加载[\s\S]*?(?=<!-- ========== 开发测试面板)/)?.[0] || '';
const stripLoaderBlock = (html) => html.replace(/<!-- ========== 加载[\s\S]*?(?=<!-- ========== 开发测试面板)/, '<!-- ========== 加载 ========== -->\n');

function ids(html) {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
}

async function main() {
  // The beta-only loader is intentionally allowed to diverge from the canonical
  // stable/dev shell; all other generated markup must stay synchronized.
  assert.equal(stripLoaderBlock(publicShell), stripLoaderBlock(generatePublicShell(canonical)), 'index-public.html must match its generated canonical shell outside the beta loader');
  const loaderIds = new Set(['loaderVideo', 'loaderBytes', 'loaderPct']);
  assert.deepEqual([...ids(publicShell)].filter((id) => !loaderIds.has(id)).sort(), [...ids(canonical)].sort(), 'canonical and public shell DOM id sets must match outside beta loader additions');
  assert.match(loaderBlock(publicShell), /loader-video/);
  assert.match(loaderBlock(publicShell), /loader-title[^>]*>土拨鼠大作战 <em>BETA/);
  for (const id of [
    'scene', 'crosshair', 'hudTop', 'hpText', 'energyText', 'stressText', 'mission',
    'objective', 'sandboxStatus', 'touchControls', 'touchJoystick', 'touchLookZone',
    'touchStick', 'touchSafeInsets', 'touchLayoutEntry', 'versionTag',
  ]) {
    assert.ok(ids(canonical).has(id), `canonical shell should contain #${id}`);
  }
  assert.equal((publicShell.match(/class="vital"/g) || []).length, 3, 'public shell must retain all three top HUD meters');
  assert.match(publicShell, /data-touch-action="attack"[^>]*data-swipe-preview=/, 'attack swipe hint controls must be synchronized');
  assert.ok(publicShell.includes('<i class="attack-swipe-hint parry">← 迎击</i>'));
  assert.ok(publicShell.includes('<i class="attack-swipe-hint roll">翻滚 →</i>'));
  assert.ok(publicShell.includes('攻击只有<b>三种招式</b>'), 'help panel must use the current attack guide');
  assert.match(publicShell, /id="sandboxStatus"/, 'public shell must include the dedicated sandbox card');

  assert.doesNotMatch(publicShell, /(?:\?|&)v=rev5\b/, 'public shell must not use rev5 cache stamps');
  assert.match(publicShell, new RegExp(`${PUBLIC_BASE}/styles\\.css\\?v=${VERSION_STAMP}`));
  assert.match(publicShell, new RegExp(`${PUBLIC_BASE}/src/main\\.js\\?v=${VERSION_STAMP}`));
  const importMapMatch = publicShell.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(importMapMatch, 'public shell must include an import map');
  assert.deepEqual(JSON.parse(importMapMatch[1]).imports, {
    three: `${PUBLIC_BASE}/vendor/three.module.js`,
    'three/webgpu': `${PUBLIC_BASE}/vendor/three.webgpu.js`,
    'three/tsl': `${PUBLIC_BASE}/vendor/three.tsl.js`,
    'three/addons/': `${PUBLIC_BASE}/vendor/addons/`,
  }, 'all vendor and addons import-map targets must use absolute beta paths');
  for (const asset of ['favicon.ico', 'favicon-32.png', 'favicon-192.png']) {
    assert.ok(publicShell.includes(`${PUBLIC_BASE}/assets/${asset}`), `icon ${asset} must use an absolute beta path`);
  }
  assert.doesNotMatch(publicShell, /<script[^>]*version-switch\.js/, 'floating corner version-switch script must be removed (switching lives in settings)');
  assert.doesNotMatch(publicShell, /(?:href|src)="\.\//, 'public document must not retain relative URL attributes');

  const versionMode = await import(pathToFileURL(path.join(ROOT, 'src/core/version-mode.mjs')).href);
  assert.equal(versionMode.resolveVersion({ search: '?version=beta', pathname: '/marmot3d/' }), 'beta', 'version=beta query selects beta');
  assert.equal(versionMode.resolveVersion({ search: '', pathname: '/marmot3d-beta/' }), 'beta', 'direct beta directory selects beta');
  assert.equal(versionMode.resolveVersion({ search: '', pathname: '/marmot3d-beta' }), 'beta', 'beta path without trailing slash selects beta');
  assert.equal(versionMode.resolveVersion({ search: '?version=dev', pathname: '/marmot3d-beta/' }), 'beta', 'deployed beta pathname remains beta');
  assert.equal(versionMode.resolveVersion({ search: '', pathname: '/marmot3d/' }), 'stable', 'ordinary route remains stable');

  const progressModule = await import(pathToFileURL(path.join(ROOT, 'src/core/progress.mjs')).href);
  const levelCount = 12;
  const stableRecord = JSON.stringify({ maxUnlocked: 0, completedLevels: [0] });
  const storage = new Map([[progressModule.STABLE_PROGRESS_KEY, stableRecord]]);
  const mockStorage = {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, value); },
  };
  const betaFromEmpty = progressModule.readProgress({
    getItem: () => null,
  }, levelCount, true);
  assert.equal(betaFromEmpty.maxUnlocked, levelCount - 1, 'beta empty progress unlocks every level');
  assert.equal(progressModule.isLevelUnlocked(betaFromEmpty, levelCount - 1), true, 'beta can select the final level');
  assert.deepEqual([...betaFromEmpty.completedLevels], [], 'all unlocked does not fabricate completed levels');
  const betaFromStableFirstLevel = progressModule.readProgress(mockStorage, levelCount, true);
  assert.equal(betaFromStableFirstLevel.maxUnlocked, levelCount - 1, 'beta unlocks all even when shared stable progress has only level 1');
  assert.deepEqual([...betaFromStableFirstLevel.completedLevels], [], 'stable completions do not bleed into beta');
  const stableEmpty = progressModule.readProgress({ getItem: () => null }, levelCount, false);
  assert.equal(stableEmpty.maxUnlocked, 0, 'stable empty progress unlocks only level 1');
  assert.equal(progressModule.isLevelUnlocked(stableEmpty, 0), true, 'stable can select level 1');
  assert.equal(progressModule.isLevelUnlocked(stableEmpty, 1), false, 'stable cannot select level 2 from empty progress');
  const stableExisting = progressModule.readProgress(mockStorage, levelCount, false);
  assert.equal(stableExisting.maxUnlocked, 0, 'stable one-level progress remains sequential');
  assert.deepEqual([...stableExisting.completedLevels], [0], 'stable keeps its completed-level record');

  betaFromStableFirstLevel.completedLevels.add(2);
  progressModule.writeProgress(mockStorage, betaFromStableFirstLevel, true);
  assert.equal(storage.get(progressModule.STABLE_PROGRESS_KEY), stableRecord, 'beta writes must not mutate shared stable progress');
  assert.deepEqual(JSON.parse(storage.get(progressModule.BETA_PROGRESS_KEY)), {
    maxUnlocked: levelCount - 1,
    completedLevels: [2],
  }, 'beta progress is persisted separately and keeps only genuine completions');
  assert.equal(progressModule.progressStorageKey(false), progressModule.STABLE_PROGRESS_KEY);
  assert.equal(progressModule.progressStorageKey(true), progressModule.BETA_PROGRESS_KEY);

  const versionSource = read('src/core/version.js');
  const mainSource = read('src/main.js');
  assert.match(versionSource, /export const IS_BETA = VERSION === 'beta';/);
  assert.match(mainSource, /readProgress\(progressStorage, LEVELS\.length, IS_BETA\)/);
  assert.match(mainSource, /const locked = !isLevelUnlocked\(progress, i\)/);
  assert.match(mainSource, /writeProgress\(progressStorage, progress, IS_BETA\)/);
  assert.match(mainSource, /version-tag \$\{IS_DEV \? 'dev' : IS_BETA \? 'beta' : 'stable'\}/);

  console.log('beta entry shell, version detection, isolated full unlock, and stable progression: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
