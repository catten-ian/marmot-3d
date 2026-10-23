# Beta audio assets (offline generation only)

The browser never calls ElevenLabs or MiniMax and contains no provider credential. Runtime audio uses only local `assets/audio/sfx/*.mp3` and `assets/audio/bgm/*.mp3` listed in adjacent manifests. Until generation, manifests are intentionally empty and the game uses its existing procedural SFX / silent BGM fallback.

## Generate sound effects

Node.js 18+ is required for built-in `fetch`.

```sh
# Validate prompts and request shapes without network access:
env -u ELEVENLABS_API_KEY node tools/audio/gen-sfx-elevenlabs.mjs --dry-run

# After an authorized key is provided, run once from the repository root:
ELEVENLABS_API_KEY="$ELEVENLABS_API_KEY" node tools/audio/gen-sfx-elevenlabs.mjs
```

The script reads only `ELEVENLABS_API_KEY`, calls ElevenLabs `POST /v1/sound-generation` with `eleven_text_to_sound_v2`, and writes 16 unique MP3s under `assets/audio/sfx/`; the legacy `kill` event aliases `repel` in the manifest. Prompts are centralized in `SFX_PROMPTS` in the script. `kill` remains a compatibility cue separate from the non-lethal `repel` event.

## Generate background music

```sh
env -u MINIMAX_API_KEY node tools/audio/gen-bgm-minimax.mjs --dry-run

# After an authorized key is provided, run once from the repository root:
MINIMAX_API_KEY="$MINIMAX_API_KEY" node tools/audio/gen-bgm-minimax.mjs
```

The script reads only `MINIMAX_API_KEY`, calls MiniMax Music 2.6 `POST /v1/music_generation`, and writes six instrumental MP3s under `assets/audio/bgm/`. Prompts and BPM/style settings are centralized in `BGM_PROMPTS`. Generation is a manual offline asset-production step; do not invoke it from app runtime or CI.

Both scripts support `--dry-run`; without their corresponding environment variable they print a skip notice and exit successfully. Each completed item updates `manifest.json` with `file`, measured `durationSeconds`, and `sha256`. MP3 files are ignored by git; `.gitkeep` and manifests remain tracked. Review licensing/terms, quality, loop points, loudness, and mobile playback before distributing generated files.

## Runtime manifest shape

```json
{
  "version": 1,
  "generatedAt": "ISO-8601 timestamp",
  "assets": {
    "hit": {
      "file": "assets/audio/sfx/hit.mp3",
      "durationSeconds": 0.84,
      "sha256": "hex sha256"
    }
  }
}
```

To add an SFX, add one event to `src/systems/audio.js` `SFX_ASSETS`, a matching prompt to `SFX_PROMPTS`, a fallback method and concurrency group, then update the event coverage tests. To add a BGM slot, update `BGM_SLOTS`, `BGM_ASSETS`, `selectBgmSlot`, `BGM_PROMPTS`, and the slot tests. Keep assets static and local; failures/missing manifest entries fall back to procedural SFX or silence for BGM.
