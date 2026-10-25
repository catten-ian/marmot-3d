/**
 * PAF 新模型契约测试：藏狐本体 + 土拨鼠猎物。
 * 覆盖：API 契约面、姿态混合差异与无 NaN、setColor、头可见性、
 * 土拨鼠 group 兼容（position/rotation/visible）与状态姿态差异。
 * 用法：node --test tools/test-paf-models.cjs
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let THREE, foxMod, moleMod;

async function loadWithVendorThree(rel) {
  const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace("import * as THREE from 'three';", 'const THREE = globalThis.__THREE;');
  return import(`data:text/javascript,${encodeURIComponent(src)}`);
}

test.before(async () => {
  THREE = await import('../vendor/three.module.js');
  globalThis.__THREE = THREE;
  foxMod = await loadWithVendorThree('src/entities/paf-fox-model.js');
  moleMod = await loadWithVendorThree('src/entities/paf-mole-model.js');
});

test('藏狐模型：API 契约面齐全', () => {
  const fox = foxMod.createPafFoxModel({});
  for (const k of ['group', 'root', 'body', 'head', 'muzzle', 'ears', 'legs', 'tail', 'setColor', 'setAnimState', 'update']) {
    assert.ok(fox[k], `缺少 ${k}`);
  }
  assert.equal(fox.root, fox.group);
  assert.equal(fox.ears.length, 2, '两只大三角耳');
  assert.equal(fox.legs.length, 4, '四条腿');
  assert.ok(fox.group instanceof THREE.Group);
  assert.ok(fox.head.position.z > 0 && fox.muzzle.position.z > 0, '头与吻朝前 (+Z)');
});

test('藏狐模型：setColor 改变毛色', () => {
  const fox = foxMod.createPafFoxModel({});
  let furMat = null;
  fox.group.traverse((o) => { if (!furMat && o.isMesh && o.material?.vertexColors) furMat = o.material; });
  assert.ok(furMat, '存在顶点色毛材质');
  const before = furMat.color.getHex();
  fox.setColor(0x88bbdd);
  assert.notEqual(furMat.color.getHex(), before);
});

test('藏狐模型：姿态混合在 idle/stalk/wind/lunge 下互不相同且无 NaN', () => {
  const poses = ['idle', 'stalk', 'wind', 'lunge', 'dash', 'recover']
    .map((a) => foxMod.computePafFoxPose({ anim: a, speed: 2 }));
  const keys = ['bodyY', 'bodyPitch', 'hipDrop', 'headPitch', 'legBend', 'tailLow', 'tailWag', 'gaitFreq', 'gaitAmp'];
  for (const p of poses) {
    for (const k of keys) assert.ok(Number.isFinite(p[k]), `${p.anim}.${k} 非有限数`);
  }
  // 两两不完全相同（至少一个关键参数不同）
  for (let i = 0; i < poses.length; i++) {
    for (let j = i + 1; j < poses.length; j++) {
      const diff = keys.some((k) => Math.abs(poses[i][k] - poses[j][k]) > 1e-9);
      assert.ok(diff, `${poses[i].anim} 与 ${poses[j].anim} 姿态完全相同`);
    }
  }
  // 蓄力：后躯明显下压（hipDrop 大）、头抬（headPitch 大）——提案 D1 语义
  const wind = foxMod.computePafFoxPose({ anim: 'wind' });
  const idle = foxMod.computePafFoxPose({ anim: 'idle' });
  assert.ok(wind.hipDrop > idle.hipDrop, '蓄力后躯下压');
  assert.ok(wind.headPitch > idle.headPitch, '蓄力头略抬');
});

test('藏狐模型：步频随速度上升、冲刺摆幅大于潜行', () => {
  const slow = foxMod.computePafFoxPose({ anim: 'stalk', speed: 1 });
  const fast = foxMod.computePafFoxPose({ anim: 'stalk', speed: 5 });
  assert.ok(fast.gaitFreq > slow.gaitFreq, '步频随速度上升');
  const dash = foxMod.computePafFoxPose({ anim: 'dash', speed: 6 });
  assert.ok(dash.gaitAmp > slow.gaitAmp, '冲刺摆幅大于潜行');
});

test('藏狐模型：update 多帧后腿部旋转有限且 idle≠dash', () => {
  const mk = () => foxMod.createPafFoxModel({});
  const run = (anim, speed) => {
    const fox = mk();
    fox.setAnimState({ anim, speed });
    for (let i = 0; i < 30; i++) fox.update(1 / 60);
    return fox.legs.map((l) => l.rotation.x);
  };
  const idle = run('idle', 0);
  const dash = run('dash', 6.4);
  for (const v of [...idle, ...dash]) assert.ok(Number.isFinite(v), '腿摆 NaN');
  assert.notDeepEqual(dash, idle, 'idle 与 dash 腿摆应不同');
});

test('藏狐模型：setHeadVisible 切换头部可见（FPV 防糊屏）', () => {
  const fox = foxMod.createPafFoxModel({});
  assert.ok(fox.head.visible);
  fox.setHeadVisible(false);
  assert.equal(fox.head.visible, false);
  fox.setHeadVisible(true);
  assert.equal(fox.head.visible, true);
});

test('藏狐模型：宽颊、毛领、四腿爪尖与白尾尖构成藏狐轮廓', () => {
  const fox = foxMod.createPafFoxModel({});
  assert.ok(fox.body.getObjectByName('neck-ruff'));
  assert.ok(fox.head.getObjectByName('cheek-ruff-1'));
  for (const leg of fox.legs) {
    const knee = leg.children.find((o) => o.name.endsWith('-knee'));
    assert.ok(knee?.children.some((o) => o.name.startsWith('claw-')), `${leg.name} 缺爪尖`);
  }
  const tip = fox.tail.userData.segs[2].getObjectByName('plume');
  assert.equal(tip.material, fox.head.getObjectByName('cheek-l').material, '尾尖与奶白颊毛同材质');
  fox.group.traverse((o) => {
    if (o.isMesh && o.material?.vertexColors) {
      assert.ok(o.geometry.getAttribute('color'), `${o.name} 顶点色材质缺颜色属性会渲染成黑块`);
    }
  });
});

test('土拨鼠模型：返回 THREE.Group 且兼容 Prey 用法', () => {
  const mole = moleMod.createPafMoleModel({ color: 0xb3925a });
  assert.ok(mole instanceof THREE.Group);
  mole.position.set(1, 2, 3);
  mole.rotation.y = 0.7;
  mole.visible = false;
  assert.deepEqual([mole.position.x, mole.position.y, mole.position.z], [1, 2, 3]);
  assert.ok(Math.abs(mole.rotation.y - 0.7) < 1e-9);
  assert.equal(mole.visible, false);
  mole.visible = true;
  assert.equal(typeof mole.setMoleState, 'function');
  assert.equal(typeof mole.updateAnim, 'function');
});

test('土拨鼠模型：wander/alert/flee 姿态可读差异且无 NaN', () => {
  const run = (state) => {
    const mole = moleMod.createPafMoleModel({});
    mole.setMoleState(state);
    for (let i = 0; i < 60; i++) mole.updateAnim(1 / 60, state === 'flee' ? 1 : 0.2);
    const body = mole.getObjectByName('body');
    assert.ok(body, '有 body 分组');
    assert.ok(Number.isFinite(body.rotation.x) && Number.isFinite(body.position.y), `${state} 姿态 NaN`);
    return { pitch: body.rotation.x, y: body.position.y };
  };
  const wander = run('wander'), alert = run('alert'), flee = run('flee');
  assert.ok(alert.pitch < wander.pitch - 0.2, '警觉时立起（后仰）');
  assert.ok(alert.y > wander.y, '警觉时身体抬高');
  assert.notEqual(flee.pitch, wander.pitch, '逃跑姿态与游荡不同');
});

test('土拨鼠模型：圆躯、钝吻、四趾掘土爪与门齿齐全，纯姿态有限', () => {
  const mole = moleMod.createPafMoleModel({});
  const body = mole.getObjectByName('body');
  assert.ok(body.getObjectByName('rump'));
  const head = body.getObjectByName('head');
  assert.ok(head.getObjectByName('incisor--1'));
  for (const side of [-1, 1]) {
    const paw = body.getObjectByName(`front-paw-${side}`);
    assert.equal(paw.children.filter((o) => o.name.startsWith('claw-')).length, 4);
  }
  for (const state of ['wander', 'alert', 'flee', 'invalid']) {
    const pose = moleMod.computePafMolePose(state, Number.NaN);
    for (const key of ['rearUp', 'pawLift', 'earPerk', 'headUp', 'speed', 'gaitFrequency']) {
      assert.ok(Number.isFinite(pose[key]), `${state}.${key}`);
    }
  }
});
