import { describe, it, expect } from "vitest";
import {
  LOOM_LO_MIDI,
  LOOM_HI_MIDI,
  freq01,
  hzAt01,
  semitoneLines,
  DEFAULT_RAINBOW,
  hexToRgb,
  rainbowAt,
  parseRainbow,
  bandMean,
  buildColumn,
  PATTERNS,
  getPattern,
} from "./chromaLoom";
import { midiHz } from "./notes";

describe("frequency axis", () => {
  it("maps the span endpoints to 0 and 1", () => {
    expect(freq01(midiHz(LOOM_LO_MIDI))).toBeCloseTo(0, 6);
    expect(freq01(midiHz(LOOM_HI_MIDI))).toBeCloseTo(1, 6);
  });

  it("puts the midpoint semitone at 0.5 (log spacing)", () => {
    const mid = (LOOM_LO_MIDI + LOOM_HI_MIDI) / 2;
    expect(freq01(midiHz(mid))).toBeCloseTo(0.5, 6);
  });

  it("is monotonic in frequency", () => {
    let prev = -Infinity;
    for (let hz = 70; hz <= 2000; hz += 50) {
      const t = freq01(hz);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });

  it("hzAt01 inverts freq01", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      expect(freq01(hzAt01(t))).toBeCloseTo(t, 6);
    }
  });
});

describe("semitoneLines", () => {
  const lines = semitoneLines();

  it("has one line per semitone, C2..C7 inclusive", () => {
    expect(lines).toHaveLength(LOOM_HI_MIDI - LOOM_LO_MIDI + 1);
    expect(lines[0].midi).toBe(LOOM_LO_MIDI);
    expect(lines[lines.length - 1].midi).toBe(LOOM_HI_MIDI);
  });

  it("spaces lines evenly from 0 to 1", () => {
    expect(lines[0].t01).toBe(0);
    expect(lines[lines.length - 1].t01).toBe(1);
    const step = lines[1].t01 - lines[0].t01;
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].t01 - lines[i - 1].t01).toBeCloseTo(step, 9);
    }
  });

  it("flags the six C octave lines with labels", () => {
    const cs = lines.filter((l) => l.isC);
    expect(cs.map((l) => l.label)).toEqual(["C2", "C3", "C4", "C5", "C6", "C7"]);
    for (const c of cs) expect(c.natural).toBe(true);
  });

  it("marks sharps as non-natural", () => {
    const cSharp = lines.find((l) => l.midi === 37)!;
    expect(cSharp.natural).toBe(false);
  });
});

describe("rainbow", () => {
  it("parses long and short hex, any case", () => {
    expect(hexToRgb("#ff8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(hexToRgb("#F00")).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb("nope")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
  });

  it("hits the exact key colors at their stops", () => {
    const stops = parseRainbow(DEFAULT_RAINBOW);
    expect(rainbowAt(stops, 0)).toEqual(hexToRgb(DEFAULT_RAINBOW[0]));
    expect(rainbowAt(stops, 1)).toEqual(hexToRgb(DEFAULT_RAINBOW[DEFAULT_RAINBOW.length - 1]));
    // With 7 stops, t = 3/6 lands exactly on the middle (green) stop.
    expect(rainbowAt(stops, 0.5)).toEqual(hexToRgb(DEFAULT_RAINBOW[3]));
  });

  it("interpolates linearly between neighbouring stops", () => {
    const stops = [
      { r: 0, g: 0, b: 0 },
      { r: 100, g: 200, b: 50 },
    ];
    expect(rainbowAt(stops, 0.5)).toEqual({ r: 50, g: 100, b: 25 });
  });

  it("clamps t outside 0..1", () => {
    const stops = parseRainbow(DEFAULT_RAINBOW);
    expect(rainbowAt(stops, -1)).toEqual(rainbowAt(stops, 0));
    expect(rainbowAt(stops, 2)).toEqual(rainbowAt(stops, 1));
  });

  it("parseRainbow falls back per-entry on malformed colors", () => {
    const parsed = parseRainbow(["#000000", "garbage", "#ffffff"]);
    expect(parsed[0]).toEqual({ r: 0, g: 0, b: 0 });
    expect(parsed[1]).toEqual(hexToRgb(DEFAULT_RAINBOW[1]));
    expect(parsed[2]).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("bandMean", () => {
  const spec = [10, 20, 30, 40];

  it("returns the covering bin for a within-bin band", () => {
    expect(bandMean(spec, 0.6, 1.4)).toBeCloseTo(20, 6);
  });

  it("averages fractional coverage across bins", () => {
    // [1.0, 2.0] covers half of bin 1 and half of bin 2.
    expect(bandMean(spec, 1.0, 2.0)).toBeCloseTo(25, 6);
  });

  it("degenerates to the nearest bin for a zero-width band", () => {
    expect(bandMean(spec, 2.0, 2.0)).toBe(30);
  });
});

describe("buildColumn", () => {
  const SR = 48000;
  const BINS = 4096; // fftSize 8192
  const ROWS = 240;

  it("puts a pure tone's energy at its log-axis row", () => {
    const hz = 440;
    const spectrum = new Uint8Array(BINS);
    const binHz = SR / (2 * BINS);
    spectrum[Math.round(hz / binHz)] = 255;
    const col = buildColumn(spectrum, SR, ROWS);
    let maxRow = 0;
    for (let i = 1; i < ROWS; i++) if (col[i] > col[maxRow]) maxRow = i;
    const expected = Math.round((1 - freq01(hz)) * (ROWS - 1));
    expect(Math.abs(maxRow - expected)).toBeLessThanOrEqual(1);
    expect(col[maxRow]).toBeGreaterThan(0);
  });

  it("is silent for an empty spectrum and full-scale for a saturated one", () => {
    const quiet = buildColumn(new Uint8Array(BINS), SR, ROWS);
    for (const v of quiet) expect(v).toBe(0);
    const loud = buildColumn(new Uint8Array(BINS).fill(255), SR, ROWS);
    for (const v of loud) expect(v).toBeCloseTo(1, 6);
  });
});

describe("patterns", () => {
  it("offers four looms with unique ids, only the ribbon ready", () => {
    expect(PATTERNS).toHaveLength(4);
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(4);
    expect(PATTERNS.filter((p) => p.ready).map((p) => p.id)).toEqual(["ribbon"]);
  });

  it("getPattern resolves ids and falls back to the ribbon", () => {
    expect(getPattern("snail").label).toBe("Snail Shell");
    expect(getPattern("nope" as never).id).toBe("ribbon");
  });
});
