// Pure state for the driver's-eye picture-in-picture: it appears when something
// breaks near the blade and stays for a while after the last break, aimed at
// where the most recent breaks are. Kept free of three.js so the rules are
// unit-tested.

/** Break within this distance of the vehicle counts as "we struck it". */
export const PIP_TRIGGER_RADIUS = 30;
/** Keep showing the view this long after the last nearby break. */
export const PIP_HOLD_SECONDS = 6;

export interface PipState {
  /** Wall-clock seconds until which the view is shown (−∞ = hidden). */
  visibleUntil: number;
  /** Where to look: running centroid of recent breaks. */
  target: [number, number, number];
  /** Breaks folded into the target so far (decays so the aim follows the collapse). */
  weight: number;
}

export const HIDDEN_PIP: PipState = { visibleUntil: -Infinity, target: [0, 0, 0], weight: 0 };

/**
 * Fold this step's break events in. `events` is a flat array of [x, y, z, kind]
 * groups, `count` of them; `vehicle` is the vehicle's position.
 */
export function updatePip(
  state: PipState,
  now: number,
  dt: number,
  events: ArrayLike<number>,
  count: number,
  vehicle: readonly [number, number, number],
): PipState {
  // Forget old aim slowly so a climbing collapse front pulls the view upward.
  let weight = state.weight * Math.exp(-dt / 1.0);
  let [tx, ty, tz] = state.target;
  let visibleUntil = state.visibleUntil;
  for (let i = 0; i < count; i++) {
    const x = events[i * 4];
    const y = events[i * 4 + 1];
    const z = events[i * 4 + 2];
    const dx = x - vehicle[0];
    const dz = z - vehicle[2];
    if (dx * dx + dz * dz <= PIP_TRIGGER_RADIUS * PIP_TRIGGER_RADIUS) {
      visibleUntil = now + PIP_HOLD_SECONDS;
    }
    // Aim at all recent breaks (near or far — the collapse may climb away from the blade).
    const w = weight + 1;
    tx = (tx * weight + x) / w;
    ty = (ty * weight + y) / w;
    tz = (tz * weight + z) / w;
    weight = w;
  }
  return { visibleUntil, target: [tx, ty, tz], weight };
}

export const pipVisible = (state: PipState, now: number): boolean => now < state.visibleUntil;
