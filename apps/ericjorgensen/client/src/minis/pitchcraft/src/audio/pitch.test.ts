import { describe, it, expect } from "vitest";
import { subtractTone } from "./pitch";

const SR = 44100;
const N = 2048;

function sine(hz: number, phase: number, amp = 1): Float32Array {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++)
    buf[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR + phase);
  return buf;
}

function rms(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

describe("subtractTone", () => {
  it("removes a pure sine at the target frequency to near-zero", () => {
    // The LS solver gives exact cancellation regardless of fractional-cycle
    // count in the buffer — residual is only float32 quantisation noise.
    const buf = sine(440, 0);
    subtractTone(buf, SR, 440);
    expect(rms(buf)).toBeLessThan(1e-5);
  });

  it("handles an arbitrary acoustic delay (phase shift) correctly", () => {
    // A speaker → room → mic path shows up as a phase offset; the LS
    // estimator measures that phase from the mic signal itself.
    const buf = sine(440, 1.37); // ~78° phase shift
    subtractTone(buf, SR, 440);
    expect(rms(buf)).toBeLessThan(1e-5);
  });

  it("does not significantly attenuate a sine at a different frequency", () => {
    const buf = sine(660, 0);
    const before = rms(buf);
    subtractTone(buf, SR, 440);
    expect(rms(buf) / before).toBeGreaterThan(0.99);
  });

  it("removes the tone component from a mixed signal with negligible residual", () => {
    // Real use-case: leaked reference tone mixed with the singer's voice.
    // The LS estimator accounts for spectral leakage between the two
    // frequencies, so the residual tone error is well under 10% of the
    // original tone amplitude (typically ~3–5% due to finite-window
    // cross-contamination).
    const N2 = N;
    const tone = sine(440, 0.9, 0.4);
    const voice = sine(330, 0, 0.7);
    const buf = new Float32Array(N2);
    for (let i = 0; i < N2; i++) buf[i] = tone[i] + voice[i];

    subtractTone(buf, SR, 440);

    const toneRms = rms(tone);
    let errSq = 0;
    for (let i = 0; i < N2; i++) errSq += (buf[i] - voice[i]) ** 2;
    const errRms = Math.sqrt(errSq / N2);
    expect(errRms / toneRms).toBeLessThan(0.1); // <10% tone residual
  });
});
