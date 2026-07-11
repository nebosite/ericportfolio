// RangeExplorerEngine — the imperative core of the Range Explorer game:
// microphone capture, the 60fps loop, and the polar "flower" canvas. Pitch is
// mapped to angle + rainbow hue; holding a note grows that semitone's petal
// outward. The pure logic (sustain tracking, prompts, the final range/voice
// suggestion) lives in src/game/rangeFlower.ts; React drives start/finish and
// renders the HUD/results it reports back.

import { PitchAnalyser } from "./src/audio/pitch";
import { hzMidi, midiName, isSharp } from "./src/game/notes";
import {
  RANGE_LO,
  RANGE_HI,
  SUGGEST_MIN_SEC,
  angleFor,
  petalArc,
  colorFor,
  petalRadius01,
  SustainTracker,
  flowerStats,
  explorePrompt,
  buildRangeResult,
  RangeResult,
} from "./src/game/rangeFlower";
import { MicError } from "./engine";

export interface RangeHud {
  liveName: string; // detected note name, "—" when silent
  liveHz: string;
  prompt: string; // the current coaching line
  petals: number;
  heldSec: number;
}

export function blankRangeHud(): RangeHud {
  return {
    liveName: "—",
    liveHz: "",
    prompt: "Sing any comfortable note — a clear “ahh” — and hold it steady.",
    petals: 0,
    heldSec: 0,
  };
}

export interface RangeEngineOpts {
  onHud: (hud: RangeHud) => void;
  onEnd: (result: RangeResult | null) => void;
}

export class RangeExplorerEngine {
  private opts: RangeEngineOpts;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0;
  private H = 0;

  private audio: { stream: MediaStream; ctx: AudioContext } | null = null;
  private pitch: PitchAnalyser | null = null;
  // begin() may be called (player dismissed the intro) before start()'s mic
  // permission resolves; if so we remember the intent and auto-begin once the
  // audio graph is live. Without this the loop never starts → a blank canvas.
  private pendingBegin = false;

  private tracker = new SustainTracker();
  private t0 = 0;
  private raf = 0;
  private lastHud = 0;
  private curMidi: number | null = null; // fractional MIDI this frame

  private onResize = () => this.sizeCanvas();

  constructor(opts: RangeEngineOpts) {
    this.opts = opts;
    window.addEventListener("resize", this.onResize);
  }

  /** Ref callback from React: attach (or detach with null) the flower canvas. */
  setCanvas = (el: HTMLCanvasElement | null): void => {
    if (el === this.canvas) return;
    this.canvas = el;
    this.ctx = el ? el.getContext("2d") : null;
    if (el) this.sizeCanvas();
  };

