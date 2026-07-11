// Big Aster Tiny Oids — the pure game model. Every rule lives here (unit
// tested in roidsLogic.test.ts); the component owns only pixels, timers and
// input plumbing. All motion is dt-based (seconds), the field wraps like a
// torus, and rng is injectable for deterministic tests.
//
// Like pipeLogic, step() mutates the state it is given (the render layer keeps
// it in a mutable ref) and returns it for convenience. Sounds are decoupled:
// rules push SoundEvents onto state.events (cleared at the top of each step)
// and the render layer drains them into the Web Audio sfx after stepping.

export type Vec2 = { x: number; y: number };

export type RoidSize = 1 | 2 | 3;

export type WeaponKind =
  | "bullet" // the default pea shooter, infinite ammo
  | "machine" // machine gun: very fast fire, slight spray
  | "super" // super bullets: explode into frag bullets on impact
  | "laser" // hitscan bolt, stops at the first thing it hits
  | "superlaser" // hitscan, penetrates everything to the screen edge
  | "ultralaser" // hitscan, penetrates AND wraps for 10 screen lengths
  | "puffball"; // circular energy blast centered on the ship

export type PowerupKind = Exclude<WeaponKind, "bullet"> | "shield" | "bouncy" | "life";

export type SoundEvent =
  | "shoot"
  | "laser"
  | "boom"
  | "powerup"
  | "puff"
  | "sweep" // nova charge-up alarm
  | "hit"
  | "shipdown"
  | "castledown"
  | "castlespawn"
  | "empty" // weapon powerup exhausted
  | "gameover";

export interface InputState {
  left: boolean;
  right: boolean;
  thrust: boolean;
  fire: boolean;
}

export interface Ship {
  pos: Vec2;
  vel: Vec2;
  angle: number; // radians, 0 = +x
  turnVel: number; // rad/s — turning carries a little inertia
  shield: number; // hits absorbed before losing a life
  bouncy: number; // seconds of bouncy armor remaining
  invuln: number; // seconds of post-hit / respawn grace
  cooldown: number; // seconds until the ship may fire again
  thrusting: boolean; // presentation hint for the flame
}

export interface Roid {
  pos: Vec2;
  vel: Vec2;
  size: RoidSize;
  angle: number;
  spin: number;
  shape: number[]; // radial multipliers giving each rock its own outline
}

export type BulletKind = "std" | "machine" | "super" | "enemy";

export interface Bullet {
  pos: Vec2;
  vel: Vec2;
  life: number; // seconds remaining
  kind: BulletKind;
}

export interface BeamSeg {
  a: Vec2;
  b: Vec2;
}

export type BeamKind = "laser" | "superlaser" | "ultralaser";

export interface Beam {
  segs: BeamSeg[];
  kind: BeamKind;
  ttl: number; // fades out over this many seconds (visual only; damage applied on fire)
}

export interface Blast {
  pos: Vec2;
  maxR: number;
  ttl: number;
  age: number;
  kind: "puff" | "wreck";
}

export interface Powerup {
  pos: Vec2;
  vel: Vec2;
  kind: PowerupKind;
  ttl: number;
}

/** Rising "you got X" text where a powerup was scooped up. */
export interface Floater {
  pos: Vec2;
  kind: PowerupKind;
  age: number;
  ttl: number;
}

/** A short line shard flung out by an explosion (pure vector confetti). */
export interface Debris {
  pos: Vec2;
  vel: Vec2;
  angle: number;
  spin: number;
  len: number;
  age: number;
  ttl: number;
}

/**
 * The castle's big gun: a slow radiant bullet that starts small, swells to
 * maxR as it flies, and dies at the screen edge (it does NOT wrap).
 */
export interface Nova {
  pos: Vec2;
  vel: Vec2;
  r: number;
  maxR: number;
  age: number;
}

export interface CastleRing {
  r: number;
  segs: boolean[]; // alive flags, index 0 starts at ring.angle
  angle: number;
  spin: number; // rad/s
  regen: number; // seconds until one destroyed segment grows back
}

export interface Castle {
  pos: Vec2;
  vel: Vec2;
  rings: CastleRing[]; // outer → inner
  coreAngle: number; // the core ship's facing — it only shoots this way
  coreSpin: number; // rad/s
  gunCooldown: number;
  charge: { t: number; angle: number } | null; // nova charging up
  novaCooldown: number;
}

export interface GameState {
  w: number;
  h: number;
  ship: Ship;
  lives: number;
  score: number;
  wave: number;
  weapon: WeaponKind;
  ammo: number; // Infinity while weapon === "bullet"
  roids: Roid[];
  bullets: Bullet[];
  beams: Beam[];
  blasts: Blast[];
  powerups: Powerup[];
  floaters: Floater[];
  debris: Debris[];
  novas: Nova[];
  castles: Castle[]; // up to `wave` of them at once
  castleTimer: number; // counts down to the next castle while below the cap
  respawn: number; // >0 while the ship is dead and waiting to respawn
  over: boolean;
  events: SoundEvent[]; // cleared at the top of every step
}

// ---------------------------------------------------------------------------
// Tuning constants (exported so tests and the HUD agree with the rules)

export const SHIP_R = 6;
export const TURN_RATE = 4.2; // rad/s, the max turn speed
export const TURN_ACCEL = 35; // rad/s² — spin-up and spin-down of the turn
export const THRUST = 320; // px/s²
export const DRAG = 0.55; // exponential decay per second
export const MAX_SPEED = 480;

export const BULLET_SPEED = 520;
// Player bullets fly all the way to the screen edge and die there (they do
// not wrap); this life is only a backstop against anything getting stuck.
export const BULLET_LIFE = 10;
export const MACHINE_SPRAY = 0.09; // radians of random jitter
export const SUPER_BULLET_R = 9; // super bullets are ~4× the size of a pea
export const FRAG_COUNT = 20; // a super bullet bursts into this many regular bullets
export const PUFF_RADIUS = 95;
export const ULTRA_SCREENS = 10;

