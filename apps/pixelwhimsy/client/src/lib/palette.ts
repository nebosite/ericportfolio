// Classic 8-bit indexed color for PixelWhimsy. The drawing surface stores a
// palette *index* (0-255) per toy pixel, and a render loop maps each index to a
// color through the current palette. The palette is animated, so the same
// drawing can shimmer and cycle without touching the pixel buffer — the old
// demoscene "color cycling" trick.
//
// Layout of the 256 entries:
//   0          BLANK — the white background / eraser.
//   1 .. N     The static crayon colors (paint that never animates).
//   128 .. 255 The "high-bit" colors: 16 consecutive GROUPS of 8. Each group has
//              one base color; at any animation phase exactly one slot in the
//              group shows that color and the other seven are white. Each tick
//              the lit slot advances and wraps — a little marching dot of color.
//
// Painting with an animated color writes successive indices within a group as
// the brush stamps, so the lit dot chases along the stroke as the palette ticks.
//
// Pure and framework-free so the index math and palette construction are unit
// tested away from the canvas.

import { PALETTE as CRAYONS, BLANK } from './paint';

export const PALETTE_SIZE = 256;
export const BLANK_INDEX = 0;
export const ANIM_BASE = 128; // high-bit colors start here
export const GROUP_SIZE = 8;
export const GROUP_COUNT = (PALETTE_SIZE - ANIM_BASE) / GROUP_SIZE; // 16
const WHITE = '#ffffff';
const BLACK = '#000000';

// Static colors: index 0 is blank (the mode's background), then crayons at 1..16.
export const STATIC_COLORS: readonly string[] = [BLANK, ...CRAYONS];

// One base color per animated group — vivid crayons only. White and black are
// excluded: an animated color has to read against BOTH the light (white) and
// dark (black) backgrounds, and each of those vanishes on one of them.
export const GROUP_COLORS: readonly string[] = (() => {
  const vivid = CRAYONS.filter((c) => {
    const l = c.toLowerCase();
    return l !== WHITE && l !== BLACK;
  });
  return Array.from({ length: GROUP_COUNT }, (_, g) => vivid[g % vivid.length]);
})();

export function isAnimatedIndex(index: number): boolean {
  return index >= ANIM_BASE;
}

/** The group (0..GROUP_COUNT-1) an animated index belongs to. */
export function groupOf(index: number): number {
  return Math.floor((index - ANIM_BASE) / GROUP_SIZE);
}

/** The index to write for the `stamp`-th brush stamp of an animated group. */
export function animIndex(group: number, stamp: number): number {
  const slot = ((stamp % GROUP_SIZE) + GROUP_SIZE) % GROUP_SIZE;
  return ANIM_BASE + group * GROUP_SIZE + slot;
}

/** Which slot within every group is lit (the full color) at this phase. */
export function litSlot(phase: number): number {
  return ((phase % GROUP_SIZE) + GROUP_SIZE) % GROUP_SIZE;
}

/** Circular distance between two slots on a ring of `n`. */
function ringDist(a: number, b: number, n: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

/** Halfway between a "#rrggbb" color and a target ("#ffffff" or "#000000"). */
function halfTo(hex: string, target: string): string {
  const mid = (i: number) =>
    Math.round(
      (parseInt(hex.slice(i, i + 2), 16) + parseInt(target.slice(i, i + 2), 16)) /
        2,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${mid(1)}${mid(3)}${mid(5)}`;
}

// Feathered shoulders: each step away from the lit slot fades halfway toward the
// background. Three shoulders on each side, then the farthest slot (the "rest")
// gets one more half-step — never reaching the background, so the whole group
// stays gently tinted. Two ladders: toward white (light mode) and black (dark).
function buildLadder(target: string): readonly (readonly string[])[] {
  const half = GROUP_COLORS.map((c) => halfTo(c, target));
  const faint = half.map((c) => halfTo(c, target));
  const fainter = faint.map((c) => halfTo(c, target));
  const rest = fainter.map((c) => halfTo(c, target));
  return [GROUP_COLORS, half, faint, fainter, rest];
}

const SHADES_LIGHT = buildLadder(WHITE);
const SHADES_DARK = buildLadder(BLACK);

// Backward-compatible light-mode shade exports (indexed by ring distance).
export const GROUP_HALF: readonly string[] = SHADES_LIGHT[1];
export const GROUP_FAINT: readonly string[] = SHADES_LIGHT[2];
export const GROUP_FAINTER: readonly string[] = SHADES_LIGHT[3];
export const GROUP_REST: readonly string[] = SHADES_LIGHT[4];

/**
 * The color string an index resolves to at a given animation phase and mode. The
 * lit slot shows the full group color; each step away fades one shade toward the
 * background (white in light mode, black in dark), down to the faint "rest" tint
 * — never the background itself, so the group stays gently colored.
 */
export function colorAt(index: number, phase: number, dark = false): string {
  if (index < ANIM_BASE) {
    if (index === BLANK_INDEX) return dark ? BLACK : WHITE;
    return STATIC_COLORS[index] ?? (dark ? BLACK : WHITE);
  }
  const shades = dark ? SHADES_DARK : SHADES_LIGHT;
  const g = groupOf(index);
  const slot = (index - ANIM_BASE) % GROUP_SIZE;
  const d = ringDist(slot, litSlot(phase), GROUP_SIZE);
  return shades[Math.min(d, shades.length - 1)][g];
}

/** Pack "#rrggbb" into a little-endian RGBA word for canvas ImageData. */
export function hexToRgba32(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; // 0xAABBGGRR
}

const STATIC_RGBA = STATIC_COLORS.map(hexToRgba32);
const WHITE_RGBA = hexToRgba32(WHITE);
const BLACK_RGBA = hexToRgba32(BLACK);
// Per-shade RGBA tables for the render loop, one set per background mode.
const SHADE_RGBA_LIGHT: number[][] = SHADES_LIGHT.map((arr) => arr.map(hexToRgba32));
const SHADE_RGBA_DARK: number[][] = SHADES_DARK.map((arr) => arr.map(hexToRgba32));

/**
 * Build the 256-entry index→RGBA lookup for the given animation phase and mode,
 * into `out` (reused across frames to avoid allocation). Static crayons are
 * constant; the blank background (index 0) follows the mode (white/black), and
 * within each high-bit group the lit slot carries the full color while each step
 * away fades a shade toward the background (down to the faint "rest" tint).
 */
export function buildPalette32(
  phase: number,
  out: Uint32Array = new Uint32Array(PALETTE_SIZE),
  dark = false,
): Uint32Array {
  const base = dark ? BLACK_RGBA : WHITE_RGBA;
  const shadeRGBA = dark ? SHADE_RGBA_DARK : SHADE_RGBA_LIGHT;
  for (let i = 0; i < ANIM_BASE; i++) {
    out[i] = i < STATIC_RGBA.length ? STATIC_RGBA[i] : base;
  }
  out[BLANK_INDEX] = base; // the blank background follows the mode
  const lit = litSlot(phase);
  for (let g = 0; g < GROUP_COUNT; g++) {
    const b = ANIM_BASE + g * GROUP_SIZE;
    for (let s = 0; s < GROUP_SIZE; s++) {
      const d = ringDist(s, lit, GROUP_SIZE);
      out[b + s] = shadeRGBA[Math.min(d, shadeRGBA.length - 1)][g];
    }
  }
  return out;
}
