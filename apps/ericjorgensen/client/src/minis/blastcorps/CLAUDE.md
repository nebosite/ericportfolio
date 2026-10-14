# Blast Corps Reimagined — working notes for this folder

A "Pure AI Output" mini on ericjorgensen.com (`/blast-corps-reimagined`). Homage to
Blast Corps (Rare, N64, 1997): heavy vehicles, buildings in the way. The difference
is the brief this folder serves.

## North Star (from the brief — do not drift)

> Extreme physical realism plus knocking over buildings. Buildings made of hundreds
> to thousands of little parts whose destruction is **simulated in real time**. Tune
> the part count to fit, but use every CPU on the PC and the graphics card.
> Slice 2: skyscrapers of 10–50 stories (columns, beams, floors, glass), ten of them on a
> street, a fanciful 30 ft × 50 ft tractor doing 200 km/h in 5 s, follow camera plus a
> driver's-eye picture-in-picture after a strike, smoke/debris/sparks/steam/fire, layered
> rumble, a hardware-probe stats window with highs and lows. "This step is to probe what
> the hardware can do."

Corollaries we hold to:

- Every part is a dynamic rigid body from load. No static walls that "become" dynamic.
- No scripted collapse, authored fracture, impulse injection, or damping/velocity
  clamps beyond engine defaults. A joint fails only because the solver measured a
  force beyond what a connection of the configured strength carries.
- Break thresholds in physical units (Pa, N·m), with the solver settings they were
  tuned under recorded here. Margins are measured by headless tests, never assumed.
- Headless tests run the real wasm, not mocks.
- Stated limits of the model (slice 2): **members are unbreakable; connections break.**
  Towers topple and shed parts; they do not pancake through their own columns except
  where a splice crushes. See "What the probe found".

## The three lenses (keep using them)

Work on this folder is reviewed by three deliberately opposed perspectives. When
planning a slice, write the plan down and have each lens attack it before coding;
check in with them mid-slice when measurements force a change.

- **Physicist** — realism and parallelism. Vetoes fakery; asks for measurement.
- **Game Designer** — ten-seconds-to-fun. Vehicle feel, camera, feedback, loop,
  instant restart, no menus in the way, pad+keyboard parity.
- **Shipwright** — small tested pieces that ship this session. Pure logic in plain
  modules with Vitest; glue thin and mocked in page tests; repo conventions.

Decisions they fought over, and the outcome:

| Question                     | Physicist                                    | Designer                           | Shipwright                   | Shipped                                                                                     |
| ---------------------------- | -------------------------------------------- | ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| Mortar model (slice 1)       | real per-joint force                         | —                                  | simplest honest rule         | SixDOF constraints, `GetTotalLambdaPosition/Rotation`; tension/shear/bending (M/Z)          |
| Brick mass                   | 150–300 kg                                   | 3–5 kg if the truck stops dead     | —                            | 200 kg hollow block; the dozer got heavier instead                                          |
| Contacts between glued pairs | filter them                                  | —                                  | —                            | filtered (GroupFilterTable); re-enabled on break                                            |
| Multithreading               | MT later                                     | —                                  | probe first — it sets limits | MT Jolt behind COOP/COEP on the route; 16 threads measured                                  |
| Bend/break (long elements)   | motor-based plastic hinge, not spring limits | cut: invisible at 55 m             | defer                        | cut; rigid segments + breakable joints                                                      |
| Joint capacity               | (material, material) connector table         | —                                  | —                            | `materials.ts`: splices, moment connections, composite deck, silicone, mortar               |
| Slabs (see below)            | pinned by one stud                           | —                                  | —                            | pinned; only on towers ≤ 12 stories by default (`floors` policy)                            |
| Beams' mass                  | section mass (W21×62 = 92 kg/m), not box     | —                                  | —                            | explicit 490 kg                                                                             |
| Street layout                | —                                            | stagger so a straight run hits all | —                            | one tower per 36 m pitch, alternating, inner column line 1.5 m over the centreline          |
| Goal                         | —                                            | towers felled, not % by mass       | —                            | Street Leveled when every tower is ≥ 50% displaced by mass; end-of-street card otherwise    |
| Contact feedback             | —                                            | strike-onset hit-stop + thud       | —                            | first break within 20 m after 0.4 s quiet → hit-stop ~70 ms, thud, FOV punch (speed-scaled) |
| Driver PIP                   | —                                            | cut (looks backward at 50 m/s)     | —                            | kept (the brief asks for it) but aimed at the struck tower's centre, 6 s hold               |
| HUD stats                    | split timings; heap; threads                 | hide behind a toggle               | hi/lo rows, GPU string       | panel under the arena, F3/Back toggles, current/low/high, reset                             |

