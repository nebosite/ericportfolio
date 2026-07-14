// Big Space Tiny Invaders — the pure game model. Every rule lives here (unit
// tested in invadersLogic.test.ts); the component owns only pixels, timers,
// sound and input plumbing. Built for scale: the formation is thousands of
// invaders stored in typed arrays and moved as one rigid body, so stepping,
// collision (grid-indexed, O(1) per bullet) and rendering (one blit) stay
// cheap no matter how big the horde gets. Scrap grains are a preallocated
// struct-of-arrays particle pool for the same reason.
//
// Like pipeLogic, step() mutates the state it is given and returns it. Sounds
// are data: rules push SoundEvents onto state.events (cleared each step);
// formation deaths/births go on state.deadSlots/state.bornSlots so the render
// layer can patch its offscreen formation bitmap instead of redrawing it.

export type Vec2 = { x: number; y: number };

export type SoundEvent =
  | "shoot"
  | "pop" // an invader dies
  | "zap" // chain lightning propagates a jump
  | "missile"
  | "boom" // missile blast
  | "nuke"
  | "beam" // air support
  | "ufo"
  | "laser"
  | "pickup" // scrap grain collected
  | "powerup"
  | "stackup" // a stackable powerup leveled up
  | "reload" // energy meter converted into missiles
  | "playerdown"
  | "levelup"
  | "gameover";

export type WeaponKind = "gun" | "sprinkler" | "chain";
export type PowerupKind = "sprinkler" | "chain" | "missiles" | "air" | "nuke" | "life" | "wall";

export interface InputState {
  left: boolean;
  right: boolean;
  fire: boolean;
  /** One-shot: launch a missile toward this point (consumed by step). */
  missile: Vec2 | null;
  /** One-shot: call down air support / drop the ground nuke. */
  air: boolean;
  nuke: boolean;
  /** One-shot: cycle the equipped shooting weapon. */
  selectWeapon: boolean;
}

export interface Player {
  x: number;
  invuln: number; // seconds of post-hit grace
  cooldown: number;
  sweep: number; // sprinkler sweep phase (radians)
}

/** The marching horde: a rigid grid moved by its origin; only alive flags,
 *  per-row/col counts and cached extents are stored per-slot. */
export interface Formation {
  cols: number;
  rows: number;
  x: number; // origin (top-left of the grid)
  y: number;
  dir: 1 | -1;
  alive: Uint8Array; // idx = row * cols + col
  aliveCount: number;
  colCounts: Uint16Array;
  rowCounts: Uint16Array;
  minCol: number; // cached alive extents (maintained on death/birth)
  maxCol: number;
  maxRow: number;
}

export type FlyerMode = "dive" | "return" | "arrive";

/** A swooping invader following a Catmull-Rom spline as part of a squadron;
 *  offx/offy keep the squadron's formation shape along the shared path. */
export interface Flyer {
  mode: FlyerMode;
  slot: number; // home / target slot in the formation
  type: number;
  x: number;
  y: number;
  path: number[]; // flattened spline control points [x0,y0,x1,y1,…]
  offx: number;
  offy: number;
  t: number; // starts negative: each ship is time-offset to follow its leader
  dur: number;
  fireCooldown: number;
  wob: number; // per-ship steering-jitter phase, so flights look organic
  squad: number; // dive-squad id (for the wipe-out bonus), or -1
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  chain: boolean; // chain-lightning round
  chainGen: number; // jumps deep (0 = the shot you fired)
  chainTarget: number; // homing target slot for a forked bolt, else -1
}

export interface EBullet {
  x: number;
  y: number;
  vy: number;
}

/** An air-support missile falling straight down from above the strike point. */
export interface AirMissile {
  x: number;
  y: number;
  vy: number;
}

/** A guided missile on a quadratic bezier that bends around shield walls. */
export interface Missile {
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  tx: number;
  ty: number;
  x: number;
  y: number;
  u: number;
  len: number; // approximate curve length, for constant speed
}

/** Expanding friendly blast (missile or nuke). Kills as it grows. */
export interface Blast {
  x: number;
  y: number;
  maxR: number;
  age: number;
  ttl: number;
  kind: "missile" | "nuke";
}

export interface Beam {
  cx: number;
  halfW: number;
  age: number;
  ttl: number;
}

/** A short-lived crackle drawn between a chain hit and each ship it forks to. */
export interface Bolt {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  ttl: number;
}

export interface NukeFuse {
  x: number;
  y: number;
  fuse: number;
}

export interface Shield {
  x: number; // top-left
  y: number;
  cellsW: number;
  cellsH: number;
  cells: Uint8Array;
  dirty: boolean; // renderer clears this after repainting
}

export interface Ufo {
  x: number;
  y: number;
  vx: number;
  charge: number; // >0: warming up the laser
  laser: number; // >0: beam active for this long
  gunCooldown: number;
}

export interface Pickup {
  x: number;
  y: number;
  vy: number; // falls under the same gravity as the debris
  groundTtl: number; // once landed, seconds before it fades away
  kind: PowerupKind;
}

/** Rising "you got X" text near the player. */
export interface Floater {
  x: number;
  y: number;
  kind: PowerupKind;
  age: number;
  ttl: number;
}

export interface Firework {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  ttl: number;
  hue: number;
}

/** A glowing patch of hot ground left by a nuke; deadly to the ship while hot. */
export interface Lava {
  x: number;
  halfW: number;
  age: number;
  ttl: number;
}

/** Preallocated struct-of-arrays pool for the shimmering scrap grains. */
export interface ScrapPool {
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  ttl: Float32Array;
  seed: Float32Array; // per-grain sparkle phase/period
  count: number;
}

/** A dive squadron: destroy every member for a bonus. */
export interface Squad {
  id: number;
  total: number;
  killed: number;
  returned: number;
}

/** Rising bonus text (e.g. the squadron wipe-out). */
export interface Banner {
  x: number;
  y: number;
  text: string;
  age: number;
  ttl: number;
}

export interface GameState {
  w: number;
  h: number;
  level: number;
  score: number;
  lives: number;
  charge: number; // one shared pool: bullets/missiles cost it, debris + time refill it
  player: Player;
  respawn: number; // >0 while the ship is gone
  form: Formation;
  introQueue: number[]; // slots still to fly in, in launch order (lowest rows first)
  introLaunched: number; // how many of introQueue have launched
  introElapsed: number; // seconds since the fly-in began
  flyers: Flyer[];
  bullets: Bullet[];
  ebullets: EBullet[];
  missiles: Missile[];
  airMissiles: AirMissile[];
  blasts: Blast[];
  beams: Beam[];
  bolts: Bolt[];
  fuses: NukeFuse[];
  shields: Shield[];
  ufos: Ufo[];
  pickups: Pickup[];
  floaters: Floater[];
  fireworks: Firework[];
  lavas: Lava[];
  banners: Banner[];
  squads: Squad[];
  nextSquadId: number;
  scrap: ScrapPool;
  weapon: WeaponKind; // the equipped shooting weapon
  weapons: WeaponKind[]; // unlocked shooting weapons, cycled by the select key
  airAmmo: number;
  nukeAmmo: number;
  chainStack: number; // 0..MAX_STACK — extra chain-lightning generations
  missileStack: number; // 0..MAX_STACK — each doubles missile blast area
  nukeStack: number; // 0..MAX_STACK — each doubles nuke blast area
  sprinklerStack: number; // 0..MAX_STACK — each +50% sprinkler fire rate
  airStack: number; // 0..MAX_STACK — each +30% air-support width
  eShotTimer: number;
  flyerTimer: number;
  ufoTimer: number;
  ufoDefeated: boolean; // once shot down, no UFO returns until the next level
  over: boolean;
  events: SoundEvent[];
  deadSlots: number[]; // formation deaths this step (renderer patches its bitmap)
  bornSlots: number[]; // formation arrivals this step
}

// ---------------------------------------------------------------------------
// Tuning constants

export const SPACING = 9; // 7px invader + 2px gap
export const INV_HIT = 4.5; // hit radius around a slot center
export const DROP = 10; // how far the horde drops at each edge

export const PLAYER_SPEED = 260;
export const PLAYER_HALF = 6;
export const START_LIVES = 3;
export const RESPAWN_DELAY = 1.4;
export const RESPAWN_INVULN = 2.2;

// One shared charge pool feeds bullets and missiles (big satisfying numbers).
export const CHARGE_START = 2500;
export const CHARGE_REGEN = 20; // passive +20 per second
export const CHARGE_PER_SCRAP = 20; // each grain collected
export const COST_BULLET = 10;
export const COST_CHAIN = 500;
export const COST_MISSILE = 1000;

export const BULLET_SPEED = 540;
export const GUN_COOLDOWN = 0.18;
export const SPRINKLER_COOLDOWN = 0.03;
export const SPRINKLER_ARC = (20 * Math.PI) / 180; // full sweep width
export const SPRINKLER_RATE = 5; // sweep oscillations per second
export const SPRINKLER_RATE_PER_STACK = 0.5; // each sprinkler stack: +50% fire rate
export const AIR_WIDTH_PER_STACK = 0.3; // each air-support stack: +30% width
export const CHAIN_COOLDOWN = 0.3;
export const PLAYER_SHIELD_PUNCH = 6; // px bite per player round (3× the old 2)
export const ENEMY_SHIELD_PUNCH = 2;

