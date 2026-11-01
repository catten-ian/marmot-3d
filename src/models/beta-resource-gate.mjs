/** Pure, browser independent entry gate coordinator for Beta resources. */
export function createResourceEntryGate({ resources, audioReady, onProgress = () => {}, onError = () => {} } = {}) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('resources must be a non-empty array');
  let promise = null;
  let failed = null;
  let entered = false;
  const run = async () => {
    let done = 0;
    const settle = async (resource) => {
      try {
        const value = await resource.load();
        if (typeof resource.validate === 'function') await resource.validate(value);
        done += 1; onProgress({ done, total: resources.length + 1, resource: resource.id });
        return value;
      } catch (error) {
        error.resourceId = resource.id;
        throw error;
      }
    };
    try {
      const values = await Promise.all(resources.map(settle));
      if (typeof audioReady !== 'function') throw new Error('音频进入门未提供 ready()');
      await audioReady();
      done += 1; onProgress({ done, total: resources.length + 1, resource: 'audio' });
      return { values, audio: true };
    } catch (error) {
      failed = error;
      onError(error);
      throw error;
    }
  };
  return {
    enter(task) {
      if (failed) { promise = null; entered = false; }
      if (!promise) promise = run();
      return promise.then(() => { if (entered) return; entered = true; return task?.(); });
    },
    preload() { if (!promise) promise = run(); return promise; },
    get pending() { return !!promise && !failed; },
    get error() { return failed; },
    reset() { resources.forEach((resource) => { try { resource.reset?.(); } catch (_) {} }); failed = null; promise = null; entered = false; },
  };
}
