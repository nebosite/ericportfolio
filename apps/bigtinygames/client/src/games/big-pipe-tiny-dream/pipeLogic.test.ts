import { describe, it, expect } from "vitest";
import {
  N,
  E,
  S,
  W,
  Tile,
  Grid,
  Rng,
  openings,
  exitSide,
  canReceive,
  isLocked,
  rotateTile,
  generateGrid,
  startFlow,
  advanceFlow,
  tileAt,
  countdownSec,
  flowRate,
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
    expect(openings(tile("straight", 2))).toEqual([true, false, true, false]);
  });

  it("elbow bends and sweeps around with rotation", () => {
    expect(openings(tile("elbow", 0))).toEqual([true, true, false, false]); // N+E
    expect(openings(tile("elbow", 1))).toEqual([false, true, true, false]); // E+S
    expect(openings(tile("elbow", 2))).toEqual([false, false, true, true]); // S+W
    expect(openings(tile("elbow", 3))).toEqual([true, false, false, true]); // W+N
  });

  it("cross opens every side regardless of rotation", () => {
    expect(openings(tile("cross", 0))).toEqual([true, true, true, true]);
    expect(openings(tile("cross", 3))).toEqual([true, true, true, true]);
  });

  it("start and terminus open only toward their dir", () => {
    expect(openings(tile("start", 0, E))).toEqual([false, true, false, false]);
    expect(openings(tile("terminus", 0, W))).toEqual([false, false, false, true]);
  });
});

describe("exitSide", () => {
  it("straight and cross pass straight through", () => {
    expect(exitSide(tile("straight", 0), N)).toBe(S);
    expect(exitSide(tile("cross", 0), E)).toBe(W);
    expect(exitSide(tile("cross", 0), N)).toBe(S);
  });

  it("elbow bends to its other opening", () => {
    expect(exitSide(tile("elbow", 0), N)).toBe(E);
    expect(exitSide(tile("elbow", 0), E)).toBe(N);
  });

  it("a terminus has nowhere onward", () => {
    expect(exitSide(tile("terminus", 0, W), W)).toBeNull();
  });

  it("returns null when entering a closed side", () => {
    expect(exitSide(tile("straight", 0), E)).toBeNull();
  });
});

describe("canReceive / locking", () => {
  it("receives on an open, dry side only", () => {
    expect(canReceive(tile("straight", 0), N)).toBe(true);
    expect(canReceive(tile("straight", 0), E)).toBe(false); // closed side
    const wet = tile("straight", 0);
    wet.water[N] = true;
    expect(canReceive(wet, N)).toBe(false); // already used
  });

  it("a cross can still receive on its free channel", () => {
    const c = tile("cross", 0);
    c.water[N] = true;
    c.water[S] = true; // N–S channel used
    expect(canReceive(c, E)).toBe(true); // E–W channel still open
    expect(canReceive(c, N)).toBe(false);
  });

  it("start tiles and any watered pipe are locked; a dry terminus is not", () => {
    expect(isLocked(tile("start", 0, N))).toBe(true);
    expect(isLocked(tile("terminus", 0, N))).toBe(false); // rotatable until reached
    expect(isLocked(tile("straight", 0))).toBe(false);
    const wet = tile("elbow", 0);
    wet.water[N] = true;
    expect(isLocked(wet)).toBe(true);
  });

  it("rotate advances an elbow's rot and turns a terminus's opening", () => {
    const r = rotateTile(tile("elbow", 3));
    expect(r.rot).toBe(0);
    expect(r.water).toEqual(dry());
    const term = rotateTile(tile("terminus", 0, N));
    expect(term.dir).toBe(E); // N → E
  });
});

describe("generateGrid", () => {
  it("places start centrally and a terminus at its mirror", () => {
    const g = generateGrid(20, 20, seqRng([0.5]));
    const s = tileAt(g, g.start.x, g.start.y);
    expect(s.kind).toBe("start");
    expect(g.start).toEqual({ x: 10, y: 10 });
    // mirror of (10,10) through the 20x20 board is (9,9)
    expect(g.terminus).toEqual({ x: 9, y: 9 });
    expect(tileAt(g, 9, 9).kind).toBe("terminus");
    expect(s.water.some(Boolean)).toBe(true); // source primed
  });

  it("keeps the start in the central area", () => {
    const g = generateGrid(20, 20, seqRng([0.99, 0.99, 0.99, 0.5]));
    expect(g.start.x).toBeGreaterThanOrEqual(5);
    expect(g.start.x).toBeLessThan(15);
    expect(g.start.y).toBeGreaterThanOrEqual(5);
    expect(g.start.y).toBeLessThan(15);
  });

  it("is deterministic for a given rng", () => {
    const a = generateGrid(8, 8, seqRng([0.1, 0.7, 0.3, 0.9]));
    const b = generateGrid(8, 8, seqRng([0.1, 0.7, 0.3, 0.9]));
    expect(a.tiles.map((t) => `${t.kind}${t.rot}`)).toEqual(
      b.tiles.map((t) => `${t.kind}${t.rot}`),
    );
    expect(a.start).toEqual(b.start);
    expect(a.terminus).toEqual(b.terminus);
  });
});

