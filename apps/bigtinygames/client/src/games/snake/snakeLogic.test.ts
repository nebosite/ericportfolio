import { describe, it, expect } from 'vitest';
import {
  START_LENGTH,
  POINTS_PER_APPLE,
  CORPSE_LIFE,
  GHOST_COUNT,
  GHOST_LEN,
  GHOST_RUSH_LIFE,
  initialState,
  addFood,
  addGhostPowerup,
  advanceGhost,
  step,
  type GameState,
  type Ghost,
} from './snakeLogic';
import type { Vec } from '../input';

const RIGHT: Vec = { x: 1, y: 0 };
const UP: Vec = { x: 0, y: -1 };

// A deterministic rng that walks through a fixed sequence (repeats the last).
const seqRng = (seq: number[]) => {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
};

function gs(partial: Partial<GameState>): GameState {
  const snakes = partial.snakes ?? [];
  return {
    cols: 20,
    rows: 20,
    foods: [],
    corpses: [],
    rocks: [],
    ghosts: [],
    ghostPowerup: null,
    score: 0,
    over: false,
    ...partial,
    snakes,
    buffs: partial.buffs ?? snakes.map(() => 0),
    grow: partial.grow ?? snakes.map(() => 0),
  };
}

// A ghost whose trail is exactly the listed cells (head-first), parked in place.
const ghostAt = (cells: Vec[]): Ghost => ({ hx: cells[0].x, hy: cells[0].y, dx: 1, dy: 0, trail: cells });

describe('initialState', () => {
  it('starts with one centered snake and a single food', () => {
    const s = initialState(20, 20, () => 0);
    expect(s.snakes).toHaveLength(1);
    expect(s.snakes[0]).toHaveLength(START_LENGTH);
    expect(s.snakes[0][0]).toEqual({ x: 10, y: 10 });
    expect(s.foods).toHaveLength(1);
    expect(s.over).toBe(false);
    expect(s.cols).toBe(20);
    expect(s.rows).toBe(20);
  });
});

describe('addFood', () => {
  it('adds a single food on a free cell', () => {
    const s = gs({ snakes: [[{ x: 5, y: 5 }]] });
    // cell (0,0) via rng 0,0; blob-check 0.9 (≥ 0.2 → no blob)
    const r = addFood(s, seqRng([0, 0, 0.9]));
    expect(r.foods).toHaveLength(1);
    expect(r.foods[0]).toEqual({ x: 0, y: 0 });
  });

  it('drops a 3x3 blob of food ~20% of the time', () => {
    const s = gs({ snakes: [[{ x: 0, y: 0 }]], cols: 20, rows: 20 });
    // cell (10,10) via rng 0.5,0.5; blob-check 0.1 (< 0.2 → blob)
    const r = addFood(s, seqRng([0.5, 0.5, 0.1]));
    expect(r.foods).toHaveLength(9); // a full 3x3, all in-bounds and free
  });

  it('does nothing once the game is over', () => {
    const s = gs({ over: true });
    expect(addFood(s)).toBe(s);
  });
});

