# Big Ast Tiny eRoids — Game Instructions

App-specific notes for the Big Ast Tiny eRoids game. The repo-wide `CLAUDE.md`
(local review before deploy, **tests for every change**, deployment guards, the
standard per-entity feedback feature) and the Big Tiny Games house style still
apply on top of this.

## North Star: classic Asteroids, escalated into a light show

This is our take on **Asteroids**, drawn in the glowing line-art of the old
vector-monitor arcade cabinets (Asteroids, Star Castle, Tempest). Two things
set it apart from the same-old rock shooter, and every feature should serve at
least one of them:

1. **An arsenal worth scavenging.** The default pea shooter is deliberately
   modest; the game is about chasing weapon drops and the escalating power
   fantasy they buy — machine gun → super bullets → laser → super laser →
   ultra laser → puffball. Ammo always runs dry, so the high never lasts and
   the hunt starts again.
2. **The StarCastles.** The "UFO" is a boss: a tiny winged gunship wrapped in
   counter-rotating rings of flat, gapless shield segments (an homage to Star
   Castle). The core slowly turns and pot-shots **only along its own facing**,
   its rings slowly **regenerate**, and the moment a radial hole through every
   ring lines up with your ship it charges and looses a **nova** — a slow,
   radiant bullet that starts small and **swells as it flies**, vaporizing
   rocks and ship alike before dying at the screen edge (it never wraps; no
   lasers from the castle). Novas get **faster and bigger with the wave**.
   Your own path to its core is the same hole it shoots through. Castles
   escalate with the wave: **one more shield layer each wave** (2 at wave 1,
   capped at 6), they spawn **faster** each wave, **up to `wave` of them at
   once**, each arrival announced by an ominous drone.

### The arsenal (all rules in `roidsLogic.ts`)

| Weapon        | Behavior                                                                 | Ammo |
| ------------- | ------------------------------------------------------------------------ | ---- |
| Pea shooter   | Default projectile, infinite                                             | ∞    |
| Machine gun   | The whole magazine rushes out as a held-trigger spray (12.5ms cadence)   | 100  |
| Super bullets | ~4× the size; burst into **20 regular bullets** on impact                | 16   |
| Laser bolt    | Hitscan — instantly hits the first thing in line                         | 24   |
| Super laser   | Hitscan, **penetrates everything** out to the screen edge                | 12   |
| Ultra laser   | Hitscan, penetrates **and wraps** for 10 screen lengths                  | 6    |
| Puffball      | Circular energy blast centered on the ship; vaporizes (no splits) nearby | 3    |

