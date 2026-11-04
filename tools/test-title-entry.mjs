import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const main = fs.readFileSync('src/main.js', 'utf8');
const css = fs.readFileSync('styles.css', 'utf8');

test('campaign start and level-select actions are first-screen DOM siblings', () => {
  const primary = main.indexOf('title-actions-primary');
  const sandbox = main.indexOf('id="sandboxEntryBtn"');
  const fox = main.indexOf('id="playAsFoxBtn"');
  assert.ok(primary >= 0 && primary < sandbox, 'campaign actions must precede sandbox entry');
  assert.ok(primary < fox, 'campaign actions must precede play-as-fox entry');
  const block = main.slice(primary, sandbox);
  assert.match(block, /id="startBtn"/);
  assert.match(block, /id="levelSelectBtn"/);
});

test('title actions remain visible while the long panel scrolls at mobile and desktop sizes', () => {
  assert.match(css, /\.title-actions-primary\s*\{[^}]*position:\s*sticky/);
  assert.match(css, /\.title-actions-primary\s*\{[^}]*z-index:\s*2/);
  assert.match(css, /@media\s*\(max-width:\s*420px\)[\s\S]*?\.title-actions\s*\{\s*flex-direction:\s*column/);
  assert.match(css, /\.panel\s*\{[\s\S]*?overflow-y:\s*auto/);
});
