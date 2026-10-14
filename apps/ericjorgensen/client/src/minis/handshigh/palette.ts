export interface PaletteColor {
  name: string;
  hex: string;
}

/** Eight bright colors, then eight dark ones — the only choices offered for text and background. */
export const BRIGHT_COLORS: PaletteColor[] = [
  { name: "Red", hex: "#ff0000" },
  { name: "Orange", hex: "#ff8c00" },
  { name: "Yellow", hex: "#ffff00" },
  { name: "Green", hex: "#00ff00" },
  { name: "Cyan", hex: "#00ffff" },
  { name: "Sky blue", hex: "#3399ff" },
  { name: "Magenta", hex: "#ff00ff" },
  { name: "White", hex: "#ffffff" },
];

export const DARK_COLORS: PaletteColor[] = [
  { name: "Black", hex: "#000000" },
  { name: "Charcoal", hex: "#444444" },
  { name: "Maroon", hex: "#800000" },
  { name: "Brown", hex: "#7a4a00" },
  { name: "Forest", hex: "#006400" },
  { name: "Teal", hex: "#006666" },
  { name: "Navy", hex: "#000080" },
  { name: "Purple", hex: "#660099" },
];

export const PALETTE: PaletteColor[] = [...BRIGHT_COLORS, ...DARK_COLORS];

export function isPaletteColor(hex: unknown): hex is string {
  return typeof hex === "string" && PALETTE.some((c) => c.hex === hex);
}
