export const SANDBOX_TYPES = ['normal', 'fast', 'heavy', 'pup', 'boss'];

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
  types: SANDBOX_TYPES,
  boss: false,
  fog: '#93a4a8',
  sky: ['#8fa8c4', '#c9d8dd'],
  grass: ['#93a978', '#718f65'],
  sun: '#fff3d4',
  sunIntensity: 1.9,
  ambient: 0.42,
};

export function createSandboxState() {
  return {
    active: false,
    godMode: false,
    freezeTimer: true,
    selectedType: 'normal',
    difficulty: 'standard',
    speedMultiplier: 1,
    alertMultiplier: 1,
    fps: 0,
    lastCommand: '',
  };
}

export const SANDBOX_DIFFICULTIES = {
  calm: { label: '低压', speedMultiplier: 0.72, alertMultiplier: 1.35 },
  standard: { label: '标准', speedMultiplier: 1, alertMultiplier: 1 },
  intense: { label: '高压', speedMultiplier: 1.35, alertMultiplier: 0.72 },
};
