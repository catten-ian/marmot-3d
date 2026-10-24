/** 版本标题 / 构建戳纯函数测试（node:test）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const ROOT = path.resolve(__dirname, '..');
  const mode = await import(path.join(ROOT, 'src/core/version-mode.mjs'));
  const version = await import(path.join(ROOT, 'src/core/version.js'));

  test('documentTitleFor：beta/dev 加后缀，stable 返回 null 保持静态标题', () => {
    assert.equal(mode.documentTitleFor('beta'), '土拨鼠大作战 3D · Beta');
    assert.equal(mode.documentTitleFor('dev'), '土拨鼠大作战 3D · Dev');
    assert.equal(mode.documentTitleFor('stable'), null);
    assert.equal(mode.documentTitleFor('unknown'), null);
  });

  test('BUILD_STAMP 存在且与 public shell 的 ?v= 戳一致（不允许私自升戳）', () => {
    assert.equal(typeof version.BUILD_STAMP, 'string');
    const shell = fs.readFileSync(path.join(ROOT, 'index-public.html'), 'utf8');
    const stamps = new Set([...shell.matchAll(/\?v=([a-z0-9]+)/gi)].map((m) => m[1]));
    assert.equal(stamps.size, 1, `public shell 应只有一个版本戳，实际：${[...stamps].join(',')}`);
    assert.ok(stamps.has(version.BUILD_STAMP), `BUILD_STAMP=${version.BUILD_STAMP} 应与 shell 戳一致`);
  });

  test('CHANNEL_SHORT 与 resolveVersion 判定一致', () => {
    // Node 环境无 location，version.js 兜底 stable
    assert.equal(version.VERSION, 'stable');
    assert.equal(version.CHANNEL_SHORT, 'Stable');
  });
})();
