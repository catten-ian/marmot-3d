# m3d-20261027 beta BGM overhaul report

Implementation commit: `a3b998b4e0b7591c830c023c2585aa1ca2706ef2` (`feat(beta): overhaul beta background music system`).

## Changes

- Added pure metadata and decision module `src/systems/bgm-tracks.mjs`, including per-track `introSec`/`gain`, intro skip exceptions, and injected-RNG combat variant selection.
- Updated `src/systems/audio.js`: beta slots now use `night` and `paf`; `cave` is removed; file tracks start at the resolved offset, natural loops restart at zero, combat selects one of `combat`, `combat-b`, and `combat-c` per combat entry, and each track gain is multiplied into the crossfade target.
- Raised the beta default BGM setting from **38% to 61%** (the BGM bus remains user adjustable); this is approximately 1.6x the previous default.
- Preload now fetches menu, explore, tension, one selected combat variant, night, victory, and defeat. PAF is loaded on demand and cached; progress reporting remains one completion event per job.
- Added PAF activation priority so the main loop cannot reclaim the `paf` track while PAF is active; leaving PAF returns control to the normal state selector.
- Removed `assets/audio/elevenlabs/bgm/cave.mp3`, `assets/audio/elevenlabs/bgm-candidates/cave-a.mp3`, and `cave-b.mp3`.
- Added `tools/test-bgm-overhaul.test.cjs` and updated audio preload/slot contract expectations.

## Validation

- `node --check` passed for every changed JavaScript/module/test file.
- `node tools/test-bgm-overhaul.test.cjs`: **4/4 passed**.
- `node tools/run-node-tests.cjs`: **81/81 passed**; the repository reports 22 browser/CDP tests skipped because Chrome is unavailable in this worker.
- `git diff --check`: passed.
- `manifest.json` was not modified. New generated MP3 files (`night.mp3`, `combat-b.mp3`, `combat-c.mp3`, `paf.mp3`) are expected to be placed by the integrating process; missing manifest entries/files continue through the existing procedural fail-soft path.

## Known boundaries

The metadata `gain` values are beta placeholders at `1.0`, and the `introSec` values are provisional until the integrating process measures the final encoded files and updates the metadata. This change does not alter stable/dev runtime selection because the Audio path remains beta guarded.
