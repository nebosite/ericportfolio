import { describe, it, expect } from 'vitest';
import { gridSize, brushOffsets, floodFill, CELL } from './paint';

describe('gridSize', () => {
  it('fills the viewport minus the tool/color strips, in 10px cells', () => {
    const g = gridSize(1050, 550); // (1050-50)/10 = 100, (550-50)/10 = 50
    expect(g).toEqual({ cols: 100, rows: 50, cellSize: CELL });
  });
  it('floors partial cells and never goes below 1', () => {
    expect(gridSize(57, 57)).toEqual({ cols: 1, rows: 1, cellSize: CELL }); // (7/10) floored, min 1
  });
});

describe('brushOffsets', () => {
  it('single and fill touch just the cursor cell', () => {
    expect(brushOffsets('single')).toEqual([[0, 0]]);
    expect(brushOffsets('fill')).toEqual([[0, 0]]);
  });
  it('round5 is a 5-wide disc with the corners rounded off', () => {
    const o = brushOffsets('round5');
    const xs = o.map(([dx]) => dx);
    expect(Math.min(...xs)).toBe(-2);
    expect(Math.max(...xs)).toBe(2);
    // corner (2,2) is distance ~2.83 > 2.5 → excluded
    expect(o).not.toContainEqual([2, 2]);
    expect(o).toContainEqual([0, 0]);
    expect(o).toContainEqual([2, 0]);
  });
  it('round20 spans roughly 20 cells across', () => {
    const o = brushOffsets('round20');
    const xs = o.map(([dx]) => dx);
    expect(Math.min(...xs)).toBe(-10);
    expect(Math.max(...xs)).toBe(10);
  });
});

describe('floodFill', () => {
  // 4x4 grid: left half 'w', right half 'k'
  const cols = 4;
  const rows = 4;
  const W = '#ffffff';
  const K = '#000000';
  const R = '#ff0000';
  const grid = () => {
    const g: string[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) g.push(x < 2 ? W : K);
    return g;
  };

  it('returns the whole contiguous same-color region', () => {
    const idxs = floodFill(grid(), cols, rows, 0, 0, R);
    expect(idxs.length).toBe(8); // the 2x4 white block
    // none of the black cells (x>=2) are included
    for (const i of idxs) expect(i % cols).toBeLessThan(2);
  });

  it('does nothing when the target is already the new color', () => {
    expect(floodFill(grid(), cols, rows, 0, 0, W)).toEqual([]);
  });

  it('does not leak across a color boundary (4-connected)', () => {
    const idxs = floodFill(grid(), cols, rows, 3, 3, R);
    expect(idxs.length).toBe(8); // only the black block
    for (const i of idxs) expect(i % cols).toBeGreaterThanOrEqual(2);
  });

  it('does not mutate the input grid', () => {
    const g = grid();
    const copy = [...g];
    floodFill(g, cols, rows, 0, 0, R);
    expect(g).toEqual(copy);
  });
});
