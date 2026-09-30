// Three Ahead Chess — the fast engine.
//
// The same rules as chess.ts, but on flat typed arrays with no allocation per
// move, so rounds can be resolved by the billion (the opening analysis) or by
// the hundred-thousand inside a ten-second think (the equilibrium planner).
// chess.ts stays the source of truth: fast.test.ts cross-checks every rule
// against it on randomized rounds.
//
// State layout (one Int8Array, copied with .set):
//   [0..63]    square → piece index, or -1
//   [64..95]   piece type (0 = gone, then PAWN..KING)
//   [96..127]  piece position, or -1
//   [128..159] has-moved flag
//   [160..191] side: 0 = white, 1 = black
// An order is packed into one int: piece (5 bits) | to << 5 | capture << 11.
// A plan is three orders packed into one double: o1 + o2·4096 + o3·4096².

import { Board, Order, PieceType } from "./chess";

export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

const SQ = 0;
const TYPE = 64;
const POS = 96;
const MOVED = 128;
const SIDE = 160;
export const STATE_SIZE = 192;

export const WHITE = 0;
export const BLACK = 1;

const TYPE_CODE: Record<PieceType, number> = {
  pawn: PAWN,
  knight: KNIGHT,
  bishop: BISHOP,
  rook: ROOK,
  queen: QUEEN,
  king: KING,
};
const TYPE_NAME: PieceType[] = ["pawn", "pawn", "knight", "bishop", "rook", "queen", "king"];

export const packOrder = (piece: number, to: number, capture: boolean): number =>
  piece | (to << 5) | (capture ? 2048 : 0);
export const orderPiece = (o: number): number => o & 31;
export const orderTo = (o: number): number => (o >> 5) & 63;
export const orderCapture = (o: number): boolean => (o & 2048) !== 0;

export const packPlan = (o1: number, o2: number, o3: number): number =>
  o1 + o2 * 4096 + o3 * 16777216;
export const planOrder = (plan: number, i: number): number =>
  Math.floor(plan / (i === 0 ? 1 : i === 1 ? 4096 : 16777216)) % 4096;

/** A fast state plus the map from fast piece index back to real piece ids. */
export interface FastPosition {
  state: Int8Array;
  ids: number[];
}

/** Convert a chess.ts board (any piece ids) into a fast state. */
export function fromBoard(board: Board): FastPosition {
  const state = new Int8Array(STATE_SIZE);
  state.fill(-1, SQ, SQ + 64);
  state.fill(-1, POS, POS + 32);
  const ids: number[] = [];
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p) continue;
    const i = ids.length;
    if (i >= 32) throw new Error("more than 32 pieces");
    ids.push(p.id);
    state[SQ + sq] = i;
    state[TYPE + i] = TYPE_CODE[p.type];
    state[POS + i] = sq;
    state[MOVED + i] = p.hasMoved ? 1 : 0;
    state[SIDE + i] = p.side === "white" ? WHITE : BLACK;
  }
  return { state, ids };
}

/** Convert a fast state back into a chess.ts board, with real piece ids. */
export function toBoard(pos: FastPosition): Board {
  const board: Board = new Array(64).fill(null);
  const { state, ids } = pos;
  for (let i = 0; i < ids.length; i++) {
    const sq = state[POS + i];
    if (sq < 0 || state[TYPE + i] === 0) continue;
    board[sq] = {
      id: ids[i],
      side: state[SIDE + i] === WHITE ? "white" : "black",
      type: TYPE_NAME[state[TYPE + i]],
      hasMoved: state[MOVED + i] === 1,
    };
  }
  return board;
}

/** Translate a chess.ts order into a packed fast order (null if its piece is
 *  not in this position). */
export function encodeOrder(pos: FastPosition, order: Order): number | null {
  const i = pos.ids.indexOf(order.pieceId);
  return i < 0 ? null : packOrder(i, order.to, order.capture);
}

/** Translate a packed fast order back to a chess.ts order. */
export function decodeOrder(pos: FastPosition, o: number): Order {
  const piece = orderPiece(o);
  return {
    pieceId: pos.ids[piece],
    from: pos.state[POS + piece],
    to: orderTo(o),
    capture: orderCapture(o),
  };
}

export const pieceAt = (s: Int8Array, sq: number): number => s[SQ + sq];
export const pieceType = (s: Int8Array, i: number): number => s[TYPE + i];
export const pieceSide = (s: Int8Array, i: number): number => s[SIDE + i];
export const piecePos = (s: Int8Array, i: number): number => s[POS + i];

