/** Small pure helper so the disabled-path behavior can be asserted in Node. */
export function isSplatEnabled(config) {
  return Boolean(config && config.splat && config.splat.enabled === true);
}

export function mountSplatWhenEnabled(config, mount) {
  if (!isSplatEnabled(config)) return false;
  if (typeof mount === 'function') mount();
  return true;
}
