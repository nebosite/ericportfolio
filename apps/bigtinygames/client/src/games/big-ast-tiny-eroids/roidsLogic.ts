// Big Ast Tiny eRoids — the pure game model. Every rule lives here (unit
// tested in roidsLogic.test.ts); the component owns only pixels, timers and
// input plumbing. All motion is dt-based (seconds), the field wraps like a
// torus, and rng is injectable for deterministic tests.
//
// Like pipeLogic, step() mutates the state it is given (the render layer keeps
// it in a mutable ref) and returns it for convenience.

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

export type BulletKind = "std" | "machine" | "super" | "frag" | "enemy";

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

export type BeamKind = "laser" | "superlaser" | "ultralaser" | "sweep";

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

export interface CastleRing {
  r: number;
  segs: boolean[]; // alive flags, index 0 starts at ring.angle
  angle: number;
  spin: number; // rad/s
  regen: number; // seconds until one destroyed segment grows back
}

export type SweepState =
  | { phase: "charge"; t: number; angle: number }
  | { phase: "fire"; t: number; from: number; to: number };

export interface Castle {
  pos: Vec2;
  vel: Vec2;
  rings: CastleRing[]; // outer → inner
  gunCooldown: number;
  sweep: SweepState | null;
  sweepCooldown: number;
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
  castle: Castle | null;
  castleTimer: number; // counts down to the next castle while none is out
  respawn: number; // >0 while the ship is dead and waiting to respawn
  over: boolean;
}

// ---------------------------------------------------------------------------
// Tuning constants (exported so tests and the HUD agree with the rules)

export const SHIP_R = 12;
export const TURN_RATE = 4.2; // rad/s
export const THRUST = 320; // px/s²
export const DRAG = 0.55; // exponential decay per second
export const MAX_SPEED = 480;

export const BULLET_SPEED = 520;
export const BULLET_LIFE = 1.0;
export const MACHINE_SPRAY = 0.09; // radians of random jitter
export const FRAG_COUNT = 10;
export const FRAG_SPEED = 340;
export const FRAG_LIFE = 0.5;
export const PUFF_RADIUS = 190;
export const ULTRA_SCREENS = 10;

export const FIRE_COOLDOWN: Record<WeaponKind, number> = {
  bullet: 0.26,
  machine: 0.07,
  super: 0.38,
  laser: 0.32,
  superlaser: 0.5,
  ultralaser: 0.65,
  puffball: 0.8,
};

export const WEAPON_AMMO: Record<Exclude<WeaponKind, "bullet">, number> = {
  machine: 120,
  super: 16,
  laser: 24,
  superlaser: 12,
  ultralaser: 6,
  puffball: 3,
};

export const ROID_R: Record<RoidSize, number> = { 1: 13, 2: 25, 3: 44 };
export const ROID_SCORE: Record<RoidSize, number> = { 3: 20, 2: 50, 1: 100 };

export const START_LIVES = 3;
export const START_SHIELD = 1;
export const MAX_SHIELD = 5;
export const SHIELD_PICKUP = 2;
export const BOUNCY_TIME = 9;
export const RESPAWN_DELAY = 1.6;
export const RESPAWN_INVULN = 2.5;
export const HIT_GRACE = 1.0; // grace after a shield absorbs a hit

export const POWERUP_TTL = 11;
export const POWERUP_R = 11;
export const DROP_CHANCE = 0.12;

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
export const CASTLE_EVERY = 26; // and between castles after that
export const CORE_R = 12;
export const CASTLE_SEG_SCORE = 25;
export const CASTLE_CORE_SCORE = 1500;
export const RING_BAND = 7; // half-thickness of a shield ring
export const RING_REGEN = 7; // seconds per segment regrown, per ring
export const CASTLE_GUN_SPEED = 190;
export const CASTLE_GUN_LIFE = 2.6;
export const SWEEP_CHARGE = 0.9;
export const SWEEP_SPAN = (100 * Math.PI) / 180;
export const SWEEP_DURATION = 1.3;
export const SWEEP_WIDTH = 13; // half-width of the destructive zone
export const SWEEP_COOLDOWN = 4.5;
export const CASTLE_RINGS: Array<{ r: number; n: number; spin: number }> = [
  { r: 66, n: 12, spin: 0.6 },
  { r: 50, n: 10, spin: -0.85 },
  { r: 36, n: 8, spin: 1.15 },
];

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

