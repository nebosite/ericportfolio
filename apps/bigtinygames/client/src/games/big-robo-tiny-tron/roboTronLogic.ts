// Big Robo Tiny Tron — pure game logic types, contracts, and constants.
// No React / browser imports. Every rule the step() function enforces is
// described here; unit tests live in roboTronLogic.test.ts; the canvas
// component (BigRoboTinyTron.tsx) owns only rendering, sound, and input wiring.
//
// Coordinate systems
// ------------------
// Two coordinate spaces coexist:
//
//   Cell space  — integer (col, row) grid positions.
//     Used for: maze topology, enemy positions, human placement, powerup
//     placement, and decoy placement. An enemy is authoritative at its
//     (col, row); the renderer maps these to pixels via cellCenter().
//
//   Pixel space — continuous (x, y) real coordinates.
//     Used for: the player, all bullets. The player can occupy any pixel
//     inside a corridor; bullets travel freely between walls.
//
//   Pixel center of cell (col, row) =
//     { x: col * CELL_SIZE + CELL_SIZE / 2,
//       y: row * CELL_SIZE + CELL_SIZE / 2 }
//
// Maze wall encoding
// ------------------
// Each cell stores a bitmask of which WALLS ARE PRESENT on its faces:
//   N = 1   (the face toward row - 1 is a wall)
//   E = 2   (the face toward col + 1 is a wall)
//   S = 4   (the face toward row + 1 is a wall)
//   W = 8   (the face toward col - 1 is a wall)
//
// A value of 0 means the cell is open on all four sides (impossible in a
// well-formed maze, but valid for reading). 15 (0b1111) is a fully walled
// cell — an isolated pillar that the backtracker never visits.
//
// The outer border cells always have their outward-facing bit set (solid
// outer ring). Two adjacent cells that share a corridor have their shared
// face bit cleared in BOTH cells (the bitmask is redundant but makes
// direction queries O(1) without a neighbor lookup).
//
// Wall bitmasks are stored in a flat Uint8Array:
//   index = row * cols + col

// ---------------------------------------------------------------------------
// Primitive types

/** A 2D vector / point in pixel space. */
export type Vec2 = { x: number; y: number };

/** An integer cell coordinate in the maze grid. */
export interface CellPos {
  col: number;
  row: number;
}

// ---------------------------------------------------------------------------
// Maze

export interface Maze {
  /** Number of cells in the horizontal direction. */
  cols: number;
  /** Number of cells in the vertical direction. */
  rows: number;
  /**
   * Per-cell wall bitmask: N=1, E=2, S=4, W=8.
   * Flat array, index = row * cols + col.
   * Set bit ⟹ the named face has a wall.
   */
  walls: Uint8Array;
  /** Pixel size of one cell (square). All cells are the same size. */
  cellSize: number;
  /**
   * The four corner teleport pad cells in order [NW, NE, SE, SW].
   * Each pad occupies the corner cell of the maze. Walking onto a pad
   * teleports the player to the diagonally opposite pad (NW ↔ SE, NE ↔ SW).
   * Enemies are NOT teleported.
   */
  teleportPads: readonly [CellPos, CellPos, CellPos, CellPos];
  /**
   * Cells on the outer border that serve as exits to the next level.
   * These cells have their outward-facing wall bit cleared in the walls array
   * once exitsOpen is true (the renderer reads the walls array for this).
   * Typically one cell on each of the four sides, chosen by the generator.
   * The generator places exits at level start; step() opens them (clears the
   * wall bit in place) when exitsOpen first becomes true.
   */
  exitCells: CellPos[];
}

// ---------------------------------------------------------------------------
// Player

export interface Player {
  /** Pixel position of the player's center. */
  x: number;
  y: number;
  /**
   * The last non-zero aim direction, one of the 8 unit vectors (±1, ±1),
   * (±1, 0), or (0, ±1). Persists between frames so releasing aim keys
   * keeps the player oriented for the next shot.
   */
  aimDir: Vec2;
  /**
   * Seconds of post-hit invincibility remaining. Player is immune to damage
   * and flickers visually while invuln > 0.
   */
  invuln: number;
  /**
   * Seconds until the player may fire again (shared across all powerup modes).
   * The TripleBullets and AllDirections powerups reduce this by a multiplier,
   * not by replacing it entirely.
   */
  shootCooldown: number;
  /**
   * Seconds remaining in the respawn delay (player is off-screen while > 0).
   * Set to RESPAWN_DELAY when a life is lost; cleared to 0 when the player
   * re-enters the maze at the spawn cell.
   */
  respawnTimer: number;
  /**
   * The currently active timed powerup, or null when none is active.
   * A "Decoy" here means the player is holding an unused Decoy pickup —
   * it is consumed when input.dropDecoy fires and a decoy is placed.
   * The three timed powerups (TripleBullets, AllDirections, SpeedBoost)
   * expire when powerupTimer reaches 0.
   */
  activePowerup: PowerupKind | null;
  /**
   * Seconds remaining on the active timed powerup (TripleBullets, AllDirections,
   * SpeedBoost). Ignored when activePowerup is null or "Decoy".
   */
  powerupTimer: number;
}

// ---------------------------------------------------------------------------
// Enemies — discriminated union on `kind`

/**
 * Fields shared by all enemy types.
 *
 * Enemies move in cell space: they advance one cell at a time along a BFS path
 * toward their current target (the player, or the active decoy if one exists).
 * The `moveTimer` counts down; when it reaches 0 the enemy steps into path[0]
 * (updating col/row) and resets the timer. The path is recomputed lazily
 * (pathAge tracks staleness; one enemy's path is refreshed per step() call to
 * spread BFS cost across frames — see Design Risk #3).
 *
 * Enemies fire at the player when shootCooldown ≤ 0 and the player occupies
 * an adjacent cell or a cell in the same row/column with line of sight
 * (no wall bit set between them along that axis).
 */