/* ---- Execution (mirrors chess.ts attemptMove exactly) ------------------------ */

/** Execute one packed order on `s` (mutating). Returns the captured piece's
 *  type (0 if none). */
export function execute(s: Int8Array, o: number): number {
  const i = o & 31;
  const to = (o >> 5) & 63;
  const capture = (o & 2048) !== 0;
  const from = s[POS + i];
  if (from < 0 || s[TYPE + i] === 0) return 0; // gone
  if (to === from) return 0;
  const side = s[SIDE + i];
  const type = s[TYPE + i];
  const f0 = from & 7;
  const r0 = from >> 3;
  const df = (to & 7) - f0;
  const dr = (to >> 3) - r0;
  const adf = df < 0 ? -df : df;
  const adr = dr < 0 ? -dr : dr;
  let landed = from;
  let victim = -1;

  switch (type) {
    case KNIGHT:
    case KING: {
      // (No closure here: this runs billions of times in the analysis, and a
      // per-call allocation turns into garbage-collector churn.)
      let jump = false;
      if (type === KNIGHT) jump = (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
      else if (adr === 0 && adf === 2 && s[MOVED + i] === 0) {
        if (castle(s, from, to)) landed = to;
      } else jump = (adf > adr ? adf : adr) === 1;
      if (jump) {
        // single-square landing: all or nothing
        const t = s[SQ + to];
        if (t < 0) landed = to;
        else if (s[SIDE + t] !== side && capture) {
          victim = t;
          landed = to;
        }
      }
      break;
    }
    case PAWN: {
      const dir = side === WHITE ? 1 : -1;
      if (df === 0 && dr === dir) {
        if (s[SQ + to] < 0) landed = to;
      } else if (df === 0 && dr === 2 * dir && s[MOVED + i] === 0) {
        const mid = from + 8 * dir;
        if (s[SQ + mid] < 0) landed = s[SQ + to] < 0 ? to : mid;
      } else if (adf === 1 && dr === dir) {
        const t = s[SQ + to];
        if (t >= 0 && s[SIDE + t] !== side && capture) {
          victim = t;
          landed = to;
        }
      }
      break;
    }
    case ROOK:
    case BISHOP:
    case QUEEN: {
      const straight = df === 0 || dr === 0;
      const diagonal = adf === adr;
      if (type === ROOK ? !straight : type === BISHOP ? !diagonal : !(straight || diagonal)) {
        break;
      }
      const step = (dr > 0 ? 8 : dr < 0 ? -8 : 0) + (df > 0 ? 1 : df < 0 ? -1 : 0);
      let prev = from;
      for (let sq = from + step; ; sq += step) {
        const t = s[SQ + sq];
        if (sq === to) {
          if (t < 0) landed = sq;
          else if (s[SIDE + t] !== side && capture) {
            victim = t;
            landed = sq;
          } else landed = prev;
          break;
        }
        if (t >= 0) {
          landed = prev;
          break;
        }
        prev = sq;
      }
      break;
    }
  }

  let capturedType = 0;
  if (victim >= 0) {
    capturedType = s[TYPE + victim];
    s[POS + victim] = -1;
    s[TYPE + victim] = 0;
  }
  if (landed !== from) {
    s[SQ + from] = -1;
    s[SQ + landed] = i;
    s[POS + i] = landed;
    s[MOVED + i] = 1;
  }
  if (type === PAWN && landed >> 3 === (side === WHITE ? 7 : 0)) s[TYPE + i] = QUEEN;
  return capturedType;
}

/** Castle if playable (king unmoved on its home e-file square, rook unmoved
 *  in the corner, path empty); moves the rook. The caller moves the king. */
function castle(s: Int8Array, from: number, to: number): boolean {
  if ((from & 7) !== 4) return false;
  const wing = to & 7;
  if (wing !== 6 && wing !== 2) return false;
  const rank = from & 56;
  const king = s[SQ + from];
  const rookSq = rank + (wing === 6 ? 7 : 0);
  const rook = s[SQ + rookSq];
  if (rook < 0 || s[TYPE + rook] !== ROOK || s[SIDE + rook] !== s[SIDE + king]) return false;
  if (s[MOVED + rook] !== 0) return false;
  const lo = wing === 6 ? 5 : 1;
  const hi = wing === 6 ? 6 : 3;
  for (let f = lo; f <= hi; f++) if (s[SQ + rank + f] >= 0) return false;
  const rookTo = rank + (wing === 6 ? 5 : 3);
  s[SQ + rookSq] = -1;
  s[SQ + rookTo] = rook;
  s[POS + rook] = rookTo;
  s[MOVED + rook] = 1;
  return true;
}

/** Resolve a round in place. `first` leads (0 white, 1 black). Returns the
 *  winner: 0 none, 1 white, 2 black. */
export function resolve(s: Int8Array, whitePlan: number, blackPlan: number, first = WHITE): number {
  const lead = first === WHITE ? whitePlan : blackPlan;
  const follow = first === WHITE ? blackPlan : whitePlan;
  for (let k = 0; k < 3; k++) {
    const div = k === 0 ? 1 : k === 1 ? 4096 : 16777216;
    if (execute(s, Math.floor(lead / div) % 4096) === KING) return first === WHITE ? 1 : 2;
    if (execute(s, Math.floor(follow / div) % 4096) === KING) return first === WHITE ? 2 : 1;
  }
  return 0;
}

/* ---- Attacks ----------------------------------------------------------------- */

const KNIGHT_D = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];
const KING_D = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Does any piece of `bySide` attack `target` (normal chess attacks)? */
export function attacked(s: Int8Array, target: number, bySide: number): boolean {
  const f0 = target & 7;
  const r0 = target >> 3;
  for (const [df, dr] of KNIGHT_D) {
    const f = f0 + df;
    const r = r0 + dr;
    if (f < 0 || f > 7 || r < 0 || r > 7) continue;
    const p = s[SQ + r * 8 + f];
    if (p >= 0 && s[SIDE + p] === bySide && s[TYPE + p] === KNIGHT) return true;
  }
  const pr = r0 - (bySide === WHITE ? 1 : -1);
  if (pr >= 0 && pr <= 7) {
    for (const df of [-1, 1]) {
      const f = f0 + df;
      if (f < 0 || f > 7) continue;
      const p = s[SQ + pr * 8 + f];
      if (p >= 0 && s[SIDE + p] === bySide && s[TYPE + p] === PAWN) return true;
    }
  }
  for (let d = 0; d < 8; d++) {
    const [df, dr] = KING_D[d];
    const diagonal = d >= 4;
    for (let k = 1; ; k++) {
      const f = f0 + df * k;
      const r = r0 + dr * k;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const p = s[SQ + r * 8 + f];
      if (p < 0) continue;
      if (s[SIDE + p] === bySide) {
        const t = s[TYPE + p];
        if (t === QUEEN || t === (diagonal ? BISHOP : ROOK)) return true;
        if (k === 1 && t === KING) return true;
      }
      break;
    }
  }
  return false;
}

