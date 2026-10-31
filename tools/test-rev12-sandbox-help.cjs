/** Rev12 regression checks for sandbox/test-panel containment and dynamic help copy. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const panelStart = main.indexOf('// 开发测试面板通过 ?test=1 显式启用');
const panelEnd = main.indexOf('const sandboxPanelUI = setupSandboxPanel', panelStart);
assert(panelStart >= 0 && panelEnd > panelStart, 'test panel wiring should be present');
const panel = main.slice(panelStart, panelEnd);

assert.match(panel, /function setTestPanelOpen\(open\)/, 'panel visibility should have one shared state helper');
assert.match(panel, /testModeBtn\.addEventListener\('pointerdown',[\s\S]*?stopPropagation\(\)/, 'toggle pointerdown must not reach outside dismissal');
assert.match(panel, /testModeBtn\.addEventListener\('click',[\s\S]*?stopPropagation\(\)/, 'toggle click must not immediately dismiss the panel');
assert.match(panel, /testPanel\.addEventListener\('pointerdown', stopTestPanelEvent\)/, 'panel pointer events must stay inside the panel');
assert.match(panel, /testPanel\.addEventListener\('click', stopTestPanelEvent\)/, 'panel clicks must stay inside the panel');
assert.match(panel, /document\.addEventListener\('pointerdown', closeTestPanelOutside\)/, 'touch/mouse outside pointerdown should dismiss');
assert.match(panel, /document\.addEventListener\('click', closeTestPanelOutside\)/, 'outside click should dismiss');
assert.match(panel, /testPanel\.contains\(event\.target\) \|\| testModeBtn\.contains\(event\.target\)/, 'outside dismissal must exempt both panel and toggle');
assert.match(panel, /setTestPanelOpen\(false\)/, 'close button and sandbox exit should use shared dismissal state');

const panelCss = css.slice(css.indexOf('.test-panel {'), css.indexOf('.test-panel header'));
assert.match(panelCss, /top:\s*max\(/, 'panel needs a top viewport bound');
assert.match(panelCss, /bottom:\s*max\(/, 'panel needs a bottom action-area bound');
assert.match(panelCss, /max-height:\s*calc\(100dvh\s*-\s*90px/, 'desktop panel height must account for both bounds');
assert.match(panelCss, /overflow:\s*auto/, 'panel contents must scroll internally');
assert.match(css, /top:\s*max\(8px, calc\(8px \+ var\(--safe-top, 0px\)\)\);/, 'mobile panel needs a top bound');
assert.match(css, /max-height:\s*calc\(100dvh\s*-\s*76px\s*-\s*var\(--safe-top, 0px\)\s*-\s*var\(--safe-bottom, 0px\)\)/, 'mobile panel must fit above the bottom action area');
const landscape = css.slice(css.indexOf('@media (orientation: landscape) and (max-height: 520px)'), css.indexOf('/* Keep the build badge'));
assert.match(landscape, /\.test-panel\s*\{[\s\S]*?top:\s*max\(8px/, 'short landscape panel needs a top bound');
assert.match(landscape, /\.test-panel\s*\{[\s\S]*?max-height:\s*calc\(100dvh\s*-\s*70px/, 'short landscape panel must fit above the action area');

const helpStart = main.indexOf('function syncHelpKeys()');
const helpEnd = main.indexOf('\nsyncHelpKeys();', helpStart);
assert(helpStart >= 0 && helpEnd > helpStart, 'dynamic help renderer should be present');
const help = main.slice(helpStart, helpEnd);
for (const id of ['forward', 'back', 'left', 'right', 'turnLeft', 'turnRight', 'attack', 'parry', 'dodge', 'jump', 'burst', 'ultimate', 'interact', 'sprint', 'pause', 'retry', 'restart', 'fullscreen']) {
  assert.match(help, new RegExp(`get\\('${id}'\\)|keys\\('${id}'\\)`), `help should derive ${id} from Keybinds`);
}
for (const phrase of ['touch-help', '鼠标左键', '鼠标右键', '中键', '向左滑迎击', '向右滑翻滚', '第一/第三人称视角切换', 'Enter', 'Esc', 'compatible', 'optimized', 'custom']) {
  assert.match(help, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `help should mention ${phrase}`);
}
assert.doesNotMatch(help, /if \(r\.empty\) return '鼠标左键'/, 'only the attack action may use the intentional mouse-left fallback');
assert.match(help, /const attackKeys = join\(\['鼠标左键', get\('attack'\)\]\)/, 'optimized attack must retain its intentional mouse-left label');
assert.match(help, /if \(includeAlt && r\.alt\) out\.push\(r\.alt\)/, 'help formatter must retain alternate bindings');
assert.match(help, /const value = parts\(id\)\.join\(' \/ '\);\s*return value \|\| emptyFallback;/, 'empty primary bindings must still render their alternate key');
assert.match(help, /方向键/, 'movement help must explicitly identify direction-key alternatives');
assert.match(help, /\$\{keys\('left'\)\} \/ \$\{keys\('right'\)\} 横移/, 'dev movement help must retain dynamic left/right strafe bindings');
assert.match(help, /\$\{keys\('turnLeft'\)\} \/ \$\{keys\('turnRight'\)\} 转向/, 'dev movement help must retain dynamic A/D turn bindings');
assert.match(main, /binds\.onChange\(syncHelpKeys\)/, 'help must refresh after rebinding');


console.log('test-rev12-sandbox-help: OK');
