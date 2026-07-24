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

// "endcap" is a single-opening plug: water flows in and safely STOPS (no onward
// exit, no crash). It is never seeded onto a board — it only exists as a free
// part the player can drop to cap a dead end (e.g. a tee's spare spur).
export type PipeKind = "straight" | "elbow" | "cross" | "tee" | "start" | "terminus" | "endcap";

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
  hint?: Level1Hint; // level-1 only: the pre-laid example route, for the tutorial
}

/** The level-1 pre-laid example route, surfaced for the on-board tutorial. */
export interface Level1Hint {
  /** Ordered cells from the source to the target drain (drives the tutorial arrow). */
  path: Array<{ x: number; y: number }>;
  /** The tee that splits the trail; its third opening is left free as a hint. */
  tee: { x: number; y: number };
  /** The single drain the pre-laid trail reaches. */
  target: { x: number; y: number };
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
  endcap: [N], // a single opening; water enters and stops (no onward exit)
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

/**
 * Turn a tile in place so it opens onto `side`. Dir-kinds point their single
 * opening there; every other kind is rotated to the first `rot` that includes
 * `side` (every kind can face any side, so this always succeeds). Used at
 * generation time to guarantee a source/drain's neighbour connects back to it.
 */
export function orientToOpen(t: Tile, side: Side): void {
  if (isDirKind(t.kind)) {
    t.dir = side;
    return;
  }
  for (let r = 0; r < 4; r++) {
    if (openings({ ...t, rot: r })[side]) {
      t.rot = r;
      return;
    }
  }
}

/**
 * Turn a tile into the pipe that opens exactly onto `a` and `b`: a straight when
 * they're opposite, an elbow when they're adjacent. Used to lay a pre-solved
 * trail cell that connects its previous and next neighbours.
 */
export function orientToConnect(t: Tile, a: Side, b: Side): void {
  t.dir = undefined;
  t.water = [false, false, false, false];
  if (a === OPP[b]) {
    t.kind = "straight";
    t.rot = a === N || a === S ? 0 : 1; // straight opens N–S at rot 0, E–W at rot 1
    return;
  }
  t.kind = "elbow";
  for (let r = 0; r < 4; r++) {
    const o = openings({ kind: "elbow", rot: r, water: [false, false, false, false] });
    if (o[a] && o[b]) {
      t.rot = r;
      return;
    }
  }
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

/** The side of `from` that faces its orthogonally-adjacent neighbour `to`. */
const dirBetween = (from: { x: number; y: number }, to: { x: number; y: number }): Side =>
  to.x > from.x ? E : to.x < from.x ? W : to.y > from.y ? S : N;

/** True if the ordered path bends at least once (i.e. is not a straight shot). */
export function pathHasTurn(path: Array<{ x: number; y: number }>): boolean {
  for (let i = 1; i < path.length - 1; i++) {
    const sameCol = path[i - 1].x === path[i].x && path[i].x === path[i + 1].x;
    const sameRow = path[i - 1].y === path[i].y && path[i].y === path[i + 1].y;
    if (!sameCol && !sameRow) return true;
  }
  return false;
}

/**
 * A wandering (never a straight shot), non-self-intersecting cell path from the
 * source to the target, walked one cell at a time. Uses a Z-bend when the target
 * is off both axes, or a perpendicular "bump" when it shares the source's row or
 * column — so the route always turns.
 */
function wanderingPath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  cols: number,
  rows: number,
): Array<{ x: number; y: number }> {
  const cells: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
  let x = sx;
  let y = sy;
  const walkTo = (nx: number, ny: number): void => {
    while (x !== nx) {
      x += Math.sign(nx - x);
      cells.push({ x, y });
    }
    while (y !== ny) {
      y += Math.sign(ny - y);
      cells.push({ x, y });
    }
  };
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  const dx = tx - sx;
  const dy = ty - sy;
  if (dx !== 0 && dy !== 0) {
    const midX = clamp(sx + Math.trunc(dx / 2), 1, cols - 2);
    walkTo(midX, sy); // horizontal run
    walkTo(midX, ty); // vertical run
    walkTo(tx, ty); // horizontal run into the target
  } else if (dx === 0) {
    const bx = clamp(sx + (sx < cols - 2 ? 2 : -2), 1, cols - 2);
    walkTo(bx, sy);
    walkTo(bx, ty);
    walkTo(tx, ty); // tx === sx
  } else {
    const by = clamp(sy + (sy < rows - 2 ? 2 : -2), 1, rows - 2);
    walkTo(sx, by);
    walkTo(tx, by);
    walkTo(tx, ty); // ty === sy
  }
  return cells;
}

/**
 * Carve the level-1 example route. Picks the drain closest to the source, lays a
 * *wandering* pre-solved trail of elbows and straights to it, then turns one of
 * its straight pieces into a TEE that continues the trail to the drain but leaves
 * its third opening FREE — a hint (not a solution): the player must extend that
 * spur to reach the rest of the drains. Mutates `tiles`; returns the reserved
 * trail cells + the hint (path, tee, target), or null if it can't lay a proper
 * (turning, tee-bearing) trail.
 */
export function carveLevel1Trail(
  tiles: Tile[],
  cols: number,
  rows: number,
  sx: number,
  sy: number,
  drains: Array<{ x: number; y: number }>,
): { reserved: Set<string>; hint: Level1Hint } | null {
  if (drains.length === 0) return null;

  // 2. The closest terminus is the target.
  let target = drains[0];
  let best = euclid(sx, sy, target.x, target.y);
  for (const d of drains) {
    const e = euclid(sx, sy, d.x, d.y);
    if (e < best) {
      best = e;
      target = d;
    }
  }

  // 3. Carve a wandering trail to it (must actually turn).
  const path = wanderingPath(sx, sy, target.x, target.y, cols, rows);
  if (path.length < 3 || !pathHasTurn(path)) return null;
  const reserved = new Set<string>(path.map((c) => `${c.x},${c.y}`));

  // Source opens toward the first step and is primed.
  const sdir = dirBetween(path[0], path[1]);
  const src = tiles[sy * cols + sx];
  src.kind = "start";
  src.rot = 0;
  src.dir = sdir;
  src.water = [false, false, false, false];
  src.water[sdir] = true;

  // Interior cells become straights/elbows connecting prev↔next.
  for (let i = 1; i < path.length - 1; i++) {
    const c = path[i];
    orientToConnect(
      tiles[c.y * cols + c.x],
      dirBetween(c, path[i - 1]),
      dirBetween(c, path[i + 1]),
    );
  }

  // Target terminus opens toward the incoming water.
  const last = path[path.length - 1];
  const beforeLast = path[path.length - 2];
  const tgt = tiles[last.y * cols + last.x];
  tgt.kind = "terminus";
  tgt.rot = 0;
  tgt.dir = dirBetween(last, beforeLast);
  tgt.water = [false, false, false, false];

  // 4. Turn one straight piece into a tee: keep the trail's two in-line openings,
  // add a third (spur) — pointed at the nearest OTHER drain as a hint — and leave
  // it free. Prefer a straight near the MIDDLE of the run so the split reads well.
  const straightIdxs: number[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    if (dirBetween(path[i], path[i - 1]) === OPP[dirBetween(path[i], path[i + 1])]) {
      straightIdxs.push(i);
    }
  }
  if (straightIdxs.length === 0) return null; // no straight to demo the split
  const mid = (path.length - 1) / 2;
  straightIdxs.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const teeCell = path[straightIdxs[0]];
  const toPrev = dirBetween(teeCell, path[straightIdxs[0] - 1]);
  const perp: Side[] = toPrev === N || toPrev === S ? [E, W] : [N, S];
  const other = drains.find((d) => d !== target);
  let spur = perp[0];
  if (other) {
    const d0 = euclid(teeCell.x + DX[perp[0]], teeCell.y + DY[perp[0]], other.x, other.y);
    const d1 = euclid(teeCell.x + DX[perp[1]], teeCell.y + DY[perp[1]], other.x, other.y);
    spur = d0 <= d1 ? perp[0] : perp[1];
  }
  const teeTile = tiles[teeCell.y * cols + teeCell.x];
  teeTile.kind = "tee";
  teeTile.dir = undefined;
  teeTile.rot = spur === perp[0] ? perp[1] : perp[0]; // missing side (== rot) is the non-spur perp
  teeTile.water = [false, false, false, false];

  return { reserved, hint: { path, tee: teeCell, target } };
}

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

