import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOX, PLAYER } from '../src/core/config.js';
import { estimatePlayerVelocity, straightWindAimYaw, stepFoxTurn } from '../src/core/fox-motion.js';

const dt = 1 / 120;
const reach = PLAYER.radius + FOX.collisionRadius.normal;
const angleError = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function runDash({ attack, playerSpeed = 0, old = false, drill = false }) {
  const a = old ? { ...attack, turnRate: 0, windLeadTime: 0 } : attack;
  let fox = { x: 0, z: 0, yaw: 0, turnVelocity: 0 };
  let player = { x: 0, z: 9.2 };
  let motion;
  let minDistance = Infinity;
  let dashStartYaw = null;
  const wind = 0.76 * a.windMul;
  for (let t = 0; t < wind + a.dashTime + dt / 2; t += dt) {
    player.x += playerSpeed * dt;
    motion = estimatePlayerVelocity(motion, player, dt);
    if (t < wind) {
      const target = straightWindAimYaw({ foxX: fox.x, foxZ: fox.z, player, motion,
        mode: a.mode, leadTime: a.windLeadTime });
      const turn = stepFoxTurn(fox.yaw, target, fox.turnVelocity, dt,
        FOX.handling.windTurnRate, FOX.handling.windTurnAccel);
      fox.yaw = turn.yaw; fox.turnVelocity = turn.turnVelocity;
    } else {
      if (dashStartYaw === null) dashStartYaw = fox.yaw;
      if (a.turnRate > 0 && !drill) {
        const target = Math.atan2(player.x - fox.x, player.z - fox.z);
        const turn = stepFoxTurn(fox.yaw, target, fox.turnVelocity, dt,
          Math.min(FOX.handling.maxTurnRate, a.turnRate), FOX.handling.turnAccel);
        fox.yaw = turn.yaw; fox.turnVelocity = turn.turnVelocity;
      }
      fox.x += Math.sin(fox.yaw) * FOX.dashSpeed * (a.dashSpeedMul || 1) * dt;
      fox.z += Math.cos(fox.yaw) * FOX.dashSpeed * (a.dashSpeedMul || 1) * dt;
    }
    minDistance = Math.min(minDistance, Math.hypot(player.x - fox.x, player.z - fox.z));
  }
  return { minDistance, finalDistance: Math.hypot(player.x - fox.x, player.z - fox.z), yaw: fox.yaw, dashStartYaw };
}

test('攻击数值契约与冲刺距离覆盖接触范围', () => {
  assert.deepEqual(FOX.attacks.normal, { mode: 'straight', windMul: 1.2, dashTime: 0.76, turnRate: 0.42, windLeadTime: 0.75, label: '直线冲刺' });
  assert.deepEqual(FOX.attacks.fast, { mode: 'straight', windMul: 0.85, dashTime: 0.68, turnRate: 0.16, windLeadTime: 0.35, label: '疾冲' });
  for (const key of ['normal', 'fast']) {
    const a = FOX.attacks[key];
    assert.ok(14.5 * a.dashTime * (a.dashSpeedMul || 1) >= FOX.windRange - (FOX.contact.default ?? 1.7));
  }
});

test('低通速度估计与直线蓄力预瞄保持纯函数契约', () => {
  let motion;
  for (let i = 0; i < 80; i++) motion = estimatePlayerVelocity(motion, { x: 0, z: 3 }, dt);
  assert.ok(Math.abs(motion.vx) < 1e-9 && Math.abs(motion.vz) < 1e-9);
  assert.ok(angleError(straightWindAimYaw({ foxX: 0, foxZ: 0, player: { x: 0, z: 3 }, motion, mode: 'straight', leadTime: 0 }), 0) < 1e-9);
  motion = undefined;
  let p = { x: 0, z: 3 };
  for (let i = 0; i < 55; i++) { p = { x: p.x + 4.8 * dt, z: p.z }; motion = estimatePlayerVelocity(motion, p, dt); }
  assert.ok(Math.abs(motion.vx - 4.8) < 0.15, `vx=${motion.vx}`);
  const yaw = straightWindAimYaw({ foxX: 0, foxZ: 0, player: p, motion, mode: 'straight', leadTime: 0.75 });
  assert.ok(yaw > Math.atan2(p.x, p.z), 'aim must lead positive-x motion');
});

test('120Hz 端到端纯仿真：站桩命中、横移修复、早躲可逃、drill 锁定', () => {
  const a = FOX.attacks.normal;
  const still = runDash({ attack: a });
  const moving = runDash({ attack: a, playerSpeed: -PLAYER.speed });
  const old = runDash({ attack: a, playerSpeed: -PLAYER.speed, old: true });
  const sprint = runDash({ attack: a, playerSpeed: -PLAYER.speed * 1.42 });
  const drill = runDash({ attack: a, playerSpeed: -PLAYER.speed, drill: true });
  assert.ok(still.minDistance <= reach, `still ${still.minDistance} > ${reach}`);
  assert.ok(moving.minDistance <= reach, `moving ${moving.minDistance} > ${reach}`);
  assert.ok(old.minDistance > reach, `old ${old.minDistance} <= ${reach}`);
  assert.ok(sprint.finalDistance > reach, `sprint ${sprint.finalDistance} <= ${reach}`);
  assert.ok(angleError(drill.yaw, drill.dashStartYaw) < 1e-9,
    `drill yaw changed from ${drill.dashStartYaw} to ${drill.yaw}`);
  console.log(JSON.stringify({ reach, still, moving, old, sprint, drill }));
});
