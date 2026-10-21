/**
 * 动态键位提示回归：
 * - 兼容方案 burst/ultimate/interact 必须是 J/K/E；
 * - 优化方案必须是 Q/R/F（用户反馈的“F 键救援”而非 E）；
 * - bindText 支持空绑定回退；
 * - setHintBinds 后不传 binds 也能读到当前方案（HUD 用法）。
 * 纯 Node，ESM 经动态 import 载入。运行：node tools/test-key-hints.js
 */
const assert = require('node:assert/strict');

(async () => {
  const { Keybinds } = await import('../src/core/keybinds.js');
  const { bindText, schemeHints, setHintBinds } = await import('../src/core/key-hints.mjs');

  const compat = new Keybinds();
  compat.setScheme('compatible');
  assert.equal(bindText(compat, 'burst'), 'J', '兼容方案爆发键应为 J');
  assert.equal(bindText(compat, 'ultimate'), 'K', '兼容方案大招键应为 K');
  assert.equal(bindText(compat, 'interact'), 'E', '兼容方案交互键应为 E');

  const opt = new Keybinds();
  opt.setScheme('optimized');
  assert.equal(bindText(opt, 'burst'), 'Q', '优化方案爆发键应为 Q');
  assert.equal(bindText(opt, 'ultimate'), 'R', '优化方案大招键应为 R');
  assert.equal(bindText(opt, 'interact'), 'F', '优化方案救援键应为 F（不是 E）');

  // 空绑定（优化方案 attack 交给鼠标左键）回退到传入的 fallback。
  assert.equal(bindText(opt, 'attack', '左键'), '左键', '空绑定应回退 fallback');

  // 系统键
  assert.equal(bindText(opt, 'pause'), 'Esc', '优化方案暂停应为 Esc');
  assert.equal(bindText(compat, 'pause'), 'P', '兼容方案暂停应为 P');
  assert.equal(bindText(compat, 'retry'), 'T', '兼容方案重试应为 T');

  // schemeHints 两方案都应包含技能键。
  const hc = schemeHints(compat, { isDev: false });
  assert.ok(hc.burst && hc.ultimate && hc.interact, '兼容方案 hints 应包含技能键');
  const ho = schemeHints(opt, { isDev: true });
  assert.equal(ho.interact, 'F', 'dev 优化方案 hints 交互键为 F');
  assert.ok(ho.movement.includes('转向'), 'dev 优化方案移动说明应含转向');
  // 正式版（非 dev）优化方案 A/D 为 null，移动说明不应出现占位符 “—”。
  const hoStable = schemeHints(opt, { isDev: false });
  assert.ok(!hoStable.movement.includes('—'), '正式版优化方案移动说明不应有占位符');

  // 全局当前方案注册（HUD 在 binds 创建前实例化的场景）。
  setHintBinds(opt);
  assert.equal(bindText(null, 'interact'), 'F', '注册后不传 binds 也应读到优化方案 F');
  setHintBinds(compat);
  assert.equal(bindText(null, 'interact'), 'E', '切回兼容方案后应为 E');

  console.log('key-hints dynamic binding: all assertions passed');
})().catch((err) => { console.error(err); process.exitCode = 1; });