/** Square of `side`'s king, or -1. */
export function kingSquare(s: Int8Array, side: number): number {
  for (let i = 0; i < 32; i++) {
    if (s[TYPE + i] === KING && s[SIDE + i] === side) return s[POS + i];
  }
  return -1;
}

/* ---- Order spaces and plan enumeration --------------------------------------- */

/**
 * Orders `side` could seal on `s` (the player's own predicted board).
 *   "sensible": what a careful player orders — rays stop at the first piece,
 *     capture flags set exactly when an enemy stands on the target.
 *   "full": everything that could ever matter blind — also ambushes (a capture
 *     flag on an empty square, or on a square my own piece holds, in case an
 *     enemy takes it first), aims THROUGH enemy pieces that may have moved,
 *     and pushes onto enemy-held squares.
 */
export function orderSpace(s: Int8Array, side: number, full: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    const type = s[TYPE + i];
    if (type === 0 || s[SIDE + i] !== side) continue;
    const from = s[POS + i];
    const f0 = from & 7;
    const r0 = from >> 3;
    const addTarget = (to: number) => {
      const t = s[SQ + to];
      if (t < 0) {
        out.push(packOrder(i, to, false));
        if (full) out.push(packOrder(i, to, true));
      } else if (s[SIDE + t] !== side) out.push(packOrder(i, to, true));
      else if (full) out.push(packOrder(i, to, true));
    };
    if (type === KNIGHT || type === KING) {
      for (const [df, dr] of type === KNIGHT ? KNIGHT_D : KING_D) {
        const f = f0 + df;
        const r = r0 + dr;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        addTarget(r * 8 + f);
      }
      if (type === KING && s[MOVED + i] === 0 && f0 === 4) {
        for (const wing of [6, 2]) {
          const rank = from & 56;
          const rook = s[SQ + rank + (wing === 6 ? 7 : 0)];
          if (rook < 0 || s[TYPE + rook] !== ROOK || s[SIDE + rook] !== side) continue;
          if (s[MOVED + rook] !== 0) continue;
          let clear = true;
          for (let f = wing === 6 ? 5 : 1; f <= (wing === 6 ? 6 : 3); f++) {
            const p = s[SQ + rank + f];
            if (p >= 0 && (!full || s[SIDE + p] === side)) clear = false;
          }
          if (clear) out.push(packOrder(i, rank + wing, false));
        }
      }
    } else if (type === PAWN) {
      const dir = side === WHITE ? 1 : -1;
      const r1 = r0 + dir;
      if (r1 < 0 || r1 > 7) continue;
      const one = r1 * 8 + f0;
      const oneOcc = s[SQ + one];
      const oneOwn = oneOcc >= 0 && s[SIDE + oneOcc] === side;
      if (oneOcc < 0 || (full && !oneOwn)) {
        out.push(packOrder(i, one, false));
        const r2 = r0 + 2 * dir;
        if (s[MOVED + i] === 0 && r2 >= 0 && r2 <= 7) {
          const twoOcc = s[SQ + r2 * 8 + f0];
          const twoOwn = twoOcc >= 0 && s[SIDE + twoOcc] === side;
          if ((oneOcc < 0 && twoOcc < 0) || (full && !twoOwn)) {
            out.push(packOrder(i, r2 * 8 + f0, false));
          }
        }
      }
      for (const df of [-1, 1]) {
        const f = f0 + df;
        if (f < 0 || f > 7) continue;
        const diag = r1 * 8 + f;
        const t = s[SQ + diag];
        if ((t >= 0 && s[SIDE + t] !== side) || full) out.push(packOrder(i, diag, true));
      }
    } else {
      const dirs = type === ROOK ? KING_D.slice(0, 4) : type === BISHOP ? KING_D.slice(4) : KING_D;
      for (const [df, dr] of dirs) {
        let throughEnemy = false;
        for (let k = 1; ; k++) {
          const f = f0 + df * k;
          const r = r0 + dr * k;
          if (f < 0 || f > 7 || r < 0 || r > 7) break;
          const to = r * 8 + f;
          const t = s[SQ + to];
          if (t >= 0 && s[SIDE + t] === side) {
            if (full && !throughEnemy) out.push(packOrder(i, to, true));
            break;
          }
          addTarget(to);
          if (t >= 0) {
            if (!full) break;
            throughEnemy = true;
          }
        }
      }
    }
  }
  return out;
}

