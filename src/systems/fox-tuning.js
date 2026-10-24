import { GUI } from '../../vendor/lil-gui/lil-gui.esm.js';
import { FOX } from '../core/config.js';
import { SMART_POUNCE_STAGE, SMART_POUNCE_TUNE, resetSmartPounceTune } from '../entities/smart-fox-core.mjs';

/**
 * 阶段 5：藏狐调参台（?foxtune=1 懒加载）。
 * 把 FOX.vitals / FOX.detection / FOX.ACTIONS / FOX.retreat / SMART_POUNCE_TUNE
 * 拉到 lil-gui 面板上实时调；构造时先深拷贝一份初始快照，"复位默认"可整包还原。
 *
 * 快照刷新边界：
 *  - FOX.vitals / detection / ACTIONS / retreat / SMART_POUNCE_TUNE 都是运行时读取，下一帧生效；
 *  - fox.maxStamina / fox.maxHp 是构造时快照：maxStamina 改动会同步刷新现有狐狸（体力 clamp 到新上限），
 *    maxHp 等改动需要点"重生当前狐狸"重建狐狸后生效。
 */
export class FoxTuning {
  constructor({ scene, controller, foxes, respawnFoxes } = {}) {
    this.scene = scene; this.controller = controller;
    this.foxes = foxes; this.respawnFoxes = respawnFoxes;
    if (typeof document !== 'undefined' && !document.querySelector('link[data-lil-gui]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('../../vendor/lil-gui/lil-gui.css', import.meta.url);
      link.dataset.lilGui = '1';
      document.head.appendChild(link);
    }
    // 初始快照（深拷贝）：复位默认 / 导入校验都基于它
    this._defaults = this._snapshot();
    this._controllers = [];
    this._buildGui();
  }

  _snapshot() {
    return JSON.parse(JSON.stringify({
      vitals: FOX.vitals,
      detection: FOX.detection,
      actions: { stalkSpeed: FOX.ACTIONS.stalk.speed, sprintSpeed: FOX.ACTIONS.sprint.speed },
      retreat: FOX.retreat,
      pounce: { ...SMART_POUNCE_TUNE },
    }));
  }

  _applySnapshot(snap) {
    if (!snap || typeof snap !== 'object') return false;
    const num = (v) => Number.isFinite(v);
    if (snap.vitals) for (const k of Object.keys(FOX.vitals)) if (num(snap.vitals[k])) FOX.vitals[k] = snap.vitals[k];
    if (snap.detection) for (const k of Object.keys(FOX.detection)) if (num(snap.detection[k])) FOX.detection[k] = snap.detection[k];
    if (snap.actions) {
      if (num(snap.actions.stalkSpeed)) FOX.ACTIONS.stalk.speed = snap.actions.stalkSpeed;
      if (num(snap.actions.sprintSpeed)) FOX.ACTIONS.sprint.speed = snap.actions.sprintSpeed;
    }
    if (snap.retreat) for (const k of Object.keys(FOX.retreat)) {
      if (k === 'restSeconds') continue; // 嵌套表不在调参范围内
      if (num(snap.retreat[k])) FOX.retreat[k] = snap.retreat[k];
    }
    if (snap.pounce) for (const k of Object.keys(SMART_POUNCE_TUNE)) if (num(snap.pounce[k])) SMART_POUNCE_TUNE[k] = snap.pounce[k];
    this._syncFoxStaminaCaps();
    this._refreshDisplay();
    return true;
  }

  /** maxStamina 是构造时快照：改动后同步刷新现有狐狸，体力 clamp 到新上限。 */
  _syncFoxStaminaCaps() {
    const list = typeof this.foxes === 'function' ? this.foxes() : (this.foxes || []);
    for (const f of list || []) {
      if (!f || f.maxStamina == null) continue;
      f.maxStamina = FOX.vitals.maxStamina;
      f.stamina = Math.max(0, Math.min(f.maxStamina, f.stamina));
    }
  }

  _refreshDisplay() { for (const c of this._controllers) c.updateDisplay(); }

  _track(c) { this._controllers.push(c); return c; }

  _buildGui() {
    const gui = new GUI({ title: '藏狐调参台' });
    this.gui = gui;

    const stamina = gui.addFolder('体力 / Stamina');
    this._track(stamina.add(FOX.vitals, 'maxStamina', 20, 300, 1).name('体力上限')).onChange(() => this._syncFoxStaminaCaps());
    this._track(stamina.add(FOX.vitals, 'sprintStaminaPerSec', 0, 60, 0.5).name('冲刺耗体力/秒'));
    this._track(stamina.add(FOX.vitals, 'pounceStaminaPerSec', 0, 80, 0.5).name('扑咬冲刺耗体力/秒'));
    this._track(stamina.add(FOX.vitals, 'restStaminaPerSec', 0, 60, 0.5).name('休息回体力/秒'));
    this._track(stamina.add(FOX.vitals, 'restHpRegenRatio', 0, 0.3, 0.005).name('休息回血比例/秒'));
    this._track(stamina.add(FOX.vitals, 'hitStaminaCost', 0, 40, 0.5).name('受击额外扣体力'));
    this._track(stamina.add(FOX.vitals, 'staminaLockSeconds', 0, 5, 0.05).name('体力锁定秒数'));

    const hp = gui.addFolder('血量影响 / HP');
    this._track(hp.add(FOX.vitals, 'lowHpThreshold', 0, 1, 0.01).name('低血阈值'));
    this._track(hp.add(FOX.vitals, 'speedMulAtZeroHp', 0.2, 1, 0.01).name('零血速度倍率'));
    this._track(hp.add(FOX.vitals, 'damageMulAtZeroHp', 0.2, 1, 0.01).name('零血伤害倍率'));

    const pounce = gui.addFolder('扑咬时序 / Pounce');
    this._track(pounce.add(SMART_POUNCE_TUNE, 'dashDuration', 0.05, 1.5, 0.01).name('冲刺阶段时长'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'dashSpeedMul', 0.5, 2.5, 0.01).name('冲刺速度倍率'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'windupTime', 0, 0.6, 0.01).name('扑咬前摇'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'strikeTime', 0.02, 0.8, 0.01).name('扑咬位移时长'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'strikeSpeed', 2, 25, 0.1).name('扑咬速度'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'recoverTime', 0, 2, 0.01).name('扑咬后摇'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'maxStrikeDistance', 0, 5, 0.05).name('扑咬最远距离'));
    this._track(pounce.add(SMART_POUNCE_TUNE, 'staminaCost', 0, 60, 1).name('扑咬一次耗体力'));

    const detect = gui.addFolder('可发现性 / Detection');
    this._track(detect.add(FOX.detection, 'stalk', 0, 20, 0.1).name('慢行被察觉半径'));
    this._track(detect.add(FOX.detection, 'sprint', 0, 30, 0.1).name('冲刺被察觉半径'));
    this._track(detect.add(FOX.detection, 'pounce', 0, 40, 0.1).name('扑咬被察觉半径'));
    this._track(detect.add(FOX.detection, 'viewRange', 5, 80, 0.5).name('玩家视距'));
    this._track(detect.add(FOX.detection, 'viewConeDeg', 10, 360, 1).name('视野锥全角(度)'));

    const actions = gui.addFolder('动作 / Actions');
    this._track(actions.add(FOX.ACTIONS.stalk, 'speed', 0, 8, 0.05).name('慢行速度'));
    this._track(actions.add(FOX.ACTIONS.sprint, 'speed', 0, 14, 0.05).name('冲刺速度'));

    const retreat = gui.addFolder('撤退阈值 / Retreat');
    this._track(retreat.add(FOX.retreat, 'hpRatio', 0, 1, 0.01).name('血量撤退阈值'));
    this._track(retreat.add(FOX.retreat, 'staminaRatio', 0, 1, 0.01).name('体力撤退阈值'));
    this._track(retreat.add(FOX.retreat, 'hitStreak', 1, 12, 1).name('连打撤退次数'));
    this._track(retreat.add(FOX.retreat, 'hitStreakDecay', 0, 20, 0.5).name('连打衰减秒数'));
    this._track(retreat.add(FOX.retreat, 'speed', 1, 12, 0.1).name('撤退速度'));

    const tools = gui.addFolder('工具 / Tools');
    const acts = {
      复位默认: () => {
        const snap = JSON.parse(JSON.stringify(this._defaults));
        resetSmartPounceTune();
        this._applySnapshot(snap);
      },
      重生当前狐狸: () => { this.respawnFoxes?.(); },
      导出JSON: () => this._exportJson(),
      导入JSON: () => this._importJson(),
    };
    tools.add(acts, '复位默认');
    tools.add(acts, '重生当前狐狸');
    tools.add(acts, '导出JSON');
    tools.add(acts, '导入JSON');
  }

  _exportJson() {
    const blob = new Blob([JSON.stringify(this._snapshot(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'fox-tuning.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  _importJson() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const data = JSON.parse(String(r.result));
          this._applySnapshot(data);
        } catch { /* 忽略解析失败，不写回任何值 */ }
      };
      r.readAsText(f);
    };
    inp.click();
  }
}

export { SMART_POUNCE_STAGE, SMART_POUNCE_TUNE, resetSmartPounceTune };
