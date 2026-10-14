// Pure building generator: a hollow masonry tower laid in running bond with
// interlocking corners and window openings. Produces axis-aligned parts (each
// becomes one rigid body) and the glue joints between every pair of parts that
// share a face (each becomes one six-axis constraint whose force we read back).
// No engine types here, so the geometry is unit-tested headlessly.

import type { MortarStrength } from "./mortar";
import type { MaterialKind } from "./protocol";

/** Nominal masonry unit: 1.0 m long, 0.5 m high, 0.5 m thick (hollow CMU-ish). */
export const BRICK = { length: 1.0, height: 0.5, thickness: 0.5 } as const;
/** Mass of a full unit (kg): a 0.25 m³ hollow concrete block (~1100 kg/m³, ~70% solid). */
export const BRICK_MASS = 200;

export type BuildingSize = "small" | "medium" | "large" | "huge" | "colossal";

export const BUILDING_SIZES: readonly BuildingSize[] = [
  "small",
  "medium",
  "large",
  "huge",
  "colossal",
];

/**
 * Footprint side in bricks (square tower) and number of courses. Height is the
 * solver's enemy, not part count: the load through a bed joint grows with the
 * courses above it, and the iterative solver's at-rest error grows with that
 * load — past ~20 courses it approaches real mortar strength on its own. So the
 * big sizes grow outward, not up (see CLAUDE.md for the measurements).
 */
export const SIZE_SPECS: Record<BuildingSize, { side: number; courses: number }> = {
  small: { side: 4, courses: 12 },
  medium: { side: 6, courses: 16 },
  large: { side: 8, courses: 20 },
  huge: { side: 12, courses: 18 },
  colossal: { side: 18, courses: 18 },
};

export interface Part {
  /** Centre in world metres. */
  center: [number, number, number];
  /** Half extents (m). */
  half: [number, number, number];
  mass: number;
  /** Material, for colour, particles and connection strength (masonry when absent). */
  kind?: MaterialKind;
}

export interface Joint {
  a: number; // part index
  b: number; // part index
  /** Unit normal from a's centre toward b's centre (axis-aligned). */
  normal: [number, number, number];
  /** Shared face centre (world). */
  point: [number, number, number];
  /** Shared face area (m²). */
  area: number;
  /** Half the shared face's extent across the bending axis — lever arm that turns a moment into edge tension. */
  lever: number;
  /** Connection strength override (the weaker material's); the building default when absent. */
  strength?: MortarStrength;
  /** Material that fails at this joint (for particles/sound); masonry when absent. */
  kind?: MaterialKind;
}

export interface BuildingPlan {
  parts: Part[];
  joints: Joint[];
  /** Footprint centre on the ground plane. */
  center: [number, number];
  /** Overall height (m). */
  height: number;
  /** Footprint half-width (m). */
  halfWidth: number;
}

const EPS = 1e-4;

/** Courses carrying window openings: 3–4, 8–9, 13–14, … */
export const isWindowCourse = (course: number): boolean => course >= 3 && (course - 3) % 5 < 2;

/**
 * Window openings along a wall of `side` bays, as [start, end) intervals in the
 * wall's own coordinate (0 = the footprint edge). Every other bay, never the end
 * bays (the corners stay solid).
 */
export function windowIntervals(side: number): [number, number][] {
  const out: [number, number][] = [];
  for (let bay = 1; bay < side - 1; bay += 2)
    out.push([bay * BRICK.length, (bay + 1) * BRICK.length]);
  return out;
}

/**
 * Lay a square tower. The footprint is `side` bricks on each edge. Odd and even
 * courses alternate which pair of walls runs the full length so corners interlock;
 * because the shortened walls start half a brick (one wall thickness) in, their
 * head joints land mid-brick over the course below — running bond for free.
 * Windows are one bay wide and two courses tall; bricks that straddle an opening
 * are cut, as a mason would.
 */