/** Every three-order plan `side` could seal from `s`, as packed doubles.
 *  Later orders are drawn from the board after the earlier ones execute
 *  unopposed (how a player plans). */
export function enumeratePlans(s: Int8Array, side: number, full: boolean): Float64Array {
  const plans: number[] = [];
  const b1 = new Int8Array(STATE_SIZE);
  const b2 = new Int8Array(STATE_SIZE);
  for (const o1 of orderSpace(s, side, full)) {
    b1.set(s);
    execute(b1, o1);
    for (const o2 of orderSpace(b1, side, full)) {
      b2.set(b1);
      execute(b2, o2);
      for (const o3 of orderSpace(b2, side, full)) plans.push(packPlan(o1, o2, o3));
    }
  }
  return Float64Array.from(plans);
}

/** Round outcome on a fresh copy: +1 white decisive, −1 black decisive, 0 open.
 *  Decisive = a king captured in the round, or the NEXT round's leader ending
 *  this round with the enemy king under attack (its step-1 capture can't be
 *  answered). `nextLead` is who leads next round (-1: nobody knows — then no
 *  first strike counts). */
export function roundPayoff(
  start: Int8Array,
  scratch: Int8Array,
  whitePlan: number,
  blackPlan: number,
  first: number,
  nextLead: number,
): number {
  scratch.set(start);
  const winner = resolve(scratch, whitePlan, blackPlan, first);
  if (winner === 1) return 1;
  if (winner === 2) return -1;
  if (nextLead === WHITE) {
    const k = kingSquare(scratch, BLACK);
    if (k >= 0 && attacked(scratch, k, WHITE)) return 1;
  } else if (nextLead === BLACK) {
    const k = kingSquare(scratch, WHITE);
    if (k >= 0 && attacked(scratch, k, BLACK)) return -1;
  }
  return 0;
}