// A chain hit forks to its CHAIN_FANOUT nearest unharmed ships, each fork
// travelling as its own homing bolt; forking runs CHAIN_JUMPS generations, so
// one round wipes about 1 + 4 + 16 + 64 ≈ 85 invaders.
export const CHAIN_FANOUT = 4;
export const CHAIN_JUMPS = 3;
export const CHAIN_RADIUS = 10 * SPACING; // 10 grid squares — else the fork dies
export const CHAIN_BULLET_SPEED = 460;

export const MISSILE_SPEED = 840;
export const MISSILE_BLAST_R = 5 * SPACING;
export const MAX_STACK = 3; // stackable powerups cap at +3
/** Radius multiplier for `stack` area-doublings (each stack doubles the area). */
export function areaStackMul(stack: number): number {
  return Math.sqrt(2) ** stack;
}
export const CHAIN_BULLET_CAP = 2500; // perf guard: forks stop past this many bolts
export const LAVA_TTL = 3.5; // seconds a nuke's molten ground stays deadly-hot
export const NUKE_FUSE = 1.5;
export const NUKE_BLAST_R = 30 * SPACING; // twice the old footprint
export const NUKE_RISE_SPEED = 200; // the fused charge rises this fast before it blows

// Air support: a barrage of half-strength missiles raining from above the
// strike point, each exploding on the first invader/shield/ground it hits.
export const AIR_MISSILE_COUNT = 50;
export const AIR_MISSILE_SPREAD = 200; // ± horizontal offset from the strike x
export const AIR_MISSILE_SPEED = 340;
export const AIR_MISSILE_BLAST_R = MISSILE_BLAST_R * 0.5; // half strength
export const AIR_SPREAD_PER_STACK = 0.3; // each air stack: +30% spread width

export const EBULLET_CAP = 150;
export const SCRAP_MAX = 15000;
export const SCRAP_TTL_MIN = 10;
export const SCRAP_TTL_MAX = 15;
export const SCRAP_DROP_CHANCE = 1 / 10; // ~1 in 10 kills sheds scrap
export const SCRAP_PER_KILL = 1; // + up to 1 more, random (when a kill does drop)
export const SCRAP_GROUND_TTL = 2; // a grain dies 2s after it lands
export const PICKUP_RADIUS = 16;
export const MAGNET_RADIUS = 60;

export const POWERUP_CHANCE = 0.0008; // per invader death (rare)
export const SHIELD_DROP_CHANCE = 0.005; // per bullet that bites a shield wall
export const PICKUP_GRAVITY = 60; // same pull as the scrap grains
export const PICKUP_GROUND_TTL = 4; // seconds a landed pickup waits to be grabbed
export const FLOATER_TTL = 1.3;
export const BANNER_TTL = 1.6;

export const UFO_Y = 24;
export const UFO_SPEED = 90;
export const UFO_GAP_MIN = 25; // pretty rare, and only ever one at a time
export const UFO_GAP_MAX = 45;
export const UFO_CHARGE = 0.5;
export const UFO_LASER_DESCEND = 2; // seconds for the beam to crawl to the ground
export const UFO_LASER_HOLD = 0.4; // lingers briefly at full length once it lands
export const UFO_SCORE = 1000;
export const FLYER_SCORE = 50;
export const SQUAD_BONUS = 1000; // wipe out an entire dive squadron
export const SOLDIER_FIRE_WEIGHT = 3; // soldiers are picked to fire 3× as often

export const SQUAD_MIN = 10; // dive squadron size
export const SQUAD_MAX = 15;
export const DIVE_DUR = 9; // a slow, graceful swoop: down low, then right back up
export const DIVE_STAGGER = 0.12; // per-ship time offset — follow the leader
export const RETURN_DUR = 2.6;
export const FLYER_FIRE_MIN = 0.5; // each swooping ship shoots ~4× as often (0.5–1.25 s)
export const FLYER_FIRE_MAX = 1.25;
export const FLYER_JITTER = 2.2; // px of organic steering wobble

// Fly-in: an air-raid siren wails for INTRO_WARMUP seconds first (nothing
// launches), then every invader takes its own curving path to its slot, the
// lowest rows filling first, over INTRO_LAUNCH_WINDOW (+ ~1s flight).
export const INTRO_WARMUP = 3;
export const INTRO_LAUNCH_WINDOW = 3;
export const INTRO_DUR_MIN = 0.8;
export const INTRO_DUR_MAX = 1.1;

export const SHIELD_CELL = 2; // px per shield bitmap cell
export const SHIELD_W = 24; // cells
export const SHIELD_H = 16;

// Weighted powerup table.
export const DROP_TABLE: Array<{ kind: PowerupKind; weight: number }> = [
  { kind: "missiles", weight: 24 },
  { kind: "sprinkler", weight: 22 },
  { kind: "chain", weight: 20 },
  { kind: "air", weight: 14 },
  { kind: "nuke", weight: 12 },
  { kind: "wall", weight: 12 }, // rebuild the shield walls
  { kind: "life", weight: 0.8 }, // extra ships are now ~1/10 as common
];

/** Shield walls: about 5 per thousand pixels of width. */
export function shieldCount(w: number): number {
  return Math.max(2, Math.round((w / 1000) * 5));
}

/** How big the horde is: wide, and deep enough to cover the top half. */
export function formationDims(w: number, h: number): { cols: number; rows: number } {
  const cols = Math.max(10, Math.floor((w * 0.86) / SPACING));
  const rows = Math.max(6, Math.floor((h * 0.5) / SPACING));
  // Perf ceiling: cap the grid at 20k slots, trimming rows first.
  const cap = 20000;
  return cols * rows <= cap ? { cols, rows } : { cols, rows: Math.max(6, Math.floor(cap / cols)) };
}

/** Horde march speed: faster each level, and faster as the horde thins. */
export function marchSpeed(level: number, aliveFrac: number): number {
  return Math.min(150, (10 + 6 * level) * (1 + 2 * (1 - aliveFrac)));
}

/** Horde fire rate (shots per second), scaling with the level. */
export function eShotsPerSec(level: number): number {
  return Math.min(20, 1.5 + 1.2 * level);
}

export function eBulletSpeed(level: number): number {
  return Math.min(260, 120 + 8 * level);
}

export function groundY(h: number): number {
  return h - 26;
}

export function shieldTopY(h: number): number {
  return h - 88;
}

/** Swooping squadrons never fly lower than 10px above the shield tops. */
export function swoopFloorY(h: number): number {
  return shieldTopY(h) - 10;
}

// ---------------------------------------------------------------------------
// Splines (Catmull-Rom with clamped ends) — the flight language of the game.

export function splinePoint(pts: number[], u: number): Vec2 {
  const n = pts.length / 2;
  if (n === 1) return { x: pts[0], y: pts[1] };
  const segs = n - 1;
  const f = Math.min(segs - 1e-4, Math.max(0, u * segs));
  const i = Math.floor(f);
  const t = f - i;
  const px = (k: number) => pts[Math.max(0, Math.min(n - 1, k)) * 2];
  const py = (k: number) => pts[Math.max(0, Math.min(n - 1, k)) * 2 + 1];
  const t2 = t * t;
  const t3 = t2 * t;
  const cr = (p0: number, p1: number, p2: number, p3: number) =>
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  return {
    x: cr(px(i - 1), px(i), px(i + 1), px(i + 2)),
    y: cr(py(i - 1), py(i), py(i + 1), py(i + 2)),
  };
}

// ---------------------------------------------------------------------------
// Construction

function invaderType(row: number, rows: number): number {
  return row < rows * 0.2 ? 2 : row < rows * 0.55 ? 1 : 0;
}

export const TYPE_SCORE = [10, 20, 30];

export function slotCenter(form: Formation, idx: number): Vec2 {
  const col = idx % form.cols;
  const row = (idx / form.cols) | 0;
  return {
    x: form.x + col * SPACING + SPACING / 2,
    y: form.y + row * SPACING + SPACING / 2,
  };
}

/** An EMPTY formation — the horde flies in as intro squadrons fill it. */
export function makeFormation(w: number, h: number): Formation {
  const { cols, rows } = formationDims(w, h);
  return {
    cols,
    rows,
    x: (w - cols * SPACING) / 2,
    y: 42,
    dir: 1,
    alive: new Uint8Array(cols * rows),
    aliveCount: 0,
    colCounts: new Uint16Array(cols),
    rowCounts: new Uint16Array(rows),
    minCol: 0,
    maxCol: cols - 1,
    maxRow: rows - 1,
  };
}

/** The fly-in order: every slot, lowest rows first (shuffled within a row) so
 *  the grid fills from the bottom up. */
