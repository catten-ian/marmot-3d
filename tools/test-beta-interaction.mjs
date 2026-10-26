import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  betaInteractionSkillState, interactionSemantics,
} from '../src/core/interaction-semantics.mjs';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

test('beta interact copy is grazing-only across action, HUD, help and touch labels', () => {
  const beta = interactionSemantics(true);
  for (const [key, value] of Object.entries(beta)) {
    assert.doesNotMatch(value, /救援|陪伴|companion|rescue/i, `${key} must not advertise companion interaction`);
  }
  assert.match(beta.actionLabel, /啃草/);
  assert.match(beta.help, /采花/);
  assert.match(beta.touchAria, /按住/);

  const stable = interactionSemantics(false);
  assert.equal(stable.actionLabel, '救援/陪伴');
  assert.equal(stable.help, '救援 / 陪伴');
});

test('beta keyboard skill status depends on forage, never rescue/companion state', () => {
  assert.deepEqual(betaInteractionSkillState(), {
    label: '啃草', state: 'ready', sub: '靠近草地或花按住',
  });
  assert.deepEqual(betaInteractionSkillState({
    available: true, held: true, kind: 'grass', rescued: false, saved: false,
  }), { label: '啃草', state: 'active', sub: '啃食中' });
  assert.deepEqual(betaInteractionSkillState({
    available: true, held: true, kind: 'flower', rescued: true, saved: true,
  }), { label: '啃草', state: 'active', sub: '采花中' });
});

test('main beta input exits before companion actions while automatic rescue remains', () => {
  assert.match(main, /function doInteract\(\) \{\s+\/\/ Beta[\s\S]*?if \(IS_BETA\) return;/,
    'beta key/touch interact cannot emit rescue or companion toasts');
  assert.match(main, /if \(IS_BETA && !game\.friend\.rescued && !game\.friend\.saved/,
    'the separate beta proximity-rescue path is preserved');
  assert.match(main, /if \(IS_BETA\) \{\s+if \(game\.gatherAvailable\) prompt[\s\S]*?else if \(forage\.index === -2\) prompt/,
    'contextual HUD prompt is sourced from gather/forage availability in beta');
  assert.match(main, /betaInteractionSkillState\(\{/, 'keyboard status uses centralized beta forage semantics');
  assert.match(hud, /this\.el\.socialStatus\.innerHTML = IS_BETA/, 'HUD status is beta gated');
});
