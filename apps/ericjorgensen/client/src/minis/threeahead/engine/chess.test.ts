import { describe, it, expect } from "vitest";
import {
  Board,
  Order,
  Piece,
  PieceType,
  Side,
  applyOrderOptimistic,
  cloneBoard,
  describeOutcome,
  executeOrder,
  findPiece,
  initialBoard,
  moveOptions,
  resolveRound,
  square,
  squareName,
} from "./chess";

/* Test helpers: build sparse positions by algebraic square name. */

const sq = (name: string): number => square(name.charCodeAt(0) - 97, Number(name[1]) - 1);

let nextId = 100;
function put(
  board: Board,
  at: string,
  side: Side,
  type: PieceType,
  opts: { hasMoved?: boolean; id?: number } = {},
): Piece {
  const piece: Piece = { id: opts.id ?? nextId++, side, type, hasMoved: opts.hasMoved ?? false };
  board[sq(at)] = piece;
  return piece;
}

const empty = (): Board => new Array(64).fill(null);

function order(piece: Piece, board: Board, to: string, capture = false): Order {
  return { pieceId: piece.id, from: findPiece(board, piece.id)!, to: sq(to), capture };
}

describe("board basics", () => {
  it("sets up the standard position", () => {
    const board = initialBoard();
    expect(board.filter(Boolean)).toHaveLength(32);
    expect(board[sq("e1")]).toMatchObject({ side: "white", type: "king" });
    expect(board[sq("d8")]).toMatchObject({ side: "black", type: "queen" });
    expect(board[sq("a2")]).toMatchObject({ side: "white", type: "pawn" });
    expect(board[sq("g8")]).toMatchObject({ side: "black", type: "knight" });
  });

  it("names squares algebraically", () => {
    expect(squareName(0)).toBe("a1");
    expect(squareName(63)).toBe("h8");
    expect(squareName(sq("e4"))).toBe("e4");
  });
});

describe("planning options", () => {
  it("extends slider rays through occupied squares (blockers may vacate)", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a4", "white", "pawn");
    const targets = moveOptions(board, findPiece(board, rook.id)!).map((o) => squareName(o.to));
    expect(targets).toContain("a8"); // beyond the friendly pawn
  });

  it("defaults the capture flag to whether an enemy stands on the target", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a5", "black", "knight");
    const options = moveOptions(board, findPiece(board, rook.id)!);
    expect(options.find((o) => o.to === sq("a5"))!.captureDefault).toBe(true);
    expect(options.find((o) => o.to === sq("a3"))!.captureDefault).toBe(false);
  });

  it("forces capture on pawn diagonals and forbids it on pushes", () => {
    const board = empty();
    const pawn = put(board, "e2", "white", "pawn");
    const options = moveOptions(board, findPiece(board, pawn.id)!);
    expect(options.find((o) => o.to === sq("d3"))!.captureForced).toBe(true);
    expect(options.find((o) => o.to === sq("e3"))!.captureForced).toBe(false);
    expect(options.find((o) => o.to === sq("e4"))!.captureForced).toBe(false);
  });

  it("drops the double push once the pawn has moved", () => {
    const board = empty();
    const pawn = put(board, "e3", "white", "pawn", { hasMoved: true });
    const targets = moveOptions(board, findPiece(board, pawn.id)!).map((o) => squareName(o.to));
    expect(targets).toContain("e4");
    expect(targets).not.toContain("e5");
  });

  it("offers castling only while it looks playable", () => {
    const board = empty();
    const king = put(board, "e1", "white", "king");
    put(board, "h1", "white", "rook");
    put(board, "a1", "white", "rook");
    put(board, "b1", "white", "knight"); // queenside blocked
    const targets = moveOptions(board, findPiece(board, king.id)!).map((o) => squareName(o.to));
    expect(targets).toContain("g1");
    expect(targets).not.toContain("c1");
  });
});

describe("sliding execution", () => {
  it("stops just short of a friendly piece in the path", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a5", "white", "pawn");
    const step = executeOrder(board, order(rook, board, "a8"));
    expect(step.kind).toBe("stopped");
    expect(squareName(step.landed!)).toBe("a4");
  });

  it("stops just short of an unpredicted enemy on the ordered square", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a5", "black", "knight");
    const step = executeOrder(board, order(rook, board, "a5", false));
    expect(step.kind).toBe("stopped");
    expect(squareName(step.landed!)).toBe("a4");
    expect(board[sq("a5")]!.type).toBe("knight"); // the knight survives
  });

  it("captures an enemy on the ordered square when predicted", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a5", "black", "knight");
    const step = executeOrder(board, order(rook, board, "a5", true));
    expect(step.kind).toBe("captured");
    expect(step.captured).toMatchObject({ type: "knight", side: "black" });
    expect(board[sq("a5")]!.id).toBe(rook.id);
  });

  it("stops short of a MID-path enemy even when a capture was predicted", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a4", "black", "knight");
    const step = executeOrder(board, order(rook, board, "a8", true));
    expect(step.kind).toBe("stopped");
    expect(squareName(step.landed!)).toBe("a3");
    expect(board[sq("a4")]!.type).toBe("knight");
  });

  it("holds when the very first square is blocked", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a2", "white", "pawn");
    const step = executeOrder(board, order(rook, board, "a8"));
    expect(step.kind).toBe("held");
    expect(step.landed).toBe(step.from);
  });

  it("moves cleanly to an empty ordered square even with a wasted capture flag", () => {
    const board = empty();
    const queen = put(board, "d1", "white", "queen");
    const step = executeOrder(board, order(queen, board, "d7", true));
    expect(step.kind).toBe("moved");
    expect(squareName(step.landed!)).toBe("d7");
  });
});