  private sizeCanvas(): void {
    const el = this.canvas;
    if (!el || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = h;
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
    this.pitch = new PitchAnalyser(ctx, src, 4096);
    this.audio = { stream, ctx };
    // If the player already dismissed the intro while the mic prompt was open,
    // start now; otherwise the loop waits for begin().
    if (this.pendingBegin) {
      this.pendingBegin = false;
      this.startLoop();
    }
  }

  /** Start listening/drawing. Call after the intro card is dismissed. If the mic
   *  hasn't come up yet, defer until start() resolves (see pendingBegin). */
  begin(): void {
    if (this.audio) this.startLoop();
    else this.pendingBegin = true;
  }

  private startLoop(): void {
    this.tracker = new SustainTracker();
    this.t0 = performance.now() / 1000;
    this.lastHud = 0;
    this.curMidi = null;
    this.sizeCanvas();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  /** Ambient home-card preview: no mic, no scoring — the flower breathing with
   *  synthetic held petals and a live dot sweeping the range. Draws only while
   *  the tab is visible and a canvas is attached; destroy() tears it down. */
  startPreview(): void {
    this.t0 = performance.now() / 1000;
    cancelAnimationFrame(this.raf);
    const step = (): void => {
      this.raf = requestAnimationFrame(step);
      if (document.hidden || !this.ctx) return;
      this.drawPreviewFlower(performance.now() / 1000 - this.t0);
    };
    step();
  }

  /** The ambient flower for the tiny home-card windows. The full draw() is
   *  tuned for the big stage — its fixed 30px hub, hold-time rings, and 44px
   *  label margin leave no petal room on a 150px card (and none at all on the
   *  96×72 onramp window) — so the preview draws the same leaf shapes and
   *  pitch-rainbow colors at proportional sizes: one gently breathing petal
   *  every third semitone, a hub, and a bright dot sweeping the range. */
  private drawPreviewFlower(t: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W;
    const H = this.H;
    if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#14100b";
    ctx.fillRect(0, 0, W, H);
    const cx = W / 2;
    const cy = H * 0.54;
    const base = Math.min(W, H) * 0.1;
    const maxr = Math.min(W, H) * 0.46;
    const halfArc = petalArc() * 3 * 0.42; // one petal per 3 semitones
    const growAt = (i: number) => 0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.55);
    const rAt = (i: number) => base + (0.35 + 0.65 * growAt(i)) * (maxr - base);
    for (let m = RANGE_LO, i = 0; m <= RANGE_HI; m += 3, i++) {
      this.petal(ctx, cx, cy, angleFor(m), halfArc, rAt(i), m, 0.82);
    }
    // The hub, and a live dot riding whichever petal the sweep is passing.
    ctx.fillStyle = "#1d1610";
    ctx.strokeStyle = "#3a2f1c";
    ctx.beginPath();
    ctx.arc(cx, cy, base * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const midi = RANGE_LO + ((Math.sin(t * 0.35) + 1) / 2) * (RANGE_HI - RANGE_LO);
    const a = angleFor(midi);
    const r = rAt(Math.round((midi - RANGE_LO) / 3));
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = colorFor(midi, 1, 65);
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  /** The player is done exploring: stop the audio, freeze the flower, and
   *  report the range verdict (null = not enough sustained singing). */
  finish(): void {
    if (!this.audio) return;
    cancelAnimationFrame(this.raf);
    this.teardownAudio();
    this.draw(); // freeze the final flower for the results screen
    this.opts.onEnd(buildRangeResult(this.tracker.bins));
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
    this.pitch = null;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.audio || !this.pitch) return;
    const now = performance.now() / 1000 - this.t0;

    const pr = this.pitch.read();
    this.curMidi = pr ? hzMidi(pr.f0) : null;
    this.tracker.push(now, this.curMidi);

    this.draw();
    this.pushHud(now, pr ? pr.f0 : -1);
  };

  private pushHud(now: number, hz: number): void {
    if (now - this.lastHud < 0.08) return;
    this.lastHud = now;
    const stats = flowerStats(this.tracker.bins);
    this.opts.onHud({
      liveName: this.curMidi == null ? "—" : midiName(Math.round(this.curMidi)),
      liveHz: hz > 0 ? hz.toFixed(1) + " Hz" : "",
      prompt: explorePrompt(stats, now),
      petals: stats.petals,
      heldSec: stats.heldSec,
    });
  }

  // ---------- drawing ----------

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W;
    const H = this.H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0c0d12";
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const rBase = 30; // petals start just outside the center disc
    const maxR = Math.min(W, H) / 2 - 44;
    if (maxR <= rBase) return;
    const rFor = (sec: number) => rBase + petalRadius01(sec) * (maxR - rBase);
    const halfArc = petalArc() * 0.42; // petal half-width, with a sliver of gap

    // Faint hold-time rings (1s, 2s, 4s and the full-hold rim).
    ctx.lineWidth = 1;
    ctx.font = "9px 'Spline Sans Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const sec of [1, 2, 4, 6]) {
      const r = rFor(sec);
      ctx.strokeStyle = sec === 6 ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.045)";
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#565c6a";
      ctx.fillText(sec + "s", cx, cy + r + 8);
    }

