import { engineHz, layerGains, smooth, thudStrength, turbineHz } from "./mix";

// Procedural sound, no assets: the machine's engine and turbine, road rumble,
// a sub-bass rumble for the mass that is moving, a mid roar for debris, impact
// thuds and glass bursts. Every gain follows the pure mix curves with smoothing;
// a compressor keeps the sum civil. Must be created after a user gesture.

export class RumbleSynth {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly engineGain: GainNode;
  private readonly turbineGain: GainNode;
  private readonly roadGain: GainNode;
  private readonly subGain: GainNode;
  private readonly roarGain: GainNode;
  private readonly engineA: OscillatorNode;
  private readonly engineB: OscillatorNode;
  private readonly turbine: OscillatorNode;
  private readonly noise: AudioBuffer;
  private gains = { engine: 0, turbine: 0, road: 0, sub: 0, roar: 0 };
  private lastThud = 0;
  private glassVoices = 0;
  private readonly topSpeed: number;

  constructor(topSpeed: number) {
    this.topSpeed = topSpeed;
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.knee.value = 20;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.noise = brownNoise(ctx, 3);

    // Engine: two detuned low oscillators through a low-pass.
    this.engineGain = this.gain(0);
    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = "lowpass";
    engineFilter.frequency.value = 220;
    engineFilter.connect(this.engineGain);
    this.engineA = this.osc("sawtooth", 40, engineFilter);
    this.engineB = this.osc("square", 40.7, engineFilter);
    // Turbine whine.
    this.turbineGain = this.gain(0);
    this.turbine = this.osc("sine", 800, this.turbineGain);
    // Road rumble: brown noise, low-passed.
    this.roadGain = this.gain(0);
    this.noiseLayer("lowpass", 120, 0.7, this.roadGain);
    // Sub rumble: the mass that is moving.
    this.subGain = this.gain(0);
    this.noiseLayer("lowpass", 60, 0.9, this.subGain);
    // Debris roar: band-passed noise.
    this.roarGain = this.gain(0);
    this.noiseLayer("bandpass", 450, 0.6, this.roarGain);
  }

  /** Resume on the user gesture that started the game. */
  start(): void {
    void this.ctx.resume();
  }

  /** Per-frame update from the simulation's numbers. */
  update(speed: number, awakeFraction: number, breaksPerSecond: number, dt: number): void {
    const target = layerGains({
      speed: Math.abs(speed),
      topSpeed: this.topSpeed,
      awakeFraction,
      breaksPerSecond,
    });
    this.gains = {
      engine: smooth(this.gains.engine, target.engine, dt, 0.2),
      turbine: smooth(this.gains.turbine, target.turbine, dt, 0.3),
      road: smooth(this.gains.road, target.road, dt, 0.3),
      sub: smooth(this.gains.sub, target.sub, dt, 0.5),
      roar: smooth(this.gains.roar, target.roar, dt, 0.25),
    };
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(this.gains.engine, t, 0.05);
    this.turbineGain.gain.setTargetAtTime(this.gains.turbine, t, 0.05);
    this.roadGain.gain.setTargetAtTime(this.gains.road, t, 0.05);
    this.subGain.gain.setTargetAtTime(this.gains.sub, t, 0.1);
    this.roarGain.gain.setTargetAtTime(this.gains.roar, t, 0.05);
    const hz = engineHz(Math.abs(speed), this.topSpeed);
    this.engineA.frequency.setTargetAtTime(hz, t, 0.1);
    this.engineB.frequency.setTargetAtTime(hz * 1.012, t, 0.1);
    this.turbine.frequency.setTargetAtTime(turbineHz(Math.abs(speed), this.topSpeed), t, 0.15);
  }

  /** A hit: strength from a one-step speed drop (m/s). */
  impact(speedDrop: number): void {
    this.thud(thudStrength(speedDrop));
  }

  /**
   * Strike onset: the first break near the blade after a quiet spell. A 900 t
   * machine loses no speed going through a tower, so the hit is keyed to contact
   * itself, at a strength set by how fast it was going.
   */
  strike(strength: number): void {
    this.thud(Math.min(1, Math.max(0, strength)));
  }

  private thud(strength: number): void {
    const t = this.ctx.currentTime;
    if (strength === 0 || t - this.lastThud < 0.12) return;
    this.lastThud = t;
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(25, t + 0.45);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(strength * 0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.55);
    // Duck the steady layers so the hit reads.
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(0.5, t);
    this.master.gain.linearRampToValueAtTime(0.8, t + 0.35);
  }

  /** Glass breaking: short bright noise bursts, a few voices per step at most. */
  glass(count: number): void {
    const t = this.ctx.currentTime;
    const voices = Math.min(4, count);
    if (this.glassVoices > 12) return;
    for (let i = 0; i < voices; i++) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      src.playbackRate.value = 2 + Math.random();
      const filter = this.ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.value = 3000 + Math.random() * 4000;
      const g = this.ctx.createGain();
      const start = t + i * 0.02;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.25, start + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start(start, Math.random() * 2);
      src.stop(start + 0.08);
      this.glassVoices++;
      src.onended = () => {
        this.glassVoices--;
      };
    }
  }

  dispose(): void {
    void this.ctx.close();
  }

  private gain(value: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = value;
    g.connect(this.master);
    return g;
  }

  private osc(type: OscillatorType, hz: number, to: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    o.connect(to);
    o.start();
    return o;
  }

  private noiseLayer(type: BiquadFilterType, hz: number, q: number, to: AudioNode): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = hz;
    filter.Q.value = q;
    src.connect(filter);
    filter.connect(to);
    src.start();
  }
}

/** Seconds of looping brown noise (integrated white noise, leaky). */
function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  return buffer;
}
