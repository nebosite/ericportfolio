// Three Ahead Chess — the equilibrium planner (the machine's top levels).
//
// Each round is a simultaneous-move game, so there is no single best plan —
// any fixed choice can be learned and punished (a human beat a deterministic
// level 10 every game with one rehearsed rush). This planner treats the round
// as the matrix game it is:
//
//   rows    = every sensible plan I could seal,
//   columns = every sensible plan the enemy could seal,
//   payoff  = ±1 for a decisive round (a king captured, or the NEXT round's
//             leader ending this one with the enemy king under attack),
//             otherwise a small material term,
//
// solves it by double oracle within the thinking budget, and SAMPLES its plan
// from the resulting equilibrium mixture. The exact start position uses the
// opening book computed offline by analysis/opening.ts over the full plan space.

import { Board, Order, Side, initialBoard } from "./chess";
import {
  BLACK,
  STATE_SIZE,
  WHITE,
  attacked,
  decodeOrder,
  enumeratePlans,
  execute,
  fromBoard,
  kingSquare,
  planOrder,
  resolve,
} from "./fast";
import { solveZeroSum, sampleMix } from "./nash";
import { BookEntry, OPENING_BOOK } from "./openingBook";
import { OPENING_BOOK_ALTERNATING } from "./openingBookAlternating";
import { levelBudgetMs, mulberry32, planOrdersDeep } from "./ai";

const MATERIAL = [0, 100, 320, 330, 500, 900, 0];

export interface NashOptions {
  /** Wall-clock budget in ms. */
  budgetMs: number;
  /** Under the first-to-seal house rule nobody knows who leads. */
  raceLead?: boolean;
  /** Explicit leads for this round and the next (e.g. alternating leads).
   *  Omitted: the standard rules, Ivory leads every round. */
  lead?: { first: Side; next: Side };
  /** Stop after this many double-oracle iterations (tests, determinism). */
  maxIterations?: number;
}

/** Material balance for `side` (fast state), in centipawns. */
function material(s: Int8Array, side: number): number {
  let score = 0;
  for (let i = 0; i < 32; i++) {
    const t = s[64 + i];
    if (t === 0) continue;
    score += s[160 + i] === side ? MATERIAL[t] : -MATERIAL[t];
  }
  return score;
}

/** Payoff to `me` for one pairing, from a fresh copy of `start`. */
function payoffFor(
  start: Int8Array,
  scratch: Int8Array,
  me: number,
  myPlan: number,
  theirPlan: number,
  first: number,
  nextLead: number,
  baseMaterial: number,
): number {
  scratch.set(start);
  const white = me === WHITE ? myPlan : theirPlan;
  const black = me === WHITE ? theirPlan : myPlan;
  const winner = resolve(scratch, white, black, first);
  if (winner !== 0) return (winner === 1) === (me === WHITE) ? 1 : -1;
  const them = 1 - me;
  if (nextLead === me) {
    const k = kingSquare(scratch, them);
    if (k >= 0 && attacked(scratch, k, me)) return 1;
  } else if (nextLead === them) {
    const k = kingSquare(scratch, me);
    if (k >= 0 && attacked(scratch, k, them)) return -1;
  }
  const delta = material(scratch, me) - baseMaterial;
  return Math.max(-0.3, Math.min(0.3, delta / 3000));
}

function isStartPosition(board: Board): boolean {
  const start = initialBoard();
  for (let sq = 0; sq < 64; sq++) {
    const a = board[sq];
    const b = start[sq];
    if (!a !== !b) return false;
    if (a && b && (a.id !== b.id || a.type !== b.type || a.hasMoved)) return false;
  }
  return true;
}

/** Sample a plan from an offline opening book. */
function fromBook(
  book: { ivory: BookEntry[]; onyx: BookEntry[] },
  side: Side,
  rng: () => number,
): Order[] | null {
  const mix = side === "white" ? book.ivory : book.onyx;
  if (mix.length === 0) return null;
  let r = rng();
  for (const entry of mix) {
    r -= entry.p;
    if (r <= 0) return entry.orders;
  }
  return mix[mix.length - 1].orders;
}

/**
 * Seal three orders by solving the round's matrix game and sampling the
 * equilibrium. Anytime: whatever mixture it holds when the budget runs out is
 * an equilibrium of the plans examined so far.
 */
