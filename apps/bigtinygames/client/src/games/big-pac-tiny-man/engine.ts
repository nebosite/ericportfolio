import { Application, Container, Graphics, Sprite, Ticker } from 'pixi.js';
import { attachGameInput, Vec } from '../input';
import { Maze, TILE, WorldPlan, generateMaze, planWorld } from './maze';
import { loadSpriteTextures, pelletTexture, SpriteTextures } from './sprites';
import { Sfx } from './sfx';

export interface WorldStats {
  cols: number;
  rows: number;
  ghosts: number;
  powerPellets: number;
  ghostBases: number;
  dotsTotal: number;
  dotsEaten: number;
  score: number;
}

const MAX_W = 3840; // cap the playfield at 4K
const MAX_H = 2160;
const PAC_SPEED = 150; // px/sec (~9 tiles/sec at the 16px tile)
const GHOST_SPEED = 120;
const CHUNK = 32; // dots batched into one Graphics per 32x32-tile chunk

// AI tuning, all in grid squares.
const CHASE_RADIUS = 20; // start hunting Pac when this close
const LEASH = 30; // wander no further than this from home before drifting back
const FRIGHTEN_RADIUS = 22; // a power pellet scares ghosts within this range
const POWERUP_MIN_GAP = 10; // no two power pellets closer than this

// Scoring.
const DOT_POINTS = 10;
const PELLET_POINTS = 50;
const FRUIT_POINTS = 100;

// Fruit spawning (per ghost base).
const FRUIT_INTERVAL = 6000; // ms between a base's fruit spawns
const FRUIT_PER_BASE = 6; // max alive fruit a single base will keep out
const FRUIT_RADIUS = 8; // tiles from base center a fruit can appear

const WALL_COLOR = 0x1c1c8a;
const DOT_COLOR = 0xffc7ae;
const PELLET_COLOR = 0xffe14b;
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

interface Ghost extends Mover {
  home: { x: number; y: number };
  color: number;
  frightened: boolean;
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
  static async create(host: HTMLElement, onStats: (s: WorldStats) => void): Promise<BigPacEngine> {
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.min(Math.round(host.clientWidth * dpr), MAX_W);
    const pxH = Math.min(Math.round(host.clientHeight * dpr), MAX_H);

    const app = new Application();
    await app.init({ width: pxW, height: pxH, background: 0x05050c, antialias: false });
    app.canvas.style.width = `${pxW / dpr}px`;
    app.canvas.style.height = `${pxH / dpr}px`;
    app.canvas.style.setProperty('image-rendering', 'pixelated');
    host.appendChild(app.canvas);

    // Sprites (PNG) and sounds (MP3) load up front so the first frame is ready.
    const textures = await loadSpriteTextures();
    const sfx = new Sfx();
    sfx.load();

    return new BigPacEngine(app, pxW, pxH, onStats, textures, sfx);
  }

  private app: Application;
  private onStats: (s: WorldStats) => void;
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
  private ghosts: Ghost[] = [];
  private pac: Mover;
  private desiredDir: Vec | null = null;
  private dotsTotal = 0;
  private dotsEaten = 0;
  private score = 0;
  private elapsed = 0;
  private detachInput: () => void;

