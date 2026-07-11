// SingadoodleEngine — the imperative game core: microphone capture, the 60fps
// game loop, per-tick scoring, the canvas piano-roll, and HUD updates. It wraps
// the framework-free modules under src/ (pitch/tone/notes/scoring) without
// rewriting their tuned algorithms; React just drives start/stop and renders the
// HUD/summary it reports back. Persistence (IndexedDB, high scores) is the
// page's job — the engine only computes a finished session's result.

import { PitchAnalyser } from "./src/audio/pitch";
import { TonePlayer } from "./src/audio/tone";
import {
  VoiceId,
  LevelId,
  noteSet,
  buildSequence,
  buildTunePlan,
  PlayNote,
  TUNE_COUNT,
  midiName,
  midiHz,
  hzMidi,
  isSharp,
  NOTE_NAMES,
  CYCLE,
  CYCLE_TOTAL,
  SCORE_OFFSET,
  phaseOf,
  stepsRemaining,
  Phase,
} from "./src/game/notes";
import { centsOff, quality, accuracyRatio, tickPoints, VibratoDetector } from "./src/game/scoring";
import {
  drawPitchGraph,
  meanStd,
  isContinuous,
  GRAPH_CENTS,
  GraphBar,
} from "./src/game/pitchGraph";

const ACCENT = "#F4B23E";
const TEAL = "#35C4B5";
const GRAY = "#4a5060";

export interface Pill {
  label: string;
  color: string;
  bg: string;
  border: string;
}

export interface Hud {
  score: number;
  multLabel: string;
  multNote: string;
  multBg: string;
  multBorder: string;
  multFg: string;
  multSub: string;
  phaseLabel: string;
  phaseColor: string;
  phaseBg: string;
  phaseBorder: string;
  targetName: string;
  targetHz: string;
  noteCount: string;
  stepsLeft: number;
  stepsUnit: string;
  targetColor: string;
  liveName: string;
  liveCents: string;
  liveColor: string;
  vibrato: boolean;
  timerPct: number;
}

export interface PerNote {
  n: number;
  rSum: number;
  pts: number;
  // Cents-off running sums for the pitch graph (continuous samples only).
  cN: number;
  cSum: number;
  cSqSum: number;
}

export interface SessionResult {
  score: number;
  accuracy: number; // 0..100
  vibratoSec: number;
  bestNote: string;
  perNote: Record<string, PerNote>;
}

export interface EngineOpts {
  voiceId: VoiceId;
  level: LevelId;
  onHud: (hud: Hud) => void;
  onEnd: (result: SessionResult) => void;
}

export type MicError = "denied" | "error";

export function blankHud(): Hud {
  return {
    score: 0,
    multLabel: "×1",
    multNote: "find it",
    multBg: "transparent",
    multBorder: "var(--line-soft)",
    multFg: "var(--ink-faint)",
    multSub: "var(--ink-faint)",
    phaseLabel: "Ready",
    phaseColor: "var(--ink-faint)",
    phaseBg: "transparent",
    phaseBorder: "var(--line-soft)",
    targetName: "—",
    targetHz: "",
    noteCount: "",
    stepsLeft: 0,
    stepsUnit: "steps left",
    targetColor: "var(--ink-faint)",
    liveName: "—",
    liveCents: "",
    liveColor: "var(--ink-faint)",
    vibrato: false,
    timerPct: 0,
  };
}

export class SingadoodleEngine {
  private opts: EngineOpts;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0;
  private H = 0;

  // The pitch graph to the right of the grid (its own canvas, same pitch axis).
  private graphCanvas: HTMLCanvasElement | null = null;
  private gctx: CanvasRenderingContext2D | null = null;
  private gW = 0;
  private gH = 0;

  private audio: { stream: MediaStream; ctx: AudioContext } | null = null;
  private pitch: PitchAnalyser | null = null;
  private tone: TonePlayer | null = null;
  private fft: AnalyserNode | null = null;
  private freq = new Uint8Array(0);
  // begin() may fire (intro dismissed) before start()'s mic prompt resolves; if
  // so we defer the note session until the audio graph is live (blank-screen guard).
  private pendingBegin = false;

