// notes.ts — note math, voice ranges, difficulty, session sequence, cycle timing.
// Scientific pitch notation: C4 = MIDI 60, A4 = MIDI 69 = 440 Hz.

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export function midiName(m: number): string {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
export function midiHz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}
export function hzMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}
export function isSharp(m: number): boolean {
  return NOTE_NAMES[((m % 12) + 12) % 12].includes("#");
}

export type VoiceId =
  | "contralto"
  | "mezzo"
  | "soprano"
  | "tenor"
  | "baritone"
  | "bass";

export interface Voice {
  id: VoiceId;
  label: string;
  detail: string; // e.g. "Low Female · F3–E5"
  lo: number; // MIDI
  hi: number; // MIDI
}

export const VOICES: Voice[] = [
  {
    id: "contralto",
    label: "Contralto",
    detail: "Low Female · F3–E5",
    lo: 53,
    hi: 76,
  },
  {
    id: "mezzo",
    label: "Mezzo-Soprano",
    detail: "Med Female · A3–F5",
    lo: 57,
    hi: 77,
  },
  {
    id: "soprano",
    label: "Soprano",
    detail: "High Female · C4–C6",
    lo: 60,
    hi: 84,
  },
  { id: "tenor", label: "Tenor", detail: "High Male · C3–E5", lo: 48, hi: 76 },
  {
    id: "baritone",
    label: "Baritone",
    detail: "Med Male · G2–E4",
    lo: 43,
    hi: 64,
  },
  { id: "bass", label: "Bass", detail: "Low Male · E2–E4", lo: 40, hi: 64 },
];

export interface Level {
  n: 1 | 2 | 3 | 4;
  title: string;
  detail: string;
}
export const LEVELS: Level[] = [
  { n: 1, title: "Beginner", detail: "One octave · sweet spot" },
  { n: 2, title: "Practiced", detail: "Full chosen range" },
  { n: 3, title: "Advanced", detail: "Range + 4 each end" },
  { n: 4, title: "From Memory", detail: "8 short tunes · no guide tone" },
];

export function getVoice(id: VoiceId): Voice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

/** The set of MIDI notes for a given voice + difficulty level. */
export function noteSet(
  voiceId: VoiceId,
  level: 1 | 2 | 3 | 4,
): { lo: number; hi: number; set: number[] } {
  const v = getVoice(voiceId);
  let lo: number, hi: number;
  if (level === 1) {
    const c = Math.round((v.lo + v.hi) / 2);
    lo = c - 6;
    hi = c + 6;
  } else if (level === 2) {
    lo = v.lo;
    hi = v.hi;
  } else if (level === 3) {
    lo = v.lo - 4;
    hi = v.hi + 4;
  } else {
    // Level 4 "From Memory" works in a comfortable band around the centre.
    const c = Math.round((v.lo + v.hi) / 2);
    lo = c - 7;
    hi = c + 7;
  }
  const set: number[] = [];
  for (let m = lo; m <= hi; m++) set.push(m);
  return { lo, hi, set };
}

/** Full session order: every note ascending, then descending, then shuffled. */
export function buildSequence(set: number[]): number[] {
  const asc = set.slice();
  const desc = set.slice().reverse();
  const rand = set.slice();
  for (let i = rand.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rand[i], rand[j]] = [rand[j], rand[i]];
  }
  return asc.concat(desc, rand);
}

// ---- per-note cycle timing (seconds) ----
export const CYCLE = { REST: 2, PREVIEW: 2, PREP: 2, SCORE: 5 } as const;
export const CYCLE_TOTAL =
  CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP + CYCLE.SCORE; // 11

export type Phase = "rest" | "preview" | "prep" | "score" | "done";

/** Phase of a note given seconds elapsed since that note's cycle start. */
export function phaseOf(elapsedInCycle: number): Phase {
  const r = elapsedInCycle;
  if (r < CYCLE.REST) return "rest";
  if (r < CYCLE.REST + CYCLE.PREVIEW) return "preview";
  if (r < CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP) return "prep";
  if (r < CYCLE_TOTAL) return "score";
  return "done";
}

// ---- Level 4: short made-up tunes (sung from memory, no guide tone) ----

// Scale-degree semitone offsets from the tonic.
export const MAJOR_STEPS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

// How many tunes per level-4 session, and how many notes per tune.
export const TUNE_COUNT = 8;
export const TUNE_NOTES = 5;

// Note values, in beats (quarter / half / whole).
const QUARTER = 1;
const HALF = 2;
const WHOLE = 4;

export interface Tune {
  key: number; // tonic pitch class 0–11
  minor: boolean;
  notes: number[]; // 8 MIDI notes
  durations: number[]; // beats per note (1 = quarter, 2 = half, 4 = whole)
}

/**
 * Make up a simple, well-structured 8-note tune for a voice: pick a random key,
 * draw scale notes from a comfortable band around the centre of the range, and
 * walk them as a small arch (rise then fall) that begins and ends on the tonic,
 * mostly by step with the odd third. `rng` is injectable for deterministic tests.
 */
