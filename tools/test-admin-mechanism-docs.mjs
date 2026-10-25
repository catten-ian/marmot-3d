import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTuningEntries } from '../src/admin/tuning-schema.mjs';
import { buildMechanismDocs, MECHANISM_GUIDES, parameterEffect } from '../src/admin/mechanism-docs-data.mjs';

const entries = buildTuningEntries();
const docs = buildMechanismDocs(entries);

test('机制文档覆盖且只覆盖一次所有 schema 分组和参数', () => {
  const schemaGroups = new Set(entries.map((entry) => entry.group));
  const documentedGroups = MECHANISM_GUIDES.flatMap((guide) => guide.groups);
  assert.equal(new Set(documentedGroups).size, documentedGroups.length, '分组不能重复挂载');
  assert.deepEqual(new Set(documentedGroups), schemaGroups);
  const parameters = docs.flatMap((guide) => guide.parameters);
  assert.equal(parameters.length, entries.length);
  assert.equal(new Set(parameters.map((parameter) => parameter.id)).size, entries.length);
  for (const entry of entries) {
    const parameter = parameters.find((item) => item.id === entry.id);
    assert.ok(parameter, `缺少参数文档 ${entry.id}`);
    assert.equal(parameter.def, String(entry.viewDef ?? entry.def).replace(/^true$/, '开（true）').replace(/^false$/, '关（false）'));
    assert.equal(parameter.source, entry.source);
    assert.equal(parameter.file, entry.file);
    for (const key of ['range', 'up', 'down', 'link', 'risk']) assert.ok(parameter[key].length > 3, `${entry.id} 缺少 ${key}`);
  }
});

test('要求的机制均有中文说明、源码依据、联动和验证建议', () => {
  for (const id of ['fox', 'forage', 'burrow', 'player', 'view', 'audio', 'admin']) {
    const guide = docs.find((item) => item.id === id);
    assert.ok(guide, `缺少机制 ${id}`);
    assert.match(guide.overview, /[\u4e00-\u9fff]/);
    assert.match(guide.sources, /src\//);
    assert.ok(guide.workflow.length >= 2);
    assert.ok(guide.risks.length >= 1);
  }
  assert.match(docs.find((item) => item.id === 'fox').overview, /120°/);
  assert.match(docs.find((item) => item.id === 'forage').overview, /growth/);
  assert.match(docs.find((item) => item.id === 'burrow').overview, /0\.18/);
  assert.match(docs.find((item) => item.id === 'view').overview, /旧存档|marmot\.touch-layout/);
  assert.match(docs.find((item) => item.id === 'audio').overview, /master、SFX、BGM/);
});

test('环境草参数直接采用真实 schema 默认值并说明距离权重和慢再生', () => {
  const forage = docs.find((guide) => guide.id === 'forage');
  for (const id of ['beta.grazeCoreRadius', 'beta.grazeHaloRadius', 'beta.grazeRate', 'beta.grassRegrowPerSec', 'beta.grazeRegenPerSec']) {
    const parameter = forage.parameters.find((item) => item.id === id);
    assert.ok(parameter, `缺少 ${id}`);
    assert.equal(parameter.def, String(entries.find((entry) => entry.id === id).def));
  }
  assert.match(forage.overview, /核心圈.*线性衰减/);
  assert.match(forage.workflow.join(' '), /逐帧/);
});

test('特殊参数方向语义不退化为误导性的统一模板', () => {
  assert.match(parameterEffect(entries.find((entry) => entry.id === 'smart.weight.pounceBase')).up, /不是概率|效用评分/);
  assert.match(parameterEffect(entries.find((entry) => entry.id === 'wheel.lunge.cooldown')).up, /间隔更长/);
  assert.match(parameterEffect(entries.find((entry) => entry.id === 'beta.flowerInstant')).up, /开启/);
  assert.match(parameterEffect(entries.find((entry) => entry.id === 'foxAtk.normal.mode')).up, /straight/);
});
