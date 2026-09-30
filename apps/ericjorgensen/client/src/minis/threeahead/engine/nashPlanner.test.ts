import { describe, it, expect } from "vitest";
import { Board, Order, PieceType, Side, initialBoard, resolveRound, square } from "./chess";
import { isAttacked, mulberry32 } from "./ai";
import { planMachine, planOrdersNash } from "./nashPlanner";
import { OPENING_BOOK } from "./openingBook";

const sq = (name: string): number => square(name.charCodeAt(0) - 97, Number(name[1]) - 1);
let nextId = 400;
function put(board: Board, at: string, side: Side, type: PieceType): void {
  board[sq(at)] = { id: nextId++, side, type, hasMoved: true };
}

/** Did Ivory decide the round: a king taken, or Onyx's king left en prise
 *  to Ivory's round-2 lead? */
function ivoryDecisive(board: Board, white: Order[], black: Order[]): boolean {
  const r = resolveRound(board, white, black);
  if (r.winner === "white") return true;
  const k = r.board.findIndex((p) => p?.type === "king" && p.side === "black");
  return k >= 0 && isAttacked(r.board, k, "white");
}

describe("opening book", () => {
  it("holds probability mixtures that sum to one", () => {
    for (const mix of [OPENING_BOOK.ivory, OPENING_BOOK.onyx]) {
      expect(mix.length).toBeGreaterThan(1);
      expect(mix.reduce((a, e) => a + e.p, 0)).toBeCloseTo(1, 4);
      for (const e of mix) expect(e.orders).toHaveLength(3);
    }
  });

  it("is what the top levels play from the start position", async () => {
    const plan = await planMachine(initialBoard(), "black", 10, { rng: mulberry32(3) });
    const key = JSON.stringify(plan);
    expect(OPENING_BOOK.onyx.some((e) => JSON.stringify(e.orders) === key)).toBe(true);
  });

  it("makes no single rush a sure thing against the book", () => {
    // The rush that beat the old deterministic level 10 every game.
    const board = initialBoard();
    const id = (n: string) => board[sq(n)]!.id;
    const rushes: Order[][] = [
      [
        { pieceId: id("e2"), from: sq("e2"), to: sq("e4"), capture: false },
        { pieceId: id("d1"), from: sq("d1"), to: sq("h5"), capture: false },
        { pieceId: id("d1"), from: sq("h5"), to: sq("f7"), capture: true },
      ],
      [
        { pieceId: id("b1"), from: sq("b1"), to: sq("c3"), capture: false },
        { pieceId: id("b1"), from: sq("c3"), to: sq("b5"), capture: false },
        { pieceId: id("b1"), from: sq("b5"), to: sq("d6"), capture: false },
      ],
    ];
    for (const rush of rushes) {
      let lethal = 0;
      for (const e of OPENING_BOOK.onyx) {
        if (ivoryDecisive(initialBoard(), rush, e.orders)) lethal += e.p;
      }
      // The equilibrium caps ANY single Ivory plan at the game value (< 1/2).
      expect(lethal).toBeLessThan(0.5);
    }
  });
});

describe("planOrdersNash", () => {
  it("returns three orders for its own pieces in a middlegame", async () => {
    const board: Board = new Array(64).fill(null);
    put(board, "e1", "white", "king");
    put(board, "d1", "white", "queen");
    put(board, "a2", "white", "pawn");
    put(board, "e8", "black", "king");
    put(board, "a8", "black", "rook");
    put(board, "h7", "black", "pawn");
    const plan = await planOrdersNash(board, "white", mulberry32(1), {
      budgetMs: 60_000,
      maxIterations: 12,
    });
    expect(plan).not.toBeNull();
    expect(plan!).toHaveLength(3);
    for (const o of plan!)
      expect(board.some((p) => p?.id === o.pieceId && p.side === "white")).toBe(true);
  });

  it("takes a king that cannot escape", async () => {
    // Back rank: Ivory leads, and Ra8xh8 lands at step 1 before Onyx moves.
    const board: Board = new Array(64).fill(null);
    put(board, "a1", "white", "king");
    put(board, "a8", "white", "rook");
    put(board, "h8", "black", "king");
    put(board, "g7", "black", "pawn");
    put(board, "h7", "black", "pawn");
    const plan = await planOrdersNash(board, "white", mulberry32(2), {
      budgetMs: 60_000,
      maxIterations: 30,
    });
    const flee = [
      { pieceId: board[sq("h8")]!.id, from: sq("h8"), to: sq("g8"), capture: false },
      { pieceId: board[sq("g7")]!.id, from: sq("g7"), to: sq("g6"), capture: false },
      { pieceId: board[sq("h7")]!.id, from: sq("h7"), to: sq("h6"), capture: false },
    ];
    expect(resolveRound(board, plan!, flee).winner).toBe("white");
  });
});
