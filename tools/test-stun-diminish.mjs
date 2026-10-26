import test from 'node:test';
import assert from 'node:assert/strict';
import { BETA_TUNE, expireStunDiminution, stepStunDiminution } from '../src/core/beta-tuning.js';

const tune = {
  stunDiminishWindow: 3,
  stunDiminishFactor: 0.55,
  stunDiminishFloor: 0.15,
  stunDiminishResetSeconds: 4,
};

test('眩晕递减：连续命中时按层递减并触及下限', () => {
  let state = { level: 0, lastAppliedAt: -Infinity, lastEndedAt: -Infinity, currentStun: 0 };
  const durations = [];
  for (let i = 0; i < 6; i += 1) {
    const next = stepStunDiminution(1, state, { betaOn: true, now: i * 0.2, tune });
    durations.push(next.duration);
    state = { ...next, currentStun: next.duration };
  }
  assert.equal(durations[0], 1);
  assert.equal(durations[1], 0.55);
  assert.ok(Math.abs(durations[2] - 0.3025) < 1e-12);
  assert.ok(Math.abs(durations[3] - 0.166375) < 1e-12);
  assert.equal(durations[4], 0.15);
  assert.equal(durations[5], 0.15);
  assert.equal(stepStunDiminution(0.1, { ...state, currentStun: 0 }, { betaOn: true, now: 1.3, tune }).duration, 0.1);
  assert.ok(durations.every((v, i) => i === 0 || v <= durations[i - 1]));
});

test('模拟基础平A节奏：最大眩晕首击后，第二次递减令后续攻击间出现恢复窗口', () => {
  const interval = 0.58; // tap cooldown（未加速）
  const base = 0.66; // 基础眩晕 0.6 × 静止 tap posture 1.1
  const first = stepStunDiminution(base, {}, { betaOn: true, now: 0, tune });
  assert.equal(first.duration, base); // 首击不递减
  const second = stepStunDiminution(base, { ...first, currentStun: first.duration }, { betaOn: true, now: interval, tune });
  assert.ok(second.duration < interval, `第二击后 ${second.duration}s < 平A间隔 ${interval}s`);
  const endedAt = interval + second.duration;
  const thirdAt = interval * 2;
  const third = stepStunDiminution(base, { ...second, currentStun: 0, lastEndedAt: endedAt }, { betaOn: true, now: thirdAt, tune });
  assert.ok(thirdAt - endedAt > 0, '第三击前狐狸已脱离眩晕并拥有行动窗口');
  assert.equal(third.level, 2);
  assert.ok(third.duration < second.duration);
});

test('眩晕递减：窗口外下一次恢复原始时长，清零时间后层数归零', () => {
  const first = stepStunDiminution(1, {}, { betaOn: true, now: 0, tune });
  const within = stepStunDiminution(1, { ...first, currentStun: 0 }, { betaOn: true, now: 2.5, tune });
  assert.equal(within.duration, 0.55);
  const outside = stepStunDiminution(1, { ...within, currentStun: 0 }, { betaOn: true, now: 6, tune });
  assert.equal(outside.duration, 0.55);
  assert.equal(outside.level, 1); // >3s 不再叠层，但层数仍到4s才清零
  const reset = stepStunDiminution(1, { ...outside, currentStun: 0 }, { betaOn: true, now: 10.1, tune });
  assert.equal(reset.duration, 1);
  assert.equal(reset.level, 0);
  const expired = expireStunDiminution(within, 6.6, 4);
  assert.equal(expired.level, 0);
  assert.equal(expired.lastAppliedAt, -Infinity);
});

test('眩晕递减：stable/dev 旁路保持原始时长', () => {
  assert.deepEqual(stepStunDiminution(1.2, { level: 8, currentStun: 1 }, { betaOn: false, now: 1, tune }), {
    duration: 1.2, level: 0, lastAppliedAt: 1, lastEndedAt: -Infinity,
  });
  assert.equal(BETA_TUNE.stunDiminishWindow, 3);
  assert.equal(BETA_TUNE.stunDiminishFactor, 0.55);
  assert.equal(BETA_TUNE.stunDiminishFloor, 0.15);
  assert.equal(BETA_TUNE.stunDiminishResetSeconds, 4);
});

test('智能狐生成点仅 Beta 显式传 hp=4，stable/dev 不改普通默认血量', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /new SmartFox\(scene, x, z, 0, slot, \{ lureBias: 1\.15, \.\.\.\(IS_BETA \? \{ hp: 4 \} : \{\}\) \}\)/);
  const config = await (await import('node:fs/promises')).readFile(new URL('../src/core/config.js', import.meta.url), 'utf8');
  assert.match(config, /normal:\s*\{[^}]*hp:\s*6/s);
});
