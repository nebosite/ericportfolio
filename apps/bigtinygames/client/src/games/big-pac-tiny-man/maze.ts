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

// Ghost box: 5x4 exterior, 3x2 open interior, 1-tile walls all around, and a
// single exit at the top middle. Odd-aligned so the exit column lands on the
// corridor lattice.
const BASE_ROOM_W = 5;
const BASE_ROOM_H = 4;

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

  // Ghost boxes: walled rooms spread across the maze, each nudged by a random
  // jitter so they don't sit on a rigid grid. The box border is forced to
  // wall, the 3x2 interior is open, and the only way in or out is the top
  // middle tile, which connects up to the corridor lattice.
  const baseRooms: Rect[] = [];
  const pacSpawn = { x: 2 * startCx + 1, y: 2 * startCy + 1 };
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
    // y >= 3 keeps room above the exit for the connector up to the lattice.
    y = Math.min(Math.max(y, 3), rows - 1 - BASE_ROOM_H) | 1;
    // Pac spawns in a walkable clearing; never drop a box on top of him.
    if (Math.abs(x + 2 - pacSpawn.x) <= 4 && Math.abs(y + 2 - pacSpawn.y) <= 4) {
      x = x + 8 <= cols - 1 - BASE_ROOM_W ? (x + 8) | 1 : (x - 8) | 1;
    }

    const exitX = x + 2; // top middle (odd column — on the corridor lattice)
    for (let ry = y; ry < y + BASE_ROOM_H; ry++) {
      for (let rx = x; rx < x + BASE_ROOM_W; rx++) {
        const isBorder = rx === x || rx === x + BASE_ROOM_W - 1 || ry === y || ry === y + BASE_ROOM_H - 1;
        const isExit = rx === exitX && ry === y;
        grid[at(rx, ry)] = isBorder && !isExit ? 0 : 1;
      }
    }
    // Connect the exit upward: (exitX, y-2) is an odd/odd lattice tile, which
    // the backtracker always carved, so one connector tile reaches the maze.
    carve(exitX, y - 1);
    baseRooms.push({ x, y, w: BASE_ROOM_W, h: BASE_ROOM_H });
  }

  // Stamping walled boxes over the braided maze chops some loops into stubs.
  // Repair pass: any corridor tile left with <=1 open neighbor gets re-opened
  // through to the corridor beyond (when that wouldn't breach a box or the
  // outer border), otherwise the stub tile is eroded back to wall. Repeats
  // until stable, so stubs either reconnect or vanish.
  const boxMask = new Uint8Array(cols * rows);
  for (const r of baseRooms) {
    for (let ry = r.y; ry < r.y + r.h; ry++) {
      for (let rx = r.x; rx < r.x + r.w; rx++) boxMask[at(rx, ry)] = 1;
    }
  }
  const wrapX = (v: number) => ((v % cols) + cols) % cols;
  const wrapY = (v: number) => ((v % rows) + rows) % rows;
  for (let pass = 0, dirty = true; dirty && pass < 50; pass++) {
    dirty = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = at(x, y);
        if (!grid[idx] || boxMask[idx]) continue;
        let open = 0;
        for (const [dx, dy] of CELL_DIRS) {
          if (grid[at(wrapX(x + dx), wrapY(y + dy))]) open++;
        }
        if (open > 1) continue;
        // Try to reconnect: carve the wall beside the stub if a corridor lies
        // just beyond it (without tunneling through boxes or the outer edge).
        let fixed = false;
        for (const [dx, dy] of CELL_DIRS) {
          const wx = x + dx;
          const wy = y + dy;
          const fx = x + 2 * dx;
          const fy = y + 2 * dy;
          if (wx <= 0 || wy <= 0 || wx >= cols - 1 || wy >= rows - 1) continue;
          if (fx < 0 || fy < 0 || fx >= cols || fy >= rows) continue;
          if (grid[at(wx, wy)] || boxMask[at(wx, wy)]) continue;
          if (!grid[at(fx, fy)] || boxMask[at(fx, fy)]) continue;
          carve(wx, wy);
          fixed = true;
          break;
        }
        if (!fixed && !(x === pacSpawn.x && y === pacSpawn.y)) {
          grid[idx] = 0; // erode the stub; the next pass re-checks its neighbor
        }
        dirty = true;
      }
    }
  }

  // Connectivity guarantee: stamping walled boxes (and the erosion above) can
  // island a box or a small corridor pocket off the main network. Flood from
  // Pac's spawn, then reconnect every unreached open tile by carving the single
  // interior wall between it and a reachable corridor. Carving only ever adds
  // open space, so it can't create a dead end or strand ghosts in a sealed box.
  const floodFromSpawn = (): Uint8Array => {
    const seen = new Uint8Array(cols * rows);
    const start = at(pacSpawn.x, pacSpawn.y);
    seen[start] = 1;
    const stack = [start];
    while (stack.length > 0) {
      const idx = stack.pop()!;
      const x = idx % cols;
      const y = (idx - x) / cols;
      for (const [dx, dy] of CELL_DIRS) {
        const nidx = at(wrapX(x + dx), wrapY(y + dy));
        if (seen[nidx] || grid[nidx] !== 1) continue;
        seen[nidx] = 1;
        stack.push(nidx);
      }
    }
    return seen;
  };

  for (let pass = 0; pass < 50; pass++) {
    const reach = floodFromSpawn();
    let carved = false;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = at(x, y);
        if (grid[idx] !== 1 || reach[idx]) continue; // only unreachable open tiles
        for (const [dx, dy] of CELL_DIRS) {
          const wx = x + dx;
          const wy = y + dy;
          const fx = wrapX(x + 2 * dx);
          const fy = wrapY(y + 2 * dy);
          // Stay off the outer border so we never open a stray wrap tunnel.
          if (wx <= 0 || wy <= 0 || wx >= cols - 1 || wy >= rows - 1) continue;
          const wIdx = at(wx, wy);
          const fIdx = at(fx, fy);
          if (grid[wIdx] !== 0 || boxMask[wIdx]) continue; // need an interior wall, not a box border
          if (grid[fIdx] !== 1 || !reach[fIdx]) continue; // far side must be reachable corridor
          carve(wx, wy);
          carved = true;
          break;
        }
      }
    }
    if (!carved) break; // converged (or nothing left to connect)
  }

  return {
    cols,
    rows,
    grid,
    baseRooms,
    pacSpawn,
    tunnelRows,
    tunnelCols,
  };
}
