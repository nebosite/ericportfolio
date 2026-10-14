// Pure mapping from what the simulation reports to how loud each sound layer
// should be. Kept free of Web Audio so the curves are unit-tested; the synth
// just applies these gains with smoothing.

export interface MixInputs {
  /** Vehicle speed (m/s, absolute). */
  speed: number;
  /** Top speed the engine layer should peak at (m/s). */
  topSpeed: number;
  /** Fraction of built parts currently awake (0..1). */
  awakeFraction: number;
  /** Joint failures in the last second. */
  breaksPerSecond: number;
}

export interface MixGains {
  engine: number;
  turbine: number;
  road: number;
  sub: number;
  roar: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Layer gains in 0..1. */
export function layerGains(input: MixInputs): MixGains {
  const s = clamp01(input.speed / Math.max(1, input.topSpeed));
  return {
    engine: 0.18 + 0.22 * s, // always on: the machine is alive even at idle
    turbine: 0.3 * s * s,
    road: 0.5 * s,
    sub: 0.9 * clamp01(input.awakeFraction * 3),
    // 10 breaks/s → 0.3, 1000 → 1.0 (log scale, as the designer specified).
    roar:
      input.breaksPerSecond <= 0
        ? 0
        : clamp01(0.3 + (0.7 * Math.log10(input.breaksPerSecond / 10)) / 2),
  };
}

/** Engine pitch (Hz) from speed: a low idle rising with the drivetrain. */
export function engineHz(speed: number, topSpeed: number): number {
  return 40 + 70 * clamp01(speed / Math.max(1, topSpeed));
}

/** Turbine whine pitch (Hz). */
export function turbineHz(speed: number, topSpeed: number): number {
  return 800 + 1600 * clamp01(speed / Math.max(1, topSpeed));
}

/**
 * Impact thud strength 0..1 from a one-step speed drop (m/s): a 5 m/s loss is a
 * full-strength hit; small bumps are inaudible.
 */
export function thudStrength(speedDrop: number): number {
  if (speedDrop < 0.8) return 0;
  return clamp01(speedDrop / 5);
}

/** Exponential smoothing toward a target, framerate-independent. */
export function smooth(current: number, target: number, dt: number, timeConstant: number): number {
  const a = 1 - Math.exp(-dt / Math.max(1e-3, timeConstant));
  return current + (target - current) * a;
}
