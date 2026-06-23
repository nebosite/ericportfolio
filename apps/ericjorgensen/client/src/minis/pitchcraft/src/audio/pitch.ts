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

  /** Detected fundamental in Hz, or -1 when no clear pitch / silence. */
  read(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    return autoCorrelate(this.buf, this.analyser.context.sampleRate);
  }
}
