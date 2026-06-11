// World sizing + maze generation for Big Pac Tiny Man.
//
// The premise: sprites stay at arcade size (16px tiles — Pac is 13x13, ghosts
// 14x15), but the maze fills the physical browser pixels, up to 4K. Everything
// that made the classic game (ghosts, power pellets, ghost houses, dots) scales
// with the area, so a big screen gets a labyrinth many times the original.

export const TILE = 16; // px — matches the original arcade sprite cell (16x16)

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WorldPlan {
  cols: number; // tile grid, always odd so the maze lattice lines up
  rows: number;
  ghosts: number;
  powerPellets: number;
  ghostBases: number;
}

// The original arcade maze: 28x31 tiles, 4 ghosts, 1 ghost house.
const CLASSIC_TILES = 28 * 31;
const CLASSIC_GHOSTS = 4;

/** Counts scale with maze area relative to the 1980 original. */
export function planWorld(pxW: number, pxH: number): WorldPlan {
  const odd = (n: number) => Math.max(15, 2 * Math.floor((n - 1) / 2) + 1);
  const cols = odd(Math.floor(pxW / TILE));
  const rows = odd(Math.floor(pxH / TILE));
  const ratio = (cols * rows) / CLASSIC_TILES;
  return {
    cols,
    rows,
    ghosts: Math.max(CLASSIC_GHOSTS, Math.round(CLASSIC_GHOSTS * ratio)),
    // One power pellet per ~100 grid squares (placed with spacing by the engine).
    powerPellets: Math.max(1, Math.floor((cols * rows) / 100)),
    ghostBases: Math.max(1, Math.round(ratio)),
  };
}

export interface Maze {
  cols: number;
  rows: number;
  /** 1 = floor (corridor), 0 = wall. Index = y * cols + x. */
  grid: Uint8Array;
  baseRooms: Rect[];
  pacSpawn: { x: number; y: number };
  /** Rows/cols carved edge-to-edge as wrap-around tunnels. */
  tunnelRows: number[];
  tunnelCols: number[];
}

const CELL_DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const BASE_ROOM_W = 9; // tiles, odd so room edges land on the corridor lattice
const BASE_ROOM_H = 5;

