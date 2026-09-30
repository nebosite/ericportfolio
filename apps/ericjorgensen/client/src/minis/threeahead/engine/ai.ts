// Three Ahead Chess — the computer player.
//
// The machine plans exactly the way a human does: it takes the current board,
// picks a good order, assumes it succeeds, and plans its next order from that
// predicted position — three plies deep. Each candidate is scored with a
// classic material + placement evaluation, minus a "hanging pieces" penalty
// (what could the opponent take right after this?), with captures on later
// plies discounted because the victim may well have moved by then.
//
// Strength 1–10 is a noise dial: level 10 scores candidates exactly; each
// level below adds random jitter to every candidate's score, so weaker levels
// drift toward second-best (and occasionally worse) choices while still never
// playing outright nonsense — a hung queen is a far bigger score swing than
// the largest jitter.

import {
  Board,
  Order,
  Piece,
  PieceType,
  Side,
  Square,
  cloneBoard,
  executeOrder,
  fileOf,
  onBoard,
  otherSide,
  rankOf,
  square,
} from "./chess";

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

/** Centipawn material values; the king's is only a tiebreak — winning is
 *  detected by the king-capture bonus, not material. */
const VALUE: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 20000,
};

const KING_CAPTURE = 1_000_000;
/** How much to trust a capture planned 1st / 2nd / 3rd — later victims may
 *  have wandered off by the time the order executes. */
const CAPTURE_TRUST = [1, 0.65, 0.45];
/** Weight of the "what hangs after this?" penalty. */
const THREAT_WEIGHT = 0.85;
/** Bonus for RELOCATING the king while an enemy piece could line up on it
 *  within a move. Captures must be predicted at an exact square, so a king
 *  that moves invalidates any snipe aimed at where it stood — dodging is this
 *  variant's core defensive move. Early self-play with stationary kings had
 *  the first mover winning 96% of games on blind king races. */
const DODGE_BONUS = 350;
/** Score jitter per level below 10, in centipawns. */
const NOISE_PER_LEVEL = 34;
/** Knights are this variant's assassins (self-play had them landing 81% of
 *  king captures), so hunting the enemy's and guarding your own SOUNDED like
 *  the right oblique strategy. The A/B said otherwise: a 120cp bounty plus a
 *  12cp king-escort bonus blew the greedy first-mover share from 58% to 95% —
 *  both knobs pull play toward committal, attacker-friendly lines. They ship
 *  OFF and remain only as experiment dials for the self-play soak. */
const KNIGHT_BOUNTY = 0;
/** Per-piece bonus for friendly escorts standing beside the own king. Off —
 *  see above. */
const KING_GUARD = 0;

/** Effective piece value under the strategy knobs. */
function pieceValue(type: PieceType, knightBounty: number): number {
  return VALUE[type] + (type === "knight" ? knightBounty : 0);
}

/** Deterministic PRNG so games (and tests) can be replayed from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- Realistic move generation ------------------------------------------
   Unlike the planner UI (which lets a human aim through squares they expect
   to be vacated), the machine only orders moves that work on its predicted
   board: rays truncated at the first blocker, captures flagged. */

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

interface Candidate {
  order: Order;
  victim: PieceType | null;
}

function slideCandidates(
  board: Board,
  piece: Piece,
  from: Square,
  rays: readonly (readonly [number, number])[],
  out: Candidate[],
): void {
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  for (const [df, dr] of rays) {
    for (let k = 1; ; k++) {
      const f = f0 + df * k;
      const r = r0 + dr * k;
      if (!onBoard(f, r)) break;
      const to = square(f, r);
      const occupant = board[to];
      if (!occupant) {
        out.push({ order: { pieceId: piece.id, from, to, capture: false }, victim: null });
        continue;
      }
      if (occupant.side !== piece.side) {
        out.push({ order: { pieceId: piece.id, from, to, capture: true }, victim: occupant.type });
      }
      break;
    }
  }
}

/** Every order `side` could sensibly seal on this (predicted) board. */
export function generateCandidates(board: Board, side: Side): Candidate[] {
  const out: Candidate[] = [];
  for (let from = 0; from < 64; from++) {
    const piece = board[from];
    if (!piece || piece.side !== side) continue;
    const f0 = fileOf(from);
    const r0 = rankOf(from);
    switch (piece.type) {
      case "rook":
        slideCandidates(board, piece, from, ROOK_RAYS, out);
        break;
      case "bishop":
        slideCandidates(board, piece, from, BISHOP_RAYS, out);
        break;
      case "queen":
        slideCandidates(board, piece, from, [...ROOK_RAYS, ...BISHOP_RAYS], out);
        break;
      case "knight":
      case "king": {
        const jumps = piece.type === "knight" ? KNIGHT_JUMPS : [...ROOK_RAYS, ...BISHOP_RAYS];
        for (const [df, dr] of jumps) {
          if (!onBoard(f0 + df, r0 + dr)) continue;
          const to = square(f0 + df, r0 + dr);
          const occupant = board[to];
          if (occupant && occupant.side === piece.side) continue;
          out.push({
            order: { pieceId: piece.id, from, to, capture: occupant !== null },
            victim: occupant?.type ?? null,
          });
        }
        break;
      }
      case "pawn": {
        const dir = side === "white" ? 1 : -1;
        if (!onBoard(f0, r0 + dir)) break;
        const one = square(f0, r0 + dir);
        if (!board[one]) {
          out.push({ order: { pieceId: piece.id, from, to: one, capture: false }, victim: null });
          const two = square(f0, r0 + 2 * dir);
          if (!piece.hasMoved && onBoard(f0, r0 + 2 * dir) && !board[two]) {
            out.push({ order: { pieceId: piece.id, from, to: two, capture: false }, victim: null });
          }
        }
        for (const df of [-1, 1]) {
          if (!onBoard(f0 + df, r0 + dir)) continue;
          const to = square(f0 + df, r0 + dir);
          const occupant = board[to];
          if (occupant && occupant.side !== piece.side) {
            out.push({
              order: { pieceId: piece.id, from, to, capture: true },
              victim: occupant.type,
            });
          }
        }
        break;
      }
    }
  }
  return out;
}