All fire cooldowns are in `FIRE_COOLDOWN` (halved once already — the game
likes a high rate of fire). While a laser tier is armed, a **faint sight
line** previews the exact path of the next shot every frame (including
pierces and the ultra's wrap), via the pure `traceHitscan` — the same
function `fireHitscan` uses to apply damage, so the preview can never lie.

Defensive drops: **shield power** (+2, max 5 — absorbs any hit, shatters the
offending rock), **bouncy armor** (18 s — rocks and shield rings deflect the
ship instead of harming it; bullets and the nova still hurt), and the rare
**extra ship**. Player bullets **fly all the way to the screen edge** and die
there (they never wrap; only the ultra laser gets the wrap).

### Principles for new features

- **Weapons stay distinct.** A new weapon must create a visibly different
  firing pattern/decision, not just bigger numbers.
- **Risk and reward together.** Drops fall where rocks die — usually in the
  most dangerous spot on the field.
- **The castle telegraphs — but never with a line.** Every deadly castle move
  is signposted (the core flares and a proto-nova orb swells on it during the
  charge). Nothing the castle does may ever draw a beam/laser line; its
  attacks are always bullets. Deaths should feel readable, never random.
- **Stay legible in the glow.** Honor the color language: white = ship,
  ice-blue = rocks (and their debris shards), gold = friendly fire and the
  vector score, red = enemy fire and the nova, shield rings cycle
  green/gold/red/… outer→inner, hexagon + letter = powerup, and every pickup
  announces itself with a rising floater in its own color. Everything is drawn
  at ~50% scale with **thin oscilloscope-bloom strokes** (two soft halos + a
  hot core in `glowStroke`) — density carries the spectacle, not sprite size.
  The score and remaining ships live **inside the game** as seven-segment
  vector digits and little hulls; an armed weapon shows as a **red dot on the
  ship's nose** that blinks faster as the magazine runs low.
- **Everything wraps.** The field is a torus; the ultra laser, the ship, rocks
  and bullets all use it. Mechanics that exploit the wrap are on-theme.

## Architecture / where things live

The hard rule (see the repo `CLAUDE.md`): **gameplay rules live in a pure,
framework-free module and are unit-tested; rendering and timers stay in the
component.**

- `roidsLogic.ts` — the **pure game model** and the only place rules live:
  dt-based `step(state, input, dt, rng)` (mutates the given state, pipeLogic
  style), ship physics (turn/thrust/drag/wrap), rocks that split 3→2→1, the
  whole arsenal (`fireWeapon`, hitscan `fireHitscan` with wrap-walking beam
  segments, `firePuffball`), the weighted powerup drop table, shield /
  bouncy / lives damage rules (`hitShip`), wave progression, and the entire
  StarCastle fleet (`makeCastle` with per-wave layer count, ring rotation +
  regen, the aimed core gun, `castleHoleAt` hole detection, the charge→nova
  launch and `stepNovas` flight/growth/carving, spawn cadence `castleInterval`
  capped at `wave` simultaneous). Deterministic: rng is injectable everywhere.
  Sounds are data too: rules push `SoundEvent`s onto `state.events` (cleared
  each step) and the component drains them into the sfx; pickups push rising
  `state.floaters`, and explosions push `state.debris` line shards.
- `roidsLogic.test.ts` — unit tests for all of the above (the safety net;
  extend it for every rule change). Uses `seqRng`/`lcg` helpers plus
  `freshState`/`parkedRoid`/`quietCastle` builders for exact setups.
- `BigAstTinyERoids.tsx` — the **render + loop + input** layer: a
  `requestAnimationFrame` loop, the vector-glow canvas renderer (each path
  stroked twice — fat translucent + thin bright — under `lighter`
  compositing, with a translucent-black fill each frame for phosphor
  persistence trails), held-key input (keydown/keyup), per-frame gamepad
  polling, virtual touch buttons (coarse-pointer only), the HUD, the
  idle/gameover/saved overlays, and the high-score flow
  (`GET/POST /api/leaderboard` **with the `game` slug passed explicitly**).
- `BigAstTinyERoids.module.css` / `BigAstTinyERoidsPage*` — fill-the-stage
  layout, overlays, touch buttons; page chrome (lobby link, title, footer).
- Registered in `../registry.ts` (id `big-ast-tiny-eroids`, route
  `/big-ast-tiny-eroids`).

Standard wiring: the title screen carries
`<FeedbackPanel entity="big-ast-tiny-eroids" />`; analytics fire `game_start`,
`game_over` (with score) and `score_submitted` via `lib/analytics`. Feedback
itself is owned by the shared feedback service (see the repo-root `CLAUDE.md`).

## Current defaults worth knowing (tune freely)

- Waves: **`10 + 5·wave` big rocks per million square pixels**
  (`waveRoidCount`, floor 1, perf ceiling 120), spawned ≥120 px from the ship;
  the next wave starts the moment the field is clear (even mid-castle).
- Scores: rocks 20/50/100 (big/med/small), castle shield segment 25, castle
  core **1500** (+ two guaranteed powerup drops).
- Castles: first at 18 s; spawn interval `max(8, 26 − 2·(wave−1))` s, and up
  to **`wave` castles at once**. Layers = `min(1 + wave, 6)` (inner ring r 36,
  +16 px per layer; 8 segments inner, +2 per layer outward). Rings regenerate
  one destroyed segment per ring every 7 s. The core gun fires along the
  core's facing at **30% of the old cadence** (~1.7–5.7 s between shots).
- Rock drift: `base + rng·base + 2·wave` px/s with base 20/35/55 (big/med/
  small) — half the original pace; splits stay 3→2→1.
- Nova: 0.9 s telegraphed charge (flaring core + swelling proto-nova orb — no
  aim line), then a bullet at `min(90 + 18·wave, 260)` px/s swelling from r 4
  to `min(28 + 6·wave, 80)` over 1.2 s; 4.5 s cooldown. Its **kill radius is
  the reach of its outermost radiation line** (`novaHitR = 1.5r + 6`); the
  rays are drawn from the bullet's center out to that reach, so if a line can
  touch you, so can the nova. A deep synth buzz (`novabuzz.wav` loop) runs
  for as long as any nova is in flight. Shield blocks one touch (1 s grace) —
  but sitting inside a passing nova longer than the grace is fatal.
- Castle collisions are **wrap-aware**: bullets, beams and the ship's hull
  all collide with the nearest torus image of a castle (`nearestImage`; beams
  check all nine images), so the wrapped-around part of an edge-straddling
  castle is fully solid and shootable.
- Ship feel: turning has angular inertia (`TURN_ACCEL` 35 rad/s² up to
  `TURN_RATE` 4.2 rad/s, braking at the same rate on release).
- Powerup pods drift for 22 s before fading; bouncy armor runs 18 s.
- Drops: 12% chance per destroyed rock, weighted table in `DROP_TABLE`
  (extra life rarest at 5/100).
- Sound: `sfx.ts` plays the placeholder synth WAVs in `assets/sounds/` (all
  <2 s, hand-editable — regenerate or replace freely), gated by the shared
  `lib/volume` master + the `VolumeControl` on the title screen. One-shot clip
  names match the model's `SoundEvent` union (`castlespawn` → `ominous.wav`;
  `boom` is the deep rumbly rock explosion; `shipdown` is a high-pitched
  white-noise blast; `empty` is the magazine-dry click). `thrust.wav` (engine
  rumble) and `novabuzz.wav` (live-nova buzz) are seamless loops driven by
  `Sfx.setLoop` (integer-Hz partials only, so regenerated versions must also
  loop cleanly).

## How to evaluate a change here

A feature is done when it (1) serves the **arsenal-chase or the
castle-as-boss** fantasy rather than adding generic polish; (2) lives as a
**rule in the tested pure model** with new unit tests, not a one-off in the
render loop; and (3) **stays readable in the glow** — the established color
language holds and deadly things telegraph. Then run it locally, lose a ship
to the sweep on purpose, and make sure you knew exactly why you died.
