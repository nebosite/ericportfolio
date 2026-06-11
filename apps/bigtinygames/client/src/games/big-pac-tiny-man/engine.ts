import { Application, Container, Graphics, Sprite, Texture, Ticker } from 'pixi.js';
import { attachGameInput, Vec } from '../input';
import { Maze, TILE, WorldPlan, generateMaze, planWorld } from './maze';
import { GHOST, PAC_CLOSED, PAC_OPEN, PELLET, patternTexture } from './sprites';

// STUB BUILD — what works: full-resolution maze generation, scaled entity
// counts, Pac steering (keyboard + gamepad) with dot/pellet eating, ghosts
// wandering out of their bases. What's missing (TODOs below): ghost
// chase/scatter AI, frightened mode, collisions/lives, scoring, leaderboard.

export interface WorldStats {
  cols: number;
  rows: number;
  ghosts: number;
  powerPellets: number;
  ghostBases: number;
  dotsTotal: number;
  dotsEaten: number;
}

const MAX_W = 3840; // cap the playfield at 4K
const MAX_H = 2160;
const PAC_SPEED = 88; // px/sec — Pac is 8px tall, so ~11 body-lengths/sec
const GHOST_SPEED = 66;
// Dots are drawn into one Graphics per 32x32-tile chunk: the whole field is a
// handful of static batched meshes, and eating a dot rebuilds only its chunk.
const CHUNK = 32;

const WALL_COLOR = 0x1c1c8a;
const DOT_COLOR = 0xffc7ae;
const BASE_OUTLINE = 0xff6ec7;
const GHOST_TINTS = [0xff4b4b, 0xffb8ff, 0x00ffff, 0xffb852];

const DIRS: Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
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

export class BigPacEngine {
  /**
   * Sizes the canvas to the host's PHYSICAL pixels (CSS size x devicePixelRatio,
   * capped at 4K) so one world unit is one device pixel — the maze is exactly
   * as labyrinthine as the monitor allows.
   */
  static async create(host: HTMLElement, onStats: (s: WorldStats) => void): Promise<BigPacEngine> {
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.min(Math.round(host.clientWidth * dpr), MAX_W);
    const pxH = Math.min(Math.round(host.clientHeight * dpr), MAX_H);

    // Pixi renders via WebGPU/WebGL: tens of thousands of dots and hundreds
    // of ghosts end up in a few batched GPU draw calls.
    const app = new Application();
    await app.init({ width: pxW, height: pxH, background: 0x05050c, antialias: false });
    app.canvas.style.width = `${pxW / dpr}px`;
    app.canvas.style.height = `${pxH / dpr}px`;
    app.canvas.style.setProperty('image-rendering', 'pixelated');
    host.appendChild(app.canvas);
    return new BigPacEngine(app, pxW, pxH, onStats);
  }

  private app: Application;
  private onStats: (s: WorldStats) => void;
  private plan: WorldPlan;
  private maze: Maze;
  private chunkCols: number;

  private dotTiles = new Set<number>();
  private chunkDots = new Map<number, Set<number>>();
  private chunkGfx = new Map<number, Graphics>();
  private pelletsByTile = new Map<number, Sprite>();
  private pelletLayer = new Container();
  private ghosts: Mover[] = [];
  private pac: Mover;
  private desiredDir: Vec | null = null;
  private dotsTotal = 0;
  private dotsEaten = 0;
  private elapsed = 0;
  private pacOpen: Texture;
  private pacClosed: Texture;
  private detachInput: () => void;

