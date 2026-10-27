/** Pure memory budget helpers for dev-only large asset loading. */
export function getMemorySnapshot(memory = globalThis.performance?.memory) {
  if (!memory || !Number.isFinite(Number(memory.jsHeapSizeLimit))) return null;
  return {
    usedJSHeapSize: Math.max(0, Number(memory.usedJSHeapSize) || 0),
    jsHeapSizeLimit: Math.max(0, Number(memory.jsHeapSizeLimit) || 0),
  };
}

export function memoryBudgetFor({ snapshot = getMemorySnapshot(), reserveBytes = 256 * 1024 * 1024, maxFraction = 0.82 } = {}) {
  if (!snapshot) return null;
  const byFraction = snapshot.jsHeapSizeLimit * Math.min(0.95, Math.max(0.5, Number(maxFraction) || 0.82));
  return Math.max(0, Math.min(byFraction, snapshot.jsHeapSizeLimit - Math.max(0, Number(reserveBytes) || 0)));
}

export function exceedsMemoryBudget({ snapshot = getMemorySnapshot(), extraBytes = 0, reserveBytes = 256 * 1024 * 1024, maxFraction = 0.82 } = {}) {
  const budget = memoryBudgetFor({ snapshot, reserveBytes, maxFraction });
  if (budget == null) return false;
  return snapshot.usedJSHeapSize + Math.max(0, Number(extraBytes) || 0) > budget;
}
