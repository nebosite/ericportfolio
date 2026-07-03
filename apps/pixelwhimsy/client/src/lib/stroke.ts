// Stroke interpolation for PixelWhimsy painting. Pointer events arrive sparsely
// (and skip when the cursor moves fast), so painting only at each raw sample
// leaves blank gaps and hard angles. This module turns a run of cursor samples
// into a dense, gap-free path of toy-pixel cells:
//
//   1. A centripetal Catmull-Rom spline smooths the path. Its tangents come from
//      the neighbouring sample positions — i.e. the cursor's velocity — so the
//      curve bends naturally through frenetic movement instead of cornering
//      sharply. Centripetal parameterisation (alpha = 0.5) is the variant that
//      never forms cusps or self-intersecting loops, so it stays clean.
//   2. The spline is sampled finely and rasterised to integer cells, bridging
//      any remaining gap with a straight line, so the cursor advances no more
//      than one toy pixel at a time and the stroke is unbroken.
//
// Pure and framework-free so it can be unit tested away from the canvas.

export interface Pt {
  x: number;
  y: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Pt, b: Pt, wa: number, wb: number): Pt => ({
  x: a.x * wa + b.x * wb,
  y: a.y * wa + b.y * wb,
});

/**
 * Integer cells along the straight line from (x0,y0) to (x1,y1) via Bresenham,
 * EXCLUDING the start cell (it was already painted). 8-connected, so the result
 * is contiguous — consecutive cells are always touching.
 */
export function lineCells(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  let guard = dx + dy + 2; // never loop forever on bad input
  while ((x !== x1 || y !== y1) && guard-- > 0) {
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
    out.push([x, y]);
  }
  return out;
}

/** Sample the centripetal Catmull-Rom segment from p1 to p2 (p0,p3 set tangents). */
function sampleSegment(p0: Pt, p1: Pt, p2: Pt, p3: Pt, samples: number): Pt[] {
  const ALPHA = 0.5;
  // Knot times; the epsilon keeps coincident/duplicated points from dividing by 0.
  const knot = (t: number, a: Pt, b: Pt) => t + Math.max(Math.pow(dist(a, b), ALPHA), 1e-4);
  const t0 = 0;
  const t1 = knot(t0, p0, p1);
  const t2 = knot(t1, p1, p2);
  const t3 = knot(t2, p2, p3);

  const out: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = t1 + ((t2 - t1) * i) / samples;
    const a1 = mix(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
    const a2 = mix(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
    const a3 = mix(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
    const b1 = mix(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
    const b2 = mix(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
    out.push(mix(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1)));
  }
  return out;
}

/**
 * The contiguous run of integer cells the brush should paint as the cursor
 * travels from `p1` to `p2`, smoothed by a centripetal Catmull-Rom spline whose
 * shape is guided by the neighbouring samples `p0` (before) and `p3` (after) —
 * the local velocity. Points are in toy-pixel-cell coordinates (fractional ok).
 *
 * Excludes `p1`'s own cell (already painted on the previous step). Consecutive
 * returned cells are always touching (≤ 1 cell apart), so the stroke never skips.
 */
export function strokeCells(p0: Pt, p1: Pt, p2: Pt, p3: Pt): Array<[number, number]> {
  // Oversample relative to the chord so even a curved segment steps well under a
  // cell each sample; the Bresenham bridge covers anything that slips through.
  const samples = Math.max(2, Math.ceil(dist(p1, p2) * 4));
  const pts = sampleSegment(p0, p1, p2, p3, samples);

  const cells: Array<[number, number]> = [];
  let lx = Math.floor(pts[0].x);
  let ly = Math.floor(pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    const cx = Math.floor(pts[i].x);
    const cy = Math.floor(pts[i].y);
    if (cx === lx && cy === ly) continue;
    for (const cell of lineCells(lx, ly, cx, cy)) cells.push(cell);
    lx = cx;
    ly = cy;
  }
  return cells;
}
