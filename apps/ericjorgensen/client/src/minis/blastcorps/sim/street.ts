// Pure street layout: skyscrapers in two rows along an avenue running +z, the
// tractor spawning at the −z end. Short towers sit nearest the spawn so the
// first structure is ready in well under a second and the tall ones pop in as
// the player drives. Deterministic for a given spec (seeded), so the worker and
// the main thread agree without talking.

import type { BuildingPlan } from "./buildingPlan";
import { planBuilding } from "./buildingPlan";
import { BAY, COLUMN, planSkyscraper } from "./skyscraper";
import type { FloorsPolicy, SceneSpec, VehicleKind } from "./protocol";

/** Carriageway plus sidewalks: wide enough for a 15 m machine to swing. */
export const AVENUE_WIDTH = 30;
/** Gap between neighbouring towers along the avenue. */
export const TOWER_GAP = 36;
/** Spawn stands this far before the first tower's near face. */
export const SPAWN_RUNUP = 140;
/**
 * Tallest tower that gets floor slabs under the "auto" policy. Measured: Jolt's
 * iterative solver (10 iterations, 60 Hz) keeps 11 t slabs resting on a 10-story
 * frame; from 20 stories up they fall through in every arrangement tried, while
 * the bare steel frame stands to 50 (see CLAUDE.md).
 */
export const SLAB_STORY_LIMIT = 12;

export function slabsFor(stories: number, policy: FloorsPolicy): boolean {
  if (policy === "none") return false;
  if (policy === "all") return true;
  return stories <= SLAB_STORY_LIMIT;
}

export interface StreetLayout {
  plans: BuildingPlan[];
  spawn: [number, number, number];
  /** Length of the built-up avenue (m). */
  length: number;
  vehicle: VehicleKind;
}

/** Mulberry32: tiny seeded PRNG so a street is reproducible. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Story counts for `towers` buildings between 10 and `maxStories`, shuffled so
 * the street looks irregular but with the shortest two nearest the spawn.
 */
export function storyCounts(towers: number, maxStories: number, seed = 7): number[] {
  const rnd = seeded(seed);
  const min = 10;
  const span = Math.max(0, maxStories - min);
  const counts = Array.from({ length: towers }, (_, i) =>
    Math.round(min + (span * i) / Math.max(1, towers - 1)),
  );
  for (let i = counts.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [counts[i], counts[j]] = [counts[j], counts[i]];
  }
  // Shortest two first (one per side of the street).
  counts.sort((a, b) => a - b);
  const [a, b, ...rest] = counts;
  const rnd2 = seeded(seed + 1);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd2() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [a, b, ...rest].filter((n) => n !== undefined);
}

/** Bays per side for a tower of this height: taller towers get a wider footprint. */
export function baysFor(stories: number): number {
  if (stories >= 36) return 4;
  if (stories >= 18) return 3;
  return 2;
}

/** How far each staggered tower's inner column line crosses the street's centreline (m). */
export const INTRUSION = 1.5;

/**
 * One tower per pitch, sides alternating, each set so its inner column line
 * crosses the centreline by INTRUSION: a straight run at top speed shears two
 * column lines off every tower, and a 6 m steer pancakes one. The shortest tower
 * stands centred across the end of the run-up as the first hit. At 55 m/s a
 * 36 m gap is 0.7 s per tower and lets a 120 m tower topple onto its neighbour.
 */
export function planStreet(spec: Extract<SceneSpec, { kind: "street" }>): StreetLayout {
  const stories = storyCounts(spec.towers, spec.maxStories);
  const floors = spec.floors ?? "auto";
  const plans: BuildingPlan[] = [];
  let z = 0; // near face of the next tower
  stories.forEach((s, index) => {
    const bays = baysFor(s);
    const depth = bays * BAY + COLUMN;
    const half = depth / 2;
    // Tower 0 centred; then left, right, left…
    const x = index === 0 ? 0 : (index % 2 === 1 ? -1 : 1) * (half - COLUMN / 2 - INTRUSION);
    plans.push(
      planSkyscraper({
        bays,
        stories: s,
        origin: [x, z + half],
        glass: spec.glass,
        slabs: slabsFor(s, floors),
      }),
    );
    z += depth + TOWER_GAP;
  });
  return { plans, spawn: [0, 5.6, -SPAWN_RUNUP], length: z, vehicle: "tractor" };
}

/** The slice-1 scene: one masonry tower, dozer 42 m out. */
export function planTowerScene(size: Extract<SceneSpec, { kind: "tower" }>["size"]): StreetLayout {
  const plan = planBuilding(size);
  return {
    plans: [plan],
    spawn: [0, 2.2, -(plan.halfWidth + 42)],
    length: plan.halfWidth * 2,
    vehicle: "dozer",
  };
}

export function planScene(spec: SceneSpec): StreetLayout {
  return spec.kind === "street" ? planStreet(spec) : planTowerScene(spec.size);
}

/** Parts per story of a `bays`-wide frame: columns + beams (+ slabs) (+ glass units). */
export function partsPerStory(bays: number, glass: boolean, slabs = true): number {
  return (bays + 1) ** 2 + 2 * bays * (bays + 1) + (slabs ? bays ** 2 : 0) + (glass ? 4 * bays : 0);
}

/** Part count of a street without planning it (the title screen shows it live). */
export function estimateStreetParts(spec: Extract<SceneSpec, { kind: "street" }>): number {
  const floors = spec.floors ?? "auto";
  return storyCounts(spec.towers, spec.maxStories).reduce(
    (n, s) => n + s * partsPerStory(baysFor(s), spec.glass, slabsFor(s, floors)),
    0,
  );
}