/* ---- Evaluation ----------------------------------------------------------- */

/** Small placement bonus: centralized minor pieces/queens, advanced pawns. */
function placement(piece: Piece, sq: Square): number {
  const f = fileOf(sq);
  const r = rankOf(sq);
  const centrality = 3 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5)); // 0 rim → ~3 center
  switch (piece.type) {
    case "knight":
      return centrality * 9;
    case "bishop":
      return centrality * 6;
    case "queen":
      return centrality * 2;
    case "rook":
      return centrality * 2;
    case "pawn": {
      const advance = piece.side === "white" ? r - 1 : 6 - r;
      return advance * 6 + centrality * 2;
    }
    case "king":
      return -centrality * 4; // a shy king lives longer
  }
}

/** Static evaluation from `side`'s point of view, in centipawns. */
export function evaluate(board: Board, side: Side, knightBounty = 0, kingGuard = 0): number {
  let score = 0;
  for (let sq = 0; sq < 64; sq++) {
    const piece = board[sq];
    if (!piece) continue;
    const value = pieceValue(piece.type, knightBounty) + placement(piece, sq);
    score += piece.side === side ? value : -value;
  }
  if (kingGuard > 0) score += kingGuard * kingEscorts(board, side);
  return score;
}

/** Friendly pieces standing beside the own king (its escort). */
function kingEscorts(board: Board, side: Side): number {
  let kingSq = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.type === "king" && p.side === side) {
      kingSq = sq;
      break;
    }
  }
  if (kingSq < 0) return 0;
  const f0 = fileOf(kingSq);
  const r0 = rankOf(kingSq);
  let escorts = 0;
  for (const [df, dr] of [...ROOK_RAYS, ...BISHOP_RAYS]) {
    if (!onBoard(f0 + df, r0 + dr)) continue;
    const p = board[square(f0 + df, r0 + dr)];
    if (p && p.side === side) escorts++;
  }
  return escorts;
}

/** Does any piece of `bySide` attack `target`? Scans outward from the target
 *  (rays, knight jumps, pawn diagonals) instead of generating every move —
 *  this sits in the hot path of both planning and self-play. */
export function isAttacked(board: Board, target: Square, bySide: Side): boolean {
  const f0 = fileOf(target);
  const r0 = rankOf(target);
  for (const [df, dr] of KNIGHT_JUMPS) {
    if (!onBoard(f0 + df, r0 + dr)) continue;
    const p = board[square(f0 + df, r0 + dr)];
    if (p && p.side === bySide && p.type === "knight") return true;
  }
  // A bySide pawn attacks diagonally toward its own forward direction, so it
  // sits one rank BEHIND the target relative to that direction.
  const pawnRank = r0 - (bySide === "white" ? 1 : -1);
  for (const df of [-1, 1]) {
    if (!onBoard(f0 + df, pawnRank)) continue;
    const p = board[square(f0 + df, pawnRank)];
    if (p && p.side === bySide && p.type === "pawn") return true;
  }
  return slidersAttack(board, target, bySide);
}

function slidersAttack(board: Board, target: Square, bySide: Side): boolean {
  const f0 = fileOf(target);
  const r0 = rankOf(target);
  for (const [rays, kinds] of [
    [ROOK_RAYS, ["rook", "queen"]],
    [BISHOP_RAYS, ["bishop", "queen"]],
  ] as const) {
    for (const [df, dr] of rays) {
      for (let k = 1; ; k++) {
        const f = f0 + df * k;
        const r = r0 + dr * k;
        if (!onBoard(f, r)) break;
        const p = board[square(f, r)];
        if (!p) continue;
        if (p.side === bySide) {
          if ((kinds as readonly string[]).includes(p.type)) return true;
          if (k === 1 && p.type === "king") return true;
        }
        break; // first occupant along the ray blocks the rest
      }
    }
  }
  return false;
}

/** Does the piece standing on `from` attack `target` on this board? */
function pieceAttacks(board: Board, from: Square, target: Square): boolean {
  const piece = board[from];
  if (!piece || from === target) return false;
  const df = fileOf(target) - fileOf(from);
  const dr = rankOf(target) - rankOf(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);
  switch (piece.type) {
    case "knight":
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    case "king":
      return Math.max(adf, adr) === 1;
    case "pawn":
      return adf === 1 && dr === (piece.side === "white" ? 1 : -1);
    case "rook":
      if (df !== 0 && dr !== 0) return false;
      break;
    case "bishop":
      if (adf !== adr) return false;
      break;
    case "queen":
      if (df !== 0 && dr !== 0 && adf !== adr) return false;
      break;
  }
  const stepF = Math.sign(df);
  const stepR = Math.sign(dr);
  for (let f = fileOf(from) + stepF, r = rankOf(from) + stepR; ; f += stepF, r += stepR) {
    const sq = square(f, r);
    if (sq === target) return true;
    if (board[sq]) return false;
  }
}

/** Can any enemy piece move to a square from which it attacks `side`'s king?
 *  A 2-move king threat: with three sealed moves per round, an attacker two
 *  beats away is lethal, so plans must respect it. */
function kingReachableInTwo(board: Board, side: Side): boolean {
  let kingSq = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.type === "king" && p.side === side) {
      kingSq = sq;
      break;
    }
  }
  if (kingSq < 0) return false;
  for (const cand of generateCandidates(board, otherSide(side))) {
    const attacker = board[cand.order.from]!;
    const victim = board[cand.order.to];
    if (victim?.type === "king") continue; // that's a 1-move threat, priced elsewhere
    board[cand.order.from] = null;
    board[cand.order.to] = attacker;
    const reaches = pieceAttacks(board, cand.order.to, kingSq);
    board[cand.order.from] = attacker;
    board[cand.order.to] = victim ?? null;
    if (reaches) return true;
  }
  return false;
}

