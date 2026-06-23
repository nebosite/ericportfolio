// scoring.ts — per-tick scoring and vibrato detection.

import { midiHz } from "./notes";

/** Cents between a detected frequency and a target MIDI note (signed). */
export function centsOff(detectedHz: number, targetMidi: number): number {
  return 1200 * Math.log2(detectedHz / midiHz(targetMidi));
}

/**
 * Points for one 100ms tick, by absolute cents error:
 *   ≤25 (⅛ step) → 5,  ≤50 (¼ step) → 2,  ≤100 (semitone) → 1,  else 0.
 */
export function quality(absCents: number): 0 | 1 | 2 | 5 {
  if (absCents <= 25) return 5;
  if (absCents <= 50) return 2;
  if (absCents <= 100) return 1;
  return 0;
}

export const VIBRATO_MULTIPLIER = 10;
export const TICK_MS = 100;

/** Accuracy ratio 0..1 for a tick (used for the pitch-map mastery + accuracy %). */
export function accuracyRatio(absCents: number): number {
  return Math.max(0, 1 - absCents / 100);
}

/**
 * Points earned for one tick. Pass vibratoActive=true (and quality>0) for the ×10 bonus.
 */
export function tickPoints(absCents: number, vibratoActive: boolean): number {
  const q = quality(absCents);
  return q * (vibratoActive && q > 0 ? VIBRATO_MULTIPLIER : 1);
}

/**
 * Detects a sung vibrato: the pitch stays within a semitone of the target and crosses
 * it at a regular rate of at least 5 times per second. Push one sample per frame while
 * the note is being scored; call active() to test the trailing ~1.1s window.
 */
export class VibratoDetector {
  private samples: { t: number; cents: number }[] = [];
  private windowSec: number;

  constructor(windowSec = 1.15) {
    this.windowSec = windowSec;
  }

  /** t in seconds, cents = signed deviation from the target. */
  push(t: number, cents: number): void {
    this.samples.push({ t, cents });
    while (this.samples.length && t - this.samples[0].t > this.windowSec)
      this.samples.shift();
  }

  reset(): void {
    this.samples.length = 0;
  }

  active(): boolean {
    const v = this.samples;
    if (v.length < 8) return false;
    const span = v[v.length - 1].t - v[0].t;
    if (span < 0.6) return false;
    let cross = 0,
      mn = Infinity,
      mx = -Infinity,
      sumAbs = 0;
    for (let i = 0; i < v.length; i++) {
      mn = Math.min(mn, v[i].cents);
      mx = Math.max(mx, v[i].cents);
      sumAbs += Math.abs(v[i].cents);
      if (
        i > 0 &&
        Math.sign(v[i].cents) !== Math.sign(v[i - 1].cents) &&
        Math.abs(v[i].cents) > 4
      )
        cross++;
    }
    const rate = cross / span; // crossings per second
    const ptp = mx - mn; // peak-to-peak cents
    const meanAbs = sumAbs / v.length;
    return rate >= 5 && ptp >= 30 && ptp <= 320 && meanAbs < 110;
  }
}
