const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/systems/effects.js', 'utf8');
const helperStart = source.indexOf('const DAMAGE_TEXT_REFERENCE_FOV = 68;');
const helperEnd = source.indexOf('/**\n * 伤害数字：世界空间 billboard 文本。', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'damage text helpers not found');
const helperSource = source.slice(helperStart, helperEnd)
  .replace(/^export /gm, '')
  + '\nmodule.exports = { damageTextFovCompensation, damageTextCanvasSize };';
const sandbox = { module: { exports: {} }, exports: {}, Math, Number, String, Array };
vm.runInNewContext(helperSource, sandbox, { filename: 'effects.js helpers' });
const { damageTextFovCompensation, damageTextCanvasSize } = sandbox.module.exports;

const tp = damageTextFovCompensation(68);
const fp = damageTextFovCompensation(78);
const expectedFp = Math.tan(78 * Math.PI / 360) / Math.tan(68 * Math.PI / 360);
assert.ok(Math.abs(tp - 1) < 1e-12, `68deg reference should be 1, got ${tp}`);
assert.ok(fp > tp, `78deg should need a larger world scale, got ${fp}`);
assert.ok(Math.abs(fp - expectedFp) < 1e-12, `unexpected 68/78 FOV ratio: ${fp}`);
assert.ok(Math.abs(damageTextFovCompensation(68, 78) - 1 / fp) < 1e-12);

const short = damageTextCanvasSize('12');
const long = damageTextCanvasSize('12345678901234567890');
assert.equal(short.width, 256);
assert.equal(short.height, 128);
assert.equal(short.cssWidth, 128);
assert.equal(long.height, short.height);
assert.ok(long.cssWidth > short.cssWidth, 'long damage text must receive a wider canvas');
assert.equal(long.width, long.cssWidth * long.dpr);

const measured = damageTextCanvasSize('12', { measuredTextWidth: 160 });
assert.equal(measured.cssWidth, 192);
assert.equal(measured.width, 384);
console.log('damage text size helpers: all assertions passed');
