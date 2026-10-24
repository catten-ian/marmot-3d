/**
 * 键位 + 触控/HUD 布局 + 音量/画质偏好的「导入 / 导出」纯逻辑（beta）。
 *
 * 导出：buildConfigExport 汇总当前生效配置为带 schemaVersion 的 JSON 对象，
 *       并标明导出时的输入模式（touch / keyboard）。
 * 导入：sanitizeConfig 做白名单 + 钳制校验，返回可直接交给各子系统
 *       （Keybinds.applyImported / TouchLayout.importLayout / Audio.setSettings …）
 *       的干净配置；非法字段被忽略并列入 warnings，绝不抛异常打断界面。
 *
 * 本模块不触碰 DOM / localStorage，node:test 可直接覆盖。
 */
import { ACTIONS, normalizeControlMode } from './keybinds.js';
import { normalizeAudioSettings } from '../systems/audio.js';
import { normalizeGraphicsPreference } from './graphics-preference.js';
import { normalizeInputMode, INPUT_MODES } from './input-mode.mjs';

export const CONFIG_SCHEMA_VERSION = 1;
export const CONFIG_APP = 'marmot3d';

const SCHEMES = ['compatible', 'optimized', 'custom'];
const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));
// KeyboardEvent.code 白名单格式：KeyW / Digit3 / ArrowUp / ShiftLeft / F11 / Escape …
const KEY_CODE_RE = /^(?:Key[A-Z]|Digit[0-9]|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Arrow(?:Up|Down|Left|Right)|F(?:[1-9]|1[0-9]|2[0-4])|(?:Space|Escape|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|ContextMenu|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|MetaLeft|MetaRight))$/;
const TOP_LEVEL_KEYS = ['schemaVersion', 'app', 'channel', 'exportedAt', 'inputMode', 'keybinds', 'touchLayout', 'audio', 'graphics', 'inputModePreference'];

function sanitizeKeyValue(value) {
  // 合法形态：单个 code 字符串、null（未绑定）、code 数组（多键）。
  if (value == null) return null;
  if (typeof value === 'string') return KEY_CODE_RE.test(value) ? value : undefined;
  if (Array.isArray(value)) {
    const codes = value.filter((code) => typeof code === 'string' && KEY_CODE_RE.test(code));
    return codes.length ? codes : [];
  }
  return undefined; // 非法类型：忽略
}

/** 组装导出对象。所有字段读取失败都不应阻断导出。 */
export function buildConfigExport({
  binds = null, layout = null, audioSettings = null,
  graphicsPreference = 'auto', inputModePreference = 'auto',
  inputModeEffective = 'keyboard', channel = 'beta', now = new Date(),
} = {}) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    app: CONFIG_APP,
    channel,
    exportedAt: now instanceof Date ? now.toISOString() : String(now),
    // 标明导出时的输入模式：键鼠 / 触控两种模式都能导出，导入方据此了解上下文。
    inputMode: inputModeEffective === 'touch' ? 'touch' : 'keyboard',
    keybinds: binds ? {
      scheme: binds.scheme,
      controlMode: normalizeControlMode(binds.controlMode),
      custom: { ...binds.custom },
    } : undefined,
    touchLayout: layout ? JSON.parse(JSON.stringify(layout)) : undefined,
    audio: audioSettings ? normalizeAudioSettings(audioSettings) : undefined,
    graphics: normalizeGraphicsPreference(graphicsPreference),
    inputModePreference: normalizeInputMode(inputModePreference),
  };
}

