/** Pure, browser independent entry gate coordinator for Beta resources. */
export function createResourceEntryGate({ resources, audioReady, onProgress = () => {}, onError = () => {} } = {}) {
  if (!Array.isArray(resources) || !resources.length) throw new TypeError('resources must be a non-empty array');
  let readyPromise = null;
  let failed = null;
  const failedResources = new Set();
  let loading = false;
  let batchPromise = null;
  const successful = new Map();
  const run = async () => {
    loading = true;
    let done = 0;
    const settle = async (resource) => {
      try {
        if (successful.has(resource.id)) {
          done += 1; onProgress({ done, total: resources.length + 1, resource: resource.id });
          return successful.get(resource.id);
        }
        const value = await resource.load();
        if (typeof resource.validate === 'function') await resource.validate(value);
        successful.set(resource.id, value);
        done += 1; onProgress({ done, total: resources.length + 1, resource: resource.id });
        return value;
      } catch (error) {
        successful.delete(resource.id);
        failedResources.add(resource.id);
        if (error && !error.resourceId) error.resourceId = resource.id;
        throw error;
      }
    };
    try {
      // Wait for every initializer to settle before allowing a retry to replace it.
      const results = await Promise.allSettled(resources.map(settle));
      const rejected = results.find((result) => result.status === 'rejected');
      if (rejected) throw rejected.reason;
      const values = results.map((result) => result.value);
      if (typeof audioReady !== 'function') throw new Error('音频进入门未提供 ready()');
      await audioReady();
      done += 1; onProgress({ done, total: resources.length + 1, resource: 'audio' });
      return { values, audio: true };
    } catch (error) {
      failed = error;
      onError(error);
      throw error;
    } finally {
      loading = false;
    }
  };
  const getReady = () => { if (!readyPromise) readyPromise = run(); return readyPromise; };
  return {
    /** Concurrent callers share one batch and only the first task runs. */
    enter(task) {
      if (failed) return Promise.reject(failed);
      if (batchPromise) return batchPromise;
      batchPromise = getReady().then(() => task?.()).finally(() => {
        batchPromise = null;
      });
      return batchPromise;
    },
    preload() { return getReady(); },
    get pending() { return loading; },
    get error() { return failed; },
    /** Retry only the failed model/resource; successful resource promises remain cached. */
    reset() {
      if (loading || batchPromise) return;
      for (const id of failedResources) {
        successful.delete(id);
        resources.find((resource) => resource.id === id)?.reset?.();
      }
      failedResources.clear();
      readyPromise = null; failed = null;
    },
  };
}
