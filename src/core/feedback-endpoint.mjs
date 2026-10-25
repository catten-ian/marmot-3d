/** Select the same-origin collector route for the active page/channel. */
export function deriveFeedbackEndpoint(locationLike) {
  if (!locationLike) return '/marmot3d/api/feedback';
  const protocol = String(locationLike.protocol || '').toLowerCase();
  if (protocol === 'file:') return '/marmot3d/api/feedback';
  const pathname = String(locationLike.pathname || '/');
  const queryVersion = new URLSearchParams(String(locationLike.search || '')).get('version');
  const isBetaPath = pathname === '/marmot3d-beta' || pathname.startsWith('/marmot3d-beta/');
  if (isBetaPath || queryVersion === 'beta') return '/marmot3d-beta/api/feedback';
  return '/marmot3d/api/feedback';
}