interface EnemyBase {
  /**
   * Unique, stable id for this enemy. Assigned from GameState.nextEnemyId at
   * spawn; never reused. Used as React key and for targeting logic.
   */
  id: number;
  /** Current cell column (authoritative position in logic). */
  col: number;
  /** Current cell row. */
  row: number;
  /** Hit points remaining. Removed from enemies[] when hp reaches 0. */
  hp: number;
  /**
   * Seconds until this enemy takes its next cell step.
   * When it reaches 0, the enemy moves to path[0] and resets to the
   * kind-specific MOVE_INTERVAL constant (with a small random jitter to
   * prevent lockstep marching).
   */
  moveTimer: number;
  /**
   * Pre-computed BFS path from the enemy's current cell to its target.
   * path[0] is the NEXT cell to move into; path is consumed head-first.
   * Empty when the enemy has no reachable path (surrounded by walls,
   * or target is unreachable).
   */
  path: CellPos[];
  /**
   * Seconds since the current path was computed. When this exceeds
   * ENEMY_PATH_AGE the path is marked for recomputation on the next
   * round-robin tick.
   */
  pathAge: number;
  /** Seconds until this enemy may fire again. */
  shootCooldown: number;
}

/**
 * Grunt — the standard enemy.
 * 1 HP. BFS pathfinding through maze corridors. Fires a single bullet aimed
 * directly at the player when cooldown expires and line of sight exists.
 * Provides the immediate threat that validates the maze-constrains-combat premise.
 */
export interface Grunt extends EnemyBase {
  kind: "grunt";
}

/**
 * Enforcer — the second enemy archetype (introduced at level 3+).
 * 3 HP. Same BFS as the Grunt but moves ~25% slower (ENFORCER_MOVE_INTERVAL).
 * Fires a spread of ENFORCER_SPREAD_COUNT bullets fanned across
 * ENFORCER_SPREAD_ANGLE radians around its aim vector. Forces the player to
 * respect positional discipline — a spread shot covers the axis-sliding escape.
 */
export interface Enforcer extends EnemyBase {
  kind: "enforcer";
}

/**
 * Phantom — the signature enemy (post-MVP; include the type now so the
 * discriminated union is complete before the feature ships).
 * 2 HP. Ignores wall bitmasks when computing its BFS path: it travels through
 * walls as if they were open corridors. While `phasing` is true the Phantom is
 * mid-wall and IMMUNE to player bullets (bullets pass through it).
 * Its debut requires a 10-second telegraph (Design Risk #1) — the renderer
 * plays the debut animation when an event "phantomDebut" is in state.events.
 */
export interface Phantom extends EnemyBase {
  kind: "phantom";
  /**
   * True while the Phantom is occupying a wall tile (between two corridor
   * cells). The renderer draws it as a translucent ghost; bullet collisions
   * are skipped while phasing.
   */
  phasing: boolean;
}

export type Enemy = Grunt | Enforcer | Phantom;
export type EnemyKind = Enemy["kind"];

// ---------------------------------------------------------------------------
// Humans (yellow dots)

/**
 * A human rescue target placed at a fixed cell at level start.
 * Contact with the player grants HUMAN_RESCUE_SCORE and removes the human.
 * A Grunt occupying the same cell kills the human: deduct HUMAN_KILL_PENALTY
 * and remove it. Dead humans are removed from the array immediately after
 * the penalty event is emitted.
 */
export interface Human {
  /**
   * Unique stable id; assigned from GameState.nextHumanId at level init.
   */
  id: number;
  col: number;
  row: number;
}

// ---------------------------------------------------------------------------
// Bullets

/**
 * A bullet in flight. Player bullets and enemy bullets share this type.
 *
 * Player bullets:
 *   fromPlayer = true. Travel in the player's current aimDir (8-way).
 *   TripleBullets: three bullets fired simultaneously, spread ±15°.
 *   AllDirections: eight bullets fired simultaneously in the 8 cardinal/diagonal dirs.
 *
 * Enemy bullets:
 *   fromPlayer = false. Aimed at the player's pixel position at fire time.
 *   Enforcer spread: three simultaneous bullets, all fromPlayer = false.
 *
 * Bullets are destroyed on wall contact or when they leave the maze bounds.
 * Player bullets deal 1 damage to any enemy they strike; enemy bullets
 * trigger a player hit if they reach the player's pixel circle.
 */
export interface Bullet {
  /** Unique id from GameState.nextBulletId. */
  id: number;
  x: number;  // pixel position
  y: number;
  vx: number; // pixels/second
  vy: number;
  fromPlayer: boolean;
}

// ---------------------------------------------------------------------------
// Powerup pickups (on the map, not yet collected)

/**
 * The four powerup variants.
 *
 * TripleBullets  — player fires 3 bullets per shot (spread ±15°) for POWERUP_TTL s.
 * AllDirections  — player fires 8 bullets simultaneously per shot for POWERUP_TTL s.
 * SpeedBoost     — player moves at PLAYER_SPEED * PLAYER_SPEED_BOOST for POWERUP_TTL s.
 * Decoy          — one-shot: the player can drop a decoy sprite that all enemies
 *                  treat as their BFS target until it expires (DECOY_TTL s).
 *                  Picking up a second Decoy while holding one extends the held count
 *                  by 1 (tracked separately from activePowerup, as a simple integer).
 */
export type PowerupKind = "TripleBullets" | "AllDirections" | "SpeedBoost" | "Decoy";