export function planBuilding(size: BuildingSize, origin: [number, number] = [0, 0]): BuildingPlan {
  const { side, courses } = SIZE_SPECS[size];
  const parts: Part[] = [];
  const L = BRICK.length;
  const H = BRICK.height;
  const T = BRICK.thickness;
  const extent = side * L; // outer footprint edge length
  const minX = origin[0] - extent / 2;
  const minZ = origin[1] - extent / 2;
  const maxX = minX + extent;
  const maxZ = minZ + extent;
  const windows = windowIntervals(side);
  // Openings in world coordinates along a wall that begins at `wallStart`.
  const openingsFor = (course: number, wallStart: number): Opening[] =>
    isWindowCourse(course) ? windows.map(([s, e]) => [wallStart + s, wallStart + e]) : [];

  for (let c = 0; c < courses; c++) {
    const y = H / 2 + c * H;
    if (c % 2 === 0) {
      // x-walls run the full length; z-walls fit between them.
      layRun(parts, 0, minZ + T / 2, minX, maxX, y, openingsFor(c, minX));
      layRun(parts, 0, maxZ - T / 2, minX, maxX, y, openingsFor(c, minX));
      layRun(parts, 2, minX + T / 2, minZ + T, maxZ - T, y, openingsFor(c, minZ));
      layRun(parts, 2, maxX - T / 2, minZ + T, maxZ - T, y, openingsFor(c, minZ));
    } else {
      layRun(parts, 2, minX + T / 2, minZ, maxZ, y, openingsFor(c, minZ));
      layRun(parts, 2, maxX - T / 2, minZ, maxZ, y, openingsFor(c, minZ));
      layRun(parts, 0, minZ + T / 2, minX + T, maxX - T, y, openingsFor(c, minX));
      layRun(parts, 0, maxZ - T / 2, minX + T, maxX - T, y, openingsFor(c, minX));
    }
  }

  return {
    parts,
    joints: findJoints(parts),
    center: origin,
    height: courses * H,
    halfWidth: extent / 2,
  };
}

/** A window opening along a run: [start, end) in world coordinates. */
type Opening = [number, number];

/**
 * Lay one straight run of bricks along `axis` (0 = x, 2 = z) from `from` to `to`
 * at height `y`; `fixed` is the run's constant coordinate. Runs step over
 * openings and cut the brick that would enter one, as a mason would.
 */
function layRun(
  parts: Part[],
  axis: 0 | 2,
  fixed: number,
  from: number,
  to: number,
  y: number,
  openings: Opening[],
): void {
  const L = BRICK.length;
  const H = BRICK.height;
  const T = BRICK.thickness;
  let cursor = from;
  while (cursor < to - EPS) {
    const atOpening = openings.find(([s]) => Math.abs(s - cursor) < EPS);
    if (atOpening) {
      cursor = atOpening[1];
      continue;
    }
    let brickLen = Math.min(L, to - cursor);
    for (const [s] of openings) {
      if (s > cursor + EPS && s < cursor + brickLen - EPS) brickLen = s - cursor;
    }
    const mid = cursor + brickLen / 2;
    const center: [number, number, number] = axis === 0 ? [mid, y, fixed] : [fixed, y, mid];
    const half: [number, number, number] =
      axis === 0 ? [brickLen / 2, H / 2, T / 2] : [T / 2, H / 2, brickLen / 2];
    parts.push({ center, half, mass: (BRICK_MASS * brickLen) / L });
    cursor += brickLen;
  }
}

/**
 * A single straight wall along x, `cols` bricks long and `rows` courses high, in
 * running bond (odd courses start and end with a half brick), standing on the
 * ground at z = 0. Used by the headless structural tests.
 */
export function planWall(
  cols: number,
  rows: number,
  origin: [number, number] = [0, 0],
): BuildingPlan {
  const parts: Part[] = [];
  const L = BRICK.length;
  const H = BRICK.height;
  const minX = origin[0] - (cols * L) / 2;
  const maxX = minX + cols * L;
  for (let c = 0; c < rows; c++) {
    const y = H / 2 + c * H;
    if (c % 2 === 0) {
      layRun(parts, 0, origin[1], minX, maxX, y, []);
    } else {
      // Half brick, full bricks, half brick.
      layRun(parts, 0, origin[1], minX, minX + L / 2, y, []);
      layRun(parts, 0, origin[1], minX + L / 2, maxX - L / 2, y, []);
      layRun(parts, 0, origin[1], maxX - L / 2, maxX, y, []);
    }
  }
  return {
    parts,
    joints: findJoints(parts),
    center: origin,
    height: rows * H,
    halfWidth: (cols * L) / 2,
  };
}

