// Three Ahead Chess — core rules engine.
//
// Normal chess movement, but each player secretly seals THREE orders at a time;
// the round then plays out W,B,W,B,W,B with no further intervention. An order
// names a piece, a destination, and whether the mover predicts a capture there.
// Because the board drifts away from the plan, execution is forgiving:
//
//   - Sliding pieces travel as far as they can toward the ordered square and
//     stop just short of whatever blocks the path.
//   - An enemy ON the ordered square is captured only if the capture was
//     predicted; otherwise the mover halts one square short of it.
//   - Knights (and single-step king moves) that cannot land don't move at all.
//   - A pawn ordered to capture diagonally fizzles if no victim is there.
//   - A piece that has been captured loses its remaining orders.
//
// There is no check or checkmate — plans are sealed blind, so the game is won
// by actually capturing the enemy king. Castling is supported (blocked = the
// whole move fizzles); pawns auto-promote to queens; there is no en passant.
//
// Squares are 0..63 with a1 = 0, h1 = 7, a8 = 56 (file = i & 7, rank = i >> 3).
// This module is pure and framework-free so the rules are unit-testable.

export type Side = "white" | "black";
export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";
export type Square = number;

export interface Piece {
  id: number;
  side: Side;
  type: PieceType;
  hasMoved: boolean;
}

/** 64 entries, a1 first; null = empty. */
export type Board = (Piece | null)[];

/** A sealed order: move piece `pieceId` to `to`, predicting a capture or not.
 *  `from` is where the piece stood when the order was written (display only —
 *  execution always starts from wherever the piece actually is). */
export interface Order {
  pieceId: number;
  from: Square;
  to: Square;
  capture: boolean;
}

export const fileOf = (sq: Square): number => sq & 7;
export const rankOf = (sq: Square): number => sq >> 3;
export const square = (file: number, rank: number): Square => rank * 8 + file;
export const onBoard = (file: number, rank: number): boolean =>
  file >= 0 && file < 8 && rank >= 0 && rank < 8;

const FILES = "abcdefgh";
export const squareName = (sq: Square): string => `${FILES[fileOf(sq)]}${rankOf(sq) + 1}`;

export const otherSide = (side: Side): Side => (side === "white" ? "black" : "white");

/** Forward rank direction for a side's pawns. */
const pawnDir = (side: Side): number => (side === "white" ? 1 : -1);
const lastRank = (side: Side): number => (side === "white" ? 7 : 0);

const BACK_ROW: PieceType[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

/** Standard starting position. Piece ids 0–15 white, 16–31 black. */
export function initialBoard(): Board {
  const board: Board = new Array(64).fill(null);
  let id = 0;
  const place = (side: Side, backRank: number, pawnRank: number) => {
    for (let f = 0; f < 8; f++) {
      board[square(f, backRank)] = { id: id++, side, type: BACK_ROW[f], hasMoved: false };
    }
    for (let f = 0; f < 8; f++) {
      board[square(f, pawnRank)] = { id: id++, side, type: "pawn", hasMoved: false };
    }
  };
  place("white", 0, 1);
  place("black", 7, 6);
  return board;
}

export function cloneBoard(board: Board): Board {
  return board.map((p) => (p ? { ...p } : null));
}

export function findPiece(board: Board, pieceId: number): Square | null {
  for (let i = 0; i < 64; i++) if (board[i]?.id === pieceId) return i;
  return null;
}

/* ---- Planning: what may a piece be ORDERED to do? -------------------------
   Orders are written against a guess of the future, so sliding rays extend
   through occupied squares (the blocker may have moved by then) — execution
   sorts out what actually happens. */

export interface MoveOption {
  to: Square;
  /** true/false = the capture flag is fixed (pawn diagonals, pawn pushes,
   *  castling); undefined = the player may toggle it. */
  captureForced?: boolean;
  /** Sensible default for the flag: is an enemy on `to` right now? */
  captureDefault: boolean;
  isCastle?: boolean;
}

const ROOK_RAYS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
const BISHOP_RAYS = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;
const KNIGHT_JUMPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
] as const;