export const FIRE_COOLDOWN: Record<WeaponKind, number> = {
  bullet: 0.13,
  machine: 0.0125, // the 100-round magazine rushes out as one held-trigger spray
  super: 0.19,
  laser: 0.16,
  superlaser: 0.25,
  ultralaser: 0.325,
  puffball: 0.4,
};

export const WEAPON_AMMO: Record<Exclude<WeaponKind, "bullet">, number> = {
  machine: 100,
  super: 16,
  laser: 24,
  superlaser: 12,
  ultralaser: 6,
  puffball: 3,
};

export const ROID_R: Record<RoidSize, number> = { 1: 7, 2: 13, 3: 22 };
export const ROID_SCORE: Record<RoidSize, number> = { 3: 20, 2: 50, 1: 100 };

/** Opening rocks per wave: 10 + 5·wave big rocks per million square pixels. */
export function waveRoidCount(w: number, h: number, wave: number): number {
  const count = Math.round(((10 + 5 * wave) * w * h) / 1_000_000);
  return Math.max(1, Math.min(120, count));
}
export const SPAWN_CLEAR = 120; // opening rocks spawn at least this far from the ship

export const START_LIVES = 3;
export const START_SHIELD = 1;
export const MAX_SHIELD = 5;
export const SHIELD_PICKUP = 2;
export const BOUNCY_TIME = 18;
export const RESPAWN_DELAY = 1.6;
export const RESPAWN_INVULN = 2.5;
export const HIT_GRACE = 1.0; // grace after a shield absorbs a hit

export const POWERUP_TTL = 22;
export const POWERUP_R = 8;
export const DROP_CHANCE = 0.12;
export const FLOATER_TTL = 1.2;

// Weighted drop table — extra life is deliberately the rare one.
export const DROP_TABLE: Array<{ kind: PowerupKind; weight: number }> = [
  { kind: "shield", weight: 18 },
  { kind: "machine", weight: 15 },
  { kind: "laser", weight: 14 },
  { kind: "super", weight: 12 },
  { kind: "bouncy", weight: 11 },
  { kind: "puffball", weight: 9 },
  { kind: "superlaser", weight: 9 },
  { kind: "ultralaser", weight: 7 },
  { kind: "life", weight: 5 },
];

export const CASTLE_FIRST = 18; // seconds before the first castle warps in
export const CASTLE_EVERY = 26; // base seconds between castles (shrinks per wave)
export const CORE_R = 6;
export const CASTLE_SEG_SCORE = 25;
export const CASTLE_CORE_SCORE = 1500;
export const RING_BAND = 4; // half-thickness of a shield ring
export const RING_REGEN = 7; // seconds per segment regrown, per ring
export const CASTLE_GUN_SPEED = 190;
export const CASTLE_GUN_LIFE = 2.6;
export const CASTLE_GUN_RATE = 0.3; // pot-shot cadence multiplier (1 = the old rate)

// The nova: the castle's telegraphed big shot through an aligned hole.
export const NOVA_CHARGE = 0.9; // telegraph time before it fires
export const NOVA_COOLDOWN = 4.5;
export const NOVA_START_R = 4; // launches small…
export const NOVA_GROW_TIME = 1.2; // …and swells to full size over this long
export function novaSpeed(wave: number): number {
  return Math.min(90 + 18 * wave, 260);
}
export function novaMaxR(wave: number): number {
  return Math.min(28 + 6 * wave, 80);
}
/** The nova's kill radius: the reach of its outermost radiation line. */
export function novaHitR(r: number): number {
  return r * 1.5 + 6;
}

export const DEBRIS_PER_ROID = 6;
export const DEBRIS_CAP = 300; // oldest shards drop first past this

// Shield layers: two on wave 1, one more each wave, capped.
export const CASTLE_LAYER_BASE_R = 36; // innermost ring radius
export const CASTLE_LAYER_STEP = 16; // radius gap between rings
export const CASTLE_MAX_LAYERS = 6;
export function castleLayers(wave: number): number {
  return Math.min(1 + wave, CASTLE_MAX_LAYERS);
}
/** Seconds between castle spawns at this wave — they come faster each level. */
export function castleInterval(wave: number): number {
  return Math.max(8, CASTLE_EVERY - 2 * (wave - 1));
}

export const BEAM_TTL = 0.22;

// ---------------------------------------------------------------------------
// Small math helpers

const TAU = Math.PI * 2;

export function wrapPos(p: Vec2, w: number, h: number): Vec2 {
  p.x = ((p.x % w) + w) % w;
  p.y = ((p.y % h) + h) % h;
  return p;
}

