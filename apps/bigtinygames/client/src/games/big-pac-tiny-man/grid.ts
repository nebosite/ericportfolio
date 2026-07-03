// Pure grid + pathfinding helpers for Big Pac Tiny Man, extracted from the
// pixi-coupled engine so the maze topology and ghost-AI math can be unit tested
// on their own. Nothing here touches the DOM, pixi, or timers.

import { Vec } from "../input";

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

/** Straight-line (Euclidean) distance between two tiles on a torus. */
export function torusHypot(
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
  return Math.sqrt(dx * dx + dy * dy);
}

/** Turn a swipe delta (px or cells) into a 4-way heading by its dominant axis. */
export function swipeDirection(dx: number, dy: number): Vec {
  return Math.abs(dx) >= Math.abs(dy) ? { x: dx < 0 ? -1 : 1, y: 0 } : { x: 0, y: dy < 0 ? -1 : 1 };
}

/**
 * Steer toward a tapped cell. When already moving, turn on the axis
 * perpendicular to the current heading toward the tap (steer around corners);
 * when stopped, head toward the tap by its dominant axis. Returns null when the
 * tap gives no unambiguous turn.
 */
export function tapTurn(
  cur: Vec,
  from: { x: number; y: number },
  tap: { x: number; y: number },
): Vec | null {
  if (cur.x === 0 && cur.y === 0) {
    if (tap.x === from.x && tap.y === from.y) return null;
    return swipeDirection(tap.x - from.x, tap.y - from.y);
  }
  if (cur.y === 0) {
    // moving horizontally → steer vertically toward the tap
    if (tap.y < from.y) return { x: 0, y: -1 };
    if (tap.y > from.y) return { x: 0, y: 1 };
    return null;
  }
  // moving vertically → steer horizontally toward the tap
  if (tap.x < from.x) return { x: -1, y: 0 };
  if (tap.x > from.x) return { x: 1, y: 0 };
  return null;
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
 * Shortest toroidal path from `startIdx` to `targetIdx` across walkable tiles
 * (grid value 1 and not in `blocked`), returned as the list of step directions
 * to walk it. BFS is bounded to `maxSteps` deep; returns an empty array when the
 * target isn't reachable within that many steps (or start === target).
 */
export function bfsPath(
  grid: Uint8Array,
  cols: number,
  rows: number,
  startIdx: number,
  targetIdx: number,
  blocked: ReadonlySet<number>,
  maxSteps: number,
): Vec[] {
  if (startIdx === targetIdx) return [];
  const cameFrom = new Map<number, number>(); // tile -> tile we reached it from
  const stepDir = new Map<number, Vec>(); // tile -> dir taken to reach it
  const seen = new Set<number>([startIdx]);
  let frontier = [startIdx];
  let found = false;
  for (let depth = 0; depth < maxSteps && frontier.length > 0 && !found; depth++) {
    const next: number[] = [];
    for (const idx of frontier) {
      const x = idx % cols;
      const y = (idx - x) / cols;
      for (const d of DIRS) {
        const nx = wrap(x + d.x, cols);
        const ny = wrap(y + d.y, rows);
        const nidx = ny * cols + nx;
        if (seen.has(nidx) || grid[nidx] !== 1 || blocked.has(nidx)) continue;
        seen.add(nidx);
        cameFrom.set(nidx, idx);
        stepDir.set(nidx, d);
        if (nidx === targetIdx) {
          found = true;
          break;
        }
        next.push(nidx);
      }
      if (found) break;
    }
    frontier = next;
  }
  if (!found) return [];
  const dirs: Vec[] = [];
  for (let cur = targetIdx; cur !== startIdx; cur = cameFrom.get(cur)!) {
    dirs.push(stepDir.get(cur)!);
  }
  dirs.reverse();
  return dirs;
}

/**
 * A* shortest path from `startIdx` to `targetIdx` across walkable tiles (grid
 * value 1 and not in `blocked`), returned as the list of step directions to
 * walk it. Movement is toroidal and uniform-cost, with the toroidal Manhattan
 * distance as an admissible heuristic, so the path is optimal — and, unlike a
 * greedy "step toward home" chase, it can never get stuck circling a wall.
 * Returns an empty array if the target is unreachable (or start === target).
 */
export function aStarPath(
  grid: Uint8Array,
  cols: number,
  rows: number,
  startIdx: number,
  targetIdx: number,
  blocked: ReadonlySet<number>,
  maxExpansions: number = cols * rows,
): Vec[] {
  if (startIdx === targetIdx) return [];
  const tX = targetIdx % cols;
  const tY = (targetIdx - tX) / cols;
  const heuristic = (idx: number) => {
    const x = idx % cols;
    const y = (idx - x) / cols;
    return torusDist(x, y, tX, tY, cols, rows);
  };

  // Binary min-heap of [fScore, tile]; small and dependency-free.
  const heap: Array<[number, number]> = [[heuristic(startIdx), startIdx]];
  const push = (f: number, idx: number) => {
    heap.push([f, idx]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < heap.length && heap[l][0] < heap[s][0]) s = l;
        if (r < heap.length && heap[r][0] < heap[s][0]) s = r;
        if (s === i) break;
        [heap[s], heap[i]] = [heap[i], heap[s]];
        i = s;
      }
    }
    return top;
  };

  const gScore = new Map<number, number>([[startIdx, 0]]);
  const cameFrom = new Map<number, number>();
  const stepDir = new Map<number, Vec>();
  const closed = new Set<number>();
  let expansions = 0;
  while (heap.length > 0 && expansions < maxExpansions) {
    const [, current] = pop();
    if (current === targetIdx) {
      const dirs: Vec[] = [];
      for (let cur = targetIdx; cur !== startIdx; cur = cameFrom.get(cur)!) {
        dirs.push(stepDir.get(cur)!);
      }
      dirs.reverse();
      return dirs;
    }
    if (closed.has(current)) continue;
    closed.add(current);
    expansions++;
    const cx = current % cols;
    const cy = (current - cx) / cols;
    const g = gScore.get(current)!;
    for (const d of DIRS) {
      const nx = wrap(cx + d.x, cols);
      const ny = wrap(cy + d.y, rows);
      const nidx = ny * cols + nx;
      if (grid[nidx] !== 1 || blocked.has(nidx) || closed.has(nidx)) continue;
      const tentative = g + 1;
      if (tentative < (gScore.get(nidx) ?? Infinity)) {
        gScore.set(nidx, tentative);
        cameFrom.set(nidx, current);
        stepDir.set(nidx, d);
        push(tentative + heuristic(nidx), nidx);
      }
    }
  }
  return [];
}

/**
 * Scan straight down column `x` from row `startY` (toroidal), returning the
 * index of the first walkable tile (grid value 1) that isn't in `blocked`, or
 * -1 if the whole column is walled/blocked. Used to drop fruit into the first
 * open spot beneath a ghost lair's entrance.
 */
export function firstOpenBelow(
  grid: Uint8Array,
  cols: number,
  rows: number,
  x: number,
  startY: number,
  blocked: ReadonlySet<number>,
): number {
  for (let step = 0; step < rows; step++) {
    const y = wrap(startY + step, rows);
    const idx = y * cols + x;
    if (grid[idx] === 1 && !blocked.has(idx)) return idx;
  }
  return -1;
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
