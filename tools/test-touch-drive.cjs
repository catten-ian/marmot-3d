const assert = require('node:assert/strict');

(async () => {
  const { resolveTouchDrive, wrapAngle } = await import('../src/core/move-facing.mjs');
  const dt = 1 / 60;
  const turnRate = 2.7;
  const backpedalSpeed = 0.58;
  const angleDelta = (a, b) => wrapAngle(a - b);
  const drive = (x, y, extra = {}) => resolveTouchDrive({
    bodyYaw: 0,
    cameraYaw: 1.23,
    x,
    y,
    dt,
    turnRate,
    backpedalSpeed,
    ...extra,
  });

  const idle = drive(0, 0);
  assert.equal(idle.throttle, 0, 'idle throttle is zero');
  assert.equal(idle.direction, 0, 'idle direction is neutral');
  assert.equal(idle.turn, 0, 'idle turn is zero');
  assert.equal(idle.bodyYaw, 0, 'idle body yaw is unchanged');
  assert.equal(idle.cameraYaw, 1.23, 'idle camera yaw is unchanged');

  const dead = drive(0.1, -0.1);
  assert.equal(dead.throttle, 0, 'deadzone removes small movement');
  assert.equal(dead.turn, 0, 'deadzone removes small steering');
  assert.equal(dead.bodyYaw, 0, 'deadzone does not rotate body');

  const forward = drive(0, 0.8);
  assert.equal(forward.direction, 1, 'up is forward');
  assert.equal(forward.throttle, 0.8, 'forward throttle follows y');
  assert.equal(forward.speedScale, 1, 'forward uses full speed');
  assert.equal(forward.isBackpedal, false, 'forward is not backpedal');

  const back = drive(0, -0.8);
  assert.equal(back.direction, -1, 'down is backward');
  assert.equal(back.throttle, 0.8, 'backward throttle follows |y|');
  assert.equal(back.speedScale, backpedalSpeed, 'backward uses backpedal speed');
  assert.equal(back.isBackpedal, true, 'backward is backpedal');

  const left = drive(-1, 0);
  const right = drive(1, 0);
  assert.equal(left.throttle, 0, 'pure left has no throttle');
  assert.equal(right.throttle, 0, 'pure right has no throttle');
  assert.ok(left.turn > 0 && angleDelta(left.bodyYaw, 0) > 0, 'pure left turns left');
  assert.ok(right.turn < 0 && angleDelta(right.bodyYaw, 0) < 0, 'pure right turns right');
  assert.equal(left.direction, 0, 'pure left has no movement direction');
  assert.equal(right.direction, 0, 'pure right has no movement direction');

  const forwardLeft = drive(-0.7, 0.8);
  const forwardRight = drive(0.7, 0.8);
  assert.equal(forwardLeft.throttle, 0.8, 'forward-left speed comes from y');
  assert.equal(forwardRight.throttle, 0.8, 'forward-right speed comes from y');
  assert.ok(forwardLeft.turn > 0 && forwardRight.turn < 0,
    'forward diagonals keep normal left/right steering');

  const backLeft = drive(-0.7, -0.8);
  const backRight = drive(0.7, -0.8);
  assert.equal(backLeft.throttle, 0.8, 'back-left speed comes from y');
  assert.equal(backRight.throttle, 0.8, 'back-right speed comes from y');
  assert.ok(backLeft.turn < 0 && backRight.turn > 0,
    'backward steering reverses left/right');
  assert.equal(backLeft.speedScale, backpedalSpeed, 'back-left keeps backpedal speed');
  assert.equal(backRight.speedScale, backpedalSpeed, 'back-right keeps backpedal speed');

  let body = 0;
  let previous = body;
  let totalTurn = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    const result = resolveTouchDrive({ bodyYaw: body, cameraYaw: 1.23, x: -1, y: 0.75, dt, turnRate });
    assert.equal(result.throttle, 0.75, 'continuous steering keeps y throttle');
    assert.equal(result.cameraYaw, 1.23, 'continuous steering leaves camera yaw untouched');
    const step = angleDelta(result.bodyYaw, previous);
    assert.ok(step > 0, `forward-left keeps turning left frame=${frame}`);
    totalTurn += step;
    previous = body = result.bodyYaw;
  }
  assert.ok(totalTurn > 1.5, `continuous left steering accumulates turn, got ${totalTurn}`);

  body = 0;
  previous = body;
  for (let frame = 0; frame < 60; frame += 1) {
    const result = resolveTouchDrive({ bodyYaw: body, cameraYaw: 1.23, x: -1, y: -0.75, dt, turnRate });
    const step = angleDelta(result.bodyYaw, previous);
    assert.ok(step < 0, `back-left reverses turn direction frame=${frame}`);
    assert.equal('uTurn' in result, false, 'tank drive has no U-turn state');
    previous = body = result.bodyYaw;
  }

  console.log('touch-drive logic: all assertions passed');
})().catch((error) => { console.error(error); process.exit(1); });
