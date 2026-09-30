// Three Ahead Chess — solving the round as the game it really is.
//
// A round is a SIMULTANEOUS-move game: both players seal a plan without seeing
// the other's. Such games generally have no best single plan — only a best
// MIXTURE of plans (a Nash equilibrium), because any fixed choice can be
// learned and punished. (A human proved it: a level-10 Onyx that always chose
// the same defense lost every time to one rehearsed rush.)
//
// solveZeroSum finds the equilibrium of a small payoff matrix exactly (simplex).
// doubleOracle scales that to plan spaces with hundreds of thousands of plans:
// it solves the game restricted to a few plans per side, asks each side for
// its best reply to the other's current mixture, adds any reply that improves
// on the restricted value, and repeats until neither side can improve — at
// which point the restricted equilibrium is an equilibrium of the whole game.

export interface MixedStrategy {
  /** Indices into the player's plan pool, with their probabilities. */
  support: { index: number; p: number }[];
}

export interface ZeroSumSolution {
  row: number[]; // row player's (maximizer's) probabilities
  col: number[]; // column player's (minimizer's) probabilities
  value: number; // expected payoff to the row player
}

/** Exact equilibrium of a zero-sum matrix game (row player maximizes). */
export function solveZeroSum(A: number[][]): ZeroSumSolution {
  const m = A.length;
  const n = A[0].length;
  let min = Infinity;
  for (const r of A) for (const v of r) if (v < min) min = v;
  const shift = 1 - min; // make every entry ≥ 1 so the game value is positive
  // Column player's LP: maximize Σy subject to A'y ≤ 1, y ≥ 0.
  // Tableau: m constraint rows + objective row; n structural + m slack cols.
  const width = n + m + 1;
  const T: Float64Array[] = [];
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(width);
    for (let j = 0; j < n; j++) row[j] = A[i][j] + shift;
    row[n + i] = 1;
    row[width - 1] = 1;
    T.push(row);
  }
  const obj = new Float64Array(width);
  for (let j = 0; j < n; j++) obj[j] = -1;
  T.push(obj);
  const basis = Array.from({ length: m }, (_, i) => n + i);
  const EPS = 1e-12;
  let stall = 0;
  let lastObjective = -Infinity;
  for (let iter = 0; iter < 200_000; iter++) {
    // Dantzig's rule (steepest reduced cost) is fast; if the objective stalls
    // (degenerate pivots), fall back to Bland's rule, which cannot cycle.
    let enter = -1;
    if (stall < 50) {
      let most = -1e-10;
      for (let j = 0; j < width - 1; j++) {
        if (T[m][j] < most) {
          most = T[m][j];
          enter = j;
        }
      }
    } else {
      for (let j = 0; j < width - 1; j++) {
        if (T[m][j] < -1e-10) {
          enter = j;
          break;
        }
      }
    }
    if (enter < 0) break;
    if (T[m][width - 1] > lastObjective + 1e-12) {
      lastObjective = T[m][width - 1];
      stall = 0;
    } else stall++;
    let leave = -1;
    let best = Infinity;
    for (let i = 0; i < m; i++) {
      const a = T[i][enter];
      if (a > EPS) {
        const ratio = T[i][width - 1] / a;
        if (ratio < best - 1e-15 || (Math.abs(ratio - best) <= 1e-15 && basis[i] < basis[leave])) {
          best = ratio;
          leave = i;
        }
      }
    }
    if (leave < 0) throw new Error("unbounded game LP (should be impossible)");
    const pivot = T[leave][enter];
    const prow = T[leave];
    for (let j = 0; j < width; j++) prow[j] /= pivot;
    for (let i = 0; i <= m; i++) {
      if (i === leave) continue;
      const factor = T[i][enter];
      if (factor === 0) continue;
      const row = T[i];
      for (let j = 0; j < width; j++) row[j] -= factor * prow[j];
    }
    basis[leave] = enter;
  }
  const total = T[m][width - 1]; // = Σy at optimum = 1 / shifted value
  const shiftedValue = 1 / total;
  const col = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) col[basis[i]] = T[i][width - 1] * shiftedValue;
  const row = new Array(m).fill(0);
  for (let i = 0; i < m; i++) row[i] = Math.max(0, T[m][n + i]) * shiftedValue;
  return { row: normalize(row), col: normalize(col), value: shiftedValue - shift };
}

