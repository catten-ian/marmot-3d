# Smart fox DEV sandbox QA trace

Use `index.html?version=dev&test=1` and open the `测试` panel. Enable `DEV 沙盒：启用一只智能狐`; the checkbox is only rendered for `version=dev` test mode. The ordinary level fox list remains present and the toggle adds or removes exactly one `SmartFox` instance. Stable, beta, and ordinary DEV URLs do not create one.

The deterministic command `node tools/trace-smart-fox.cjs` emits the prototype trace:

`observe -> approach -> feint-after-interruption -> committed-pounce -> pounce-continues -> recover-reposition`

The trace records suspicion, interruption memory, speed, and the committed flag. Pounce remains committed while the target reverses, so the fox does not snap its target or rotate instantly. `src/entities/smart-fox-core.mjs` uses a 120 degree cone, suspicion accumulation/decay, bounded turn rate, acceleration, and a 9.6 to 10.6 m/s attack/reposition speed band; observation uses a slower 2.4 m/s drift to create a readable setup window.

Rapier was not added. This runtime has no Rapier dependency, and the requested local vendored package is in another worktree. The prototype stays on the existing deterministic kinematic movement, bounds, terrain height, rock, and burrow handling inherited from `Fox`; no physics integration is claimed.
