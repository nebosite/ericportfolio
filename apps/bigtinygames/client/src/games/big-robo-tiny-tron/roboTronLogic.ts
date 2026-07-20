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

/**
 * A cardinal facing used to pick the walking-sprite row/column set.
 * The sprite sheet gives each walking character 12 frames grouped by facing
 * (left, right, down, up), so every moving entity tracks which way it faces.
 */
export type Facing = "left" | "right" | "down" | "up";

/** Map a movement vector to the nearest cardinal facing (dominant axis wins). */
export function facingFromVec(dx: number, dy: number): Facing | null {
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/** An integer cell coordinate in the maze grid. */
export interface CellPos {
  col: number;
  row: number;
}

/**
 * One teleport pad. Pads come in pairs: the two pads that share a `pair` index
 * (and therefore a `color`) are linked — entering one emerges you out the far
 * side of the other. There is roughly one pair per 10 grid squares.
 */
export interface TeleportPad {
  col: number;
  row: number;
  /** Pair index; the two pads of a linked pair share this value. */
  pair: number;
  /** CSS color shared by both pads of the pair (the visual pairing cue). */
  color: string;
}

/** Distinct neon colors cycled across teleport pairs so each pair reads apart. */
export const TELEPORT_PAIR_COLORS: readonly string[] = [
  "#ff3b3b",
  "#39ff14",
  "#00aaff",
  "#ffee00",
  "#ff00ff",
  "#00ffff",
  "#ff8800",
  "#b25cff",
  "#ff5cc8",
  "#7cff5c",
];

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
  /**
   * Pixel size of one cell. Cells are rectangular: `cellW` is trimmed from the
   * playable width / cols and `cellH` from the playable height / rows, so the
   * grid fills the screen almost exactly (they are usually close but not equal).
   */
  cellW: number;
  cellH: number;
  /**
   * Teleport pads, ~one linked pair per 10 grid squares. The two pads sharing a
   * `pair` index are linked: entering one emerges you out the far side of the
   * other (same for bullets). Only "smart" enemies (smartness > 1) use them.
   */
  teleportPads: readonly TeleportPad[];
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
  /**
   * Pixel-space center. Enemies now move smoothly one small step at a time
   * (like the player) rather than teleporting cell-to-cell, so (x, y) is the
   * authoritative position. `col`/`row` are the derived cell the enemy occupies
   * (cellAt(x, y)), kept in sync each step for BFS pathing and line-of-sight.
   */
  x: number;
  y: number;
  /** Current cell column (derived from x/y; used for BFS + line-of-sight). */
  col: number;
  /** Current cell row (derived from x/y). */
  row: number;
  /** Facing for sprite selection: which way the enemy last moved. */
  facing: Facing;
  /** True on any step in which the enemy actually moved (drives walk animation). */
  moving: boolean;
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
  /** Cleverness (from the level config). > 1 ⇒ willing to use teleport pads. */
  smartness: number;
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

/**
 * Hulk — big, tough marcher (green robot sprite, row 6).
 * High HP; shrugs off bullets it doesn't get enough of. Slower cadence.
 */
export interface Hulk extends EnemyBase {
  kind: "hulk";
}

/**
 * Brain — the commander (purple sprite, row 7). Pathfinds toward the player;
 * higher HP than a Grunt. (Reprogramming of family members is a future feature;
 * for now it simply chases and is worth more points.)
 */
export interface Brain extends EnemyBase {
  kind: "brain";
}

/**
 * Spheroid — spawner drone. No sprite yet (rendered as a fallback shape until
 * its art is added); included so the CSV population column has a home.
 */
export interface Spheroid extends EnemyBase {
  kind: "spheroid";
}

/**
 * Tank — heavy shooter. No sprite yet (fallback shape); present for the CSV
 * population column.
 */
export interface Tank extends EnemyBase {
  kind: "tank";
}

export type Enemy = Grunt | Enforcer | Phantom | Hulk | Brain | Spheroid | Tank;
export type EnemyKind = Enemy["kind"];

// ---------------------------------------------------------------------------
// Humans (yellow dots)

/** The four rescuable family-member types (sprite rows 1–4). */
export type FamilyType = "mom" | "dad" | "mike" | "sally";

/**
 * A family member (was "Human") — a rescue target that wanders the maze.
 *
 * Family members move smoothly in pixel space, one small step every other
 * frame, drifting in a random direction (they don't chase anything). They
 * CANNOT be hit by bullets. Touching the player rescues them (+score); touching
 * any electrode or enemy kills them, emitting a "familyDie" wail.
 */
export interface Human {
  /** Unique stable id; assigned from GameState.nextHumanId at level init. */
  id: number;
  /** Which family member (drives the sprite row). */
  type: FamilyType;
  /** Pixel-space center (authoritative). */
  x: number;
  y: number;
  /** Derived cell (cellAt(x, y)); kept in sync for wall queries. */
  col: number;
  row: number;
  /** Facing for sprite selection. */
  facing: Facing;
  /** True on frames the family member actually moved (drives walk animation). */
  moving: boolean;
  /** Current random wander direction (unit-ish vector); re-rolled periodically. */
  wanderX: number;
  wanderY: number;
}

// ---------------------------------------------------------------------------
// Electrodes (static hazards)

/**
 * An electrode — a static maze hazard placed per grid square at level start.
 *
 * Electrodes are lethal on contact to the player and to family members, and
 * enemies steer around them. A player bullet destroys an electrode: it plays a
 * two-frame shrink animation (`shrink` 0 → 1 → 2) and is then removed. While
 * `shrink > 0` the electrode is dying and no longer harms anything.
 *
 * `type` (0–7) selects the sprite group on the sheet (rows 13–14, four groups
 * of three each). Level 1 uses type 0.
 */
export interface Electrode {
  id: number;
  /** Pixel-space center. */
  x: number;
  y: number;
  /** Derived cell. */
  col: number;
  row: number;
  /** Sprite group 0–7. */
  type: number;
  /** 0 = intact, 1/2 = shrink frames after being shot. */
  shrink: number;
  /** Seconds left in the current shrink frame (0 while intact). */
  shrinkTimer: number;
}

// ---------------------------------------------------------------------------
// Particles (destruction debris)

/**
 * A debris fragment from a destroyed character. On death a character breaks
 * into horizontal line segments that fly apart perpendicular to the bullet that
 * killed it, fading as they go. Purely cosmetic but simulated in step() so the
 * renderer stays dumb.
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Half-length of the horizontal line, pixels. */
  len: number;
  /** Seconds of life remaining. */
  ttl: number;
  /** Original ttl, for fade alpha. */
  life: number;
  /** CSS color string. */
  color: string;
  /**
   * Convergence target. When set, the particle is a "reconstitute" fragment: it
   * lerps from (sx0, sy0) toward (tx, ty) over its lifetime (accelerating in)
   * instead of integrating velocity, congealing onto the reforming player.
   */
  tx?: number;
  ty?: number;
  sx0?: number;
  sy0?: number;
}