  private notes: PlayNote[] = [];
  private mode: "scale" | "tune" = "scale";
  // Expert level: hide the pitch target (dim full-height columns for timing only)
  // so the visual can't be used to check pitch.
  private hidePitch = false;
  private endAt = 0;
  private dLow = 0;
  private dHigh = 0;
  // The singer's actual note range (for the graph's note labels).
  private rangeLo = 0;
  private rangeHi = 0;
  // Discontinuity filter for the graph: the last note we sampled and the last
  // cents value, so we can drop jumps (octave/harmonic glitches, slides).
  private statNote: number | null = null;
  private statPrev: number | null = null;
  private t0 = 0;
  private raf = 0;
  private toneFor = -1;
  // When (session-relative seconds) the very first guide tone sounded; drives the
  // Training level's "start singing as soon as you hear the tone" coaching line.
  private toneStartedAt = -1;
  private lastNow: number | null = null;
  private tickAcc = 0;
  private lastHud = 0;

  private vib = new VibratoDetector();
  private trail: { t: number; m: number; q: number; vib: boolean }[] = [];
  // Detected fundamental + next two harmonics, for the spectrum debug overlay.
  private harm: { f: number[]; confident: boolean } | null = null;
  private cur = {
    hz: -1,
    midi: null as number | null,
    cents: null as number | null,
    q: 0,
    vibrato: false,
  };
  private sess = {
    score: 0,
    ticks: 0,
    qSum: 0,
    vibTicks: 0,
    perNote: {} as Record<string, PerNote>,
  };

  private onResize = () => {
    this.sizeCanvas();
    this.sizeGraphCanvas();
    this.drawGraph();
  };

  constructor(opts: EngineOpts) {
    this.opts = opts;
    window.addEventListener("resize", this.onResize);
  }

  /** Ref callback from React: attach (or detach with null) the pitch graph canvas. */
  setGraphCanvas = (el: HTMLCanvasElement | null): void => {
    if (el === this.graphCanvas) return;
    this.graphCanvas = el;
    this.gctx = el ? el.getContext("2d") : null;
    if (el) {
      this.sizeGraphCanvas();
      this.drawGraph(); // show the empty axis before the session begins
    }
  };

  private sizeGraphCanvas(): void {
    const el = this.graphCanvas;
    if (!el || !this.gctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    el.width = Math.round(w * dpr);
    el.height = Math.round(h * dpr);
    this.gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gW = w;
    this.gH = h;
  }

  /** Ref callback from React: attach (or detach with null) the play canvas. */
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

  /** Request the mic and begin the session. Rejects with a MicError on failure. */
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
    // 4096-sample (~93 ms) window: the AnalyserNode already slides this window
    // every frame, so reads overlap ~80%. The longer window roughly halves the
    // main-lobe width vs 2048, sharpening low-pitch harmonic separation and
    // steadying peaks, at the cost of a little response/vibrato smearing.
    this.pitch = new PitchAnalyser(ctx, src, 4096);
    this.tone = new TonePlayer(ctx);
    const fft = ctx.createAnalyser();
    // Large FFT so there's a real frequency bin behind every bar of the
    // fine-grained 0–2400 Hz spectrum drawn along the canvas bottom.
    fft.fftSize = 16384;
    fft.smoothingTimeConstant = 0.78;
    src.connect(fft);
    this.fft = fft;
    this.freq = new Uint8Array(fft.frequencyBinCount);
    this.audio = { stream, ctx };
    // The mic + audio graph are live, but the note session waits for begin() so
    // the page can show its "before you begin" card first without the clock
    // (and scoring) already running behind it. If the player dismissed that card
    // while the mic prompt was still open, begin() already fired — start now.
    if (this.pendingBegin) {
      this.pendingBegin = false;
      this.beginSession();
    }
  }

  /** Start the note session. Call once the player has dismissed the intro card.
   *  If the mic hasn't come up yet, defer until start() resolves (pendingBegin). */
  begin(): void {
    if (this.audio) this.beginSession();
    else this.pendingBegin = true;
  }

