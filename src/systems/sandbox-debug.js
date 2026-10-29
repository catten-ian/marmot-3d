/**
 * 沙盒数值后台（BETA-only，?sandboxdebug=1 且进入沙盒后懒加载）。
 *
 * 这个模块只在自由沙盒中加载：滑块直接绑定 PLAYER/FOX/STRIKE_VOLUMES 活对象，
 * 搜索/折叠/预设均只改变后台 UI，不销毁控制器，也不影响 stable 正式玩法。
 */
import { GUI } from '../../vendor/lil-gui/lil-gui.esm.js';
import { PLAYER, FOX } from '../core/config.js';
import { STRIKE_VOLUMES } from './combat.js';
import {
  BUILTIN_PRESET_NAME, FOLDER_STORAGE_KEY, PRESET_STORAGE_KEY,
  matchesSandboxSearch, sandboxFolderSearchState, readSandboxPresets,
  saveSandboxPreset, deleteSandboxPreset, normalizePresetName,
} from './sandbox-panel-logic.mjs';

const CFG_KEY = 'm3d_beta_sandbox_cfg_v1';

// 只序列化配置对象本身（跳过方法），JSON 快照支持重置、方案与文件导入导出。
function serializable(value) {
  if (Array.isArray(value)) return value.map(serializable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, child]) => typeof child !== 'function')
    .map(([key, child]) => [key, serializable(child)]));
}
function snapshot() {
  return JSON.parse(JSON.stringify({
    PLAYER: serializable(PLAYER),
    STRIKE: serializable(STRIKE_VOLUMES),
    FOX: serializable(FOX),
  }));
}
const FACTORY_DEFAULTS = snapshot();

function applyPlain(target, src) {
  if (!target || !src || typeof src !== 'object' || Array.isArray(src)) return;
  for (const [key, value] of Object.entries(src)) {
    if (!Object.prototype.hasOwnProperty.call(target, key)) continue;
    const current = target[key];
    if (Array.isArray(value)) {
      if (Array.isArray(current)) target[key] = value.map((item) => item && typeof item === 'object' ? structuredClone(item) : item);
    } else if (value && typeof value === 'object') {
      if (current && typeof current === 'object' && !Array.isArray(current)) applyPlain(current, value);
    } else if (typeof value !== 'function') target[key] = value;
  }
}

function applySnapshot(data, controllers, onReset) {
  if (data?.PLAYER) applyPlain(PLAYER, data.PLAYER);
  if (data?.STRIKE) {
    if (Object.prototype.hasOwnProperty.call(STRIKE_VOLUMES, 'halfAngle') && Object.prototype.hasOwnProperty.call(data.STRIKE, 'halfAngle')) STRIKE_VOLUMES.halfAngle = data.STRIKE.halfAngle;
    for (const mode of ['tap', 'stand', 'lunge']) if (STRIKE_VOLUMES[mode] && data.STRIKE[mode]) applyPlain(STRIKE_VOLUMES[mode], data.STRIKE[mode]);
  }
  if (data?.FOX) applyPlain(FOX, data.FOX);
  controllers.forEach((controller) => controller.updateDisplay());
  onReset?.();
}

function getStorage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; }
}