function normalize(p: number[]): number[] {
  const s = p.reduce((a, b) => a + b, 0);
  return s > 0 ? p.map((v) => v / s) : p.map(() => 1 / p.length);
}

export interface DoubleOracleProblem {
  /** Payoff to the row player when row plan r meets column plan c. */
  payoff(r: number, c: number): number;
  /** Best row plan against a column mixture: its index and expected payoff. */
  bestRow(colMix: { index: number; p: number }[]): { index: number; value: number };
  /** Best column plan against a row mixture: its index and expected payoff. */
  bestCol(rowMix: { index: number; p: number }[]): { index: number; value: number };
  initialRow: number;
  initialCol: number;
}

export interface DoubleOracleResult {
  row: MixedStrategy;
  col: MixedStrategy;
  /** The restricted game's value — the equilibrium value once converged. */
  value: number;
  /** Proven bounds on the true game value: lower = what the row mixture
   *  guarantees against ANY column plan, upper = likewise for the column. */
  lower: number;
  upper: number;
  iterations: number;
}

export function doubleOracle(
  problem: DoubleOracleProblem,
  opts: { epsilon?: number; maxIterations?: number; deadline?: number } = {},
): DoubleOracleResult {
  const epsilon = opts.epsilon ?? 1e-6;
  const maxIterations = opts.maxIterations ?? 500;
  const rows = [problem.initialRow];
  const cols = [problem.initialCol];
  const matrix: number[][] = [[problem.payoff(rows[0], cols[0])]];
  let solution = solveZeroSum(matrix);
  let lower = -Infinity;
  let upper = Infinity;
  let bestRowMix = mix(rows, solution.row);
  let bestColMix = mix(cols, solution.col);
  let iterations = 0;
  for (; iterations < maxIterations; iterations++) {
    const rowMix = mix(rows, solution.row);
    const colMix = mix(cols, solution.col);
    const rowReply = problem.bestRow(colMix);
    const colReply = problem.bestCol(rowMix);
    // The row mixture guarantees colReply.value; the column mixture caps the
    // row player at rowReply.value. Keep the best guarantees seen so far.
    if (colReply.value > lower) {
      lower = colReply.value;
      bestRowMix = rowMix;
    }
    if (rowReply.value < upper) {
      upper = rowReply.value;
      bestColMix = colMix;
    }
    if (upper - lower <= epsilon) break;
    if (opts.deadline !== undefined && Date.now() > opts.deadline) break;
    let grew = false;
    if (rowReply.value > solution.value + epsilon && !rows.includes(rowReply.index)) {
      rows.push(rowReply.index);
      matrix.push(cols.map((c) => problem.payoff(rowReply.index, c)));
      grew = true;
    }
    if (colReply.value < solution.value - epsilon && !cols.includes(colReply.index)) {
      cols.push(colReply.index);
      for (let i = 0; i < rows.length; i++) matrix[i].push(problem.payoff(rows[i], colReply.index));
      grew = true;
    }
    if (!grew) break;
    solution = solveZeroSum(matrix);
  }
  return {
    row: { support: bestRowMix },
    col: { support: bestColMix },
    value: solution.value,
    lower,
    upper,
    iterations,
  };
}

function mix(pool: number[], probs: number[]): { index: number; p: number }[] {
  const out: { index: number; p: number }[] = [];
  for (let i = 0; i < pool.length; i++)
    if (probs[i] > 1e-9) out.push({ index: pool[i], p: probs[i] });
  return out;
}

/** Draw one plan index from a mixed strategy. */
export function sampleMix(strategy: MixedStrategy, rng: () => number): number {
  let r = rng();
  for (const { index, p } of strategy.support) {
    r -= p;
    if (r <= 0) return index;
  }
  return strategy.support[strategy.support.length - 1].index;
}