  private constructor(
    app: Application,
    pxW: number,
    pxH: number,
    onStats: (s: WorldStats) => void,
  ) {
    this.app = app;
    this.onStats = onStats;
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

    const baseOutlines = new Graphics();
    for (const r of this.maze.baseRooms) {
      baseOutlines.rect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    }
    baseOutlines.stroke({ width: 1, color: BASE_OUTLINE });
    world.addChild(baseOutlines);

    // Tiles that never hold a dot: ghost base interiors + a clearing around
    // Pac's spawn.
    const noDot = new Uint8Array(cols * rows);
    for (const r of this.maze.baseRooms) {
      for (let y = r.y; y < r.y + r.h; y++) {
        for (let x = r.x; x < r.x + r.w; x++) noDot[y * cols + x] = 1;
      }
    }
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

    // A scaled handful of corridor tiles get power pellets instead of dots
    // (partial Fisher-Yates picks them uniformly).
    const dotLayer = new Container();
    world.addChild(dotLayer);
    const pelletTex = patternTexture(app.renderer, PELLET, DOT_COLOR);
    const pelletCount = Math.min(this.plan.powerPellets, candidates.length);
    for (let i = 0; i < pelletCount; i++) {
      const j = i + Math.floor(Math.random() * (candidates.length - i));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      const idx = candidates[i];
      const sprite = new Sprite(pelletTex);
      sprite.x = (idx % cols) * TILE;
      sprite.y = Math.floor(idx / cols) * TILE;
      this.pelletLayer.addChild(sprite);
      this.pelletsByTile.set(idx, sprite);
    }
    world.addChild(this.pelletLayer);

    for (let i = pelletCount; i < candidates.length; i++) {
      const idx = candidates[i];
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
    this.dotsTotal = this.dotTiles.size;
    for (const ck of this.chunkGfx.keys()) this.redrawChunk(ck);

    // Ghosts spawn spread across the base rooms, classic tints cycling.
    const ghostTex = patternTexture(app.renderer, GHOST, 0xffffff);
    const ghostLayer = new Container();
    world.addChild(ghostLayer);
    const rooms = this.maze.baseRooms;
    for (let i = 0; i < this.plan.ghosts; i++) {
      const room = rooms[i % rooms.length];
      const sprite = new Sprite(ghostTex);
      sprite.anchor.set(0.5);
      sprite.tint = GHOST_TINTS[i % GHOST_TINTS.length];
      ghostLayer.addChild(sprite);
      this.ghosts.push({
        tx: room.x + 1 + Math.floor(Math.random() * (room.w - 2)),
        ty: room.y + 1 + Math.floor(Math.random() * (room.h - 2)),
        progress: 0,
        dir: STOPPED,
        sprite,
      });
    }

    this.pacOpen = patternTexture(app.renderer, PAC_OPEN, 0xffe14b);
    this.pacClosed = patternTexture(app.renderer, PAC_CLOSED, 0xffe14b);
    const pacSprite = new Sprite(this.pacOpen);
    pacSprite.anchor.set(0.5);
    world.addChild(pacSprite);
    this.pac = { tx: spawn.x, ty: spawn.y, progress: 0, dir: STOPPED, sprite: pacSprite };

    this.detachInput = attachGameInput({
      onDirection: (dir) => {
        this.desiredDir = dir;
      },
    });
    for (const m of [this.pac, ...this.ghosts]) this.place(m);
    app.ticker.add(this.update, this);
    this.pushStats();
  }

  destroy() {
    this.detachInput();
    this.app.ticker.remove(this.update, this);
    this.app.destroy(true, { children: true, texture: true });
  }

  private update(ticker: Ticker) {
    const dt = Math.min(ticker.deltaMS, 50) / 1000;
    this.elapsed += ticker.deltaMS;

    const pac = this.pac;
    const want = this.desiredDir;
    // Classic feel: reversing direction is allowed mid-corridor.
    if (want && pac.progress > 0 && want.x === -pac.dir.x && want.y === -pac.dir.y) {
      pac.tx += pac.dir.x;
      pac.ty += pac.dir.y;
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

    // TODO: real ghost AI (chase/scatter targeting like Blinky/Pinky/etc.).
    // For the stub they wander the labyrinth, preferring to keep straight.
    for (const ghost of this.ghosts) {
      this.advance(ghost, GHOST_SPEED * dt, (m) => this.chooseGhostDir(m));
    }

    this.place(pac);
    const moving = pac.dir.x !== 0 || pac.dir.y !== 0;
    if (moving) pac.sprite.rotation = Math.atan2(pac.dir.y, pac.dir.x);
    pac.sprite.texture =
      moving && Math.floor(this.elapsed / 120) % 2 === 0 ? this.pacClosed : this.pacOpen;
    for (const ghost of this.ghosts) this.place(ghost);

    this.pelletLayer.alpha = 0.55 + 0.45 * Math.sin(this.elapsed / 220);

    // TODO: pac/ghost collisions, lives, score, frightened timer.
  }

  /** Walk a mover up to `dist` px, consulting `choose` at each tile center. */
  private advance(
    m: Mover,
    dist: number,
    choose: (m: Mover) => Vec | null,
    onArrive?: () => void,
  ) {
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
        m.tx += m.dir.x;
        m.ty += m.dir.y;
        m.progress = 0;
        onArrive?.();
      }
    }
  }

  private chooseGhostDir(m: Mover): Vec | null {
    const options = DIRS.filter(
      (d) => this.isOpen(m.tx, m.ty, d) && !(d.x === -m.dir.x && d.y === -m.dir.y),
    );
    if (options.length > 0) {
      if ((m.dir.x || m.dir.y) && Math.random() < 0.6) {
        const straight = options.find((d) => d.x === m.dir.x && d.y === m.dir.y);
        if (straight) return straight;
      }
      return options[Math.floor(Math.random() * options.length)];
    }
    const back = { x: -m.dir.x, y: -m.dir.y };
    return (back.x || back.y) && this.isOpen(m.tx, m.ty, back) ? back : null;
  }

  private isOpen(tx: number, ty: number, d: Vec): boolean {
    const x = tx + d.x;
    const y = ty + d.y;
    const { cols, rows, grid } = this.maze;
    return x >= 0 && y >= 0 && x < cols && y < rows && grid[y * cols + x] === 1;
  }

  private place(m: Mover) {
    m.sprite.x = m.tx * TILE + TILE / 2 + m.dir.x * m.progress;
    m.sprite.y = m.ty * TILE + TILE / 2 + m.dir.y * m.progress;
  }

  private eatAt(tx: number, ty: number) {
    const idx = ty * this.maze.cols + tx;
    if (this.dotTiles.delete(idx)) {
      const ck = Math.floor(ty / CHUNK) * this.chunkCols + Math.floor(tx / CHUNK);
      this.chunkDots.get(ck)!.delete(idx);
      this.redrawChunk(ck);
      this.dotsEaten++;
      this.pushStats();
      return;
    }
    const pellet = this.pelletsByTile.get(idx);
    if (pellet) {
      this.pelletsByTile.delete(idx);
      pellet.destroy();
      // TODO: frightened mode — ghosts turn blue and become edible.
    }
  }

  private redrawChunk(ck: number) {
    const g = this.chunkGfx.get(ck)!;
    const { cols } = this.maze;
    g.clear();
    for (const idx of this.chunkDots.get(ck)!) {
      g.rect((idx % cols) * TILE + 3, Math.floor(idx / cols) * TILE + 3, 2, 2);
    }
    g.fill(DOT_COLOR);
  }

  private pushStats() {
    this.onStats({
      cols: this.maze.cols,
      rows: this.maze.rows,
      ghosts: this.ghosts.length,
      powerPellets: this.plan.powerPellets,
      ghostBases: this.maze.baseRooms.length,
      dotsTotal: this.dotsTotal,
      dotsEaten: this.dotsEaten,
    });
  }
}
