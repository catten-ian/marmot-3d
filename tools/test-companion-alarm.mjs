import test from 'node:test';
import assert from 'node:assert/strict';
import { ALARM_INTERVALS, alarmSchedule, companionAlarmLevel, stereoPanFromWorld } from '../src/systems/audio-pan.mjs';

const base = { rescued: true, saved: false, inBurrow: false, companion: { x: 30, z: 20, playerX: 0, playerZ: 0 }, foxes: [] };
const fox = (x, z, extra = {}) => ({ x, z, alive: true, type: 'normal', ...extra });

test('世界方位映射左右且前后居中并夹紧', () => {
  assert.ok(stereoPanFromWorld(0, 5, 0, 0, 0) > 0);
  assert.ok(stereoPanFromWorld(0, -5, 0, 0, 0) < 0);
  assert.ok(Math.abs(stereoPanFromWorld(0, 0, 5, 0, 0)) < 1e-9);
  assert.ok(Math.abs(stereoPanFromWorld(0, 0, -5, 0, 0)) < 1e-9);
  assert.equal(stereoPanFromWorld(0, 20, 0, 0, 0), 1);
  console.log('ASSERT stereo-pan-sign/front-back/clamp OK');
});

test('护送报警只在伙伴安全位且按两级距离/攻击态触发', () => {
  assert.equal(companionAlarmLevel({ ...base, rescued: false }).level, 'none');
  assert.equal(companionAlarmLevel({ ...base, saved: true }).level, 'none');
  assert.equal(companionAlarmLevel({ ...base, inBurrow: true }).level, 'none');
  assert.equal(companionAlarmLevel({ ...base, foxes: [fox(0, 19)] }).level, 'none');
  assert.equal(companionAlarmLevel({ ...base, foxes: [fox(0, 15)] }).level, 'caution');
  assert.equal(companionAlarmLevel({ ...base, foxes: [fox(0, 7)] }).level, 'urgent');
  assert.equal(companionAlarmLevel({ ...base, foxes: [fox(0, 10, { state: 'wind' })] }).level, 'urgent');
  assert.equal(companionAlarmLevel({ ...base, foxes: [fox(0, 10, { type: 'smart', pounceCommitted: true })] }).level, 'urgent');
  assert.equal(companionAlarmLevel({ ...base, foxes: [fox(29, 20), fox(0, 7)] }).level, 'none');
  console.log('ASSERT alarm-gates/radii/safe-position OK');
});

test('两级节奏分别节流，紧急间隔更短', () => {
  let r = alarmSchedule('caution', 0, ALARM_INTERVALS.caution - .1);
  assert.equal(r.play, false);
  r = alarmSchedule('caution', r.timer, .1); assert.equal(r.play, true); assert.equal(r.timer, 0);
  assert.equal(alarmSchedule('urgent', 0, ALARM_INTERVALS.urgent).play, true);
  assert.ok(ALARM_INTERVALS.urgent < ALARM_INTERVALS.caution);
  assert.deepEqual(alarmSchedule('none', 1, .1), { play: false, timer: 0 });
  console.log('ASSERT alarm-schedule/cadence/reset OK');
});
