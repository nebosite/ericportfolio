import { describe, it, expect } from "vitest";
import {
  INTRUSION,
  SLAB_STORY_LIMIT,
  TOWER_GAP,
  baysFor,
  estimateStreetParts,
  partsPerStory,
  planScene,
  planStreet,
  seeded,
  slabsFor,
  storyCounts,
} from "./street";
import { COLUMN } from "./skyscraper";
import { MaterialKind } from "./protocol";

describe("storyCounts", () => {
  it("spans 10..max, is deterministic, and puts the two shortest first", () => {
    const a = storyCounts(10, 50);
    const b = storyCounts(10, 50);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    expect(Math.min(...a)).toBe(10);
    expect(Math.max(...a)).toBe(50);
    const sorted = [...a].sort((x, y) => x - y);
    expect(a.slice(0, 2)).toEqual(sorted.slice(0, 2));
  });

  it("handles a single tower and a flat maximum", () => {
    expect(storyCounts(1, 50)).toEqual([10]);
    expect(storyCounts(3, 10)).toEqual([10, 10, 10]);
  });
});

describe("seeded", () => {
  it("is reproducible and in [0,1)", () => {
    const r1 = seeded(42);
    const r2 = seeded(42);
    for (let i = 0; i < 5; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("planStreet", () => {
  const spec = { kind: "street" as const, towers: 6, maxStories: 30, glass: true };
  const street = planStreet(spec);

  it("centres the shortest tower first, then staggers the rest so each crosses the centreline", () => {
    expect(street.plans).toHaveLength(6);
    expect(street.plans[0].center[0]).toBe(0);
    expect(street.plans[0].height).toBe(10 * 4);
    street.plans.slice(1).forEach((plan, i) => {
      const expectedSide = i % 2 === 0 ? -1 : 1;
      expect(Math.sign(plan.center[0])).toBe(expectedSide);
      // The inner column line (centre of the inner columns) crosses x = 0 by INTRUSION.
      const innerColumnLine = Math.abs(plan.center[0]) - (plan.halfWidth - COLUMN / 2);
      expect(innerColumnLine).toBeCloseTo(-INTRUSION, 5);
    });
  });

  it("spaces towers one per pitch along +z with the gap, spawn before the first", () => {
    let z = 0;
    for (const plan of street.plans) {
      const depth = plan.halfWidth * 2; // footprint incl. the outer half columns
      expect(plan.center[1] - depth / 2).toBeCloseTo(z, 5);
      z += depth + TOWER_GAP;
    }
    expect(street.length).toBeCloseTo(z, 5);
    expect(street.spawn[2]).toBeLessThan(0);
    expect(street.vehicle).toBe("tractor");
  });

  it("gives floors only to towers the solver can hold, by default", () => {
    const hasSlabs = (i: number) =>
      street.plans[i].parts.some((p) => p.kind === MaterialKind.Concrete);
    const stories = (i: number) => street.plans[i].height / 4;
    for (let i = 0; i < street.plans.length; i++) {
      expect(hasSlabs(i)).toBe(stories(i) <= SLAB_STORY_LIMIT);
    }
    const all = planStreet({ ...spec, floors: "all" });
    expect(all.plans.every((p) => p.parts.some((q) => q.kind === MaterialKind.Concrete))).toBe(
      true,
    );
    const none = planStreet({ ...spec, floors: "none" });
    expect(none.plans.some((p) => p.parts.some((q) => q.kind === MaterialKind.Concrete))).toBe(
      false,
    );
    expect(slabsFor(12, "auto")).toBe(true);
    expect(slabsFor(13, "auto")).toBe(false);
  });

  it("widens the footprint with height", () => {
    expect(baysFor(10)).toBe(2);
    expect(baysFor(20)).toBe(3);
    expect(baysFor(50)).toBe(4);
  });
});

describe("estimateStreetParts", () => {
  it("matches the planned part count exactly under every floors policy", () => {
    for (const floors of ["auto", "none", "all"] as const) {
      const spec = { kind: "street" as const, towers: 4, maxStories: 20, glass: true, floors };
      const planned = planStreet(spec).plans.reduce((n, p) => n + p.parts.length, 0);
      expect(estimateStreetParts(spec)).toBe(planned);
    }
    expect(partsPerStory(3, true)).toBe(16 + 24 + 9 + 12);
    expect(partsPerStory(3, false, false)).toBe(16 + 24);
  });
});

describe("planScene", () => {
  it("still builds the slice-1 tower scene with the dozer", () => {
    const scene = planScene({ kind: "tower", size: "small" });
    expect(scene.plans).toHaveLength(1);
    expect(scene.spawn[2]).toBeLessThan(-40);
    expect(scene.vehicle).toBe("dozer");
  });
});
