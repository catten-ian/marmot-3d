# Beta hotfix: model retry, minimap persistence, grazing interaction

## Scope
- Model and scene GLB loads now retry up to three attempts with 250ms/750ms backoff; failures remain procedural/fail-soft and cooldown prevents request storms.
- Beta minimap remains visible during stationary crouch/stand posture transitions, while movement and burrow still hide it.
- Beta interact is grazing/flower-foraging only in HUD prompts, keyboard skill status, touch labels, help, pause, and title surfaces; beta `doInteract` no longer emits rescue/companion feedback.

## Verification
- `node --check` on all modified JS/MJS: passed.
- `node tools/test-model-loading-retry.mjs`: 5/5 passed.
- `node tools/test-beta-interaction.mjs`: 3/3 passed.
- `node tools/test-minimap.cjs`: passed.
- `node tools/run-node-tests.cjs`: 62/62 passed; 22 browser/CDP tests skipped because Chrome was unavailable to the test runner.

## Files
- `src/models/model-load-retry.mjs`
- `src/models/loader.js`
- `src/models/scene.js`
- `src/ui/minimap.js`
- `src/main.js`
- `src/ui/hud.js`
- `src/ui/touch-layout.js`
- `src/core/keybinds.js`
- `src/core/interaction-semantics.mjs`
- focused tests under `tools/`

## Delivery
- Local commit only; not pushed and not deployed by the worker.
