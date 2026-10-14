// Pure mortar-failure rule. The physics engine reports, for every glue joint, the
// impulse it had to apply this step to hold the two parts together (λ, in N·s,
// applied to part b). Divided by the step it is a force; compared against the
// joint's face area it is a stress. Mortar fails in tension, in shear, and in
// bending (a moment becomes edge tension across the lever arm). Compression
// never fails — masonry is strong in compression and we would rather a wall
// crush-proof than pop under its own weight.
//
// Nothing here is scripted: a joint breaks only because the solver measured a
// force beyond what mortar of this strength could carry.

export interface ConnectionStrength {
  /** Tensile strength across the face (Pa). Masonry mortar: ~0.2–0.6 MPa. */
  tensile: number;
  /** Shear strength across the face (Pa). */
  shear: number;
  /** Explicit moment capacity (N·m) for connections that aren't a face in tension
   *  (a beam's shear tab); derived from tensile × section modulus when absent. */
  moment?: number;
  /** Compressive (squash) strength across the face (Pa). Absent = unbreakable in
   *  compression, which suits masonry; a steel splice gets its section's squash
   *  load so a dropped stack can crush instead of sitting on its stubs. */
  compressive?: number;
}

/** Slice-1 name for the same thing: masonry joints are connections too. */
export type MortarStrength = ConnectionStrength;

/**
 * Default strengths — the upper end of real masonry mortar (codes put flexural
 * bond at 0.2–0.7 MPa). Why the upper end: an iterative solver distributes a
 * tall stack's weight through its redundant joints imperfectly, and that error
 * shows up as internal tension that scales with height — roughly doubled for a
 * few steps when a sleeping island is woken by a single touch. Measured on an
 * 18–20 course tower of 250 kg blocks nudged awake, it peaks near 0.5 MPa-
 * equivalent; at 0.3 MPa that sheds dozens of joints nothing physical loaded.
 * The headless tests print the peak utilisation of a standing structure so the
 * margin is measured, not assumed.
 */
export const DEFAULT_STRENGTH: MortarStrength = { tensile: 0.6e6, shear: 0.9e6 };

export interface JointLoad {
  /** Tension force across the joint (N); negative means compression. */
  tension: number;
  /** In-plane shear force (N). */
  shear: number;
  /** Bending moment (N·m). */
  moment: number;
}

/**
 * Decompose a joint's accumulated impulse into tension / shear / moment.
 * `lambda` is the positional impulse on part b (world axes), `lambdaRot` the
 * rotational impulse, `normal` the unit vector from a to b, `dt` the step.
 * Compression pushes b away from a (λ·n > 0), so tension is the negative part.
 */
export function jointLoad(
  lambda: readonly [number, number, number],
  lambdaRot: readonly [number, number, number],
  normal: readonly [number, number, number],
  dt: number,
): JointLoad {
  const along = lambda[0] * normal[0] + lambda[1] * normal[1] + lambda[2] * normal[2];
  const sx = lambda[0] - along * normal[0];
  const sy = lambda[1] - along * normal[1];
  const sz = lambda[2] - along * normal[2];
  return {
    tension: -along / dt,
    shear: Math.hypot(sx, sy, sz) / dt,
    moment: Math.hypot(lambdaRot[0], lambdaRot[1], lambdaRot[2]) / dt,
  };
}

/**
 * Whether mortar of the given strength fails under `load` on a joint of face
 * `area` (m²) whose half-depth across the bending axis is `lever` (m).
 *
 * Bending stress at the face's edge is M / Z. For a rectangular face of width w
 * and depth d = 2·lever, Z = w·d²/6 = area·lever/3, so the moment adds
 * 3·M / lever of equivalent edge force to the direct tension before comparing
 * against tensile strength × area.
 */
export function mortarFails(
  load: JointLoad,
  area: number,
  lever: number,
  strength: MortarStrength = DEFAULT_STRENGTH,
): boolean {
  return mortarUtilisation(load, area, lever, strength) > 1;
}

/**
 * How hard the joint is working: the larger of edge-tension / tensile capacity
 * and shear / shear capacity. 1.0 is the point of failure.
 */
export function mortarUtilisation(
  load: JointLoad,
  area: number,
  lever: number,
  strength: MortarStrength = DEFAULT_STRENGTH,
): number {
  const tensileCapacity = strength.tensile * area;
  // Section modulus of a rectangular face: Z = area·lever/3, so M_cap = σ_t·Z.
  const momentCapacity = strength.moment ?? (tensileCapacity * lever) / 3;
  const tensile = Math.max(0, load.tension) / tensileCapacity + load.moment / momentCapacity;
  const shear = load.shear / (strength.shear * area);
  const compression =
    strength.compressive === undefined
      ? 0
      : Math.max(0, -load.tension) / (strength.compressive * area);
  return Math.max(tensile, shear, compression);
}