/** The biggest immediate grab the opponent has: max over enemy captures of
 *  victim value, discounted by the recapture when the victim is defended. */
function worstThreat(board: Board, side: Side, knightBounty: number): number {
  const enemy = otherSide(side);
  let worst = 0;
  for (const cand of generateCandidates(board, enemy)) {
    if (!cand.victim) continue;
    let gain = pieceValue(cand.victim, knightBounty);
    if (cand.victim !== "king") {
      // Cheap recapture check: pull the attacker off its square, stand it on
      // the target, and ask whether `side` attacks it there.
      const attacker = board[cand.order.from]!;
      const victim = board[cand.order.to];
      board[cand.order.from] = null;
      board[cand.order.to] = attacker;
      if (isAttacked(board, cand.order.to, side)) gain -= VALUE[attacker.type];
      board[cand.order.from] = attacker;
      board[cand.order.to] = victim ?? null;
    }
    if (gain > worst) worst = gain;
  }
  return worst;
}

/* ---- Planning ------------------------------------------------------------- */

function scoreCandidate(
  board: Board,
  side: Side,
  cand: Candidate,
  ply: number,
  knightBounty: number,
  kingGuard: number,
): number {
  const after = cloneBoard(board);
  const step = executeOrder(after, cand.order);
  if (step.captured?.type === "king") return KING_CAPTURE - ply * 1000; // sooner is safer
  let score = evaluate(after, side, knightBounty, kingGuard);
  // Later-ply captures are speculative — refund part of the victim's value.
  if (step.captured) {
    score -= pieceValue(step.captured.type, knightBounty) * (1 - CAPTURE_TRUST[ply]);
  }
  // Don't leave the goods on the counter.
  score -= worstThreat(after, side, knightBounty) * THREAT_WEIGHT;
  return score;
}

export interface PlanOptions {
  /** Reward relocating a hunted king (on by default; off reproduces the
   *  stationary-king baseline for self-play experiments). */
  dodge?: boolean;
  /** Extra worth of knights (theirs to hunt, ours to keep); default tuned. */
  knightBounty?: number;
  /** Per-escort bonus for friendly pieces beside the own king; default tuned. */
  kingGuard?: number;
  /** Internal (deep search's enemy model): reward closing on the enemy king. */
  assassin?: boolean;
}

/** Chebyshev distance of the moved piece to the enemy king, as a rush bonus. */
function assassinBonus(board: Board, side: Side, landed: Square): number {
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.type === "king" && p.side !== side) {
      const cheb = Math.max(
        Math.abs(fileOf(sq) - fileOf(landed)),
        Math.abs(rankOf(sq) - rankOf(landed)),
      );
      return (7 - cheb) * 20;
    }
  }
  return 0;
}

/**
 * Seal three orders for `side`. `level` runs 1 (wobbly) to 10 (exact);
 * `rng` defaults to a time-seeded PRNG — pass a seeded one for replays/tests.
 */
export function planOrders(
  board: Board,
  side: Side,
  level: number,
  rng: () => number = mulberry32(Date.now() & 0xffffffff),
  opts: PlanOptions = {},
): Order[] {
  const dodge = opts.dodge ?? true;
  const knightBounty = opts.knightBounty ?? KNIGHT_BOUNTY;
  const kingGuard = opts.kingGuard ?? KING_GUARD;
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
  const noise = (MAX_LEVEL - clamped) * NOISE_PER_LEVEL;
  const predicted = cloneBoard(board);
  const orders: Order[] = [];
  for (let ply = 0; ply < 3; ply++) {
    const candidates = generateCandidates(predicted, side);
    if (candidates.length === 0) break;
    // Is someone lining up on our king? Then the king should MOVE — a sealed
    // capture aims at a fixed square, so relocation defeats it. The urge fades
    // on later plies (dodging early leaves fewer beats for the snipe to land).
    const hunted = dodge && kingReachableInTwo(predicted, side);
    const dodgeBonus = hunted ? DODGE_BONUS * (1 - ply * 0.35) : 0;
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const cand of candidates) {
      const jitter = noise > 0 ? (rng() * 2 - 1) * noise : 0;
      const mover = predicted[cand.order.from]!;
      const bonus = dodgeBonus > 0 && mover.type === "king" ? dodgeBonus : 0;
      const rush =
        opts.assassin && mover.type !== "king" ? assassinBonus(predicted, side, cand.order.to) : 0;
      const score =
        scoreCandidate(predicted, side, cand, ply, knightBounty, kingGuard) +
        bonus +
        rush +
        jitter +
        rng() * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    orders.push(best!.order);
    executeOrder(predicted, best!.order); // assume it succeeds, plan from there
  }
  return orders;
}

/* ---- Deep planning: a time budget spent second-guessing the plan ------------
   The greedy planner above ignores interleaving — it assumes the enemy stands
   still for all three beats. The deep planner spends its budget fixing exactly
   that: it seeds with the greedy plan, then repeatedly tries variants (one ply
   swapped for a different idea, the rest replanned greedily) and scores each
   whole plan by actually RESOLVING the round against predicted enemy plans.
   Whatever survives the rollouts best is sealed. */

/** Thinking budget per level, in ms. Levels 1–3 stay instant (their charm is
 *  the wobble, not the depth); from 4 up the budget grows to 10s at level 10. */
export function levelBudgetMs(level: number): number {
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)));
  return clamped < 4 ? 0 : clamped * clamped * 100;
}

export interface DeepOptions extends PlanOptions {
  /** Wall-clock budget; defaults to levelBudgetMs(level). */
  budgetMs?: number;
  /** Hard cap on plan rollouts, for deterministic tests and self-play. */
  maxRollouts?: number;
  /** Yield to the event loop every N rollouts (0 = never; default 8 keeps the
   *  UI alive during long thinks). */
  yieldEvery?: number;
  /** Under the first-to-seal house rule the lead is unknown at planning time,
   *  so BOTH sides plan as if they follow — the same pessimism for everyone,
   *  instead of white assuming boldness and black assuming meekness. */
  raceLead?: boolean;
}

