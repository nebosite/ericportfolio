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
  tuneBand,
  notesPerTune,
  stepsRemaining,
  MAJOR_STEPS,
  MINOR_STEPS,
  TUNE_COUNT,
  TUNE_SECONDS,
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
  it("training (level 0) is the five notes centered on the sweet spot", () => {
    const v = getVoice("contralto"); // 53–76
    const center = Math.round((v.lo + v.hi) / 2);
    const { lo, hi, set } = noteSet("contralto", 0);
    expect(lo).toBe(center - 2);
    expect(hi).toBe(center + 2);
    expect(set).toHaveLength(5);
  });

  it("levels 1–4 span the tune band for that level", () => {
    for (const level of [1, 2, 3, 4] as const) {
      const band = tuneBand("contralto", level);
      const { lo, hi, set } = noteSet("contralto", level);
      expect([lo, hi]).toEqual([band.lo, band.hi]);
      expect(set).toHaveLength(hi - lo + 1);
    }
  });
});

describe("tuneBand", () => {
  it("level 1 is an octave starting 25% up from the bottom", () => {
    const v = getVoice("contralto"); // 53–76
    const q = Math.round((v.hi - v.lo) * 0.25);
    expect(tuneBand("contralto", 1)).toEqual({ lo: v.lo + q, hi: v.lo + q + 12 });
  });

  it("level 2 runs from the bottom up to 25% below the top", () => {
    const v = getVoice("soprano"); // 60–84
    const q = Math.round((v.hi - v.lo) * 0.25);
    expect(tuneBand("soprano", 2)).toEqual({ lo: v.lo, hi: v.hi - q });
  });

  it("level 3 is the full range", () => {
    const v = getVoice("tenor");
    expect(tuneBand("tenor", 3)).toEqual({ lo: v.lo, hi: v.hi });
  });

  it("level 4 is the full range plus two semitones each end", () => {
    const v = getVoice("bass");
    expect(tuneBand("bass", 4)).toEqual({ lo: v.lo - 2, hi: v.hi + 2 });
  });

  it("notes per tune grow with level (3/5/7/8)", () => {
    expect([notesPerTune(1), notesPerTune(2), notesPerTune(3), notesPerTune(4)]).toEqual([
      3, 5, 7, 8,
    ]);
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

  it("without the shuffle pass (Training) it is just up then down", () => {
    const set = [60, 61, 62, 63, 64];
    const seq = buildSequence(set, false);
    expect(seq).toEqual([60, 61, 62, 63, 64, 64, 63, 62, 61, 60]);
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

describe("stepsRemaining", () => {
  it("counts the item in play: first → total, last → 1, done → 0", () => {
    expect(stepsRemaining(39, 0)).toBe(39); // first of 39
    expect(stepsRemaining(39, 38)).toBe(1); // last of 39
    expect(stepsRemaining(39, null)).toBe(0); // session finished
  });

  it("mirrors a full scale sequence as it advances", () => {
    const total = buildSequence([60, 61, 62, 63]).length; // 12
    expect(stepsRemaining(total, 0)).toBe(12);
    expect(stepsRemaining(total, 11)).toBe(1);
  });

  it("works for tune counts and never goes negative", () => {
    expect(stepsRemaining(TUNE_COUNT, 0)).toBe(TUNE_COUNT);
    expect(stepsRemaining(TUNE_COUNT, TUNE_COUNT - 1)).toBe(1);
    expect(stepsRemaining(5, 9)).toBe(0); // index past the end clamps to 0
  });
});

describe("buildTune", () => {
  it("makes an in-key, in-band tune that begins and ends on the tonic", () => {
    for (const level of [1, 2, 3, 4] as const) {
      const band = tuneBand("tenor", level);
      const n = notesPerTune(level);
      for (let seed = 1; seed <= 20; seed++) {
        const t = buildTune("tenor", level, rngFrom(seed));
        const scale = t.minor ? MINOR_STEPS : MAJOR_STEPS;
        expect(t.notes).toHaveLength(n);
        expect(t.durations).toHaveLength(n);
        // every note value is a quarter, half, or whole; the tune ends long
        for (const d of t.durations) expect([1, 2, 4]).toContain(d);
        expect([2, 4]).toContain(t.durations[n - 1]);
        // first and last are the tonic
        expect(pc(t.notes[0] - t.key)).toBe(0);
        expect(pc(t.notes[n - 1] - t.key)).toBe(0);
        for (let i = 0; i < t.notes.length; i++) {
          const m = t.notes[i];
          // every note is in the chosen key and within the level's band
          expect(scale.includes(pc(m - t.key))).toBe(true);
          expect(m).toBeGreaterThanOrEqual(band.lo);
          expect(m).toBeLessThanOrEqual(band.hi);
          // no wild leaps — stepwise tune, at most about a fifth
          if (i > 0) expect(Math.abs(m - t.notes[i - 1])).toBeLessThanOrEqual(7);
        }
      }
    }
  });

  it("is deterministic for a given rng seed", () => {
    expect(buildTune("bass", 3, rngFrom(7)).notes).toEqual(buildTune("bass", 3, rngFrom(7)).notes);
  });
});

describe("buildTunePlan", () => {
  it("lays out TUNE_COUNT 5-second tunes on a monotonic, tone-before-sing timeline", () => {
    for (const level of [1, 2, 3, 4] as const) {
      const n = notesPerTune(level);
      const plan = buildTunePlan("mezzo", level, rngFrom(3));
      expect(plan.tunes).toHaveLength(TUNE_COUNT);
      expect(plan.notes).toHaveLength(TUNE_COUNT * n);

      // every tune's listen and sing spans are exactly TUNE_SECONDS long
      for (let t = 0; t < TUNE_COUNT; t++) {
        const tn = plan.notes.filter((x) => x.tune === t);
        const last = tn[tn.length - 1];
        expect(last.toneEnd - tn[0].toneStart).toBeCloseTo(TUNE_SECONDS, 5);
        expect(last.scoreStart + last.scoreLen - tn[0].scoreStart).toBeCloseTo(TUNE_SECONDS, 5);
      }

      let lastScore = -Infinity;
      let realLo = Infinity;
      let realHi = -Infinity;
      plan.notes.forEach((x, k) => {
        expect(x.tune).toBe(Math.floor(k / n));
        expect(x.scoreLen).toBeGreaterThan(0);
        // the sing window matches the length of the note as it was heard
        expect(x.toneEnd - x.toneStart).toBeCloseTo(x.scoreLen, 6);
        // the guide tone sounds during "listen", before the sing window
        expect(x.toneStart).toBeGreaterThanOrEqual(0);
        expect(x.toneEnd).toBeLessThan(x.scoreStart);
        // sing windows advance monotonically and never overlap (allow fp slop)
        expect(x.scoreStart).toBeGreaterThanOrEqual(lastScore - 1e-6);
        lastScore = x.scoreStart + x.scoreLen;
        realLo = Math.min(realLo, x.midi);
        realHi = Math.max(realHi, x.midi);
      });
      expect(plan.lo).toBe(realLo);
      expect(plan.hi).toBe(realHi);
      expect(plan.endAt).toBeGreaterThan(lastScore);
    }
  });
});
