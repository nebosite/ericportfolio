import { describe, it, expect } from "vitest";
import {
  glowPulse,
  shouldSpawnTrail,
  advanceTrail,
  TrailNode,
  TRAIL_LIFE_SEC,
  TRAIL_SPAWN_DIST,
  TRAIL_MAX,
  GLOW_BASE_ALPHA,
  GLOW_ALPHA_SWING,
  GLOW_SCALE_SWING,
} from "./pacFx";

describe("glowPulse", () => {
  it("sits at its baseline at t=0", () => {
    const p = glowPulse(0);
    expect(p.scale).toBeCloseTo(1, 6);
    expect(p.alpha).toBeCloseTo(GLOW_BASE_ALPHA, 6);
  });

  it("breathes within a small, calm range", () => {
    let minA = Infinity;
    let maxA = -Infinity;
    let minS = Infinity;
    let maxS = -Infinity;
    for (let ms = 0; ms <= 10000; ms += 25) {
      const p = glowPulse(ms);
      minA = Math.min(minA, p.alpha);
      maxA = Math.max(maxA, p.alpha);
      minS = Math.min(minS, p.scale);
      maxS = Math.max(maxS, p.scale);
    }
    expect(minA).toBeCloseTo(GLOW_BASE_ALPHA - GLOW_ALPHA_SWING, 2);
    expect(maxA).toBeCloseTo(GLOW_BASE_ALPHA + GLOW_ALPHA_SWING, 2);
    expect(minS).toBeCloseTo(1 - GLOW_SCALE_SWING, 2);
    expect(maxS).toBeCloseTo(1 + GLOW_SCALE_SWING, 2);
    // Stays comfortably visible and never inverts.
    expect(minA).toBeGreaterThan(0);
    expect(minS).toBeGreaterThan(0);
  });
});

describe("shouldSpawnTrail", () => {
  it("spawns the first dot immediately", () => {
    expect(shouldSpawnTrail([], 10, 10)).toBe(true);
  });

  it("waits until Pac has travelled far enough from the last dot", () => {
    const nodes: TrailNode[] = [{ x: 0, y: 0, life: 1 }];
    expect(shouldSpawnTrail(nodes, TRAIL_SPAWN_DIST - 1, 0)).toBe(false);
    expect(shouldSpawnTrail(nodes, TRAIL_SPAWN_DIST, 0)).toBe(true);
    expect(shouldSpawnTrail(nodes, 100, 100)).toBe(true); // a tunnel-wrap jump
  });

  it("stops spawning at the safety cap", () => {
    const nodes: TrailNode[] = Array.from({ length: TRAIL_MAX }, (_, i) => ({
      x: i * 100,
      y: 0,
      life: 1,
    }));
    expect(shouldSpawnTrail(nodes, 9999, 0)).toBe(false);
  });
});

describe("advanceTrail", () => {
  it("fades dots by dt and preserves order without mutating the input", () => {
    const nodes: TrailNode[] = [
      { x: 1, y: 1, life: 1 },
      { x: 2, y: 2, life: 0.5 },
    ];
    const out = advanceTrail(nodes, TRAIL_LIFE_SEC / 2); // decay 0.5
    expect(out).toHaveLength(1); // the 0.5 dot hits 0 and drops
    expect(out[0]).toMatchObject({ x: 1, y: 1 });
    expect(out[0].life).toBeCloseTo(0.5, 6);
    // Input untouched.
    expect(nodes[0].life).toBe(1);
    expect(nodes[1].life).toBe(0.5);
  });

  it("drops every dot once enough time passes", () => {
    const nodes: TrailNode[] = [{ x: 0, y: 0, life: 1 }];
    expect(advanceTrail(nodes, TRAIL_LIFE_SEC)).toHaveLength(0);
  });

  it("is a no-op shape for an empty trail", () => {
    expect(advanceTrail([], 0.016)).toEqual([]);
  });
});
