// Pure paint logic for PixelWhimsy — grid sizing, brush shapes, and flood fill.
// Kept framework-free so the rules can be unit tested away from the canvas.

export const BLANK = '#ffffff';

// 16 bright, child-friendly crayon colors.
export const PALETTE = [
  '#ff3b3b', // cherry red
  '#ff8a3b', // orange pop
  '#ffd93d', // sunshine yellow
  '#b6e62e', // lime fizz
  '#4cc94c', // grass green
  '#2ec9a7', // mermaid teal
  '#3bc2ff', // sky blue
  '#2e6ee6', // crayon blue
  '#7b5ee6', // grape
  '#b03be6', // magic purple
  '#ff6fa5', // bubblegum pink
  '#a65a2e', // teddy-bear brown
  '#000000', // midnight black
  '#7a7a8c', // robot gray
  '#ffffff', // cloud white (eraser!)
  '#ffe0c2', // peach
];

export type Brush = 'single' | 'round5' | 'round20' | 'fill';

export const CELL = 10; // one toy pixel = 10x10 real pixels
export const TOOLBAR = 50; // left strip reserved for tool icons
export const COLORBAR = 50; // top strip reserved for color picking

export interface GridDims {
  cols: number;
  rows: number;
  cellSize: number;
}

/** Grid that fills the drawing area (viewport minus the tool/color strips). */
export function gridSize(
  viewW: number,
  viewH: number,
  toolbar = TOOLBAR,
  colorbar = COLORBAR,
  cell = CELL,
): GridDims {
  return {
    cols: Math.max(1, Math.floor((viewW - toolbar) / cell)),
    rows: Math.max(1, Math.floor((viewH - colorbar) / cell)),
    cellSize: cell,
  };
}

/**
 * Cell offsets (relative to the cursor cell) a brush paints. Round brushes
 * include every cell whose center is within the brush radius.
 */
export function brushOffsets(brush: Brush): Array<[number, number]> {
  if (brush === 'single' || brush === 'fill') return [[0, 0]];
  const r = brush === 'round5' ? 2 : 10; // 5x5 ≈ d5, 20x20 ≈ d21
  const limit = (r + 0.5) * (r + 0.5);
  const out: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= limit) out.push([dx, dy]);
    }
  }
  return out;
}

/**
 * 4-connected flood fill. Returns the indices of every cell in the contiguous
 * same-color region containing (x, y) — i.e. the cells to recolor. Does not
 * mutate `grid`. Empty if the target is already `newColor`.
 */
export function floodFill(
  grid: readonly string[],
  cols: number,
  rows: number,
  x: number,
  y: number,
  newColor: string,
): number[] {
  const start = y * cols + x;
  const target = grid[start];
  if (target === undefined || target === newColor) return [];

  const out: number[] = [];
  const seen = new Uint8Array(cols * rows);
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const idx = stack.pop()!;
    out.push(idx);
    const cx = idx % cols;
    const cy = (idx - cx) / cols;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (!seen[ni] && grid[ni] === target) {
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return out;
}
