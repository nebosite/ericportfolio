# Big Robo Tiny Tron

Robotron + Berserk + Tron mashup. Twin-stick shooter inside a BIG neon maze.

## Architecture

- `roboTronLogic.ts` — pure, framework-free model + rules (unit-tested). Cells
  are big (~176px, fitted to the viewport by the component). Player, enemies, and
  family all live in **pixel space**; enemies/family also carry a derived
  `col/row` for BFS + line-of-sight. `initialState(cols, rows, level, rng,
cellSize, config)` spawns a `LevelConfig`'s **per-grid-square** populations into
  every interior cell (the player's start cell stays clear). `step()` mutates and
  returns the same state ref.
- `roboTronLogic.test.ts` / `levels.test.ts` — the safety net. Extend for every
  rule change.
- `levels.ts` + `assets/levels.csv` — hand-editable population/tuning spreadsheet
  (one row per level; counts are per grid square). Columns: Moms, Dads, Mikeys,
  Sallys, Grunts, Hulks, Brains, Spheroids, Enforcers, ElectrodeType, Electrodes,
  Tanks, EnemyMoveChance. Imported as `?raw` and parsed by name.
- `sprites.ts` + `assets/sprites/sprite sheet.png` — 16×24 grid of 16×16 sprites.
  Rows 0–7 are walking characters (Robo, Mom, Dad, Mike, Sally, Grunt, Hulk,
  Brain), 12 frames each grouped by facing (left/right/down/up × still/step1/
  step2). Rows 13–14 are electrodes: 4 groups of 3 per row (types 0–7), each
  group `{normal, shrink1, shrink2}`. Reskin by editing the PNG.
- `sfx.ts` + `assets/sounds/*.wav` — one editable audio file per cue, keyed off
  logic `SoundEvent`s (fetched + decoded once, fired as one-shots). Every clip is
  < 2s so per the repo asset rule they're WAV (author longer cues as MP3). They
  were rendered from a script but are now plain files — reskin by replacing them.
- `BigRoboTinyTron.tsx` — canvas render + rAF loop + twin-stick input. Owns the
  dynamic cell-size fit, sprite animation, level progression, HUD, overlays,
  leaderboard, and the standard `FeedbackPanel`.

## Rendering model

The maze is BIG (`CELL = 440` logical px/cell). The canvas backing store is the
**actual display size** (1:1 with CSS px), and the draw layer maps the maze's
logical space onto it (`scaleX/scaleY`) so the grid **fills both axes**. Game
objects (sprites, bullets, walls, particles, pads) are drawn at **fixed native
pixel sizes** — only their positions are scaled — so they stay at their original
1:1 resolution regardless of grid size: sprites 16px, walls 8px thick, bullets a
6px line, teleport pads 30px. Walking characters loop a 3-frame cycle
(still/step1/step2) while moving.

## Core rules (current)

- **Movement:** enemies pathfind toward the player through the maze (BFS
  waypoints), advancing an `ENEMY_STEP_PX` (4px) step with `EnemyMoveChance`
  probability per frame, steering around electrodes. Family members wander
  randomly every other frame. The player moves freely with WASD.
- **Firing:** twin-stick — WASD move, arrows aim & fire. `PLAYER_SHOOT_COOLDOWN
= 0.1` ⇒ ~10 shots/second. Bullets are 6px lines at `BULLET_SPEED = 1500`
  px/s; collisions are **swept** (segment vs circle) so fast shots don't tunnel.
- **Teleport pads:** 30px targets; teleporting drops the player
  `TELEPORT_EXIT_OFFSET` (55px) toward the maze interior so it can't re-trigger.
- **Explosions:** destroyed characters burst into horizontal debris (3× size).
- **Electrodes vs enemies:** enemies don't avoid electrodes — walking into one
  blows up both the enemy and the electrode (no score). Family die on contact too.
- **Spawns:** populations are placed maximally inside each cell (up to the walls).
- **Reconstitute:** after a death, `respawnPlayer()` spawns particles that fly in
  from the arena edges (mostly diagonal) and congeal onto the player, who flashes
  (invuln) while the `reconstitute` cue plays. Timing is owned by the component;
  the converging particles animate through the step() particle sim.
- **Family (Mom/Dad/Mike/Sally):** cannot be shot; rescued by player contact
  (+score); die on contact with any electrode or enemy (`familyDie` wail).
- **Electrodes:** static hazards, lethal to player + family on contact; a player
  bullet destroys one via a two-frame shrink animation.
- **Threat model:** swarm enemies (grunt/hulk/brain/spheroid/phantom) kill by
  contact; only enforcer/tank fire bullets. Destroyed characters burst into
  horizontal debris particles flying perpendicular to the killing bullet.
- Kept from the earlier build (layered on): teleport pads, powerups, decoy,
  exits/level-clear, phantom phasing.

## TODO / pending art

- Spheroid, Enforcer, Tank sprites are **not on the sheet yet** — they render as
  fallback colored shapes. Wire them into `sprites.ts` (`ENEMY_ROW`) once the
  art rows are described/added.

Status: in development. Run `npm test -w apps/bigtinygames/client` after changes.