  private constructor(
    app: Application,
    pxW: number,
    pxH: number,
    onStats: (s: WorldStats) => void,
    textures: SpriteTextures,
    sfx: Sfx,
  ) {
    this.app = app;
    this.onStats = onStats;
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

    const dotLayer = new Container();
    world.addChild(dotLayer);

    // Power pellets: chosen with even spacing (no two within POWERUP_MIN_GAP
    // tiles) from a shuffled candidate pool; everything left becomes a dot.
    const pelletSet = this.choosePelletTiles(candidates);
    const pTex = pelletTexture(app.renderer, PELLET_COLOR);
    for (const idx of pelletSet) {
      const sprite = new Sprite(pTex);
      sprite.anchor.set(0.5);
      sprite.scale.set(TILE / 8);
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
    this.dotsTotal = this.dotTiles.size;
    for (const ck of this.chunkGfx.keys()) this.redrawChunk(ck);

    world.addChild(this.fruitLayer);

    // Ghosts spawn spread across the base rooms; each remembers its home room
    // center and its classic tint.
    const ghostLayer = new Container();
    world.addChild(ghostLayer);
    const rooms = this.maze.baseRooms;
    this.baseFruitCount = rooms.map(() => 0);
    this.baseFruitTimer = rooms.map(() => Math.random() * FRUIT_INTERVAL);
    for (let i = 0; i < this.plan.ghosts; i++) {
      const roomIdx = i % rooms.length;
      const room = rooms[roomIdx];
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
        home: { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) },
        color,
        frightened: false,
      });
    }

    const pacSprite = new Sprite(this.tex.pacOpen);
    pacSprite.anchor.set(0.5);
    world.addChild(pacSprite);
    this.pac = { tx: spawn.x, ty: spawn.y, progress: 0, dir: STOPPED, sprite: pacSprite };

    this.detachInput = attachGameInput({
      onDirection: (dir) => {
        this.desiredDir = dir;
        this.sfx.resume(); // browsers need a gesture to start audio
      },
    });
    for (const m of [this.pac, ...this.ghosts]) this.place(m);
    app.ticker.add(this.update, this);
    this.pushStats();
  }

  destroy() {
    this.detachInput();
    this.sfx.destroy();
    this.app.ticker.remove(this.update, this);
    this.app.destroy(true, { children: true, texture: true });
  }

  // ---- main loop -----------------------------------------------------------

  private update(ticker: Ticker) {
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
      this.advance(ghost, GHOST_SPEED * dt, (m) => this.chooseGhostDir(m as Ghost));
      if (ghost.frightened && torusDist(ghost.tx, ghost.ty, ghost.home.x, ghost.home.y, cols, rows) <= 2) {
        this.calm(ghost);
      }
    }

    this.spawnFruit(dt);

    this.place(pac);
    const moving = pac.dir.x !== 0 || pac.dir.y !== 0;
    if (moving) pac.sprite.rotation = Math.atan2(pac.dir.y, pac.dir.x);
    pac.sprite.texture =
      moving && Math.floor(this.elapsed / 120) % 2 === 0 ? this.tex.pacClosed : this.tex.pacOpen;
    for (const ghost of this.ghosts) this.place(ghost);

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
    const { cols, rows } = this.maze;

    // Pick a target tile and how directly to pursue it (lower = more wandering).
    let target: { x: number; y: number } | null = null;
    let directness = 0;
    if (g.frightened) {
      target = g.home;
      directness = 0.85; // flee home fairly purposefully
    } else if (torusDist(g.tx, g.ty, this.pac.tx, this.pac.ty, cols, rows) <= CHASE_RADIUS) {
      target = { x: this.pac.tx, y: this.pac.ty };
      directness = 0.55; // chase, but take a circuitous route
    } else if (torusDist(g.tx, g.ty, g.home.x, g.home.y, cols, rows) > LEASH) {
      target = g.home;
      directness = 0.7; // drifting too far — head back toward the leash
    }

    const options = DIRS.filter(
      (d) => this.isOpen(g.tx, g.ty, d) && !(d.x === -g.dir.x && d.y === -g.dir.y),
    );
    if (options.length === 0) {
      const back = { x: -g.dir.x, y: -g.dir.y };
      return (back.x || back.y) && this.isOpen(g.tx, g.ty, back) ? back : null;
    }

    if (!target) {
      // Wander: keep momentum most of the time, otherwise turn at random.
      if ((g.dir.x || g.dir.y) && Math.random() < 0.6) {
        const straight = options.find((d) => d.x === g.dir.x && d.y === g.dir.y);
        if (straight) return straight;
      }
      return options[Math.floor(Math.random() * options.length)];
    }

    // Targeted: usually step toward the target, but sometimes pick any open
    // direction so the pursuit meanders instead of being a perfect chase.
    if (Math.random() < directness) {
      let best = options[0];
      let bestD = Infinity;
      for (const d of options) {
        const nx = wrap(g.tx + d.x, cols);
        const ny = wrap(g.ty + d.y, rows);
        const dist = torusDist(nx, ny, target.x, target.y, cols, rows);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
      return best;
    }
    return options[Math.floor(Math.random() * options.length)];
  }

  private frighten(tileIdx: number) {
    const { cols, rows } = this.maze;
    const px = tileIdx % cols;
    const py = Math.floor(tileIdx / cols);
    for (const g of this.ghosts) {
      if (g.frightened) continue;
      if (torusDist(g.tx, g.ty, px, py, cols, rows) <= FRIGHTEN_RADIUS) {
        g.frightened = true;
        g.sprite.texture = this.tex.ghostFrightened;
        g.sprite.tint = 0xffffff;
      }
    }
  }

  private calm(g: Ghost) {
    g.frightened = false;
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
      // A few random tries to land on an open, unoccupied tile near the base.
      for (let attempt = 0; attempt < 12; attempt++) {
        const tx = wrap(cx + Math.floor(Math.random() * (2 * FRUIT_RADIUS + 1)) - FRUIT_RADIUS, cols);
        const ty = wrap(cy + Math.floor(Math.random() * (2 * FRUIT_RADIUS + 1)) - FRUIT_RADIUS, rows);
        const idx = ty * cols + tx;
        if (!grid[idx] || this.fruitByTile.has(idx)) continue;
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

  private isOpen(tx: number, ty: number, d: Vec): boolean {
    const { cols, rows, grid } = this.maze;
    const x = wrap(tx + d.x, cols);
    const y = wrap(ty + d.y, rows);
    return grid[y * cols + x] === 1;
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
      this.pushStats();
    }

    if (this.dotTiles.delete(idx)) {
      const ck = Math.floor(ty / CHUNK) * this.chunkCols + Math.floor(tx / CHUNK);
      this.chunkDots.get(ck)!.delete(idx);
      this.redrawChunk(ck);
      this.dotsEaten++;
      this.score += DOT_POINTS;
      this.sfx.waka();
      this.pushStats();
      return;
    }

    const pellet = this.pelletsByTile.get(idx);
    if (pellet) {
      this.pelletsByTile.delete(idx);
      pellet.destroy();
      this.score += PELLET_POINTS;
      this.sfx.play('power', 0.5);
      this.frighten(idx); // scare nearby ghosts back to their bases
      this.pushStats();
    }
  }

  /**
   * Greedy spaced sampling: shuffle the candidate corridor tiles, then accept
   * one only if it's at least POWERUP_MIN_GAP tiles from every pellet already
   * accepted. A bucket grid keeps the neighbor check O(1).
   */
  private choosePelletTiles(candidates: number[]): Set<number> {
    const { cols } = this.maze;
    const target = Math.min(this.plan.powerPellets, candidates.length);
    const gap = POWERUP_MIN_GAP;

    const order = candidates.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    const buckets = new Map<number, Array<[number, number]>>();
    const bucketCols = Math.ceil(cols / gap) + 2;
    const bkey = (bx: number, by: number) => by * bucketCols + bx;
    const farEnough = (x: number, y: number) => {
      const bx = Math.floor(x / gap);
      const by = Math.floor(y / gap);
      for (let iy = by - 1; iy <= by + 1; iy++) {
        for (let ix = bx - 1; ix <= bx + 1; ix++) {
          const arr = buckets.get(bkey(ix, iy));
          if (!arr) continue;
          for (const [px, py] of arr) {
            const dx = px - x;
            const dy = py - y;
            if (dx * dx + dy * dy < gap * gap) return false;
          }
        }
      }
      return true;
    };

    const chosen = new Set<number>();
    for (const idx of order) {
      if (chosen.size >= target) break;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (!farEnough(x, y)) continue;
      chosen.add(idx);
      const key = bkey(Math.floor(x / gap), Math.floor(y / gap));
      let arr = buckets.get(key);
      if (!arr) buckets.set(key, (arr = []));
      arr.push([x, y]);
    }
    return chosen;
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

  private pushStats() {
    this.onStats({
      cols: this.maze.cols,
      rows: this.maze.rows,
      ghosts: this.ghosts.length,
      powerPellets: this.plan.powerPellets,
      ghostBases: this.maze.baseRooms.length,
      dotsTotal: this.dotsTotal,
      dotsEaten: this.dotsEaten,
      score: this.score,
    });
  }
}

// Toroidal helpers — the maze wraps at its tunnel rows/cols.
function wrap(v: number, n: number): number {
  return ((v % n) + n) % n;
}

function torusDist(ax: number, ay: number, bx: number, by: number, cols: number, rows: number): number {
  let dx = Math.abs(ax - bx);
  let dy = Math.abs(ay - by);
  if (dx > cols - dx) dx = cols - dx;
  if (dy > rows - dy) dy = rows - dy;
  return dx + dy;
}
