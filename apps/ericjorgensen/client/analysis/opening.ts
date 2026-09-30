// Three Ahead Chess — exhaustive analysis of round 1.
//
//   npx tsx apps/ericjorgensen/client/analysis/opening.ts [--space sensible|full]
//       [--workers N] [--skip-matrix] [--skip-equilibrium]
//
// From the starting position, every plan Ivory can seal is played against
// every plan Onyx can seal (4.7 × 10^10 pairs in the full space), and three
// questions are answered exactly:
//
//   1. COUNTS — how many pairings end with Ivory winning (a king captured in
//      the round, or Ivory ending the round with Onyx's king under attack:
//      Ivory leads round 2, so that strike can't be answered), Onyx winning,
//      or open. Distinct resulting positions are estimated with HyperLogLog.
//   2. FORCED WINS — is there one plan that wins against EVERY reply?
//   3. EQUILIBRIUM — the value of round 1 under optimal (mixed) play, solved
//      by double oracle over the full plan spaces, with proven bounds.
//
// Uniform counts describe RANDOM play, not good play — question 3 is the one
// that measures a first-mover advantage between competent players.

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { initialBoard } from "../src/minis/threeahead/engine/chess";
import {
  BLACK,
  KING,
  STATE_SIZE,
  WHITE,
  attacked,
  decodeOrder,
  enumeratePlans,
  execute,
  fromBoard,
  kingSquare,
  orderCapture,
  orderPiece,
  orderTo,
  pieceType,
  piecePos,
  planOrder,
  resolve,
} from "../src/minis/threeahead/engine/fast";
import { solveZeroSum } from "../src/minis/threeahead/engine/nash";

type Space = "sensible" | "full";

/* ---- shared setup (main and workers build identical plan arrays) ----------- */

function setup(space: Space) {
  const pos = fromBoard(initialBoard());
  const start = pos.state;
  const white = enumeratePlans(start, WHITE, space === "full");
  const black = enumeratePlans(start, BLACK, space === "full");
  return { pos, start, white, black };
}

/** Who leads round 2: Ivory under the standard rules; Onyx if leads alternate
 *  (--next-lead black). Set per process from the command line / worker data. */
let nextLead = WHITE;

/** Payoff to Ivory for one round-1 pairing (Ivory leads round 1). A first
 *  strike counts for whichever side leads round 2. */
function payoff(start: Int8Array, scratch: Int8Array, w: number, b: number): number {
  scratch.set(start);
  const winner = resolve(scratch, w, b, WHITE);
  if (winner === 1) return 1;
  if (winner === 2) return -1;
  if (nextLead === WHITE) {
    const k = kingSquare(scratch, BLACK);
    return k >= 0 && attacked(scratch, k, WHITE) ? 1 : 0;
  }
  const k = kingSquare(scratch, WHITE);
  return k >= 0 && attacked(scratch, k, BLACK) ? -1 : 0;
}

/* ---- HyperLogLog: distinct positions without storing them ------------------ */

const HLL_BITS = 14;
const HLL_M = 1 << HLL_BITS;

let hashA = 0;
let hashB = 0;
/** Two 32-bit hashes of a position, left in hashA/hashB (no allocation: this
 *  runs once per pairing). */
function positionHash(s: Int8Array): void {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x9747b28c | 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = s[sq];
    const code = p < 0 ? 0 : 1 + s[64 + p] * 2 + s[160 + p] + (s[128 + p] ? 16 : 0);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ (code + sq), 0x5bd1e995);
    h2 ^= h2 >>> 15;
  }
  h1 ^= h1 >>> 16;
  h1 = Math.imul(h1, 0x85ebca6b);
  h1 ^= h1 >>> 13;
  hashA = h1 >>> 0;
  hashB = h2 >>> 0;
}

function hllAdd(reg: Uint8Array, s: Int8Array) {
  positionHash(s);
  const idx = hashA & (HLL_M - 1);
  const rank = hashB === 0 ? 33 : Math.clz32(hashB) + 1;
  if (rank > reg[idx]) reg[idx] = rank;
}

function hllEstimate(reg: Uint8Array): number {
  let sum = 0;
  let zeros = 0;
  for (let i = 0; i < HLL_M; i++) {
    sum += Math.pow(2, -reg[i]);
    if (reg[i] === 0) zeros++;
  }
  const alpha = 0.7213 / (1 + 1.079 / HLL_M);
  let e = (alpha * HLL_M * HLL_M) / sum;
  if (e <= 2.5 * HLL_M && zeros > 0) e = HLL_M * Math.log(HLL_M / zeros);
  return e;
}