export function buildTune(voiceId: VoiceId, rng: () => number): Tune {
  const v = getVoice(voiceId);
  const center = Math.round((v.lo + v.hi) / 2);
  const key = Math.min(11, Math.floor(rng() * 12));
  const minor = rng() < 0.5;
  const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
  const inScale = (m: number) => steps.includes((((m - key) % 12) + 12) % 12);

  // Scale notes in a comfortable band, low→high; adjacent = a scale step.
  const pool: number[] = [];
  for (let m = center - 7; m <= center + 7; m++) if (inScale(m)) pool.push(m);
  const tonics: number[] = [];
  for (let i = 0; i < pool.length; i++)
    if ((((pool[i] - key) % 12) + 12) % 12 === 0) tonics.push(i);

  const nearestCenter = () =>
    tonics.reduce(
      (best, i) =>
        Math.abs(pool[i] - center) < Math.abs(pool[best] - center) ? i : best,
      tonics[0],
    );

  // Stay within a comfortable ambit (±3 scale steps) of the home tonic so the
  // tune is singable and the final return home is a small interval.
  const home = nearestCenter();
  const minI = Math.max(0, home - 3);
  const maxI = Math.min(pool.length - 1, home + 3);
  const idx: number[] = [home];
  let cur = home;
  for (let j = 1; j < TUNE_NOTES - 1; j++) {
    const rising = j < TUNE_NOTES / 2; // simple arch: up then back down
    const mag = rng() < 0.7 ? 1 : 2; // mostly steps, the occasional third
    let dir = rising ? 1 : -1;
    if (rng() < 0.2) dir = -dir; // a little wander for interest
    let next = cur + dir * mag;
    if (next < minI || next > maxI) next = cur - dir * mag; // bounce off edges
    next = Math.max(minI, Math.min(maxI, next));
    idx.push(next);
    cur = next;
  }
  idx.push(home); // resolve home to the same tonic

  // Vary the rhythm: mostly quarters, some halves, the odd whole; finish long.
  const durations: number[] = [];
  for (let j = 0; j < idx.length; j++) {
    if (j === idx.length - 1) {
      durations.push(rng() < 0.55 ? HALF : WHOLE); // a longer note to land on
    } else {
      const r = rng();
      durations.push(r < 0.6 ? QUARTER : r < 0.9 ? HALF : WHOLE);
    }
  }

  return { key, minor, notes: idx.map((i) => pool[i]), durations };
}

// Level-4 timeline (seconds). Each tune: hear it played in rhythm, a short prep
// gap, then sing the same notes back at the SAME tempo and note lengths — but
// with no guide tone. The sing window for a note matches its listen tone.
const L4_BEAT = 0.55; // seconds per quarter note (listen and sing share this)
const L4_LEAD = 0.6; // silence before the listen melody starts
const L4_PREP = 1.5; // gap between hearing the tune and singing it
const L4_TAIL = 1.0; // gap after a tune before the next

/**
 * A note as the engine plays it. `scoreStart`/`scoreLen` is when it's sung and
 * scored; `toneStart`/`toneEnd` is when the supporting tone sounds (toneStart
 * < 0 means none). `cycle` is the scale-mode phase base (−1 in tune mode).
 */
export interface PlayNote {
  midi: number;
  cycle: number;
  scoreStart: number;
  scoreLen: number;
  toneStart: number;
  toneEnd: number;
  tune: number;
}

export interface TunePlan {
  notes: PlayNote[];
  lo: number;
  hi: number;
  endAt: number;
  tunes: Tune[];
}

/** Lay out TUNE_COUNT tunes back to back into a single playable timeline. */
export function buildTunePlan(voiceId: VoiceId, rng: () => number): TunePlan {
  const notes: PlayNote[] = [];
  const tunes: Tune[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let cursor = 0; // start time of the current tune
  for (let t = 0; t < TUNE_COUNT; t++) {
    const tune = buildTune(voiceId, rng);
    tunes.push(tune);
    const dur = tune.durations.map((b) => b * L4_BEAT); // seconds per note
    const total = dur.reduce((a, b) => a + b, 0);
    const listenBase = cursor + L4_LEAD;
    const singBase = listenBase + total + L4_PREP;
    let lc = listenBase; // listen cursor
    let sc = singBase; // sing cursor
    for (let j = 0; j < TUNE_NOTES; j++) {
      const midi = tune.notes[j];
      lo = Math.min(lo, midi);
      hi = Math.max(hi, midi);
      notes.push({
        midi,
        cycle: -1,
        scoreStart: sc,
        scoreLen: dur[j],
        toneStart: lc,
        toneEnd: lc + dur[j],
        tune: t,
      });
      lc += dur[j];
      sc += dur[j];
    }
    cursor = singBase + total + L4_TAIL; // next tune starts here
  }
  return { notes, lo, hi, endAt: cursor, tunes };
}

/** Offset (s) from a note's cycle start to when scoring begins. */
export const SCORE_OFFSET = CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP; // 6
