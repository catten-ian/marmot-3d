(async () => {
  const { utilityScores, updatePerception, stepSmartMotion, applyInterruption } = await import('../src/entities/smart-fox-core.mjs');
  let memory = { memory: 0, interruptions: 0, health: 1 };
  let perception = { suspicion: 0 };
  let motion = { x: 14, z: 0, vx: 0, vz: 0, yaw: Math.PI, maxTurnRate: 2.8, acceleration: 18, pounceCommitted: false };
  const trace = [];
  const tick = (label, input, intent) => {
    perception = updatePerception(perception, input, 0.25);
    const scores = utilityScores({ ...input, suspicion: perception.suspicion, memory: memory.memory, interruptions: memory.interruptions, health: memory.health });
    motion = stepSmartMotion(motion, { x: 0, z: 0 }, 0.25, intent || scores.topIntent);
    trace.push({ label, intent: intent || scores.topIntent, suspicion: +perception.suspicion.toFixed(3), memory: memory.memory, speed: +motion.speed.toFixed(2), committed: !!motion.pounceCommitted });
  };
  tick('observe', { distance: 14, viewDot: 0.2, guard: false }, 'observe');
  tick('approach', { distance: 9, viewDot: 0.9, guard: false }, 'approach');
  memory = applyInterruption(memory, 'parry');
  tick('feint-after-interruption', { distance: 7, viewDot: 0.9, guard: true }, 'feint');
  tick('committed-pounce', { distance: 5, viewDot: 1, guard: false }, 'pounce');
  tick('pounce-continues', { distance: 4, viewDot: -1, guard: false }, 'pounce');
  tick('recover-reposition', { distance: 11, viewDot: -1, guard: false }, 'recover');
  console.log(JSON.stringify({ trace, interruption: memory }, null, 2));
})();
