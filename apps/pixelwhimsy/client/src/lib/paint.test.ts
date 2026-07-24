import { describe, it, expect } from "vitest";
import {
  gridSize,
  brushOffsets,
  brushRadius,
  floodFill,
  mirrorPositions,
  MirrorMode,
  CELL,
} from "./paint";

// Order-independent comparison of a set of [x,y] cells.
const asSet = (pairs: Array<[number, number]>): string[] =>
  pairs.map(([x, y]) => `${x},${y}`).sort();

describe("gridSize", () => {
  it("fills the viewport minus the tool/color strips, in 10px cells", () => {
    const g = gridSize(1050, 550); // (1050-50)/10 = 100, (550-50)/10 = 50
    expect(g).toEqual({ cols: 100, rows: 50, cellSize: CELL });
  });
  it("floors partial cells and never goes below 1", () => {
    expect(gridSize(57, 57)).toEqual({ cols: 1, rows: 1, cellSize: CELL }); // (7/10) floored, min 1
  });
  it("honors a custom (mobile) cell size", () => {
    // (650-50)/6 = 100, 350/6 = 58.3 → 58
    expect(gridSize(650, 350, 50, 0, 6)).toEqual({ cols: 100, rows: 58, cellSize: 6 });
  });
});

describe("brushOffsets", () => {
  it("single and fill touch just the cursor cell", () => {
    expect(brushOffsets("single", 200, 100)).toEqual([[0, 0]]);
    expect(brushOffsets("fill", 200, 100)).toEqual([[0, 0]]);
  });
  it("scales round brushes to a fraction of the longest edge (as diameter)", () => {
    // longest edge 200 → big ~10% (radius 10), medium ~5% (radius 5)
    expect(brushRadius("round20", 200, 100)).toBe(10);
    expect(brushRadius("round5", 200, 100)).toBe(5);
    const big = brushOffsets("round20", 200, 100).map(([dx]) => dx);
    expect(Math.min(...big)).toBe(-10);
    expect(Math.max(...big)).toBe(10);
    const med = brushOffsets("round5", 200, 100).map(([dx]) => dx);
    expect(Math.min(...med)).toBe(-5);
    expect(Math.max(...med)).toBe(5);
  });
  it("rounds the disc corners off and keeps the center", () => {
    const o = brushOffsets("round5", 200, 100); // radius 5
    expect(o).toContainEqual([0, 0]);
    expect(o).toContainEqual([5, 0]);
    expect(o).not.toContainEqual([5, 5]); // corner distance ~7.07 > 5.5
  });
  it("never drops below radius 1 on a tiny grid", () => {
    expect(brushRadius("round5", 4, 4)).toBe(1);
    expect(brushRadius("round20", 4, 4)).toBe(1);
  });
  it("spray shares the big brush's footprint", () => {
    expect(brushRadius("spray", 200, 100)).toBe(brushRadius("round20", 200, 100));
  });
});

describe("mirrorPositions", () => {
  // 11x11 grid → centre (5,5). Point (7,8): offset (+2,+3) from centre.
  const cols = 11;
  const rows = 11;
  const at = (mode: MirrorMode) => asSet(mirrorPositions(7, 8, cols, rows, mode));

  it("mode 0 leaves the point alone", () => {
    expect(at(0)).toEqual(asSet([[7, 8]]));
  });
  it("mode 1 mirrors left-right", () => {
    expect(at(1)).toEqual(
      asSet([
        [7, 8],
        [3, 8],
      ]),
    );
  });
  it("mode 2 mirrors top-bottom", () => {
    expect(at(2)).toEqual(
      asSet([
        [7, 8],
        [7, 2],
      ]),
    );
  });
  it("mode 3 mirrors four ways", () => {
    expect(at(3)).toEqual(
      asSet([
        [7, 8],
        [3, 8],
        [7, 2],
        [3, 2],
      ]),
    );
  });
  it("mode 4 adds the two diagonals (eight-fold)", () => {
    expect(at(4)).toEqual(
      asSet([
        [7, 8],
        [3, 8],
        [7, 2],
        [3, 2],
        [8, 7],
        [2, 7],
        [8, 3],
        [2, 3],
      ]),
    );
  });
  it("drops out-of-bounds diagonal reflections on a non-square grid", () => {
    // Wide, short grid: the diagonal transpose lands off the board and is dropped,
    // and every returned cell is in bounds.
    const out = mirrorPositions(18, 4, 20, 6, 4);
    for (const [x, y] of out) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(20);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(6);
    }
  });
  it("dedupes points that fall on a mirror axis", () => {
    // A point on the horizontal centre line reflects onto itself under top-bottom.
    expect(mirrorPositions(7, 5, cols, rows, 2)).toEqual([[7, 5]]);
  });
});

describe("floodFill", () => {
  // 4x4 indexed grid: left half index W, right half index K
  const cols = 4;
  const rows = 4;
  const W = 0; // white/blank index
  const K = 12; // some other index
  const R = 5; // the new fill index
  const grid = () => {
    const g: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.push(x < 2 ? W : K);
    return g;
  };

  it("returns the whole contiguous same-color region", () => {
    const idxs = floodFill(grid(), cols, rows, 0, 0, R);
    expect(idxs.length).toBe(8); // the 2x4 white block
    // none of the black cells (x>=2) are included
    for (const i of idxs) expect(i % cols).toBeLessThan(2);
  });

  it("does nothing when the target is already the new color", () => {
    expect(floodFill(grid(), cols, rows, 0, 0, W)).toEqual([]);
  });

  it("does not leak across a color boundary (4-connected)", () => {
    const idxs = floodFill(grid(), cols, rows, 3, 3, R);
    expect(idxs.length).toBe(8); // only the black block
    for (const i of idxs) expect(i % cols).toBeGreaterThanOrEqual(2);
  });

  it("does not mutate the input grid", () => {
    const g = grid();
    const copy = [...g];
    floodFill(g, cols, rows, 0, 0, R);
    expect(g).toEqual(copy);
  });
});
