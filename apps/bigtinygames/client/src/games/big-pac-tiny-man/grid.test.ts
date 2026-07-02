import { describe, it, expect } from 'vitest';
import {
  wrap,
  torusDist,
  DIRS,
  bfsDistances,
  bfsPath,
  firstOpenBelow,
  gradientStep,
  bestTowardTarget,
  chooseSpacedTiles,
} from './grid';

describe('wrap', () => {
  it('leaves in-range values untouched', () => {
    expect(wrap(0, 10)).toBe(0);
    expect(wrap(9, 10)).toBe(9);
  });
  it('wraps past either end', () => {
    expect(wrap(10, 10)).toBe(0);
    expect(wrap(-1, 10)).toBe(9);
    expect(wrap(-11, 10)).toBe(9);
    expect(wrap(23, 10)).toBe(3);
  });
});

describe('torusDist', () => {
  it('is plain Manhattan distance when no wrap is shorter', () => {
    expect(torusDist(1, 1, 3, 2, 100, 100)).toBe(3);
  });
  it('takes the wrap-around path when it is shorter', () => {
    // x: 0 -> 9 is 1 step across the seam on a width-10 torus, not 9.
    expect(torusDist(0, 0, 9, 0, 10, 10)).toBe(1);
    expect(torusDist(0, 0, 0, 8, 10, 10)).toBe(2);
  });
});

describe('DIRS', () => {
  it('is the four unique unit cardinals', () => {
    expect(DIRS).toHaveLength(4);
    const keys = new Set(DIRS.map((d) => `${d.x},${d.y}`));
    expect(keys).toEqual(new Set(['1,0', '-1,0', '0,1', '0,-1']));
  });
});

// 5x5 all-open grid for pathfinding tests.
const COLS = 5;
const ROWS = 5;
const openGrid = () => new Uint8Array(COLS * ROWS).fill(1);
const idx = (x: number, y: number) => y * COLS + x;

describe('bfsDistances', () => {
  it('measures shortest-path step distance on an open grid', () => {
    const dist = bfsDistances(openGrid(), COLS, ROWS, idx(2, 2), new Set(), 10);
    expect(dist.get(idx(2, 2))).toBe(0);
    expect(dist.get(idx(3, 2))).toBe(1);
    expect(dist.get(idx(0, 2))).toBe(2);
    expect(dist.get(idx(0, 0))).toBe(4); // |2|+|2| manhattan
  });

  it('never routes through blocked tiles', () => {
    const grid = openGrid();
    // Wall off a vertical line x=1 (except let the BFS go around), block tile (1,2)
    const blocked = new Set([idx(1, 2)]);
    const dist = bfsDistances(grid, COLS, ROWS, idx(2, 2), blocked, 10);
    expect(dist.has(idx(1, 2))).toBe(false);
  });

  it('treats grid walls (value 0) as impassable', () => {
    const grid = openGrid();
    grid[idx(1, 2)] = 0;
    grid[idx(2, 1)] = 0;
    grid[idx(2, 3)] = 0;
    grid[idx(3, 2)] = 0; // box Pac's start tile in on all four sides
    const dist = bfsDistances(grid, COLS, ROWS, idx(2, 2), new Set(), 10);
    expect(dist.size).toBe(1); // only the start is reachable
  });

  it('stops at the radius', () => {
    const dist = bfsDistances(openGrid(), COLS, ROWS, idx(2, 2), new Set(), 1);
    expect(dist.get(idx(2, 2))).toBe(0);
    expect(dist.get(idx(3, 2))).toBe(1);
    expect(dist.has(idx(4, 2))).toBe(false); // distance 2, beyond radius 1
  });

  it('wraps toroidally', () => {
    // From the left edge, the tile on the right edge is one step across the seam.
    const dist = bfsDistances(openGrid(), COLS, ROWS, idx(0, 0), new Set(), 3);
    expect(dist.get(idx(4, 0))).toBe(1);
    expect(dist.get(idx(0, 4))).toBe(1);
  });
});

describe('gradientStep', () => {
  it('chooses the option that descends the distance gradient', () => {
    const dist = bfsDistances(openGrid(), COLS, ROWS, idx(0, 2), new Set(), 10);
    // Standing at (2,2), Pac is at (0,2): stepping left (-1,0) lowers distance.
    const step = gradientStep(DIRS.slice(), 2, 2, COLS, ROWS, dist);
    expect(step).toEqual({ x: -1, y: 0 });
  });

  it('returns null when no option lands on a known tile', () => {
    const step = gradientStep(DIRS.slice(), 2, 2, COLS, ROWS, new Map());
    expect(step).toBeNull();
  });
});

