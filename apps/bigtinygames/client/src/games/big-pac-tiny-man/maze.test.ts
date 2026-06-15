import { describe, it, expect } from 'vitest';
import { planWorld, generateMaze, TILE, type Maze } from './maze';

// planWorld/generateMaze use Math.random, so these assert structural invariants
// across several screen sizes and repeated runs rather than exact layouts.

const SIZES: Array<[number, number]> = [
  [320, 240], // tiny — clamps to the 15x15 floor
  [800, 600],
  [1280, 720],
  [1920, 1080],
];

const wrap = (v: number, n: number) => ((v % n) + n) % n;

function openNeighbors(maze: Maze, x: number, y: number): number {
  const { cols, rows, grid } = maze;
  let open = 0;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    if (grid[wrap(y + dy, rows) * cols + wrap(x + dx, cols)] === 1) open++;
  }
  return open;
}

function inAnyBox(maze: Maze, x: number, y: number): boolean {
  return maze.baseRooms.some(
    (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h,
  );
}

describe('planWorld', () => {
  it('produces an odd grid no smaller than 15x15', () => {
    for (const [w, h] of SIZES) {
      const plan = planWorld(w, h);
      expect(plan.cols).toBeGreaterThanOrEqual(15);
      expect(plan.rows).toBeGreaterThanOrEqual(15);
      expect(plan.cols % 2).toBe(1);
      expect(plan.rows % 2).toBe(1);
    }
  });

  it('keeps at least the classic counts and scales up with area', () => {
    const small = planWorld(320, 240);
    const big = planWorld(1920, 1080);
    expect(small.ghosts).toBeGreaterThanOrEqual(4);
    expect(small.powerPellets).toBeGreaterThanOrEqual(1);
    expect(small.ghostBases).toBeGreaterThanOrEqual(1);
    // A 4K-ish screen has many more ghosts/pellets/bases than a tiny one.
    expect(big.ghosts).toBeGreaterThan(small.ghosts);
    expect(big.powerPellets).toBeGreaterThan(small.powerPellets);
    expect(big.ghostBases).toBeGreaterThanOrEqual(small.ghostBases);
  });

  it('exposes the arcade tile size', () => {
    expect(TILE).toBe(16);
  });
});

describe('generateMaze', () => {
  it('returns a grid matching the planned dimensions', () => {
    for (const [w, h] of SIZES) {
      const maze = generateMaze(planWorld(w, h));
      expect(maze.grid.length).toBe(maze.cols * maze.rows);
    }
  });

  it('spawns Pac on an open corridor tile', () => {
    for (const [w, h] of SIZES) {
      const maze = generateMaze(planWorld(w, h));
      const { pacSpawn, cols, grid } = maze;
      expect(grid[pacSpawn.y * cols + pacSpawn.x]).toBe(1);
      expect(inAnyBox(maze, pacSpawn.x, pacSpawn.y)).toBe(false);
    }
  });

  it('has no dead ends: every open corridor tile has >=2 exits', () => {
    for (const [w, h] of SIZES) {
      for (let run = 0; run < 4; run++) {
        const maze = generateMaze(planWorld(w, h));
        const { cols, rows, grid, pacSpawn } = maze;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            if (grid[y * cols + x] !== 1) continue;
            if (inAnyBox(maze, x, y)) continue; // boxes are intentionally cul-de-sacs
            if (x === pacSpawn.x && y === pacSpawn.y) continue; // spawn is allowed to be a stub
            expect(openNeighbors(maze, x, y)).toBeGreaterThanOrEqual(2);
          }
        }
      }
    }
  });

  it('builds ghost boxes with a walled border and a single top-middle exit', () => {
    const maze = generateMaze(planWorld(1280, 720));
    expect(maze.baseRooms.length).toBeGreaterThan(0);
    for (const r of maze.baseRooms) {
      const exitX = r.x + 2;
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) {
          const isBorder =
            x === r.x || x === r.x + r.w - 1 || y === r.y || y === r.y + r.h - 1;
          const isExit = x === exitX && y === r.y;
          const val = maze.grid[y * maze.cols + x];
          if (isExit) expect(val).toBe(1); // the one doorway is open
          else if (isBorder) expect(val).toBe(0); // the rest of the wall is solid
          else expect(val).toBe(1); // interior is open
        }
      }
    }
  });

  it('carves wrap tunnels edge-to-edge (except where a ghost box overlaps)', () => {
    const maze = generateMaze(planWorld(1280, 720));
    expect(maze.tunnelRows.length).toBeGreaterThan(0);
    expect(maze.tunnelCols.length).toBeGreaterThan(0);
    // Ghost boxes are stamped after the tunnels, so a box footprint may wall off
    // a few tunnel tiles; everywhere else the tunnel line is open border-to-border.
    for (const ty of maze.tunnelRows) {
      for (let x = 0; x < maze.cols; x++) {
        if (inAnyBox(maze, x, ty)) continue;
        expect(maze.grid[ty * maze.cols + x]).toBe(1);
      }
    }
    for (const tx of maze.tunnelCols) {
      for (let y = 0; y < maze.rows; y++) {
        if (inAnyBox(maze, tx, y)) continue;
        expect(maze.grid[y * maze.cols + tx]).toBe(1);
      }
    }
  });

  it('keeps every open tile reachable from Pac spawn (full connectivity)', () => {
    // The connectivity pass guarantees one connected component: no sealed box,
    // no islanded corridor pocket, anywhere, at any size.
    for (const [w, h] of SIZES) {
      for (let run = 0; run < 6; run++) {
        const maze = generateMaze(planWorld(w, h));
        const { cols, rows, grid, pacSpawn } = maze;
        const start = pacSpawn.y * cols + pacSpawn.x;
        const seen = new Uint8Array(cols * rows);
        const stack = [start];
        seen[start] = 1;
        let reached = 1;
        while (stack.length) {
          const idx = stack.pop()!;
          const x = idx % cols;
          const y = (idx - x) / cols;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const nidx = wrap(y + dy, rows) * cols + wrap(x + dx, cols);
            if (seen[nidx] || grid[nidx] !== 1) continue;
            seen[nidx] = 1;
            reached++;
            stack.push(nidx);
          }
        }
        let totalOpen = 0;
        for (let i = 0; i < grid.length; i++) if (grid[i] === 1) totalOpen++;
        expect(reached).toBe(totalOpen);
      }
    }
  });
});
