// Pure game logic for Big Tiny Snake — a multi-snake field with dying corpses,
// rocks, food blobs, and the Ghost powerup. Kept framework-free so the movement,
// growth, collision, spawning, and ghost rules can be unit tested directly. The
// board size is supplied by the caller (the canvas fills the viewport), so
// dimensions live in the state.

import { Vec } from '../input';

export const START_LENGTH = 6;
export const POINTS_PER_APPLE = 10;
export const TICK_MS = 70; // game tick (also the corpse-fade frame rate)

// A dying segment fades white→black over ~2 seconds, then disappears.
export const CORPSE_LIFE = Math.max(1, Math.round(2000 / TICK_MS));
const ROCK_CHANCE = 0.03; // each dying segment leaves a permanent deadly rock
const BLOB_CHANCE = 0.2; // a food drop sometimes lands as a 3x3 blob

// Ghost powerup: grabbing it bursts GHOST_COUNT ghost snakes outward in a full
// circle, each GHOST_LEN long and flying at GHOST_SPEED cells/tick (3× a snake).
export const GHOST_COUNT = 20;
export const GHOST_LEN = 10;
const GHOST_SPEED = 3;
const GHOST_SUBSTEP = 0.5; // fine sub-steps so fast ghosts don't skip cells

// The snake that grabs the powerup gets a 10s "ghost rush": immune to ghosts,
// and rocks count as food. It turns blue, and flashes for the final 2 seconds.
export const GHOST_RUSH_LIFE = Math.round(10000 / TICK_MS);
export const GHOST_RUSH_FLASH = Math.round(2000 / TICK_MS);

/** A fading, deadly remnant of a dead snake segment. */
export interface Corpse {
  x: number;
  y: number;
  life: number; // remaining ticks; CORPSE_LIFE (white) → 0 (gone)
}

/**
 * A free-flying ghost snake. It moves off-grid at any angle; `trail` is the last
 * GHOST_LEN integer cells it occupied, head-first (trail[0] = brightest).
 */
export interface Ghost {
  hx: number; // head position (float)
  hy: number;
  dx: number; // unit heading
  dy: number;
  trail: Vec[];
}

export interface GameState {
  cols: number;
  rows: number;
  /** Every player snake on the field, head-first. All share one heading (step). */
  snakes: Vec[][];
  foods: Vec[];
  corpses: Corpse[];
  /** Permanent deadly cells left behind by some dying segments. */
  rocks: Vec[];
  /** Free-flying ghost snakes spawned by the Ghost powerup. */
  ghosts: Ghost[];
  /** The single Ghost powerup currently on the field, if any. */
  ghostPowerup: Vec | null;
  /** Ghost-rush ticks remaining per snake, parallel to `snakes` (0 = none). */
  buffs: number[];
  /** Pending grow-in segments per snake (a new snake ramps from length 1). */
  grow: number[];
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

/**
 * Find a head cell from which a snake can grow forward along `dir` for `length`
 * cells without hitting a wall or a blocked cell. New snakes start one segment
 * long and ramp up to `length`, emerging head-first from this cell.
 */
function trySpawnHead(
  cols: number,
  rows: number,
  dir: Vec,
  blocked: Set<number>,
  rng: () => number,
  length: number,
): Vec | null {
  for (let tries = 0; tries < 80; tries++) {
    const hx = Math.floor(rng() * cols);
    const hy = Math.floor(rng() * rows);
    let clear = true;
    for (let i = 0; i < length; i++) {
      const x = hx + dir.x * i;
      const y = hy + dir.y * i;
      if (!inBounds({ x, y }, cols, rows) || blocked.has(ck(x, y))) {
        clear = false;
        break;
      }
    }
    if (clear) return { x: hx, y: hy };
  }
  return null;
}

/** 20 ghosts bursting outward from (cx,cy), evenly spaced around a full circle. */
function makeBlast(cx: number, cy: number): Ghost[] {
  const ghosts: Ghost[] = [];
  for (let k = 0; k < GHOST_COUNT; k++) {
    const angle = (2 * Math.PI * k) / GHOST_COUNT;
    ghosts.push({ hx: cx, hy: cy, dx: Math.cos(angle), dy: Math.sin(angle), trail: [{ x: cx, y: cy }] });
  }
  return ghosts;
}

/** A player snake that touched a ghost becomes a ghost flying along `dir`. */
function snakeToGhost(snake: Vec[], dir: Vec): Ghost {
  return {
    hx: snake[0].x,
    hy: snake[0].y,
    dx: dir.x,
    dy: dir.y,
    trail: snake.slice(0, GHOST_LEN).map((c) => ({ x: c.x, y: c.y })),
  };
}

/**
 * Move a ghost one tick along its heading. Returns null once its whole trail has
 * wandered off the board (the last of the tail is gone).
 */
export function advanceGhost(g: Ghost, cols: number, rows: number): Ghost | null {
  let hx = g.hx;
  let hy = g.hy;
  const trail = g.trail.slice();
  const substeps = Math.ceil(GHOST_SPEED / GHOST_SUBSTEP);
  for (let s = 0; s < substeps; s++) {
    hx += g.dx * GHOST_SUBSTEP;
    hy += g.dy * GHOST_SUBSTEP;
    const cx = Math.round(hx);
    const cy = Math.round(hy);
    if (trail.length === 0 || trail[0].x !== cx || trail[0].y !== cy) {
      trail.unshift({ x: cx, y: cy });
    }
  }
  while (trail.length > GHOST_LEN) trail.pop();
  if (!trail.some((c) => inBounds(c, cols, rows))) return null;
  return { hx, hy, dx: g.dx, dy: g.dy, trail };
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
    ghosts: [],
    ghostPowerup: null,
    buffs: [0],
    grow: [0],
    score: 0,
    over: false,
  };
}

