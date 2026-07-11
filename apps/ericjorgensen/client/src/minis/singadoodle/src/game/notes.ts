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

export type VoiceId = "contralto" | "mezzo" | "soprano" | "tenor" | "baritone" | "bass";

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
    detail: "Med Female · A3–A5",
    lo: 57,
    hi: 81,
  },
  {
    id: "soprano",
    label: "Soprano",
    detail: "High Female · C4–C6",
    lo: 60,
    hi: 84,
  },
  { id: "tenor", label: "Tenor", detail: "High Male · C3–C5", lo: 48, hi: 72 },
  {
    id: "baritone",
    label: "Baritone",
    detail: "Med Male · A2–A4",
    lo: 45,
    hi: 69,
  },
  { id: "bass", label: "Bass", detail: "Low Male · E2–E4", lo: 40, hi: 64 },
];

export type LevelId = 0 | 1 | 2 | 3 | 4;
export interface Level {
  n: LevelId;
  title: string;
  detail: string;
}
export const LEVELS: Level[] = [
  { n: 0, title: "Training", detail: "5 notes · up & down · guided" },
  { n: 1, title: "Beginner", detail: "3-note tunes · octave from 25% up" },
  { n: 2, title: "Intermediate", detail: "5-note tunes · lower ¾ of range" },
  { n: 3, title: "Accomplished", detail: "7-note tunes · full range" },
  { n: 4, title: "Expert", detail: "8-note tunes · full range +2 · pitch hidden" },
];

export function getVoice(id: VoiceId): Voice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

/** The MIDI range for a given voice + level: the five-note training set at
 *  level 0, otherwise the tune level's note band. `set` is every note in it. */
export function noteSet(
  voiceId: VoiceId,
  level: LevelId,
): { lo: number; hi: number; set: number[] } {
  let lo: number, hi: number;
  if (level === 0) {
    // Training: just the five notes centred on the range's sweet spot.
    const v = getVoice(voiceId);
    const c = Math.round((v.lo + v.hi) / 2);
    lo = c - 2;
    hi = c + 2;
  } else {
    ({ lo, hi } = tuneBand(voiceId, level));
  }
  const set: number[] = [];
  for (let m = lo; m <= hi; m++) set.push(m);
  return { lo, hi, set };
}

/** Full session order: every note ascending, then descending, then shuffled.
 *  With `includeShuffle` false (the Training level) it's just up then down. */
export function buildSequence(set: number[], includeShuffle = true): number[] {
  const asc = set.slice();
  const desc = set.slice().reverse();
  if (!includeShuffle) return asc.concat(desc);
  const rand = set.slice();
  for (let i = rand.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rand[i], rand[j]] = [rand[j], rand[i]];
  }
  return asc.concat(desc, rand);
}

/** How many steps remain in the session, counting the one in play. `index` is
 *  the current item's position (note index in scale mode, tune index in tune
 *  mode) or null when nothing is active (session done); `total` is the count of
 *  items. First item → `total` left; last → 1 left; done → 0. */
export function stepsRemaining(total: number, index: number | null): number {
  if (index == null) return 0;
  return Math.max(0, total - index);
}

// ---- per-note cycle timing (seconds) ----
export const CYCLE = { REST: 2, PREVIEW: 2, PREP: 2, SCORE: 5 } as const;
export const CYCLE_TOTAL = CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP + CYCLE.SCORE; // 11

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

// ---- Tune levels (1–4): short made-up tunes, sung back from memory ----

// Scale-degree semitone offsets from the tonic.
export const MAJOR_STEPS: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
export const MINOR_STEPS: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

// Every tune level plays this many tunes; each is stretched to TUNE_SECONDS long
// (so note lengths shrink as the tune gets more notes, keeping the tune 5s).
export const TUNE_COUNT = 10;
export const TUNE_SECONDS = 5;

/** How many notes each tune has at a given tune level (1–4). */
export function notesPerTune(level: LevelId): number {
  return level === 1 ? 3 : level === 2 ? 5 : level === 3 ? 7 : 8;
}

