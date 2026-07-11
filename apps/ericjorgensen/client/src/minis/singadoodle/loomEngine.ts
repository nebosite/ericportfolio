// ChromaLoomEngine — the imperative core of Chroma Loom: microphone capture,
// the 60fps loop, and the scrolling-spectrogram canvas. Every animation frame
// the analyser's FFT is resampled onto the loom's log-frequency axis
// (buildStrip/buildColumn), tinted by the player's rainbow, and woven by the
// selected *pattern*:
//
// - ribbon    — a new slice at the LEFT edge of an offscreen fabric layer,
//               everything woven scrolling right;
// - waterfall — the ribbon turned: frequency runs left→right and each woven
//               row is its own falling slice obeying real 10 ft-drop physics
//               (waterfallVelocityMps) — a beat at the crest, then a hard
//               accelerating fall — bursting at the bottom into droplets
//               that fly out in the exact spectrum color of their spot and
//               fade in ~2s;
// - fire      — the rising ribbon as particles: each spectral slot at the
//               bottom edge births fuzzy, lopsided, slowly-spinning sprites
//               whose random birth rise converges on the scroll speed, that
//               flutter on Perlin-noise turbulence, disperse like flame and
//               fade out as smoke just past the top.
//
// The spiral looms (snail shell, square spiral, figure-eight) arrive later
// (see PATTERNS in src/game/chromaLoom.ts). The main canvas composites the
// weave with very light semitone gridlines (octave C lines labelled), turned
// to match the pattern's frequency axis. All resampling, noise, and life-curve
// math lives in chromaLoom.ts so it stays unit-tested; this file only touches
// the mic and the canvas.

import { PitchAnalyser } from "./src/audio/pitch";
import { midiName, hzMidi } from "./src/game/notes";
import {
  SCROLL_SEC,
  Rgb,
  parseRainbow,
  rainbowAt,
  buildColumn,
  buildStrip,
  hzAt01,
  createPerlin,
  smokeMix01,
  emberAlpha,
  waterfallVelocityMps,
  WATERFALL_DROP_M,
  SPLASH_LIFE_SEC,
  converge,
  semitoneLines,
  LoomPatternId,
} from "./src/game/chromaLoom";
import { MicError } from "./engine";

// ---- fire tuning ----
const FIRE_SLOTS = 96; // spectral emitters across the width
const MAX_PARTICLES = 9600;
const FIRE_SPAWN_PER_SLOT = 8.4; // spawns/sec per slot at full intensity
const SPRITE_VARIANTS = 4; // asymmetric fuzzy-blob shapes per color
const RISE_TAU = 1.8; // seconds for a random birth rise to converge on the scroll rate

interface FireParticle {
  x: number; // CSS px
  y: number;
  age: number; // seconds
  life: number;
  r0: number; // radius at birth (grows as it disperses)
  a0: number; // peak alpha (from the slot's intensity at birth)
  slot: number; // emitter slot — fixes the particle's rainbow color
  rise0: number; // rise rate at birth (random; converges to the scroll rate)
  rot: number; // current rotation (rad)
  rotV: number; // slow random spin (rad/s)
  variant: number; // which asymmetric sprite shape
}

// ---- waterfall tuning ----
const ATLAS_ROWS = 512; // ring buffer of woven rows (each slice keeps one)
const MAX_SPLASH = 3200;
const SPLASH_GRAVITY = 90; // px/s² pulling burst droplets back down
const SPLASH_COLOR_STEPS = 256; // splash sprite tints across the spectrum

/** One woven row falling down the canvas, stretching as it accelerates. */
interface WaterfallSlice {
  y: number; // top edge, CSS px
  atlasRow: number; // its pixels in the slice atlas
  strip: Float32Array; // FIRE_SLOTS intensities, kept for the burst's colors
}

interface SplashParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  r0: number; // birth radius (random, 2–5× the old base size)
  x01: number; // spawn position on the frequency axis — its exact color
}

export interface LoomHud {
  liveName: string; // detected note, e.g. "A4"
  liveHz: string;
}

export function blankLoomHud(): LoomHud {
  return { liveName: "—", liveHz: "" };
}

export interface LoomEngineOpts {
  rainbow: readonly string[]; // hex key colors, low → high frequency
  onHud: (hud: LoomHud) => void;
}

export class ChromaLoomEngine {
  private opts: LoomEngineOpts;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0; // CSS px
  private H = 0;