## Architecture

```
BlastCorpsPage.tsx         React shell: title (scene dials), HUD, end card, StatsPanel, analytics
StatsPanel.tsx             hardware probe: current / low / high rows, threads, isolation, GPU
GameHost.ts                main-thread conductor: bridge ⇄ input ⇄ renderer ⇄ audio, rAF, StatTracker
PhysicsBridge.ts           Worker wrapper; two snapshot buffers ping-pong by transfer
stats/StatTracker.ts       pure hi/lo tracking
input/controls.ts          pure: keyboard + pad → DriveControls (one throttle, one brake, slow-mo hold)
input/KeyboardSource.ts    held keys + one-shot actions (R reset, Esc quit, F3 probe)
input/GamepadSource.ts     polled standard-mapping pad (Start reset, B quit, Back probe, LB slow-mo)
render/SceneRenderer.ts    three.js: PartsMesh, VehicleModel, follow cam (speed-scaled), strike hit-stop, PIP
render/PartsMesh.ts        one InstancedBufferGeometry, poses as interleaved instance attributes (GPU-posed)
render/VehicleModel.ts     dozer and the "industrial Terminator" tractor from boxes/cylinders/emissives
render/particles.ts        pure ring buffer + burst recipes (dust, chip, smoke, steam, shard, spark, flame)
render/ParticleSystem.ts   THREE.Points with GPU integration (p0 + v0·t + ½g·t², ground clamp)
render/Effects.ts          break events → bursts; fires near steel breaks; steam on service floors
render/pip.ts              pure PIP trigger/hold state
audio/mix.ts               pure violence→gain curves (engine, turbine, road, sub, roar, thud)
audio/Rumble.ts            Web Audio graph, procedural; strike/impact thuds; glass bursts
sim/protocol.ts            messages + snapshot layout (header, break events, per-structure demolition, poses)
sim/joltFlavour.ts         pure: which Jolt build + thread count for this page
sim/physics.worker.ts      thin worker: dynamic import of the Jolt flavour, pthread-helper guard, loop
sim/Simulation.ts          world + structures (streamed one per tick) + vehicle + fixed clock + time scale
sim/PhysicsWorld.ts        Jolt owner: layers, settings, shape cache, active-body scan, heap readback
sim/Building.ts            parts + glue joints, pre-settle, per-step connection failure, break log
sim/BreakLog.ts            bounded per-step log of break positions + material
sim/materials.ts           materials and the (material, material) connection table, in Pa / N·m
sim/mortar.ts              λ → tension/shear/moment; utilisation vs capacity (M/Z; optional crushing)
sim/buildingPlan.ts        pure: masonry tower + straight wall generators; face-joint search
sim/skyscraper.ts          pure: steel frame + slabs + glass with real load paths (see below)
sim/street.ts              pure: staggered street layout, floors policy, part estimate
sim/Vehicle.ts             Jolt wheeled vehicle: DOZER (16 t) and TRACTOR (900 t) specs, governor, auto-right
sim/demolition.ts          pure: displaced parts; displaced mass per structure
```

Tests: `*.test.ts` beside each pure module; `PhysicsWorld.test.ts` and
`Simulation.test.ts` run the real wasm under `// @vitest-environment node`;
`BlastCorpsPage.test.tsx` mocks `./GameHost`. Run `npx vitest run src/minis/blastcorps`
from `apps/ericjorgensen/client`. Production parity: `npm run build && npx vite preview`
(the preview server sends the isolation headers like nginx does).

## Cross-origin isolation (multithreading)

`jolt-physics/wasm-compat-multithread` needs `SharedArrayBuffer`, which needs a
cross-origin-isolated document: COOP `same-origin` + COEP `credentialless` on the
page's HTML response (`credentialless`, not `require-corp`, so gtag and Google Fonts
keep loading). Dev/preview: `vite.config.ts` headers. Prod: nginx
`location = /blast-corps-reimagined`. Client-side navigation can never isolate, so
the home page links here with `reloadDocument`. The flavour is imported dynamically
so Jolt lands in its own chunk — Emscripten spawns pthreads from that chunk's URL, and
a worker named `em-pthread` must not run `physics.worker.ts` (guarded). Jolt's module
uses top-level await → `build.target: "es2022"`, and both flavours are excluded from
`optimizeDeps` (esbuild pre-bundling rejected the TLA and killed the dev server).

