import { describe, it, expect } from "vitest";
import { lineCells, strokeCells, type Pt } from "./stroke";

// The core invariant for "no more than one toy pixel at a time": every step in a
// returned path is to a touching cell (Chebyshev distance exactly 1).
function assertContiguous(cells: Array<[number, number]>) {
  for (let i = 1; i < cells.length; i++) {
    const [px, py] = cells[i - 1];
    const [cx, cy] = cells[i];
    const step = Math.max(Math.abs(cx - px), Math.abs(cy - py));
    expect(step).toBe(1);
  }
}

describe("lineCells", () => {
  it("walks a horizontal run, excluding the start cell", () => {
    expect(lineCells(0, 0, 4, 0)).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
  });

  it("walks a diagonal run one cell at a time", () => {
    expect(lineCells(0, 0, 3, 3)).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("bridges a steep jump with no gaps, ending on the target", () => {
    const cells = lineCells(0, 0, 2, 9);
    assertContiguous(cells);
    expect(cells[0]).not.toEqual([0, 0]); // start excluded
    expect(cells[cells.length - 1]).toEqual([2, 9]);
  });
});

describe("strokeCells", () => {
  it("fills a fast straight move so nothing is skipped", () => {
    // A 10-cell jump that a raw pointer event would leave as two dots.
    const p1: Pt = { x: 0.5, y: 0.5 };
    const p2: Pt = { x: 10.5, y: 0.5 };
    const cells = strokeCells({ x: -0.5, y: 0.5 }, p1, p2, { x: 11.5, y: 0.5 });
    assertContiguous(cells);
    expect(cells[cells.length - 1]).toEqual([10, 0]); // reaches p2's cell
    expect(cells).toContainEqual([5, 0]); // and everything in between
  });

  it("bridges a fast diagonal/steep move with a contiguous path", () => {
    const cells = strokeCells(
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 9.5, y: 4.5 },
      { x: 18, y: 9 },
    );
    assertContiguous(cells);
    expect(cells[cells.length - 1]).toEqual([9, 4]);
  });

  it("curves between samples instead of cornering sharply", () => {
    // A horizontal segment p1→p2 at y≈20 whose neighbours both sit well above it.
    // A raw straight line would stay on one row; the velocity-guided spline must
    // bow off that chord, so the path touches more than one row.
    const p0: Pt = { x: 0.5, y: 0.5 };
    const p1: Pt = { x: 0.5, y: 20.5 };
    const p2: Pt = { x: 30.5, y: 20.5 };
    const p3: Pt = { x: 30.5, y: 0.5 };
    const cells = strokeCells(p0, p1, p2, p3);
    assertContiguous(cells);
    const rows = new Set(cells.map(([, y]) => y));
    expect(rows.size).toBeGreaterThan(1);
  });

  it("returns nothing when the cursor has not left its cell", () => {
    const p: Pt = { x: 3.2, y: 3.2 };
    expect(strokeCells(p, p, { x: 3.6, y: 3.7 }, { x: 4, y: 4 })).toEqual([]);
  });

  it("tolerates duplicated/coincident neighbour points (no NaNs)", () => {
    const p1: Pt = { x: 2.5, y: 2.5 };
    const p2: Pt = { x: 6.5, y: 2.5 };
    // p0 duplicates p1 (start of a stroke) and p3 duplicates p2 (flush at the end).
    const cells = strokeCells(p1, p1, p2, p2);
    assertContiguous(cells);
    expect(cells.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(cells[cells.length - 1]).toEqual([6, 2]);
  });
});