/* ---- worker ------------------------------------------------------------------ */

interface MatrixChunk {
  whiteKill: number;
  blackKill: number;
  whiteStrike: number;
  open: number;
  rowMin: Int8Array; // per white plan in chunk: worst result vs any black plan
  rowScore: Float64Array; // per white plan: (#wins − #losses) over all black plans
  colMax: Int8Array; // per black plan: best white result vs it, within chunk
  colScore: Float64Array; // per black plan: (#white wins − #white losses) within chunk
  hll: Uint8Array;
}

if (!isMainThread) {
  const { space, lo, hi, withHll, lead } = workerData as {
    space: Space;
    lo: number;
    hi: number;
    withHll: boolean;
    lead: number;
  };
  nextLead = lead;
  const { start, white, black } = setup(space);
  const scratch = new Int8Array(STATE_SIZE);
  parentPort!.on("message", (msg: { cmd: string; mix?: { index: number; p: number }[] }) => {
    if (msg.cmd === "matrix") {
      const n = black.length;
      const out: MatrixChunk = {
        whiteKill: 0,
        blackKill: 0,
        whiteStrike: 0,
        open: 0,
        rowMin: new Int8Array(hi - lo),
        rowScore: new Float64Array(hi - lo),
        colMax: new Int8Array(n).fill(-1),
        colScore: new Float64Array(n),
        hll: new Uint8Array(HLL_M),
      };
      // Onyx's plans were enumerated depth-first (first order, then second,
      // then third), so plans sharing a prefix are contiguous. Walking them as
      // a tree, each pairing costs ONE executed order (Onyx's third) instead
      // of six: the state after the shared prefix is computed once per block.
      const s1 = new Int8Array(STATE_SIZE);
      const s2 = new Int8Array(STATE_SIZE);
      const s3 = new Int8Array(STATE_SIZE);
      const s4 = new Int8Array(STATE_SIZE);
      const s5 = new Int8Array(STATE_SIZE);
      const s6 = new Int8Array(STATE_SIZE);
      let rowMin = 1;
      let rowScore = 0;
      const record = (bi: number, v: number) => {
        if (v < rowMin) rowMin = v;
        rowScore += v;
        if (v > out.colMax[bi]) out.colMax[bi] = v;
        out.colScore[bi] += v;
      };
      const settle = (from: number, to: number, v: number, winnerIsWhite: boolean) => {
        for (let bi = from; bi < to; bi++) {
          record(bi, v);
          if (winnerIsWhite) out.whiteKill++;
          else out.blackKill++;
        }
      };
      for (let wi = lo; wi < hi; wi++) {
        const w = white[wi];
        const w1 = w % 4096;
        const w2 = Math.floor(w / 4096) % 4096;
        const w3 = Math.floor(w / 16777216) % 4096;
        rowMin = 1;
        rowScore = 0;
        s1.set(start);
        if (execute(s1, w1) === KING) {
          settle(0, n, 1, true);
        } else {
          let a = 0;
          while (a < n) {
            const b1 = black[a] % 4096;
            let a2 = a;
            while (a2 < n && black[a2] % 4096 === b1) a2++; // block sharing b1
            s2.set(s1);
            if (execute(s2, b1) === KING) settle(a, a2, -1, false);
            else {
              s3.set(s2);
              if (execute(s3, w2) === KING) settle(a, a2, 1, true);
              else {
                let c = a;
                while (c < a2) {
                  const b2 = Math.floor(black[c] / 4096) % 4096;
                  let c2 = c;
                  while (c2 < a2 && Math.floor(black[c2] / 4096) % 4096 === b2) c2++;
                  s4.set(s3);
                  if (execute(s4, b2) === KING) settle(c, c2, -1, false);
                  else {
                    s5.set(s4);
                    if (execute(s5, w3) === KING) settle(c, c2, 1, true);
                    else {
                      for (let bi = c; bi < c2; bi++) {
                        s6.set(s5);
                        if (execute(s6, Math.floor(black[bi] / 16777216) % 4096) === KING) {
                          record(bi, -1);
                          out.blackKill++;
                          continue;
                        }
                        if (withHll) hllAdd(out.hll, s6);
                        const k = kingSquare(s6, BLACK);
                        if (k >= 0 && attacked(s6, k, WHITE)) {
                          record(bi, 1);
                          out.whiteStrike++;
                        } else {
                          record(bi, 0);
                          out.open++;
                        }
                      }
                    }
                  }
                  c = c2;
                }
              }
            }
            a = a2;
          }
        }
        out.rowMin[wi - lo] = rowMin;
        out.rowScore[wi - lo] = rowScore;
        if ((wi - lo) % 200 === 199) parentPort!.postMessage({ cmd: "progress", rows: 200 });
      }
      parentPort!.postMessage({ cmd: "progress", rows: (hi - lo) % 200 });
      parentPort!.postMessage({ cmd: "matrixDone", out });
    } else if (msg.cmd === "bestRow") {
      // best white plan in [lo, hi) against a black mixture
      let best = { index: -1, value: -Infinity };
      for (let wi = lo; wi < hi; wi++) {
        let v = 0;
        for (const { index, p } of msg.mix!)
          v += p * payoff(start, scratch, white[wi], black[index]);
        if (v > best.value) best = { index: wi, value: v };
      }
      parentPort!.postMessage({ cmd: "best", best });
    } else if (msg.cmd === "bestCol") {
      // best black plan in the matching slice of black plans vs a white mixture
      const blo = Math.floor((lo / white.length) * black.length);
      const bhi = Math.floor((hi / white.length) * black.length);
      let best = { index: -1, value: Infinity };
      for (let bi = blo; bi < bhi; bi++) {
        let v = 0;
        for (const { index, p } of msg.mix!)
          v += p * payoff(start, scratch, white[index], black[bi]);
        if (v < best.value) best = { index: bi, value: v };
      }
      parentPort!.postMessage({ cmd: "best", best });
    }
  });
  parentPort!.postMessage({ cmd: "ready" });
}

