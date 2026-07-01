# Big Tiny Snake — Game Instructions

App-specific notes for the Big Tiny Snake game. The repo-wide `CLAUDE.md` (local
review before deploy, **tests for every change**, deployment guards, the
standard per-entity feedback feature) and the Big Tiny Games house style still
apply on top of this.

## North Star: take the boring same-old and shake it up

Snake is the most familiar game there is — everybody has played the exact same
"steer a line into food, get longer, don't hit a wall" a thousand times. **That
sameness is the enemy.** This game exists to take that worn-out loop and keep
**subverting it** so a Snake veteran is repeatedly surprised: _"wait, that's not
how Snake works."_

So every feature should answer one question first: **does this shake up the
same-old?** Polish and parity with classic Snake are not the goal — _twist_ is.

What "shaking it up" has meant so far (study these for the spirit, then go
further):

- **One snake became many.** Eating spawns a _new_ snake; they all share one
  heading and are steered together; your score multiplies by the number of
  snakes alive. The fantasy flipped from "grow one line" to "keep a whole writhing
  flock alive."
- **The field is alive.** Food drops on a timer and sometimes lands as a 3×3
  blob; a dying snake leaves a fading, deadly **corpse**, and occasionally a
  permanent deadly **rock** — so the board fills with consequence over time.
- **Power fantasy + risk.** The **Ghost powerup** bursts 20 ghost snakes out in a
  full circle that can slice your snakes in half or convert them away — but the
  snake that grabbed it gets a 10-second **ghost rush** (immune, rocks become
  food, turns blue and flashes before it ends). Help and danger in the same beat.
- **Even spawning is a moment.** New snakes grow in from a single segment instead
  of popping into existence full-length.

### Principles for new features

- **Subvert the familiar.** Prefer the idea that makes a veteran do a double-take
  over the idea that's merely "more Snake."
- **Embrace emergent chaos.** Systems that interact (snakes × food × ghosts ×
  rocks × corpses) produce mayhem we didn't hand-script. Lean into that.
- **Risk and reward together.** The best additions both tempt and endanger; avoid
  pure upside or pure punishment.
- **Escalation.** A run should get wilder the longer it goes, not just harder.
- **Stay legible in the chaos.** No matter how much is happening, the player must
  read the board at a glance. Honor the established color language: green = your
  snakes, **blue** = ghost-rushing, red = food, gray = rock, white→midnight-blue =
  ghost trail, white→black = dying corpse, throbbing blue/white = Ghost powerup.
- **Tiny on huge.** Keep the signature look: 12px code-drawn sprites on a field
  that **fills the viewport**.

## Architecture / where things live

The hard rule (see the repo `CLAUDE.md`): **gameplay rules live in a pure,
framework-free module and are unit-tested; rendering and timers stay in the
component.** New rules go in the logic module with tests in the same change.

- `snakeLogic.ts` — the **pure game model** and the only place rules live:
  `GameState`, `initialState`, `step(state, dir, rng)`, `addFood`,
  `addGhostPowerup`, `advanceGhost`. Movement, collisions, growth, spawning,
  corpses/rocks, the Ghost powerup, the ghost rush, and grow-in are all here.
  Framework-free and deterministic (rng is injectable). The **board size is
  supplied by the caller** (the canvas fills the viewport), so `cols`/`rows`
  live in the state.
  - Snakes are plain `Vec[][]` with **no identity**, so per-snake state is held
    in **parallel arrays** on `GameState` (`buffs` for the ghost rush, `grow`
    for grow-in). Any new per-snake property follows the same pattern, and
    **must be kept aligned with `snakes` through every transform in `step`**
    (move, eat, spawn, clip, convert).
- `snakeLogic.test.ts` — the unit tests for all of the above (the safety net;
  extend it for every rule change). Uses a `seqRng` helper for determinism.
- `SnakeGame.tsx` — the **render + loop** layer: the `setInterval` game loop at
  `TICK_MS`, canvas 2D drawing of the 12×12 code sprites, the HUD, the
  idle/gameover/saved overlays, and the high-score flow (`GET`/`POST
/api/leaderboard`). Input comes through the shared `../input`
  `attachGameInput` (arrows / WASD / gamepad → a `Vec`; Enter/Space → confirm).
  Timers here are presentation-only — note the **Ghost powerup spawn is driven
  off the loop's tick counter, not a wall-clock timer**, so it fires reliably
  even in short games.
- `SnakeGame.module.css` — the fill-the-stage layout and overlays.
- `SnakePage.tsx` / `SnakePage.module.css` — the page chrome (lobby link, title,
  footer) that hosts `<SnakeGame />`.
- Registered in `../registry.ts` (id `snake`, route `/snake`).

Standard wiring: the title screen carries `<FeedbackPanel entity="snake" />`;
high scores use the bigtinygames server's `/api/leaderboard`. Feedback itself is
owned by the shared feedback service (see the repo-root `CLAUDE.md`).

## How to evaluate a change here

A feature is done when it (1) **shakes up the same-old** — it surprises, twists,
or escalates rather than just adding parity polish; (2) lives as a **rule in the
tested pure model** with new unit tests, not a one-off in the render loop; and
(3) **stays readable** — the board is still legible at a glance in the chaos, in
the established color language. Then build it, run the field locally, and watch a
real game get gloriously out of hand before committing.
