// rangeFlower.ts — pure logic for the Range Explorer game (framework-free).
//
// The player free-sings while a polar "flower" plot grows: each semitone is a
// petal whose angle and rainbow hue encode the pitch, and whose radius is how
// long the player has *sustained* that pitch. When they finish, the sustained
// petals at the extremes give the singable range, which is matched to the
// closest named voice (Bass … Soprano).

import { VOICES, VoiceId, Voice, midiName } from "./notes";

// The flower's pitch span: D2–D6 comfortably covers every voice range
// (Bass E2 → Soprano C6) inside the detector's 70–1250 Hz clamp.
export const RANGE_LO = 38; // D2
export const RANGE_HI = 86; // D6
export const BIN_COUNT = RANGE_HI - RANGE_LO + 1; // one petal per semitone

// Sustain rules: a "run" is consecutive frames staying near one pitch. Runs
// only start crediting after MIN_RUN_SEC so slides and blips don't grow petals.
export const RUN_CENTS = 60; // stay within ±60¢ of the run center
export const MIN_RUN_SEC = 0.35; // a run credits only after this long
export const HOLD_FULL_SEC = 6; // a petal reaches full radius at this many held seconds

// Range suggestion: a petal counts toward the range once held this long, and we
// only volunteer a range/voice once there are enough qualifying petals.
export const SUGGEST_MIN_SEC = 1.0; // "sustained" for the live extremes / flower reading
export const SUGGEST_MIN_BINS = 3;

// Calling the final range demands a *strong* sustain (longer than the live
// "sustained" bar) so a passing note or glitch can't set an extreme.
export const QUALIFY_SEC = 1.6;

// Above C6 (MIDI 84) a detected pitch is more likely a harmonic (an octave-up
// misread) than a real note, so demand a much longer, steadier hold there.
export const SUSPECT_MIDI = 84; // C6
export const QUALIFY_HIGH_SEC = 3.0;

// An extreme (the lowest/highest qualifying note) is only trusted if there's a
// nearby note that was also sung — a lone petal far from everything else reads
// as a glitch/harmonic and is dropped. "Nearby" = within a fifth; "sung" = held
// at least a moment.
export const SUPPORT_SEMITONES = 5;
export const SUPPORT_MIN_SEC = 0.4;

/** How long a note must be held to count toward the final range — stricter above
 *  C6 where octave-harmonic misreads are likely. */
export function qualifyThreshold(midi: number): number {
  return midi > SUSPECT_MIDI ? QUALIFY_HIGH_SEC : QUALIFY_SEC;
}

// ---- polar mapping ----

// Leave a gap at the bottom of the circle so the lowest and highest notes don't
// touch: lows start bottom-left and sweep clockwise over the top to bottom-right.
export const GAP_DEG = 40;

/** Canvas-convention angle (radians, y-down, clockwise-positive) for a pitch. */
export function angleFor(midi: number): number {
  const t = (midi - RANGE_LO) / (RANGE_HI - RANGE_LO);
  const start = 90 + GAP_DEG / 2;
  const sweep = 360 - GAP_DEG;
  return ((start + t * sweep) * Math.PI) / 180;
}

/** Angular width of one semitone petal (radians). */
export function petalArc(): number {
  return (((360 - GAP_DEG) / (RANGE_HI - RANGE_LO)) * Math.PI) / 180;
}

/** Rainbow hue for a pitch: red at the bottom of the range → violet at the top. */
export function hueFor(midi: number): number {
  const t = Math.min(1, Math.max(0, (midi - RANGE_LO) / (RANGE_HI - RANGE_LO)));
  return Math.round(t * 280);
}

export function colorFor(midi: number, alpha = 1, light = 60): string {
  return `hsla(${hueFor(midi)}, 85%, ${light}%, ${alpha})`;
}

/** Petal radius fraction (0..1) for held seconds — sqrt so early growth is
 *  visible and a long hold approaches (and caps at) the rim. */
