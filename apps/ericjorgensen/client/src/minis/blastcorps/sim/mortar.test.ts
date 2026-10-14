import { describe, it, expect } from "vitest";
import { DEFAULT_STRENGTH, jointLoad, mortarFails } from "./mortar";

const DT = 1 / 60;
const AREA = 0.25; // half-brick overlap, 0.5 × 0.5 m
const LEVER = 0.25;

describe("jointLoad", () => {
  it("reads a push on b away from a as compression (negative tension)", () => {
    // Stacked bricks: a below, b above, λ on b points up = the solver holding b up.
    const load = jointLoad([0, 2450 * DT, 0], [0, 0, 0], [0, 1, 0], DT);
    expect(load.tension).toBeCloseTo(-2450, 0);
    expect(load.shear).toBeCloseTo(0);
  });

  it("reads a pull on b toward a as tension", () => {
    // a above, b hanging below (normal −y), λ on b points up = being held from falling.
    const load = jointLoad([0, 2450 * DT, 0], [0, 0, 0], [0, -1, 0], DT);
    expect(load.tension).toBeCloseTo(2450, 0);
  });

  it("separates shear from the normal component and reports the moment", () => {
    const load = jointLoad([3 * DT, 4 * DT, 0], [0, 0, 6 * DT], [1, 0, 0], DT);
    expect(load.tension).toBeCloseTo(-3);
    expect(load.shear).toBeCloseTo(4);
    expect(load.moment).toBeCloseTo(6);
  });
});

describe("mortarFails", () => {
  it("holds a brick's weight in tension with a large margin", () => {
    expect(mortarFails({ tension: 2450, shear: 0, moment: 0 }, AREA, LEVER)).toBe(false);
  });

  it("fails just past the tensile strength × area", () => {
    const limit = DEFAULT_STRENGTH.tensile * AREA;
    expect(mortarFails({ tension: limit * 0.99, shear: 0, moment: 0 }, AREA, LEVER)).toBe(false);
    expect(mortarFails({ tension: limit * 1.01, shear: 0, moment: 0 }, AREA, LEVER)).toBe(true);
  });

  it("fails in shear independently of tension", () => {
    const limit = DEFAULT_STRENGTH.shear * AREA;
    expect(mortarFails({ tension: -1e9, shear: limit * 1.01, moment: 0 }, AREA, LEVER)).toBe(true);
  });

  it("turns a bending moment into edge stress through the section modulus (M/Z, Z = A·lever/3)", () => {
    const sectionModulus = (AREA * LEVER) / 3;
    const momentLimit = DEFAULT_STRENGTH.tensile * sectionModulus;
    expect(mortarFails({ tension: 0, shear: 0, moment: momentLimit * 1.01 }, AREA, LEVER)).toBe(
      true,
    );
    expect(mortarFails({ tension: 0, shear: 0, moment: momentLimit * 0.9 }, AREA, LEVER)).toBe(
      false,
    );
  });

  it("never fails in pure compression, however large", () => {
    expect(mortarFails({ tension: -1e12, shear: 0, moment: 0 }, AREA, LEVER)).toBe(false);
  });

  it("respects a custom strength", () => {
    const weak = { tensile: 1, shear: 1 };
    expect(mortarFails({ tension: 10, shear: 0, moment: 0 }, AREA, LEVER, weak)).toBe(true);
  });
});
