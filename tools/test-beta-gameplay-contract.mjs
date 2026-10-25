import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BETA_TUNE } from '../src/core/beta-tuning.js';
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const main = read('src/main.js'), hud = read('src/ui/hud.js'), touch = read('src/ui/touch-layout.js');

test('released attack and successful jump interrupt forage; charging has no interrupt call', () => {
  assert.match(main, /function strike[\s\S]*?strikeGateOpen\(game\)[\s\S]*?interruptForageForAction\(\)/);
  assert.match(main, /function doJump[\s\S]*?controller\.jump\(\)[\s\S]*?interruptForageForAction\(\)/);
  assert.doesNotMatch(main, /attackCharge\.held[^\n]*interruptForageForAction/);
});

test('beta gather prompt uses the exact collection radius and distinct action state', () => {
  assert.match(main, /b\.kind === 'flower'[\s\S]*?BERRY_RADIUS \+ 0\.35/);
  assert.match(main, /game\.gatherAvailable[\s\S]*?'采集', 'gather', '可采集'/);
  assert.match(main, /touchInteract\.classList\.toggle\('is-gather'/);
  assert.match(hud, /this\.beta \? '啃草中'/);
});

test('beta movement is slightly reduced and joystick scale range is wider, guarded from stable/dev', () => {
  assert.ok(BETA_TUNE.moveSpeedMul < 1.12 && BETA_TUNE.moveSpeedMul > 1);
  assert.match(touch, /IS_BETA \? 0\.5 : 0\.7/);
  assert.match(touch, /IS_BETA \? 1\.8 : 1\.4/);
});