export function makeIntroQueue(form: Formation, rng: () => number): number[] {
  const queue: number[] = [];
  for (let row = form.rows - 1; row >= 0; row--) {
    const rowSlots: number[] = [];
    for (let col = 0; col < form.cols; col++) rowSlots.push(row * form.cols + col);
    // Shuffle within the row for an organic, non-mechanical fill.
    for (let i = rowSlots.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [rowSlots[i], rowSlots[j]] = [rowSlots[j], rowSlots[i]];
    }
    queue.push(...rowSlots);
  }
  return queue;
}

function classicShieldCells(): Uint8Array {
  // A classic notched bunker: solid block, beveled top corners, arched
  // bottom-center doorway.
  const cells = new Uint8Array(SHIELD_W * SHIELD_H).fill(1);
  for (let y = 0; y < SHIELD_H; y++) {
    for (let x = 0; x < SHIELD_W; x++) {
      const bevel = 5 - y;
      if (bevel > 0 && (x < bevel || x >= SHIELD_W - bevel)) cells[y * SHIELD_W + x] = 0;
      const dx = Math.abs(x - (SHIELD_W - 1) / 2);
      if (y >= SHIELD_H - 5 && dx < 5 - (SHIELD_H - 1 - y)) cells[y * SHIELD_W + x] = 0;
    }
  }
  return cells;
}

export function makeShields(w: number, h: number): Shield[] {
  const count = shieldCount(w);
  const shields: Shield[] = [];
  const shieldPxW = SHIELD_W * SHIELD_CELL;
  const gap = w / count;
  for (let i = 0; i < count; i++) {
    shields.push({
      x: gap * (i + 0.5) - shieldPxW / 2,
      y: shieldTopY(h),
      cellsW: SHIELD_W,
      cellsH: SHIELD_H,
      cells: classicShieldCells(),
      dirty: true,
    });
  }
  return shields;
}

export function initialState(w: number, h: number, rng: () => number = Math.random): GameState {
  const form = makeFormation(w, h);
  return {
    w,
    h,
    level: 1,
    score: 0,
    lives: START_LIVES,
    charge: CHARGE_START,
    player: { x: w / 2, invuln: RESPAWN_INVULN, cooldown: 0, sweep: 0 },
    respawn: 0,
    form,
    introQueue: makeIntroQueue(form, rng),
    introLaunched: 0,
    introElapsed: 0,
    flyers: [],
    bullets: [],
    ebullets: [],
    missiles: [],
    airMissiles: [],
    blasts: [],
    beams: [],
    bolts: [],
    fuses: [],
    shields: makeShields(w, h),
    ufos: [],
    pickups: [],
    floaters: [],
    fireworks: [],
    lavas: [],
    banners: [],
    squads: [],
    nextSquadId: 1,
    scrap: {
      x: new Float32Array(SCRAP_MAX),
      y: new Float32Array(SCRAP_MAX),
      vx: new Float32Array(SCRAP_MAX),
      vy: new Float32Array(SCRAP_MAX),
      ttl: new Float32Array(SCRAP_MAX),
      seed: new Float32Array(SCRAP_MAX),
      count: 0,
    },
    weapon: "gun",
    weapons: ["gun"],
    airAmmo: 0,
    nukeAmmo: 0,
    chainStack: 0,
    missileStack: 0,
    nukeStack: 0,
    sprinklerStack: 0,
    airStack: 0,
    eShotTimer: 1,
    flyerTimer: 7,
    ufoTimer: UFO_GAP_MIN,
    ufoDefeated: false,
    over: false,
    events: [],
    deadSlots: [],
    bornSlots: [],
  };
}

/** Test/dev helper: skip the intro and materialize the whole horde at once. */
export function fillFormation(state: GameState): void {
  const form = state.form;
  form.alive.fill(1);
  form.aliveCount = form.cols * form.rows;
  form.colCounts.fill(form.rows);
  form.rowCounts.fill(form.cols);
  form.minCol = 0;
  form.maxCol = form.cols - 1;
  form.maxRow = form.rows - 1;
  state.introQueue = [];
  state.introLaunched = 0;
}

// ---------------------------------------------------------------------------
// Formation bookkeeping

function refreshEdges(form: Formation): void {
  if (form.aliveCount === 0) return;
  while (form.minCol < form.cols - 1 && form.colCounts[form.minCol] === 0) form.minCol++;
  while (form.maxCol > 0 && form.colCounts[form.maxCol] === 0) form.maxCol--;
  while (form.maxRow > 0 && form.rowCounts[form.maxRow] === 0) form.maxRow--;
}

function detachSlot(state: GameState, idx: number): void {
  const form = state.form;
  form.alive[idx] = 0;
  form.aliveCount--;
  form.colCounts[idx % form.cols]--;
  form.rowCounts[(idx / form.cols) | 0]--;
  refreshEdges(form);
  state.deadSlots.push(idx);
}

/** Kill the invader in this slot (no-op when already empty). Returns true on a kill. */
export function killSlot(
  state: GameState,
  idx: number,
  rng: () => number,
  opts: { silent?: boolean } = {},
): boolean {
  const form = state.form;
  if (!form.alive[idx]) return false;
  detachSlot(state, idx);
  const row = (idx / form.cols) | 0;
  const type = invaderType(row, form.rows);
  state.score += TYPE_SCORE[type];
  if (!opts.silent) state.events.push("pop");
  const at = slotCenter(form, idx);
  spawnScrap(state, at.x, at.y, rng);
  maybeDropPowerup(state, at.x, at.y, rng);
  return true;
}

/** Grid slot under a point, or -1. */
export function slotAt(form: Formation, x: number, y: number): number {
  const col = Math.floor((x - form.x) / SPACING);
  const row = Math.floor((y - form.y) / SPACING);
  if (col < 0 || col >= form.cols || row < 0 || row >= form.rows) return -1;
  return row * form.cols + col;
}

/** Alive slot whose invader body overlaps the point, or -1. */
export function hitSlotAt(form: Formation, x: number, y: number): number {
  const idx = slotAt(form, x, y);
  if (idx < 0 || !form.alive[idx]) return -1;
  const c = slotCenter(form, idx);
  const dx = x - c.x;
  const dy = y - c.y;
  return dx * dx + dy * dy <= INV_HIT * INV_HIT ? idx : -1;
}

function reviveSlot(state: GameState, idx: number): void {
  const form = state.form;
  if (form.alive[idx]) return;
  form.alive[idx] = 1;
  form.aliveCount++;
  const col = idx % form.cols;
  const row = (idx / form.cols) | 0;
  form.colCounts[col]++;
  form.rowCounts[row]++;
  if (col < form.minCol) form.minCol = col;
  if (col > form.maxCol) form.maxCol = col;
  if (row > form.maxRow) form.maxRow = row;
  state.bornSlots.push(idx);
}

// ---------------------------------------------------------------------------
// Scrap + powerups

function spawnScrap(state: GameState, x: number, y: number, rng: () => number): void {
  if (rng() >= SCRAP_DROP_CHANCE) return; // most kills shed nothing now
  const s = state.scrap;
  const n = SCRAP_PER_KILL + Math.floor(rng() * 2);
  for (let i = 0; i < n; i++) {
    if (s.count >= SCRAP_MAX) return;
    const k = s.count++;
    const a = rng() * Math.PI * 2;
    const sp = 15 + rng() * 35;
    s.x[k] = x;
    s.y[k] = y;
    s.vx[k] = Math.cos(a) * sp;
    s.vy[k] = Math.sin(a) * sp - 20;
    s.ttl[k] = SCRAP_TTL_MIN + rng() * (SCRAP_TTL_MAX - SCRAP_TTL_MIN);
    s.seed[k] = rng();
  }
}

function removeScrap(s: ScrapPool, k: number): void {
  const last = --s.count;
  s.x[k] = s.x[last];
  s.y[k] = s.y[last];
  s.vx[k] = s.vx[last];
  s.vy[k] = s.vy[last];
  s.ttl[k] = s.ttl[last];
  s.seed[k] = s.seed[last];
}

export function rollPowerup(rng: () => number): PowerupKind {
  const total = DROP_TABLE.reduce((sum, d) => sum + d.weight, 0);
  let roll = rng() * total;
  for (const d of DROP_TABLE) {
    roll -= d.weight;
    if (roll <= 0) return d.kind;
  }
  return DROP_TABLE[0].kind;
}

function dropPickup(state: GameState, x: number, y: number, kind: PowerupKind): void {
  state.pickups.push({ x, y, vy: 0, groundTtl: PICKUP_GROUND_TTL, kind });
}

function maybeDropPowerup(state: GameState, x: number, y: number, rng: () => number): void {
  if (rng() >= POWERUP_CHANCE) return;
  dropPickup(state, x, y, rollPowerup(rng));
}