export function generateMaze(plan: WorldPlan): Maze {
  const { cols, rows } = plan;
  const grid = new Uint8Array(cols * rows); // starts all wall
  const at = (x: number, y: number) => y * cols + x;
  const carve = (x: number, y: number) => {
    grid[at(x, y)] = 1;
  };

  // Corridors live on odd coordinates; the maze runs on a half-resolution
  // "cell" lattice with walls between cells.
  const cellCols = (cols - 1) / 2;
  const cellRows = (rows - 1) / 2;

  // Iterative recursive-backtracker over the cells.
  const visited = new Uint8Array(cellCols * cellRows);
  const startCx = Math.floor(cellCols / 2);
  const startCy = Math.floor(cellRows / 2);
  const stack = [startCy * cellCols + startCx];
  visited[stack[0]] = 1;
  carve(2 * startCx + 1, 2 * startCy + 1);

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const cx = cur % cellCols;
    const cy = Math.floor(cur / cellCols);
    const options: Array<readonly [number, number]> = [];
    for (const d of CELL_DIRS) {
      const nx = cx + d[0];
      const ny = cy + d[1];
      if (nx >= 0 && ny >= 0 && nx < cellCols && ny < cellRows && !visited[ny * cellCols + nx]) {
        options.push(d);
      }
    }
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const [dx, dy] = options[Math.floor(Math.random() * options.length)];
    const nx = cx + dx;
    const ny = cy + dy;
    visited[ny * cellCols + nx] = 1;
    carve(2 * cx + 1 + dx, 2 * cy + 1 + dy); // the wall between the two cells
    carve(2 * nx + 1, 2 * ny + 1); // the neighbor cell itself
    stack.push(ny * cellCols + nx);
  }

  // Full braid: open EVERY dead end so the labyrinth is all loops and no
  // cul-de-sacs (Pac-style play needs that). Repeat passes until a pass makes
  // no change — opening one wall can resolve a cell but never creates a new
  // dead end, so this converges quickly.
  let changed = true;
  while (changed) {
    changed = false;
    for (let cy = 0; cy < cellRows; cy++) {
      for (let cx = 0; cx < cellCols; cx++) {
        const tx = 2 * cx + 1;
        const ty = 2 * cy + 1;
        const closed: Array<readonly [number, number]> = [];
        let openCount = 0;
        for (const d of CELL_DIRS) {
          const ncx = cx + d[0];
          const ncy = cy + d[1];
          if (ncx < 0 || ncy < 0 || ncx >= cellCols || ncy >= cellRows) continue;
          if (grid[at(tx + d[0], ty + d[1])]) openCount++;
          else closed.push(d);
        }
        if (openCount <= 1 && closed.length > 0) {
          const [dx, dy] = closed[Math.floor(Math.random() * closed.length)];
          carve(tx + dx, ty + dy);
          changed = true;
        }
      }
    }
  }

  // Wrap-around tunnels: a scaled handful of corridor rows/cols carved
  // edge-to-edge (including the border tiles), so walking off one side
  // reappears on the other. The engine treats movement as toroidal, and only
  // these rows/cols have open border tiles, so wrapping happens only here.
  const tunnelRows: number[] = [];
  const tunnelCols: number[] = [];
  const spacingRows = Math.max(1, Math.round(cellRows / Math.max(1, Math.round(rows / 38))));
  const spacingCols = Math.max(1, Math.round(cellCols / Math.max(1, Math.round(cols / 38))));
  for (let cy = Math.floor(spacingRows / 2); cy < cellRows; cy += spacingRows) {
    const ty = 2 * cy + 1;
    for (let x = 0; x < cols; x++) carve(x, ty);
    tunnelRows.push(ty);
  }
  for (let cx = Math.floor(spacingCols / 2); cx < cellCols; cx += spacingCols) {
    const tx = 2 * cx + 1;
    for (let y = 0; y < rows; y++) carve(tx, y);
    tunnelCols.push(tx);
  }

  // Ghost bases: open rooms spread across the maze, each nudged by a random
  // jitter so they don't sit on a rigid grid. Their odd-aligned footprint
  // guarantees they overlap corridors, so ghosts can always wander out.
  const baseRooms: Rect[] = [];
  const bCols = Math.max(1, Math.round(Math.sqrt(plan.ghostBases * (cols / rows))));
  const bRows = Math.max(1, Math.ceil(plan.ghostBases / bCols));
  const jitterX = Math.max(0, Math.floor((cols / bCols) * 0.28));
  const jitterY = Math.max(0, Math.floor((rows / bRows) * 0.28));
  const jitter = (range: number) =>
    range > 0 ? Math.floor(Math.random() * (2 * range + 1)) - range : 0;
  for (let i = 0; i < plan.ghostBases; i++) {
    const gx = i % bCols;
    const gy = Math.floor(i / bCols);
    let x = Math.round(((gx + 0.5) / bCols) * cols - BASE_ROOM_W / 2) + jitter(jitterX);
    let y = Math.round(((gy + 0.5) / bRows) * rows - BASE_ROOM_H / 2) + jitter(jitterY);
    x = Math.min(Math.max(x, 1), cols - 1 - BASE_ROOM_W) | 1;
    y = Math.min(Math.max(y, 1), rows - 1 - BASE_ROOM_H) | 1;
    for (let ry = y; ry < y + BASE_ROOM_H; ry++) {
      for (let rx = x; rx < x + BASE_ROOM_W; rx++) {
        carve(rx, ry);
      }
    }
    baseRooms.push({ x, y, w: BASE_ROOM_W, h: BASE_ROOM_H });
  }

  return {
    cols,
    rows,
    grid,
    baseRooms,
    pacSpawn: { x: 2 * startCx + 1, y: 2 * startCy + 1 },
    tunnelRows,
    tunnelCols,
  };
}
