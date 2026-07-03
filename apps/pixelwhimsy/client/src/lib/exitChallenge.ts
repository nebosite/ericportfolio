// The grown-up gate that guards the exit: a small multiplication problem the
// child is very unlikely to solve by mashing keys.

export interface Problem {
  a: number;
  b: number;
  answer: number;
}

/** A times-table problem with both factors in 2..9. */
export function makeProblem(rng: () => number = Math.random): Problem {
  const a = 2 + Math.floor(rng() * 8);
  const b = 2 + Math.floor(rng() * 8);
  return { a, b, answer: a * b };
}

export type AnswerState = "correct" | "wrong" | "incomplete";

/**
 * Evaluate the digits typed so far against the answer, with no Enter key:
 * - 'correct'    — the typed digits equal the answer.
 * - 'incomplete' — the typed digits are a valid prefix of the answer (keep going).
 * - 'wrong'      — the typed digits can no longer become the answer.
 */
export function evaluateAnswer(answer: number, typed: string): AnswerState {
  if (typed === "") return "incomplete";
  const ans = String(answer);
  if (typed === ans) return "correct";
  if (!ans.startsWith(typed)) return "wrong";
  return "incomplete";
}
