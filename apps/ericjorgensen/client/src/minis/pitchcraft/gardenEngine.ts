// VoiceGardenEngine — the imperative core of the Voice Garden: microphone
// capture, the 60fps loop, and the canvas scene. A side-view night garden with
// sky above and earth below. A soft shaft of light stands over the garden —
// steered by the pointer, or sweeping edge-to-edge in rhythm mode — and every
// sung tone grows something where the light falls, LIVE: the moment a voice is
// heard a plant is born and visibly creeps outward, segment by segment, for as
// long as the tone continues. Low tones weave mycelium that fruits into
// mushroom clusters; mid tones grow grass and wildflowers with shallow roots;
// high tones raise ornamental trees whose trunks and deep roots thicken and
// branch as they grow — or loose a butterfly when the voice dances. The
// highest notes also bloom in the sky as slowly-turning fractal bursts. New
// growth sprouts in front of old; plants buried behind enough newer growth
// die back into the soil (see applyOcclusion). The garden object is owned by
// the page (IndexedDB — a living archive); growth rules live in
// src/game/voiceGarden.ts.
//
// Rendering notes:
// - Finished plants are pre-rendered onto an offscreen "static" layer; each
//   frame animates only the sky, shimmer, butterflies, the growing plant, and
//   the light. Plant geometry is computed deterministically from each
//   element's seed, then *revealed* in stages (with partial final segments),
//   so a plant unfolds along the exact shape it will keep forever. Randomness
//   is always consumed in the same order regardless of growth, so a
//   half-grown plant is a strict prefix of its full self.
// - Every settled plant leaves a "focal" point collected while the static
//   layer renders; a cheap additive shimmer pass breathes hue-cycling light
//   over those points every frame, so the still garden never looks dead.

import { PitchAnalyser } from "./src/audio/pitch";
import { VoiceId, midiName, hzMidi } from "./src/game/notes";
import { hueFor } from "./src/game/rangeFlower";
import {
  Garden,
  GardenElement,
  ElementKind,
  FULL_STROKE_SEC,
  lightX01,
  LIGHT_PERIOD_SEC,
  LIGHT_MIN_X,
  LIGHT_MAX_X,
  bandFor,
  zoneFor,
  earthDepth01,
  skyBand01,
  mushroomVariety,
  wobble01,
  strokeSize01,
  elementFromStroke,
  addElement,
  applyOcclusion,
  gardenAgeDays,
  countByKind,
  StrokeTracker,
  gardenPrompt,
} from "./src/game/voiceGarden";
import { MicError } from "./engine";

export interface GardenHud {
  liveName: string;
  liveHz: string;
  zoneLabel: string; // where the current tone is growing
  stabilityLabel: string; // steady / swaying / wild
  prompt: string;
  total: number; // elements in the whole garden
  grown: number; // grown this visit
  ageDays: number;
}

export function blankGardenHud(): GardenHud {
  return {
    liveName: "—",
    liveHz: "",
    zoneLabel: "",
    stabilityLabel: "",
    prompt: "Sing a soft, steady note — anywhere in your voice — and hold it.",
    total: 0,
    grown: 0,
    ageDays: 0,
  };
}

/** What this visit grew — for the rest-screen recap. */
export interface GardenRecap {
  grown: number;
  counts: Record<ElementKind, number>; // this visit only
  total: number;
  ageDays: number;
}

export interface GardenEngineOpts {
  voiceId: VoiceId;
  garden: Garden; // the persistent garden (page owns persistence)
  onHud: (hud: GardenHud) => void;
  onGrow: (garden: Garden, el: GardenElement) => void; // page saves here
  onEnd: (recap: GardenRecap) => void;
}

/** Deterministic PRNG (mulberry32) so a persisted element redraws identically. */
function rng32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far along a staged part is at overall growth g: 0 before b0, 1 at b1. */
function stage(g: number, b0: number, b1: number): number {
  return Math.min(1, Math.max(0, (g - b0) / (b1 - b0)));
}

interface Pt {
  x: number;
  y: number;
}

/** A wandering path from (x,y) along `ang`, as precomputed points. The wiggle
 *  is fully seeded, so the same rng always walks the same path. */
function wanderPath(
  x: number,
  y: number,
  ang: number,
  len: number,
  segs: number,
  wiggle: number,
  r: () => number,
): Pt[] {
  const pts = [{ x, y }];
  let a = ang;
  for (let s = 0; s < segs; s++) {
    a += (r() - 0.5) * wiggle;
    x += Math.cos(a) * (len / segs);
    y += Math.sin(a) * (len / segs);
    pts.push({ x, y });
  }
  return pts;
}

/** Chaikin corner-cutting (×2): rounds a polyline into a smooth curve without
 *  any randomness, so revealed growth still follows a stable shape. */
