/** Deterministic, dependency-free smart fox decision, perception and motion primitives. */
export const SMART_INTENTS = ['observe', 'approach', 'feint', 'pounce', 'recover', 'abandon'];

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const wrapAngle = (a) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

export function utilityScores(input = {}) {
  const distance = Number.isFinite(input.distance) ? input.distance : 20;
  const d = clamp(1 - distance / 24);
  const facing = clamp((Number.isFinite(input.playerFacing) ? input.playerFacing : 0.5));
  const guard = clamp(input.guard ? 1 : 0);
  const fatigue = clamp(input.fatigue ?? 0);
  const health = clamp(input.health ?? 1);
  const interruptions = clamp((input.interruptions ?? 0) / 3);
  const memory = clamp((input.memory ?? 0) / 3);
  const suspicion = clamp(input.suspicion ?? 0);
  const scores = {
    observe: 0.26 + (1 - suspicion) * 0.24 + (1 - d) * 0.18,
    approach: 0.18 + d * 0.34 + suspicion * 0.22 + (1 - guard) * 0.08,
    feint: 0.12 + guard * 0.34 + memory * 0.28 + interruptions * 0.25,
    pounce: 0.08 + d * 0.44 + suspicion * 0.2 + (1 - guard) * 0.12
      - memory * 0.34 - interruptions * 0.28 - fatigue * 0.18,
    recover: 0.06 + fatigue * 0.58 + (1 - health) * 0.44 + interruptions * 0.08,
    abandon: 0.02 + (1 - health) * 0.62 + fatigue * 0.3 + (distance < 4 ? 0.04 : 0),
  };
  for (const key of SMART_INTENTS) scores[key] = Number(scores[key].toFixed(6));
  const topIntent = SMART_INTENTS.slice().sort((a, b) => scores[b] - scores[a])[0];
  return { scores, topIntent };
}

export function updatePerception(state, input = {}, dt = 1 / 60) {
  const next = { ...state };
  const distance = Number.isFinite(input.distance) ? input.distance : 99;
  const viewDot = Number.isFinite(input.viewDot) ? input.viewDot : -1;
  const inCone = distance <= (input.viewRange ?? 28) && viewDot >= Math.cos(Math.PI / 3);
  const postureFactor = input.guard ? 0.72 : (input.running ? 1.0 : 0.86);
  const distanceFactor = clamp(1 - distance / (input.viewRange ?? 28));
  const signal = inCone ? postureFactor * (0.35 + distanceFactor * 0.65) : 0;
  const rise = input.detectionRate ?? 1.8;
  const decay = input.decayRate ?? 0.48;
  next.suspicion = clamp((next.suspicion ?? 0) + (signal * rise - decay) * dt);
  next.lastSeen = inCone && signal > 0 ? (next.lastSeen ?? 0) + dt : next.lastSeen ?? 0;
  next.inCone = inCone;
  return next;
}

export function applyInterruption(memory, kind = 'parry') {
  const next = { ...memory };
  if (kind === 'damage') {
    next.health = clamp((next.health ?? 1) - 0.35);
    next.interruptions = (next.interruptions ?? 0) + 1;
    next.memory = clamp((next.memory ?? 0) + 1, 0, 3);
  } else {
    next.interruptions = (next.interruptions ?? 0) + 1;
    next.memory = clamp((next.memory ?? 0) + 1, 0, 3);
  }
  return next;
}

export function stepSmartMotion(state, target, dt = 1 / 60, intent = state.intent || 'observe') {
  const s = { ...state };
  const dx = target.x - s.x, dz = target.z - s.z;
  const distance = Math.hypot(dx, dz) || 1;
  const desired = Math.atan2(dx, dz);
  if (s.pounceCooldown > 0) s.pounceCooldown = Math.max(0, s.pounceCooldown - dt);
  if (intent === 'pounce' && !s.pounceCommitted && (s.pounceCooldown ?? 0) <= 0) {
    s.pounceCommitted = true;
    s.pounceTime = 0.72;
    s.pounceYaw = s.yaw;
  }
  const committed = s.pounceCommitted === true;
  const aim = committed ? s.pounceYaw : desired;
  const delta = wrapAngle(aim - s.yaw);
  const maxTurn = (s.maxTurnRate ?? 2.8) * dt;
  s.yaw += Math.max(-maxTurn, Math.min(maxTurn, delta));
  const speedTarget = committed ? 10.6 : intent === 'observe' ? 2.4 : intent === 'recover' ? 8.8 : 9.6;
  const accel = s.acceleration ?? 18;
  const speed = Math.hypot(s.vx ?? 0, s.vz ?? 0);
  const nextSpeed = speed + Math.max(-accel * dt, Math.min(accel * dt, speedTarget - speed));
  s.vx = Math.sin(s.yaw) * nextSpeed;
  s.vz = Math.cos(s.yaw) * nextSpeed;
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  if (committed) {
    s.pounceTime -= dt;
    if (s.pounceTime <= 0) { s.pounceCommitted = false; s.pounceCooldown = 0.8; s.intent = 'recover'; }
  }
  s.speed = nextSpeed;
  s.intent = intent;
  return s;
}
