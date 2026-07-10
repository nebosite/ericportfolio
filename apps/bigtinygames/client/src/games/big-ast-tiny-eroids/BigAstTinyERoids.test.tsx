import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import BigAstTinyERoids from "./BigAstTinyERoids";
import { trackEvent } from "../../lib/analytics";

// The canvas/rAF game loop is exercised in manual browser review (and the
// rules themselves in roidsLogic.test.ts); here we pin the overlay flow and
// wiring. Freeze rAF so the loop never advances.
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

describe("BigAstTinyERoids — overlays & wiring", () => {
  it("opens on the title screen with START and the feedback panel", () => {
    render(<BigAstTinyERoids />);
    expect(screen.getByText("BIG AST TINY EROIDS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "▶ START" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Feature Request" })).toBeInTheDocument();
  });

  it("loads this game's leaderboard by slug on mount", async () => {
    render(<BigAstTinyERoids />);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/leaderboard?game=big-ast-tiny-eroids"),
    );
  });

  it("START begins wave 1 and fires game_start", () => {
    render(<BigAstTinyERoids />);
    fireEvent.click(screen.getByRole("button", { name: "▶ START" }));
    expect(trackEvent).toHaveBeenCalledWith("game_start", { game: "big-ast-tiny-eroids" });
    expect(screen.getByText("WAVE 1")).toBeInTheDocument();
    expect(screen.getByText(/PEA SHOOTER/)).toBeInTheDocument();
    // Title overlay is gone once play begins.
    expect(screen.queryByText("BIG AST TINY EROIDS")).not.toBeInTheDocument();
  });
});
