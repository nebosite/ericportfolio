import { describe, it, expect } from "vitest";
import { isContinuous, meanStd, colorForCents, niceAxisStep } from "./pitchGraph";

describe("isContinuous", () => {
  it("accepts the first sample and small steps, rejects big jumps", () => {
    expect(isContinuous(null, 500)).toBe(true); // no previous → always start
    expect(isContinuous(0, 40)).toBe(true); // small step
    expect(isContinuous(0, 150)).toBe(true); // exactly the default threshold
    expect(isContinuous(0, 151)).toBe(false); // just over
    expect(isContinuous(-10, 1200)).toBe(false); // octave glitch
  });

  it("honors a custom jump threshold", () => {
    expect(isContinuous(0, 80, 50)).toBe(false);
    expect(isContinuous(0, 40, 50)).toBe(true);
  });
});

describe("meanStd", () => {
  it("returns zeros when there are no samples", () => {
    expect(meanStd(0, 0, 0)).toEqual({ mean: 0, std: 0 });
  });

  it("computes mean and standard deviation from running sums", () => {
    // samples [10, 20]: Σ=30, Σ²=500 → mean 15, variance 25, std 5
    const { mean, std } = meanStd(2, 30, 500);
    expect(mean).toBe(15);
    expect(std).toBeCloseTo(5, 6);
  });

  it("never returns a negative variance from float error", () => {
    // constant samples: variance is exactly 0, std 0 (no NaN from sqrt of −ε)
    const { std } = meanStd(3, 30, 300);
    expect(std).toBeCloseTo(0, 9);
  });
});

describe("niceAxisStep", () => {
  it("picks a round 1/2/5×10ⁿ step giving ~5 intervals at any magnitude", () => {
    // ~5 ticks: step should land the axis within a few intervals of maxVal
    for (const max of [10, 90, 480, 2400, 53000, 1_200_000]) {
      const step = niceAxisStep(max, 5);
      const ticks = Math.ceil(max / step);
      expect(ticks).toBeGreaterThanOrEqual(2);
      expect(ticks).toBeLessThanOrEqual(10); // never the dozens/hundreds we had before
      // step is a 1/2/5 multiple of a power of ten
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step)));
      expect([1, 2, 5, 10]).toContain(Math.round(mantissa));
    }
  });

  it("stays positive for tiny or zero maxima", () => {
    expect(niceAxisStep(0, 5)).toBeGreaterThan(0);
  });
});

describe("colorForCents", () => {
  it("is amber at exact pitch", () => {
    expect(colorForCents(0)).toBe("rgb(244, 178, 62)");
  });

  it("reaches vivid teal when flat and vivid coral when sharp", () => {
    expect(colorForCents(-100)).toBe("rgb(36, 211, 192)");
    expect(colorForCents(100)).toBe("rgb(245, 72, 44)");
  });

  it("clamps past full saturation to the endpoint colors", () => {
    expect(colorForCents(-500)).toBe(colorForCents(-100));
    expect(colorForCents(500)).toBe(colorForCents(100));
  });
});
