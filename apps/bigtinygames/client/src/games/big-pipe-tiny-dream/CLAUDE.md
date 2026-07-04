# Big Pipe Tiny Dream — Game Instructions

App-specific notes for the Big Pipe Tiny Dream game. The repo-wide `CLAUDE.md`
(local review before deploy, **tests for every change**, deployment guards, the
standard per-entity feedback feature) and the Big Tiny Games house style still
apply on top of this.

## North Star: rotate the whole board, don't place from a queue

This is our take on **Pipe Dream / Pipe Mania** — but with the classic's core
verb inverted. In the original you drew fresh pieces from a queue and _placed_
them on an empty grid, racing the flood. Here the grid **arrives already full**
of random pipe, and your only move is to **rotate pieces in place** (one click =
a quarter turn clockwise). You don't build a path from nothing; you _discover_
one that's already latent in the mess, twisting tiles to reveal it.

That inversion is the whole game, and it pairs with the portfolio's calm,
oversized aesthetic: a **big, dreamy plumbing puzzle** that fills the monitor,
fed by a slow spring you stay ahead of by thinking, not twitching. The water
creeps (`2 + 2·level` px/s — a single 40px tile takes _ten seconds_ to cross at
level 1); the countdown before it wakes is generous. The pleasure is the unhurried
_"where can this go?"_ read of a full board, not a frantic race.

So every feature should answer: **does it deepen the twist-a-full-board dream
without turning it into a twitch race?** Keep it contemplative; let the player
plan far ahead of the trickle.

### Principles for new features

- **Rotate-in-place, not place-from-queue.** The signature move is turning tiles
  that are already there. Additions should enrich reading and reshaping a full
  board (new tile kinds, obstacles, empty cells to route around), not bolt a
  piece-placement queue back on.
- **Stay ahead of a gentle flood.** The water is slow and the countdown long on
  purpose. Difficulty escalates through `level` (faster flow, shorter countdown,
  bigger goal), never through sudden spikes or precision demands.
- **Legible plumbing.** Gray casing = pipe, gold tank = the spring, blue = water
  with a bright bead at the leading edge; a watered pipe has visibly _set_ and
  can't be turned. Any new element must read at a glance at 40px.
- **Reward foresight.** The fun is seeing a route several tiles ahead and setting
  it up before the water arrives. Favor mechanics that reward planning.

## Architecture / where things live

The hard rule (see the repo `CLAUDE.md`): **the pipe/connection/flow math lives
in a pure, framework-free module and is unit-tested; the canvas/rAF/timer/input
coupling stays in the component.** Extract any new rule into the pure layer and
test it in the same change.

- `pipeLogic.ts` — the **pure model** and the only place rules live: `Tile`
  kinds (`straight` / `elbow` / `cross` crossover / `tee` splitter / `start`
  source / `terminus` drain), `openings` (rotation → which sides connect;
  `start`/`terminus` are single-opening "dir-kinds"), `exits` (the side(s) water
  leaves by — one for a straight/elbow, the channel opposite for a cross, **two
  for a tee**, none for a drain), `canReceive` / `isLocked` (a wet side can't
  take more; any water — plus the `start` — locks rotation, but a dry `terminus`
  can still be turned), `rotateTile`, `generateGrid` (tees sprinkled at ~2% of
  tiles, central start, `drainCount` drains placed ≥4 grid units from every edge
  / the source / each other), and the **multi-stream** water model: `startFlow` /
  `advanceHead` return `Step`s (`continue` a stream, `drain` = a terminus fed, or
  `dead` with a reason). A tee turns one stream into two, so a single source can
  feed several drains. **Death has two flavours**: a `crash` (off an edge or into
  a mis-oriented tile — a preparation failure) ends the whole run **immediately**;
  a `collision` (running into water already flowing) only kills that one branch,
  and the run ends by collisions alone only once **every** stream is dead before
  the drains are fed. `drainCount(cols,rows,level)` = `1 + ceil(area/1000) *
level`; `countdownSec` (base `35 − 5·level`, floored at 5, **plus a flat +30s**)
  / `flowRate` round out the level knobs. The board **wraps** (a torus):
  `wrapX`/`wrapY` fold neighbour lookups, so flow and connectivity run off one
  edge onto the opposite one and there's no "off the board" crash — only
  mis-orientation. `connectedToSource(g)` is a wrap-aware BFS over (tile,
  entry-side) states that routes exactly like the real flood (following `exits`,
  so a cross only passes straight through its two channels and a tee splits) to
  mark which tiles the water could reach (the render layer darkens the rest). Grid size is supplied by the caller (the canvas fills the viewport).
  Flow helpers **mutate** the tile `water` flags in place — the grid is a mutable
  ref in the render layer, mirroring the pixi engine pattern in Big Pac.
- `pipeLogic.test.ts` — unit tests for all of the above (the safety net; extend
  it for every rule change). Uses a `seqRng` helper for determinism.
