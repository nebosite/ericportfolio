// pacFx.ts — pure math for Pac's halo glow and fading trail (framework-free).
//
// These make the tiny man easier to spot on a monitor-sized maze without adding
// any pressure: a soft amber halo that "breathes" at a slow, calming rate, and
// a gentle trail of fading dots left as he wanders. All the pixi/rendering
// coupling stays in engine.ts; this module is just the timing/fade arithmetic
// so it can be unit-tested with no DOM.

/** A dropped trail dot: where it was left and how much life (1→0) remains. */
export interface TrailNode {
  x: number;
  y: number;
  life: number; // 1 when freshly dropped, 0 when fully faded
}

export const TRAIL_LIFE_SEC = 0.55; // how long a trail dot takes to fade out
export const TRAIL_SPAWN_DIST = 6; // px of travel between dropped dots
export const TRAIL_MAX = 28; // safety cap on live dots
// A slow breath for the halo: ~0.35 Hz, well below anything that reads as a
// flash or a throb — calm, not attention-grabbing.
export const GLOW_PULSE_RATE = 2.2; // radians/sec
export const GLOW_BASE_ALPHA = 0.5;
export const GLOW_ALPHA_SWING = 0.12;
export const GLOW_SCALE_SWING = 0.08;

/** The halo's gentle breathing pulse at a given elapsed time (ms): a scale and
 *  alpha oscillating slowly around their baselines. */
export function glowPulse(elapsedMs: number): { scale: number; alpha: number } {
  const t = Math.sin((elapsedMs / 1000) * GLOW_PULSE_RATE); // -1..1
  return {
    scale: 1 + t * GLOW_SCALE_SWING,
    alpha: GLOW_BASE_ALPHA + t * GLOW_ALPHA_SWING,
  };
}

/** Should a fresh trail dot be dropped at (x,y)? True when Pac has travelled far
 *  enough from the last dot (or there is none), and we're under the cap. A big
 *  jump — e.g. wrapping through a tunnel — simply drops a new dot at the far
 *  side; dots never connect, so the wrap leaves no streak across the maze. */
export function shouldSpawnTrail(nodes: TrailNode[], x: number, y: number): boolean {
  if (nodes.length >= TRAIL_MAX) return false;
  const last = nodes[nodes.length - 1];
  if (!last) return true;
  return Math.hypot(x - last.x, y - last.y) >= TRAIL_SPAWN_DIST;
}

/** Age every trail dot by `dt` seconds, returning only the survivors (order
 *  preserved, oldest first). Does not mutate the input. */
export function advanceTrail(nodes: TrailNode[], dt: number): TrailNode[] {
  const decay = dt / TRAIL_LIFE_SEC;
  const alive: TrailNode[] = [];
  for (const n of nodes) {
    const life = n.life - decay;
    if (life > 0) alive.push({ x: n.x, y: n.y, life });
  }
  return alive;
}
