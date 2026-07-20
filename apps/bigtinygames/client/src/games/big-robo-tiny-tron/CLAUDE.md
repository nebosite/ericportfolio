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

The maze is BIG (`CELL = 200` logical px is the _default/target_ cell size). The
component sizes the grid to the viewport in `buildLevel` with an EXACT-fill
formula: `cols = floor(w/CELL)`, `rows = floor(h/CELL)`, then the actual
**rectangular** cell size `cellW = floor(w/cols)`, `cellH = floor(h/rows)`. So the
grid fills the screen exactly on both axes (e.g. a 2100×1030 area → 10×5 cells of
210×206). Cells are therefore usually non-square: the `Maze` carries `cellW` and
`cellH` (not a single `cellSize`), and everything positional uses `cellW` on x and
`cellH` on y. The canvas backing store **is** the grid (`cols·cellW × rows·cellH`)
and is drawn **1:1** — never stretched (the CSS gives the canvas no width/height,
so display size equals backing size). `scaleX/scaleY` in the draw layer are
therefore always 1.0. Game objects are drawn at fixed native sizes: sprites 16px,
walls 8px thick, bullets a 6px line, teleport pads 30px. The maze is a per-cell
recursive backtracker that works for any counts (cols/rows are not forced odd).
Walking characters loop a 3-frame cycle (still/step1/step2) while moving. The
`.stage` fills its flex parent via `flex: 1 + align-self: stretch` (a plain
`height: 100%` does **not** resolve against the flex-sized `.main`).

## Core rules (current)

- **Movement:** enemies pathfind toward the player through the maze (BFS
  waypoints), advancing an `ENEMY_STEP_PX` (4px) step with `EnemyMoveChance`
  probability per frame, steering around electrodes. Family members wander
  randomly every other frame. The player moves freely with WASD.
- **Firing:** twin-stick — WASD move, arrows aim & fire. `PLAYER_SHOOT_COOLDOWN
= 0.1` ⇒ ~10 shots/second. Bullets are 6px lines at `BULLET_SPEED = 1500`
  px/s; collisions are **swept** (segment vs circle) so fast shots don't tunnel.
- **Teleport pads:** ~one linked **pair per 10 grid squares**, on random cells;
  the two pads of a pair share a **color** (`TELEPORT_PAIR_COLORS`). Stepping onto
  one emerges you out the **far side** of its partner, continuing in your entry
  direction (`TELEPORT_EXIT_OFFSET` = 55px past the partner center, so no
  re-trigger). **Bullets teleport the same way**, keeping their velocity. Only
  **smart** enemies (level `smartness` > 1) use pads: an enemy sitting on a pad
  jumps to the partner when it lands meaningfully closer to the player. Use
  `teleportPartner(maze, pad)` to find a pad's mate.
- **Explosions:** destroyed characters burst into horizontal debris (3× size).
- **Electrodes vs enemies:** enemies don't avoid electrodes — walking into one
  blows up both the enemy and the electrode (no score).
- **Spawns:** populations are placed maximally inside each cell (up to the walls)
  by reject-sampling positions that keep a `PLACE_GAP` (26px) from everything
  already placed in that cell, so enemies/people/electrodes never overlap and no
  enemy spawns already touching an electrode (which would insta-die).
- **Materialize:** at game start, level advance, and after a death, everything
  assembles from its sprite's 16 horizontal pixel-rows flying in from off-screen
  (rows farther from the sprite's vertical middle start a full screen away; all
  arrive together over `MATERIALIZE_DURATION` = 2s). Enemies/family converge
  vertically; the player also gets both diagonals. `state.materializeTimer`
  **freezes `step()`** (no movement/firing) while it runs; `respawnPlayer()` just
  re-arms it. Rendered by `drawMaterialize` in the component; the `reconstitute`
  cue (`materialize.wav`) plays the whole ~2s.
- **Family (Mom/Dad/Mike/Sally):** cannot be shot; **cannot be killed by enemies**
  (enemy contact is harmless to them); rescued by player contact (+score). They
  **actively avoid electrodes** while wandering (`FAMILY_ELECTRODE_MARGIN`), so
  the only remaining death is the rare electrode-overlap safety net (`familyDie`).
- **Electrodes:** static hazards, lethal to the player on contact (and to family
  on the rare overlap); a player bullet destroys one via a two-frame shrink.
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
