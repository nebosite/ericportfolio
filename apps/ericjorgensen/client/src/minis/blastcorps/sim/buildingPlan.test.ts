import { describe, it, expect } from "vitest";
import {
  BRICK,
  BRICK_MASS,
  BUILDING_SIZES,
  SIZE_SPECS,
  faceJoint,
  findJoints,
  groundedParts,
  isWindowCourse,
  planBuilding,
  planWall,
  windowIntervals,
  type Part,
} from "./buildingPlan";

const box = (center: [number, number, number], half: [number, number, number]): Part => ({
  center,
  half,
  mass: 1,
});

function overlaps(a: Part, b: Part): boolean {
  for (let k = 0; k < 3; k++) {
    if (Math.abs(a.center[k] - b.center[k]) < a.half[k] + b.half[k] - 1e-4) continue;
    return false;
  }
  return true;
}

describe("faceJoint", () => {
  it("joins two boxes sharing a face and reports its area, normal and centre", () => {
    const a = box([0, 0.25, 0], [0.5, 0.25, 0.25]);
    const b = box([0.5, 0.75, 0], [0.5, 0.25, 0.25]); // stacked, half-brick overlap
    const j = faceJoint(a, b, 0, 1);
    expect(j).not.toBeNull();
    expect(j!.normal).toEqual([0, 1, 0]);
    expect(j!.area).toBeCloseTo(0.5 * 0.5);
    expect(j!.point).toEqual([0.25, 0.5, 0]);
    expect(j!.lever).toBeCloseTo(0.25);
  });

  it("returns null for separated boxes, edge contacts and interpenetration", () => {
    const a = box([0, 0, 0], [0.5, 0.5, 0.5]);
    expect(faceJoint(a, box([2, 0, 0], [0.5, 0.5, 0.5]), 0, 1)).toBeNull();
    // Touching along x AND y → only an edge in common.
    expect(faceJoint(a, box([1, 1, 0], [0.5, 0.5, 0.5]), 0, 1)).toBeNull();
    expect(faceJoint(a, box([0.5, 0, 0], [0.5, 0.5, 0.5]), 0, 1)).toBeNull();
  });

  it("points the normal from a toward b", () => {
    const a = box([0, 0, 0], [0.5, 0.5, 0.5]);
    const b = box([-1, 0, 0], [0.5, 0.5, 0.5]);
    expect(faceJoint(a, b, 0, 1)!.normal).toEqual([-1, 0, 0]);
  });
});

describe("windows", () => {
  it("opens courses 3–4, 8–9, 13–14 and no others", () => {
    const open = Array.from({ length: 16 }, (_, c) => isWindowCourse(c));
    expect(open.map((o, c) => (o ? c : -1)).filter((c) => c >= 0)).toEqual([3, 4, 8, 9, 13, 14]);
  });

  it("skips the corner bays and alternates", () => {
    expect(windowIntervals(6)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(windowIntervals(4)).toEqual([[1, 2]]);
  });
});

describe("planBuilding", () => {
  it("grows with size and keeps every size in the hundreds-to-thousands range", () => {
    let last = 0;
    for (const size of BUILDING_SIZES) {
      const n = planBuilding(size).parts.length;
      expect(n).toBeGreaterThan(last);
      last = n;
    }
    expect(planBuilding("small").parts.length).toBeGreaterThan(100);
    expect(planBuilding("colossal").parts.length).toBeGreaterThan(1000);
  });

  it("lays every part on or above the ground with one course of grounded bricks", () => {
    const plan = planBuilding("medium");
    for (const p of plan.parts) expect(p.center[1] - p.half[1]).toBeGreaterThanOrEqual(-1e-6);
    const grounded = groundedParts(plan);
    // Even course 0: two full x-walls of `side` bricks plus two z-walls of side-1.
    const { side } = SIZE_SPECS.medium;
    expect(grounded.length).toBe(2 * side + 2 * (side - 1));
    expect(plan.height).toBe(SIZE_SPECS.medium.courses * BRICK.height);
  });

  it("never overlaps two parts (the solver would explode)", () => {
    const { parts } = planBuilding("medium");
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        expect(overlaps(parts[i], parts[j])).toBe(false);
      }
    }
  });

  it("glues the whole tower into one connected structure", () => {
    const plan = planBuilding("small");
    const adj = new Map<number, number[]>();
    for (const j of plan.joints) {
      adj.set(j.a, [...(adj.get(j.a) ?? []), j.b]);
      adj.set(j.b, [...(adj.get(j.b) ?? []), j.a]);
    }
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), stack.push(m));
    }
    expect(seen.size).toBe(plan.parts.length);
  });

  it("lays running bond: stacked joints overlap half a brick, not a whole one", () => {
    const plan = planBuilding("small");
    const stacked = plan.joints.filter((j) => j.normal[1] !== 0);
    expect(stacked.length).toBeGreaterThan(0);
    const halfOverlap = stacked.filter((j) => Math.abs(j.area - 0.25) < 1e-6).length;
    // Mostly half-brick overlaps; full overlaps only where cut bricks sit at openings.
    expect(halfOverlap / stacked.length).toBeGreaterThan(0.6);
  });

  it("leaves window openings empty and cuts the straddling bricks", () => {
    const plan = planBuilding("medium");
    const { side } = SIZE_SPECS.medium;
    const minX = -(side * BRICK.length) / 2;
    const minZ = minX;
    // Window bay 1 on the front x-wall (z = minZ + T/2), course 3.
    const wx = minX + 1.5;
    const wy = BRICK.height / 2 + 3 * BRICK.height;
    const inWindow = plan.parts.filter(
      (p) =>
        Math.abs(p.center[2] - (minZ + BRICK.thickness / 2)) < 1e-6 &&
        Math.abs(p.center[1] - wy) < 1e-6 &&
        Math.abs(p.center[0] - wx) < p.half[0] - 1e-6,
    );
    expect(inWindow).toHaveLength(0);
    // Cut bricks are lighter and half a brick long along their wall's axis.
    const cut = plan.parts.filter((p) => p.mass < BRICK_MASS - 1e-6);
    expect(cut.length).toBeGreaterThan(0);
    for (const h of cut) {
      expect(h.mass).toBeCloseTo(BRICK_MASS / 2);
      expect(Math.max(h.half[0], h.half[2])).toBeCloseTo(BRICK.length / 4);
    }
    // A tower with windows has fewer parts than its solid perimeter would.
    const solid = SIZE_SPECS.medium.courses * (2 * side + 2 * (side - 1));
    expect(plan.parts.length).toBeLessThan(solid);
  });

  it("lays a straight wall in running bond with half bricks ending the odd courses", () => {
    const wall = planWall(16, 12);
    // Even courses: 16 bricks; odd courses: 15 full + 2 halves.
    expect(wall.parts.length).toBe(6 * 16 + 6 * 17);
    const halves = wall.parts.filter((p) => p.mass < BRICK_MASS - 1e-6);
    expect(halves.length).toBe(12);
    for (let i = 0; i < wall.parts.length; i++) {
      for (let j = i + 1; j < wall.parts.length; j++) {
        expect(overlaps(wall.parts[i], wall.parts[j])).toBe(false);
      }
    }
    expect(groundedParts(wall)).toHaveLength(16);
    expect(wall.height).toBe(6);
  });

  it("finds joints identically whether or not the parts are pre-sorted", () => {
    const plan = planBuilding("small");
    const shuffled = [...plan.parts].reverse();
    expect(findJoints(shuffled).length).toBe(plan.joints.length);
  });
});
