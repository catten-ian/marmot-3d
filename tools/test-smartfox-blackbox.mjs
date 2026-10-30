import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SmartFoxBlackBoxRecorder, BLACKBOX_PRE_SECONDS, BLACKBOX_POST_SECONDS,
  detectNoProgressOscillation, detectRepeatedReorientation, detectWastedPounces, BLACKBOX_MAX_BYTES,
  replaySmartFoxPackage, compareReplayTraces, compareBlackBoxPackages, exportBlackBoxLocal,
} from '../src/sandbox/smartfox-blackbox.mjs';

function makeClock() { let t = 0; return { now: () => t, set: (v) => { t = v; } }; }

test('blackbox keeps a bounded 20s prebuffer and 5s post window with optional description', () => {
  const c = makeClock(); const r = new SmartFoxBlackBoxRecorder({ now: c.now, seed: 42, maxFrames: 100 });
  r.start({ build: { stamp: 'rev56' }, config: { difficulty: 'standard' }, initialSnapshot: { scene: 'sandbox' } });
  for (let i = 0; i <= 30; i++) { c.set(i); r.recordInput({ forward: i % 2 }, i); r.recordFox({ id: 'F1', x: i > 20 ? 0 : i * 0.01, z: 0, yaw: i % 2 ? .1 : -.1 }, i); }
  c.set(30); assert.equal(r.captureAnomaly().pending, true); c.set(35); const pkg = r.tick();
  assert.equal(pkg.description, ''); assert.equal(pkg.rngSeed, 42); assert.equal(pkg.window.preSeconds, BLACKBOX_PRE_SECONDS); assert.equal(pkg.window.postSeconds, BLACKBOX_POST_SECONDS);
  assert.ok(JSON.stringify(pkg).length <= BLACKBOX_MAX_BYTES);
  assert.ok(pkg.inputStream[0].t >= 10); assert.ok(pkg.inputStream.at(-1).t <= 35); assert.ok(pkg.inputStream.length <= 26);
  assert.equal(exportBlackBoxLocal(pkg, { download: false }).ok, false, 'node export is fail-soft and returns JSON');
});

test('three configurable anomaly detectors flag synthetic fixtures and mark no user evidence', () => {
  const pkg = {
    format: 'marmot3d-beta-smartfox-blackbox',
    foxTrajectories: Array.from({ length: 12 }, (_, i) => ({ t: i * .5, fox: { id: 'F1', x: 1, z: 1, yaw: i % 2 ? .5 : -.5 } })),
    aiDecisions: Array.from({ length: 5 }, (_, i) => ({ t: i, decision: { targetId: 'player', yaw: i % 2 ? 1 : -1 } })),
    eventLog: [{ t: 1, type: 'smart-pounce-commit', distance: 1.1, lockAngleError: .8 }, { t: 2, type: 'smart-pounce-commit', distance: 1.2, lockAngleError: .7 }],
  };
  assert.equal(detectNoProgressOscillation(pkg, { minSeconds: 2, oscillations: 2 }).length, 1);
  assert.equal(detectRepeatedReorientation(pkg, { minRepeats: 2, maxAngle: .1 }).length, 1);
  assert.equal(detectWastedPounces(pkg, { minAttempts: 2 }).length, 1);
});

test('same package replay produces repeatable trace and explicitly rejects unsupported scope', () => {
  const pkg = { format: 'marmot3d-beta-smartfox-blackbox', rngSeed: 7, initialScene: { x: 0 }, build: { stamp: 'rev56' }, effectiveConfig: {}, inputStream: [{ t: 0, input: { move: 1 } }, { t: .1, input: { move: 0 } }] };
  const run = () => replaySmartFoxPackage(pkg, { step: ({ input, rng }) => ({ input, sample: Number(rng().toFixed(6)) }) });
  assert.deepEqual(compareReplayTraces(run(), run()).identical, true);
  assert.throws(() => replaySmartFoxPackage(pkg, { supported: false, step: () => ({}) }), /only the Beta sandbox SmartFox/);
});

test('export failure is fail-soft and does not throw', () => { const old = globalThis.document; globalThis.document = { createElement() { throw new Error('disk full'); } }; assert.doesNotThrow(() => exportBlackBoxLocal({ caseId: 'x' })); globalThis.document = old; });

test('A/B comparison reports build and trace differences', () => { const a = { caseId: 'c', build: { stamp: 'a' }, analysis: { logicTrace: [{ t: 0, intent: 'observe' }], anomalies: [] }, eventLog: [] }; const b = { caseId: 'c', build: { stamp: 'b' }, analysis: { logicTrace: [{ t: 0, intent: 'pounce' }], anomalies: [{ detector: 'x' }] }, eventLog: [{ type: 'x' }] }; const out = compareBlackBoxPackages(a, b); assert.equal(out.sameCase, true); assert.equal(out.trace.identical, false); assert.equal(out.eventCountDelta, 1); });
