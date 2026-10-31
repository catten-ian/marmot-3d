export const STABLE_PROGRESS_KEY = 'marmot3d.progress.v1';
export const BETA_PROGRESS_KEY = 'marmot3d.progress.beta.v1';

export function progressStorageKey(isBeta) {
  return isBeta ? BETA_PROGRESS_KEY : STABLE_PROGRESS_KEY;
}

/** Read progress while keeping beta unlock defaults and persistence isolated. */
export function readProgress(storage, levelCount, isBeta = false) {
  const defaultMaxUnlocked = isBeta ? Math.max(0, levelCount - 1) : 0;
  try {
    const saved = JSON.parse(storage.getItem(progressStorageKey(isBeta)) || '{}');
    const persistedMax = Number.isInteger(saved.maxUnlocked) ? saved.maxUnlocked : 0;
    const completedLevels = Array.isArray(saved.completedLevels)
      ? saved.completedLevels.filter((n) => Number.isInteger(n) && n >= 0 && n < levelCount)
      : [];
    return {
      maxUnlocked: isBeta
        ? defaultMaxUnlocked
        : Math.max(0, Math.min(persistedMax, levelCount - 1)),
      completedLevels: new Set(completedLevels),
    };
  } catch (_) {
    return { maxUnlocked: defaultMaxUnlocked, completedLevels: new Set() };
  }
}

export function writeProgress(storage, progress, isBeta = false) {
  storage.setItem(progressStorageKey(isBeta), JSON.stringify({
    maxUnlocked: progress.maxUnlocked,
    completedLevels: [...progress.completedLevels],
  }));
}

export function isLevelUnlocked(progress, levelIndex) {
  return Number.isInteger(levelIndex) && levelIndex >= 0 && levelIndex <= progress.maxUnlocked;
}