  // The woven fabric, in device pixels: new slices land at x=0 and the whole
  // layer is redrawn one step to the right each weave.
  private fabric: HTMLCanvasElement | null = null;
  private fabricW = 0;
  private fabricH = 0;

  private audio: { stream: MediaStream; ctx: AudioContext } | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  private pitch: PitchAnalyser | null = null; // note-name HUD only
  private pendingBegin = false; // begin() before the mic resolves defers

  private stops: Rgb[];
  // Rainbow along the frequency axis, low → high, 3 bytes per fabric pixel
  // (rows for the ribbon, columns for the waterfall).
  private axisColors: Uint8ClampedArray = new Uint8ClampedArray(0);
  private pattern: LoomPatternId = "ribbon";

  // Fire state: emitters, particles, sprites, and the turbulence field.
  private slotColors: Rgb[] = [];
  private particles: FireParticle[] = [];
  private lastStrip: Float32Array | null = null; // for the ember bed
  private spriteCache = new Map<number, HTMLCanvasElement>();
  private smokeSprites: HTMLCanvasElement[] = [];
  private noise = createPerlin();

  // Waterfall state: falling slices (newest first), their pixel atlas, and
  // the splash of a slice bursting on the bottom edge.
  private slices: WaterfallSlice[] = [];
  private atlas: HTMLCanvasElement | null = null;
  private nextAtlasRow = 0;
  private splashes: SplashParticle[] = [];

  private t0 = 0;
  private raf = 0;
  private lastNow: number | null = null;
  private lastHud = 0;
  private scrollAcc = 0; // fractional device pixels waiting to be woven

  private onResize = (): void => {
    this.sizeCanvas();
  };

  constructor(opts: LoomEngineOpts) {
    this.opts = opts;
    this.stops = parseRainbow(opts.rainbow);
    window.addEventListener("resize", this.onResize);
  }

  /** Ref callback from React: attach (or detach with null) the loom canvas. */
  setCanvas = (el: HTMLCanvasElement | null): void => {
    if (el === this.canvas) return;
    this.canvas = el;
    this.ctx = el ? el.getContext("2d") : null;
    if (el) this.sizeCanvas();
  };

  /** Retune the rainbow's key colors; newly woven slices pick them up. */
  setRainbow(hexes: readonly string[]): void {
    this.stops = parseRainbow(hexes);
    this.buildLuts();
  }

  /** Select the weave pattern. Switching re-orients the frequency axis, so
   *  the woven fabric and any fire are cleared for a fresh start. */
  setPattern(id: LoomPatternId): void {
    if (id === this.pattern) return;
    this.pattern = id;
    this.scrollAcc = 0;
    this.particles = [];
    this.lastStrip = null;
    this.slices = [];
    this.splashes = [];
    if (this.fabric) {
      this.fabric.getContext("2d")?.clearRect(0, 0, this.fabric.width, this.fabric.height);
    }
    this.buildLuts();
  }

  /** Whether the current pattern runs frequency along the horizontal axis. */
  private freqRunsAcross(): boolean {
    return this.pattern === "waterfall" || this.pattern === "fire";
  }

  /** The audio graph's sample rate, or the standard 48 kHz when weaving the
   *  mic-less home-card preview from synthetic spectra. */
  private sampleRate(): number {
    return this.audio?.ctx.sampleRate ?? 48000;
  }

  /** Ambient home-card preview: no mic — the ribbon weaves a synthetic voice
   *  (a slow low→high sweep with harmonics) so color scrolls. Draws only while
   *  the tab is visible and a canvas is attached; destroy() tears it down. */
  startPreview(): void {
    this.pattern = "ribbon";
    this.spectrum = new Uint8Array(2048);
    this.scrollAcc = 0;
    this.lastNow = null;
    this.t0 = performance.now() / 1000;
    cancelAnimationFrame(this.raf);
    const binHz = this.sampleRate() / (2 * this.spectrum.length);
    const step = (): void => {
      this.raf = requestAnimationFrame(step);
      if (document.hidden || !this.ctx) return;
      const now = performance.now() / 1000 - this.t0;
      let dt = this.lastNow == null ? 0 : now - this.lastNow;
      this.lastNow = now;
      if (dt < 0 || dt > 0.5) dt = 0;
      // A sweeping fundamental with three fading harmonics.
      this.spectrum.fill(0);
      const f0 = hzAt01(0.5 + 0.42 * Math.sin(now * 0.55));
      for (let h = 1; h <= 4; h++) {
        const b = Math.round((f0 * h) / binHz);
        const amp = 235 / h;
        for (let k = -2; k <= 2; k++) {
          const i = b + k;
          if (i >= 0 && i < this.spectrum.length) {
            this.spectrum[i] = Math.max(this.spectrum[i], amp * Math.exp(-(k * k) / 2));
          }
        }
      }
      this.weave(dt);
      this.drawFrame();
    };
    step();
  }

