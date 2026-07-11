import shootUrl from "./assets/sounds/shoot.wav";
import laserUrl from "./assets/sounds/laser.wav";
import boomUrl from "./assets/sounds/boom.wav";
import powerupUrl from "./assets/sounds/powerup.wav";
import puffUrl from "./assets/sounds/puff.wav";
import sweepUrl from "./assets/sounds/sweep.wav";
import hitUrl from "./assets/sounds/hit.wav";
import shipdownUrl from "./assets/sounds/shipdown.wav";
import castledownUrl from "./assets/sounds/castledown.wav";
import castlespawnUrl from "./assets/sounds/ominous.wav";
import emptyUrl from "./assets/sounds/empty.wav";
import gameoverUrl from "./assets/sounds/gameover.wav";
import thrustUrl from "./assets/sounds/thrust.wav";
import novabuzzUrl from "./assets/sounds/novabuzz.wav";
import { SoundEvent } from "./roidsLogic";
import { getVolume } from "../../lib/volume";

// Sound effects for Big Aster Tiny Oids. Plays the clips in this game's
// assets/sounds/ folder through the Web Audio API (decoded once, fired as
// cheap one-shots). These are placeholder synth clips — per the repo asset
// rule every clip is a short (<2s) hand-editable WAV; replace the files to
// change the sounds. One-shot names match the model's SoundEvent union so
// the component can drain state.events straight into play(); "thrust" (the
// engine rumble) and "nova" (the live nova's deep buzz) are the extra
// loopable clips driven by setLoop().

type ClipName = SoundEvent | "thrust" | "nova";

const SOUND_FILES: Record<ClipName, string> = {
  shoot: shootUrl,
  laser: laserUrl,
  boom: boomUrl,
  powerup: powerupUrl,
  puff: puffUrl,
  sweep: sweepUrl,
  hit: hitUrl,
  shipdown: shipdownUrl,
  castledown: castledownUrl,
  castlespawn: castlespawnUrl,
  empty: emptyUrl,
  gameover: gameoverUrl,
  thrust: thrustUrl,
  nova: novabuzzUrl,
};

const DEFAULT_GAIN: Record<ClipName, number> = {
  shoot: 0.35,
  laser: 0.45,
  boom: 0.55,
  powerup: 0.55,
  puff: 0.6,
  sweep: 0.5,
  hit: 0.5,
  shipdown: 0.6,
  castledown: 0.65,
  castlespawn: 0.55,
  empty: 0.5,
  gameover: 0.6,
  thrust: 0.4,
  nova: 0.45,
};

export class Sfx {
  private ctx: AudioContext;
  private buffers = new Map<ClipName, AudioBuffer>();
  private loops = new Map<ClipName, { source: AudioBufferSourceNode; gain: GainNode }>();

  constructor() {
    this.ctx = new AudioContext();
  }

  /** Fetch + decode every clip. Safe to call without awaiting. */
  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(SOUND_FILES) as ClipName[]).map(async (name) => {
        try {
          const res = await fetch(SOUND_FILES[name]);
          const buf = await res.arrayBuffer();
          this.buffers.set(name, await this.ctx.decodeAudioData(buf));
        } catch {
          // A missing/blocked sound file just means that effect stays silent.
        }
      }),
    );
  }

  /** AudioContext starts suspended until a user gesture; call on first input. */
  resume(): void {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(name: ClipName, gain = DEFAULT_GAIN[name]): void {
    const master = getVolume();
    if (master <= 0) return; // muted
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const vol = this.ctx.createGain();
    vol.gain.value = gain * master;
    source.connect(vol).connect(this.ctx.destination);
    source.start();
  }

  /**
   * Keep a looping clip (the thrust rumble) running while `on` is true.
   * Call every frame with the desired state — it starts/stops the loop on
   * transitions and keeps the gain tracking the master volume.
   */
  setLoop(name: ClipName, on: boolean, gain = DEFAULT_GAIN[name]): void {
    const master = getVolume();
    const active = this.loops.get(name);
    if (!on || master <= 0) {
      if (active) {
        try {
          active.source.stop();
        } catch {
          // already stopped
        }
        this.loops.delete(name);
      }
      return;
    }
    if (active) {
      active.gain.gain.value = gain * master;
      return;
    }
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const vol = this.ctx.createGain();
    vol.gain.value = gain * master;
    source.connect(vol).connect(this.ctx.destination);
    source.start();
    this.loops.set(name, { source, gain: vol });
  }

  destroy(): void {
    for (const { source } of this.loops.values()) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.loops.clear();
    void this.ctx.close();
  }
}