// ---------------------------------------------------------------------------
// Level configuration (CSV-driven populations)

/**
 * Per-grid-square population counts and tuning for one level. Authored in the
 * hand-editable `assets/levels.csv` spreadsheet and parsed by levels.ts; the
 * component passes the row for the current level into initialState(). Each count
 * is spawned in EVERY interior grid square (except the player's start cell).
 */
export interface LevelConfig {
  moms: number;
  dads: number;
  mikeys: number;
  sallys: number;
  grunts: number;
  hulks: number;
  brains: number;
  spheroids: number;
  enforcers: number;
  /** Electrode sprite group (0–7) used for this level. */
  electrodeType: number;
  electrodes: number;
  tanks: number;
  /** Per-frame probability (0–1) that an enemy takes its 2px step. */
  enemyMoveChance: number;
  /**
   * Enemy cleverness for this level. Enemies with smartness > 1 are clever
   * enough to use a teleport pad in their current grid square when the paired
   * pad lands them closer to the player. 1 (or less) = never use teleports.
   */
  smartness: number;
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
  x: number; // pixel position
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
  | "playerShoot" // player bullet fired
  | "enemyShoot" // enemy bullet fired
  | "enemyDie" // an enemy reduced to 0 HP
  | "playerHit" // player struck by an enemy bullet (life lost)
  | "playerDie" // lives reached 0 → game over transition
  | "humanRescue" // player contacted a family member (+HUMAN_RESCUE_SCORE)
  | "humanDie" // a Grunt reached a family member (−HUMAN_KILL_PENALTY)
  | "familyDie" // a family member touched an electrode/enemy (electronic wail)
  | "electrodeHit" // an electrode was destroyed (player bullet or enemy collision)
  | "reconstitute" // the player is reforming after a death (respawn animation)
  | "powerupPickup" // player collected a powerup
  | "teleport" // player used a corner teleport pad
  | "exitsOpen" // all enemies dead, exits opening (play a level-clear chime)
  | "levelAdvance" // player walked through an exit → next level loaded
  | "phantomDebut" // first Phantom appears (triggers 10-second telegraph animation)
  | "gameover"; // game ended

// ---------------------------------------------------------------------------
// Game phase

/**
 * The top-level phase of the game loop.
 * The canvas component uses this to switch between title screen, gameplay,
 * and game-over overlays. Logic runs only in "playing" phase.
 */
export type GamePhase =
  | "title" // title screen; step() is a no-op
  | "playing" // active gameplay
  | "levelclear" // all enemies dead, exits open; player walks to exit
  | "gameover"; // game over; step() is a no-op

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
  /** Family members (rescue targets). */
  humans: Human[];
  /** Static electrode hazards. */
  electrodes: Electrode[];
  /** Cosmetic destruction debris. */
  particles: Particle[];
  /** Per-frame probability an enemy takes its 2px step (from the level config). */
  enemyMoveChance: number;
  /** Monotonic frame counter; family members move on even frames (every other). */
  frame: number;
  /**
   * Seconds remaining in the "materialize" animation (enemies + player assembling
   * from sprite lines). While > 0, step() freezes all gameplay; the renderer
   * draws the convergence. 0 during normal play.
   */
  materializeTimer: number;
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

/**
 * Default pixel size of each maze cell. Cells are now BIG (Robotron-style
 * arena squares). The component computes an exact size in the 150–200px band
 * that tiles the viewport cleanly and passes it into initialState(); this
 * constant is the fallback used by tests and when no size is supplied.
 */
export const CELL_SIZE = 176;

/** Player collision radius (pixel circle). */
export const PLAYER_RADIUS = 10;

/** Base player movement speed in pixels/second. */
export const PLAYER_SPEED = 200;

/** Movement speed multiplier while SpeedBoost is active. */
export const PLAYER_SPEED_BOOST = 1.6;

/** Minimum seconds between player shots. 0.1 ⇒ a 10-shots-per-second fire rate. */
export const PLAYER_SHOOT_COOLDOWN = 0.1;

/** Player bullet travel speed in pixels/second. */
export const BULLET_SPEED = 1500;

/** Rendered length of a bullet's line segment, pixels. */
export const BULLET_LENGTH = 6;

/** Bullet collision radius in pixels (treated as a point hit on walls). */
export const BULLET_RADIUS = 3;

/** Pixels an enemy advances on a single move step. */
export const ENEMY_STEP_PX = 4;

/** Pixels a family member advances on a single wander step. */
export const FAMILY_STEP_PX = 2;

/**
 * Extra clearance a family member keeps from an electrode when wandering, so
 * they visibly shy away rather than brushing right up against a lethal hazard.
 */
export const FAMILY_ELECTRODE_MARGIN = 8;

/** Collision radius for an electrode (kills player/family, stops bullets). */
export const ELECTRODE_RADIUS = 12;

/** Enemy collision radius (for family death + bullet hits). */
export const ENEMY_RADIUS = 9;

/** Seconds each electrode shrink frame is shown while it is being destroyed. */
export const ELECTRODE_SHRINK_TIME = 0.06;

/** HP by enemy kind (bullets needed to destroy). */
export const ENEMY_HP: Record<EnemyKind, number> = {
  grunt: 1,
  enforcer: 3,
  phantom: 2,
  hulk: 6,
  brain: 3,
  spheroid: 1,
  tank: 5,
};

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
export const ENFORCER_MOVE_INTERVAL = 0.3;

/** Seconds between Phantom cell steps. */
export const PHANTOM_MOVE_INTERVAL = 0.2;

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

/** Seconds the reconstitute (respawn) particle convergence lasts. */
export const RECON_DURATION = 1.0;

/** Number of particles that fly in and congeal into the reforming player. */
export const RECON_PARTICLES = 30;

/**
 * Seconds the "materialize" intro/respawn animation lasts. At the start of a
 * level and after a death, every enemy (and the player) assembles from sprite
 * lines flying in from off-screen. Gameplay is frozen for this whole window.
 */
export const MATERIALIZE_DURATION = 2.0;

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
 * Pixel radius within which the player triggers a teleport pad. The pad is a
 * small 30px-diameter target, so the trigger radius is 15px.
 */
export const TELEPORT_PAD_RADIUS = 15;

/**
 * On teleport, the player is placed this many pixels from the destination pad's
 * center (offset toward the maze interior), so they land at least 50px away and
 * don't immediately re-trigger the pad.
 */
export const TELEPORT_EXIT_OFFSET = 55;

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

/**
 * Level 1 population per grid square — the fallback used by tests and when the
 * CSV can't be loaded. Mirrors the first row of assets/levels.csv:
 * 10 grunts, 4 type-0 electrodes, 1 mom, 1 dad, 5% enemy move chance.
 */
export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  moms: 1,
  dads: 1,
  mikeys: 0,
  sallys: 0,
  grunts: 10,
  hulks: 0,
  brains: 0,
  spheroids: 0,
  enforcers: 0,
  electrodeType: 0,
  electrodes: 4,
  tanks: 0,
  enemyMoveChance: 0.05,
  smartness: 1,
};

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
    x: col * maze.cellW + maze.cellW / 2,
    y: row * maze.cellH + maze.cellH / 2,
  };
}

