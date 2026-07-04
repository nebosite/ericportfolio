import { describe, it, expect } from "vitest";
import {
  N,
  E,
  S,
  W,
  Tile,
  Grid,
  Head,
  Rng,
  openings,
  exits,
  canReceive,
  isLocked,
  rotateTile,
  generateGrid,
  startFlow,
  advanceHead,
  connectedToSource,
  wrapX,
  wrapY,
  tileAt,
  idx,
  countdownSec,
  flowRate,
  drainCount,
} from "./pipeLogic";

const dry = (): boolean[] => [false, false, false, false];
const tile = (kind: Tile["kind"], rot = 0, dir?: number): Tile => ({
  kind,
  rot,
  dir,
  water: dry(),
});

// Deterministic rng that walks a fixed sequence (values in [0,1)).
const seqRng = (seq: number[]): Rng => {
  let i = 0;
  return () => seq[i++ % seq.length];
};

describe("openings", () => {
  it("straight opens N–S at rot 0 and E–W after a quarter turn", () => {
    expect(openings(tile("straight", 0))).toEqual([true, false, true, false]);
    expect(openings(tile("straight", 1))).toEqual([false, true, false, true]);
  });

  it("elbow bends and sweeps around with rotation", () => {
    expect(openings(tile("elbow", 0))).toEqual([true, true, false, false]); // N+E
    expect(openings(tile("elbow", 2))).toEqual([false, false, true, true]); // S+W
  });

  it("cross opens every side regardless of rotation", () => {
    expect(openings(tile("cross", 0))).toEqual([true, true, true, true]);
  });

  it("tee opens three sides (bar + stem) and rotates around", () => {
    expect(openings(tile("tee", 0))).toEqual([false, true, true, true]); // E+S+W
    expect(openings(tile("tee", 1))).toEqual([true, false, true, true]); // S+W+N
    expect(openings(tile("tee", 2))).toEqual([true, true, false, true]); // W+N+E
    expect(openings(tile("tee", 3))).toEqual([true, true, true, false]); // N+E+S
  });

  it("start and terminus open only toward their dir", () => {
    expect(openings(tile("start", 0, E))).toEqual([false, true, false, false]);
    expect(openings(tile("terminus", 0, W))).toEqual([false, false, false, true]);
  });
});

describe("exits", () => {
  it("straight and cross pass straight through (one exit)", () => {
    expect(exits(tile("straight", 0), N)).toEqual([S]);
    expect(exits(tile("cross", 0), E)).toEqual([W]);
  });

  it("elbow bends to its other opening", () => {
    expect(exits(tile("elbow", 0), N)).toEqual([E]);
  });

  it("a tee splits into its other two ports", () => {
    expect(exits(tile("tee", 0), W)).toEqual([E, S]);
    expect(exits(tile("tee", 0), S)).toEqual([E, W]);
    expect(exits(tile("tee", 0), E)).toEqual([S, W]);
  });

  it("a terminus has nowhere onward, and a closed side yields none", () => {
    expect(exits(tile("terminus", 0, W), W)).toEqual([]);
    expect(exits(tile("straight", 0), E)).toEqual([]);
  });
});

describe("canReceive / locking", () => {
  it("receives on an open, dry side only", () => {
    expect(canReceive(tile("straight", 0), N)).toBe(true);
    expect(canReceive(tile("straight", 0), E)).toBe(false);
    const wet = tile("straight", 0);
    wet.water[N] = true;
    expect(canReceive(wet, N)).toBe(false); // encountering water there → dies
  });

  it("a cross can still receive on its free channel", () => {
    const c = tile("cross", 0);
    c.water[N] = true;
    c.water[S] = true;
    expect(canReceive(c, E)).toBe(true);
    expect(canReceive(c, N)).toBe(false);
  });

  it("start tiles and any watered pipe are locked; a dry terminus is not", () => {
    expect(isLocked(tile("start", 0, N))).toBe(true);
    expect(isLocked(tile("terminus", 0, N))).toBe(false);
    expect(isLocked(tile("tee", 0))).toBe(false);
    const wet = tile("tee", 0);
    wet.water[E] = true;
    expect(isLocked(wet)).toBe(true);
  });

  it("rotate advances a rot-kind and turns a terminus's opening", () => {
    expect(rotateTile(tile("tee", 3)).rot).toBe(0);
    expect(rotateTile(tile("terminus", 0, N)).dir).toBe(E);
  });
});

describe("drainCount", () => {
  it("is 1 + ceil(area/1000) * level", () => {
    expect(drainCount(20, 20, 1)).toBe(1 + 1 * 1); // area 400 → ceil 1
    expect(drainCount(40, 40, 1)).toBe(1 + 2 * 1); // area 1600 → ceil 2
    expect(drainCount(40, 40, 3)).toBe(1 + 2 * 3);
  });
});

