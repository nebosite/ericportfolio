// pitch.ts — microphone pitch detection (framework-free)
//
// autoCorrelate() finds the fundamental frequency of a time-domain buffer using
// autocorrelation with parabolic interpolation and an RMS silence gate. Tuned for
// the singing voice and clamped to 70–1200 Hz (covers Bass E2 up to Soprano C6).
//
// PitchAnalyser wraps a Web Audio AnalyserNode so you can read one pitch per frame.

export function autoCorrelate(buf: Float32Array, sampleRate: number): number {
  const N = buf.length;
  let rms = 0;
  for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N);
  if (rms < 0.012) return -1; // too quiet → treat as silence

  // Trim leading/trailing low-amplitude samples to stabilise the correlation.
  let r1 = 0,
    r2 = N - 1;
  const th = 0.2;
  for (let i = 0; i < N / 2; i++)
    if (Math.abs(buf[i]) < th) {
      r1 = i;
      break;
    }
  for (let i = 1; i < N / 2; i++)
    if (Math.abs(buf[N - i]) < th) {
      r2 = N - i;
      break;
    }

  const b = buf.slice(r1, r2);
  const M = b.length;
  const c = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    let s = 0;
    for (let j = 0; j < M - i; j++) s += b[j] * b[j + i];
    c[i] = s;
  }

  // Walk past the initial downslope, then find the highest peak.
  let d = 0;
  while (d < M - 1 && c[d] > c[d + 1]) d++;
  let max = -1,
    pos = -1;
  for (let i = d; i < M; i++)
    if (c[i] > max) {
      max = c[i];
      pos = i;
    }
  if (pos <= 0) return -1;

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const x1 = c[pos - 1],
    x2 = c[pos],
    x3 = c[pos + 1] || x2;
  const a = (x1 + x3 - 2 * x2) / 2;
  const bb = (x3 - x1) / 2;
  let T = pos;
  if (a) T = pos - bb / (2 * a);

  const f = sampleRate / T;
  return f > 70 && f < 1200 ? f : -1;
}

/**
 * Removes the sinusoidal component at `hz` from `buf` in-place.
 *
 * Uses a least-squares fit (solves the 2×2 Gram-matrix system) so the
 * cancellation is exact even when the buffer doesn't contain a whole number
 * of cycles at `hz` (i.e. the rectangular-window DFT bins don't align).
 * A running phasor avoids per-sample trig. Because amplitude and phase are
 * estimated from the mic signal itself, the cancellation is accurate
 * regardless of acoustic delay — which makes it effective for removing a
 * reference tone that has leaked back into the microphone.
 */
export function subtractTone(
  buf: Float32Array,
  sampleRate: number,
  hz: number,
): void {
  const N = buf.length;
  const omega = (2 * Math.PI * hz) / sampleRate;
  const cosStep = Math.cos(omega);
  const sinStep = Math.sin(omega);

  // First pass: accumulate the 2×2 Gram matrix (C) and RHS (d).
  let d1 = 0,
    d2 = 0,
    C11 = 0,
    C12 = 0,
    C22 = 0;
  let c = 1,
    s = 0;
  for (let i = 0; i < N; i++) {
    d1 += buf[i] * c;
    d2 += buf[i] * s;
    C11 += c * c;
    C12 += c * s;
    C22 += s * s;
    const nc = c * cosStep - s * sinStep;
    s = s * cosStep + c * sinStep;
    c = nc;
  }

  // Solve [C11 C12; C12 C22] * [a; b] = [d1; d2].
  const det = C11 * C22 - C12 * C12;
  if (Math.abs(det) < 1e-10) return;
  const a = (C22 * d1 - C12 * d2) / det;
  const b = (-C12 * d1 + C11 * d2) / det;

  // Second pass: subtract the LS-optimal sinusoidal fit.
  c = 1;
  s = 0;
  for (let i = 0; i < N; i++) {
    buf[i] -= a * c + b * s;
    const nc = c * cosStep - s * sinStep;
    s = s * cosStep + c * sinStep;
    c = nc;
  }
}

/* ------------------------------------------------------------------------ *
 * Harmonic-set pitch detection
 *
 * A sung or hummed note is harmonic-rich: energy at f0, 2·f0, 3·f0, …  The
 * detector works the way you'd read the spectrum by eye:
 *
 *  1. Find the peaks that stand out from the background (the noise floor is the
 *     median bin magnitude, not the loudest bin, so one dominant tone doesn't
 *     bury the rest), and above 5 % of the strongest peak so background is
 *     rejected. A peak must dominate its ±40 Hz neighborhood so one messy,
 *     bell-shaped lobe counts once. Peaks are kept strongest-first, ≥ 8 of them.
 *     The strongest peak above 100 Hz is a best-guess fallback.
 *  2. Find the LARGEST set of those peaks related by harmonic intervals (all
 *     near integer multiples of a common fundamental); aim for ≥ 3. If none is
 *     found, loosen the peak criteria and pull in 4 more peaks, up to two more
 *     tries.
 *  3. If a set is found, f0/f1/f2 are its first/second/third peaks.
 *  4. If not, f0 is the best-guess peak and f1/f2 are its expected harmonics.
 *
 * Jump smoothing (applied per-frame in PitchAnalyser, see smoothJump): if f0
 * leaps more than 10 semitones from the last reported value, the report only
 * moves 10 % of the way there, so a one-frame octave glitch can't whip the
 * pitch around.
 *
 * NOTE: f0 is the lowest peak of the set. subtractTone() cancels the singer's
 * own fundamental while they are on-pitch, which can leave the 2nd harmonic as
 * the lowest peak (an octave-high read). The markers drawn on the live spectrum
 * make that visible.
 * ------------------------------------------------------------------------ */

