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
} from "./notes";

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
