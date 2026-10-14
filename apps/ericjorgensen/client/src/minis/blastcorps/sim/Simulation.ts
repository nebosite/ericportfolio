import { BreakLog } from "./BreakLog";
import { Building } from "./Building";
import type { BuildingPlan } from "./buildingPlan";
import { countDisplaced, displacedMassByStructure } from "./demolition";
import { PhysicsWorld, type JoltModule, type Vec3Tuple } from "./PhysicsWorld";
import {
  EVENTS_OFFSET,
  Header,
  IDLE_CONTROLS,
  MAX_STRUCTURES,
  MaterialKind,
  PARTS_OFFSET,
  POSE_FLOATS,
  STRUCTURES_OFFSET,
  VEHICLE_OFFSET,
  VISUAL_FLOATS,
  snapshotLength,
  type DriveControls,
  type ReadyMessage,
  type SceneSpec,
  type StructureInfo,
} from "./protocol";
import { planMass } from "./skyscraper";
import { planScene, type StreetLayout } from "./street";
import { VEHICLE_SPECS, Vehicle } from "./Vehicle";

// The whole simulation behind one object: world, structures, vehicle, a fixed-step
// clock, and the snapshot it publishes after stepping. The worker is a thin
// message adapter around this; headless tests drive it directly.
//
// Scale rules:
// - Every part's pose lives in one city-wide array that is only rewritten for
//   bodies Jolt reports as awake. A 30k-part street that is asleep costs one
//   memcpy per snapshot.
// - Structures are built one per call to buildNext(), between steps, so the
//   player drives while the street pops in. Until a structure is built its parts
//   are visible but have no physics (the renderer hides them past BuiltParts).

export const FIXED_DT = 1 / 60;
/** Cap on catch-up steps per tick: fall behind rather than spiral. */
export const MAX_STEPS_PER_TICK = 4;

export interface SimulationOptions {
  /** Worker threads Jolt may use (0 = single-threaded build). */
  threads?: number;
  /** Pre-settle steps per structure (see Building). */
  presettleSteps?: number;
}

export class Simulation {
  readonly world: PhysicsWorld;
  readonly threads: number;
  readonly isolated: boolean;
  structures: Building[] = [];
  vehicle: Vehicle;
  scene: SceneSpec;
  layout: StreetLayout;
  /** City-wide poses, 7 floats per part, indexed by global part index. */
  poses = new Float32Array(0);
  /** Static visuals: half extents + material kind per part. */
  visuals = new Float32Array(0);
  private rest = new Float32Array(0);
  private masses = new Float32Array(0);
  private totalMass = 0;
  private queue: BuildingPlan[] = [];
  private partStarts: number[] = [];
  private builtParts = 0;
  private readonly post: (buffer: ArrayBuffer) => void;
  private readonly presettleSteps: number;
  private controls: DriveControls = IDLE_CONTROLS;
  private free: ArrayBuffer[] = [];
  private accumulator = 0;
  private last: number | null = null;
  private readonly breaks = new BreakLog();
  private breaksSinceSnapshot = 0;
  private timings = { total: 0, step: 0, mortar: 0, pose: 0 };
  private flipped = false;
  /** Game steps taken (pre-settling steps happen inside the world and don't count). */
  private steps = 0;

  constructor(
    J: JoltModule,
    scene: SceneSpec,
    post: (buffer: ArrayBuffer) => void,
    opts: SimulationOptions = {},
  ) {
    this.post = post;
    this.threads = opts.threads ?? 0;
    this.isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    // Masonry needs ~1.5 s to converge; steel frames settle in 1 s and are costlier per step.
    this.presettleSteps = opts.presettleSteps ?? (scene.kind === "street" ? 60 : 90);
    this.world = new PhysicsWorld(J, 65536, this.threads);
    this.world.addGround();
    this.scene = scene;
    this.layout = this.load(scene);
    this.vehicle = new Vehicle(
      this.world,
      this.layout.spawn,
      0,
      VEHICLE_SPECS[this.layout.vehicle],
    );
  }

  get partCount(): number {
    return this.poses.length / POSE_FLOATS;
  }

  /** Joints across every planned structure, built or not. */
  get jointCount(): number {
    return this.layout.plans.reduce((n, p) => n + p.joints.length, 0);
  }

  /** Joints still holding: unbuilt structures count as intact. */
  get jointsAlive(): number {
    const built = this.structures.reduce((n, s) => n + s.jointsAlive, 0);
    const pending = this.queue.reduce((n, p) => n + p.joints.length, 0);
    return built + pending;
  }

  get structuresBuilt(): number {
    return this.structures.length;
  }

