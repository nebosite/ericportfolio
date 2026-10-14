// Pure particle bookkeeping for the atmosphere layer (dust, chips, shards,
// smoke, steam, sparks, flame). Particles are visual only: each one is fully
// described at spawn (origin, velocity, birth, life, kind, size) and the GPU
// integrates p = p0 + v0·t + ½g·t² every frame, so the CPU's only per-frame work
// is writing new particles into a ring buffer. No three.js here, so the maths
// is unit-tested.

export enum ParticleKind {
  Dust = 0,
  Chip = 1,
  Smoke = 2,
  Steam = 3,
  Shard = 4,
  Spark = 5,
  Flame = 6,
}

/** Kinds drawn with normal alpha blending vs additive (glowing) blending. */
export const NORMAL_KINDS = new Set([
  ParticleKind.Dust,
  ParticleKind.Chip,
  ParticleKind.Smoke,
  ParticleKind.Steam,
  ParticleKind.Shard,
]);
export const ADDITIVE_KINDS = new Set([ParticleKind.Spark, ParticleKind.Flame]);

export interface SpawnRange {
  start: number;
  count: number;
}

/** A fixed-capacity ring of particles backed by flat typed arrays. */
export class ParticleRing {
  readonly capacity: number;
  readonly origin: Float32Array; // xyz
  readonly velocity: Float32Array; // xyz
  readonly birth: Float32Array;
  readonly life: Float32Array;
  readonly kind: Float32Array;
  readonly size: Float32Array;
  readonly seed: Float32Array;
  private cursor = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.origin = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.birth = new Float32Array(capacity).fill(-1e9); // born long ago = dead
    this.life = new Float32Array(capacity).fill(1);
    this.kind = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.seed = new Float32Array(capacity);
  }

  /**
   * Reserve `count` consecutive slots (wrapping), calling `fill(index, k)` for each.
   * Returns the one or two contiguous ranges written, for partial GPU uploads.
   */
  spawn(count: number, fill: (index: number, k: number) => void): SpawnRange[] {
    const n = Math.min(count, this.capacity);
    const ranges: SpawnRange[] = [];
    let k = 0;
    while (k < n) {
      const start = this.cursor;
      const run = Math.min(n - k, this.capacity - start);
      for (let i = 0; i < run; i++) fill(start + i, k + i);
      ranges.push({ start, count: run });
      k += run;
      this.cursor = (start + run) % this.capacity;
    }
    return ranges;
  }

  /** Write one particle. */
  set(
    i: number,
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    birth: number,
    life: number,
    size: number,
    seed: number,
  ): void {
    this.origin[i * 3] = x;
    this.origin[i * 3 + 1] = y;
    this.origin[i * 3 + 2] = z;
    this.velocity[i * 3] = vx;
    this.velocity[i * 3 + 1] = vy;
    this.velocity[i * 3 + 2] = vz;
    this.birth[i] = birth;
    this.life[i] = life;
    this.kind[i] = kind;
    this.size[i] = size;
    this.seed[i] = seed;
  }

  /** Particles alive at `now` (a scan — for the stats panel, not the hot path). */
  alive(now: number): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const t = now - this.birth[i];
      if (t >= 0 && t <= this.life[i]) n++;
    }
    return n;
  }
}

/** Per-kind spawn recipe: how many, how fast, how long, how big. */
export interface Recipe {
  count: number;
  speed: number; // mean emission speed (m/s)
  up: number; // upward bias added to velocity (m/s)
  life: number; // seconds (mean)
  size: number; // metres (mean)
  spread: number; // initial position jitter (m)
}

export const RECIPES: Record<ParticleKind, Recipe> = {
  [ParticleKind.Dust]: { count: 8, speed: 4, up: 3, life: 2.5, size: 1.6, spread: 0.6 },
  [ParticleKind.Chip]: { count: 6, speed: 9, up: 4, life: 3.0, size: 0.22, spread: 0.3 },
  [ParticleKind.Smoke]: { count: 2, speed: 1.5, up: 2.5, life: 7, size: 3.5, spread: 1.0 },
  [ParticleKind.Steam]: { count: 3, speed: 2, up: 9, life: 2.2, size: 1.4, spread: 0.3 },
  [ParticleKind.Shard]: { count: 10, speed: 7, up: 2, life: 2.5, size: 0.16, spread: 0.4 },
  [ParticleKind.Spark]: { count: 14, speed: 12, up: 5, life: 0.7, size: 0.12, spread: 0.1 },
  [ParticleKind.Flame]: { count: 2, speed: 0.8, up: 3, life: 0.9, size: 1.3, spread: 0.5 },
};

/** Gravity felt by each kind (m/s²): buoyant kinds rise. */
export const KIND_GRAVITY: Record<ParticleKind, number> = {
  [ParticleKind.Dust]: -1.2,
  [ParticleKind.Chip]: -9.81,
  [ParticleKind.Smoke]: 0.6,
  [ParticleKind.Steam]: 1.5,
  [ParticleKind.Shard]: -9.81,
  [ParticleKind.Spark]: -9.81,
  [ParticleKind.Flame]: 2.0,
};

/**
 * Emit a burst of one kind at a point. `rnd` in [0,1); `scale` multiplies the
 * recipe's count (collapses spawn more per event when the budget allows).
 */
export function burst(
  ring: ParticleRing,
  kind: ParticleKind,
  x: number,
  y: number,
  z: number,
  now: number,
  rnd: () => number,
  scale = 1,
): SpawnRange[] {
  const r = RECIPES[kind];
  const count = Math.max(1, Math.round(r.count * scale));
  return ring.spawn(count, (i) => {
    // Random direction, biased upward, with magnitude around the recipe speed.
    const theta = rnd() * Math.PI * 2;
    const u = rnd() * 2 - 1;
    const s = Math.sqrt(1 - u * u);
    const mag = r.speed * (0.4 + 1.2 * rnd());
    ring.set(
      i,
      kind,
      x + (rnd() - 0.5) * 2 * r.spread,
      y + (rnd() - 0.5) * 2 * r.spread,
      z + (rnd() - 0.5) * 2 * r.spread,
      s * Math.cos(theta) * mag,
      u * mag + r.up * (0.5 + rnd()),
      s * Math.sin(theta) * mag,
      now,
      r.life * (0.6 + 0.8 * rnd()),
      r.size * (0.6 + 0.8 * rnd()),
      rnd(),
    );
  });
}

/** Material kind (protocol) → the visual bursts a break of that material throws. */
export function burstsForMaterial(material: number): ParticleKind[] {
  switch (material) {
    case 1: // steel
      return [ParticleKind.Spark, ParticleKind.Chip];
    case 2: // concrete
      return [ParticleKind.Dust, ParticleKind.Chip];
    case 3: // glass
      return [ParticleKind.Shard];
    default: // masonry
      return [ParticleKind.Dust, ParticleKind.Chip];
  }
}
