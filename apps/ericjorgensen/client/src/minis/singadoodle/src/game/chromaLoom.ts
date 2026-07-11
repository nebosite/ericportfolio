// chromaLoom.ts — pure logic for Chroma Loom (framework-free).
//
// Chroma Loom is a live scrolling spectrogram: every frame one thin slice of
// the microphone's FFT is woven onto the canvas and the fabric scrolls on.
// Pitch runs along the frequency axis (log-spaced, so semitones are evenly
// spaced), brightness is the magnitude of each frequency, and hue sweeps a
// player-tunable rainbow from red (low) to violet (high) — the same order the
// real rainbow orders light. The weave direction is a selectable *pattern*:
// the left→right ribbon, the top→bottom waterfall, and fire — the ribbon
// rising as fuzzy Perlin-turbulent particles that flutter, disperse, and turn
// to smoke. The spiral looms (snail shell, square spiral, figure-eight) are
// still on order.
//
// This module holds everything unit-testable: the log-frequency mapping, the
// semitone gridline positions, rainbow color-stop interpolation, the FFT-bin
// → display-slot resampling, the Perlin noise the fire's turbulence samples,
// and the fire particles' life curves. Canvas/mic work lives in loomEngine.ts.

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
 * Resample one FFT frame into `n` display intensities (0..1) along the loom's
 * log-frequency axis, index 0 at the LOWEST frequency. Each slot averages the
 * fractional FFT-bin band its pixel covers on the log axis, so sparse
 * low-frequency bins interpolate and dense high-frequency bins average rather
 * than alias. `spectrum` is getByteFrequencyData output (0..255, fftSize/2).
 */
export function buildStrip(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  n: number,
): Float32Array {
  const out = new Float32Array(n);
  const binHz = sampleRate / (2 * spectrum.length); // fftSize = 2 * bin count
  const step = 1 / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const t = i * step; // index 0 = lowest frequency
    const f0 = hzAt01(Math.max(0, t - step / 2)) / binHz;
    const f1 = hzAt01(Math.min(1, t + step / 2)) / binHz;
    const v = bandMean(spectrum, f0, f1) / 255;
    out[i] = Math.pow(Math.min(1, Math.max(0, v)), INTENSITY_GAMMA);
  }
  return out;
}

/** buildStrip flipped for a vertical frequency axis: row 0 at the TOP of the
 *  canvas (the highest frequency), as the ribbon weaves it. */
export function buildColumn(
  spectrum: ArrayLike<number>,
  sampleRate: number,
  rows: number,
): Float32Array {
  return buildStrip(spectrum, sampleRate, rows).reverse();
}

// ---- Perlin noise (the fire's turbulence) ----

/**
 * Classic improved Perlin 3D noise with a seeded permutation table. Returns a
 * sampler `(x, y, z) => value` in roughly [-1, 1], exactly 0 on the integer
 * lattice, smooth everywhere, and fully deterministic for a given seed — the
 * fire pattern feeds it particle position + time to get organic flutter.
 */
export function createPerlin(seed = 0x51f7ab1e): (x: number, y: number, z: number) => number {
  // Seeded shuffle (mulberry32) of the 0..255 permutation, doubled for wrap.
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let a = seed >>> 0;
  const rnd = (): number => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = perm[i];
    perm[i] = perm[j];
    perm[j] = tmp;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (t: number, p: number, q: number): number => p + t * (q - p);
  const grad = (h: number, x: number, y: number, z: number): number => {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
  };

  return (x: number, y: number, z: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;
    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z)),
        lerp(u, grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z)),
      ),
      lerp(
        v,
        lerp(u, grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1)),
      ),
    );
  };
}

// ---- waterfall physics ----

// The waterfall mimics a real 10-foot drop: the canvas height maps to 10 ft,
// water slips over the crest at river speed and free-falls under gravity, so
// a slice crosses the canvas in ~0.74 s — slow for an instant at the lip,
// then accelerating hard toward the bottom.
export const WATERFALL_DROP_M = 10 * 0.3048; // 10 ft in meters
export const WATERFALL_ENTRY_MPS = 0.5; // river speed at the crest
export const GRAVITY_MPS2 = 9.81;

/** Fall speed in m/s at height fraction y01 (0 = crest, 1 = bottom) of the
 *  10 ft drop: v = √(v₀² + 2g·d). */
export function waterfallVelocityMps(y01: number): number {
  const t = Math.min(1, Math.max(0, y01));
  return Math.sqrt(
    WATERFALL_ENTRY_MPS * WATERFALL_ENTRY_MPS + 2 * GRAVITY_MPS2 * WATERFALL_DROP_M * t,
  );
}

// A slice that reaches the bottom bursts into splash particles that fly out
// in random directions and fade over this long.
export const SPLASH_LIFE_SEC = 2;

/** Exponential convergence: the value at `age` of something that starts at
 *  `from` and settles toward `to` with time constant `tau` (the fire's
 *  initially-random rise rates converge to the scroll rate this way). */
export function converge(from: number, to: number, age: number, tau: number): number {
  return to + (from - to) * Math.exp(-Math.max(0, age) / Math.max(1e-6, tau));
}

// ---- fire shaping ----

// A fire particle's life p (0 = born, 1 = spent) drives two curves: how much
// of it is smoke rather than flame, and how much of it is left to see. The
// decay is deliberately gentle so a particle born at the base is still faintly
// visible when its ~SCROLL_SEC rise carries it to the top of the canvas.

/** 0 = pure flame, 1 = pure smoke: flame holds through the first quarter of
 *  life, then turns to smoke by 60%. */
export function smokeMix01(p: number): number {
  return Math.min(1, Math.max(0, (p - 0.25) / (0.6 - 0.25)));
}

/** Overall visibility over life: 1 at birth, easing to 0 exactly at p = 1. */
export function emberAlpha(p: number): number {
  const q = 1 - Math.min(1, Math.max(0, p));
  return Math.pow(q, 1.2);
}

// ---- weave patterns ----

export type LoomPatternId = "ribbon" | "waterfall" | "fire" | "snail" | "squareSpiral" | "figure8";

export interface LoomPattern {
  id: LoomPatternId;
  label: string;
  detail: string;
  ready: boolean; // the spiral looms are still on order
}

export const PATTERNS: readonly LoomPattern[] = [
  {
    id: "ribbon",
    label: "Ribbon",
    detail: "weaves left to right",
    ready: true,
  },
  {
    id: "waterfall",
    label: "Waterfall",
    detail: "weaves top to bottom",
    ready: true,
  },
  {
    id: "fire",
    label: "Fire",
    detail: "rises, flutters, and turns to smoke",
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
