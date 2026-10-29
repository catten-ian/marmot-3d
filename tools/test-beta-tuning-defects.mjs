import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTuningEntries } from '../src/admin/tuning-schema.mjs';
import { FOX } from '../src/core/config.js';
import { SMART_POUNCE_TUNE, stepSmartMotion } from '../src/entities/smart-fox-core.mjs';
import { stepStamina } from '../src/core/fox-motion.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entries = buildTuningEntries();
const byId = new Map(entries.map((entry) => [entry.id, entry]));

test('缺陷 1：程序化狐狸开关真实出现在基础组并保留默认契约', () => {
  const entry = byId.get('fox.useProcedural');
  assert.ok(entry, 'fox.useProcedural 必须从 buildTuningEntries() 返回');
  assert.equal(entry.kind, 'boolean');
  assert.equal(entry.def, FOX.useProcedural);
  assert.equal(entry.group, '狐狸 · 基础');
  assert.equal(entry.source, 'FOX.useProcedural');
});

test('缺陷 2：admin 与 lil-gui 均不再暴露无运行时消费者的 foxContact', () => {
  assert.deepEqual(entries.filter((entry) => entry.id.startsWith('foxContact.')).map((entry) => entry.id), []);
  const gui = fs.readFileSync(path.join(root, 'src/systems/sandbox-debug.js'), 'utf8');
  assert.doesNotMatch(gui, /addNumber\([^\n]*FOX\.contact/);
  assert.match(fs.readFileSync(path.join(root, 'src/main.js'), 'utf8'),
    /PLAYER\.radius \+ \(FOX\.collisionRadius\[f\.type\] \?\? FOX\.collisionRadius\.normal\)/,
    '实际命中仍必须按双方碰撞半径相加');
});

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((dirent) => {
    const file = path.join(dir, dirent.name);
    return dirent.isDirectory() ? sourceFiles(file) : [file];
  }).filter((file) => /\.(?:js|mjs)$/.test(file));
}

// 逐条登记的既有静态审计盲区。这里只表示自动扫描不能确认，不代表参数有效。
// 修复 foxContact.* 后不得把它们塞回来；fox.useProcedural 也不得借此掩盖缺项。
const TUNING_CONSUMER_ALLOWLIST = Object.freeze({
  'burrowAI.exitNearOverride': '基线遗留：未找到该叶子的运行时消费者。',
  'underground.base.warmLight': '基线遗留：暖光字段未找到运行时消费者。',
  'underground.shelter.warmLight': '基线遗留：暖光字段未找到运行时消费者。',
  'foxType.normal.mass': '基线遗留：击退读取 knockbackMul，mass 静态消费者未确认。',
  'foxType.pup.mass': '基线遗留：击退读取 knockbackMul，mass 静态消费者未确认。',
  'foxType.fast.mass': '基线遗留：击退读取 knockbackMul，mass 静态消费者未确认。',
  'foxType.heavy.mass': '基线遗留：击退读取 knockbackMul，mass 静态消费者未确认。',
  'foxType.boss.mass': '基线遗留：击退读取 knockbackMul，mass 静态消费者未确认。',
  'smart.packWindow': '1.2 秒字面量内嵌 createSmartPack.canCommit，自动路径扫描无法确认。',
  'smart.packSpacing': '0.35 秒字面量内嵌 createSmartPack.canCommit，自动路径扫描无法确认。',
  'smart.packSlotSpacing': '0.025 秒字面量内嵌 createSmartPack.canCommit，自动路径扫描无法确认。',
  'world.BURROWS.1.warmLight': '基线遗留：由 UNDERGROUND 展开的暖光字段未找到运行时消费者。',
  'world.BURROWS.2.warmLight': '基线遗留：由 UNDERGROUND 展开的暖光字段未找到运行时消费者。',
  'world.BURROWS.3.warmLight': '基线遗留：由 UNDERGROUND 展开的暖光字段未找到运行时消费者。',
  'world.BURROWS.4.warmLight': '基线遗留：由 UNDERGROUND 展开的暖光字段未找到运行时消费者。',
  'misc.companionFollowSpeed': '基线遗留：beta 伙伴跟随读取 BETA_TUNE.companionFollowSpeed。',
  'misc.companionCatchDist': '基线遗留：beta 跟随间距读取 BETA_TUNE.companionFollowGap。',
  'misc.socialRange': '基线遗留：未找到 SOCIAL_RANGE 的运行时消费者。',
});