// Build a tiny hand-made grid so flow is fully predictable.
function makeGrid(
  cols: number,
  rows: number,
  tiles: Tile[],
  sx: number,
  sy: number,
  terminus = { x: -1, y: -1 },
): Grid {
  return { cols, rows, tiles, start: { x: sx, y: sy }, terminus };
}

describe("startFlow", () => {
  it("enters a correctly oriented neighbour and marks it wet", () => {
    // 3x1 row: [start→E] [straight E–W] [straight E–W]
    const g = makeGrid(3, 1, [tile("start", 0, E), tile("straight", 1), tile("straight", 1)], 0, 0);
    const f = startFlow(g);
    expect(f.dead).toBe(false);
    expect(f).toMatchObject({ x: 1, y: 0, entry: W, exit: E, filled: 1, won: false });
    expect(tileAt(g, 1, 0).water[W]).toBe(true);
    expect(tileAt(g, 1, 0).water[E]).toBe(true);
  });

  it("dies if the first neighbour can't receive", () => {
    const g = makeGrid(2, 1, [tile("start", 0, E), tile("straight", 0)], 0, 0);
    expect(startFlow(g).dead).toBe(true);
  });
});

describe("advanceFlow", () => {
  it("threads down a lined-up row, filling each tile", () => {
    const g = makeGrid(3, 1, [tile("start", 0, E), tile("straight", 1), tile("straight", 1)], 0, 0);
    let f = startFlow(g);
    f = advanceFlow(g, f);
    expect(f.dead).toBe(false);
    expect(f).toMatchObject({ x: 2, y: 0, filled: 2 });
    // running off the east edge next is game over
    f = advanceFlow(g, f);
    expect(f.dead).toBe(true);
  });

  it("dies into a mis-oriented tile", () => {
    const g = makeGrid(3, 1, [tile("start", 0, E), tile("straight", 1), tile("straight", 0)], 0, 0);
    let f = startFlow(g);
    f = advanceFlow(g, f);
    expect(f.dead).toBe(true);
    expect(f.filled).toBe(1); // only the first pipe got wet
  });

  it("an elbow turns the stream", () => {
    const g = makeGrid(
      2,
      2,
      [
        tile("start", 0, E), // (0,0)
        tile("elbow", 2), // (1,0): S+W — receives from W, exits S
        tile("straight", 0), // (0,1) unused
        tile("straight", 0), // (1,1): N–S — receives from N
      ],
      0,
      0,
    );
    let f = startFlow(g); // enters (1,0) from W
    expect(f).toMatchObject({ x: 1, y: 0, exit: S });
    f = advanceFlow(g, f); // turns down into (1,1)
    expect(f.dead).toBe(false);
    expect(f).toMatchObject({ x: 1, y: 1, entry: N });
  });

  it("crosses through a crossover piece on its free channel", () => {
    const g = makeGrid(3, 1, [tile("start", 0, E), tile("cross", 0), tile("straight", 1)], 0, 0);
    let f = startFlow(g); // enters cross from W, exits E
    expect(f).toMatchObject({ x: 1, y: 0, entry: W, exit: E });
    expect(tileAt(g, 1, 0).water[N]).toBe(false); // N–S channel still dry
    f = advanceFlow(g, f);
    expect(f).toMatchObject({ x: 2, y: 0, filled: 2, dead: false });
  });

  it("wins when the water reaches the drain", () => {
    // [start→E] [straight E–W] [terminus opening W]
    const g = makeGrid(
      3,
      1,
      [tile("start", 0, E), tile("straight", 1), tile("terminus", 0, W)],
      0,
      0,
      { x: 2, y: 0 },
    );
    let f = startFlow(g);
    f = advanceFlow(g, f); // into the drain
    expect(f).toMatchObject({ x: 2, y: 0, won: true, dead: false, filled: 2 });
  });

  it("dies if the drain's opening faces the wrong way", () => {
    // terminus opens north, but the water arrives from the west
    const g = makeGrid(
      3,
      1,
      [tile("start", 0, E), tile("straight", 1), tile("terminus", 0, N)],
      0,
      0,
      { x: 2, y: 0 },
    );
    let f = startFlow(g);
    f = advanceFlow(g, f);
    expect(f.dead).toBe(true);
    expect(f.won).toBe(false);
  });
});

describe("difficulty curve", () => {
  it("countdown shrinks with level and floors at 5s", () => {
    expect(countdownSec(1)).toBe(30);
    expect(countdownSec(2)).toBe(25);
    expect(countdownSec(6)).toBe(5);
    expect(countdownSec(10)).toBe(5);
  });

  it("flow speeds up with level", () => {
    expect(flowRate(1)).toBe(8);
    expect(flowRate(2)).toBe(12);
    expect(flowRate(3)).toBe(16);
  });
});