function smoothPts(pts: Pt[], iterations = 2): Pt[] {
  let out = pts;
  for (let it = 0; it < iterations; it++) {
    const s: Pt[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      s.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      s.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    s.push(out[out.length - 1]);
    out = s;
  }
  return out;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  hue: number;
  kind: "mote" | "spark";
}

// A fractal sky burst: a dendritic structure (precomputed once, in coordinates
// relative to its center) stamped with N-fold radial symmetry, unfolding and
// slowly turning while its hues cycle — reads as storm-lightning becoming a
// nebula, then fading back into the night.
interface BurstPath {
  pts: Pt[];
  depth: number;
  b0: number; // unfold stage at which this branch starts growing
  w: number; // base stroke width
}

interface SkyBurst {
  x: number;
  y: number;
  born: number; // session seconds
  life: number;
  sym: number; // rotational symmetry
  baseHue: number;
  intensity: number;
  paths: BurstPath[];
}

export class VoiceGardenEngine {
  private opts: GardenEngineOpts;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private W = 0;
  private H = 0;

  // Finished plants render once onto this layer; only living things animate.
  private staticLayer: HTMLCanvasElement | null = null;
  // Shimmer anchors gathered while the static layer renders.
  private focals: { x: number; y: number; el: GardenElement }[] = [];
  private focalSink: { x: number; y: number; el: GardenElement }[] | null = null;

  private audio: { stream: MediaStream; ctx: AudioContext } | null = null;
  private pitch: PitchAnalyser | null = null;
  private pendingBegin = false; // begin() before the mic resolves defers (blank-screen guard)

  private tracker = new StrokeTracker();
  // The plant currently unfolding under the voice. It joins the garden only
  // when its stroke finishes; a too-short blip quietly vanishes.
  private growing: GardenElement | null = null;
  private sessionCounts = countByKind([]);
  private sessionGrown = 0;
  private t0 = 0;
  private raf = 0;
  private lastNow: number | null = null;
  private lastHud = 0;

  private curMidi: number | null = null;
  private curHz = -1;
  // Rolling recent pitches (~0.8s) for the live steadiness readout.
  private recent: { t: number; m: number }[] = [];
  // The sky's blessing: swells while the player sings (fastest for high tones),
  // fades in silence. Drives the aurora, the stars, and the bursts.
  private blessing = 0;
  private particles: Particle[] = [];
  private bursts: SkyBurst[] = [];
  private lastBurstAt = -9;

  // The light: pointer-steered by default; rhythm mode sweeps edge to edge.
  private lightX = 0.5;
  private rhythm = false;
  private rhythmOffset = 0; // phase offset so toggling rhythm doesn't jump

  private onResize = () => {
    this.sizeCanvas();
    this.renderStatic();
  };
  private onPointer = (e: PointerEvent) => {
    const el = this.canvas;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      this.lightX = Math.min(
        LIGHT_MAX_X,
        Math.max(LIGHT_MIN_X, (e.clientX - rect.left) / rect.width),
      );
    }
  };

  constructor(opts: GardenEngineOpts) {
    this.opts = opts;
    window.addEventListener("resize", this.onResize);
  }

  /** Ref callback from React: attach (or detach with null) the garden canvas. */
  setCanvas = (el: HTMLCanvasElement | null): void => {
    if (el === this.canvas) return;
    this.canvas?.removeEventListener("pointermove", this.onPointer);
    this.canvas?.removeEventListener("pointerdown", this.onPointer);
    this.canvas = el;
    this.ctx = el ? el.getContext("2d") : null;
    if (el) {
      el.addEventListener("pointermove", this.onPointer);
      el.addEventListener("pointerdown", this.onPointer);
      this.sizeCanvas();
      this.renderStatic();
    }
  };

  /** Rhythm mode on/off. Turning it on picks the sweep phase that starts from
   *  the light's current position, so it glides rather than jumps. */
  setRhythm(on: boolean): void {
    if (on === this.rhythm) return;
    this.rhythm = on;
    if (on) {
      const now = performance.now() / 1000 - this.t0;
      const f = (this.lightX - LIGHT_MIN_X) / (LIGHT_MAX_X - LIGHT_MIN_X);
      // Ascending leg of the triangle wave passes the current position at
      // phase f·(P/2); offset the clock so that's "now".
      this.rhythmOffset = f * (LIGHT_PERIOD_SEC / 2) - (now % LIGHT_PERIOD_SEC);
    }
  }

  /** Re-render the settled garden after an external change (e.g. Clear). */
  refresh(): void {
    this.renderStatic();
    this.lastHud = 0; // push fresh HUD numbers on the next frame
  }

  /** The light's position this instant (0..1). */
  private lightAt(now: number): number {
    return this.rhythm ? lightX01(now + this.rhythmOffset) : this.lightX;
  }

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
    if (this.pendingBegin) {
      this.pendingBegin = false;
      this.startLoop();
    }
  }

  /** Open the garden. Call after the intro card is dismissed; defers if the
   *  mic hasn't come up yet. */
  begin(): void {
    if (this.audio) this.startLoop();
    else this.pendingBegin = true;
  }

  private startLoop(): void {
    this.tracker = new StrokeTracker();
    this.growing = null;
    this.sessionCounts = countByKind([]);
    this.sessionGrown = 0;
    this.lastNow = null;
    this.lastHud = 0;
    this.curMidi = null;
    this.recent = [];
    this.blessing = 0;
    this.particles = [];
    this.bursts = [];
    this.lastBurstAt = -9;
    this.t0 = performance.now() / 1000;
    this.sizeCanvas();
    this.renderStatic();
    cancelAnimationFrame(this.raf);
    this.loop();
  }

  /** Rest the garden: close any in-flight tone, stop the audio, and report the
   *  visit's recap. The garden itself persists — that's the point. */
  finish(): void {
    if (!this.audio) return;
    cancelAnimationFrame(this.raf);
    const last = this.tracker.flush();
    if (last && this.growing) this.finalize(last);
    this.growing = null;
    this.teardownAudio();
    this.renderStatic();
    this.drawFrame(performance.now() / 1000 - this.t0); // freeze the final scene
    this.opts.onEnd({
      grown: this.sessionGrown,
      counts: this.sessionCounts,
      total: this.opts.garden.elements.length,
      ageDays: gardenAgeDays(this.opts.garden, Date.now()),
    });
  }

  /** Tear everything down (call on unmount). */
  destroy(): void {
    this.pendingBegin = false;
    cancelAnimationFrame(this.raf);
    this.teardownAudio();
    this.canvas?.removeEventListener("pointermove", this.onPointer);
    this.canvas?.removeEventListener("pointerdown", this.onPointer);
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

  // ---------- growth lifecycle ----------

  /** A voice just appeared: a plant is born under the light, tiny, and will
   *  unfold live as the tone continues. */
  private birth(): void {
    const mean = this.tracker.liveMean();
    const x01 = this.tracker.strokeX01();
    if (mean == null || x01 == null) return;
    this.growing = elementFromStroke(
      this.opts.garden,
      {
        dur: this.tracker.progress(),
        meanMidi: mean,
        wobbleCents: this.tracker.liveWobbleCents() ?? 0,
        x01,
      },
      this.opts.voiceId,
      Math.random,
      Date.now(),
    );
    this.growing.size = 0.02;
  }

  /** Update the unfolding plant from the live voice: it grows with duration,
   *  and its pitch/steadiness keep shaping it until the tone ends. */
  private nurture(): void {
    const el = this.growing;
    if (!el) return;
    const mean = this.tracker.liveMean();
    if (mean != null) {
      el.band01 = bandFor(mean, this.opts.voiceId);
      el.hue = hueFor(mean);
    }
    const w = this.tracker.liveWobbleCents();
    if (w != null) el.wobble = wobble01(w);
    el.size = Math.max(0.02, Math.min(1, this.tracker.progress() / FULL_STROKE_SEC));
  }

  /** The tone ended long enough to count: the plant joins the garden for good.
   *  New growth stands in front of the old — anything now buried dies back. */
  private finalize(stroke: {
    dur: number;
    meanMidi: number;
    wobbleCents: number;
    x01: number;
  }): void {
    const el = this.growing;
    if (!el) return;
    this.growing = null;
    el.band01 = bandFor(stroke.meanMidi, this.opts.voiceId);
    el.hue = hueFor(stroke.meanMidi);
    el.wobble = wobble01(stroke.wobbleCents);
    el.size = strokeSize01(stroke.dur);
    el.id = this.opts.garden.nextId;
    addElement(this.opts.garden, el);
    const died = applyOcclusion(this.opts.garden);
    this.sessionGrown++;
    this.sessionCounts[el.kind]++;
    this.opts.onGrow(this.opts.garden, el);
    this.renderStatic();
    const groundY = this.H * 0.62;
    // A little burst of sparks where it grew.
    const y = el.kind === "butterfly" ? this.butterflyAnchorY(el, groundY) : groundY;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 26 + Math.random() * 70;
      this.particles.push({
        x: el.x01 * this.W,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 26,
        age: 0,
        life: 0.6 + Math.random() * 0.5,
        hue: el.hue,
        kind: "spark",
      });
    }
    // Buried plants sigh back into the soil as dim, falling dust.
    for (const d of died) {
      for (let i = 0; i < 8; i++) {
        this.particles.push({
          x: d.x01 * this.W + (Math.random() - 0.5) * 20,
          y: groundY - Math.random() * 30,
          vx: (Math.random() - 0.5) * 14,
          vy: 10 + Math.random() * 26,
          age: 0,
          life: 0.9 + Math.random() * 0.6,
          hue: 70,
          kind: "spark",
        });
      }
    }
    // Only a long-held sky tone echoes into the heavens.
    if ((el.kind === "tree" || el.kind === "butterfly") && stroke.dur >= 2) {
      const now = performance.now() / 1000 - this.t0;
      this.spawnBurst(now, el.x01, el.hue, 0.5 + el.size * 0.5);
    }
  }

  // ---------- sky bursts ----------

  /** Grow a fractal dendrite once (relative coordinates); it is stamped with
   *  radial symmetry and hue-cycled every frame until it fades. */
  private spawnBurst(now: number, x01: number, baseHue: number, intensity: number): void {
    if (this.bursts.length >= 6) this.bursts.shift();
    const groundY = this.H * 0.62;
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const r = rng32(seed);
    const paths: BurstPath[] = [];
    const reach = (34 + r() * 46) * (0.7 + intensity * 0.6);
    const grow = (px: number, py: number, ang: number, len: number, depth: number, b0: number) => {
      const pts = wanderPath(px, py, ang, len, 7, 0.55, r);
      paths.push({ pts, depth, b0, w: Math.max(0.5, 1.8 - depth * 0.5) });
      if (depth >= 2) return;
      const kids = 2 + (r() < 0.35 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const at = 0.45 + r() * 0.5;
        const base = pts[Math.floor(at * (pts.length - 1))];
        grow(
          base.x,
          base.y,
          ang + (r() - 0.5) * 1.9,
          len * (0.5 + r() * 0.25),
          depth + 1,
          b0 + 0.22 + at * 0.15,
        );
      }
    };
    const arms = 2 + Math.floor(r() * 2);
    for (let i = 0; i < arms; i++) {
      grow(0, 0, (i / arms) * Math.PI * 2 + r() * 0.8, reach, 0, 0);
    }
    this.bursts.push({
      x: (0.15 + x01 * 0.7) * this.W,
      y: groundY * (0.12 + r() * 0.32),
      born: now,
      life: 8 + r() * 3,
      sym: 5 + Math.floor(r() * 3),
      baseHue,
      intensity,
      paths,
    });
  }

  /** Draw the living bursts: nebula glow beneath, symmetric dendrites above,
   *  everything additive, slowly rotating, hues rolling as they age. */
  private drawBursts(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.bursts.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const b of this.bursts) {
      const age = now - b.born;
      const unfold = stage(age, 0, 2.8);
      const env = Math.min(1, age * 1.6) * (1 - stage(age, b.life - 3, b.life));
      if (env <= 0) continue;

      // Nebula bed: a soft breathing cloud whose color rolls with time.
      const nebHue = (b.baseHue + age * 26) % 360;
      const nr = (26 + age * 16) * (0.7 + b.intensity * 0.5);
      const neb = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, nr);
      neb.addColorStop(0, `hsla(${nebHue}, 80%, 62%, ${0.1 * env})`);
      neb.addColorStop(0.55, `hsla(${(nebHue + 60) % 360}, 75%, 55%, ${0.05 * env})`);
      neb.addColorStop(1, `hsla(${(nebHue + 120) % 360}, 70%, 50%, 0)`);
      ctx.fillStyle = neb;
      ctx.beginPath();
      ctx.arc(b.x, b.y, nr, 0, Math.PI * 2);
      ctx.fill();

      // The dendrites, stamped around the circle, turning as they live.
      for (let s = 0; s < b.sym; s++) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate((s / b.sym) * Math.PI * 2 + age * 0.07);
        for (const p of b.paths) {
          const frac = stage(unfold, p.b0, p.b0 + 0.42);
          if (frac <= 0) continue;
          const hue = (b.baseHue + age * 40 + p.depth * 32 + s * 9) % 360;
          const alpha = (0.15 - p.depth * 0.035) * env;
          this.taperedPath(ctx, p.pts, p.w, `hsla(${hue}, 88%, 66%, ${alpha})`, frac);
        }
        ctx.restore();
      }

      // A hot core.
      ctx.fillStyle = `hsla(${(b.baseHue + age * 50) % 360}, 90%, 78%, ${0.35 * env})`;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2 + Math.sin(age * 5) * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.audio || !this.pitch) return;
    const now = performance.now() / 1000 - this.t0;
    let dt = this.lastNow == null ? 0 : now - this.lastNow;
    this.lastNow = now;
    if (dt < 0 || dt > 0.5) dt = 0;

    const pr = this.pitch.read();
    this.curMidi = pr ? hzMidi(pr.f0) : null;
    this.curHz = pr ? pr.f0 : -1;

    // Live steadiness window.
    if (this.curMidi != null) this.recent.push({ t: now, m: this.curMidi });
    while (this.recent.length && now - this.recent[0].t > 0.8) this.recent.shift();

    // Feed the stroke tracker and run the growth lifecycle: a stroke ending
    // finalizes the plant; an active stroke without a plant births one; an
    // abandoned blip (too short to return a stroke) melts away.
    const stroke = this.tracker.push(now, this.curMidi, this.lightAt(now));
    if (stroke) this.finalize(stroke);
    if (this.tracker.isActive()) {
      if (!this.growing) this.birth();
      this.nurture();
    } else if (this.growing && !stroke) {
      this.growing = null;
    }

    // The sky's blessing swells with singing (high tones feed it fastest).
    // Only a *sustained* high tone storms: the current stroke must have held
    // high for a while before fractal bursts bloom near the light.
    if (this.curMidi != null) {
      const band = bandFor(this.curMidi, this.opts.voiceId);
      this.blessing = Math.min(1, this.blessing + dt * (0.18 + band * 0.35));
      const mean = this.tracker.liveMean();
      const meanBand = mean != null ? bandFor(mean, this.opts.voiceId) : 0;
      const sustainedHigh =
        this.tracker.isActive() && this.tracker.progress() > 1.4 && meanBand > 0.78;
      if (sustainedHigh && now - this.lastBurstAt > 1.15) {
        this.lastBurstAt = now;
        this.spawnBurst(now, this.lightAt(now), hueFor(this.curMidi), 0.5 + this.blessing * 0.7);
      }
    } else {
      this.blessing = Math.max(0, this.blessing - dt * 0.06);
    }
    this.bursts = this.bursts.filter((b) => now - b.born < b.life);

    // Light motes drift down the beam while the voice is heard.
    const groundY = this.H * 0.62;
    if (this.curMidi != null && this.W > 0) {
      const lx = this.lightAt(now) * this.W;
      for (let i = 0; i < 2; i++) {
        this.particles.push({
          x: lx + (Math.random() - 0.5) * 46,
          y: Math.random() * groundY * 0.5,
          vx: (Math.random() - 0.5) * 6,
          vy: 60 + Math.random() * 50,
          age: 0,
          life: 2.4,
          hue: hueFor(this.curMidi),
          kind: "mote",
        });
      }
    }
    for (const p of this.particles) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === "spark") p.vy += 55 * dt;
      if (p.kind === "mote" && p.y > groundY) p.age = p.life; // soaked in
    }
    this.particles = this.particles.filter((p) => p.age < p.life);

    this.drawFrame(now);
    this.pushHud(now);
  };

  private pushHud(now: number): void {
    if (now - this.lastHud < 0.1) return;
    this.lastHud = now;
    let zoneLabel = "";
    let stabilityLabel = "";
    if (this.curMidi != null) {
      const zone = zoneFor(bandFor(this.curMidi, this.opts.voiceId));
      zoneLabel =
        zone === "earth"
          ? "Earth · mushrooms"
          : zone === "green"
            ? "Green · grass & flowers"
            : "Sky · trees";
      const dev = this.recentDeviation();
      stabilityLabel = dev == null ? "" : dev < 25 ? "steady" : dev < 60 ? "swaying" : "wild";
    }
    this.opts.onHud({
      liveName: this.curMidi == null ? "—" : midiName(Math.round(this.curMidi)),
      liveHz: this.curHz > 0 ? this.curHz.toFixed(1) + " Hz" : "",
      zoneLabel,
      stabilityLabel,
      prompt: gardenPrompt(countByKind(this.opts.garden.elements), now),
      total: this.opts.garden.elements.length,
      grown: this.sessionGrown,
      ageDays: gardenAgeDays(this.opts.garden, Date.now()),
    });
  }

  /** RMS cents deviation of the last ~0.8s of pitch, or null if too little. */
  private recentDeviation(): number | null {
    if (this.recent.length < 8) return null;
    let sum = 0;
    for (const p of this.recent) sum += p.m;
    const mean = sum / this.recent.length;
    let sq = 0;
    for (const p of this.recent) sq += (p.m - mean) * (p.m - mean);
    return Math.sqrt(sq / this.recent.length) * 100;
  }

  // ---------- drawing ----------

  /** Pre-render every settled plant onto the static layer (transparent bg),
   *  collecting shimmer focal points as we go. Butterflies stay off it — they
   *  never stop moving. */
  private renderStatic(): void {
    if (!this.W || !this.H) return;
    const dpr = window.devicePixelRatio || 1;
    if (!this.staticLayer) this.staticLayer = document.createElement("canvas");
    const layer = this.staticLayer;
    layer.width = Math.round(this.W * dpr);
    layer.height = Math.round(this.H * dpr);
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    const groundY = this.H * 0.62;
    this.focalSink = [];
    // Two passes: grass draws in its own layer above every other plant.
    for (const el of this.opts.garden.elements) {
      if (el.kind === "butterfly" || el.kind === "grass") continue;
      this.plant(ctx, el, groundY, el.size);
    }
    for (const el of this.opts.garden.elements) {
      if (el.kind === "grass") this.plant(ctx, el, groundY, el.size);
    }
    this.focals = this.focalSink;
    this.focalSink = null;
  }

  private drawFrame(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.W;
    const H = this.H;
    const groundY = H * 0.62;
    ctx.clearRect(0, 0, W, H);

    // ---- sky: a deep night that blesses the garden ----
    const sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, "#0b0d1c");
    sky.addColorStop(0.7, "#0d1018");
    sky.addColorStop(1, "#0e1114");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, groundY);

    // Stars (fixed constellation, gentle twinkle; a few carry color).
    const starRng = rng32(77);
    for (let i = 0; i < 48; i++) {
      const sx = starRng() * W;
      const sy = starRng() * groundY * 0.85;
      const speed = 0.4 + starRng();
      const phase = starRng() * 7;
      const big = starRng() < 0.15;
      const tinted = starRng() < 0.25;
      const tw = 0.25 + 0.3 * Math.sin(now * speed + phase);
      ctx.globalAlpha = Math.max(0.05, tw) * (0.5 + this.blessing * 0.5);
      ctx.fillStyle = tinted ? `hsl(${(phase * 60 + now * 12) % 360}, 65%, 75%)` : "#ffffff";
      ctx.beginPath();
      ctx.arc(sx, sy, big ? 1.6 : 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Aurora ribbons — the sky's blessing, brightening as the garden is sung to.
    const baseHue = (this.curMidi != null ? hueFor(this.curMidi) : 0) + now * 14;
    for (let k = 0; k < 4; k++) {
      const yBase = groundY * (0.14 + k * 0.1);
      const amp = (13 + k * 7) * (0.5 + this.blessing);
      ctx.strokeStyle = `hsla(${(baseHue + k * 46) % 360}, 72%, 60%, ${0.035 + this.blessing * 0.07})`;
      ctx.lineWidth = 22 - k * 4;
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += 16) {
        const y = yBase + Math.sin(x * 0.006 + now * (0.3 + k * 0.12) + k * 2.1) * amp;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Fractal sky bursts — the high voice's psychedelic weather.
    this.drawBursts(ctx, now);

    // ---- earth ----
    const soil = ctx.createLinearGradient(0, groundY, 0, H);
    soil.addColorStop(0, "#191410");
    soil.addColorStop(1, "#0c0a08");
    ctx.fillStyle = soil;
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.strokeStyle = "rgba(255,255,255,0.03)";
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = groundY + ((H - groundY) * i) / 4;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 24) {
        const yy = y + Math.sin(x * 0.02 + i * 3) * 3;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(160,190,140,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, groundY);
    ctx.lineTo(W, groundY);
    ctx.stroke();

    // ---- the settled garden (pre-rendered), breathed over by shimmer ----
    if (this.staticLayer) ctx.drawImage(this.staticLayer, 0, 0, W, H);
    this.shimmer(ctx, now);

    // ---- the living: butterflies, and the plant unfolding right now ----
    for (const el of this.opts.garden.elements) {
      if (el.kind === "butterfly") this.butterfly(ctx, el, groundY, now, el.size);
    }
    if (this.growing) {
      this.focalSink = [];
      if (this.growing.kind === "butterfly")
        this.butterfly(ctx, this.growing, groundY, now, this.growing.size);
      else this.plant(ctx, this.growing, groundY, this.growing.size);
      const tip = this.focalSink[0];
      this.focalSink = null;
      if (tip) {
        // The growth tip glows and sheds sparks while the voice feeds it.
        const hue = (this.growing.hue + now * 30) % 360;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `hsla(${hue}, 85%, 70%, 0.3)`;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 5 + Math.sin(now * 8) * 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        if (Math.random() < 0.4) {
          this.particles.push({
            x: tip.x + (Math.random() - 0.5) * 6,
            y: tip.y + (Math.random() - 0.5) * 6,
            vx: (Math.random() - 0.5) * 24,
            vy: -12 - Math.random() * 22,
            age: 0,
            life: 0.5 + Math.random() * 0.4,
            hue: this.growing.hue,
            kind: "spark",
          });
        }
      }
    }

    // ---- particles (light motes and growth sparks) ----
    for (const p of this.particles) {
      const a = 1 - p.age / p.life;
      if (p.kind === "mote") {
        ctx.fillStyle = `hsla(${p.hue}, 70%, 72%, ${0.4 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `hsla(${p.hue}, 85%, 70%, ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ---- the light itself, laid over everything ----
    this.beam(ctx, this.lightAt(now) * W, groundY);
  }

  /** Breathe over every settled plant: a slow hue-cycling glow at each focal
   *  point, additive, so the garden glitters like it's lit from within. */
  private shimmer(ctx: CanvasRenderingContext2D, now: number): void {
    if (!this.focals.length) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.focals) {
      const r0 = (f.el.seed % 977) / 977;
      const pulse = 0.5 + 0.5 * Math.sin(now * (0.5 + r0 * 0.9) + r0 * 12);
      const hue = (f.el.hue + now * 12 + r0 * 90) % 360;
      const rad = 3 + 3.5 * pulse + f.el.size * 2;
      ctx.fillStyle = `hsla(${hue}, 80%, 65%, ${0.05 + 0.08 * pulse})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `hsla(${(hue + 40) % 360}, 85%, 75%, ${0.05 + 0.1 * pulse})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, rad * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The shaft of light: a soft additive column with a pool on the ground. */
  private beam(ctx: CanvasRenderingContext2D, x: number, groundY: number): void {
    const half = 44;
    const hue = this.curMidi != null ? hueFor(this.curMidi) : null;
    const tint = hue != null ? `${hue}, 60%, 75%` : `0, 0%, 88%`;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(x - half, 0, x + half, 0);
    g.addColorStop(0, `hsla(${tint}, 0)`);
    g.addColorStop(0.5, `hsla(${tint}, 0.10)`);
    g.addColorStop(1, `hsla(${tint}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - half, 0, half * 2, this.H);
    const pool = ctx.createRadialGradient(x, groundY, 2, x, groundY, half * 1.15);
    pool.addColorStop(0, `hsla(${tint}, 0.16)`);
    pool.addColorStop(1, `hsla(${tint}, 0)`);
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(x, groundY, half * 1.15, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------- plants ----------

  /** Register a plant's shimmer/growth focal point (only while a sink is set). */
  private focal(x: number, y: number, el: GardenElement): void {
    this.focalSink?.push({ x, y, el });
  }

  /** A green tinted by the element's sung hue, so foliage carries the voice. */
  private greenFor(el: GardenElement, alpha: number, hueJitter = 0): string {
    const hue = 96 + ((el.hue % 360) - 180) * 0.14 + hueJitter;
    return `hsla(${hue}, 42%, 55%, ${alpha})`;
  }

  /** Draw one plant at its growth stage g (0..1). Geometry is fully derived
   *  from the element's seed, then revealed in stages with partial final
   *  segments, so a growing plant creeps outward along the same shape it will
   *  keep forever. */
  private plant(
    ctx: CanvasRenderingContext2D,
    el: GardenElement,
    groundY: number,
    g: number,
  ): void {
    switch (el.kind) {
      case "grass":
        this.grass(ctx, el, groundY, g);
        break;
      case "flower":
        this.flower(ctx, el, groundY, g);
        break;
      case "mushroom":
        this.mushroomColony(ctx, el, groundY, g);
        break;
      case "tree":
        this.tree(ctx, el, groundY, g);
        break;
      case "butterfly":
        break; // drawn separately (always animated)
    }
  }

  /** Draw the first `frac` of a wandering path with a tapering stroke —
   *  including a partial final segment, so growth creeps rather than stepping.
   *  Tapers to a point by default; pass w1 to keep limbs thick (tree wood).
   *  Returns the current tip. */
  private taperedPath(
    ctx: CanvasRenderingContext2D,
    pts: Pt[],
    w0: number,
    color: string,
    frac: number,
    w1 = 0.25,
  ): Pt | null {
    if (frac <= 0 || pts.length < 2) return null;
    // Smooth the centerline (Chaikin ×2) so limbs bend without visible joints,
    // then reveal the first `frac` of it, partial final segment included.
    const sm = smoothPts(pts);
    const n = sm.length;
    const total = (n - 1) * Math.min(1, frac);
    const whole = Math.floor(total);
    const part = total - whole;
    const line: Pt[] = sm.slice(0, whole + 1);
    if (whole < n - 1 && part > 0.02) {
      const a = sm[whole];
      const b = sm[whole + 1];
      line.push({ x: a.x + (b.x - a.x) * part, y: a.y + (b.y - a.y) * part });
    }
    if (line.length < 2) return sm[0];
    // Fill one continuous tapered ribbon around the centerline — a single
    // seamless shape, no per-segment caps to betray the joints. Widths are
    // indexed against the FULL path, so the creeping tip stays mid-taper.
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i < line.length; i++) {
      const p0 = line[Math.max(0, i - 1)];
      const p1 = line[Math.min(line.length - 1, i + 1)];
      let dx = p1.x - p0.x;
      let dy = p1.y - p0.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const t = Math.min(1, i / (n - 1));
      const w = Math.max(0.25, w0 + (w1 - w0) * t) / 2;
      left.push({ x: line[i].x - dy * w, y: line[i].y + dx * w });
      right.push({ x: line[i].x + dy * w, y: line[i].y - dx * w });
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fill();
    return line[line.length - 1];
  }

  /** A pointed leaf as two curves meeting at a tip. */
  private leaf(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    ang: number,
    len: number,
    color: string,
  ): void {
    if (len < 0.6) return;
    const w = len * 0.34;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(len * 0.45, -w, len, 0);
    ctx.quadraticCurveTo(len * 0.45, w, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Grass: a low tuft of many arcing blades, sprouting one after another,
   *  with a few small shallow roots beneath. */
  private grass(
    ctx: CanvasRenderingContext2D,
    el: GardenElement,
    groundY: number,
    g: number,
  ): void {
    const r = rng32(el.seed);
    const x = el.x01 * this.W;
    // A dense, wide patch: many blades scattered across a broad stretch.
    const blades = 20 + Math.floor(r() * 16);
    for (let i = 0; i < blades; i++) {
      const bx = x + (r() - 0.5) * 80;
      const ang = -Math.PI / 2 + (r() - 0.5) * (0.9 + el.wobble * 0.6);
      // Tops out around half a full mushroom's height.
      const len = (10 + r() * 16) * (0.55 + el.size * 0.6);
      const pts = wanderPath(bx, groundY, ang, len, 5, 0.22 + el.wobble * 0.35, r);
      const b0 = r() * 0.55;
      this.taperedPath(
        ctx,
        pts,
        1.3,
        this.greenFor(el, 0.75, (r() - 0.5) * 26),
        stage(g, b0, b0 + 0.35),
      );
    }
    // Shallow roots — a small fringe just under the surface, patch-wide.
    const roots = 7 + Math.floor(r() * 5);
    for (let i = 0; i < roots; i++) {
      const hx = x + (r() - 0.5) * 84;
      const ang = Math.PI / 2 + (r() - 0.5) * 1.1;
      const len = 4 + r() * 8;
      const pts = wanderPath(hx, groundY + 1, ang, len, 3, 0.5, r);
      const b0 = 0.3 + r() * 0.45;
      this.taperedPath(ctx, pts, 0.8, "rgba(214,190,152,0.35)", stage(g, b0, b0 + 0.2));
    }
    this.focal(x, groundY - 10, el);
  }

  /** A wildflower: a short stem, a few leaves, petals unfurling one by one,
   *  and shallow roots — it grows low. */
  private flower(
    ctx: CanvasRenderingContext2D,
    el: GardenElement,
    groundY: number,
    g: number,
  ): void {
    const r = rng32(el.seed);
    const x = el.x01 * this.W;
    const fullH = (26 + r() * 30) * (0.6 + el.size * 0.5);
    const lean = (r() - 0.5) * 0.3;
    const stalk = wanderPath(x, groundY, -Math.PI / 2 + lean, fullH, 8, 0.18 + el.wobble * 0.35, r);
    this.taperedPath(ctx, stalk, 1.8, this.greenFor(el, 0.75), stage(g, 0.04, 0.5), 0.6);

    const leaves = 2 + Math.floor(r() * 2);
    for (let i = 0; i < leaves; i++) {
      const at = 0.25 + r() * 0.45;
      const base = stalk[Math.floor(at * (stalk.length - 1))];
      const side = i % 2 === 0 ? 1 : -1;
      const ang = -Math.PI / 2 + side * (1.05 + (r() - 0.5) * el.wobble) + lean;
      const full = 6 + r() * 8;
      const b0 = 0.25 + at * 0.35;
      this.leaf(
        ctx,
        base.x,
        base.y,
        ang,
        full * stage(g, b0, Math.min(1, b0 + 0.22)),
        this.greenFor(el, 0.6),
      );
    }

    const head = stalk[stalk.length - 1];
    const petals = 5 + Math.floor(r() * 4);
    const baseLen = 5 + r() * 6 + el.size * 4;
    const headStage = stage(g, 0.4, 0.95);
    ctx.fillStyle = `hsla(${el.hue}, 75%, 62%, 0.85)`;
    ctx.shadowColor = `hsla(${el.hue}, 80%, 65%, 0.9)`;
    ctx.shadowBlur = 8 * headStage;
    for (let i = 0; i < petals; i++) {
      const jA = (r() - 0.5) * el.wobble * 0.9;
      const jL = 1 + (r() - 0.5) * el.wobble * 0.8;
      const perPetal = stage(headStage, i / (petals + 1), Math.min(1, i / (petals + 1) + 0.45));
      const a = (i / petals) * Math.PI * 2 + jA;
      const len = baseLen * jL * perPetal;
      if (len < 0.6) continue;
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.ellipse(len * 0.55, 0, len * 0.55, len * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    const coreStage = stage(g, 0.5, 0.8);
    if (coreStage > 0) {
      ctx.fillStyle = "#F4B23E";
      ctx.beginPath();
      ctx.arc(head.x, head.y, (2 + 1.8 * (0.5 + r() * 0.5)) * coreStage, 0, Math.PI * 2);
      ctx.fill();
    }

    // Shallow roots.
    const roots = 3 + Math.floor(r() * 3);
    for (let i = 0; i < roots; i++) {
      const ang = Math.PI / 2 + (r() - 0.5) * 1.2;
      const len = 5 + r() * 8;
      const pts = wanderPath(x, groundY + 1, ang, len, 3, 0.5, r);
      const b0 = 0.3 + r() * 0.4;
      this.taperedPath(ctx, pts, 0.9, "rgba(214,190,152,0.35)", stage(g, b0, b0 + 0.2));
    }
    this.focal(head.x, head.y, el);
  }

  /** A mushroom colony: first a mycelium network spreads through the soil —
   *  fine, pale, wildly branching filaments — then a cluster of fruit pushes
   *  up, in one of several cap shapes and a range of colors. */
  private mushroomColony(
    ctx: CanvasRenderingContext2D,
    el: GardenElement,
    groundY: number,
    g: number,
  ): void {
    const r = rng32(el.seed);
    const x = el.x01 * this.W;
    const soilH = this.H - groundY;
    const deep = earthDepth01(el.band01); // lower tones spread deeper
    const reach = (soilH - 12) * (0.35 + deep * 0.35 + el.size * 0.2);
    const mycCol = "rgba(226,222,208,0.28)";
    const wig = 0.6 + el.wobble * 0.4;

    // Mycelium: recursive filaments fanning down and outward.
    const strand = (
      px: number,
      py: number,
      ang: number,
      len: number,
      depth: number,
      b0: number,
    ): void => {
      const pts = wanderPath(px, py, ang, len, Math.max(4, 8 - depth * 2), wig, r);
      this.taperedPath(ctx, pts, Math.max(0.5, 1.1 - depth * 0.2), mycCol, stage(g, b0, b0 + 0.24));
      if (depth >= 3) return;
      const kids = 2 + (r() < 0.5 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const at = 0.3 + r() * 0.6;
        const base = pts[Math.floor(at * (pts.length - 1))];
        let kang = ang + (r() - 0.5) * 1.4;
        kang = Math.min(Math.PI - 0.15, Math.max(0.15, kang)); // stay below ground
        strand(base.x, base.y, kang, len * (0.55 + r() * 0.25), depth + 1, b0 + 0.12 + at * 0.08);
      }
    };
    const strands = 3 + Math.floor(r() * 2);
    for (let s = 0; s < strands; s++) {
      const ang = Math.PI / 2 + (s - (strands - 1) / 2) * (0.55 + r() * 0.2);
      strand(x, groundY + 1, ang, reach * 0.45, 0, 0.02);
    }

    // The fruiting body: a cluster of mushrooms, one shape family per colony,
    // popping up one by one once the mycelium has taken hold.
    // Cartoonish but not towering; the variety comes from where in the low
    // band the tone sat: toadstool → morel → chanterelle → russula → puffball.
    const SCALE = 1.7;
    const variety = mushroomVariety(el.band01);
    const fruits = 2 + Math.floor(r() * 4);
    let tallest = 0;
    for (let f = 0; f < fruits; f++) {
      const fx = x + (f - (fruits - 1) / 2) * (9 + r() * 9);
      let fullH = (10 + r() * 22) * SCALE * (0.6 + el.size * 0.5);
      const fullW = (5 + r() * 9) * SCALE;
      const sw = 1.8 * SCALE * 0.7; // stalk half-width
      const hue = (el.hue + (r() - 0.5) * 70 + 360) % 360;
      const light = 48 + r() * 16;
      const tilt = (r() - 0.5) * (0.15 + el.wobble * 0.6);
      // The stem curves: its top drifts sideways, bowing through the middle.
      const bend = (r() - 0.5) * fullH * 0.55;
      const fb0 = 0.42 + f * 0.09 + r() * 0.05;
      const spotRolls: [number, number, number][] = [];
      const spots = 2 + Math.floor(r() * 2);
      for (let i = 0; i < spots; i++) spotRolls.push([r(), r(), r()]);
      const waveRolls: number[] = [];
      for (let i = 0; i < 4; i++) waveRolls.push(r());
      if (variety === "puffball") fullH *= 0.3; // puffballs squat on the ground
      const hs = stage(g, fb0, fb0 + 0.2);
      const cs = stage(g, fb0 + 0.1, fb0 + 0.3);
      const h = fullH * hs;
      tallest = Math.max(tallest, h);
      if (h < 1) continue;
      ctx.save();
      ctx.translate(fx, groundY);
      ctx.rotate(tilt);
      const topX = bend * hs; // where the curved stem tops out
      // Stalk — curved, bowing through the midpoint (puffballs barely have one).
      if (variety !== "puffball") {
        ctx.fillStyle = "rgba(230,222,202,0.7)";
        ctx.beginPath();
        ctx.moveTo(-sw, 0);
        ctx.quadraticCurveTo(-sw + bend * 0.8, -h * 0.55, topX - sw * 0.75, -h);
        ctx.lineTo(topX + sw * 0.75, -h);
        ctx.quadraticCurveTo(sw + bend * 0.8, -h * 0.55, sw, 0);
        ctx.closePath();
        ctx.fill();
      }
      // Cap, by variety.
      const capW = fullW * cs;
      if (capW > 0.8) {
        ctx.fillStyle = `hsla(${hue}, 58%, ${light}%, 0.9)`;
        ctx.shadowColor = `hsla(${hue}, 65%, ${light + 8}%, 0.8)`;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        if (variety === "toadstool") {
          ctx.ellipse(topX, -h, capW, capW * 0.68, 0, Math.PI, 0); // classic dome
          ctx.closePath();
        } else if (variety === "morel") {
          // A tall, pitted cone sitting on the stem.
          ctx.fillStyle = `hsla(${30 + (hue % 30)}, 32%, ${light * 0.75}%, 0.92)`;
          ctx.ellipse(topX, -h - capW * 0.5, capW * 0.62, capW * 1.05, 0, 0, Math.PI * 2);
        } else if (variety === "chanterelle") {
          // A trumpet: flares up and out from the stem, wavy at the lip.
          ctx.fillStyle = `hsla(${38 + (hue % 24)}, 70%, ${light + 6}%, 0.9)`;
          ctx.moveTo(topX - sw, -h);
          ctx.quadraticCurveTo(topX - capW * 0.9, -h - capW * 0.35, topX - capW, -h - capW * 0.75);
          for (let wv = 0; wv < 4; wv++) {
            const wx = topX - capW + ((wv + 1) / 4) * capW * 2;
            const wy = -h - capW * (0.75 + (wv % 2 === 0 ? 0.12 : -0.04) + waveRolls[wv] * 0.08);
            ctx.quadraticCurveTo(wx - capW * 0.2, wy - capW * 0.1, wx, wy);
          }
          ctx.quadraticCurveTo(topX + capW * 0.9, -h - capW * 0.35, topX + sw, -h);
          ctx.closePath();
        } else if (variety === "russula") {
          ctx.ellipse(topX, -h, capW * 1.25, capW * 0.32, 0, Math.PI, 0); // wide flat plate
          ctx.closePath();
        } else {
          // Puffball: a plump sphere resting on the ground.
          ctx.fillStyle = `hsla(${hue}, 22%, ${Math.min(78, light + 22)}%, 0.92)`;
          ctx.arc(topX, -h - capW * 0.5, capW * 0.85, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        // Markings: toadstool spots, morel pits, puffball speckles.
        const markA = 0.45 * stage(g, fb0 + 0.22, fb0 + 0.34);
        if (markA > 0) {
          for (const [sr1, sr2, sr3] of spotRolls) {
            ctx.beginPath();
            if (variety === "toadstool" && el.wobble < 0.6) {
              ctx.fillStyle = `rgba(255,255,255,${markA})`;
              ctx.arc(
                topX + (sr1 - 0.5) * capW * 1.1,
                -h - sr2 * capW * 0.35,
                (0.9 + sr3 * 1.2) * 1.6,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            } else if (variety === "morel") {
              ctx.fillStyle = `rgba(20,14,8,${markA * 0.8})`;
              ctx.arc(
                topX + (sr1 - 0.5) * capW * 0.8,
                -h - capW * 0.15 - sr2 * capW * 0.8,
                (0.7 + sr3) * 1.4,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            } else if (variety === "puffball") {
              ctx.fillStyle = `rgba(120,104,84,${markA * 0.7})`;
              ctx.arc(
                topX + (sr1 - 0.5) * capW * 1.2,
                -h - capW * 0.5 + (sr2 - 0.5) * capW * 1.2,
                0.7 + sr3 * 0.9,
                0,
                Math.PI * 2,
              );
              ctx.fill();
            }
          }
        }
      }
      ctx.restore();
    }
    this.focal(x, groundY - Math.max(10, tallest * 0.8), el);
  }

  /** An ornamental tree: the trunk climbs and *thickens with growth*, forking
   *  again and again into an airy crown tipped with one of several leaf kinds
   *  and the occasional blossom — while an equally-branching root system,
   *  thickening the same way, mirrors it into the deep soil. */
  private tree(ctx: CanvasRenderingContext2D, el: GardenElement, groundY: number, g: number): void {
    const r = rng32(el.seed);
    const x = el.x01 * this.W;
    const skyBand = skyBand01(el.band01);
    // Tall crowns — the highest voices push past the top of the frame.
    const fullH = groundY * (0.93 + skyBand * 0.36) * (0.85 + r() * 0.15);
    const thick = 0.3 + 0.7 * g; // the whole wood thickens as the tree grows
    const leafType = Math.floor(r() * 3); // 0 round · 1 pointed · 2 needles
    const bloomChance = 0.3 + skyBand * 0.35;
    const barkCol = "hsla(24, 30%, 40%, 0.9)";
    const barkFleck = "hsla(20, 32%, 24%, 0.5)";
    const rootCol = "rgba(199,168,124,0.55)";
    const leafJitter = (r() - 0.5) * 30;
    const wigBase = 0.1 + el.wobble * 0.25;
    // Foliage is collected as flat descriptors and drawn as one batched layer
    // over the wood — thousands of leaves cost a couple of path fills.
    const leafDots: { x: number; y: number; ang: number; roll: number; b0: number }[] = [];
    const blooms: { x: number; y: number; size: number; b0: number }[] = [];
    const sprinkle = (
      cx: number,
      cy: number,
      ang: number,
      count: number,
      spread: number,
      b0: number,
    ) => {
      for (let c = 0; c < count; c++) {
        leafDots.push({
          x: cx + (r() - 0.5) * spread,
          y: cy + (r() - 0.5) * spread * 0.8,
          ang: ang + (r() - 0.5) * 1.8,
          roll: r(),
          b0: Math.min(0.95, b0 + r() * 0.16),
        });
      }
    };

    // Crown: recursive limbs, 2–4 children each, five levels deep.
    const limb = (
      px: number,
      py: number,
      ang: number,
      len: number,
      w: number,
      depth: number,
      b0: number,
    ): void => {
      const pts = wanderPath(
        px,
        py,
        ang,
        len,
        Math.max(4, 9 - depth),
        wigBase * (1 + depth * 0.3),
        r,
      );
      const frac = stage(g, b0, b0 + 0.3);
      this.taperedPath(ctx, pts, w * thick, barkCol, frac, w * thick * 0.55);
      // Bark texture: short dark flecks along the thicker limbs.
      if (depth <= 2) {
        const flecks = 2 + Math.floor(r() * 3);
        for (let f = 0; f < flecks; f++) {
          const at = 0.15 + r() * 0.7;
          const off = (r() - 0.5) * w * thick * 0.5;
          const flen = 2 + r() * 4;
          if (at < frac) {
            const i = Math.floor(at * (pts.length - 1));
            const p0 = pts[i];
            const p1 = pts[Math.min(pts.length - 1, i + 1)];
            const d = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
            const ux = (p1.x - p0.x) / d;
            const uy = (p1.y - p0.y) / d;
            ctx.strokeStyle = barkFleck;
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(p0.x - uy * off, p0.y + ux * off);
            ctx.lineTo(p0.x - uy * off + ux * flen, p0.y + ux * off + uy * flen);
            ctx.stroke();
          }
        }
      }
      const isTip = depth >= 4 || len < 9;
      if (!isTip) {
        const kids = depth === 0 ? 3 + Math.floor(r() * 2) : 2 + (r() < 0.55 ? 1 : 0);
        for (let k = 0; k < kids; k++) {
          const at = depth === 0 ? 0.45 + r() * 0.5 : 0.35 + r() * 0.6;
          const base = pts[Math.floor(at * (pts.length - 1))];
          const side = k % 2 === 0 ? 1 : -1;
          const kang = ang + side * (0.3 + r() * 0.45) + (r() - 0.5) * 0.25;
          limb(
            base.x,
            base.y,
            kang,
            len * (0.55 + r() * 0.18),
            w * 0.62,
            depth + 1,
            Math.min(0.85, b0 + 0.11 + at * 0.07),
          );
        }
        // Small leafy twigs also sprout along inner limbs — early and often —
        // so the tree greens from within long before the crown fills.
        if (depth >= 1) {
          const twigs = 1 + (r() < 0.6 ? 1 : 0);
          for (let tw = 0; tw < twigs; tw++) {
            const at = 0.3 + r() * 0.6;
            const base = pts[Math.floor(at * (pts.length - 1))];
            const tang = ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6);
            const tlen = len * (0.18 + r() * 0.14);
            const tpts = wanderPath(base.x, base.y, tang, tlen, 4, wigBase * 1.4, r);
            const tb0 = Math.min(0.85, b0 + 0.05 + at * 0.05);
            this.taperedPath(ctx, tpts, w * thick * 0.3, barkCol, stage(g, tb0, tb0 + 0.2));
            const twigTip = tpts[tpts.length - 1];
            sprinkle(twigTip.x, twigTip.y, tang, 16 + Math.floor(r() * 12), 16, tb0 + 0.06);
          }
        }
        return;
      }
      // Foliage at the tip: a dense cloud of this tree's leaf kind.
      const tip = pts[pts.length - 1];
      sprinkle(tip.x, tip.y, ang, 80 + Math.floor(r() * 50), 26, b0 + 0.08);
      // Sometimes a blossom crowns the tip — also above the branches.
      const bloomRoll = r();
      const bloomSize = 2.2 + r() * 2.4;
      if (bloomRoll < bloomChance) {
        blooms.push({ x: tip.x, y: tip.y, size: bloomSize, b0 });
      }
    };
    limb(x, groundY, -Math.PI / 2 + (r() - 0.5) * 0.12, fullH * 0.4, 7 + skyBand * 2.5, 0, 0.02);

    // Roots: the crown mirrored into the earth — thick, forking, deepening.
    const rootLimb = (
      px: number,
      py: number,
      ang: number,
      len: number,
      w: number,
      depth: number,
      b0: number,
    ): void => {
      const pts = wanderPath(
        px,
        py,
        ang,
        len,
        Math.max(4, 8 - depth),
        (0.3 + el.wobble * 0.4) * (1 + depth * 0.25),
        r,
      );
      const endW = depth >= 2 ? 0.25 : w * thick * 0.5;
      this.taperedPath(ctx, pts, w * thick, rootCol, stage(g, b0, b0 + 0.3), endW);
      // Root hairs.
      const hairs = 2 + Math.floor(r() * 3);
      for (let h = 0; h < hairs; h++) {
        const at = 0.25 + r() * 0.65;
        const base = pts[Math.floor(at * (pts.length - 1))];
        const hang = ang + (r() < 0.5 ? -1 : 1) * (0.8 + r() * 0.7);
        const hpts = wanderPath(base.x, base.y, hang, 2.5 + r() * 5, 3, 1.1, r);
        const hb0 = Math.min(0.92, b0 + 0.25 + at * 0.2);
        this.taperedPath(ctx, hpts, 0.7, "rgba(214,190,152,0.35)", stage(g, hb0, hb0 + 0.15));
      }
      if (depth >= 3) return;
      const kids = 2 + (r() < 0.5 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const at = 0.3 + r() * 0.55;
        const base = pts[Math.floor(at * (pts.length - 1))];
        const side = k % 2 === 0 ? 1 : -1;
        let kang = ang + side * (0.35 + r() * 0.5);
        kang = Math.min(Math.PI - 0.1, Math.max(0.1, kang)); // stay underground
        rootLimb(
          base.x,
          base.y,
          kang,
          len * (0.55 + r() * 0.2),
          w * 0.6,
          depth + 1,
          Math.min(0.88, b0 + 0.12 + at * 0.06),
        );
      }
    };
    // Roots run long — they hit the bottom of the soil and keep spreading wide.
    const rootReach = (this.H - groundY) * (1.9 + skyBand * 0.4) * (0.85 + r() * 0.15);
    rootLimb(
      x,
      groundY + 1,
      Math.PI / 2 + (r() - 0.5) * 0.15,
      rootReach * 0.4,
      5.5 + skyBand * 1.5,
      0,
      0.05,
    );

    // Leaves and blossoms sit in their own layer over the branchwork. All
    // leaves of a kind batch into a single path, so the dense canopy is cheap.
    const leafCol = this.greenFor(el, 0.55, leafJitter);
    if (leafType === 0) {
      ctx.fillStyle = leafCol;
      ctx.beginPath();
      for (const L of leafDots) {
        const s = stage(g, L.b0, Math.min(1, L.b0 + 0.2));
        if (s <= 0.02) continue;
        const rad = (1.5 + L.roll * 1.5) * s;
        ctx.moveTo(L.x + rad, L.y);
        ctx.arc(L.x, L.y, rad, 0, Math.PI * 2);
      }
      ctx.fill();
    } else if (leafType === 1) {
      ctx.fillStyle = leafCol;
      ctx.beginPath();
      for (const L of leafDots) {
        const s = stage(g, L.b0, Math.min(1, L.b0 + 0.2));
        if (s <= 0.02) continue;
        const len = (4 + L.roll * 5.5) * s;
        const dx = Math.cos(L.ang);
        const dy = Math.sin(L.ang);
        const wHalf = len * 0.34;
        const tx = L.x + dx * len;
        const ty = L.y + dy * len;
        const mx = L.x + dx * len * 0.45;
        const my = L.y + dy * len * 0.45;
        ctx.moveTo(L.x, L.y);
        ctx.quadraticCurveTo(mx - dy * wHalf, my + dx * wHalf, tx, ty);
        ctx.quadraticCurveTo(mx + dy * wHalf, my - dx * wHalf, L.x, L.y);
      }
      ctx.fill();
    } else {
      ctx.strokeStyle = leafCol;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const L of leafDots) {
        const s = stage(g, L.b0, Math.min(1, L.b0 + 0.2));
        if (s <= 0.02) continue;
        for (let n = 0; n < 3; n++) {
          const na = L.ang + (n - 1) * 0.5 + (L.roll - 0.5) * 0.5;
          const nl = (3.5 + L.roll * 4) * s;
          ctx.moveTo(L.x, L.y);
          ctx.lineTo(L.x + Math.cos(na) * nl, L.y + Math.sin(na) * nl);
        }
      }
      ctx.stroke();
    }
    for (const bloom of blooms) {
      const bs = stage(g, Math.min(0.96, bloom.b0 + 0.3), Math.min(1, bloom.b0 + 0.48));
      if (bs <= 0.05) continue;
      ctx.fillStyle = `hsla(${el.hue}, 78%, 66%, ${0.85 * bs})`;
      for (let p = 0; p < 5; p++) {
        const pa = (p / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(
          bloom.x + Math.cos(pa) * bloom.size * bs * 0.8,
          bloom.y + Math.sin(pa) * bloom.size * bs * 0.8,
          bloom.size * 0.55 * bs,
          bloom.size * 0.34 * bs,
          pa,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.fillStyle = `rgba(244,178,62,${0.9 * bs})`;
      ctx.beginPath();
      ctx.arc(bloom.x, bloom.y, 1 * bs, 0, Math.PI * 2);
      ctx.fill();
    }

    this.focal(x, groundY - fullH * 0.7, el);
  }

  private butterflyAnchorY(el: GardenElement, groundY: number): number {
    const skyBand = skyBand01(el.band01);
    return groundY - (0.5 + skyBand * 0.34) * (groundY - 60);
  }

  private butterfly(
    ctx: CanvasRenderingContext2D,
    el: GardenElement,
    groundY: number,
    now: number,
    g: number,
  ): void {
    const r = rng32(el.seed);
    const ax = el.x01 * this.W;
    const ay = this.butterflyAnchorY(el, groundY);
    const roam = (14 + el.wobble * 26 + el.size * 10) * g;
    const s1 = 0.4 + r() * 0.5;
    const s2 = 0.3 + r() * 0.4;
    const ph = r() * 7;
    const x = ax + Math.sin(now * s1 + ph) * roam;
    const y = ay + Math.sin(now * s2 * 1.7 + ph * 2) * roam * 0.6;
    const flap = Math.sin(now * 9 + ph) * 0.75;
    const size = (4 + el.size * 5) * Math.min(1, 0.3 + g);
    // Wings slowly roll through neighbouring hues — iridescence.
    const hue = (el.hue + Math.sin(now * 0.7 + ph) * 24 + now * 6) % 360;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.2 + g * 1.5);
    ctx.translate(x, y);
    ctx.fillStyle = `hsla(${hue}, 80%, 66%, 0.9)`;
    ctx.shadowColor = `hsla(${hue}, 80%, 66%, 0.9)`;
    ctx.shadowBlur = 8;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(flap * 0.6);
      ctx.beginPath();
      ctx.ellipse(size * 0.7, -size * 0.2, size, size * 0.62, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#2c2530";
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.4, size * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