// In-place iterative radix-2 Cooley–Tukey FFT; length must be a power of two.
function fftRadix2(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const FFT_N = 8192; // zero-padded length → fine spectral interpolation
let scratchRe: Float32Array | null = null;
let scratchIm: Float32Array | null = null;

interface SpectralPeak {
  f: number; // interpolated frequency (Hz)
  m: number; // peak amplitude
}

const SEARCH_HZ = 4000; // search peaks past 2400 so 3 harmonics fit for high notes
const MERGE_HZ = 40; // a peak must dominate ±this; rejects window side lobes
const HARMONIC_TOL = 0.04; // a peak counts as harmonic h if within 4 % of h·f0

// Noise-floor cutoff as a fraction of the strongest peak. Scales with the
// signal, so a quiet low note isn't lost the way a fixed amplitude cutoff would
// lose it. Raise to be stricter about background, lower to catch fainter peaks.
export const PEAK_CUTOFF_FRAC = 0.05;

export interface VoicePitch {
  f0: number; // reported fundamental (Hz) — used for scoring
  f1: number; // 2nd harmonic marker (detected, or 2·f0 when guessing)
  f2: number; // 3rd harmonic marker (detected, or 3·f0 when guessing)
  confident: boolean; // true = a harmonic set was found; false = best-guess
}

/**
 * Peaks above `thresh` that dominate their ±MERGE_HZ neighborhood, strongest
 * first. The windowed-max test treats one bell-shaped lobe (and its window side
 * lobes) as a single peak, while still resolving harmonics, which sit ≥ 70 Hz
 * apart. Sub-bin frequency comes from parabolic interpolation of the apex.
 */
function findPeaks(
  mag: Float32Array,
  binHz: number,
  minK: number,
  maxK: number,
  thresh: number,
): SpectralPeak[] {
  const win = Math.max(1, Math.round(MERGE_HZ / binHz));
  const hiBound = maxK + 1;
  const peaks: SpectralPeak[] = [];
  for (let k = minK; k <= maxK; k++) {
    const v = mag[k];
    if (v <= thresh || v < mag[k - 1] || v < mag[k + 1]) continue;
    let isMax = true;
    const lo = Math.max(0, k - win);
    const hi = Math.min(hiBound, k + win);
    for (let j = lo; j <= hi; j++) {
      if (j !== k && mag[j] > v) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const a = mag[k - 1];
    const c = mag[k + 1];
    const d = a - 2 * v + c;
    const delta = d !== 0 ? (0.5 * (a - c)) / d : 0; // parabolic sub-bin
    peaks.push({ f: (k + delta) * binHz, m: v });
    if (k + 1 < hi) k = k + 1; // already know the next bin can't be a new peak
  }
  peaks.sort((p, q) => q.m - p.m); // strongest first
  return peaks;
}

/**
 * Largest subset of `peaks` whose frequencies are near-integer multiples of a
 * common fundamental, returned sorted by frequency. Ties prefer the larger
 * fundamental (so f0 and not f0/2 explains the same peaks). Null if no set of
 * three or more is found.
 */
function findHarmonicSet(peaks: SpectralPeak[]): SpectralPeak[] | null {
  if (peaks.length < 3) return null;

  // Candidate fundamentals: each peak read as harmonic 1..4.
  const cands: number[] = [];
  for (const p of peaks)
    for (let d = 1; d <= 4; d++) {
      const c = p.f / d;
      if (c >= 70) cands.push(c);
    }
  cands.sort((a, b) => b - a); // descending → ties keep the larger fundamental

  let best: SpectralPeak[] | null = null;
  let bestCount = 0;
  let bestStrength = 0;
  for (const f0c of cands) {
    const members: SpectralPeak[] = [];
    const used = new Set<number>();
    for (const p of peaks) {
      // peaks are strongest-first, so a slot is claimed by its strongest peak
      const h = Math.round(p.f / f0c);
      if (h < 1 || h > 12 || used.has(h)) continue;
      if (Math.abs(p.f - h * f0c) <= HARMONIC_TOL * h * f0c) {
        used.add(h);
        members.push(p);
      }
    }
    if (members.length < 3) continue;
    const strength = members.reduce((s, p) => s + p.m, 0);
    if (
      members.length > bestCount ||
      (members.length === bestCount && strength > bestStrength)
    ) {
      bestCount = members.length;
      bestStrength = strength;
      best = members;
    }
  }
  if (!best) return null;
  best.sort((a, b) => a.f - b.f);
  return best;
}

/**
 * Damp octave-sized glitches: if `next` jumps more than 10 semitones from
 * `last`, report only 10 % of the way (in log-frequency) toward it.
 */
export function smoothJump(last: number, next: number): number {
  if (last <= 0 || next <= 0) return next;
  const semis = Math.abs(12 * Math.log2(next / last));
  if (semis <= 10) return next;
  return last * Math.pow(next / last, 0.1);
}

/**
 * Detect the vocal pitch from a time-domain buffer, or null for silence.
 * Returns the fundamental plus the next two harmonic markers (see block
 * comment above for the algorithm).
 */
export function detectVoicePitch(
  buf: Float32Array,
  sampleRate: number,
): VoicePitch | null {
  const N0 = buf.length;
  let rms = 0;
  for (let i = 0; i < N0; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / N0);
  if (rms < 0.01) return null; // silence

  if (!scratchRe || scratchRe.length !== FFT_N) {
    scratchRe = new Float32Array(FFT_N);
    scratchIm = new Float32Array(FFT_N);
  }
  const re = scratchRe;
  const im = scratchIm as Float32Array;
  re.fill(0);
  im.fill(0);

  // Hann window the (tone-subtracted) buffer into the zero-padded FFT input.
  const wDen = N0 - 1;
  for (let i = 0; i < N0; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / wDen);
    re[i] = buf[i] * w;
  }
  fftRadix2(re, im);

  const half = FFT_N >> 1;
  const binHz = sampleRate / FFT_N;
  const minK = Math.max(1, Math.floor(70 / binHz));
  const maxK = Math.min(half - 2, Math.ceil(SEARCH_HZ / binHz));

  // Magnitude spectrum over the search band (plus one guard bin each side).
  const mag = new Float32Array(maxK + 2);
  for (let k = minK - 1; k <= maxK + 1; k++) mag[k] = Math.hypot(re[k], im[k]);

  // Noise floor = median magnitude (robust to a few dominant peaks).
  const slice = Array.from(mag.slice(minK, maxK + 1)).sort((a, b) => a - b);
  const floor = slice[slice.length >> 1] || 0;
  let gmax = 0;
  for (let k = minK; k <= maxK; k++) if (mag[k] > gmax) gmax = mag[k];
  if (gmax <= 0) return null;

  // Reject anything below 5 % of the strongest peak as background. Because it
  // tracks the loudest peak, a quiet low note keeps its harmonics instead of
  // them falling under a fixed amplitude floor.
  const magCutoff = gmax * PEAK_CUTOFF_FRAC;

  // Three passes, each more generous about what counts as a peak, pulling in
  // 4 more peaks for the candidate set each time. The 5 %-of-max cutoff always
  // applies on top of the relative (median-based) threshold.
  const passes = [
    { mult: 4, count: 8 },
    { mult: 2.5, count: 12 },
    { mult: 1.5, count: 16 },
  ];
  let guess = -1;
  for (let t = 0; t < passes.length; t++) {
    const thresh = Math.max(floor * passes[t].mult, magCutoff);
    const peaks = findPeaks(mag, binHz, minK, maxK, thresh);
    if (t === 0) {
      for (const p of peaks)
        if (p.f > 100) {
          guess = p.f; // strongest peak above 100 Hz
          break;
        }
    }
    const set = findHarmonicSet(peaks.slice(0, passes[t].count));
    if (set && set.length >= 3) {
      const f0 = Math.min(1200, Math.max(70, set[0].f));
      return { f0, f1: set[1].f, f2: set[2].f, confident: true };
    }
  }

  // No harmonic set: fall back to the best-guess peak and its expected partials.
  if (guess > 0) {
    const f0 = Math.min(1200, Math.max(70, guess));
    return { f0, f1: f0 * 2, f2: f0 * 3, confident: false };
  }
  return null;
}

export class PitchAnalyser {
  readonly analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;
  private lastF0 = -1; // for jump smoothing across frames

  constructor(ctx: AudioContext, source: AudioNode, fftSize = 2048) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.buf = new Float32Array(fftSize);
  }

  /**
   * Detect the vocal pitch this frame, or null for silence. Returns the
   * fundamental plus the next two harmonic markers. Pass `cancelHz` to subtract
   * a known reference tone before detection. f0 is jump-smoothed across frames
   * (see smoothJump); a silent frame resets the smoother so the next note reads
   * directly.
   */
  read(cancelHz?: number): VoicePitch | null {
    this.analyser.getFloatTimeDomainData(this.buf);
    if (cancelHz != null && cancelHz > 0)
      subtractTone(this.buf, this.analyser.context.sampleRate, cancelHz);
    const r = detectVoicePitch(this.buf, this.analyser.context.sampleRate);
    if (!r) {
      this.lastF0 = -1;
      return null;
    }
    r.f0 = smoothJump(this.lastF0, r.f0);
    this.lastF0 = r.f0;
    return r;
  }
}