export function petalRadius01(sec: number): number {
  return Math.sqrt(Math.min(sec, HOLD_FULL_SEC) / HOLD_FULL_SEC);
}

// ---- sustain tracking ----

/**
 * Accumulates *sustained* singing time into per-semitone bins. Feed it one
 * (time, fractional-MIDI-or-null) sample per frame; time in seconds. A sample
 * extends the current run while it stays within RUN_CENTS of the run's center
 * (which drifts slightly so a slow settle stays one run); a jump, silence, or
 * out-of-range pitch starts over. Runs credit their bin only after MIN_RUN_SEC.
 */
export class SustainTracker {
  readonly bins = new Float32Array(BIN_COUNT); // held seconds per semitone
  private runCenter: number | null = null;
  private runStart = 0;
  private lastT = 0;

  push(t: number, midi: number | null): void {
    if (midi == null || midi < RANGE_LO - 0.5 || midi > RANGE_HI + 0.5) {
      this.runCenter = null;
      return;
    }
    if (this.runCenter == null || Math.abs(midi - this.runCenter) * 100 > RUN_CENTS) {
      this.runCenter = midi;
      this.runStart = t;
      this.lastT = t;
      return;
    }
    this.runCenter += (midi - this.runCenter) * 0.08;
    const dt = t - this.lastT;
    this.lastT = t;
    if (dt <= 0 || dt > 0.5) return; // clock jump / tab-away — don't credit
    if (t - this.runStart < MIN_RUN_SEC) return;
    const bin = Math.round(this.runCenter) - RANGE_LO;
    if (bin >= 0 && bin < BIN_COUNT) this.bins[bin] += dt;
  }

  /** Seconds held for a given MIDI note (0 if outside the flower's span). */
  heldFor(midi: number): number {
    const bin = midi - RANGE_LO;
    return bin >= 0 && bin < BIN_COUNT ? this.bins[bin] : 0;
  }
}

// ---- reading the flower ----

export interface FlowerStats {
  petals: number; // bins with any credited hold
  heldSec: number; // total credited seconds
  loMidi: number | null; // lowest / highest *sustained* petal (≥ SUGGEST_MIN_SEC)
  hiMidi: number | null;
}

export function flowerStats(bins: Float32Array): FlowerStats {
  let petals = 0;
  let heldSec = 0;
  let lo: number | null = null;
  let hi: number | null = null;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] <= 0) continue;
    petals++;
    heldSec += bins[i];
    if (bins[i] >= SUGGEST_MIN_SEC) {
      const m = RANGE_LO + i;
      if (lo == null) lo = m;
      hi = m;
    }
  }
  return { petals, heldSec, loMidi: lo, hiMidi: hi };
}

// ---- coaching prompts ----

/** What to tell the player next, from what they've grown so far. Rotates the
 *  low / high / fill-in encouragements every ~14s once they're going. */
export function explorePrompt(stats: FlowerStats, elapsed: number): string {
  if (stats.petals === 0) return "Sing any comfortable note — a clear “ahh” — and hold it steady.";
  if (stats.heldSec < 4) return "Hold it… watch the petal grow. Then try a different note.";
  const k = Math.floor(elapsed / 14) % 3;
  if (k === 0) return "Slide down low. Find your lowest strong note and hold it.";
  if (k === 1) return "Now sweep up high — hold the highest note that still feels easy.";
  return "Fill in the flower — grow the short petals between your extremes.";
}

// ---- range suggestion ----

// The classic voices split by gender, for the "best female / best male" match.
export const FEMALE_VOICES: VoiceId[] = ["soprano", "mezzo", "contralto"];
export const MALE_VOICES: VoiceId[] = ["tenor", "baritone", "bass"];

export interface RangeResult {
  loMidi: number;
  hiMidi: number;
  loName: string;
  hiName: string;
  voice: Voice; // overall best match
  female: Voice; // best-matching female voice
  male: Voice; // best-matching male voice
  heldSec: number;
  petals: number;
}

/** Closeness of a voice to a lo–hi span: mostly by range center, with a small
 *  pull toward matching endpoints. Lower is better. */