  private beginSession(): void {
    this.hidePitch = this.opts.level === 4;
    if (this.opts.level !== 0) {
      // Tune levels (1–4): short made-up tunes, sung back from memory. Level 4
      // (Expert) also hides the pitch target.
      const plan = buildTunePlan(this.opts.voiceId, this.opts.level, Math.random);
      this.notes = plan.notes;
      this.mode = "tune";
      this.rangeLo = plan.lo;
      this.rangeHi = plan.hi;
      this.dLow = plan.lo - 1.5;
      this.dHigh = plan.hi + 1.5;
      this.endAt = plan.endAt;
    } else {
      // Training (level 0): the five-note set, up then down, with a guide tone.
      const { lo, hi, set } = noteSet(this.opts.voiceId, this.opts.level);
      const seq = buildSequence(set, false);
      this.notes = seq.map((m, i) => {
        const c = i * CYCLE_TOTAL;
        return {
          midi: m,
          cycle: c,
          scoreStart: c + SCORE_OFFSET,
          scoreLen: CYCLE.SCORE,
          toneStart: c + CYCLE.REST, // tone sounds Preview → end of Sing
          toneEnd: c + CYCLE_TOTAL,
          tune: 0,
        };
      });
      this.mode = "scale";
      this.rangeLo = lo;
      this.rangeHi = hi;
      this.dLow = lo - 1.5;
      this.dHigh = hi + 1.5;
      this.endAt = seq.length * CYCLE_TOTAL + 0.3;
    }
    this.t0 = performance.now() / 1000;
    this.trail = [];
    this.harm = null;
    this.vib.reset();
    this.tickAcc = 0;
    this.lastNow = null;
    this.toneFor = -1;
    this.toneStartedAt = -1;
    this.statNote = null;
    this.statPrev = null;
    this.lastHud = 0;
    this.cur = { hz: -1, midi: null, cents: null, q: 0, vibrato: false };
    this.sess = { score: 0, ticks: 0, qSum: 0, vibTicks: 0, perNote: {} };
    this.sizeCanvas();
    this.sizeGraphCanvas();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  /** End the session early (e.g. the player taps "End session"). */
  stop(): void {
    if (this.audio) this.endSession();
  }

  /** Ambient home-card preview: no mic, no scoring, no HUD — a looping snippet
   *  of the piano roll with target blocks crossing the playhead and a synthetic
   *  voice tracing them. Draws only while the tab is visible and a canvas is
   *  attached; destroy() tears it down. */
  startPreview(): void {
    const LOOP = 8; // seconds; the melody repeats seamlessly
    const MELODY: { m: number; s: number }[] = [
      { m: 62, s: 0 },
      { m: 64, s: 1.2 },
      { m: 60, s: 2.5 },
      { m: 67, s: 3.7 },
      { m: 62, s: 5 },
      { m: 65, s: 6.2 },
      { m: 59, s: 7.2 },
    ];
    this.mode = "tune";
    this.hidePitch = false;
    this.dLow = 57.5;
    this.dHigh = 69.5;
    this.rangeLo = 59;
    this.rangeHi = 68;
    this.trail = [];
    this.t0 = performance.now() / 1000;
    cancelAnimationFrame(this.raf);
    const step = (): void => {
      this.raf = requestAnimationFrame(step);
      if (document.hidden || !this.ctx) return;
      const now = performance.now() / 1000 - this.t0;
      // Rebuild the visible window of looping notes each frame (cheap).
      const base = LOOP * Math.floor(now / LOOP);
      this.notes = [];
      for (const off of [base - LOOP, base, base + LOOP]) {
        for (const n of MELODY) {
          this.notes.push({
            midi: n.m,
            cycle: n.s + off,
            scoreStart: n.s + off,
            scoreLen: 0.9,
            toneStart: -1,
            toneEnd: -1,
            tune: 0,
          });
        }
      }
      // The synthetic voice hums along: it settles on whichever target is at
      // (or just leaving) the playhead, with a gentle human wobble.
      let target = MELODY[0].m;
      for (const n of this.notes) {
        if (n.scoreStart <= now + 0.25 && now < n.scoreStart + n.scoreLen + 0.5) target = n.midi;
      }
      const m = target + Math.sin(now * 5.2) * 0.07 + Math.sin(now * 0.9) * 0.05;
      this.trail.push({ t: now, m, q: 2, vib: false });
      while (this.trail.length && now - this.trail[0].t > 2.4) this.trail.shift();
      this.cur = { hz: midiHz(m), midi: m, cents: 8, q: 2, vibrato: false };
      this.draw(now, "score", null);
    };
    step();
  }

  /** Tear everything down (call on unmount). */
  destroy(): void {
    this.pendingBegin = false;
    cancelAnimationFrame(this.raf);
    this.teardownAudio();
    window.removeEventListener("resize", this.onResize);
  }

  private teardownAudio(): void {
    this.tone?.stop();
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
    this.tone = null;
    this.fft = null;
  }

  private curNote(now: number): PlayNote | null {
    for (const n of this.notes) if (now >= n.cycle && now < n.cycle + CYCLE_TOTAL) return n;
    return null;
  }

  /** Is this note's supporting/preview tone sounding right now? */
  private isPreview(n: PlayNote, now: number): boolean {
    if (this.mode === "scale") return phaseOf(now - n.cycle) === "preview";
    return now >= n.toneStart && now < n.toneEnd;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.audio || !this.pitch) return;
    const now = performance.now() / 1000 - this.t0;

    // Which note (if any) is being scored, which note's tone should sound, and
    // the note + phase to show in the HUD. Scale mode runs each note through an
    // 11s rest/preview/prep/sing cycle; tune mode plays the whole tune as guide
    // tones up front, then scores the notes back-to-back with no tone.
    let cn: PlayNote | null;
    let ph: Phase;
    let scoring: PlayNote | null;
    let toneNote: PlayNote | null;
    if (this.mode === "scale") {
      cn = this.curNote(now);
      ph = cn ? phaseOf(now - cn.cycle) : "done";
      scoring = cn && ph === "score" ? cn : null;
      toneNote = cn && (ph === "preview" || ph === "prep" || ph === "score") ? cn : null;
    } else {
      scoring = null;
      toneNote = null;
      for (const n of this.notes) {
        if (now >= n.scoreStart && now < n.scoreStart + n.scoreLen) scoring = n;
        if (now >= n.toneStart && now < n.toneEnd) toneNote = n;
      }
      if (scoring) {
        cn = scoring;
        ph = "score";
      } else if (toneNote) {
        cn = toneNote;
        ph = "preview"; // "Listen" — the tune is playing
      } else {
        cn = this.notes.find((n) => n.scoreStart > now) ?? null;
        ph = cn && cn.scoreStart - now <= CYCLE.PREP + 0.3 ? "prep" : "rest";
      }
    }

    // Read pitch. Tone subtraction is currently disabled — detection relies on
    // the voice's harmonic structure to tell the singer apart from the tone.
    const pr = this.pitch.read();
    const hz = pr ? pr.f0 : -1;
    this.harm = pr ? { f: [pr.f0, pr.f1, pr.f2], confident: pr.confident } : null;

    if (toneNote) {
      if (this.toneStartedAt < 0) this.toneStartedAt = now;
      const idx = this.notes.indexOf(toneNote);
      if (this.toneFor !== idx) {
        this.tone?.play(toneNote.midi);
        this.toneFor = idx;
      }
    } else if (this.toneFor !== -1) {
      this.tone?.stop();
      this.toneFor = -1;
    }

    let cents: number | null = null;
    let midiF: number | null = null;
    if (hz > 0) {
      midiF = hzMidi(hz);
      if (scoring) cents = centsOff(hz, scoring.midi);
    }

    if (scoring && cents !== null) this.vib.push(now, cents);
    else if (!scoring) this.vib.reset();
    const vibrato = this.vib.active();
    const q = scoring && cents !== null ? quality(Math.abs(cents)) : 0;

    if (midiF !== null) this.trail.push({ t: now, m: midiF, q, vib: vibrato });
    while (this.trail.length && now - this.trail[0].t > 2.4) this.trail.shift();

    this.cur = { hz, midi: midiF, cents, q, vibrato };
    this.scoreStep(now, scoring, vibrato);

    if (now > this.endAt) {
      this.endSession();
      return;
    }

    this.draw(now, ph, cn);
    this.drawGraph();
    this.pushHud(now, cn, ph, scoring, q, vibrato);
  };

