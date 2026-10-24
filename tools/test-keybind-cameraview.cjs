/** cameraView（切换视角）动作：定义 / 默认方案 / 冲突检测（node:test）。 */
const test = require('node:test');
const assert = require('node:assert/strict');

(async () => {
  const kb = await import('../src/core/keybinds.js');

  test('ACTIONS 含 cameraView 系统动作', () => {
    const a = kb.ACTIONS.find((x) => x.id === 'cameraView');
    assert.ok(a, 'cameraView action missing');
    assert.equal(a.type, 'system');
    assert.equal(a.label, '切换视角');
  });

  test('兼容/优化方案默认 KeyV，isAction 命中', () => {
    const binds = new kb.Keybinds();
    binds.scheme = 'compatible';
    assert.equal(binds.key('cameraView'), 'KeyV');
    assert.ok(binds.isAction('KeyV', 'cameraView'));
    binds.scheme = 'optimized';
    assert.equal(binds.key('cameraView'), 'KeyV');
    // describe() 自动列出新动作（设置面板重绑 UI 依赖它）
    assert.ok(binds.describe().some((r) => r.id === 'cameraView'));
  });

  test('findConflicts 能检测 cameraView 与其他动作的冲突', () => {
    const conflicts = kb.findConflicts({ pause: 'KeyP', cameraView: 'KeyP' });
    assert.ok(conflicts.has('KeyP'));
    assert.deepEqual([...conflicts.get('KeyP')].sort(), ['cameraView', 'pause']);
  });

  test('自定义改键后 isAction 跟随新键', () => {
    const binds = new kb.Keybinds();
    binds.setKey('cameraView', 'KeyC');
    assert.ok(binds.isAction('KeyC', 'cameraView'));
    assert.ok(!binds.isAction('KeyV', 'cameraView'));
    binds.resetCustom();
    assert.equal(binds.key('cameraView'), 'KeyV', '恢复默认后回到 KeyV');
  });
})();
