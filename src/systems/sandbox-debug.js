/**
 * 沙盒数值后台（dev-only，?sandboxdebug=1 懒加载）。
 *
 * 与 ?debugvolumes=1 的区别：
 *   - debugvolumes 偏「战斗体积可视化」，只覆盖近战/碰撞；
 *   - sandbox-debug 偏「全局数值调参」，覆盖玩家基础、三招战斗轮、跳跃、
 *     狐狸全局、五种狐狸类型、五种攻击模式、沙盒难度倍率，并带快捷操作与
 *     配置导出/导入。所有滑块直接改 config 的活对象（PLAYER/FOX/STRIKE_VOLUMES），
 *     战斗判定每帧读的就是这些值，因此调整即时生效、所见即所得。
 *
 * 不做持久化：沙盒是临时试验场，刷新即回默认；需要留存用「导出 JSON」。
 */
import { GUI } from '../../vendor/lil-gui/lil-gui.esm.js';
import { PLAYER, FOX } from '../core/config.js';
import { STRIKE_VOLUMES } from './combat.js';

const CFG_KEY = 'm3d_sandbox_debug_cfg_v1';

// 深拷贝仅取我们调的数值字段，用于重置/导出（不拷贝函数）。
function snapshot() {
  return JSON.parse(JSON.stringify({
    PLAYER: {
      radius: PLAYER.radius, collisionHeight: PLAYER.collisionHeight,
      speed: PLAYER.speed, backpedalSpeed: PLAYER.backpedalSpeed,
      bodyTurnRate: PLAYER.bodyTurnRate, eyeHeight: PLAYER.eyeHeight,
      maxHp: PLAYER.maxHp, maxEnergy: PLAYER.maxEnergy,
      jump: { ...PLAYER.jump }, posture: { ...PLAYER.posture },
      combatWheel: {
        tap: { ...PLAYER.combatWheel.tap, stand: { ...PLAYER.combatWheel.tap.stand }, run: { ...PLAYER.combatWheel.tap.run } },
        dodge: { ...PLAYER.combatWheel.dodge },
        stand: { ...PLAYER.combatWheel.stand },
        lunge: { ...PLAYER.combatWheel.lunge },
      },
    },
    STRIKE: {
      halfAngle: STRIKE_VOLUMES.halfAngle,
      tap: { ...STRIKE_VOLUMES.tap }, stand: { ...STRIKE_VOLUMES.stand }, lunge: { ...STRIKE_VOLUMES.lunge },
    },
    FOX: {
      windRange: FOX.windRange, dashSpeed: FOX.dashSpeed, groundAttackHeight: FOX.groundAttackHeight,
      fleeSpeed: FOX.fleeSpeed, fleeMaxTime: FOX.fleeMaxTime, roamRange: FOX.roamRange,
      contact: { ...FOX.contact }, collisionRadius: { ...FOX.collisionRadius }, collisionHeight: { ...FOX.collisionHeight },
      damage: { ...FOX.damage },
      types: Object.fromEntries(Object.entries(FOX.types).map(([k, v]) => [k, { ...v }])),
      attacks: Object.fromEntries(Object.entries(FOX.attacks).map(([k, v]) => [k, { ...v }])),
    },
  }));
}

function applyPlain(target, src) {
  if (!src || typeof src !== 'object') return;
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) applyPlain(target[k] || (target[k] = {}), v);
    else if (k in target) target[k] = v;
  }
}

