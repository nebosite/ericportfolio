import { Application, Container, Graphics, Sprite, Text, Ticker } from 'pixi.js';
import { attachGameInput, Vec } from '../input';
import { Maze, TILE, WorldPlan, generateMaze, planWorld } from './maze';
import {
  DIRS,
  aStarPath,
  bestTowardTarget,
  bfsPath,
  chooseSpacedTiles,
  firstOpenBelow,
  torusDist,
  torusHypot,
  wrap,
} from './grid';
import { loadSpriteTextures, SpriteTextures } from './sprites';
import { Sfx } from './sfx';

const BG_COLOR = 0x05050c;
const MAX_W = 3840; // cap the playfield at 4K
const MAX_H = 2160;
const PAC_SPEED = 150; // px/sec (~9 tiles/sec at the 16px tile)
const GHOST_SPEED = 60; // ghosts amble at less than half Pac's speed
const EYES_SPEED = 150; // eaten ghosts hurry home
const CHUNK = 32; // dots batched into one Graphics per 32x32-tile chunk

// AI tuning, all in grid squares.
const CHASE_RADIUS = 30; // path-hunt Pac when within this many tiles
const LEASH = 30; // wander no further than this from home before drifting back
const FRIGHT_MS = 8000; // how long fright lasts if the ghost isn't eaten
const FRIGHT_FLASH_MS = 3000; // flash blue<->white for the final stretch of fright
const PATH_RECOMPUTE_MS = 2000; // commit to a fresh path to Pac this often
const PATH_MAX_STEPS = 60; // BFS depth cap when pathing to Pac (winding paths)
const POWERUP_MIN_GAP = 10; // no two power pellets closer than this

// Scoring.
const DOT_POINTS = 10;
const PELLET_POINTS = 50;
const FRUIT_POINTS = 100;
const GHOST_POINTS = 200;

// Fruit spawning: one fruit per ghost lair, dropped below its entrance and
// respawned this long after being eaten.
const FRUIT_INTERVAL = 6000; // ms before a lair re-drops its fruit once eaten

const WALL_COLOR = 0x1c1c8a;
const WALL_FILL_COLOR = 0x141467; // dark blue inside the wall outline
const WALL_OUTLINE = 3; // px thickness of the wall's rounded outline
const WALL_RADIUS = 6; // px corner rounding on wall shapes
const BOX_FLOOR_COLOR = 0x5a5a5a; // ghost-lair floor: gray, marking forbidden ground
const DOT_COLOR = 0xffc7ae;
const GHOST_TINTS = [0xff4b4b, 0xffb8ff, 0x00ffff, 0xffb852];

// Ghost-clearing blast triggered by touching a regular ghost.
const EXPLOSION_RADIUS = 5; // grid units; ghosts within die (as eyes), no score
const EXPLODE_MS = 450; // how long the blast graphic lasts
const EXPLOSION_COLOR = 0xffd24a;

const STOPPED: Vec = { x: 0, y: 0 };
const NO_BLOCKED: ReadonlySet<number> = new Set(); // eyes may cross any open tile, boxes included

// Grid-locked mover, classic Pac style: an entity occupies a tile and walks
// center-to-center; `progress` is how many pixels it has covered toward the
// next tile.
interface Mover {
  tx: number;
  ty: number;
  progress: number;
  dir: Vec;
  sprite: Sprite;
}

type GhostState = 'normal' | 'frightened' | 'eyes';

interface Ghost extends Mover {
  home: { x: number; y: number }; // a tile inside its box
  exitAbove: { x: number; y: number }; // the corridor tile just above the exit
  color: number;
  state: GhostState;
  frightUntil: number; // elapsed-ms deadline while frightened
  pathDirs: Vec[]; // remaining committed steps of the current path to Pac
  repathAt: number; // elapsed-ms deadline to commit to a fresh path
  repathDue: boolean; // set when it's time to repath; consumed at the next tile
}

