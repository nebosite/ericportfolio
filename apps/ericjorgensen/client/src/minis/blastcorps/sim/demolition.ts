// Pure demolition scoring: how much of a building has been displaced from where
// it was built. A part counts as displaced once its centre has moved more than
// half a brick height or it has tipped more than ~20°. Operates on the snapshot
// pose array so it runs identically in the worker and in headless tests.

import { POSE_FLOATS } from "./protocol";

/** Centre displacement (m) beyond which a part counts as demolished. */
export const DISPLACE_DISTANCE = 0.25;
/** cos(20°): a part whose up-axis has tilted past this counts as demolished. */
export const DISPLACE_TILT_COS = Math.cos((20 * Math.PI) / 180);
/** Demolition fraction at which the building counts as leveled. */
export const LEVELED_FRACTION = 0.75;

/**
 * Count displaced parts. `poses` holds POSE_FLOATS per part starting at `offset`;
 * `rest` is the flat list of rest centres (3 per part).
 */
export function countDisplaced(
  poses: Float32Array,
  offset: number,
  rest: Float32Array,
  partCount: number,
): number {
  let displaced = 0;
  for (let i = 0; i < partCount; i++) {
    const o = offset + i * POSE_FLOATS;
    const dx = poses[o] - rest[i * 3];
    const dy = poses[o + 1] - rest[i * 3 + 1];
    const dz = poses[o + 2] - rest[i * 3 + 2];
    if (dx * dx + dy * dy + dz * dz > DISPLACE_DISTANCE * DISPLACE_DISTANCE) {
      displaced++;
      continue;
    }
    if (upDotY(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]) < DISPLACE_TILT_COS) {
      displaced++;
    }
  }
  return displaced;
}

/** Y component of the body's local up axis after rotation by quaternion (x,y,z,w). */
export function upDotY(x: number, _y: number, z: number, _w: number): number {
  // Rotating (0,1,0) by a unit quaternion gives y' = 1 − 2(x² + z²); y and w drop out.
  return 1 - 2 * (x * x + z * z);
}

/** Whether part `i` (in a flat pose array with POSE_FLOATS stride at `offset`) is displaced from `rest`. */
export function isDisplaced(
  poses: Float32Array,
  offset: number,
  rest: Float32Array,
  i: number,
): boolean {
  const o = offset + i * POSE_FLOATS;
  const dx = poses[o] - rest[i * 3];
  const dy = poses[o + 1] - rest[i * 3 + 1];
  const dz = poses[o + 2] - rest[i * 3 + 2];
  if (dx * dx + dy * dy + dz * dz > DISPLACE_DISTANCE * DISPLACE_DISTANCE) return true;
  return upDotY(poses[o + 3], poses[o + 4], poses[o + 5], poses[o + 6]) < DISPLACE_TILT_COS;
}

/**
 * Displaced mass per structure, as a fraction of each structure's mass. `starts`
 * holds each structure's first part index (ascending) and `count` the total parts.
 */
export function displacedMassByStructure(
  poses: Float32Array,
  offset: number,
  rest: Float32Array,
  masses: Float32Array,
  starts: number[],
  count: number,
): number[] {
  const out: number[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : count;
    let total = 0;
    let displaced = 0;
    for (let i = from; i < to; i++) {
      total += masses[i];
      if (isDisplaced(poses, offset, rest, i)) displaced += masses[i];
    }
    out.push(total === 0 ? 0 : displaced / total);
  }
  return out;
}

export const demolitionFraction = (displaced: number, partCount: number): number =>
  partCount === 0 ? 0 : displaced / partCount;

export const isLeveled = (displaced: number, partCount: number): boolean =>
  demolitionFraction(displaced, partCount) >= LEVELED_FRACTION;
