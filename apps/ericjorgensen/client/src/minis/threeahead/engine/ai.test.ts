import { describe, it, expect } from "vitest";
import {
  Board,
  Piece,
  PieceType,
  Side,
  cloneBoard,
  executeOrder,
  initialBoard,
  square,
  squareName,
} from "./chess";
import {
  evaluate,
  generateCandidates,
  isAttacked,
  levelBudgetMs,
  mulberry32,
  planKingHunt,
  planOrders,
  planOrdersDeep,
} from "./ai";

const sq = (name: string): number => square(name.charCodeAt(0) - 97, Number(name[1]) - 1);

let nextId = 200;
function put(board: Board, at: string, side: Side, type: PieceType, hasMoved = false): Piece {
  const piece: Piece = { id: nextId++, side, type, hasMoved };
  board[sq(at)] = piece;
  return piece;
}
const empty = (): Board => new Array(64).fill(null);

describe("candidate generation", () => {
  it("truncates slider rays at the first blocker and flags captures", () => {
    const board = empty();
    put(board, "a1", "white", "rook");
    put(board, "a4", "black", "pawn");
    const rookMoves = generateCandidates(board, "white").filter((c) => c.order.from === sq("a1"));
    const names = rookMoves.map((c) => squareName(c.order.to));
    expect(names).toContain("a4");
    expect(names).not.toContain("a5"); // nothing beyond the blocker
    expect(rookMoves.find((c) => c.order.to === sq("a4"))!.order.capture).toBe(true);
  });

  it("produces 20 legal openings from the initial position", () => {
    expect(generateCandidates(initialBoard(), "white")).toHaveLength(20);
  });
});

describe("evaluation", () => {
  it("prefers material", () => {
    const board = empty();
    put(board, "e1", "white", "king");
    put(board, "e8", "black", "king");
    put(board, "d1", "white", "queen");
    expect(evaluate(board, "white")).toBeGreaterThan(0);
    expect(evaluate(board, "black")).toBeLessThan(0);
  });

  it("sees attacks", () => {
    const board = empty();
    put(board, "a1", "white", "rook");
    put(board, "a8", "black", "knight");
    expect(isAttacked(board, sq("a8"), "white")).toBe(true);
    expect(isAttacked(board, sq("b8"), "white")).toBe(false);
  });
});