interface Fruit {
  sprite: Sprite;
  base: number;
}

/** A rising, fading "+N" score number spawned where points were earned. */
interface Popup {
  text: Text;
  born: number; // elapsed-ms at spawn
  x: number;
  y: number;
}

export class BigPacEngine {
  /**
   * Sizes the canvas to the host's PHYSICAL pixels (CSS size x devicePixelRatio,
   * capped at 4K) so one world unit is one device pixel.
   */
  static async create(host: HTMLElement, onScore: (score: number) => void): Promise<BigPacEngine> {
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.min(Math.round(host.clientWidth * dpr), MAX_W);
    const pxH = Math.min(Math.round(host.clientHeight * dpr), MAX_H);

    const app = new Application();
    await app.init({ width: pxW, height: pxH, background: BG_COLOR, antialias: false });
    app.canvas.style.width = `${pxW / dpr}px`;
    app.canvas.style.height = `${pxH / dpr}px`;
    app.canvas.style.setProperty('image-rendering', 'pixelated');
    host.appendChild(app.canvas);

    // Sprites (PNG) and sounds (MP3) load up front so the first frame is ready.
    const textures = await loadSpriteTextures();
    const sfx = new Sfx();
    sfx.load();

    return new BigPacEngine(app, pxW, pxH, onScore, textures, sfx);
  }

  private app: Application;
  private onScore: (score: number) => void;
  private tex: SpriteTextures;
  private sfx: Sfx;
  private plan: WorldPlan;
  private maze: Maze;
  private chunkCols: number;

  private dotTiles = new Set<number>();
  private chunkDots = new Map<number, Set<number>>();
  private chunkGfx = new Map<number, Graphics>();
  private pelletsByTile = new Map<number, Sprite>();
  private pelletLayer = new Container();
  private fruitLayer = new Container();
  private fruitByTile = new Map<number, Fruit>();
  private baseFruitCount: number[] = [];
  private baseFruitTimer: number[] = [];
  /** Every tile of every ghost box footprint (walls, interior, exit). */
  private baseTiles = new Set<number>();
  private ghosts: Ghost[] = [];
  private pac: Mover;
  private desiredDir: Vec | null = null;
  private score = 0;
  private elapsed = 0;
  private started = false;
  private popupLayer = new Container();
  private popups: Popup[] = [];
  private fxLayer = new Container();
  private explosions: Array<{ gfx: Graphics; born: number; x: number; y: number }> = [];
  /** Ghosts eaten so far in the current fright phase; doubles their value. */
  private ghostChain = 0;
  private frightActive = false;
  private detachInput: () => void = () => {};

  /** True once the player has pressed Start; the world is locked in. */
  get hasStarted(): boolean {
    return this.started;
  }