describe('bfsPath', () => {
  const walk = (sx: number, sy: number, dirs: { x: number; y: number }[]) => {
    let x = sx;
    let y = sy;
    for (const d of dirs) {
      x = wrap(x + d.x, COLS);
      y = wrap(y + d.y, ROWS);
    }
    return { x, y };
  };

  it('returns the step directions of a shortest path', () => {
    const dirs = bfsPath(openGrid(), COLS, ROWS, idx(2, 2), idx(0, 2), new Set(), 20);
    expect(dirs).toHaveLength(2);
    expect(walk(2, 2, dirs)).toEqual({ x: 0, y: 2 });
  });

  it('is empty when start equals target', () => {
    expect(bfsPath(openGrid(), COLS, ROWS, idx(2, 2), idx(2, 2), new Set(), 20)).toEqual([]);
  });

  it('routes around grid walls and never steps on one', () => {
    const grid = openGrid();
    grid[idx(1, 2)] = 0; // wall straight between start and target
    const dirs = bfsPath(grid, COLS, ROWS, idx(2, 2), idx(0, 2), new Set(), 20);
    expect(dirs.length).toBeGreaterThan(2); // forced to detour
    expect(walk(2, 2, dirs)).toEqual({ x: 0, y: 2 });
    let x = 2;
    let y = 2;
    for (const d of dirs) {
      x = wrap(x + d.x, COLS);
      y = wrap(y + d.y, ROWS);
      expect(grid[idx(x, y)]).toBe(1);
    }
  });

  it('wraps toroidally for the shorter path', () => {
    const dirs = bfsPath(openGrid(), COLS, ROWS, idx(0, 0), idx(4, 0), new Set(), 20);
    expect(dirs).toEqual([{ x: -1, y: 0 }]); // one step across the seam
  });

  it('returns empty when the target is unreachable', () => {
    const grid = openGrid();
    for (const [x, y] of [[1, 0], [4, 0], [0, 1], [0, 4]]) grid[idx(x, y)] = 0; // seal (0,0)
    expect(bfsPath(grid, COLS, ROWS, idx(2, 2), idx(0, 0), new Set(), 20)).toEqual([]);
  });

  it('gives up past the step budget', () => {
    // (0,0) is 4 steps from (2,2); a budget of 2 can't reach it.
    expect(bfsPath(openGrid(), COLS, ROWS, idx(2, 2), idx(0, 0), new Set(), 2)).toEqual([]);
  });
});

describe('firstOpenBelow', () => {
  it('finds the first open tile scanning downward', () => {
    const grid = new Uint8Array(COLS * ROWS); // all wall
    grid[idx(2, 3)] = 1;
    expect(firstOpenBelow(grid, COLS, ROWS, 2, 0, new Set())).toBe(idx(2, 3));
  });

  it('skips blocked tiles', () => {
    const grid = new Uint8Array(COLS * ROWS).fill(1);
    const blocked = new Set([idx(2, 1), idx(2, 2)]);
    expect(firstOpenBelow(grid, COLS, ROWS, 2, 1, blocked)).toBe(idx(2, 3));
  });

  it('wraps around the bottom edge', () => {
    const grid = new Uint8Array(COLS * ROWS); // all wall
    grid[idx(2, 1)] = 1;
    expect(firstOpenBelow(grid, COLS, ROWS, 2, 3, new Set())).toBe(idx(2, 1));
  });

  it('returns -1 when the whole column is closed', () => {
    const grid = new Uint8Array(COLS * ROWS); // all wall
    expect(firstOpenBelow(grid, COLS, ROWS, 2, 0, new Set())).toBe(-1);
  });
});

describe('bestTowardTarget', () => {
  // Use a large grid so wrap-around never makes "away" ambiguous.
  const BIG = 100;
  it('moves toward the target when chasing', () => {
    const step = bestTowardTarget(DIRS.slice(), 50, 50, { x: 60, y: 50 }, BIG, BIG, false);
    expect(step).toEqual({ x: 1, y: 0 });
  });
  it('moves away from the target when fleeing', () => {
    const step = bestTowardTarget(DIRS.slice(), 50, 50, { x: 60, y: 50 }, BIG, BIG, true);
    // Fleeing a target to the right: stepping left maximizes distance.
    expect(step).toEqual({ x: -1, y: 0 });
  });
});

describe('chooseSpacedTiles', () => {
  // A deterministic LCG so the spacing invariant is reproducible.
  const seeded = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  it('never places two chosen tiles closer than the gap', () => {
    const cols = 40;
    const rows = 40;
    const candidates: number[] = [];
    for (let i = 0; i < cols * rows; i++) candidates.push(i);
    const gap = 10;
    const chosen = [...chooseSpacedTiles(candidates, cols, 50, gap, seeded(7))];
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        const ax = chosen[i] % cols;
        const ay = Math.floor(chosen[i] / cols);
        const bx = chosen[j] % cols;
        const by = Math.floor(chosen[j] / cols);
        const d2 = (ax - bx) ** 2 + (ay - by) ** 2;
        expect(d2).toBeGreaterThanOrEqual(gap * gap);
      }
    }
  });

  it('never exceeds the requested count or the candidate pool', () => {
    const candidates = [0, 1, 2, 3, 4];
    expect(chooseSpacedTiles(candidates, 5, 3, 1, seeded(1)).size).toBeLessThanOrEqual(3);
    expect(chooseSpacedTiles([], 5, 3, 1).size).toBe(0);
  });
});
