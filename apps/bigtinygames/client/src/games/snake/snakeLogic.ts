// Pure game logic for Big Tiny Snake — now a multi-snake field. Kept
// framework-free so the movement, growth, collision, and spawning rules can be
// unit tested directly. The board size is supplied by the caller (the canvas
// fills the viewport), so dimensions live in the state, not as constants.

import { Vec } from '../input';

export const START_LENGTH = 6;
export const POINTS_PER_APPLE = 10;

export interface GameState {
  cols: number;
  rows: number;
  /** Every snake on the field, head-first. All share one heading (see step). */
  snakes: Vec[][];
  /** Food cells; one is added every few seconds and removed when eaten. */
  foods: Vec[];
  score: number;
  over: boolean;
}

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const ck = (x: number, y: number) => y * 1_000_003 + x; // cell key (cols ≪ 1e6)
const inBounds = (c: Vec, cols: number, rows: number) =>
  c.x >= 0 && c.y >= 0 && c.x < cols && c.y < rows;

/** A straight snake of `length` with its head at (hx,hy), trailing behind dir. */
function makeSnake(hx: number, hy: number, dir: Vec, length = START_LENGTH): Vec[] {
  return Array.from({ length }, (_, i) => ({
    x: hx - dir.x * i,
    y: hy - dir.y * i,
  }));
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
    score: 0,
    over: false,
  };
}

/** Add one food at a random free cell (called on a timer). */
export function addFood(state: GameState, rng: () => number = Math.random): GameState {
  if (state.over) return state;
  const blocked = occupied(state.snakes);
  for (const f of state.foods) blocked.add(ck(f.x, f.y));
  const cell = randomFreeCell(state.cols, state.rows, blocked, rng);
  return cell ? { ...state, foods: [...state.foods, cell] } : state;
}

/**
 * Advance every snake one tick in the shared direction `dir`. Inputs are never
 * mutated. Rules:
 * - A snake dies hitting a wall or its own body.
 * - When two snakes collide (a head enters another's body, or two heads meet),
 *   BOTH die.
 * - Eating a food grows that snake, scores POINTS_PER_APPLE × (snakes alive),
 *   and spawns a fresh snake at a random free cell.
 * - When the last snake dies the game is over.
 */
export function step(state: GameState, dir: Vec, rng: () => number = Math.random): GameState {
  if (state.over) return state;
  const { cols, rows, snakes, foods } = state;
  const n = snakes.length;

  const newHeads = snakes.map((s) => add(s[0], dir));
  const bodySets = snakes.map((s) => new Set(s.map((c) => ck(c.x, c.y))));
  const dead = new Array<boolean>(n).fill(false);

  // Walls + self (own full body, classic).
  for (let i = 0; i < n; i++) {
    const h = newHeads[i];
    if (!inBounds(h, cols, rows) || bodySets[i].has(ck(h.x, h.y))) dead[i] = true;
  }
  // Snake-vs-snake: head into another's body, or two heads onto the same cell.
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

  const foodSet = new Set(foods.map((f) => ck(f.x, f.y)));

  // Which survivors land on a food this tick (heads are distinct, so each food
  // goes to at most one snake).
  const eatenFood = new Set<number>();
  const eaters = new Set<number>();
  for (const i of survivors) {
    const h = newHeads[i];
    const k = ck(h.x, h.y);
    if (foodSet.has(k)) {
      eatenFood.add(k);
      eaters.add(i);
    }
  }
  // Any food eaten this tick lengthens EVERY surviving snake (they keep their
  // tail instead of trimming it).
  const grewThisTick = eaters.size > 0;

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

  // One fresh snake per food eaten, each the length of the snake that ate it.
  if (spawnLengths.length > 0) {
    const blocked = occupied(resultSnakes);
    for (const f of newFoods) blocked.add(ck(f.x, f.y));
    for (const length of spawnLengths) {
      const ns = trySpawnSnake(cols, rows, dir, blocked, rng, length);
      if (!ns) continue; // couldn't fit this one; try the rest
      resultSnakes.push(ns);
      for (const c of ns) blocked.add(ck(c.x, c.y));
    }
  }

  return {
    cols,
    rows,
    snakes: resultSnakes,
    foods: newFoods,
    score,
    over: resultSnakes.length === 0,
  };
}