  private constructor(
    app: Application,
    pxW: number,
    pxH: number,
    onScore: (score: number) => void,
    textures: SpriteTextures,
    sfx: Sfx,
  ) {
    this.app = app;
    this.onScore = onScore;
    this.tex = textures;
    this.sfx = sfx;
    this.plan = planWorld(pxW, pxH);
    this.maze = generateMaze(this.plan);
    const { cols, rows, grid } = this.maze;
    this.chunkCols = Math.ceil(cols / CHUNK);

    const world = new Container();
    world.x = Math.floor((pxW - cols * TILE) / 2);
    world.y = Math.floor((pxH - rows * TILE) / 2);
    app.stage.addChild(world);

    // Walls drawn with a rounded outline (classic maze look): the wall union is
    // filled once in the outline color, then re-filled inset by the outline
    // width in the dark-blue wall-fill color, leaving a rounded border ring
    // around a dark-blue interior. Each tile's exposed corners round; wall-to-
    // wall joins are squared by straight bridge fills so runs read as one
    // continuous rounded outline.
    const isWall = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < cols && y < rows && grid[y * cols + x] === 0;
    const traceWalls = (g: Graphics, inset: number) => {
      const size = TILE - 2 * inset;
      const rr = Math.max(0, WALL_RADIUS - inset);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (isWall(x, y)) g.roundRect(x * TILE + inset, y * TILE + inset, size, size, rr);
        }
      }
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (!isWall(x, y)) continue;
          if (isWall(x + 1, y)) {
            g.rect(x * TILE + TILE - WALL_RADIUS, y * TILE + inset, 2 * WALL_RADIUS, size);
          }
          if (isWall(x, y + 1)) {
            g.rect(x * TILE + inset, y * TILE + TILE - WALL_RADIUS, size, 2 * WALL_RADIUS);
          }
        }
      }
    };
    const walls = new Graphics();
    traceWalls(walls, 0);
    walls.fill(WALL_COLOR);
    traceWalls(walls, WALL_OUTLINE);
    walls.fill(WALL_FILL_COLOR);
    world.addChild(walls);

    // Ghost-box footprints: Pac may never stand here; ghosts only when leaving
    // or returning home.
    for (const r of this.maze.baseRooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) this.baseTiles.add(y * cols + x);
      }
    }

    // Forbidden ground: tint the walkable area inside each box (3x2 interior
    // plus the exit doorway) gray, expanded 1px to meet the wall edges.
    const boxFloor = new Graphics();
    for (const r of this.maze.baseRooms) {
      boxFloor.rect(
        (r.x + 1) * TILE - 1,
        (r.y + 1) * TILE - 1,
        (r.w - 2) * TILE + 2,
        (r.h - 2) * TILE + 2,
      );
      boxFloor.rect((r.x + 2) * TILE - 1, r.y * TILE - 1, TILE + 2, TILE + 2);
    }
    boxFloor.fill(BOX_FLOOR_COLOR);
    world.addChild(boxFloor);

    // Tiles that never hold a dot: ghost boxes + a clearing around Pac's spawn.
    const noDot = new Uint8Array(cols * rows);
    for (const idx of this.baseTiles) noDot[idx] = 1;
    const spawn = this.maze.pacSpawn;
    for (let y = spawn.y - 2; y <= spawn.y + 2; y++) {
      for (let x = spawn.x - 2; x <= spawn.x + 2; x++) {
        if (x >= 0 && y >= 0 && x < cols && y < rows) noDot[y * cols + x] = 1;
      }
    }

    const candidates: number[] = [];
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] && !noDot[i]) candidates.push(i);
    }

    const dotLayer = new Container();
    world.addChild(dotLayer);

    // Power pellets: chosen with even spacing (no two within POWERUP_MIN_GAP
    // tiles) from a shuffled candidate pool; everything left becomes a dot.
    const pelletSet = chooseSpacedTiles(
      candidates,
      cols,
      this.plan.powerPellets,
      POWERUP_MIN_GAP,
    );
    for (const idx of pelletSet) {
      const sprite = new Sprite(this.tex.pellet);
      sprite.anchor.set(0.5);
      sprite.x = (idx % cols) * TILE + TILE / 2;
      sprite.y = Math.floor(idx / cols) * TILE + TILE / 2;
      this.pelletLayer.addChild(sprite);
      this.pelletsByTile.set(idx, sprite);
    }
    world.addChild(this.pelletLayer);

    for (const idx of candidates) {
      if (pelletSet.has(idx)) continue;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const ck = Math.floor(y / CHUNK) * this.chunkCols + Math.floor(x / CHUNK);
      let set = this.chunkDots.get(ck);
      if (!set) {
        set = new Set();
        this.chunkDots.set(ck, set);
        const g = new Graphics();
        this.chunkGfx.set(ck, g);
        dotLayer.addChild(g);
      }
      set.add(idx);
      this.dotTiles.add(idx);
    }
    for (const ck of this.chunkGfx.keys()) this.redrawChunk(ck);

    world.addChild(this.fruitLayer);

    // Ghosts spawn inside the box interiors; each remembers its home box and
    // its classic tint.
    const ghostLayer = new Container();
    world.addChild(ghostLayer);
    const rooms = this.maze.baseRooms;
    this.baseFruitCount = rooms.map(() => 0);
    this.baseFruitTimer = rooms.map(() => 0); // each lair drops its first fruit right away
    for (let i = 0; i < this.plan.ghosts; i++) {
      const room = rooms[i % rooms.length];
      const color = GHOST_TINTS[i % GHOST_TINTS.length];
      const sprite = new Sprite(this.tex.ghost);
      sprite.anchor.set(0.5);
      sprite.tint = color;
      ghostLayer.addChild(sprite);
      this.ghosts.push({
        tx: room.x + 1 + Math.floor(Math.random() * (room.w - 2)),
        ty: room.y + 1 + Math.floor(Math.random() * (room.h - 2)),
        progress: 0,
        dir: STOPPED,
        sprite,
        home: { x: room.x + 2, y: room.y + 1 },
        exitAbove: { x: room.x + 2, y: room.y - 1 },
        color,
        state: 'normal',
        frightUntil: 0,
        pathDirs: [],
        repathAt: 0,
        repathDue: false,
      });
    }

    const pacSprite = new Sprite(this.tex.pacOpen);
    pacSprite.anchor.set(0.5);
    world.addChild(pacSprite);
    this.pac = { tx: spawn.x, ty: spawn.y, progress: 0, dir: STOPPED, sprite: pacSprite };

    // Blast graphics over the maze, and floating "+N" score numbers on top.
    world.addChild(this.fxLayer);
    world.addChild(this.popupLayer);

    for (const m of [this.pac, ...this.ghosts]) this.place(m);
    app.ticker.add(this.update, this);
    this.pushScore();
  }

  /**
   * Begin play. Until this is called the world stays frozen and no keyboard or
   * gamepad input is consumed, so typing elsewhere on the title screen (e.g. the
   * feedback box) can never trip the controls. Driven by the page's Start button.
   */
  start() {
    if (this.started) return;
    this.started = true;
    this.sfx.resume(); // browsers need a user gesture to start audio
    this.detachInput = attachGameInput({
      onDirection: (dir) => {
        this.desiredDir = dir;
      },
    });
  }

  destroy() {
    this.detachInput();
    this.sfx.destroy();
    this.app.ticker.remove(this.update, this);
    this.app.destroy(true, { children: true, texture: true });
  }

  // ---- main loop -----------------------------------------------------------

  private update(ticker: Ticker) {
    if (!this.started) return; // frozen until the first control input

    const dt = Math.min(ticker.deltaMS, 50) / 1000;
    this.elapsed += ticker.deltaMS;

    const pac = this.pac;
    const want = this.desiredDir;
    const { cols, rows } = this.maze;
    // Classic feel: reversing direction is allowed mid-corridor.
    if (want && pac.progress > 0 && want.x === -pac.dir.x && want.y === -pac.dir.y) {
      pac.tx = wrap(pac.tx + pac.dir.x, cols);
      pac.ty = wrap(pac.ty + pac.dir.y, rows);
      pac.progress = TILE - pac.progress;
      pac.dir = want;
    }
    this.advance(
      pac,
      PAC_SPEED * dt,
      (m) => {
        if (want && this.isOpen(m.tx, m.ty, want)) return want;
        if ((m.dir.x || m.dir.y) && this.isOpen(m.tx, m.ty, m.dir)) return m.dir;
        return null;
      },
      () => this.eatAt(pac.tx, pac.ty),
    );

    for (const ghost of this.ghosts) {
      if (ghost.state === 'frightened' && this.elapsed >= ghost.frightUntil) this.calm(ghost);
      // Commit to a fresh path to Pac every couple of seconds (consumed at the
      // ghost's next tile center, in chooseGhostDir).
      if (ghost.state === 'normal' && this.elapsed >= ghost.repathAt) {
        ghost.repathAt = this.elapsed + PATH_RECOMPUTE_MS;
        ghost.repathDue = true;
      }
      const speed = ghost.state === 'eyes' ? EYES_SPEED : GHOST_SPEED;
      this.advance(ghost, speed * dt, (m) => this.chooseGhostDir(m as Ghost));
      if (
        ghost.state === 'eyes' &&
        torusDist(ghost.tx, ghost.ty, ghost.home.x, ghost.home.y, cols, rows) <= 1
      ) {
        this.calm(ghost); // eyes made it home — back to a regular ghost
      }
    }

    this.spawnFruit(dt);
    this.updatePopups();

    this.place(pac);
    const moving = pac.dir.x !== 0 || pac.dir.y !== 0;
    if (moving) pac.sprite.rotation = Math.atan2(pac.dir.y, pac.dir.x);
    pac.sprite.texture =
      moving && Math.floor(this.elapsed / 120) % 2 === 0 ? this.tex.pacClosed : this.tex.pacOpen;
    for (const ghost of this.ghosts) {
      this.place(ghost);
      // Own the frightened look every frame: solid blue normally, and for the
      // final FRIGHT_FLASH_MS flash blue<->white (ghost.png is a neutral body,
      // so tinting it white reads as a white ghost) to warn the window is ending.
      if (ghost.state === 'frightened') {
        const flashing = ghost.frightUntil - this.elapsed <= FRIGHT_FLASH_MS;
        const showWhite = flashing && Math.floor(this.elapsed / 200) % 2 === 0;
        ghost.sprite.texture = showWhite ? this.tex.ghost : this.tex.ghostFrightened;
        ghost.sprite.tint = 0xffffff;
      }
    }

    // Pac eats frightened ghosts on contact; they become homebound eyes. Each
    // consecutive ghost in the same fright phase is worth double the last.
    for (const ghost of this.ghosts) {
      if (ghost.state !== 'frightened') continue;
      if (
        Math.abs(ghost.sprite.x - pac.sprite.x) < TILE * 0.7 &&
        Math.abs(ghost.sprite.y - pac.sprite.y) < TILE * 0.7
      ) {
        const points = GHOST_POINTS * 2 ** this.ghostChain;
        this.ghostChain += 1;
        ghost.state = 'eyes';
        ghost.pathDirs = [];
        ghost.sprite.texture = this.tex.ghostEyes;
        ghost.sprite.tint = 0xffffff;
        this.score += points;
        this.sfx.play('eatghost', 0.5);
        this.spawnPopup(ghost.sprite.x, ghost.sprite.y, `+${points}`);
        this.pushScore();
      }
    }

    // When the fright phase is over (all frightened ghosts eaten or calmed),
    // reset the eat-chain back to the base value for next time.
    if (this.frightActive && !this.ghosts.some((g) => g.state === 'frightened')) {
      this.frightActive = false;
      this.ghostChain = 0;
    }

    // Touching a REGULAR ghost sets off a blast: every ghost within
    // EXPLOSION_RADIUS is knocked out (sent home as eyes), for no points.
    for (const ghost of this.ghosts) {
      if (ghost.state !== 'normal') continue;
      if (
        Math.abs(ghost.sprite.x - pac.sprite.x) < TILE * 0.7 &&
        Math.abs(ghost.sprite.y - pac.sprite.y) < TILE * 0.7
      ) {
        this.explode(pac.tx, pac.ty, pac.sprite.x, pac.sprite.y);
        break;
      }
    }

    this.updateExplosions();
    this.pelletLayer.alpha = 0.55 + 0.45 * Math.sin(this.elapsed / 220);
  }

  /** Walk a mover up to `dist` px, consulting `choose` at each tile center. */
  private advance(
    m: Mover,
    dist: number,
    choose: (m: Mover) => Vec | null,
    onArrive?: () => void,
  ) {
    const { cols, rows } = this.maze;
    while (dist > 0) {
      if (m.progress === 0) {
        const next = choose(m);
        if (!next) {
          m.dir = STOPPED;
          return;
        }
        m.dir = next;
      }
      const step = Math.min(dist, TILE - m.progress);
      m.progress += step;
      dist -= step;
      if (m.progress >= TILE) {
        m.tx = wrap(m.tx + m.dir.x, cols);
        m.ty = wrap(m.ty + m.dir.y, rows);
        m.progress = 0;
        onArrive?.();
      }
    }
  }

  // ---- ghost AI ------------------------------------------------------------

  private chooseGhostDir(g: Ghost): Vec | null {
    const { cols, rows, grid } = this.maze;
    const inBase = this.baseTiles.has(g.ty * cols + g.tx);
    // Box tiles are walkable only for ghosts already inside (heading out) or
    // eyes heading home.
    const allowBase = g.state === 'eyes' || inBase;

    // Eyes head straight home along a guaranteed A* path — no wandering and no
    // chasing Pac, so a just-eaten ghost can never get lost circling walls.
    if (g.state === 'eyes') {
      if (g.pathDirs.length === 0) {
        const gi = g.ty * cols + g.tx;
        const hi = g.home.y * cols + g.home.x;
        g.pathDirs = aStarPath(grid, cols, rows, gi, hi, NO_BLOCKED);
      }
      const d = g.pathDirs.shift();
      if (d && this.isOpen(g.tx, g.ty, d, true)) return d;
      // At/adjacent to home (or a rare stale step): fall through to a safe step.
    }

    // Aggressive chase: when its 2-second timer is up, a normal ghost within
    // CHASE_RADIUS commits to the shortest path to Pac's current tile, then
    // walks that path (one step per tile) until the next recompute — hunting a
    // remembered position rather than re-steering every frame.
    if (g.state === 'normal' && !inBase) {
      if (g.repathDue) {
        g.repathDue = false;
        const gi = g.ty * cols + g.tx;
        const pi = this.pac.ty * cols + this.pac.tx;
        g.pathDirs =
          torusDist(g.tx, g.ty, this.pac.tx, this.pac.ty, cols, rows) <= CHASE_RADIUS
            ? bfsPath(grid, cols, rows, gi, pi, this.baseTiles, PATH_MAX_STEPS)
            : [];
      }
      while (g.pathDirs.length > 0) {
        const d = g.pathDirs.shift()!;
        if (this.isOpen(g.tx, g.ty, d)) return d;
        // A step no longer fits (shouldn't happen on a static maze) — drop the
        // stale path and fall through to the calm wander/leash behavior.
        g.pathDirs = [];
      }
    }

    const options = DIRS.filter(
      (d) => this.isOpen(g.tx, g.ty, d, allowBase) && !(d.x === -g.dir.x && d.y === -g.dir.y),
    );
    if (options.length === 0) {
      const back = { x: -g.dir.x, y: -g.dir.y };
      return (back.x || back.y) && this.isOpen(g.tx, g.ty, back, allowBase) ? back : null;
    }

    // Pick a target tile, how directly to pursue it (lower = more wandering),
    // and whether to run toward it or away from it.
    let target: { x: number; y: number } | null = null;
    let directness = 0;
    let flee = false;
    if (g.state === 'eyes') {
      target = g.home;
      directness = 0.9; // a little wobble keeps eyes from pacing in corners
    } else if (inBase) {
      target = g.exitAbove; // newly spawned or just-respawned: file out the door
      directness = 1;
    } else if (g.state === 'frightened') {
      target = { x: this.pac.tx, y: this.pac.ty };
      flee = true;
      directness = 0.8; // run away from Pac, with a panicked stumble
    } else if (torusDist(g.tx, g.ty, g.home.x, g.home.y, cols, rows) > LEASH) {
      target = g.home;
      directness = 0.7; // drifting too far — head back toward the leash
    }

    if (!target) {
      // Wander: keep momentum most of the time, otherwise turn at random.
      if ((g.dir.x || g.dir.y) && Math.random() < 0.6) {
        const straight = options.find((d) => d.x === g.dir.x && d.y === g.dir.y);
        if (straight) return straight;
      }
      return options[Math.floor(Math.random() * options.length)];
    }

    if (Math.random() < directness) {
      return bestTowardTarget(options, g.tx, g.ty, target, cols, rows, flee);
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  /** A power pellet frightens every ghost on the board (except homebound eyes). */
  private frighten() {
    // A fresh power pellet restarts the eat-chain at the base value.
    this.frightActive = true;
    this.ghostChain = 0;
    for (const g of this.ghosts) {
      if (g.state === 'eyes') continue; // already eaten — nothing to scare
      g.state = 'frightened';
      g.frightUntil = this.elapsed + FRIGHT_MS;
      g.pathDirs = []; // drop any committed chase path while fleeing
      g.sprite.texture = this.tex.ghostFrightened;
      g.sprite.tint = 0xffffff;
    }
  }

  private calm(g: Ghost) {
    g.state = 'normal';
    g.pathDirs = [];
    g.repathAt = 0; // repath toward Pac immediately now that the hunt resumes
    g.sprite.texture = this.tex.ghost;
    g.sprite.tint = g.color;
  }

  // ---- fruit ---------------------------------------------------------------

  private spawnFruit(dt: number) {
    const { cols, rows, grid } = this.maze;
    const rooms = this.maze.baseRooms;
    for (let b = 0; b < rooms.length; b++) {
      this.baseFruitTimer[b] -= dt * 1000;
      // One fruit per lair: never add another while this lair's fruit is still
      // uneaten, and wait out the respawn delay after it's been taken.
      if (this.baseFruitCount[b] > 0 || this.baseFruitTimer[b] > 0) continue;
      this.baseFruitTimer[b] = FRUIT_INTERVAL;

      // Drop it into the first open tile straight below the lair's entrance
      // (its top-middle exit column), so it always sits in a fixed, reachable
      // spot just under the box.
      const room = rooms[b];
      const exitX = room.x + 2;
      const idx = firstOpenBelow(grid, cols, rows, exitX, room.y + room.h, this.baseTiles);
      if (idx < 0 || this.fruitByTile.has(idx)) continue;
      const tx = idx % cols;
      const ty = Math.floor(idx / cols);
      const sprite = new Sprite(this.tex.fruit);
      sprite.anchor.set(0.5);
      sprite.x = tx * TILE + TILE / 2;
      sprite.y = ty * TILE + TILE / 2;
      this.fruitLayer.addChild(sprite);
      this.fruitByTile.set(idx, { sprite, base: b });
      this.baseFruitCount[b]++;
    }
  }

  // ---- score popups --------------------------------------------------------

  /** Spawn a readable "+N" that rises and fades where points were earned. */
  private spawnPopup(x: number, y: number, label: string) {
    const text = new Text({
      text: label,
      style: {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 18,
        fontWeight: 'bold',
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 3 },
      },
    });
    text.anchor.set(0.5);
    text.x = x;
    text.y = y;
    this.popupLayer.addChild(text);
    this.popups.push({ text, born: this.elapsed, x, y });
  }

  private updatePopups() {
    const LIFE = 2000; // ms to rise and fade out
    const RISE = 28; // px it floats upward over its life
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      const t = (this.elapsed - p.born) / LIFE;
      if (t >= 1) {
        p.text.destroy();
        this.popups.splice(i, 1);
        continue;
      }
      p.text.y = p.y - t * RISE;
      p.text.alpha = 1 - t;
    }
  }

  // ---- ghost-clearing blast ------------------------------------------------

  /** Blast at (tileX,tileY): knock out every ghost within EXPLOSION_RADIUS. */
  private explode(tileX: number, tileY: number, px: number, py: number) {
    const { cols, rows } = this.maze;
    this.spawnExplosion(px, py);
    this.sfx.play('eatghost', 0.4); // reuse the eaten-ghost thump for the blast
    for (const g of this.ghosts) {
      if (g.state === 'eyes') continue; // already down
      if (torusHypot(g.tx, g.ty, tileX, tileY, cols, rows) <= EXPLOSION_RADIUS) {
        g.state = 'eyes'; // dies as if eaten — but no points for a blast
        g.pathDirs = [];
        g.sprite.texture = this.tex.ghostEyes;
        g.sprite.tint = 0xffffff;
      }
    }
  }

  private spawnExplosion(x: number, y: number) {
    const gfx = new Graphics();
    this.fxLayer.addChild(gfx);
    this.explosions.push({ gfx, born: this.elapsed, x, y });
  }

  private updateExplosions() {
    const maxR = EXPLOSION_RADIUS * TILE;
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      const t = (this.elapsed - e.born) / EXPLODE_MS;
      if (t >= 1) {
        e.gfx.destroy();
        this.explosions.splice(i, 1);
        continue;
      }
      const r = maxR * t;
      e.gfx.clear();
      e.gfx.circle(e.x, e.y, r * 0.7);
      e.gfx.fill({ color: EXPLOSION_COLOR, alpha: 0.35 * (1 - t) });
      e.gfx.circle(e.x, e.y, r);
      e.gfx.stroke({ color: EXPLOSION_COLOR, width: 3, alpha: 1 - t });
    }
  }

  // ---- helpers -------------------------------------------------------------

  /** Is the tile one step in direction `d` walkable? Box tiles need `allowBase`. */
  private isOpen(tx: number, ty: number, d: Vec, allowBase = false): boolean {
    const { cols, rows, grid } = this.maze;
    const x = wrap(tx + d.x, cols);
    const y = wrap(ty + d.y, rows);
    const idx = y * cols + x;
    if (grid[idx] !== 1) return false;
    return allowBase || !this.baseTiles.has(idx);
  }

  private place(m: Mover) {
    m.sprite.x = m.tx * TILE + TILE / 2 + m.dir.x * m.progress;
    m.sprite.y = m.ty * TILE + TILE / 2 + m.dir.y * m.progress;
  }

  private eatAt(tx: number, ty: number) {
    const idx = ty * this.maze.cols + tx;

    const fruit = this.fruitByTile.get(idx);
    if (fruit) {
      const px = fruit.sprite.x;
      const py = fruit.sprite.y;
      this.fruitByTile.delete(idx);
      this.baseFruitCount[fruit.base]--;
      fruit.sprite.destroy();
      this.score += FRUIT_POINTS;
      this.sfx.play('fruit', 0.45);
      this.spawnPopup(px, py, `+${FRUIT_POINTS}`);
      this.pushScore();
    }

    if (this.dotTiles.delete(idx)) {
      const ck = Math.floor(ty / CHUNK) * this.chunkCols + Math.floor(tx / CHUNK);
      this.chunkDots.get(ck)!.delete(idx);
      this.redrawChunk(ck);
      this.score += DOT_POINTS;
      this.sfx.waka();
      this.pushScore();
      return;
    }

    const pellet = this.pelletsByTile.get(idx);
    if (pellet) {
      this.pelletsByTile.delete(idx);
      pellet.destroy();
      this.score += PELLET_POINTS;
      this.sfx.play('power', 0.5);
      this.frighten(); // every ghost panics and scatters away from Pac
      this.pushScore();
    }
  }

  private redrawChunk(ck: number) {
    const g = this.chunkGfx.get(ck)!;
    const { cols } = this.maze;
    const o = Math.floor(TILE / 2) - 1;
    g.clear();
    for (const idx of this.chunkDots.get(ck)!) {
      g.rect((idx % cols) * TILE + o, Math.floor(idx / cols) * TILE + o, 3, 3);
    }
    g.fill(DOT_COLOR);
  }

  private pushScore() {
    this.onScore(this.score);
  }
}