describe('step', () => {
  it('moves a snake forward without growing when there is no food', () => {
    const snake: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ];
    const r = step(gs({ snakes: [snake] }), RIGHT);
    expect(r.snakes[0][0]).toEqual({ x: 6, y: 5 });
    expect(r.snakes[0]).toHaveLength(3);
    expect(r.over).toBe(false);
  });

  it('does not mutate the input state', () => {
    const s = gs({
      snakes: [
        [
          { x: 5, y: 5 },
          { x: 4, y: 5 },
        ],
      ],
      foods: [{ x: 9, y: 9 }],
    });
    const copy = JSON.parse(JSON.stringify(s));
    step(s, RIGHT);
    expect(s).toEqual(copy);
  });

  it('grows, scores, and spawns a new snake on eating', () => {
    const snake: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ];
    const s = gs({ snakes: [snake], foods: [{ x: 6, y: 5 }] });
    const r = step(s, RIGHT, () => 0.5);
    expect(r.snakes.length).toBe(2); // the grown snake + one freshly spawned
    const grown = r.snakes.find((sn) => sn[0].x === 6 && sn[0].y === 5)!;
    expect(grown).toHaveLength(3);
    expect(r.foods).toHaveLength(0); // food consumed
    expect(r.score).toBe(POINTS_PER_APPLE * 1); // one snake alive when eaten
  });

  it('lengthens every snake when any one eats', () => {
    const eater: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ];
    const other: Vec[] = [
      { x: 5, y: 15 },
      { x: 4, y: 15 },
      { x: 3, y: 15 },
    ];
    const s = gs({ snakes: [eater, other], foods: [{ x: 6, y: 5 }], cols: 40, rows: 40 });
    const r = step(s, RIGHT, () => 0.5);
    const otherAfter = r.snakes.find((sn) => sn[0].x === 6 && sn[0].y === 15)!;
    expect(otherAfter).toHaveLength(4); // grew from 3, even though it didn't eat
  });

  it('spawns a child that ramps up to the parent length', () => {
    const eater: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ]; // length 3 → grows to 4 this tick
    const s = gs({ snakes: [eater], foods: [{ x: 6, y: 5 }], cols: 40, rows: 40 });
    const r = step(s, RIGHT, () => 0.5);
    expect(r.snakes).toHaveLength(2);
    const child = r.snakes.findIndex((sn) => sn.length === 1); // starts one segment long
    expect(child).toBeGreaterThanOrEqual(0);
    expect(r.grow[child]).toBe(3); // pending grow to the parent's length of 4
  });

  it('multiplies food points by the number of snakes alive', () => {
    const a: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ];
    const b: Vec[] = [
      { x: 5, y: 10 },
      { x: 4, y: 10 },
    ];
    const c: Vec[] = [
      { x: 5, y: 15 },
      { x: 4, y: 15 },
    ];
    const s = gs({ snakes: [a, b, c], foods: [{ x: 6, y: 5 }], cols: 40, rows: 40 });
    const r = step(s, RIGHT, () => 0.5);
    expect(r.score).toBe(POINTS_PER_APPLE * 3);
  });

  it('ends the game when the last snake hits a wall', () => {
    const s = gs({ snakes: [[{ x: 19, y: 5 }]], cols: 20, rows: 20 });
    const r = step(s, RIGHT); // head → x=20 (out of bounds)
    expect(r.snakes).toHaveLength(0);
    expect(r.over).toBe(true);
  });

  it('kills a snake that runs into its own body', () => {
    const snake: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 4 },
      { x: 5, y: 4 },
    ];
    const r = step(gs({ snakes: [snake] }), UP); // head (5,5) → (5,4), an own cell
    expect(r.over).toBe(true);
  });

  it('kills both snakes when two collide, leaving other snakes alive', () => {
    const a: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
    ]; // → (6,5)
    const b: Vec[] = [
      { x: 6, y: 5 },
      { x: 6, y: 6 },
    ]; // occupies (6,5)
    const clear: Vec[] = [
      { x: 1, y: 15 },
      { x: 0, y: 15 },
    ]; // → (2,15), safe
    const s = gs({ snakes: [a, b, clear], foods: [], cols: 40, rows: 40 });
    const r = step(s, RIGHT);
    expect(r.snakes).toHaveLength(1);
    expect(r.snakes[0][0]).toEqual({ x: 2, y: 15 });
    expect(r.over).toBe(false);
  });

  it('is over only once every snake is dead', () => {
    const s = gs({
      snakes: [[{ x: 19, y: 5 }], [{ x: 19, y: 10 }]],
      cols: 20,
      rows: 20,
    });
    const r = step(s, RIGHT); // both hit the right wall
    expect(r.over).toBe(true);
  });
});

