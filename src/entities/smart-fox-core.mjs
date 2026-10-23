/** Deterministic, dependency-free smart fox decision, perception and motion primitives. */
export const SMART_INTENTS = ['observe', 'approach', 'feint', 'pounce', 'recover', 'abandon'];


export const SMART_PHASES = ['observe', 'approach', 'wind', 'pounce', 'recover'];
export const SMART_PHASE_MIN = { observe: 0.35, approach: 0.35, wind: 0.55, pounce: 0.72, recover: 1.15 };
export const SMART_POUNCE_COOLDOWN = 1.2;


export function sampleWalkableGround(samples, referenceY = null, layerTolerance = 0.28) {
  const values = (samples || []).filter(Number.isFinite);
  if (!values.length) return Number.isFinite(referenceY) ? referenceY : 0;
  let best = values;
  let bestCount = 0;
  let bestReferenceDistance = Infinity;
  for (const center of values) {
    const layer = values.filter((y) => Math.abs(y - center) <= layerTolerance);
    const sortedLayer = layer.slice().sort((a, b) => a - b);
    const mid = Math.floor(sortedLayer.length / 2);
    const median = sortedLayer.length % 2 ? sortedLayer[mid] : (sortedLayer[mid - 1] + sortedLayer[mid]) * 0.5;
    const refDistance = Number.isFinite(referenceY) ? Math.abs(median - referenceY) : 0;
    if (layer.length > bestCount || (layer.length === bestCount && refDistance < bestReferenceDistance)) {
      best = layer; bestCount = layer.length; bestReferenceDistance = refDistance;
    }
  }
  const sorted = best.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) * 0.5;
}

export function stepGroundY(currentY, targetY, dt, maxRate = 3.2) {
  if (!Number.isFinite(targetY)) return currentY;
  if (!Number.isFinite(currentY)) return targetY;
  const maxStep = Math.max(0, maxRate * Math.max(0, dt));
  return currentY + Math.max(-maxStep, Math.min(maxStep, targetY - currentY));
}

export function advanceDrillState(state = {}, input = {}, dt = 1 / 60) {
  const s = { phase: 'approach', phaseTime: 0, cooldown: 0, ...state };
  const step = Math.max(0, Number(dt) || 0);
  s.phaseTime += step;
  s.cooldown = Math.max(0, (s.cooldown || 0) - step);
  const minDwell = { approach: 0.25, wind: input.windDuration ?? 0.55, pounce: 0.35, recover: 1.2 }[s.phase] ?? 0.25;
  const canLeave = s.phaseTime >= minDwell;
  const enter = (phase) => { s.phase = phase; s.phaseTime = 0; };
  if (s.phase === 'approach') {
    if (canLeave && input.inRange && input.reachable !== false && s.cooldown <= 0) enter('wind');
  } else if (s.phase === 'wind') {
    if (input.reachable === false) { if (canLeave) enter('approach'); }
    else if (canLeave) enter('pounce');
  } else if (s.phase === 'pounce') {
    if (input.pounceFinished) { enter('recover'); s.cooldown = Math.max(s.cooldown, 1.2); }
  } else if (s.phase === 'recover') {
    if (canLeave && s.cooldown <= 0) enter('approach');
  }
  return s;
}

/**
 * Hysteretic single-fox attack state machine.  Distances/reachability are sampled
 * once per frame, but transitions are admitted only after the current phase's
 * minimum dwell time.  A committed pounce always completes, then enters recover
 * and a cooldown, so an edge-of-threshold target cannot retrigger the warning.
 */
export function advanceSmartState(state = {}, input = {}, dt = 1 / 60) {
  const s = { phase: 'observe', phaseTime: 0, cooldown: 0, pounceTime: 0, ...state };
  const step = Math.max(0, Number(dt) || 0);
  s.phaseTime += step;
  s.cooldown = Math.max(0, (s.cooldown || 0) - step);
  const minTime = SMART_PHASE_MIN[s.phase] ?? 0.35;
  const reachable = input.reachable !== false;
  const candidate = !!input.candidatePounce;
  const safe = !!input.safe;
  const canLeave = s.phaseTime >= minTime;
  const enter = (phase) => { s.phase = phase; s.phaseTime = 0; };

  if (s.phase === 'pounce' && !input.motionCommitted) {
    s.pounceTime = Math.max(0, (s.pounceTime || SMART_PHASE_MIN.pounce) - step);
    if (s.pounceTime <= 0) { enter('recover'); s.cooldown = Math.max(s.cooldown, SMART_POUNCE_COOLDOWN); }
  } else if (safe && s.phase !== 'recover') {
    enter('recover');
  } else if (s.phase === 'wind') {
    if (!reachable && canLeave) enter('approach');
    else if (reachable && canLeave) { enter('pounce'); s.pounceTime = SMART_PHASE_MIN.pounce; }
  } else if (s.phase === 'recover') {
    if (canLeave && s.cooldown <= 0) enter(candidate ? 'wind' : 'approach');
  } else if (s.phase === 'observe' || s.phase === 'approach') {
    if (candidate && reachable && s.cooldown <= 0 && canLeave) enter('wind');
    else if (!candidate && s.phase === 'observe' && canLeave) enter('approach');
    else if (candidate && !reachable && s.phase === 'observe' && canLeave) enter('approach');
  }
  s.intent = s.phase === 'wind' ? 'observe' : s.phase;
  s.warn = s.phase === 'wind';
  return s;
}

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

export function separationVector(position, neighbors = [], minDistance = 1.8, strength = 2.4) {
  let x = 0, z = 0;
  for (const n of neighbors || []) {
    const dx = position.x - n.x, dz = position.z - n.z;
    const d = Math.hypot(dx, dz);
    if (d <= 1e-5 || d >= minDistance) continue;
    const w = (minDistance - d) / minDistance;
    x += (dx / d) * w; z += (dz / d) * w;
  }
  const len = Math.hypot(x, z);
  if (!len) return { x: 0, z: 0 };
  const scale = Math.min(strength, len * strength);
  return { x: x / len * scale, z: z / len * scale };
}

export function isSegmentReachable(start, target, obstacles = [], clearance = 0.8) {
  const ax = start.x, az = start.z, bx = target.x, bz = target.z;
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  for (const o of obstacles || []) {
    const r = Math.max(0, Number(o.r) || 0) + clearance;
    const t = len2 > 1e-8 ? Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.z - az) * dz) / len2)) : 0;
    const px = ax + dx * t - o.x, pz = az + dz * t - o.z;
    if (px * px + pz * pz < r * r) return false;
  }
  return true;
}

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
    if (s.pounceTime <= 0) { s.pounceCommitted = false; s.pounceCooldown = Math.max(s.pounceCooldown || 0, SMART_POUNCE_COOLDOWN); s.intent = 'recover'; s.phase = 'recover'; s.phaseTime = 0; }
  }
  s.speed = nextSpeed;
  s.intent = intent;
  return s;
}
