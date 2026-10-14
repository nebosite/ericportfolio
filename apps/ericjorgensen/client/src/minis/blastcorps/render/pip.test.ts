import { describe, it, expect } from "vitest";
import { HIDDEN_PIP, PIP_HOLD_SECONDS, PIP_TRIGGER_RADIUS, pipVisible, updatePip } from "./pip";

const vehicle: [number, number, number] = [0, 0, 0];

describe("updatePip", () => {
  it("stays hidden with no breaks", () => {
    const s = updatePip(HIDDEN_PIP, 10, 1 / 60, [], 0, vehicle);
    expect(pipVisible(s, 10)).toBe(false);
  });

  it("shows on a break near the vehicle and hides after the hold", () => {
    const events = [5, 2, 5, 1];
    const s = updatePip(HIDDEN_PIP, 10, 1 / 60, events, 1, vehicle);
    expect(pipVisible(s, 10)).toBe(true);
    expect(pipVisible(s, 10 + PIP_HOLD_SECONDS - 0.1)).toBe(true);
    expect(pipVisible(s, 10 + PIP_HOLD_SECONDS + 0.1)).toBe(false);
  });

  it("ignores far breaks for the trigger but still aims at them", () => {
    const far = PIP_TRIGGER_RADIUS * 3;
    const s = updatePip(HIDDEN_PIP, 10, 1 / 60, [far, 20, 0, 2], 1, vehicle);
    expect(pipVisible(s, 10)).toBe(false);
    expect(s.target).toEqual([far, 20, 0]);
  });

  it("aims at the centroid of recent breaks and lets the aim drift toward new ones", () => {
    let s = updatePip(HIDDEN_PIP, 0, 1 / 60, [0, 0, 10, 1, 0, 10, 10, 1], 2, vehicle);
    expect(s.target).toEqual([0, 5, 10]);
    // A second later with no breaks the weight decays; the next break pulls the aim strongly.
    s = updatePip(s, 1, 1, [], 0, vehicle);
    s = updatePip(s, 1, 1 / 60, [0, 40, 10, 1], 1, vehicle);
    expect(s.target[1]).toBeGreaterThan(20);
  });
});
