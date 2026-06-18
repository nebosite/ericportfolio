// Pure game logic for Big Tiny Snake — a multi-snake field with dying corpses,
// rocks, and food blobs. Kept framework-free so the movement, growth, collision,
// and spawning rules can be unit tested directly. The board size is supplied by
// the caller (the canvas fills the viewport), so dimensions live in the state.

import { Vec } from '../input';

export const START_LENGTH = 6;
export const POINTS_PER_APPLE = 10;
export const TICK_MS = 70; // game tick (also the corpse-fade frame rate)

// A dying segment fades white→black over ~2 seconds, then disappears.
export const CORPSE_LIFE = Math.max(1, Math.round(2000 / TICK_MS));
const ROCK_CHANCE = 0.03; // each dying segment leaves a permanent deadly rock
const BLOB_CHANCE = 0.2; // a food drop sometimes lands as a 3x3 blob

/** A fading, deadly remnant of a dead snake segment. */
export interface Corpse {
  x: number;
  y: number;
  life: number; // remaining ticks; CORPSE_LIFE (white) → 0 (gone)
}

export interface GameState {
  cols: number;
  rows: number;
  /** Every snake on the field, head-first. All share one heading (see step). */
  snakes: Vec[][];
  foods: Vec[];
  corpses: Corpse[];
  /** Permanent deadly cells left behind by some dying segments. */
  rocks: Vec[];
  score: number;
  over: boolean;
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const ck = (x: number, y: number) => y * 1_000_003 + x; // cell key (cols ≪ 1e6)
const inBounds = (c: Vec, cols: number, rows: number) =>
  c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows;

/** A straight snake of `length` with its head at (hx,hy), trailing behind dir. */
function makeSnake(hx: number, hy: number, dir: Vec, length = START_LENGTH): Vec[] {
  return Array.from({ length }, (_, i) => ({ x: hx - dir.x * i, y: hy - dir.y * i }));
}

function occupied(snakes: Vec[][]): Set<number> {
  const set = new Set<number>();
  for (const snake of snakes) for (const c of snake) set.add(ck(c.x, c.y));
  return set;
}

/** A random cell not in `blocked`, or null if none found after many tries. */
function randomFreeCell(
  cols: number,
  rows: number,
  blocked: Set<number>,
  rng: () => number,
): Vec | null {
  for (let tries = 0; tries < 300; tries++) {
    const x = Math.floor(rng() * cols);
    const y = Math.floor(rng() * rows);
    if (!blocked.has(ck(x, y))) return { x, y };
  }
  return null;
}

/** Place a fresh snake of `length` whose whole body is in-bounds and free. */
function trySpawnSnake(
  cols: number,
  rows: number,
  dir: Vec,
  blocked: Set<number>,
  rng: () => number,
  length: number,
): Vec[] | null {
  for (let tries = 0; tries < 80; tries++) {
    const hx = Math.floor(rng() * cols);
    const hy = Math.floor(rng() * rows);
    const snake = makeSnake(hx, hy, dir, length);
    if (snake.every((c) => inBounds(c, cols, rows) && !blocked.has(ck(c.x, c.y)))) {
      return snake;
    }
  }
  return null;
}

/** A new game: one snake in the center heading right, plus a single food. */
export function initialState(cols: number, rows: number, rng: () => number = Math.random): GameState {
  const snake = makeSnake(Math.floor(cols / 2), Math.floor(rows / 2), { x: 1, y: 0 });
  const food = randomFreeCell(cols, rows, occupied([snake]), rng);
  return {
    cols,
    rows,
    snakes: [snake],
    foods: food ? [food] : [],
    corpses: [],
    rocks: [],
    score: 0,
    over: false,
  };
}

/** Cells nothing new should land on: snakes, foods, corpses, rocks. */
function blockedCells(state: GameState): Set<number> {
  const blocked = occupied(state.snakes);
  for (const f of state.foods) blocked.add(ck(f.x, f.y));
  for (const c of state.corpses) blocked.add(ck(c.x, c.y));
  for (const r of state.rocks) blocked.add(ck(r.x, r.y));
  return blocked;
}

/**
 * Add a food drop. 20% of the time it lands as a 3x3 blob (the center cell plus
 * whatever neighbors are free); otherwise a single food. Called on a timer.
 */
export function addFood(state: GameState, rng: () => number = Math.random): GameState {
  if (state.over) return state;
  const blocked = blockedCells(state);
  const cell = randomFreeCell(state.cols, state.rows, blocked, rng);
  if (!cell) return state;

  const drop: Vec[] = [cell];
  if (rng() < BLOB_CHANCE) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) continue;
        if (blocked.has(ck(x, y))) continue;
        drop.push({ x, y });
      }
    }
  }
  return { ...state, foods: [...state.foods, ...drop] };
}

