import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HostEvents, HostStats } from "./GameHost";
import type { SceneSpec } from "./sim/protocol";

// jsdom has no Worker, WebGL or gamepads, so the host is a fake that lets the
// test push stats and actions the way the real one would.
const fake = vi.hoisted(() => ({
  events: null as HostEvents | null,
  scene: null as unknown,
  start: vi.fn(),
  reset: vi.fn(),
  resetStats: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("./GameHost", () => ({
  GameHost: vi.fn().mockImplementation(function (
    this: unknown,
    _canvas: HTMLCanvasElement,
    scene: SceneSpec,
    events: HostEvents,
  ) {
    fake.events = events;
    fake.scene = scene;
    return {
      start: fake.start,
      reset: fake.reset,
      resetStats: fake.resetStats,
      destroy: fake.destroy,
    };
  }),
}));

import BlastCorpsPage, { formatClock } from "./BlastCorpsPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <BlastCorpsPage />
    </MemoryRouter>,
  );
}

const structures = [
  {
    partStart: 0,
    partCount: 100,
    center: [0, 20, 0] as [number, number, number],
    height: 40,
    halfWidth: 6,
    mass: 2_000_000,
  },
  {
    partStart: 100,
    partCount: 200,
    center: [30, 40, 0] as [number, number, number],
    height: 80,
    halfWidth: 9,
    mass: 9_400_000,
  },
];

const DEFAULT_SCENE = { kind: "street", towers: 10, maxStories: 30, glass: true, floors: "auto" };

const baseStats: HostStats = {
  ready: true,
  built: 2,
  totalStructures: 2,
  partCount: 300,
  jointCount: 900,
  jointsAlive: 900,
  demolition: 0,
  structureDemolition: [0, 0],
  structures,
  awake: 0,
  physicsMs: 1.2,
  fps: 60,
  speed: 0,
  flipped: false,
  throttleSeen: false,
  padConnected: false,
  threads: 7,
  crossOriginIsolated: true,
  gpu: "Test GPU",
  vehicleZ: 0,
  streetLength: 200,
  timeScale: 1,
  rows: [
    { name: "fps", sample: { current: 60, low: 42, high: 61, samples: 10 } },
    { name: "physics ms", sample: { current: 1.2, low: 0.7, high: 31.8, samples: 10 } },
  ],
};

function pushStats(partial: Partial<HostStats>) {
  act(() => fake.events!.onStats({ ...baseStats, ...partial }));
}

beforeEach(() => {
  localStorage.clear();
  fake.events = null;
  fake.scene = null;
  fake.start.mockClear();
  fake.reset.mockClear();
  fake.resetStats.mockClear();
  fake.destroy.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("title screen", () => {
  it("shows the name, both control columns, Start and the standard feedback panel", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: /Blast Corps/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Keyboard" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Controller" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start Demolition" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Feature Request/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vote on Requests/ })).toBeInTheDocument();
    expect(screen.getByText("Slow motion — the physics keeps stepping")).toBeInTheDocument();
  });

  it("defaults to a 10-tower street up to 30 stories, floors up to 12 stories, glass on", () => {
    renderPage();
    expect(screen.getByRole("radio", { name: "10 towers" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "30 stories" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "up to 12 stories" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: "Glass skin" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const before = screen.getByTestId("part-estimate").textContent;
    fireEvent.click(screen.getByRole("radio", { name: "50 stories" }));
    expect(screen.getByRole("radio", { name: "50 stories" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("part-estimate").textContent).not.toBe(before);
    const auto = screen.getByTestId("part-estimate").textContent;
    fireEvent.click(screen.getByRole("radio", { name: /all \(unstable/ }));
    expect(screen.getByTestId("part-estimate").textContent).not.toBe(auto);
  });

  it("switches to the classic masonry tower and back", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: /Small/ }));
    expect(screen.getByRole("radio", { name: /Small/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "10 towers" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    fireEvent.click(screen.getByRole("radio", { name: "4 towers" }));
    expect(screen.getByRole("radio", { name: /Small/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "4 towers" })).toHaveAttribute("aria-checked", "true");
  });

  it("starts the game with the chosen scene, records the play and fires game_start", () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "4 towers" }));
    fireEvent.click(screen.getByRole("radio", { name: "20 stories" }));
    fireEvent.click(screen.getByRole("radio", { name: "none" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Demolition" }));
    expect(fake.scene).toEqual({
      kind: "street",
      towers: 4,
      maxStories: 20,
      glass: true,
      floors: "none",
    });
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "game_start",
      expect.objectContaining({ game: "blast-corps-reimagined", scene: "street", towers: 4 }),
    );
    expect(localStorage.getItem("plays_blast-corps-reimagined")).toBe("1");
    delete (window as Partial<Window & { gtag?: unknown }>).gtag;
  });

  it("also starts on Enter", () => {
    renderPage();
    fireEvent.keyDown(window, { code: "Enter" });
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Demolition arena")).toBeInTheDocument();
  });
});

describe("in play", () => {
  function startGame() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start Demolition" }));
  }

  it("shows a layout notice until the worker is ready, then build progress and the tonnage meter", () => {
    startGame();
    expect(screen.getByText("Laying out the street…")).toBeInTheDocument();
    pushStats({ built: 0, demolition: 0.1, structureDemolition: [0.6, 0] });
    expect(screen.queryByText("Laying out the street…")).not.toBeInTheDocument();
    expect(screen.getByTestId("building")).toHaveTextContent("Building tower 1 of 2");
    expect(screen.getByTestId("demolition")).toHaveTextContent("2,000 t");
    expect(screen.getByText(/Towers felled 1 \/ 2 · 10% of the street/)).toBeInTheDocument();
    pushStats({ built: 2 });
    expect(screen.queryByTestId("building")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("segments")).getAllByRole("generic").length).toBeGreaterThan(
      0,
    );
  });

  it("starts the clock on the first throttle, not on Start, and shows the slow-motion badge", () => {
    vi.useFakeTimers();
    startGame();
    expect(screen.getByTestId("clock")).toHaveTextContent("0:00.0");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("clock")).toHaveTextContent("0:00.0");
    pushStats({ throttleSeen: true, timeScale: 0.25 });
    expect(screen.getByText("SLOW MOTION")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByTestId("clock")).not.toHaveTextContent("0:00.0");
  });

  it("announces each felled tower with its tonnage, and Street Leveled once every tower is down", () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: typeof gtag }).gtag = gtag;
    startGame();
    pushStats({ throttleSeen: true, demolition: 0.3, structureDemolition: [0.1, 0.55] });
    expect(screen.getByRole("status")).toHaveTextContent("Tower 2 felled — 9,400 t");
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "tower_felled",
      expect.objectContaining({ tower: 1 }),
    );
    expect(screen.queryByText("Street Leveled!")).not.toBeInTheDocument();
    pushStats({ throttleSeen: true, demolition: 0.52, structureDemolition: [0.5, 0.55] });
    expect(screen.getByRole("status")).toHaveTextContent("Street Leveled!");
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2 towers · 11,400 t");
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "game_over",
      expect.objectContaining({ game: "blast-corps-reimagined", felled: 2, towers: 2, score: 52 }),
    );
    delete (window as Partial<Window & { gtag?: unknown }>).gtag;
  });

  it("ends the run with a card when the machine drives off the end of the street", () => {
    startGame();
    pushStats({
      throttleSeen: true,
      structureDemolition: [0.6, 0.1],
      vehicleZ: 290,
      streetLength: 200,
    });
    expect(screen.getByRole("status")).toHaveTextContent("End of the street");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 towers · 2,000 t");
  });

  it("rebuilds the scene (and resets hi/lo) on the reset action, and returns to the title on quit", () => {
    startGame();
    act(() => fake.events!.onAction("reset"));
    expect(fake.reset).toHaveBeenCalledWith(DEFAULT_SCENE);
    expect(fake.resetStats).toHaveBeenCalled();
    act(() => fake.events!.onAction("quit"));
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Start Demolition" })).toBeInTheDocument();
  });

  it("shows the hardware probe with low/high columns and toggles it on the debug action", () => {
    startGame();
    pushStats({});
    const panel = screen.getByLabelText("Hardware probe");
    expect(panel).toHaveTextContent("300 parts");
    expect(panel).toHaveTextContent("8 threads");
    expect(panel).toHaveTextContent("cross-origin isolated");
    expect(panel).toHaveTextContent("Test GPU");
    const row = within(panel).getByText("physics ms").closest("tr")!;
    expect(row).toHaveTextContent("1.2");
    expect(row).toHaveTextContent("0.7");
    expect(row).toHaveTextContent("31.8");
    fireEvent.click(within(panel).getByRole("button", { name: "Reset hi/lo" }));
    expect(fake.resetStats).toHaveBeenCalled();
    act(() => fake.events!.onAction("debug"));
    expect(screen.queryByLabelText("Hardware probe")).not.toBeInTheDocument();
  });

  it("explains how to get multithreading when the page is not isolated", () => {
    startGame();
    pushStats({ threads: 0, crossOriginIsolated: false });
    expect(screen.getByLabelText("Hardware probe")).toHaveTextContent("1 thread · not isolated");
  });

  it("switches the hint line to pad glyphs when a controller is connected", () => {
    startGame();
    expect(screen.getByText(/W throttle/)).toBeInTheDocument();
    pushStats({ padConnected: true });
    expect(screen.getByText(/RT throttle/)).toBeInTheDocument();
  });

  it("surfaces a worker error", () => {
    startGame();
    act(() => fake.events!.onError("wasm failed to load"));
    expect(screen.getByText("wasm failed to load")).toBeInTheDocument();
  });
});

describe("formatClock", () => {
  it("formats minutes, seconds and tenths", () => {
    expect(formatClock(0)).toBe("0:00.0");
    expect(formatClock(14_230)).toBe("0:14.2");
    expect(formatClock(75_900)).toBe("1:15.9");
  });
});
