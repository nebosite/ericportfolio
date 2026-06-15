import { Application, Container, Graphics, Sprite, Ticker } from 'pixi.js';
import { attachGameInput, Vec } from '../input';
import { Maze, TILE, WorldPlan, generateMaze, planWorld } from './maze';
import {
  DIRS,
  bestTowardTarget,
  bfsDistances,
  chooseSpacedTiles,
  gradientStep,
  torusDist,
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
const CHASE_RADIUS = 20; // hunt Pac via shortest path when within this range
const LEASH = 30; // wander no further than this from home before drifting back
const FRIGHT_MS = 8000; // how long fright lasts if the ghost isn't eaten
const POWERUP_MIN_GAP = 10; // no two power pellets closer than this

// Scoring.
const DOT_POINTS = 10;
const PELLET_POINTS = 50;
const FRUIT_POINTS = 100;
const GHOST_POINTS = 200;

// Fruit spawning (per ghost base).
const FRUIT_INTERVAL = 6000; // ms between a base's fruit spawns
const FRUIT_PER_BASE = 6; // max alive fruit a single base will keep out
const FRUIT_RADIUS = 8; // tiles from base center a fruit can appear

const WALL_COLOR = 0x1c1c8a;
const BOX_FLOOR_COLOR = 0x141467; // forbidden ground: slightly darker than walls
const DOT_COLOR = 0xffc7ae;
const GHOST_TINTS = [0xff4b4b, 0xffb8ff, 0x00ffff, 0xffb852];

const STOPPED: Vec = { x: 0, y: 0 };

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
}

interface Fruit {
  sprite: Sprite;
  base: number;
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
  /** BFS path distances from Pac's tile, out to CHASE_RADIUS (toroidal). */
  private pacDistances = new Map<number, number>();
  private lastPacIdx = -1;
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

    // Walls: horizontal runs of wall tiles merged into single rects, all in
    // one static Graphics (one geometry upload, one draw call).
    const walls = new Graphics();
    for (let y = 0; y < rows; y++) {
      let runStart = -1;
      for (let x = 0; x <= cols; x++) {
        const isWall = x < cols && !grid[y * cols + x];
        if (isWall && runStart < 0) runStart = x;
        if (!isWall && runStart >= 0) {
          walls.rect(runStart * TILE, y * TILE, (x - runStart) * TILE, TILE);
          runStart = -1;
        }
      }
    }
    walls.fill(WALL_COLOR);
    world.addChild(walls);

    // Wider-looking passages: every floor run is redrawn in the background
    // color expanded 1px outward, shaving 1px off each adjoining wall edge.
    const floorCarve = new Graphics();
    for (let y = 0; y < rows; y++) {
      let runStart = -1;
      for (let x = 0; x <= cols; x++) {
        const isFloor = x < cols && grid[y * cols + x] === 1;
        if (isFloor && runStart < 0) runStart = x;
        if (!isFloor && runStart >= 0) {
          floorCarve.rect(runStart * TILE - 1, y * TILE - 1, (x - runStart) * TILE + 2, TILE + 2);
          runStart = -1;
        }
      }
    }
    floorCarve.fill(BG_COLOR);
    world.addChild(floorCarve);

