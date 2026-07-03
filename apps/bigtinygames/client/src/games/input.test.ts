import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { attachGameInput } from "./input";

// The gamepad poll runs on rAF; stub the API so it's inert and we can focus on
// the keyboard path (the part that drives play on a desktop).
beforeEach(() => {
  Object.defineProperty(navigator, "getGamepads", {
    value: () => [],
    configurable: true,
  });
});

let detach: (() => void) | null = null;
afterEach(() => {
  detach?.();
  detach = null;
});

function press(key: string): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, cancelable: true });
  window.dispatchEvent(ev);
  return ev;
}

describe("attachGameInput — keyboard", () => {
  it("maps the arrow keys to unit direction vectors", () => {
    const onDirection = vi.fn();
    detach = attachGameInput({ onDirection });
    press("ArrowUp");
    press("ArrowDown");
    press("ArrowLeft");
    press("ArrowRight");
    expect(onDirection.mock.calls.map((c) => c[0])).toEqual([
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("maps WASD (any case) to the same directions", () => {
    const onDirection = vi.fn();
    detach = attachGameInput({ onDirection });
    press("w");
    press("S");
    press("a");
    press("D");
    expect(onDirection.mock.calls.map((c) => c[0])).toEqual([
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("fires onConfirm for Enter and Space", () => {
    const onConfirm = vi.fn();
    detach = attachGameInput({ onConfirm });
    press("Enter");
    press(" ");
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  it("ignores keys that are not bound", () => {
    const onDirection = vi.fn();
    const onConfirm = vi.fn();
    detach = attachGameInput({ onDirection, onConfirm });
    press("q");
    press("Shift");
    expect(onDirection).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("calls preventDefault for handled keys", () => {
    detach = attachGameInput({ onDirection: vi.fn(), onConfirm: vi.fn() });
    expect(press("ArrowUp").defaultPrevented).toBe(true);
    expect(press("Enter").defaultPrevented).toBe(true);
  });

  it("stops responding after the returned cleanup runs", () => {
    const onDirection = vi.fn();
    const off = attachGameInput({ onDirection });
    off();
    press("ArrowUp");
    expect(onDirection).not.toHaveBeenCalled();
  });
});