function voiceScore(v: Voice, loMidi: number, hiMidi: number): number {
  const c = (loMidi + hiMidi) / 2;
  const vc = (v.lo + v.hi) / 2;
  return Math.abs(c - vc) + 0.25 * ((Math.abs(loMidi - v.lo) + Math.abs(hiMidi - v.hi)) / 2);
}

/** The voice from `pool` (default: all) whose range sits closest to lo–hi. */
export function suggestVoice(
  loMidi: number,
  hiMidi: number,
  pool: readonly Voice[] = VOICES,
): Voice {
  let best = pool[0];
  let bestScore = Infinity;
  for (const v of pool) {
    const score = voiceScore(v, loMidi, hiMidi);
    if (score < bestScore) {
      bestScore = score;
      best = v;
    }
  }
  return best;
}

function voicesFor(ids: VoiceId[]): Voice[] {
  return ids.map((id) => VOICES.find((v) => v.id === id)!);
}

/**
 * The lowest and highest notes we trust as the range, or null if there isn't
 * enough strong, corroborated singing. Only notes held long enough count
 * (`qualifyThreshold`, stricter above C6), and an isolated extreme with no other
 * sung note within a fifth is dropped as a likely harmonic/glitch.
 */
export function confidentRange(bins: Float32Array): { lo: number; hi: number } | null {
  const qualifying: number[] = [];
  for (let i = 0; i < bins.length; i++) {
    const midi = RANGE_LO + i;
    if (bins[i] >= qualifyThreshold(midi)) qualifying.push(midi);
  }
  const supported = (m: number): boolean => {
    for (let d = 1; d <= SUPPORT_SEMITONES; d++) {
      const loN = m - d - RANGE_LO;
      const hiN = m + d - RANGE_LO;
      if (loN >= 0 && bins[loN] >= SUPPORT_MIN_SEC) return true;
      if (hiN < bins.length && bins[hiN] >= SUPPORT_MIN_SEC) return true;
    }
    return false;
  };
  // Drop isolated extremes from each end (they lack a nearby corroborating note).
  while (qualifying.length && !supported(qualifying[0])) qualifying.shift();
  while (qualifying.length && !supported(qualifying[qualifying.length - 1])) qualifying.pop();
  if (qualifying.length < SUGGEST_MIN_BINS) return null;
  return { lo: qualifying[0], hi: qualifying[qualifying.length - 1] };
}

/** The finished-flower verdict, or null if there isn't enough strong,
 *  corroborated singing to call a range yet. */
export function buildRangeResult(bins: Float32Array): RangeResult | null {
  const range = confidentRange(bins);
  if (!range) return null;
  const stats = flowerStats(bins);
  const { lo, hi } = range;
  return {
    loMidi: lo,
    hiMidi: hi,
    loName: midiName(lo),
    hiName: midiName(hi),
    voice: suggestVoice(lo, hi),
    female: suggestVoice(lo, hi, voicesFor(FEMALE_VOICES)),
    male: suggestVoice(lo, hi, voicesFor(MALE_VOICES)),
    heldSec: stats.heldSec,
    petals: stats.petals,
  };
}

/** "2 octaves and a 3rd" style description of a semitone span. */
export function spanText(loMidi: number, hiMidi: number): string {
  const semis = hiMidi - loMidi;
  const oct = Math.floor(semis / 12);
  const rest = semis % 12;
  // Rough interval names by semitone count above the octave.
  const names = [
    "",
    "a 2nd",
    "a 2nd",
    "a 3rd",
    "a 3rd",
    "a 4th",
    "a tritone",
    "a 5th",
    "a 6th",
    "a 6th",
    "a 7th",
    "a 7th",
  ];
  const octPart = oct === 0 ? "" : oct === 1 ? "an octave" : `${oct} octaves`;
  if (!octPart) return names[rest] || "less than a 2nd";
  if (!rest) return octPart;
  return `${octPart} and ${names[rest]}`;
}