/** All squares a piece of `type`/`side` standing (virtually) on `from` could
 *  move to on `board`: empty squares and enemy-piece squares (a capture, with
 *  the prediction assumed correct), with sliders blocked normally. */
function pieceMovesFrom(board: Board, type: PieceType, side: Side, from: Square): Square[] {
  const out: Square[] = [];
  const f0 = fileOf(from);
  const r0 = rankOf(from);
  const push = (to: Square): boolean => {
    // returns false when a slider must stop after this square
    const occupant = board[to];
    if (occupant && occupant.side === side) return false;
    out.push(to);
    return occupant === null;
  };
  switch (type) {
    case "knight":
    case "king": {
      const jumps = type === "knight" ? KNIGHT_JUMPS : [...ROOK_RAYS, ...BISHOP_RAYS];
      for (const [df, dr] of jumps) {
        if (onBoard(f0 + df, r0 + dr)) push(square(f0 + df, r0 + dr));
      }
      break;
    }
    case "rook":
    case "bishop":
    case "queen": {
      const rays =
        type === "rook"
          ? ROOK_RAYS
          : type === "bishop"
            ? BISHOP_RAYS
            : [...ROOK_RAYS, ...BISHOP_RAYS];
      for (const [df, dr] of rays) {
        for (let k = 1; ; k++) {
          const f = f0 + df * k;
          const r = r0 + dr * k;
          if (!onBoard(f, r)) break;
          if (!push(square(f, r))) break;
        }
      }
      break;
    }
    case "pawn": {
      const dir = side === "white" ? 1 : -1;
      if (onBoard(f0, r0 + dir) && !board[square(f0, r0 + dir)]) out.push(square(f0, r0 + dir));
      for (const df of [-1, 1]) {
        if (!onBoard(f0 + df, r0 + dir)) continue;
        const to = square(f0 + df, r0 + dir);
        const occupant = board[to];
        if (occupant && occupant.side !== side) out.push(to);
      }
      break;
    }
  }
  return out;
}

/**
 * The lone-hunter test: can any single enemy piece relay its three beats into
 * capturing my king ON THE SQUARE WHERE IT NOW STANDS? This is the kill
 * pattern that decides most games (a knight two or three hops out is invisible
 * to one-move threat horizons), so the deep planner rejects any plan that
 * fails it. Two modelling choices matter:
 *   - Blockers follow MY plan (the hunter is credited with good guesses), but
 *     the TARGET is my king's planning-time square. Orders are sealed blind,
 *     so a king move cannot be predicted — any plan that moves the king before
 *     the hunt lands therefore breaks the hunt. (An earlier version let the
 *     hunter track the dodging king through my own plan's snapshots; that made
 *     every plan from round 2 on look doomed — a knight relay nearly always
 *     exists — and the vetoed-everything search degenerated to noise.)
 *   - Other enemy pieces stand still, keeping the search tiny (a BFS over ≤64
 *     squares × 3 beats per enemy piece).
 * Returns the earliest killing enemy beat (1–3) and the hunter, or null.
 */
export interface HuntResult {
  /** Earliest enemy beat (1–3) that captures my king. */
  beat: number;
  /** Where the successful hunter starts from. */
  hunter: Square;
}

export function planKingHunt(
  board: Board,
  myPlan: Order[],
  mySide: Side,
  iLead: boolean,
): HuntResult | null {
  // snapshots[k] = the board after my first k orders execute unopposed.
  const snapshots: Board[] = [cloneBoard(board)];
  {
    const sim = cloneBoard(board);
    for (const order of myPlan) {
      executeOrder(sim, order);
      snapshots.push(cloneBoard(sim));
    }
    while (snapshots.length < 4) snapshots.push(snapshots[snapshots.length - 1]);
  }
  // The hunter aims at where my king stands NOW…
  let kingSq = -1;
  let kingId = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.type === "king" && p.side === mySide) {
      kingSq = sq;
      kingId = p.id;
      break;
    }
  }
  if (kingSq < 0) return null;
  // …and an unpredictable king move breaks any hunt that lands after it.
  let kingMoveStep = Number.POSITIVE_INFINITY;
  for (let i = 0; i < myPlan.length; i++) {
    if (myPlan[i].pieceId === kingId) {
      kingMoveStep = iLead ? 2 * (i + 1) - 1 : 2 * (i + 1);
      break;
    }
  }
  const enemy = otherSide(mySide);
  let earliest: HuntResult | null = null;
  for (let start = 0; start < 64; start++) {
    const hunter = board[start];
    if (!hunter || hunter.side !== enemy) continue;
    // If I lead and my very first order takes the hunter where it stands, the
    // hunt never starts.
    if (iLead && myPlan[0]?.capture && myPlan[0].to === start) continue;
    // Frontier states carry a promotion flag: a pawn buzzsaw that captures its
    // way up the board (pawns ARE hunters here — one ate a knight, a pawn and
    // a king in a single trace) keeps hunting as a queen once it crowns.
    const lastRank = enemy === "white" ? 7 : 0;
    let frontier = new Map<Square, boolean>([[start, hunter.type !== "pawn"]]);
    for (let beat = 1; beat <= 3 && frontier.size > 0; beat++) {
      if (earliest !== null && beat >= earliest.beat) break;
      // A kill on this beat lands at this global step of the round…
      const killStep = iLead ? 2 * beat : 2 * beat - 1;
      // …and is only real while my king hasn't slipped away first.
      if (killStep >= kingMoveStep) break;
      // If I lead the round, my beat-k order lands before the enemy's beat k.
      const snap = snapshots[Math.min(iLead ? beat : beat - 1, 3)];
      const next = new Map<Square, boolean>();
      for (const [pos, grown] of frontier) {
        const moveType = hunter.type === "pawn" && grown ? "queen" : hunter.type;
        for (const to of pieceMovesFromHunter(snap, hunter, start, pos, moveType)) {
          if (to === kingSq) {
            earliest = { beat, hunter: start };
            break;
          }
          const crowns = grown || (hunter.type === "pawn" && rankOf(to) === lastRank);
          if (crowns || !next.has(to)) next.set(to, crowns || (next.get(to) ?? false));
        }
        if (earliest !== null) break;
      }
      if (earliest !== null) break;
      frontier = next;
    }
  }
  return earliest;
}

