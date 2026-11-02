const assert = require('node:assert/strict');
const test = require('node:test');

let mod;
test.before(async () => { mod = await import('../src/core/paf-leaderboard.mjs'); });

function storage(initial = null, { denyGet = false, denySet = false, denyRemove = false } = {}) {
  let value = initial;
  return {
    getItem() { if (denyGet) throw new Error('denied'); return value; },
    setItem(_key, next) { if (denySet) throw new Error('denied'); value = next; },
    removeItem() { if (denyRemove) throw new Error('denied'); value = null; },
    peek() { return value; },
  };
}

test('records sort by score, duration, timestamp and cap at ten', () => {
  const store = storage();
  const board = mod.createPafLeaderboard({ storage: store, now: () => new Date('2026-11-02T00:00:00.000Z') });
  for (let i = 0; i < 12; i++) board.record({ score: i, durationMs: 120000, timestamp: new Date(Date.UTC(2026, 0, i + 1)) });
  const rows = board.list();
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.map((row) => row.score), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
});

test('equal scores use deterministic timestamp tie-break and preserve clear fields', () => {
  const board = mod.createPafLeaderboard({ storage: storage() });
  board.record({ score: 4, durationMs: 120000, timestamp: '2026-11-02T00:00:02.000Z' });
  board.record({ score: 4, durationMs: 120000, timestamp: '2026-11-02T00:00:01.000Z' });
  assert.deepEqual(board.list().map((row) => [row.score, row.durationMs, row.timestamp]), [
    [4, 120000, '2026-11-02T00:00:01.000Z'],
    [4, 120000, '2026-11-02T00:00:02.000Z'],
  ]);
});

test('corrupt, denied and unavailable storage fail soft', () => {
  const corrupt = storage(JSON.stringify({ version: 999, records: [{ score: 999999 }] }));
  const board = mod.createPafLeaderboard({ storage: corrupt });
  assert.deepEqual(board.list(), []);
  assert.equal(board.record({ score: 2, timestamp: 'bad', durationMs: 120000 }).added, false);

  const denied = mod.createPafLeaderboard({ storage: storage(null, { denyGet: true, denySet: true, denyRemove: true }) });
  assert.deepEqual(denied.list(), []);
  assert.equal(denied.record({ score: 1, timestamp: '2026-11-02T00:00:00.000Z', durationMs: 120000 }).added, false);
  assert.equal(denied.reset(), false);

  const unavailable = mod.createPafLeaderboard({ storage: null });
  assert.deepEqual(unavailable.list(), []);
  assert.equal(unavailable.record({ score: 1, timestamp: '2026-11-02T00:00:00.000Z', durationMs: 120000 }).added, false);
});

test('reset removes only local records', () => {
  const store = storage();
  const board = mod.createPafLeaderboard({ storage: store });
  board.record({ score: 3, timestamp: '2026-11-02T00:00:00.000Z', durationMs: 120000 });
  assert.equal(board.list().length, 1);
  assert.equal(board.reset(), true);
  assert.deepEqual(board.list(), []);
});