export function normAngle(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The image of point c (e.g. a castle center) nearest to p on the torus, so
 *  collision math works on the wrapped-around part of a castle too. */
export function nearestImage(c: Vec2, p: Vec2, w: number, h: number): Vec2 {
  let x = c.x;
  let y = c.y;
  if (p.x - x > w / 2) x += w;
  else if (x - p.x > w / 2) x -= w;
  if (p.y - y > h / 2) y += h;
  else if (y - p.y > h / 2) y -= h;
  return { x, y };
}

/** Shortest toroidal distance between two points on the wrapping field. */
export function torusDist(a: Vec2, b: Vec2, w: number, h: number): number {
  let dx = Math.abs(a.x - b.x);
  let dy = Math.abs(a.y - b.y);
  if (dx > w / 2) dx = w - dx;
  if (dy > h / 2) dy = h - dy;
  return Math.hypot(dx, dy);
}

/** Earliest t in [0, maxT] where the ray from p along dir enters the circle. */
function rayCircleT(p: Vec2, dir: Vec2, c: Vec2, r: number, maxT: number): number | null {
  const fx = p.x - c.x;
  const fy = p.y - c.y;
  const b = fx * dir.x + fy * dir.y;
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = -b - sq;
  const t2 = -b + sq;
  if (t1 >= 0 && t1 <= maxT) return t1;
  if (t2 >= 0 && t2 <= maxT) return t2; // started inside the circle
  return null;
}

/** Both crossings of the ray with a circle's rim (for shield rings). */
function rayRimTs(p: Vec2, dir: Vec2, c: Vec2, r: number, maxT: number): number[] {
  const fx = p.x - c.x;
  const fy = p.y - c.y;
  const b = fx * dir.x + fy * dir.y;
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - cc;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [-b - sq, -b + sq].filter((t) => t >= 0 && t <= maxT);
}

/** Distance from the ray start until it leaves the [0,w]x[0,h] rectangle. */
export function rayExit(p: Vec2, dir: Vec2, w: number, h: number): number {
  let t = Infinity;
  if (dir.x > 1e-9) t = Math.min(t, (w - p.x) / dir.x);
  if (dir.x < -1e-9) t = Math.min(t, -p.x / dir.x);
  if (dir.y > 1e-9) t = Math.min(t, (h - p.y) / dir.y);
  if (dir.y < -1e-9) t = Math.min(t, -p.y / dir.y);
  return Number.isFinite(t) ? Math.max(t, 0) : Math.max(w, h);
}

// ---------------------------------------------------------------------------
// Construction

export function makeShip(w: number, h: number): Ship {
  return {
    pos: { x: w / 2, y: h / 2 },
    vel: { x: 0, y: 0 },
    angle: -Math.PI / 2,
    turnVel: 0,
    shield: START_SHIELD,
    bouncy: 0,
    invuln: RESPAWN_INVULN,
    cooldown: 0,
    thrusting: false,
  };
}

export function makeRoid(pos: Vec2, size: RoidSize, wave: number, rng: () => number): Roid {
  const base: Record<RoidSize, number> = { 3: 20, 2: 35, 1: 55 };
  const speed = base[size] + rng() * base[size] + wave * 2;
  const dir = rng() * TAU;
  const shape: number[] = [];
  for (let i = 0; i < 10; i++) shape.push(0.72 + rng() * 0.52);
  return {
    pos: { x: pos.x, y: pos.y },
    vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
    size,
    angle: rng() * TAU,
    spin: (rng() - 0.5) * 2.4,
    shape,
  };
}

export function makeCastle(w: number, h: number, rng: () => number, wave: number): Castle {
  // Warp in on a random edge, drifting across the field.
  const edge = Math.floor(rng() * 4);
  const pos =
    edge === 0
      ? { x: rng() * w, y: 0 }
      : edge === 1
        ? { x: rng() * w, y: h }
        : edge === 2
          ? { x: 0, y: rng() * h }
          : { x: w, y: rng() * h };
  const dir = rng() * TAU;
  const speed = 28 + rng() * 26;
  const layers = castleLayers(wave);
  const rings: CastleRing[] = [];
  for (let k = layers - 1; k >= 0; k--) {
    // k = 0 innermost; array is outer → inner.
    rings.push({
      r: CASTLE_LAYER_BASE_R + CASTLE_LAYER_STEP * k,
      segs: new Array<boolean>(8 + 2 * k).fill(true),
      angle: rng() * TAU,
      spin: (k % 2 === 0 ? 1 : -1) * (0.55 + 0.1 * k),
      regen: RING_REGEN,
    });
  }
  return {
    pos,
    vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
    rings,
    coreAngle: rng() * TAU,
    coreSpin: (rng() < 0.5 ? -1 : 1) * (0.4 + rng() * 0.5),
    gunCooldown: 1 + rng(),
    charge: null,
    novaCooldown: 2,
  };
}

export function initialState(w: number, h: number, rng: () => number = Math.random): GameState {
  const state: GameState = {
    w,
    h,
    ship: makeShip(w, h),
    lives: START_LIVES,
    score: 0,
    wave: 1,
    weapon: "bullet",
    ammo: Infinity,
    roids: [],
    bullets: [],
    beams: [],
    blasts: [],
    powerups: [],
    floaters: [],
    debris: [],
    novas: [],
    castles: [],
    castleTimer: CASTLE_FIRST,
    respawn: 0,
    over: false,
    events: [],
  };
  spawnWave(state, rng);
  return state;
}

/** Populate the field for the current wave, clear of the ship. */
export function spawnWave(state: GameState, rng: () => number): void {
  const count = waveRoidCount(state.w, state.h, state.wave);
  for (let i = 0; i < count; i++) {
    let pos = { x: rng() * state.w, y: rng() * state.h };
    for (let tries = 0; tries < 24; tries++) {
      if (torusDist(pos, state.ship.pos, state.w, state.h) > SPAWN_CLEAR) break;
      pos = { x: rng() * state.w, y: rng() * state.h };
    }
    state.roids.push(makeRoid(pos, 3, state.wave, rng));
  }
}

// ---------------------------------------------------------------------------
// Scoring, splitting, drops

function rollDrop(rng: () => number): PowerupKind {
  const total = DROP_TABLE.reduce((sum, d) => sum + d.weight, 0);
  let roll = rng() * total;
  for (const d of DROP_TABLE) {
    roll -= d.weight;
    if (roll <= 0) return d.kind;
  }
  return DROP_TABLE[0].kind;
}

function maybeDrop(state: GameState, pos: Vec2, rng: () => number): void {
  if (rng() >= DROP_CHANCE) return;
  const kind = rollDrop(rng);
  const dir = rng() * TAU;
  state.powerups.push({
    pos: { x: pos.x, y: pos.y },
    vel: { x: Math.cos(dir) * 30, y: Math.sin(dir) * 30 },
    kind,
    ttl: POWERUP_TTL,
  });
}

/**
 * A rock takes a hit: score it, break a big one into two smaller ones (unless
 * shatter — the puffball/sweep vaporize outright), maybe drop a powerup. The
 * roid must already have been removed from state.roids by the caller.
 */
/** Fling explosion shards out from a point — the little vector boom. */
export function spawnDebris(state: GameState, pos: Vec2, count: number, rng: () => number): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.6;
    const speed = 60 + rng() * 80;
    state.debris.push({
      pos: { x: pos.x, y: pos.y },
      vel: { x: Math.cos(a) * speed, y: Math.sin(a) * speed },
      angle: rng() * TAU,
      spin: (rng() - 0.5) * 12,
      len: 3 + rng() * 4,
      age: 0,
      ttl: 0.5 + rng() * 0.3,
    });
  }
  if (state.debris.length > DEBRIS_CAP) {
    state.debris.splice(0, state.debris.length - DEBRIS_CAP);
  }
}

