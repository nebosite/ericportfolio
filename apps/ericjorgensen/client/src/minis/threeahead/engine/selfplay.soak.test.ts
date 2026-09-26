import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { Board, Order, PieceType, Side, initialBoard, resolveRound } from "./chess";
import { DeepOptions, mulberry32, planOrders, planOrdersDeep } from "./ai";

// Self-play soak study — NOT part of the normal suite (it takes minutes).
// Run it by hand to probe the game's balance for degenerate win conditions:
//
//   SELFPLAY=1 npx vitest run --root apps/ericjorgensen/client \
//     src/minis/threeahead/engine/selfplay.soak.test.ts
//
// Tunables: SELFPLAY_GAMES (default 2000), SELFPLAY_LEVEL (default 10).
// It reports first-mover (white) win share, game-length distribution, which
// piece delivered the killing blow, and on which of the winner's three sealed
// orders the king fell.

const GAMES = Number(process.env.SELFPLAY_GAMES ?? 2000);
const LEVEL = Number(process.env.SELFPLAY_LEVEL ?? 10);
/** 0 disables the king-dodge heuristic (stationary-king baseline). */
const DODGE = process.env.SELFPLAY_DODGE !== "0";
/** "black" leads every round; "alt" alternates the lead by round parity;
 *  "race" flips a per-round coin (models the first-to-seal house rule). */
const FIRST = process.env.SELFPLAY_FIRST ?? "white";
/** Strategy knobs: unset = shipped defaults; a number overrides. */
const KNIGHT = process.env.SELFPLAY_KNIGHT ? Number(process.env.SELFPLAY_KNIGHT) : undefined;
const GUARD = process.env.SELFPLAY_GUARD ? Number(process.env.SELFPLAY_GUARD) : undefined;
/** Deep-search rollouts per plan for each side (0/unset = greedy). */
const DEEP_W = Number(process.env.SELFPLAY_DEEP_W ?? process.env.SELFPLAY_DEEP ?? 0);
const DEEP_B = Number(process.env.SELFPLAY_DEEP_B ?? process.env.SELFPLAY_DEEP ?? 0);
const ROUND_CAP = 120;

interface GameStat {
  winner: "white" | "black" | null;
  rounds: number;
  captor: PieceType | null;
  /** Which of the winner's three orders in the final round landed the blow (1–3). */
  fatalOrder: number | null;
}

function plan(
  board: Board,
  side: Side,
  rng: () => number,
  deepRollouts: number,
): Order[] | Promise<Order[]> {
  const opts: DeepOptions = {
    dodge: DODGE,
    knightBounty: KNIGHT,
    kingGuard: GUARD,
    raceLead: FIRST === "race",
  };
  if (deepRollouts > 0) {
    return planOrdersDeep(board, side, LEVEL, rng, {
      ...opts,
      budgetMs: Number.MAX_SAFE_INTEGER,
      maxRollouts: deepRollouts,
      yieldEvery: 0,
    });
  }
  return planOrders(board, side, LEVEL, rng, opts);
}

async function playGame(seed: number): Promise<GameStat> {
  const rngW = mulberry32(seed * 2 + 1);
  const rngB = mulberry32(seed * 2 + 2);
  const rngLead = mulberry32(seed * 977 + 5);
  let board = initialBoard();
  for (let round = 1; round <= ROUND_CAP; round++) {
    const white = await plan(board, "white", rngW, DEEP_W);
    const black = await plan(board, "black", rngB, DEEP_B);
    const lead: Side =
      FIRST === "alt"
        ? round % 2 === 1
          ? "white"
          : "black"
        : FIRST === "race"
          ? rngLead() < 0.5
            ? "white"
            : "black"
          : (FIRST as Side);
    const result = resolveRound(board, white, black, lead);
    board = result.board;
    if (result.winner) {
      const last = result.steps[result.steps.length - 1];
      const stepNo = result.steps.length; // 1..6 in lead-then-follow order
      const winnerLed = result.winner === lead;
      const fatalOrder = winnerLed ? (stepNo + 1) / 2 : stepNo / 2;
      return { winner: result.winner, rounds: round, captor: last.pieceType, fatalOrder };
    }
  }
  return { winner: null, rounds: ROUND_CAP, captor: null, fatalOrder: null };
}

