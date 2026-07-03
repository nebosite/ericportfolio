// Pure, framework-free model for Big Pipe Tiny Dream (a rotate-in-place take on
// Pipe Dream). No DOM / canvas / timers live here — only the grid of pipe tiles,
// how they connect when rotated, and how the water streams thread through them.
// The render loop in BigPipeTinyDream.tsx drives these with real pixels/time.
//
// Sides are indexed clockwise from north: 0=N, 1=E, 2=S, 3=W. A tile carries a
// `kind`, a `rot` (0..3 quarter-turns clockwise), and a per-side `water` flag
// (any water at all locks the tile against rotation).
//
// Water is a set of concurrent stream heads: a `tee` splits one stream into two,
// so a single source can feed several drains at once.

export type Side = number; // 0=N, 1=E, 2=S, 3=W
export const N = 0;
export const E = 1;
export const S = 2;
export const W = 3;

/** Opposite side — the edge you arrive at after crossing the shared border. */
export const OPP: Side[] = [S, W, N, E];
/** Neighbour offset per side. */
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export type PipeKind = "straight" | "elbow" | "cross" | "tee" | "start" | "terminus";

export interface Tile {
  kind: PipeKind;
  rot: number; // 0..3 quarter-turns clockwise
  dir?: Side; // start/terminus only: the single side that opens (spout / drain)
  water: boolean[]; // length 4 — which sides currently carry water
}

export interface Grid {
  cols: number;
  rows: number;
  tiles: Tile[]; // row-major, length cols*rows
  start: { x: number; y: number };
  drains: Array<{ x: number; y: number }>; // reaching every one clears the level
}

export type Rng = () => number;

// Base openings at rot 0. A straight is a vertical pipe (N–S); an elbow bends
// N→E; a cross opens all four sides (two independent channels); a tee opens
// E+S+W (a horizontal bar with a downward stem). Start/terminus openings come
// from their `dir`, not this table.
const BASE_OPEN: Record<PipeKind, Side[]> = {
  straight: [N, S],
  elbow: [N, E],
  cross: [N, E, S, W],
  tee: [E, S, W],
  start: [],
  terminus: [],
};

/** Kinds whose single opening is tracked by `dir` (and which rotate that dir). */
export const isDirKind = (kind: PipeKind): boolean => kind === "start" || kind === "terminus";