describe("planOrders", () => {
  it("returns three orders that all execute meaningfully on the predicted board", () => {
    const rng = mulberry32(7);
    const orders = planOrders(initialBoard(), "white", 5, rng);
    expect(orders).toHaveLength(3);
    const board = initialBoard();
    for (const order of orders) {
      const step = executeOrder(board, order);
      expect(step.side).toBe("white");
      // Planned against its own predictions with a static opponent, every
      // order should actually move a piece.
      expect(step.kind === "moved" || step.kind === "captured").toBe(true);
    }
  });

  it("plans for black too", () => {
    const orders = planOrders(initialBoard(), "black", 5, mulberry32(11));
    expect(orders).toHaveLength(3);
    const board = initialBoard();
    for (const order of orders) {
      expect(board[order.from]?.side).toBe("black");
      executeOrder(board, order);
    }
  });

  it("takes a hanging queen at full strength, predicting the capture", () => {
    const board = empty();
    put(board, "e1", "white", "king", true);
    put(board, "e8", "black", "king", true);
    put(board, "a1", "white", "rook", true);
    put(board, "a8", "black", "queen", true); // free to a1-rook
    const orders = planOrders(board, "white", 10, mulberry32(3));
    expect(squareName(orders[0].to)).toBe("a8");
    expect(orders[0].capture).toBe(true);
  });

  it("goes for the enemy king when it is capturable", () => {
    const board = empty();
    put(board, "e1", "white", "king", true);
    put(board, "h4", "black", "king", true);
    put(board, "h1", "white", "rook", true); // Rh1xh4 wins outright
    const orders = planOrders(board, "white", 10, mulberry32(5));
    expect(squareName(orders[0].to)).toBe("h4");
    expect(orders[0].capture).toBe(true);
  });

  it("avoids obviously hanging its queen at full strength", () => {
    const board = empty();
    put(board, "e1", "white", "king", true);
    put(board, "e8", "black", "king", true);
    put(board, "d1", "white", "queen", true);
    put(board, "d8", "black", "rook", true); // Qd1–d7-ish squares are covered
    const orders = planOrders(board, "white", 10, mulberry32(9));
    // The queen must not be ordered onto a square the rook takes for free.
    const after = cloneBoard(board);
    executeOrder(after, orders[0]);
    const queenSq = after.findIndex((p) => p?.type === "queen" && p.side === "white");
    const defended = isAttacked(after, queenSq, "white");
    if (isAttacked(after, queenSq, "black")) {
      expect(defended).toBe(true);
    }
  });

  it("is deterministic for a given seed and level", () => {
    const a = planOrders(initialBoard(), "white", 4, mulberry32(42));
    const b = planOrders(initialBoard(), "white", 4, mulberry32(42));
    expect(a).toEqual(b);
  });

  it("still plans sensible (non-suicidal) moves at level 1", () => {
    // Level 1 jitters hard, but across many seeds it must never order its own
    // queen onto a defended enemy pawn's square for free — that class of
    // blunder is worth far more than the maximum jitter.
    const board = empty();
    put(board, "e1", "white", "king", true);
    put(board, "e8", "black", "king", true);
    put(board, "d4", "white", "queen", true);
    put(board, "e6", "black", "pawn", true);
    put(board, "f7", "black", "pawn", true); // defends e6
    for (let seed = 1; seed <= 20; seed++) {
      const orders = planOrders(board, "white", 1, mulberry32(seed));
      expect(squareName(orders[0].to)).not.toBe("e6");
    }
  });

  it("clamps out-of-range levels", () => {
    expect(planOrders(initialBoard(), "white", 99, mulberry32(1))).toHaveLength(3);
    expect(planOrders(initialBoard(), "white", -5, mulberry32(1))).toHaveLength(3);
  });
});

describe("planKingHunt", () => {
  it("finds a pawn buzzsaw two beats from the king", () => {
    // White pawn on c6; black king e8 behind its home pawns: c6xd7 then d7xe8.
    const board = empty();
    put(board, "c6", "white", "pawn", true);
    const d7 = put(board, "d7", "black", "pawn");
    put(board, "c8", "black", "bishop");
    put(board, "e8", "black", "king");
    put(board, "e1", "white", "king");
    const stayPlan = [
      { pieceId: d7.id, from: sq("d7"), to: sq("d6"), capture: false },
      { pieceId: d7.id, from: sq("d6"), to: sq("d5"), capture: false },
      { pieceId: d7.id, from: sq("d5"), to: sq("d4"), capture: false },
    ];
    // Black doesn't lead, so the pawn's beat-2 kill lands at global step 3.
    const hunt = planKingHunt(board, stayPlan, "black", false);
    expect(hunt).not.toBeNull();
    expect(hunt!.beat).toBe(2);
    expect(squareName(hunt!.hunter)).toBe("c6");
  });

  it("is broken by an early, unpredictable king move", () => {
    const board = empty();
    put(board, "c6", "white", "pawn", true);
    put(board, "d7", "black", "pawn");
    put(board, "c8", "black", "bishop");
    const king = put(board, "e8", "black", "king", true);
    put(board, "e1", "white", "king");
    // The king relocates on black's first order — sealed captures aim at
    // fixed squares, so the beat-2 kill (step 3) comes after the dodge (step 2).
    const dodgePlan = [
      { pieceId: king.id, from: sq("e8"), to: sq("f8"), capture: false },
      { pieceId: king.id, from: sq("f8"), to: sq("g8"), capture: false },
      { pieceId: king.id, from: sq("g8"), to: sq("h8"), capture: false },
    ];
    expect(planKingHunt(board, dodgePlan, "black", false)).toBeNull();
  });

  it("sees a knight relay through a capturable stepping stone", () => {
    // Knight f3 → e5 (empty) → xd7?? … use: f3 → e5 → f7 attacks? Construct a
    // clean 2-hop: knight on d4 → e6(capturing a pawn) at beat 1, then e6xg7?
    // Simplest: knight c4 → d6 (beat 1) → xe8 (beat 2).
    const board = empty();
    put(board, "c4", "white", "knight", true);
    put(board, "e8", "black", "king");
    put(board, "a8", "black", "rook");
    put(board, "e1", "white", "king");
    const rook = board[sq("a8")]!;
    const idlePlan = [
      { pieceId: rook.id, from: sq("a8"), to: sq("a7"), capture: false },
      { pieceId: rook.id, from: sq("a7"), to: sq("a6"), capture: false },
      { pieceId: rook.id, from: sq("a6"), to: sq("a5"), capture: false },
    ];
    const hunt = planKingHunt(board, idlePlan, "black", false);
    expect(hunt).not.toBeNull();
    expect(hunt!.beat).toBe(2);
  });

  it("finds nothing at the starting position", () => {
    expect(planKingHunt(initialBoard(), [], "white", true)).toBeNull();
    expect(planKingHunt(initialBoard(), [], "black", false)).toBeNull();
  });
});