/**
 * A powerup pickup in the maze. Removed when the player occupies the same cell
 * (player center within POWERUP_PICKUP_RADIUS of the cell center).
 */
export interface PowerupPickup {
  /** Unique id from GameState.nextPickupId. */
  id: number;
  col: number;
  row: number;
  kind: PowerupKind;
}

// ---------------------------------------------------------------------------
// Decoy

/**
 * An active decoy placed by the player via the Decoy powerup.
 *
 * While a decoy is present on the map, all enemies compute their BFS target
 * as the decoy's cell instead of the player's cell. This is the entire
 * targeting override — no special enemy mode is needed.
 *
 * The decoy expires after DECOY_TTL seconds (ttl counts down to 0).
 * At expiry it is removed from state (state.decoy = null) and enemies
 * resume pathing to the player.
 *
 * DESIGN RISK #2 (from design doc): The decoy MUST be visually distinct from
 * the player sprite. The renderer is responsible for this; the logic provides
 * the cell position and ttl. Suggested: decoy renders as a dim, pulsing copy
 * of the player in a noticeably different color (e.g. dim magenta vs the player's
 * bright white/yellow).
 */
export interface DecoyEntity {
  col: number;
  row: number;
  /** Pixel center of the cell (cached for renderer). */
  x: number;
  y: number;
  /** Seconds until the decoy expires. Counts down each step. */
  ttl: number;
}

// ---------------------------------------------------------------------------
// Sound / animation events

/**
 * Rules push SoundEvents onto state.events each step; the canvas component
 * drains and plays them. The array is cleared at the START of each step()
 * call (not the end), so the renderer always sees events from the most
 * recently completed step.
 */
export type SoundEvent =
  | "playerShoot"     // player bullet fired
  | "enemyShoot"      // enemy bullet fired
  | "enemyDie"        // an enemy reduced to 0 HP
  | "playerHit"       // player struck by an enemy bullet (life lost)
  | "playerDie"       // lives reached 0 → game over transition
  | "humanRescue"     // player contacted a human (+HUMAN_RESCUE_SCORE)
  | "humanDie"        // a Grunt reached a human (−HUMAN_KILL_PENALTY)
  | "powerupPickup"   // player collected a powerup
  | "teleport"        // player used a corner teleport pad
  | "exitsOpen"       // all enemies dead, exits opening (play a level-clear chime)
  | "levelAdvance"    // player walked through an exit → next level loaded
  | "phantomDebut"    // first Phantom appears (triggers 10-second telegraph animation)
  | "gameover";       // game ended

// ---------------------------------------------------------------------------
// Game phase

/**
 * The top-level phase of the game loop.
 * The canvas component uses this to switch between title screen, gameplay,
 * and game-over overlays. Logic runs only in "playing" phase.
 */
export type GamePhase =
  | "title"       // title screen; step() is a no-op
  | "playing"     // active gameplay
  | "levelclear"  // all enemies dead, exits open; player walks to exit
  | "gameover";   // game over; step() is a no-op

// ---------------------------------------------------------------------------
// Root game state

/**
 * The complete, authoritative game state.
 *
 * step() MUTATES this object and returns the same reference (matching the
 * pattern in invadersLogic.ts and pipeLogic.ts). The canvas component stores
 * it in a ref (not React state) and redraws after each step.
 *
 * All arrays are plain mutable arrays; use splice/push for removes/adds.
 * Typed arrays (walls in Maze) are mutated in place by the generator and
 * by step() when exits open.
 */
export interface GameState {
  phase: GamePhase;
  level: number;
  score: number;
  lives: number;
  maze: Maze;
  player: Player;
  enemies: Enemy[];
  humans: Human[];
  bullets: Bullet[];
  powerupPickups: PowerupPickup[];
  /** The currently active decoy, or null if none has been placed. */
  decoy: DecoyEntity | null;
  /**
   * Number of unused Decoy charges the player is holding.
   * Increments when a Decoy pickup is collected; decrements when input.dropDecoy
   * is consumed. Capped at DECOY_MAX_HELD to prevent hoarding.
   */
  decoyCharges: number;
  /**
   * True once all enemies have been eliminated. When this flips to true,
   * step() clears the outward wall bit on each exitCell in the maze so the
   * renderer sees them as open corridors, and emits "exitsOpen".
   */
  exitsOpen: boolean;
  /**
   * Index into state.enemies[] of the enemy whose BFS path will be
   * recomputed on the NEXT step() call. Cycles 0 → enemies.length − 1.
   * This is the staggering mechanism for Design Risk #3.
   */
  bfsRefreshIndex: number;
  /**
   * Sound/animation events fired during the most recent step() call.
   * Cleared at the start of each step(); populated by rules during it.
   * The canvas component reads these once per frame after step() returns.
   */
  events: SoundEvent[];
  /**
   * Monotonically increasing id counters. Each new entity gets the next
   * value; the counter increments immediately after. Never reused within
   * a session, so ids are safe as React keys and as targeting identifiers.
   */
  nextBulletId: number;
  nextEnemyId: number;
  nextHumanId: number;
  nextPickupId: number;
}

// ---------------------------------------------------------------------------
// Input state

/**
 * A snapshot of player input for one step() call.
 *
 * The canvas component translates raw keyboard/gamepad state into this
 * plain struct and passes it to step(). step() never reads from the DOM.
 *
 * All directional fields use integer values (-1, 0, or 1) to match the
 * existing input.ts conventions in this repo.
 */