export function cellAt(maze: Maze, x: number, y: number): CellPos {
  return {
    col: Math.floor(x / maze.cellW),
    row: Math.floor(y / maze.cellH),
  };
}

export function teleportPadPositions(maze: Maze): readonly TeleportPad[] {
  return maze.teleportPads;
}

/** The other pad linked to `pad` (same pair index), or null if it has no partner. */
export function teleportPartner(maze: Maze, pad: TeleportPad): TeleportPad | null {
  for (const p of maze.teleportPads) {
    if (p !== pad && p.pair === pad.pair) return p;
  }
  return null;
}

export function exitPositions(maze: Maze): CellPos[] {
  return maze.exitCells;
}

export function bfsPath(maze: Maze, start: CellPos, goal: CellPos, ignoreWalls = false): CellPos[] {
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
  const { cols, rows, cellW, cellH } = maze;

  if (nx < 0 || ny < 0 || nx >= cols * cellW || ny >= rows * cellH) return true;

  const oldCol = Math.floor(bx / cellW);
  const oldRow = Math.floor(by / cellH);
  const newCol = Math.floor(nx / cellW);
  const newRow = Math.floor(ny / cellH);

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

const FACINGS: Facing[] = ["left", "right", "down", "up"];

export function initialState(
  cols: number,
  rows: number,
  level: number,
  rng: () => number = Math.random,
  cellW: number = CELL_SIZE,
  config: LevelConfig = DEFAULT_LEVEL_CONFIG,
  cellH: number = cellW,
): GameState {
  // Any cols/rows work (the maze is a per-cell recursive backtracker); the
  // caller sizes the grid to fill the viewport, so we keep the counts as given.
  const walls = buildMaze(cols, rows, rng);
  const midCol = Math.floor(cols / 2);
  const midRow = Math.floor(rows / 2);

  // One linked teleport PAIR per ~10 grid squares, on distinct random interior
  // cells (never the player's start cell). Each pair shares a color so the link
  // is visible.
  const numPairs = Math.floor((cols * rows) / 10);
  const teleportPads: TeleportPad[] = [];
  {
    const used = new Set<number>([midRow * cols + midCol]);
    const pickCell = (): CellPos | null => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const col = Math.floor(rng() * cols);
        const row = Math.floor(rng() * rows);
        const idx = row * cols + col;
        if (!used.has(idx)) {
          used.add(idx);
          return { col, row };
        }
      }
      return null;
    };
    for (let pair = 0; pair < numPairs; pair++) {
      const a = pickCell();
      const b = pickCell();
      if (!a || !b) break;
      const color = TELEPORT_PAIR_COLORS[pair % TELEPORT_PAIR_COLORS.length];
      teleportPads.push({ ...a, pair, color });
      teleportPads.push({ ...b, pair, color });
    }
  }

  // One exit per edge, mid-point of each edge. Outward wall bits remain SET (sealed).
  const exitCells: CellPos[] = [
    { col: midCol, row: 0 },
    { col: cols - 1, row: midRow },
    { col: midCol, row: rows - 1 },
    { col: 0, row: midRow },
  ];

  const maze: Maze = { cols, rows, walls, cellW, cellH, teleportPads, exitCells };

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

  // Jittered pixel position placed MAXIMALLY inside a cell (center → nearly the
  // wall) BUT not overlapping anything already placed in the cell — so enemies,
  // people and electrodes never sit on top of each other. PLACE_GAP also exceeds
  // ENEMY_RADIUS + ELECTRODE_RADIUS, so no enemy spawns already touching an
  // electrode (which would blow it up on frame one).
  const spreadX = cellW / 2 - 12;
  const spreadY = cellH / 2 - 12;
  const PLACE_GAP = 26;
  const placeInCell = (col: number, row: number, placed: Vec2[]): Vec2 => {
    const c = cellCenter(maze, col, row);
    let chosen: Vec2 = { x: c.x, y: c.y };
    for (let attempt = 0; attempt < 40; attempt++) {
      chosen = { x: c.x + (rng() * 2 - 1) * spreadX, y: c.y + (rng() * 2 - 1) * spreadY };
      if (placed.every((q) => dist2(chosen.x, chosen.y, q.x, q.y) >= PLACE_GAP * PLACE_GAP)) break;
    }
    placed.push(chosen);
    return chosen;
  };
  const randFacing = (): Facing => FACINGS[Math.floor(rng() * 4)] ?? "down";

  const enemies: Enemy[] = [];
  const humans: Human[] = [];
  const electrodes: Electrode[] = [];
  let nextEnemyId = 1;
  let nextHumanId = 1;
  let nextElectrodeId = 1;

  const makeEnemy = (kind: EnemyKind, col: number, row: number, placed: Vec2[]): Enemy => {
    const p = placeInCell(col, row, placed);
    const base: EnemyBase = {
      id: nextEnemyId++,
      x: p.x,
      y: p.y,
      col,
      row,
      facing: randFacing(),
      moving: false,
      hp: ENEMY_HP[kind],
      moveTimer: 0,
      path: [],
      pathAge: 0,
      shootCooldown: kind === "enforcer" ? ENFORCER_SHOOT_COOLDOWN : GRUNT_SHOOT_COOLDOWN,
      smartness: config.smartness ?? 1,
    };
    switch (kind) {
      case "phantom":
        return { ...base, kind: "phantom", phasing: false };
      default:
        return { ...base, kind } as Enemy;
    }
  };

  const makeFamily = (type: FamilyType, col: number, row: number, placed: Vec2[]): Human => {
    const p = placeInCell(col, row, placed);
    return {
      id: nextHumanId++,
      type,
      x: p.x,
      y: p.y,
      col,
      row,
      facing: randFacing(),
      moving: false,
      wanderX: 0,
      wanderY: 0,
    };
  };

  const makeElectrode = (col: number, row: number, placed: Vec2[]): Electrode => {
    const p = placeInCell(col, row, placed);
    return {
      id: nextElectrodeId++,
      x: p.x,
      y: p.y,
      col,
      row,
      type: config.electrodeType,
      shrink: 0,
      shrinkTimer: 0,
    };
  };

  // Populate every interior grid square (skip the player's start cell) with the
  // per-square counts from the level config.
  const spawnN = (n: number, fn: () => void) => {
    for (let i = 0; i < n; i++) fn();
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (col === midCol && row === midRow) continue;
      // Positions already taken in THIS cell — every new entity avoids them.
      const placed: Vec2[] = [];
      spawnN(config.grunts, () => enemies.push(makeEnemy("grunt", col, row, placed)));
      spawnN(config.hulks, () => enemies.push(makeEnemy("hulk", col, row, placed)));
      spawnN(config.brains, () => enemies.push(makeEnemy("brain", col, row, placed)));
      spawnN(config.spheroids, () => enemies.push(makeEnemy("spheroid", col, row, placed)));
      spawnN(config.enforcers, () => enemies.push(makeEnemy("enforcer", col, row, placed)));
      spawnN(config.tanks, () => enemies.push(makeEnemy("tank", col, row, placed)));
      spawnN(config.moms, () => humans.push(makeFamily("mom", col, row, placed)));
      spawnN(config.dads, () => humans.push(makeFamily("dad", col, row, placed)));
      spawnN(config.mikeys, () => humans.push(makeFamily("mike", col, row, placed)));
      spawnN(config.sallys, () => humans.push(makeFamily("sally", col, row, placed)));
      spawnN(config.electrodes, () => electrodes.push(makeElectrode(col, row, placed)));
    }
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
    electrodes,
    particles: [],
    enemyMoveChance: config.enemyMoveChance,
    frame: 0,
    materializeTimer: MATERIALIZE_DURATION,
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
  const { cols, rows, cellW, cellH } = maze;
  const r = PLAYER_RADIUS;

  if (nx < r || ny < r || nx > cols * cellW - r || ny > rows * cellH - r) return true;

  const col = Math.floor(nx / cellW);
  const row = Math.floor(ny / cellH);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;

  const lx = nx - col * cellW;
  const ly = ny - row * cellH;
  const w = maze.walls[row * cols + col];

  if (lx < r && w & W_BIT) return true;
  if (lx > cellW - r && w & E_BIT) return true;
  if (ly < r && w & N_BIT) return true;
  if (ly > cellH - r && w & S_BIT) return true;

  return false;
}

