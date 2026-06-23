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
  n: 1 | 2 | 3;
  title: string;
  detail: string;
}
export const LEVELS: Level[] = [
  { n: 1, title: "Beginner", detail: "One octave · sweet spot" },
  { n: 2, title: "Practiced", detail: "Full chosen range" },
  { n: 3, title: "Advanced", detail: "Range + 4 each end" },
];

export function getVoice(id: VoiceId): Voice {
  return VOICES.find((v) => v.id === id) ?? VOICES[0];
}

/** The set of MIDI notes for a given voice + difficulty level. */
export function noteSet(
  voiceId: VoiceId,
  level: 1 | 2 | 3,
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
  } else {
    lo = v.lo - 4;
    hi = v.hi + 4;
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

/** Offset (s) from a note's cycle start to when scoring begins. */
export const SCORE_OFFSET = CYCLE.REST + CYCLE.PREVIEW + CYCLE.PREP; // 6
