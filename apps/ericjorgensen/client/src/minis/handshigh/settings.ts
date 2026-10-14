import {
  DEFAULT_CHARS_PER_SECOND,
  FontWidth,
  MAX_CHARS_PER_SECOND,
  MIN_CHARS_PER_SECOND,
} from "./marquee";
import { isPaletteColor } from "./palette";

export interface Settings {
  charsPerSecond: number;
  fg: string;
  bg: string;
  bold: boolean;
  font: FontWidth;
}

export const DEFAULT_SETTINGS: Settings = {
  charsPerSecond: DEFAULT_CHARS_PER_SECOND,
  fg: "#00ff00",
  bg: "#000000",
  bold: true,
  font: "wide",
};

const KEY = "handshigh:settings";

/** Reads saved settings, falling back per-field to the defaults for anything invalid. */
export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const cps = Number(raw.charsPerSecond);
    return {
      charsPerSecond:
        cps >= MIN_CHARS_PER_SECOND && cps <= MAX_CHARS_PER_SECOND
          ? cps
          : DEFAULT_SETTINGS.charsPerSecond,
      fg: isPaletteColor(raw.fg) ? raw.fg : DEFAULT_SETTINGS.fg,
      bg: isPaletteColor(raw.bg) ? raw.bg : DEFAULT_SETTINGS.bg,
      bold: typeof raw.bold === "boolean" ? raw.bold : DEFAULT_SETTINGS.bold,
      font: raw.font === "narrow" || raw.font === "wide" ? raw.font : DEFAULT_SETTINGS.font,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings just won't be remembered */
  }
}