/**
 * Advance every snake one tick in the shared direction `dir`. Inputs are never
 * mutated. Rules:
 * - A snake dies hitting a wall, its own body, a rock, or a (still-fading)
 *   corpse. When two snakes collide, BOTH die.
 * - A dead snake's segments become corpses (deadly while they fade over ~2s);
 *   each segment has a 10% chance to also leave a permanent deadly rock.
 * - Eating a food grows that snake, scores POINTS_PER_APPLE × (snakes alive),
 *   lengthens EVERY surviving snake, and spawns a fresh snake the same length as
 *   the one that ate.
 * - When the last snake dies the game is over.
 */
export function step(state: GameState, dir: Vec, rng: () => number = Math.random): GameState {
  if (state.over) return state;
  const { cols, rows, snakes, foods, corpses, rocks } = state;
  const n = snakes.length;

  const newHeads = snakes.map((s) => add(s[0], dir));
  const bodySets = snakes.map((s) => new Set(s.map((c) => ck(c.x, c.y))));

  // Static deadly cells: rocks + currently-fading corpses.
  const deadly = new Set<number>();
  for (const r of rocks) deadly.add(ck(r.x, r.y));
  for (const c of corpses) deadly.add(ck(c.x, c.y));

  const dead = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const h = newHeads[i];
    if (!inBounds(h, cols, rows) || bodySets[i].has(ck(h.x, h.y)) || deadly.has(ck(h.x, h.y))) {
      dead[i] = true;
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const hi = newHeads[i];
      const hj = newHeads[j];
      if (
        bodySets[j].has(ck(hi.x, hi.y)) ||
        bodySets[i].has(ck(hj.x, hj.y)) ||
        (hi.x === hj.x && hi.y === hj.y)
      ) {
        dead[i] = true;
        dead[j] = true;
      }
    }
  }

  const survivors: number[] = [];
  for (let i = 0; i < n; i++) if (!dead[i]) survivors.push(i);
  const aliveCount = survivors.length;

  // Eating: which survivors land on a food (heads are distinct).
  const foodSet = new Set(foods.map((f) => ck(f.x, f.y)));
  const eatenFood = new Set<number>();
  const eaters = new Set<number>();
  for (const i of survivors) {
    const k = ck(newHeads[i].x, newHeads[i].y);
    if (foodSet.has(k)) {
      eatenFood.add(k);
      eaters.add(i);
    }
  }
  const grewThisTick = eaters.size > 0; // any bite lengthens every snake

  const resultSnakes: Vec[][] = [];
  const spawnLengths: number[] = [];
  let score = state.score;
  for (const i of survivors) {
    const grown = [newHeads[i], ...snakes[i]];
    if (!grewThisTick) grown.pop();
    resultSnakes.push(grown);
    if (eaters.has(i)) {
      score += POINTS_PER_APPLE * aliveCount;
      spawnLengths.push(grown.length); // a child matches the parent that ate
    }
  }

  const newFoods = foods.filter((f) => !eatenFood.has(ck(f.x, f.y)));

  // Age existing corpses (fade); drop the fully-faded ones.
  const newCorpses: Corpse[] = [];
  for (const c of corpses) if (c.life > 1) newCorpses.push({ x: c.x, y: c.y, life: c.life - 1 });

  // Turn dead snakes' segments into fresh corpses; 10% also leave a rock.
  const newRocks = rocks.slice();
  for (let i = 0; i < n; i++) {
    if (!dead[i]) continue;
    for (const seg of snakes[i]) {
      newCorpses.push({ x: seg.x, y: seg.y, life: CORPSE_LIFE });
      if (rng() < ROCK_CHANCE) newRocks.push({ x: seg.x, y: seg.y });
    }
  }

  // One fresh snake per food eaten, each the length of the snake that ate it,
  // placed clear of everything (snakes, foods, corpses, rocks).
  if (spawnLengths.length > 0) {
    const blocked = occupied(resultSnakes);
    for (const f of newFoods) blocked.add(ck(f.x, f.y));
    for (const c of newCorpses) blocked.add(ck(c.x, c.y));
    for (const r of newRocks) blocked.add(ck(r.x, r.y));
    for (const length of spawnLengths) {
      const ns = trySpawnSnake(cols, rows, dir, blocked, rng, length);
      if (!ns) continue;
      resultSnakes.push(ns);
      for (const c of ns) blocked.add(ck(c.x, c.y));
    }
  }

  return {
    cols,
    rows,
    snakes: resultSnakes,
    foods: newFoods,
    corpses: newCorpses,
    rocks: newRocks,
    score,
    over: resultSnakes.length === 0,
  };
}