describe("knight execution", () => {
  it("does not move at all when the landing square holds an unpredicted enemy", () => {
    const board = empty();
    const knight = put(board, "g1", "white", "knight");
    put(board, "f3", "black", "pawn");
    const step = executeOrder(board, order(knight, board, "f3", false));
    expect(step.kind).toBe("held");
    expect(squareName(step.landed!)).toBe("g1");
  });

  it("captures on the landing square when predicted", () => {
    const board = empty();
    const knight = put(board, "g1", "white", "knight");
    put(board, "f3", "black", "pawn");
    const step = executeOrder(board, order(knight, board, "f3", true));
    expect(step.kind).toBe("captured");
  });

  it("does not move when the landing square holds a friend", () => {
    const board = empty();
    const knight = put(board, "g1", "white", "knight");
    put(board, "f3", "white", "pawn");
    const step = executeOrder(board, order(knight, board, "f3", true));
    expect(step.kind).toBe("held");
  });
});

describe("pawn execution", () => {
  it("halts a blocked single push", () => {
    const board = empty();
    const pawn = put(board, "e2", "white", "pawn");
    put(board, "e3", "black", "rook");
    const step = executeOrder(board, order(pawn, board, "e3"));
    expect(step.kind).toBe("held");
  });

  it("settles on the middle square when only the far square of a double push is taken", () => {
    const board = empty();
    const pawn = put(board, "e2", "white", "pawn");
    put(board, "e4", "black", "rook");
    const step = executeOrder(board, order(pawn, board, "e4"));
    expect(step.kind).toBe("stopped");
    expect(squareName(step.landed!)).toBe("e3");
  });

  it("fizzles a diagonal order when the victim is not there", () => {
    const board = empty();
    const pawn = put(board, "e4", "white", "pawn", { hasMoved: true });
    const step = executeOrder(board, order(pawn, board, "d5", true));
    expect(step.kind).toBe("held");
    expect(squareName(step.landed!)).toBe("e4");
  });

  it("captures diagonally when predicted and promotes on the last rank", () => {
    const board = empty();
    const pawn = put(board, "g7", "white", "pawn", { hasMoved: true });
    put(board, "h8", "black", "rook");
    const step = executeOrder(board, order(pawn, board, "h8", true));
    expect(step.kind).toBe("captured");
    expect(step.promoted).toBe(true);
    expect(board[sq("h8")]!.type).toBe("queen");
  });

  it("auto-promotes a pawn pushed to the last rank", () => {
    const board = empty();
    const pawn = put(board, "c7", "white", "pawn", { hasMoved: true });
    executeOrder(board, order(pawn, board, "c8"));
    expect(board[sq("c8")]!.type).toBe("queen");
  });
});

describe("king and castling execution", () => {
  it("holds a one-step move onto an unpredicted enemy", () => {
    const board = empty();
    const king = put(board, "e1", "white", "king");
    put(board, "e2", "black", "pawn");
    const step = executeOrder(board, order(king, board, "e2", false));
    expect(step.kind).toBe("held");
  });

  it("castles kingside, moving the rook too", () => {
    const board = empty();
    const king = put(board, "e1", "white", "king");
    put(board, "h1", "white", "rook");
    const step = executeOrder(board, order(king, board, "g1"));
    expect(step.castled).toBe(true);
    expect(board[sq("g1")]!.type).toBe("king");
    expect(board[sq("f1")]!.type).toBe("rook");
  });

  it("fizzles castling entirely when the path is blocked at execution", () => {
    const board = empty();
    const king = put(board, "e1", "white", "king");
    put(board, "h1", "white", "rook");
    put(board, "f1", "black", "bishop"); // arrived since the plan was sealed
    const step = executeOrder(board, order(king, board, "g1"));
    expect(step.kind).toBe("held");
    expect(board[sq("e1")]!.type).toBe("king");
    expect(board[sq("h1")]!.type).toBe("rook"); // rook untouched
  });
});