export const idx = (g: Grid, x: number, y: number): number => y * g.cols + x;
export const inBounds = (g: Grid, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows;
export const tileAt = (g: Grid, x: number, y: number): Tile => g.tiles[idx(g, x, y)];

// The board wraps: stepping off one edge continues on the opposite one, so the
// grid is a torus (like Big Pac's maze). Neighbour lookups run through these.
export const wrapX = (g: Grid, x: number): number => ((x % g.cols) + g.cols) % g.cols;
export const wrapY = (g: Grid, y: number): number => ((y % g.rows) + g.rows) % g.rows;

/** Which sides this tile currently opens onto, accounting for its rotation. */
export function openings(t: Tile): boolean[] {
  const out = [false, false, false, false];
  if (isDirKind(t.kind)) {
    out[t.dir ?? N] = true;
    return out;
  }
  for (const s of BASE_OPEN[t.kind]) out[(s + t.rot) % 4] = true;
  return out;
}

/**
 * Where water leaves this tile after entering from `entry`:
 *   - straight / cross: straight through (a cross keeps its two channels
 *     independent, so it never turns) — one exit.
 *   - elbow: bends to its other opening — one exit.
 *   - tee: splits into the other two ports — two exits.
 *   - terminus/start: only one opening, so there's nowhere onward — no exits.
 * Returns [] if `entry` isn't actually an opening.
 */
export function exits(t: Tile, entry: Side): Side[] {
  const open = openings(t);
  if (!open[entry]) return [];
  if (t.kind === "cross") return open[OPP[entry]] ? [OPP[entry]] : [];
  const out: Side[] = [];
  for (let s = 0; s < 4; s++) if (open[s] && s !== entry) out.push(s);
  return out;
}

/**
 * Can this tile take water arriving at `entry`? It must open onto that side and
 * that side must be dry — an already-wet side (a full pipe, a used cross/tee
 * channel) has nothing left to receive, so a stream that hits it dies.
 */
export function canReceive(t: Tile, entry: Side): boolean {
  return openings(t)[entry] && !t.water[entry];
}

/** Start tiles are the source (always "wet"); any watered pipe is locked too. */
export function isLocked(t: Tile): boolean {
  return t.kind === "start" || t.water.some(Boolean);
}

/**
 * Rotate a tile one quarter-turn clockwise (caller checks isLocked first).
 * Dir-kinds (a rotatable terminus) turn their single opening; everyone else
 * advances `rot`.
 */
export function rotateTile(t: Tile): Tile {
  if (isDirKind(t.kind)) {
    return { ...t, dir: (((t.dir ?? N) + 1) % 4) as Side, water: [...t.water] };
  }
  return { ...t, rot: (t.rot + 1) % 4, water: [...t.water] };
}

// Non-tee kind weights for a fresh board: elbows and straights are the
// workhorses, the crossover piece is the rarer treat.
const KIND_BAG: PipeKind[] = ["straight", "straight", "elbow", "elbow", "elbow", "cross"];

// Tees are a rare splitter — roughly 2% of the board.
const TEE_PROB = 0.02;

/**
 * How many drains a level carries: 1 + ceil(gridArea / 1000) * level, where the
 * area is counted in grid cells.
 */
export const drainCount = (cols: number, rows: number, level: number): number =>
  1 + Math.ceil((cols * rows) / 1000) * level;

const euclid = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

/**
 * A full board of pipes with:
 *   - `tee` splitters sprinkled at ~2% of tiles, the rest random
 *     straight/elbow/cross;
 *   - a `start` source in the central area, pointing a random in-bounds
 *     direction;
 *   - `drainCount` terminus drains placed randomly, each at least 4 grid units
 *     from every edge, from the source, and from one another.
 */
export function generateGrid(cols: number, rows: number, rng: Rng, level = 1): Grid {
  const tiles: Tile[] = [];
  for (let i = 0; i < cols * rows; i++) {
    const isTee = rng() < TEE_PROB;
    const kind = isTee ? "tee" : KIND_BAG[Math.floor(rng() * KIND_BAG.length)];
    tiles.push({ kind, rot: Math.floor(rng() * 4), water: [false, false, false, false] });
  }

  const sx = Math.floor(cols * 0.25 + rng() * cols * 0.5);
  const sy = Math.floor(rows * 0.25 + rng() * rows * 0.5);
  const dir = Math.floor(rng() * 4) as Side;
  const start: Tile = { kind: "start", rot: 0, dir, water: [false, false, false, false] };
  start.water[dir] = true; // the source is primed from the first frame
  tiles[sy * cols + sx] = start;

  // Drains: random, ≥4 from any edge / the source / each other.
  const drains: Array<{ x: number; y: number }> = [];
  const target = drainCount(cols, rows, level);
  const minX = 4;
  const maxX = cols - 5;
  const minY = 4;
  const maxY = rows - 5;
  if (maxX >= minX && maxY >= minY) {
    let attempts = 0;
    while (drains.length < target && attempts < target * 300) {
      attempts++;
      const x = minX + Math.floor(rng() * (maxX - minX + 1));
      const y = minY + Math.floor(rng() * (maxY - minY + 1));
      if (euclid(x, y, sx, sy) < 4) continue;
      if (drains.some((d) => euclid(x, y, d.x, d.y) < 4)) continue;
      drains.push({ x, y });
    }
  }
  if (drains.length === 0) {
    // Board too small for the margins — fall back to a single spot opposite the
    // source so the level is still completable.
    const fx = Math.min(cols - 1, Math.max(0, cols - 1 - sx));
    const fy = Math.min(rows - 1, Math.max(0, rows - 1 - sy));
    if (fx !== sx || fy !== sy) drains.push({ x: fx, y: fy });
  }
  for (const d of drains) {
    tiles[d.y * cols + d.x] = {
      kind: "terminus",
      rot: 0,
      dir: Math.floor(rng() * 4) as Side,
      water: [false, false, false, false],
    };
  }

  return { cols, rows, tiles, start: { x: sx, y: sy }, drains };
}

// A stream head: the tile its leading edge is crossing, the side it entered
// from, the side(s) it will leave by (two for a tee), and 0..1 progress across
// the tile.
export interface Head {
  x: number;
  y: number;
  entry: Side;
  exits: Side[];
  progress: number;
}

// What happens when a stream steps toward a neighbour:
//   - continue: it enters an ordinary pipe and rides on as a (new) head;
//   - drain: it reaches a terminus — that drain is now fed;
//   - dead: the branch ends. "crash" (ran off the board or into a mis-oriented
//     tile — a preparation failure) ends the whole game immediately; "collision"
//     (ran into water already flowing) only kills that one branch.
export type DeathReason = "crash" | "collision";
export type Step =
  | { type: "continue"; head: Head }
  | { type: "drain"; x: number; y: number; entry: Side }
  | { type: "dead"; reason: DeathReason };

// Mark a tile's channel(s) wet and return the head sitting at its entry edge.
// Mutates the tile's `water` (the grid is a mutable ref in the render layer,
// mirroring how the pixi engine mutates its world).
function enterTile(g: Grid, x: number, y: number, entry: Side): Head {
  const t = tileAt(g, x, y);
  const ex = exits(t, entry);
  t.water[entry] = true;
  for (const e of ex) t.water[e] = true;
  return { x, y, entry, exits: ex, progress: 0 };
}

// Step a stream into the cell (x,y), arriving at side `entry`.
function stepInto(g: Grid, x: number, y: number, entry: Side): Step {
  // Off the board or a tile with no opening on that side is a crash (the player
  // never prepared a pipe there) → game over.
  if (!inBounds(g, x, y) || !openings(tileAt(g, x, y))[entry]) {
    return { type: "dead", reason: "crash" };
  }
  const t = tileAt(g, x, y);
  // A matching opening that's already wet is a collision — this branch dies, but
  // the run goes on if another stream is still alive.
  if (t.water[entry]) return { type: "dead", reason: "collision" };
  if (t.kind === "terminus") {
    t.water[entry] = true;
    return { type: "drain", x, y, entry };
  }
  return { type: "continue", head: enterTile(g, x, y, entry) };
}

/**
 * Begin the flood: water leaves the start tile toward its `dir` into the
 * neighbouring cell (wrapping across the board edge). One step — the caller
 * turns it into the first head (or an immediate game over / drain).
 */
export function startFlow(g: Grid): Step {
  const s = tileAt(g, g.start.x, g.start.y);
  const dir = s.dir ?? N;
  return stepInto(g, wrapX(g, g.start.x + DX[dir]), wrapY(g, g.start.y + DY[dir]), OPP[dir]);
}

/**
 * Advance a head that has run the full length of its tile: one Step per exit
 * (two for a tee). Neighbours wrap across the board edges. A branch that runs
 * into a mis-oriented tile comes back a `crash`, into water already there a
 * `collision`; one that reaches a terminus comes back `drain`.
 */
export function advanceHead(g: Grid, head: Head): Step[] {
  return head.exits.map((exit) =>
    stepInto(g, wrapX(g, head.x + DX[exit]), wrapY(g, head.y + DY[exit]), OPP[exit]),
  );
}

/**
 * Which tiles the water could actually reach from the source — the same routing
 * as the real flood (following `exits`, so a cross only passes straight through
 * its two independent channels and a tee splits), just ignoring collisions.
 * States are (tile, entry side) so a piece's reachable exits depend on how the
 * stream arrived. The render layer darkens everything this leaves out.
 */
export function connectedToSource(g: Grid): boolean[] {
  const connected = new Array(g.cols * g.rows).fill(false);
  connected[idx(g, g.start.x, g.start.y)] = true;
  const visited = new Set<number>(); // key = tileIndex * 4 + entry side
  const queue: Array<{ x: number; y: number; entry: Side }> = [];

  // Water entering cell (x,y) from `entry` — only if the tile opens there.
  const enter = (rawX: number, rawY: number, entry: Side) => {
    const x = wrapX(g, rawX);
    const y = wrapY(g, rawY);
    if (!openings(tileAt(g, x, y))[entry]) return;
    const key = idx(g, x, y) * 4 + entry;
    if (visited.has(key)) return;
    visited.add(key);
    connected[idx(g, x, y)] = true;
    queue.push({ x, y, entry });
  };

  const s = tileAt(g, g.start.x, g.start.y);
  const dir = s.dir ?? N;
  enter(g.start.x + DX[dir], g.start.y + DY[dir], OPP[dir]); // the source emits

  while (queue.length) {
    const { x, y, entry } = queue.shift() as { x: number; y: number; entry: Side };
    for (const ex of exits(tileAt(g, x, y), entry)) {
      enter(x + DX[ex], y + DY[ex], OPP[ex]);
    }
  }
  return connected;
}

// Difficulty knobs, all keyed off the 1-based level (from the game spec).
// The base (35 − 5·level, floored at 5s) gets a flat +30s of planning time.
export const countdownSec = (level: number): number => Math.max(5, 35 - 5 * level) + 30;
export const flowRate = (level: number): number => 4 + 4 * level; // pixels / second
