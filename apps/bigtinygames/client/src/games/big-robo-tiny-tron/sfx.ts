import { getVolume } from "../../lib/volume";
import type { SoundEvent } from "./roboTronLogic";

// Sound for Big Robo Tiny Tron. Rather than ship binary clips, these are
// synthesized on the fly with the Web Audio API — short arcade blips built from
// oscillators + gain envelopes. Every cue is keyed off a logic SoundEvent so the
// component can just forward state.events here each frame. Master volume comes
// from the shared VolumeControl (src/lib/volume.ts).

export class Sfx {
  private ctx: AudioContext | null = null;

  private ensure(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** AudioContext starts suspended until a user gesture; call on first input. */
  resume(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** A single oscillator tone with a linear gain envelope. */
  private tone(
    ctx: AudioContext,
    type: OscillatorType,
    fromHz: number,
    toHz: number,
    dur: number,
    gain: number,
  ): void {
    const master = getVolume();
    if (master <= 0) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(fromHz, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t0 + dur);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain * master, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** A short burst of filtered noise (explosions / hits). */
  private noise(ctx: AudioContext, dur: number, gain: number, hz = 1200): void {
    const master = getVolume();
    if (master <= 0) return;
    const t0 = ctx.currentTime;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = hz;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain * master, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp).connect(env).connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /** The family "electronic wail" — a warbling, downward-bending tone. */
  private wail(ctx: AudioContext): void {
    const master = getVolume();
    if (master <= 0) return;
    const t0 = ctx.currentTime;
    const dur = 0.5;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const env = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(900, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + dur);
    lfo.type = "sine";
    lfo.frequency.value = 22;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(osc.frequency);
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.35 * master, t0 + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(env).connect(ctx.destination);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + dur + 0.02);
    lfo.stop(t0 + dur + 0.02);
  }

  /** Play the cue for a single logic event (unhandled events are silent). */
  play(event: SoundEvent): void {
    const ctx = this.ensure();
    if (!ctx) return;
    switch (event) {
      case "playerShoot":
        this.tone(ctx, "square", 720, 480, 0.05, 0.12);
        break;
      case "enemyShoot":
        this.tone(ctx, "square", 300, 200, 0.08, 0.1);
        break;
      case "enemyDie":
        this.noise(ctx, 0.18, 0.35, 1600);
        break;
      case "electrodeHit":
        this.tone(ctx, "triangle", 1200, 300, 0.12, 0.16);
        break;
      case "playerHit":
        this.noise(ctx, 0.35, 0.5, 800);
        this.tone(ctx, "sawtooth", 400, 80, 0.35, 0.25);
        break;
      case "playerDie":
      case "gameover":
        this.tone(ctx, "sawtooth", 300, 40, 0.9, 0.3);
        break;
      case "humanRescue":
        this.tone(ctx, "square", 520, 1040, 0.18, 0.2);
        break;
      case "familyDie":
        this.wail(ctx);
        break;
      case "teleport":
        this.tone(ctx, "sine", 300, 1400, 0.2, 0.18);
        break;
      case "powerupPickup":
        this.tone(ctx, "square", 660, 1320, 0.16, 0.2);
        break;
      case "exitsOpen":
        this.tone(ctx, "square", 440, 880, 0.3, 0.22);
        break;
      case "levelAdvance":
        this.tone(ctx, "square", 523, 1046, 0.35, 0.24);
        break;
      default:
        break;
    }
  }

  destroy(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