export function breakRoid(
  state: GameState,
  roid: Roid,
  rng: () => number,
  opts: { shatter?: boolean } = {},
): void {
  state.score += ROID_SCORE[roid.size];
  state.events.push("boom");
  // Drop roll first so its rng draws stay stable regardless of debris/children.
  maybeDrop(state, roid.pos, rng);
  spawnDebris(state, roid.pos, DEBRIS_PER_ROID, rng);
  if (!opts.shatter && roid.size > 1) {
    const childSize = (roid.size - 1) as RoidSize;
    for (let i = 0; i < 2; i++) {
      const child = makeRoid(roid.pos, childSize, state.wave, rng);
      // Children inherit a push from the parent so the break reads as physics.
      child.vel.x += roid.vel.x * 0.4;
      child.vel.y += roid.vel.y * 0.4;
      state.roids.push(child);
    }
  }
}

// ---------------------------------------------------------------------------
// Powerups

export function collectPowerup(state: GameState, kind: PowerupKind): void {
  state.events.push("powerup");
  switch (kind) {
    case "shield":
      state.ship.shield = Math.min(MAX_SHIELD, state.ship.shield + SHIELD_PICKUP);
      break;
    case "bouncy":
      state.ship.bouncy = BOUNCY_TIME;
      break;
    case "life":
      state.lives += 1;
      break;
    default:
      // A weapon pickup: switching arms it fresh; grabbing the same weapon
      // again tops up the magazine.
      if (state.weapon === kind) state.ammo += WEAPON_AMMO[kind];
      else {
        state.weapon = kind;
        state.ammo = WEAPON_AMMO[kind];
      }
      break;
  }
}

function spendAmmo(state: GameState): void {
  if (state.weapon === "bullet") return;
  state.ammo -= 1;
  if (state.ammo <= 0) {
    state.weapon = "bullet";
    state.ammo = Infinity;
    state.events.push("empty");
  }
}

// ---------------------------------------------------------------------------
// Firing

function nose(ship: Ship): Vec2 {
  return {
    x: ship.pos.x + Math.cos(ship.angle) * SHIP_R,
    y: ship.pos.y + Math.sin(ship.angle) * SHIP_R,
  };
}

function fireProjectile(state: GameState, kind: BulletKind, jitter: number, rng: () => number) {
  const a = state.ship.angle + (jitter === 0 ? 0 : (rng() - 0.5) * 2 * jitter);
  const p = nose(state.ship);
  state.bullets.push({
    pos: p,
    vel: {
      x: Math.cos(a) * BULLET_SPEED + state.ship.vel.x * 0.35,
      y: Math.sin(a) * BULLET_SPEED + state.ship.vel.y * 0.35,
    },
    life: BULLET_LIFE,
    kind,
  });
}

/** Ring-rim crossings of a beam segment, as castle shield hits — checked
 *  against every wrap image of the castle, so the wrapped-around part of a
 *  castle straddling a screen edge takes hits too. */
function beamRingHits(
  castle: Castle,
  p: Vec2,
  dir: Vec2,
  maxT: number,
  w: number,
  h: number,
): Array<{ t: number; ring: CastleRing; seg: number }> {
  const hits: Array<{ t: number; ring: CastleRing; seg: number }> = [];
  for (const dx of [-w, 0, w]) {
    for (const dy of [-h, 0, h]) {
      const c = { x: castle.pos.x + dx, y: castle.pos.y + dy };
      for (const ring of castle.rings) {
        for (const t of rayRimTs(p, dir, c, ring.r, maxT)) {
          const hit = { x: p.x + dir.x * t, y: p.y + dir.y * t };
          const seg = ringSegmentAt(ring, Math.atan2(hit.y - c.y, hit.x - c.x));
          if (ring.segs[seg]) hits.push({ t, ring, seg });
        }
      }
    }
  }
  return hits;
}

export interface HitscanTrace {
  segs: BeamSeg[];
  roids: Roid[];
  ringHits: Array<{ ring: CastleRing; seg: number }>;
  cores: Castle[];
}

/**
 * Trace a laser-tier shot WITHOUT applying any damage: the segments the beam
 * would draw and everything it would hit. fireHitscan applies it; the render
 * layer also calls this every frame to draw the aiming sight while a laser
 * weapon is equipped. laser: stops at the first hit. superlaser: pierces out
 * to the screen edge. ultralaser: pierces and wraps for ULTRA_SCREENS screen
 * lengths.
 */
