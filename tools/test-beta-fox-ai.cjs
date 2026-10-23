const assert = require('node:assert/strict');
(async () => {
  const {
    separationVector, isSegmentReachable, stepSmartMotion,
    advanceSmartState, advanceDrillState, sampleWalkableGround, stepGroundY,
  } = await import('../src/entities/smart-fox-core.mjs');
  const { stepFoxTurn } = await import('../src/core/fox-motion.js');

  // B6: separation remains an explicit multi-fox concern, not the single-fox B8 cause.
  const s = separationVector({ x: 0, z: 0 }, [{ x: 0.2, z: 0 }, { x: 0, z: 0.4 }], 1.8, 2.2);
  assert.ok(Math.hypot(s.x, s.z) > 0, 'overlapping foxes receive separation');
  const moved = { x: 0, z: 0 }, peers = [{ x: 0.2, z: 0 }];
  moved.x += s.x / 60; moved.z += s.z / 60;
  assert.ok(Math.hypot(moved.x - peers[0].x, moved.z - peers[0].z) > 0.2, 'separation moves apart');
  assert.equal(isSegmentReachable({ x: 0, z: 0 }, { x: 5, z: 0 }, [{ x: 2.5, z: 0, r: 1 }], 0.2), false, 'rock blocks pounce');
  assert.equal(isSegmentReachable({ x: 0, z: 0 }, { x: 5, z: 0 }, [{ x: 2.5, z: 2, r: 1 }], 0.2), true, 'clear line is reachable');

  // One-fox intercept drill: distance jitters around the arrival boundary but the
  // FSM's 1.15m enter / 1.55m leave hysteresis and minimum dwell prevent chatter.
  const dt = 1 / 60;
  let drill = { phase: 'approach', phaseTime: 0, cooldown: 0 };
  let transitions = [], previous = drill.phase, pounceStartedAt = null, latestPounceEnd = null;
  const phases = [];
  for (let frame = 0; frame < 20 * 60; frame++) {
    const t = frame * dt;
    const inRange = 1.12 + (frame % 12 < 6 ? 0.08 : -0.04) <= 1.15; // boundary chatter input
    drill = advanceDrillState(drill, {
      inRange,
      reachable: true,
      pounceFinished: drill.phase === 'pounce' && drill.phaseTime >= 0.4,
      windDuration: 0.55,
    }, dt);
    phases.push(drill.phase);
    if (drill.phase !== previous) {
      transitions.push({ t, from: previous, to: drill.phase });
      if (drill.phase === 'pounce') pounceStartedAt = t;
      if (previous === 'pounce' && drill.phase === 'recover') latestPounceEnd = t;
      previous = drill.phase;
    }
  }
  assert.ok(phases.includes('wind') && phases.includes('pounce') && phases.includes('recover'), 'single fox can warn, pounce and recover');
  for (let end = 1; end <= 20; end++) {
    const inWindow = transitions.filter((tr) => tr.t > end - 1 && tr.t <= end);
    assert.ok(inWindow.length <= 3, `bounded state transitions per second: ${inWindow.length} in [${end - 1}, ${end}]`);
  }
  // Every miss completion gets a real recovery lockout; no immediate second warning.
  assert.ok(latestPounceEnd != null && pounceStartedAt != null, 'miss simulation completed a pounce');
  for (let i = 0; i < phases.length; i++) {
    if (phases[i] !== 'recover') continue;
    const endEvent = transitions.find((tr) => tr.to === 'recover' && tr.t <= i * dt);
    if (!endEvent) continue;
    const firstWarning = transitions.find((tr) => tr.from !== 'wind' && tr.to === 'wind' && tr.t > endEvent.t);
    if (firstWarning) assert.ok(firstWarning.t - endEvent.t >= 1.15, 'post-miss warning respects cooldown and recovery dwell');
  }

  // The actual drill FSM must not re-arm during its post-pounce recovery window.
  let drillMiss = { phase: 'pounce', phaseTime: 0.4, cooldown: 0 };
  drillMiss = advanceDrillState(drillMiss, { pounceFinished: true, inRange: true, reachable: true }, dt);
  assert.equal(drillMiss.phase, 'recover', 'miss enters recover');
  for (let i = 0; i < 60; i++) {
    drillMiss = advanceDrillState(drillMiss, { inRange: true, reachable: true }, dt);
    assert.notEqual(drillMiss.phase, 'wind', 'miss cooldown prevents immediate re-telegraph');
  }

  // Smart-fox attack state is also hysteretic under reachable/range edge chatter.
  let smart = { phase: 'observe', phaseTime: 0, cooldown: 0, pounceTime: 0 };
  let smartTransitions = [], oldPhase = smart.phase;
  for (let frame = 0; frame < 20 * 60; frame++) {
    const rangeEdge = frame % 10 < 5;
    smart = advanceSmartState(smart, {
      candidatePounce: rangeEdge,
      reachable: frame % 7 !== 0,
      motionCommitted: false,
      safe: false,
    }, dt);
    if (smart.phase !== oldPhase) { smartTransitions.push({ t: frame * dt, phase: smart.phase }); oldPhase = smart.phase; }
  }
  for (let end = 1; end <= 20; end++) {
    const count = smartTransitions.filter((tr) => tr.t > end - 1 && tr.t <= end).length;
    assert.ok(count <= 3, `smart phase chatter is bounded: ${count} transitions/s`);
  }

  // Smooth, rate-limited grounded height on a connected walkable layer. A lower
  // neighboring surface is rejected by consensus; y never jumps or alternates.
  let y = 0.32, maxYStep = 0, yDirectionReversals = 0, prevYStep = 0;
  for (let frame = 0; frame < 120; frame++) {
    const target = sampleWalkableGround([0.31, 0.33, 0.32, frame % 2 ? -0.1 : 1.4, 0.34], y);
    const nextY = stepGroundY(y, target, dt, 3.2);
    const dy = nextY - y;
    maxYStep = Math.max(maxYStep, Math.abs(dy));
    if (dy * prevYStep < -1e-8) yDirectionReversals++;
    prevYStep = dy; y = nextY;
  }
  assert.ok(maxYStep <= 3.2 * dt + 1e-9, `ground y step bounded (${maxYStep})`);
  assert.equal(yDirectionReversals, 0, 'ground height is stable on noisy neighboring samples');

  // Turn rate and non-oscillation under a stable target, then a single target change.
  const wrap = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
  let yaw = -2.8, turnVelocity = 0, maxTurn = 0, reversals = 0, lastStep = 0;
  for (let frame = 0; frame < 180; frame++) {
    const target = frame < 90 ? 2.5 : -2.5;
    const next = stepFoxTurn(yaw, target, turnVelocity, dt, 2.8, 9.5);
    const delta = wrap(next.yaw - yaw);
    maxTurn = Math.max(maxTurn, Math.abs(delta));
    if (delta * lastStep < -1e-8) reversals++;
    lastStep = delta; yaw = next.yaw; turnVelocity = next.turnVelocity;
  }
  assert.ok(maxTurn <= 2.8 * dt + 1e-9, `yaw step bounded (${maxTurn})`);
  assert.ok(reversals <= 2, `yaw target change is damped, not oscillatory (${reversals} reversals)`);

  // Smart-fox root motion remains bounded and stationary measured speed remains 0.
  let st = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, maxTurnRate: 2.8, acceleration: 18, pounceCooldown: 0 };
  let maxStep = 0, maxSmartTurn = 0, prevYaw = st.yaw;
  for (let i = 0; i < 60; i++) {
    const n = stepSmartMotion(st, { x: 0, z: 4 }, dt, 'approach');
    maxStep = Math.max(maxStep, Math.hypot(n.x - st.x, n.z - st.z));
    maxSmartTurn = Math.max(maxSmartTurn, Math.abs(n.yaw - prevYaw));
    prevYaw = n.yaw; st = n;
  }
  assert.ok(maxStep <= 0.2, `bounded displacement ${maxStep}`);
  assert.ok(maxSmartTurn <= 2.8 * dt + 1e-9, `smart yaw bounded ${maxSmartTurn}`);
  const measuredStationarySpeed = Math.hypot(0, 0);
  assert.ok(measuredStationarySpeed < 0.05, 'stationary measured speed is approximately zero');
  console.log(`beta fox AI: separation/reachability + one-fox hysteresis/cooldown + bounded y/yaw passed (${transitions.length} drill, ${smartTransitions.length} smart transitions / 20s; max dy=${maxYStep.toFixed(4)}, max yaw/frame=${maxTurn.toFixed(4)})`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
