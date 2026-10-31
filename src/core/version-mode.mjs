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
