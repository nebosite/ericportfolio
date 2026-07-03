// Pure, framework-free model for Big Pipe Tiny Dream (a rotate-in-place take on
// Pipe Dream). No DOM / canvas / timers live here — only the grid of pipe tiles,
// how they connect when rotated, and how the water head threads through them.
// The render loop in BigPipeTinyDream.tsx drives these with real pixels/time.
//
// Sides are indexed clockwise from north: 0=N, 1=E, 2=S, 3=W. A tile carries a
// `kind`, a `rot` (0..3 quarter-turns clockwise), and a per-side `water` flag
// (any water at all locks the tile against rotation).

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

export type PipeKind = "straight" | "elbow" | "cross" | "start" | "terminus";

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
  terminus: { x: number; y: number }; // the drain — water reaching it clears the level
}

export type Rng = () => number;

// Base openings at rot 0. A straight is a vertical pipe (N–S); an elbow bends
// N→E; a cross opens all four sides (two independent channels). Start/terminus
// openings come from their `dir`, not this table.
const BASE_OPEN: Record<PipeKind, Side[]> = {
  straight: [N, S],
  elbow: [N, E],
  cross: [N, E, S, W],
  start: [],
  terminus: [],
};

/** Kinds whose single opening is tracked by `dir` (and which rotate that dir). */
export const isDirKind = (kind: PipeKind): boolean => kind === "start" || kind === "terminus";

export const idx = (g: Grid, x: number, y: number): number => y * g.cols + x;
export const inBounds = (g: Grid, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < g.cols && y < g.rows;
export const tileAt = (g: Grid, x: number, y: number): Tile => g.tiles[idx(g, x, y)];

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
 * Where water leaves this tile after entering from `entry`. Straight and cross
 * pass straight through (a cross keeps its two channels independent, so it
 * never turns); an elbow bends to its other opening. A terminus/start has only
 * one opening, so there's nowhere onward — returns null.
 */
export function exitSide(t: Tile, entry: Side): Side | null {
  const open = openings(t);
  if (!open[entry]) return null;
  if (t.kind === "cross") return open[OPP[entry]] ? OPP[entry] : null;
  for (let s = 0; s < 4; s++) if (open[s] && s !== entry) return s;
  return null;
}

/**
 * Can this tile take water arriving at `entry`? It must open onto that side and
 * that side must be dry — an already-wet side (a straight/elbow that's full, or
 * a cross channel already in use) has nothing left to receive.
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

// Kind weights for a fresh board: elbows and straights are the workhorses, the
// crossover piece is the rare treat.
const KIND_BAG: PipeKind[] = ["straight", "straight", "elbow", "elbow", "elbow", "cross"];

/**
 * A full board of randomly-kinded, randomly-rotated pipes with a start tile in
 * the central area (the middle 50% each way, pointing a random direction so its
 * first neighbour always exists) and a terminus drain at the start's mirror
 * position through the board centre.
 */
export function generateGrid(cols: number, rows: number, rng: Rng): Grid {
  const tiles: Tile[] = [];
  for (let i = 0; i < cols * rows; i++) {
    tiles.push({
      kind: KIND_BAG[Math.floor(rng() * KIND_BAG.length)],
      rot: Math.floor(rng() * 4),
      water: [false, false, false, false],
    });
  }
  const sx = Math.floor(cols * 0.25 + rng() * cols * 0.5);
  const sy = Math.floor(rows * 0.25 + rng() * rows * 0.5);
  const dir = Math.floor(rng() * 4) as Side;
  const start: Tile = { kind: "start", rot: 0, dir, water: [false, false, false, false] };
  start.water[dir] = true; // the source is primed from the first frame
  tiles[sy * cols + sx] = start;

  // The drain sits opposite the spring, mirrored through the board centre.
  let tx = cols - 1 - sx;
  let ty = rows - 1 - sy;
  if (tx === sx && ty === sy) {
    // Start landed dead centre — nudge the drain off it, staying in bounds.
    tx = sx + 1 < cols ? sx + 1 : sx - 1;
  }
  const tdir = Math.floor(rng() * 4) as Side;
  tiles[ty * cols + tx] = {
    kind: "terminus",
    rot: 0,
    dir: tdir,
    water: [false, false, false, false],
  };

  return { cols, rows, tiles, start: { x: sx, y: sy }, terminus: { x: tx, y: ty } };
}

// The water head: the single tile the leading edge is crossing right now, the
// side it entered from, the side it will leave by, and 0..1 progress across the
// tile. `filled` counts pipe tiles the water has entered (the start tile is the
// source and doesn't count). `dead` marks a game over; `won` marks the frame the
// head enters the terminus drain.
export interface Flow {
  x: number;
  y: number;
  entry: Side;
  exit: Side;
  progress: number;
  dead: boolean;
  won: boolean;
  filled: number;
}

// Mark a tile's channel wet and return the head sitting at its entry edge.
// Mutates the tile's `water` (the grid is a mutable ref in the render layer,
// mirroring how the pixi engine mutates its world).
function enterTile(g: Grid, x: number, y: number, entry: Side, filledSoFar: number): Flow {
  const t = tileAt(g, x, y);
  const exit = exitSide(t, entry);
  t.water[entry] = true;
  if (exit != null) t.water[exit] = true;
  return {
    x,
    y,
    entry,
    exit: exit ?? entry,
    progress: 0,
    dead: false,
    won: t.kind === "terminus",
    filled: filledSoFar + 1,
  };
}

/**
 * Begin the flood: water leaves the start tile toward its `dir` into the
 * neighbouring pipe. If that neighbour is off-grid or can't receive, the head
 * comes back dead (an immediate game over the moment the countdown ends).
 */
export function startFlow(g: Grid): Flow {
  const s = tileAt(g, g.start.x, g.start.y);
  const dir = s.dir ?? N;
  const nx = g.start.x + DX[dir];
  const ny = g.start.y + DY[dir];
  const entry = OPP[dir];
  if (!inBounds(g, nx, ny) || !canReceive(tileAt(g, nx, ny), entry)) {
    return { x: nx, y: ny, entry, exit: entry, progress: 0, dead: true, won: false, filled: 0 };
  }
  return enterTile(g, nx, ny, entry, 0);
}

/**
 * Cross the head into the next tile once it has run the length of the current
 * one. Game over if the next tile is off the board or isn't oriented to receive
 * the water ("reaches the edge of a tile with nothing to receive it").
 */
export function advanceFlow(g: Grid, f: Flow): Flow {
  if (f.dead || f.won) return f;
  const exit = f.exit;
  const nx = f.x + DX[exit];
  const ny = f.y + DY[exit];
  const entry = OPP[exit];
  if (!inBounds(g, nx, ny) || !canReceive(tileAt(g, nx, ny), entry)) {
    return { ...f, dead: true };
  }
  return enterTile(g, nx, ny, entry, f.filled);
}

// Difficulty knobs, all keyed off the 1-based level (from the game spec).
export const countdownSec = (level: number): number => Math.max(5, 35 - 5 * level);
export const flowRate = (level: number): number => 4 + 4 * level; // pixels / second