/**
 * Generic wall test for a moving entity of the given radius (enemies, family).
 * Same face-clearance logic as playerCollidesWall but with a caller radius.
 */
function entityCollidesWall(maze: Maze, nx: number, ny: number, r: number): boolean {
  const { cols, rows, cellW, cellH } = maze;
  if (nx < r || ny < r || nx > cols * cellW - r || ny > rows * cellH - r) return true;
  const col = Math.floor(nx / cellW);
  const row = Math.floor(ny / cellH);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return true;
  const lx = nx - col * cellW;
  const ly = ny - row * cellH;
  const w = maze.walls[row * cols + col];
  if (lx < r && w & W_BIT) return true;
  if (lx > cellW - r && w & E_BIT) return true;
  if (ly < r && w & N_BIT) return true;
  if (ly > cellH - r && w & S_BIT) return true;
  return false;
}

/** Squared distance between two points. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Squared distance from point (px, py) to the segment (ax, ay)-(bx, by).
 * Used for swept bullet collisions so fast bullets (1500px/s ⇒ ~24px/frame)
 * can't tunnel through a target between two frames.
 */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return dist2(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return dist2(px, py, ax + t * dx, ay + t * dy);
}

/**
 * Spawn horizontal-line debris for a destroyed character. Fragments split into
 * two streams flying perpendicular to the killing bullet's velocity (vx, vy),
 * spread across the sprite's height, and fade over ~0.5s.
 */
