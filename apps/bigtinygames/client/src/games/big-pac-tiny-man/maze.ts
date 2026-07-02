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

// Ghost lairs sit on an even grid dense enough that no tile is farther than
// ~LAIR_REACH grid units from one. LAIR_CELL is the grid spacing, sized so a
// cell's half-diagonal (0.5·√2·LAIR_CELL) plus the ±1 jitter and placement
// rounding stays within LAIR_REACH — the 0.9 factor is that safety margin.
const LAIR_REACH = 18;
const LAIR_CELL = Math.round(LAIR_REACH * Math.SQRT2 * 0.9); // ≈23

/** Columns × rows of the even ghost-lair grid for a maze of this size. */
export function lairGridDims(cols: number, rows: number): { bCols: number; bRows: number } {
  return {
    bCols: Math.max(1, Math.ceil(cols / LAIR_CELL)),
    bRows: Math.max(1, Math.ceil(rows / LAIR_CELL)),
  };
}

/** Counts scale with maze area relative to the 1980 original. */
export function planWorld(pxW: number, pxH: number): WorldPlan {
  const odd = (n: number) => Math.max(15, 2 * Math.floor((n - 1) / 2) + 1);
  const cols = odd(Math.floor(pxW / TILE));
  const rows = odd(Math.floor(pxH / TILE));
  const ratio = (cols * rows) / CLASSIC_TILES;
  const { bCols, bRows } = lairGridDims(cols, rows);
  return {
    cols,
    rows,
    ghosts: Math.max(CLASSIC_GHOSTS, Math.round(CLASSIC_GHOSTS * ratio)),
    // One power pellet per ~100 grid squares (placed with spacing by the engine).
    powerPellets: Math.max(1, Math.floor((cols * rows) / 100)),
    // An even grid of lairs covering the whole maze (no empty corner).
    ghostBases: bCols * bRows,
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

  // Extra porosity: after braiding, open a share of the still-closed inter-cell
  // walls so the maze has ~POROSITY more passages — a looser, more open weave to
  // wander. Opening walls only adds connections, so it can never create a dead
  // end or strand anything; the later repair/connectivity passes still hold.
  const POROSITY = 0.2;
  let openWalls = 0;
  const closedWalls: Array<[number, number]> = [];
  for (let cy = 0; cy < cellRows; cy++) {
    for (let cx = 0; cx < cellCols; cx++) {
      const tx = 2 * cx + 1;
      const ty = 2 * cy + 1;
      if (cx + 1 < cellCols) {
        if (grid[at(tx + 1, ty)]) openWalls++;
        else closedWalls.push([tx + 1, ty]);
      }
      if (cy + 1 < cellRows) {
        if (grid[at(tx, ty + 1)]) openWalls++;
        else closedWalls.push([tx, ty + 1]);
      }
    }
  }
  for (let i = closedWalls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [closedWalls[i], closedWalls[j]] = [closedWalls[j], closedWalls[i]];
  }
  const toOpen = Math.min(closedWalls.length, Math.round(openWalls * POROSITY));
  for (let i = 0; i < toOpen; i++) carve(closedWalls[i][0], closedWalls[i][1]);

  // Wrap-around exits used to be whole corridor rows/cols carved edge-to-edge —
  // straight shortcuts across the maze. They're now punched in at the very end
  // (after connectivity) as border-only openings, so the interior stays maze.
  const tunnelRows: number[] = [];
  const tunnelCols: number[] = [];

  // Ghost boxes: walled rooms on an EVEN grid that covers the whole maze — one
  // per cell, every cell (so no corner is left empty), spaced so no tile is more
  // than ~LAIR_REACH from a lair. The box border is forced to wall, the 3x2
  // interior is open, and the only way in or out is the top-middle tile, which
  // connects up to the corridor lattice.
  const baseRooms: Rect[] = [];
  const pacSpawn = { x: 2 * startCx + 1, y: 2 * startCy + 1 };
  const { bCols, bRows } = lairGridDims(cols, rows);
  // A ±1-tile nudge off the even grid so lairs don't sit on a perfectly rigid
  // lattice. x stays odd (its exit column must land on the corridor lattice); y
  // may be any parity — the exit connector reaches the maze either way.
  const jitter1 = () => Math.floor(Math.random() * 3) - 1; // -1, 0, or +1
  for (let gy = 0; gy < bRows; gy++) {
    for (let gx = 0; gx < bCols; gx++) {
      let x = Math.round(((gx + 0.5) / bCols) * cols - BASE_ROOM_W / 2) + jitter1();
      let y = Math.round(((gy + 0.5) / bRows) * rows - BASE_ROOM_H / 2) + jitter1();
      x = Math.min(Math.max(x, 1), cols - 1 - BASE_ROOM_W) | 1;
      // y >= 3 keeps room above the exit for the connector up to the lattice.
      y = Math.min(Math.max(y, 3), rows - 1 - BASE_ROOM_H);

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
  }

  // A lair may have landed on Pac's spawn; the even grid takes priority, so move
  // his spawn to the nearest open, non-box tile instead of nudging the lair.
  const inBox = (x: number, y: number) =>
    baseRooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  if (grid[at(pacSpawn.x, pacSpawn.y)] !== 1 || inBox(pacSpawn.x, pacSpawn.y)) {
    const seen = new Uint8Array(cols * rows);
    seen[at(pacSpawn.x, pacSpawn.y)] = 1;
    const queue: Array<[number, number]> = [[pacSpawn.x, pacSpawn.y]];
    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      if (grid[at(cx, cy)] === 1 && !inBox(cx, cy)) {
        pacSpawn.x = cx;
        pacSpawn.y = cy;
        break;
      }
      for (const [dx, dy] of CELL_DIRS) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (seen[at(nx, ny)]) continue;
        seen[at(nx, ny)] = 1;
        queue.push([nx, ny]);
      }
    }
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

  // Wrap-around exits: open ONLY the two border tiles of a scaled set of
  // corridor rows/cols where the tile just inside each edge is already open.
  // Each exit is then a clean two-neighbour passage — the border tile, its
  // inward corridor, and the toroidal wrap to the matching tile on the far
  // edge — so walking off one side reappears on the other WITHOUT a straight
  // corridor spanning the maze. Done last, so no repair pass can erode them.
  // Target ~twice the old edge-to-edge tunnel density (was ~one per 38 tiles).
  const wantRows = Math.max(1, Math.round(rows / 19));
  const wantCols = Math.max(1, Math.round(cols / 19));
  const rowStride = Math.max(1, Math.round(cellRows / wantRows));
  const colStride = Math.max(1, Math.round(cellCols / wantCols));
  for (let cy = Math.floor(rowStride / 2); cy < cellRows; cy += rowStride) {
    const ty = 2 * cy + 1;
    if (grid[at(1, ty)] === 1 && grid[at(cols - 2, ty)] === 1) {
      carve(0, ty);
      carve(cols - 1, ty);
      tunnelRows.push(ty);
    }
  }
  for (let cx = Math.floor(colStride / 2); cx < cellCols; cx += colStride) {
    const tx = 2 * cx + 1;
    if (grid[at(tx, 1)] === 1 && grid[at(tx, rows - 2)] === 1) {
      carve(tx, 0);
      carve(tx, rows - 1);
      tunnelCols.push(tx);
    }
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
