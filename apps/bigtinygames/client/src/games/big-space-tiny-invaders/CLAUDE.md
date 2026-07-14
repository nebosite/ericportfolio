# Big Space Tiny Invaders — Game Instructions

App-specific notes for the Big Space Tiny Invaders game. The repo-wide
`CLAUDE.md` (local review before deploy, **tests for every change**,
deployment guards, the standard per-entity feedback feature) and the Big Tiny
Games house style still apply on top of this.

## North Star: Space Invaders at absurd scale

This is our take on **Space Invaders** with the axis of exaggeration turned
all the way up: not 55 invaders but **thousands** — a wall of tiny 7px aliens
filling almost half the monitor — against one tiny cannon. Everything about
the design flows from that scale:

1. **The horde is a weather system, not a set of enemies.** Every game (and
   every level) opens with the whole horde **flying in** — each invader takes
   its **own curving spline straight to its slot**, the **lowest rows filling
   first**, and the whole grid (deep enough to cover the top half of the
   screen) populates in **~4 seconds**. You don't clear it invader by invader;
   you carve into it with area weapons while the classic march grinds down.
   The three tiers differ: **grunts** (bottom, 10pts) and **soldiers**
   (middle, 20pts — they drop **3× the bullets**) hold formation; **elites**
   (top, 30pts) are the **only tier that flies low**, detaching as galaga-style
   **squadrons of 10–15** that swoop over your sky (never below 10px above the
   shield tops) and glide back. **Wipe out a whole squadron** before it
   returns for a **+1000 bonus** (rising banner). **Destroyed invaders are
   never replaced** — every hole is permanent for the level.
2. **Performance is a design constraint, not an afterthought.** Tens of
   thousands of objects (invaders + scrap grains) must step, collide and draw
   at 60fps. Every mechanic added here must respect the data layout that
   makes that possible (see Architecture).

### Charge — one shared ammo pool