  const wx = (x: number): number => ((x % cols) + cols) % cols;
  const wy = (y: number): number => ((y % rows) + rows) % rows;

  // Drains: random, ≥4 from any edge / the source / each other.
  let drains: Array<{ x: number; y: number }> = [];
  const target = drainCount(cols, rows, level);
  const minX = 4;
  const maxX = cols - 5;
  const minY = 4;
  const maxY = rows - 5;
  const placeDrain = (x: number, y: number): void => {
    drains.push({ x, y });
    tiles[y * cols + x] = {
      kind: "terminus",
      rot: 0,
      dir: Math.floor(rng() * 4) as Side,
      water: [false, false, false, false],
    };
  };
  if (maxX >= minX && maxY >= minY) {
    let attempts = 0;
    while (drains.length < target && attempts < target * 300) {
      attempts++;
      const x = minX + Math.floor(rng() * (maxX - minX + 1));
      const y = minY + Math.floor(rng() * (maxY - minY + 1));
      if (x === sx && y === sy) continue;
      if (euclid(x, y, sx, sy) < 4) continue;
      if (drains.some((d) => euclid(x, y, d.x, d.y) < 4)) continue;
      placeDrain(x, y);
    }
  }
  if (drains.length === 0) {
    // Board too small for the margins — fall back to a single spot opposite the
    // source so the level is still completable.
    const fx = Math.min(cols - 1, Math.max(0, cols - 1 - sx));
    const fy = Math.min(rows - 1, Math.max(0, rows - 1 - sy));
    if (fx !== sx || fy !== sy) placeDrain(fx, fy);
  }

