// Pure control merging: keyboard state and gamepad state → one DriveControls.
// One throttle, one brake: W/↑ or the right trigger drive forward; S/↓ or the
// left trigger brake while rolling forward and reverse once stopped; Space or
// the A button is the handbrake. Whichever source is more insistent wins, so a
// player can mix a keyboard and a pad without either fighting the other.

import type { DriveControls } from "../sim/protocol";

export interface KeyState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  /** Slow-motion hold (Shift / LB): the solver keeps stepping, time just stretches. */
  slow: boolean;
}

export const NO_KEYS: KeyState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  slow: false,
};

export interface PadState {
  /** Left stick X, −1..1 (right positive). */
  steer: number;
  /** Right trigger 0..1. */
  accelerate: number;
  /** Left trigger 0..1. */
  decelerate: number;
  handbrake: boolean;
  /** LB held: slow motion. */
  slow: boolean;
}

export const NO_PAD: PadState = {
  steer: 0,
  accelerate: 0,
  decelerate: 0,
  handbrake: false,
  slow: false,
};

/** Stick dead zone; below this the stick reads as centred. */
export const DEAD_ZONE = 0.12;
/** Forward speed (m/s) above which "back" means brake rather than reverse. */
export const REVERSE_BELOW_MPS = 0.6;

/** Apply a radial dead zone and rescale so full deflection still reads 1. */
export function deadZone(value: number, zone = DEAD_ZONE): number {
  const mag = Math.abs(value);
  if (mag < zone) return 0;
  return Math.sign(value) * Math.min(1, (mag - zone) / (1 - zone));
}

/**
 * Merge both sources given the vehicle's current forward speed (m/s, negative
 * when rolling backwards) — needed to decide whether "back" brakes or reverses.
 */
export function mergeControls(keys: KeyState, pad: PadState, forwardSpeed: number): DriveControls {
  const accel = Math.max(keys.forward ? 1 : 0, clamp01(pad.accelerate));
  const decel = Math.max(keys.back ? 1 : 0, clamp01(pad.decelerate));
  const keySteer = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const padSteer = deadZone(pad.steer);
  // Analog deflection is the more deliberate signal, so the stick wins ties.
  const steer = Math.abs(padSteer) >= Math.abs(keySteer) && padSteer !== 0 ? padSteer : keySteer;

  let throttle = accel;
  let brake = 0;
  if (decel > 0) {
    if (forwardSpeed > REVERSE_BELOW_MPS) {
      brake = decel; // rolling forward: slow down first
    } else {
      throttle = -decel; // stopped (or already reversing): back up
    }
  }
  if (accel > 0 && decel > 0 && forwardSpeed <= REVERSE_BELOW_MPS) {
    throttle = accel - decel; // both held while stopped: they cancel
  }
  return {
    throttle: clamp(throttle, -1, 1),
    steer: clamp(steer, -1, 1),
    brake,
    handbrake: keys.handbrake || pad.handbrake ? 1 : 0,
  };
}

/** Standard-mapping gamepad → PadState. Pure so it can be fed fake pads. */
export function readPad(pad: {
  axes: readonly number[];
  buttons: readonly { value: number; pressed: boolean }[];
}): PadState {
  const button = (i: number) => pad.buttons[i] ?? { value: 0, pressed: false };
  return {
    steer: pad.axes[0] ?? 0,
    accelerate: button(7).value, // RT
    decelerate: button(6).value, // LT
    handbrake: button(0).pressed, // A / Cross
    slow: button(4).pressed, // LB
  };
}

/** Buttons with one-shot meaning, read by the page rather than the vehicle. */
export const PAD_BUTTON = { start: 9, back: 8, a: 0, b: 1, lb: 4 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);
