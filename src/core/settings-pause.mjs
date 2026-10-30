/** Route the shared settings panel's pause/resume requests to the active mode. */
export function createSettingsPauseHooks({ getPaf = () => null, normal = {} } = {}) {
  const activePaf = () => {
    const paf = getPaf?.();
    return paf?.active ? paf : null;
  };
  return {
    pause() {
      const paf = activePaf();
      if (paf) paf.setPaused?.(true);
      else normal.pause?.();
    },
    resume() {
      const paf = activePaf();
      if (paf) paf.setPaused?.(false);
      else normal.resume?.();
    },
    isPaused() {
      const paf = activePaf();
      return paf ? !!paf.paused : !!normal.isPaused?.();
    },
    isPlaying() {
      return !!activePaf() || !!normal.isPlaying?.();
    },
  };
}
