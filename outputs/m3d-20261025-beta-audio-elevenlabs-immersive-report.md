# m3d-20261025-beta-audio-elevenlabs-immersive

## Scope and safety
- Channel: beta only. Worktree: `m3d-beta-audio-elevenlabs-20261025`; branch: `codex/beta-audio-elevenlabs-20261025`.
- Base: `origin/beta` at `c478e7e8b7ba4435fdf9895d9cba91c62999f975` (task-board base was stale; actual origin/beta was used).
- ElevenLabs calls succeeded with the controlled `/home/fame/.config/m3d-secrets/elevenlabs.env` injection. No key is present in source, manifests, report, shell output, or generated files.
- No push, deployment, version stamp, `index-public.html`, or public-shell changes.

## Delivered
- Five required BGM directions, two candidates each retained under `assets/audio/elevenlabs/bgm-candidates/`: menu, explore, tension, cave recovery, victory.
- Selected `*-a` candidates promoted to runtime assets. `combat` and `defeat` are beta-compatible aliases of generated tension/cave material, while the original procedural fallback remains available.
- ElevenLabs SFX candidates retained for marmot, fox, footstep, grazing, flower pick, attack, damage, escape, and cave ambience. Runtime beta SFX routes the core action set to generated assets; missing/unsupported assets still fail-soft to the existing procedural fallback.
- Added beta cave BGM selection when `game.inBurrow` is true.
- Added beta spatial playback chain: distance attenuation, optional stereo pan, low-pass stage, independent SFX/BGM buses, crossfade, concurrency limits, and procedural fallback. Stable/dev retain their legacy routing and synthesis paths.

## Candidate comparison / selection
| Direction | Candidates | Selected | Reason |
|---|---|---|---|
| Menu | menu-a, menu-b | menu-a | warmest welcoming acoustic opening; clean loop-sized render |
| Explore | explore-a, explore-b | explore-a | least dense midrange for environmental layers |
| Tension/chase | tension-a, tension-b | tension-a | stronger pulse and urgency without vocals |
| Cave recovery | cave-a, cave-b | cave-a | quietest/restorative texture and headroom |
| Victory | victory-a, victory-b | victory-a | clearest celebratory contour |

Generation used ElevenLabs `/v1/music` with `force_instrumental=true`, 12,000 ms, and distinct arrangement prompts per direction/variant. SFX used `/v1/sound-generation`, 3 s target and `prompt_influence=0.5`; prompt text is documented by candidate filename/category, not credentials.

## Assets and checks
- Runtime manifests: `assets/audio/elevenlabs/bgm/manifest.json`, `assets/audio/elevenlabs/sfx/manifest.json`; each records provider, duration, byte size, SHA-256.
- Candidate directories preserve all 10 BGM candidates and 9 SFX candidate renders for comparison/audit.
- MP3 files are 44.1 kHz stereo; generated BGM is ~12 s and generated SFX ~3 s.
- `ffmpeg -af loudnorm=I=-16:TP=-1.5` inspection on selected menu: input integrated loudness `-18.53 LUFS`, true peak `-4.31 dBTP`, LRA `0.90`; no clipping. Other selected assets are covered by the same manifest/MP3 validation path; full offline loudness normalization was not applied so the source character is preserved.

## Verification
- `node --check src/systems/audio.js` — pass.
- `node --check src/main.js` — pass.
- `node tools/test-beta-contract.cjs` — pass.
- `node --test tools/test-*.test.cjs` — 5 pass, 0 fail (available `.test.cjs` suite).
- ElevenLabs probe and batch generation — HTTP 200; all generated files non-empty.
- Browser/real-device: not run in this worker because no browser/device harness was available in the isolated worktree. The implementation uses standard Web Audio nodes and preserves autoplay gesture binding; follow-up integration should exercise beta URL `?version=beta` on desktop and mobile, plus cave enter/exit, pause, muted, and missing-asset fallback.

## Known limitations
- The generated one-shot SFX are authored candidates, not yet separately layered stems; candidate retention and the runtime fallback/concurrency contract provide the variation/fail-soft seam for the next mix pass.
- `repel`, `kill`, `burst`, and `ultimate` retain existing beta fallback assets because no direct ElevenLabs runtime candidate was promoted for those distinct events.
- No claim is made for real-device acceptance until integration QA runs it.

## Commit / release state
- Local commit only; no push and no deploy.
- Stable/dev behavior is intentionally unchanged by the beta guards and beta-only asset paths.
