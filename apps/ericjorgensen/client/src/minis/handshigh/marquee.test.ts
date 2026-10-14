import { describe, it, expect } from "vitest";
import {
  LOOP_PAUSE_MS,
  MAX_MESSAGE_LENGTH,
  fontSizeForHeight,
  fontStyle,
  marqueeOffset,
  normalizeMessage,
  scrollSpeed,
} from "./marquee";

describe("normalizeMessage", () => {
  it("upper-cases, trims and collapses whitespace", () => {
    expect(normalizeMessage("  hands \n  high ")).toBe("HANDS HIGH");
  });
  it("returns empty for blank input", () => {
    expect(normalizeMessage("   ")).toBe("");
  });
  it("caps the length", () => {
    expect(normalizeMessage("a".repeat(500))).toHaveLength(MAX_MESSAGE_LENGTH);
  });
});

describe("scrollSpeed", () => {
  it("moves one average character width per 1/charsPerSecond seconds", () => {
    expect(scrollSpeed(1000, 10, 3)).toBeCloseTo(300);
  });
  it("scales with the chosen speed", () => {
    expect(scrollSpeed(1000, 10, 4)).toBe(2 * scrollSpeed(1000, 10, 2));
  });
  it("is zero with no characters", () => {
    expect(scrollSpeed(100, 0, 2)).toBe(0);
  });
});

describe("marqueeOffset", () => {
  // viewport 400, text 1000, speed 100px/s => 14s of travel, then the pause.
  const travelMs = 14000;

  it("starts just off the right edge", () => {
    expect(marqueeOffset(0, 400, 1000, 100)).toBe(400);
  });
  it("moves left at the given speed", () => {
    expect(marqueeOffset(1000, 400, 1000, 100)).toBe(300);
  });
  it("is fully off the left edge when the last letter leaves", () => {
    expect(marqueeOffset(travelMs - 1, 400, 1000, 100)).toBeCloseTo(-1000, 0);
  });
  it("stays blank (off-screen) for the whole pause", () => {
    expect(LOOP_PAUSE_MS).toBe(2000);
    expect(marqueeOffset(travelMs, 400, 1000, 100)).toBe(-1000);
    expect(marqueeOffset(travelMs + LOOP_PAUSE_MS - 1, 400, 1000, 100)).toBe(-1000);
  });
  it("restarts from the right edge after the pause", () => {
    expect(marqueeOffset(travelMs + LOOP_PAUSE_MS, 400, 1000, 100)).toBe(400);
  });
  it("parks at the right edge when it cannot move", () => {
    expect(marqueeOffset(5000, 400, 1000, 0)).toBe(400);
  });
});

describe("fontSizeForHeight", () => {
  it("makes capitals nearly fill the height", () => {
    const size = fontSizeForHeight(800);
    expect(size * 0.72).toBeCloseTo(800 * 0.84);
  });
});

describe("fontStyle", () => {
  it("wide bold is the heavy Arial Black look", () => {
    const s = fontStyle(true, "wide");
    expect(s.fontFamily).toContain("Arial Black");
    expect(s.fontWeight).toBe(900);
  });
  it("wide without bold drops to regular Arial", () => {
    const s = fontStyle(false, "wide");
    expect(s.fontFamily).toMatch(/^Arial,/);
    expect(s.fontWeight).toBe(400);
  });
  it("narrow uses a condensed face, bold or not", () => {
    expect(fontStyle(true, "narrow")).toMatchObject({ fontStretch: "condensed", fontWeight: 700 });
    expect(fontStyle(false, "narrow").fontFamily).toContain("Arial Narrow");
    expect(fontStyle(false, "narrow").fontWeight).toBe(400);
  });
});
