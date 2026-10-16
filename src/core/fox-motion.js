import { FOX } from './config.js';

export function foxRecoverySeconds(type, mode) {
  if (mode === 'leap') return FOX.recovery.leap;
  if (mode === 'combo') return FOX.recovery.combo;
  return type === 'fast' ? FOX.recovery.fast : FOX.recovery.normal;
}

/** Bounded angular acceleration; returns the new heading and angular velocity. */
export function stepFoxTurn(yaw, targetYaw, turnVelocity, dt, maxRate, acceleration) {
  let delta = targetYaw - yaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (dt <= 0 || Math.abs(delta) < 1e-7) return { yaw: yaw + delta, turnVelocity: 0 };
  const wanted = Math.sign(delta) * Math.min(maxRate, Math.abs(delta) / dt);
  const maxChange = acceleration * dt;
  const nextVelocity = turnVelocity + Math.max(-maxChange, Math.min(maxChange, wanted - turnVelocity));
  const step = Math.max(-Math.abs(delta), Math.min(Math.abs(delta), nextVelocity * dt));
  const reached = Math.sign(step) === Math.sign(delta) && Math.abs(step) >= Math.abs(delta) - 1e-7;
  return { yaw: yaw + step, turnVelocity: reached ? 0 : nextVelocity };
}

export function dashFrictionFactor(dt) {
  return Math.exp(-FOX.handling.brakeLerp * Math.max(0, dt));
}

export function beginFoxRecovery(vx, vz) {
  const speed = Math.hypot(vx, vz);
  const cap = FOX.handling.recoverySpeedMax;
  if (speed <= cap || speed < 1e-8) return { vx, vz };
  const scale = cap / speed;
  return { vx: vx * scale, vz: vz * scale };
}

export function stepFoxRecovery(timer, vx, vz, dt) {
  const drag = dashFrictionFactor(dt);
  const nextTimer = Math.max(0, timer - dt);
  const velocity = beginFoxRecovery(vx * drag, vz * drag);
  return {
    timer: nextTimer,
    state: nextTimer > 0 ? 'rest' : 'roam',
    vx: nextTimer > 0 ? velocity.vx : 0,
    vz: nextTimer > 0 ? velocity.vz : 0,
  };
}
