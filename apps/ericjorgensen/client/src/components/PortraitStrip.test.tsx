import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import PortraitStrip, { pickRandom, pickInitial } from "./PortraitStrip";

describe("pickRandom / pickInitial", () => {
  const pool = Array.from({ length: 8 }, (_, i) => `/m/${i}.jpg`);

  it("pickRandom never returns an excluded item", () => {
    const exclude = new Set(pool.slice(0, 7)); // only /m/7.jpg is allowed
    for (let n = 0; n < 50; n++) {
      expect(pickRandom(pool, exclude)).toBe("/m/7.jpg");
    }
  });

  it("pickRandom returns null when everything is excluded", () => {
    expect(pickRandom(pool, new Set(pool))).toBeNull();
  });

  it("pickInitial returns the requested count with no duplicates", () => {
    for (let n = 0; n < 50; n++) {
      const picks = pickInitial(pool, 5);
      expect(picks).toHaveLength(5);
      expect(new Set(picks).size).toBe(5);
    }
  });

  it("pickInitial is capped at the pool size", () => {
    const picks = pickInitial(pool, 100);
    expect(picks).toHaveLength(pool.length);
    expect(new Set(picks).size).toBe(pool.length);
  });
});

describe("PortraitStrip component", () => {
  const pool = Array.from({ length: 8 }, (_, i) => `/m/${i}.jpg`);

  const setWidth = (w: number) =>
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: w,
    });

  beforeEach(() => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve(pool) } as Response),
    ) as typeof fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  const uniqueSrcs = () => {
    const imgs = screen.getAllByRole("img") as HTMLImageElement[];
    return {
      count: imgs.length,
      unique: new Set(imgs.map((i) => i.getAttribute("src"))).size,
    };
  };

  it("shows five distinct portraits on desktop", async () => {
    setWidth(1200);
    render(<PortraitStrip />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const { count, unique } = uniqueSrcs();
    expect(count).toBe(5);
    expect(unique).toBe(5);
  });

  it("shows three distinct portraits on mobile", async () => {
    setWidth(480);
    render(<PortraitStrip />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const { count, unique } = uniqueSrcs();
    expect(count).toBe(3);
    expect(unique).toBe(3);
  });

  it("never shows a duplicate after rotations", async () => {
    setWidth(1200);
    render(<PortraitStrip />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Several rotation intervals (max 15s each) — invariant must always hold.
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000);
      });
      const { count, unique } = uniqueSrcs();
      expect(count).toBe(5);
      expect(unique).toBe(5);
    }
  });
});
