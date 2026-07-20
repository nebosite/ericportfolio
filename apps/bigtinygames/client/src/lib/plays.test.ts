import { describe, it, expect, beforeEach } from "vitest";
import { recordPlay, takePendingNudge } from "./plays";

describe("plays / feature-request nudge", () => {
  beforeEach(() => localStorage.clear());

  it("counts plays per game independently", () => {
    expect(recordPlay("snake")).toBe(1);
    expect(recordPlay("snake")).toBe(2);
    expect(recordPlay("big-pac-tiny-man")).toBe(1);
    expect(recordPlay("snake")).toBe(3);
  });

  it("arms a nudge on the 3rd and 10th play, and only then", () => {
    const seen: number[] = [];
    for (let i = 1; i <= 12; i++) {
      recordPlay("snake");
      const n = takePendingNudge("snake");
      if (n !== null) seen.push(n);
    }
    expect(seen).toEqual([3, 10]);
  });

  it("fires each nudge exactly once (takePendingNudge clears it)", () => {
    recordPlay("snake"); // 1
    recordPlay("snake"); // 2
    recordPlay("snake"); // 3 → armed
    expect(takePendingNudge("snake")).toBe(3);
    expect(takePendingNudge("snake")).toBeNull();
  });

  it("returns null when no nudge is pending", () => {
    recordPlay("snake");
    expect(takePendingNudge("snake")).toBeNull();
  });
});
