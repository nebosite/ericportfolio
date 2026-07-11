import { describe, it, expect } from "vitest";
import {
  RANGE_LO,
  RANGE_HI,
  BIN_COUNT,
  MIN_RUN_SEC,
  HOLD_FULL_SEC,
  SUGGEST_MIN_SEC,
  GAP_DEG,
  angleFor,
  petalArc,
  hueFor,
  petalRadius01,
  SustainTracker,
  flowerStats,
  explorePrompt,
  suggestVoice,
  qualifyThreshold,
  confidentRange,
  buildRangeResult,
  spanText,
  QUALIFY_SEC,
  QUALIFY_HIGH_SEC,
} from "./rangeFlower";

/** A contiguous run of qualifying petals [lo..hi] held `sec` seconds each. */
function cluster(lo: number, hi: number, sec = 2): Float32Array {
  const bins = new Float32Array(BIN_COUNT);
  for (let m = lo; m <= hi; m++) bins[m - RANGE_LO] = sec;
  return bins;
}

const FRAME = 1 / 60;

/** Feed the tracker a steady pitch for `sec` seconds at 60fps, starting at t0. */
function hold(tr: SustainTracker, midi: number, sec: number, t0 = 0): number {
  let t = t0;
  for (let i = 0; i <= Math.round(sec * 60); i++) {
    tr.push(t, midi);
    t += FRAME;
  }
  return t;
}

describe("polar mapping", () => {
  it("sweeps clockwise from bottom-left to bottom-right, leaving the gap", () => {
    const start = ((90 + GAP_DEG / 2) * Math.PI) / 180;
    const end = ((90 + GAP_DEG / 2 + 360 - GAP_DEG) * Math.PI) / 180;
    expect(angleFor(RANGE_LO)).toBeCloseTo(start, 8);
    expect(angleFor(RANGE_HI)).toBeCloseTo(end, 8);
    expect(angleFor(60)).toBeGreaterThan(angleFor(59)); // monotonic
  });

  it("spans one petal arc per semitone", () => {
    expect(angleFor(61) - angleFor(60)).toBeCloseTo(petalArc(), 8);
  });

  it("colors low red through violet high", () => {
    expect(hueFor(RANGE_LO)).toBe(0);
    expect(hueFor(RANGE_HI)).toBe(280);
    expect(hueFor(RANGE_LO - 5)).toBe(0); // clamped
    expect(hueFor(RANGE_HI + 5)).toBe(280);
  });
});

describe("petalRadius01", () => {
  it("grows from 0, caps at 1, monotonic", () => {
    expect(petalRadius01(0)).toBe(0);
    expect(petalRadius01(HOLD_FULL_SEC)).toBe(1);
    expect(petalRadius01(HOLD_FULL_SEC * 3)).toBe(1);
    expect(petalRadius01(1)).toBeGreaterThan(petalRadius01(0.5));
    // sqrt: early growth is fast
    expect(petalRadius01(HOLD_FULL_SEC / 4)).toBeCloseTo(0.5, 6);
  });
});

describe("SustainTracker", () => {
  it("credits a steady hold to its semitone bin, minus the run lead-in", () => {
    const tr = new SustainTracker();
    hold(tr, 69, 2);
    const credited = tr.heldFor(69);
    expect(credited).toBeGreaterThan(2 - MIN_RUN_SEC - 0.1);
    expect(credited).toBeLessThanOrEqual(2.05);
  });

  it("tolerates wobble within the run band", () => {
    const tr = new SustainTracker();
    let t = 0;
    for (let i = 0; i < 120; i++) {
      tr.push(t, 69 + Math.sin(i / 3) * 0.2); // ±20¢ wobble
      t += FRAME;
    }
    expect(tr.heldFor(69)).toBeGreaterThan(1.4);
  });

  it("does not credit constant pitch-jumping", () => {
    const tr = new SustainTracker();
    let t = 0;
    for (let i = 0; i < 240; i++) {
      tr.push(t, i % 2 ? 60 : 67);
      t += FRAME;
    }
    expect(tr.heldFor(60)).toBe(0);
    expect(tr.heldFor(67)).toBe(0);
  });

  it("ignores blips shorter than the minimum run", () => {
    const tr = new SustainTracker();
    hold(tr, 72, MIN_RUN_SEC * 0.6);
    expect(tr.heldFor(72)).toBe(0);
  });

  it("keeps separate holds in separate bins across silence", () => {
    const tr = new SustainTracker();
    let t = hold(tr, 50, 1.5);
    tr.push(t, null); // silence resets the run
    t = hold(tr, 62, 1.5, t + 0.5);
    expect(tr.heldFor(50)).toBeGreaterThan(1);
    expect(tr.heldFor(62)).toBeGreaterThan(1);
  });

  it("ignores pitches outside the flower's span and clock jumps", () => {
    const tr = new SustainTracker();
    hold(tr, RANGE_LO - 3, 2);
    expect(Array.from(tr.bins).every((v) => v === 0)).toBe(true);
    // A big gap between samples (tab-away) must not credit a huge dt.
    tr.push(0, 60);
    tr.push(FRAME, 60);
    tr.push(10, 60); // 10s jump
    expect(tr.heldFor(60)).toBe(0);
  });
});

