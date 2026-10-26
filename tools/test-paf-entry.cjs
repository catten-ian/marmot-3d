/** PAF entry module integrity and ownership contract regression. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const paf = fs.readFileSync(path.join(root, 'src/play/play-as-fox.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

test('PAF reuses the shared TouchControls route and has no independent touch DOM', () => {
  assert.match(paf, /new PafInputRoute\(touchControls\)/);
  assert.match(paf, /pafRoute\.activate/);
  assert.match(paf, /pafRoute\.restore/);
  assert.doesNotMatch(paf, /id=\"pafTouch\"|pafStick|pafPounce|pafSprint|pafLook/);
  assert.match(paf, /data-touch-action=\"attack\"/);
  assert.match(paf, /data-touch-action=\"dodge\"/);
  assert.match(paf, /data-touch-action=\"jump\"/);
});

test('PAF hides marmot-only touch actions and overlapping utility buttons', () => {
  // 藏狐模式不得混显土拨鼠专属触控件（死按钮）：啃草/爆发/大招/暂停全部隐藏。
  for (const action of ['interact', 'burst', 'ultimate', 'pause']) {
    assert.match(paf, new RegExp(`body\\.play-as-fox \\[data-touch-action=\\"${action}\\"\\]`));
  }
  assert.match(paf, /data-touch-action="interact"[\s\S]*?display:none/);
  // 顶部帮助/全屏/设置按钮与「退出扮演」重叠，PAF 期间同步隐藏。
  for (const id of ['helpBtn', 'fsBtn', 'setBtn']) {
    assert.match(paf, new RegExp(`body\\.play-as-fox #${id}`));
  }
});

test('Beta entry hands off to the independent PAF update loop and exit callback returns to title', () => {
  assert.match(main, /pafBtn\) pafBtn\.onclick = enterPlayAsFox/);
  assert.match(main, /playAsFox = createPlayAsFox\([\s\S]*?onExit: \(\) => \{[\s\S]*?title\(\)/);
  assert.match(main, /if \(playAsFox\) \{[\s\S]*?playAsFox\.update\(dt\);[\s\S]*?return;/);
  assert.match(paf, /const api = \{ update, exit, get active\(\) \{ return running; \} \}/);
});