export async function planOrdersNash(
  board: Board,
  side: Side,
  rng: () => number,
  opts: NashOptions,
): Promise<Order[] | null> {
  // Round 1 has an exact offline answer when the leads are known: Ivory
  // first, then Ivory again (standard) or Onyx (alternating).
  if (!opts.raceLead && isStartPosition(board) && (opts.lead?.first ?? "white") === "white") {
    const book = opts.lead?.next === "black" ? OPENING_BOOK_ALTERNATING : OPENING_BOOK;
    const plan = fromBook(book, side, rng);
    if (plan) return plan;
  }
  const deadline = Date.now() + opts.budgetMs;
  const pos = fromBoard(board);
  const start = pos.state;
  const me = side === "white" ? WHITE : BLACK;
  const them = 1 - me;
  const mine = enumeratePlans(start, me, false);
  const theirs = enumeratePlans(start, them, false);
  if (mine.length === 0 || theirs.length === 0) return null;
  const scratch = new Int8Array(STATE_SIZE);
  const baseMaterial = material(start, me);
  // [who leads this round, who leads the next]. Standard rules: Ivory both
  // times. Race rule: nobody knows, so average the two cases where one player
  // is quicker throughout. Explicit leads (alternating): exactly as given.
  const code = (s: Side) => (s === "white" ? WHITE : BLACK);
  const leads: [number, number][] = opts.lead
    ? [[code(opts.lead.first), code(opts.lead.next)]]
    : opts.raceLead
      ? [
          [WHITE, WHITE],
          [BLACK, BLACK],
        ]
      : [[WHITE, WHITE]];
  const pay = (r: number, c: number) => {
    let v = 0;
    for (const [first, next] of leads) {
      v += payoffFor(start, scratch, me, mine[r], theirs[c], first, next, baseMaterial);
    }
    return v / leads.length;
  };

  let yieldCounter = 0;
  const maybeYield = async () => {
    if (++yieldCounter % 4000 === 0) await new Promise((res) => setTimeout(res, 0));
  };
  const bestRow = async (colMix: { index: number; p: number }[]) => {
    let best = { index: 0, value: -Infinity };
    for (let r = 0; r < mine.length; r++) {
      let v = 0;
      for (const { index, p } of colMix) v += p * pay(r, index);
      if (v > best.value) best = { index: r, value: v };
      await maybeYield();
      if (Date.now() > deadline) break;
    }
    return best;
  };
  const bestCol = async (rowMix: { index: number; p: number }[]) => {
    let best = { index: 0, value: Infinity };
    for (let c = 0; c < theirs.length; c++) {
      let v = 0;
      for (const { index, p } of rowMix) v += p * pay(index, c);
      if (v < best.value) best = { index: c, value: v };
      await maybeYield();
      if (Date.now() > deadline) break;
    }
    return best;
  };

  const rows = [Math.floor(rng() * mine.length)];
  const cols = [Math.floor(rng() * theirs.length)];
  const matrix = [[pay(rows[0], cols[0])]];
  let sol = solveZeroSum(matrix);
  const maxIterations = opts.maxIterations ?? 200;
  for (let it = 0; it < maxIterations && Date.now() < deadline; it++) {
    const rowMix = rows.map((index, i) => ({ index, p: sol.row[i] })).filter((x) => x.p > 1e-9);
    const colMix = cols.map((index, j) => ({ index, p: sol.col[j] })).filter((x) => x.p > 1e-9);
    const rowReply = await bestRow(colMix);
    const colReply = await bestCol(rowMix);
    let grew = false;
    if (rowReply.value > sol.value + 1e-9 && !rows.includes(rowReply.index)) {
      rows.push(rowReply.index);
      matrix.push(cols.map((c) => pay(rowReply.index, c)));
      grew = true;
    }
    if (colReply.value < sol.value - 1e-9 && !cols.includes(colReply.index)) {
      cols.push(colReply.index);
      for (let i = 0; i < rows.length; i++) matrix[i].push(pay(rows[i], colReply.index));
      grew = true;
    }
    if (!grew) break;
    sol = solveZeroSum(matrix);
  }
  const pick = sampleMix(
    { support: rows.map((index, i) => ({ index, p: sol.row[i] })).filter((x) => x.p > 1e-9) },
    rng,
  );
  // Decode against the predicted board so each order's `from` is where the
  // piece will stand when it executes.
  const s = new Int8Array(STATE_SIZE);
  s.set(start);
  const orders: Order[] = [];
  for (let k = 0; k < 3; k++) {
    const o = planOrder(mine[pick], k);
    orders.push(decodeOrder({ state: s, ids: pos.ids }, o));
    execute(s, o);
  }
  return orders;
}

/** Levels 7–10 solve the round's game; below that the deep planner's single
 *  best guess is part of the charm (and beatable, as a mid level should be). */
export const NASH_MIN_LEVEL = 7;

/** The machine's plan at any level, honouring the level's thinking budget. */
export async function planMachine(
  board: Board,
  side: Side,
  level: number,
  opts: { raceLead?: boolean; rng?: () => number } = {},
): Promise<Order[]> {
  const rng = opts.rng ?? mulberry32(Date.now() & 0xffffffff);
  if (level >= NASH_MIN_LEVEL) {
    const plan = await planOrdersNash(board, side, rng, {
      budgetMs: levelBudgetMs(level),
      raceLead: opts.raceLead,
    });
    if (plan) return plan;
  }
  return planOrdersDeep(board, side, level, rng, { raceLead: opts.raceLead });
}