/** Distance from point c to the segment a→b. */
function segPointDist(a: Vec2, b: Vec2, c: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2));
  return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y);
}

// ---------------------------------------------------------------------------
// Construction

export function makeShip(w: number, h: number): Ship {
  return {
    pos: { x: w / 2, y: h / 2 },
    vel: { x: 0, y: 0 },
    angle: -Math.PI / 2,
    shield: START_SHIELD,
    bouncy: 0,
    invuln: RESPAWN_INVULN,
    cooldown: 0,
    thrusting: false,
  };
}

export function makeRoid(pos: Vec2, size: RoidSize, wave: number, rng: () => number): Roid {
  const base: Record<RoidSize, number> = { 3: 40, 2: 70, 1: 110 };
  const speed = base[size] + rng() * base[size] + wave * 4;
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

export function makeCastle(w: number, h: number, rng: () => number): Castle {
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
  return {
    pos,
    vel: { x: Math.cos(dir) * speed, y: Math.sin(dir) * speed },
    rings: CASTLE_RINGS.map((spec) => ({
      r: spec.r,
      segs: new Array<boolean>(spec.n).fill(true),
      angle: rng() * TAU,
      spin: spec.spin,
      regen: RING_REGEN,
    })),
    gunCooldown: 1 + rng(),
    sweep: null,
    sweepCooldown: 2,
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
    castle: null,
    castleTimer: CASTLE_FIRST,
    respawn: 0,
    over: false,
  };
  spawnWave(state, rng);
  return state;
}

/** Populate the field for the current wave: 2+wave big rocks, clear of the ship. */
export function spawnWave(state: GameState, rng: () => number): void {
  const count = Math.min(2 + state.wave, 12);
  for (let i = 0; i < count; i++) {
    let pos = { x: rng() * state.w, y: rng() * state.h };
    for (let tries = 0; tries < 24; tries++) {
      if (torusDist(pos, state.ship.pos, state.w, state.h) > 170) break;
      pos = { x: rng() * state.w, y: rng() * state.h };
    }
    state.roids.push(makeRoid(pos, 3, state.wave, rng));
  }
}

// ---------------------------------------------------------------------------
// Scoring, splitting, drops

function maybeDrop(state: GameState, pos: Vec2, rng: () => number): void {
  if (rng() >= DROP_CHANCE) return;
  const total = DROP_TABLE.reduce((sum, d) => sum + d.weight, 0);
  let roll = rng() * total;
  let kind: PowerupKind = DROP_TABLE[0].kind;
  for (const d of DROP_TABLE) {
    roll -= d.weight;
    if (roll <= 0) {
      kind = d.kind;
      break;
    }
  }
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
 * shatter — the puffball vaporizes outright), maybe drop a powerup. The roid
 * must already have been removed from state.roids by the caller.
 */
export function breakRoid(
  state: GameState,
  roid: Roid,
  rng: () => number,
  opts: { shatter?: boolean } = {},
): void {
  state.score += ROID_SCORE[roid.size];
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
  maybeDrop(state, roid.pos, rng);
}

// ---------------------------------------------------------------------------
// Powerups

export function collectPowerup(state: GameState, kind: PowerupKind): void {
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

/** Ring-rim crossings of a beam segment, as castle shield hits. */
function beamRingHits(
  castle: Castle,
  p: Vec2,
  dir: Vec2,
  maxT: number,
): Array<{ t: number; ring: CastleRing; seg: number }> {
  const hits: Array<{ t: number; ring: CastleRing; seg: number }> = [];
  for (const ring of castle.rings) {
    for (const t of rayRimTs(p, dir, castle.pos, ring.r, maxT)) {
      const hit = { x: p.x + dir.x * t, y: p.y + dir.y * t };
      const seg = ringSegmentAt(ring, Math.atan2(hit.y - castle.pos.y, hit.x - castle.pos.x));
      if (ring.segs[seg]) hits.push({ t, ring, seg });
    }
  }
  return hits;
}

/**
 * Hitscan for the three laser tiers. Applies all damage immediately and pushes
 * a Beam for the render layer. laser: stops at the first hit. superlaser:
 * pierces everything out to the screen edge. ultralaser: pierces and wraps for
 * ULTRA_SCREENS screen lengths.
 */
export function fireHitscan(
  state: GameState,
  kind: "laser" | "superlaser" | "ultralaser",
  rng: () => number,
): void {
  const pierce = kind !== "laser";
  const wrap = kind === "ultralaser";
  const dir = { x: Math.cos(state.ship.angle), y: Math.sin(state.ship.angle) };
  let p = nose(state.ship);
  let remaining = wrap ? ULTRA_SCREENS * Math.max(state.w, state.h) : Infinity;

  const segs: BeamSeg[] = [];
  const roidHits = new Set<Roid>();
  const ringHits: Array<{ ring: CastleRing; seg: number }> = [];
  let coreHit = false;

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
    const castle = state.castle;
    if (castle) {
      for (const rh of beamRingHits(castle, p, dir, segLen)) {
        if (ringHits.some((h) => h.ring === rh.ring && h.seg === rh.seg)) continue;
        hits.push({ t: rh.t, apply: () => ringHits.push({ ring: rh.ring, seg: rh.seg }) });
      }
      if (!coreHit) {
        const t = rayCircleT(p, dir, castle.pos, CORE_R, segLen);
        if (t != null)
          hits.push({
            t,
            apply: () => {
              coreHit = true;
            },
          });
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

  for (const roid of roidHits) {
    const idx = state.roids.indexOf(roid);
    if (idx >= 0) {
      state.roids.splice(idx, 1);
      breakRoid(state, roid, rng);
    }
  }
  for (const { ring, seg } of ringHits) {
    ring.segs[seg] = false;
    state.score += CASTLE_SEG_SCORE;
  }
  if (coreHit && state.castle) destroyCastle(state, rng);

  state.beams.push({ segs, kind, ttl: BEAM_TTL });
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
  const castle = state.castle;
  if (castle) {
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
}

export function fireWeapon(state: GameState, rng: () => number): void {
  const weapon = state.weapon;
  state.ship.cooldown = FIRE_COOLDOWN[weapon];
  switch (weapon) {
    case "bullet":
      fireProjectile(state, "std", 0, rng);
      break;
    case "machine":
      fireProjectile(state, "machine", MACHINE_SPRAY, rng);
      break;
    case "super":
      fireProjectile(state, "super", 0, rng);
      break;
    case "laser":
    case "superlaser":
    case "ultralaser":
      fireHitscan(state, weapon, rng);
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

export function destroyCastle(state: GameState, rng: () => number): void {
  const castle = state.castle;
  if (!castle) return;
  state.score += CASTLE_CORE_SCORE;
  state.blasts.push({
    pos: { x: castle.pos.x, y: castle.pos.y },
    maxR: 120,
    ttl: 0.7,
    age: 0,
    kind: "wreck",
  });
  // A slain castle always coughs up two gifts.
  for (let i = 0; i < 2; i++) {
    const dir = rng() * TAU;
    const total = DROP_TABLE.reduce((sum, d) => sum + d.weight, 0);
    let roll = rng() * total;
    let kind: PowerupKind = DROP_TABLE[0].kind;
    for (const d of DROP_TABLE) {
      roll -= d.weight;
      if (roll <= 0) {
        kind = d.kind;
        break;
      }
    }
    state.powerups.push({
      pos: { x: castle.pos.x, y: castle.pos.y },
      vel: { x: Math.cos(dir) * 60, y: Math.sin(dir) * 60 },
      kind,
      ttl: POWERUP_TTL,
    });
  }
  state.castle = null;
  state.castleTimer = CASTLE_EVERY;
}

function stepCastle(state: GameState, dt: number, rng: () => number): void {
  const castle = state.castle;
  if (!castle) {
    state.castleTimer -= dt;
    if (state.castleTimer <= 0) state.castle = makeCastle(state.w, state.h, rng);
    return;
  }

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

  // Pot-shots: small bullets spat out in random directions.
  castle.gunCooldown -= dt;
  if (castle.gunCooldown <= 0) {
    castle.gunCooldown = 0.5 + rng() * 1.2;
    const a = rng() * TAU;
    state.bullets.push({
      pos: { x: castle.pos.x, y: castle.pos.y },
      vel: { x: Math.cos(a) * CASTLE_GUN_SPEED, y: Math.sin(a) * CASTLE_GUN_SPEED },
      life: CASTLE_GUN_LIFE,
      kind: "enemy",
    });
  }

  // The signature attack: when the rotating shields open a radial hole toward
  // the ship, charge up and sweep a wide destructive beam across that arc.
  castle.sweepCooldown = Math.max(0, castle.sweepCooldown - dt);
  const shipTargetable = state.respawn <= 0 && !state.over;
  if (!castle.sweep && castle.sweepCooldown <= 0 && shipTargetable) {
    const theta = Math.atan2(state.ship.pos.y - castle.pos.y, state.ship.pos.x - castle.pos.x);
    if (castleHoleAt(castle, theta)) castle.sweep = { phase: "charge", t: 0, angle: theta };
  }

  const sweep = castle.sweep;
  if (sweep) {
    sweep.t += dt;
    if (sweep.phase === "charge") {
      if (sweep.t >= SWEEP_CHARGE) {
        castle.sweep = {
          phase: "fire",
          t: 0,
          from: sweep.angle - SWEEP_SPAN / 2,
          to: sweep.angle + SWEEP_SPAN / 2,
        };
      }
    } else {
      const frac = Math.min(1, sweep.t / SWEEP_DURATION);
      const angle = sweep.from + (sweep.to - sweep.from) * frac;
      const len = Math.max(state.w, state.h) * 1.5;
      const a = castle.pos;
      const b = { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
      // The beam carves through rocks…
      const survivors: Roid[] = [];
      for (const roid of state.roids) {
        if (segPointDist(a, b, roid.pos) <= SWEEP_WIDTH + ROID_R[roid.size]) {
          breakRoid(state, roid, rng, { shatter: true });
        } else survivors.push(roid);
      }
      state.roids = survivors;
      // …and through the ship.
      if (shipTargetable && segPointDist(a, b, state.ship.pos) <= SWEEP_WIDTH + SHIP_R) {
        hitShip(state);
      }
      if (sweep.t >= SWEEP_DURATION) {
        castle.sweep = null;
        castle.sweepCooldown = SWEEP_COOLDOWN;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Ship damage

/** One hit lands on the ship: shields absorb it, otherwise a life is lost. */
export function hitShip(state: GameState): void {
  const ship = state.ship;
  if (ship.invuln > 0 || state.respawn > 0 || state.over) return;
  if (ship.shield > 0) {
    ship.shield -= 1;
    ship.invuln = HIT_GRACE;
    return;
  }
  state.lives -= 1;
  state.blasts.push({
    pos: { x: ship.pos.x, y: ship.pos.y },
    maxR: 60,
    ttl: 0.6,
    age: 0,
    kind: "wreck",
  });
  if (state.lives <= 0) {
    state.over = true;
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
    if (input.left) ship.angle -= TURN_RATE * dt;
    if (input.right) ship.angle += TURN_RATE * dt;
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
  for (const bullet of state.bullets) {
    bullet.life -= dt;
    bullet.pos.x += bullet.vel.x * dt;
    bullet.pos.y += bullet.vel.y * dt;
    wrapPos(bullet.pos, state.w, state.h);
  }
  state.bullets = state.bullets.filter((b) => b.life > 0);

  // -- asteroids ------------------------------------------------------------
  for (const roid of state.roids) {
    roid.pos.x += roid.vel.x * dt;
    roid.pos.y += roid.vel.y * dt;
    roid.angle += roid.spin * dt;
    wrapPos(roid.pos, state.w, state.h);
  }

  // -- the castle -----------------------------------------------------------
  stepCastle(state, dt, rng);

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
    for (const roid of state.roids) {
      if (deadRoids.has(roid)) continue;
      if (torusDist(bullet.pos, roid.pos, state.w, state.h) <= ROID_R[roid.size] + 2) {
        deadBullets.add(bullet);
        deadRoids.add(roid);
        if (bullet.kind === "super") {
          // Super bullets burst into a radial spray of frags on impact.
          for (let i = 0; i < FRAG_COUNT; i++) {
            const a = (i / FRAG_COUNT) * TAU + rng() * 0.3;
            spawned.push({
              pos: { x: bullet.pos.x, y: bullet.pos.y },
              vel: { x: Math.cos(a) * FRAG_SPEED, y: Math.sin(a) * FRAG_SPEED },
              life: FRAG_LIFE,
              kind: "frag",
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

  // Player bullets vs the castle (swept so fast bullets can't tunnel a ring).
  const castle = state.castle;
  if (castle) {
    for (const bullet of state.bullets) {
      if (bullet.kind === "enemy" || deadBullets.has(bullet)) continue;
      const speed = Math.hypot(bullet.vel.x, bullet.vel.y);
      if (speed === 0) continue;
      const dir = { x: bullet.vel.x / speed, y: bullet.vel.y / speed };
      const back = { x: bullet.pos.x - bullet.vel.x * dt, y: bullet.pos.y - bullet.vel.y * dt };
      const travel = speed * dt;
      let hitT = Infinity;
      let hitRing: CastleRing | null = null;
      let hitSeg = -1;
      for (const ring of castle.rings) {
        for (const t of rayRimTs(back, dir, castle.pos, ring.r, travel)) {
          const at = { x: back.x + dir.x * t, y: back.y + dir.y * t };
          const seg = ringSegmentAt(ring, Math.atan2(at.y - castle.pos.y, at.x - castle.pos.x));
          if (ring.segs[seg] && t < hitT) {
            hitT = t;
            hitRing = ring;
            hitSeg = seg;
          }
        }
      }
      const coreT = rayCircleT(back, dir, castle.pos, CORE_R + 2, travel);
      if (coreT != null && coreT < hitT) {
        deadBullets.add(bullet);
        destroyCastle(state, rng);
        break; // castle is gone; stop checking bullets against it
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
        hitShip(state);
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
        hitShip(state);
      } else {
        hitShip(state);
      }
      break;
    }
  }

  // The castle's shield rings are solid walls to the ship.
  if (castle && state.respawn <= 0 && !state.over && ship.invuln <= 0) {
    const d = dist(ship.pos, castle.pos);
    for (const ring of castle.rings) {
      if (Math.abs(d - ring.r) > RING_BAND + SHIP_R) continue;
      const theta = Math.atan2(ship.pos.y - castle.pos.y, ship.pos.x - castle.pos.x);
      const seg = ringSegmentAt(ring, theta);
      if (!ring.segs[seg]) continue;
      if (ship.bouncy > 0) {
        // Bounce radially off the ring.
        const nx = (ship.pos.x - castle.pos.x) / (d || 1);
        const ny = (ship.pos.y - castle.pos.y) / (d || 1);
        const dot = ship.vel.x * nx + ship.vel.y * ny;
        ship.vel.x -= 2 * dot * nx;
        ship.vel.y -= 2 * dot * ny;
        const push = d < ring.r ? ring.r - RING_BAND - SHIP_R - 1 : ring.r + RING_BAND + SHIP_R + 1;
        ship.pos.x = castle.pos.x + nx * push;
        ship.pos.y = castle.pos.y + ny * push;
      } else if (ship.shield > 0) {
        ring.segs[seg] = false;
        state.score += CASTLE_SEG_SCORE;
        hitShip(state);
      } else {
        hitShip(state);
      }
      break;
    }
  }

  // Powerup pickups.
  if (shipAlive && !state.over) {
    const kept: Powerup[] = [];
    for (const pu of state.powerups) {
      if (torusDist(pu.pos, ship.pos, state.w, state.h) <= SHIP_R + POWERUP_R) {
        collectPowerup(state, pu.kind);
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
