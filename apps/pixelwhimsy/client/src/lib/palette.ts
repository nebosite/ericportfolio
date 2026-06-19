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
const ANIM_WHITE = '#ffffff';

// Static colors: index 0 is blank/white, then the crayons at 1..16.
export const STATIC_COLORS: readonly string[] = [BLANK, ...CRAYONS];

// One base color per animated group — vivid crayons (white can't animate against
// a white background), wrapping if there are more groups than colors.
export const GROUP_COLORS: readonly string[] = (() => {
  const vivid = CRAYONS.filter((c) => c.toLowerCase() !== ANIM_WHITE);
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

/** Halfway between a "#rrggbb" color and white — a softened tint. */
function halfToWhite(hex: string): string {
  const mid = (i: number) =>
    Math.round((parseInt(hex.slice(i, i + 2), 16) + 255) / 2)
      .toString(16)
      .padStart(2, "0");
  return `#${mid(1)}${mid(3)}${mid(5)}`;
}

// Feathered shoulders: each step away from the lit slot fades halfway toward
// white. Three shoulders on each side, then the farthest slot (the "rest") gets
// one more half-step — never pure white, so the whole group stays gently tinted.
export const GROUP_HALF: readonly string[] = GROUP_COLORS.map(halfToWhite);
export const GROUP_FAINT: readonly string[] = GROUP_HALF.map(halfToWhite);
export const GROUP_FAINTER: readonly string[] = GROUP_FAINT.map(halfToWhite);
export const GROUP_REST: readonly string[] = GROUP_FAINTER.map(halfToWhite);

// Indexed by min(ring distance, 4): full color, three shoulders, then the rest.
const SHADES: readonly (readonly string[])[] = [
  GROUP_COLORS,
  GROUP_HALF,
  GROUP_FAINT,
  GROUP_FAINTER,
  GROUP_REST,
];

/**
 * The color string an index resolves to at a given animation phase. The lit slot
 * shows the full group color; each step away fades one shade toward white (three
 * shoulders on each side), and the farthest slot is the faint "rest" tint —
 * never pure white, so the whole group stays gently colored.
 */
export function colorAt(index: number, phase: number): string {
  if (index < ANIM_BASE) return STATIC_COLORS[index] ?? BLANK;
  const g = groupOf(index);
  const slot = (index - ANIM_BASE) % GROUP_SIZE;
  const d = ringDist(slot, litSlot(phase), GROUP_SIZE);
  return SHADES[Math.min(d, SHADES.length - 1)][g];
}

/** Pack "#rrggbb" into a little-endian RGBA word for canvas ImageData. */
export function hexToRgba32(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0; // 0xAABBGGRR
}

const STATIC_RGBA = STATIC_COLORS.map(hexToRgba32);
const WHITE_RGBA = hexToRgba32(ANIM_WHITE);
// Per-shade RGBA tables, parallel to SHADES, for the render loop.
const SHADE_RGBA: number[][] = SHADES.map((arr) => arr.map(hexToRgba32));

/**
 * Build the 256-entry index→RGBA lookup for the given animation phase, into
 * `out` (reused across frames to avoid allocation). Static entries are constant;
 * within each high-bit group the lit slot carries the full color and each step
 * away fades a shade toward white (down to the faint "rest" tint).
 */
export function buildPalette32(phase: number, out: Uint32Array = new Uint32Array(PALETTE_SIZE)): Uint32Array {
  for (let i = 0; i < ANIM_BASE; i++) {
    out[i] = i < STATIC_RGBA.length ? STATIC_RGBA[i] : WHITE_RGBA;
  }
  const lit = litSlot(phase);
  for (let g = 0; g < GROUP_COUNT; g++) {
    const base = ANIM_BASE + g * GROUP_SIZE;
    for (let s = 0; s < GROUP_SIZE; s++) {
      const d = ringDist(s, lit, GROUP_SIZE);
      out[base + s] = SHADE_RGBA[Math.min(d, SHADE_RGBA.length - 1)][g];
    }
  }
  return out;
}
