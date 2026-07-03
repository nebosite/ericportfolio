import { describe, it, expect } from "vitest";
import { DEFAULT_STATS, applySession, bestFor, bestKey, Stats } from "./history";

function freshStats(): Stats {
  return { ...DEFAULT_STATS, bests: {}, notes: {} };
}

const session = (voiceId: string, difficulty: number, score: number) => ({
  score,
  perNote: {},
  voiceId,
  difficulty,
});

describe("per voice + level high scores", () => {
  it("keys scores by voice and level", () => {
    expect(bestKey("soprano", 2)).toBe("soprano:2");
    expect(bestFor(freshStats(), "soprano", 2)).toBe(0);
  });

  it("tracks a separate best for each voice/level pair", () => {
    const s = freshStats();
    applySession(s, session("soprano", 2, 500));
    applySession(s, session("soprano", 4, 120));
    applySession(s, session("tenor", 2, 300));

    expect(bestFor(s, "soprano", 2)).toBe(500);
    expect(bestFor(s, "soprano", 4)).toBe(120); // same voice, different level
    expect(bestFor(s, "tenor", 2)).toBe(300); // same level, different voice
    expect(bestFor(s, "bass", 1)).toBe(0); // untouched
  });

  it("only beats its own bucket, and reports isBest per bucket", () => {
    const s = freshStats();
    expect(applySession(s, session("soprano", 2, 400)).isBest).toBe(true);
    // a lower score in the same bucket is not a best
    expect(applySession(s, session("soprano", 2, 250)).isBest).toBe(false);
    expect(bestFor(s, "soprano", 2)).toBe(400);
    // first score in a different bucket is its own best, even if lower overall
    expect(applySession(s, session("soprano", 4, 90)).isBest).toBe(true);
    expect(bestFor(s, "soprano", 4)).toBe(90);
  });
});
