import { SANDBOX_DIFFICULTIES } from './state.js';

export function applySandboxDifficulty(state, key) {
  const difficulty = SANDBOX_DIFFICULTIES[key] ? key : 'standard';
  Object.assign(state, {
    difficulty,
    speedMultiplier: SANDBOX_DIFFICULTIES[difficulty].speedMultiplier,
    alertMultiplier: SANDBOX_DIFFICULTIES[difficulty].alertMultiplier,
  });
  return SANDBOX_DIFFICULTIES[difficulty];
}

export function spawnSandboxFoxes({ count = 1, type, state, spawnFox }) {
  const n = Math.max(1, Math.min(20, Number(count) || 1));
  const picked = type || state.selectedType;
  for (let i = 0; i < n; i++) spawnFox(picked, i, state);
  state.lastCommand = n === 1 ? `已生成 1 只${picked}` : `已生成 ${n} 只${picked}`;
  return n;
}

export function clearSandboxFoxes({ state, clearFoxes }) {
  clearFoxes();
  state.lastCommand = '已清除全部狐狸';
}