describe("flowerStats / prompts", () => {
  it("summarizes petals, total, and the sustained extremes", () => {
    const bins = new Float32Array(BIN_COUNT);
    bins[45 - RANGE_LO] = 2; // sustained
    bins[52 - RANGE_LO] = 0.4; // grown but not sustained
    bins[69 - RANGE_LO] = SUGGEST_MIN_SEC; // exactly at the bar
    const s = flowerStats(bins);
    expect(s.petals).toBe(3);
    expect(s.heldSec).toBeCloseTo(3.4, 5);
    expect(s.loMidi).toBe(45);
    expect(s.hiMidi).toBe(69);
  });

  it("prompts to start, then to hold, then rotates low/high/fill", () => {
    const empty = flowerStats(new Float32Array(BIN_COUNT));
    expect(explorePrompt(empty, 0)).toMatch(/Sing any comfortable note/);
    const bins = new Float32Array(BIN_COUNT);
    bins[60 - RANGE_LO] = 1;
    expect(explorePrompt(flowerStats(bins), 5)).toMatch(/Hold it/);
    bins[60 - RANGE_LO] = 6;
    const going = flowerStats(bins);
    expect(explorePrompt(going, 0)).toMatch(/low/);
    expect(explorePrompt(going, 14)).toMatch(/high/);
    expect(explorePrompt(going, 28)).toMatch(/Fill in/);
  });
});

describe("suggestVoice", () => {
  it("matches classic ranges to their voice", () => {
    expect(suggestVoice(40, 64).id).toBe("bass");
    expect(suggestVoice(45, 69).id).toBe("baritone");
    expect(suggestVoice(48, 72).id).toBe("tenor");
    expect(suggestVoice(53, 76).id).toBe("contralto");
    expect(suggestVoice(57, 81).id).toBe("mezzo");
    expect(suggestVoice(60, 84).id).toBe("soprano");
  });

  it("classifies a narrow explored range by where it sits", () => {
    expect(suggestVoice(43, 60).id).toBe("bass"); // low, short span
    expect(suggestVoice(67, 80).id).toBe("soprano"); // high, short span
  });
});

describe("qualifyThreshold", () => {
  it("demands a much longer hold above C6", () => {
    expect(qualifyThreshold(69)).toBe(QUALIFY_SEC);
    expect(qualifyThreshold(84)).toBe(QUALIFY_SEC); // C6 itself is fine
    expect(qualifyThreshold(85)).toBe(QUALIFY_HIGH_SEC);
    expect(qualifyThreshold(86)).toBe(QUALIFY_HIGH_SEC);
    expect(QUALIFY_HIGH_SEC).toBeGreaterThan(QUALIFY_SEC);
  });
});

describe("confidentRange / buildRangeResult", () => {
  it("is null until enough strongly-held petals are corroborated", () => {
    expect(confidentRange(new Float32Array(BIN_COUNT))).toBeNull();
    const two = cluster(60, 61);
    expect(confidentRange(two)).toBeNull(); // only 2 qualifying petals
    const three = cluster(60, 62);
    expect(confidentRange(three)).toEqual({ lo: 60, hi: 62 });
  });

  it("ignores brief holds that never reach the strong-sustain bar", () => {
    const bins = cluster(55, 60); // a solid run
    bins[45 - RANGE_LO] = QUALIFY_SEC - 0.3; // a weak low scrape, below the bar
    const r = buildRangeResult(bins)!;
    expect(r.loMidi).toBe(55); // the scrape doesn't lower the range
    expect(r.hiMidi).toBe(60);
  });

  it("drops an isolated high note as a likely harmonic", () => {
    const bins = cluster(45, 50); // real singing down low
    bins[86 - RANGE_LO] = QUALIFY_HIGH_SEC + 0.5; // a lone D6 far above — no support
    expect(buildRangeResult(bins)!.hiMidi).toBe(50);
  });

  it("keeps a high note when it is strongly held AND corroborated nearby", () => {
    const bins = cluster(82, 86, QUALIFY_HIGH_SEC + 0.2); // a run up to D6, all strong
    const r = buildRangeResult(bins)!;
    expect(r.hiMidi).toBe(86);
    expect(r.hiName).toBe("D6");
  });

  it("excludes a high note held too briefly for the stricter bar", () => {
    const bins = cluster(60, 64);
    bins[85 - RANGE_LO] = QUALIFY_SEC + 0.2; // strong enough below C6, but 85 needs more
    expect(buildRangeResult(bins)!.hiMidi).toBe(64);
  });

  it("reports the best-matching female and male voice for the span", () => {
    const r = buildRangeResult(cluster(45, 69))!;
    expect(FEMALE_IDS).toContain(r.female.id);
    expect(MALE_IDS).toContain(r.male.id);
    expect(r.male.id).toBe("baritone"); // A2–A4 is squarely baritone
    expect(r.female.id).toBe("contralto"); // nearest female
    expect(r.voice.id).toBe("baritone");
  });
});

const FEMALE_IDS = ["soprano", "mezzo", "contralto"];
const MALE_IDS = ["tenor", "baritone", "bass"];

describe("spanText", () => {
  it("names spans in octaves and intervals", () => {
    expect(spanText(45, 69)).toBe("2 octaves");
    expect(spanText(45, 57)).toBe("an octave");
    expect(spanText(45, 61)).toBe("an octave and a 3rd");
    expect(spanText(45, 52)).toBe("a 5th");
    expect(spanText(45, 46)).toBe("a 2nd");
  });
});