export function applyPowerup(state: GameState, kind: PowerupKind): void {
  // A "stackup" event replaces the usual "powerup" chime whenever a stackable
  // pickup actually levels up (short of its cap).
  const stack = (cur: number): { value: number; leveled: boolean } => {
    if (cur < MAX_STACK) return { value: cur + 1, leveled: true };
    return { value: cur, leveled: false };
  };
  // Unlock + equip a shooting weapon the first time it's collected.
  const unlock = (kind: WeaponKind) => {
    if (!state.weapons.includes(kind)) state.weapons.push(kind);
    state.weapon = kind;
  };
  switch (kind) {
    case "sprinkler": {
      const known = state.weapons.includes("sprinkler");
      unlock("sprinkler");
      const s = known
        ? stack(state.sprinklerStack)
        : { value: state.sprinklerStack, leveled: false };
      state.sprinklerStack = s.value; // each extra +50% fire rate
      state.events.push(s.leveled ? "stackup" : "powerup");
      break;
    }
    case "chain": {
      const known = state.weapons.includes("chain");
      unlock("chain");
      const s = known ? stack(state.chainStack) : { value: state.chainStack, leveled: false };
      state.chainStack = s.value; // each extra deepens the cascade
      state.events.push(s.leveled ? "stackup" : "powerup");
      break;
    }
    case "missiles": {
      // Dust/energy already fuels missiles; the pickup upgrades their blast.
      const s = stack(state.missileStack);
      state.missileStack = s.value;
      state.events.push(s.leveled ? "stackup" : "powerup");
      break;
    }
    case "air": {
      state.airAmmo += 1;
      const s = stack(state.airStack); // each +30% beam width
      state.airStack = s.value;
      state.events.push(s.leveled ? "stackup" : "powerup");
      break;
    }
    case "nuke": {
      state.nukeAmmo += 1;
      const s = stack(state.nukeStack);
      state.nukeStack = s.value;
      state.events.push(s.leveled ? "stackup" : "powerup");
      break;
    }
    case "wall":
      // Rebuild every shield wall to full.
      for (const shield of state.shields) {
        shield.cells = classicShieldCells();
        shield.dirty = true;
      }
      state.events.push("powerup");
      break;
    case "life":
      state.lives += 1;
      state.events.push("powerup");
      break;
  }
}

/** Cycle the equipped shooting weapon through the unlocked list. */
export function cycleWeapon(state: GameState): void {
  if (state.weapons.length < 2) return;
  const i = state.weapons.indexOf(state.weapon);
  state.weapon = state.weapons[(i + 1) % state.weapons.length];
}

// ---------------------------------------------------------------------------
// Shields

/** Carve a circular bite out of any shield the point lands in. Returns true
 *  if solid shield material was hit. */
export function damageShieldAt(state: GameState, x: number, y: number, r: number): boolean {
  let hit = false;
  for (const shield of state.shields) {
    const px = x - shield.x;
    const py = y - shield.y;
    const w = shield.cellsW * SHIELD_CELL;
    const h = shield.cellsH * SHIELD_CELL;
    if (px < -r || px > w + r || py < -r || py > h + r) continue;
    const cr = Math.max(1, Math.round(r / SHIELD_CELL));
    const cx = Math.floor(px / SHIELD_CELL);
    const cy = Math.floor(py / SHIELD_CELL);
    // Must strike solid material at the impact cell (with a 1-cell tolerance).
    let struck = false;
    for (let dy = -1; dy <= 1 && !struck; dy++) {
      for (let dx = -1; dx <= 1 && !struck; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && tx < shield.cellsW && ty >= 0 && ty < shield.cellsH) {
          if (shield.cells[ty * shield.cellsW + tx]) struck = true;
        }
      }
    }
    if (!struck) continue;
    hit = true;
    for (let dy = -cr; dy <= cr; dy++) {
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx * dx + dy * dy > cr * cr) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx >= 0 && tx < shield.cellsW && ty >= 0 && ty < shield.cellsH) {
          shield.cells[ty * shield.cellsW + tx] = 0;
        }
      }
    }
    shield.dirty = true;
  }
  return hit;
}

/** Erase every shield cell inside an x-range (the air-support beam). */
function razeShieldColumns(state: GameState, x0: number, x1: number): void {
  for (const shield of state.shields) {
    const w = shield.cellsW * SHIELD_CELL;
    if (x1 < shield.x || x0 > shield.x + w) continue;
    const c0 = Math.max(0, Math.floor((x0 - shield.x) / SHIELD_CELL));
    const c1 = Math.min(shield.cellsW - 1, Math.floor((x1 - shield.x) / SHIELD_CELL));
    for (let cy = 0; cy < shield.cellsH; cy++) {
      for (let cx = c0; cx <= c1; cx++) shield.cells[cy * shield.cellsW + cx] = 0;
    }
    shield.dirty = true;
  }
}

// ---------------------------------------------------------------------------
// Missiles: bezier paths that bend around the shield walls

/** The x the missile should route through at shield height: the nearest gap
 *  between shield walls (or a screen edge lane). */
export function missileControlX(state: GameState, fromX: number): number {
  if (state.shields.length === 0) return fromX;
  const shieldPxW = SHIELD_W * SHIELD_CELL;
  // Standing over open ground already? Go straight up.
  const overShield = state.shields.some((s) => fromX >= s.x - 4 && fromX <= s.x + shieldPxW + 4);
  if (!overShield) return fromX;
  const sorted = [...state.shields].sort((a, b) => a.x - b.x);
  const gaps: number[] = [sorted[0].x / 2];
  for (let i = 0; i < sorted.length - 1; i++) {
    gaps.push((sorted[i].x + shieldPxW + sorted[i + 1].x) / 2);
  }
  gaps.push((sorted[sorted.length - 1].x + shieldPxW + state.w) / 2);
  let best = gaps[0];
  for (const g of gaps) if (Math.abs(g - fromX) < Math.abs(best - fromX)) best = g;
  return best;
}

function bezierAt(m: Missile, u: number): Vec2 {
  const v = 1 - u;
  return {
    x: v * v * m.sx + 2 * v * u * m.cx + u * u * m.tx,
    y: v * v * m.sy + 2 * v * u * m.cy + u * u * m.ty,
  };
}

