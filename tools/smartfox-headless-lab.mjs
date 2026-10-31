#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { runScenario, runMatrix, SCENARIOS, MOVES } from '../src/headless/smartfox-combat-lab.mjs';
const args = process.argv.slice(2); const cmd = args[0] || 'matrix';
const get = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const num = (k, d) => Number(get(k, d));
const out = get('out', null); const options = { seed: num('seed', 20261031), dt: num('dt', 1 / 60), duration: num('duration', 20), foxes: num('foxes', 1), marmots: num('marmots', 1), scenario: get('scenario', 'faceoff-tap'), movement: get('movement', 'stationary') };
if (cmd === 'help') { console.log(JSON.stringify({ commands: ['matrix', 'repro'], scenarios: SCENARIOS, movements: MOVES, options: '--seed N --dt S --duration S --foxes N --marmots N --scenario NAME --movement NAME --out PATH' }, null, 2)); process.exit(0); }
const started = performance.now();
const result = cmd === 'matrix' ? { command: 'matrix', config: options, cases: runMatrix(options) } : { command: 'repro', config: options, ...runScenario(options) };
result.wallMs = Number((performance.now() - started).toFixed(3));
result.commit = '6ac0ebb';
const text = JSON.stringify(result, null, 2); if (out) await writeFile(out, text); else console.log(text);
const failed = cmd === 'matrix' ? result.cases.some((r) => r.status !== 'completed') : result.status !== 'completed';
process.exitCode = failed ? 1 : 0;
