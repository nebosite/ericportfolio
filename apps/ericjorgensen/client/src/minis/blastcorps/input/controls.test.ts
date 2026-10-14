import { describe, it, expect } from "vitest";
import {
  DEAD_ZONE,
  NO_KEYS,
  NO_PAD,
  REVERSE_BELOW_MPS,
  deadZone,
  mergeControls,
  readPad,
} from "./controls";

describe("deadZone", () => {
  it("zeroes small deflections and rescales the rest to reach 1", () => {
    expect(deadZone(DEAD_ZONE / 2)).toBe(0);
    expect(deadZone(-DEAD_ZONE / 2)).toBe(0);
    expect(deadZone(1)).toBe(1);
    expect(deadZone(-1)).toBe(-1);
    expect(deadZone((1 + DEAD_ZONE) / 2)).toBeCloseTo(0.5);
  });
});

describe("mergeControls — keyboard", () => {
  it("is idle with nothing held", () => {
    expect(mergeControls(NO_KEYS, NO_PAD, 0)).toEqual({
      throttle: 0,
      steer: 0,
      brake: 0,
      handbrake: 0,
    });
  });

  it("drives forward on W and steers with A/D", () => {
    const c = mergeControls({ ...NO_KEYS, forward: true, right: true }, NO_PAD, 5);
    expect(c.throttle).toBe(1);
    expect(c.steer).toBe(1);
    expect(mergeControls({ ...NO_KEYS, left: true }, NO_PAD, 0).steer).toBe(-1);
  });

  it("brakes on S while rolling forward, reverses once stopped", () => {
    const rolling = mergeControls({ ...NO_KEYS, back: true }, NO_PAD, REVERSE_BELOW_MPS + 1);
    expect(rolling.brake).toBe(1);
    expect(rolling.throttle).toBe(0);
    const stopped = mergeControls({ ...NO_KEYS, back: true }, NO_PAD, 0);
    expect(stopped.brake).toBe(0);
    expect(stopped.throttle).toBe(-1);
    // Already reversing: keep reversing, don't brake.
    expect(mergeControls({ ...NO_KEYS, back: true }, NO_PAD, -3).throttle).toBe(-1);
  });

  it("cancels W and S when both are held at rest", () => {
    expect(mergeControls({ ...NO_KEYS, forward: true, back: true }, NO_PAD, 0).throttle).toBe(0);
  });

  it("pulls the handbrake on Space", () => {
    expect(mergeControls({ ...NO_KEYS, handbrake: true }, NO_PAD, 0).handbrake).toBe(1);
  });
});

describe("mergeControls — gamepad", () => {
  it("maps the right trigger to throttle and the stick to steering", () => {
    const c = mergeControls(NO_KEYS, { ...NO_PAD, accelerate: 0.6, steer: -1 }, 0);
    expect(c.throttle).toBeCloseTo(0.6);
    expect(c.steer).toBe(-1);
  });

  it("maps the left trigger to brake (rolling) or reverse (stopped)", () => {
    expect(mergeControls(NO_KEYS, { ...NO_PAD, decelerate: 0.5 }, 10).brake).toBeCloseTo(0.5);
    expect(mergeControls(NO_KEYS, { ...NO_PAD, decelerate: 0.5 }, 0).throttle).toBeCloseTo(-0.5);
  });

  it("lets the more insistent source win and ignores stick noise", () => {
    const c = mergeControls(
      { ...NO_KEYS, forward: true, left: true },
      { ...NO_PAD, accelerate: 0.3, steer: DEAD_ZONE / 2 },
      0,
    );
    expect(c.throttle).toBe(1);
    expect(c.steer).toBe(-1);
    const padWins = mergeControls({ ...NO_KEYS, left: true }, { ...NO_PAD, steer: 1 }, 0);
    expect(padWins.steer).toBe(1);
  });

  it("clamps out-of-range trigger values", () => {
    expect(mergeControls(NO_KEYS, { ...NO_PAD, accelerate: 7 }, 0).throttle).toBe(1);
  });
});

describe("readPad", () => {
  it("reads a standard-mapping pad: axis 0 steer, LT/RT triggers, A handbrake", () => {
    const buttons = Array.from({ length: 17 }, () => ({ value: 0, pressed: false }));
    buttons[7] = { value: 0.8, pressed: true };
    buttons[6] = { value: 0.2, pressed: true };
    buttons[0] = { value: 1, pressed: true };
    buttons[4] = { value: 1, pressed: true };
    expect(readPad({ axes: [0.4, 0, 0, 0], buttons })).toEqual({
      steer: 0.4,
      accelerate: 0.8,
      decelerate: 0.2,
      handbrake: true,
      slow: true,
    });
  });

  it("tolerates pads with fewer buttons", () => {
    expect(readPad({ axes: [], buttons: [] })).toEqual({
      steer: 0,
      accelerate: 0,
      decelerate: 0,
      handbrake: false,
      slow: false,
    });
  });
});
