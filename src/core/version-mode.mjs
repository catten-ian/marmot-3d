/** Resolve the product mode from the URL without touching browser globals. */
export function resolveVersion({ search = '', pathname = '/' } = {}) {
  const queryVersion = new URLSearchParams(search).get('version');
  const isBetaPath = pathname === '/marmot3d-beta'
    || pathname.startsWith('/marmot3d-beta/');
  // The deployed beta pathname is authoritative, while the normal shell uses
  // the explicit query switch for the separate dev experiment.
  if (queryVersion === 'beta' || isBetaPath) return 'beta';
  if (queryVersion === 'dev') return 'dev';
  return 'stable';
}

/**
 * 计算浏览器标签页标题。
 * beta / dev 附加通道后缀，便于多开时一眼区分；stable 返回 null，
 * 表示保持 index.html 的静态 <title> 不动（SEO 文案不被污染）。
 */
export function documentTitleFor(version, base = '土拨鼠大作战 3D') {
  if (version === 'beta') return `${base} · Beta`;
  if (version === 'dev') return `${base} · Dev`;
  return null;
}
