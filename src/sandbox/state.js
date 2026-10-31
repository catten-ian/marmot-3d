export const SANDBOX_LEVEL = {
  name: '自由测试场',
  brief: '自由测试 · 无关卡 / 无时间限制',
  count: 0,
  speed: 8.6,
  goal: Infinity,
  repels: Infinity,
  time: Infinity,
  wind: 0.72,
  reinforce: 5,
  friend: [26, 12],
  types: ['normal'],
  boss: false,
  fog: '#93a4a8',
  sky: ['#8fa8c4', '#c9d8dd'],
  grass: ['#93a978', '#718f65'],
  sun: '#fff3d4',
  sunIntensity: 1.9,
  ambient: 0.42,
};

export const SANDBOX_DUMMY_REGEN_DELAY = 1.5;
export const SANDBOX_DUMMY_REGEN_RATE = 2;

export function createSandboxState() {
  return {
    active: false,
    godMode: false,
    freezeTimer: true,
    difficulty: 'standard',
    speedMultiplier: 1,
    alertMultiplier: 1,
    dummy: null,
    dummyDefeatable: true,
    parryDrill: false,
    // dev 沙盒专属：低重力 / 飞行观察（稳定版面板不显示此项）
    lowGravity: false,
    fps: 0,
    lastCommand: '',
  };
}

export const SANDBOX_DIFFICULTIES = {
  calm: { label: '低压', speedMultiplier: 0.72, alertMultiplier: 1.35 },
  standard: { label: '标准', speedMultiplier: 1, alertMultiplier: 1 },
  intense: { label: '高压', speedMultiplier: 1.35, alertMultiplier: 0.72 },
};

/** Place at most one sandbox dummy, disposing the previous instance if needed. */
export function placeSandboxDummy({ state, createDummy, removeDummy }) {
  if (state.dummy) removeDummy?.(state.dummy);
  state.dummy = createDummy?.() || null;
  state.lastCommand = state.dummy ? '已放置练习木桩' : '未能放置练习木桩';
  return state.dummy;
}

export function removeSandboxDummy({ state, removeDummy }) {
  const dummy = state.dummy;
  if (dummy) removeDummy?.(dummy);
  state.dummy = null;
  state.lastCommand = '已移除练习木桩';
  return !!dummy;
}

/** Switch damageability without leaving an indestructible dummy at zero HP. */
export function setSandboxDummyDefeatable(dummy, defeatable) {
  if (!dummy?.isSandboxDummy) return false;
  dummy.dummyDefeatable = !!defeatable;
  if (!dummy.dummyDefeatable && dummy.hp <= 0) {
    dummy.hp = Math.min(dummy.maxHp || 1, 1);
    dummy.state = 'dummy';
    dummy.fleeing = false;
    if (dummy.mesh) dummy.mesh.visible = true;
  }
  dummy._updateHpBar?.();
  return true;
}

/** Delay indestructible-dummy recovery until 1.5 seconds after its last hit. */
export function stepSandboxDummyRecovery(dummy, dt) {
  if (!dummy?.isSandboxDummy) return dummy?.hp;
  const elapsed = Math.max(0, Number(dt) || 0);
  const delay = Math.max(0, Number(dummy.dummyNoHitTimer) || 0);
  const waiting = Math.min(delay, elapsed);
  dummy.dummyNoHitTimer = Math.max(0, delay - waiting);
  const recoveryTime = elapsed - waiting;
  if (dummy.dummyDefeatable || dummy.hp <= 0) return dummy.hp;
  if (recoveryTime > 0 && dummy.dummyNoHitTimer <= 0) {
    dummy.hp = Math.min(dummy.maxHp, dummy.hp + recoveryTime * SANDBOX_DUMMY_REGEN_RATE);
  }
  return dummy.hp;
}
