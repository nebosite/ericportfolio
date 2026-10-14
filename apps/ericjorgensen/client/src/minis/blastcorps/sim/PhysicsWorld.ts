import type Jolt from "jolt-physics";

// Thin owner of a Jolt physics system: layers, settings, body creation and the
// fast pose readback used to fill snapshots. Engine-facing but free of DOM, so it
// runs identically inside the worker and in headless Node tests (which load the
// real wasm). Everything else in ./sim builds on this.

/** The initialised Jolt module (default export of `jolt-physics`, awaited). */
export type JoltModule = typeof Jolt;

export const LAYER_STATIC = 0;
export const LAYER_MOVING = 1;
const NUM_LAYERS = 2;

export type Vec3Tuple = [number, number, number];
export type QuatTuple = [number, number, number, number];

export interface BoxOptions {
  motion: "static" | "dynamic";
  mass?: number;
  friction?: number;
  /** Add the body awake (default) or asleep — a built-but-untouched wall costs nothing asleep. */
  activate?: boolean;
  /** Collision group membership: glued neighbours are filtered out of contact so the
   *  glue alone carries their load and reports it honestly. */
  group?: { filter: Jolt.GroupFilterTable; subGroup: number };
  /** Caller's tag, read back with the active-body scan (parts use their global index). */
  userData?: number;
  /** Continuous collision detection — for anything fast enough to cross a thin part in one step. */
  ccd?: boolean;
}

/** User-data tag for bodies that are not building parts (ground, vehicle). */
export const NOT_A_PART = 0x7fffffff;

export class PhysicsWorld {
  readonly J: JoltModule;
  readonly iface: Jolt.JoltInterface;
  readonly system: Jolt.PhysicsSystem;
  readonly bodies: Jolt.BodyInterface;
  /** Steps taken since creation. */
  stepCount = 0;

  // Scratch objects reused for every call so the wasm heap never churns.
  private readonly tmpVec: Jolt.Vec3;
  private readonly tmpRVec: Jolt.RVec3;
  private readonly tmpQuat: Jolt.Quat;
  private readonly tmpQuat2: Jolt.Quat;
  private readonly activeIds: Jolt.BodyIDVector;
  private readonly shapes = new Map<string, Jolt.BoxShape>();