export interface InputState {
  /**
   * WASD movement intent. Each component is -1, 0, or 1.
   * Diagonal combinations (moveX ≠ 0 && moveY ≠ 0) are valid.
   * Axis-sliding: if the primary move direction is blocked by a wall,
   * step() attempts to slide along the perpendicular axis.
   */
  moveX: number;
  moveY: number;
  /**
   * Arrow-key aim direction. Each component is -1, 0, or 1.
   * All 8 combinations of (±1, ±1), (±1, 0), (0, ±1) are valid aims.
   * (0, 0) means no arrow key is held; the player retains the last aimDir
   * stored in player.aimDir.
   */
  aimX: number;
  aimY: number;
  /**
   * True while at least one arrow key is held, meaning the player wants
   * to fire this frame. Shooting is gated by player.shootCooldown; step()
   * fires when fire = true AND cooldown ≤ 0.
   */
  fire: boolean;
  /**
   * One-shot consume flag: place a decoy at the player's current cell.
   * The canvas component sets this to true for exactly ONE frame when the
   * player presses the designated drop-decoy key, then resets it to false.
   * step() ignores this if decoyCharges = 0 or a decoy is already live.
   */
  dropDecoy: boolean;
}

// ---------------------------------------------------------------------------
// Tuning constants
//
// All values exported so the renderer and tests can reference them without
// hard-coding magic numbers. Adjust here; everything else follows.

/** Pixel size of each maze cell. Keep a multiple of 8 for crisp pixel walls. */
export const CELL_SIZE = 40;

/** Player collision radius (pixel circle). */
export const PLAYER_RADIUS = 7;

/** Base player movement speed in pixels/second. */
export const PLAYER_SPEED = 180;

/** Movement speed multiplier while SpeedBoost is active. */
export const PLAYER_SPEED_BOOST = 1.6;

/** Minimum seconds between player shots (base rate, no powerup). */
export const PLAYER_SHOOT_COOLDOWN = 0.22;

/** Player bullet travel speed in pixels/second. */
export const BULLET_SPEED = 340;

/** Bullet collision radius in pixels (treated as a point hit on walls). */
export const BULLET_RADIUS = 3;

/**
 * Player bullet spread angle in radians for the TripleBullets powerup.
 * Centre bullet fires along aimDir; outer bullets fan ±TRIPLE_SPREAD from it.
 */
export const TRIPLE_SPREAD = Math.PI / 12; // 15°

/**
 * Seconds between Grunt cell steps.
 * A small random jitter (±10%) is applied each move to avoid lockstep.
 */
export const GRUNT_MOVE_INTERVAL = 0.22;

/** Seconds between Enforcer cell steps (slower than the Grunt). */
export const ENFORCER_MOVE_INTERVAL = 0.30;

/** Seconds between Phantom cell steps. */
export const PHANTOM_MOVE_INTERVAL = 0.20;

/** Seconds between Grunt shots. */
export const GRUNT_SHOOT_COOLDOWN = 1.8;

/** Seconds between Enforcer shots. */
export const ENFORCER_SHOOT_COOLDOWN = 2.4;

/** Number of bullets in an Enforcer spread shot. */
export const ENFORCER_SPREAD_COUNT = 3;

/** Total fan angle of the Enforcer spread (radians). Centred on aimDir. */
export const ENFORCER_SPREAD_ANGLE = Math.PI / 6; // 30° total, so ±15° each side

/**
 * Seconds before a stale BFS path is re-queued for refresh.
 * The actual recompute happens on the enemy's bfsRefreshIndex turn
 * (one enemy per step call), so real latency is pathAge + enemies.length * dt.
 */
export const ENEMY_PATH_AGE = 0.5;

/**
 * Minimum cell-distance from the player at which an enemy may spawn.
 * Prevents enemies from spawning directly on top of the player.
 */
export const MIN_ENEMY_SPAWN_DIST = 5;

/** Seconds of post-hit player invincibility. */
export const INVULN_DURATION = 2.0;

/** Seconds of delay before the player re-enters the maze after losing a life. */
export const RESPAWN_DELAY = 1.5;

/** Starting lives. */
export const LIVES_START = 3;

/** Score awarded when the player rescues a human by contact. */
export const HUMAN_RESCUE_SCORE = 1000;

/** Score penalty when a Grunt eliminates a human (subtracted from score). */
export const HUMAN_KILL_PENALTY = 500;

/** Score awarded per enemy kill (all types). */
export const ENEMY_KILL_SCORE = 100;

/** Number of humans placed per level. */
export const HUMAN_COUNT = 3;

/** Seconds the TripleBullets / AllDirections / SpeedBoost powerups last. */
export const POWERUP_TTL = 8.0;

/** Seconds an active Decoy persists before expiring. */
export const DECOY_TTL = 6.0;

/** Maximum Decoy charges the player can hold simultaneously. */
export const DECOY_MAX_HELD = 3;

/**
 * Pixel radius within which the player triggers a teleport pad.
 * The player's center must be within this distance of the pad cell's center.
 */
export const TELEPORT_PAD_RADIUS = 10;

/**
 * Pixel radius within which the player collects a powerup pickup.
 */
export const POWERUP_PICKUP_RADIUS = 14;

/**
 * Pixel radius within which the player contacts a human (rescuing it).
 */
export const HUMAN_CONTACT_RADIUS = 12;

/**
 * Grunt count at level start = ENEMIES_BASE + (level - 1) * ENEMIES_PER_LEVEL.
 * Enforcers are mixed in from level 3+: one Enforcer per 4 enemies (rounded).
 */
export const ENEMIES_BASE = 3;
export const ENEMIES_PER_LEVEL = 2;

// ---------------------------------------------------------------------------
// Internal wall-bit constants (N=1, E=2, S=4, W=8)

const N_BIT = 1;
const E_BIT = 2;
const S_BIT = 4;
const W_BIT = 8;

// ---------------------------------------------------------------------------
// Implementations

// ---------------------------------------------------------------------------
// Pure renderer / AI helpers

