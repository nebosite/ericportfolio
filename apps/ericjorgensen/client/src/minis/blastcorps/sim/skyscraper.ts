// Pure skyscraper generator: a steel moment frame with concrete floor slabs and
// a glass skin, as axis-aligned parts.
//
// Load paths matter more than geometry here, because every joint we add is a
// rigid six-axis tie and an iterative solver answers redundant rigid ties among
// heavy bodies with large opposing internal forces. So the structure is
// modelled the way real frames carry load:
//
// - Columns are continuous: each story's segment stands face-to-face on the one
//   below (a welded splice), so the whole stack is steel.
// - Beams frame into columns with explicit moment connections (they stop 0.35 m
//   short of the column so beams never share a volume at a corner).
// - Floor slabs REST on 10 cm ledges of the beams — contact and friction, no
//   joints — like precast planks. They never touch a column.
// - Glass units hang from the beam above by a single joint, with a sill gap, as a
//   curtain wall does. They don't touch slabs or columns.
//
// Measured before this (slabs and glass rigidly tied to everything they touched):
// a 10-story frame failed 237–1848 joints under its own weight, all in glass and
// concrete, never in steel, and worse with height. Columns + beams alone: 2%.

import { findJoints, type BuildingPlan, type Joint, type Part } from "./buildingPlan";
import { COLUMN_SPLICE, MATERIALS, connectionFor, failingMaterial } from "./materials";
import type { ConnectionStrength } from "./mortar";
import { MaterialKind } from "./protocol";

export const STORY_HEIGHT = 4.0;
export const BAY = 6.0;
export const COLUMN = 0.5; // square HSS section
/** Beams are wider than the columns so the slabs have a ledge to sit on. */
export const BEAM_WIDTH = 0.7;
export const BEAM_DEPTH = 0.5;
/** Beams weigh as a W21×62 (92 kg/m), not as a solid box of their collision volume. */
export const BEAM_KG_PER_M = 92;
/** Composite floor: ~150 mm of concrete on metal deck (a 6 m bay ≈ 13 t). */
export const SLAB_THICKNESS = 0.15;
/** Glass units are modelled 0.15 m thick for solver stability but weigh as 12 mm glass. */
export const GLASS_THICKNESS = 0.15;
/** Glass hangs with a sill gap: it never bears on the slab or ground. */
export const GLASS_SILL_GAP = 0.03;
const GLASS_AREAL_MASS = 0.012 * 2500; // kg/m² of 12 mm glass

export interface SkyscraperSpec {
  /** Bays per side (square footprint). */
  bays: number;
  stories: number;
  /** Footprint centre on the ground. */
  origin: [number, number];
  /** Include the glass skin (the bulk of the part count's "detail"). */
  glass?: boolean;
  /** Floor slabs: none, one per bay, or split into `slabSplit`² pieces per bay. */
  slabs?: boolean;
  slabSplit?: number;
  /** How slabs attach: rest on beam ledges, one pin to one beam, or studs to all four beams. */
  slabJoints?: "none" | "pins" | "beams";
  /** Multiplier on slab-connection capacities (solver-redundancy margin; see materials.ts). */
  slabStrengthScale?: number;
  /** Beam width override (wider beams give slabs a deeper ledge). */
  beamWidth?: number;
}