function spawnDebris(
  state: GameState,
  x: number,
  y: number,
  vx: number,
  vy: number,
  color: string,
): void {
  const speed = Math.hypot(vx, vy) || 1;
  // Unit vector perpendicular to the bullet path.
  const px = -vy / speed;
  const py = vx / speed;
  // Explosions are 3× as big: fragments are longer, spread wider, and fly ~3×
  // farther in the same lifetime.
  const FRAGMENTS = 6;
  for (let i = 0; i < FRAGMENTS; i++) {
    // Spread fragments along the bullet axis (the "slices" of the body).
    const t = (i / (FRAGMENTS - 1) - 0.5) * 42;
    const along = { x: (vx / speed) * t, y: (vy / speed) * t };
    const dir = i % 2 === 0 ? 1 : -1;
    const spd = (60 + Math.random() * 90) * 3;
    state.particles.push({
      x: x + along.x,
      y: y + along.y,
      vx: px * spd * dir,
      vy: py * spd * dir,
      len: 15,
      ttl: 0.45 + Math.random() * 0.25,
      life: 0.7,
      color,
    });
  }
}

/** Debris color per character kind. */
const DEBRIS_COLOR: Record<string, string> = {
  grunt: "#ff3b3b",
  enforcer: "#ff8800",
  phantom: "#00ffff",
  hulk: "#39ff14",
  brain: "#b25cff",
  spheroid: "#66ccff",
  tank: "#cccccc",
  mom: "#ff5cc8",
  dad: "#3b6bff",
  mike: "#ff5c5c",
  sally: "#ff8c3b",
};

// ---------------------------------------------------------------------------
// step

/** True if (x, y) with the given radius overlaps any intact electrode. */
function hitsElectrode(state: GameState, x: number, y: number, r: number): boolean {
  const rr = (ELECTRODE_RADIUS + r) * (ELECTRODE_RADIUS + r);
  for (const el of state.electrodes) {
    if (el.shrink > 0) continue; // dying electrodes are harmless / pass-through
    if (dist2(x, y, el.x, el.y) < rr) return true;
  }
  return false;
}

/**
 * Advance one enemy by a single ENEMY_STEP_PX step toward its target, following
 * its BFS waypoint path through the maze and steering around electrodes. Sets
 * facing + moving for animation. Phantoms ignore walls.
 */
function moveEnemy(state: GameState, e: Enemy): void {
  const { maze, player } = state;
  const ignoreWalls = e.kind === "phantom";

  // Target point: the next path waypoint's center, or the player/decoy directly.
  let tx: number;
  let ty: number;
  if (e.path.length > 0) {
    const c = cellCenter(maze, e.path[0].col, e.path[0].row);
    tx = c.x;
    ty = c.y;
  } else if (state.decoy) {
    tx = state.decoy.x;
    ty = state.decoy.y;
  } else {
    tx = player.x;
    ty = player.y;
  }

  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  let sx = (dx / d) * ENEMY_STEP_PX;
  let sy = (dy / d) * ENEMY_STEP_PX;

  // Enemies steer around walls but NOT electrodes — walking into an electrode
  // makes them (and the electrode) blow up, handled after movement.
  const tryMove = (mx: number, my: number): boolean => {
    const nx = e.x + mx;
    const ny = e.y + my;
    if (!ignoreWalls && entityCollidesWall(maze, nx, ny, ENEMY_RADIUS)) return false;
    e.x = nx;
    e.y = ny;
    return true;
  };

  let moved = tryMove(sx, sy);
  if (!moved) {
    // Slide around the obstacle by rotating the step vector.
    for (const ang of [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2]) {
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const rx = sx * cs - sy * sn;
      const ry = sx * sn + sy * cs;
      if (tryMove(rx, ry)) {
        sx = rx;
        sy = ry;
        moved = true;
        break;
      }
    }
  }

  e.moving = moved;
  if (moved) {
    e.facing = facingFromVec(sx, sy) ?? e.facing;
    e.col = Math.max(0, Math.min(maze.cols - 1, Math.floor(e.x / maze.cellW)));
    e.row = Math.max(0, Math.min(maze.rows - 1, Math.floor(e.y / maze.cellH)));
    // Pop the waypoint once we're basically on it.
    if (e.path.length > 0) {
      const c = cellCenter(maze, e.path[0].col, e.path[0].row);
      if (dist2(e.x, e.y, c.x, c.y) < ENEMY_STEP_PX * 3 * (ENEMY_STEP_PX * 3)) {
        e.path.shift();
      }
    }
  }
}