function rayTargets(from: Square, rays: readonly (readonly [number, number])[]): Square[] {
  const targets: Square[] = [];
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  for (const [df, dr] of rays) {
    for (let k = 1; ; k++) {
      const f = f0 + df * k;
      const r = r0 + dr * k;
      if (!onBoard(f, r)) break;
      targets.push(square(f, r));
    }
  }
  return targets;
}

/** All destinations a piece at `from` may be ordered to, given `board` (the
 *  player's predicted board). Rays run to the board edge regardless of
 *  occupancy — you may aim through a square you expect to be vacated. */
export function moveOptions(board: Board, from: Square): MoveOption[] {
  const piece = board[from];
  if (!piece) return [];
  const enemyAt = (sq: Square) => {
    const p = board[sq];
    return p !== null && p.side !== piece.side;
  };
  const opt = (to: Square, captureForced?: boolean, isCastle?: boolean): MoveOption => ({
    to,
    captureForced,
    captureDefault: captureForced ?? enemyAt(to),
    isCastle,
  });

  const f0 = fileOf(from);
  const r0 = rankOf(from);
  switch (piece.type) {
    case "rook":
      return rayTargets(from, ROOK_RAYS).map((to) => opt(to));
    case "bishop":
      return rayTargets(from, BISHOP_RAYS).map((to) => opt(to));
    case "queen":
      return rayTargets(from, [...ROOK_RAYS, ...BISHOP_RAYS]).map((to) => opt(to));
    case "knight": {
      const options: MoveOption[] = [];
      for (const [df, dr] of KNIGHT_JUMPS) {
        if (onBoard(f0 + df, r0 + dr)) options.push(opt(square(f0 + df, r0 + dr)));
      }
      return options;
    }
    case "king": {
      const options: MoveOption[] = [];
      for (const [df, dr] of [...ROOK_RAYS, ...BISHOP_RAYS]) {
        if (onBoard(f0 + df, r0 + dr)) options.push(opt(square(f0 + df, r0 + dr)));
      }
      // Castling: offered only while it looks playable on the predicted board.
      if (!piece.hasMoved) {
        for (const side of ["king", "queen"] as const) {
          const target = castleTarget(board, from, side);
          if (target !== null) options.push(opt(target, false, true));
        }
      }
      return options;
    }
    case "pawn": {
      const options: MoveOption[] = [];
      const dir = pawnDir(piece.side);
      if (onBoard(f0, r0 + dir)) {
        options.push(opt(square(f0, r0 + dir), false));
        if (!piece.hasMoved && onBoard(f0, r0 + 2 * dir)) {
          options.push(opt(square(f0, r0 + 2 * dir), false));
        }
        for (const df of [-1, 1]) {
          if (onBoard(f0 + df, r0 + dir)) options.push(opt(square(f0 + df, r0 + dir), true));
        }
      }
      return options;
    }
  }
}

/** The king's castling destination on `wing`, or null if it isn't currently
 *  playable on this board (king/rook moved, rook missing, or path occupied). */
function castleTarget(board: Board, kingSq: Square, wing: "king" | "queen"): Square | null {
  const king = board[kingSq];
  if (!king || king.type !== "king" || king.hasMoved) return null;
  const rank = rankOf(kingSq);
  if (fileOf(kingSq) !== 4) return null;
  const rookFile = wing === "king" ? 7 : 0;
  const rook = board[square(rookFile, rank)];
  if (!rook || rook.type !== "rook" || rook.side !== king.side || rook.hasMoved) return null;
  const [lo, hi] = wing === "king" ? [5, 6] : [1, 3];
  for (let f = lo; f <= hi; f++) if (board[square(f, rank)]) return null;
  return square(wing === "king" ? 6 : 2, rank);
}

/* ---- Execution ----------------------------------------------------------- */

export type OutcomeKind =
  | "moved" // reached the ordered square
  | "captured" // reached it and took the predicted victim
  | "stopped" // slider halted short of the ordered square
  | "held" // could not move at all
  | "gone"; // the piece had already been captured