/* ---- Full threat search: clearing beats and the next-round first strike -----
   planKingHunt above models a lone hunter that stays inside this round. Two
   real kill patterns escape it (found by a human beating level 10 with
   e4, Qh5, Qxf7):
     1. The hunter's side may spend a beat CLEARING its own blocker (e2-e4
        opens d1-h5), so a friendly piece in the way is a one-beat toll, not
        a wall.
     2. If the enemy leads the NEXT round, a hunter that merely ENDS this round
        attacking my king kills it at next round's step 1 — before I can move.
   kingThreats models both. Its answer is pessimistic by design (the hunter is
   credited with knowing my plan), so callers use the threat COUNT to rank
   plans that can't be made fully safe. */

export interface KingThreat {
  /** Global step of the killing blow: 1–6 this round, 7 = next round's step 1. */
  step: number;
  /** Where the hunter starts this round. */
  hunter: Square;
  /** For next-round threats: the square the hunter ends the round on. */
  landing: Square;
}

/** Hunter-side moves from `pos` on `snap`, with the beat cost of each: 1 per
 *  move plus 1 per own (hunter-side) piece that must first be cleared away. */
function huntMoves(
  snap: Board,
  type: PieceType,
  side: Side,
  pos: Square,
): { to: Square; cost: number }[] {
  const out: { to: Square; cost: number }[] = [];
  const f0 = fileOf(pos);
  const r0 = rankOf(pos);
  const toll = (sq: Square) => (snap[sq] && snap[sq]!.side === side ? 1 : 0);
  switch (type) {
    case "knight":
    case "king": {
      const jumps = type === "knight" ? KNIGHT_JUMPS : [...ROOK_RAYS, ...BISHOP_RAYS];
      for (const [df, dr] of jumps) {
        if (!onBoard(f0 + df, r0 + dr)) continue;
        const to = square(f0 + df, r0 + dr);
        out.push({ to, cost: 1 + toll(to) });
      }
      break;
    }
    case "rook":
    case "bishop":
    case "queen": {
      const rays =
        type === "rook"
          ? ROOK_RAYS
          : type === "bishop"
            ? BISHOP_RAYS
            : [...ROOK_RAYS, ...BISHOP_RAYS];
      for (const [df, dr] of rays) {
        let cleared = 0;
        for (let k = 1; ; k++) {
          const f = f0 + df * k;
          const r = r0 + dr * k;
          if (!onBoard(f, r)) break;
          const sq = square(f, r);
          const occupant = snap[sq];
          if (occupant && occupant.side === side) {
            // A pawn can't clear a file by pushing along it (d2-d4 still
            // blocks d1-d7); anything else steps aside for one beat.
            if (occupant.type === "pawn" && df === 0) break;
            cleared++;
            // Pass through, but don't STAND where a pawn stood: it only
            // stepped up its own file, so file routes from here stay shut.
            if (occupant.type !== "pawn") out.push({ to: sq, cost: 1 + cleared });
            continue;
          }
          out.push({ to: sq, cost: 1 + cleared });
          if (occupant) break; // one of mine: a capture ends the ray
        }
      }
      break;
    }
    case "pawn": {
      const dir = side === "white" ? 1 : -1;
      if (onBoard(f0, r0 + dir)) {
        const one = square(f0, r0 + dir);
        const occupant = snap[one];
        if (!occupant || occupant.side === side) out.push({ to: one, cost: 1 + toll(one) });
        for (const df of [-1, 1]) {
          if (!onBoard(f0 + df, r0 + dir)) continue;
          const diag = square(f0 + df, r0 + dir);
          const victim = snap[diag];
          if (victim && victim.side !== side) out.push({ to: diag, cost: 1 });
        }
      }
      break;
    }
  }
  return out;
}

/** Beats a hunter of `type` standing on `from` still needs (clearing tolls)
 *  before it attacks `target` on `snap`; null if it can't attack it at all. */
function attackToll(
  snap: Board,
  type: PieceType,
  side: Side,
  from: Square,
  target: Square,
): number | null {
  if (from === target) return null;
  const df = fileOf(target) - fileOf(from);
  const dr = rankOf(target) - rankOf(from);
  const adf = Math.abs(df);
  const adr = Math.abs(dr);
  switch (type) {
    case "knight":
      return (adf === 1 && adr === 2) || (adf === 2 && adr === 1) ? 0 : null;
    case "king":
      return Math.max(adf, adr) === 1 ? 0 : null;
    case "pawn":
      return adf === 1 && dr === (side === "white" ? 1 : -1) ? 0 : null;
    case "rook":
      if (df !== 0 && dr !== 0) return null;
      break;
    case "bishop":
      if (adf !== adr) return null;
      break;
    case "queen":
      if (df !== 0 && dr !== 0 && adf !== adr) return null;
      break;
  }
  const stepF = Math.sign(df);
  const stepR = Math.sign(dr);
  let toll = 0;
  for (let f = fileOf(from) + stepF, r = rankOf(from) + stepR; ; f += stepF, r += stepR) {
    const sq = square(f, r);
    if (sq === target) return toll;
    const occupant = snap[sq];
    if (!occupant) continue;
    if (occupant.side !== side) return null; // one of the defender's pieces blocks the line
    if (occupant.type === "pawn" && stepF === 0) return null; // a pawn can't leave its file
    toll++;
  }
}