describe('corpses & rocks', () => {
  it('turns a dead snake into fresh fading corpses', () => {
    const snake: Vec[] = [
      { x: 19, y: 5 },
      { x: 18, y: 5 },
    ];
    const r = step(gs({ snakes: [snake] }), RIGHT, () => 1); // wall death, rng=1 → no rocks
    expect(r.over).toBe(true);
    expect(r.corpses).toHaveLength(2);
    expect(r.corpses.every((c) => c.life === CORPSE_LIFE)).toBe(true);
    expect(r.rocks).toHaveLength(0);
  });

  it('leaves a deadly rock for dying segments ~3% of the time', () => {
    const snake: Vec[] = [
      { x: 19, y: 5 },
      { x: 18, y: 5 },
      { x: 17, y: 5 },
    ];
    const r = step(gs({ snakes: [snake] }), RIGHT, () => 0); // rng=0 < 0.03 → every segment rocks
    expect(r.rocks).toHaveLength(3);
  });

  it('ages corpses each tick and drops the fully-faded ones', () => {
    const live = gs({ snakes: [[{ x: 5, y: 5 }, { x: 4, y: 5 }]], corpses: [{ x: 0, y: 0, life: 5 }] });
    expect(step(live, RIGHT, () => 1).corpses.find((c) => c.x === 0)?.life).toBe(4);

    const dyingOut = gs({
      snakes: [[{ x: 5, y: 5 }, { x: 4, y: 5 }]],
      corpses: [{ x: 0, y: 0, life: 1 }],
    });
    expect(step(dyingOut, RIGHT, () => 1).corpses.find((c) => c.x === 0)).toBeUndefined();
  });

  it('kills a snake that runs into a corpse', () => {
    const s = gs({
      snakes: [[{ x: 5, y: 5 }, { x: 4, y: 5 }]],
      corpses: [{ x: 6, y: 5, life: CORPSE_LIFE }],
    });
    expect(step(s, RIGHT, () => 1).over).toBe(true);
  });

  it('kills a snake that runs into a rock', () => {
    const s = gs({ snakes: [[{ x: 5, y: 5 }, { x: 4, y: 5 }]], rocks: [{ x: 6, y: 5 }] });
    expect(step(s, RIGHT).over).toBe(true);
  });
});

describe('ghost powerup', () => {
  it('places a single powerup, and is a no-op once one exists', () => {
    const placed = addGhostPowerup(gs({ snakes: [[{ x: 5, y: 5 }]] }), seqRng([0, 0]));
    expect(placed.ghostPowerup).toEqual({ x: 0, y: 0 });

    const already = gs({ ghostPowerup: { x: 1, y: 1 } });
    expect(addGhostPowerup(already)).toBe(already);
  });

  it('bursts 20 ghosts when a snake grabs the powerup', () => {
    const snake: Vec[] = [{ x: 5, y: 5 }, { x: 4, y: 5 }]; // → head (6,5)
    const r = step(gs({ snakes: [snake], ghostPowerup: { x: 6, y: 5 } }), RIGHT);
    expect(r.ghostPowerup).toBeNull();
    expect(r.ghosts).toHaveLength(GHOST_COUNT);
    expect(r.over).toBe(false); // the snake survives the pickup
  });

  it('advances a ghost ~3 cells/tick and trims its trail', () => {
    const moved = advanceGhost(ghostAt([{ x: 0, y: 5 }]), 40, 40)!;
    expect(moved.trail[0]).toEqual({ x: 3, y: 5 });
    expect(moved.trail.length).toBeLessThanOrEqual(GHOST_LEN);
  });

  it('removes a ghost once its whole trail is off-board', () => {
    let cur: Ghost | null = { hx: 39, hy: 5, dx: 1, dy: 0, trail: [{ x: 39, y: 5 }] };
    for (let t = 0; t < 25 && cur; t++) cur = advanceGhost(cur, 40, 40);
    expect(cur).toBeNull();
  });

  it('turns a snake into a ghost when its head touches one', () => {
    const target: Vec[] = [{ x: 5, y: 5 }, { x: 4, y: 5 }]; // → (6,5)
    const bystander: Vec[] = [{ x: 5, y: 15 }, { x: 4, y: 15 }];
    const ghost: Ghost = { hx: 9, hy: 5, dx: -1, dy: 0, trail: [{ x: 9, y: 5 }] }; // sweeps onto (6,5)
    const r = step(gs({ snakes: [target, bystander], ghosts: [ghost], cols: 40, rows: 40 }), RIGHT);
    expect(r.snakes).toHaveLength(1); // target converted away, bystander remains
    expect(r.snakes[0][0]).toEqual({ x: 6, y: 15 });
    expect(r.ghosts.length).toBeGreaterThanOrEqual(2); // advanced + converted
    expect(r.over).toBe(false);
  });

  it('clips a snake where a ghost crosses its body, keeping the front half', () => {
    const snake: Vec[] = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
      { x: 1, y: 5 },
    ];
    const ghost: Ghost = { hx: 4, hy: 8, dx: 0, dy: -1, trail: [{ x: 4, y: 8 }] }; // sweeps onto (4,5)
    const r = step(gs({ snakes: [snake], ghosts: [ghost], cols: 40, rows: 40 }), RIGHT);
    expect(r.snakes[0]).toHaveLength(2); // front (head side) survives
    expect(r.snakes[0][0]).toEqual({ x: 6, y: 5 });
    expect(r.over).toBe(false);
  });
});

