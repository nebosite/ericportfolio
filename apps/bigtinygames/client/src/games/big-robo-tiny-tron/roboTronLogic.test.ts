import { describe, it, expect, beforeEach } from "vitest";
import {
  initialState,
  step,
  bfsPath,
  mazeCellPassable,
  cellCenter,
  cellAt,
  applyPowerup,
  bulletHitsWall,
  CELL_SIZE,
  PLAYER_SPEED,
  PLAYER_SPEED_BOOST,
  PLAYER_SHOOT_COOLDOWN,
  BULLET_SPEED,
  TRIPLE_SPREAD,
  ENFORCER_SPREAD_COUNT,
  ENFORCER_SPREAD_ANGLE,
  ENEMIES_BASE,
  ENEMIES_PER_LEVEL,
  MIN_ENEMY_SPAWN_DIST,
  HUMAN_COUNT,
  GRUNT_MOVE_INTERVAL,
  GRUNT_SHOOT_COOLDOWN,
  ENFORCER_SHOOT_COOLDOWN,
  POWERUP_TTL,
  DECOY_MAX_HELD,
  DECOY_TTL,
  POWERUP_PICKUP_RADIUS,
  PLAYER_RADIUS,
  LIVES_START,
  ENEMY_KILL_SCORE,
  INVULN_DURATION,
  RESPAWN_DELAY,
} from "./roboTronLogic";
import type {
  GameState,
  InputState,
  Maze,
  Player,
  Enemy,
  Grunt,
  Enforcer,
  Phantom,
  CellPos,
} from "./roboTronLogic";

// ---------------------------------------------------------------------------
// Test helpers

/** Deterministic RNG that cycles through a fixed value sequence. */
const seqRng = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

/** Build a minimal open maze (only outer-border walls set). */
function openMaze(cols: number, rows: number): Maze {
  const walls = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let bits = 0;
      if (r === 0) bits |= 1; // N
      if (c === cols - 1) bits |= 2; // E
      if (r === rows - 1) bits |= 4; // S
      if (c === 0) bits |= 8; // W
      walls[r * cols + c] = bits;
    }
  }
  return {
    cols,
    rows,
    walls,
    cellSize: CELL_SIZE,
    teleportPads: [
      { col: 0, row: 0 },
      { col: cols - 1, row: 0 },
      { col: cols - 1, row: rows - 1 },
      { col: 0, row: rows - 1 },
    ],
    exitCells: [
      { col: Math.floor(cols / 2), row: 0 },
      { col: cols - 1, row: Math.floor(rows / 2) },
      { col: Math.floor(cols / 2), row: rows - 1 },
      { col: 0, row: Math.floor(rows / 2) },
    ],
  };
}

const IDLE: InputState = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  fire: false,
  dropDecoy: false,
};

function basePlayer(x: number, y: number): Player {
  return {
    x,
    y,
    aimDir: { x: 1, y: 0 },
    invuln: 0,
    shootCooldown: 0,
    respawnTimer: 0,
    activePowerup: null,
    powerupTimer: 0,
  };
}

function makeGrunt(id: number, col: number, row: number, overrides: Partial<Grunt> = {}): Grunt {
  return {
    kind: "grunt",
    id,
    col,
    row,
    hp: 1,
    moveTimer: GRUNT_MOVE_INTERVAL,
    path: [],
    pathAge: 0,
    shootCooldown: GRUNT_SHOOT_COOLDOWN,
    ...overrides,
  };
}

function makeEnforcer(id: number, col: number, row: number, overrides: Partial<Enforcer> = {}): Enforcer {
  return {
    kind: "enforcer",
    id,
    col,
    row,
    hp: 3,
    moveTimer: GRUNT_MOVE_INTERVAL,
    path: [],
    pathAge: 0,
    shootCooldown: ENFORCER_SHOOT_COOLDOWN,
    ...overrides,
  };
}

