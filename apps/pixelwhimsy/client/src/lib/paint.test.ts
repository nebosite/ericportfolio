import { describe, it, expect } from "vitest";
import { gridSize, brushOffsets, brushRadius, floodFill, CELL } from "./paint";

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