export function createSandboxDebugGUI({ actions = {}, state = null } = {}) {
  if (typeof document !== 'undefined' && !document.querySelector('link[data-lil-gui]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../vendor/lil-gui/lil-gui.css', import.meta.url);
    link.dataset.lilGui = '1';
    document.head.appendChild(link);
  }

  const DEFAULTS = snapshot();
  const gui = new GUI({ title: '沙盒数值后台' });
  const controllers = [];
  const track = (c) => { controllers.push(c); return c; };

  // —— 快捷操作 ——
  const act = {
    spawnOne: () => actions.spawnOne?.(),
    spawnGroup: () => actions.spawnGroup?.(),
    clearFoxes: () => actions.clearFoxes?.(),
    placeDummy: () => actions.placeDummy?.(),
    removeDummy: () => actions.removeDummy?.(),
    refill: () => actions.refill?.(),
    charge: () => actions.charge?.(),
    toggleVolumes: () => actions.toggleVolumes?.(),
    resetAll() {
      applyPlain({ PLAYER, STRIKE_VOLUMES, FOX }, DEFAULTS);
      // STRIKE_VOLUMES 别名结构需单独回填（DEFAULTS 用的是 STRIKE 键）。
      controllers.forEach((c) => c.updateDisplay());
      actions.onReset?.();
    },
    exportCfg() {
      const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sandbox-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    importCfg() {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = () => {
        const f = inp.files?.[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => {
          try {
            const data = JSON.parse(String(r.result));
            if (data.PLAYER) applyPlain(PLAYER, data.PLAYER);
            if (data.STRIKE) { STRIKE_VOLUMES.halfAngle = data.STRIKE.halfAngle; ['tap', 'stand', 'lunge'].forEach((m) => applyPlain(STRIKE_VOLUMES[m], data.STRIKE[m])); }
            if (data.FOX) applyPlain(FOX, data.FOX);
            controllers.forEach((c) => c.updateDisplay());
            actions.onReset?.();
          } catch (e) { console.warn('[sandbox-debug] 导入失败', e); }
        };
        r.readAsText(f);
      };
      inp.click();
    },
  };

  // —— 玩家基础 ——
  const pBasic = gui.addFolder('土拨鼠 · 基础');
  track(pBasic.add(PLAYER, 'radius', 0.1, 2, 0.01).name('碰撞半径'));
  track(pBasic.add(PLAYER, 'collisionHeight', 0.1, 2, 0.01).name('碰撞高度'));
  track(pBasic.add(PLAYER, 'eyeHeight', 0.1, 1.5, 0.01).name('视高'));
  track(pBasic.add(PLAYER, 'speed', 1, 16, 0.1).name('移动速度'));
  track(pBasic.add(PLAYER, 'backpedalSpeed', 0.1, 1, 0.01).name('后退倍率'));
  track(pBasic.add(PLAYER, 'bodyTurnRate', 1, 20, 0.1).name('转身速率'));
  track(pBasic.add(PLAYER, 'maxHp', 10, 300, 1).name('最大生命'));
  track(pBasic.add(PLAYER, 'maxEnergy', 10, 300, 1).name('最大储备'));

  // —— 跳跃 ——
  const pJump = gui.addFolder('土拨鼠 · 跳跃');
  track(pJump.add(PLAYER.jump, 'velocity', 1, 9, 0.05).name('起跳速度'));
  track(pJump.add(PLAYER.jump, 'gravity', 3, 20, 0.1).name('重力'));
  track(pJump.add(PLAYER.jump, 'cooldown', 0.05, 1.5, 0.01).name('跳跃冷却'));
  track(pJump.add(PLAYER.jump, 'dodgeHeight', 0, 2, 0.01).name('躲咬高度'));

  // —— 三招战斗轮 ——
  const wheel = PLAYER.combatWheel;
  const pTap = gui.addFolder('招式 · 推击 tap');
  track(pTap.add(wheel.tap, 'cooldown', 0.05, 2, 0.01).name('冷却'));
  track(pTap.add(wheel.tap.stand, 'rangeMul', 0.2, 3, 0.01).name('站立距离倍率'));
  track(pTap.add(wheel.tap.stand, 'damageMul', 0, 5, 0.01).name('站立伤害倍率'));
  track(pTap.add(wheel.tap.run, 'rangeMul', 0.2, 3, 0.01).name('奔跑距离倍率'));
  track(pTap.add(wheel.tap.run, 'damageMul', 0, 5, 0.01).name('奔跑伤害倍率'));

  const pStand = gui.addFolder('招式 · 迎击 stand');
  track(pStand.add(wheel.stand, 'damageMul', 0, 5, 0.01).name('伤害倍率'));
  track(pStand.add(wheel.stand, 'rangeMul', 0.2, 3, 0.01).name('距离倍率'));
  track(pStand.add(wheel.stand, 'cooldown', 0.05, 2, 0.01).name('冷却'));
  track(pStand.add(wheel.stand, 'recovery', 0, 2, 0.01).name('后摇'));
  track(pStand.add(wheel.stand, 'parryWindow', 0.05, 1, 0.01).name('迎击窗口'));
  track(pStand.add(wheel.stand, 'parryHalfAngle', 0, Math.PI, 0.01).name('迎击半角'));

  const pLunge = gui.addFolder('招式 · 扑击 lunge');
  track(pLunge.add(wheel.lunge, 'damageMul', 0, 5, 0.01).name('伤害倍率'));
  track(pLunge.add(wheel.lunge, 'distance', 0, 8, 0.05).name('扑击距离'));
  track(pLunge.add(wheel.lunge, 'range', -0.5, 5, 0.01).name('追加距离'));
  track(pLunge.add(wheel.lunge, 'rangeMul', 0.2, 3, 0.01).name('距离倍率'));
  track(pLunge.add(wheel.lunge, 'recovery', 0, 2, 0.01).name('后摇'));

  const pDodge = gui.addFolder('招式 · 翻滚 dodge');
  track(pDodge.add(wheel.dodge, 'distance', 0, 8, 0.05).name('翻滚距离'));
  track(pDodge.add(wheel.dodge, 'invuln', 0, 2, 0.01).name('无敌时间'));
  track(pDodge.add(wheel.dodge, 'recovery', 0, 2, 0.01).name('后摇'));

  // —— 攻击体积（与 debug-volumes 同一对象）——
  const pVol = gui.addFolder('攻击体积（扇形）');
  track(pVol.add(STRIKE_VOLUMES, 'halfAngle', 0.1, Math.PI, 0.01).name('扇形半角'));
  track(pVol.add(STRIKE_VOLUMES.tap, 'lower', -1, 2, 0.01).name('tap 下沿'));
  track(pVol.add(STRIKE_VOLUMES.tap, 'upper', 0.1, 3, 0.01).name('tap 上沿'));
  track(pVol.add(STRIKE_VOLUMES.lunge, 'lower', -1, 2, 0.01).name('lunge 下沿'));
  track(pVol.add(STRIKE_VOLUMES.lunge, 'upper', 0.1, 4, 0.01).name('lunge 上沿'));

  // —— 狐狸全局 ——
  const fGlob = gui.addFolder('狐狸 · 全局');
  track(fGlob.add(FOX, 'windRange', 2, 25, 0.1).name('开始蓄力距离'));
  track(fGlob.add(FOX, 'dashSpeed', 4, 30, 0.1).name('冲刺速度'));
  track(fGlob.add(FOX, 'groundAttackHeight', 0, 2, 0.01).name('地扑攻击高度'));
  track(fGlob.add(FOX, 'fleeSpeed', 2, 16, 0.1).name('逃跑速度'));
  track(fGlob.add(FOX, 'fleeMaxTime', 0.5, 8, 0.1).name('逃跑最长时间'));
  track(fGlob.add(FOX, 'roamRange', 10, 120, 1).name('感知半径'));

  // —— 各类型狐狸 ——
  const fTypes = gui.addFolder('狐狸 · 类型属性');
  for (const [key, t] of Object.entries(FOX.types)) {
    const sub = fTypes.addFolder(key);
    track(sub.add(t, 'hp', 1, 40, 1).name('血量'));
    track(sub.add(t, 'speed', 0.3, 3, 0.02).name('速度倍率'));
    track(sub.add(t, 'wind', 0.3, 3, 0.02).name('蓄力倍率'));
    track(sub.add(t, 'mass', 0.2, 2, 0.02).name('质量(击退)'));
    track(sub.add(t, 'scale', 0.4, 2.4, 0.02).name('体型'));
    const cr = FOX.collisionRadius[key] ?? FOX.collisionRadius.normal;
    const ch = FOX.collisionHeight[key] ?? FOX.collisionHeight.normal;
    track(sub.add(FOX.collisionRadius, key, 0.2, 3, 0.01).name('碰撞半径'));
    track(sub.add(FOX.collisionHeight, key, 0.1, 2, 0.01).name('碰撞高度'));
    if (FOX.damage[key] != null) track(sub.add(FOX.damage, key, 1, 60, 1).name('伤害'));
    void cr; void ch;
  }
  track(fGlob.add(FOX.damage, 'default', 1, 60, 1).name('普通伤害'));

  // —— 攻击模式（扑击/直线/环绕/连击）——
  const fAtk = gui.addFolder('狐狸 · 攻击模式');
  for (const [key, a] of Object.entries(FOX.attacks)) {
    const sub = fAtk.addFolder(key);
    track(sub.add(a, 'mode', ['leap', 'straight', 'circle', 'combo']).name('模式'));
    if (a.dashTime != null) track(sub.add(a, 'dashTime', 0.05, 2, 0.01).name('冲刺时长'));
    if (a.leapHeight != null) track(sub.add(a, 'leapHeight', 0, 3, 0.01).name('跃扑高度'));
    if (a.windMul != null) track(sub.add(a, 'windMul', 0.3, 3, 0.02).name('蓄力倍率'));
    if (a.turnRate != null) track(sub.add(a, 'turnRate', 0, 2, 0.02).name('追踪转向'));
    if (a.dashSpeedMul != null) track(sub.add(a, 'dashSpeedMul', 0.3, 3, 0.02).name('冲刺速度倍率'));
  }

  // —— 沙盒难度/状态 ——（仅展示当前基线 state 中真实存在的字段，避免对 undefined gui.add 报错）
  if (state) {
    const sb = gui.addFolder('沙盒 · 状态');
    if ('speedMultiplier' in state) track(sb.add(state, 'speedMultiplier', 0.3, 3, 0.01).name('狐狸速度倍率').onChange(() => actions.onState?.()));
    if ('alertMultiplier' in state) track(sb.add(state, 'alertMultiplier', 0.3, 3, 0.01).name('警觉倍率').onChange(() => actions.onState?.()));
    if ('godMode' in state) track(sb.add(state, 'godMode').name('无敌').onChange((v) => { actions.onFlag?.('godMode', v); }));
    if ('freezeTimer' in state) track(sb.add(state, 'freezeTimer').name('冻结计时').onChange((v) => actions.onFlag?.('freezeTimer', v)));
    if ('lowGravity' in state) track(sb.add(state, 'lowGravity').name('低重力').onChange((v) => actions.onFlag?.('lowGravity', v)));
  }

  // —— 操作 ——
  const ops = gui.addFolder('操作');
  ops.add(act, 'spawnOne').name('前方生成 1 只');
  ops.add(act, 'spawnGroup').name('生成一群');
  ops.add(act, 'clearFoxes').name('清除狐狸');
  ops.add(act, 'placeDummy').name('放练习木桩');
  ops.add(act, 'removeDummy').name('移除木桩');
  ops.add(act, 'refill').name('回满生命/储备');
  ops.add(act, 'charge').name('充满大招');
  ops.add(act, 'toggleVolumes').name('开关攻击范围显示');
  ops.add(act, 'resetAll').name('恢复全部默认值');
  ops.add(act, 'exportCfg').name('导出 JSON');
  ops.add(act, 'importCfg').name('导入 JSON');

  // 默认折叠大部分，避免一屏塞满；基础/操作保持展开。
  [pJump, pStand, pLunge, pDodge, pVol, fTypes, fAtk].forEach((f) => f.close());

  return {
    gui,
    controllers,
    config: { PLAYER, FOX, STRIKE_VOLUMES },
    save() { try { localStorage.setItem(CFG_KEY, JSON.stringify(snapshot())); } catch (_) {} },
    loadSaved() {
      try {
        const raw = localStorage.getItem(CFG_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data.PLAYER) applyPlain(PLAYER, data.PLAYER);
        if (data.STRIKE) { STRIKE_VOLUMES.halfAngle = data.STRIKE.halfAngle; ['tap', 'stand', 'lunge'].forEach((m) => applyPlain(STRIKE_VOLUMES[m], data.STRIKE[m])); }
        if (data.FOX) applyPlain(FOX, data.FOX);
        controllers.forEach((c) => c.updateDisplay());
        return true;
      } catch (_) { return false; }
    },
    destroy() { gui.destroy(); },
  };
}
