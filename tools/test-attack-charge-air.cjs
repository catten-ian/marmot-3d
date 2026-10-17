const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const {
    resolveAttackRelease, isWeakAerialPounce, advanceAttackCharge,
    interruptAttackCharge, resolvePendingAerialParry, AttackGesture,
    POUNCE_HOLD_MS, MAX_ATTACK_CHARGE_MS, AERIAL_POUNCE_DAMAGE_MUL,
  } = await import('../src/core/combat-wheel.mjs');

  assert.equal(POUNCE_HOLD_MS, 650);
  assert.equal(MAX_ATTACK_CHARGE_MS, 1500);
  assert.equal(resolveAttackRelease({ holdMs: 649, grounded: true }), 'tap', 'ground tap before 650ms is push');
  assert.equal(resolveAttackRelease({ holdMs: 650, grounded: true }), 'lunge', 'ground charge at threshold is pounce');
  assert.equal(resolveAttackRelease({ holdMs: 900, grounded: true }), 'lunge', 'long ground hold is pounce');
  assert.deepEqual(advanceAttackCharge(1490, 16), { holdMs: 1500, progress: 1, autoRelease: true }, '1500ms clamps and auto-releases');
  assert.equal(resolveAttackRelease({ holdMs: MAX_ATTACK_CHARGE_MS, grounded: true }), 'lunge', 'timeout resolves as pounce');
  assert.deepEqual(advanceAttackCharge(100, 50), { holdMs: 150, progress: 0.1, autoRelease: false });

  assert.ok(AERIAL_POUNCE_DAMAGE_MUL > 0 && AERIAL_POUNCE_DAMAGE_MUL < 1);
  assert.equal(AERIAL_POUNCE_DAMAGE_MUL, 0.55);
  assert.equal(resolveAttackRelease({ holdMs: 50, grounded: false }), 'lunge', 'air tap remains pounce');
  assert.equal(resolveAttackRelease({ holdMs: 700, grounded: false }), 'lunge', 'charged air release remains pounce');
  assert.equal(isWeakAerialPounce({ holdMs: 50, grounded: false }), true);
  assert.equal(isWeakAerialPounce({ holdMs: 650, grounded: false }), false, 'charged air pounce is not weakened');
  assert.equal(isWeakAerialPounce({ holdMs: 50, grounded: true }), false);

  assert.deepEqual(resolvePendingAerialParry(true, false), { pending: true, execute: false });
  assert.deepEqual(resolvePendingAerialParry(true, true), { pending: false, execute: true }, 'pending parry executes once on landing');
  assert.deepEqual(resolvePendingAerialParry(false, true), { pending: false, execute: false });

  const interrupted = interruptAttackCharge({ held: true, t: 0.8, pointerId: 9, via: 'touch', fired: null, interrupted: false, energy: 42 });
  assert.deepEqual(interrupted, { held: false, t: 0, pointerId: null, via: null, fired: null, interrupted: true, energy: 42 }, 'interrupt leaves energy untouched');
  assert.equal(resolveAttackRelease({ holdMs: 1000, interrupted: interrupted.interrupted }), null, 'hit interruption makes subsequent release a no-op');
  assert.equal(resolveAttackRelease({ holdMs: 1000, fired: 'parry' }), null);
  assert.equal(resolveAttackRelease({ holdMs: 1000, fired: 'roll' }), null);

  const parry = new AttackGesture(1, 0);
  assert.equal(parry.update(-30, 0, 30)?.kind, 'parry');
  assert.equal(parry.update(30, 0, 60), null, 'gesture latch prevents a second move');
  assert.equal(resolveAttackRelease({ holdMs: 900, fired: parry.fired }), null, 'gesture release cannot fire a second attack');
  const roll = new AttackGesture(2, 0);
  assert.equal(roll.update(30, 0, 30)?.kind, 'roll');
  assert.equal(roll.update(-30, 0, 60), null);
  assert.equal(resolveAttackRelease({ holdMs: 900, fired: roll.fired }), null);

  // UI regression: fixed lower-center charge progress, phone idle core-only/pressed art,
  // desktop full artwork. The attack colors remain in the original stylesheet rules.
  const css = fs.readFileSync('styles.css', 'utf8');
  const controls = fs.readFileSync('src/core/controls.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(css, /\.attack-charge-hint\s*\{[^}]*left:\s*50%[^}]*bottom:/s);
  assert.match(css, /\.attack-charge-fill\s*\{[^}]*width:\s*var\(--charge-progress/s);
  assert.match(css, /\.touch-mode \.touch-actions button\[data-touch-action="attack"\] b,[\s\S]*?opacity:\s*0/);
  assert.match(css, /\.touch-mode \.touch-actions button\[data-touch-action="attack"\]\.pressed b,[\s\S]*?opacity:\s*1/);
  assert.match(css, /button\[data-touch-action="attack"\][\s\S]*?background-image:\s*linear-gradient/s);
  assert.match(css, /\.touch-mode \.touch-actions button\[data-touch-action="attack"\] b[\s\S]*?opacity:\s*0/, 'idle art hiding is restricted to touch mode; desktop stays complete');
  const landingMethod = controls.match(/requestFastLanding\(speed = 5\.2\)[\s\S]*?\n  }/);
  assert.ok(landingMethod, 'controller exposes a quick-landing request');
  assert.match(landingMethod[0], /this\.vy = Math\.min\(this\.vy, -fallSpeed\)/);
  assert.doesNotMatch(landingMethod[0], /teleport|position\.(set|y\s*\+=?)/i, 'quick landing uses velocity rather than teleporting');
  assert.match(html, /class="attack-core"/);
  assert.match(html, /data-touch-action="attack"/);

  // Incoming-hit interruption belongs only to the player's actual contact-damage path.
  const main = fs.readFileSync('src/main.js', 'utf8');
  const hitFoxStart = main.indexOf('function hitFox(');
  const hitFoxEnd = main.indexOf('\nfunction ', hitFoxStart + 1);
  assert.ok(hitFoxStart >= 0 && hitFoxEnd > hitFoxStart, 'hitFox source is present');
  const hitFoxSource = main.slice(hitFoxStart, hitFoxEnd);
  assert.doesNotMatch(hitFoxSource, /interruptHeldAttackCharge\s*\(/, 'outgoing hits must not interrupt a held attack');
  assert.doesNotMatch(hitFoxSource, /clearPendingAerialParry\s*\(/, 'outgoing hits must not clear a pending aerial parry');

  const contactStart = main.indexOf('// 接触伤害');
  const parryStart = main.indexOf('if (parryOK) {', contactStart);
  const parryContinue = main.indexOf('continue;', parryStart);
  const hpMutation = main.indexOf('p.hp = testState.godMode', contactStart);
  assert.ok(contactStart >= 0 && parryStart > contactStart && parryContinue > parryStart && hpMutation > parryContinue,
    'player contact-damage and parry blocks are present');
  assert.match(main.slice(parryContinue, hpMutation + 100),
    /continue;[\s\S]*?interruptHeldAttackCharge\(\);\s*clearPendingAerialParry\(\);\s*p\.hp = testState\.godMode/,
    'only a non-parried player contact hit interrupts charge and clears pending aerial parry immediately before HP mutation');

  const pauseStart = main.indexOf('function pause() {');
  const resumeStart = main.indexOf('\nfunction resume()', pauseStart);
  assert.ok(pauseStart >= 0 && resumeStart > pauseStart, 'pause source is present');
  const pauseSource = main.slice(pauseStart, resumeStart);
  assert.ok(pauseSource.indexOf('clearPendingAerialParry();') < pauseSource.indexOf('cancelAttackCharge();')
    && pauseSource.indexOf('cancelAttackCharge();') < pauseSource.indexOf("game.mode = 'pause';")
    && pauseSource.indexOf("game.mode = 'pause';") < pauseSource.indexOf('touchControls?.releaseAll();'),
  'pause clears pending parry and cancels charge before changing mode or releasing touches');
  assert.doesNotMatch(pauseSource, /\breleaseAttack\s*\(/, 'pause must cancel rather than fire a held attack');

  const finishStart = main.indexOf('function finish(');
  const levelSelectStart = main.indexOf('\nfunction showLevelSelect()', finishStart);
  const finishSource = main.slice(finishStart, levelSelectStart);
  assert.match(finishSource, /clearPendingAerialParry\(\);[\s\S]*?cancelAttackCharge\(\);/, 'finish clears pending parry and charge');
  const titleStart = main.indexOf('function title() {');
  const startPlayStart = main.indexOf('\nfunction startPlay()', titleStart);
  const titleSource = main.slice(titleStart, startPlayStart);
  assert.match(titleSource, /clearPendingAerialParry\(\);[\s\S]*?cancelAttackCharge\(\);/, 'title clears pending parry and charge');

  console.log('attack charge and aerial logic/UI/contact interruption: all assertions passed');
})().catch((err) => { console.error(err); process.exit(1); });
