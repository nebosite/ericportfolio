import { describe, it, expect } from "vitest";
import { engineHz, layerGains, smooth, thudStrength, turbineHz } from "./mix";

describe("layerGains", () => {
  it("keeps the engine audible at idle and raises everything with speed", () => {
    const idle = layerGains({ speed: 0, topSpeed: 55, awakeFraction: 0, breaksPerSecond: 0 });
    expect(idle.engine).toBeGreaterThan(0.1);
    expect(idle.turbine).toBe(0);
    expect(idle.road).toBe(0);
    expect(idle.sub).toBe(0);
    expect(idle.roar).toBe(0);
    const fast = layerGains({ speed: 55, topSpeed: 55, awakeFraction: 0, breaksPerSecond: 0 });
    expect(fast.engine).toBeGreaterThan(idle.engine);
    expect(fast.turbine).toBeGreaterThan(0.25);
    expect(fast.road).toBeCloseTo(0.5);
  });

  it("scales the sub rumble with the awake fraction and clamps", () => {
    expect(
      layerGains({ speed: 0, topSpeed: 55, awakeFraction: 0.1, breaksPerSecond: 0 }).sub,
    ).toBeCloseTo(0.27);
    expect(
      layerGains({ speed: 0, topSpeed: 55, awakeFraction: 0.9, breaksPerSecond: 0 }).sub,
    ).toBeCloseTo(0.9);
  });

  it("maps breaks per second to the roar on a log scale: 10 → 0.3, 1000 → 1.0", () => {
    const at = (b: number) =>
      layerGains({ speed: 0, topSpeed: 55, awakeFraction: 0, breaksPerSecond: b }).roar;
    expect(at(10)).toBeCloseTo(0.3);
    expect(at(1000)).toBeCloseTo(1.0);
    expect(at(100)).toBeGreaterThan(0.3);
    expect(at(100)).toBeLessThan(1.0);
    expect(at(1)).toBeLessThan(0.3);
    expect(at(0)).toBe(0);
  });
});

describe("pitches and thuds", () => {
  it("raise pitch with speed", () => {
    expect(engineHz(0, 55)).toBe(40);
    expect(engineHz(55, 55)).toBe(110);
    expect(turbineHz(27.5, 55)).toBe(1600);
  });

  it("ignores small bumps and saturates at a 5 m/s loss", () => {
    expect(thudStrength(0.5)).toBe(0);
    expect(thudStrength(2.5)).toBeCloseTo(0.5);
    expect(thudStrength(50)).toBe(1);
  });

  it("smooths toward a target independent of framerate", () => {
    const one = smooth(0, 1, 0.5, 0.25);
    const two = smooth(smooth(0, 1, 0.25, 0.25), 1, 0.25, 0.25);
    expect(one).toBeCloseTo(two, 5);
    expect(one).toBeGreaterThan(0.8);
  });
});