  // Level 1: lay a wandering example route to the closest drain, ending in a tee
  // with a free spur (a hint, not a solution). Drop any *other* drain the trail
  // overran (its tile is now a pipe); the target stays a drain.
  let reserved = new Set<string>([`${sx},${sy}`]);
  let hint: Level1Hint | undefined;
  if (level === 1 && drains.length > 0) {
    const carved = carveLevel1Trail(tiles, cols, rows, sx, sy, drains);
    if (carved) {
      reserved = carved.reserved;
      hint = carved.hint;
      const targetKey = `${hint.target.x},${hint.target.y}`;
      drains = drains.filter((d) => {
        const k = `${d.x},${d.y}`;
        return k === targetKey || !reserved.has(k);
      });
    }
  }

  // Every source/drain's neighbour on its opening side is turned to connect back,
  // so a spout/drain is never sealed off at its own mouth. Skip the reserved
  // level-1 trail (already wired) and any dir-kind neighbour (another spout/drain).
  const orientAdjacent = (px: number, py: number, d: Side): void => {
    const nx = wx(px + DX[d]);
    const ny = wy(py + DY[d]);
    if (reserved.has(`${nx},${ny}`)) return;
    const t = tiles[ny * cols + nx];
    if (isDirKind(t.kind)) return;
    orientToOpen(t, OPP[d]);
  };
  orientAdjacent(sx, sy, start.dir ?? dir);
  for (const d of drains) {
    orientAdjacent(d.x, d.y, tiles[d.y * cols + d.x].dir ?? N);
  }

  return { cols, rows, tiles, start: { x: sx, y: sy }, drains, hint };
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
