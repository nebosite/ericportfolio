// pitchGraph.ts — the vertical "how flat/sharp am I" graph shown beside the play
// grid and, in a compact form, on the home screen. The pure helpers (meanStd,
// colorForCents, isContinuous) are unit-tested; drawPitchGraph paints a supplied
// 2D context and stays in the manual browser review like the rest of the canvas.

import { midiName, isSharp } from "./notes";

/** Half-width of the graph in cents: the plot spans ±150¢ = three semitones. */
export const GRAPH_CENTS = 150;
/** A 100 ms cents sample this far from the previous one is a discontinuous jump
 *  (octave/harmonic glitch or a slide) and is left out of a note's average. */
export const JUMP_CENTS = 150;
/** Cents off at which the flat/sharp color reaches full saturation. */
const COLOR_CENTS = 70;

const AMBER: RGB = [244, 178, 62]; // exact pitch — the game accent
const TEAL: RGB = [36, 211, 192]; // flat side — vivid teal
const CORAL: RGB = [245, 72, 44]; // sharp side — vivid coral

type RGB = [number, number, number];

export interface GraphBar {
  mean: number; // average cents off pitch (− flat, + sharp)
  std: number; // spread of the (continuous) samples, in cents
}

/** Is `cur` continuous with `prev` (or is `prev` absent)? Used to drop the
 *  discontinuous jumps the spec asks us to ignore when averaging a note. */
export function isContinuous(prev: number | null, cur: number, jump = JUMP_CENTS): boolean {
  return prev == null || Math.abs(cur - prev) <= jump;
}

/** A "nice" round axis step (1/2/5 × 10ⁿ) that yields roughly `ticks` intervals
 *  up to `maxVal`, so an axis stays readable at any score magnitude. */
export function niceAxisStep(maxVal: number, ticks = 5): number {
  const raw = Math.max(1, maxVal) / Math.max(1, ticks);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return nice * mag;
}

/** Mean and standard deviation from running sums (count, Σx, Σx²). */
export function meanStd(cN: number, cSum: number, cSqSum: number): GraphBar {
  if (cN <= 0) return { mean: 0, std: 0 };
  const mean = cSum / cN;
  const variance = cSqSum / cN - mean * mean;
  return { mean, std: Math.sqrt(Math.max(0, variance)) };
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Bar color: amber at exact pitch, fading quickly to a vivid teal (flat) /
 *  coral (sharp), reaching full saturation by COLOR_CENTS. CSS `rgb(...)`. */
export function colorForCents(cents: number): string {
  const t = Math.max(-1, Math.min(1, cents / COLOR_CENTS));
  const c = t <= 0 ? mix(AMBER, TEAL, -t) : mix(AMBER, CORAL, t);
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  r = Math.min(r, h / 2, Math.abs(w) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface PitchGraphOpts {
  W: number;
  H: number;
  dLow: number; // padded pitch domain (bottom), matches the play grid
  dHigh: number; // padded pitch domain (top)
  lo: number; // first note in the singer's range (for labels)
  hi: number; // last note in the singer's range
  bars: Record<number, GraphBar>; // per-midi average/spread
  compact?: boolean; // smaller type for the home-screen copy
  mini?: boolean; // one-octave thumbnail: tightest chrome, no axis caption
}

/** Paint the pitch graph into `ctx`. Shared by the live engine graph and the
 *  home-screen summary so both read identically. */
export function drawPitchGraph(ctx: CanvasRenderingContext2D, opts: PitchGraphOpts): void {
  const { W, H, dLow, dHigh, lo, hi, bars, compact, mini } = opts;
  if (H <= 0 || W <= 0 || dHigh <= dLow) return;

  const gutter = mini ? 21 : compact ? 26 : 32; // left column for note names
  const head = mini ? 14 : compact ? 26 : 30; // top band for the axis labels
  const padR = 6;
  const x0 = gutter;
  const x1 = W - padR;
  const plotW = x1 - x0;
  const cx = (x0 + x1) / 2;
  const span = dHigh - dLow;
  const lane = (H - head) / span;
  const xFor = (c: number) =>
    cx + (Math.max(-GRAPH_CENTS, Math.min(GRAPH_CENTS, c)) / GRAPH_CENTS) * (plotW / 2);
  const yFor = (m: number) => head + (1 - (m - dLow) / span) * (H - head);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#0c0d12";
  ctx.fillRect(0, 0, W, H);

  const smallFont = `${compact || mini ? 8 : 9}px 'Spline Sans Mono', monospace`;

  // Semitone gridlines; the exact-pitch line (0¢) is the strong one.
  for (const c of [-100, 0, 100]) {
    const x = xFor(c);
    ctx.strokeStyle = c === 0 ? "rgba(255,255,255,0.30)" : "rgba(255,255,255,0.07)";
    ctx.lineWidth = c === 0 ? 1.5 : 1;
    ctx.beginPath();
    ctx.moveTo(x, head);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // Axis header: flat/sharp end labels always; the "semitones off" caption and
  // ± numbers only when there's room (the mini thumbnail drops them).
  ctx.font = smallFont;
  ctx.textBaseline = "middle";
  if (!mini) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#6b7180";
    ctx.fillText("semitones off", cx, 9);
    ctx.fillStyle = "#565c6a";
    for (const c of [-100, 0, 100]) {
      const n = c / 100;
      ctx.fillText((n > 0 ? "+" : "") + n, xFor(c), head - 9);
    }
  }
  ctx.textAlign = "left";
  ctx.fillStyle = colorForCents(-100);
  ctx.fillText("flat", x0, mini ? 7 : 9);
  ctx.textAlign = "right";
  ctx.fillStyle = colorForCents(100);
  ctx.fillText("sharp", x1, mini ? 7 : 9);

  // Note names down the left gutter (naturals always; sharps when there's room).
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = smallFont;
  for (let m = lo; m <= hi; m++) {
    if (isSharp(m) && lane < 16) continue;
    ctx.fillStyle = m % 12 === 0 ? "rgba(243,239,230,0.6)" : "rgba(138,144,160,0.5)";
    ctx.fillText(midiName(m), 3, yFor(m));
  }

  // One bar per sung note: centred on the mean, two standard deviations wide,
  // coloured by how flat/sharp the average is. Clamped to the plot area.
  const barH = Math.max(3, Math.min(lane * 0.7, compact ? 9 : 15));
  for (const key in bars) {
    const m = Number(key);
    if (m < dLow || m > dHigh) continue;
    const b = bars[key];
    const y = yFor(m);
    const meanX = xFor(b.mean);
    const halfPx = Math.max(1.5, (b.std / GRAPH_CENTS) * (plotW / 2));
    const left = Math.max(x0, meanX - halfPx);
    const right = Math.min(x1, meanX + halfPx);
    ctx.fillStyle = colorForCents(b.mean);
    roundRect(ctx, left, y - barH / 2, Math.max(3, right - left), barH, Math.min(3, barH / 2));
    ctx.fill();
  }
}