function hasRuntimeConsumer(entry, runtimeFiles) {
  const expression = entry.source.split(' → ')[0].trim();
  const sourceText = fs.readFileSync(path.join(root, entry.file), 'utf8');
  // 默认参数/内嵌字面量：检查标注的函数和参数确实存在于其实现文件中。
  const documented = expression.match(/^([\w$]+)\(([\w$]+)/);
  if (documented) {
    return new RegExp(`\\b${documented[1]}\\s*\\(`).test(sourceText)
      && new RegExp(`\\b${documented[2]}\\b`).test(sourceText);
  }
  const parts = expression.startsWith('world.') ? expression.slice(6).split('.') : expression.split('.');
  if (!parts.every((part) => /^[A-Za-z0-9_$]+$/.test(part))) return false;
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const leaf = escape(parts.at(-1));
  const rx = new RegExp(`(?<![\\w$])${leaf}(?![\\w$])`);
  // 类型表的末级 boss/pup 等只是键，不能当成消费者；必须找到 FOX.<表> 的动态/静态读取。
  // 其他字段允许经别名或解构消费，因此检查叶字段；无法确认的仍进入显式 allowlist。
  const typedMap = parts.length === 3 && parts[0] === 'FOX'
    && /^(?:normal|smart|pup|fast|heavy|boss|default)$/.test(parts[2]);
  const container = typedMap
    ? new RegExp(`(?<![\\w$])FOX\\s*\\.\\s*${escape(parts[1])}(?![\\w$])`) : null;
  return runtimeFiles.some(({ file, text }) => {
    // 常量定义文件本身不算消费者；算法/运行时模块可以在声明文件内消费常量。
    if (entry.file === 'src/core/config.js' && file === path.join(root, entry.file)) return false;
    return container ? container.test(text) : rx.test(text);
  });
}

test('通用幽灵旋钮探测器：每个后台条目都有消费者或逐条说明的 allowlist 理由', () => {
  assert.equal(Object.hasOwn(TUNING_CONSUMER_ALLOWLIST, 'foxContact.default'), false);
  assert.equal(Object.keys(TUNING_CONSUMER_ALLOWLIST).some((id) => id.startsWith('foxContact.')), false);
  assert.equal(Object.hasOwn(TUNING_CONSUMER_ALLOWLIST, 'fox.useProcedural'), false);
  for (const [id, reason] of Object.entries(TUNING_CONSUMER_ALLOWLIST)) {
    assert.ok(byId.has(id), `allowlist 不能引用不存在条目：${id}`);
    assert.ok(typeof reason === 'string' && reason.trim().length >= 12, `allowlist 必须逐条给出理由：${id}`);
  }
  const runtimeFiles = sourceFiles(path.join(root, 'src'))
    .filter((file) => !file.includes(`${path.sep}admin${path.sep}`))
    .filter((file) => !file.endsWith(path.join('systems', 'sandbox-debug.js')))
    .map((file) => ({ file, text: fs.readFileSync(file, 'utf8') }));
  const unresolved = entries
    .filter((entry) => !hasRuntimeConsumer(entry, runtimeFiles) && !TUNING_CONSUMER_ALLOWLIST[entry.id])
    .map((entry) => `${entry.id} -> ${entry.file} / ${entry.source}`);
  assert.deepEqual(unresolved, [], `后台条目缺少运行时消费者：\n${unresolved.join('\n')}`);
});

test('缺陷 3：提交门不变，beta 预留等于 dash-only 真实消耗且 stable 扣费不变', async () => {
  const { smartPounceStaminaReserve, smartPounceStaminaDrainPerSec } = await import('../src/entities/smart-fox-core.mjs');
  assert.equal(typeof smartPounceStaminaReserve, 'function', '提交门须由可测的完整预留函数驱动');
  assert.equal(typeof smartPounceStaminaDrainPerSec, 'function', '体力扣费必须通过 beta-only 阶段策略');
  if (typeof smartPounceStaminaReserve !== 'function' || typeof smartPounceStaminaDrainPerSec !== 'function') return;
  const perSec = FOX.vitals.pounceStaminaPerSec;
  const dashOnly = SMART_POUNCE_TUNE.staminaCost + perSec * SMART_POUNCE_TUNE.dashDuration;
  assert.ok(Math.abs(smartPounceStaminaReserve(perSec) - dashOnly) < 1e-9);
  assert.ok(Math.abs(dashOnly - 36.92) < 1e-9, '默认完整动作预留与实耗应均为 36.92');
  for (const stage of ['dash', 'windup', 'strike']) {
    assert.equal(smartPounceStaminaDrainPerSec({ beta: false, committed: true, stage, pounceRate: perSec }), perSec);
  }
});

test('缺陷 3：恰好过 beta 提交门的体力可走完整 dash→windup→strike 且不锁死', async () => {
  const { smartPounceStaminaReserve, smartPounceStaminaDrainPerSec } = await import('../src/entities/smart-fox-core.mjs');
  assert.equal(typeof smartPounceStaminaReserve, 'function', '提交门须由可测的完整预留函数驱动');
  assert.equal(typeof smartPounceStaminaDrainPerSec, 'function', '体力扣费必须通过 beta-only 阶段策略');
  if (typeof smartPounceStaminaReserve !== 'function' || typeof smartPounceStaminaDrainPerSec !== 'function') return;
  const dt = 1 / 60;
  const perSec = FOX.vitals.pounceStaminaPerSec;
  let stamina = smartPounceStaminaReserve(perSec);
  const initialStamina = stamina;
  let locked = 0;
  let state = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, acceleration: 18, pounceCooldown: 0,
    pounceMinDistance: 3, pounceMaxDistance: 7, pounceSpeed: 10.6 };
  const seen = [];
  for (let frame = 0; frame < 120 && (frame === 0 || state.pounceCommitted); frame++) {
    if (frame > 0) {
      const stepped = stepStamina({ stamina, locked, hp: 10 }, dt, {
        maxStamina: 100, drainPerSec: smartPounceStaminaDrainPerSec({ beta: true, committed: state.pounceCommitted, stage: state.pounceStage, remaining: state.pounceStageTime, dt, pounceRate: perSec, stalkRate: 0 }),
        regenPerSec: 0, resting: false, staminaLockSeconds: 1.2,
      });
      stamina = stepped.stamina;
      locked = stepped.locked;
      assert.equal(locked, 0, `第 ${frame} 帧 (${state.pounceStage}) 不应体力锁死`);
    }
    state = stepSmartMotion(state, { x: 0, z: 5.5 }, dt, 'pounce', { commitAllowed: true });
    if (state.pounceStrikeStarted) stamina = Math.max(0, stamina - SMART_POUNCE_TUNE.staminaCost);
    if (seen.at(-1) !== state.pounceStage) seen.push(state.pounceStage);
  }
  assert.deepEqual(seen.slice(0, 4), ['dash', 'windup', 'strike', 'recover']);
  assert.equal(state.pounceStage, 'recover');
  assert.ok(stamina >= 0 && Number.isFinite(stamina));
  assert.ok(Math.abs(initialStamina - stamina - initialStamina) < 1e-9,
    '完整动作实际消耗必须与提交门预留完全一致');
});
