// growMark.ts
// Framework-free generator for the "living specimen" marks used in the
// portfolio redesign. Each project/category is grown once from a seed into a
// fractal organism with handedness (it curls one way) and non-bilateral
// branching. The growth STYLE encodes where a thing sits on the hand→machine
// spectrum: wild → sapling → grafted → crystalline.
//
// This module produces plain geometry (line segments + bud points). Render it
// with the GrownMark component (components/GrownMark.tsx).
//
// No dependencies. Deterministic: same (seed, style, growthSeed) always grows
// the same mark.

export type GrowthStyle = "wild" | "sapling" | "grafted" | "crystal";

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
}
export interface Bud {
  x: number;
  y: number;
}
export interface Mark {
  segments: Segment[];
  buds: Bud[];
  square: boolean; // true → buds render as squares (crystalline), else circles
  cap: "round" | "butt";
}

interface StyleParams {
  depth: number; // recursion depth (trunk = depth, tips = 0)
  len: number; // initial segment length
  decay: number; // length multiplier per level
  angle: number; // base branch spread, degrees
  jitter: number; // 0..1 angular randomness (relative to angle)
  hand: number; // 0..1 handedness bias — whole organism curls one way
  splits: number[]; // pool of child counts to pick from
  graft?: boolean; // organic base, geometric (machine) tips
  geometric?: boolean; // fully ordered/crystalline
}

export const STYLES: Record<GrowthStyle, StyleParams> = {
  wild: {
    depth: 6,
    len: 31,
    decay: 0.74,
    angle: 30,
    jitter: 0.55,
    hand: 0.42,
    splits: [2, 2, 2, 3],
  },
  sapling: {
    depth: 4,
    len: 27,
    decay: 0.72,
    angle: 24,
    jitter: 0.4,
    hand: 0.26,
    splits: [2, 2, 1],
  },
  grafted: {
    depth: 6,
    len: 28,
    decay: 0.73,
    angle: 27,
    jitter: 0.45,
    hand: 0.3,
    splits: [2, 2, 3],
    graft: true,
  },
  crystal: {
    depth: 5,
    len: 27,
    decay: 0.76,
    angle: 38,
    jitter: 0.06,
    hand: 0,
    splits: [2, 2, 3],
    geometric: true,
  },
};

// FNV-1a string hash → 32-bit seed
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32 PRNG
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Grow a mark. ViewBox is 0 0 120 150; base at (60,148), growing upward.
 * @param seedStr   unique per item (e.g. project name); same string → same mark
 * @param style     growth archetype
 * @param strokeScale  multiplier for stroke + bud size (emblems ~1.18, inline ~0.85)
 * @param growthSeed   global reseed — bump to regrow every organism
 */
export function growMark(
  seedStr: string,
  style: GrowthStyle,
  strokeScale = 1,
  growthSeed = 1,
): Mark {
  const S = STYLES[style];
  const r = rng(hash(seedStr + "|" + growthSeed));
  const segments: Segment[] = [];
  const buds: Bud[] = [];
  const handSign = r() < 0.5 ? -1 : 1; // handedness
  const pick = (arr: number[]) => arr[Math.floor(r() * arr.length)];

  const grow = (
    x: number,
    y: number,
    ang: number,
    len: number,
    depth: number,
  ) => {
    if (depth <= 0 || len < 3) {
      buds.push({ x, y });
      return;
    }
    const rad = (ang * Math.PI) / 180;
    const x2 = x + Math.cos(rad) * len;
    const y2 = y + Math.sin(rad) * len;
    segments.push({
      x1: x,
      y1: y,
      x2,
      y2,
      w: Math.max(0.7, depth * 0.95) * strokeScale,
    });

    const geo = !!S.geometric || (!!S.graft && depth <= 2); // grafted: tips go geometric
    let n = pick(S.splits);
    if (depth === S.depth) n = Math.max(n, 2);

    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0 : i / (n - 1) - 0.5;
      let off = frac * S.angle * 2;
      if (n === 1) off = geo ? 0 : (r() - 0.5) * S.angle * 0.5;
      const jit = geo
        ? (r() - 0.5) * 2.2
        : (r() - 0.5) * S.angle * S.jitter * 2;
      const handed = handSign * S.hand * S.angle;
      const childAng = ang + off + jit + handed;
      const nlen = len * S.decay * (geo ? 1 : 0.84 + r() * 0.32);
      grow(x2, y2, childAng, nlen, depth - 1);
    }
  };

  grow(
    60,
    148,
    -90 + handSign * S.hand * S.angle * 0.6,
    S.len * (0.92 + r() * 0.18),
    S.depth,
  );
  return {
    segments,
    buds,
    square: !!S.geometric,
    cap: S.geometric ? "butt" : "round",
  };
}
