/** Pure beta BGM metadata and selection decisions. */
// gain = 10^((targetLufs - measuredLufs) / 20)，把各曲目实测响度归一到 -16 LUFS。
// combat 的三个变体实测响度不同，增益按 assetKey（combat / combat-b / combat-c）分别取值。
export const BGM_TRACK_META = Object.freeze({
  menu: Object.freeze({ introSec: 4, gain: 1.36 }),
  explore: Object.freeze({ introSec: 6, gain: 1.22 }),
  tension: Object.freeze({ introSec: 5, gain: 1.88 }),
  combat: Object.freeze({ variants: Object.freeze(['combat', 'combat-b', 'combat-c']), introSec: 5, gain: 0.56 }),
  'combat-b': Object.freeze({ introSec: 5, gain: 0.68 }),
  'combat-c': Object.freeze({ introSec: 5, gain: 0.62 }),
  night: Object.freeze({ introSec: 5, gain: 1.60 }),
  victory: Object.freeze({ introSec: 0, gain: 0.77 }),
  defeat: Object.freeze({ introSec: 4, gain: 0.98 }),
  paf: Object.freeze({ introSec: 6, gain: 0.85 }),
});

export function resolveBgmStartOffset({ slot, prevMode = null, transition = 'switch', introSec } = {}) {
  if (transition === 'loop' || slot === 'victory') return 0;
  if (slot === 'explore' && prevMode === 'title' && transition === 'play') return 0;
  const value = introSec ?? BGM_TRACK_META[slot]?.introSec ?? 0;
  return Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
}

export function chooseCombatVariant({ variants = BGM_TRACK_META.combat.variants, previous = null, rng = Math.random } = {}) {
  const list = [...variants].filter(Boolean);
  if (!list.length) return 'combat';
  const eligible = list.length > 1 ? list.filter((item) => item !== previous) : list;
  const random = Number(rng?.());
  const index = Math.min(eligible.length - 1, Math.max(0, Math.floor((Number.isFinite(random) ? random : 0) * eligible.length)));
  return eligible[index] || list[0];
}

export function getBgmTrackMeta(slot) { return BGM_TRACK_META[slot] || { introSec: 0, gain: 1.0 }; }
