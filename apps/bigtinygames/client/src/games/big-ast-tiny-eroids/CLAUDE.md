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
2. **The StarCastle.** The "UFO" is a boss: a core wrapped in three
   counter-rotating segmented shield rings (an homage to Star Castle). It
   pot-shots small bullets at random, its rings slowly **regenerate**, and the
   moment a radial hole in all three rings lines up with your ship it charges
   and **sweeps a wide destructive beam** across your half of the sky —
   vaporizing rocks and ship alike. Your own path to its core is the same hole
   it shoots through.

### The arsenal (all rules in `roidsLogic.ts`)

| Weapon        | Behavior                                                                 | Ammo |
| ------------- | ------------------------------------------------------------------------ | ---- |
| Pea shooter   | Default projectile, infinite                                             | ∞    |
| Machine gun   | ~4× fire rate, slight spray                                              | 120  |
| Super bullets | Explode into a radial burst of frag bullets on impact                    | 16   |
| Laser bolt    | Hitscan — instantly hits the first thing in line                         | 24   |
| Super laser   | Hitscan, **penetrates everything** out to the screen edge                | 12   |
| Ultra laser   | Hitscan, penetrates **and wraps** for 10 screen lengths                  | 6    |
| Puffball      | Circular energy blast centered on the ship; vaporizes (no splits) nearby | 3    |

Defensive drops: **shield power** (+2, max 5 — absorbs any hit, shatters the
offending rock), **bouncy armor** (9 s — rocks and shield rings deflect the
ship instead of harming it; bullets and the sweep still hurt), and the rare
**extra ship**.

### Principles for new features

- **Weapons stay distinct.** A new weapon must create a visibly different
  firing pattern/decision, not just bigger numbers.
- **Risk and reward together.** Drops fall where rocks die — usually in the
  most dangerous spot on the field.
- **The castle telegraphs.** Every deadly castle move is signposted (flaring
  core + flickering aim line during the charge). Deaths should feel read-able,
  never random.
- **Stay legible in the glow.** Honor the color language: white = ship,
  ice-blue = rocks, gold = friendly fire, red = enemy fire and the sweep,
  green/gold/red = shield rings (outer→inner), hexagon + letter = powerup.
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
  StarCastle (`makeCastle`, ring rotation + regen, random pot-shots,
  `castleHoleAt` hole detection, the charge→sweep beam). Deterministic: rng is
  injectable everywhere.
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

- Waves: `2 + wave` big rocks (cap 12), spawned ≥170 px from the ship; next
  wave starts the moment the field is clear (even mid-castle).
- Scores: rocks 20/50/100 (big/med/small), castle shield segment 25, castle
  core **1500** (+ two guaranteed powerup drops).
- Castle cadence: first at 18 s, then 26 s after each kill; rings regenerate
  one destroyed segment per ring every 7 s.
- Sweep: 0.9 s telegraphed charge, then a 100° arc over 1.3 s centered on
  where you were. Shield blocks one tick of it (1 s grace).
- Drops: 12% chance per destroyed rock, weighted table in `DROP_TABLE`
  (extra life rarest at 5/100).
- No sound yet — when adding it, follow the house pattern (`sfx.ts`, WAV <2s,
  shared `lib/volume` + `VolumeControl` on the title screen).

## How to evaluate a change here

A feature is done when it (1) serves the **arsenal-chase or the
castle-as-boss** fantasy rather than adding generic polish; (2) lives as a
**rule in the tested pure model** with new unit tests, not a one-off in the
render loop; and (3) **stays readable in the glow** — the established color
language holds and deadly things telegraph. Then run it locally, lose a ship
to the sweep on purpose, and make sure you knew exactly why you died.
