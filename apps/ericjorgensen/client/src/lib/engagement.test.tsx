import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { EngagementClock, useEngagement } from "./engagement";
import { trackEvent } from "./analytics";

vi.mock("./analytics", () => ({ trackEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("EngagementClock", () => {
  it("counts elapsed time while visible", () => {
    const c = new EngagementClock(1000);
    expect(c.elapsedMs(4000)).toBe(3000);
  });

  it("pauses accumulation while hidden", () => {
    const c = new EngagementClock(0);
    c.setVisible(false, 1000); // 1s visible, then hidden
    c.setVisible(true, 5000); // 4s hidden (not counted), visible again
    expect(c.elapsedMs(6000)).toBe(2000); // 1s + 1s
  });

  it("ignores same-state toggles and never goes negative", () => {
    const c = new EngagementClock(0);
    c.setVisible(true, 500); // already visible → no-op
    expect(c.elapsedMs(1000)).toBe(1000);
    const c2 = new EngagementClock(1000);
    expect(c2.elapsedMs(0)).toBe(0); // clamped, not negative
  });
});

describe("useEngagement", () => {
  function Probe() {
    useEngagement("thing");
    return null;
  }

  it("fires engage_start on mount and engage_end with seconds on leave", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { unmount } = render(<Probe />);
    expect(trackEvent).toHaveBeenCalledWith("engage_start", { entity: "thing" });
    vi.setSystemTime(5000);
    unmount();
    expect(trackEvent).toHaveBeenCalledWith("engage_end", { entity: "thing", seconds: 5 });
  });
});
