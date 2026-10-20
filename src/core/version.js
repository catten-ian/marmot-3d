/**
 * 版本开关：?version=dev
 *
 * 目的：把「A Verdant Trail 环境 + 旱獭真实生态学改写」的实验性改动隔离在 dev 版，
 * 正式版（默认）保持原样，便于随时对照与回退。
 *
 * 用法：
 *   index.html              → 正式版
 *   index.html?version=dev  → dev 版（生态学改写）
 *
 * 设计原则：dev 独有环境通过显式动态加载隔离；稳定版只走原有渲染与资产路径。
 * dev 独有内容用 DEV_FEATURES 显式列出，正式版读不到它们，
 * 这样即使 dev 分支出问题，也不会污染正式版路径。
 */

/** 当前版本模式 */
export const VERSION = (() => {
  try {
    const q = new URLSearchParams(location.search).get('version');
    return q === 'dev' ? 'dev' : 'stable';
  } catch (e) {
    return 'stable';
  }
})();

export const IS_DEV = VERSION === 'dev';

/** 供 UI 显示当前版本角标 */
export const VERSION_LABEL = IS_DEV
  ? 'DEV · A Verdant Trail 环境 + 旱獭生态'
  : '神经—体液调节 · 抽象玩法演示';

/**
 * dev 版专属特性清单。
 * 正式版应保持这些开关为 false，从而走原有代码路径。
 */
export const DEV_FEATURES = {
  /** 采食对象改为草本植物（沙草、禾本科、豆科花等） */
  herbivoreFood: IS_DEV,
  /** 耐饥渴：储备消耗降低、见底惩罚放宽 */
  famineTolerance: IS_DEV,
  /** 季节性食物：各关按 levelIndex 循环映射不同季节的适口植物 */
  seasonalFood: IS_DEV,
  /** 富含亚油酸的食物给予额外储备 */
  linoleicBonus: IS_DEV,
  /**
   * **GS 全场景（legacy）**：保留旧诊断路径，正常 dev 改用 Verdant Trail。
   *
   * 该路径只供旧诊断覆盖开关使用：
   * 需要 WebGPURenderer（GaussianSplat 不支持经典 WebGLRenderer）。
   */
  gsWorld: false,
  /** Offline A Verdant Trail render + sampled ground, only for ?version=dev. */
  verdantWorld: IS_DEV,
  /** Explicit intelligent fox sandbox control; never available outside DEV. */
  smartFoxSandbox: IS_DEV,
};

/** 是否启用某 dev 特性（正式版恒为 false） */
export function devOn(key) {
  return IS_DEV && DEV_FEATURES[key] === true;
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