export function traceHitscan(
  state: GameState,
  kind: "laser" | "superlaser" | "ultralaser",
): HitscanTrace {
  const pierce = kind !== "laser";
  const wrap = kind === "ultralaser";
  const dir = { x: Math.cos(state.ship.angle), y: Math.sin(state.ship.angle) };
  let p = nose(state.ship);
  let remaining = wrap ? ULTRA_SCREENS * Math.max(state.w, state.h) : Infinity;

  const segs: BeamSeg[] = [];
  const roidHits = new Set<Roid>();
  const ringHits: Array<{ ring: CastleRing; seg: number }> = [];
  const coreHits = new Set<Castle>();

  let guard = ULTRA_SCREENS * 4; // safety against degenerate zero-length loops
  while (remaining > 0.5 && guard-- > 0) {
    const segLen = Math.min(remaining, rayExit(p, dir, state.w, state.h));
    type Hit = { t: number; apply: () => void };
    const hits: Hit[] = [];
    for (const roid of state.roids) {
      if (roidHits.has(roid)) continue;
      const t = rayCircleT(p, dir, roid.pos, ROID_R[roid.size], segLen);
      if (t != null) hits.push({ t, apply: () => roidHits.add(roid) });
    }
    for (const castle of state.castles) {
      for (const rh of beamRingHits(castle, p, dir, segLen, state.w, state.h)) {
        if (ringHits.some((h) => h.ring === rh.ring && h.seg === rh.seg)) continue;
        hits.push({ t: rh.t, apply: () => ringHits.push({ ring: rh.ring, seg: rh.seg }) });
      }
      if (!coreHits.has(castle)) {
        for (const dx of [-state.w, 0, state.w]) {
          for (const dy of [-state.h, 0, state.h]) {
            const c = { x: castle.pos.x + dx, y: castle.pos.y + dy };
            const t = rayCircleT(p, dir, c, CORE_R, segLen);
            if (t != null) hits.push({ t, apply: () => coreHits.add(castle) });
          }
        }
      }
    }
    hits.sort((a, b) => a.t - b.t);

    if (!pierce) {
      if (hits.length > 0) {
        hits[0].apply();
        const t = hits[0].t;
        segs.push({ a: p, b: { x: p.x + dir.x * t, y: p.y + dir.y * t } });
      } else {
        segs.push({ a: p, b: { x: p.x + dir.x * segLen, y: p.y + dir.y * segLen } });
      }
      break;
    }

    for (const h of hits) h.apply();
    segs.push({ a: p, b: { x: p.x + dir.x * segLen, y: p.y + dir.y * segLen } });
    remaining -= segLen;
    if (!wrap) break;
    p = wrapPos(
      { x: p.x + dir.x * (segLen + 0.01), y: p.y + dir.y * (segLen + 0.01) },
      state.w,
      state.h,
    );
  }

  return { segs, roids: [...roidHits], ringHits, cores: [...coreHits] };
}

/** Fire a laser tier: trace it, then apply all the damage at once. */
export function fireHitscan(
  state: GameState,
  kind: "laser" | "superlaser" | "ultralaser",
  rng: () => number,
): void {
  const trace = traceHitscan(state, kind);
  for (const roid of trace.roids) {
    const idx = state.roids.indexOf(roid);
    if (idx >= 0) {
      state.roids.splice(idx, 1);
      breakRoid(state, roid, rng);
    }
  }
  for (const { ring, seg } of trace.ringHits) {
    ring.segs[seg] = false;
    state.score += CASTLE_SEG_SCORE;
  }
  for (const castle of trace.cores) destroyCastle(state, castle, rng);

  state.beams.push({ segs: trace.segs, kind, ttl: BEAM_TTL });
}

/** The puffball: a circular energy blast that vaporizes everything nearby. */
export function firePuffball(state: GameState, rng: () => number): void {
  const at = state.ship.pos;
  const survivors: Roid[] = [];
  for (const roid of state.roids) {
    if (torusDist(roid.pos, at, state.w, state.h) <= PUFF_RADIUS + ROID_R[roid.size]) {
      breakRoid(state, roid, rng, { shatter: true });
    } else survivors.push(roid);
  }
  state.roids = survivors;
  state.bullets = state.bullets.filter(
    (b) => b.kind !== "enemy" || torusDist(b.pos, at, state.w, state.h) > PUFF_RADIUS,
  );
  for (const castle of state.castles) {
    for (const ring of castle.rings) {
      for (let i = 0; i < ring.segs.length; i++) {
        if (!ring.segs[i]) continue;
        const mid = ring.angle + ((i + 0.5) * TAU) / ring.segs.length;
        const segPos = {
          x: castle.pos.x + Math.cos(mid) * ring.r,
          y: castle.pos.y + Math.sin(mid) * ring.r,
        };
        if (torusDist(segPos, at, state.w, state.h) <= PUFF_RADIUS) {
          ring.segs[i] = false;
          state.score += CASTLE_SEG_SCORE;
        }
      }
    }
  }
  state.blasts.push({
    pos: { x: at.x, y: at.y },
    maxR: PUFF_RADIUS,
    ttl: 0.5,
    age: 0,
    kind: "puff",
  });
  state.events.push("puff");
}

export function fireWeapon(state: GameState, rng: () => number): void {
  const weapon = state.weapon;
  state.ship.cooldown = FIRE_COOLDOWN[weapon];
  switch (weapon) {
    case "bullet":
      fireProjectile(state, "std", 0, rng);
      state.events.push("shoot");
      break;
    case "machine":
      fireProjectile(state, "machine", MACHINE_SPRAY, rng);
      state.events.push("shoot");
      break;
    case "super":
      fireProjectile(state, "super", 0, rng);
      state.events.push("shoot");
      break;
    case "laser":
    case "superlaser":
    case "ultralaser":
      fireHitscan(state, weapon, rng);
      state.events.push("laser");
      break;
    case "puffball":
      firePuffball(state, rng);
      break;
  }
  spendAmmo(state);
}

// ---------------------------------------------------------------------------
// The StarCastle

/** Index of the shield segment covering world angle theta on this ring. */
export function ringSegmentAt(ring: CastleRing, theta: number): number {
  const rel = normAngle(theta - ring.angle);
  return Math.min(ring.segs.length - 1, Math.floor((rel / TAU) * ring.segs.length));
}

/** True when a straight radial line at theta passes a destroyed segment of every ring. */
export function castleHoleAt(castle: Castle, theta: number): boolean {
  return castle.rings.every((ring) => !ring.segs[ringSegmentAt(ring, theta)]);
}

export function destroyCastle(state: GameState, castle: Castle, rng: () => number): void {
  const idx = state.castles.indexOf(castle);
  if (idx < 0) return;
  state.castles.splice(idx, 1);
  state.score += CASTLE_CORE_SCORE;
  state.events.push("castledown");
  state.blasts.push({
    pos: { x: castle.pos.x, y: castle.pos.y },
    maxR: 60,
    ttl: 0.7,
    age: 0,
    kind: "wreck",
  });
  // A slain castle always coughs up two gifts.
  for (let i = 0; i < 2; i++) {
    const dir = rng() * TAU;
    state.powerups.push({
      pos: { x: castle.pos.x, y: castle.pos.y },
      vel: { x: Math.cos(dir) * 60, y: Math.sin(dir) * 60 },
      kind: rollDrop(rng),
      ttl: POWERUP_TTL,
    });
  }
}