/**
 * Every way a single enemy piece (with its side's help clearing the road) can
 * kill my king while `myPlan` executes, or set up an unanswerable first strike
 * for the next round. `enemyLeadsNext` switches on the next-round threats.
 * A next-round threat is NEUTRALIZED when my third order is an ambush — a
 * capture aimed at the hunter's landing square that executes after it lands
 * (only possible when I follow this round).
 */
export function kingThreats(
  board: Board,
  myPlan: Order[],
  mySide: Side,
  iLead: boolean,
  enemyLeadsNext: boolean,
): KingThreat[] {
  const snapshots: Board[] = [cloneBoard(board)];
  const sim = cloneBoard(board);
  for (const order of myPlan) {
    executeOrder(sim, order);
    snapshots.push(cloneBoard(sim));
  }
  while (snapshots.length < 4) snapshots.push(snapshots[snapshots.length - 1]);
  const endSnap = snapshots[3];

  let kingSq = -1;
  let kingId = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.type === "king" && p.side === mySide) {
      kingSq = sq;
      kingId = p.id;
      break;
    }
  }
  if (kingSq < 0) return [];
  let endKingSq = -1;
  for (let sq = 0; sq < 64; sq++) {
    if (endSnap[sq]?.id === kingId) endKingSq = sq;
  }
  let kingMoveStep = Number.POSITIVE_INFINITY;
  for (let i = 0; i < myPlan.length; i++) {
    if (myPlan[i].pieceId === kingId) {
      kingMoveStep = iLead ? 2 * (i + 1) - 1 : 2 * (i + 1);
      break;
    }
  }
  const ambush = !iLead && myPlan[2]?.capture ? myPlan[2].to : -1;

  const enemy = otherSide(mySide);
  const lastRank = enemy === "white" ? 7 : 0;
  const threats: KingThreat[] = [];
  for (let start = 0; start < 64; start++) {
    const hunter = board[start];
    if (!hunter || hunter.side !== enemy) continue;
    if (iLead && myPlan[0]?.capture && myPlan[0].to === start) continue;
    // best[sq] = fewest beats to stand on sq; grown = crowned pawn on the way.
    const best = new Map<Square, { beats: number; grown: boolean }>();
    best.set(start, { beats: 0, grown: hunter.type !== "pawn" });
    let frontier: Square[] = [start];
    let inRoundStep = Number.POSITIVE_INFINITY;
    for (let wave = 0; wave < 3 && frontier.length > 0; wave++) {
      const next: Square[] = [];
      for (const pos of frontier) {
        const here = best.get(pos)!;
        const moveType: PieceType = hunter.type === "pawn" && here.grown ? "queen" : hunter.type;
        for (const { to, cost } of (() => {
          const beat = here.beats + 1;
          const snap = snapshots[Math.min(iLead ? beat : beat - 1, 3)];
          const original = snap[start];
          if (original?.id === hunter.id) snap[start] = null;
          const moves = huntMoves(snap, moveType, enemy, pos);
          snap[start] = original ?? null;
          return moves;
        })()) {
          const beats = here.beats + cost;
          if (beats > 3) continue;
          if (to === kingSq) {
            const step = iLead ? 2 * beats : 2 * beats - 1;
            if (step < kingMoveStep) inRoundStep = Math.min(inRoundStep, step);
            continue;
          }
          const grown = here.grown || (hunter.type === "pawn" && rankOf(to) === lastRank);
          const seen = best.get(to);
          if (!seen || beats < seen.beats || (grown && !seen.grown)) {
            best.set(to, { beats, grown });
            next.push(to);
          }
        }
      }
      frontier = next;
    }
    if (inRoundStep !== Number.POSITIVE_INFINITY) {
      threats.push({ step: inRoundStep, hunter: start, landing: kingSq });
      continue;
    }
    if (!enemyLeadsNext || endKingSq < 0) continue;
    // Next round, step 1: can the hunter END this round attacking my king?
    const original = endSnap[start];
    if (original?.id === hunter.id) endSnap[start] = null;
    for (const [pos, { beats, grown }] of best) {
      if (pos === ambush) continue; // my third order captures it on arrival
      const type: PieceType = hunter.type === "pawn" && grown ? "queen" : hunter.type;
      const toll = attackToll(endSnap, type, enemy, pos, endKingSq);
      if (toll !== null && beats + toll <= 3) {
        // Every landing counts: blocking one of a bishop's two roads is real
        // progress even while the other stays open.
        threats.push({ step: 7, hunter: start, landing: pos });
      }
    }
    endSnap[start] = original ?? null;
  }
  return threats;
}

/** Moves for the hunter standing (virtually) at `pos`, on a snapshot where its
 *  original square may still show it — that square is treated as empty. */
function pieceMovesFromHunter(
  snap: Board,
  hunter: Piece,
  originalSquare: Square,
  pos: Square,
  moveType: PieceType,
): Square[] {
  const original = snap[originalSquare];
  if (original?.id === hunter.id) snap[originalSquare] = null;
  const moves = pieceMovesFrom(snap, moveType, hunter.side, pos);
  snap[originalSquare] = original ?? null;
  return moves;
}

/**
 * How dangerous a set of threats is. The defender's odds depend on how many
 * enemy pieces could strike (each must GUESS my sealed plan), not on how many
 * squares one piece could strike from — so danger is counted per hunter, with
 * only a small extra per additional landing (enough to reward a block that
 * shuts one of a bishop's two roads). A strike at the square my king stands on
 * now needs no guessing and weighs most; one aimed at where my king will have
 * moved to weighs least.
 */
