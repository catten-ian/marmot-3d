# DEV Verdant P2 QA

- Date: 2026-10-23
- Static/node evidence: `node tools/run-node-tests.cjs` => `OK 36/36`; 22 browser tests are skipped by the repository runner when Chrome/CDP is unavailable.
- Browser/CDP status: attempted a separate headless Chrome endpoint on port 9223 and local server on 4173. The managed Chrome process did not expose a CDP listener in this sandbox, so no screenshot or runtime assertion is claimed here.
- Required follow-up on a real browser/device: open `index.html?version=dev&webgl=1&verdantTier=low`, verify uphill physical Y never drops below `__game.controller.onGroundY`, downhill follows, jump/landing remain airborne then grounded, `?verdantProxy=1` blocks a selected boulder without sealing the route, and throttled GLB bytes keep the loader alive while a true zero-byte stall still fails at 25s and the hard limit remains 180s.