function stepCastles(state: GameState, dt: number, rng: () => number): void {
  // Spawn cadence: the timer only runs while there's a free slot; the cap on
  // simultaneous castles is the wave number.
  if (state.castles.length < state.wave) {
    state.castleTimer -= dt;
    if (state.castleTimer <= 0) {
      state.castles.push(makeCastle(state.w, state.h, rng, state.wave));
      state.castleTimer = castleInterval(state.wave);
      state.events.push("castlespawn");
    }
  }

  const shipTargetable = state.respawn <= 0 && !state.over;
  for (const castle of state.castles) {
    castle.pos.x += castle.vel.x * dt;
    castle.pos.y += castle.vel.y * dt;
    wrapPos(castle.pos, state.w, state.h);

    for (const ring of castle.rings) {
      ring.angle = normAngle(ring.angle + ring.spin * dt);
      ring.regen -= dt;
      if (ring.regen <= 0) {
        ring.regen = RING_REGEN;
        const dead: number[] = [];
        for (let i = 0; i < ring.segs.length; i++) if (!ring.segs[i]) dead.push(i);
        if (dead.length > 0) ring.segs[dead[Math.floor(rng() * dead.length)]] = true;
      }
    }

    // The core ship slowly turns, and only fires the way it is pointing.
    castle.coreAngle = normAngle(castle.coreAngle + castle.coreSpin * dt);
    castle.gunCooldown -= dt;
    if (castle.gunCooldown <= 0) {
      castle.gunCooldown = (0.5 + rng() * 1.2) / CASTLE_GUN_RATE;
      state.bullets.push({
        pos: { x: castle.pos.x, y: castle.pos.y },
        vel: {
          x: Math.cos(castle.coreAngle) * CASTLE_GUN_SPEED,
          y: Math.sin(castle.coreAngle) * CASTLE_GUN_SPEED,
        },
        life: CASTLE_GUN_LIFE,
        kind: "enemy",
      });
    }

    // The signature attack: when the rotating shields open a radial hole
    // toward the ship, charge up and loose a nova — a slow radiant bullet
    // that swells as it flies and dies at the screen edge.
    castle.novaCooldown = Math.max(0, castle.novaCooldown - dt);
    if (!castle.charge && castle.novaCooldown <= 0 && shipTargetable) {
      const theta = Math.atan2(state.ship.pos.y - castle.pos.y, state.ship.pos.x - castle.pos.x);
      if (castleHoleAt(castle, theta)) {
        castle.charge = { t: 0, angle: theta };
        state.events.push("sweep");
      }
    }

    const charge = castle.charge;
    if (charge) {
      charge.t += dt;
      if (charge.t >= NOVA_CHARGE) {
        const speed = novaSpeed(state.wave);
        state.novas.push({
          pos: { x: castle.pos.x, y: castle.pos.y },
          vel: { x: Math.cos(charge.angle) * speed, y: Math.sin(charge.angle) * speed },
          r: NOVA_START_R,
          maxR: novaMaxR(state.wave),
          age: 0,
        });
        castle.charge = null;
        castle.novaCooldown = NOVA_COOLDOWN;
      }
    }
  }
}

/** Advance the novas: swell, fly straight (no wrap), carve, die off-screen. */
function stepNovas(state: GameState, dt: number, rng: () => number): void {
  if (state.novas.length === 0) return;
  const shipTargetable = state.respawn <= 0 && !state.over;
  const kept: Nova[] = [];
  for (const nova of state.novas) {
    nova.age += dt;
    nova.r = Math.min(
      nova.maxR,
      NOVA_START_R + (nova.maxR - NOVA_START_R) * (nova.age / NOVA_GROW_TIME),
    );
    nova.pos.x += nova.vel.x * dt;
    nova.pos.y += nova.vel.y * dt;

    // It carves through rocks (vaporized, not split)…
    const survivors: Roid[] = [];
    for (const roid of state.roids) {
      if (dist(nova.pos, roid.pos) <= nova.r + ROID_R[roid.size]) {
        breakRoid(state, roid, rng, { shatter: true });
      } else survivors.push(roid);
    }
    state.roids = survivors;
    // …and through the ship — deadly out to the tip of its radiation lines.
    if (shipTargetable && dist(nova.pos, state.ship.pos) <= novaHitR(nova.r) + SHIP_R) {
      hitShip(state, rng);
    }

    // No wrap: gone once fully past any screen edge.
    const m = nova.maxR;
    if (nova.pos.x < -m || nova.pos.x > state.w + m || nova.pos.y < -m || nova.pos.y > state.h + m)
      continue;
    kept.push(nova);
  }
  state.novas = kept;
}

// ---------------------------------------------------------------------------
// Ship damage

/** One hit lands on the ship: shields absorb it, otherwise a life is lost. */
export function hitShip(state: GameState, rng: () => number = Math.random): void {
  const ship = state.ship;
  if (ship.invuln > 0 || state.respawn > 0 || state.over) return;
  if (ship.shield > 0) {
    ship.shield -= 1;
    ship.invuln = HIT_GRACE;
    state.events.push("hit");
    return;
  }
  state.lives -= 1;
  state.events.push("shipdown");
  state.blasts.push({
    pos: { x: ship.pos.x, y: ship.pos.y },
    maxR: 30,
    ttl: 0.6,
    age: 0,
    kind: "wreck",
  });
  spawnDebris(state, ship.pos, 8, rng);
  if (state.lives <= 0) {
    state.over = true;
    state.events.push("gameover");
    return;
  }
  state.respawn = RESPAWN_DELAY;
}

function respawnShip(state: GameState): void {
  state.ship = makeShip(state.w, state.h);
}

// ---------------------------------------------------------------------------
// The main step