export interface StepOutcome {
  order: Order;
  side: Side;
  pieceType: PieceType;
  /** Where the piece actually stood when the order came up (null if gone). */
  from: Square | null;
  /** Where it ended up (= from when held; null if gone). */
  landed: Square | null;
  kind: OutcomeKind;
  captured?: { type: PieceType; side: Side };
  promoted?: boolean;
  castled?: boolean;
  reason?: string;
  /** Snapshot after this step — used by the UI to replay the round. */
  boardAfter: Board;
}

interface Attempt {
  landed: Square;
  kind: OutcomeKind;
  captured?: Piece;
  castled?: boolean;
  reason?: string;
}

/** Execute one order against the live board (mutates `board`). */
export function executeOrder(board: Board, order: Order): StepOutcome {
  const from = findPiece(board, order.pieceId);
  if (from === null) {
    return {
      order,
      side: order.pieceId < 16 ? "white" : "black",
      pieceType: "pawn",
      from: null,
      landed: null,
      kind: "gone",
      reason: "the piece was already captured",
      boardAfter: cloneBoard(board),
    };
  }
  const piece = board[from]!;
  const attempt = attemptMove(board, piece, from, order);

  if (attempt.landed !== from) {
    // attemptMove already removed any captured victim from the board.
    board[from] = null;
    board[attempt.landed] = piece;
    piece.hasMoved = true;
  }
  let promoted = false;
  if (piece.type === "pawn" && rankOf(attempt.landed) === lastRank(piece.side)) {
    piece.type = "queen";
    promoted = true;
  }

  return {
    order,
    side: piece.side,
    pieceType: piece.type,
    from,
    landed: attempt.landed,
    kind: attempt.kind,
    captured: attempt.captured
      ? { type: attempt.captured.type, side: attempt.captured.side }
      : undefined,
    promoted: promoted || undefined,
    castled: attempt.castled,
    reason: attempt.reason,
    boardAfter: cloneBoard(board),
  };
}

/** Work out where the order actually lands. May capture (removing the victim
 *  from `board`) and, for castling, also moves the rook. Never moves `piece`
 *  itself — the caller does that. */
function attemptMove(board: Board, piece: Piece, from: Square, order: Order): Attempt {
  const held = (reason: string): Attempt => ({ landed: from, kind: "held", reason });
  if (order.to === from) return held("already standing there");
  if (order.to < 0 || order.to > 63) return held("no such square");

  const df = fileOf(order.to) - fileOf(from);
  const dr = rankOf(order.to) - rankOf(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);

  switch (piece.type) {
    case "knight":
      if (!((adf === 1 && adr === 2) || (adf === 2 && adr === 1))) {
        return held("the move no longer makes sense from here");
      }
      return landOrHold(board, piece, from, order);
    case "king":
      if (adr === 0 && adf === 2 && !piece.hasMoved) return attemptCastle(board, from, order);
      if (Math.max(adf, adr) !== 1) return held("the move no longer makes sense from here");
      return landOrHold(board, piece, from, order);
    case "pawn":
      return attemptPawn(board, piece, from, order, df, dr);
    case "rook":
      if (df !== 0 && dr !== 0) return held("the move no longer makes sense from here");
      return slide(board, piece, from, order);
    case "bishop":
      if (adf !== adr) return held("the move no longer makes sense from here");
      return slide(board, piece, from, order);
    case "queen":
      if (!(df === 0 || dr === 0 || adf === adr)) {
        return held("the move no longer makes sense from here");
      }
      return slide(board, piece, from, order);
  }
}

/** Single-square landings (knight jumps, king steps): all or nothing. */
function landOrHold(board: Board, piece: Piece, from: Square, order: Order): Attempt {
  const target = board[order.to];
  if (target && target.side === piece.side) {
    return { landed: from, kind: "held", reason: "one of its own stood on the square" };
  }
  if (target) {
    if (!order.capture) {
      return { landed: from, kind: "held", reason: "an unpredicted enemy held the square" };
    }
    board[order.to] = null;
    return { landed: order.to, kind: "captured", captured: target };
  }
  return { landed: order.to, kind: "moved" };
}

