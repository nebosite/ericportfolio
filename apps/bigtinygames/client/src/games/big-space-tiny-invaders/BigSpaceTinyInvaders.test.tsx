import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import BigSpaceTinyInvaders from "./BigSpaceTinyInvaders";
import { trackEvent } from "../../lib/analytics";

// The canvas/rAF battle loop is exercised in manual browser review (and the
// rules themselves in invadersLogic.test.ts); here we pin the overlay flow
// and wiring. Freeze rAF so the loop never advances.
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

describe("BigSpaceTinyInvaders — overlays & wiring", () => {
  it("opens on the title screen with START and the feedback panel", () => {
    render(<BigSpaceTinyInvaders />);
    expect(screen.getByText("BIG SPACE TINY INVADERS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶ START" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /feature request/i })).toBeInTheDocument();
  });

  it("loads this game's leaderboard by slug on mount", async () => {
    render(<BigSpaceTinyInvaders />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/leaderboard?game=big-space-tiny-invaders"),
    );
  });

  it("START begins the game and fires game_start", () => {
    render(<BigSpaceTinyInvaders />);
    fireEvent.click(screen.getByRole("button", { name: "▶ START" }));
    expect(trackEvent).toHaveBeenCalledWith("game_start", { game: "big-space-tiny-invaders" });
    // Title overlay is gone once play begins (stats render on-canvas now).
    expect(screen.queryByText("BIG SPACE TINY INVADERS")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "▶ START" })).not.toBeInTheDocument();
  });
});