function launchMissile(state: GameState, target: Vec2): void {
  const sx = state.player.x;
  const sy = groundY(state.h) - 12;
  // Bend sideways through a shield gap when the flight would cross the walls.
  const crossesShields = target.y < shieldTopY(state.h);
  const cx = crossesShields ? missileControlX(state, sx) : (sx + target.x) / 2;
  const cy = crossesShields ? shieldTopY(state.h) - 30 : (sy + target.y) / 2;
  const m: Missile = { sx, sy, cx, cy, tx: target.x, ty: target.y, x: sx, y: sy, u: 0, len: 1 };
  // Approximate the curve length so flight speed stays constant.
  let len = 0;
  let prev = { x: sx, y: sy };
  for (let i = 1; i <= 8; i++) {
    const p = bezierAt(m, i / 8);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  m.len = Math.max(1, len);
  state.missiles.push(m);
  state.events.push("missile");
}

// ---------------------------------------------------------------------------
// Chain lightning: a hit forks to its nearest unharmed ships as homing bolts

/** The N nearest alive slots within CHAIN_RADIUS that no in-flight chain bolt
 *  has already claimed, closest first. */
function nearestChainTargets(state: GameState, x: number, y: number, want: number): number[] {
  const form = state.form;
  const claimed = new Set<number>();
  for (const b of state.bullets) if (b.chain && b.chainTarget >= 0) claimed.add(b.chainTarget);
  const c0 = Math.max(0, Math.floor((x - CHAIN_RADIUS - form.x) / SPACING));
  const c1 = Math.min(form.cols - 1, Math.floor((x + CHAIN_RADIUS - form.x) / SPACING));
  const r0 = Math.max(0, Math.floor((y - CHAIN_RADIUS - form.y) / SPACING));
  const r1 = Math.min(form.rows - 1, Math.floor((y + CHAIN_RADIUS - form.y) / SPACING));
  const rr = CHAIN_RADIUS * CHAIN_RADIUS;
  const cands: Array<{ idx: number; d: number }> = [];
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const idx = row * form.cols + col;
      if (!form.alive[idx] || claimed.has(idx)) continue;
      const sx = form.x + col * SPACING + SPACING / 2;
      const sy = form.y + row * SPACING + SPACING / 2;
      const d = (sx - x) ** 2 + (sy - y) ** 2;
      if (d > rr) continue;
      cands.push({ idx, d });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  return cands.slice(0, want).map((c) => c.idx);
}

/** A chain bolt struck at (x,y): fork to the CHAIN_FANOUT nearest unharmed
 *  ships as homing bolts (dies quietly if none are within a 10-grid radius).
 *  The last generation kills but does not fork. */
export function chainFork(state: GameState, x: number, y: number, gen: number): void {
  // Each collected chain powerup adds a generation (chainStack, capped +3).
  if (gen >= CHAIN_JUMPS + state.chainStack) return;
  if (state.bullets.length >= CHAIN_BULLET_CAP) return; // perf backstop
  const targets = nearestChainTargets(state, x, y, CHAIN_FANOUT);
  if (targets.length === 0) return;
  for (const idx of targets) {
    const c = slotCenter(state.form, idx);
    const dx = c.x - x;
    const dy = c.y - y;
    const d = Math.hypot(dx, dy) || 1;
    state.bullets.push({
      x,
      y,
      vx: (dx / d) * CHAIN_BULLET_SPEED,
      vy: (dy / d) * CHAIN_BULLET_SPEED,
      chain: true,
      chainGen: gen + 1,
      chainTarget: idx,
    });
    state.bolts.push({ ax: x, ay: y, bx: c.x, by: c.y, ttl: 0.18 });
  }
  state.events.push("zap");
}

// ---------------------------------------------------------------------------
// Firing

/** Charge cost of one shot of the equipped weapon. */
export function weaponCost(weapon: WeaponKind): number {
  return weapon === "chain" ? COST_CHAIN : COST_BULLET;
}

function fireBullet(state: GameState): void {
  const p = state.player;
  // Can't afford the equipped weapon? Fall back to the sprinkler if owned,
  // otherwise the pea shooter.
  if (state.charge < weaponCost(state.weapon)) {
    state.weapon = state.weapons.includes("sprinkler") ? "sprinkler" : "gun";
  }
  const cost = weaponCost(state.weapon);
  if (state.charge < cost) return; // even the fallback is unaffordable
  state.charge -= cost;
  let angle = -Math.PI / 2;
  if (state.weapon === "sprinkler") {
    // The spray sweeps back and forth across the arc.
    angle += (Math.sin(p.sweep) * SPRINKLER_ARC) / 2;
  }
  state.bullets.push({
    x: p.x,
    y: groundY(state.h) - 12,
    vx: Math.cos(angle) * BULLET_SPEED,
    vy: Math.sin(angle) * BULLET_SPEED,
    chain: state.weapon === "chain",
    chainGen: 0,
    chainTarget: -1, // the shot you fired flies straight; forks home to slots
  });
  state.events.push("shoot");
  if (state.weapon === "sprinkler") {
    // Each sprinkler stack fires 50% faster.
    p.cooldown = SPRINKLER_COOLDOWN / (1 + SPRINKLER_RATE_PER_STACK * state.sprinklerStack);
  } else if (state.weapon === "chain") {
    p.cooldown = CHAIN_COOLDOWN;
  } else {
    p.cooldown = GUN_COOLDOWN;
  }
}

// ---------------------------------------------------------------------------
// Player damage

export function hitPlayer(state: GameState, rng: () => number = Math.random): void {
  if (state.player.invuln > 0 || state.respawn > 0 || state.over) return;
  state.lives -= 1;
  state.events.push("playerdown");
  // Go out like a firework.
  const gx = state.player.x;
  const gy = groundY(state.h) - 8;
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2;
    const sp = 40 + rng() * 200;
    state.fireworks.push({
      x: gx,
      y: gy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 60,
      age: 0,
      ttl: 0.8 + rng() * 0.7,
      hue: Math.floor(rng() * 360),
    });
  }
  // Dying drops your toys: back to the pea cannon and every upgrade/stack
  // reset (the shared charge pool is kept).
  state.weapon = "gun";
  state.weapons = ["gun"];
  state.airAmmo = 0;
  state.nukeAmmo = 0;
  state.chainStack = 0;
  state.missileStack = 0;
  state.nukeStack = 0;
  state.sprinklerStack = 0;
  state.airStack = 0;
  if (state.lives <= 0) {
    state.over = true;
    state.events.push("gameover");
    return;
  }
  state.respawn = RESPAWN_DELAY;
}

// ---------------------------------------------------------------------------
// Flyers: squadron dives and intro arrivals, all on splines

/** Detach a squadron of 10–15 **elite** invaders to swoop low — elites are the
 *  only tier that flies low. Wipe out the whole squad for a bonus. */
function spawnDiveSquad(state: GameState, rng: () => number): void {
  const form = state.form;
  if (form.aliveCount === 0) return;
  const eliteRow = (row: number) => invaderType(row, form.rows) === 2;
  // Anchor on a living elite.
  let anchor = -1;
  for (let tries = 0; tries < 24 && anchor < 0; tries++) {
    const idx = Math.floor(rng() * form.cols * form.rows);
    if (form.alive[idx] && eliteRow((idx / form.cols) | 0)) anchor = idx;
  }
  if (anchor < 0) return;
  const want = SQUAD_MIN + Math.floor(rng() * (SQUAD_MAX - SQUAD_MIN + 1));
  const eliteRows = Math.max(1, Math.floor(form.rows * 0.2));
  const r0 = Math.min((anchor / form.cols) | 0, Math.max(0, eliteRows - 3));
  const c0 = Math.min(anchor % form.cols, Math.max(0, form.cols - 8));
  const members: number[] = [];
  for (let dr = 0; dr < 3 && members.length < want; dr++) {
    for (let dc = 0; dc < 8 && members.length < want; dc++) {
      const row = r0 + dr;
      const col = c0 + dc;
      if (row >= form.rows || col >= form.cols || !eliteRow(row)) continue;
      const idx = row * form.cols + col;
      if (form.alive[idx]) members.push(idx);
    }
  }
  if (members.length < 3) return; // too sparse here to make a squadron
  const a = slotCenter(form, anchor);
  const floorY = swoopFloorY(state.h);
  const px = state.player.x;
  const exitX = rng() < 0.5 ? state.w * 0.15 : state.w * 0.85;
  const squadId = state.nextSquadId++;
  state.squads.push({ id: squadId, total: members.length, killed: 0, returned: 0 });
  // One slow, graceful swoop: out of the grid, down to the floor over the
  // player's sky, then right back up and off the top.
  const path = [
    a.x,
    a.y,
    px + (rng() - 0.5) * 160,
    (a.y + floorY) / 2,
    px + (rng() - 0.5) * 60,
    floorY,
    exitX,
    state.h * 0.35,
    exitX,
    -16,
  ];
  members.forEach((idx, i) => {
    const c = slotCenter(form, idx);
    detachSlot(state, idx);
    state.flyers.push({
      mode: "dive",
      slot: idx,
      type: invaderType((idx / form.cols) | 0, form.rows),
      x: c.x,
      y: c.y,
      path,
      offx: c.x - a.x,
      offy: c.y - a.y,
      t: -i * DIVE_STAGGER, // trail out one after another
      dur: DIVE_DUR,
      fireCooldown: FLYER_FIRE_MIN + rng() * (FLYER_FIRE_MAX - FLYER_FIRE_MIN),
      wob: rng() * Math.PI * 2,
      squad: squadId,
    });
  });
}

/** The fly-in: launch each queued invader on its own curving path straight to
 *  its slot. Lowest rows come first; the whole grid fills in ~4 seconds. */
function launchIntro(state: GameState, dt: number, rng: () => number): void {
  const form = state.form;
  const total = state.introQueue.length;
  if (state.introLaunched >= total) return;
  state.introElapsed += dt;
  // Hold everything back for the warmup (just the siren wailing), then launch.
  const launchT = state.introElapsed - INTRO_WARMUP;
  if (launchT <= 0) return;
  const target = Math.floor(Math.min(1, launchT / INTRO_LAUNCH_WINDOW) * total);
  while (state.introLaunched < target) {
    const idx = state.introQueue[state.introLaunched++];
    const home = slotCenter(form, idx);
    // A gentle curve from an offscreen staging point directly to the slot.
    const fromTop = rng() < 0.6;
    const startX = fromTop ? home.x + (rng() - 0.5) * 320 : rng() < 0.5 ? -40 : state.w + 40;
    const startY = fromTop ? -40 - rng() * 90 : rng() * state.h * 0.35;
    const ctrlX = home.x + (rng() - 0.5) * 220;
    const ctrlY = home.y * 0.45 + (rng() - 0.5) * 120;
    state.flyers.push({
      mode: "arrive",
      slot: idx,
      type: invaderType((idx / form.cols) | 0, form.rows),
      x: startX,
      y: startY,
      path: [startX, startY, ctrlX, ctrlY, home.x, home.y],
      offx: 0,
      offy: 0,
      t: 0,
      dur: INTRO_DUR_MIN + rng() * (INTRO_DUR_MAX - INTRO_DUR_MIN),
      fireCooldown: 9999,
      wob: rng() * Math.PI * 2,
      squad: -1,
    });
  }
}

/** Resolve a squad once all its members are accounted for; a clean wipe pays
 *  a bonus with a rising banner. */
function resolveSquad(state: GameState, squadId: number): void {
  if (squadId < 0) return;
  const sq = state.squads.find((s) => s.id === squadId);
  if (!sq || sq.killed + sq.returned < sq.total) return;
  if (sq.killed >= sq.total) {
    state.score += SQUAD_BONUS;
    state.banners.push({
      x: state.player.x,
      y: state.h * 0.4,
      text: `SQUADRON WIPED +${SQUAD_BONUS}`,
      age: 0,
      ttl: BANNER_TTL,
    });
  }
  state.squads = state.squads.filter((s) => s.id !== squadId);
}

