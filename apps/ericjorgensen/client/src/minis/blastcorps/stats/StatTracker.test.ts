import { describe, it, expect } from "vitest";
import { StatTracker, formatStat } from "./StatTracker";

describe("StatTracker", () => {
  it("starts a metric with current = low = high", () => {
    const t = new StatTracker();
    t.record("fps", 60);
    expect(t.get("fps")).toEqual({ current: 60, low: 60, high: 60, samples: 1 });
  });

  it("tracks the low and high separately from the current value", () => {
    const t = new StatTracker();
    for (const v of [60, 42, 61, 58]) t.record("fps", v);
    expect(t.get("fps")).toEqual({ current: 58, low: 42, high: 61, samples: 4 });
  });

  it("ignores NaN and infinities", () => {
    const t = new StatTracker();
    t.record("ms", 8);
    t.record("ms", NaN);
    t.record("ms", Infinity);
    expect(t.get("ms")).toEqual({ current: 8, low: 8, high: 8, samples: 1 });
    expect(t.get("never")).toBeUndefined();
  });

  it("resets one metric or all", () => {
    const t = new StatTracker();
    t.record("a", 1);
    t.record("b", 2);
    t.reset("a");
    expect(t.get("a")).toBeUndefined();
    expect(t.get("b")?.current).toBe(2);
    t.reset();
    expect(t.names()).toEqual([]);
  });

  it("exports rows as independent copies", () => {
    const t = new StatTracker();
    t.record("a", 1);
    const rows = t.toRows();
    expect(rows).toEqual([{ name: "a", sample: { current: 1, low: 1, high: 1, samples: 1 } }]);
    rows[0].sample.current = 99;
    expect(t.get("a")?.current).toBe(1);
  });
});

describe("formatStat", () => {
  it("prints integers with separators and floats with fixed decimals", () => {
    expect(formatStat(12345)).toBe("12,345");
    expect(formatStat(8.456)).toBe("8.5");
    expect(formatStat(8.456, 2)).toBe("8.46");
  });
});