/**
 * Every pair of parts that share a face (touching on one axis, overlapping on the
 * other two) gets a joint. O(n²) on a spatial hash would be premature: a 2000-part
 * plan is ~2M cheap AABB checks, well under 100 ms, and it runs once per build.
 */
export function findJoints(parts: Part[]): Joint[] {
  const joints: Joint[] = [];
  if (parts.length === 0) return joints;
  // Sweep along the axis the parts spread most along (height for a tower, length
  // for a street), so the early-out keeps the inner loop short.
  const axis = widestAxis(parts);
  const order = parts
    .map((_, i) => i)
    .sort((i, j) => parts[i].center[axis] - parts[j].center[axis]);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const a = parts[i];
    const reach = a.center[axis] + a.half[axis];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      const b = parts[j];
      if (b.center[axis] - b.half[axis] > reach + EPS) break;
      const joint = faceJoint(a, b, i, j);
      if (joint) joints.push(joint);
    }
  }
  return joints;
}

function widestAxis(parts: Part[]): 0 | 1 | 2 {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    for (let k = 0; k < 3; k++) {
      if (p.center[k] < min[k]) min[k] = p.center[k];
      if (p.center[k] > max[k]) max[k] = p.center[k];
    }
  }
  const spread = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (spread[1] >= spread[0] && spread[1] >= spread[2]) return 1;
  return spread[0] >= spread[2] ? 0 : 2;
}

/** The face joint between two axis-aligned boxes, or null if they don't share a face. */
export function faceJoint(a: Part, b: Part, ia: number, ib: number): Joint | null {
  let touchAxis = -1;
  const overlap: number[] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const gap = Math.abs(b.center[k] - a.center[k]) - (a.half[k] + b.half[k]);
    if (Math.abs(gap) < EPS) {
      if (touchAxis !== -1) return null; // edge/corner contact, not a face
      touchAxis = k;
    } else if (gap > 0) {
      return null; // separated
    } else {
      overlap[k] =
        Math.min(a.center[k] + a.half[k], b.center[k] + b.half[k]) -
        Math.max(a.center[k] - a.half[k], b.center[k] - b.half[k]);
    }
  }
  if (touchAxis === -1) return null; // interpenetrating — never in a valid plan
  const others = [0, 1, 2].filter((k) => k !== touchAxis);
  if (overlap[others[0]] < EPS || overlap[others[1]] < EPS) return null;
  const normal: [number, number, number] = [0, 0, 0];
  normal[touchAxis] = Math.sign(b.center[touchAxis] - a.center[touchAxis]);
  const point: [number, number, number] = [0, 0, 0];
  point[touchAxis] = a.center[touchAxis] + normal[touchAxis] * a.half[touchAxis];
  for (const k of others) {
    point[k] =
      (Math.max(a.center[k] - a.half[k], b.center[k] - b.half[k]) +
        Math.min(a.center[k] + a.half[k], b.center[k] + b.half[k])) /
      2;
  }
  const area = overlap[others[0]] * overlap[others[1]];
  // Bending about the face's short axis is resisted across its long axis — use the
  // smaller half-extent so we never underestimate edge tension.
  const lever = Math.min(overlap[others[0]], overlap[others[1]]) / 2;
  return { a: ia, b: ib, normal, point, area, lever };
}

/** Parts that rest directly on the ground plane (y = 0). */
export function groundedParts(plan: BuildingPlan): number[] {
  return plan.parts
    .map((p, i) => (Math.abs(p.center[1] - p.half[1]) < EPS ? i : -1))
    .filter((i) => i >= 0);
}
