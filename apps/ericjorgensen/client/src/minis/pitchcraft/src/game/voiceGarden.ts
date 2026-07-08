// voiceGarden.ts — pure logic for the Voice Garden (framework-free).
//
// The garden is a living archive of the player's voice: a side-view 2D world
// (underground, ground, sky) grown one sung tone at a time and persisted
// across visits. Where a tone sits in the player's range decides *what* grows
// (low → roots & mushrooms, mid → stems & leaves, high → blossoms &
// butterflies); how steadily it was held decides *how* it grows (stable →
// clean shapes, wobbly → wild organic ones); and *where* it grows is a rhythm
// game — a watering can sweeps back and forth, and the tone lands where the
// can is when the singing starts. There is no score and no failure: the
// activity builds range awareness, pitch stability, and comfort vocalizing.

import { getVoice, VoiceId } from "./notes";
import { hueFor } from "./rangeFlower";

// ---- the sung stroke (one tone = one element) ----

export const MIN_STROKE_SEC = 0.25; // shorter utterances don't grow anything
export const FULL_STROKE_SEC = 3; // a tone this long grows a full-size element
export const STROKE_GAP_SEC = 0.3; // silence this long ends the stroke
export const STROKE_BREAK_SEMITONES = 3; // a pitch jump this big starts a new stroke

// Growth follows the light: when it moves this far (0..1 of the garden) from
// where the current stroke began, the stroke closes and a fresh one starts at
// the new spot — so singing while sweeping the pointer plants a wave. These
// movement-split strokes accept a much shorter duration than a normal stroke,
// or a fast sweep would plant nothing at all.
export const STROKE_MOVE_X = 0.05;
export const MIN_MOVE_STROKE_SEC = 0.05;

// Stability: RMS deviation from the stroke's mean, in cents.
export const WOBBLE_CLEAN_CENTS = 15; // at/below this → fully clean
export const WOBBLE_WILD_CENTS = 75; // at/above this → fully wild

// ---- the light (where growth lands) ----
//
// A soft shaft of light stands over the garden; a sung tone takes root where
// the light falls. The player steers it with the pointer, or checks "rhythm"
// to let it sweep edge to edge on its own — then placement becomes timing.

export const LIGHT_EDGE_SEC = 1; // edge-to-edge travel time in rhythm mode
export const LIGHT_PERIOD_SEC = LIGHT_EDGE_SEC * 2; // full left→right→left cycle
export const LIGHT_MIN_X = 0.04;
export const LIGHT_MAX_X = 0.96;

/** Where the rhythm-mode light is (0..1 across the garden) at time t: a
 *  triangle wave, so it glides right then left at constant speed. */
export function lightX01(t: number): number {
  const phase = (((t % LIGHT_PERIOD_SEC) + LIGHT_PERIOD_SEC) % LIGHT_PERIOD_SEC) / LIGHT_PERIOD_SEC;
  const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
  return LIGHT_MIN_X + tri * (LIGHT_MAX_X - LIGHT_MIN_X);
}

// ---- pitch zones ----

export type Zone = "earth" | "green" | "sky";

// Zone boundaries in the voice range. The green (grass & flowers) band is by
// far the widest, so most casual singing seeds the meadow; mushrooms live in
// the lowest slice and trees in the highest.
export const EARTH_MAX = 0.22;
export const GREEN_MAX = 0.8;

/** Where a pitch sits in the player's voice range, clamped 0..1. */
export function bandFor(midi: number, voiceId: VoiceId): number {
  const v = getVoice(voiceId);
  return Math.min(1, Math.max(0, (midi - v.lo) / (v.hi - v.lo)));
}

/** The pitch zone: the lowest slice grows underground, the wide middle grows
 *  grass and flowers, the top raises trees and sky life. */
export function zoneFor(band01: number): Zone {
  if (band01 < EARTH_MAX) return "earth";
  if (band01 < GREEN_MAX) return "green";
  return "sky";
}

/** How deep in the earth zone a pitch sits: 1 at the very bottom of the voice,
 *  0 at the top of the mushroom band. */
export function earthDepth01(band01: number): number {
  return Math.min(1, Math.max(0, 1 - band01 / EARTH_MAX));
}

/** How high in the sky zone a pitch sits: 0 where trees begin, 1 at the top. */
export function skyBand01(band01: number): number {
  return Math.min(1, Math.max(0, (band01 - GREEN_MAX) / (1 - GREEN_MAX)));
}

