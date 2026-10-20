#!/usr/bin/env node
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.resolve(__dirname, '..');
const tests = ['tools/test-smart-fox.cjs', 'tools/test-verdant.cjs'];
let failed = 0;
for (const test of tests) {
  const r = spawnSync(process.execPath, [path.join(root, test)], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(`node-test-summary: ${tests.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
