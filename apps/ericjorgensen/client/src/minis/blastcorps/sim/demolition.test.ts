import { describe, it, expect } from "vitest";
import {
  DISPLACE_DISTANCE,
  LEVELED_FRACTION,
  countDisplaced,
  demolitionFraction,
  isLeveled,
  upDotY,
} from "./demolition";
import { POSE_FLOATS } from "./protocol";

/** Build a pose array (with `offset` leading slots) from rest centres, optionally edited. */
function poses(rest: number[][], offset: number, edit?: (poses: Float32Array) => void) {
  const arr = new Float32Array(offset + rest.length * POSE_FLOATS);
  rest.forEach((c, i) => {
    const o = offset + i * POSE_FLOATS;
    arr.set([c[0], c[1], c[2], 0, 0, 0, 1], o);
  });
  edit?.(arr);
  return arr;
}

const rest = [
  [0, 0.25, 0],
  [1, 0.25, 0],
  [2, 0.25, 0],
  [3, 0.25, 0],
];
const restFlat = new Float32Array(rest.flat());

describe("countDisplaced", () => {
  it("counts nothing for an untouched building", () => {
    expect(countDisplaced(poses(rest, 5), 5, restFlat, 4)).toBe(0);
  });

  it("counts a part moved past half a brick, but not solver jitter", () => {
    const moved = poses(rest, 0, (p) => {
      p[0 * POSE_FLOATS + 1] -= DISPLACE_DISTANCE * 1.1; // fell
      p[1 * POSE_FLOATS + 0] += 0.01; // 1 cm of drift
    });
    expect(countDisplaced(moved, 0, restFlat, 4)).toBe(1);
  });

  it("counts a part tipped past 20° even if its centre stayed put", () => {
    const tipped = poses(rest, 0, (p) => {
      // Rotate 30° about x: q = (sin15°, 0, 0, cos15°).
      const h = (30 * Math.PI) / 180 / 2;
      p.set([Math.sin(h), 0, 0, Math.cos(h)], 2 * POSE_FLOATS + 3);
      // 10° about z stays upright enough.
      const g = (10 * Math.PI) / 180 / 2;
      p.set([0, 0, Math.sin(g), Math.cos(g)], 3 * POSE_FLOATS + 3);
    });
    expect(countDisplaced(tipped, 0, restFlat, 4)).toBe(1);
  });
});

describe("upDotY", () => {
  it("is 1 upright, 0 on its side and −1 upside down", () => {
    expect(upDotY(0, 0, 0, 1)).toBeCloseTo(1);
    const s = Math.SQRT1_2;
    expect(upDotY(s, 0, 0, s)).toBeCloseTo(0); // 90° about x
    expect(upDotY(1, 0, 0, 0)).toBeCloseTo(-1); // 180° about x
    expect(upDotY(0, s, 0, s)).toBeCloseTo(1); // yaw doesn't tilt
  });
});

describe("leveled", () => {
  it("is reached at the leveled fraction and not before", () => {
    expect(demolitionFraction(0, 0)).toBe(0);
    expect(isLeveled(Math.ceil(LEVELED_FRACTION * 100) - 1, 100)).toBe(false);
    expect(isLeveled(Math.ceil(LEVELED_FRACTION * 100), 100)).toBe(true);
  });
});
