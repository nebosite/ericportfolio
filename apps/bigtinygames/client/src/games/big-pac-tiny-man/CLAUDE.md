# Big Pac Tiny Man — Game Instructions

App-specific notes for the Big Pac Tiny Man game. The repo-wide `CLAUDE.md`
(local review before deploy, **tests for every change**, deployment guards, the
standard per-entity feedback feature) and the Big Tiny Games house style still
apply on top of this.

## North Star: Pac-Man as a low-stress game of mindfulness

This is **not** the tense, twitchy arcade score-chase. It's the same beloved
silhouette — a little man wandering a labyrinth, eating dots, ghosts about —
drained of its adrenaline and turned into something **calm, slow, and
meditative**. The pleasure is the **unhurried wander**: a tiny man feeding his
way across a maze **as big as your whole monitor**, in no particular rush, with
nothing punishing breathing down his neck.

The signature move is the inversion of scale and stakes: **Big maze, tiny man,
gentle ghosts.** The maze fills the physical screen (up to 4K); the ghosts amble
at **less than half** the player's speed, stay **leashed** near home, and drift
rather than hunt. The feeling to protect is _flow and ease_, not challenge.

So every feature should answer one question first: **does this keep the
experience low-stress and mindful?** If it adds pressure, urgency, punishment, or
twitch demands, it's almost certainly wrong for this game.

### Principles for new features

- **Low stress, always.** No time pressure, no harsh fail states, no spikes in
  difficulty, no precision/twitch demands. Ghosts stay ambient and forgiving;
  losing should never feel sharp. When in doubt, make it gentler.
- **Mindful scale is the point.** The enormous, calm maze and the tiny man within
  it are the whole vibe. Preserve the sense of a vast, quiet space to roam.
- **Flow over challenge.** Reward relaxed, exploratory wandering and steady
  feeding. Don't make the player tense up or optimize.
- **Soothing sensory feedback.** Gentle motion and sound (the soft munch, calm
  sprites) that relax rather than alarm. Avoid jarring flashes or harsh audio.
- **Keep the classic silhouette, lose the cortisol.** It should still read as
  Pac-Man at a glance — dots, ghosts, power pellets, tunnels — but feel like a
  slow breath, not a high-score grind.

The existing tuning encodes this intent; treat these as the calm baseline before
changing anything (all in `engine.ts`): `PAC_SPEED 150` vs `GHOST_SPEED 60`
(ghosts amble at under half speed), `CHASE_RADIUS 20` (only hunt when very
close), `LEASH 30` (wander, then drift back home), `FRIGHT_MS 8000` (long, easy
fright windows). Nudge these toward _calmer_, rarely toward _harder_.

## Architecture / where things live

The hard rule (see the repo `CLAUDE.md`): **the maze topology and ghost-AI math
live in pure, framework-free modules and are unit-tested; the pixi/DOM/timer
coupling stays in the engine.** Extract any new rule's logic into the pure layer
and test it in the same change.

- `grid.ts` — **pure** grid + pathfinding helpers, extracted from the engine so
  they can be unit-tested with no DOM/pixi/timers: toroidal `wrap`, `torusDist`,
  BFS distances, gradient/`bestTowardTarget` chase steps, `chooseSpacedTiles`.
  This is where ghost-AI and maze math belong.
- `maze.ts` — **pure** world sizing + maze generation. `planWorld` scales the
  counts (ghosts, power pellets, ghost houses) with screen **area** relative to
  the 1980 original; `generateMaze` builds the lattice. `TILE = 16` (arcade
  sprite cell). The premise: sprites stay arcade-size while the maze fills the
  physical pixels.
- `grid.test.ts` / `maze.test.ts` — the unit tests for the two pure modules
  (the safety net; extend them for every logic change).
- `engine.ts` — the **pixi-coupled game**: the `Application`/`Ticker` loop,
  rendering (dots batched per `CHUNK` for performance, maze walls as geometry),
  movement, ghost behavior, scoring, fright/eat-ghost flow, and input via the
  shared `../input` `attachGameInput`. All the gameplay **tuning constants** live
  at the top here. Keep pure math out of here — call into `grid.ts`/`maze.ts`.
- `sprites.ts` — loads the gameplay graphics, which are **editable PNGs** in
  `assetts/sprites/` at real arcade size (Pac 13×13, ghosts 14×15, etc.); the
  ghost body is tinted per ghost. Reskin by replacing the PNGs — nothing is
  generated. (Dots and walls stay code-drawn geometry.)
- `sfx.ts` — sound via the Web Audio API, playing the **MP3s** in
  `assetts/sounds/` as cheap overlapping one-shots (the munch `waka` is throttled
  so it doesn't machine-gun). Replace the MP3s to change the sounds.
- `BigPacTinyManPage.tsx` / `BigPacTinyMan.module.css` — the page: hosts the pixi
  canvas, the start gate, the score HUD, and the standard feedback panel. **The
  maze derives from the page size**, so a resize regenerates the world — but only
  until play begins; once started, the world locks and a resize just letterboxes.
- Registered in `../registry.ts` (id `big-pac-tiny-man`, route
  `/big-pac-tiny-man`).

Standard wiring: the title/start screen carries
`<FeedbackPanel entity="big-pac-tiny-man" />`. This game keeps **no per-app
server data** (the bigtinygames server is health-only for it); feedback is owned
by the shared feedback service (see the repo-root `CLAUDE.md`).

## How to evaluate a change here

A feature is done when it (1) keeps the experience **low-stress and mindful** —
it deepens calm, flow, and unhurried exploration rather than adding pressure or
punishment; (2) puts any new maze/AI math in the **pure, tested modules**
(`grid.ts`/`maze.ts`), not buried in the pixi engine; and (3) still **reads as
Pac-Man** at a glance. Then build it, run it locally on a large window, and check
that wandering the big maze still feels like a slow, easy breath before
committing.
