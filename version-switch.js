/* Small relative-path stable/dev switch for the shared /marmot3d/ tree. */
(() => {
  const script = document.currentScript;
  const current = script?.dataset.current === 'dev' ? 'dev' : 'stable';
  const params = new URLSearchParams(location.search);
  const isDev = params.get('version') === 'dev';
  const link = document.createElement('a');
  const next = new URL(location.href);
  if (isDev) next.searchParams.delete('version');
  else next.searchParams.set('version', 'dev');
  link.href = `${next.pathname}${next.search}${next.hash}`;
  link.textContent = isDev ? '稳定版' : 'DEV';
  link.title = isDev ? '切换到稳定版' : '切换到 DEV 版';
  link.setAttribute('aria-label', link.title);
  Object.assign(link.style, {
    position: 'fixed', right: '12px', bottom: '10px', zIndex: '70',
    padding: '5px 9px', border: '1px solid rgba(214,232,189,.45)',
    borderRadius: '14px', color: '#e5edda', background: 'rgba(8,20,13,.62)',
    font: '600 10px/1.2 system-ui,sans-serif', textDecoration: 'none',
    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
  });
  link.dataset.current = current;
  document.body.appendChild(link);
})();
