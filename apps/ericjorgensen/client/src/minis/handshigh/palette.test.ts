import { describe, it, expect } from "vitest";
import { BRIGHT_COLORS, DARK_COLORS, PALETTE, isPaletteColor } from "./palette";
import { DEFAULT_SETTINGS } from "./settings";

describe("palette", () => {
  it("offers eight bright and eight dark colors, all distinct", () => {
    expect(BRIGHT_COLORS).toHaveLength(8);
    expect(DARK_COLORS).toHaveLength(8);
    expect(new Set(PALETTE.map((c) => c.hex)).size).toBe(16);
  });

  it("contains the default green-on-black", () => {
    expect(isPaletteColor(DEFAULT_SETTINGS.fg)).toBe(true);
    expect(isPaletteColor(DEFAULT_SETTINGS.bg)).toBe(true);
  });

  it("rejects colors that are not in the palette", () => {
    expect(isPaletteColor("#123456")).toBe(false);
    expect(isPaletteColor(42)).toBe(false);
  });
});