// ---- mushroom varieties ----

// Where the tone sits within the mushroom band picks the variety: the deepest
// voices grow toadstools, rising through morels, chanterelles and russulas to
// puffballs at the top of the band.
export type MushroomVariety = "toadstool" | "morel" | "chanterelle" | "russula" | "puffball";
export const MUSHROOM_VARIETIES: readonly MushroomVariety[] = [
  "toadstool",
  "morel",
  "chanterelle",
  "russula",
  "puffball",
];

export function mushroomVariety(band01: number): MushroomVariety {
  const up = 1 - earthDepth01(band01); // 0 at the bottom of the voice → toadstool
  return MUSHROOM_VARIETIES[Math.min(MUSHROOM_VARIETIES.length - 1, Math.floor(up * 5))];
}

// ---- garden elements ----

// The garden's flora: low tones weave mushroom colonies (mycelium first, then
// fruit); mid tones grow grass and wildflowers with shallow roots; high tones
// raise ornamental trees with deep roots — or set a butterfly loose when the
// voice danced.
export type ElementKind = "grass" | "flower" | "mushroom" | "tree" | "butterfly";

/** Map an element kind from an older saved garden onto today's flora. */
export function migrateKind(kind: string): ElementKind {
  switch (kind) {
    case "root":
      return "mushroom"; // old underground taproots → mushroom colonies
    case "stem":
      return "grass"; // old mid greenery → grass
    case "blossom":
      return "tree"; // old sky blooms → flowering trees
    case "grass":
    case "flower":
    case "mushroom":
    case "tree":
    case "butterfly":
      return kind;
    default:
      return "grass";
  }
}

export interface GardenElement {
  id: number;
  kind: ElementKind;
  x01: number; // where the watering can was when the tone began
  band01: number; // where in the voice range the tone sat
  size: number; // 0..1, from how long the tone was held
  wobble: number; // 0 clean .. 1 wild
  hue: number; // rainbow hue of the sung pitch (shared with Range Explorer)
  seed: number; // deterministic drawing
  ts: number; // when it grew (Date.now())
}

export interface Garden {
  elements: GardenElement[];
  nextId: number;
  createdTs: number | null; // when the first element grew — the garden's birthday
}

export function emptyGarden(): Garden {
  return { elements: [], nextId: 1, createdTs: null };
}

// The garden is a living archive, but a bounded one: past this size the oldest
// growth quietly composts to make room (keeps drawing + storage sane).
export const MAX_ELEMENTS = 320;

export interface Stroke {
  dur: number; // seconds of voiced singing
  meanMidi: number;
  wobbleCents: number; // RMS deviation from the mean
  x01: number; // can position when the stroke began
}

/** 0 (clean) .. 1 (wild) from a stroke's RMS cents deviation. */
export function wobble01(wobbleCents: number): number {
  return Math.min(
    1,
    Math.max(0, (wobbleCents - WOBBLE_CLEAN_CENTS) / (WOBBLE_WILD_CENTS - WOBBLE_CLEAN_CENTS)),
  );
}

/** Element size 0..1 from how long the tone was held. */
export function strokeSize01(dur: number): number {
  return Math.min(1, Math.max(0.18, dur / FULL_STROKE_SEC));
}

// Grass is easy to grow — but it won't take where grass already crowds.
export const GRASS_CROWD_RADIUS = 0.05; // "the area": this close in x (0..1)
export const GRASS_CROWD_COUNT = 3; // this much grass there → a flower instead

/** Is there already a lot of grass around x01? */
export function grassCrowdedAt(garden: Garden, x01: number): boolean {
  let n = 0;
  for (const el of garden.elements) {
    if (el.kind === "grass" && Math.abs(el.x01 - x01) < GRASS_CROWD_RADIUS) n++;
    if (n >= GRASS_CROWD_COUNT) return true;
  }
  return false;
}

/**
 * What a finished stroke grows. Low tones weave mushroom colonies underground;
 * mid tones grow grass (readily — unless the spot is already thick with it,
 * when a wildflower comes up instead); high tones raise a tree when steady
 * and set a butterfly loose when the voice danced.
 */
