# Dynamic SmartFox attacker matrix comparison

Base: `b90c0e0d62ba1d9a78c7c8cacf6de8e1bbf7b8f7`; exactly one marmot; dt=1/60; 6 s/case; 3 seeds; 180 cases.

| Foxes | Side | Completed / failed | Max unique pounce committers | Max active attackers | Commits | Pounce strikes | Melee strikes | Melee hits | Player damage | Attack pressure | Retreats | Deaths |
|---:|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | before | 45 / 0 | 1 | 1 | 45 | 30 | 45 | 45 | 45 | 75 | 45 | 0 |
| 1 | after | 45 / 0 | 1 | 1 | 45 | 30 | 45 | 45 | 45 | 75 | 45 | 0 |
| 2 | before | 45 / 0 | 2 | 2 | 60 | 45 | 75 | 75 | 75 | 120 | 75 | 0 |
| 2 | after | 45 / 0 | 2 | 2 | 60 | 30 | 75 | 75 | 75 | 105 | 75 | 0 |
| 4 | before | 45 / 0 | 3 | 4 | 135 | 105 | 240 | 210 | 210 | 345 | 90 | 0 |
| 4 | after | 30 / 15 | 4 | 4 | 90 | 90 | 180 | 135 | 135 | 270 | 105 | 0 |
| 8 | before | 45 / 0 | 4 | 8 | 180 | 165 | 375 | 345 | 345 | 540 | 0 | 0 |
| 8 | after | 45 / 0 | 8 | 8 | 240 | 210 | 435 | 255 | 255 | 645 | 105 | 0 |

## Same-seed faceoff proof

- 4 foxes, seed 20261031, stationary faceoff: before 3 unique committers (0,1,2); after 4 (0,1,2,3), 4 active attackers; after peak attack roles 4, peak concurrent pounces 3, peak commits in 1.2 s window 3.
- 8 foxes, seed 20261031, stationary faceoff: before 4 unique committers (0,1,2,7); after 8 (0,1,2,3,4,5,6,7), 8 active attackers; after peak attack roles 8, peak concurrent pounces 3, peak commits in 1.2 s window 4.

## Retained scenario failures

After: 15/180 failed, all 4-fox parry-tap setup cases (5 movements x 3 seeds) because no real parry_success occurred. Before: 0/180 failed. No failed case was removed or marked passed.

## Performance

Before wall 921.658 ms; after wall 971.231 ms. Full nominal simulated time 1080 s; after relative speed 1112.0x real time (Node, renderer-free).
