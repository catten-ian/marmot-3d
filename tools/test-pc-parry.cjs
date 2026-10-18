const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const root = path.resolve(__dirname, '..');
  const keybinds = await import('../src/core/keybinds.js');
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  const parry = keybinds.ACTIONS.find((a) => a.id === 'parry');
  assert.deepEqual(parry, { id: 'parry', label: '迎击', type: 'combat' });
  const binds = new keybinds.Keybinds();
  assert.equal(binds.isAction('KeyB', 'parry'), true, 'compatible defaults bind B to parry');
  binds.setScheme('optimized');
  assert.equal(binds.isAction('KeyB', 'parry'), true, 'optimized defaults bind B to parry');
  assert.equal(keybinds.findConflicts(binds.map).size, 0, 'optimized defaults have no key conflict');

  assert.match(main, /function triggerParryGesture\(ctx = null\)/);
  assert.match(main, /const directPc = ctx\?\.source === 'pc'/);
  assert.match(main, /if \(binds\.isAction\(e\.code, 'parry'\)\) triggerParryGesture\(\{ source: 'pc'/);
  assert.match(main, /if \(e\.button === 1\) \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?triggerParryGesture\(\{ source: 'pc'/);
  assert.match(main, /if \(!controller\.grounded\) \{[\s\S]*?pendingAerialParry = true[\s\S]*?\} else \{[\s\S]*?strike\('stand', \{ fromParryGesture: true \}\)/);
  assert.match(html, /<kbd>中键<\/kbd> \/ <kbd>B<\/kbd> 迎击/);
  console.log('pc parry input contract ok');
})();