describe("planOrdersDeep", () => {
  it("returns three orders and stays deterministic for a seed", async () => {
    const opts = { budgetMs: Number.MAX_SAFE_INTEGER, maxRollouts: 25, yieldEvery: 0 };
    const a = await planOrdersDeep(initialBoard(), "white", 10, mulberry32(42), opts);
    const b = await planOrdersDeep(initialBoard(), "white", 10, mulberry32(42), opts);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it("rescues a hunted king that greedy planning would leave standing", async () => {
    // The buzzsaw position: the only good plans dodge the king or eat the pawn.
    const board = empty();
    put(board, "c6", "white", "pawn", true);
    put(board, "d7", "black", "pawn");
    put(board, "c8", "black", "bishop");
    put(board, "e8", "black", "king", true);
    put(board, "e1", "white", "king", true);
    const plan = await planOrdersDeep(board, "black", 10, mulberry32(7), {
      budgetMs: Number.MAX_SAFE_INTEGER,
      maxRollouts: 40,
      yieldEvery: 0,
    });
    expect(planKingHunt(board, plan, "black", false)).toBeNull();
  });

  it("still takes a clean king capture", async () => {
    const board = empty();
    put(board, "e1", "white", "king", true);
    put(board, "h4", "black", "king", true);
    put(board, "h1", "white", "rook", true);
    const plan = await planOrdersDeep(board, "white", 10, mulberry32(5), {
      budgetMs: Number.MAX_SAFE_INTEGER,
      maxRollouts: 30,
      yieldEvery: 0,
    });
    expect(squareName(plan[0].to)).toBe("h4");
    expect(plan[0].capture).toBe(true);
  });

  it("falls back to the greedy plan when the budget is zero", async () => {
    const rngA = mulberry32(9);
    const rngB = mulberry32(9);
    const deep = await planOrdersDeep(initialBoard(), "white", 5, rngA, { budgetMs: 0 });
    const greedy = planOrders(initialBoard(), "white", 5, rngB);
    expect(deep).toEqual(greedy);
  });
});

describe("levelBudgetMs", () => {
  it("keeps low levels instant and scales to ten seconds at level 10", () => {
    expect(levelBudgetMs(1)).toBe(0);
    expect(levelBudgetMs(3)).toBe(0);
    expect(levelBudgetMs(4)).toBeGreaterThan(0);
    expect(levelBudgetMs(10)).toBe(10000);
  });
});
