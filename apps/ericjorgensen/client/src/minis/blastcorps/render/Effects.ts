import type * as THREE from "three";
import { EVENT_FLOATS, MaterialKind } from "../sim/protocol";
import { ParticleKind, burst, burstsForMaterial, type SpawnRange } from "./particles";
import { ParticleSystem } from "./ParticleSystem";

// Atmosphere: turns the snapshot's break events into particle bursts and runs
// the persistent emitters (fires, steam vents) they can start. Purely visual —
// nothing here feeds back into the physics.

const NORMAL_CAPACITY = 150_000;
const ADDITIVE_CAPACITY = 50_000;
const MAX_FIRES = 12;
const MAX_VENTS = 16;
/** A steel failure this close to the ground may start a fire (ruptured service lines). */
const FIRE_MAX_HEIGHT = 14;
const FIRE_CHANCE = 0.08;
const FIRE_SECONDS = 22;
/** Concrete failures on service floors (every 8th story) vent steam. */
const VENT_CHANCE = 0.25;
const VENT_SECONDS = 7;
const STORY = 4;

interface Emitter {
  x: number;
  y: number;
  z: number;
  until: number;
  accumulator: number;
}

export class Effects {
  readonly normal = new ParticleSystem(NORMAL_CAPACITY, false);
  readonly additive = new ParticleSystem(ADDITIVE_CAPACITY, true);
  private readonly fires: Emitter[] = [];
  private readonly vents: Emitter[] = [];
  private rnd = mulberry32(12345);
  /** Particles spawned since the last stats read. */
  spawnedSince = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.normal.points);
    scene.add(this.additive.points);
  }

  /**
   * Fold this step's break events in. `events` is [x, y, z, material] × count.
   * `violence` scales smoke at the centroid of the breaks.
   */
  onBreaks(events: ArrayLike<number>, count: number, now: number, violence: number): void {
    if (count === 0) return;
    // Spawn fewer particles per event in a big collapse so the budget lasts.
    const scale = count > 200 ? 0.3 : count > 60 ? 0.6 : 1;
    const normalRanges: SpawnRange[] = [];
    const additiveRanges: SpawnRange[] = [];
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < count; i++) {
      const x = events[i * EVENT_FLOATS];
      const y = events[i * EVENT_FLOATS + 1];
      const z = events[i * EVENT_FLOATS + 2];
      const material = events[i * EVENT_FLOATS + 3] as MaterialKind;
      cx += x;
      cy += y;
      cz += z;
      for (const kind of burstsForMaterial(material)) {
        const target =
          kind === ParticleKind.Spark || kind === ParticleKind.Flame ? this.additive : this.normal;
        const ranges = burst(target.ring, kind, x, y, z, now, this.rnd, scale);
        (target === this.additive ? additiveRanges : normalRanges).push(...ranges);
      }
      if (material === MaterialKind.Steel && y < FIRE_MAX_HEIGHT && this.fires.length < MAX_FIRES) {
        if (this.rnd() < FIRE_CHANCE)
          this.fires.push({ x, y, z, until: now + FIRE_SECONDS, accumulator: 0 });
      }
      if (material === MaterialKind.Concrete && this.vents.length < MAX_VENTS) {
        const story = Math.round(y / STORY);
        if (story % 8 === 0 && this.rnd() < VENT_CHANCE) {
          this.vents.push({ x, y, z, until: now + VENT_SECONDS, accumulator: 0 });
        }
      }
    }
    // A collapse front breathes smoke in proportion to how much is failing.
    if (violence > 4) {
      const smoke = Math.min(40, Math.round(violence * 0.4));
      normalRanges.push(
        ...burst(
          this.normal.ring,
          ParticleKind.Smoke,
          cx / count,
          cy / count,
          cz / count,
          now,
          this.rnd,
          smoke / 2,
        ),
      );
    }
    this.normal.commit(normalRanges);
    this.additive.commit(additiveRanges);
    this.spawnedSince += normalRanges.reduce((n, r) => n + r.count, 0);
    this.spawnedSince += additiveRanges.reduce((n, r) => n + r.count, 0);
  }

  /** Run the persistent emitters and advance the particle clocks. */
  update(now: number, dt: number, viewportHeightPx: number): void {
    const normalRanges: SpawnRange[] = [];
    const additiveRanges: SpawnRange[] = [];
    for (const list of [this.fires, this.vents]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (now > e.until) {
          list.splice(i, 1);
          continue;
        }
        e.accumulator += dt;
        const isFire = list === this.fires;
        const period = isFire ? 0.05 : 0.08;
        while (e.accumulator >= period) {
          e.accumulator -= period;
          if (isFire) {
            additiveRanges.push(
              ...burst(this.additive.ring, ParticleKind.Flame, e.x, e.y + 0.5, e.z, now, this.rnd),
            );
            if (this.rnd() < 0.5)
              normalRanges.push(
                ...burst(
                  this.normal.ring,
                  ParticleKind.Smoke,
                  e.x,
                  e.y + 2,
                  e.z,
                  now,
                  this.rnd,
                  0.5,
                ),
              );
          } else {
            normalRanges.push(
              ...burst(this.normal.ring, ParticleKind.Steam, e.x, e.y, e.z, now, this.rnd),
            );
          }
        }
      }
    }
    if (normalRanges.length) this.normal.commit(normalRanges);
    if (additiveRanges.length) this.additive.commit(additiveRanges);
    this.spawnedSince += normalRanges.reduce((n, r) => n + r.count, 0);
    this.spawnedSince += additiveRanges.reduce((n, r) => n + r.count, 0);
    this.normal.update(now, viewportHeightPx);
    this.additive.update(now, viewportHeightPx);
  }

  get activeEmitters(): number {
    return this.fires.length + this.vents.length;
  }

  /** Approximate particles alive (sampled, for the stats panel). */
  alive(now: number): number {
    return this.normal.ring.alive(now) + this.additive.ring.alive(now);
  }

  dispose(): void {
    this.normal.dispose();
    this.additive.dispose();
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
