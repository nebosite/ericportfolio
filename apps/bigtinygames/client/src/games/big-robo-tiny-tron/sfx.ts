import shootUrl from "./assets/sounds/shoot.wav";
import enemyShootUrl from "./assets/sounds/enemyShoot.wav";
import explosionUrl from "./assets/sounds/explosion.wav";
import electrodeUrl from "./assets/sounds/electrode.wav";
import playerHitUrl from "./assets/sounds/playerHit.wav";
import gameoverUrl from "./assets/sounds/gameover.wav";
import rescueUrl from "./assets/sounds/rescue.wav";
import wailUrl from "./assets/sounds/wail.wav";
import teleportUrl from "./assets/sounds/teleport.wav";
import powerupUrl from "./assets/sounds/powerup.wav";
import exitsOpenUrl from "./assets/sounds/exitsOpen.wav";
import levelAdvanceUrl from "./assets/sounds/levelAdvance.wav";
import reconstituteUrl from "./assets/sounds/reconstitute.wav";
import { getVolume } from "../../lib/volume";
import type { SoundEvent } from "./roboTronLogic";

// Sound for Big Robo Tiny Tron. Every cue is an editable audio file in
// assets/sounds/ (all clips are < 2s, so per the repo asset rule they are WAV;
// author longer cues as MP3). They're fetched + decoded once and fired as cheap
// one-shots through the Web Audio API. Master volume comes from the shared
// VolumeControl (src/lib/volume.ts). Each logic SoundEvent maps to one clip.

const EVENT_FILES: Partial<Record<SoundEvent, string>> = {
  playerShoot: shootUrl,
  enemyShoot: enemyShootUrl,
  enemyDie: explosionUrl,
  electrodeHit: electrodeUrl,
  playerHit: playerHitUrl,
  playerDie: gameoverUrl,
  gameover: gameoverUrl,
  humanRescue: rescueUrl,
  familyDie: wailUrl,
  teleport: teleportUrl,
  powerupPickup: powerupUrl,
  exitsOpen: exitsOpenUrl,
  levelAdvance: levelAdvanceUrl,
  reconstitute: reconstituteUrl,
};

/** Per-cue gain trims so nothing is jarring relative to the others. */
const EVENT_GAIN: Partial<Record<SoundEvent, number>> = {
  playerShoot: 0.28,
  enemyShoot: 0.3,
  enemyDie: 0.6,
  electrodeHit: 0.4,
  playerHit: 0.6,
  playerDie: 0.6,
  gameover: 0.6,
  humanRescue: 0.5,
  familyDie: 0.5,
  teleport: 0.5,
  powerupPickup: 0.5,
  exitsOpen: 0.55,
  levelAdvance: 0.6,
  reconstitute: 0.6,
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private buffers = new Map<SoundEvent, AudioBuffer>();

  private ensure(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!this.ctx) this.ctx = new AudioContext();
    return this.ctx;
  }

  /** Fetch + decode every clip. Safe to call without awaiting. */
  async load(): Promise<void> {
    const ctx = this.ensure();
    if (!ctx) return;
    await Promise.all(
      (Object.keys(EVENT_FILES) as SoundEvent[]).map(async (event) => {
        const url = EVENT_FILES[event];
        if (!url) return;
        try {
          const res = await fetch(url);
          const buf = await res.arrayBuffer();
          this.buffers.set(event, await ctx.decodeAudioData(buf));
        } catch {
          // A missing/blocked clip just means that cue stays silent.
        }
      }),
    );
  }

  /** AudioContext starts suspended until a user gesture; call on first input. */
  resume(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** Play the cue for a single logic event (unmapped events are silent). */
  play(event: SoundEvent): void {
    const master = getVolume();
    if (master <= 0) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = this.buffers.get(event);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = (EVENT_GAIN[event] ?? 0.5) * master;
    src.connect(gain).connect(ctx.destination);
    src.start();
  }

  destroy(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
  }
}
