// Wire protocol between the main thread and the physics worker, plus the layout
// of the per-step snapshot. Pure types and layout constants — shared by the
// worker (writer), PhysicsBridge (carrier) and the renderer/audio (readers).
//
// Snapshot layout (Float32):
//   [header][break events: MAX_BREAK_EVENTS × EVENT_FLOATS][vehicle poses][part poses × 7]

/** What to build. `street` lays `towers` skyscrapers along an avenue; `tower` is the slice-1 masonry tower. */
export type FloorsPolicy = "auto" | "none" | "all";

export type SceneSpec =
  | { kind: "tower"; size: "small" | "medium" | "large" | "huge" | "colossal" }
  | {
      kind: "street";
      towers: number;
      maxStories: number;
      glass: boolean;
      /** Floor slabs: "auto" only on towers short enough for the solver to hold them (see street.ts). */
      floors?: FloorsPolicy;
    };

/** One structure's static description, sent once with `ready`. */
export interface StructureInfo {
  /** Global index of its first part and how many it has. */
  partStart: number;
  partCount: number;
  center: [number, number, number];
  height: number;
  halfWidth: number;
  /** Total mass (kg), for tonnage scoring. */
  mass: number;
}

/** Floats per part in the static visuals array: half extents xyz + material kind. */
export const VISUAL_FLOATS = 4;

/** Driver input, normalised. throttle −1..1 (negative = reverse), steer −1..1 (positive = right). */
export interface DriveControls {
  throttle: number;
  steer: number;
  brake: number; // 0..1
  handbrake: number; // 0..1
}

export const IDLE_CONTROLS: DriveControls = { throttle: 0, steer: 0, brake: 0, handbrake: 0 };

export type MainToWorker =
  | { type: "init"; scene: SceneSpec }
  | { type: "controls"; controls: DriveControls }
  | { type: "reset"; scene?: SceneSpec }
  | { type: "timeScale"; value: number }
  | { type: "recycle"; buffer: ArrayBuffer };

/** Sent once per (re)build; the renderer sizes its buffers from this. */
export interface ReadyMessage {
  type: "ready";
  partCount: number;
  jointCount: number;
  /** VISUAL_FLOATS per part: half extents + material kind. */
  visuals: Float32Array;
  structures: StructureInfo[];
  spawn: [number, number, number];
  vehicle: VehicleKind;
  /** Length of the built-up street along +z (m), for the end-of-street card. */
  streetLength: number;
  /** Worker threads Jolt may use (0 = single-threaded build). */
  threads: number;
  crossOriginIsolated: boolean;
}

export type WorkerToMain =
  | ReadyMessage
  | { type: "progress"; built: number; total: number; builtParts: number }
  | { type: "snapshot"; buffer: ArrayBuffer }
  | { type: "error"; message: string };

/** Floats per rigid pose: position xyz + quaternion xyzw. */
export const POSE_FLOATS = 7;
/** Wheel pose slots in a snapshot (chassis pose + one pose per wheel; unused slots stay zero). */
export const MAX_WHEELS = 6;

/** Which machine the scene puts the player in (the renderer builds the matching body). */
export type VehicleKind = "dozer" | "tractor";

/** Snapshot header slots (Float32). */
export enum Header {
  Step = 0,
  PhysicsMs = 1, // whole fixed step: Jolt + mortar scan + pose copy
  Awake = 2,
  JointsAlive = 3,
  BreaksThisStep = 4,
  Displaced = 5,
  SpeedMps = 6,
  Flipped = 7, // 1 while the vehicle is upside down
  PeakStress = 8, // highest mortar utilisation seen since the last snapshot (1 = failing)
  StepMs = 9, // Jolt's Step() alone
  MortarMs = 10, // the per-joint impulse scan
  PoseMs = 11, // copying active bodies' poses out of the wasm heap
  BreakCount = 12, // break events recorded in the events region (≤ MAX_BREAK_EVENTS)
  Violence = 13, // 0..∞ "how much is happening", for audio and shake
  JointsTotal = 14,
  BuiltParts = 15, // parts whose physics exists so far (structures build in order)
  HeapUsedMb = 16, // Jolt wasm heap in use
  HeapTotalMb = 17,
  DemolishedMassFraction = 18, // displaced mass / total mass across the scene
  Count = 19,
}

export const HEADER_FLOATS = Header.Count;

/** Break events carried per snapshot: x, y, z, material kind. */
export const MAX_BREAK_EVENTS = 512;
export const EVENT_FLOATS = 4;
export const EVENTS_OFFSET = HEADER_FLOATS;

/** Per-structure demolition fraction by mass (0..1), one float each. */
export const MAX_STRUCTURES = 16;
export const STRUCTURES_OFFSET = EVENTS_OFFSET + MAX_BREAK_EVENTS * EVENT_FLOATS;

export const VEHICLE_FLOATS = POSE_FLOATS * (1 + MAX_WHEELS);
/** Offset of the chassis pose. */
export const VEHICLE_OFFSET = STRUCTURES_OFFSET + MAX_STRUCTURES;
/** Offset of the first part pose. */
export const PARTS_OFFSET = VEHICLE_OFFSET + VEHICLE_FLOATS;

/** Total Float32 slots for a snapshot describing `partCount` parts. */
export function snapshotLength(partCount: number): number {
  return PARTS_OFFSET + POSE_FLOATS * partCount;
}

/** Offset of wheel `i`'s pose. */
export const wheelOffset = (i: number): number => VEHICLE_OFFSET + POSE_FLOATS * (1 + i);
/** Offset of part `i`'s pose. */
export const partOffset = (i: number): number => PARTS_OFFSET + POSE_FLOATS * i;
/** Offset of break event `i`. */
export const eventOffset = (i: number): number => EVENTS_OFFSET + EVENT_FLOATS * i;

/** Material kinds, as carried in break events and used for colour, particles and sound. */
export enum MaterialKind {
  Masonry = 0,
  Steel = 1,
  Concrete = 2,
  Glass = 3,
}