export function step(
  state: GameState,
  input: InputState,
  dt: number,
  rng: () => number = Math.random,
): GameState {
  state.events.length = 0;
  if (state.over) return state;
  const ship = state.ship;

  // -- timers -------------------------------------------------------------
  ship.invuln = Math.max(0, ship.invuln - dt);
  ship.bouncy = Math.max(0, ship.bouncy - dt);
  ship.cooldown = Math.max(0, ship.cooldown - dt);
  for (const beam of state.beams) beam.ttl -= dt;
  state.beams = state.beams.filter((b) => b.ttl > 0);
  for (const blast of state.blasts) blast.age += dt;
  state.blasts = state.blasts.filter((b) => b.age < b.ttl);
  for (const floater of state.floaters) floater.age += dt;
  state.floaters = state.floaters.filter((f) => f.age < f.ttl);
  for (const shard of state.debris) {
    shard.age += dt;
    shard.pos.x += shard.vel.x * dt;
    shard.pos.y += shard.vel.y * dt;
    shard.angle += shard.spin * dt;
    wrapPos(shard.pos, state.w, state.h);
  }
  state.debris = state.debris.filter((s) => s.age < s.ttl);
  for (const pu of state.powerups) {
    pu.ttl -= dt;
    pu.pos.x += pu.vel.x * dt;
    pu.pos.y += pu.vel.y * dt;
    wrapPos(pu.pos, state.w, state.h);
  }
  state.powerups = state.powerups.filter((p) => p.ttl > 0);

  if (state.respawn > 0) {
    state.respawn -= dt;
    if (state.respawn <= 0) {
      state.respawn = 0;
      respawnShip(state);
    }
  }
  const shipAlive = state.respawn <= 0;

  // -- ship control -------------------------------------------------------
  if (shipAlive) {
    // Turning carries a little inertia: ramp quickly toward the target rate,
    // then wind back down when the stick is released.
    const turnTarget = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (turnTarget !== 0) {
      ship.turnVel += turnTarget * TURN_ACCEL * dt;
      ship.turnVel = Math.max(-TURN_RATE, Math.min(TURN_RATE, ship.turnVel));
    } else {
      const brake = TURN_ACCEL * dt;
      if (Math.abs(ship.turnVel) <= brake) ship.turnVel = 0;
      else ship.turnVel -= Math.sign(ship.turnVel) * brake;
    }
    ship.angle += ship.turnVel * dt;
    ship.thrusting = input.thrust;
    if (input.thrust) {
      ship.vel.x += Math.cos(ship.angle) * THRUST * dt;
      ship.vel.y += Math.sin(ship.angle) * THRUST * dt;
    }
    const decay = Math.exp(-DRAG * dt);
    ship.vel.x *= decay;
    ship.vel.y *= decay;
    const speed = Math.hypot(ship.vel.x, ship.vel.y);
    if (speed > MAX_SPEED) {
      ship.vel.x *= MAX_SPEED / speed;
      ship.vel.y *= MAX_SPEED / speed;
    }
    ship.pos.x += ship.vel.x * dt;
    ship.pos.y += ship.vel.y * dt;
    wrapPos(ship.pos, state.w, state.h);

    if (input.fire && ship.cooldown <= 0) fireWeapon(state, rng);
  }

  // -- projectiles ----------------------------------------------------------
  // Enemy bullets wrap like everything else; player bullets fly straight and
  // die exactly at the screen edge.
  for (const bullet of state.bullets) {
    bullet.life -= dt;
    bullet.pos.x += bullet.vel.x * dt;
    bullet.pos.y += bullet.vel.y * dt;
    if (bullet.kind === "enemy") wrapPos(bullet.pos, state.w, state.h);
  }
  state.bullets = state.bullets.filter(
    (b) =>
      b.life > 0 &&
      (b.kind === "enemy" ||
        (b.pos.x >= -4 && b.pos.x <= state.w + 4 && b.pos.y >= -4 && b.pos.y <= state.h + 4)),
  );

  // -- asteroids ------------------------------------------------------------
  for (const roid of state.roids) {
    roid.pos.x += roid.vel.x * dt;
    roid.pos.y += roid.vel.y * dt;
    roid.angle += roid.spin * dt;
    wrapPos(roid.pos, state.w, state.h);
  }

  // -- the castles and their novas ---------------------------------------------
  stepCastles(state, dt, rng);
  stepNovas(state, dt, rng);

  // -- collisions -----------------------------------------------------------
  resolveCollisions(state, dt, rng);

  // -- wave progression -------------------------------------------------------
  if (state.roids.length === 0 && !state.over) {
    state.wave += 1;
    spawnWave(state, rng);
  }

  return state;
}

