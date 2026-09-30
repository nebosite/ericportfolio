import { describe, it, expect } from "vitest";
import { Board, Order, cloneBoard, initialBoard, resolveRound } from "./chess";
import { isAttacked, mulberry32 } from "./ai";
import {
  BLACK,
  STATE_SIZE,
  WHITE,
  attacked,
  decodeOrder,
  enumeratePlans,
  execute,
  fromBoard,
  orderSpace,
  packPlan,
  planOrder,
  resolve,
  toBoard,
} from "./fast";

// chess.ts is the source of truth; the fast engine must agree with it on
// every rule. These tests play thousands of random rounds through both.

/** A random full-space plan for `side`, drawn on the player's own predicted
 *  board (each order applied unopposed before choosing the next). */
function randomPlan(board: Board, side: number, rng: () => number): number {
  const s = new Int8Array(STATE_SIZE);
  s.set(fromBoard(board).state);
  const orders: number[] = [];
  for (let k = 0; k < 3; k++) {
    const space = orderSpace(s, side, true);
    const o = space[Math.floor(rng() * space.length)];
    orders.push(o);
    execute(s, o);
  }
  return packPlan(orders[0], orders[1], orders[2]);
}

function toOrders(board: Board, plan: number): Order[] {
  const pos = fromBoard(board);
  // decodeOrder needs the piece's CURRENT square only for display; execution
  // uses pieceId + to + capture, which is all that matters here.
  return [0, 1, 2].map((i) => decodeOrder(pos, planOrder(plan, i)));
}

function sameBoard(a: Board, b: Board): boolean {
  for (let sq = 0; sq < 64; sq++) {
    const x = a[sq];
    const y = b[sq];
    if (!x !== !y) return false;
    if (x && y && (x.id !== y.id || x.type !== y.type || x.hasMoved !== y.hasMoved)) return false;
  }
  return true;
}

describe("fast engine parity with chess.ts", () => {
  it("resolves thousands of random full-space rounds identically", () => {
    const rng = mulberry32(2026);
    let board = initialBoard();
    let checked = 0;
    for (let game = 0; game < 60; game++) {
      board = initialBoard();
      for (let round = 0; round < 25; round++) {
        const w = randomPlan(board, WHITE, rng);
        const b = randomPlan(board, BLACK, rng);
        const first = rng() < 0.5 ? WHITE : BLACK;
        const slow = resolveRound(
          board,
          toOrders(board, w),
          toOrders(board, b),
          first === WHITE ? "white" : "black",
        );
        const pos = fromBoard(board);
        const winner = resolve(pos.state, w, b, first);
        const fast = toBoard(pos);
        expect(winner).toBe(slow.winner === "white" ? 1 : slow.winner === "black" ? 2 : 0);
        if (!slow.winner) expect(sameBoard(fast, slow.board)).toBe(true);
        checked++;
        if (slow.winner) break;
        board = cloneBoard(slow.board);
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it("agrees with the slow attack test on random positions", () => {
    const rng = mulberry32(7);
    let board = initialBoard();
    for (let round = 0; round < 40; round++) {
      const pos = fromBoard(board);
      for (let sq = 0; sq < 64; sq++) {
        expect(attacked(pos.state, sq, WHITE)).toBe(isAttacked(board, sq, "white"));
        expect(attacked(pos.state, sq, BLACK)).toBe(isAttacked(board, sq, "black"));
      }
      const w = randomPlan(board, WHITE, rng);
      const b = randomPlan(board, BLACK, rng);
      const result = resolveRound(board, toOrders(board, w), toOrders(board, b));
      if (result.winner) board = initialBoard();
      else board = result.board;
    }
  });

  it("round-trips boards", () => {
    const board = initialBoard();
    expect(sameBoard(toBoard(fromBoard(board)), board)).toBe(true);
  });
});

describe("plan spaces at the start", () => {
  it("counts sensible and full plan spaces", () => {
    const s = fromBoard(initialBoard()).state;
    const sensible = enumeratePlans(s, WHITE, false).length;
    const full = enumeratePlans(s, WHITE, true).length;
    expect(sensible).toBeGreaterThan(5000);
    expect(full).toBeGreaterThan(sensible);
  });
});
