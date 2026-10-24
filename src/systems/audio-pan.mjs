export const SAFE_RADIUS = 5.5;
export const URGENT_RADIUS = 11;
export const URGENT_PLAIN = 8;
export const CAUTION_RADIUS = 18;
export const ALARM_INTERVALS = Object.freeze({ caution: 2.6, urgent: 1.1 });

/** World +x is right; listener forward is (sin(yaw), cos(yaw)). */
export function stereoPanFromWorld(listenerYaw, sourceX, sourceZ, listenerX, listenerZ) {
  const dx = sourceX - listenerX, dz = sourceZ - listenerZ, length = Math.hypot(dx, dz);
  if (length < 1e-9) return 0;
  const rightX = Math.cos(listenerYaw), rightZ = -Math.sin(listenerYaw);
  return Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / length));
}

export function companionAlarmLevel({ rescued, saved, inBurrow, companion, foxes = [] }) {
  if (!rescued || saved || inBurrow || !companion) return { level: 'none', fox: null };
  const alive = foxes.filter((f) => f?.alive);
  if (alive.some((f) => Math.hypot(f.x - companion.x, f.z - companion.z) <= SAFE_RADIUS)) return { level: 'none', fox: null };
  const distances = alive.map((f) => ({ fox: f, d: Math.hypot(f.x - companion.playerX, f.z - companion.playerZ) }));
  const urgent = distances.filter(({ fox, d }) => d <= URGENT_PLAIN || (d <= URGENT_RADIUS && (fox.pounceCommitted || fox.state === 'wind' || fox.state === 'dash'))).sort((a, b) => a.d - b.d)[0];
  if (urgent) return { level: 'urgent', fox: urgent.fox };
  const caution = distances.filter(({ d }) => d <= CAUTION_RADIUS).sort((a, b) => a.d - b.d)[0];
  return caution ? { level: 'caution', fox: caution.fox } : { level: 'none', fox: null };
}

export function alarmSchedule(level, timer = 0, dt = 0, intervals = ALARM_INTERVALS) {
  if (level !== 'caution' && level !== 'urgent') return { play: false, timer: 0 };
  const next = Math.max(0, timer) + Math.max(0, dt), interval = intervals[level];
  return next >= interval ? { play: true, timer: 0 } : { play: false, timer: next };
}
