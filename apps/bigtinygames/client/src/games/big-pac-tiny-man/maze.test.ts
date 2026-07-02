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

  it('opens wrap exits at the borders WITHOUT a straight corridor across', () => {
    // Exits are now just the two border tiles of a row/col (plus the toroidal
    // wrap between them); the interior stays maze, so there is no edge-to-edge
    // shortcut. Use a large maze so a coincidentally all-open row is impossible.
    for (let run = 0; run < 4; run++) {
      const maze = generateMaze(planWorld(1920, 1080));
      const { cols, rows, grid } = maze;
      expect(maze.tunnelRows.length).toBeGreaterThan(0);
      expect(maze.tunnelCols.length).toBeGreaterThan(0);

      for (const ty of maze.tunnelRows) {
        // both border ends open, so the wrap is walkable
        expect(grid[ty * cols + 0]).toBe(1);
        expect(grid[ty * cols + (cols - 1)]).toBe(1);
        // ...but the row is NOT a straight corridor: it still has interior walls
        let walls = 0;
        for (let x = 1; x < cols - 1; x++) if (grid[ty * cols + x] === 0) walls++;
        expect(walls).toBeGreaterThan(0);
      }
      for (const tx of maze.tunnelCols) {
        expect(grid[0 * cols + tx]).toBe(1);
        expect(grid[(rows - 1) * cols + tx]).toBe(1);
        let walls = 0;
        for (let y = 1; y < rows - 1; y++) if (grid[y * cols + tx] === 0) walls++;
        expect(walls).toBeGreaterThan(0);
      }
    }
  });

  it('roughly doubles the exit density versus the old ~one-per-38-tiles', () => {
    // Old density was ≈ round(dim/38); the new target ≈ round(dim/19), so the
    // counts should clear the old formula even if a box swallows an exit or two.
    const maze = generateMaze(planWorld(1920, 1080));
    expect(maze.tunnelRows.length).toBeGreaterThan(Math.max(1, Math.round(maze.rows / 38)));
    expect(maze.tunnelCols.length).toBeGreaterThan(Math.max(1, Math.round(maze.cols / 38)));
  });

  it('opens extra passages for a loopier, more porous maze', () => {
    for (let run = 0; run < 3; run++) {
      const maze = generateMaze(planWorld(1920, 1080));
      const { cols, rows, grid } = maze;
      const cellCols = (cols - 1) / 2;
      const cellRows = (rows - 1) / 2;
      const cells = cellCols * cellRows;
      let open = 0;
      for (let cy = 0; cy < cellRows; cy++) {
        for (let cx = 0; cx < cellCols; cx++) {
          if (cx + 1 < cellCols && grid[(2 * cy + 1) * cols + (2 * cx + 2)] === 1) open++;
          if (cy + 1 < cellRows && grid[(2 * cy + 2) * cols + (2 * cx + 1)] === 1) open++;
        }
      }
      // A perfect maze opens exactly cells-1 inter-cell walls; the full braid
      // plus the porosity pass opens well beyond that, so the weave has loops.
      expect(open).toBeGreaterThan(1.15 * (cells - 1));
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
