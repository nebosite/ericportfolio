// Behavior tests for the warm, play-first Singadoodle home screen: the hero +
// voice chip, the overlays, and the "cards open intros without touching the
// microphone" contract. Canvas/mic internals are exercised in the manual
// browser review; here the engines run against a null 2D context and a
// never-resolving getUserMedia stub.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SingadoodlePage from "./SingadoodlePage";

// IndexedDB isn't available under jsdom — stub the persistence layer with
// resolved defaults and keep the pure helpers real.
vi.mock("./src/storage/history", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./src/storage/history")>();
  return {
    ...actual,
    loadStats: vi.fn(async () => ({ ...actual.DEFAULT_STATS })),
    loadHistory: vi.fn(async () => []),
    loadGarden: vi.fn(async () => ({ elements: [], nextId: 1, createdTs: null })),
    saveStats: vi.fn(async () => {}),
    saveGarden: vi.fn(async () => {}),
    addHistory: vi.fn(async () => {}),
    submitHighScore: vi.fn(),
  };
});

const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {})); // stays pending

beforeEach(() => {
  getUserMedia.mockClear();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  // Quiet, deterministic canvases + no animation loops under jsdom.
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => null,
  ) as unknown as HTMLCanvasElement["getContext"];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderHome() {
  const utils = render(
    <MemoryRouter>
      <SingadoodlePage />
    </MemoryRouter>,
  );
  await screen.findByText("Ways to play"); // lets the async stats load settle
  return utils;
}

describe("SingadoodlePage home (warm reskin)", () => {
  it("leads with play: hero, onramp, three game cards, train-your-ear, feedback", async () => {
    await renderHome();
    expect(screen.getByRole("heading", { name: /singadoodle/i })).toBeInTheDocument();
    expect(screen.getByText(/no lessons, no pressure/i)).toBeInTheDocument();
    expect(screen.getByText(/new here\? start here/i)).toBeInTheDocument();
    for (const name of ["Range Explorer", "Voice Garden", "Chroma Loom", "The Trainer"]) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
    expect(screen.getByText("Train your ear")).toBeInTheDocument();
    expect(screen.getByText(/open your practice/i)).toBeInTheDocument();
    // The standard per-entity feedback feature stays on the title screen.
    expect(screen.getByText(/help shape singadoodle/i)).toBeInTheDocument();
  });

  it("voice chip opens the picker; choosing a voice updates the chip and closes it", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /singing as/i }));
    expect(screen.getByText("Which voice is yours?")).toBeInTheDocument();
    // Real ranges from VOICES, warm plain-language descriptions.
    expect(screen.getByText("a deep, resonant voice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /bass/i }));
    await waitFor(() => expect(screen.queryByText("Which voice is yours?")).toBeNull());
    expect(screen.getByRole("button", { name: /singing as bass/i })).toBeInTheDocument();
  });

  it("practice card opens the gently-kept stats overlay", async () => {
    await renderHome();
    fireEvent.click(screen.getByText(/open your practice/i));
    expect(screen.getByText("Your practice, gently kept")).toBeInTheDocument();
    expect(screen.getByText("day streak")).toBeInTheDocument();
    expect(screen.getByText("visits")).toBeInTheDocument();
    expect(screen.getByText("best")).toBeInTheDocument();
  });

  it("a game card opens its intro without touching the microphone", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /voice garden/i }));
    expect(await screen.findByRole("button", { name: /open the garden/i })).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("the garden intro's CTA is what requests the mic", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /voice garden/i }));
    fireEvent.click(await screen.findByRole("button", { name: /open the garden/i }));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("the trainer intro hosts the level picker with warm copy", async () => {
    await renderHome();
    fireEvent.click(screen.getByRole("button", { name: /the trainer/i }));
    expect(await screen.findByText("Choose a level")).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /expert/i }));
    expect(screen.getByText(/the pitch is hidden\. trust your ear\./i)).toBeInTheDocument();
    // The intro also carries the voice chip for quick switching.
    expect(screen.getByRole("button", { name: /voice: /i })).toBeInTheDocument();
  });
});