describe("generateGrid", () => {
  it("sprinkles a few tees and keeps the start central", () => {
    const g = generateGrid(40, 40, Math.random, 1);
    expect(tileAt(g, g.start.x, g.start.y).kind).toBe("start");
    expect(g.start.x).toBeGreaterThanOrEqual(10);
    expect(g.start.x).toBeLessThan(30);
    const tees = g.tiles.filter((t) => t.kind === "tee").length;
    // ~2% of tiles are tees — sparse, but a handful on a 1600-cell board.
    expect(tees).toBeGreaterThan(0);
    expect(tees).toBeLessThan(g.tiles.length * 0.06);
  });

  it("places drains ≥4 from every edge, the source and each other", () => {
    const g = generateGrid(40, 40, Math.random, 2);
    expect(g.drains.length).toBe(drainCount(40, 40, 2));
    for (let i = 0; i < g.drains.length; i++) {
      const d = g.drains[i];
      expect(d.x).toBeGreaterThanOrEqual(4);
      expect(d.x).toBeLessThanOrEqual(40 - 5);
      expect(d.y).toBeGreaterThanOrEqual(4);
      expect(d.y).toBeLessThanOrEqual(40 - 5);
      expect(Math.hypot(d.x - g.start.x, d.y - g.start.y)).toBeGreaterThanOrEqual(4);
      expect(tileAt(g, d.x, d.y).kind).toBe("terminus");
      for (let j = i + 1; j < g.drains.length; j++) {
        const e = g.drains[j];
        expect(Math.hypot(d.x - e.x, d.y - e.y)).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("is deterministic for a given rng", () => {
    const a = generateGrid(24, 24, seqRng([0.1, 0.7, 0.3, 0.9, 0.5]), 2);
    const b = generateGrid(24, 24, seqRng([0.1, 0.7, 0.3, 0.9, 0.5]), 2);
    expect(a.tiles.map((t) => `${t.kind}${t.rot}`)).toEqual(
      b.tiles.map((t) => `${t.kind}${t.rot}`),
    );
    expect(a.start).toEqual(b.start);
    expect(a.drains).toEqual(b.drains);
  });
});

// Build a tiny hand-made grid so flow is fully predictable.
function makeGrid(
  cols: number,
  rows: number,
  tiles: Tile[],
  sx: number,
  sy: number,
  drains: Array<{ x: number; y: number }> = [],
): Grid {
  return { cols, rows, tiles, start: { x: sx, y: sy }, drains };
}

// A head sitting in a tile, having entered from `entry` with the given exits.
const head = (x: number, y: number, entry: number, exits: number[]): Head => ({
  x,
  y,
  entry,
  exits,
  progress: 1,
});

describe("startFlow", () => {
  it("continues into a correctly oriented neighbour and marks it wet", () => {
    const g = makeGrid(3, 1, [tile("start", 0, E), tile("straight", 1), tile("straight", 1)], 0, 0);
    const step = startFlow(g);
    expect(step.type).toBe("continue");
    if (step.type === "continue") {
      expect(step.head).toMatchObject({ x: 1, y: 0, entry: W, exits: [E] });
    }
    expect(tileAt(g, 1, 0).water[W]).toBe(true);
  });

  it("dies if the first neighbour can't receive", () => {
    const g = makeGrid(2, 1, [tile("start", 0, E), tile("straight", 0)], 0, 0);
    expect(startFlow(g).type).toBe("dead");
  });

  it("reaches a drain sitting right next to the spring", () => {
    const g = makeGrid(2, 1, [tile("start", 0, E), tile("terminus", 0, W)], 0, 0, [{ x: 1, y: 0 }]);
    const step = startFlow(g);
    expect(step).toMatchObject({ type: "drain", x: 1, y: 0, entry: W });
  });
});

describe("advanceHead", () => {
  it("wraps across the edge into an aligned neighbour", () => {
    // (2,0) heads east; the board wraps to column 0, which opens west → continue.
    const g = makeGrid(3, 1, [tile("straight", 1), tile("start", 0, E), tile("straight", 1)], 1, 0);
    const results = advanceHead(g, head(2, 0, W, [E]));
    expect(results[0].type).toBe("continue");
    if (results[0].type === "continue") expect(results[0].head).toMatchObject({ x: 0, y: 0 });
  });

  it("wrapping into a mis-oriented tile still crashes", () => {
    // wraps east from (1,0) back to the start, which faces east not west → crash.
    const g = makeGrid(2, 1, [tile("start", 0, E), tile("straight", 1)], 0, 0);
    startFlow(g);
    expect(advanceHead(g, head(1, 0, W, [E]))).toEqual([{ type: "dead", reason: "crash" }]);
  });

  it("a tee splits into two live streams", () => {
    // tee at (1,1) fed from the west → exits E and S into aligned neighbours.
    const tiles = Array.from({ length: 9 }, () => tile("straight", 0));
    tiles[1 * 3 + 1] = tile("tee", 0); // (1,1): E+S+W
    tiles[1 * 3 + 2] = tile("straight", 1); // (2,1): E–W, opens W
    tiles[2 * 3 + 1] = tile("straight", 0); // (1,2): N–S, opens N
    const g = makeGrid(3, 3, tiles, 0, 0);
    const results = advanceHead(g, head(1, 1, W, [E, S]));
    expect(results.map((r) => r.type)).toEqual(["continue", "continue"]);
    expect(tileAt(g, 2, 1).water[W]).toBe(true);
    expect(tileAt(g, 1, 2).water[N]).toBe(true);
  });

  it("a tee branch that crashes into a wall while the other lives", () => {
    const tiles = Array.from({ length: 9 }, () => tile("straight", 0));
    tiles[1 * 3 + 1] = tile("tee", 0); // (1,1) exits E,S
    tiles[1 * 3 + 2] = tile("straight", 0); // (2,1): N–S — no west opening → crash
    tiles[2 * 3 + 1] = tile("straight", 0); // (1,2): N–S — opens N → continue
    const g = makeGrid(3, 3, tiles, 0, 0);
    const results = advanceHead(g, head(1, 1, W, [E, S]));
    const east = results[0]; // exit E → (2,1)
    const south = results[1]; // exit S → (1,2)
    expect(east).toEqual({ type: "dead", reason: "crash" });
    expect(south.type).toBe("continue");
  });

  it("a stream that meets existing water dies by collision (not game over)", () => {
    // (1,0) opens west but is already wet on that side → collision, not a crash.
    const g = makeGrid(2, 1, [tile("start", 0, E), tile("straight", 1)], 0, 0);
    tileAt(g, 1, 0).water[W] = true;
    expect(advanceHead(g, head(0, 0, W, [E]))).toEqual([{ type: "dead", reason: "collision" }]);
  });

  it("reaches a drain when the terminus faces the incoming water", () => {
    const g = makeGrid(
      3,
      1,
      [tile("start", 0, E), tile("straight", 1), tile("terminus", 0, W)],
      0,
      0,
      [{ x: 2, y: 0 }],
    );
    startFlow(g);
    const results = advanceHead(g, head(1, 0, W, [E]));
    expect(results).toEqual([{ type: "drain", x: 2, y: 0, entry: W }]);
  });
});

describe("wraparound + connectivity", () => {
  it("wrapX / wrapY fold coordinates onto the torus", () => {
    const g = makeGrid(5, 4, [], 0, 0);
    expect(wrapX(g, -1)).toBe(4);
    expect(wrapX(g, 5)).toBe(0);
    expect(wrapY(g, -1)).toBe(3);
    expect(wrapY(g, 4)).toBe(0);
  });

  it("marks tiles that trace back to the source and leaves the rest out", () => {
    // (0,0) start→E, (1,0) E–W straight connects; (2,0) vertical does not.
    const g = makeGrid(3, 1, [tile("start", 0, E), tile("straight", 1), tile("straight", 0)], 0, 0);
    const seen = connectedToSource(g);
    expect(seen[idx(g, 0, 0)]).toBe(true); // source
    expect(seen[idx(g, 1, 0)]).toBe(true); // linked E–W pipe
    expect(seen[idx(g, 2, 0)]).toBe(false); // vertical, no west opening
  });

  it("connectivity follows the wraparound edge", () => {
    // start faces west; the tile it reaches sits on the far (wrapped) column.
    const g = makeGrid(2, 1, [tile("start", 0, W), tile("straight", 1)], 0, 0);
    const seen = connectedToSource(g);
    expect(seen[idx(g, 1, 0)]).toBe(true); // reached by wrapping west from (0,0)
  });

  it("a cross only passes straight through its entry channel", () => {
    // source enters the cross from the west → water may only leave east, never
    // turn up/down through the perpendicular channel.
    const tiles = Array.from({ length: 9 }, () => tile("straight", 0));
    tiles[1 * 3 + 0] = tile("start", 0, E); // (0,1) source → east
    tiles[1 * 3 + 1] = tile("cross", 0); // (1,1) cross
    tiles[1 * 3 + 2] = tile("straight", 1); // (2,1) E–W, opens W → reachable
    tiles[0 * 3 + 1] = tile("straight", 0); // (1,0) N–S, opens S — must NOT connect
    const g = makeGrid(3, 3, tiles, 0, 1);
    const seen = connectedToSource(g);
    expect(seen[idx(g, 1, 1)]).toBe(true); // the cross itself
    expect(seen[idx(g, 2, 1)]).toBe(true); // straight through to the east
    expect(seen[idx(g, 1, 0)]).toBe(false); // the cross must not turn north
  });
});

describe("difficulty curve", () => {
  it("countdown shrinks with level, with a +30s planning buffer", () => {
    expect(countdownSec(1)).toBe(60); // 30 base + 30
    expect(countdownSec(6)).toBe(35); // 5 floor + 30
  });

  it("flow speeds up with level", () => {
    expect(flowRate(1)).toBe(8);
    expect(flowRate(3)).toBe(16);
  });
});
