import shootUrl from "./assets/sounds/shoot.wav";
import popUrl from "./assets/sounds/pop.wav";
import zapUrl from "./assets/sounds/zap.wav";
import missileUrl from "./assets/sounds/missile.wav";
import boomUrl from "./assets/sounds/boom.wav";
import nukeUrl from "./assets/sounds/nuke.wav";
import beamUrl from "./assets/sounds/beam.wav";
import ufoUrl from "./assets/sounds/ufo.wav";
import laserUrl from "./assets/sounds/laser.wav";
import pickupUrl from "./assets/sounds/pickup.wav";
import powerupUrl from "./assets/sounds/powerup.wav";
import stackupUrl from "./assets/sounds/stackup.wav";
import reloadUrl from "./assets/sounds/reload.wav";
import playerdownUrl from "./assets/sounds/playerdown.wav";
import levelupUrl from "./assets/sounds/levelup.wav";
import gameoverUrl from "./assets/sounds/gameover.wav";
import sirenUrl from "./assets/sounds/siren.wav";
import { SoundEvent } from "./invadersLogic";
import { getVolume } from "../../lib/volume";

// Sound effects for Big Space Tiny Invaders. Plays the clips in this game's
// assets/sounds/ folder through the Web Audio API (decoded once, fired as
// cheap one-shots). These are placeholder synth clips — per the repo asset
// rule every clip is a short (<2s) hand-editable WAV; replace the files to
// change the sounds. One-shot names match the model's SoundEvent union; the
// UFO "laser" and the fly-in "siren" are the extra loopable clips driven by
// setLoop.

type ClipName = SoundEvent | "siren";

const SOUND_FILES: Record<ClipName, string> = {
  shoot: shootUrl,
  pop: popUrl,
  zap: zapUrl,
  missile: missileUrl,
  boom: boomUrl,
  nuke: nukeUrl,
  beam: beamUrl,
  ufo: ufoUrl,
  laser: laserUrl,
  pickup: pickupUrl,
  powerup: powerupUrl,
  stackup: stackupUrl,
  reload: reloadUrl,
  playerdown: playerdownUrl,
  levelup: levelupUrl,
  gameover: gameoverUrl,
  siren: sirenUrl,
};

const DEFAULT_GAIN: Record<ClipName, number> = {
  shoot: 0.25,
  pop: 0.3,
  zap: 0.45,
  missile: 0.4,
  boom: 0.5,
  nuke: 0.7,
  beam: 0.55,
  ufo: 0.4,
  laser: 0.5,
  pickup: 0.25,
  powerup: 0.55,
  stackup: 0.6,
  reload: 0.45,
  playerdown: 0.6,
  levelup: 0.5,
  gameover: 0.6,
  siren: 0.45,
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
   * Keep a looping clip (the UFO laser buzz) running while `on` is true. Call
   * every frame with the desired state — it starts/stops on transitions and
   * keeps the gain tracking the master volume.
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

  /** Ramp a running loop's gain to silence over `seconds`, then stop it. */
  fade(name: ClipName, seconds: number): void {
    const active = this.loops.get(name);
    if (!active) return;
    const t = this.ctx.currentTime;
    try {
      active.gain.gain.cancelScheduledValues(t);
      active.gain.gain.setValueAtTime(active.gain.gain.value, t);
      active.gain.gain.linearRampToValueAtTime(0.0001, t + seconds);
      active.source.stop(t + seconds + 0.05);
    } catch {
      // context may be closed; ignore
    }
    this.loops.delete(name); // it's on its way out; setLoop can start fresh later
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
