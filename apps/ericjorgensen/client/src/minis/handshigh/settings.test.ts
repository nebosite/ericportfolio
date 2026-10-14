import { describe, it, expect, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";

beforeEach(() => localStorage.clear());

describe("settings", () => {
  it("defaults to green on black", () => {
    expect(DEFAULT_SETTINGS.fg).toBe("#00ff00");
    expect(DEFAULT_SETTINGS.bg).toBe("#000000");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    const s = { charsPerSecond: 3.5, fg: "#ffff00",
      bg: "#000080",
      bold: false,
      font: "narrow" as const,
    };
    saveSettings(s);
    expect(loadSettings()).toEqual(s);
  });

  it("falls back to defaults when stored values are invalid or off-palette", () => {
    localStorage.setItem(
      "handshigh:settings",
      JSON.stringify({ charsPerSecond: 99, fg: "red", bg: "#123456" }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults to bold wide type and ignores bad values", () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ bold: true, font: "wide" });
    localStorage.setItem("handshigh:settings", JSON.stringify({ bold: "yes", font: "comic" }));
    expect(loadSettings()).toMatchObject({ bold: true, font: "wide" });
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("handshigh:settings", "{nope");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
