/**
 * 智能狐战术层（阶段 3）纯函数测试。
 * 覆盖：flankSlots、assignFlankSlot、assignRoles、forcedRetreat。
 * 用法：node tools/test-fox-tactics.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

let flankSlots, assignFlankSlot, assignRoles, forcedRetreat;

test.before(async () => {
  ({ flankSlots, assignFlankSlot, assignRoles, forcedRetreat } = await import('../src/entities/smart-fox-core.mjs'));
});

const wrap = (a) => {
  let v = a;
  while (v > Math.PI) v -= Math.PI * 2;
  while (v < -Math.PI) v += Math.PI * 2;
  return v;
};

test('flankSlots：返回 count 个槽位', () => {
  for (const n of [1, 2, 3, 4]) {
    const slots = flankSlots(n, 0.7, { x: 10, z: -5 }, 6);
    assert.equal(slots.length, n);
    for (const s of slots) {
      assert.equal(typeof s.x, 'number');
      assert.equal(typeof s.z, 'number');
      assert.ok(Math.abs(Math.hypot(s.x - 10, s.z + 5) - 6) < 1e-9, '槽位在指定半径上');
    }
  }
  assert.deepEqual(flankSlots(0, 0, { x: 0, z: 0 }, 6), []);
});

test('flankSlots：槽位角度互不相同（不重叠）', () => {
  const slots = flankSlots(4, 1.1, { x: 0, z: 0 }, 6);
  const angles = slots.map((s) => s.angle);
  for (let i = 0; i < angles.length; i++)
    for (let j = i + 1; j < angles.length; j++)
      assert.ok(Math.abs(wrap(angles[i] - angles[j])) > 1e-6, `槽位 ${i}/${j} 角度重叠`);
});

test('flankSlots：槽位围绕逃跑轴分布（全部在后半球，不挤在正面）', () => {
  const axis = 0.9;
  const slots = flankSlots(3, axis, { x: 0, z: 0 }, 6);
  // 3 只 → 180°/120°/240° 相对逃跑轴
  const rel = slots.map((s) => Math.abs(wrap(s.angle - axis))).sort((a, b) => a - b);
  assert.ok(Math.abs(rel[0] - Math.PI * 2 / 3) < 1e-9);
  assert.ok(Math.abs(rel[1] - Math.PI * 2 / 3) < 1e-9);
  assert.ok(Math.abs(rel[2] - Math.PI) < 1e-9);
  for (const r of rel) assert.ok(r >= Math.PI / 2, '存在正面槽位');
  // 单只狐 → 正后方
  const solo = flankSlots(1, axis, { x: 0, z: 0 }, 6);
  assert.ok(Math.abs(Math.abs(wrap(solo[0].angle - axis)) - Math.PI) < 1e-9);
});

test('assignFlankSlot：不同 self 拿到不同槽位（不抢同一个）', () => {
  const player = { x: 0, z: 0 };
  const slots = flankSlots(3, 0, player, 6);
  const a = { x: slots[0].x + 0.1, z: slots[0].z, slot: 0, flankSlotIndex: null };
  const b = { x: slots[1].x + 0.1, z: slots[1].z, slot: 1, flankSlotIndex: null };
  const ia = assignFlankSlot(a, [a, b], slots);
  a.flankSlotIndex = ia;                       // a 先占位
  const ib = assignFlankSlot(b, [a, b], slots);
  assert.notEqual(ia, null);
  assert.notEqual(ib, null);
  assert.notEqual(ia, ib, '两只狐抢到了同一个槽位');
  // 粘性：a 已经在槽位 0 附近，再算仍应保住自己的槽位
  assert.equal(assignFlankSlot(a, [a, b], slots), ia);
});

test('assignFlankSlot：没有可用槽位时返回 null（不崩）', () => {
  const player = { x: 0, z: 0 };
  const slots = flankSlots(1, 0, player, 6);
  const other = { x: 1, z: 1, slot: 1, flankSlotIndex: 0 };   // 唯一槽位已被占
  const self = { x: -3, z: 0, slot: 0, flankSlotIndex: null };
  assert.equal(assignFlankSlot(self, [self, other], slots), null);
  assert.equal(assignFlankSlot(self, [self], []), null);
});

const mkFox = (slot, x, z, hp = 100, stamina = 100) => ({
  slot, x, z, hp, maxHp: 100, stamina, maxStamina: 100, state: 'roam', retreating: false,
});

test('assignRoles：只有一只 striker', () => {
  const player = { x: 0, z: 0 };
  const foxes = [mkFox(0, 3, 0), mkFox(1, 6, 2), mkFox(2, -6, -2)];
  const roles = assignRoles(foxes, player, {}, 10);
  const list = Object.values(roles).map((r) => r.role);
  assert.equal(list.filter((r) => r === 'striker').length, 1);
  assert.equal(roles[0].role, 'striker');   // 最近的一只主攻
  assert.ok(['flanker', 'distractor'].includes(roles[1].role));
  assert.ok(['flanker', 'distractor'].includes(roles[2].role));
});

test('assignRoles：有伤/撤退中的狐是 retreat', () => {
  const player = { x: 0, z: 0 };
  const foxes = [mkFox(0, 3, 0), mkFox(1, 4, 0, 20), mkFox(2, 5, 0)];
  foxes[2].retreating = true;
  const roles = assignRoles(foxes, player, {}, 10);
  assert.equal(roles[1].role, 'retreat');   // 残血
  assert.equal(roles[2].role, 'retreat');   // 撤退中
  assert.equal(roles[0].role, 'striker');
});

test('assignRoles：粘性 —— 同样输入两次结果相同，且 holdTime 内不换 striker', () => {
  const player = { x: 0, z: 0 };
  const foxes = [mkFox(0, 3, 0), mkFox(1, 6, 2), mkFox(2, -6, -2)];
  const r1 = assignRoles(foxes, player, {}, 10);
  const r2 = assignRoles(foxes, player, r1, 10.5);
  assert.deepEqual(r2, r1, '同样输入两次结果不同');
  // striker 稍微走远、另一只更近，但持有时间未到 → 不换
  foxes[0].x = 5.5; foxes[1].x = 3.2;
  const r3 = assignRoles(foxes, player, r1, 11.0, { holdTime: 1.5 });
  assert.equal(r3[0].role, 'striker', '粘性期内 striker 不应易主');
  // 超过 holdTime → 允许换
  const r4 = assignRoles(foxes, player, r1, 12.0, { holdTime: 1.5 });
  assert.equal(r4[1].role, 'striker');
});

test('assignRoles：单只狐直接是 striker；空数组不崩', () => {
  const roles = assignRoles([mkFox(7, 1, 1)], { x: 0, z: 0 }, {}, 0);
  assert.equal(roles[7].role, 'striker');
  assert.deepEqual(assignRoles([], { x: 0, z: 0 }, {}, 0), {});
});

test('forcedRetreat：刚被打 → true；没被打过 → false；旧事 → false', () => {
  assert.equal(forcedRetreat({ lastHitAt: 10 }, { now: 10, window: 0.05 }), true);
  assert.equal(forcedRetreat({ lastHitAt: 9.98 }, { now: 10, window: 0.05 }), true);
  assert.equal(forcedRetreat({}, { now: 10 }), false);                 // 没被打过
  assert.equal(forcedRetreat({ lastHitAt: -Infinity }, { now: 10 }), false);
  assert.equal(forcedRetreat({ lastHitAt: 5 }, { now: 10, window: 0.6 }), false); // 很久之前
});
