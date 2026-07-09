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
  buildStrip,
  createPerlin,
  smokeMix01,
  emberAlpha,
  waterfallVelocityMps,
  WATERFALL_ENTRY_MPS,
  WATERFALL_DROP_M,
  GRAVITY_MPS2,
  converge,
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

describe("buildStrip", () => {
  const SR = 48000;
  const BINS = 4096;
  const N = 240;

  it("is buildColumn flipped (index 0 = lowest frequency)", () => {
    const spectrum = new Uint8Array(BINS);
    for (let i = 0; i < BINS; i++) spectrum[i] = (i * 7) % 256;
    const strip = buildStrip(spectrum, SR, N);
    const col = buildColumn(spectrum, SR, N);
    for (let i = 0; i < N; i++) expect(col[i]).toBeCloseTo(strip[N - 1 - i], 6);
  });

  it("puts a pure tone's energy at its log-axis slot", () => {
    const hz = 440;
    const spectrum = new Uint8Array(BINS);
    spectrum[Math.round(hz / (SR / (2 * BINS)))] = 255;
    const strip = buildStrip(spectrum, SR, N);
    let maxI = 0;
    for (let i = 1; i < N; i++) if (strip[i] > strip[maxI]) maxI = i;
    expect(Math.abs(maxI - Math.round(freq01(hz) * (N - 1)))).toBeLessThanOrEqual(1);
  });
});

describe("createPerlin", () => {
  const noise = createPerlin();

  it("is deterministic for a seed and varies across seeds", () => {
    const again = createPerlin();
    const other = createPerlin(12345);
    let differs = false;
    for (let i = 0; i < 20; i++) {
      const x = i * 0.37 + 0.11;
      expect(noise(x, x * 2, x * 3)).toBe(again(x, x * 2, x * 3));
      if (noise(x, x * 2, x * 3) !== other(x, x * 2, x * 3)) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("is 0 on the integer lattice and bounded in [-1, 1]", () => {
    for (const [x, y, z] of [
      [0, 0, 0],
      [1, 2, 3],
      [-4, 7, 250],
    ]) {
      expect(noise(x, y, z)).toBeCloseTo(0, 9);
    }
    for (let i = 0; i < 500; i++) {
      const v = noise(i * 0.173, i * 0.291 + 5, i * 0.107 - 3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it("is smooth: nearby samples are nearby values", () => {
    for (let i = 0; i < 100; i++) {
      const x = i * 0.31;
      expect(Math.abs(noise(x + 1e-3, 4.5, 7.7) - noise(x, 4.5, 7.7))).toBeLessThan(0.02);
    }
  });
});

describe("waterfall physics", () => {
  it("enters at river speed and hits the bottom at free-fall speed", () => {
    expect(waterfallVelocityMps(0)).toBeCloseTo(WATERFALL_ENTRY_MPS, 9);
    const vBottom = Math.sqrt(
      WATERFALL_ENTRY_MPS * WATERFALL_ENTRY_MPS + 2 * GRAVITY_MPS2 * WATERFALL_DROP_M,
    );
    expect(waterfallVelocityMps(1)).toBeCloseTo(vBottom, 9); // ≈ 7.75 m/s
    expect(waterfallVelocityMps(-1)).toBe(waterfallVelocityMps(0)); // clamped
    let prev = 0;
    for (let y = 0; y <= 1; y += 0.05) {
      const v = waterfallVelocityMps(y);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it("crosses the 10 ft drop in the real fall time (~0.74 s)", () => {
    // Numerically integrate dt = dy / v(y); analytically t = (v₁ − v₀)/g.
    const steps = 10000;
    let t = 0;
    for (let i = 0; i < steps; i++) {
      const y = (i + 0.5) / steps;
      t += WATERFALL_DROP_M / steps / waterfallVelocityMps(y);
    }
    const expected = (waterfallVelocityMps(1) - WATERFALL_ENTRY_MPS) / GRAVITY_MPS2;
    expect(t).toBeCloseTo(expected, 3);
    expect(t).toBeGreaterThan(0.6);
    expect(t).toBeLessThan(0.9);
  });
});

describe("converge", () => {
  it("starts at `from`, settles to `to`, and moves monotonically", () => {
    expect(converge(10, 2, 0, 1.5)).toBeCloseTo(10, 9);
    expect(converge(10, 2, 100, 1.5)).toBeCloseTo(2, 6);
    let prev = converge(10, 2, 0, 1.5);
    for (let age = 0.2; age <= 6; age += 0.2) {
      const v = converge(10, 2, age, 1.5);
      expect(v).toBeLessThan(prev);
      expect(v).toBeGreaterThan(2);
      prev = v;
    }
    // Converging upward works too.
    expect(converge(1, 5, 0.5, 0.5)).toBeGreaterThan(1);
    expect(converge(1, 5, 0.5, 0.5)).toBeLessThan(5);
  });
});

describe("fire life curves", () => {
  it("smokeMix01 holds flame early, is all smoke by 60% of life", () => {
    expect(smokeMix01(0)).toBe(0);
    expect(smokeMix01(0.25)).toBe(0);
    expect(smokeMix01(0.6)).toBe(1);
    expect(smokeMix01(1)).toBe(1);
    expect(smokeMix01(0.425)).toBeCloseTo(0.5, 6);
  });

  it("emberAlpha eases from 1 at birth to 0 exactly at end of life", () => {
    expect(emberAlpha(0)).toBe(1);
    expect(emberAlpha(1)).toBe(0);
    let prev = 1;
    for (let p = 0.1; p <= 1; p += 0.1) {
      const v = emberAlpha(p);
      expect(v).toBeLessThan(prev);
      prev = v;
    }
    // Gentle decay: still faintly visible near the top of the rise.
    expect(emberAlpha(0.9)).toBeGreaterThan(0.05);
  });
});

describe("patterns", () => {
  it("offers six looms with unique ids; ribbon, waterfall and fire ready", () => {
    expect(PATTERNS).toHaveLength(6);
    expect(new Set(PATTERNS.map((p) => p.id)).size).toBe(6);
    expect(PATTERNS.filter((p) => p.ready).map((p) => p.id)).toEqual([
      "ribbon",
      "waterfall",
      "fire",
    ]);
  });

  it("getPattern resolves ids and falls back to the ribbon", () => {
    expect(getPattern("snail").label).toBe("Snail Shell");
    expect(getPattern("nope" as never).id).toBe("ribbon");
  });
});
