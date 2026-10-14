// Materials and the connections between them, in physical units. A joint's
// capacity depends on what is being joined (a beam's shear tab, a slab's shear
// studs, a glass unit's silicone bite), so capacity comes from a (material,
// material) table rather than "the weaker material". Numbers are code-typical
// values for real sections; see CLAUDE.md for the element table and sources.

import type { ConnectionStrength } from "./mortar";
import { MaterialKind } from "./protocol";

export interface Material {
  kind: MaterialKind;
  name: string;
  /** kg/m³ of the part as modelled (glass units are a thin box carrying 12 mm glass mass). */
  density: number;
  /** Base colour, 0..1 RGB. */
  color: [number, number, number];
}

export const MATERIALS: Record<MaterialKind, Material> = {
  [MaterialKind.Masonry]: {
    kind: MaterialKind.Masonry,
    name: "masonry",
    density: 800,
    color: [0.55, 0.36, 0.26],
  },
  [MaterialKind.Steel]: {
    kind: MaterialKind.Steel,
    name: "steel",
    density: 1500,
    color: [0.42, 0.2, 0.17],
  },
  [MaterialKind.Concrete]: {
    kind: MaterialKind.Concrete,
    name: "concrete",
    density: 2400,
    color: [0.62, 0.61, 0.58],
  },
  [MaterialKind.Glass]: {
    kind: MaterialKind.Glass,
    name: "glass",
    density: 200,
    color: [0.45, 0.62, 0.72],
  },
};

const MPa = 1e6;

// Every joint locks all six axes, so it carries whatever moment the geometry
// demands — a beam's fixed-end moment under its slab (wL²/12 ≈ 80 kN·m), a slab
// edge's (~85 kN·m). Capacities must therefore be those of *monolithic*
// connections (a fully welded moment frame, a composite deck), not of pinned
// shear tabs; rating a locked joint with a pin's 80 kN·m made the whole frame
// fail under dead load (measured: 1848 of 2004 joints in a 10-story tower).

/** Masonry mortar (slice 1): upper-range flexural bond. */
const MORTAR: ConnectionStrength = { tensile: 0.6 * MPa, shear: 0.9 * MPa };
/** Fully welded beam-to-column moment connection: the beam's own capacity
 *  (W21×62: A·f_y ≈ 4 MN over the 0.15 m² end face; M_p ≈ 815 kN·m). */
const MOMENT_CONNECTION: ConnectionStrength = { tensile: 25 * MPa, shear: 15 * MPa, moment: 800e3 };
/** Column splice (HSS 500×500×25, full-strength welded): A·f_y ≈ 16 MN over the
 *  0.25 m² section (64 MPa), M_p ≈ 2.9 MN·m. */
const SPLICE: ConnectionStrength = {
  tensile: 60 * MPa,
  shear: 35 * MPa,
  moment: 2.9e6,
  compressive: 60 * MPa, // squash load ≈ 16 MN: a dropped stack can crush a splice
};
/** Composite slab on a beam: shear studs (weak in uplift) with the RC slab's own
 *  edge moment capacity (~55 kN·m per metre over a 5.5 m edge). */
const COMPOSITE_DECK: ConnectionStrength = { tensile: 0.3 * MPa, shear: 1.1 * MPa, moment: 300e3 };
/** Slab-to-slab construction joint with continuity reinforcement. */
const SLAB_JOINT: ConnectionStrength = { tensile: 1.0 * MPa, shear: 1.0 * MPa, moment: 300e3 };
/** Structural silicone bite holding a glass unit to its frame. The moment is
 *  explicit: derived from a 5 cm-deep seam it would be ~700 N·m, less than the
 *  panel's own weight eccentricity, and every unit would "fail" at rest. */
const SILICONE: ConnectionStrength = { tensile: 0.3 * MPa, shear: 0.3 * MPa, moment: 60e3 };

/** Connection capacity between two materials. Symmetric. */
export function connectionFor(a: MaterialKind, b: MaterialKind): ConnectionStrength {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (lo === MaterialKind.Glass || hi === MaterialKind.Glass) return SILICONE;
  if (lo === MaterialKind.Masonry && hi === MaterialKind.Masonry) return MORTAR;
  if (lo === MaterialKind.Steel && hi === MaterialKind.Steel) return MOMENT_CONNECTION;
  if (lo === MaterialKind.Steel && hi === MaterialKind.Concrete) return COMPOSITE_DECK;
  if (lo === MaterialKind.Concrete && hi === MaterialKind.Concrete) return SLAB_JOINT;
  return MORTAR; // masonry against anything else: the mortar governs
}

/** Column-to-column splice through a floor (an explicit joint; the segments don't touch). */
export const COLUMN_SPLICE = SPLICE;

/**
 * Which material "fails" at a joint, for particles and sound: glass shatters,
 * concrete dusts, steel sparks.
 */
export function failingMaterial(a: MaterialKind, b: MaterialKind): MaterialKind {
  if (a === MaterialKind.Glass || b === MaterialKind.Glass) return MaterialKind.Glass;
  if (a === MaterialKind.Concrete || b === MaterialKind.Concrete) return MaterialKind.Concrete;
  if (a === MaterialKind.Steel || b === MaterialKind.Steel) return MaterialKind.Steel;
  return MaterialKind.Masonry;
}
