import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxRecorder, RECORD_LIMIT_EVENTS, summarizeTake, renderSummaryText, downloadTake } from '../src/sandbox/recorder.js';

test('recorder produces a bounded readable combat ledger and preserves start metadata', () => {
  const r = new SandboxRecorder();
  r.start(10, { level: 1 });
  const fox = { type: 'normal', state: 'wind', hp: 6, x: 2, z: 3 };
  r.sampleFoxStates(10.1, [fox]);
  r.strike('stand', { running: false }, 10.2);
  r.foxHit({ fox: r.idFor(fox), foxType: 'normal', damage: 1.8, hpBefore: 6, hpAfter: 4.2, outcome: 'hit' }, 10.2);
  fox.state = 'flee'; fox.hp = 0;
  r.sampleFoxStates(10.5, [fox]);
  const take = r.stop(11, { reason: 'test' });
  assert.equal(take.meta.level, 1);
  assert.equal(take.summary.foxes[0].damage, 1.8);
  assert.equal(take.summary.strikes[0].move, 'stand');
  assert.match(renderSummaryText(take.summary), /命中 1 次/);
  assert.match(JSON.stringify(take), /flee/);
  assert.equal(downloadTake(take), false, 'node has no DOM and fails soft');
});

test('recorder drops oldest body events above cap and can restart cleanly', () => {
  const r = new SandboxRecorder({ maxEvents: 5 });
  r.start(0);
  for (let i = 0; i < 20; i++) r.push('strike', { move: 'tap', i }, i / 10);
  assert.equal(r.events.length, 5);
  assert.ok(r.events.length <= RECORD_LIMIT_EVENTS);
  assert.equal(r.events[0].type, 'rec-start');
  assert.equal(r.events.at(-1).i, 19);
  r.stop(3);
  r.start(4);
  assert.equal(r.events.length, 1);
  assert.equal(r.active, true);
  assert.equal(summarizeTake(r.events).counts['rec-start'], 1);
});