export function elementKind(
  band01: number,
  wobble: number,
  rng: () => number,
  grassCrowded = false,
): ElementKind {
  const zone = zoneFor(band01);
  if (zone === "earth") return "mushroom";
  if (zone === "green") return !grassCrowded && rng() < 0.85 ? "grass" : "flower";
  return wobble > 0.5 ? "butterfly" : "tree";
}

/** Grow a stroke into a garden element. `now` and `rng` injectable for tests. */
export function elementFromStroke(
  garden: Garden,
  stroke: Stroke,
  voiceId: VoiceId,
  rng: () => number,
  now: number,
): GardenElement {
  const band01 = bandFor(stroke.meanMidi, voiceId);
  const wobble = wobble01(stroke.wobbleCents);
  return {
    id: garden.nextId,
    kind: elementKind(band01, wobble, rng, grassCrowdedAt(garden, stroke.x01)),
    x01: stroke.x01,
    band01,
    size: strokeSize01(stroke.dur),
    wobble,
    hue: hueFor(stroke.meanMidi),
    seed: Math.floor(rng() * 0x7fffffff),
    ts: now,
  };
}

/** Add an element to the garden (mutates): sets the birthday on first growth
 *  and composts the oldest element past MAX_ELEMENTS. */
export function addElement(garden: Garden, el: GardenElement): void {
  garden.elements.push(el);
  garden.nextId = el.id + 1;
  if (garden.createdTs == null) garden.createdTs = el.ts;
  while (garden.elements.length > MAX_ELEMENTS) garden.elements.shift();
}

/** Whole days (≥1) since the garden's first element; 0 for an empty garden. */
export function gardenAgeDays(garden: Garden, now: number): number {
  if (garden.createdTs == null) return 0;
  return Math.max(1, Math.floor((now - garden.createdTs) / 86400000) + 1);
}

/** Element counts by kind (for the session recap / HUD). */
export function countByKind(elements: GardenElement[]): Record<ElementKind, number> {
  const out: Record<ElementKind, number> = {
    grass: 0,
    flower: 0,
    mushroom: 0,
    tree: 0,
    butterfly: 0,
  };
  for (const el of elements) out[el.kind]++;
  return out;
}

// ---- crowding (new growth in front eventually buries the old) ----

// New plants sprout in the foreground and can obscure what's behind them.
// Once this many newer plants stand in front of an element, it dies and
// returns to the soil. Kept high so a plant survives a whole thicket growing
// over it before it finally gives way.
export const OCCLUDE_LIMIT = 30;

/** Half of an element's on-screen footprint (0..1 of garden width). */
export function elementHalfWidth(el: GardenElement): number {
  switch (el.kind) {
    case "grass":
      return 0.04 + el.size * 0.03; // a wide, sprawling patch
    case "flower":
      return 0.014 + el.size * 0.016;
    case "mushroom":
      return 0.02 + el.size * 0.026;
    case "tree":
      return 0.045 + el.size * 0.05;
    case "butterfly":
      return 0; // never occludes, never occluded
  }
}

/** Do two elements overlap enough for the newer one to obscure the older? */
export function occludes(older: GardenElement, newer: GardenElement): boolean {
  if (older.kind === "butterfly" || newer.kind === "butterfly") return false;
  const hw = (elementHalfWidth(older) + elementHalfWidth(newer)) * 0.6;
  return hw > 0 && Math.abs(older.x01 - newer.x01) < hw;
}

/**
 * Cull plants buried behind too much newer growth (mutates the garden).
 * Elements are stored oldest→newest, and newer draws over older, so an
 * element dies once OCCLUDE_LIMIT newer elements overlap it. Returns the
 * casualties so the engine can bid them farewell.
 */
export function applyOcclusion(garden: Garden): GardenElement[] {
  const els = garden.elements;
  const removed: GardenElement[] = [];
  const keep: GardenElement[] = [];
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    let inFront = 0;
    for (let j = i + 1; j < els.length && inFront < OCCLUDE_LIMIT; j++) {
      if (occludes(e, els[j])) inFront++;
    }
    if (inFront >= OCCLUDE_LIMIT) removed.push(e);
    else keep.push(e);
  }
  if (removed.length) garden.elements = keep;
  return removed;
}

// ---- stroke tracking ----