export function threatDanger(threats: KingThreat[], kingMoves: boolean): number {
  const byHunter = new Map<Square, { weight: number; landings: number }>();
  for (const t of threats) {
    const weight = t.step < 7 ? 3 : kingMoves ? 1 : 2;
    const seen = byHunter.get(t.hunter);
    if (!seen) byHunter.set(t.hunter, { weight, landings: 1 });
    else {
      seen.weight = Math.max(seen.weight, weight);
      seen.landings++;
    }
  }
  let danger = 0;
  for (const { weight, landings } of byHunter.values())
    danger += weight * (1 + 0.1 * (landings - 1));
  return danger;
}

/** Bonus for ending my plan with the enemy king's square (and, to a lesser
 *  degree, its escape squares) under attack — lethal when I lead next round,
 *  unless the enemy's sealed plan happens to move the king away. */
function leaderPressure(board: Board, side: Side): number {
  let kingSq = -1;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (p && p.type === "king" && p.side !== side) kingSq = sq;
  }
  if (kingSq < 0) return 0;
  let bonus = isAttacked(board, kingSq, side) ? 900 : 0;
  const f0 = fileOf(kingSq);
  const r0 = rankOf(kingSq);
  for (const [df, dr] of [...ROOK_RAYS, ...BISHOP_RAYS]) {
    if (onBoard(f0 + df, r0 + dr) && isAttacked(board, square(f0 + df, r0 + dr), side)) {
      bonus += 40;
    }
  }
  return bonus;
}

/** Every third order that would capture a hunter arriving on `landing`, for a
 *  plan whose first orders are `prefix`: my pieces able to strike that square
 *  once an enemy stands on it (it may be empty, or even hold my own piece that
 *  the hunter will have taken). */
function ambushOrders(board: Board, prefix: Order[], side: Side, landing: Square): Order[] {
  const predicted = cloneBoard(board);
  for (const order of prefix) executeOrder(predicted, order);
  const original = predicted[landing];
  predicted[landing] = { id: -1, side: otherSide(side), type: "pawn", hasMoved: true };
  const orders: Order[] = [];
  for (let from = 0; from < 64; from++) {
    const piece = predicted[from];
    if (!piece || piece.side !== side) continue;
    if (pieceMovesFrom(predicted, piece.type, side, from).includes(landing)) {
      orders.push({ pieceId: piece.id, from, to: landing, capture: true });
    }
  }
  predicted[landing] = original;
  return orders;
}

/** One plan variant: force a random candidate at a random ply, then finish the
 *  remaining plies greedily. */
function mutatePlan(
  board: Board,
  side: Side,
  plan: Order[],
  level: number,
  rng: () => number,
  opts: PlanOptions,
): Order[] {
  const ply = Math.floor(rng() * 3);
  const predicted = cloneBoard(board);
  const orders: Order[] = [];
  for (let i = 0; i < ply && i < plan.length; i++) {
    orders.push(plan[i]);
    executeOrder(predicted, plan[i]);
  }
  const candidates = generateCandidates(predicted, side);
  if (candidates.length === 0) return plan;
  const forced = candidates[Math.floor(rng() * candidates.length)];
  orders.push(forced.order);
  executeOrder(predicted, forced.order);
  const rest = planOrders(predicted, side, level, rng, opts);
  for (const order of rest) {
    if (orders.length >= 3) break;
    orders.push(order);
  }
  return orders;
}

/**
 * Seal three orders with real thinking time. Seeds with the greedy plan, then
 * hill-climbs plan variants against predicted enemy plans until the budget
 * runs out. Async so a 10-second think doesn't freeze the page.
 */
