import rotateUrl from "./assets/sounds/rotate.wav";
import flowUrl from "./assets/sounds/flow.wav";
import levelupUrl from "./assets/sounds/levelup.wav";
import gameoverUrl from "./assets/sounds/gameover.wav";
import { getVolume } from "../../lib/volume";

// Sound effects for Big Pipe Tiny Dream. Plays the clips in this game's
// assets/sounds/ folder through the Web Audio API (decoded once, fired as cheap
// one-shots). These are placeholder beeps — per the repo asset rule every clip
// is a short (<2s) hand-editable WAV; replace the files to change the sounds.

export type SoundName = "rotate" | "flow" | "levelup" | "gameover";

const SOUND_FILES: Record<SoundName, string> = {
  rotate: rotateUrl,
  flow: flowUrl,
  levelup: levelupUrl,
  gameover: gameoverUrl,
};

export class Sfx {
  private ctx: AudioContext;
  private buffers = new Map<SoundName, AudioBuffer>();

  constructor() {
    this.ctx = new AudioContext();
  }

  /** Fetch + decode every clip. Safe to call without awaiting. */
  async load(): Promise<void> {
    await Promise.all(
      (Object.keys(SOUND_FILES) as SoundName[]).map(async (name) => {
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

  play(name: SoundName, gain = 0.5): void {
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

  destroy(): void {
    void this.ctx.close();
  }
}