function resolveCollisions(state: GameState, dt: number, rng: () => number): void {
  const ship = state.ship;
  const shipAlive = state.respawn <= 0 && !state.over;

  // Player bullets vs rocks.
  const deadBullets = new Set<Bullet>();
  const deadRoids = new Set<Roid>();
  const spawned: Bullet[] = []; // frags queued so we never mutate mid-iteration
  for (const bullet of state.bullets) {
    if (bullet.kind === "enemy") continue;
    const bulletR = bullet.kind === "super" ? SUPER_BULLET_R : 2;
    for (const roid of state.roids) {
      if (deadRoids.has(roid)) continue;
      if (torusDist(bullet.pos, roid.pos, state.w, state.h) <= ROID_R[roid.size] + bulletR) {
        deadBullets.add(bullet);
        deadRoids.add(roid);
        if (bullet.kind === "super") {
          // Super bullets burst into a radial spray of regular bullets.
          for (let i = 0; i < FRAG_COUNT; i++) {
            const a = (i / FRAG_COUNT) * TAU + rng() * 0.3;
            spawned.push({
              pos: { x: bullet.pos.x, y: bullet.pos.y },
              vel: { x: Math.cos(a) * BULLET_SPEED, y: Math.sin(a) * BULLET_SPEED },
              life: BULLET_LIFE,
              kind: "std",
            });
          }
        }
        break;
      }
    }
  }
  state.bullets.push(...spawned);
  for (const roid of deadRoids) {
    const idx = state.roids.indexOf(roid);
    if (idx >= 0) {
      state.roids.splice(idx, 1);
      breakRoid(state, roid, rng);
    }
  }

  // Player bullets vs the castles (swept so fast bullets can't tunnel a ring;
  // collision runs against the castle image nearest the bullet, so the
  // wrapped-around part of an edge-straddling castle registers hits too).
  for (const castle of [...state.castles]) {
    for (const bullet of state.bullets) {
      if (bullet.kind === "enemy" || deadBullets.has(bullet)) continue;
      const speed = Math.hypot(bullet.vel.x, bullet.vel.y);
      if (speed === 0) continue;
      const dir = { x: bullet.vel.x / speed, y: bullet.vel.y / speed };
      const back = { x: bullet.pos.x - bullet.vel.x * dt, y: bullet.pos.y - bullet.vel.y * dt };
      const travel = speed * dt;
      const center = nearestImage(castle.pos, back, state.w, state.h);
      let hitT = Infinity;
      let hitRing: CastleRing | null = null;
      let hitSeg = -1;
      for (const ring of castle.rings) {
        for (const t of rayRimTs(back, dir, center, ring.r, travel)) {
          const at = { x: back.x + dir.x * t, y: back.y + dir.y * t };
          const seg = ringSegmentAt(ring, Math.atan2(at.y - center.y, at.x - center.x));
          if (ring.segs[seg] && t < hitT) {
            hitT = t;
            hitRing = ring;
            hitSeg = seg;
          }
        }
      }
      const coreT = rayCircleT(back, dir, center, CORE_R + 2, travel);
      if (coreT != null && coreT < hitT) {
        deadBullets.add(bullet);
        destroyCastle(state, castle, rng);
        break; // this castle is gone; move on to the next
      }
      if (hitRing) {
        deadBullets.add(bullet);
        hitRing.segs[hitSeg] = false;
        state.score += CASTLE_SEG_SCORE;
      }
    }
  }

  // Enemy bullets vs the ship.
  if (shipAlive) {
    for (const bullet of state.bullets) {
      if (bullet.kind !== "enemy") continue;
      if (torusDist(bullet.pos, ship.pos, state.w, state.h) <= SHIP_R + 3) {
        deadBullets.add(bullet);
        hitShip(state, rng);
      }
    }
  }
  if (deadBullets.size > 0) state.bullets = state.bullets.filter((b) => !deadBullets.has(b));

  // Rocks vs the ship.
  if (shipAlive && ship.invuln <= 0) {
    for (const roid of state.roids) {
      const r = ROID_R[roid.size] + SHIP_R;
      if (torusDist(roid.pos, ship.pos, state.w, state.h) > r) continue;
      if (ship.bouncy > 0) {
        bounceOffRoid(state, roid);
        continue;
      }
      if (ship.shield > 0) {
        // The shield takes the hit and shatters the offending rock.
        const idx = state.roids.indexOf(roid);
        if (idx >= 0) state.roids.splice(idx, 1);
        breakRoid(state, roid, rng);
        hitShip(state, rng);
      } else {
        hitShip(state, rng);
      }
      break;
    }
  }

  // The castles' shield rings are solid walls to the ship (wrap-aware, so the
  // wrapped-around part of an edge-straddling castle is solid too).
  if (state.respawn <= 0 && !state.over && ship.invuln <= 0) {
    outer: for (const castle of state.castles) {
      const center = nearestImage(castle.pos, ship.pos, state.w, state.h);
      const d = dist(ship.pos, center);
      for (const ring of castle.rings) {
        if (Math.abs(d - ring.r) > RING_BAND + SHIP_R) continue;
        const theta = Math.atan2(ship.pos.y - center.y, ship.pos.x - center.x);
        const seg = ringSegmentAt(ring, theta);
        if (!ring.segs[seg]) continue;
        if (ship.bouncy > 0) {
          // Bounce radially off the ring.
          const nx = (ship.pos.x - center.x) / (d || 1);
          const ny = (ship.pos.y - center.y) / (d || 1);
          const dot = ship.vel.x * nx + ship.vel.y * ny;
          ship.vel.x -= 2 * dot * nx;
          ship.vel.y -= 2 * dot * ny;
          const push =
            d < ring.r ? ring.r - RING_BAND - SHIP_R - 1 : ring.r + RING_BAND + SHIP_R + 1;
          ship.pos.x = center.x + nx * push;
          ship.pos.y = center.y + ny * push;
          wrapPos(ship.pos, state.w, state.h);
        } else if (ship.shield > 0) {
          ring.segs[seg] = false;
          state.score += CASTLE_SEG_SCORE;
          hitShip(state, rng);
        } else {
          hitShip(state, rng);
        }
        break outer;
      }
    }
  }

  // Powerup pickups.
  if (shipAlive && !state.over) {
    const kept: Powerup[] = [];
    for (const pu of state.powerups) {
      if (torusDist(pu.pos, ship.pos, state.w, state.h) <= SHIP_R + POWERUP_R) {
        collectPowerup(state, pu.kind);
        state.floaters.push({
          pos: { x: pu.pos.x, y: pu.pos.y },
          kind: pu.kind,
          age: 0,
          ttl: FLOATER_TTL,
        });
      } else kept.push(pu);
    }
    state.powerups = kept;
  }
}

/** Bouncy armor: elastic-ish deflection instead of damage. */
function bounceOffRoid(state: GameState, roid: Roid): void {
  const ship = state.ship;
  const dx = ship.pos.x - roid.pos.x;
  const dy = ship.pos.y - roid.pos.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = dx / d;
  const ny = dy / d;
  const dot = ship.vel.x * nx + ship.vel.y * ny;
  if (dot < 0) {
    ship.vel.x -= 2 * dot * nx * 0.9;
    ship.vel.y -= 2 * dot * ny * 0.9;
  }
  // Shove the ship just outside the rock so it can't re-collide next frame,
  // and give the rock a nudge so the bounce reads both ways.
  const clear = ROID_R[roid.size] + SHIP_R + 1;
  ship.pos.x = roid.pos.x + nx * clear;
  ship.pos.y = roid.pos.y + ny * clear;
  wrapPos(ship.pos, state.w, state.h);
  roid.vel.x -= nx * 30;
  roid.vel.y -= ny * 30;
}