Measured in Chrome on this machine: `crossOriginIsolated` true, **16 threads**, a
10-tower street of 10,716 parts / 29,148 joints built in 5.3 s while driving, 60 fps,
8 draw calls, 137k triangles, 1.3 ms physics idle.

## What the probe found (2026-10-06/07, Jolt 1.1.0, 10 velocity / 2 position steps, 60 Hz)

**Scale data path.** Poses live in one city-wide array rewritten only for bodies Jolt
reports awake (`GetActiveBodies`, user data = global part index); the snapshot is one
memcpy; the renderer uploads the pose array as interleaved instance attributes and a
vertex shader rotates a unit box — no CPU matrices. A sleeping street costs nothing.
A dense glued 14×14×14 cube (2,744 bricks, 7,644 joints) kept awake costs
**127 ms/step single-threaded**: awake count is the budget, not part count.

**Steel frame model — what failed and why.** Every joint is a locked six-axis tie, and
an iterative solver answers redundant rigid ties among heavy bodies with large opposing
internal forces that scale with mass and with the load above. In order:

1. Connector capacities for _pinned_ real connections (80 kN·m shear tabs) under locked
   joints: a 10-story frame failed 1,848/2,004 joints under dead load (fixed-end
   moments wL²/12 ≈ 80 kN·m per beam, ≈ 85 per slab edge). → Monolithic capacities
   (beam M_p 800 kN·m, composite deck 300 kN·m, splice 2.9 MN·m).
