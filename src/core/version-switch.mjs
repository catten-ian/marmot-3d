/**
 * 版本通道切换（设置面板内使用）。
 *
 * 三条线上线路径（同源部署）：
 *   stable → /marmot3d/
 *   beta   → /marmot3d-beta/
 *   dev    → /marmot3d/?version=dev
 *
 * 切版用整页跳转（最稳）；切版时丢弃 test/sandbox/webgl 等临时查询参数，
 * 避免把某条线的调试开关带到另一条线。
 *
 * 本模块不读取模块加载期的浏览器全局，location 通过参数注入，便于 Node 测试。
 */

export const STABLE_BASE = '/marmot3d/';
export const BETA_BASE = '/marmot3d-beta/';

export const VERSION_CHANNELS = [
  {
    id: 'stable',
    name: '正式版',
    short: 'Stable',
    desc: 'v1.0 正式发布，神经—体液调节抽象玩法演示。',
    base: STABLE_BASE,
    query: '',
  },
  {
    id: 'beta',
    name: 'BETA 体验版',
    short: 'Beta',
    desc: '新特性预览，默认开放全部关卡，存档与正式版隔离。',
    base: BETA_BASE,
    query: '',
  },
  {
    id: 'dev',
    name: 'DEV 开发版',
    short: 'Dev',
    desc: 'A Verdant Trail 写实环境 + 旱獭真实生态学实验。',
    base: STABLE_BASE,
    query: 'version=dev',
  },
];

export function getVersionChannel(id) {
  return VERSION_CHANNELS.find((c) => c.id === id) || null;
}

function normalizePath(pathname) {
  if (!pathname) return STABLE_BASE;
  // 统一成以 / 结尾，便于替换基路径。
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

/**
 * 计算切到目标通道的同站完整 URL。
 * @param {string} channelId stable|beta|dev
 * @param {{pathname?:string, origin?:string}} loc
 */
export function channelHref(channelId, loc = {}) {
  const ch = getVersionChannel(channelId);
  if (!ch) throw new Error(`unknown version channel: ${channelId}`);
  const pathname = normalizePath(loc.pathname || (typeof location !== 'undefined' ? location.pathname : STABLE_BASE));
  const origin = loc.origin || (typeof location !== 'undefined' ? location.origin : '');
  const onBetaTree = pathname.includes('/marmot3d-beta/');
  const onStableTree = pathname.includes('/marmot3d/');

  let path;
  if (ch.id === 'beta') {
    path = BETA_BASE; // 跨部署，固定基路径
  } else if (onStableTree || onBetaTree) {
    path = STABLE_BASE; // stable / dev 都在 /marmot3d/
  } else {
    // 本地或未知根路径（如 file://、本地静态服）：留在当前路径，只改查询参数。
    path = pathname;
  }
  const search = ch.query ? `?${ch.query}` : '';
  return `${origin}${path}${search}`;
}

/** 设置面板用的当前通道 + 可选项（含跳转 href）。 */
export function versionSwitchModel(currentVersion, loc = {}) {
  const current = VERSION_CHANNELS.some((c) => c.id === currentVersion) ? currentVersion : 'stable';
  return {
    current,
    options: VERSION_CHANNELS.map((c) => ({
      ...c,
      current: c.id === current,
      href: channelHref(c.id, loc),
    })),
  };
}