/* ---- main --------------------------------------------------------------------- */

const PIECE_LETTER = ["", "", "N", "B", "R", "Q", "K"];
const sqName = (sq: number) => "abcdefgh"[sq & 7] + ((sq >> 3) + 1);

/** Human-readable plan, e.g. "e2-e4, Qd1-h5, Qh5xf7". */
function formatPlan(start: Int8Array, plan: number): string {
  const s = new Int8Array(STATE_SIZE);
  s.set(start);
  const parts: string[] = [];
  for (let k = 0; k < 3; k++) {
    const o = planOrder(plan, k);
    const piece = orderPiece(o);
    const from = piecePos(s, piece);
    const letter = PIECE_LETTER[pieceType(s, piece)];
    const castle = pieceType(s, piece) === KING && Math.abs((orderTo(o) & 7) - (from & 7)) === 2;
    parts.push(
      castle
        ? (orderTo(o) & 7) === 6
          ? "O-O"
          : "O-O-O"
        : `${letter}${sqName(from)}${orderCapture(o) ? "x" : "-"}${sqName(orderTo(o))}`,
    );
    execute(s, o);
  }
  return parts.join(", ");
}

async function main() {
  const args = process.argv.slice(2);
  const space: Space = args.includes("--space")
    ? (args[args.indexOf("--space") + 1] as Space)
    : "full";
  const nWorkers = args.includes("--workers")
    ? Number(args[args.indexOf("--workers") + 1])
    : Math.max(1, os.cpus().length - 2);
  const outDir = path.join(
    path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")),
    "results",
  );
  fs.mkdirSync(outDir, { recursive: true });

  if (args.includes("--next-lead") && args[args.indexOf("--next-lead") + 1] === "black") {
    nextLead = BLACK;
    if (!args.includes("--skip-matrix")) {
      throw new Error("--next-lead black supports only the equilibrium (add --skip-matrix)");
    }
  }
  const tag = nextLead === BLACK ? `${space}-alternating` : space;
  const t0 = Date.now();
  const { pos, start, white, black } = setup(space);
  const log = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
  log(
    `space=${space}: ${white.length} Ivory plans × ${black.length} Onyx plans = ${(white.length * black.length).toExponential(3)} pairs; ${nWorkers} workers`,
  );

  const workers: Worker[] = [];
  const ranges: [number, number][] = [];
  for (let k = 0; k < nWorkers; k++) {
    const lo = Math.floor((k * white.length) / nWorkers);
    const hi = Math.floor(((k + 1) * white.length) / nWorkers);
    ranges.push([lo, hi]);
    workers.push(
      new Worker(new URL(import.meta.url), {
        execArgv: ["--import", "tsx"],
        workerData: { space, lo, hi, withHll: args.includes("--hll"), lead: nextLead },
      }),
    );
  }
  await Promise.all(workers.map((w) => new Promise<void>((res) => w.once("message", () => res()))));
  log("workers ready");

  const report: Record<string, unknown> = {
    space,
    whitePlans: white.length,
    blackPlans: black.length,
  };

  if (!args.includes("--skip-matrix")) {
    let rowsDone = 0;
    const chunks = await Promise.all(
      workers.map(
        (w) =>
          new Promise<MatrixChunk>((res) => {
            const onMsg = (m: { cmd: string; rows?: number; out?: MatrixChunk }) => {
              if (m.cmd === "progress") {
                rowsDone += m.rows!;
                if (rowsDone % 5000 < m.rows!) {
                  const frac = rowsDone / white.length;
                  const eta = ((Date.now() - t0) / 1000) * (1 / frac - 1);
                  log(`matrix ${(100 * frac).toFixed(1)}%  (eta ${(eta / 60).toFixed(1)} min)`);
                }
              } else if (m.cmd === "matrixDone") {
                w.off("message", onMsg);
                res(m.out!);
              }
            };
            w.on("message", onMsg);
            w.postMessage({ cmd: "matrix" });
          }),
      ),
    );
    let whiteKill = 0,
      blackKill = 0,
      whiteStrike = 0,
      open = 0;
    const rowMin = new Int8Array(white.length);
    const rowScore = new Float64Array(white.length);
    const colMax = new Int8Array(black.length).fill(-1);
    const colScore = new Float64Array(black.length);
    const hll = new Uint8Array(HLL_M);
    chunks.forEach((c, k) => {
      whiteKill += c.whiteKill;
      blackKill += c.blackKill;
      whiteStrike += c.whiteStrike;
      open += c.open;
      rowMin.set(c.rowMin, ranges[k][0]);
      rowScore.set(c.rowScore, ranges[k][0]);
      for (let b = 0; b < black.length; b++) {
        if (c.colMax[b] > colMax[b]) colMax[b] = c.colMax[b];
        colScore[b] += c.colScore[b];
      }
      for (let i = 0; i < HLL_M; i++) if (c.hll[i] > hll[i]) hll[i] = c.hll[i];
    });
    const total = whiteKill + blackKill + whiteStrike + open;
    let forcedWhite = -1;
    for (let w = 0; w < white.length; w++) if (rowMin[w] === 1) forcedWhite = w;
    let forcedBlack = -1;
    for (let b = 0; b < black.length; b++) if (colMax[b] === -1) forcedBlack = b;
    let bestW = 0;
    for (let w = 1; w < white.length; w++) if (rowScore[w] > rowScore[bestW]) bestW = w;
    let bestB = 0;
    for (let b = 1; b < black.length; b++) if (colScore[b] < colScore[bestB]) bestB = b;
    const safeBlack = colMax.reduce((n, v) => n + (v <= 0 ? 1 : 0), 0);
    report.counts = {
      pairs: total,
      ivoryCapturesKing: whiteKill,
      onyxCapturesKing: blackKill,
      ivoryFirstStrike: whiteStrike,
      open,
      ivoryDecisiveShare: (whiteKill + whiteStrike) / total,
      onyxDecisiveShare: blackKill / total,
      distinctPositionsEstimate: args.includes("--hll") ? Math.round(hllEstimate(hll)) : null,
    };
    report.forcedWins = {
      ivoryHasForcedWin: forcedWhite >= 0,
      ivoryForcedPlan: forcedWhite >= 0 ? formatPlan(start, white[forcedWhite]) : null,
      onyxHasForcedWin: forcedBlack >= 0,
      onyxPlansThatNeverLoseRound1: safeBlack,
    };
    report.vsUniformRandom = {
      bestIvoryPlan: formatPlan(start, white[bestW]),
      bestIvoryPlanNetWinShare: rowScore[bestW] / black.length,
      bestOnyxPlan: formatPlan(start, black[bestB]),
      bestOnyxPlanNetLossShare: colScore[bestB] / white.length,
    };
    log(`matrix done: ${JSON.stringify(report.counts)}`);
    log(`forced wins: ${JSON.stringify(report.forcedWins)}`);
  }

  if (!args.includes("--skip-equilibrium")) {
    const scratch = new Int8Array(STATE_SIZE);
    const ask = (
      cmd: string,
      mix: { index: number; p: number }[],
      better: (a: number, b: number) => boolean,
    ) =>
      Promise.all(
        workers.map(
          (w) =>
            new Promise<{ index: number; value: number }>((res) => {
              w.once("message", (m: { best: { index: number; value: number } }) => res(m.best));
              w.postMessage({ cmd, mix });
            }),
        ),
      ).then((bests) =>
        bests.filter((b) => b.index >= 0).reduce((a, b) => (better(b.value, a.value) ? b : a)),
      );

    // doubleOracle is synchronous; drive it with an async re-implementation of
    // its loop so best replies can fan out to the worker pool.
    const rows = [0];
    const cols = [0];
    const matrix = [[payoff(start, scratch, white[0], black[0])]];
    let lower = -Infinity;
    let upper = Infinity;
    let rowMix: { index: number; p: number }[] = [];
    let colMix: { index: number; p: number }[] = [];
    let bestRowMix = rowMix;
    let bestColMix = colMix;
    let sol = solveZeroSum(matrix);
    for (let it = 0; it < 400; it++) {
      rowMix = rows.map((index, i) => ({ index, p: sol.row[i] })).filter((x) => x.p > 1e-9);
      colMix = cols.map((index, j) => ({ index, p: sol.col[j] })).filter((x) => x.p > 1e-9);
      const rowReply = await ask("bestRow", colMix, (a, b) => a > b);
      const colReply = await ask("bestCol", rowMix, (a, b) => a < b);
      if (colReply.value > lower) {
        lower = colReply.value;
        bestRowMix = rowMix;
      }
      if (rowReply.value < upper) {
        upper = rowReply.value;
        bestColMix = colMix;
      }
      log(
        `equilibrium it ${it}: restricted ${rows.length}×${cols.length}, value ${sol.value.toFixed(5)}, proven [${lower.toFixed(5)}, ${upper.toFixed(5)}]`,
      );
      if (upper - lower < 1e-6) break;
      let grew = false;
      if (rowReply.value > sol.value + 1e-9 && !rows.includes(rowReply.index)) {
        rows.push(rowReply.index);
        matrix.push(cols.map((c) => payoff(start, scratch, white[rowReply.index], black[c])));
        grew = true;
      }
      if (colReply.value < sol.value - 1e-9 && !cols.includes(colReply.index)) {
        cols.push(colReply.index);
        for (let i = 0; i < rows.length; i++)
          matrix[i].push(payoff(start, scratch, white[rows[i]], black[colReply.index]));
        grew = true;
      }
      if (!grew) break;
      sol = solveZeroSum(matrix);
    }
    const describe = (mix: { index: number; p: number }[], plans: Float64Array) =>
      [...mix]
        .sort((a, b) => b.p - a.p)
        .map(({ index, p }) => ({
          p: Number(p.toFixed(4)),
          plan: formatPlan(start, plans[index]),
        }));
    const book = (mix: { index: number; p: number }[], plans: Float64Array) =>
      mix.map(({ index, p }) => ({
        p,
        orders: [0, 1, 2].map((k) => {
          const s = new Int8Array(STATE_SIZE);
          s.set(start);
          for (let j = 0; j < k; j++) execute(s, planOrder(plans[index], j));
          return decodeOrder({ state: s, ids: pos.ids }, planOrder(plans[index], k));
        }),
      }));
    report.equilibrium = {
      value: sol.value,
      provenLower: lower,
      provenUpper: upper,
      meaning:
        "expected (Ivory decisive − Onyx decisive) in round 1 when both sides play optimal mixtures",
      ivoryMix: describe(bestRowMix, white),
      onyxMix: describe(bestColMix, black),
    };
    fs.writeFileSync(
      path.join(outDir, `opening-book-${tag}.json`),
      JSON.stringify(
        { space, ivory: book(bestRowMix, white), onyx: book(bestColMix, black) },
        null,
        2,
      ),
    );
    log(`equilibrium: value ${sol.value.toFixed(5)} ∈ [${lower.toFixed(5)}, ${upper.toFixed(5)}]`);
  }

  report.nextLead = nextLead === WHITE ? "ivory" : "onyx";
  report.seconds = (Date.now() - t0) / 1000;
  fs.writeFileSync(path.join(outDir, `opening-${tag}.json`), JSON.stringify(report, null, 2));
  log(`wrote ${path.join(outDir, `opening-${tag}.json`)}`);
  await Promise.all(workers.map((w) => w.terminate()));
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
