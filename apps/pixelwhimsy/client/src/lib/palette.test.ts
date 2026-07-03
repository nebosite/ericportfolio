import { describe, it, expect } from "vitest";
import {
  ANIM_BASE,
  GROUP_SIZE,
  GROUP_COUNT,
  STATIC_COLORS,
  GROUP_COLORS,
  GROUP_HALF,
  GROUP_FAINT,
  GROUP_FAINTER,
  GROUP_REST,
  animIndex,
  litSlot,
  groupOf,
  isAnimatedIndex,
  colorAt,
  hexToRgba32,
  buildPalette32,
} from "./palette";

// circular distance between two slots on the 8-ring, mirroring palette.ts
const ring = (a: number, b: number) => Math.min(Math.abs(a - b), GROUP_SIZE - Math.abs(a - b));
// the shade ladder by distance: full, three shoulders, then the rest tint
const shade = (g: number, d: number) =>
  [GROUP_COLORS, GROUP_HALF, GROUP_FAINT, GROUP_FAINTER, GROUP_REST][Math.min(d, 4)][g];

describe("index helpers", () => {
  it("separates static indices from animated high-bit indices", () => {
    expect(isAnimatedIndex(0)).toBe(false);
    expect(isAnimatedIndex(ANIM_BASE - 1)).toBe(false);
    expect(isAnimatedIndex(ANIM_BASE)).toBe(true);
    expect(isAnimatedIndex(255)).toBe(true);
  });

  it("maps animated indices back to their group", () => {
    expect(groupOf(ANIM_BASE)).toBe(0);
    expect(groupOf(ANIM_BASE + GROUP_SIZE - 1)).toBe(0);
    expect(groupOf(ANIM_BASE + GROUP_SIZE)).toBe(1);
    expect(groupOf(255)).toBe(GROUP_COUNT - 1);
  });

  it("walks a group one slot per stamp and wraps after 8", () => {
    const g = 2;
    const base = ANIM_BASE + g * GROUP_SIZE;
    expect(animIndex(g, 0)).toBe(base + 0);
    expect(animIndex(g, 7)).toBe(base + 7);
    expect(animIndex(g, 8)).toBe(base + 0); // wraps within the group
    expect(animIndex(g, 11)).toBe(base + 3);
  });

  it("advances the lit slot each phase and wraps", () => {
    expect(litSlot(0)).toBe(0);
    expect(litSlot(7)).toBe(7);
    expect(litSlot(8)).toBe(0);
  });
});

describe("colorAt", () => {
  it("returns the fixed color for static indices", () => {
    expect(colorAt(0, 0)).toBe(STATIC_COLORS[0]);
    expect(colorAt(1, 99)).toBe(STATIC_COLORS[1]); // phase has no effect
  });

  it("lights one slot full, fades three shoulders each side, tints the rest", () => {
    const g = 3;
    const base = ANIM_BASE + g * GROUP_SIZE;
    const phase = 2;
    const lit = litSlot(phase);
    for (let s = 0; s < GROUP_SIZE; s++) {
      expect(colorAt(base + s, phase)).toBe(shade(g, ring(s, lit)));
    }
  });

  it("softens the shoulders of the lit slot and moves them with the phase", () => {
    const base = ANIM_BASE; // group 0
    expect(colorAt(base + 0, 0)).toBe(GROUP_COLORS[0]); // lit
    expect(colorAt(base + 1, 0)).toBe(GROUP_HALF[0]); // shoulder 1
    expect(colorAt(base + 2, 0)).toBe(GROUP_FAINT[0]); // shoulder 2
    expect(colorAt(base + 3, 0)).toBe(GROUP_FAINTER[0]); // shoulder 3
    expect(colorAt(base + 4, 0)).toBe(GROUP_REST[0]); // far slot — tinted, not white
    expect(colorAt(base + 7, 0)).toBe(GROUP_HALF[0]); // shoulder 1 wraps round
    // phase advances → the lit slot (and its shoulders) move on
    expect(colorAt(base + 1, 1)).toBe(GROUP_COLORS[0]);
    expect(colorAt(base + 0, 1)).toBe(GROUP_HALF[0]);
  });

  it("the shades step from full color toward — but not reaching — white", () => {
    const ladder = [
      GROUP_COLORS[0],
      GROUP_HALF[0],
      GROUP_FAINT[0],
      GROUP_FAINTER[0],
      GROUP_REST[0],
    ];
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]).not.toBe(ladder[i - 1]);
    expect(GROUP_REST[0]).not.toBe("#ffffff"); // the rest is a tint, never pure white
  });
});

describe("hexToRgba32", () => {
  it("packs hex into little-endian RGBA with full alpha", () => {
    expect(hexToRgba32("#ff0000") >>> 0).toBe(0xff0000ff); // R=ff, A=ff
    expect(hexToRgba32("#00ff00") >>> 0).toBe(0xff00ff00); // G=ff
    expect(hexToRgba32("#0000ff") >>> 0).toBe(0xffff0000); // B=ff
  });
});

describe("buildPalette32", () => {
  it("fills static entries and lights one slot per group for the phase", () => {
    const phase = 5;
    const pal = buildPalette32(phase);
    expect(pal).toHaveLength(256);

    // static
    expect(pal[0]).toBe(hexToRgba32(STATIC_COLORS[0]));
    expect(pal[1]).toBe(hexToRgba32(STATIC_COLORS[1]));

    // every group: lit slot full color, then shaded shoulders down to the rest
    const lit = litSlot(phase);
    for (let g = 0; g < GROUP_COUNT; g++) {
      const base = ANIM_BASE + g * GROUP_SIZE;
      for (let s = 0; s < GROUP_SIZE; s++) {
        expect(pal[base + s]).toBe(hexToRgba32(shade(g, ring(s, lit))));
      }
    }
  });

  it("reuses the provided output buffer", () => {
    const buf = new Uint32Array(256);
    expect(buildPalette32(0, buf)).toBe(buf);
  });

  it("bases on white in light mode and black in dark mode", () => {
    expect(buildPalette32(0)[0]).toBe(hexToRgba32("#ffffff"));
    expect(buildPalette32(0, undefined, true)[0]).toBe(hexToRgba32("#000000"));
  });
});

describe("dark mode", () => {
  it("fades animated shoulders toward black, not white", () => {
    const g = 0;
    const rest = ANIM_BASE + g * GROUP_SIZE + 4; // farthest slot from a lit slot 0
    const dark = colorAt(rest, 0, true);
    const light = colorAt(rest, 0, false);
    expect(dark).not.toBe(light);
    expect(dark).not.toBe("#000000"); // never reaches the background
    expect(colorAt(ANIM_BASE + g * GROUP_SIZE, 0, true)).toBe(GROUP_COLORS[g]); // lit slot is full color in both modes
  });

  it("animated groups avoid white and black so they show on both backgrounds", () => {
    for (const c of GROUP_COLORS) {
      expect(c.toLowerCase()).not.toBe("#ffffff");
      expect(c.toLowerCase()).not.toBe("#000000");
    }
  });
});
