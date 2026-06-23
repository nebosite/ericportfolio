// tone.ts — click-free sine "preview" of a target note.
// Play during the 2s Preview phase so the singer hears the note before matching it.

import { midiHz } from "../game/notes";

export class TonePlayer {
  private ctx: AudioContext;
  private node: { osc: OscillatorNode; gain: GainNode } | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /** Start a pure sine at the given MIDI note (replaces any currently playing tone). */
  play(midi: number, level = 0.16): void {
    this.stop();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = midiHz(midi);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.03); // fade in to avoid a click
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    this.node = { osc, gain };
  }

  /** Fade out and stop the current tone, if any. */
  stop(): void {
    if (!this.node) return;
    const now = this.ctx.currentTime;
    const { osc, gain } = this.node;
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.05);
      osc.stop(now + 0.07);
    } catch {
      /* already stopped */
    }
    this.node = null;
  }
}