/**
 * Turns per-frame pitch samples into finished strokes. Feed it one
 * (time, fractional-MIDI-or-null, canX01) sample per frame; it returns a
 * Stroke when one completes (silence longer than STROKE_GAP_SEC or a pitch
 * jump larger than STROKE_BREAK_SEMITONES ends it), null otherwise.
 * Strokes shorter than MIN_STROKE_SEC are discarded.
 */
export class StrokeTracker {
  private active = false;
  private startT = 0;
  private lastVoiceT = 0;
  private x01 = 0;
  private n = 0;
  private sum = 0;
  private sumSq = 0;

  /** The in-progress stroke's voiced duration so far — drives the live growth. */
  progress(): number {
    return this.active ? Math.max(0, this.lastVoiceT - this.startT) : 0;
  }

  /** Is a stroke being sung right now? */
  isActive(): boolean {
    return this.active;
  }

  /** Mean pitch of the in-progress stroke (null when not singing). */
  liveMean(): number | null {
    return this.active && this.n > 0 ? this.sum / this.n : null;
  }

  /** RMS cents deviation of the in-progress stroke (null when not singing). */
  liveWobbleCents(): number | null {
    if (!this.active || this.n < 2) return null;
    const mean = this.sum / this.n;
    return Math.sqrt(Math.max(0, this.sumSq / this.n - mean * mean)) * 100;
  }

  /** Where the light stood when the in-progress stroke began. */
  strokeX01(): number | null {
    return this.active ? this.x01 : null;
  }

  push(t: number, midi: number | null, canX: number): Stroke | null {
    if (midi == null) {
      if (this.active && t - this.lastVoiceT > STROKE_GAP_SEC) return this.finish();
      return null;
    }
    if (!this.active) {
      this.begin(t, midi, canX);
      return null;
    }
    if (Math.abs(canX - this.x01) > STROKE_MOVE_X) {
      // The light has moved on: plant here (even a short dab counts while
      // sweeping) and start growing at the new spot — the wave effect.
      const done = this.finish(MIN_MOVE_STROKE_SEC);
      this.begin(t, midi, canX);
      return done;
    }
    const mean = this.sum / this.n;
    if (Math.abs(midi - mean) > STROKE_BREAK_SEMITONES) {
      // The voice leapt to a different note: close this stroke, start the next.
      const done = this.finish();
      this.begin(t, midi, canX);
      return done;
    }
    this.n++;
    this.sum += midi;
    this.sumSq += midi * midi;
    this.lastVoiceT = t;
    return null;
  }

  /** Force-close the current stroke (e.g. on quit), returning it if long enough. */
  flush(): Stroke | null {
    return this.active ? this.finish() : null;
  }

  private begin(t: number, midi: number, canX: number): void {
    this.active = true;
    this.startT = t;
    this.lastVoiceT = t;
    this.x01 = canX;
    this.n = 1;
    this.sum = midi;
    this.sumSq = midi * midi;
  }

  private finish(minDur = MIN_STROKE_SEC): Stroke | null {
    this.active = false;
    const dur = this.lastVoiceT - this.startT;
    if (dur < minDur || this.n < 2) return null;
    const mean = this.sum / this.n;
    const variance = Math.max(0, this.sumSq / this.n - mean * mean);
    return {
      dur,
      meanMidi: mean,
      wobbleCents: Math.sqrt(variance) * 100,
      x01: this.x01,
    };
  }
}

// ---- gentle guidance ----

/** A soft prompt for the HUD, rotating with time and aware of what the garden
 *  still lacks. Never instructions to obey — invitations. */
export function gardenPrompt(counts: Record<ElementKind, number>, elapsed: number): string {
  const ground = counts.grass + counts.flower;
  const total = ground + counts.mushroom + counts.tree + counts.butterfly;
  if (total === 0) return "Sing a soft, steady note — anywhere in your voice — and hold it.";
  const sky = counts.tree + counts.butterfly;
  const invites: string[] = [];
  if (counts.mushroom < ground) invites.push("Low, slow notes weave mycelium and mushrooms.");
  if (sky < ground) invites.push("High notes raise trees — a wavering one becomes a butterfly.");
  invites.push("Steady tones grow clean shapes; let one wander and see what happens.");
  invites.push("Your note takes root where the light falls — guide it, or let it sweep.");
  invites.push("Crowded plants fade — new growth in front buries the old.");
  return invites[Math.floor(elapsed / 16) % invites.length];
}
