# Three Ahead Chess — exhaustive round-1 analysis

`opening.ts` resolves **every** plan Ivory can seal against **every** plan Onyx can
seal from the starting position, then solves round 1 as the simultaneous-move
game it is. It answers: _is there a first-mover advantage, and how big?_

```bash
# full plan space: 217,486 plans per side, 4.7 × 10^10 pairings (~11 min on 26 cores)
npx tsx apps/ericjorgensen/client/analysis/opening.ts --space full
# the "sensible" space only (no ambushes / aiming through pieces): ~30 s
npx tsx apps/ericjorgensen/client/analysis/opening.ts --space sensible [--hll]
# the equilibrium if leads ALTERNATE (Onyx leads round 2)
npx tsx apps/ericjorgensen/client/analysis/opening.ts --space full --skip-matrix --next-lead black
# rebuild the engine's opening book from a result
node apps/ericjorgensen/client/analysis/makeBook.mjs full
```

## Definitions

- **Plan** — three sealed orders. The _sensible_ space is what a careful player
  orders (rays stop at the first piece; capture flags set exactly when an enemy
  stands on the target). The _full_ space adds everything that can matter when
  plans are blind: **ambushes** (a capture flag on an empty square, or on a
  square your own piece holds, in case the enemy takes it first), aims
  **through** enemy pieces that may have moved, and pushes onto enemy-held
  squares.
- **Decisive round** — a king is captured during the round, or the side that
  leads the _next_ round ends this one attacking the enemy king. Its step-1
  capture then lands before the other side can move, so the attack can't be
  answered. This is the pattern behind the reported e4, Qh5, Qxf7 win.
- **Value** — the expected (Ivory decisive − Onyx decisive) when both sides play
  their optimal mixed strategies. It comes from double oracle with an exact
  simplex solver. The proven lower and upper bounds are what each side's
  mixture guarantees against _every_ plan in the space.

## Results (standard rules: Ivory leads every round)

|                                      | Sensible space            | Full space     |
| ------------------------------------ | ------------------------- | -------------- |
| Plans per side                       | 11,048                    | 217,486        |
| Pairings resolved                    | 122,058,304               | 47,300,160,196 |
| Ivory decisive, uniform random play  | 0.98%                     | 0.14%          |
| Onyx decisive, uniform random play   | 0.0017%                   | 0.00055%       |
| Forced win for either side           | none                      | none           |
| **Round-1 value under optimal play** | **+0.2857 (exactly 2/7)** | **+0.2580**    |
| Value if leads alternate             | −0.2813                   | −0.3187        |

Distinct positions after round 1 (sensible space, HyperLogLog): ≈ 8.9 million.

What the numbers mean:

1. **No forced wins.** Every Ivory plan has an Onyx reply that survives round 1,
   and every Onyx plan loses to some Ivory plan. Nobody can _force_ anything; it
   is a guessing game.
2. **Random-play counts don't measure fairness.** Almost every random pairing
   is quiet (99.86%), so uniform counts say little about competent play. The
   equilibrium does measure it.
3. **The first-mover advantage is real and structural.** With both sides
   optimal, Ivory ends round 1 decisively about **26%** of the time. Onyx can't
   answer in kind, because Ivory also leads round 2. Ambushes (Kxf7, c7xd6,
   …) are Onyx's main resource: adding them to the plan space cuts Ivory's
   edge from 28.6% to 25.8%.
4. **The weapon belongs to whoever leads the next round.** Alternating leads
   just hands it to Onyx (−32%). Under the **first-to-seal house rule** the
   next leader isn't fixed, and the starting position is mirror-symmetric, so
   round 1 is fair by symmetry (value 0).

The full plan space multiplies each round's pairings by another ~4.7 × 10^10,
so an exhaustive _two_-round count is out of reach (~10^21). The per-round
equilibrium above is the exact statement that can be made.

## Whole games (self-play)

These are 100 games per rule set between equilibrium players (1 s of thinking
per plan, 60-round cap), run with the `SELFPLAY_NASH` and `SELFPLAY_FIRST`
options in `engine/selfplay.soak.test.ts`:

| Rules                                          | Ivory wins | Onyx wins | Avg length |
| ---------------------------------------------- | ---------- | --------- | ---------- |
| Standard (Ivory always leads)                  | 54%        | 46%       | 5.3 rounds |
| First-to-seal (lead is a coin flip each round) | 54%        | 46%       | 3.3 rounds |
| Alternating leads                              | 28%        | **72%**   | 3.3 rounds |

With 100 games the 95% margin is about ±10 points, so the standard and race
results are both consistent with a fair game. Alternating is clearly lopsided.
It gives one player _both_ timing advantages every round: that round's
follower gets the last word within the round _and_ leads the next round, where
its end-of-round attack can't be answered. Under the standard rules those two
advantages are split between the players.

## How the AI uses this

Levels 7–10 solve each round's matrix game within their thinking budget and
sample their plan from the equilibrium mix (`engine/nashPlanner.ts`). At the
start position they sample from `engine/openingBook.ts`, which is generated
from `results/opening-book-full.json`. No single rush can beat that book more
often than the game value: e4, Qh5, Qxf7 is decisive in 25.8% of games, down
from 100% against the old deterministic level 10.