  /** Static description for the main thread, sent once per (re)build. */
  describe(): Omit<ReadyMessage, "type" | "threads" | "crossOriginIsolated"> {
    const structures: StructureInfo[] = this.layout.plans.map((plan, i) => ({
      partStart: this.partStarts[i],
      partCount: plan.parts.length,
      center: [plan.center[0], plan.height / 2, plan.center[1]],
      height: plan.height,
      halfWidth: plan.halfWidth,
      mass: planMass(plan),
    }));
    return {
      partCount: this.partCount,
      jointCount: this.jointCount,
      visuals: this.visuals,
      structures,
      spawn: this.layout.spawn,
      vehicle: this.layout.vehicle,
      streetLength: this.layout.length,
    };
  }

  progress(): { built: number; total: number; builtParts: number } {
    return {
      built: this.structures.length,
      total: this.layout.plans.length,
      builtParts: this.builtParts,
    };
  }

  /** Build the next pending structure (one per call). Returns false when the street is complete. */
  buildNext(): boolean {
    const plan = this.queue.shift();
    if (!plan) return false;
    const base = this.partStarts[this.structures.length];
    const building = new Building(this.world, plan, undefined, this.presettleSteps, base);
    building.writePoses(this.poses, base * POSE_FLOATS);
    this.rest.set(building.rest, base * 3);
    this.structures.push(building);
    this.builtParts = base + plan.parts.length;
    return true;
  }

  /** Build everything now (tests and headless probes). */
  buildAll(): void {
    while (this.buildNext()) {
      /* keep going */
    }
  }

  setControls(controls: DriveControls): void {
    this.controls = controls;
  }

  /** Simulation rate relative to real time (1 = live, 0.25 = slow motion). */
  timeScale = 1;

  setTimeScale(value: number): void {
    this.timeScale = Math.min(1, Math.max(0.05, value));
  }

  /** The main thread hands a consumed snapshot buffer back for reuse. */
  recycle(buffer: ArrayBuffer): void {
    if (buffer.byteLength === snapshotLength(this.partCount) * 4) this.free.push(buffer);
  }

  /** Tear the city down, lay out the scene again (same or new), respawn the vehicle. */
  reset(scene: SceneSpec = this.scene): void {
    for (const s of this.structures) s.destroy();
    this.scene = scene;
    this.layout = this.load(scene);
    if (this.vehicle.spec.kind !== this.layout.vehicle) {
      this.vehicle.destroy();
      this.vehicle = new Vehicle(
        this.world,
        this.layout.spawn,
        0,
        VEHICLE_SPECS[this.layout.vehicle],
      );
    }
    this.vehicle.reset(this.layout.spawn, 0);
    this.controls = IDLE_CONTROLS;
    this.accumulator = 0;
    this.last = null;
    this.breaks.clear();
    this.breaksSinceSnapshot = 0;
    this.steps = 0;
  }

