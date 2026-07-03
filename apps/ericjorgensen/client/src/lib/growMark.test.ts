import { describe, it, expect } from "vitest";
import { growMark } from "./growMark";

describe("growMark", () => {
  it("is deterministic: same (seed, style, growthSeed) → identical geometry", () => {
    expect(growMark("PixelWhimsy", "wild")).toEqual(growMark("PixelWhimsy", "wild"));
  });

  it("changes when the seed or the growthSeed changes", () => {
    expect(growMark("a", "wild")).not.toEqual(growMark("b", "wild"));
    expect(growMark("a", "wild", 1, 1)).not.toEqual(growMark("a", "wild", 1, 2));
  });

  it("grows from the base at (60, 148)", () => {
    const m = growMark("seed", "sapling");
    expect(m.segments[0].x1).toBe(60);
    expect(m.segments[0].y1).toBe(148);
    expect(m.segments.length).toBeGreaterThan(0);
    expect(m.buds.length).toBeGreaterThan(0);
  });

  it("tags generations from the base (trunk = 0) so growth can be staggered", () => {
    const m = growMark("seed", "wild");
    expect(m.segments[0].gen).toBe(0); // trunk grows first
    // maxGen is the deepest generation across segments and buds
    const deepest = Math.max(...m.segments.map((s) => s.gen), ...m.buds.map((b) => b.gen));
    expect(m.maxGen).toBe(deepest);
    expect(m.maxGen).toBeGreaterThan(0);
  });

  it("renders crystalline buds as squares with butt caps, organic as round circles", () => {
    const crystal = growMark("x", "crystal");
    expect(crystal.square).toBe(true);
    expect(crystal.cap).toBe("butt");
    const wild = growMark("x", "wild");
    expect(wild.square).toBe(false);
    expect(wild.cap).toBe("round");
  });

  it("scales stroke width with strokeScale", () => {
    const thin = growMark("x", "wild", 0.85);
    const thick = growMark("x", "wild", 1.18);
    expect(thick.segments[0].w).toBeGreaterThan(thin.segments[0].w);
  });

  it("stays within reasonable bounds of the 0 0 120 150 viewBox", () => {
    // Tips/buds shouldn't fly wildly outside the drawing area.
    const m = growMark("Big Tiny Games", "crystal", 1.18);
    for (const b of m.buds) {
      expect(b.x).toBeGreaterThan(-40);
      expect(b.x).toBeLessThan(160);
      expect(b.y).toBeLessThan(150);
    }
  });
});