export async function planOrdersDeep(
  board: Board,
  side: Side,
  level: number,
  rng: () => number = mulberry32(Date.now() & 0xffffffff),
  opts: DeepOptions = {},
): Promise<Order[]> {
  const budgetMs = opts.budgetMs ?? levelBudgetMs(level);
  const maxRollouts = opts.maxRollouts ?? Number.POSITIVE_INFINITY;
  const yieldEvery = opts.yieldEvery ?? 8;
  const knightBounty = opts.knightBounty ?? KNIGHT_BOUNTY;
  const kingGuard = opts.kingGuard ?? KING_GUARD;

  const seed = planOrders(board, side, level, rng, opts);
  if (budgetMs <= 0 || maxRollouts <= 0 || seed.length < 3) return seed;

  // Deep thinking must RESPECT THE FOG. Every rollout design that scored plans
  // by resolving rounds against explicit enemy plans — min-scored, mean-scored,
  // with any cast of greedy/assassin/dodger models, any stakes — made the
  // machine WORSE: the real adversary optimizes against you and is never in
  // the sampled cast, so rollout-fitted plans are brittle, the defender pays
  // for the mismatch, and the first mover's win share climbed from 58% to
  // 93–100% in self-play. So the budget buys breadth, not clairvoyance: sample
  // many greedy plans (each a coherent, fog-disciplined line) plus targeted
  // defensive plans, and judge every one by greedy's own trusted plan-level
  // criteria — final material with speculative captures discounted, hanging
  // pieces, and the lone-hunter veto. No imagined enemy ever moves.
  const iLead = opts.raceLead ? false : side === "white";
  // Who strikes first next round? Without the race rule Ivory always does;
  // under it nobody knows, so each side assumes the worst: the enemy.
  const enemyLeadsNext = opts.raceLead ? true : side === "black";
  const iLeadNext = !opts.raceLead && side === "white";
  const threatsOf = (plan: Order[]) => kingThreats(board, plan, side, iLead, enemyLeadsNext);
  const scorePlan = (plan: Order[]): number => {
    const sim = cloneBoard(board);
    let trustRefund = 0;
    let myKillStep = Number.POSITIVE_INFINITY;
    for (let ply = 0; ply < plan.length; ply++) {
      const step = executeOrder(sim, plan[ply]);
      if (step.captured) {
        if (step.captured.type === "king" && myKillStep === Number.POSITIVE_INFINITY) {
          myKillStep = iLead ? 2 * ply + 1 : 2 * ply + 2;
        }
        trustRefund +=
          pieceValue(step.captured.type, knightBounty) * (1 - CAPTURE_TRUST[Math.min(ply, 2)]);
      }
    }
    // Both kills in a round are provable the same way (the victim can't know),
    // so a mutual race is decided by the beat order: my kill only counts if it
    // lands BEFORE any provable kill against me. This is what stops two deep
    // planners from happily racing each other — the slower racer reads its own
    // death and defends instead.
    const threats = threatsOf(plan);
    let enemyKillStep = Number.POSITIVE_INFINITY;
    for (const t of threats) enemyKillStep = Math.min(enemyKillStep, t.step);
    if (myKillStep < enemyKillStep) return KING_CAPTURE - myKillStep;
    let score = evaluate(sim, side, knightBounty, kingGuard) - trustRefund;
    score -= worstThreat(sim, side, knightBounty) * THREAT_WEIGHT;
    // The leader's first strike: ending the round with the enemy king (or the
    // squares it could flee to) under attack is the lethal pattern in reverse.
    if (iLeadNext) score += leaderPressure(sim, side);
    if (threats.length > 0) {
      // A threatened plan is only as good as the enemy's odds of guessing it.
      // A strike at the square my king stands on NOW needs no guessing, so it
      // weighs heaviest; one aimed at where my king will have moved to is a
      // guess the enemy must get right. More ways in, worse odds.
      const kingId = board.find((p) => p?.type === "king" && p.side === side)?.id;
      const kingMoves = plan.some((o) => o.pieceId === kingId);
      const danger = threatDanger(threats, kingMoves);
      // Jitter smaller than one threat: near-equal defenses are chosen at
      // random, so an opponent can't learn one rush that always lands.
      score = -KING_CAPTURE - danger * 600 + score / 10 + rng() * 200;
    }
    return score;
  };

  let bestPlan = seed;
  let bestScore = scorePlan(seed);
  let rollouts = 1;
  const consider = (plan: Order[]) => {
    if (plan.length < 3) return;
    const score = scorePlan(plan);
    rollouts++;
    if (score > bestScore) {
      bestScore = score;
      bestPlan = plan;
    }
  };

  // Rescue heuristic: when the seed plan is hunted, random sampling is a slow
  // way to stumble onto salvation — so try the obvious defenses first: every
  // king flight, and every capture of a hunter, each completed greedily.
  const seedThreats = threatsOf(seed);
  if (seedThreats.length > 0) {
    const hunters = new Set(seedThreats.map((t) => t.hunter));
    for (const cand of generateCandidates(board, side)) {
      const mover = board[cand.order.from]!;
      const flight = mover.type === "king" && !cand.victim;
      const execution = hunters.has(cand.order.to) && cand.order.capture;
      if (!flight && !execution) continue;
      const predicted = cloneBoard(board);
      executeOrder(predicted, cand.order);
      consider([cand.order, ...planOrders(predicted, side, level, rng, opts).slice(0, 2)]);
    }
  }
  // Ambush rescue: a first strike needs the hunter to END the round on a
  // landing square — so seal a third order that captures on that square
  // after it arrives (Kxf7 answers e4, Qh5, Qxf7). Rerun on every new
  // champion: its first two orders may already block some landings, which
  // changes which square is worth ambushing.
  const ambushPass = () => {
    if (iLead) return;
    for (let pass = 0; pass < 3; pass++) {
      const landings = new Set(
        threatsOf(bestPlan)
          .filter((t) => t.step === 7)
          .map((t) => t.landing),
      );
      if (landings.size === 0) break;
      const before = bestPlan;
      const prefix = bestPlan.slice(0, 2);
      for (const landing of landings) {
        for (const ambush of ambushOrders(board, prefix, side, landing)) {
          consider([prefix[0], prefix[1], ambush]);
        }
      }
      if (bestPlan === before) break;
    }
  };
  ambushPass();

  // Defensive beam: when the enemy has many ways in, build plans that shut
  // them one order at a time — the two orders that cut the most threat
  // routes (blocks like e6 and Nc6 each close several diagonals), then the
  // best ambush on what's left.
  if (!iLead && threatsOf(bestPlan).length > 0) {
    const BEAM = 6;
    const weigh = (plan: Order[]) =>
      // random tie-breaks: no single rush is a sure thing
      threatDanger(threatsOf(plan), true) + rng() * 0.05;
    let beams: Order[][] = [[]];
    for (let ply = 0; ply < 2; ply++) {
      const scored: { plan: Order[]; danger: number }[] = [];
      for (const prefix of beams) {
        const predicted = cloneBoard(board);
        for (const order of prefix) executeOrder(predicted, order);
        for (const cand of generateCandidates(predicted, side)) {
          const plan = [...prefix, cand.order];
          scored.push({ plan, danger: weigh(plan) });
        }
      }
      scored.sort((a, b) => a.danger - b.danger);
      beams = scored.slice(0, BEAM).map((s) => s.plan);
    }
    for (const prefix of beams) {
      const landings = new Set(
        threatsOf(prefix)
          .filter((t) => t.step === 7)
          .map((t) => t.landing),
      );
      for (const landing of landings) {
        for (const ambush of ambushOrders(board, prefix, side, landing)) {
          consider([...prefix, ambush]);
        }
      }
      const predicted = cloneBoard(board);
      for (const order of prefix) executeOrder(predicted, order);
      consider([...prefix, ...planOrders(predicted, side, level, rng, opts).slice(0, 1)]);
    }
  }

  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline && rollouts < maxRollouts) {
    // Half the time explore a fresh mutated line, half refine the champion.
    const parent = rng() < 0.5 ? bestPlan : seed;
    const variant = mutatePlan(board, side, parent, level, rng, opts);
    const score = scorePlan(variant);
    rollouts++;
    if (score > bestScore) {
      bestScore = score;
      bestPlan = variant;
      ambushPass();
    }
    if (yieldEvery > 0 && rollouts % yieldEvery === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return bestPlan;
}
