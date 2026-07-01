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

export const CELL = 10; // one toy pixel = 10x10 real pixels (desktop)
export const CELL_MOBILE = 6; // smaller toy pixels on phones/tablets
export const TOOLBAR = 50; // left strip reserved for tool icons
export const COLORBAR = 50; // top strip reserved for color picking

// Brush diameters as a fraction of the grid's longest edge: the big brush spans
// ~10% of the screen, the medium ~5% — so both stay proportional to the canvas.
const BRUSH_DIAMETER_FRAC: Partial<Record<Brush, number>> = {
  round20: 0.1,
  round5: 0.05,
};

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
 * Brush radius in cells, scaled to the grid. Round brushes span a fraction of
 * the longest edge (big ~10%, medium ~5%) as their diameter, so they stay
 * proportional to the screen; single/fill are a single cell. Never below 1.
 */
export function brushRadius(brush: Brush, cols = 0, rows = 0): number {
  const frac = BRUSH_DIAMETER_FRAC[brush];
  if (!frac) return 0; // single / fill
  const longest = Math.max(cols, rows);
  return Math.max(1, Math.round((longest * frac) / 2));
}

/**
 * Cell offsets (relative to the cursor cell) a brush paints. Round brushes
 * include every cell whose center is within the brush radius (see brushRadius).
 */
export function brushOffsets(
  brush: Brush,
  cols = 0,
  rows = 0,
): Array<[number, number]> {
  const r = brushRadius(brush, cols, rows);
  if (r <= 0) return [[0, 0]];
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
 * 4-connected flood fill over the indexed pixel buffer. Returns the cell indices
 * of the contiguous same-value region containing (x, y) — i.e. the cells to
 * recolor. Does not mutate `grid`. Empty if the target is already `newColor`
 * (pass a value no cell can hold, e.g. -1, to force a fill regardless).
 */
export function floodFill(
  grid: ArrayLike<number>,
  cols: number,
  rows: number,
  x: number,
  y: number,
  newColor: number,
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