/** Sliding movement: advance square by square and stop just short of any
 *  blocker; the ordered square itself may be a predicted capture. */
function slide(board: Board, piece: Piece, from: Square, order: Order): Attempt {
  const stepF = Math.sign(fileOf(order.to) - fileOf(from));
  const stepR = Math.sign(rankOf(order.to) - rankOf(from));
  let prev = from;
  for (let f = fileOf(from) + stepF, r = rankOf(from) + stepR; ; f += stepF, r += stepR) {
    const sq = square(f, r);
    const occupant = board[sq];
    if (sq === order.to) {
      if (!occupant) return { landed: sq, kind: "moved" };
      if (occupant.side === piece.side) {
        return stopShort(from, prev, "one of its own stood on the square");
      }
      if (!order.capture) {
        return stopShort(from, prev, "an unpredicted enemy held the square");
      }
      board[sq] = null;
      return { landed: sq, kind: "captured", captured: occupant };
    }
    if (occupant) return stopShort(from, prev, "the path was blocked");
    prev = sq;
  }
}

function stopShort(from: Square, prev: Square, reason: string): Attempt {
  return prev === from
    ? { landed: from, kind: "held", reason }
    : { landed: prev, kind: "stopped", reason };
}

function attemptPawn(
  board: Board,
  piece: Piece,
  from: Square,
  order: Order,
  df: number,
  dr: number,
): Attempt {
  const dir = pawnDir(piece.side);
  const held = (reason: string): Attempt => ({ landed: from, kind: "held", reason });

  if (df === 0 && dr === dir) {
    // Single push — pawns can never capture forward.
    if (board[order.to]) return held("the square ahead was occupied");
    return { landed: order.to, kind: "moved" };
  }
  if (df === 0 && dr === 2 * dir && !piece.hasMoved) {
    const mid = square(fileOf(from), rankOf(from) + dir);
    if (board[mid]) return held("the square ahead was occupied");
    if (board[order.to])
      return { landed: mid, kind: "stopped", reason: "the far square was occupied" };
    return { landed: order.to, kind: "moved" };
  }
  if (Math.abs(df) === 1 && dr === dir) {
    const target = board[order.to];
    if (!target) return held("swung at an empty square");
    if (target.side === piece.side) return held("one of its own stood on the square");
    if (!order.capture) return held("an unpredicted enemy held the square");
    board[order.to] = null;
    return { landed: order.to, kind: "captured", captured: target };
  }
  return held("the move no longer makes sense from here");
}

function attemptCastle(board: Board, from: Square, order: Order): Attempt {
  const wing = fileOf(order.to) === 6 ? "king" : fileOf(order.to) === 2 ? "queen" : null;
  const target = wing && castleTarget(board, from, wing);
  if (!wing || target !== order.to) {
    return { landed: from, kind: "held", reason: "castling was blocked" };
  }
  const rank = rankOf(from);
  const rookFrom = square(wing === "king" ? 7 : 0, rank);
  const rookTo = square(wing === "king" ? 5 : 3, rank);
  const rook = board[rookFrom]!;
  board[rookFrom] = null;
  board[rookTo] = rook;
  rook.hasMoved = true;
  return { landed: order.to, kind: "moved", castled: true };
}

/* ---- Optimistic planning view ----------------------------------------------
   While CHOOSING moves, the UI assumes every sealed order works exactly as
   intended: the piece arrives on its ordered square no matter what currently
   blocks the path (the blocker may well have moved by then). Execution stays
   strict — this view is only the player's hopeful sketch of the future. */

/** Apply `order` to `board` (mutating) as if it fully succeeds: the piece is
 *  placed on its ordered square, whatever stands there is displaced (shown as
 *  a ghost by the UI), pawns crown on the last rank, and a castling king
 *  brings its rook along for the picture. */