export function mazeCellPassable(
  maze: Maze,
  col: number,
  row: number,
  dir: "N" | "E" | "S" | "W",
): boolean {
  const bit = dir === "N" ? N_BIT : dir === "E" ? E_BIT : dir === "S" ? S_BIT : W_BIT;
  return !(maze.walls[row * maze.cols + col] & bit);
}

export function cellCenter(maze: Maze, col: number, row: number): Vec2 {
  return {
    x: col * maze.cellSize + maze.cellSize / 2,
    y: row * maze.cellSize + maze.cellSize / 2,
  };
}

export function cellAt(maze: Maze, x: number, y: number): CellPos {
  return {
    col: Math.floor(x / maze.cellSize),
    row: Math.floor(y / maze.cellSize),
  };
}

export function teleportPadPositions(
  maze: Maze,
): readonly [CellPos, CellPos, CellPos, CellPos] {
  return maze.teleportPads;
}

export function exitPositions(maze: Maze): CellPos[] {
  return maze.exitCells;
}

export function bfsPath(
  maze: Maze,
  start: CellPos,
  goal: CellPos,
  ignoreWalls = false,
): CellPos[] {
  const { cols, rows } = maze;
  const total = cols * rows;
  const visited = new Uint8Array(total);
  const parent = new Int32Array(total).fill(-1);

  const DIRS = [
    { dc: 0, dr: -1, bit: N_BIT },
    { dc: 1, dr: 0, bit: E_BIT },
    { dc: 0, dr: 1, bit: S_BIT },
    { dc: -1, dr: 0, bit: W_BIT },
  ] as const;

  const startIdx = start.row * cols + start.col;
  const goalIdx = goal.row * cols + goal.col;

  visited[startIdx] = 1;
  const queue: number[] = [startIdx];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    if (cur === goalIdx) break;
    const col = cur % cols;
    const row = Math.floor(cur / cols);
    for (const d of DIRS) {
      const nc = col + d.dc;
      const nr = row + d.dr;
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      if (!ignoreWalls && maze.walls[cur] & d.bit) continue;
      const ni = nr * cols + nc;
      if (visited[ni]) continue;
      visited[ni] = 1;
      parent[ni] = cur;
      queue.push(ni);
    }
  }

  if (!visited[goalIdx]) return [];

  const path: CellPos[] = [];
  let cur = goalIdx;
  while (cur !== startIdx) {
    path.push({ col: cur % cols, row: Math.floor(cur / cols) });
    cur = parent[cur];
  }
  path.reverse();
  return path;
}

export function applyPowerup(state: GameState, kind: PowerupKind): void {
  if (kind === "Decoy") {
    if (state.decoyCharges < DECOY_MAX_HELD) state.decoyCharges++;
    return;
  }
  state.player.activePowerup = kind;
  state.player.powerupTimer = POWERUP_TTL;
}

