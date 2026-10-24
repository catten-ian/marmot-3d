/** Pure heading helpers shared by dev wolf movement and its warning line. */
export function headingFromVelocity(vx, vz, fallbackYaw = 0) {
  const x = Number(vx), z = Number(vz);
  return Number.isFinite(x) && Number.isFinite(z) && Math.hypot(x, z) > 1e-6
    ? Math.atan2(x, z) : fallbackYaw;
}
export function directionFromYaw(yaw) { return { x: Math.sin(yaw), z: Math.cos(yaw) }; }
export function warningHeading({ velocityX = 0, velocityZ = 0, yaw = 0 } = {}) {
  return headingFromVelocity(velocityX, velocityZ, yaw);
}
