import { describe, it, expect } from "vitest";
import { BreakLog } from "./BreakLog";
import { EVENT_FLOATS, MAX_BREAK_EVENTS, MaterialKind } from "./protocol";

describe("BreakLog", () => {
  it("stores position and kind in order", () => {
    const log = new BreakLog();
    log.push(1, 2, 3, MaterialKind.Steel);
    log.push(4, 5, 6, MaterialKind.Glass);
    expect(log.count).toBe(2);
    const out = new Float32Array(10 + 2 * EVENT_FLOATS);
    log.writeTo(out, 10);
    expect([...out.subarray(10)]).toEqual([
      1,
      2,
      3,
      MaterialKind.Steel,
      4,
      5,
      6,
      MaterialKind.Glass,
    ]);
  });

  it("counts overflow without storing it, and clears", () => {
    const log = new BreakLog();
    for (let i = 0; i < MAX_BREAK_EVENTS + 25; i++) log.push(i, 0, 0, MaterialKind.Masonry);
    expect(log.count).toBe(MAX_BREAK_EVENTS);
    expect(log.total).toBe(MAX_BREAK_EVENTS + 25);
    expect(log.data[(MAX_BREAK_EVENTS - 1) * EVENT_FLOATS]).toBe(MAX_BREAK_EVENTS - 1);
    log.clear();
    expect(log.count).toBe(0);
    expect(log.total).toBe(0);
  });
});
