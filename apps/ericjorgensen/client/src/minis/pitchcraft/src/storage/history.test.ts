import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATS,
  applySession,
  bestFor,
  bestKey,
  recentNoteStats,
  recentScorePoints,
  Stats,
  SessionRecord,
} from "./history";

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

const rec = (
  ts: number,
  score: number,
  notes?: SessionRecord["notes"],
  voice = "soprano",
): SessionRecord => ({ ts, d: "2026-01-01", score, accuracy: 0, voice, level: 1, notes });

describe("recentNoteStats", () => {
  it("sums per-note cents across only the most recent n sessions with data", () => {
    const history: SessionRecord[] = [
      rec(1, 0, { "60": { cN: 5, cSum: 50, cSqSum: 600 } }),
      rec(2, 0), // no note data — ignored
      rec(3, 0, { "60": { cN: 3, cSum: 30, cSqSum: 400 }, "62": { cN: 2, cSum: 10, cSqSum: 80 } }),
      rec(4, 0, { "60": { cN: 1, cSum: 5, cSqSum: 25 } }),
    ];
    const agg = recentNoteStats(history, "soprano", 1, 2); // last two soprano L1 sessions w/ notes: 3 & 4
    expect(agg["60"]).toEqual({ cN: 4, cSum: 35, cSqSum: 425 });
    expect(agg["62"]).toEqual({ cN: 2, cSum: 10, cSqSum: 80 });
  });

  it("only counts sessions for the requested voice and level", () => {
    const history: SessionRecord[] = [
      rec(1, 0, { "60": { cN: 5, cSum: 50, cSqSum: 600 } }, "soprano"),
      rec(2, 0, { "60": { cN: 9, cSum: 90, cSqSum: 900 } }, "bass"),
      { ...rec(3, 0, { "60": { cN: 7, cSum: 70, cSqSum: 700 } }, "soprano"), level: 2 },
    ];
    expect(recentNoteStats(history, "soprano", 1, 10)["60"]).toEqual({
      cN: 5,
      cSum: 50,
      cSqSum: 600,
    });
    expect(recentNoteStats(history, "soprano", 2, 10)["60"]).toEqual({
      cN: 7,
      cSum: 70,
      cSqSum: 700,
    });
    expect(recentNoteStats(history, "tenor", 1, 10)).toEqual({});
  });

  it("returns an empty map when no session has note data", () => {
    expect(recentNoteStats([rec(1, 100), rec(2, 200)], "soprano", 1, 10)).toEqual({});
  });
});

describe("recentScorePoints", () => {
  const DAY = 86400000;
  it("keeps in-window sessions for the voice+level, oldest → newest", () => {
    const now = 100 * DAY;
    const history: SessionRecord[] = [
      rec(now - 95 * DAY, 100), // too old — dropped
      rec(now - 20 * DAY, 700, undefined, "bass"), // wrong voice — dropped
      rec(now - 10 * DAY, 300),
      rec(now - 2 * DAY, 500),
    ];
    const pts = recentScorePoints(history, "soprano", 1, now, 90);
    expect(pts.map((p) => p.score)).toEqual([300, 500]); // oldest first
    expect(pts[0].daysAgo).toBeCloseTo(10, 6);
    expect(pts[1].daysAgo).toBeCloseTo(2, 6);
  });

  it("excludes sessions from a different level of the same voice", () => {
    const now = 10 * DAY;
    const history: SessionRecord[] = [
      { ...rec(now - 1 * DAY, 400), level: 2 },
      rec(now - 1 * DAY, 250), // level 1
    ];
    expect(recentScorePoints(history, "soprano", 1, now, 90).map((p) => p.score)).toEqual([250]);
  });
});