/**
 * Advance one family member by a random wander step, avoiding walls AND
 * electrodes (they are not suicidal — they never deliberately step onto an
 * electrode). A blocked step re-rolls the heading next time.
 */
function moveFamily(state: GameState, h: Human): void {
  const { maze } = state;
  if ((h.wanderX === 0 && h.wanderY === 0) || Math.random() < 0.04) {
    const ang = Math.random() * Math.PI * 2;
    h.wanderX = Math.cos(ang);
    h.wanderY = Math.sin(ang);
  }
  const sx = h.wanderX * FAMILY_STEP_PX;
  const sy = h.wanderY * FAMILY_STEP_PX;
  const nx = h.x + sx;
  const ny = h.y + sy;
  const blocked =
    entityCollidesWall(maze, nx, ny, PLAYER_RADIUS) ||
    hitsElectrode(state, nx, ny, PLAYER_RADIUS + FAMILY_ELECTRODE_MARGIN);
  if (!blocked) {
    h.x = nx;
    h.y = ny;
    h.moving = true;
    h.facing = facingFromVec(sx, sy) ?? h.facing;
    h.col = Math.max(0, Math.min(maze.cols - 1, Math.floor(h.x / maze.cellW)));
    h.row = Math.max(0, Math.min(maze.rows - 1, Math.floor(h.y / maze.cellH)));
  } else {
    // Bounced off a wall or shied away from an electrode — re-roll heading.
    h.wanderX = 0;
    h.wanderY = 0;
    h.moving = false;
  }
}

/** Apply one point of damage to the player (shared by bullet/enemy/electrode hits). */
function damagePlayer(state: GameState): void {
  const { player } = state;
  state.lives--;
  player.invuln = INVULN_DURATION;
  player.respawnTimer = RESPAWN_DELAY;
  state.events.push("playerHit");
  if (state.lives <= 0) {
    state.phase = "gameover";
    state.events.push("playerDie");
    state.events.push("gameover");
  }
}

/**
 * Bring the player back after a death: clear the respawn delay, grant a flashing
 * invuln window, and re-run the "materialize" animation for the whole scene
 * (every enemy and the player assemble from sprite lines flying in from
 * off-screen). Emits the "reconstitute" cue for the come-together sound.
 *
 * Called by the render layer when the post-death pause ends (it owns the
 * timing); the convergence then plays out while step() is frozen.
 */
export function respawnPlayer(state: GameState): void {
  state.player.respawnTimer = 0;
  state.player.invuln = INVULN_DURATION;
  state.materializeTimer = MATERIALIZE_DURATION;
  state.events.push("reconstitute");
}

