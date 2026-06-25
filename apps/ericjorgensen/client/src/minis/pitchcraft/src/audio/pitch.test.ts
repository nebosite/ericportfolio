import { describe, it, expect } from "vitest";
import { subtractTone, detectVoicePitch, smoothJump } from "./pitch";

const SR = 44100;
const N = 2048;

/** Build a harmonic-rich tone: amps[0]=fundamental, amps[1]=2nd harmonic, … */
function voice(f0: number, amps: number[], phase = 0): Float32Array {
  const b = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let h = 0; h < amps.length; h++)
      s += amps[h] * Math.sin((2 * Math.PI * f0 * (h + 1) * i) / SR + phase);
    b[i] = s;
  }
  return b;
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

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

describe("detectVoicePitch", () => {
  it("finds the fundamental of a harmonic-rich tone", () => {
    const r = detectVoicePitch(voice(220, [1, 0.6, 0.4, 0.2]), SR);
    expect(r).not.toBeNull();
    expect(r!.confident).toBe(true);
    expect(Math.abs(cents(r!.f0, 220))).toBeLessThan(15);
  });

  it("reports the first three harmonics as f0/f1/f2", () => {
    const r = detectVoicePitch(voice(150, [1, 0.8, 0.6, 0.4]), SR);
    expect(r).not.toBeNull();
    expect(Math.abs(cents(r!.f0, 150))).toBeLessThan(15);
    expect(Math.abs(cents(r!.f1, 300))).toBeLessThan(15);
    expect(Math.abs(cents(r!.f2, 450))).toBeLessThan(15);
  });

  it("finds the fundamental even when it is the weaker peak", () => {
    // A hummed note often has a 2nd harmonic louder than its fundamental.
    const r = detectVoicePitch(voice(180, [0.4, 1, 0.6]), SR);
    expect(r).not.toBeNull();
    expect(Math.abs(cents(r!.f0, 180))).toBeLessThan(20);
  });

  it("locks to the voice, not a loud off-key tone with no harmonics", () => {
    // Voice at 220 (+ harmonics) plus a strong lone tone at 277 Hz (off-key,
    // not harmonically related): the harmonic set is the voice's, so f0 ≈ 220.
    const b = voice(220, [1, 0.6, 0.4]);
    for (let i = 0; i < N; i++)
      b[i] += 1.2 * Math.sin((2 * Math.PI * 277 * i) / SR);
    const r = detectVoicePitch(b, SR);
    expect(r).not.toBeNull();
    expect(Math.abs(cents(r!.f0, 220))).toBeLessThan(25);
  });

  it("reports the lowest present harmonic when the fundamental is missing", () => {
    // By design f0 is the first peak of the set. With the fundamental absent
    // (e.g. cancelled by subtractTone when on-pitch) the lowest peak is 2·f0,
    // so this reads an octave high — the spectrum markers make that visible.
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++)
      b[i] =
        1.0 * Math.sin((2 * Math.PI * 400 * i) / SR) +
        0.6 * Math.sin((2 * Math.PI * 600 * i) / SR) +
        0.3 * Math.sin((2 * Math.PI * 800 * i) / SR);
    const r = detectVoicePitch(b, SR);
    expect(r).not.toBeNull();
    expect(Math.abs(cents(r!.f0, 400))).toBeLessThan(20);
  });

  it("falls back to a best guess for a lone tone (low confidence)", () => {
    // A single tone forms no harmonic set, so detection reports the strongest
    // peak as a best guess and flags it as not confident. (Anti-cheat against
    // the reference tone is handled upstream by subtractTone + the RMS gate.)
    const b = new Float32Array(N);
    for (let i = 0; i < N; i++)
      b[i] = 0.5 * Math.sin((2 * Math.PI * 330 * i) / SR);
    const r = detectVoicePitch(b, SR);
    expect(r).not.toBeNull();
    expect(r!.confident).toBe(false);
    expect(Math.abs(cents(r!.f0, 330))).toBeLessThan(25);
  });

  it("returns null for silence", () => {
    expect(detectVoicePitch(new Float32Array(N), SR)).toBeNull();
  });

  it("detects a quiet low note (cutoff scales with the loudest peak)", () => {
    // Low pitch, low absolute level — a fixed amplitude floor would drop the
    // weaker harmonics, but the 5 %-of-max cutoff keeps them, so the set holds.
    const r = detectVoicePitch(voice(220, [0.04, 0.025, 0.018]), SR);
    expect(r).not.toBeNull();
    expect(r!.confident).toBe(true);
    expect(Math.abs(cents(r!.f0, 220))).toBeLessThan(15);
  });

  it("drops a peak weaker than 5% of the strongest", () => {
    // The 3rd harmonic at 2% of the fundamental is below the cutoff, so only
    // two peaks survive — too few for a set, leaving a low-confidence guess.
    const r = detectVoicePitch(voice(220, [1, 0.8, 0.02]), SR);
    expect(r).not.toBeNull();
    expect(r!.confident).toBe(false);
  });
});

describe("smoothJump", () => {
  it("passes small changes through unchanged", () => {
    expect(smoothJump(220, 233)).toBe(233); // ~1 semitone
    expect(smoothJump(220, 330)).toBe(330); // ~7 semitones, still under 10
  });

  it("damps a >10-semitone jump to 10% of the way (log scale)", () => {
    const out = smoothJump(220, 880); // +24 semitones
    expect(out).toBeCloseTo(220 * Math.pow(4, 0.1), 3);
    // the reported jump is only ~2.4 semitones, far short of the 24 asked
    expect(Math.abs(cents(out, 220)) / 100).toBeLessThan(3);
  });

  it("returns the new value when there is no prior value", () => {
    expect(smoothJump(-1, 440)).toBe(440);
  });
});