export function bulletHitsWall(
  maze: Maze,
  bx: number,
  by: number,
  vx: number,
  vy: number,
  dt: number,
): boolean {
  const nx = bx + vx * dt;
  const ny = by + vy * dt;
  const { cols, rows, cellSize } = maze;

  if (nx < 0 || ny < 0 || nx >= cols * cellSize || ny >= rows * cellSize) return true;

  const oldCol = Math.floor(bx / cellSize);
  const oldRow = Math.floor(by / cellSize);
  const newCol = Math.floor(nx / cellSize);
  const newRow = Math.floor(ny / cellSize);

  if (newCol < 0 || newCol >= cols || newRow < 0 || newRow >= rows) return true;
  if (newCol === oldCol && newRow === oldRow) return false;

  const dc = Math.sign(newCol - oldCol);
  const dr = Math.sign(newRow - oldRow);

  if (dc !== 0 && maze.walls[oldRow * cols + oldCol] & (dc > 0 ? E_BIT : W_BIT)) return true;
  if (dr !== 0 && maze.walls[oldRow * cols + oldCol] & (dr > 0 ? S_BIT : N_BIT)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Maze generator — iterative recursive backtracker

function buildMaze(cols: number, rows: number, rng: () => number): Uint8Array {
  const walls = new Uint8Array(cols * rows).fill(15);
  const visited = new Uint8Array(cols * rows);

  const DIRS = [
    { dc: 0, dr: -1, bit: N_BIT, opp: S_BIT },
    { dc: 1, dr: 0, bit: E_BIT, opp: W_BIT },
    { dc: 0, dr: 1, bit: S_BIT, opp: N_BIT },
    { dc: -1, dr: 0, bit: W_BIT, opp: E_BIT },
  ] as const;

  const startCol = Math.floor(cols / 2);
  const startRow = Math.floor(rows / 2);
  visited[startRow * cols + startCol] = 1;
  const stack: CellPos[] = [{ col: startCol, row: startRow }];

  while (stack.length > 0) {
    const { col, row } = stack[stack.length - 1];
    const avail = DIRS.filter((d) => {
      const nc = col + d.dc;
      const nr = row + d.dr;
      return nc >= 0 && nc < cols && nr >= 0 && nr < rows && !visited[nr * cols + nc];
    });
    if (avail.length === 0) {
      stack.pop();
      continue;
    }
    const d = avail[Math.floor(rng() * avail.length)];
    const nc = col + d.dc;
    const nr = row + d.dr;
    walls[row * cols + col] &= ~d.bit;
    walls[nr * cols + nc] &= ~d.opp;
    visited[nr * cols + nc] = 1;
    stack.push({ col: nc, row: nr });
  }

  return walls;
}

// ---------------------------------------------------------------------------
// initialState

export function initialState(
  cols: number,
  rows: number,
  level: number,
  rng: () => number = Math.random,
): GameState {
  if (cols % 2 === 0) cols++;
  if (rows % 2 === 0) rows++;

  const walls = buildMaze(cols, rows, rng);
  const midCol = Math.floor(cols / 2);
  const midRow = Math.floor(rows / 2);

  const teleportPads: [CellPos, CellPos, CellPos, CellPos] = [
    { col: 0, row: 0 },
    { col: cols - 1, row: 0 },
    { col: cols - 1, row: rows - 1 },
    { col: 0, row: rows - 1 },
  ];

  // One exit per edge, mid-point of each edge. Outward wall bits remain SET (sealed).
  const exitCells: CellPos[] = [
    { col: midCol, row: 0 },
    { col: cols - 1, row: midRow },
    { col: midCol, row: rows - 1 },
    { col: 0, row: midRow },
  ];

  const maze: Maze = { cols, rows, walls, cellSize: CELL_SIZE, teleportPads, exitCells };

  const playerCenter = cellCenter(maze, midCol, midRow);
  const player: Player = {
    x: playerCenter.x,
    y: playerCenter.y,
    aimDir: { x: 1, y: 0 },
    invuln: 0,
    shootCooldown: 0,
    respawnTimer: 0,
    activePowerup: null,
    powerupTimer: 0,
  };

  const totalEnemies = ENEMIES_BASE + (level - 1) * ENEMIES_PER_LEVEL;
  const enforcerCount = level >= 3 ? Math.round(totalEnemies / 4) : 0;
  const enemies: Enemy[] = [];
  let nextEnemyId = 1;
  const occupied = new Set<string>([`${midCol},${midRow}`]);

  for (let i = 0; i < totalEnemies; i++) {
    let eCol = 0;
    let eRow = 0;
    let attempts = 0;
    do {
      eCol = Math.floor(rng() * cols);
      eRow = Math.floor(rng() * rows);
      attempts++;
    } while (
      attempts < 2000 &&
      (occupied.has(`${eCol},${eRow}`) ||
        Math.abs(eCol - midCol) + Math.abs(eRow - midRow) < MIN_ENEMY_SPAWN_DIST)
    );
    occupied.add(`${eCol},${eRow}`);

    const isEnforcer = i < enforcerCount;
    const base = {
      id: nextEnemyId++,
      col: eCol,
      row: eRow,
      hp: isEnforcer ? 3 : 1,
      moveTimer: isEnforcer ? ENFORCER_MOVE_INTERVAL : GRUNT_MOVE_INTERVAL,
      path: [] as CellPos[],
      pathAge: 0,
      shootCooldown: isEnforcer ? ENFORCER_SHOOT_COOLDOWN : GRUNT_SHOOT_COOLDOWN,
    };
    enemies.push(
      isEnforcer ? { ...base, kind: "enforcer" as const } : { ...base, kind: "grunt" as const },
    );
  }

  const humans: Human[] = [];
  let nextHumanId = 1;

  for (let i = 0; i < HUMAN_COUNT; i++) {
    let hCol = 0;
    let hRow = 0;
    let attempts = 0;
    do {
      hCol = Math.floor(rng() * cols);
      hRow = Math.floor(rng() * rows);
      attempts++;
    } while (attempts < 2000 && occupied.has(`${hCol},${hRow}`));
    occupied.add(`${hCol},${hRow}`);
    humans.push({ id: nextHumanId++, col: hCol, row: hRow });
  }

  return {
    phase: "playing",
    level,
    score: 0,
    lives: LIVES_START,
    maze,
    player,
    enemies,
    humans,
    bullets: [],
    powerupPickups: [],
    decoy: null,
    decoyCharges: 0,
    exitsOpen: false,
    bfsRefreshIndex: 0,
    events: [],
    nextBulletId: 1,
    nextEnemyId,
    nextHumanId,
    nextPickupId: 1,
  };
}

// ---------------------------------------------------------------------------
// step helpers

/** True if there is an unobstructed same-row or same-column line between two cells. */
function lineOfSight(maze: Maze, ac: number, ar: number, bc: number, br: number): boolean {
  const { cols } = maze;
  if (ac === bc) {
    const minR = Math.min(ar, br);
    const maxR = Math.max(ar, br);
    for (let r = minR; r < maxR; r++) {
      if (maze.walls[r * cols + ac] & S_BIT) return false;
    }
    return true;
  }
  if (ar === br) {
    const minC = Math.min(ac, bc);
    const maxC = Math.max(ac, bc);
    for (let c = minC; c < maxC; c++) {
      if (maze.walls[ar * cols + c] & E_BIT) return false;
    }
    return true;
  }
  return false;
}

/**
 * True if placing the player center at (nx, ny) would overlap a wall or leave
 * the maze bounds. PLAYER_RADIUS clearance is required from every wall face.
 */
function playerCollidesWall(maze: Maze, nx: number, ny: number): boolean {
  const { cols, rows, cellSize } = maze;
  const r = PLAYER_RADIUS;

  if (nx < r || ny < r || nx > cols * cellSize - r || ny > rows * cellSize - r) return true;

  const col = Math.floor(nx / cellSize);
  const row = Math.floor(ny / cellSize);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;

  const lx = nx - col * cellSize;
  const ly = ny - row * cellSize;
  const w = maze.walls[row * cols + col];

  if (lx < r && w & W_BIT) return true;
  if (lx > cellSize - r && w & E_BIT) return true;
  if (ly < r && w & N_BIT) return true;
  if (ly > cellSize - r && w & S_BIT) return true;

  return false;
}

// ---------------------------------------------------------------------------
// step

export function step(state: GameState, input: InputState, dt: number): GameState {
  if (state.phase === "title" || state.phase === "gameover") return state;

  dt = Math.min(dt, 0.05);

  // 1. Clear events
  state.events = [];

  const { maze, player } = state;
  const { cols, rows, cellSize } = maze;

  // 2. Tick timers
  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  if (player.respawnTimer > 0) player.respawnTimer -= dt;
  if (player.activePowerup !== null && player.activePowerup !== "Decoy") {
    player.powerupTimer -= dt;
  }
  if (state.decoy) state.decoy.ttl -= dt;
  for (const e of state.enemies) {
    e.moveTimer -= dt;
    e.shootCooldown -= dt;
    e.pathAge += dt;
  }

  // 3. Expire powerups
  if (player.activePowerup !== null && player.activePowerup !== "Decoy" && player.powerupTimer <= 0) {
    player.activePowerup = null;
    player.powerupTimer = 0;
  }

  // 4. Expire decoy
  if (state.decoy && state.decoy.ttl <= 0) state.decoy = null;

  if (player.respawnTimer <= 0) {
    // 6. Player movement
    const speed = PLAYER_SPEED * (player.activePowerup === "SpeedBoost" ? PLAYER_SPEED_BOOST : 1);
    const mx = input.moveX * speed * dt;
    const my = input.moveY * speed * dt;

    if (mx !== 0 || my !== 0) {
      const ox = player.x;
      const oy = player.y;
      if (!playerCollidesWall(maze, ox + mx, oy + my)) {
        player.x = ox + mx;
        player.y = oy + my;
      } else {
        if (!playerCollidesWall(maze, ox + mx, oy)) player.x = ox + mx;
        if (!playerCollidesWall(maze, ox, oy + my)) player.y = oy + my;
      }
    }

    // 7. Teleport pad check
    for (let i = 0; i < 4; i++) {
      const pad = maze.teleportPads[i];
      const pc = cellCenter(maze, pad.col, pad.row);
      const dx = player.x - pc.x;
      const dy = player.y - pc.y;
      if (dx * dx + dy * dy < TELEPORT_PAD_RADIUS * TELEPORT_PAD_RADIUS) {
        const opp = maze.teleportPads[(i + 2) % 4];
        const oc = cellCenter(maze, opp.col, opp.row);
        player.x = oc.x;
        player.y = oc.y;
        state.events.push("teleport");
        break;
      }
    }

    // 8. Exit walk-through
    if (state.exitsOpen) {
      for (const ec of maze.exitCells) {
        const pc = cellCenter(maze, ec.col, ec.row);
        const dx = player.x - pc.x;
        const dy = player.y - pc.y;
        if (dx * dx + dy * dy < POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS) {
          const nextLevel = state.level + 1;
          const { score, lives } = state;
          const next = initialState(cols % 2 === 0 ? cols : cols, rows % 2 === 0 ? rows : rows, nextLevel);
          next.score = score;
          next.lives = lives;
          next.events = ["levelAdvance"];
          Object.assign(state, next);
          return state;
        }
      }
    }

    // 9. Aim direction
    if (input.aimX !== 0 || input.aimY !== 0) {
      player.aimDir = { x: input.aimX, y: input.aimY };
    }

    // 10. Player shoot
    if (input.fire && player.shootCooldown <= 0) {
      const angle = Math.atan2(player.aimDir.y, player.aimDir.x);

      const spawnBullet = (a: number) => {
        state.bullets.push({
          id: state.nextBulletId++,
          x: player.x,
          y: player.y,
          vx: Math.cos(a) * BULLET_SPEED,
          vy: Math.sin(a) * BULLET_SPEED,
          fromPlayer: true,
        });
      };

      if (player.activePowerup === "TripleBullets") {
        spawnBullet(angle - TRIPLE_SPREAD);
        spawnBullet(angle);
        spawnBullet(angle + TRIPLE_SPREAD);
        player.shootCooldown = PLAYER_SHOOT_COOLDOWN * 0.7;
      } else if (player.activePowerup === "AllDirections") {
        for (let i = 0; i < 8; i++) spawnBullet((i * Math.PI) / 4);
        player.shootCooldown = PLAYER_SHOOT_COOLDOWN * 0.7;
      } else {
        spawnBullet(angle);
        player.shootCooldown = PLAYER_SHOOT_COOLDOWN;
      }
      state.events.push("playerShoot");
    }

    // 11. Decoy drop
    if (input.dropDecoy && state.decoyCharges > 0 && state.decoy === null) {
      const { col, row } = cellAt(maze, player.x, player.y);
      const center = cellCenter(maze, col, row);
      state.decoy = { col, row, x: center.x, y: center.y, ttl: DECOY_TTL };
      state.decoyCharges--;
    }

    // 18. Player-human contact
    for (let i = state.humans.length - 1; i >= 0; i--) {
      const h = state.humans[i];
      const hc = cellCenter(maze, h.col, h.row);
      const dx = player.x - hc.x;
      const dy = player.y - hc.y;
      if (dx * dx + dy * dy < HUMAN_CONTACT_RADIUS * HUMAN_CONTACT_RADIUS) {
        state.humans.splice(i, 1);
        state.score += HUMAN_RESCUE_SCORE;
        state.events.push("humanRescue");
      }
    }

    // 20. Player-powerup pickup
    for (let i = state.powerupPickups.length - 1; i >= 0; i--) {
      const p = state.powerupPickups[i];
      const pc = cellCenter(maze, p.col, p.row);
      const dx = player.x - pc.x;
      const dy = player.y - pc.y;
      if (dx * dx + dy * dy < POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS) {
        applyPowerup(state, p.kind);
        state.powerupPickups.splice(i, 1);
        state.events.push("powerupPickup");
      }
    }
  }

  // 12. BFS path refresh (one enemy per frame, round-robin)
  if (state.enemies.length > 0) {
    const idx = state.bfsRefreshIndex % state.enemies.length;
    const e = state.enemies[idx];
    const target =
      state.decoy !== null
        ? { col: state.decoy.col, row: state.decoy.row }
        : cellAt(maze, player.x, player.y);
    e.path = bfsPath(maze, { col: e.col, row: e.row }, target, e.kind === "phantom");
    e.pathAge = 0;
  }
  state.bfsRefreshIndex =
    state.enemies.length > 0 ? (state.bfsRefreshIndex + 1) % state.enemies.length : 0;

  // 13. Enemy movement
  for (const e of state.enemies) {
    if (e.moveTimer <= 0 && e.path.length > 0) {
      const next = e.path.shift()!;
      e.col = next.col;
      e.row = next.row;
      const interval =
        e.kind === "enforcer"
          ? ENFORCER_MOVE_INTERVAL
          : e.kind === "phantom"
            ? PHANTOM_MOVE_INTERVAL
            : GRUNT_MOVE_INTERVAL;
      e.moveTimer = interval * (0.9 + Math.random() * 0.2);
    }
  }

  // 14. Enemy shooting
  const playerCell = cellAt(maze, player.x, player.y);
  for (const e of state.enemies) {
    if (e.shootCooldown > 0) continue;
    if (!lineOfSight(maze, e.col, e.row, playerCell.col, playerCell.row)) continue;

    const ec = cellCenter(maze, e.col, e.row);
    const tc = cellCenter(maze, playerCell.col, playerCell.row);
    const dx = tc.x - ec.x;
    const dy = tc.y - ec.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    const angle = Math.atan2(dy, dx);

    const spawnEnemyBullet = (a: number) => {
      state.bullets.push({
        id: state.nextBulletId++,
        x: ec.x,
        y: ec.y,
        vx: Math.cos(a) * BULLET_SPEED,
        vy: Math.sin(a) * BULLET_SPEED,
        fromPlayer: false,
      });
    };

    if (e.kind === "enforcer") {
      const fanStep = ENFORCER_SPREAD_COUNT > 1 ? ENFORCER_SPREAD_ANGLE / (ENFORCER_SPREAD_COUNT - 1) : 0;
      for (let i = 0; i < ENFORCER_SPREAD_COUNT; i++) {
        spawnEnemyBullet(angle - ENFORCER_SPREAD_ANGLE / 2 + i * fanStep);
      }
      e.shootCooldown = ENFORCER_SHOOT_COOLDOWN;
    } else {
      spawnEnemyBullet(angle);
      e.shootCooldown = e.kind === "phantom" ? GRUNT_SHOOT_COOLDOWN : GRUNT_SHOOT_COOLDOWN;
    }
    state.events.push("enemyShoot");
  }

  // 15. Bullet movement + wall removal
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (bulletHitsWall(maze, b.x, b.y, b.vx, b.vy, dt)) {
      state.bullets.splice(i, 1);
      continue;
    }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0 || b.y < 0 || b.x >= cols * cellSize || b.y >= rows * cellSize) {
      state.bullets.splice(i, 1);
    }
  }

  // 16. Player-enemy bullet collision
  if (player.invuln <= 0 && player.respawnTimer <= 0) {
    for (let i = state.bullets.length - 1; i >= 0; i--) {
      const b = state.bullets[i];
      if (b.fromPlayer) continue;
      const dx = b.x - player.x;
      const dy = b.y - player.y;
      if (dx * dx + dy * dy < PLAYER_RADIUS * PLAYER_RADIUS) {
        state.bullets.splice(i, 1);
        state.lives--;
        player.invuln = INVULN_DURATION;
        player.respawnTimer = RESPAWN_DELAY;
        state.events.push("playerHit");
        if (state.lives <= 0) {
          state.phase = "gameover";
          state.events.push("playerDie");
          state.events.push("gameover");
        }
        break;
      }
    }
  }

  // 17. Enemy-player bullet collision
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (!b.fromPlayer) continue;
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j];
      if (e.kind === "phantom" && (e as Phantom).phasing) continue;
      const ec = cellCenter(maze, e.col, e.row);
      const dx = b.x - ec.x;
      const dy = b.y - ec.y;
      if (Math.sqrt(dx * dx + dy * dy) < PLAYER_RADIUS + 4) {
        state.bullets.splice(i, 1);
        e.hp--;
        if (e.hp <= 0) {
          state.enemies.splice(j, 1);
          state.score += ENEMY_KILL_SCORE;
          state.events.push("enemyDie");
        }
        break;
      }
    }
  }

  // 19. Enemy-human contact
  for (let i = state.humans.length - 1; i >= 0; i--) {
    const h = state.humans[i];
    for (const e of state.enemies) {
      if (e.kind === "grunt" && e.col === h.col && e.row === h.row) {
        state.humans.splice(i, 1);
        state.score = Math.max(0, state.score - HUMAN_KILL_PENALTY);
        state.events.push("humanDie");
        break;
      }
    }
  }

  // 21. Level-clear check (never overwrite a gameover that was just set in rule 16)
  if (state.enemies.length === 0 && !state.exitsOpen && state.phase !== "gameover") {
    state.exitsOpen = true;
    state.phase = "levelclear";
    for (const ec of maze.exitCells) {
      const idx = ec.row * cols + ec.col;
      if (ec.row === 0) maze.walls[idx] &= ~N_BIT;
      else if (ec.row === rows - 1) maze.walls[idx] &= ~S_BIT;
      else if (ec.col === 0) maze.walls[idx] &= ~W_BIT;
      else if (ec.col === cols - 1) maze.walls[idx] &= ~E_BIT;
    }
    state.events.push("exitsOpen");
  }

  return state;
}
