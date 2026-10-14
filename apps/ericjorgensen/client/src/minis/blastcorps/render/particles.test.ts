import { describe, it, expect } from "vitest";
import {
  ADDITIVE_KINDS,
  NORMAL_KINDS,
  ParticleKind,
  ParticleRing,
  RECIPES,
  burst,
  burstsForMaterial,
} from "./particles";

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("ParticleRing", () => {
  it("starts with every slot dead", () => {
    const ring = new ParticleRing(8);
    expect(ring.alive(0)).toBe(0);
  });

  it("spawns contiguously and wraps around as one or two ranges", () => {
    const ring = new ParticleRing(8);
    const written: number[] = [];
    expect(ring.spawn(5, (i) => written.push(i))).toEqual([{ start: 0, count: 5 }]);
    expect(ring.spawn(5, (i) => written.push(i))).toEqual([
      { start: 5, count: 3 },
      { start: 0, count: 2 },
    ]);
    expect(written).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
  });

  it("caps a single spawn at the capacity", () => {
    const ring = new ParticleRing(4);
    const ranges = ring.spawn(10, () => {});
    expect(ranges.reduce((n, r) => n + r.count, 0)).toBe(4);
  });

  it("counts alive particles by birth and life", () => {
    const ring = new ParticleRing(4);
    ring.set(0, ParticleKind.Dust, 0, 0, 0, 0, 0, 0, 10, 2, 1, 0);
    ring.set(1, ParticleKind.Dust, 0, 0, 0, 0, 0, 0, 10, 5, 1, 0);
    expect(ring.alive(11)).toBe(2);
    expect(ring.alive(13)).toBe(1);
    expect(ring.alive(16)).toBe(0);
  });
});

describe("burst", () => {
  it("writes the recipe's count with upward-biased velocities around the point", () => {
    const ring = new ParticleRing(64);
    const ranges = burst(ring, ParticleKind.Spark, 10, 20, 30, 5, seq([0.5]));
    const count = ranges.reduce((n, r) => n + r.count, 0);
    expect(count).toBe(RECIPES[ParticleKind.Spark].count);
    for (let i = 0; i < count; i++) {
      expect(Math.abs(ring.origin[i * 3] - 10)).toBeLessThanOrEqual(
        RECIPES[ParticleKind.Spark].spread,
      );
      expect(ring.velocity[i * 3 + 1]).toBeGreaterThan(0); // up bias
      expect(ring.birth[i]).toBe(5);
      expect(ring.kind[i]).toBe(ParticleKind.Spark);
      expect(ring.life[i]).toBeGreaterThan(0);
    }
  });

  it("scales the count and never emits fewer than one", () => {
    const ring = new ParticleRing(64);
    expect(burst(ring, ParticleKind.Smoke, 0, 0, 0, 0, seq([0.5]), 0.01)[0].count).toBe(1);
    expect(burst(ring, ParticleKind.Dust, 0, 0, 0, 0, seq([0.5]), 2)[0].count).toBe(
      RECIPES[ParticleKind.Dust].count * 2,
    );
  });
});

describe("kinds", () => {
  it("partitions every kind into exactly one blending set", () => {
    for (const k of Object.values(ParticleKind).filter((v) => typeof v === "number") as number[]) {
      expect(NORMAL_KINDS.has(k) !== ADDITIVE_KINDS.has(k)).toBe(true);
    }
  });

  it("maps materials to sensible bursts", () => {
    expect(burstsForMaterial(1)).toContain(ParticleKind.Spark);
    expect(burstsForMaterial(2)).toContain(ParticleKind.Dust);
    expect(burstsForMaterial(3)).toEqual([ParticleKind.Shard]);
    expect(burstsForMaterial(0)).toContain(ParticleKind.Dust);
  });
});