- `sprites.ts` — loads the pipe tile graphics, which are **editable 40x40 PNGs**
  in `assets/sprites/` (`pipe` vertical, `elbow` E+S, `cross` horizontal-on-top,
  `start` opening E, `terminus` opening E). The render layer rotates each sprite
  by whole quarter-turns to match the tile's logical openings (`spriteFor` in the
  component maps kind+rot/dir → sprite + rotation steps). Reskin by replacing the
  PNGs — nothing is generated.
- `sfx.ts` — sound via the Web Audio API, playing the **placeholder beep WAVs** in
  `assets/sounds/` as cheap one-shots: `rotate` (a pipe turns), `flow` (the flood
  wakes), `levelup` (water reaches the drain), `gameover`. All are short (<2s)
  hand-editable WAVs per the repo asset rule; replace the files to change them.
- `BigPipeTinyDream.tsx` — the **render + loop + input** layer: a `requestAnimation
Frame` flood loop and layered canvas 2D drawing — a textured green ground, a
  transparent **pipe layer** (repainted whole on any board change, dimming every
  tile `connectedToSource` leaves out at 50% via a `source-atop` tint), a baked
  **water layer** that accumulates completed streams, plus per-frame glows (a halo
  per head, a shadow + ring per drain) and the countdown badge. The HUD carries
  the SPEED toggle, the **piece bank** (four one-shot free pieces — elbow /
  straight / cross / tee — click a slot to arm the cursor with that piece, click a
  tile to drop it, or click the origin slot to put it back), and `DRAINS x/n`.
  Input: click/tap a tile to rotate (or place the armed piece); locked tiles are
  ignored, and placement also skips drains; Enter/Space/gamepad confirm starts a
  run or advances a level via the shared `../input` `attachGameInput`. Everything
  here is pixels and timing — keep pure math in `pipeLogic.ts`.
- `BigPipeTinyDream.module.css` — the fill-the-stage layout and overlays.
- `BigPipeTinyDreamPage.tsx` / `BigPipeTinyDreamPage.module.css` — the page chrome
  (lobby link, title, footer) that hosts `<BigPipeTinyDream />`.
- Registered in `../registry.ts` (id `big-pipe-tiny-dream`, route
  `/big-pipe-tiny-dream`).

Standard wiring: the title screen carries
`<FeedbackPanel entity="big-pipe-tiny-dream" />`; high scores use the
bigtinygames server's per-game `/api/leaderboard` (slug `big-pipe-tiny-dream` —
no server change was needed, the leaderboard table is already per-game). Feedback
itself is owned by the shared feedback service (see the repo-root `CLAUDE.md`).

## Current defaults worth knowing (tune freely)

- **Flow speed** = `4 + 4·level` px/s; **countdown** = `35 − 5·level`s (floor 5)
  **+ 30s** planning buffer.
- **Tee** = a rare ~2% splitter. Enter one port → water exits the other two.
- **Wraparound**: the board is a torus — flow (and the connectivity check) run
  off one edge onto the opposite one; there's no "off the board" crash.
- **Path highlight**: tiles that can't `connectedToSource` are dimmed 50% so the
  live path from spring to drains reads at a glance; recomputed on every rotate /
  placement.
- **Piece bank**: four one-shot free pieces (elbow / straight / cross / tee),
  refreshed each level. Arm one → the cursor becomes it → click a rotatable tile
  to drop it (spends it), or click its origin slot to put it back.
- **Drains** = `1 + ceil(area/1000)·level`, placed randomly ≥4 from every edge,
  the source and each other. **Level clear** = feed **all** drains. **Game over**
  = a stream **crashes** into a mis-oriented tile (immediate), or every stream
  dies (crash or collision) before the drains are fed. Running into existing
  water is a **collision** — only that branch dies.
- **Score** = **one point per pixel the water travels**, summed over all live
  streams, accumulated across levels; submitted to the leaderboard on game over.
- **Speed toggle** overrides level speed with a flat fast 200 px/s, and hitting
  it also releases the water at once (skips any remaining countdown).
- **Volume** is a shared master setting (`src/lib/volume.ts` + the
  `VolumeControl` on the title screen), applied by every game's `Sfx.play`.
- **Sound** = placeholder beeps (`assets/sounds/*.wav`) for rotate / flow-start /
  level-complete / game-over. Swap the WAVs for nicer cues when ready.

## How to evaluate a change here

A feature is done when it (1) **deepens the rotate-a-full-board dream** — it
enriches planning and reshaping ahead of a gentle flood rather than adding a
twitch race or a placement queue; (2) puts any new pipe/flow math in the **pure,
tested `pipeLogic.ts`**, not buried in the canvas loop, with new unit tests; and
(3) stays **legible at 40px** in the established color language. Then build it,
run it locally on a large window, and confirm twisting a full board toward the
creeping water still feels like a slow, pleasant daydream before committing.