describe('ghost rush (buff)', () => {
  it('grants the grabbing snake a 10s ghost rush', () => {
    const snake: Vec[] = [{ x: 5, y: 5 }, { x: 4, y: 5 }]; // → grabs (6,5)
    const r = step(gs({ snakes: [snake], ghostPowerup: { x: 6, y: 5 } }), RIGHT);
    expect(r.ghosts).toHaveLength(GHOST_COUNT);
    expect(r.buffs[0]).toBe(GHOST_RUSH_LIFE - 1); // granted, then counted down this tick
  });

  it('counts the rush down each tick', () => {
    const r = step(gs({ snakes: [[{ x: 5, y: 5 }, { x: 4, y: 5 }]], buffs: [10] }), RIGHT);
    expect(r.buffs[0]).toBe(9);
  });

  it('makes a rushing snake immune to ghosts', () => {
    const snake: Vec[] = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
    const ghost: Ghost = { hx: 9, hy: 5, dx: -1, dy: 0, trail: [{ x: 9, y: 5 }] }; // sweeps onto (6,5)
    const r = step(
      gs({ snakes: [snake], buffs: [GHOST_RUSH_LIFE], ghosts: [ghost], cols: 40, rows: 40 }),
      RIGHT,
    );
    expect(r.snakes).toHaveLength(1); // not converted away
    expect(r.snakes[0][0]).toEqual({ x: 6, y: 5 });
    expect(r.over).toBe(false);
  });

  it('lets a rushing snake eat rocks as food instead of dying', () => {
    const snake: Vec[] = [{ x: 5, y: 5 }, { x: 4, y: 5 }];
    const r = step(
      gs({ snakes: [snake], buffs: [GHOST_RUSH_LIFE], rocks: [{ x: 6, y: 5 }], cols: 40, rows: 40 }),
      RIGHT,
    );
    expect(r.over).toBe(false); // survived the rock
    expect(r.rocks).toHaveLength(0); // rock consumed
    expect(r.score).toBe(POINTS_PER_APPLE); // scored like a food
  });

  it('still kills an unbuffed snake on a rock', () => {
    const r = step(gs({ snakes: [[{ x: 5, y: 5 }, { x: 4, y: 5 }]], rocks: [{ x: 6, y: 5 }] }), RIGHT);
    expect(r.over).toBe(true);
  });
});

describe('grow-in', () => {
  it('grows a new snake one segment per tick until it is full length', () => {
    // a one-segment snake at (5,5) heading right, targeting length 3 (grow = 2)
    let s = gs({ snakes: [[{ x: 5, y: 5 }]], grow: [2], cols: 40, rows: 40 });

    s = step(s, RIGHT);
    expect(s.snakes[0]).toHaveLength(2);
    expect(s.grow[0]).toBe(1);

    s = step(s, RIGHT);
    expect(s.snakes[0]).toHaveLength(3);
    expect(s.grow[0]).toBe(0);

    s = step(s, RIGHT); // full now: length holds steady as it slithers
    expect(s.snakes[0]).toHaveLength(3);
    expect(s.grow[0]).toBe(0);
  });
});
