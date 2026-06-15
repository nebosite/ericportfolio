// Pure grid + pathfinding helpers for Big Pac Tiny Man, extracted from the
// pixi-coupled engine so the maze topology and ghost-AI math can be unit tested
// on their own. Nothing here touches the DOM, pixi, or timers.

import { Vec } from '../input';

/** Toroidal wrap of a coordinate into [0, n). */
export function wrap(v: number, n: number): number {
  return ((v % n) + n) % n;
}

/** Manhattan distance between two tiles on a torus of the given dimensions. */
export function torusDist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cols: number,
  rows: number,
): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > cols - dx) dx = cols - dx;
  if (dy > rows - dy) dy = rows - dy;
  return dx + dy;
}

/** The four cardinal moves. */
export const DIRS: Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Flood-fill path distances outward from `startIdx` across walkable tiles
 * (grid value 1 and not in `blocked`), stopping at `radius` steps. Movement is
 * toroidal. Returns tile index -> step distance, including the start at 0.
 */
export function bfsDistances(
  grid: Uint8Array,
  cols: number,
  rows: number,
  startIdx: number,
  blocked: ReadonlySet<number>,
  radius: number,
): Map<number, number> {
  const dist = new Map<number, number>();
  dist.set(startIdx, 0);
  let frontier = [startIdx];
  for (let depth = 1; depth <= radius && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const idx of frontier) {
      const x = idx % cols;
      const y = (idx - x) / cols;
      for (const d of DIRS) {
        const nx = wrap(x + d.x, cols);
        const ny = wrap(y + d.y, rows);
        const nidx = ny * cols + nx;
        if (dist.has(nidx)) continue;
        if (grid[nidx] !== 1 || blocked.has(nidx)) continue;
        dist.set(nidx, depth);
        next.push(nidx);
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Of the given move options, the one whose destination tile has the lowest
 * recorded distance — i.e. the step that descends a BFS gradient fastest.
 * Returns null when no option lands on a known tile.
 */
export function gradientStep(
  options: Vec[],
  fromTx: number,
  fromTy: number,
  cols: number,
  rows: number,
  distances: Map<number, number>,
): Vec | null {
  let best: Vec | null = null;
  let bestD = Infinity;
  for (const d of options) {
    const nidx = wrap(fromTy + d.y, rows) * cols + wrap(fromTx + d.x, cols);
    const nd = distances.get(nidx);
    if (nd !== undefined && nd < bestD) {
      bestD = nd;
      best = d;
    }
  }
  return best;
}

/**
 * Of the given options, the move that minimizes (or, when `flee`, maximizes)
 * toroidal distance to the target tile.
 */
export function bestTowardTarget(
  options: Vec[],
  fromTx: number,
  fromTy: number,
  target: { x: number; y: number },
  cols: number,
  rows: number,
  flee: boolean,
): Vec {
  let best = options[0];
  let bestScore = Infinity;
  for (const d of options) {
    const nx = wrap(fromTx + d.x, cols);
    const ny = wrap(fromTy + d.y, rows);
    const dist = torusDist(nx, ny, target.x, target.y, cols, rows);
    const score = flee ? -dist : dist;
    if (score < bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/**
 * Greedy spaced sampling: shuffle `candidates`, then accept a tile only if it is
 * at least `gap` tiles (Euclidean) from every tile already accepted, until
 * `target` are chosen. A bucket grid keeps the neighbor check ~O(1). `rng` is
 * injectable so callers (and tests) can make the sampling deterministic.
 */
export function chooseSpacedTiles(
  candidates: number[],
  cols: number,
  target: number,
  gap: number,
  rng: () => number = Math.random,
): Set<number> {
  target = Math.min(target, candidates.length);

  const order = candidates.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const buckets = new Map<number, Array<[number, number]>>();
  const bucketCols = Math.ceil(cols / gap) + 2;
  const bkey = (bx: number, by: number) => by * bucketCols + bx;
  const farEnough = (x: number, y: number) => {
    const bx = Math.floor(x / gap);
    const by = Math.floor(y / gap);
    for (let iy = by - 1; iy <= by + 1; iy++) {
      for (let ix = bx - 1; ix <= bx + 1; ix++) {
        const arr = buckets.get(bkey(ix, iy));
        if (!arr) continue;
        for (const [px, py] of arr) {
          const dx = px - x;
          const dy = py - y;
          if (dx * dx + dy * dy < gap * gap) return false;
        }
      }
    }
    return true;
  };

  const chosen = new Set<number>();
  for (const idx of order) {
    if (chosen.size >= target) break;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (!farEnough(x, y)) continue;
    chosen.add(idx);
    const key = bkey(Math.floor(x / gap), Math.floor(y / gap));
    let arr = buckets.get(key);
    if (!arr) buckets.set(key, (arr = []));
    arr.push([x, y]);
  }
  return chosen;
}