describe.skipIf(!process.env.SELFPLAY)("self-play soak", () => {
  it(
    `plays ${GAMES} games at level ${LEVEL} vs level ${LEVEL}`,
    { timeout: 4 * 60 * 60 * 1000 },
    async () => {
      const stats: GameStat[] = [];
      const started = Date.now();
      for (let game = 0; game < GAMES; game++) {
        stats.push(await playGame(game + 1));
        if ((game + 1) % 100 === 0) {
          const secs = ((Date.now() - started) / 1000).toFixed(0);
          console.log(`  …${game + 1}/${GAMES} games (${secs}s)`);
        }
      }

      const white = stats.filter((s) => s.winner === "white").length;
      const black = stats.filter((s) => s.winner === "black").length;
      const draws = stats.filter((s) => s.winner === null).length;
      const decided = white + black;
      const rounds = stats.map((s) => s.rounds).sort((a, b) => a - b);
      const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
      const median = rounds[Math.floor(rounds.length / 2)];
      const pct = (n: number, of: number) => ((100 * n) / of).toFixed(1) + "%";

      const buckets: [string, (r: number) => boolean][] = [
        ["1–3 rounds", (r) => r <= 3],
        ["4–6 rounds", (r) => r >= 4 && r <= 6],
        ["7–10 rounds", (r) => r >= 7 && r <= 10],
        ["11–20 rounds", (r) => r >= 11 && r <= 20],
        ["21+ rounds", (r) => r >= 21],
      ];
      const captors = new Map<string, number>();
      const fatalOrders = new Map<number, number>();
      for (const s of stats) {
        if (s.captor) captors.set(s.captor, (captors.get(s.captor) ?? 0) + 1);
        if (s.fatalOrder) fatalOrders.set(s.fatalOrder, (fatalOrders.get(s.fatalOrder) ?? 0) + 1);
      }

      const lines: string[] = [];
      lines.push(
        `=== Three Ahead Chess self-play: ${GAMES} games, level ${LEVEL}, dodge=${DODGE}, first=${FIRST}, ` +
          `knight=${KNIGHT ?? "default"}, guard=${GUARD ?? "default"}, deepW=${DEEP_W}, deepB=${DEEP_B} ===`,
      );
      lines.push(`Elapsed: ${((Date.now() - started) / 1000).toFixed(0)}s`);
      lines.push(
        `White (first mover): ${white}  (${pct(white, GAMES)}, ${pct(white, decided)} of decided)`,
      );
      lines.push(
        `Black:               ${black}  (${pct(black, GAMES)}, ${pct(black, decided)} of decided)`,
      );
      lines.push(`Draws (${ROUND_CAP}-round cap): ${draws} (${pct(draws, GAMES)})`);
      lines.push(`Game length: avg ${avg.toFixed(1)} rounds, median ${median}`);
      for (const [label, test] of buckets) {
        const n = stats.filter((s) => test(s.rounds)).length;
        lines.push(`  ${label}: ${n} (${pct(n, GAMES)})`);
      }
      lines.push("King captured by:");
      for (const [type, n] of [...captors.entries()].sort((a, b) => b[1] - a[1])) {
        lines.push(`  ${type}: ${n} (${pct(n, decided)})`);
      }
      lines.push("Killing blow landed on winner's order #:");
      for (const n of [1, 2, 3]) {
        lines.push(
          `  order ${n}: ${fatalOrders.get(n) ?? 0} (${pct(fatalOrders.get(n) ?? 0, decided)})`,
        );
      }

      const report = lines.join("\n");
      console.log("\n" + report);
      if (process.env.SELFPLAY_OUT) fs.writeFileSync(process.env.SELFPLAY_OUT, report + "\n");

      expect(stats).toHaveLength(GAMES);
    },
  );
});
