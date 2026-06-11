// Sound effects for Big Pac Tiny Man. Plays the MP3s in public/sounds/ through
// the Web Audio API, which decodes them once and can fire many overlapping
// one-shots cheaply (Pac eats a lot of dots). Drop in your own same-named MP3s
// to change the sounds.

type SoundName = 'waka' | 'power' | 'fruit';

const SOUND_FILES: Record<SoundName, string> = {
  waka: '/sounds/waka.mp3',
  power: '/sounds/power.mp3',
  fruit: '/sounds/fruit.mp3',
};

const WAKA_MIN_GAP_MS = 55; // throttle the munch blip so it doesn't machine-gun

export class Sfx {
  private ctx: AudioContext;
  private buffers = new Map<SoundName, AudioBuffer>();
  private lastWaka = 0;

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
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: SoundName, gain = 0.5): void {
    const buffer = this.buffers.get(name);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const vol = this.ctx.createGain();
    vol.gain.value = gain;
    source.connect(vol).connect(this.ctx.destination);
    source.start();
  }

  /** Throttled dot-munch so a fast Pac doesn't stack hundreds of blips. */
  waka(): void {
    const now = performance.now();
    if (now - this.lastWaka < WAKA_MIN_GAP_MS) return;
    this.lastWaka = now;
    this.play('waka', 0.35);
  }

  destroy(): void {
    void this.ctx.close();
  }
}