    // Ghost-box footprints: Pac may never stand here; ghosts only when leaving
    // or returning home.
    for (const r of this.maze.baseRooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) this.baseTiles.add(y * cols + x);
      }
    }

    // Forbidden ground: tint the walkable area inside each box (3x2 interior
    // plus the exit doorway) slightly darker than the walls, expanded 1px to
    // meet the narrowed wall edges.
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
    this.baseFruitTimer = rooms.map(() => Math.random() * FRUIT_INTERVAL);
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
      });
    }

    const pacSprite = new Sprite(this.tex.pacOpen);
    pacSprite.anchor.set(0.5);
    world.addChild(pacSprite);
    this.pac = { tx: spawn.x, ty: spawn.y, progress: 0, dir: STOPPED, sprite: pacSprite };

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

    this.rebuildPacDistances();

    for (const ghost of this.ghosts) {
      if (ghost.state === 'frightened' && this.elapsed >= ghost.frightUntil) this.calm(ghost);
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

    this.place(pac);
    const moving = pac.dir.x !== 0 || pac.dir.y !== 0;
    if (moving) pac.sprite.rotation = Math.atan2(pac.dir.y, pac.dir.x);
    pac.sprite.texture =
      moving && Math.floor(this.elapsed / 120) % 2 === 0 ? this.tex.pacClosed : this.tex.pacOpen;
    for (const ghost of this.ghosts) this.place(ghost);

    // Pac eats frightened ghosts on contact; they become homebound eyes.
    for (const ghost of this.ghosts) {
      if (ghost.state !== 'frightened') continue;
      if (
        Math.abs(ghost.sprite.x - pac.sprite.x) < TILE * 0.7 &&
        Math.abs(ghost.sprite.y - pac.sprite.y) < TILE * 0.7
      ) {
        ghost.state = 'eyes';
        ghost.sprite.texture = this.tex.ghostEyes;
        ghost.sprite.tint = 0xffffff;
        this.score += GHOST_POINTS;
        this.sfx.play('eatghost', 0.5);
        this.pushScore();
      }
    }

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

  /**
   * Flood-fill walkable path distances outward from Pac's tile, stopping at
   * CHASE_RADIUS. Ghosts inside the flood chase by descending the gradient —
   * a true shortest path. Rebuilt only when Pac changes tile (~800 tiles max).
   */
  private rebuildPacDistances() {
    const { cols, rows, grid } = this.maze;
    const startIdx = this.pac.ty * cols + this.pac.tx;
    if (startIdx === this.lastPacIdx) return;
    this.lastPacIdx = startIdx;
    this.pacDistances = bfsDistances(
      grid,
      cols,
      rows,
      startIdx,
      this.baseTiles,
      CHASE_RADIUS,
    );
  }

  private chooseGhostDir(g: Ghost): Vec | null {
    const { cols, rows } = this.maze;
    const inBase = this.baseTiles.has(g.ty * cols + g.tx);
    // Box tiles are walkable only for ghosts already inside (heading out) or
    // eyes heading home.
    const allowBase = g.state === 'eyes' || inBase;

    const options = DIRS.filter(
      (d) => this.isOpen(g.tx, g.ty, d, allowBase) && !(d.x === -g.dir.x && d.y === -g.dir.y),
    );
    if (options.length === 0) {
      const back = { x: -g.dir.x, y: -g.dir.y };
      return (back.x || back.y) && this.isOpen(g.tx, g.ty, back, allowBase) ? back : null;
    }

    // Aggressive chase: a normal ghost inside Pac's BFS flood follows the
    // distance gradient down — the true shortest path, no wandering.
    if (g.state === 'normal' && !inBase && this.pacDistances.has(g.ty * cols + g.tx)) {
      const best = gradientStep(options, g.tx, g.ty, cols, rows, this.pacDistances);
      if (best) return best;
      // No non-reversing option descends the gradient; fall through to wander.
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
    for (const g of this.ghosts) {
      if (g.state === 'eyes') continue; // already eaten — nothing to scare
      g.state = 'frightened';
      g.frightUntil = this.elapsed + FRIGHT_MS;
      g.sprite.texture = this.tex.ghostFrightened;
      g.sprite.tint = 0xffffff;
    }
  }

  private calm(g: Ghost) {
    g.state = 'normal';
    g.sprite.texture = this.tex.ghost;
    g.sprite.tint = g.color;
  }

  // ---- fruit ---------------------------------------------------------------

  private spawnFruit(dt: number) {
    const { cols, rows, grid } = this.maze;
    const rooms = this.maze.baseRooms;
    for (let b = 0; b < rooms.length; b++) {
      this.baseFruitTimer[b] -= dt * 1000;
      if (this.baseFruitTimer[b] > 0 || this.baseFruitCount[b] >= FRUIT_PER_BASE) continue;
      this.baseFruitTimer[b] = FRUIT_INTERVAL * (0.6 + Math.random() * 0.8);

      const room = rooms[b];
      const cx = room.x + Math.floor(room.w / 2);
      const cy = room.y + Math.floor(room.h / 2);
      // A few random tries to land on an open, unoccupied tile near the base
      // (but never inside the box, where Pac can't reach it).
      for (let attempt = 0; attempt < 12; attempt++) {
        const tx = wrap(cx + Math.floor(Math.random() * (2 * FRUIT_RADIUS + 1)) - FRUIT_RADIUS, cols);
        const ty = wrap(cy + Math.floor(Math.random() * (2 * FRUIT_RADIUS + 1)) - FRUIT_RADIUS, rows);
        const idx = ty * cols + tx;
        if (!grid[idx] || this.baseTiles.has(idx) || this.fruitByTile.has(idx)) continue;
        const sprite = new Sprite(this.tex.fruit);
        sprite.anchor.set(0.5);
        sprite.x = tx * TILE + TILE / 2;
        sprite.y = ty * TILE + TILE / 2;
        this.fruitLayer.addChild(sprite);
        this.fruitByTile.set(idx, { sprite, base: b });
        this.baseFruitCount[b]++;
        break;
      }
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
      this.fruitByTile.delete(idx);
      this.baseFruitCount[fruit.base]--;
      fruit.sprite.destroy();
      this.score += FRUIT_POINTS;
      this.sfx.play('fruit', 0.45);
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