Bullets and missiles both drain a single **charge** pool (starts **2500**,
**+20/sec** passive, **+20 per scrap grain** collected — the numbers are
deliberately big and chunky). Costs: **pea/sprinkler bullet 10**, **chain shot
500**, **missile 1000**. Out of charge = no shot (the weapon never "runs dry"
into the gun; it just can't fire). Air support and the nuke keep their own
stockpile counts (from pickups).

### Shooting weapons — selectable

The equipped shooting weapon is one of the **unlocked** ones (`state.weapons`,
starts `["gun"]`; sprinkler/chain pickups unlock + equip them). **Z / right-
click / Ctrl** cycles through them (`cycleWeapon`).

- **Pea cannon** (default) — single shots, straight up. Cost 1.
- **Sprinkler** (unlock) — a rapid spray sweeping a 20° arc. **Stackable**:
  each `sprinklerStack` is **+50% fire rate** (max +3). Cost 1/bullet.
- **Chain bullets** (unlock, cost **50**/shot — a horde-clearer). The bolt
  buzzes with crackly blue energy; on impact it **forks to the 4 nearest
  unharmed ships**, each fork a homing bolt that arcs _over_ everything to land
  exactly one kill. Forks run **3 generations** (~**1+4+16+64 ≈ 85** kills); a
  fork with nothing inside a **10-grid radius** dies. **Stackable**: each
  `chainStack` adds a generation (max +3 → up to 6 generations).

### Specials

- **Missiles** (mouse!) — click to fire a missile that glides a smooth bezier
  to that point (flashing **target cross** until it lands) for a 5-invader
  blast, **bending through the nearest shield gap**. Fuelled by charge (100).
  The **missile pickup is a stackable upgrade**: each **doubles the blast
  area** (`missileStack`, radius ×√2, max +3 → ×8 area).
- **Air support** (X, stockpiled) — a **barrage of 50 half-strength missiles**
  (`airMissiles`) raining from above the strike x, each spread ±200px and
  exploding on the first invader / shield / ground it hits (half the normal
  blast radius). **A missile landing on the ship kills it** — calling it over
  your own head is dangerous. **Stackable**: each `airStack` is **+30% spread
  width** (max +3).
- **Ground nuke** (C, stockpiled — the pickup grants a nuke to drop **and**
  stacks its area). Drops a fused charge that **rises ~200px/s** while the fuse
  burns; 1.5s later a **plasma-filled hemisphere** (base radius **30 invaders**,
  `nukeStack` doubles the area per pickup up to +3) vaporizes everything inside
  — invaders, flyers, UFOs, enemy fire, **shield walls, and the player**. It
  leaves a glowing patch of **molten ground** (`lavas`) at the launch x that
  stays deadly-hot ~3.5s (post-respawn invuln protects you). Because it rises,
  the blast now goes off mid-air and is less likely to catch the ship.
- **Rebuild walls** (`wall` pickup, "W") — instantly restores every shield
  wall to full.

**Scrap & charge:** only ~**1 in 10 kills** sheds scrap — 1–2 sparkly
**blue/white** grains (each fades between shades on its own 200–400ms cycle)
that drift, fall (and **die 2s after landing**), and add **+20 to the shared
charge pool** when collected. UFOs are **rare and solitary**
(one at a time, ~25–45s apart, **worth 1000**); after a visible charge-up each fires a bright,
animated straight-down laser whose leading front **crawls to the ground over
2 seconds** (so you have two full seconds to slide out from under it — it only
harms the player once it lands), and always drops a powerup when shot. A UFO
can be killed by a **missile or nuke blast** too (`killInCircle` reaches them),
not just a direct bullet. **Shoot
the UFO down and it stays gone for the rest of the level** (a fresh one only
appears next level). Powerups **fall under
the same gravity as the debris, land on the ground, and fade after ~4s**
(blinking first); catching one announces itself with **rising text** near the
ship. Shield walls (~5 per 1000px of width) erode cell by cell — **player
rounds punch 3× bigger holes** than enemy fire, and a battered wall
**occasionally shakes a powerup loose** (5% per bullet bite). **Dying costs
your toys**: weapon back to the pea cannon, air/nuke stock zeroed, missiles
clipped to the starter 3 — and the ship goes out as a firework with a deep
boom. Levels: a fresh, faster, more trigger-happy horde flies in each time
the field is cleared. The HUD (score, level, ships, weapon, stock, energy) is
drawn **inside the battlefield** in big arcade text.

### Principles for new features

- **Respect the scale.** New mechanics should be area-shaped or horde-shaped;
  anything that only affects one invader at a time is invisible here.
- **Carve vs refill.** The core tension is your ability to carve holes vs the
  horde's ability to march, dive and refill. Keep both sides growing.
- **Stay in budget.** New per-entity work must be O(active entities), never
  O(grid). The formation is data (typed arrays), not objects; collision
  against it must go through grid indexing (`slotAt`/`hitSlotAt`) or bounded
  region scans, never linear scans per bullet.
- **Legible at 7px.** Green/cyan/magenta tiers, red = enemy fire, gold =
  yours, amber shimmer = scrap. Boxed letters = powerups.

## Architecture / where things live

The hard rule (see the repo `CLAUDE.md`): **gameplay rules live in a pure,
framework-free module and are unit-tested; rendering and timers stay in the
component.**

- `invadersLogic.ts` — the **pure game model** (mutating `step`, pipeLogic
  style; injectable rng). The formation is a **struct of typed arrays**
  (`alive: Uint8Array`, per-row/col counts, cached extents) moved rigidly by
  an origin — O(1) marching regardless of size. Bullet collision is **grid
  indexed** (O(1) per bullet substep); blasts/chains scan only their bounding
  region. Scrap is a preallocated **SoA particle pool** with swap-removal.
  Flyers/UFOs/bullets are small plain arrays. Sounds are `SoundEvent`s on
  `state.events`; formation deaths/births are reported per-step via
  `state.deadSlots`/`state.bornSlots` so the renderer can patch instead of
  repaint; shields carry a `dirty` flag.
- `invadersLogic.test.ts` — unit tests for all of the above (the safety net;
  extend it for every rule change).
- `BigSpaceTinyInvaders.tsx` — the **render + loop + input** layer. The
  performance core: the formation is pre-rendered onto **two offscreen
  canvases** (animation frames) and blitted with a single `drawImage`;
  deaths/births clear/draw single 8px cells; a level change rebuilds them.
  Shields render to small offscreen canvases repainted only when dirty.
  Scrap draws as two batched single-fillStyle passes (alternating grains
  twinkle). Input: ◀▶ move, Space fire (held), **mouse/tap = missile**, X =
  air support, C = nuke; gamepad and coarse-pointer touch buttons included.
- `sfx.ts` + `assets/sounds/*.wav` — placeholder synth clips (<2s,
  hand-editable); one-shot names match the `SoundEvent` union, plus two
  loopable extras (`ClipName = SoundEvent | "siren"`). The **UFO `laser`** and
  the **fly-in `siren`** (an echoey air-raid wail — carrier phase + wail LFO
  chosen for a seamless loop, with circular echo taps) are driven by
  `Sfx.setLoop`: the laser while any beam descends; the siren from the start of
  the fly-in (warmup + settle), then **`Sfx.fade`d out over 2s** once everyone
  has landed. `boom` (missile blast) is a deep echoey sub-thump + delay taps.
  The active shooting weapon shows as a small **icon in a ~20px status band
  under the ship** (`drawWeaponIcon`), not as bottom-bar text.
- `BigSpaceTinyInvaders.module.css` / `BigSpaceTinyInvadersPage*` —
  fill-the-stage layout, overlays, touch buttons; page chrome.
- Registered in `../registry.ts` (id `big-space-tiny-invaders`, route
  `/big-space-tiny-invaders`).

Standard wiring: the title screen carries
`<FeedbackPanel entity="big-space-tiny-invaders" />` and a `VolumeControl`;
analytics fire `game_start`, `game_over` (with score) and `score_submitted`;
high scores use the shared `/api/leaderboard` **with the `game` slug passed
explicitly**.

## Current defaults worth knowing (tune freely)

- Grid: 9px pitch (7px invader + 2px gap); `formationDims` ≈ 76×33 (~2.5k) at
  800×600, ~11k at 1920×1080, hard-capped at 20k slots; rows cover the top
  half of the screen. March speed
  `min(150, (10+6·level)·(1+2·(1−aliveFrac)))`, drop 10px per edge; reaching
  the ground = game over. The march **recomputes the true alive column/row
  extent from the counts every frame** (not a maintained minCol/maxCol) so a
  thinned horde can never scroll off the edge on a stale extent.
- Intro (`makeIntroQueue` + `launchIntro`): an air-raid **siren wails for a
  `INTRO_WARMUP` (3s) warmup** with nothing on screen, then the queue — every
  slot ordered **lowest row first** (shuffled within a row) — launches over
  `INTRO_LAUNCH_WINDOW` (3s) so with ~1s flights the grid fills ~4s after the
  warmup. Each invader flies its **own** short curving bezier from offscreen
  straight to its slot (no low swoop). March is **paused until the fill fully
  settles** (`introDone`). Per-ship steering jitter (`FLYER_JITTER`) fades on
  settle.
- Horde fire: `min(20, 1.5+1.2·level)` shots/s, **one bullet per tick** from a
  weighted pick of a few sampled columns' bottom-most invaders — **soldiers
  are weighted `SOLDIER_FIRE_WEIGHT` (3×)** so they fire ~3× as often as other
  tiers (single bullets over time, never a burst); capped at 150 live bullets.
- Dive squadrons: 10–15 **elite** ships (`SQUAD_MIN/MAX`), staggered 0.12s
  along a shared spline (offsets shrink once airborne → follow-the-leader),
  slow 9s swoop to the floor and back up, 2.6s return; floor at `swoopFloorY`
  (shield tops − 10px); each fires often (~0.5–1.25s). A `Squad` record tracks
  killed/returned; a clean wipe (`resolveSquad`) pays `SQUAD_BONUS`.
- Missiles fly their bezier at 840 px/s.
- Scores: invader tiers 10/20/30 (grunt/soldier/elite), flyer 50, UFO **1000**,
  full-squadron wipe **+1000**.
- Scrap: only ~**1/10 of kills** shed any (`SCRAP_DROP_CHANCE`), then 1–2
  grains, 10–15s airborne life but **only `SCRAP_GROUND_TTL` (2s) once landed**,
  pool capped at 15k; magnet radius 60, pickup radius 16.
- Powerups: **0.08%** drop per invader kill (`POWERUP_CHANCE`, 1/10 of before),
  shield-bite drop 0.5%; always from a shot UFO; caught at the ship. **Extra
  ships are rare** (life weight 0.8,
  ~1/10 of the others).
- Starter loadout: 250 charge, 3 lives, gun only. Stack upgrades (`chainStack`/
  `missileStack`/`nukeStack`/`sprinklerStack`/`airStack`, `areaStackMul` =
  √2^stack; sprinkler/air are linear per-stack) persist across levels but are
  **lost on death** along with the rest of your toys (the charge pool is kept).
- The title screen shows a **legend of every enemy and power-up**; the
  game-over and saved overlays carry a **BACK TO LOBBY** link.

## How to evaluate a change here

A feature is done when it (1) serves the **absurd-scale fantasy** — carving
into a living wall of thousands; (2) lives as a **rule in the tested pure
model** with new unit tests, and stays inside the perf budget (no O(grid)
work per frame, no per-invader objects); and (3) reads at a glance at 7px.
Then run it locally full-screen, watch the frame rate with a nuke going off
inside 10k invaders, and make sure the scrap still shimmers.