  /** Repaint the pitch graph from the session's per-note cents stats. Renders an
   *  empty axis (falling back to the opts range) before the session begins. */
  private drawGraph(): void {
    if (!this.gctx) return;
    let { dLow, dHigh, rangeLo: lo, rangeHi: hi } = this;
    if (dHigh <= dLow) {
      const r = noteSet(this.opts.voiceId, this.opts.level);
      lo = r.lo;
      hi = r.hi;
      dLow = lo - 1.5;
      dHigh = hi + 1.5;
    }
    const bars: Record<number, GraphBar> = {};
    for (const key in this.sess.perNote) {
      const pn = this.sess.perNote[key];
      if (pn.cN > 0) bars[Number(key)] = meanStd(pn.cN, pn.cSum, pn.cSqSum);
    }
    drawPitchGraph(this.gctx, { W: this.gW, H: this.gH, dLow, dHigh, lo, hi, bars });
  }

  private scoreStep(now: number, scoring: PlayNote | null, vibrato: boolean): void {
    if (this.lastNow == null) this.lastNow = now;
    let dt = now - this.lastNow;
    this.lastNow = now;
    if (dt < 0 || dt > 0.5) dt = 0;
    if (!scoring) {
      this.tickAcc = 0;
      this.statPrev = null; // between notes: the next note starts a fresh run
      return;
    }
    this.tickAcc += dt;
    while (this.tickAcc >= 0.1) {
      this.tickAcc -= 0.1;
      const cents = this.cur.cents;
      const ac = cents == null ? 999 : Math.abs(cents);
      const pts = tickPoints(ac, vibrato);
      const ratio = cents == null ? 0 : accuracyRatio(ac);
      this.sess.score += pts;
      this.sess.ticks++;
      this.sess.qSum += ratio;
      if (vibrato && quality(ac) > 0) this.sess.vibTicks++;
      const key = String(scoring.midi);
      const pn =
        this.sess.perNote[key] ||
        (this.sess.perNote[key] = { n: 0, rSum: 0, pts: 0, cN: 0, cSum: 0, cSqSum: 0 });
      pn.n++;
      pn.rSum += ratio;
      pn.pts += pts;

      // Feed the pitch graph: only continuous samples within the ±graph window,
      // so octave/harmonic glitches and slides don't skew a note's average.
      if (cents != null && Math.abs(cents) <= GRAPH_CENTS) {
        if (this.statNote !== scoring.midi) {
          this.statNote = scoring.midi;
          this.statPrev = null;
        }
        if (isContinuous(this.statPrev, cents)) {
          pn.cN++;
          pn.cSum += cents;
          pn.cSqSum += cents * cents;
        }
        this.statPrev = cents;
      }
    }
  }

