#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { runScenario, runMatrix, SCENARIOS, MOVES } from '../src/headless/smartfox-combat-lab.mjs';
const args = process.argv.slice(2); const cmd = args[0] || 'matrix';
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const num = (k, d) => Number(get(k, d));
const out = get('out', null);
const configPath = get('config', null);
let configOverride = {};
if (configPath) {
  try { configOverride = JSON.parse(await readFile(configPath, 'utf8')); }
  catch (error) { console.error(`invalid --config JSON: ${error.message}`); process.exit(2); }
}
const options = { seed: num('seed', configOverride.seed ?? 20261031), dt: num('dt', configOverride.dt ?? 1 / 60), duration: num('duration', configOverride.duration ?? 20), foxes: num('foxes', configOverride.foxes ?? 1), marmots: num('marmots', configOverride.marmots ?? 1), scenario: get('scenario', configOverride.scenario ?? 'faceoff-tap'), movement: get('movement', configOverride.movement ?? 'stationary'), tune: configOverride.tune || configOverride.overrides || {} };
if (cmd === 'help') { console.log(JSON.stringify({ commands: ['matrix', 'repro'], scenarios: SCENARIOS, movements: MOVES, options: '--seed N --dt S --duration S --foxes N --marmots N --scenario NAME --movement NAME --config FILE --out PATH' }, null, 2)); process.exit(0); }
const started = performance.now();
const result = cmd === 'matrix' ? { command: 'matrix', config: options, cases: runMatrix(options) } : { command: 'repro', config: options, ...runScenario(options) };
result.wallMs = Number((performance.now() - started).toFixed(3));
result.commit = process.env.GIT_COMMIT || 'working-tree';
const text = JSON.stringify(result, null, 2); if (out) await writeFile(out, text); else console.log(text);
const failed = cmd === 'matrix' ? result.cases.some((r) => r.status !== 'completed') : result.status !== 'completed';
process.exitCode = failed ? 1 : 0;