/** Cells nothing new should land on: snakes, foods, corpses, rocks, powerup. */
function blockedCells(state: GameState): Set<number> {
  const blocked = occupied(state.snakes);
  for (const f of state.foods) blocked.add(ck(f.x, f.y));
  for (const c of state.corpses) blocked.add(ck(c.x, c.y));
  for (const r of state.rocks) blocked.add(ck(r.x, r.y));
  if (state.ghostPowerup) blocked.add(ck(state.ghostPowerup.x, state.ghostPowerup.y));
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

/** Place the (single) Ghost powerup on a free cell if there isn't one already. */
export function addGhostPowerup(state: GameState, rng: () => number = Math.random): GameState {
  if (state.over || state.ghostPowerup) return state;
  const cell = randomFreeCell(state.cols, state.rows, blockedCells(state), rng);
  if (!cell) return state;
  return { ...state, ghostPowerup: cell };
}

/**
 * Advance every snake one tick in the shared direction `dir`. Inputs are never
 * mutated. Rules:
 * - A snake dies hitting a wall, its own body, a rock, or a (still-fading)
 *   corpse. When two snakes collide, BOTH die.
 * - A dead snake's segments become corpses (deadly while they fade over ~2s);
 *   each segment has a 3% chance to also leave a permanent deadly rock.
 * - Eating a food grows that snake, scores POINTS_PER_APPLE × (snakes alive),
 *   lengthens EVERY surviving snake, and spawns a fresh snake the same length as
 *   the one that ate.
 * - Grabbing the Ghost powerup bursts 20 ghost snakes outward in a full circle
 *   and gives that snake a 10s ghost-rush: it is immune to ghosts and rocks
 *   count as food for it.
 * - Ghosts fly straight at 3× speed: where one crosses a snake's BODY it clips
 *   it (the back half dies, the shorter front half lives); a snake whose HEAD
 *   touches a ghost is itself turned into a ghost (lost to the player). A
 *   ghost-rushing snake ignores ghosts entirely.
 * - When the last player snake is gone the game is over.
 */
export function step(state: GameState, dir: Vec, rng: () => number = Math.random): GameState {
  if (state.over) return state;
  const { cols, rows, snakes, foods, corpses, rocks, ghosts } = state;
  const n = snakes.length;
  const buffOf = (i: number) => state.buffs[i] ?? 0;
  const growOf = (i: number) => state.grow[i] ?? 0;

  const newHeads = snakes.map((s) => add(s[0], dir));
  const bodySets = snakes.map((s) => new Set(s.map((c) => ck(c.x, c.y))));

  // Corpses kill everyone; rocks kill only snakes that aren't ghost-rushing
  // (for a rushing snake a rock is food, handled below).
  const corpseSet = new Set<number>();
  for (const c of corpses) corpseSet.add(ck(c.x, c.y));
  const rockSet = new Set<number>();
  for (const r of rocks) rockSet.add(ck(r.x, r.y));

  const dead = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const h = newHeads[i];
    const k = ck(h.x, h.y);
    if (
      !inBounds(h, cols, rows) ||
      bodySets[i].has(k) ||
      corpseSet.has(k) ||
      (rockSet.has(k) && buffOf(i) === 0)
    ) {
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

  // Eating: a survivor eats a food, or — while ghost-rushing — a rock.
  const foodSet = new Set(foods.map((f) => ck(f.x, f.y)));
  const eatenFood = new Set<number>();
  const eatenRock = new Set<number>();
  const eaters = new Set<number>();
  for (const i of survivors) {
    const k = ck(newHeads[i].x, newHeads[i].y);
    if (foodSet.has(k)) {
      eatenFood.add(k);
      eaters.add(i);
    } else if (buffOf(i) > 0 && rockSet.has(k)) {
      eatenRock.add(k); // rocks count as food during a ghost rush
      eaters.add(i);
    }
  }
  const grewThisTick = eaters.size > 0; // any bite lengthens every snake

  const movedSnakes: Vec[][] = [];
  const movedBuffs: number[] = [];
  const movedGrow: number[] = [];
  const spawnLengths: number[] = [];
  let score = state.score;
  for (const i of survivors) {
    const growing = growOf(i) > 0; // a freshly spawned snake still ramping up
    const grown = [newHeads[i], ...snakes[i]];
    if (!grewThisTick && !growing) grown.pop(); // growing snakes keep their tail
    movedSnakes.push(grown);
    movedBuffs.push(buffOf(i));
    movedGrow.push(growing ? growOf(i) - 1 : 0);
    if (eaters.has(i)) {
      score += POINTS_PER_APPLE * aliveCount;
      spawnLengths.push(grown.length); // a child ramps up to the parent's length
    }
  }

  const newFoods = foods.filter((f) => !eatenFood.has(ck(f.x, f.y)));

  // Age existing corpses (fade); drop the fully-faded ones.
  const newCorpses: Corpse[] = [];
  for (const c of corpses) if (c.life > 1) newCorpses.push({ x: c.x, y: c.y, life: c.life - 1 });

  // Rocks eaten by rushing snakes are gone; dead snakes leave new ones (~3%).
  const newRocks = rocks.filter((r) => !eatenRock.has(ck(r.x, r.y)));
  for (let i = 0; i < n; i++) {
    if (!dead[i]) continue;
    for (const seg of snakes[i]) {
      newCorpses.push({ x: seg.x, y: seg.y, life: CORPSE_LIFE });
      if (rng() < ROCK_CHANCE) newRocks.push({ x: seg.x, y: seg.y });
    }
  }

  // One fresh snake per food eaten, each the length of the snake that ate it,
  // placed clear of everything (snakes, foods, corpses, rocks, ghosts).
  if (spawnLengths.length > 0) {
    const blocked = occupied(movedSnakes);
    for (const f of newFoods) blocked.add(ck(f.x, f.y));
    for (const c of newCorpses) blocked.add(ck(c.x, c.y));
    for (const r of newRocks) blocked.add(ck(r.x, r.y));
    for (const g of ghosts) for (const c of g.trail) blocked.add(ck(c.x, c.y));
    for (const length of spawnLengths) {
      const head = trySpawnHead(cols, rows, dir, blocked, rng, length);
      if (!head) continue;
      movedSnakes.push([{ x: head.x, y: head.y }]); // start one segment long
      movedBuffs.push(0); // spawned children start unbuffed
      movedGrow.push(length - 1); // and ramp up to full length
      for (let i = 0; i < length; i++) blocked.add(ck(head.x + dir.x * i, head.y + dir.y * i));
    }
  }

  // Ghost powerup pickup → burst, and the grabbing snake starts its ghost rush.
  let ghostPowerup = state.ghostPowerup;
  let blastGhosts: Ghost[] = [];
  if (ghostPowerup) {
    const pk = ck(ghostPowerup.x, ghostPowerup.y);
    const grabber = movedSnakes.findIndex((sn) => ck(sn[0].x, sn[0].y) === pk);
    if (grabber !== -1) {
      blastGhosts = makeBlast(ghostPowerup.x, ghostPowerup.y);
      ghostPowerup = null;
      movedBuffs[grabber] = GHOST_RUSH_LIFE;
    }
  }

  // Advance existing ghosts; drop the ones fully off-screen.
  const advancedGhosts: Ghost[] = [];
  for (const g of ghosts) {
    const moved = advanceGhost(g, cols, rows);
    if (moved) advancedGhosts.push(moved);
  }

  // Ghost ↔ snake interactions, using this tick's advanced ghost cells.
  const ghostCells = new Set<number>();
  for (const g of advancedGhosts) {
    for (const c of g.trail) if (inBounds(c, cols, rows)) ghostCells.add(ck(c.x, c.y));
  }
  const finalSnakes: Vec[][] = [];
  const finalBuffs: number[] = [];
  const finalGrow: number[] = [];
  const convertedGhosts: Ghost[] = [];
  for (let s = 0; s < movedSnakes.length; s++) {
    const snake = movedSnakes[s];
    const buff = movedBuffs[s];
    const grow = movedGrow[s];
    if (buff > 0) {
      finalSnakes.push(snake); // ghost-rushing: immune to ghosts
      finalBuffs.push(buff - 1);
      finalGrow.push(grow);
      continue;
    }
    if (ghostCells.has(ck(snake[0].x, snake[0].y))) {
      convertedGhosts.push(snakeToGhost(snake, dir)); // head touched a ghost → becomes one
      continue;
    }
    let clipAt = -1;
    for (let i = 1; i < snake.length; i++) {
      if (ghostCells.has(ck(snake[i].x, snake[i].y))) {
        clipAt = i; // clip at the cut nearest the head: back half dies
        break;
      }
    }
    finalSnakes.push(clipAt === -1 ? snake : snake.slice(0, clipAt));
    finalBuffs.push(0);
    finalGrow.push(grow);
  }

  return {
    cols,
    rows,
    snakes: finalSnakes,
    foods: newFoods,
    corpses: newCorpses,
    rocks: newRocks,
    ghosts: [...advancedGhosts, ...convertedGhosts, ...blastGhosts],
    ghostPowerup,
    buffs: finalBuffs,
    grow: finalGrow,
    score,
    over: finalSnakes.length === 0,
  };
}