  private endSession(): void {
    cancelAnimationFrame(this.raf);
    this.teardownAudio();
    this.drawGraph(); // freeze the final graph for the "done" screen
    const s = this.sess;
    const score = Math.round(s.score);
    const accuracy = s.ticks ? Math.round((s.qSum / s.ticks) * 100) : 0;
    let bestNote = "—";
    let bestR = -1;
    for (const m in s.perNote) {
      const pn = s.perNote[m];
      const r = pn.n ? pn.rSum / pn.n : 0;
      if (r > bestR && pn.n > 3) {
        bestR = r;
        bestNote = midiName(Number(m));
      }
    }
    this.opts.onEnd({
      score,
      accuracy,
      vibratoSec: s.vibTicks / 10,
      bestNote,
      perNote: s.perNote,
    });
  }

  // ---------- drawing ----------
  private yFor(m: number): number {
    return this.H - ((m - this.dLow) / (this.dHigh - this.dLow)) * this.H;
  }

  private qColor(q: number, vib: boolean): string {
    if (vib) return TEAL;
    if (q >= 5) return "#ffffff";
    if (q >= 2) return ACCENT;
    if (q >= 1) return "#b9863a";
    return GRAY;
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    r = Math.min(r, h / 2, Math.abs(w) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private draw(now: number, _ph: Phase, cn: PlayNote | null): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W;
    const H = this.H;
    const playX = W * 0.27;
    const pps = (W * 0.72) / 7.0;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0c0d12";
    ctx.fillRect(0, 0, W, H);

    // Ambient FFT spectrum along the bottom — fine-grained, capped at 2400 Hz.
    if (this.fft) {
      this.fft.getByteFrequencyData(this.freq);
      const TOP_HZ = 2400;
      const nyquist = this.fft.context.sampleRate / 2;
      const topBin = Math.max(
        1,
        Math.min(this.freq.length, Math.round((TOP_HZ / nyquist) * this.freq.length)),
      );
      const bars = 880;
      const bw = W / bars;
      for (let i = 0; i < bars; i++) {
        const bin = Math.min(topBin - 1, Math.floor((i / bars) * topBin));
        const v = this.freq[bin] / 255;
        const bh = v * 90;
        ctx.fillStyle = "rgba(244,178,62," + (0.04 + v * 0.1) + ")";
        ctx.fillRect(i * bw, H - bh, bw + 0.5, bh);
      }

      // Debug overlay: mark the detector's fundamental f₀ and the next two
      // harmonics f₁/f₂ (the actual peaks it chose). If detection is right
      // these land on real peaks above; a leaked off-pitch tone shows up as an
      // UNmarked peak. Amber = best-guess fallback (no harmonic set found).
      if (this.harm) {
        const [m0, m1, m2] = this.harm.f;
        const fundCol = this.harm.confident ? "#ffffff" : ACCENT;
        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        const marks: [number, string, boolean][] = [
          [m0, "f₀", true],
          [m1, "f₁", false],
          [m2, "f₂", false],
        ];
        for (const [f, label, isFund] of marks) {
          if (f <= 0 || f > TOP_HZ) continue;
          const x = (f / TOP_HZ) * W;
          const col = isFund ? fundCol : TEAL;
          ctx.strokeStyle = col;
          ctx.fillStyle = col;
          ctx.globalAlpha = isFund ? 0.92 : 0.5;
          ctx.lineWidth = isFund ? 2 : 1.4;
          ctx.beginPath();
          ctx.moveTo(x, H);
          ctx.lineTo(x, H - 108);
          ctx.stroke();
          ctx.globalAlpha = isFund ? 1 : 0.7;
          ctx.beginPath();
          ctx.arc(x, H - 108, isFund ? 3.2 : 2.4, 0, 7);
          ctx.fill();
          ctx.font = (isFund ? "600 11px " : "10px ") + "'Spline Sans Mono', monospace";
          ctx.fillText(label, x, H - 116);
        }
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = fundCol;
        ctx.font = "10px 'Spline Sans Mono', monospace";
        ctx.fillText(
          Math.round(m0) + " Hz" + (this.harm.confident ? "" : " ?"),
          (Math.min(m0, TOP_HZ) / TOP_HZ) * W,
          H - 130,
        );
        ctx.restore();
      }
    }

    // Semitone grid; naturals labelled, C's brightest, sharps fainter.
    ctx.font = "10px 'Spline Sans Mono', monospace";
    ctx.textBaseline = "middle";
    const loM = Math.ceil(this.dLow);
    const hiM = Math.floor(this.dHigh);
    for (let m = loM; m <= hiM; m++) {
      const y = this.yFor(m);
      const sharp = isSharp(m);
      ctx.strokeStyle = sharp ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      if (!sharp) {
        ctx.fillStyle = m % 12 === 0 ? "rgba(243,239,230,0.55)" : "rgba(138,144,160,0.4)";
        ctx.fillText(midiName(m), 8, y);
      }
    }

    // Target blocks scrolling right→left.
    const laneH = H / (this.dHigh - this.dLow);
    for (const n of this.notes) {
      const sStart = n.scoreStart;
      const x1 = playX + (sStart - now) * pps;
      const x2 = playX + (sStart + n.scoreLen - now) * pps;
      if (x2 < -40 || x1 > W) continue;
      const isScore = now >= sStart && now <= sStart + n.scoreLen;
      const isPrev = this.isPreview(n, now);

      // Expert level: reveal only timing, never pitch — a dim full-height column
      // where the note's sing window crosses, brighter while it's being scored.
      if (this.hidePitch) {
        const cbx = Math.max(x1, 0);
        const cw = Math.min(x2, W) - cbx;
        if (cw > 0) {
          ctx.fillStyle = isScore ? "rgba(244,178,62,0.12)" : "rgba(255,255,255,0.05)";
          ctx.fillRect(cbx, 0, cw, H);
        }
        continue;
      }

      const y = this.yFor(n.midi);
      const h = Math.min(laneH * 0.82, 20);
      if (isScore) {
        ctx.fillStyle = "rgba(244,178,62,0.07)";
        ctx.fillRect(0, y - laneH / 2, W, laneH);
      } else if (isPrev) {
        ctx.fillStyle = "rgba(53,196,181,0.06)";
        ctx.fillRect(0, y - laneH / 2, W, laneH);
      }
      ctx.fillStyle = isScore
        ? "rgba(244,178,62,0.9)"
        : isPrev
          ? "rgba(53,196,181,0.55)"
          : "rgba(244,178,62,0.2)";
      const bx = Math.max(x1, -20);
      this.roundRect(ctx, bx, y - h / 2, Math.min(x2, W + 20) - bx, h, 4);
      ctx.fill();
      if (isScore) {
        ctx.fillStyle = "#0a0b0f";
        ctx.font = "600 13px 'Spline Sans Mono', monospace";
        ctx.fillText(midiName(n.midi), Math.max(x1, playX) + 8, y);
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(playX, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isPrev) {
        ctx.fillStyle = "#0a0b0f";
        ctx.font = "12px 'Spline Sans Mono', monospace";
        ctx.fillText("♪", Math.max(x1, 2) + 6, y);
      }
    }

    // The player's recent-pitch ribbon, colored by accuracy.
    if (this.trail.length > 1) {
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      for (let i = 1; i < this.trail.length; i++) {
        const p0 = this.trail[i - 1];
        const p1 = this.trail[i];
        const X0 = playX + (p0.t - now) * pps;
        const X1 = playX + (p1.t - now) * pps;
        if (X1 > playX) continue;
        ctx.strokeStyle = this.qColor(p1.q, p1.vib);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(X0, this.yFor(p0.m));
        ctx.lineTo(X1, this.yFor(p1.m));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // The live pitch dot at the playhead, glowing with closeness.
    if (this.cur.midi !== null) {
      const y = this.yFor(this.cur.midi);
      const ratio = this.cur.cents == null ? 0 : Math.max(0, 1 - Math.abs(this.cur.cents) / 100);
      const col = this.cur.vibrato ? TEAL : ACCENT;
      ctx.shadowColor = col;
      ctx.shadowBlur = 6 + ratio * 22;
      ctx.fillStyle = ratio > 0.78 ? "#ffffff" : col;
      ctx.beginPath();
      ctx.arc(playX, y, 5 + ratio * 3.5, 0, 7);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (ratio > 0.78) {
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(playX, y, 9 + ratio * 4, 0, 7);
        ctx.stroke();
      }
    }

    // Playhead.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, H);
    ctx.stroke();

    // Training coach: a pill sitting just above the current note's lane, its left
    // edge on the playhead, prompting the player to sing the moment the tone lands.
    if (this.opts.level === 0 && this.toneStartedAt >= 0 && cn && this.notes.indexOf(cn) === 0) {
      const msg = "Start singing as soon as you hear the tone";
      ctx.save();
      ctx.globalAlpha = Math.min(1, (now - this.toneStartedAt) / 0.5); // brief fade-in
      ctx.font = "13px 'Spline Sans Mono', monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const padX = 13;
      const boxH = 28;
      const tw = ctx.measureText(msg).width;
      const laneH = H / (this.dHigh - this.dLow);
      const barTop = this.yFor(cn.midi) - Math.min(laneH * 0.82, 20) / 2;
      const cy = barTop - 10 - boxH / 2; // centre the pill 10px above the bar
      const bx = Math.max(4, Math.min(playX, W - tw - padX * 2 - 4));
      this.roundRect(ctx, bx, cy - boxH / 2, tw + padX * 2, boxH, boxH / 2);
      ctx.fillStyle = "rgba(20,16,8,0.85)";
      ctx.fill();
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = ACCENT;
      ctx.fillText(msg, bx + padX, cy + 0.5);
      ctx.restore();
    }
  }

  // ---------- HUD ----------
  private pushHud(
    now: number,
    cn: PlayNote | null,
    ph: Phase,
    scoring: PlayNote | null,
    q: number,
    vibrato: boolean,
  ): void {
    if (now - this.lastHud < 0.08) return;
    this.lastHud = now;
    const noteCount =
      this.mode === "tune"
        ? cn
          ? `Tune ${cn.tune + 1} / ${TUNE_COUNT}`
          : ""
        : (cn ? this.notes.indexOf(cn) + 1 : this.notes.length) + " / " + this.notes.length;

    // "Steps left" for the prominent upper-right indicator: notes remaining in
    // scale mode, tunes remaining at level 4 (both count the item in play).
    const stepsTotal = this.mode === "tune" ? TUNE_COUNT : this.notes.length;
    const stepIdx = cn ? (this.mode === "tune" ? cn.tune : this.notes.indexOf(cn)) : null;
    const stepsLeft = stepsRemaining(stepsTotal, stepIdx);
    const stepsUnit = this.mode === "tune" ? "tunes left" : "steps left";

    let mult = {
      multLabel: "×1",
      multNote: "find it",
      multBg: "transparent",
      multBorder: "var(--line-soft)",
      multFg: "var(--ink-faint)",
      multSub: "var(--ink-faint)",
    };
    if (vibrato && q > 0)
      mult = {
        multLabel: "×10",
        multNote: "vibrato",
        multBg: "rgba(53,196,181,0.14)",
        multBorder: TEAL,
        multFg: TEAL,
        multSub: TEAL,
      };
    else if (q >= 5)
      mult = {
        multLabel: "×5",
        multNote: "locked",
        multBg: "rgba(244,178,62,0.16)",
        multBorder: ACCENT,
        multFg: ACCENT,
        multSub: "var(--amber)",
      };
    else if (q >= 2)
      mult = {
        multLabel: "×2",
        multNote: "close",
        multBg: "rgba(244,178,62,0.10)",
        multBorder: "var(--amber)",
        multFg: ACCENT,
        multSub: "var(--ink-faint)",
      };
    else if (q >= 1)
      mult = {
        multLabel: "×1",
        multNote: "warm",
        multBg: "rgba(244,178,62,0.05)",
        multBorder: "var(--line)",
        multFg: "var(--amber)",
        multSub: "var(--ink-faint)",
      };

    const phaseMap: Record<
      Phase,
      {
        phaseLabel: string;
        phaseColor: string;
        phaseBg: string;
        phaseBorder: string;
      }
    > = {
      rest: {
        phaseLabel: "Breathe",
        phaseColor: "var(--ink-faint)",
        phaseBg: "transparent",
        phaseBorder: "var(--line-soft)",
      },
      preview: {
        phaseLabel: "Listen",
        phaseColor: TEAL,
        phaseBg: "rgba(53,196,181,0.12)",
        phaseBorder: TEAL,
      },
      prep: {
        phaseLabel: "Get ready",
        phaseColor: "var(--amber)",
        phaseBg: "rgba(244,178,62,0.06)",
        phaseBorder: "var(--line)",
      },
      score: {
        phaseLabel: "Sing",
        phaseColor: ACCENT,
        phaseBg: "rgba(244,178,62,0.14)",
        phaseBorder: ACCENT,
      },
      done: {
        phaseLabel: "—",
        phaseColor: "var(--ink-faint)",
        phaseBg: "transparent",
        phaseBorder: "var(--line-soft)",
      },
    };
    const pm = phaseMap[ph] || phaseMap.done;

    const c = this.cur;
    const liveColor =
      c.midi == null ? "var(--ink-faint)" : c.vibrato ? TEAL : q >= 2 ? ACCENT : "var(--ink-dim)";
    const liveName = c.midi == null ? "—" : midiName(Math.round(c.midi));
    let liveCents = c.midi == null ? "silent" : midiName(Math.round(c.midi));
    if (c.midi != null && scoring)
      liveCents = c.cents == null ? "—" : (c.cents >= 0 ? "+" : "") + Math.round(c.cents) + "¢";

    const timerPct = scoring
      ? Math.max(0, 1 - (now - scoring.scoreStart) / scoring.scoreLen) * 100
      : 0;
    const targetColor = ph === "preview" ? TEAL : ph === "score" ? ACCENT : "var(--ink-dim)";

    this.opts.onHud({
      score: Math.round(this.sess.score),
      ...mult,
      ...pm,
      targetName: cn ? midiName(cn.midi) : "—",
      targetHz: cn ? midiHz(cn.midi).toFixed(1) + " Hz" : "",
      noteCount,
      stepsLeft,
      stepsUnit,
      targetColor,
      liveName,
      liveCents,
      liveColor,
      vibrato: !!(vibrato && q > 0),
      timerPct,
    });
  }
}

// Re-export the name-cycle helper for the page's pitch map / labels.
export { NOTE_NAMES };
