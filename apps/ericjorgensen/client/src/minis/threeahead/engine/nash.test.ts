import { describe, it, expect } from "vitest";
import { mulberry32 } from "./ai";
import { doubleOracle, sampleMix, solveZeroSum } from "./nash";

/** Check the equilibrium property directly: the row mixture guarantees at
 *  least `value` against every column, and the column mixture concedes at
 *  most `value` against every row. */
function assertEquilibrium(A: number[][], row: number[], col: number[], value: number) {
  for (let j = 0; j < A[0].length; j++) {
    let payoff = 0;
    for (let i = 0; i < A.length; i++) payoff += row[i] * A[i][j];
    expect(payoff).toBeGreaterThanOrEqual(value - 1e-7);
  }
  for (let i = 0; i < A.length; i++) {
    let payoff = 0;
    for (let j = 0; j < A[0].length; j++) payoff += col[j] * A[i][j];
    expect(payoff).toBeLessThanOrEqual(value + 1e-7);
  }
}

describe("solveZeroSum", () => {
  it("solves rock-paper-scissors: value 0, uniform play", () => {
    const A = [
      [0, -1, 1],
      [1, 0, -1],
      [-1, 1, 0],
    ];
    const s = solveZeroSum(A);
    expect(s.value).toBeCloseTo(0, 9);
    for (const p of [...s.row, ...s.col]) expect(p).toBeCloseTo(1 / 3, 9);
  });

  it("finds a pure saddle point", () => {
    const A = [
      [3, 5],
      [1, 2],
    ];
    const s = solveZeroSum(A);
    expect(s.value).toBeCloseTo(3, 9);
    expect(s.row[0]).toBeCloseTo(1, 9);
    expect(s.col[0]).toBeCloseTo(1, 9);
  });

  it("satisfies the equilibrium property on random games", () => {
    const rng = mulberry32(99);
    for (let t = 0; t < 30; t++) {
      const m = 2 + Math.floor(rng() * 12);
      const n = 2 + Math.floor(rng() * 12);
      const A = Array.from({ length: m }, () =>
        Array.from({ length: n }, () => Math.round(rng() * 6 - 3)),
      );
      const s = solveZeroSum(A);
      assertEquilibrium(A, s.row, s.col, s.value);
    }
  });
});

describe("doubleOracle", () => {
  it("matches the full solve on a large random game while touching few plans", () => {
    const rng = mulberry32(5);
    const m = 150;
    const n = 120;
    const A = Array.from({ length: m }, () =>
      Array.from({ length: n }, () => (rng() < 0.3 ? 1 : rng() < 0.4 ? -1 : 0)),
    );
    const full = solveZeroSum(A);
    const result = doubleOracle({
      payoff: (r, c) => A[r][c],
      bestRow: (colMix) => {
        let best = { index: 0, value: -Infinity };
        for (let r = 0; r < m; r++) {
          let v = 0;
          for (const { index, p } of colMix) v += p * A[r][index];
          if (v > best.value) best = { index: r, value: v };
        }
        return best;
      },
      bestCol: (rowMix) => {
        let best = { index: 0, value: Infinity };
        for (let c = 0; c < n; c++) {
          let v = 0;
          for (const { index, p } of rowMix) v += p * A[index][c];
          if (v < best.value) best = { index: c, value: v };
        }
        return best;
      },
      initialRow: 0,
      initialCol: 0,
    });
    expect(result.value).toBeCloseTo(full.value, 6);
    expect(result.upper - result.lower).toBeLessThan(1e-5);
  });

  it("samples plans in proportion to their probabilities", () => {
    const rng = mulberry32(1);
    const counts = [0, 0];
    const strategy = {
      support: [
        { index: 10, p: 0.25 },
        { index: 20, p: 0.75 },
      ],
    };
    for (let k = 0; k < 4000; k++) counts[sampleMix(strategy, rng) === 10 ? 0 : 1]++;
    expect(counts[0] / 4000).toBeCloseTo(0.25, 1);
  });
});