    // Note spokes + labels at every C (octave marks), fainter ticks at naturals.
    for (let m = RANGE_LO; m <= RANGE_HI; m++) {
      if (isSharp(m)) continue;
      const a = angleFor(m);
      const isC = m % 12 === 0;
      const x1 = cx + Math.cos(a) * maxR;
      const y1 = cy + Math.sin(a) * maxR;
      ctx.strokeStyle = isC ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.03)";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rBase, cy + Math.sin(a) * rBase);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      if (isC) {
        ctx.fillStyle = "rgba(243,239,230,0.55)";
        ctx.font = "10px 'Spline Sans Mono', monospace";
        ctx.fillText(midiName(m), cx + Math.cos(a) * (maxR + 18), cy + Math.sin(a) * (maxR + 18));
      }
    }

    // The petals: one per semitone with any credited hold. Drawn as a leaf —
    // two quadratic curves from the center to the tip and back — glowing in
    // that pitch's rainbow hue; sustained petals (≥ the suggestion bar) pop.
    const bins = this.tracker.bins;
    for (let i = 0; i < bins.length; i++) {
      const sec = bins[i];
      if (sec <= 0) continue;
      const m = RANGE_LO + i;
      const a = angleFor(m);
      const r = rFor(sec);
      const sustained = sec >= SUGGEST_MIN_SEC;
      this.petal(ctx, cx, cy, a, halfArc, r, m, sustained ? 0.85 : 0.5);
    }

    // Current range extremes: bold radial lines marking the lowest and highest
    // notes held so far, so the player can see the reach they've established.
    const stats = flowerStats(bins);
    if (stats.loMidi != null) this.extremeMarker(ctx, cx, cy, rBase, maxR, stats.loMidi, "LOW");
    if (stats.hiMidi != null) this.extremeMarker(ctx, cx, cy, rBase, maxR, stats.hiMidi, "HIGH");

    // Live pitch: a soft ray at the current angle with a bright dot riding the
    // growing petal's tip, so holding visibly "pushes" the petal outward.
    if (this.curMidi != null && this.curMidi >= RANGE_LO - 0.5 && this.curMidi <= RANGE_HI + 0.5) {
      const a = angleFor(this.curMidi);
      const near = Math.round(this.curMidi);
      const tipR = rFor(this.tracker.heldFor(near));
      const col = colorFor(this.curMidi, 1, 65);
      ctx.strokeStyle = colorFor(this.curMidi, 0.28);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rBase, cy + Math.sin(a) * rBase);
      ctx.lineTo(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR);
      ctx.stroke();
      ctx.shadowColor = col;
      ctx.shadowBlur = 16;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * tipR, cy + Math.sin(a) * tipR, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Center disc: the note being sung right now, in its color.
    ctx.fillStyle = "#101218";
    ctx.strokeStyle = "#23262f";
    ctx.beginPath();
    ctx.arc(cx, cy, rBase - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (this.curMidi != null) {
      ctx.fillStyle = colorFor(this.curMidi, 1, 70);
      ctx.font = "600 15px 'Spline Sans Mono', monospace";
      ctx.fillText(midiName(Math.round(this.curMidi)), cx, cy + 0.5);
    } else {
      ctx.fillStyle = "#565c6a";
      ctx.font = "13px 'Spline Sans Mono', monospace";
      ctx.fillText("♪", cx, cy + 0.5);
    }
  }

  /** A bold radial line + rim label marking a current range extreme. */
  private extremeMarker(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rBase: number,
    maxR: number,
    midi: number,
    tag: "LOW" | "HIGH",
  ): void {
    const a = angleFor(midi);
    const col = colorFor(midi, 1, 66);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * rBase, cy + Math.sin(a) * rBase);
    ctx.lineTo(cx + Math.cos(a) * (maxR + 6), cy + Math.sin(a) * (maxR + 6));
    ctx.stroke();
    ctx.setLineDash([]);

    // A small label pill just outside the rim: "LOW · A2" / "HIGH · A4".
    const text = `${tag} · ${midiName(midi)}`;
    ctx.font = "600 10px 'Spline Sans Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lx = cx + Math.cos(a) * (maxR + 26);
    const ly = cy + Math.sin(a) * (maxR + 26);
    const tw = ctx.measureText(text).width;
    ctx.globalAlpha = 1;
    this.roundRectPath(ctx, lx - tw / 2 - 6, ly - 9, tw + 12, 18, 9);
    ctx.fillStyle = "rgba(10,11,15,0.9)";
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillText(text, lx, ly + 0.5);
    ctx.restore();
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** One leaf-shaped petal from the center disc out to radius r. */
  private petal(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    a: number,
    halfArc: number,
    r: number,
    midi: number,
    alpha: number,
  ): void {
    const bx = cx + Math.cos(a) * 6;
    const by = cy + Math.sin(a) * 6;
    const tx = cx + Math.cos(a) * r;
    const ty = cy + Math.sin(a) * r;
    const cr = r * 0.62; // control-point radius — sets the belly of the leaf
    const c1x = cx + Math.cos(a - halfArc * 1.6) * cr;
    const c1y = cy + Math.sin(a - halfArc * 1.6) * cr;
    const c2x = cx + Math.cos(a + halfArc * 1.6) * cr;
    const c2y = cy + Math.sin(a + halfArc * 1.6) * cr;
    ctx.fillStyle = colorFor(midi, alpha);
    ctx.shadowColor = colorFor(midi, 0.8);
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo(c1x, c1y, tx, ty);
    ctx.quadraticCurveTo(c2x, c2y, bx, by);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}