function stepFlyers(state: GameState, dt: number, rng: () => number): void {
  const form = state.form;
  const floorY = swoopFloorY(state.h);
  for (let i = state.flyers.length - 1; i >= 0; i--) {
    const f = state.flyers[i];
    f.t += dt;
    const u = Math.max(0, Math.min(1, f.t / f.dur)); // t<0: still waiting its turn
    // Organic steering: a little per-ship wobble on top of the spline.
    const jx = u > 0 ? Math.sin(f.t * 2.6 + f.wob) * FLYER_JITTER : 0;
    const jy = u > 0 ? Math.cos(f.t * 2.1 + f.wob * 1.7) * FLYER_JITTER * 0.8 : 0;
    if (f.mode === "dive") {
      // The squadron strings out along the path: spatial offsets shrink once
      // airborne so ships read as following, not moving in lockstep.
      const shrink = 1 - 0.75 * Math.min(1, u * 6);
      const p = splinePoint(f.path, u);
      f.x = p.x + f.offx * shrink + jx;
      f.y = Math.min(p.y + f.offy * shrink + jy, floorY);
      f.fireCooldown -= dt;
      if (u > 0 && f.fireCooldown <= 0 && state.ebullets.length < EBULLET_CAP) {
        f.fireCooldown = FLYER_FIRE_MIN + rng() * (FLYER_FIRE_MAX - FLYER_FIRE_MIN);
        state.ebullets.push({ x: f.x, y: f.y + 4, vy: eBulletSpeed(state.level) });
      }
      if (u >= 1) {
        // Off the top: glide back down into the formation.
        const home = slotCenter(form, f.slot);
        f.mode = "return";
        f.t = 0;
        f.dur = RETURN_DUR;
        f.path = [home.x + f.offx, -14, home.x + f.offx, Math.max(6, form.y * 0.5), 0, 0];
        f.offx = 0;
        f.offy = 0;
        f.x = f.path[0];
        f.y = f.path[1];
      }
    } else {
      // Arrivals and returns track their (marching) home slot: the spline
      // carries the flight, then blends into the live slot position.
      const home = slotCenter(form, f.slot);
      const p = splinePoint(f.path, u);
      const w = u * u;
      const jitterFade = 1 - w; // settle cleanly into the grid
      f.x = (p.x + f.offx) * (1 - w) + home.x * w + jx * jitterFade;
      f.y = Math.min(
        (p.y + f.offy) * (1 - w) + home.y * w + jy * jitterFade,
        Math.max(floorY, home.y),
      );
      if (u >= 1) {
        state.flyers.splice(i, 1);
        reviveSlot(state, f.slot);
        if (f.squad >= 0) {
          const sq = state.squads.find((s) => s.id === f.squad);
          if (sq) sq.returned++;
          resolveSquad(state, f.squad);
        }
      }
    }
  }
}

function killFlyer(state: GameState, i: number, rng: () => number): void {
  const f = state.flyers[i];
  state.flyers.splice(i, 1);
  state.score += FLYER_SCORE;
  state.events.push("pop");
  spawnScrap(state, f.x, f.y, rng);
  maybeDropPowerup(state, f.x, f.y, rng);
  if (f.squad >= 0) {
    const sq = state.squads.find((s) => s.id === f.squad);
    if (sq) sq.killed++;
    resolveSquad(state, f.squad);
  }
}

// ---------------------------------------------------------------------------
// The main step