export function planSkyscraper(spec: SkyscraperSpec): BuildingPlan {
  const { bays, stories, origin } = spec;
  const glass = spec.glass ?? true;
  const parts: Part[] = [];
  const side = bays * BAY;
  const minX = origin[0] - side / 2;
  const minZ = origin[1] - side / 2;
  const gx = (i: number) => minX + i * BAY; // grid line x
  const gz = (k: number) => minZ + k * BAY; // grid line z
  const slabTop = STORY_HEIGHT;
  const slabBottom = slabTop - SLAB_THICKNESS;
  const beamTop = slabBottom;
  const beamBottom = beamTop - BEAM_DEPTH;
  const beamWidth = spec.beamWidth ?? BEAM_WIDTH;
  const beamSpan = BAY - beamWidth; // beams stop short of the column by their own width
  const slabSpan = BAY - COLUMN; // slabs stop at the column faces

  const box = (
    kind: MaterialKind,
    center: [number, number, number],
    half: [number, number, number],
    mass?: number,
  ) => {
    const volume = 8 * half[0] * half[1] * half[2];
    parts.push({ center, half, mass: mass ?? MATERIALS[kind].density * volume, kind });
  };

  const columnIds: number[] = [];
  const beamEnds: {
    part: number;
    at: [number, number, number];
    normal: [number, number, number];
  }[] = [];
  /** x-beam part index by "i|k|story", for slab pins. */
  const xBeamAt = new Map<string, number>();
  const slabPins: { part: number; i: number; k: number; story: number }[] = [];

  for (let s = 0; s < stories; s++) {
    const y0 = s * STORY_HEIGHT;
    // Continuous columns: one full-story segment per grid point.
    for (let i = 0; i <= bays; i++) {
      for (let k = 0; k <= bays; k++) {
        columnIds.push(parts.length);
        box(
          MaterialKind.Steel,
          [gx(i), y0 + STORY_HEIGHT / 2, gz(k)],
          [COLUMN / 2, STORY_HEIGHT / 2, COLUMN / 2],
        );
      }
    }
    // Beams along x and along z, framing into the columns.
    const beamY = y0 + beamBottom + BEAM_DEPTH / 2;
    for (let i = 0; i < bays; i++) {
      for (let k = 0; k <= bays; k++) {
        const part = parts.length;
        xBeamAt.set(`${i}|${k}|${s}`, part);
        box(
          MaterialKind.Steel,
          [gx(i) + BAY / 2, beamY, gz(k)],
          [beamSpan / 2, BEAM_DEPTH / 2, beamWidth / 2],
          BEAM_KG_PER_M * beamSpan,
        );
        beamEnds.push({ part, at: [gx(i) + beamWidth / 2, beamY, gz(k)], normal: [-1, 0, 0] });
        beamEnds.push({ part, at: [gx(i + 1) - beamWidth / 2, beamY, gz(k)], normal: [1, 0, 0] });
      }
    }
    for (let i = 0; i <= bays; i++) {
      for (let k = 0; k < bays; k++) {
        const part = parts.length;
        box(
          MaterialKind.Steel,
          [gx(i), beamY, gz(k) + BAY / 2],
          [beamWidth / 2, BEAM_DEPTH / 2, beamSpan / 2],
          BEAM_KG_PER_M * beamSpan,
        );
        beamEnds.push({ part, at: [gx(i), beamY, gz(k) + beamWidth / 2], normal: [0, 0, -1] });
        beamEnds.push({ part, at: [gx(i), beamY, gz(k + 1) - beamWidth / 2], normal: [0, 0, 1] });
      }
    }
    // Slabs rest on the beam ledges; optionally split into pieces.
    if (spec.slabs ?? true) {
      const split = Math.max(1, Math.round(spec.slabSplit ?? 1));
      const piece = slabSpan / split;
      const slabY = y0 + slabBottom + SLAB_THICKNESS / 2;
      for (let i = 0; i < bays; i++) {
        for (let k = 0; k < bays; k++) {
          for (let si = 0; si < split; si++) {
            for (let sk = 0; sk < split; sk++) {
              if (sk === 0) slabPins.push({ part: parts.length, i, k, story: s });
              box(
                MaterialKind.Concrete,
                [
                  gx(i) + COLUMN / 2 + piece * (si + 0.5),
                  slabY,
                  gz(k) + COLUMN / 2 + piece * (sk + 0.5),
                ],
                [piece / 2, SLAB_THICKNESS / 2, piece / 2],
              );
            }
          }
        }
      }
    }
    // Glass units: flush with the outer column faces, under the perimeter beams.
    if (glass) {
      const gh = beamBottom - GLASS_SILL_GAP;
      const gy = y0 + GLASS_SILL_GAP + gh / 2;
      const mass = GLASS_AREAL_MASS * slabSpan * gh;
      const outer = COLUMN / 2 - GLASS_THICKNESS / 2;
      for (let i = 0; i < bays; i++) {
        box(
          MaterialKind.Glass,
          [gx(i) + BAY / 2, gy, minZ - outer],
          [slabSpan / 2, gh / 2, GLASS_THICKNESS / 2],
          mass,
        );
        box(
          MaterialKind.Glass,
          [gx(i) + BAY / 2, gy, minZ + side + outer],
          [slabSpan / 2, gh / 2, GLASS_THICKNESS / 2],
          mass,
        );
      }
      for (let k = 0; k < bays; k++) {
        box(
          MaterialKind.Glass,
          [minX - outer, gy, gz(k) + BAY / 2],
          [GLASS_THICKNESS / 2, gh / 2, slabSpan / 2],
          mass,
        );
        box(
          MaterialKind.Glass,
          [minX + side + outer, gy, gz(k) + BAY / 2],
          [GLASS_THICKNESS / 2, gh / 2, slabSpan / 2],
          mass,
        );
      }
    }
  }

  // Face joints, filtered down to the load paths described above.
  // Measured (CLAUDE.md): at 10–12 stories a pinned slab (one stud joint) and a
  // resting slab behave alike; the pin keeps slabs aboard a toppling tower (they
  // would slide off past ~31°) and is the Physicist's pick. Studs to all four
  // beams — even at 3× capacity — and every arrangement at 20+ stories fail.
  const slabJoints = spec.slabJoints ?? "pins";
  const slabScale = spec.slabStrengthScale ?? 1;
  const joints: Joint[] = findJoints(parts).filter((j) => {
    const pa = parts[j.a];
    const pb = parts[j.b];
    const concreteA = pa.kind === MaterialKind.Concrete;
    const concreteB = pb.kind === MaterialKind.Concrete;
    if (concreteA || concreteB) {
      // Slabs never tie to columns or each other; to beams only when studded.
      if (slabJoints !== "beams") return false;
      const other = concreteA ? pb : pa;
      return other.kind === MaterialKind.Steel && !isColumn(other) && j.normal[1] !== 0;
    }
    const glassA = pa.kind === MaterialKind.Glass;
    const glassB = pb.kind === MaterialKind.Glass;
    if (glassA || glassB) return j.normal[1] !== 0; // glass hangs from the beam above only
    // Steel-steel faces: only column splices (vertical); beams get explicit joints.
    return isColumn(pa) && isColumn(pb) && j.normal[1] !== 0;
  });
  for (const j of joints) {
    const a = parts[j.a].kind ?? MaterialKind.Masonry;
    const b = parts[j.b].kind ?? MaterialKind.Masonry;
    const splice = isColumn(parts[j.a]) && isColumn(parts[j.b]);
    const base = splice ? COLUMN_SPLICE : connectionFor(a, b);
    const slab = a === MaterialKind.Concrete || b === MaterialKind.Concrete;
    j.strength = slab && slabScale !== 1 ? scaled(base, slabScale) : base;
    j.kind = failingMaterial(a, b);
  }
  // Explicit beam-to-column moment connections at every beam end.
  const columnAt = new Map<string, number>();
  for (const id of columnIds) {
    const p = parts[id];
    columnAt.set(gridKey(p.center[0], p.center[2], Math.floor(p.center[1] / STORY_HEIGHT)), id);
  }
  for (const end of beamEnds) {
    const story = Math.floor(end.at[1] / STORY_HEIGHT);
    const cx = end.at[0] + end.normal[0] * (beamWidth / 2);
    const cz = end.at[2] + end.normal[2] * (beamWidth / 2);
    const column = columnAt.get(gridKey(cx, cz, story));
    if (column === undefined) continue;
    joints.push({
      a: end.part,
      b: column,
      normal: end.normal,
      point: end.at,
      area: beamWidth * BEAM_DEPTH,
      lever: BEAM_DEPTH / 2,
      strength: connectionFor(MaterialKind.Steel, MaterialKind.Steel),
      kind: MaterialKind.Steel,
    });
  }
  // Optional slab pins: one stud joint per slab to the beam under its −z edge, so
  // a slab is held by a single honest tie (plus contact on its other edges).
  if (slabJoints === "pins") {
    const ledge = (beamWidth - COLUMN) / 2;
    for (const pin of slabPins) {
      const beam = xBeamAt.get(`${pin.i}|${pin.k}|${pin.story}`);
      if (beam === undefined) continue;
      const slab = parts[pin.part];
      joints.push({
        a: pin.part,
        b: beam,
        normal: [0, -1, 0],
        point: [
          slab.center[0],
          slab.center[1] - slab.half[1],
          slab.center[2] - slab.half[2] + ledge / 2,
        ],
        area: ledge * slab.half[0] * 2,
        lever: ledge / 2,
        strength: scaled(connectionFor(MaterialKind.Steel, MaterialKind.Concrete), slabScale),
        kind: MaterialKind.Concrete,
      });
    }
  }

  return {
    parts,
    joints,
    center: origin,
    height: stories * STORY_HEIGHT,
    halfWidth: side / 2 + COLUMN / 2,
  };
}

/** Columns are the tall steel parts (beams are 0.5 m deep, columns a full story). */
export const isColumn = (p: Part): boolean => p.kind === MaterialKind.Steel && p.half[1] > 1;

const gridKey = (x: number, z: number, story: number): string =>
  `${x.toFixed(2)}|${z.toFixed(2)}|${story}`;

const scaled = (s: ConnectionStrength, k: number): ConnectionStrength => ({
  tensile: s.tensile * k,
  shear: s.shear * k,
  moment: s.moment === undefined ? undefined : s.moment * k,
});

/** Total mass of a plan (kg). */
export function planMass(plan: BuildingPlan): number {
  return plan.parts.reduce((m, p) => m + p.mass, 0);
}
