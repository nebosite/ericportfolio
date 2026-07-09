// ChromaLoomEngine — the imperative core of Chroma Loom: microphone capture,
// the 60fps loop, and the scrolling-spectrogram canvas. Every animation frame
// the analyser's FFT is resampled onto the loom's log-frequency axis
// (buildColumn), tinted by the player's rainbow, and woven as a thin new slice
// at the LEFT edge of an offscreen fabric layer while everything already woven
// scrolls to the right. The main canvas composites the fabric under a static
// overlay of very light semitone gridlines (octave C lines labelled).
//
// The weave *pattern* is selectable; only the left→right "ribbon" is
// implemented — the snail shell, square spiral and figure-eight looms arrive
// later (see PATTERNS in src/game/chromaLoom.ts). All the resampling and
// color math lives in that module so it stays unit-tested; this file only
// touches the mic and the canvas.

import { PitchAnalyser } from "./src/audio/pitch";
import { midiName, hzMidi } from "./src/game/notes";
import {
  SCROLL_SEC,
  Rgb,
  parseRainbow,
  rainbowAt,
  buildColumn,
  semitoneLines,
  LoomPatternId,
} from "./src/game/chromaLoom";
import { MicError } from "./engine";

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
  private rowColors: Uint8ClampedArray = new Uint8ClampedArray(0); // 3 bytes per fabric row
  private pattern: LoomPatternId = "ribbon";

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
    this.buildRowColors();
  }

  /** Select the weave pattern. Only the ribbon weaves today; the choice is
   *  kept so the coming looms slot in here. */
  setPattern(id: LoomPatternId): void {
    this.pattern = id;
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
    this.buildRowColors();
  }

  /** Precompute each fabric row's rainbow color (rebuilt on resize/retune). */
  private buildRowColors(): void {
    const rows = this.fabricH;
    this.rowColors = new Uint8ClampedArray(rows * 3);
    if (!rows) return;
    for (let row = 0; row < rows; row++) {
      const t = 1 - row / (rows - 1); // top row = highest frequency
      const c = rainbowAt(this.stops, t);
      this.rowColors[row * 3] = c.r;
      this.rowColors[row * 3 + 1] = c.g;
      this.rowColors[row * 3 + 2] = c.b;
    }
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
    this.weave(dt);
    this.drawFrame();
    this.pushHud(now);
  };

  /** Advance the fabric by the elapsed time and weave the new slice(s) at the
   *  left edge — the whole graph scrolls left → right. */
  private weave(dt: number): void {
    const fabric = this.fabric;
    if (!fabric || !this.fabricW || !this.fabricH) return;
    const fctx = fabric.getContext("2d");
    if (!fctx) return;
    this.scrollAcc += (dt * this.fabricW) / SCROLL_SEC;
    const dx = Math.floor(this.scrollAcc);
    if (dx < 1) return;
    this.scrollAcc -= dx;

    // Everything already woven steps right...
    fctx.drawImage(fabric, dx, 0);
    // ...and the freshest slice lands at the left edge, dx pixels wide.
    const rows = this.fabricH;
    const col = buildColumn(this.spectrum, this.audio!.ctx.sampleRate, rows);
    const img = fctx.createImageData(dx, rows);
    const data = img.data;
    for (let row = 0; row < rows; row++) {
      const v = col[row];
      const r = this.rowColors[row * 3] * v;
      const g = this.rowColors[row * 3 + 1] * v;
      const b = this.rowColors[row * 3 + 2] * v;
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

  private drawFrame(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W;
    const H = this.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#08090d";
    ctx.fillRect(0, 0, W, H);

    if (this.fabric) ctx.drawImage(this.fabric, 0, 0, W, H);

    // Very light semitone gridlines over the weave: sharps faintest, naturals
    // a touch brighter, octave C lines brightest and labelled at the left.
    ctx.save();
    ctx.font = "9px 'Spline Sans Mono', monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (const line of semitoneLines()) {
      const y = (1 - line.t01) * H;
      ctx.strokeStyle = line.isC
        ? "rgba(255,255,255,0.11)"
        : line.natural
          ? "rgba(255,255,255,0.05)"
          : "rgba(255,255,255,0.025)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      if (line.isC) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillText(line.label, 5, y - 6);
      }
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
