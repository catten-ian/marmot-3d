#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runScenario, runMatrix, SCENARIOS, MOVES } from '../src/headless/smartfox-combat-lab.mjs';

const args = process.argv.slice(2), cmd = args[0] || 'matrix';
const flags = new Set(['seed', 'dt', 'duration', 'foxes', 'marmots', 'scenario', 'movement', 'out', 'config']);
const values = new Map();
let out = null, result;
try {
  if (!['help', 'matrix', 'repro'].includes(cmd)) throw new TypeError(`unknown command: ${cmd}`);
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    if (!flag.startsWith('--') || !flags.has(flag.slice(2)) || args[i + 1] === undefined || args[i + 1].startsWith('--')) throw new TypeError(`invalid option: ${flag}`);
    values.set(flag.slice(2), args[i + 1]);
  }
  out = values.get('out') || null;
  if (cmd === 'help') {
    console.log(JSON.stringify({ commands: ['matrix', 'repro'], scenarios: SCENARIOS, movements: MOVES,
      options: '--seed N --dt S --duration S --foxes N --marmots N --scenario NAME --movement NAME --config FILE --out PATH',
      limits: 'one marmot; 1..64 foxes; dt 1/240..0.1; duration <=300; bounded actor-ticks',
      parryOpening: 'moving policies approach normally until a real parry and follow-up tap, then resume requested movement' }, null, 2));
    process.exit(0);
  }
  const config = values.has('config') ? JSON.parse(await readFile(values.get('config'), 'utf8')) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('--config must contain a JSON object');
  const get = (key, fallback) => values.get(key) ?? config[key] ?? fallback;
  const num = (key, fallback) => Number(get(key, fallback));
  const options = { seed:num('seed',20261031), dt:num('dt',1/60), duration:num('duration',20), foxes:num('foxes',1), marmots:1,
    scenario:get('scenario','faceoff-tap'), movement:get('movement','stationary'), tune:config.tune ?? config.overrides ?? {} };
  const started = performance.now();
  result = cmd === 'matrix' ? { command:cmd, config:options, cases:runMatrix(options) } : { command:cmd, ...runScenario(options) };
  result.wallMs = Number((performance.now() - started).toFixed(3));
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  try {
    result.commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding:'utf8', stdio:['ignore','pipe','ignore'] }).trim();
    result.dirty = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/headless/smartfox-combat-lab.mjs', 'src/entities/smart-fox-core.mjs', 'src/entities/smart-fox.js', 'src/core/beta-tuning.js', 'src/core/fox-motion.js', 'tools/smartfox-headless-lab.mjs'], { cwd, encoding:'utf8' }).trim().split('\n').filter(Boolean);
  } catch { result.commit = 'unavailable'; }
  const failed = cmd === 'matrix' ? result.cases.some((r) => r.status !== 'completed') : result.status !== 'completed';
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  result = { command:cmd, status:'failed', failure:error.message, code:'invalid_input' };
  process.exitCode = 2;
}
const text = JSON.stringify(result, null, 2);
if (out) await writeFile(out, text); else console.log(text);