export function step(
  state: GameState,
  input: InputState,
  dt: number,
  rng: () => number = Math.random,
): GameState {
  state.events.length = 0;
  state.deadSlots.length = 0;
  state.bornSlots.length = 0;
  if (state.over) return state;

  const ground = groundY(state.h);
  const player = state.player;
  const form = state.form;

  // -- timers / respawn ------------------------------------------------------
  player.invuln = Math.max(0, player.invuln - dt);
  player.cooldown = Math.max(0, player.cooldown - dt);
  player.sweep += SPRINKLER_RATE * dt * Math.PI * 2;
  state.charge += CHARGE_REGEN * dt; // the main charge trickles back up
  for (let i = state.banners.length - 1; i >= 0; i--) {
    state.banners[i].age += dt;
    if (state.banners[i].age >= state.banners[i].ttl) state.banners.splice(i, 1);
  }
  if (state.respawn > 0) {
    state.respawn -= dt;
    if (state.respawn <= 0) {
      state.respawn = 0;
      player.x = state.w / 2;
      player.invuln = RESPAWN_INVULN;
    }
  }
  const alive = state.respawn <= 0;

  // -- fireworks ---------------------------------------------------------------
  for (let i = state.fireworks.length - 1; i >= 0; i--) {
    const fw = state.fireworks[i];
    fw.age += dt;
    if (fw.age >= fw.ttl) {
      state.fireworks.splice(i, 1);
      continue;
    }
    fw.vy += 160 * dt;
    fw.x += fw.vx * dt;
    fw.y += fw.vy * dt;
  }

  // -- player ---------------------------------------------------------------
  if (alive) {
    if (input.left) player.x -= PLAYER_SPEED * dt;
    if (input.right) player.x += PLAYER_SPEED * dt;
    player.x = Math.max(PLAYER_HALF + 2, Math.min(state.w - PLAYER_HALF - 2, player.x));
    if (input.selectWeapon) cycleWeapon(state);
    if (input.fire && player.cooldown <= 0) fireBullet(state);
    if (input.missile && state.charge >= COST_MISSILE) {
      state.charge -= COST_MISSILE;
      launchMissile(state, input.missile);
    }
    if (input.air && state.airAmmo > 0) {
      state.airAmmo--;
      // A barrage of 50 half-strength missiles rains from above the strike x,
      // spread ±AIR_MISSILE_SPREAD (wider per air stack), entering staggered.
      const spread = AIR_MISSILE_SPREAD * (1 + AIR_SPREAD_PER_STACK * state.airStack);
      for (let i = 0; i < AIR_MISSILE_COUNT; i++) {
        state.airMissiles.push({
          x: player.x + (rng() * 2 - 1) * spread,
          y: -rng() * 400, // staggered above the screen so they rain in over time
          vy: AIR_MISSILE_SPEED,
        });
      }
      state.events.push("beam");
    }
    if (input.nuke && state.nukeAmmo > 0) {
      state.nukeAmmo--;
      state.fuses.push({ x: player.x, y: ground - 4, fuse: NUKE_FUSE });
    }
  }

  // -- the fly-in: each invader curves in to its own slot, lowest rows first ---
  const introing = state.introLaunched < state.introQueue.length;
  if (introing) launchIntro(state, dt, rng);
  const introDone = !introing && !state.flyers.some((f) => f.mode === "arrive");

  // -- the horde marches (paused until the fly-in has fully settled) ------------
  if (form.aliveCount > 0 && introDone) {
    // Recompute the true alive extent from the counts every frame so a thinned
    // horde can never scroll off the edge on a stale minCol/maxCol.
    let lo = -1;
    let hi = -1;
    for (let c = 0; c < form.cols; c++) {
      if (form.colCounts[c] > 0) {
        if (lo < 0) lo = c;
        hi = c;
      }
    }
    let botRow = 0;
    for (let r = form.rows - 1; r >= 0; r--) {
      if (form.rowCounts[r] > 0) {
        botRow = r;
        break;
      }
    }
    form.minCol = lo < 0 ? 0 : lo;
    form.maxCol = hi < 0 ? 0 : hi;
    form.maxRow = botRow;
    const frac = Math.min(1, form.aliveCount / (form.cols * form.rows));
    form.x += form.dir * marchSpeed(state.level, frac) * dt;
    const left = form.x + form.minCol * SPACING;
    const right = form.x + (form.maxCol + 1) * SPACING;
    if (form.dir > 0 && right > state.w - 6) {
      form.x -= right - (state.w - 6);
      form.dir = -1;
      form.y += DROP;
    } else if (form.dir < 0 && left < 6) {
      form.x += 6 - left;
      form.dir = 1;
      form.y += DROP;
    }
    // Invaders reaching the ground is the end.
    if (form.y + (form.maxRow + 1) * SPACING >= ground - 4) {
      state.over = true;
      state.events.push("gameover");
      return state;
    }
  }

  // -- horde fire: one shooter per tick, soldiers weighted 3× so they fire
  //    more often (single bullets over time, never a burst) ---------------------
  state.eShotTimer -= dt;
  if (state.eShotTimer <= 0 && form.aliveCount > 0) {
    state.eShotTimer = 1 / eShotsPerSec(state.level);
    if (state.ebullets.length < EBULLET_CAP) {
      const span = form.maxCol - form.minCol + 1;
      const cand: Array<{ col: number; row: number; w: number }> = [];
      let totalW = 0;
      for (let k = 0; k < 6; k++) {
        const col = form.minCol + Math.floor(rng() * span);
        if (form.colCounts[col] === 0) continue;
        let brow = -1;
        for (let row = form.rows - 1; row >= 0; row--) {
          if (form.alive[row * form.cols + col]) {
            brow = row;
            break;
          }
        }
        if (brow < 0) continue;
        const w = invaderType(brow, form.rows) === 1 ? SOLDIER_FIRE_WEIGHT : 1;
        cand.push({ col, row: brow, w });
        totalW += w;
      }
      if (cand.length > 0) {
        let roll = rng() * totalW;
        let pick = cand[0];
        for (const c of cand) {
          roll -= c.w;
          if (roll <= 0) {
            pick = c;
            break;
          }
        }
        state.ebullets.push({
          x: form.x + pick.col * SPACING + SPACING / 2,
          y: form.y + (pick.row + 1) * SPACING,
          vy: eBulletSpeed(state.level),
        });
      }
    }
  }

  // -- flyers -----------------------------------------------------------------
  state.flyerTimer -= dt;
  if (state.flyerTimer <= 0 && introDone) {
    state.flyerTimer = Math.max(2.5, 8 - state.level * 0.4) * (0.7 + rng() * 0.6);
    const diving = state.flyers.filter((f) => f.mode === "dive").length;
    if (diving < SQUAD_MAX * Math.min(2, 1 + state.level * 0.2)) spawnDiveSquad(state, rng);
  }
  stepFlyers(state, dt, rng);

  // -- UFOs (pretty rare, and never more than one at a time) --------------------
  state.ufoTimer -= dt;
  if (state.ufoTimer <= 0 && state.ufos.length === 0 && !state.ufoDefeated) {
    state.ufoTimer = UFO_GAP_MIN + rng() * (UFO_GAP_MAX - UFO_GAP_MIN);
    const fromLeft = rng() < 0.5;
    state.ufos.push({
      x: fromLeft ? -16 : state.w + 16,
      y: UFO_Y,
      vx: fromLeft ? UFO_SPEED : -UFO_SPEED,
      charge: 0,
      laser: 0,
      gunCooldown: 1.5 + rng() * 2,
    });
    state.events.push("ufo");
  }
  for (let i = state.ufos.length - 1; i >= 0; i--) {
    const u = state.ufos[i];
    u.x += u.vx * dt;
    if (u.x < -24 || u.x > state.w + 24) {
      state.ufos.splice(i, 1);
      continue;
    }
    if (u.laser > 0) {
      // The beam crawls to the ground over UFO_LASER_DESCEND seconds; u.laser
      // counts UP the active elapsed time.
      u.laser += dt;
      const front = UFO_Y + (ground - UFO_Y) * Math.min(1, u.laser / UFO_LASER_DESCEND);
      // Shields burn as the descending front passes their height.
      if (front >= shieldTopY(state.h)) damageShieldAt(state, u.x, shieldTopY(state.h) + 8, 3);
      // The player is only in danger once the beam actually reaches the
      // ground — two full seconds to slide out from under it.
      if (
        u.laser >= UFO_LASER_DESCEND &&
        alive &&
        player.invuln <= 0 &&
        Math.abs(player.x - u.x) < PLAYER_HALF + 2
      ) {
        hitPlayer(state, rng);
      }
      if (u.laser >= UFO_LASER_DESCEND + UFO_LASER_HOLD) u.laser = 0; // beam done
    } else if (u.charge > 0) {
      u.charge -= dt;
      if (u.charge <= 0) {
        u.laser = 0.0001; // begin the descent
        state.events.push("laser");
      }
    } else {
      u.gunCooldown -= dt;
      if (u.gunCooldown <= 0) {
        u.gunCooldown = 2 + rng() * 2.5;
        u.charge = UFO_CHARGE;
      }
    }
  }

  // -- player bullets (substepped so fast rounds can't tunnel a row) ----------
  const deadBullets = new Set<Bullet>();
  for (const b of state.bullets) {
    // A forked chain bolt seeks ONLY its claimed target, arcing over every
    // other ship in between — so each fork reliably kills exactly one ship and
    // the cascade reaches its full 1+4+16+64 rather than collapsing locally.
    if (b.chain && b.chainTarget >= 0) {
      if (!form.alive[b.chainTarget]) {
        deadBullets.add(b);
        continue;
      }
      const c = slotCenter(form, b.chainTarget);
      const dx = c.x - b.x;
      const dy = c.y - b.y;
      const dist = Math.hypot(dx, dy);
      const travel = CHAIN_BULLET_SPEED * dt;
      if (dist <= travel + INV_HIT) {
        deadBullets.add(b);
        killSlot(state, b.chainTarget, rng, { silent: true });
        chainFork(state, c.x, c.y, b.chainGen);
      } else {
        b.x += (dx / dist) * travel;
        b.y += (dy / dist) * travel;
      }
      continue;
    }
    const steps = Math.max(1, Math.ceil((Math.hypot(b.vx, b.vy) * dt) / (SPACING / 2)));
    for (let s = 0; s < steps && !deadBullets.has(b); s++) {
      b.x += (b.vx * dt) / steps;
      b.y += (b.vy * dt) / steps;
      if (b.y < -4 || b.y > state.h + 4 || b.x < -4 || b.x > state.w + 4) {
        deadBullets.add(b);
        break;
      }
      const idx = hitSlotAt(form, b.x, b.y);
      if (idx >= 0) {
        deadBullets.add(b);
        killSlot(state, idx, rng, b.chain ? { silent: true } : {});
        if (b.chain) chainFork(state, b.x, b.y, b.chainGen);
        break;
      }
      // Flyers.
      for (let i = state.flyers.length - 1; i >= 0; i--) {
        const f = state.flyers[i];
        const dx = b.x - f.x;
        const dy = b.y - f.y;
        if (dx * dx + dy * dy <= INV_HIT * INV_HIT) {
          deadBullets.add(b);
          killFlyer(state, i, rng);
          if (b.chain) chainFork(state, b.x, b.y, b.chainGen);
          break;
        }
      }
      if (deadBullets.has(b)) break;
      // UFOs.
      for (let i = state.ufos.length - 1; i >= 0; i--) {
        const u = state.ufos[i];
        if (Math.abs(b.x - u.x) < 10 && Math.abs(b.y - u.y) < 6) {
          deadBullets.add(b);
          state.ufos.splice(i, 1);
          state.ufoDefeated = true;
          state.score += UFO_SCORE;
          state.events.push("pop");
          dropPickup(state, u.x, u.y, rollPowerup(rng));
          break;
        }
      }
      if (deadBullets.has(b)) break;
      // Shields block friendly fire too — but your rounds punch big holes,
      // and battered walls occasionally shake a powerup loose.
      if (damageShieldAt(state, b.x, b.y, PLAYER_SHIELD_PUNCH)) {
        deadBullets.add(b);
        if (rng() < SHIELD_DROP_CHANCE) dropPickup(state, b.x, b.y, rollPowerup(rng));
        break;
      }
    }
  }
  if (deadBullets.size > 0) state.bullets = state.bullets.filter((b) => !deadBullets.has(b));

  // -- chain crackle bolts fade fast --------------------------------------------
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    state.bolts[i].ttl -= dt;
    if (state.bolts[i].ttl <= 0) state.bolts.splice(i, 1);
  }

  // -- enemy bullets ------------------------------------------------------------
  for (let i = state.ebullets.length - 1; i >= 0; i--) {
    const e = state.ebullets[i];
    e.y += e.vy * dt;
    if (e.y > state.h + 4) {
      state.ebullets.splice(i, 1);
      continue;
    }
    if (damageShieldAt(state, e.x, e.y, ENEMY_SHIELD_PUNCH)) {
      state.ebullets.splice(i, 1);
      if (rng() < SHIELD_DROP_CHANCE) dropPickup(state, e.x, e.y, rollPowerup(rng));
      continue;
    }
    if (
      alive &&
      player.invuln <= 0 &&
      Math.abs(e.x - player.x) < PLAYER_HALF + 2 &&
      Math.abs(e.y - (ground - 8)) < 8
    ) {
      state.ebullets.splice(i, 1);
      hitPlayer(state, rng);
    }
  }

  // -- missiles: glide the bezier, detonate at the target ------------------------
  for (let i = state.missiles.length - 1; i >= 0; i--) {
    const m = state.missiles[i];
    m.u += (MISSILE_SPEED / m.len) * dt;
    if (m.u >= 1) {
      state.missiles.splice(i, 1);
      state.blasts.push({
        x: m.tx,
        y: m.ty,
        maxR: MISSILE_BLAST_R * areaStackMul(state.missileStack),
        age: 0,
        ttl: 0.45,
        kind: "missile",
      });
      state.events.push("boom");
    } else {
      const p = bezierAt(m, m.u);
      m.x = p.x;
      m.y = p.y;
    }
  }

  // -- nuke fuses: the charge rises into the air, then blows -------------------
  for (let i = state.fuses.length - 1; i >= 0; i--) {
    const fuse = state.fuses[i];
    fuse.fuse -= dt;
    fuse.y -= NUKE_RISE_SPEED * dt; // climbs ~200px/s while the fuse burns
    if (fuse.fuse <= 0) {
      state.fuses.splice(i, 1);
      const nukeR = NUKE_BLAST_R * areaStackMul(state.nukeStack);
      state.blasts.push({ x: fuse.x, y: fuse.y, maxR: nukeR, age: 0, ttl: 0.8, kind: "nuke" });
      // Leave a patch of deadly molten ground where it launched from.
      state.lavas.push({ x: fuse.x, halfW: nukeR * 0.85, age: 0, ttl: LAVA_TTL });
      state.events.push("nuke");
    }
  }

  // -- expanding blasts: kill everything the growing ring reaches ------------------
  for (let i = state.blasts.length - 1; i >= 0; i--) {
    const blast = state.blasts[i];
    blast.age += dt;
    const r = blast.maxR * Math.min(1, blast.age / blast.ttl);
    killInCircle(state, blast.x, blast.y, r, rng);
    if (blast.kind === "nuke") {
      // A nuke is total: it razes the shield walls it engulfs and its plasma
      // takes the ship too.
      razeShieldColumns(state, blast.x - r, blast.x + r);
      if (alive && player.invuln <= 0 && Math.abs(player.x - blast.x) <= r) hitPlayer(state, rng);
    } else {
      damageShieldAt(state, blast.x, blast.y, r * 0.8);
    }
    if (blast.age >= blast.ttl) state.blasts.splice(i, 1);
  }

  // -- molten ground left by nukes: glows, cools, and burns the ship -----------
  for (let i = state.lavas.length - 1; i >= 0; i--) {
    const lava = state.lavas[i];
    lava.age += dt;
    if (lava.age >= lava.ttl) {
      state.lavas.splice(i, 1);
      continue;
    }
    if (alive && player.invuln <= 0 && Math.abs(player.x - lava.x) <= lava.halfW) {
      hitPlayer(state, rng);
    }
  }

  // -- air-support barrage: falling missiles explode on the first invader,
  //    shield or ground they hit; one landing on the ship kills it -------------
  for (let i = state.airMissiles.length - 1; i >= 0; i--) {
    const m = state.airMissiles[i];
    m.y += m.vy * dt;
    if (m.y < 0) continue; // still descending from above the screen
    let hit = false;
    // The ship.
    if (
      alive &&
      player.invuln <= 0 &&
      Math.abs(m.x - player.x) < PLAYER_HALF + 3 &&
      Math.abs(m.y - (ground - 8)) < 8
    ) {
      hitPlayer(state, rng);
      hit = true;
    }
    // An invader (grid or flyer).
    if (!hit && hitSlotAt(form, m.x, m.y) >= 0) hit = true;
    if (!hit) {
      for (const f of state.flyers) {
        if (Math.abs(m.x - f.x) < INV_HIT && Math.abs(m.y - f.y) < INV_HIT) {
          hit = true;
          break;
        }
      }
    }
    // A shield, or the ground.
    if (!hit && damageShieldAt(state, m.x, m.y, 2)) hit = true;
    if (!hit && m.y >= ground) hit = true;
    if (hit) {
      state.airMissiles.splice(i, 1);
      state.blasts.push({
        x: m.x,
        y: Math.min(m.y, ground),
        maxR: AIR_MISSILE_BLAST_R,
        age: 0,
        ttl: 0.35,
        kind: "missile",
      });
      state.events.push("boom");
    }
  }

  // -- scrap grains --------------------------------------------------------------------
  stepScrap(state, dt, alive);

  // -- falling pickups: drop like the debris, sit on the ground, then fade ----
  for (let i = state.pickups.length - 1; i >= 0; i--) {
    const pk = state.pickups[i];
    if (pk.y >= ground - 6) {
      pk.y = ground - 6;
      pk.vy = 0;
      pk.groundTtl -= dt;
      if (pk.groundTtl <= 0) {
        state.pickups.splice(i, 1);
        continue;
      }
    } else {
      pk.vy += PICKUP_GRAVITY * dt;
      pk.y += pk.vy * dt;
    }
    if (alive && Math.abs(pk.x - player.x) < PICKUP_RADIUS && Math.abs(pk.y - (ground - 8)) < 14) {
      state.pickups.splice(i, 1);
      applyPowerup(state, pk.kind);
      state.floaters.push({ x: player.x, y: ground - 24, kind: pk.kind, age: 0, ttl: FLOATER_TTL });
    }
  }

  // -- rising pickup announcements ----------------------------------------------
  for (let i = state.floaters.length - 1; i >= 0; i--) {
    const fl = state.floaters[i];
    fl.age += dt;
    if (fl.age >= fl.ttl) state.floaters.splice(i, 1);
  }

  // -- level progression --------------------------------------------------------------------
  if (
    form.aliveCount === 0 &&
    state.flyers.length === 0 &&
    state.introLaunched >= state.introQueue.length &&
    !state.over
  ) {
    state.level += 1;
    state.form = makeFormation(state.w, state.h);
    state.introQueue = makeIntroQueue(state.form, rng);
    state.introLaunched = 0;
    state.introElapsed = 0;
    state.flyerTimer = 7;
    state.ufoTimer = UFO_GAP_MIN;
    state.ufoDefeated = false; // a fresh level gets a fresh UFO
    state.ebullets.length = 0;
    state.bolts.length = 0;
    state.lavas.length = 0;
    state.airMissiles.length = 0;
    state.squads.length = 0;
    state.events.push("levelup");
  }

  return state;
}