  /**
   * Advance by wall-clock time: steps the fixed clock as many times as fit (capped),
   * then publishes a snapshot if a buffer is free. Returns the steps taken.
   */
  tick(nowMs: number): number {
    if (this.last === null) this.last = nowMs;
    // Slow motion is simply fewer fixed steps per real second: the solver keeps
    // stepping at 60 Hz of simulated time, so debris hangs mid-air for real.
    this.accumulator += Math.min(0.25, (nowMs - this.last) / 1000) * this.timeScale;
    this.last = nowMs;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_TICK) {
      this.step();
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps > MAX_STEPS_PER_TICK - 1) this.accumulator = 0; // we fell behind: drop the backlog
    if (steps > 0) this.publish();
    return steps;
  }

  /** One fixed step: drive, simulate, fail overloaded joints, copy out moved poses, right a flipped vehicle. */
  step(): void {
    const t0 = now();
    this.vehicle.applyControls(this.controls);
    this.world.step(FIXED_DT);
    const t1 = now();
    let broke = 0;
    for (const s of this.structures) broke += s.applyMortar(FIXED_DT, this.breaks);
    this.breaksSinceSnapshot += broke;
    const t2 = now();
    this.updateActivePoses();
    const t3 = now();
    this.vehicle.autoRight(FIXED_DT);
    this.flipped = this.vehicle.isFlipped();
    this.timings = { total: now() - t0, step: t1 - t0, mortar: t2 - t1, pose: t3 - t2 };
    this.steps++;
  }

  /** Fill `out` with header, break events, vehicle poses and all part poses. */
  writeSnapshot(out: Float32Array): void {
    this.vehicle.writePoses(out, VEHICLE_OFFSET);
    out.set(this.poses, PARTS_OFFSET);
    this.breaks.writeTo(out, EVENTS_OFFSET);
    const awake = this.world.activeBodies();
    const [heapUsed, heapTotal] = this.world.heapMb();
    out[Header.Step] = this.steps;
    out[Header.PhysicsMs] = this.timings.total;
    out[Header.StepMs] = this.timings.step;
    out[Header.MortarMs] = this.timings.mortar;
    out[Header.PoseMs] = this.timings.pose;
    out[Header.Awake] = awake;
    out[Header.JointsAlive] = this.jointsAlive;
    out[Header.JointsTotal] = this.jointCount;
    out[Header.BreaksThisStep] = this.breaksSinceSnapshot;
    out[Header.BreakCount] = this.breaks.count;
    out[Header.Displaced] = countDisplaced(this.poses, 0, this.rest, this.partCount);
    out[Header.SpeedMps] = this.vehicle.forwardSpeed();
    out[Header.Flipped] = this.flipped ? 1 : 0;
    out[Header.PeakStress] = Math.max(0, ...this.structures.map((s) => s.takePeakUtilisation()));
    out[Header.Violence] = violence(this.breaksSinceSnapshot, awake, this.builtParts);
    out[Header.BuiltParts] = this.builtParts;
    out[Header.HeapUsedMb] = heapUsed;
    out[Header.HeapTotalMb] = heapTotal;
    const perStructure = displacedMassByStructure(
      this.poses,
      0,
      this.rest,
      this.masses,
      this.partStarts,
      this.partCount,
    );
    let demolished = 0;
    perStructure.forEach((fraction, s) => {
      if (s < MAX_STRUCTURES) out[STRUCTURES_OFFSET + s] = fraction;
      demolished += fraction * this.structureMass(s);
    });
    out[Header.DemolishedMassFraction] = this.totalMass === 0 ? 0 : demolished / this.totalMass;
    this.breaksSinceSnapshot = 0;
    this.breaks.clear();
  }

  private structureMass(s: number): number {
    return planMass(this.layout.plans[s]);
  }

  destroy(): void {
    this.vehicle.destroy();
    for (const s of this.structures) s.destroy();
    this.world.destroy();
  }

  /** Lay out a scene: size every city-wide array, seed poses from the plans, queue the builds. */
  private load(scene: SceneSpec): StreetLayout {
    const layout = planScene(scene);
    const total = layout.plans.reduce((n, p) => n + p.parts.length, 0);
    this.poses = new Float32Array(total * POSE_FLOATS);
    this.rest = new Float32Array(total * 3);
    this.masses = new Float32Array(total);
    this.visuals = new Float32Array(total * VISUAL_FLOATS);
    this.partStarts = [];
    this.structures = [];
    this.builtParts = 0;
    this.totalMass = 0;
    let i = 0;
    for (const plan of layout.plans) {
      this.partStarts.push(i);
      for (const p of plan.parts) {
        this.poses.set([p.center[0], p.center[1], p.center[2], 0, 0, 0, 1], i * POSE_FLOATS);
        this.rest.set(p.center, i * 3);
        this.masses[i] = p.mass;
        this.totalMass += p.mass;
        this.visuals.set(
          [p.half[0], p.half[1], p.half[2], p.kind ?? MaterialKind.Masonry],
          i * VISUAL_FLOATS,
        );
        i++;
      }
    }
    this.queue = [...layout.plans];
    this.allocateBuffers();
    return layout;
  }

  /** Rewrite the poses of bodies that are awake; everything else is unchanged by definition. */
  private updateActivePoses(): void {
    const count = this.partCount;
    this.world.forEachActiveBody((index, id) => {
      if (index < count) this.world.readPoseById(id, this.poses, index * POSE_FLOATS);
    });
  }

  private publish(): void {
    const buffer = this.free.pop();
    if (!buffer) return; // both snapshots still in flight; skip this one
    this.writeSnapshot(new Float32Array(buffer));
    this.post(buffer);
  }

  private allocateBuffers(): void {
    const bytes = snapshotLength(this.partCount) * 4;
    this.free = [new ArrayBuffer(bytes), new ArrayBuffer(bytes)];
  }
}

/**
 * How much is happening, for sound and shake: joint failures dominate, with the
 * share of the built city that is awake as a floor so a sliding pile still rumbles.
 */
export function violence(breaks: number, awake: number, builtParts: number): number {
  const awakeFraction = builtParts === 0 ? 0 : Math.min(1, awake / builtParts);
  return breaks + 4 * awakeFraction;
}

export type { Vec3Tuple };

const now = (): number =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
