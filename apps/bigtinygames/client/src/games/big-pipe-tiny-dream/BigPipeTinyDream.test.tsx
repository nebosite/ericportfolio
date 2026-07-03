import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import BigPipeTinyDream from "./BigPipeTinyDream";
import { trackEvent } from "../../lib/analytics";

// The canvas/rAF flood loop is exercised in manual browser review; here we just
// pin the overlay flow and wiring. Freeze rAF so the loop never advances.
vi.mock("../../lib/analytics", () => ({ trackEvent: vi.fn() }));

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0 as unknown as number);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse([]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BigPipeTinyDream — overlays & wiring", () => {
  it("opens on the title screen with START and the feedback panel", () => {
    render(<BigPipeTinyDream />);
    expect(screen.getByText("BIG PIPE TINY DREAM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶ START" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feature Request" })).toBeInTheDocument();
  });

  it("loads this game's leaderboard by slug on mount", async () => {
    render(<BigPipeTinyDream />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/leaderboard?game=big-pipe-tiny-dream"),
    );
  });

  it("START drops into a level 1 board and fires game_start", () => {
    render(<BigPipeTinyDream />);
    fireEvent.click(screen.getByRole("button", { name: "▶ START" }));
    expect(trackEvent).toHaveBeenCalledWith("game_start", { game: "big-pipe-tiny-dream" });
    expect(screen.getByText("LEVEL 1")).toBeInTheDocument();
    expect(screen.getByText("◎ GUIDE WATER TO THE DRAIN")).toBeInTheDocument();
    // Title overlay is gone once play begins.
    expect(screen.queryByText("BIG PIPE TINY DREAM")).not.toBeInTheDocument();
  });
});
