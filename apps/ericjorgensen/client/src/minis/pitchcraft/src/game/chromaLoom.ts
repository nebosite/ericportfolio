// chromaLoom.ts — pure logic for Chroma Loom (framework-free).
//
// Chroma Loom is a live scrolling spectrogram: every frame one thin slice of
// the microphone's FFT is woven onto the canvas and the fabric scrolls on.
// Pitch runs along the frequency axis (log-spaced, so semitones are evenly
// spaced), brightness is the magnitude of each frequency, and hue sweeps a
// player-tunable rainbow from red (low) to violet (high) — the same order the
// real rainbow orders light. The weave direction is a selectable *pattern*
// (only the left→right ribbon is woven today; the other looms are on order).
//
// This module holds everything unit-testable: the log-frequency mapping, the
// semitone gridline positions, rainbow color-stop interpolation, and the
// FFT-bin → display-row resampling. The canvas/mic work lives in loomEngine.ts.

import { midiHz, hzMidi, midiName, isSharp } from "./notes";

// The loom's pitch span: C2 (65.4 Hz) to C7 (2093 Hz) — five octaves that
// cover every voice range plus whistles, inside the analyser's useful band.
export const LOOM_LO_MIDI = 36; // C2
export const LOOM_HI_MIDI = 96; // C7

// How long a woven slice takes to cross the canvas.
export const SCROLL_SEC = 28;

// getByteFrequencyData bytes are already log-amplitude (dB mapped to 0..255);
// a mild gamma on top keeps the noise floor dark without crushing the voice.
export const INTENSITY_GAMMA = 1.35;

/** Position of a frequency on the loom's log axis: 0 at C2, 1 at C7. */
export function freq01(hz: number): number {
  return (hzMidi(hz) - LOOM_LO_MIDI) / (LOOM_HI_MIDI - LOOM_LO_MIDI);
}

/** Inverse of freq01: the frequency at axis position t (0..1). */
export function hzAt01(t: number): number {
  return midiHz(LOOM_LO_MIDI + t * (LOOM_HI_MIDI - LOOM_LO_MIDI));
}

// ---- semitone gridlines ----

export interface SemitoneLine {
  midi: number;
  t01: number; // position on the frequency axis (0 = C2, 1 = C7)
  natural: boolean; // naturals draw a touch brighter than sharps
  isC: boolean; // octave lines are brightest and carry a label
  label: string; // e.g. "C4"
}

/** One very light gridline per semitone across the loom's span. */
export function semitoneLines(): SemitoneLine[] {
  const lines: SemitoneLine[] = [];
  for (let m = LOOM_LO_MIDI; m <= LOOM_HI_MIDI; m++) {
    lines.push({
      midi: m,
      t01: (m - LOOM_LO_MIDI) / (LOOM_HI_MIDI - LOOM_LO_MIDI),
      natural: !isSharp(m),
      isC: m % 12 === 0,
      label: midiName(m),
    });
  }
  return lines;
}

// ---- the rainbow ----

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// The default key colors, red (low) → violet (high), evenly spaced across the
// frequency axis. The player can retune each stop from the loom's controls.
export const DEFAULT_RAINBOW: readonly string[] = [
  "#ff2d2d", // red
  "#ff8a00", // orange
  "#ffd500", // yellow
  "#2ed573", // green
  "#1e90ff", // blue
  "#5352ed", // indigo
  "#b653f7", // violet
];

/** Parse "#rgb" or "#rrggbb" (case-insensitive). Returns null if malformed. */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

/** The rainbow's color at axis position t (0..1): key stops evenly spaced,
 *  linearly interpolated between neighbours. */
export function rainbowAt(stops: readonly Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0];
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i];
  const b = stops[i + 1];
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
  };
}

/** Parse a list of hex stops, falling back to the default rainbow for any
 *  malformed entry (so a corrupt saved palette can't blank the loom). */
export function parseRainbow(hexes: readonly string[]): Rgb[] {
  const fallback = DEFAULT_RAINBOW.map((h) => hexToRgb(h)!);
  if (hexes.length === 0) return fallback;
  return hexes.map((h, i) => hexToRgb(h) ?? fallback[Math.min(i, fallback.length - 1)]);
}

// ---- FFT → display-row resampling ----

/** Mean of the spectrum (treated as a step function, bin k covering
 *  [k-0.5, k+0.5)) over the fractional bin range [b0, b1]. */
export function bandMean(spectrum: ArrayLike<number>, b0: number, b1: number): number {
  const n = spectrum.length;
  const lo = Math.min(Math.max(b0, -0.5), n - 0.5);
  const hi = Math.min(Math.max(b1, -0.5), n - 0.5);
  if (hi <= lo) {
    const k = Math.min(n - 1, Math.max(0, Math.round((lo + hi) / 2)));
    return spectrum[k];
  }
  let sum = 0;
  const k0 = Math.max(0, Math.floor(lo + 0.5));
  const k1 = Math.min(n - 1, Math.floor(hi + 0.5));
  for (let k = k0; k <= k1; k++) {
    const a = Math.max(lo, k - 0.5);
    const b = Math.min(hi, k + 0.5);
    if (b > a) sum += spectrum[k] * (b - a);
  }
  return sum / (hi - lo);
}

/**
 * Resample one FFT frame into `rows` display intensities (0..1), row 0 at the
 * TOP of the canvas (the highest frequency). Each row averages the fractional
 * FFT-bin band its pixel covers on the log axis, so sparse low-frequency bins
 * interpolate and dense high-frequency bins average rather than alias.
 * `spectrum` is getByteFrequencyData output (0..255, length fftSize/2).
 */
export function buildColumn(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  rows: number,
): Float32Array {
  const out = new Float32Array(rows);
  const binHz = sampleRate / (2 * spectrum.length); // fftSize = 2 * bin count
  const step = 1 / Math.max(1, rows - 1);
  for (let row = 0; row < rows; row++) {
    const t = 1 - row * step; // top row = highest frequency
    const f0 = hzAt01(Math.max(0, t - step / 2)) / binHz;
    const f1 = hzAt01(Math.min(1, t + step / 2)) / binHz;
    const v = bandMean(spectrum, f0, f1) / 255;
    out[row] = Math.pow(Math.min(1, Math.max(0, v)), INTENSITY_GAMMA);
  }
  return out;
}

// ---- weave patterns ----

export type LoomPatternId = "ribbon" | "snail" | "squareSpiral" | "figure8";

export interface LoomPattern {
  id: LoomPatternId;
  label: string;
  detail: string;
  ready: boolean; // only the ribbon is woven today
}

export const PATTERNS: readonly LoomPattern[] = [
  {
    id: "ribbon",
    label: "Ribbon",
    detail: "weaves left to right",
    ready: true,
  },
  {
    id: "snail",
    label: "Snail Shell",
    detail: "spirals from the rim to the middle",
    ready: false,
  },
  {
    id: "squareSpiral",
    label: "Square Spiral",
    detail: "the snail's path, squared off",
    ready: false,
  },
  {
    id: "figure8",
    label: "Figure Eight",
    detail: "sweeps an endless lemniscate",
    ready: false,
  },
];

export function getPattern(id: LoomPatternId): LoomPattern {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];
}
