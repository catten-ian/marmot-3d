const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const root = require('node:path').resolve(__dirname, '..');

test('dev cave profile shrinks mouths and trigger detects sloped entrance', async () => {
  global.location = { search: '?version=dev' };
  const u = await import('../src/world/underground.js');
  const base = { type: 'base', x: 0, z: 0 };
  const shelter = { type: 'shelter', x: 10, z: 0 };
  assert.deepEqual(u.undergroundProfile(base).openingRadius, 1.3);
  assert.deepEqual(u.undergroundProfile(base).slopeRadius, 2.4);
  assert.deepEqual(u.undergroundProfile(shelter).openingRadius, 0.75);
  assert.deepEqual(u.undergroundProfile(shelter).slopeRadius, 1.35);
  assert.equal(u.burrowTriggerAt(2.3, 0, [base]).def, base);
  assert.equal(u.burrowTriggerAt(2.5, 0, [base]), null);
});

test('dev-only feature gates preserve stable path', () => {
  const version = fs.readFileSync(`${root}/src/core/version.js`, 'utf8');
  const props = fs.readFileSync(`${root}/src/world/props.js`, 'utf8');
  assert.match(version, /scannedBurrows:\s*IS_DEV/);
  assert.match(version, /screamingMarmot:\s*IS_DEV/);
  assert.match(version, /sorrelFood:\s*IS_DEV/);
  assert.match(props, /if \(devBurrow\)/);
  assert.match(props, /else if \(isBase\)/);
  assert.match(props, /burrow-main-interior\.glb/);
  assert.match(props, /burrow-shelter-interior\.glb/);
  const stable = execFileSync(process.execPath, ['-e', `global.location={search:'?version=stable'}; import('./src/world/underground.js').then(m=>{const p=m.undergroundProfile({type:'base'}); if(p.openingRadius!==2.2||p.slopeRadius!==3.6) process.exit(1);})`], { cwd: root, encoding: 'utf8' });
  assert.equal(stable, '');
});
