import { describe, it, expect } from "vitest";
import { midiHz } from "./notes";
import {
  centsOff,
  quality,
  accuracyRatio,
  tickPoints,
  VIBRATO_MULTIPLIER,
  VibratoDetector,
} from "./scoring";

describe("centsOff", () => {
  it("is 0 dead-on and signed by direction", () => {
    expect(centsOff(midiHz(69), 69)).toBeCloseTo(0, 6);
    expect(centsOff(midiHz(69) * Math.pow(2, 50 / 1200), 69)).toBeCloseTo(50, 4); // 50¢ sharp
    expect(centsOff(midiHz(69) * Math.pow(2, -50 / 1200), 69)).toBeCloseTo(-50, 4); // 50¢ flat
  });
});

describe("quality thresholds", () => {
  it("scores ⅛/¼/semitone bands and nothing beyond", () => {
    expect(quality(0)).toBe(5);
    expect(quality(25)).toBe(5);
    expect(quality(25.1)).toBe(2);
    expect(quality(50)).toBe(2);
    expect(quality(50.1)).toBe(1);
    expect(quality(100)).toBe(1);
    expect(quality(100.1)).toBe(0);
  });
});

describe("accuracyRatio", () => {
  it("is 1 dead-on, 0 at a semitone, clamped past that", () => {
    expect(accuracyRatio(0)).toBe(1);
    expect(accuracyRatio(50)).toBeCloseTo(0.5, 6);
    expect(accuracyRatio(100)).toBe(0);
    expect(accuracyRatio(200)).toBe(0);
  });
});

describe("tickPoints", () => {
  it("multiplies a scoring tick by 10 only while a vibrato is held", () => {
    expect(tickPoints(10, false)).toBe(5);
    expect(tickPoints(10, true)).toBe(5 * VIBRATO_MULTIPLIER);
    // no points → no bonus, even with vibrato flagged
    expect(tickPoints(150, true)).toBe(0);
  });
});

describe("VibratoDetector", () => {
  it("is inactive with too few samples", () => {
    const v = new VibratoDetector();
    v.push(0, 0);
    v.push(0.1, 10);
    expect(v.active()).toBe(false);
  });

  it("activates for a steady ~6Hz wobble within a semitone of the target", () => {
    const v = new VibratoDetector();
    // ~1.1s of a ±40-cent, 6 Hz oscillation, sampled at 60fps
    for (let i = 0; i <= 66; i++) {
      const t = i / 60;
      v.push(t, 40 * Math.sin(2 * Math.PI * 6 * t));
    }
    expect(v.active()).toBe(true);
  });

  it("does not activate for a held, steady pitch", () => {
    const v = new VibratoDetector();
    for (let i = 0; i <= 66; i++) v.push(i / 60, 5); // basically flat
    expect(v.active()).toBe(false);
  });

  it("resets its window", () => {
    const v = new VibratoDetector();
    for (let i = 0; i <= 66; i++) v.push(i / 60, 40 * Math.sin(2 * Math.PI * 6 * (i / 60)));
    v.reset();
    expect(v.active()).toBe(false);
  });
});