/** The MIDI band a tune level draws its notes from. */
export function tuneBand(voiceId: VoiceId, level: LevelId): { lo: number; hi: number } {
  const v = getVoice(voiceId);
  const q = Math.round((v.hi - v.lo) * 0.25);
  if (level === 1) {
    const b = v.lo + q; // an octave starting 25% up from the bottom
    return { lo: b, hi: b + 12 };
  }
  if (level === 2) return { lo: v.lo, hi: v.hi - q }; // bottom up to 25% from the top
  if (level === 3) return { lo: v.lo, hi: v.hi }; // the full range
  return { lo: v.lo - 2, hi: v.hi + 2 }; // level 4: full range + 2 each end
}

// Note values, in beats (quarter / half / whole).
const QUARTER = 1;
const HALF = 2;
const WHOLE = 4;

export interface Tune {
  key: number; // tonic pitch class 0–11
  minor: boolean;
  notes: number[]; // MIDI notes (notesPerTune long)
  durations: number[]; // relative beats per note (scaled to seconds on layout)
}

/**
 * Make up a simple, singable tune for a tune level: pick a random key, draw
 * scale notes from the level's band, and walk them as a small arch (rise then
 * fall) that begins and ends on the same tonic, mostly by step. The home tonic
 * is chosen randomly within the band so tunes explore the whole range across a
 * session. `rng` is injectable for deterministic tests.
 */
export function buildTune(voiceId: VoiceId, level: LevelId, rng: () => number): Tune {
  const band = tuneBand(voiceId, level);
  const n = notesPerTune(level);
  const key = Math.min(11, Math.floor(rng() * 12));
  const minor = rng() < 0.5;
  const steps = minor ? MINOR_STEPS : MAJOR_STEPS;
  const inScale = (m: number) => steps.includes((((m - key) % 12) + 12) % 12);

  // Scale notes across the band, low→high; adjacent = a scale step.
  const pool: number[] = [];
  for (let m = band.lo; m <= band.hi; m++) if (inScale(m)) pool.push(m);
  const tonics: number[] = [];
  for (let i = 0; i < pool.length; i++)
    if ((((pool[i] - key) % 12) + 12) % 12 === 0) tonics.push(i);

  // A random home tonic so tunes land in different parts of the range.
  const home = tonics.length
    ? tonics[Math.min(tonics.length - 1, Math.floor(rng() * tonics.length))]
    : Math.floor(pool.length / 2);

  // Stay within a comfortable ambit (±3 scale steps) of home so the tune is
  // singable and the final return home is a small interval.
  const minI = Math.max(0, home - 3);
  const maxI = Math.min(pool.length - 1, home + 3);
  const idx: number[] = [home];
  let cur = home;
  for (let j = 1; j < n - 1; j++) {
    const rising = j < n / 2; // simple arch: up then back down
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

// Tune-level timeline (seconds): hear the tune played in rhythm, a short prep
// gap, then sing the same notes back at the same tempo — but with no guide tone.
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

/** Lay out TUNE_COUNT tunes back to back into a single playable timeline, each
 *  tune stretched to exactly TUNE_SECONDS regardless of its note count. */
export function buildTunePlan(voiceId: VoiceId, level: LevelId, rng: () => number): TunePlan {
  const notes: PlayNote[] = [];
  const tunes: Tune[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let cursor = 0; // start time of the current tune
  for (let t = 0; t < TUNE_COUNT; t++) {
    const tune = buildTune(voiceId, level, rng);
    tunes.push(tune);
    const totalBeats = tune.durations.reduce((a, b) => a + b, 0);
    const beatSec = TUNE_SECONDS / totalBeats; // stretch the tune to exactly 5s
    const dur = tune.durations.map((b) => b * beatSec); // seconds per note
    const listenBase = cursor + L4_LEAD;
    const singBase = listenBase + TUNE_SECONDS + L4_PREP;
    let lc = listenBase; // listen cursor
    let sc = singBase; // sing cursor
    for (let j = 0; j < tune.notes.length; j++) {
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
    cursor = singBase + TUNE_SECONDS + L4_TAIL; // next tune starts here
  }
  return { notes, lo, hi, endAt: cursor, tunes };
}

/** Offset (s) from a note's cycle start to when scoring begins. */
export const SCORE_OFFSET = CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP; // 6
