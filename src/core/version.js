import { resolveVersion } from './version-mode.mjs';

/**
 * 版本开关：?version=dev / ?version=beta
 *
 * 目的：把「按旱獭真实生态学改写」的实验性改动隔离在 dev 版，
 * 正式版（默认）保持原样，便于随时对照与回退。
 *
 * 用法：
 *   index.html              → 正式版
 *   index.html?version=dev  → dev 版（生态学改写）
 *
 * 设计原则：开关只影响**数据与文案**，不改渲染架构。
 * dev 独有内容用 DEV_FEATURES 显式列出，正式版读不到它们，
 * 这样即使 dev 分支出问题，也不会污染正式版路径。
 */

/** 当前版本模式：stable、beta 或 dev。 */
export const VERSION = (() => {
  try {
    return resolveVersion({ search: location.search, pathname: location.pathname });
  } catch (e) {
    return 'stable';
  }
})();

export const IS_DEV = VERSION === 'dev';
export const IS_BETA = VERSION === 'beta';

/**
 * 构建戳：与 public shell（index.html / index-public.html）里资源 URL 的
 * ?v= 参数保持一致，供设置面板"当前版本"一行展示。
 * 发布新版本时由主代理统一升级 shell 戳与本常量，日常修复不动它。
 */
export const BUILD_STAMP = 'rev52';

/** 通道短名（Stable/Beta/Dev），供设置面板等只读展示。 */
export const CHANNEL_SHORT = IS_DEV ? 'Dev' : IS_BETA ? 'Beta' : 'Stable';

/** 供 UI 显示当前版本角标 */
export const VERSION_LABEL = IS_DEV
  ? 'DEV · 旱獭生态 + GS 全场景'
  : IS_BETA
    ? 'BETA · 体验版（全部关卡开放）'
    : '神经—体液调节 · 抽象玩法演示';

/**
 * dev 版专属特性清单。
 * 正式版应保持这些开关为 false，从而走原有代码路径。
 */
export const DEV_FEATURES = {
  /** 采食对象改为草本植物（沙草、禾本科、豆科花等） */
  herbivoreFood: IS_DEV || IS_BETA,
  /** 耐饥渴：储备消耗降低、见底惩罚放宽 */
  famineTolerance: IS_DEV,
  /** 季节性食物：各关按 levelIndex 循环映射不同季节的适口植物 */
  seasonalFood: IS_DEV || IS_BETA,
  /** 富含亚油酸的食物给予额外储备 */
  linoleicBonus: IS_DEV,
  /**
   * **GS 全场景**：把摄影测量高斯泼溅当作全部场景（含可行走地面）。
   *
   * 与前四项性质不同 —— 前四项只改数据与文案，这一项改**渲染架构**：
   * 需要 WebGPURenderer（GaussianSplat 不支持经典 WebGLRenderer）。
   * 因此它需要 index.html 的引导层做异步初始化，不能在同步模块里建渲染器。
   */
  gsWorld: IS_DEV,
};

/**
 * 是否启用某实验特性。
 * 是否启用完全由 DEV_FEATURES[key] 决定——每个特性自身已编码
 * 它是 dev 专属（IS_DEV）还是 dev+beta（IS_DEV||IS_BETA），
 * 因此这里不能再额外 AND 上 IS_DEV，否则 beta 永远读不到 beta 开放的特性。
 * stable（既非 dev 也非 beta）下所有 DEV_FEATURES 均为 false，恒返回 false。
 */
export function devOn(key) {
  return DEV_FEATURES[key] === true;
}

/**
 * 是否使用真实摄影测量模型（assets/models/*.glb）。
 * 可用 `?models=off` 强制关闭，回退到程序化建模 —— 便于对比与排障。
 * 模型缺失时 loader 也会自动回退，这里只是提供一个显式开关。
 */
export const USE_REAL_MODELS = (() => {
  try {
    return new URLSearchParams(location.search).get('models') !== 'off';
  } catch (e) {
    return true;
  }
})();

/**
 * dev 版使用分块藏狐模型以驱动四肢跑步循环；正式版继续使用原有狐狸资产。
 * `foxmodel=off` 可强制回退到程序化模型，便于视觉对照与排障。
 */
export const USE_REAL_FOX_MODEL = (() => {
  try {
    return USE_REAL_MODELS && new URLSearchParams(location.search).get('foxmodel') !== 'off';
  } catch (e) {
    return true;
  }
})();

/**
 * dev 版是否强制走 WebGL2 路径（跳过 WebGPU 检测）。
 * 用途：在没有 WebGPU 的环境（CI、headless、无独显机器）下验证 GS 场景内容。
 * 调试参数：`?version=dev&webgl=1`
 */
export const FORCE_WEBGL = (() => {
  try {
    return new URLSearchParams(location.search).get('webgl') === '1';
  } catch (e) {
    return false;
  }
})();

/**
 * GS 全场景的显式覆盖开关（独立于 version=dev）。
 *   ?gs=1 —— 即使在正式版也强制启用 GS 全场景（需 WebGPU，或配 webgl=1），
 *            便于在不切 dev 数据的情况下排查渲染/坐标问题；
 *   ?gs=0 —— 即使在 dev 版也强制关闭 GS，回退到程序化场景。
 * 缺省时跟随 dev 特性（仅 ?version=dev 启用）。
 */
export const GS_OVERRIDE = (() => {
  try {
    const v = new URLSearchParams(location.search).get('gs');
    if (v === '1') return true;
    if (v === '0') return false;
    return null;
  } catch (e) {
    return null;
  }
})();
