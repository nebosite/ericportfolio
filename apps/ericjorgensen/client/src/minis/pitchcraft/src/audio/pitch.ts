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

export class PitchAnalyser {
  readonly analyser: AnalyserNode;
  private buf: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, source: AudioNode, fftSize = 2048) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = fftSize;
    this.analyser.smoothingTimeConstant = 0;
    source.connect(this.analyser);
    this.buf = new Float32Array(fftSize);
  }

  /**
   * Detected fundamental in Hz, or -1 when no clear pitch / silence.
   * Pass `cancelHz` to subtract a known reference tone before detection.
   */
  read(cancelHz?: number): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    if (cancelHz != null && cancelHz > 0)
      subtractTone(this.buf, this.analyser.context.sampleRate, cancelHz);
    return autoCorrelate(this.buf, this.analyser.context.sampleRate);
  }
}