describe("orders against a drifted board", () => {
  it("skips the order when the piece has already been captured", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    const savedOrder = order(rook, board, "a8");
    board[sq("a1")] = null; // captured before its turn
    const step = executeOrder(board, savedOrder);
    expect(step.kind).toBe("gone");
    expect(step.landed).toBeNull();
  });

  it("continues along the same line after an earlier stop-short", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a5", "white", "pawn");
    const first = executeOrder(board, order(rook, board, "a8"));
    expect(squareName(first.landed!)).toBe("a4"); // stopped short
    board[sq("a5")] = null; // the pawn moved away between orders
    const second = executeOrder(board, {
      pieceId: rook.id,
      from: sq("a1"),
      to: sq("a8"),
      capture: false,
    });
    expect(second.kind).toBe("moved");
    expect(squareName(second.landed!)).toBe("a8");
  });

  it("holds when displacement broke the move's geometry", () => {
    const board = empty();
    const bishop = put(board, "c1", "white", "bishop");
    put(board, "e3", "white", "pawn");
    const first = executeOrder(board, order(bishop, board, "g5"));
    expect(squareName(first.landed!)).toBe("d2"); // stopped short of the pawn
    // c4 is neither diagonal nor reachable from d2 — the order no longer makes sense.
    const step = executeOrder(board, {
      pieceId: bishop.id,
      from: sq("c1"),
      to: sq("c4"),
      capture: false,
    });
    expect(step.kind).toBe("held");
    expect(squareName(step.landed!)).toBe("d2");
  });
});

describe("round resolution", () => {
  it("alternates white, black, white, black, white, black", () => {
    const board = initialBoard();
    const w = (name: string, to: string): Order => {
      const piece = board[sq(name)]!;
      return { pieceId: piece.id, from: sq(name), to: sq(to), capture: false };
    };
    const result = resolveRound(
      board,
      [w("e2", "e4"), w("d2", "d4"), w("g1", "f3")],
      [w("e7", "e5"), w("d7", "d5"), w("b8", "c6")],
    );
    expect(result.steps.map((s) => s.side)).toEqual([
      "white",
      "black",
      "white",
      "black",
      "white",
      "black",
    ]);
    expect(result.winner).toBeNull();
    // Input board untouched:
    expect(board[sq("e2")]).not.toBeNull();
  });

  it("ends the round the moment a king is captured", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a8", "black", "king");
    const blackPawn = put(board, "h7", "black", "pawn");
    const result = resolveRound(
      board,
      [order(rook, board, "a8", true), order(rook, board, "h8", false)],
      [order(blackPawn, board, "h6"), order(blackPawn, board, "h5")],
    );
    expect(result.winner).toBe("white");
    expect(result.steps).toHaveLength(1); // nothing after the king falls
  });

  it("lets a mid-round capture erase a later order", () => {
    const board = empty();
    const whiteRook = put(board, "a1", "white", "rook");
    const blackRook = put(board, "a8", "black", "rook");
    put(board, "h1", "white", "king");
    put(board, "h8", "black", "king");
    const result = resolveRound(
      board,
      [order(whiteRook, board, "a8", true)], // takes the black rook first
      [order(blackRook, board, "b8", false)],
    );
    expect(result.steps[0].kind).toBe("captured");
    expect(result.steps[1].kind).toBe("gone");
  });
});

describe("narration", () => {
  it("describes each outcome kind readably", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    put(board, "a5", "black", "knight");
    const stopped = executeOrder(cloneBoard(board), order(rook, board, "a5", false));
    expect(describeOutcome(stopped)).toMatch(/halts at a4/);
    const captured = executeOrder(cloneBoard(board), order(rook, board, "a5", true));
    expect(describeOutcome(captured)).toMatch(/takes the knight/);
  });
});

describe("optimistic planning view", () => {
  it("places a slider on its ordered square straight through a blocker", () => {
    const board = empty();
    const bishop = put(board, "f1", "white", "bishop");
    put(board, "e2", "white", "pawn"); // blocks the diagonal today
    applyOrderOptimistic(board, order(bishop, board, "b5"));
    expect(board[sq("b5")]!.id).toBe(bishop.id);
    expect(board[sq("f1")]).toBeNull();
    expect(board[sq("e2")]!.type).toBe("pawn"); // the blocker is untouched
  });

  it("displaces whatever stands on the ordered square", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    const knight = put(board, "a8", "black", "knight");
    applyOrderOptimistic(board, order(rook, board, "a8", true));
    expect(board[sq("a8")]!.id).toBe(rook.id);
    expect(board.some((p) => p?.id === knight.id)).toBe(false); // ghost fodder
  });

  it("crowns a pawn shown reaching the last rank", () => {
    const board = empty();
    const pawn = put(board, "g2", "white", "pawn");
    applyOrderOptimistic(board, order(pawn, board, "g8"));
    expect(board[sq("g8")]!.type).toBe("queen");
  });

  it("brings the rook along for a castling picture", () => {
    const board = empty();
    const king = put(board, "e1", "white", "king");
    put(board, "h1", "white", "rook");
    applyOrderOptimistic(board, order(king, board, "g1"));
    expect(board[sq("g1")]!.type).toBe("king");
    expect(board[sq("f1")]!.type).toBe("rook");
  });

  it("does nothing for a piece that is already gone", () => {
    const board = empty();
    const rook = put(board, "a1", "white", "rook");
    const savedOrder = order(rook, board, "a8");
    board[sq("a1")] = null;
    applyOrderOptimistic(board, savedOrder);
    expect(board[sq("a8")]).toBeNull();
  });
});
