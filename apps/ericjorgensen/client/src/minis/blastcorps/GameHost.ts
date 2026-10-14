import { RumbleSynth } from "./audio/Rumble";
import { mergeControls } from "./input/controls";
import { GamepadSource } from "./input/GamepadSource";
import { KeyboardSource, type InputAction } from "./input/KeyboardSource";
import { PhysicsBridge } from "./PhysicsBridge";
import { SceneRenderer } from "./render/SceneRenderer";
import {
  EVENTS_OFFSET,
  EVENT_FLOATS,
  Header,
  MAX_STRUCTURES,
  STRUCTURES_OFFSET,
  VEHICLE_OFFSET,
  type ReadyMessage,
  type SceneSpec,
  type StructureInfo,
} from "./sim/protocol";
import { VEHICLE_SPECS } from "./sim/Vehicle";
import { StatTracker, type StatSample } from "./stats/StatTracker";

// Main-thread conductor for one play session: physics worker ⇄ input ⇄ renderer,
// with a requestAnimationFrame loop. The page owns the React state; this class
// pushes it a stats summary about ten times a second and forwards one-shot
// actions (reset / quit / debug). It is the glue the page test mocks, so it
// stays thin and declarative; the hi/lo bookkeeping lives in StatTracker.

export interface HostStats {
  ready: boolean;
  /** Structures with physics so far, out of the scene's total. */
  built: number;
  totalStructures: number;
  partCount: number;
  jointCount: number;
  jointsAlive: number;
  /** Street demolition, 0..1, by displaced mass. */
  demolition: number;
  /** Per-structure demolition by mass, in street order. */
  structureDemolition: number[];
  structures: StructureInfo[];
  awake: number;
  physicsMs: number;
  fps: number;
  speed: number;
  flipped: boolean;
  /** Set once the player has first touched the throttle (starts the clock). */
  throttleSeen: boolean;
  padConnected: boolean;
  threads: number;
  crossOriginIsolated: boolean;
  gpu: string;
  /** Vehicle position along the street (m) and the street's built-up length. */
  vehicleZ: number;
  streetLength: number;
  /** Simulation rate relative to real time (0.25 while slow motion is held). */
  timeScale: number;
  /** Hi/lo rows for the hardware panel. */
  rows: { name: string; sample: StatSample }[];
}

export interface HostEvents {
  onStats: (stats: HostStats) => void;
  onAction: (action: InputAction) => void;
  onError: (message: string) => void;
}

const STATS_INTERVAL_MS = 100;
/** A break this close to the vehicle counts as the blade striking something. */
const STRIKE_RADIUS = 20;
/** Quiet time before another strike onset can fire. */
const STRIKE_COOLDOWN_MS = 400;
const SLOW_MOTION = 0.25;

export class GameHost {
  private readonly canvas: HTMLCanvasElement;
  private readonly events: HostEvents;
  private readonly bridge: PhysicsBridge;
  private readonly renderer: SceneRenderer;
  private readonly keyboard: KeyboardSource;
  private readonly gamepad: GamepadSource;
  private readonly tracker = new StatTracker();
  private audio: RumbleSynth | null = null;
  private breakTimes: number[] = [];
  private lastStrikeAt = -Infinity;
  private lastNearBreakAt = -Infinity;
  private builtParts = 0;
  private lastAliveSample = 0;
  private timeScale = 1;
  private scene: SceneSpec;
  private raf = 0;
  private lastFrame = 0;
  private lastStats = 0;
  private lastBytes = 0;
  private lastBytesAt = 0;
  private fps = 60;
  private speed = 0;
  private stats: HostStats;
  private readonly resizeObserver: ResizeObserver | null;