export function createSandboxDebugGUI({ actions = {}, state = null } = {}) {
  if (typeof document !== 'undefined' && !document.querySelector('link[data-lil-gui]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../vendor/lil-gui/lil-gui.css', import.meta.url);
    link.dataset.lilGui = '1';
    document.head.appendChild(link);
  }

  const DEFAULTS = FACTORY_DEFAULTS;
  const gui = new GUI({ title: '沙盒数值后台' });
  const controllers = [];
  const searchableRows = [];
  const defaultClosedFolders = new Set();
  const folderRecords = [];
  const folderRecordByGui = new Map();
  let searchQuery = '';
  let isApplyingSearch = false;
  let folderOpenState = new Map();

  const track = (controller) => { controllers.push(controller); return controller; };
  const folder = (parent, title) => parent.addFolder(title);
  const has = (target, key) => !!target && Object.prototype.hasOwnProperty.call(target, key);
  const addNumber = (parent, target, key, min, max, step, label) => {
    if (!has(target, key) || typeof target[key] !== 'number' || !Number.isFinite(target[key])) return null;
    return track(parent.add(target, key, min, max, step).name(label));
  };
  const addChoice = (parent, target, key, choices, label) => {
    if (!has(target, key) || typeof target[key] !== 'string') return null;
    return track(parent.add(target, key, choices).name(label));
  };
  const addFlag = (parent, target, key, label, onChange) => {
    if (!has(target, key) || typeof target[key] !== 'boolean') return null;
    const controller = parent.add(target, key).name(label);
    if (onChange) controller.onChange(onChange);
    return track(controller);
  };
  const addNativeRow = (parent, labelText, control) => {
    const row = document.createElement('label');
    row.className = 'sandbox-debug-row';
    const label = document.createElement('span'); label.textContent = labelText;
    row.append(label, control);
    parent.$children.appendChild(row);
    searchableRows.push({ parent, element: row, name: labelText, property: control?.dataset?.property || '' });
    return row;
  };

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
    resetAll() { applySnapshot(DEFAULTS, gui.controllersRecursive(), actions.onReset); },
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
        const file = inp.files?.[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try { applySnapshot(JSON.parse(String(reader.result)), gui.controllersRecursive(), actions.onReset); }
          catch (error) { console.warn('[sandbox-debug] 导入失败', error); }
        };
        reader.readAsText(file);
      };
      inp.click();
    },
  };

  // —— 玩家基础 ——（beta 实际 PLAYER；每个字段先验证存在且为数值）
  const pBasic = folder(gui, '土拨鼠 · 基础');
  addNumber(pBasic, PLAYER, 'radius', 0.1, 2, 0.01, '碰撞半径');
  addNumber(pBasic, PLAYER, 'collisionHeight', 0.1, 2, 0.01, '碰撞高度');
  addNumber(pBasic, PLAYER, 'eyeHeight', 0.1, 1.5, 0.01, '视高');
  addNumber(pBasic, PLAYER, 'speed', 1, 16, 0.1, '移动速度');
  addNumber(pBasic, PLAYER, 'backpedalSpeed', 0.1, 1, 0.01, '后退倍率');
  addNumber(pBasic, PLAYER, 'bodyTurnRate', 1, 20, 0.1, '转身速率');
  addNumber(pBasic, PLAYER, 'maxHp', 10, 300, 1, '最大生命');
  addNumber(pBasic, PLAYER, 'maxEnergy', 10, 300, 1, '最大储备');

  // —— 跳跃 ——
  const pJump = folder(gui, '土拨鼠 · 跳跃');
  addNumber(pJump, PLAYER.jump, 'velocity', 1, 9, 0.05, '起跳速度');
  addNumber(pJump, PLAYER.jump, 'gravity', 3, 20, 0.1, '重力');
  addNumber(pJump, PLAYER.jump, 'cooldown', 0.05, 1.5, 0.01, '跳跃冷却');
  addNumber(pJump, PLAYER.jump, 'dodgeHeight', 0, 2, 0.01, '躲咬高度');

  // —— 三招战斗轮 ——
  const wheel = PLAYER.combatWheel || {};
  const pTap = folder(gui, '招式 · 推击 tap');
  addNumber(pTap, wheel.tap, 'cooldown', 0.05, 2, 0.01, '冷却');
  addNumber(pTap, wheel.tap?.stand, 'rangeMul', 0.2, 3, 0.01, '站立距离倍率');
  addNumber(pTap, wheel.tap?.stand, 'damageMul', 0, 5, 0.01, '站立伤害倍率');
  addNumber(pTap, wheel.tap?.run, 'rangeMul', 0.2, 3, 0.01, '奔跑距离倍率');
  addNumber(pTap, wheel.tap?.run, 'damageMul', 0, 5, 0.01, '奔跑伤害倍率');

  const pStand = folder(gui, '招式 · 迎击 stand');
  addNumber(pStand, wheel.stand, 'damageMul', 0, 5, 0.01, '伤害倍率');
  addNumber(pStand, wheel.stand, 'rangeMul', 0.2, 3, 0.01, '距离倍率');
  addNumber(pStand, wheel.stand, 'cooldown', 0.05, 2, 0.01, '冷却');
  addNumber(pStand, wheel.stand, 'recovery', 0, 2, 0.01, '后摇');
  addNumber(pStand, wheel.stand, 'parryWindow', 0.05, 1, 0.01, '迎击窗口');
  addNumber(pStand, wheel.stand, 'parryHalfAngle', 0, Math.PI, 0.01, '迎击半角');

  const pLunge = folder(gui, '招式 · 扑击 lunge');
  addNumber(pLunge, wheel.lunge, 'damageMul', 0, 5, 0.01, '伤害倍率');
  addNumber(pLunge, wheel.lunge, 'distance', 0, 8, 0.05, '扑击距离');
  addNumber(pLunge, wheel.lunge, 'range', -0.5, 5, 0.01, '追加距离');
  addNumber(pLunge, wheel.lunge, 'rangeMul', 0.2, 3, 0.01, '距离倍率');
  addNumber(pLunge, wheel.lunge, 'recovery', 0, 2, 0.01, '后摇');

  const pDodge = folder(gui, '招式 · 翻滚 dodge');
  addNumber(pDodge, wheel.dodge, 'distance', 0, 8, 0.05, '翻滚距离');
  addNumber(pDodge, wheel.dodge, 'invuln', 0, 2, 0.01, '无敌时间');
  addNumber(pDodge, wheel.dodge, 'recovery', 0, 2, 0.01, '后摇');

  // —— 攻击体积（直接绑定 combat.js 中被判定每帧读取的 STRIKE_VOLUMES）——
  const pVol = folder(gui, '攻击体积（扇形）');
  addNumber(pVol, STRIKE_VOLUMES, 'halfAngle', 0.1, Math.PI, 0.01, '扇形半角');
  for (const [mode, label] of [['tap', 'tap'], ['stand', 'stand'], ['lunge', 'lunge']]) {
    const volume = STRIKE_VOLUMES[mode];
    addNumber(pVol, volume, 'lower', -1, 2, 0.01, `${label} 下沿`);
    addNumber(pVol, volume, 'upper', 0.1, mode === 'lunge' ? 4 : 3, 0.01, `${label} 上沿`);
  }

  // —— 狐狸全局 ——
  const fGlob = folder(gui, '狐狸 · 全局');
  addNumber(fGlob, FOX, 'windRange', 2, 25, 0.1, '开始蓄力距离');
  addNumber(fGlob, FOX, 'dashSpeed', 4, 30, 0.1, '冲刺速度');
  addNumber(fGlob, FOX, 'groundAttackHeight', 0, 2, 0.01, '地扑攻击高度');
  addNumber(fGlob, FOX, 'fleeSpeed', 2, 16, 0.1, '逃跑速度');
  addNumber(fGlob, FOX, 'fleeMaxTime', 0.5, 8, 0.1, '逃跑最长时间');
  addNumber(fGlob, FOX, 'roamRange', 10, 120, 1, '感知半径');

  // —— 各类型狐狸 ——
  const fTypes = folder(gui, '狐狸 · 类型属性');
  for (const [key, typeConfig] of Object.entries(FOX.types || {})) {
    const sub = folder(fTypes, key);
    addNumber(sub, typeConfig, 'hp', 1, 40, 1, '血量');
    addNumber(sub, typeConfig, 'speed', 0.3, 3, 0.02, '速度倍率');
    addNumber(sub, typeConfig, 'wind', 0.3, 3, 0.02, '蓄力倍率');
    addNumber(sub, typeConfig, 'mass', 0.2, 2, 0.02, '质量(击退)');
    addNumber(sub, typeConfig, 'scale', 0.4, 2.4, 0.02, '体型');
    addNumber(sub, FOX.collisionRadius, key, 0.2, 3, 0.01, '碰撞半径');
    addNumber(sub, FOX.collisionHeight, key, 0.1, 2, 0.01, '碰撞高度');
    addNumber(sub, FOX.damage, key, 1, 60, 1, '伤害');
  }
  addNumber(fGlob, FOX.damage, 'default', 1, 60, 1, '普通伤害');

  // —— 攻击模式（扑击/直线/环绕/连击）——
  const fAtk = folder(gui, '狐狸 · 攻击模式');
  for (const [key, attackConfig] of Object.entries(FOX.attacks || {})) {
    const sub = folder(fAtk, key);
    addChoice(sub, attackConfig, 'mode', ['leap', 'straight', 'circle', 'combo'], '模式');
    addNumber(sub, attackConfig, 'dashTime', 0.05, 2, 0.01, '冲刺时长');
    addNumber(sub, attackConfig, 'leapHeight', 0, 3, 0.01, '跃扑高度');
    addNumber(sub, attackConfig, 'windMul', 0.3, 3, 0.02, '蓄力倍率');
    addNumber(sub, attackConfig, 'turnRate', 0, 2, 0.02, '追踪转向');
    addNumber(sub, attackConfig, 'dashSpeedMul', 0.3, 3, 0.02, '冲刺速度倍率');
  }

  // —— 沙盒难度/状态 ——（只展示真实存在的字段）
  if (state) {
    const sb = folder(gui, '沙盒 · 状态');
    if (has(state, 'speedMultiplier')) { const c = addNumber(sb, state, 'speedMultiplier', 0.3, 3, 0.01, '狐狸速度倍率'); c?.onChange(() => actions.onState?.()); }
    if (has(state, 'alertMultiplier')) { const c = addNumber(sb, state, 'alertMultiplier', 0.3, 3, 0.01, '警觉倍率'); c?.onChange(() => actions.onState?.()); }
    addFlag(sb, state, 'godMode', '无敌', (value) => actions.onFlag?.('godMode', value));
    addFlag(sb, state, 'freezeTimer', '冻结计时', (value) => actions.onFlag?.('freezeTimer', value));
    addFlag(sb, state, 'lowGravity', '低重力', (value) => actions.onFlag?.('lowGravity', value));
  }

  // —— 操作 ——
  const ops = folder(gui, '操作');
  track(ops.add(act, 'spawnOne').name('前方生成 1 只'));
  track(ops.add(act, 'spawnGroup').name('生成一群'));
  track(ops.add(act, 'clearFoxes').name('清除狐狸'));
  if (typeof actions.placeDummy === 'function') track(ops.add(act, 'placeDummy').name('放练习木桩'));
  if (typeof actions.removeDummy === 'function') track(ops.add(act, 'removeDummy').name('移除木桩'));
  track(ops.add(act, 'refill').name('回满生命/储备'));
  track(ops.add(act, 'charge').name('充满大招'));
  if (typeof actions.toggleVolumes === 'function') track(ops.add(act, 'toggleVolumes').name('开关攻击范围显示'));
  track(ops.add(act, 'resetAll').name('恢复全部默认值'));
  track(ops.add(act, 'exportCfg').name('导出 JSON'));
  track(ops.add(act, 'importCfg').name('导入 JSON'));

  // —— 预设方案 ——
  const presetFolder = folder(gui, '预设方案');
  const presetState = { name: '', selected: BUILTIN_PRESET_NAME };
  track(presetFolder.add(presetState, 'name').name('方案名称'));
  const presetSelect = document.createElement('select');
  presetSelect.dataset.property = 'selected';
  presetSelect.setAttribute('aria-label', '选择预设');
  const presetSelectRow = addNativeRow(presetFolder, '选择预设', presetSelect);
  void presetSelectRow;
  const presetStatus = document.createElement('div');
  presetStatus.className = 'sandbox-debug-note'; presetStatus.setAttribute('aria-live', 'polite');
  presetStatus.textContent = '出厂默认不可删除';
  presetFolder.$children.appendChild(presetStatus);
  searchableRows.push({ parent: presetFolder, element: presetStatus, name: '预设状态', property: 'status' });
  const storedPresets = () => readSandboxPresets(getStorage());
  const refreshPresetOptions = () => {
    const names = [BUILTIN_PRESET_NAME, ...storedPresets().map((preset) => preset.name)];
    const selected = names.includes(presetState.selected) ? presetState.selected : BUILTIN_PRESET_NAME;
    presetState.selected = selected;
    presetSelect.replaceChildren(...names.map((name) => { const option = document.createElement('option'); option.value = name; option.textContent = name; return option; }));
    presetSelect.value = selected;
  };
  presetSelect.addEventListener('change', () => { presetState.selected = presetSelect.value; });
  const presetActions = {
    save() {
      const name = normalizePresetName(presetState.name);
      const ok = saveSandboxPreset(getStorage(), name, snapshot(), PRESET_STORAGE_KEY);
      presetStatus.textContent = ok ? `已保存预设：${name}` : '保存失败：名称为空/保留，或本地存储不可用';
      if (ok) { presetState.name = ''; presetFolder.controllersRecursive().forEach((controller) => controller.updateDisplay()); presetState.selected = name; refreshPresetOptions(); }
    },
    apply() {
      const selected = presetSelect.value || presetState.selected;
      if (selected === BUILTIN_PRESET_NAME) { act.resetAll(); presetStatus.textContent = '已应用出厂默认'; return; }
      const preset = storedPresets().find((item) => item.name === selected);
      if (!preset) { presetStatus.textContent = '所选预设不存在'; refreshPresetOptions(); return; }
      applySnapshot(preset.snapshot, gui.controllersRecursive(), actions.onReset);
      presetStatus.textContent = `已应用预设：${preset.name}`;
    },
    remove() {
      const selected = presetSelect.value || presetState.selected;
      if (selected === BUILTIN_PRESET_NAME) { presetStatus.textContent = '出厂默认不可删除'; return; }
      const ok = deleteSandboxPreset(getStorage(), selected, PRESET_STORAGE_KEY);
      presetStatus.textContent = ok ? `已删除预设：${selected}` : '删除失败：预设不存在或本地存储不可用';
      if (ok) { presetState.selected = BUILTIN_PRESET_NAME; refreshPresetOptions(); }
    },
  };
  track(presetFolder.add(presetActions, 'save').name('保存当前为预设'));
  track(presetFolder.add(presetActions, 'apply').name('应用所选预设'));
  track(presetFolder.add(presetActions, 'remove').name('删除所选预设'));
  refreshPresetOptions();

  // —— 关卡复现 ——
  const replayFolder = folder(gui, '关卡复现');
  const replayState = { selected: 0 };
  const levels = actions.getLevels?.() || [];
  const levelOptions = Object.fromEntries(levels.map((level, index) => [`第 ${index + 1} 关 · ${level.name || '未命名'}`, index]));
  if (Object.keys(levelOptions).length) track(replayFolder.add(replayState, 'selected', levelOptions).name('选择关卡'));
  const replayStatus = document.createElement('div');
  replayStatus.className = 'sandbox-debug-note'; replayStatus.setAttribute('aria-live', 'polite');
  replayStatus.textContent = '复现仅应用阵容与环境，不开启限时关卡';
  replayFolder.$children.appendChild(replayStatus);
  searchableRows.push({ parent: replayFolder, element: replayStatus, name: '关卡复现提示', property: 'replay' });
  const replayAction = { replay() {
    const result = actions.replicateLevel?.(Number(replayState.selected));
    gui.controllersRecursive().forEach((controller) => controller.updateDisplay());
    replayStatus.textContent = typeof result === 'string' ? result : (result?.summary || '未能复现所选关卡');
  } };
  track(replayFolder.add(replayAction, 'replay').name('复现此关卡配置'));

  // —— 搜索框：按中文名、属性名、完整分组路径即时过滤 ——
  const searchWrap = document.createElement('label'); searchWrap.className = 'sandbox-debug-search';
  const searchLabel = document.createElement('span'); searchLabel.textContent = '搜索数值';
  const searchInput = document.createElement('input'); searchInput.type = 'search'; searchInput.placeholder = '中文名称 / 属性名 / 分组路径';
  searchInput.setAttribute('aria-label', '搜索沙盒数值');
  searchWrap.append(searchLabel, searchInput); gui.domElement.insertBefore(searchWrap, gui.$children);
  const style = document.createElement('style');
  style.textContent = `.lil-gui.root .sandbox-debug-search{display:flex;gap:8px;align-items:center;padding:8px 10px;background:#1a1a1a;color:#ddd;font:12px sans-serif}.lil-gui.root .sandbox-debug-search span{white-space:nowrap}.lil-gui.root .sandbox-debug-search input{min-width:0;flex:1;padding:6px 8px;border:1px solid #555;border-radius:3px;background:#101010;color:#eee;font:inherit}.lil-gui.root .sandbox-debug-row{padding:7px 10px;display:flex;gap:8px;align-items:center;color:#ddd;font:12px sans-serif}.lil-gui.root .sandbox-debug-row span{white-space:nowrap}.lil-gui.root .sandbox-debug-row select{min-width:0;flex:1;padding:5px;background:#202020;color:#eee;border:1px solid #555}.lil-gui.root .sandbox-debug-note{padding:5px 10px;color:#b8d7b3;font:11px/1.4 sans-serif;overflow-wrap:anywhere}`;
  gui.domElement.appendChild(style);

  // 记录稳定的嵌套路径。~序号处理同名兄弟 folder，避免碰撞。
  const collectFolders = (parent, humanPrefix = '', keyPrefix = '') => {
    const counts = new Map();
    for (const child of parent.children || []) {
      if (!child?.domElement || !Array.isArray(child.folders)) continue;
      const title = String(child._title || '');
      const occurrence = (counts.get(title) || 0) + 1; counts.set(title, occurrence);
      const humanPath = humanPrefix ? `${humanPrefix} / ${title}` : title;
      const keyPath = keyPrefix ? `${keyPrefix}/${encodeURIComponent(title)}~${occurrence}` : `${encodeURIComponent(title)}~${occurrence}`;
      child.domElement.dataset.sandboxFolderPath = keyPath;
      const record = { folder: child, humanPath, keyPath };
      folderRecords.push(record); folderRecordByGui.set(child, record);
      collectFolders(child, humanPath, keyPath);
    }
  };
  [pJump, pStand, pLunge, pDodge, pVol, fTypes, fAtk].forEach((item) => defaultClosedFolders.add(item));
  collectFolders(gui);

  const storedOpen = (() => {
    try {
      const raw = getStorage()?.getItem(FOLDER_STORAGE_KEY); if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.version === 1 && parsed.open && typeof parsed.open === 'object' ? parsed.open : null;
    } catch (error) { console.warn('[sandbox-debug] 分组状态读取失败，使用默认折叠', error); return null; }
  })();
  folderOpenState = new Map(folderRecords.map(({ folder, keyPath }) => [keyPath, storedOpen && Object.prototype.hasOwnProperty.call(storedOpen, keyPath) ? !!storedOpen[keyPath] : !defaultClosedFolders.has(folder)]));
  const writeFolderState = () => {
    const storage = getStorage(); if (!storage) return;
    try { storage.setItem(FOLDER_STORAGE_KEY, JSON.stringify({ version: 1, open: Object.fromEntries(folderOpenState) })); }
    catch (error) { console.warn('[sandbox-debug] 分组状态保存失败', error); }
  };
  for (const { folder, keyPath } of folderRecords) folder.open(folderOpenState.get(keyPath));

  const applySearch = () => {
    isApplyingSearch = true;
    const visit = (current) => {
      const currentRecord = folderRecordByGui.get(current);
      const currentPath = currentRecord?.humanPath || '';
      let matched = false;
      for (const child of current.children || []) {
        if (child?.domElement && Array.isArray(child.folders)) {
          const childMatched = visit(child);
          const childPath = folderRecordByGui.get(child)?.humanPath || '';
          const childState = sandboxFolderSearchState(searchQuery, childPath, childMatched);
          child.show(childState.visible);
          if (searchQuery.trim()) child.open(childState.open);
          else child.open(folderOpenState.get(folderRecordByGui.get(child)?.keyPath));
          matched ||= childMatched || (searchQuery.trim() && matchesSandboxSearch(searchQuery, { path: childPath }));
        } else if (child?.domElement && child.property != null) {
          const found = matchesSandboxSearch(searchQuery, { name: child._name, property: child.property, path: currentPath });
          child.domElement.style.display = found ? '' : 'none'; matched ||= found;
        }
      }
      for (const row of searchableRows) {
        if (row.parent !== current) continue;
        const found = matchesSandboxSearch(searchQuery, { name: row.name, property: row.property, path: currentPath });
        row.element.style.display = found ? '' : 'none'; matched ||= found;
      }
      return !!matched;
    };
    for (const child of gui.children || []) {
      if (!child?.domElement || !Array.isArray(child.folders)) continue;
      const childMatched = visit(child);
      const childPath = folderRecordByGui.get(child)?.humanPath || '';
      const childState = sandboxFolderSearchState(searchQuery, childPath, childMatched);
      child.show(childState.visible);
      if (searchQuery.trim()) child.open(childState.open);
      else child.open(folderOpenState.get(folderRecordByGui.get(child)?.keyPath));
    }
    isApplyingSearch = false;
  };
  searchInput.addEventListener('input', () => { searchQuery = searchInput.value; applySearch(); });
  searchInput.addEventListener('keydown', (event) => event.stopPropagation());
  gui.onOpenClose((changed) => {
    if (isApplyingSearch || searchQuery.trim()) return;
    const record = folderRecordByGui.get(changed); if (!record) return;
    folderOpenState.set(record.keyPath, !changed._closed); writeFolderState();
  });
  applySearch();

  return {
    gui,
    controllers,
    config: { PLAYER, FOX, STRIKE_VOLUMES },
    save() { try { getStorage()?.setItem(CFG_KEY, JSON.stringify(snapshot())); } catch (_) {} },
    loadSaved() {
      try {
        const raw = getStorage()?.getItem(CFG_KEY); if (!raw) return false;
        applySnapshot(JSON.parse(raw), gui.controllersRecursive(), actions.onReset); return true;
      } catch (_) { return false; }
    },
    destroy() { gui.destroy(); },
  };
}