2. Still 506 failures at 10 stories, all glass and concrete, steel 0. Columns + beams
   alone: 2% peak, zero failures, asleep in 40 steps. Deriving a moment capacity from a
   5 cm glass seam gave ~700 N·m (less than the panel's weight eccentricity). → Explicit
   seam moment (60 kN·m), glass hung with a sill gap, slabs 0.15 m.
3. 237 → 5,275 failures from 10 → 50 stories (266% → 866%): every column segment stood
   on a slab, putting 13 t slabs in the stack's load path. → Continuous columns
   (face-to-face splices), beams 0.7 m wide with explicit moment joints, slabs resting
   on beam ledges by contact only, glass hung from one beam.
4. 10 stories: 45 glass failures, slept when pre-settled. 20–50: slabs **fell through**
   their beams (0.55 t beams rotate out from under 11 t slabs; 7–46 m of −y drift).
   Pins (1 stud joint), studs to all four beams (even at 3× capacity), Baumgarte 0.1 and
   20 iterations all failed from 20 stories up. Beams re-massed to W21×62 (490 kg).
5. Final: pinned slabs, 10–12 stories ✓ (10 st: 14 glass failures on a nudge, peaks
   119% → 73%, slab drift 11 cm); 16 st degrading; bare frames (no slabs) stand to 50
   stories (53 glass failures, peaks ≤ 122%). Hence `floors: "auto"` = slabs only on
   towers ≤ 12 stories (`SLAB_STORY_LIMIT`), taller towers steel-and-glass; "all" lets a
   visitor watch the solver fail; "none" for the leanest frames.

| 3-bay tower | parts | joints | awake ms/step (ST) | build (incl. 60-step pre-settle) |
| ----------- | ----- | ------ | ------------------ | -------------------------------- |
| 10 st pins  | 610   | 690    | 8.2                | 0.5 s                            |
| 12 st pins  | 732   | 828    | 10.5               | 0.65 s                           |
| 30 st frame | 1,560 | 1,800  | 19.2               | 1.2 s                            |
| 50 st frame | 2,600 | 3,000  | 34.5               | 2.3 s                            |

Glass still sheds ~2–5% of units when a tower is nudged awake (solver transient, not
load — the Physicist's verdict: a defect to chase, not a strength to raise). A nudged
tower with slabs does not fall back asleep within 3 s (micro-creep); several nudged
towers add up in step time.

**Masonry (slice 1, unchanged).** 200 kg hollow blocks, 0.6/0.9 MPa mortar, pre-settled
90 steps; nudge-wake peaks 38–71% for 160–1,080 bricks; colossal 6.6 ms/step awake.

**Tractor.** 900 t, six 3 m wheels, 4 MN·m engine through 12:1, clutch strength 11,000,
tyre grip 2.4, `LinearCast`; 0–180 km/h in 5 s measured; Jolt's rpm cap does not bound a
heavy vehicle's speed (276 → 334 km/h observed) so a throttle governor eases off over the
last 10% to 200 km/h (the Physicist: a diesel governor is the only honest limiter; drag
on 135 m² is ~250 kN vs 13 MN tractive). It plowed through a 10-story frame at 180 km/h
without visible speed loss (expected dip to 36–42 m/s during the 0.4 s transit by a
momentum ledger — not yet instrumented, see roadmap).

**Production run (vite preview, 16 threads, default street: 10 towers to 30 stories,
floors ≤ 12, glass).** 9,269 parts / 10,604 joints built in 2.0–2.3 s; a straight
full-throttle run felled 6–8 of 10 towers (5,000–6,500 t) in ~21 s, ending on the
end-of-street card; 4,600–6,400 bodies awake at 8–13 ms/step; 60 fps throughout;
~2,000 particles alive, 12 fires at peak; wasm heap 63 MB. The governor holds 196 km/h.
(The ground slab was 800 m: the machine drove off its edge at 22 s and "accelerated"
in free fall — now 3 km.)

**Build cost.** Creating 3,050 parts takes ~50 ms; pre-settling is the cost
(60 steps × awake ms/step). Towers build one per worker tick, nearest first.

**Memory.** The MT compat build has a fixed 128 MiB heap (no growth). Largest street
(10 towers × up to 50 stories, glass, auto floors) is measured by
`Simulation.test.ts` ("largest street") against a 96 MB ceiling.

## Perf budget

60 Hz physics in the worker. Awake-structure budget ≤ 10 ms/step single-threaded; with
16 threads the probe shows how far that stretches. `MAX_STEPS_PER_TICK = 4` then drop
the backlog: slow motion, never a death spiral. Slow-mo hold (Shift/LB) = time scale
0.25 on the fixed clock — the solver keeps stepping at 60 Hz of simulated time.

## Roadmap (small pieces; each gets the three-lens treatment)

1. **Momentum ledger** across a strike (Physicist): tractor Δp vs Σ debris Δp per step;
   expect ratio 1.0 ± 0.1 and a dip to 36–42 m/s. If far from 1, the 600:1 contacts
   fabricate momentum and demolition % is not trustworthy.
2. **Glass wake transient**: find why a nudge sheds 2–5% of units; candidates — Jolt's
   lost constraint warm start on island wake (measured 2× worse than a full wake),
   per-island wake grace, or a direct solver for small islands.
3. **Felled-tower tripod cam** in the PIP slot for 3 s (Designer), tyre smoke, slow-mo
   audio pitch.
4. **Determinism test** ST vs MT (identical pose hash at step 600), and SharedArrayBuffer
   snapshots when isolated.
5. **Plastic hinge bend** via rotation motors (`mMaxTorqueLimit = M_p`,
   `GetTotalLambdaMotorRotation`) if visible bending is ever wanted.
6. Blast Corps proper: the carrier on a path, time limit, more vehicles, levels.

## Gotchas

- `FixedConstraint` is not bound in jolt-physics 1.1.0 (only its settings); use
  `SixDOFConstraintSettings` + `MakeFixedAxis` ×6 and `castObject(..., SixDOFConstraint)`.
  SixDOF soft limits are translation-only — not a bend model.
- `JoltInterface` has a fixed temp allocator: `mMaxContactConstraints` 32768 aborts
  `Step`; 16384 is proven. Past the cap Jolt drops contacts rather than crashing.
- After `RemoveConstraint` Jolt frees the constraint (refcount 0) — never `destroy` it.
  Shared `BoxShape`s need an `AddRef` by the cache or they die with their last body.
- Read Jolt vectors from `HEAPF32` via `getPointer(v) >> 2`, never per-component
  getters in hot loops; re-fetch `HEAPF32` each step (memory can grow).
- Worker typing: `self as unknown as Worker`; the client tsconfig has only the DOM lib.
- The MT build does not initialise under Node (pthreads); measure MT in the browser.
- The production build emits the MT module twice; the worker imports one, Emscripten's
  pthread spawn references the other. Harmless.
- `optimizeDeps` must exclude both Jolt flavours (top-level await) and `build.target`
  must be es2022.
- Slab/glass joints are the solver's weak spot — re-run the skyscraper measurements in
  `PhysicsWorld.test.ts`-style diags whenever masses, capacities or topology change.