  getPatternId(): LoomPatternId {
    return this.pattern;
  }

  /** Request the mic and set up the audio graph. Rejects with a MicError. */
  async start(): Promise<void> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      throw (name === "NotAllowedError" ? "denied" : "error") as MicError;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();
    await ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    // A tall FFT so the low octaves resolve on the log axis (C2 sits near
    // 65 Hz; 16384 points at 48 kHz gives ~2.9 Hz bins). Light temporal
    // smoothing steadies the weave without smearing time.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 16384;
    analyser.smoothingTimeConstant = 0.3;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -24;
    src.connect(analyser);
    this.analyser = analyser;
    this.spectrum = new Uint8Array(analyser.frequencyBinCount);
    this.pitch = new PitchAnalyser(ctx, src, 4096);
    this.audio = { stream, ctx };
    if (this.pendingBegin) {
      this.pendingBegin = false;
      this.startLoop();
    }
  }

  /** Start weaving. Call after the intro card is dismissed; defers if the mic
   *  hasn't come up yet. */
  begin(): void {
    if (this.audio) this.startLoop();
    else this.pendingBegin = true;
  }

  private startLoop(): void {
    this.lastNow = null;
    this.lastHud = 0;
    this.scrollAcc = 0;
    this.particles = [];
    this.lastStrip = null;
    this.slices = [];
    this.splashes = [];
    this.t0 = performance.now() / 1000;
    this.sizeCanvas();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  /** Stop the loom, freezing the last woven frame. Returns the session's
   *  length in seconds (for analytics). */
  finish(): number {
    const seconds = this.audio ? performance.now() / 1000 - this.t0 : 0;
    cancelAnimationFrame(this.raf);
    this.teardownAudio();
    return seconds;
  }

  /** Tear everything down (call on unmount). */
  destroy(): void {
    this.pendingBegin = false;
    cancelAnimationFrame(this.raf);
    this.teardownAudio();
    window.removeEventListener("resize", this.onResize);
  }

  private teardownAudio(): void {
    if (!this.audio) return;
    try {
      this.audio.stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    try {
      void this.audio.ctx.close();
    } catch {
      /* already closed */
    }
    this.audio = null;
    this.analyser = null;
    this.pitch = null;
  }

  // ---------- sizing ----------

  private sizeCanvas(): void {
    const el = this.canvas;
    if (!el || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    const devW = Math.round(w * dpr);
    const devH = Math.round(h * dpr);
    // Never touch canvas width/height unless it actually changed — assigning
    // them CLEARS a canvas even when the value is the same, and this runs on
    // every React re-render (the inline canvas ref detaches/reattaches).
    if (el.width !== devW || el.height !== devH) {
      el.width = devW;
      el.height = devH;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;

    // The fabric works in device pixels (putImageData ignores transforms).
    // Same size → keep the weave exactly as it is.
    if (this.fabric && this.fabricW === devW && this.fabricH === devH) return;
    // Re-cut the fabric, carrying the woven history across (scaled).
    const old = this.fabric;
    const oldW = this.fabricW;
    const oldH = this.fabricH;
    const next = document.createElement("canvas");
    next.width = devW;
    next.height = devH;
    if (old && oldW && oldH) {
      next.getContext("2d")?.drawImage(old, 0, 0, oldW, oldH, 0, 0, devW, devH);
    }
    this.fabric = next;
    this.fabricW = devW;
    this.fabricH = devH;
    // The waterfall's slice atlas matches the fabric width; a resize
    // invalidates every stored row, so the falling slices start over.
    const atlas = document.createElement("canvas");
    atlas.width = devW;
    atlas.height = ATLAS_ROWS;
    this.atlas = atlas;
    this.nextAtlasRow = 0;
    this.slices = [];
    this.splashes = [];
    this.buildLuts();
  }

  /** Precompute the rainbow along the frequency axis — per fabric pixel for
   *  the woven patterns, per emitter slot for the fire — plus invalidate the
   *  fire's tinted sprites. Rebuilt on resize, retune, and pattern change. */
  private buildLuts(): void {
    const len = this.freqRunsAcross() ? this.fabricW : this.fabricH;
    this.axisColors = new Uint8ClampedArray(Math.max(0, len) * 3);
    for (let i = 0; i < len; i++) {
      const t = len === 1 ? 0 : i / (len - 1); // 0 = lowest frequency
      const c = rainbowAt(this.stops, t);
      this.axisColors[i * 3] = c.r;
      this.axisColors[i * 3 + 1] = c.g;
      this.axisColors[i * 3 + 2] = c.b;
    }
    this.slotColors = [];
    for (let s = 0; s < FIRE_SLOTS; s++) {
      this.slotColors.push(rainbowAt(this.stops, s / (FIRE_SLOTS - 1)));
    }
    this.spriteCache.clear();
  }

  // ---------- the loop ----------

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.audio || !this.analyser) return;
    const now = performance.now() / 1000 - this.t0;
    let dt = this.lastNow == null ? 0 : now - this.lastNow;
    this.lastNow = now;
    if (dt < 0 || dt > 0.5) dt = 0;

    this.analyser.getByteFrequencyData(this.spectrum);
    if (this.pattern === "fire") this.fire(dt, now);
    else if (this.pattern === "waterfall") this.waterfall(dt);
    else this.weave(dt);
    this.drawFrame();
    this.pushHud(now);
  };

  /** Ribbon: advance the fabric by the elapsed time — everything steps right,
   *  the fresh slice lands at the left edge. */
  private weave(dt: number): void {
    const fabric = this.fabric;
    if (!fabric || !this.fabricW || !this.fabricH) return;
    const fctx = fabric.getContext("2d");
    if (!fctx) return;
    this.scrollAcc += (dt * this.fabricW) / SCROLL_SEC;
    const dx = Math.floor(this.scrollAcc);
    if (dx < 1) return;
    this.scrollAcc -= dx;
    fctx.drawImage(fabric, dx, 0);
    const rows = this.fabricH;
    const col = buildColumn(this.spectrum, this.sampleRate(), rows);
    const img = fctx.createImageData(dx, rows);
    const data = img.data;
    for (let row = 0; row < rows; row++) {
      const v = col[row];
      const a = (rows - 1 - row) * 3; // axisColors run low→high; row 0 is high
      const r = this.axisColors[a] * v;
      const g = this.axisColors[a + 1] * v;
      const b = this.axisColors[a + 2] * v;
      for (let x = 0; x < dx; x++) {
        const i = (row * dx + x) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 255;
      }
    }
    fctx.putImageData(img, 0, 0);
  }

  // ---------- waterfall ----------

  /** Waterfall: each woven row is its own falling slice — born at the top at
   *  the slow end of the speed profile, accelerating as it descends
   *  (waterfallSpeed01), and bursting into splash droplets when it reaches
   *  the bottom edge. */
  private waterfall(dt: number): void {
    const W = this.W;
    const H = this.H;
    const atlas = this.atlas;
    if (!W || !H || !atlas) return;

    // Weave a fresh slice whenever the previous one has cleared the top row.
    if (this.slices.length === 0 || this.slices[0].y >= 1) {
      const actx = atlas.getContext("2d");
      if (actx) {
        const cols = this.fabricW;
        const sr = this.sampleRate();
        const strip = buildStrip(this.spectrum, sr, cols);
        const img = actx.createImageData(cols, 1);
        const data = img.data;
        for (let x = 0; x < cols; x++) {
          const v = strip[x];
          const i = x * 4;
          data[i] = this.axisColors[x * 3] * v;
          data[i + 1] = this.axisColors[x * 3 + 1] * v;
          data[i + 2] = this.axisColors[x * 3 + 2] * v;
          data[i + 3] = 255;
        }
        actx.putImageData(img, 0, this.nextAtlasRow);
        this.slices.unshift({
          y: 0,
          atlasRow: this.nextAtlasRow,
          strip: buildStrip(this.spectrum, sr, FIRE_SLOTS),
        });
        this.nextAtlasRow = (this.nextAtlasRow + 1) % ATLAS_ROWS;
      }
    }

    // Fall like real water over a 10 ft drop: the canvas height maps to
    // 10 ft, so px/s = v(m/s) · (H px / drop m).
    const pxPerM = H / WATERFALL_DROP_M;
    for (const s of this.slices) {
      s.y += waterfallVelocityMps(s.y / H) * pxPerM * dt;
    }

    // Any slice reaching the bottom bursts outward.
    while (this.slices.length && this.slices[this.slices.length - 1].y >= H) {
      this.burst(this.slices.pop()!);
    }

    // Splash droplets fly out, arc under gravity, and fade.
    for (const p of this.splashes) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += SPLASH_GRAVITY * dt;
    }
    this.splashes = this.splashes.filter((p) => p.age < p.life);
  }

  /** A slice hits the bottom: throw droplets out in random directions from
   *  wherever the slice actually carried energy, each tinted with the exact
   *  spectrum color of the spot that spawned it. */
  private burst(slice: WaterfallSlice): void {
    const slotW = this.W / FIRE_SLOTS;
    for (let s = 0; s < FIRE_SLOTS; s++) {
      const v = slice.strip[s];
      if (v < 0.08 || this.splashes.length >= MAX_SPLASH) continue;
      const n = 2 * (1 + Math.round(v * 2));
      for (let i = 0; i < n && this.splashes.length < MAX_SPLASH; i++) {
        const ang = Math.random() * Math.PI * 2;
        const speed = (50 + Math.random() * 160) * (0.5 + v * 0.7);
        const x = (s + Math.random()) * slotW;
        this.splashes.push({
          x,
          y: this.H - 2,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          age: 0,
          life: SPLASH_LIFE_SEC * (0.8 + Math.random() * 0.4),
          r0: 3 * (2 + Math.random() * 3), // 2–5× the old base size
          x01: x / this.W,
        });
      }
    }
  }

  /** Draw the falling slices, each stretched down to meet the next-older one
   *  so the accelerating column stays gapless. */
  private drawSlices(ctx: CanvasRenderingContext2D): void {
    const atlas = this.atlas;
    if (!atlas || !this.slices.length) return;
    const W = this.W;
    const H = this.H;
    const n = this.slices.length;
    for (let i = 0; i < n; i++) {
      const s = this.slices[i]; // newest (top) first
      const below = i + 1 < n ? this.slices[i + 1].y : Math.min(H, s.y + 40);
      const h = Math.min(40, Math.max(1, below - s.y + 0.5));
      ctx.drawImage(atlas, 0, s.atlasRow, this.fabricW, 1, 0, s.y, W, h);
    }
  }

  /** Burst droplets: additive glows tinted with the exact spectrum color at
   *  each droplet's spawn point. */
  private drawSplashes(ctx: CanvasRenderingContext2D): void {
    if (!this.splashes.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.splashes) {
      const q = p.age / p.life;
      const r = p.r0 * (1 + 1.3 * q);
      ctx.globalAlpha = (1 - q) * 0.9;
      ctx.drawImage(this.splashSpriteFor(p.x01), p.x - r, p.y - r, r * 2, r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** A splash sprite in the rainbow color at axis position x01 — tints are
   *  cached at 256 steps across the spectrum (visually exact), in the same
   *  cache the fire uses so retuning the rainbow rebuilds them all. */
  private splashSpriteFor(x01: number): HTMLCanvasElement {
    const idx = Math.max(
      0,
      Math.min(SPLASH_COLOR_STEPS - 1, Math.round(x01 * (SPLASH_COLOR_STEPS - 1))),
    );
    const key = 1_000_000 + idx;
    let sprite = this.spriteCache.get(key);
    if (sprite) return sprite;
    sprite = ChromaLoomEngine.makeSprite(rainbowAt(this.stops, idx / (SPLASH_COLOR_STEPS - 1)));
    this.spriteCache.set(key, sprite);
    return sprite;
  }

  // ---------- fire ----------

  /** Advance the fire: birth particles from the spectrum's bottom-edge
   *  emitters, then let each rise at the scroll speed while Perlin-noise
   *  turbulence flutters it. Life is long enough (≥ SCROLL_SEC) that a
   *  particle fades out as smoke around the top of the canvas. */
  private fire(dt: number, now: number): void {
    const W = this.W;
    const H = this.H;
    if (!W || !H) return;
    const strip = buildStrip(this.spectrum, this.sampleRate(), FIRE_SLOTS);
    this.lastStrip = strip;
    const rise = H / SCROLL_SEC; // "roughly the same speed as the scroll"

    if (dt > 0) {
      const slotW = W / FIRE_SLOTS;
      for (let s = 0; s < FIRE_SLOTS && this.particles.length < MAX_PARTICLES; s++) {
        const v = strip[s];
        if (v < 0.05) continue;
        // Poisson-ish spawning: the expected count can exceed one per frame.
        let expected = v * FIRE_SPAWN_PER_SLOT * dt;
        while (expected > 0 && this.particles.length < MAX_PARTICLES) {
          if (Math.random() >= expected) break;
          expected -= 1;
          this.particles.push({
            x: (s + 0.2 + Math.random() * 0.6) * slotW,
            y: H - 3 - Math.random() * 4,
            age: 0,
            life: SCROLL_SEC * (1.05 + Math.random() * 0.35),
            r0: 4.5 + v * 7 + Math.random() * 3.5,
            a0: 0.35 + v * 0.65,
            slot: s,
            rise0: rise * (0.25 + Math.random() * 1.5),
            rot: Math.random() * Math.PI * 2,
            rotV: (Math.random() - 0.5) * 0.8,
            variant: Math.floor(Math.random() * SPRITE_VARIANTS),
          });
        }
      }
    }

    for (const p of this.particles) {
      p.age += dt;
      p.rot += p.rotV * dt;
      const q = p.age / p.life;
      // Each particle is born with its own rise rate and settles onto the
      // scroll rate within a few seconds (exponential convergence).
      const riseNow = converge(p.rise0, rise, p.age, RISE_TAU);
      // Two octaves of sideways turbulence (smoke flutters wider than flame)
      // plus a gentle ripple on the rise itself.
      const n1 = this.noise(p.x * 0.007, p.y * 0.007, now * 0.32);
      const n2 = this.noise(p.x * 0.025 + 40, p.y * 0.025 + 40, now * 0.8);
      const ny = this.noise(p.x * 0.007 + 130, p.y * 0.007 + 130, now * 0.32);
      p.x += (n1 + 0.5 * n2) * (16 + 60 * q) * dt;
      p.y += (-riseNow * (1.06 - 0.18 * q) + ny * 9) * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.life && p.y > -30);
  }

  /** An asymmetric fuzzy sprite tinted with a slot's rainbow color (cached
   *  per slot × shape variant; the cache clears when the rainbow retunes). */
  private spriteFor(slot: number, variant: number): HTMLCanvasElement {
    const key = slot * SPRITE_VARIANTS + variant;
    let sprite = this.spriteCache.get(key);
    if (sprite) return sprite;
    sprite = ChromaLoomEngine.makeSprite(this.slotColors[slot] ?? { r: 255, g: 255, b: 255 });
    this.spriteCache.set(key, sprite);
    return sprite;
  }

  private smokeSpriteFor(variant: number): HTMLCanvasElement {
    let sprite = this.smokeSprites[variant];
    if (!sprite) {
      sprite = ChromaLoomEngine.makeSprite({ r: 145, g: 147, b: 155 });
      this.smokeSprites[variant] = sprite;
    }
    return sprite;
  }

  /** A fuzzy, deliberately lopsided blob: a soft off-center core with a few
   *  jittered side-lobes, so no two variants (or rotations) look alike. */
  private static makeSprite(c: Rgb): HTMLCanvasElement {
    const el = document.createElement("canvas");
    el.width = 64;
    el.height = 64;
    const g = el.getContext("2d")!;
    const rgb = `${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}`;
    const lobes = 4;
    for (let i = 0; i < lobes; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = i === 0 ? Math.random() * 4 : 5 + Math.random() * 8;
      const cx = 32 + Math.cos(ang) * d;
      const cy = 32 + Math.sin(ang) * d;
      const r = i === 0 ? 22 + Math.random() * 6 : 9 + Math.random() * 12;
      const a0 = i === 0 ? 0.85 : 0.3 + Math.random() * 0.3;
      const grad = g.createRadialGradient(cx, cy, 1, cx, cy, r);
      grad.addColorStop(0, `rgba(${rgb}, ${a0})`);
      grad.addColorStop(0.5, `rgba(${rgb}, ${a0 * 0.35})`);
      grad.addColorStop(1, `rgba(${rgb}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
    return el;
  }

  /** Draw the ember bed and every particle: smoke first (normal compositing,
   *  gray, broad), flame on top (additive, rainbow-tinted). Each particle
   *  draws rotated by its own slow spin. */
  private drawFire(ctx: CanvasRenderingContext2D): void {
    const W = this.W;
    const H = this.H;
    ctx.save();

    // The ember bed: the live ribbon slice glowing along the base.
    ctx.globalCompositeOperation = "lighter";
    if (this.lastStrip) {
      const slotW = W / FIRE_SLOTS;
      for (let s = 0; s < FIRE_SLOTS; s++) {
        const v = this.lastStrip[s];
        if (v <= 0.03) continue;
        const c = this.slotColors[s];
        ctx.fillStyle = `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${v})`;
        ctx.fillRect(s * slotW, H - 4, slotW + 0.5, 4);
      }
    }

    // Smoke pass — what each particle has already become.
    ctx.globalCompositeOperation = "source-over";
    for (const p of this.particles) {
      const q = p.age / p.life;
      const mix = smokeMix01(q);
      if (mix <= 0) continue;
      ctx.globalAlpha = emberAlpha(q) * p.a0 * mix * 0.5;
      this.stampRotated(ctx, this.smokeSpriteFor(p.variant), p, q);
    }

    // Flame pass — what's still burning, additive so overlaps glow.
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const q = p.age / p.life;
      const mix = smokeMix01(q);
      if (mix >= 1) continue;
      ctx.globalAlpha = emberAlpha(q) * p.a0 * (1 - mix);
      this.stampRotated(ctx, this.spriteFor(p.slot, p.variant), p, q);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Stamp a sprite centered on the particle at its current spin and size.
   *  Manual un-rotate instead of save/restore — thousands run per frame. */
  private stampRotated(
    ctx: CanvasRenderingContext2D,
    sprite: HTMLCanvasElement,
    p: FireParticle,
    q: number,
  ): void {
    // Born already fuzzy: the birth size matches what the old growth curve
    // reached ~40% of the way up, easing to the same full-grown size.
    const r = p.r0 * (1.9 + 1.7 * q);
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
    ctx.rotate(-p.rot);
    ctx.translate(-p.x, -p.y);
  }

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W;
    const H = this.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#08090d";
    ctx.fillRect(0, 0, W, H);

    if (this.pattern === "fire") {
      // Gridlines beneath the flames so the fire reads on top.
      this.drawGrid(ctx);
      this.drawFire(ctx);
      return;
    }
    if (this.pattern === "waterfall") {
      this.drawSlices(ctx);
      this.drawGrid(ctx);
      this.drawSplashes(ctx); // the burst flies over the gridlines
      return;
    }
    if (this.fabric) ctx.drawImage(this.fabric, 0, 0, W, H);
    this.drawGrid(ctx);
  }

  /** Very light semitone gridlines matched to the pattern's frequency axis:
   *  sharps faintest, naturals a touch brighter, octave C lines brightest and
   *  labelled. Horizontal lines for the ribbon; vertical when frequency runs
   *  across (waterfall, fire). */
  private drawGrid(ctx: CanvasRenderingContext2D): void {
    const W = this.W;
    const H = this.H;
    const across = this.freqRunsAcross();
    ctx.save();
    ctx.font = "9px 'Spline Sans Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const line of semitoneLines()) {
      ctx.strokeStyle = line.isC
        ? "rgba(255,255,255,0.11)"
        : line.natural
          ? "rgba(255,255,255,0.05)"
          : "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (across) {
        const x = line.t01 * W;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        if (line.isC) {
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          // Labels sit clear of the fresh edge: bottom for the waterfall's
          // top-woven rows, top for the fire rising off the base.
          ctx.fillText(line.label, x + 4, this.pattern === "waterfall" ? H - 9 : 9);
        }
      } else {
        const y = (1 - line.t01) * H;
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        if (line.isC) {
          ctx.fillStyle = "rgba(255,255,255,0.3)";
          ctx.fillText(line.label, 5, y - 6);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private pushHud(now: number): void {
    if (now - this.lastHud < 0.1) return;
    this.lastHud = now;
    const pr = this.pitch?.read() ?? null;
    this.opts.onHud({
      liveName: pr ? midiName(Math.round(hzMidi(pr.f0))) : "—",
      liveHz: pr ? pr.f0.toFixed(1) + " Hz" : "",
    });
  }
}