export function configExportFilename(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `marmot3d-beta-config-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

const LAYOUT_BUTTON_IDS = ['attack', 'dodge', 'jump', 'interact', 'burst', 'ultimate', 'pause', 'sandboxControl'];
const LAYOUT_CARD_IDS = ['hudVitals', 'hudMission', 'hudObjective', 'hudSandbox', 'hudMinimap', 'hudViewMode'];
const LAYOUT_TOP_KEYS = ['scale', 'opacity', 'buttons', 'cards', 'joystick', 'attackCoreSize', 'attackCoreOpacity'];
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function cleanLayoutItem(source, allowed, ranges, prefix, warnings, ignored) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    warnings.push(`${prefix} 类型非法，已忽略。`);
    return null;
  }
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (!allowed.includes(key)) { ignored.push(`${prefix}.${key}`); continue; }
    const range = ranges[key];
    if (!range) { out[key] = value; continue; }
    const n = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(n)) {
      warnings.push(`${prefix}.${key} 非法，已忽略。`);
      continue;
    }
    const next = clamp(n, range[0], range[1]);
    if (next !== n) warnings.push(`${prefix}.${key} 越界，已钳制到 ${next}。`);
    out[key] = next;
  }
  return out;
}

function sanitizeLayout(raw, warnings, ignored) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('touchLayout 类型非法，已忽略。');
    return null;
  }
  const out = {};
  const topRanges = {
    scale: [0.65, 1.5], opacity: [0.3, 1],
    attackCoreSize: [0.4, 1], attackCoreOpacity: [0.3, 1],
  };
  for (const [key, value] of Object.entries(raw)) {
    if (!LAYOUT_TOP_KEYS.includes(key)) { ignored.push(`touchLayout.${key}`); continue; }
    if (key === 'buttons' || key === 'cards') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        warnings.push(`touchLayout.${key} 类型非法，已忽略。`); continue;
      }
      const ids = key === 'buttons' ? LAYOUT_BUTTON_IDS : LAYOUT_CARD_IDS;
      const itemKeys = key === 'buttons'
        ? ['x', 'y', 'scale', 'opacity', 'coreSize', 'coreOpacity'] : ['x', 'y', 'scale', 'opacity'];
      const itemRanges = key === 'buttons'
        ? { x: [0, 1], y: [0, 1], scale: [0.65, 1.5], opacity: [0.3, 1], coreSize: [0.4, 1], coreOpacity: [0.3, 1] }
        : { x: [0, 1], y: [0, 1], scale: [0.75, 1.25], opacity: [0.35, 1] };
      const clean = {};
      for (const [id, item] of Object.entries(value)) {
        if (!ids.includes(id)) { ignored.push(`touchLayout.${key}.${id}`); continue; }
        const result = cleanLayoutItem(item, itemKeys, itemRanges, `touchLayout.${key}.${id}`, warnings, ignored);
        if (result) clean[id] = result;
      }
      out[key] = clean;
    } else if (key === 'joystick') {
      const result = cleanLayoutItem(value,
        ['x', 'y', 'scale', 'sprintThreshold'],
        { x: [0, 1], y: [0, 1], scale: [0.7, 1.4], sprintThreshold: [0.55, 0.95] },
        'touchLayout.joystick', warnings, ignored);
      if (result) out.joystick = result;
    } else {
      const n = Number(value), range = topRanges[key];
      if (typeof value !== 'number' || !Number.isFinite(n)) { warnings.push(`touchLayout.${key} 非法，已忽略。`); continue; }
      const next = clamp(n, range[0], range[1]);
      if (next !== n) warnings.push(`touchLayout.${key} 越界，已钳制到 ${next}。`);
      out[key] = next;
    }
  }
  return out;
}

function sanitizeAudio(raw, warnings, ignored) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('audio 字段类型非法，已忽略。'); return null;
  }
  const out = {};
  const allowed = ['masterVolume', 'sfxVolume', 'bgmVolume', 'sfxEnabled', 'bgmEnabled'];
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key)) { ignored.push(`audio.${key}`); continue; }
    if (key.endsWith('Enabled')) {
      if (typeof value !== 'boolean') { warnings.push(`audio.${key} 非法，已忽略。`); continue; }
      out[key] = value;
    } else {
      const n = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(n)) { warnings.push(`audio.${key} 非法，已忽略。`); continue; }
      const next = clamp(n, 0, 100);
      if (next !== n) warnings.push(`audio.${key} 越界，已钳制到 ${next}。`);
      out[key] = next;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * 校验并清洗导入配置。
 * 返回 { ok, config?, error?, warnings[], ignored[] }：
 *  - ok=false 时 error 为用户可读原因（schema 不符 / 不是 JSON 对象等）；
 *  - warnings 记录被钳制或忽略的非法值，供页面内提示条展示。
 */
export function sanitizeConfig(raw) {
  const warnings = [];
  const ignored = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: '文件内容不是有效的配置 JSON 对象。', warnings, ignored };
  }
  if (raw.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `配置 schemaVersion 不匹配：期望 ${CONFIG_SCHEMA_VERSION}，实际 ${JSON.stringify(raw.schemaVersion ?? '缺失')}。`,
      warnings, ignored,
    };
  }
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.includes(key)) ignored.push(key);
  }

  const config = {};
  if (raw.keybinds != null) {
    if (typeof raw.keybinds !== 'object') {
      warnings.push('keybinds 字段类型非法，已忽略。');
    } else {
      const kb = {};
      if (raw.keybinds.scheme != null) {
        if (SCHEMES.includes(raw.keybinds.scheme)) kb.scheme = raw.keybinds.scheme;
        else warnings.push(`未知键位方案 ${JSON.stringify(raw.keybinds.scheme)}，已忽略。`);
      }
      if (raw.keybinds.controlMode != null) {
        const mode = normalizeControlMode(raw.keybinds.controlMode, null);
        if (mode) kb.controlMode = mode;
        else warnings.push(`未知操控模式 ${JSON.stringify(raw.keybinds.controlMode)}，已忽略。`);
      }
      if (raw.keybinds.custom != null) {
        if (typeof raw.keybinds.custom !== 'object') {
          warnings.push('keybinds.custom 字段类型非法，已忽略。');
        } else {
          const custom = {};
          for (const [actionId, value] of Object.entries(raw.keybinds.custom)) {
            if (!ACTION_IDS.has(actionId)) { ignored.push(`keybinds.custom.${actionId}`); continue; }
            const clean = sanitizeKeyValue(value);
            if (clean === undefined) warnings.push(`动作 ${actionId} 的键位 ${JSON.stringify(value)} 非法，已忽略。`);
            else custom[actionId] = clean;
          }
          kb.custom = custom;
        }
      }
      if (Object.keys(kb).length) config.keybinds = kb;
    }
  }
  if (raw.touchLayout != null) {
    const layout = sanitizeLayout(raw.touchLayout, warnings, ignored);
    if (layout && Object.keys(layout).length) config.touchLayout = layout;
  }
  if (raw.audio != null) {
    const audio = sanitizeAudio(raw.audio, warnings, ignored);
    if (audio) config.audio = audio;
  }
  if (raw.graphics != null) {
    const pref = normalizeGraphicsPreference(raw.graphics);
    if (pref !== raw.graphics) warnings.push(`图形偏好 ${JSON.stringify(raw.graphics)} 非法，已回退为 auto。`);
    config.graphics = pref;
  }
  if (raw.inputModePreference != null) {
    if (INPUT_MODES.includes(raw.inputModePreference)) config.inputModePreference = raw.inputModePreference;
    else warnings.push(`输入模式偏好 ${JSON.stringify(raw.inputModePreference)} 非法，已忽略。`);
  }
  if (!Object.keys(config).length) {
    return { ok: false, error: '配置内容为空：没有可导入的有效字段。', warnings, ignored };
  }
  return { ok: true, config, warnings, ignored };
}

/** 解析导入文件文本；JSON 语法错误也走统一失败路径。 */
export function parseConfigText(text) {
  try {
    return sanitizeConfig(JSON.parse(String(text)));
  } catch (_) {
    return { ok: false, error: '文件不是合法的 JSON。', warnings: [], ignored: [] };
  }
}
