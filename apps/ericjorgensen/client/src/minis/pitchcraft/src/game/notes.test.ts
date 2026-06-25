import { describe, it, expect } from "vitest";
import {
  midiName,
  midiHz,
  hzMidi,
  isSharp,
  getVoice,
  noteSet,
  buildSequence,
  phaseOf,
  CYCLE,
  CYCLE_TOTAL,
  SCORE_OFFSET,
  buildTune,
  buildTunePlan,
  MAJOR_STEPS,
  MINOR_STEPS,
  TUNE_COUNT,
  TUNE_NOTES,
} from "./notes";

// Deterministic PRNG (mulberry32) so the generative tests are repeatable.
function rngFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pc = (m: number) => ((m % 12) + 12) % 12;

describe("note math", () => {
  it("names MIDI notes in scientific pitch notation", () => {
    expect(midiName(60)).toBe("C4");
    expect(midiName(69)).toBe("A4");
    expect(midiName(61)).toBe("C#4");
    expect(midiName(48)).toBe("C3");
  });

  it("maps MIDI to Hz and back (A4 = 440)", () => {
    expect(midiHz(69)).toBeCloseTo(440, 5);
    expect(midiHz(60)).toBeCloseTo(261.6256, 3);
    expect(hzMidi(440)).toBeCloseTo(69, 6);
    expect(hzMidi(midiHz(64))).toBeCloseTo(64, 6);
  });

  it("flags the sharps", () => {
    expect(isSharp(61)).toBe(true); // C#
    expect(isSharp(60)).toBe(false); // C
    expect(isSharp(66)).toBe(true); // F#
  });
});

describe("noteSet", () => {
  it("level 1 is one octave centered on the range's sweet spot", () => {
    const v = getVoice("contralto"); // 53–76
    const center = Math.round((v.lo + v.hi) / 2);
    const { lo, hi, set } = noteSet("contralto", 1);
    expect(lo).toBe(center - 6);
    expect(hi).toBe(center + 6);
    expect(set).toHaveLength(13); // inclusive octave
  });

  it("level 2 is the full chosen range", () => {
    const { lo, hi } = noteSet("soprano", 2);
    expect([lo, hi]).toEqual([60, 84]);
  });

  it("level 3 extends four semitones each end", () => {
    const { lo, hi } = noteSet("tenor", 3); // 48–76
    expect([lo, hi]).toEqual([44, 80]);
  });
});

describe("buildSequence", () => {
  it("plays every note three times: ascending, descending, then a shuffle", () => {
    const set = [60, 61, 62, 63];
    const seq = buildSequence(set);
    expect(seq).toHaveLength(set.length * 3);
    expect(seq.slice(0, 4)).toEqual([60, 61, 62, 63]); // ascending
    expect(seq.slice(4, 8)).toEqual([63, 62, 61, 60]); // descending
    // the final pass is a permutation of the set
    expect([...seq.slice(8)].sort((a, b) => a - b)).toEqual(set);
  });
});

describe("cycle timing", () => {
  it("the 11s cycle splits rest/preview/prep/sing and only sings last", () => {
    expect(CYCLE_TOTAL).toBe(11);
    expect(SCORE_OFFSET).toBe(CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP);
    expect(phaseOf(0)).toBe("rest");
    expect(phaseOf(2)).toBe("preview");
    expect(phaseOf(4)).toBe("prep");
    expect(phaseOf(6)).toBe("score");
    expect(phaseOf(10.9)).toBe("score");
    expect(phaseOf(11)).toBe("done");
  });
});

describe("noteSet level 4", () => {
  it("is a comfortable band centred on the range (±7 semitones)", () => {
    const v = getVoice("soprano");
    const center = Math.round((v.lo + v.hi) / 2);
    const { lo, hi, set } = noteSet("soprano", 4);
    expect([lo, hi]).toEqual([center - 7, center + 7]);
    expect(set).toHaveLength(15);
  });
});

describe("buildTune", () => {
  it("makes an in-key, in-range tune that begins and ends on the tonic", () => {
    const v = getVoice("tenor");
    const center = Math.round((v.lo + v.hi) / 2);
    const last = TUNE_NOTES - 1;
    for (let seed = 1; seed <= 25; seed++) {
      const t = buildTune("tenor", rngFrom(seed));
      const scale = t.minor ? MINOR_STEPS : MAJOR_STEPS;
      expect(t.notes).toHaveLength(TUNE_NOTES);
      expect(t.durations).toHaveLength(TUNE_NOTES);
      // every note value is a quarter, half, or whole; the tune ends long
      for (const d of t.durations) expect([1, 2, 4]).toContain(d);
      expect([2, 4]).toContain(t.durations[last]);
      expect(t.key).toBeGreaterThanOrEqual(0);
      expect(t.key).toBeLessThanOrEqual(11);
      // first and last are the tonic
      expect(pc(t.notes[0] - t.key)).toBe(0);
      expect(pc(t.notes[last] - t.key)).toBe(0);
      for (let i = 0; i < t.notes.length; i++) {
        const m = t.notes[i];
        // every note is in the chosen key and within the comfortable band
        expect(scale.includes(pc(m - t.key))).toBe(true);
        expect(m).toBeGreaterThanOrEqual(center - 7);
        expect(m).toBeLessThanOrEqual(center + 7);
        // no wild leaps — stepwise tune, at most about a fifth
        if (i > 0) expect(Math.abs(m - t.notes[i - 1])).toBeLessThanOrEqual(7);
      }
    }
  });

  it("is deterministic for a given rng seed", () => {
    expect(buildTune("bass", rngFrom(7)).notes).toEqual(
      buildTune("bass", rngFrom(7)).notes,
    );
  });
});

describe("buildTunePlan", () => {
  it("lays out 8 tunes of 8 notes on a monotonic, tone-before-sing timeline", () => {
    const plan = buildTunePlan("mezzo", rngFrom(3));
    expect(plan.tunes).toHaveLength(TUNE_COUNT);
    expect(plan.notes).toHaveLength(TUNE_COUNT * TUNE_NOTES);

    let lastScore = -Infinity;
    let realLo = Infinity;
    let realHi = -Infinity;
    plan.notes.forEach((n, k) => {
      expect(n.tune).toBe(Math.floor(k / TUNE_NOTES));
      expect(n.scoreLen).toBeGreaterThan(0);
      // the sing window matches the length of the note as it was heard
      expect(n.toneEnd - n.toneStart).toBeCloseTo(n.scoreLen, 6);
      // the guide tone sounds during the "listen" phase, before the sing window
      expect(n.toneStart).toBeGreaterThanOrEqual(0);
      expect(n.toneEnd).toBeLessThan(n.scoreStart);
      // sing windows advance monotonically and never overlap (allow fp slop)
      expect(n.scoreStart).toBeGreaterThanOrEqual(lastScore - 1e-6);
      lastScore = n.scoreStart + n.scoreLen;
      realLo = Math.min(realLo, n.midi);
      realHi = Math.max(realHi, n.midi);
    });
    expect(plan.lo).toBe(realLo);
    expect(plan.hi).toBe(realHi);
    expect(plan.endAt).toBeGreaterThan(lastScore);
  });
});