  constructor(canvas: HTMLCanvasElement, scene: SceneSpec, events: HostEvents) {
    this.canvas = canvas;
    this.events = events;
    this.scene = scene;
    this.renderer = new SceneRenderer(canvas);
    this.stats = {
      ready: false,
      built: 0,
      totalStructures: 0,
      partCount: 0,
      jointCount: 0,
      jointsAlive: 0,
      demolition: 0,
      structureDemolition: [],
      structures: [],
      awake: 0,
      physicsMs: 0,
      fps: 60,
      speed: 0,
      flipped: false,
      throttleSeen: false,
      padConnected: false,
      threads: 0,
      crossOriginIsolated: false,
      gpu: this.renderer.gpuName(),
      vehicleZ: 0,
      streetLength: 0,
      timeScale: 1,
      rows: [],
    };
    const onAction = (action: InputAction) => this.events.onAction(action);
    this.keyboard = new KeyboardSource(window, onAction);
    this.gamepad = new GamepadSource(onAction);
    this.bridge = new PhysicsBridge({
      onReady: (ready) => this.onReady(ready),
      onProgress: (built, total) => {
        this.stats = { ...this.stats, built, totalStructures: total };
        this.events.onStats(this.stats);
      },
      onSnapshot: (snap) => this.onSnapshot(snap),
      onError: (message) => this.events.onError(message),
    });
    this.resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.fit()) : null;
  }

  start(): void {
    this.fit();
    this.resizeObserver?.observe(this.canvas);
    this.keyboard.attach();
    try {
      this.audio = new RumbleSynth(this.topSpeed);
      this.audio.start();
    } catch {
      this.audio = null; // no Web Audio: play silently
    }
    this.bridge.init(this.scene);
    this.lastFrame = performance.now();
    this.lastBytesAt = this.lastFrame;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Rebuild the scene (optionally a different one) and respawn the vehicle. */
  reset(scene: SceneSpec = this.scene): void {
    this.scene = scene;
    this.stats = { ...this.stats, ready: false, built: 0, demolition: 0, throttleSeen: false };
    this.events.onStats(this.stats);
    this.bridge.reset(scene);
  }

  /** Forget hi/lo history (R also does this). */
  resetStats(): void {
    this.tracker.reset();
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.keyboard.detach();
    this.bridge.terminate();
    this.renderer.dispose();
    this.audio?.dispose();
  }

  private get topSpeed(): number {
    return VEHICLE_SPECS[this.scene.kind === "street" ? "tractor" : "dozer"].topSpeed;
  }

  private onReady(ready: ReadyMessage): void {
    this.renderer.setScene(ready.visuals, ready.partCount, ready.structures, ready.vehicle);
    this.stats = {
      ...this.stats,
      ready: true,
      built: 0,
      totalStructures: ready.structures.length,
      partCount: ready.partCount,
      jointCount: ready.jointCount,
      jointsAlive: ready.jointCount,
      structures: ready.structures,
      structureDemolition: ready.structures.map(() => 0),
      threads: ready.threads,
      streetLength: ready.streetLength,
      crossOriginIsolated: ready.crossOriginIsolated,
    };
    this.tracker.reset();
    this.events.onStats(this.stats);
  }

  private frame = (now: number) => {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.1;

    const pad = this.gamepad.poll();
    const controls = mergeControls(this.keyboard.state, pad, this.speed);
    this.bridge.setControls(controls);
    if (!this.stats.throttleSeen && controls.throttle !== 0) {
      this.stats = { ...this.stats, throttleSeen: true };
    }
    // Slow motion while held: the solver keeps stepping, time stretches.
    const wantScale = this.keyboard.state.slow || pad.slow ? SLOW_MOTION : 1;
    if (wantScale !== this.timeScale) {
      this.timeScale = wantScale;
      this.bridge.setTimeScale(wantScale);
      this.stats = { ...this.stats, timeScale: wantScale };
    }

    const t0 = performance.now();
    this.renderer.render(dt, now / 1000);
    const renderMs = performance.now() - t0;
    this.tracker.record("fps", Math.round(this.fps));
    this.tracker.record("frame ms", dt * 1000);
    this.tracker.record("render ms", renderMs);

    if (this.audio) {
      const cutoff = now - 1000;
      while (this.breakTimes.length && this.breakTimes[0] < cutoff) this.breakTimes.shift();
      const breaksPerSecond = this.breakTimes.length;
      const awakeFraction =
        this.builtParts > 0 ? Math.min(1, this.stats.awake / this.builtParts) : 0;
      this.audio.update(this.speed, awakeFraction, breaksPerSecond, dt);
    }

    if (now - this.lastStats > STATS_INTERVAL_MS) {
      this.lastStats = now;
      const info = this.renderer.info;
      this.tracker.record("draw calls", info.calls);
      this.tracker.record("triangles", info.triangles);
      const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      if (memory) this.tracker.record("js heap MB", memory.usedJSHeapSize / 1048576);
      if (now - this.lastAliveSample > 1000) {
        this.lastAliveSample = now;
        this.tracker.record("particles alive", this.renderer.effects.alive(now / 1000));
        this.tracker.record("emitters", this.renderer.effects.activeEmitters);
      }
      const seconds = (now - this.lastBytesAt) / 1000;
      if (seconds > 0.5) {
        this.tracker.record(
          "snapshot MB/s",
          (this.bridge.bytesReceived - this.lastBytes) / 1048576 / seconds,
        );
        this.lastBytes = this.bridge.bytesReceived;
        this.lastBytesAt = now;
      }
      this.stats = {
        ...this.stats,
        fps: Math.round(this.fps),
        padConnected: this.gamepad.connected,
        rows: this.tracker.toRows(),
      };
      this.events.onStats(this.stats);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private onSnapshot(snap: Float32Array): void {
    const now = performance.now();
    this.renderer.applySnapshot(snap, now / 1000, 1 / 60);
    this.speed = snap[Header.SpeedMps];
    this.builtParts = snap[Header.BuiltParts];
    const vx = snap[VEHICLE_OFFSET];
    const vz = snap[VEHICLE_OFFSET + 2];

    // Breaks feed the roar; glass tinkles; a break near the blade after a quiet
    // spell is a strike onset — the hit the machine's momentum never shows.
    const breaks = snap[Header.BreaksThisStep];
    for (let i = 0; i < Math.min(breaks, 50); i++) this.breakTimes.push(now);
    const count = snap[Header.BreakCount];
    let glass = 0;
    let near = false;
    for (let i = 0; i < count; i++) {
      const o = EVENTS_OFFSET + i * EVENT_FLOATS;
      if (snap[o + 3] === 3) glass++;
      const dx = snap[o] - vx;
      const dz = snap[o + 2] - vz;
      if (dx * dx + dz * dz < STRIKE_RADIUS * STRIKE_RADIUS) near = true;
    }
    if (near) {
      if (
        now - this.lastNearBreakAt > STRIKE_COOLDOWN_MS &&
        now - this.lastStrikeAt > STRIKE_COOLDOWN_MS
      ) {
        this.lastStrikeAt = now;
        const strength = Math.min(1, Math.abs(this.speed) / this.topSpeed);
        this.audio?.strike(strength);
        this.renderer.strike(strength);
      }
      this.lastNearBreakAt = now;
    }
    if (glass > 0) this.audio?.glass(glass);

    const structureDemolition: number[] = [];
    for (let s = 0; s < Math.min(this.stats.structures.length, MAX_STRUCTURES); s++) {
      structureDemolition.push(snap[STRUCTURES_OFFSET + s]);
    }
    this.renderer.setDemolition(structureDemolition);
    this.tracker.record("physics ms", snap[Header.PhysicsMs]);
    this.tracker.record("jolt step ms", snap[Header.StepMs]);
    this.tracker.record("joint scan ms", snap[Header.MortarMs]);
    this.tracker.record("pose copy ms", snap[Header.PoseMs]);
    this.tracker.record("bodies awake", snap[Header.Awake]);
    this.tracker.record("joints holding", snap[Header.JointsAlive]);
    this.tracker.record("breaks / step", snap[Header.BreaksThisStep]);
    this.tracker.record("wasm heap MB", snap[Header.HeapUsedMb]);
    this.tracker.record("speed km/h", snap[Header.SpeedMps] * 3.6);
    this.stats = {
      ...this.stats,
      demolition: snap[Header.DemolishedMassFraction],
      structureDemolition,
      awake: snap[Header.Awake],
      physicsMs: snap[Header.PhysicsMs],
      jointsAlive: snap[Header.JointsAlive],
      speed: this.speed,
      flipped: snap[Header.Flipped] > 0.5,
      vehicleZ: vz,
    };
  }

  private fit(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(
      Math.max(1, Math.round(rect.width * dpr)),
      Math.max(1, Math.round(rect.height * dpr)),
    );
  }
}