/** Kill everything inside a circle: formation cells, flyers, enemy bullets. */
function killInCircle(state: GameState, x: number, y: number, r: number, rng: () => number): void {
  if (r <= 0) return;
  const form = state.form;
  if (form.aliveCount > 0) {
    const c0 = Math.max(0, Math.floor((x - r - form.x) / SPACING));
    const c1 = Math.min(form.cols - 1, Math.floor((x + r - form.x) / SPACING));
    const r0 = Math.max(0, Math.floor((y - r - form.y) / SPACING));
    const r1 = Math.min(form.rows - 1, Math.floor((y + r - form.y) / SPACING));
    const rr = r * r;
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const idx = row * form.cols + col;
        if (!form.alive[idx]) continue;
        const sx = form.x + col * SPACING + SPACING / 2;
        const sy = form.y + row * SPACING + SPACING / 2;
        const dx = sx - x;
        const dy = sy - y;
        if (dx * dx + dy * dy <= rr) killSlot(state, idx, rng, { silent: true });
      }
    }
  }
  for (let i = state.flyers.length - 1; i >= 0; i--) {
    const f = state.flyers[i];
    const dx = f.x - x;
    const dy = f.y - y;
    if (dx * dx + dy * dy <= r * r) killFlyer(state, i, rng);
  }
  for (let i = state.ebullets.length - 1; i >= 0; i--) {
    const e = state.ebullets[i];
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= r * r) state.ebullets.splice(i, 1);
  }
  // Blasts take out UFOs too — so a well-aimed missile or nuke can kill one.
  for (let i = state.ufos.length - 1; i >= 0; i--) {
    const u = state.ufos[i];
    const dx = u.x - x;
    const dy = u.y - y;
    if (dx * dx + dy * dy <= r * r) {
      state.ufos.splice(i, 1);
      state.ufoDefeated = true;
      state.score += UFO_SCORE;
      state.events.push("pop");
      dropPickup(state, u.x, u.y, rollPowerup(rng));
    }
  }
}

function stepScrap(state: GameState, dt: number, playerAlive: boolean): void {
  const s = state.scrap;
  const ground = groundY(state.h);
  const px = state.player.x;
  const py = ground - 8;
  let collected = 0;
  for (let k = s.count - 1; k >= 0; k--) {
    s.ttl[k] -= dt;
    if (s.ttl[k] <= 0) {
      removeScrap(s, k);
      continue;
    }
    // Magnetize toward a nearby player; otherwise drift and fall.
    const dx = px - s.x[k];
    const dy = py - s.y[k];
    const d2 = dx * dx + dy * dy;
    if (playerAlive && d2 < MAGNET_RADIUS * MAGNET_RADIUS) {
      const d = Math.sqrt(d2) || 1;
      s.vx[k] += (dx / d) * 700 * dt;
      s.vy[k] += (dy / d) * 700 * dt;
    } else {
      s.vy[k] += 60 * dt; // gravity
      s.vx[k] *= 1 - 0.6 * dt;
    }
    s.x[k] += s.vx[k] * dt;
    s.y[k] += s.vy[k] * dt;
    if (s.y[k] > ground - 1) {
      s.y[k] = ground - 1;
      s.vy[k] = 0;
      s.vx[k] = 0;
      if (s.ttl[k] > SCRAP_GROUND_TTL) s.ttl[k] = SCRAP_GROUND_TTL; // dies 2s after landing
    }
    if (playerAlive && d2 < PICKUP_RADIUS * PICKUP_RADIUS) {
      removeScrap(s, k);
      state.charge += CHARGE_PER_SCRAP; // debris feeds the shared charge pool
      collected++;
    }
  }
  if (collected > 0) state.events.push("pickup");
}