  constructor(J: JoltModule, maxBodies = 4096, workerThreads = 0) {
    this.J = J;
    const settings = new J.JoltSettings();
    settings.mMaxBodies = maxBodies;
    settings.mMaxWorkerThreads = workerThreads;
    settings.mMaxBodyPairs = Math.min(maxBodies * 8, 65536);
    // Per-step contact storage comes out of JoltInterface's fixed temp allocator;
    // 32768 aborts the step, 16384 is proven. Past the cap Jolt drops contacts
    // rather than crashing, which is the right failure mode for a "colossal" pile.
    settings.mMaxContactConstraints = Math.min(maxBodies * 4, 16384);
    const pairFilter = new J.ObjectLayerPairFilterTable(NUM_LAYERS);
    pairFilter.EnableCollision(LAYER_STATIC, LAYER_MOVING);
    pairFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING);
    const bpLayers = new J.BroadPhaseLayerInterfaceTable(NUM_LAYERS, NUM_LAYERS);
    bpLayers.MapObjectToBroadPhaseLayer(LAYER_STATIC, new J.BroadPhaseLayer(0));
    bpLayers.MapObjectToBroadPhaseLayer(LAYER_MOVING, new J.BroadPhaseLayer(1));
    settings.mObjectLayerPairFilter = pairFilter;
    settings.mBroadPhaseLayerInterface = bpLayers;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(
      bpLayers,
      NUM_LAYERS,
      pairFilter,
      NUM_LAYERS,
    );
    this.iface = new J.JoltInterface(settings);
    J.destroy(settings);
    this.system = this.iface.GetPhysicsSystem();
    this.bodies = this.system.GetBodyInterface();
    this.tmpVec = new J.Vec3(0, 0, 0);
    this.tmpRVec = new J.RVec3(0, 0, 0);
    this.tmpQuat = new J.Quat(0, 0, 0, 1);
    this.tmpQuat2 = new J.Quat(0, 0, 0, 1);
    this.activeIds = new J.BodyIDVector();
  }

  /** Advance one fixed step (one collision step — enough at 60 Hz for 18 m/s vehicles). */
  step(dt: number): void {
    this.iface.Step(dt, 1);
    this.stepCount++;
  }

  activeBodies(): number {
    return this.system.GetNumActiveBodies(this.J.EBodyType_RigidBody);
  }

  /** A large static slab whose top face is y = 0 — big enough that a 200 km/h run
   *  past the end of a 600 m street never finds its edge (measured: it did at 400). */
  addGround(halfExtent = 1500): Jolt.Body {
    return this.createBox([0, -1, 0], [halfExtent, 1, halfExtent], {
      motion: "static",
      friction: 0.8,
    });
  }

  createBox(center: Vec3Tuple, half: Vec3Tuple, opts: BoxOptions): Jolt.Body {
    return this.createBody(this.boxShape(half), center, [0, 0, 0, 1], opts);
  }

  /** One shared BoxShape per distinct size — a street has thousands of identical beams. */
  private boxShape(half: Vec3Tuple): Jolt.BoxShape {
    const key = `${half[0]},${half[1]},${half[2]}`;
    let shape = this.shapes.get(key);
    if (!shape) {
      const J = this.J;
      this.tmpVec.Set(half[0], half[1], half[2]);
      shape = new J.BoxShape(this.tmpVec, Math.min(0.02, Math.min(...half) * 0.2));
      // Shapes are ref-counted by their bodies; the cache holds one reference of its
      // own so a shape outlives the last body that used it (rebuilds reuse it).
      shape.AddRef();
      this.shapes.set(key, shape);
    }
    return shape;
  }

  /** Wasm heap use in megabytes: [used, total]. */
  heapMb(): [number, number] {
    const total = this.J.JoltInterface.prototype.sGetTotalMemory();
    const free = this.J.JoltInterface.prototype.sGetFreeMemory();
    return [(total - free) / 1048576, total / 1048576];
  }

  /** Create and add a body around an already-built shape (compound shapes for the vehicle). */
  createBody(shape: Jolt.Shape, center: Vec3Tuple, rot: QuatTuple, opts: BoxOptions): Jolt.Body {
    const J = this.J;
    const isStatic = opts.motion === "static";
    this.tmpRVec.Set(center[0], center[1], center[2]);
    this.tmpQuat.Set(rot[0], rot[1], rot[2], rot[3]);
    const settings = new J.BodyCreationSettings(
      shape,
      this.tmpRVec,
      this.tmpQuat,
      isStatic ? J.EMotionType_Static : J.EMotionType_Dynamic,
      isStatic ? LAYER_STATIC : LAYER_MOVING,
    );
    if (!isStatic && opts.mass !== undefined) {
      settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia;
      settings.mMassPropertiesOverride.mMass = opts.mass;
    }
    settings.mFriction = opts.friction ?? 0.7;
    settings.mUserData = opts.userData ?? NOT_A_PART;
    if (opts.ccd) settings.mMotionQuality = J.EMotionQuality_LinearCast;
    if (opts.group) {
      const group = new J.CollisionGroup(opts.group.filter, 0, opts.group.subGroup);
      settings.mCollisionGroup = group;
      J.destroy(group); // copied into the settings
    }
    const body = this.bodies.CreateBody(settings);
    J.destroy(settings);
    this.bodies.AddBody(
      body.GetID(),
      opts.activate === false ? J.EActivation_DontActivate : J.EActivation_Activate,
    );
    return body;
  }

  /** Take a body out of the simulation and free it. */
  removeBody(body: Jolt.Body): void {
    const id = body.GetID();
    if (this.bodies.IsAdded(id)) this.bodies.RemoveBody(id);
    this.bodies.DestroyBody(id);
  }

  /** Write position xyz + rotation xyzw into `out` at `offset` (7 floats). */
  readPose(body: Jolt.Body, out: Float32Array, offset: number): void {
    this.readPoseById(body.GetID(), out, offset);
  }

  readPoseById(id: Jolt.BodyID, out: Float32Array, offset: number): void {
    this.bodies.GetPositionAndRotation(id, this.tmpRVec, this.tmpQuat);
    this.copyFloats(this.tmpRVec, out, offset, 3);
    this.copyFloats(this.tmpQuat, out, offset + 3, 4);
  }

  /**
   * Visit every awake rigid body with its user-data tag. This is how a 30k-part
   * city stays cheap to publish: only the bodies that moved get their poses read.
   */
  forEachActiveBody(visit: (userData: number, id: Jolt.BodyID) => void): number {
    const vec = this.activeIds;
    vec.clear();
    this.system.GetActiveBodies(this.J.EBodyType_RigidBody, vec);
    const n = vec.size();
    for (let i = 0; i < n; i++) {
      const id = vec.at(i);
      visit(this.bodies.GetUserData(id), id);
    }
    return n;
  }

  /** Read a Jolt vector straight from the wasm heap (no per-component calls). */
  readVec3(v: Jolt.Vec3 | Jolt.RVec3, out: Vec3Tuple): Vec3Tuple {
    const heap = this.J.HEAPF32;
    const at = this.J.getPointer(v) >> 2;
    out[0] = heap[at];
    out[1] = heap[at + 1];
    out[2] = heap[at + 2];
    return out;
  }

  private copyFloats(
    v: Jolt.Vec3 | Jolt.RVec3 | Jolt.Quat,
    out: Float32Array,
    offset: number,
    n: number,
  ) {
    const heap = this.J.HEAPF32;
    const at = this.J.getPointer(v) >> 2;
    for (let i = 0; i < n; i++) out[offset + i] = heap[at + i];
  }

  /** Teleport a body (used to right a flipped vehicle and to reset). */
  placeBody(body: Jolt.Body, center: Vec3Tuple, yaw: number): void {
    const J = this.J;
    this.tmpRVec.Set(center[0], center[1], center[2]);
    this.tmpVec.Set(0, 1, 0);
    const q = J.Quat.prototype.sRotation(this.tmpVec, yaw);
    this.tmpQuat2.Set(q.GetX(), q.GetY(), q.GetZ(), q.GetW());
    this.bodies.SetPositionAndRotation(
      body.GetID(),
      this.tmpRVec,
      this.tmpQuat2,
      J.EActivation_Activate,
    );
    this.tmpVec.Set(0, 0, 0);
    body.SetLinearVelocity(this.tmpVec);
    body.SetAngularVelocity(this.tmpVec);
  }

  destroy(): void {
    const J = this.J;
    J.destroy(this.tmpVec);
    J.destroy(this.tmpRVec);
    J.destroy(this.tmpQuat);
    J.destroy(this.tmpQuat2);
    J.destroy(this.activeIds);
    for (const shape of this.shapes.values()) shape.Release();
    this.shapes.clear();
    J.destroy(this.iface);
  }
}