export function step(state: GameState, input: InputState, dt: number): GameState {
  if (state.phase === "title" || state.phase === "gameover") return state;

  dt = Math.min(dt, 0.05);

  // 1. Clear events, advance frame counter
  state.events = [];
  state.frame++;

  // 1b. Materialize freeze: while enemies + player are assembling from sprite
  // lines, all gameplay is suspended (no movement, shooting, or collisions).
  if (state.materializeTimer > 0) {
    state.materializeTimer = Math.max(0, state.materializeTimer - dt);
    return state;
  }

  const { maze, player } = state;
  const { cols, rows, cellW, cellH } = maze;

  // 2. Tick timers
  if (player.shootCooldown > 0) player.shootCooldown -= dt;
  if (player.invuln > 0) player.invuln -= dt;
  if (player.respawnTimer > 0) player.respawnTimer -= dt;
  if (player.activePowerup !== null && player.activePowerup !== "Decoy") {
    player.powerupTimer -= dt;
  }
  if (state.decoy) state.decoy.ttl -= dt;
  for (const e of state.enemies) {
    e.shootCooldown -= dt;
    e.pathAge += dt;
  }

  // 3. Expire powerups
  if (
    player.activePowerup !== null &&
    player.activePowerup !== "Decoy" &&
    player.powerupTimer <= 0
  ) {
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

    // 7. Teleport pad check — stepping onto a pad emerges you out the FAR side
    // of its linked pair, continuing in the same direction you entered. (mx, my)
    // is this frame's movement = the entry direction (aim is the fallback).
    for (const pad of maze.teleportPads) {
      const pc = cellCenter(maze, pad.col, pad.row);
      const dx = player.x - pc.x;
      const dy = player.y - pc.y;
      if (dx * dx + dy * dy < TELEPORT_PAD_RADIUS * TELEPORT_PAD_RADIUS) {
        const partner = teleportPartner(maze, pad);
        if (!partner) break;
        const oc = cellCenter(maze, partner.col, partner.row);
        let dirx = mx;
        let diry = my;
        if (dirx === 0 && diry === 0) {
          dirx = player.aimDir.x;
          diry = player.aimDir.y;
        }
        const dl = Math.hypot(dirx, diry) || 1;
        player.x = oc.x + (dirx / dl) * TELEPORT_EXIT_OFFSET;
        player.y = oc.y + (diry / dl) * TELEPORT_EXIT_OFFSET;
        state.events.push("teleport");
        break;
      }
    }

    // 8. Exit walk-through — signal the component to build the next level
    // (it owns the dynamic cell size + per-level CSV config).
    if (state.exitsOpen) {
      for (const ec of maze.exitCells) {
        const pc = cellCenter(maze, ec.col, ec.row);
        const dx = player.x - pc.x;
        const dy = player.y - pc.y;
        if (dx * dx + dy * dy < POWERUP_PICKUP_RADIUS * POWERUP_PICKUP_RADIUS) {
          state.events.push("levelAdvance");
          return state;
        }
      }
    }

    // 9. Aim direction
    if (input.aimX !== 0 || input.aimY !== 0) {
      player.aimDir = { x: input.aimX, y: input.aimY };
    }

    // 10. Player shoot — one bullet per frame while firing (cooldown is 0).
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

    // 18. Player-family contact → rescue
    for (let i = state.humans.length - 1; i >= 0; i--) {
      const h = state.humans[i];
      if (dist2(player.x, player.y, h.x, h.y) < HUMAN_CONTACT_RADIUS * HUMAN_CONTACT_RADIUS) {
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

  // 13. Enemy movement — smooth, one small step at a time, EnemyMoveChance% per frame
  for (const e of state.enemies) {
    if (Math.random() < state.enemyMoveChance) moveEnemy(state, e);
    else e.moving = false;
  }

  // 13a. Enemy ↔ electrode collision — an enemy that walks into an intact
  // electrode blows up and destroys the electrode (no score awarded).
  {
    const rr = (ENEMY_RADIUS + ELECTRODE_RADIUS) * (ENEMY_RADIUS + ELECTRODE_RADIUS);
    for (let i = state.enemies.length - 1; i >= 0; i--) {
      const e = state.enemies[i];
      for (const el of state.electrodes) {
        if (el.shrink > 0) continue;
        if (dist2(e.x, e.y, el.x, el.y) < rr) {
          spawnDebris(state, e.x, e.y, e.x - el.x || 1, e.y - el.y, DEBRIS_COLOR[e.kind] ?? "#fff");
          state.enemies.splice(i, 1);
          el.shrink = 1;
          el.shrinkTimer = ELECTRODE_SHRINK_TIME;
          state.events.push("enemyDie");
          state.events.push("electrodeHit");
          break;
        }
      }
    }
  }

  // 13c. Smart-enemy teleport — a clever enemy (smartness > 1) standing on a pad
  // takes it when the paired pad lands it meaningfully closer to its target,
  // emerging out the far side heading toward the player/decoy.
  if (maze.teleportPads.length > 0) {
    const tgt = state.decoy ? { x: state.decoy.x, y: state.decoy.y } : { x: player.x, y: player.y };
    const cellMin = Math.min(cellW, cellH);
    for (const e of state.enemies) {
      if (e.smartness <= 1) continue;
      for (const pad of maze.teleportPads) {
        const pc = cellCenter(maze, pad.col, pad.row);
        if (dist2(e.x, e.y, pc.x, pc.y) >= TELEPORT_PAD_RADIUS * TELEPORT_PAD_RADIUS) continue;
        const partner = teleportPartner(maze, pad);
        if (!partner) continue;
        const oc = cellCenter(maze, partner.col, partner.row);
        const here = Math.hypot(e.x - tgt.x, e.y - tgt.y);
        const there = Math.hypot(oc.x - tgt.x, oc.y - tgt.y);
        if (there + cellMin < here) {
          const dx = tgt.x - oc.x;
          const dy = tgt.y - oc.y;
          const dl = Math.hypot(dx, dy) || 1;
          e.x = oc.x + (dx / dl) * TELEPORT_EXIT_OFFSET;
          e.y = oc.y + (dy / dl) * TELEPORT_EXIT_OFFSET;
          e.col = Math.max(0, Math.min(cols - 1, Math.floor(e.x / cellW)));
          e.row = Math.max(0, Math.min(rows - 1, Math.floor(e.y / cellH)));
          e.path = []; // stale after a jump — force a fresh BFS
          break;
        }
      }
    }
  }

  // 13b. Family movement — every other frame, random wander
  if (state.frame % 2 === 0) {
    for (const h of state.humans) moveFamily(state, h);
  } else {
    for (const h of state.humans) h.moving = false;
  }

  // 14. Enemy shooting — only the ranged types fire (enforcer/tank). The swarm
  // types (grunt/hulk/brain/spheroid/phantom) threaten by contact instead.
  const playerCell = cellAt(maze, player.x, player.y);
  for (const e of state.enemies) {
    if (e.kind !== "enforcer" && e.kind !== "tank") continue;
    if (e.shootCooldown > 0) continue;
    if (!lineOfSight(maze, e.col, e.row, playerCell.col, playerCell.row)) continue;

    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    const angle = Math.atan2(dy, dx);

    const spawnEnemyBullet = (a: number) => {
      state.bullets.push({
        id: state.nextBulletId++,
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * BULLET_SPEED,
        vy: Math.sin(a) * BULLET_SPEED,
        fromPlayer: false,
      });
    };

    if (e.kind === "enforcer") {
      const fanStep =
        ENFORCER_SPREAD_COUNT > 1 ? ENFORCER_SPREAD_ANGLE / (ENFORCER_SPREAD_COUNT - 1) : 0;
      for (let i = 0; i < ENFORCER_SPREAD_COUNT; i++) {
        spawnEnemyBullet(angle - ENFORCER_SPREAD_ANGLE / 2 + i * fanStep);
      }
      e.shootCooldown = ENFORCER_SHOOT_COOLDOWN;
    } else {
      spawnEnemyBullet(angle);
      e.shootCooldown = ENFORCER_SHOOT_COOLDOWN;
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
    // 15a. Bullet teleport — a bullet crossing a pad emerges out the far side of
    // its pair, keeping its velocity (so it continues in the same direction).
    for (const pad of maze.teleportPads) {
      const pc = cellCenter(maze, pad.col, pad.row);
      const bpx = b.x - b.vx * dt;
      const bpy = b.y - b.vy * dt;
      if (segDist2(pc.x, pc.y, bpx, bpy, b.x, b.y) < TELEPORT_PAD_RADIUS * TELEPORT_PAD_RADIUS) {
        const partner = teleportPartner(maze, pad);
        if (partner) {
          const oc = cellCenter(maze, partner.col, partner.row);
          const bl = Math.hypot(b.vx, b.vy) || 1;
          b.x = oc.x + (b.vx / bl) * TELEPORT_EXIT_OFFSET;
          b.y = oc.y + (b.vy / bl) * TELEPORT_EXIT_OFFSET;
        }
        break;
      }
    }
    if (b.x < 0 || b.y < 0 || b.x >= cols * cellW || b.y >= rows * cellH) {
      state.bullets.splice(i, 1);
    }
  }

  // 15b. Player-bullet vs electrode — destroy it (shrink animation), stop bullet
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (!b.fromPlayer) continue;
    const bpx = b.x - b.vx * dt;
    const bpy = b.y - b.vy * dt;
    for (const el of state.electrodes) {
      if (el.shrink > 0) continue;
      const rr = (ELECTRODE_RADIUS + BULLET_RADIUS) * (ELECTRODE_RADIUS + BULLET_RADIUS);
      if (segDist2(el.x, el.y, bpx, bpy, b.x, b.y) < rr) {
        state.bullets.splice(i, 1);
        el.shrink = 1;
        el.shrinkTimer = ELECTRODE_SHRINK_TIME;
        state.events.push("electrodeHit");
        break;
      }
    }
  }

  // 15c. Advance electrode shrink animation; remove when fully shrunk
  for (let i = state.electrodes.length - 1; i >= 0; i--) {
    const el = state.electrodes[i];
    if (el.shrink === 0) continue;
    el.shrinkTimer -= dt;
    if (el.shrinkTimer <= 0) {
      el.shrink++;
      el.shrinkTimer = ELECTRODE_SHRINK_TIME;
      if (el.shrink > 2) state.electrodes.splice(i, 1);
    }
  }

  // 16. Player damage — enemy bullets, enemy contact, electrode contact
  if (player.invuln <= 0 && player.respawnTimer <= 0) {
    let hit = false;
    for (let i = state.bullets.length - 1; i >= 0 && !hit; i--) {
      const b = state.bullets[i];
      if (b.fromPlayer) continue;
      const bpx = b.x - b.vx * dt;
      const bpy = b.y - b.vy * dt;
      if (segDist2(player.x, player.y, bpx, bpy, b.x, b.y) < PLAYER_RADIUS * PLAYER_RADIUS) {
        state.bullets.splice(i, 1);
        hit = true;
      }
    }
    if (!hit) {
      const rr = (ENEMY_RADIUS + PLAYER_RADIUS) * (ENEMY_RADIUS + PLAYER_RADIUS);
      for (const e of state.enemies) {
        if (e.kind === "phantom" && (e as Phantom).phasing) continue;
        if (dist2(e.x, e.y, player.x, player.y) < rr) {
          hit = true;
          break;
        }
      }
    }
    if (!hit && hitsElectrode(state, player.x, player.y, PLAYER_RADIUS)) hit = true;
    if (hit) damagePlayer(state);
  }

  // 17. Enemy-player bullet collision
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    if (!b.fromPlayer) continue;
    const bpx = b.x - b.vx * dt;
    const bpy = b.y - b.vy * dt;
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j];
      if (e.kind === "phantom" && (e as Phantom).phasing) continue;
      if (
        segDist2(e.x, e.y, bpx, bpy, b.x, b.y) <
        (ENEMY_RADIUS + BULLET_RADIUS) * (ENEMY_RADIUS + BULLET_RADIUS)
      ) {
        e.hp--;
        if (e.hp <= 0) {
          spawnDebris(state, e.x, e.y, b.vx, b.vy, DEBRIS_COLOR[e.kind] ?? "#ffffff");
          state.enemies.splice(j, 1);
          state.score += ENEMY_KILL_SCORE;
          state.events.push("enemyDie");
        }
        state.bullets.splice(i, 1);
        break;
      }
    }
  }

  // 19. Family death — ONLY an intact electrode can kill a family member now;
  // enemies never harm them. Since they actively avoid electrodes while
  // wandering, this is a rare safety net (e.g. a spawn-overlap edge case).
  for (let i = state.humans.length - 1; i >= 0; i--) {
    const h = state.humans[i];
    if (hitsElectrode(state, h.x, h.y, PLAYER_RADIUS)) {
      spawnDebris(state, h.x, h.y, 1, 0, DEBRIS_COLOR[h.type] ?? "#ffffff");
      state.humans.splice(i, 1);
      state.score = Math.max(0, state.score - HUMAN_KILL_PENALTY);
      state.events.push("familyDie");
    }
  }

  // 22. Particle simulation — debris integrate velocity; reconstitute particles
  // (with a target) lerp from their start toward the player, accelerating in.
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.ttl -= dt;
    if (p.tx !== undefined && p.ty !== undefined && p.sx0 !== undefined && p.sy0 !== undefined) {
      const prog = 1 - Math.max(0, p.ttl / p.life); // 0 → 1
      const eased = prog * prog; // ease-in: accelerate toward the player
      p.x = p.sx0 + (p.tx - p.sx0) * eased;
      p.y = p.sy0 + (p.ty - p.sy0) * eased;
    } else {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
    }
    if (p.ttl <= 0) state.particles.splice(i, 1);
  }

  // 21. Level-clear check (never overwrite a gameover that was just set in rule 16;
  // lives > 0 is equivalent and avoids a TS control-flow narrowing snag)
  if (state.enemies.length === 0 && !state.exitsOpen && state.lives > 0) {
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