export function applyOrderOptimistic(board: Board, order: Order): void {
  const from = findPiece(board, order.pieceId);
  if (from === null || from === order.to) return;
  const piece = board[from]!;
  // Castling: a yet-unmoved king sliding two files from its home file.
  if (
    piece.type === "king" &&
    !piece.hasMoved &&
    fileOf(from) === 4 &&
    rankOf(order.to) === rankOf(from) &&
    Math.abs(fileOf(order.to) - fileOf(from)) === 2
  ) {
    const rank = rankOf(from);
    const wing = fileOf(order.to) === 6 ? "king" : "queen";
    const rookFrom = square(wing === "king" ? 7 : 0, rank);
    const rookTo = square(wing === "king" ? 5 : 3, rank);
    const rook = board[rookFrom];
    if (rook && rook.type === "rook" && rook.side === piece.side && !rook.hasMoved) {
      board[rookFrom] = null;
      board[rookTo] = rook;
      rook.hasMoved = true;
    }
  }
  board[from] = null;
  board[order.to] = piece;
  piece.hasMoved = true;
  if (piece.type === "pawn" && rankOf(order.to) === lastRank(piece.side)) {
    piece.type = "queen";
  }
}

/* ---- Round resolution ----------------------------------------------------- */

export interface RoundResult {
  steps: StepOutcome[];
  board: Board;
  /** Set when a king was captured this round; remaining orders are discarded. */
  winner: Side | null;
}

/** Play out a full round: W1, B1, W2, B2, W3, B3. Stops the moment a king is
 *  captured. Does not mutate the input board. `first` exists for balance
 *  experiments (self-play soak tests); the shipped game always leads white. */
export function resolveRound(
  board: Board,
  whiteOrders: Order[],
  blackOrders: Order[],
  first: Side = "white",
): RoundResult {
  const live = cloneBoard(board);
  const steps: StepOutcome[] = [];
  let winner: Side | null = null;
  const rounds = Math.max(whiteOrders.length, blackOrders.length);
  const beatOrder: readonly Side[] = first === "white" ? ["white", "black"] : ["black", "white"];
  outer: for (let i = 0; i < rounds; i++) {
    for (const side of beatOrder) {
      const order = (side === "white" ? whiteOrders : blackOrders)[i];
      if (!order) continue;
      const step = executeOrder(live, order);
      steps.push(step);
      if (step.captured?.type === "king") {
        winner = step.side;
        break outer;
      }
    }
  }
  return { steps, board: live, winner };
}

/* ---- Narration ------------------------------------------------------------ */

const PIECE_NAMES: Record<PieceType, string> = {
  pawn: "pawn",
  knight: "knight",
  bishop: "bishop",
  rook: "rook",
  queen: "queen",
  king: "king",
};

/** One human-readable line per step, for the round log. */
export function describeOutcome(step: StepOutcome): string {
  const sideName = step.side === "white" ? "White" : "Black";
  const pieceName = PIECE_NAMES[step.promoted ? "pawn" : step.pieceType];
  const intent = `${squareName(step.order.from)}→${squareName(step.order.to)}`;
  switch (step.kind) {
    case "gone":
      return `${sideName}'s order ${intent} dies with its piece — ${step.reason}.`;
    case "captured": {
      const victim = PIECE_NAMES[step.captured!.type];
      const flourish = step.captured!.type === "king" ? " The king falls — the game is over!" : "";
      const crowned = step.promoted ? " It is crowned a queen!" : "";
      return `${sideName} ${pieceName} ${intent} — takes the ${victim}, as predicted.${crowned}${flourish}`;
    }
    case "moved": {
      if (step.castled)
        return `${sideName} castles — the king slides to ${squareName(step.landed!)}.`;
      const crowned = step.promoted ? " It is crowned a queen!" : "";
      const wasted =
        step.order.capture && !step.captured ? " The predicted victim was not there." : "";
      return `${sideName} ${pieceName} ${intent} — arrives cleanly.${wasted}${crowned}`;
    }
    case "stopped":
      return `${sideName} ${pieceName} ${intent} — halts at ${squareName(step.landed!)}: ${step.reason}.`;
    case "held":
      return `${sideName} ${pieceName} ${intent} — holds its ground: ${step.reason}.`;
  }
}