function minimalState(overrides: Partial<GameState> = {}): GameState {
  const maze = openMaze(11, 11);
  const cx = 5 * CELL_SIZE + CELL_SIZE / 2;
  const cy = 5 * CELL_SIZE + CELL_SIZE / 2;
  return {
    phase: "playing",
    level: 1,
    score: 0,
    lives: LIVES_START,
    maze,
    player: basePlayer(cx, cy),
    enemies: [],
    humans: [],
    bullets: [],
    powerupPickups: [],
    decoy: null,
    decoyCharges: 0,
    exitsOpen: false,
    bfsRefreshIndex: 0,
    events: [],
    nextBulletId: 1,
    nextEnemyId: 1,
    nextHumanId: 1,
    nextPickupId: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TC-01: initialState — full connectivity (BFS from center to every cell)
describe("TC-01 initialState full connectivity", () => {
  it("every cell is reachable from (0,0) in an 11x11 level-1 maze", () => {
    // Use a spread rng so the maze actually generates corridors
    const rng = seqRng([0.1, 0.3, 0.7, 0.5, 0.2, 0.9, 0.4, 0.6, 0.8, 0.0]);
    const state = initialState(11, 11, 1, rng);
    const { maze } = state;
    const unreachable: CellPos[] = [];
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        const path = bfsPath(maze, { col: 0, row: 0 }, { col: c, row: r });
        // (0,0) to (0,0) returns [] which is fine
        if (c === 0 && r === 0) continue;
        if (path.length === 0) unreachable.push({ col: c, row: r });
      }
    }
    expect(unreachable).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-02: mazeCellPassable — outer border walls are solid
describe("TC-02 outer border walls are solid", () => {
  it("N face of every cell in row 0 is a wall", () => {
    const rng = seqRng([0.5]);
    const state = initialState(11, 11, 1, rng);
    const { maze } = state;
    for (let c = 0; c < maze.cols; c++) {
      expect(mazeCellPassable(maze, c, 0, "N")).toBe(false);
    }
  });

  it("S face of every cell in last row is a wall", () => {
    const rng = seqRng([0.5]);
    const state = initialState(11, 11, 1, rng);
    const { maze } = state;
    const last = maze.rows - 1;
    for (let c = 0; c < maze.cols; c++) {
      expect(mazeCellPassable(maze, c, last, "S")).toBe(false);
    }
  });

  it("W face of every cell in col 0 is a wall", () => {
    const rng = seqRng([0.5]);
    const state = initialState(11, 11, 1, rng);
    const { maze } = state;
    for (let r = 0; r < maze.rows; r++) {
      expect(mazeCellPassable(maze, 0, r, "W")).toBe(false);
    }
  });

  it("E face of every cell in last col is a wall", () => {
    const rng = seqRng([0.5]);
    const state = initialState(11, 11, 1, rng);
    const { maze } = state;
    const last = maze.cols - 1;
    for (let r = 0; r < maze.rows; r++) {
      expect(mazeCellPassable(maze, last, r, "E")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-03: corridor openings are symmetric
describe("TC-03 corridor openings are symmetric", () => {
  it("E face of a cell agrees with W face of its eastern neighbour", () => {
    const rng = seqRng([0.3, 0.7, 0.1, 0.9]);
    const state = initialState(11, 11, 1, rng);
    const { maze } = state;
    let mismatches = 0;
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols - 1; c++) {
        if (mazeCellPassable(maze, c, r, "E") !== mazeCellPassable(maze, c + 1, r, "W")) {
          mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TC-04: Player spawns at maze center
describe("TC-04 player spawns at maze center", () => {
  it("player pixel position maps to the center cell of an 11x11 grid", () => {
    const state = initialState(11, 11, 1, seqRng([0.5]));
    const { player, maze } = state;
    const spawnCell = cellAt(maze, player.x, player.y);
    expect(spawnCell.col).toBe(5);
    expect(spawnCell.row).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// TC-05: Enemy count scales with level
describe("TC-05 enemy count scales with level", () => {
  const rng = () => seqRng([0.1, 0.9, 0.2, 0.8, 0.3, 0.7]);
  it.each([
    [1, ENEMIES_BASE],
    [3, ENEMIES_BASE + 2 * ENEMIES_PER_LEVEL],
    [5, ENEMIES_BASE + 4 * ENEMIES_PER_LEVEL],
  ])("level %i → %i enemies", (level, expected) => {
    const state = initialState(11, 11, level, rng());
    expect(state.enemies).toHaveLength(expected);
  });
});

// ---------------------------------------------------------------------------
// TC-06: Enemy minimum spawn distance from player
describe("TC-06 enemy min spawn distance", () => {
  it("all enemies are at least MIN_ENEMY_SPAWN_DIST Manhattan cells from player", () => {
    const state = initialState(15, 15, 1, seqRng([0.1, 0.9, 0.2, 0.8]));
    const { player, maze } = state;
    const spawnCell = cellAt(maze, player.x, player.y);
    for (const e of state.enemies) {
      const dist = Math.abs(e.col - spawnCell.col) + Math.abs(e.row - spawnCell.row);
      expect(dist).toBeGreaterThanOrEqual(MIN_ENEMY_SPAWN_DIST);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-07: Human count and no overlap with player or enemies
describe("TC-07 human count and placement", () => {
  it("exactly HUMAN_COUNT humans, none sharing a cell with player or enemies", () => {
    const state = initialState(11, 11, 1, seqRng([0.1, 0.3, 0.5, 0.7, 0.9]));
    expect(state.humans).toHaveLength(HUMAN_COUNT);
    const { player, maze } = state;
    const spawnCell = cellAt(maze, player.x, player.y);
    const enemyCells = new Set(state.enemies.map((e) => `${e.col},${e.row}`));
    for (const h of state.humans) {
      expect(`${h.col},${h.row}`).not.toBe(`${spawnCell.col},${spawnCell.row}`);
      expect(enemyCells.has(`${h.col},${h.row}`)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-08: No Enforcers at level 1, at least one at level 3
describe("TC-08 Enforcer introduction at level 3", () => {
  it("level 1 has zero Enforcers", () => {
    const state = initialState(11, 11, 1, seqRng([0.5]));
    expect(state.enemies.filter((e) => e.kind === "enforcer")).toHaveLength(0);
  });

  it("level 3 has at least one Enforcer", () => {
    const state = initialState(11, 11, 3, seqRng([0.5]));
    expect(state.enemies.filter((e) => e.kind === "enforcer").length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// TC-09: Exits are sealed at level start
describe("TC-09 exits sealed at level start", () => {
  it("outward wall bit is set on every exit cell and exitsOpen is false", () => {
    const state = initialState(11, 11, 1, seqRng([0.5]));
    expect(state.exitsOpen).toBe(false);
    const { maze } = state;
    for (const ec of maze.exitCells) {
      const isN = ec.row === 0;
      const isS = ec.row === maze.rows - 1;
      const isW = ec.col === 0;
      const isE = ec.col === maze.cols - 1;
      if (isN) expect(mazeCellPassable(maze, ec.col, ec.row, "N")).toBe(false);
      if (isS) expect(mazeCellPassable(maze, ec.col, ec.row, "S")).toBe(false);
      if (isW) expect(mazeCellPassable(maze, ec.col, ec.row, "W")).toBe(false);
      if (isE) expect(mazeCellPassable(maze, ec.col, ec.row, "E")).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-10: Normal move along open corridor
describe("TC-10 normal player movement", () => {
  it("player x increases by PLAYER_SPEED * dt when moving east through open corridor", () => {
    const state = minimalState();
    const dt = 0.016;
    const beforeX = state.player.x;
    step(state, { ...IDLE, moveX: 1 }, dt);
    expect(state.player.x).toBeCloseTo(beforeX + PLAYER_SPEED * dt, 1);
  });
});

// ---------------------------------------------------------------------------
// TC-11: Wall blocks movement
describe("TC-11 wall blocks movement", () => {
  it("E wall prevents the player from moving further east", () => {
    const maze = openMaze(11, 11);
    // Add E wall on cell (5,5)
    maze.walls[5 * 11 + 5] |= 2; // E bit
    // Also add W wall on (6,5) for symmetry
    maze.walls[5 * 11 + 6] |= 8; // W bit

    // Place player very close to the E wall of cell (5,5)
    const wallX = (5 + 1) * CELL_SIZE; // east face of cell 5 = 240
    const playerX = wallX - PLAYER_RADIUS - 0.5; // just inside safe zone
    const playerY = 5 * CELL_SIZE + CELL_SIZE / 2;

    const state = minimalState({ maze, player: basePlayer(playerX, playerY) });
    const xBefore = state.player.x;
    step(state, { ...IDLE, moveX: 1 }, 0.016);
    // Player should not move east (wall collision)
    expect(state.player.x).toBeCloseTo(xBefore, 1);
  });
});

// ---------------------------------------------------------------------------
// TC-13: SpeedBoost multiplies movement speed
describe("TC-13 SpeedBoost movement speed", () => {
  it("player x increases by PLAYER_SPEED * PLAYER_SPEED_BOOST * dt with SpeedBoost active", () => {
    const state = minimalState({
      player: {
        ...basePlayer(5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2),
        activePowerup: "SpeedBoost",
        powerupTimer: 5,
      },
    });
    const dt = 0.016;
    const beforeX = state.player.x;
    step(state, { ...IDLE, moveX: 1 }, dt);
    expect(state.player.x).toBeCloseTo(beforeX + PLAYER_SPEED * PLAYER_SPEED_BOOST * dt, 1);
  });
});

// ---------------------------------------------------------------------------
// TC-14: Bullet created in aim direction
describe("TC-14 bullet created in aim direction", () => {
  it("firing with aimDir east creates one player bullet travelling east", () => {
    const state = minimalState();
    state.player.shootCooldown = 0;
    step(state, { ...IDLE, fire: true, aimX: 1, aimY: 0 }, 0.016);
    const playerBullets = state.bullets.filter((b) => b.fromPlayer);
    expect(playerBullets).toHaveLength(1);
    expect(playerBullets[0].vx).toBeCloseTo(BULLET_SPEED, 0);
    expect(playerBullets[0].vy).toBeCloseTo(0, 1);
  });
});

// ---------------------------------------------------------------------------
// TC-15: Cooldown prevents firing
describe("TC-15 cooldown prevents firing", () => {
  it("no bullet is created and cooldown decrements when shootCooldown > 0", () => {
    const state = minimalState();
    state.player.shootCooldown = 0.1;
    step(state, { ...IDLE, fire: true, aimX: 1, aimY: 0 }, 0.016);
    expect(state.bullets).toHaveLength(0);
    expect(state.player.shootCooldown).toBeCloseTo(0.1 - 0.016, 3);
  });
});

// ---------------------------------------------------------------------------
// TC-16: TripleBullets fires three spread bullets
describe("TC-16 TripleBullets fires 3 bullets", () => {
  it("fires exactly 3 bullets with centre at 0 deg and outer at ±TRIPLE_SPREAD", () => {
    const state = minimalState({
      player: {
        ...basePlayer(5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2),
        activePowerup: "TripleBullets",
        powerupTimer: 5,
        shootCooldown: 0,
      },
    });
    step(state, { ...IDLE, fire: true, aimX: 1, aimY: 0 }, 0.016);
    const pb = state.bullets.filter((b) => b.fromPlayer);
    expect(pb).toHaveLength(3);

    const angles = pb.map((b) => Math.atan2(b.vy, b.vx)).sort((a, z) => a - z);
    expect(angles[0]).toBeCloseTo(-TRIPLE_SPREAD, 4);
    expect(angles[1]).toBeCloseTo(0, 4);
    expect(angles[2]).toBeCloseTo(TRIPLE_SPREAD, 4);
  });
});

// ---------------------------------------------------------------------------
// TC-17: AllDirections fires eight bullets
describe("TC-17 AllDirections fires 8 bullets", () => {
  it("fires exactly 8 bullets covering all 8 cardinal/diagonal directions", () => {
    const state = minimalState({
      player: {
        ...basePlayer(5 * CELL_SIZE + CELL_SIZE / 2, 5 * CELL_SIZE + CELL_SIZE / 2),
        activePowerup: "AllDirections",
        powerupTimer: 5,
        shootCooldown: 0,
      },
    });
    step(state, { ...IDLE, fire: true, aimX: 1, aimY: 0 }, 0.016);
    const pb = state.bullets.filter((b) => b.fromPlayer);
    expect(pb).toHaveLength(8);

    const expectedAngles = [0, 45, 90, 135, 180, 225, 270, 315].map((d) => (d * Math.PI) / 180);
    const actualAngles = pb.map((b) => {
      let a = Math.atan2(b.vy, b.vx);
      if (a < 0) a += 2 * Math.PI;
      return a;
    }).sort((a, z) => a - z);

    for (let i = 0; i < 8; i++) {
      expect(actualAngles[i]).toBeCloseTo(expectedAngles[i], 3);
    }
  });
});

// ---------------------------------------------------------------------------
// TC-21: bfsPath returns shortest path through open maze
describe("TC-21 bfsPath shortest path in hand-crafted maze", () => {
  it("returns the exact corridor (0,0)→(1,0)→(2,0)→(2,1)→(2,2)", () => {
    // 5x5 maze, all walls set; carve only the specified corridor
    const cols = 5;
    const rows = 5;
    const walls = new Uint8Array(cols * rows).fill(15);

    // Carve (0,0)→(1,0): clear E of (0,0) and W of (1,0)
    walls[0 * cols + 0] &= ~2;
    walls[0 * cols + 1] &= ~8;
    // Carve (1,0)→(2,0): clear E of (1,0) and W of (2,0)
    walls[0 * cols + 1] &= ~2;
    walls[0 * cols + 2] &= ~8;
    // Carve (2,0)→(2,1): clear S of (2,0) and N of (2,1)
    walls[0 * cols + 2] &= ~4;
    walls[1 * cols + 2] &= ~1;
    // Carve (2,1)→(2,2): clear S of (2,1) and N of (2,2)
    walls[1 * cols + 2] &= ~4;
    walls[2 * cols + 2] &= ~1;

    const maze: Maze = {
      cols,
      rows,
      walls,
      cellSize: CELL_SIZE,
      teleportPads: [
        { col: 0, row: 0 },
        { col: 4, row: 0 },
        { col: 4, row: 4 },
        { col: 0, row: 4 },
      ],
      exitCells: [],
    };

    const path = bfsPath(maze, { col: 0, row: 0 }, { col: 2, row: 2 });
    expect(path).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
      { col: 2, row: 1 },
      { col: 2, row: 2 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// TC-22: bfsPath with ignoreWalls passes through walls
describe("TC-22 bfsPath ignoreWalls", () => {
  it("finds a path in a fully walled 3x3 maze when ignoreWalls=true", () => {
    const cols = 3;
    const rows = 3;
    const walls = new Uint8Array(cols * rows).fill(15);
    const maze: Maze = {
      cols,
      rows,
      walls,
      cellSize: CELL_SIZE,
      teleportPads: [
        { col: 0, row: 0 },
        { col: 2, row: 0 },
        { col: 2, row: 2 },
        { col: 0, row: 2 },
      ],
      exitCells: [],
    };
    const path = bfsPath(maze, { col: 0, row: 0 }, { col: 2, row: 2 }, true);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ col: 2, row: 2 });
  });

  it("returns empty path for the same maze WITHOUT ignoreWalls", () => {
    const cols = 3;
    const rows = 3;
    const walls = new Uint8Array(cols * rows).fill(15);
    const maze: Maze = {
      cols,
      rows,
      walls,
      cellSize: CELL_SIZE,
      teleportPads: [
        { col: 0, row: 0 },
        { col: 2, row: 0 },
        { col: 2, row: 2 },
        { col: 0, row: 2 },
      ],
      exitCells: [],
    };
    expect(bfsPath(maze, { col: 0, row: 0 }, { col: 2, row: 2 })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// TC-23: Player bullet does NOT damage Phantom while phasing
describe("TC-23 Phantom immune while phasing", () => {
  it("hp unchanged and bullet survives when Phantom is phasing", () => {
    const phantom: Phantom = {
      kind: "phantom",
      id: 1,
      col: 5,
      row: 5,
      hp: 2,
      moveTimer: 1,
      path: [],
      pathAge: 0,
      shootCooldown: 1,
      phasing: true,
    };
    const ec = cellCenter(openMaze(11, 11), 5, 5);
    const state = minimalState({
      enemies: [phantom],
      bullets: [{ id: 1, x: ec.x, y: ec.y, vx: BULLET_SPEED, vy: 0, fromPlayer: true }],
      nextBulletId: 2,
    });
    step(state, IDLE, 0.016);
    const ph = state.enemies.find((e) => e.kind === "phantom") as Phantom | undefined;
    expect(ph).toBeDefined();
    expect(ph!.hp).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TC-24: Player bullet damages Phantom when NOT phasing
describe("TC-24 Phantom vulnerable when not phasing", () => {
  it("hp decrements when Phantom is not phasing", () => {
    const phantom: Phantom = {
      kind: "phantom",
      id: 1,
      col: 5,
      row: 5,
      hp: 2,
      moveTimer: 1,
      path: [],
      pathAge: 0,
      shootCooldown: 1,
      phasing: false,
    };
    const ec = cellCenter(openMaze(11, 11), 5, 5);
    const state = minimalState({
      enemies: [phantom],
      bullets: [{ id: 1, x: ec.x, y: ec.y, vx: BULLET_SPEED, vy: 0, fromPlayer: true }],
      nextBulletId: 2,
    });
    step(state, IDLE, 0.016);
    // Phantom took a hit — hp decremented
    const ph = state.enemies.find((e) => e.kind === "phantom") as Phantom | undefined;
    expect(ph).toBeDefined();
    expect(ph!.hp).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// TC-25: Enemy bullet kills player on last life
describe("TC-25 enemy bullet kills player on last life", () => {
  it("phase becomes gameover and events include playerDie and gameover", () => {
    const state = minimalState({ lives: 1 });
    state.player.invuln = 0;
    state.player.respawnTimer = 0;
    // Place enemy bullet exactly at player position
    state.bullets.push({ id: 1, x: state.player.x, y: state.player.y, vx: 0, vy: 0, fromPlayer: false });
    state.nextBulletId = 2;
    step(state, IDLE, 0.016);
    expect(state.phase).toBe("gameover");
    expect(state.events).toContain("playerDie");
    expect(state.events).toContain("gameover");
  });
});

// ---------------------------------------------------------------------------
// TC-26: Enemy bullet ignored while player is invulnerable
describe("TC-26 enemy bullet ignored while invulnerable", () => {
  it("lives unchanged and no playerHit event while invuln > 0", () => {
    const state = minimalState({ lives: 3 });
    state.player.invuln = 1.5;
    state.bullets.push({ id: 1, x: state.player.x, y: state.player.y, vx: 0, vy: 0, fromPlayer: false });
    state.nextBulletId = 2;
    step(state, IDLE, 0.016);
    expect(state.lives).toBe(3);
    expect(state.events).not.toContain("playerHit");
  });
});

// ---------------------------------------------------------------------------
// TC-27: bulletHitsWall returns true when bullet crosses a wall
describe("TC-27 bulletHitsWall true on wall crossing", () => {
  it("returns true when bullet at cell center moves east into an E wall", () => {
    const maze = openMaze(11, 11);
    // Add E wall on cell (2,2)
    maze.walls[2 * 11 + 2] |= 2;
    maze.walls[2 * 11 + 3] |= 8;

    const bx = 2 * CELL_SIZE + CELL_SIZE / 2; // center of (2,2)
    const by = 2 * CELL_SIZE + CELL_SIZE / 2;
    // Move far enough east to cross the cell boundary
    const dt = (CELL_SIZE / 2 + 5) / BULLET_SPEED;
    expect(bulletHitsWall(maze, bx, by, BULLET_SPEED, 0, dt)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TC-28: bulletHitsWall returns false in open corridor
describe("TC-28 bulletHitsWall false in open corridor", () => {
  it("returns false when E face of cell is open and bullet moves east", () => {
    const maze = openMaze(11, 11); // all internal walls open
    const bx = 2 * CELL_SIZE + CELL_SIZE / 2;
    const by = 2 * CELL_SIZE + CELL_SIZE / 2;
    const dt = (CELL_SIZE / 2 + 5) / BULLET_SPEED;
    expect(bulletHitsWall(maze, bx, by, BULLET_SPEED, 0, dt)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TC-29: applyPowerup("TripleBullets") refreshes timer if already active
describe("TC-29 applyPowerup refreshes timer", () => {
  it("resets powerupTimer to POWERUP_TTL when TripleBullets already active", () => {
    const state = minimalState();
    state.player.activePowerup = "TripleBullets";
    state.player.powerupTimer = 2.0;
    applyPowerup(state, "TripleBullets");
    expect(state.player.powerupTimer).toBe(POWERUP_TTL);
    expect(state.player.activePowerup).toBe("TripleBullets");
  });
});

// ---------------------------------------------------------------------------
// TC-30: applyPowerup("Decoy") does not exceed DECOY_MAX_HELD
describe("TC-30 applyPowerup Decoy cap", () => {
  it("decoyCharges stays at DECOY_MAX_HELD when already at cap", () => {
    const state = minimalState({ decoyCharges: DECOY_MAX_HELD });
    applyPowerup(state, "Decoy");
    expect(state.decoyCharges).toBe(DECOY_MAX_HELD);
    expect(state.player.activePowerup).toBeNull();
  });

  it("increments decoyCharges when below cap", () => {
    const state = minimalState({ decoyCharges: 1 });
    applyPowerup(state, "Decoy");
    expect(state.decoyCharges).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TC-31: Player walking over pickup triggers applyPowerup and removes pickup
describe("TC-31 powerup pickup", () => {
  it("pickup is removed and powerup applied when player is within pickup radius", () => {
    const maze = openMaze(11, 11);
    // Place pickup at cell (5,5) — same as player
    const state = minimalState({
      maze,
      powerupPickups: [{ id: 1, col: 5, row: 5, kind: "SpeedBoost" }],
      nextPickupId: 2,
    });
    // Player is already at center of (5,5)
    step(state, IDLE, 0.016);
    expect(state.powerupPickups).toHaveLength(0);
    expect(state.player.activePowerup).toBe("SpeedBoost");
    expect(state.events).toContain("powerupPickup");
  });
});

// ---------------------------------------------------------------------------
// TC-32: Last enemy killed opens exits
describe("TC-32 last enemy killed opens exits", () => {
  it("exitsOpen becomes true, phase becomes levelclear, and exitsOpen event fires", () => {
    const maze = openMaze(11, 11);
    const grunt = makeGrunt(1, 5, 3, { hp: 1, moveTimer: 1, shootCooldown: 1 });
    const ec = cellCenter(maze, 5, 3);
    const state = minimalState({
      maze,
      enemies: [grunt],
      bullets: [{ id: 1, x: ec.x, y: ec.y, vx: BULLET_SPEED, vy: 0, fromPlayer: true }],
      nextBulletId: 2,
    });
    step(state, IDLE, 0.016);
    expect(state.enemies).toHaveLength(0);
    expect(state.exitsOpen).toBe(true);
    expect(state.phase).toBe("levelclear");
    expect(state.events).toContain("exitsOpen");
    expect(state.score).toBe(ENEMY_KILL_SCORE);
  });
});

// ---------------------------------------------------------------------------
// TC-34: Dropping a decoy places it at player cell and decrements charges
describe("TC-34 drop decoy", () => {
  it("decoy placed at player cell and decoyCharges decrements by 1", () => {
    const state = minimalState({ decoyCharges: 2 });
    step(state, { ...IDLE, dropDecoy: true }, 0.016);
    expect(state.decoy).not.toBeNull();
    expect(state.decoyCharges).toBe(1);
    const playerCell = cellAt(state.maze, state.player.x, state.player.y);
    expect(state.decoy!.col).toBe(playerCell.col);
    expect(state.decoy!.row).toBe(playerCell.row);
  });

  it("decoy not placed when decoyCharges is 0", () => {
    const state = minimalState({ decoyCharges: 0 });
    step(state, { ...IDLE, dropDecoy: true }, 0.016);
    expect(state.decoy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TC-36: Decoy ttl expiry removes decoy
describe("TC-36 decoy ttl expiry", () => {
  it("decoy is set to null after ttl drops to zero", () => {
    const center = cellCenter(openMaze(11, 11), 3, 3);
    const state = minimalState({
      decoy: { col: 3, row: 3, x: center.x, y: center.y, ttl: 0.01 },
    });
    step(state, IDLE, 0.02); // dt > ttl → expires
    expect(state.decoy).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bonus: cellCenter and cellAt round-trip
describe("cellCenter / cellAt", () => {
  it("cellAt(cellCenter(col, row)) returns the same cell", () => {
    const maze = openMaze(11, 11);
    for (const [c, r] of [
      [0, 0],
      [5, 5],
      [10, 10],
    ]) {
      const { x, y } = cellCenter(maze, c, r);
      const back = cellAt(maze, x, y);
      expect(back.col).toBe(c);
      expect(back.row).toBe(r);
    }
  });
});
