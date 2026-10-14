import type Jolt from "jolt-physics";
import { upDotY } from "./demolition";
import { LAYER_MOVING, type PhysicsWorld, type Vec3Tuple } from "./PhysicsWorld";
import { MAX_WHEELS, POSE_FLOATS, type DriveControls, type VehicleKind } from "./protocol";

// The demolition vehicle, built on Jolt's wheeled vehicle controller — real
// suspension, engine, transmission and tyre friction, so what it does to a
// building is decided by its momentum and the solver, not by a script. Two
// machines share the class: the slice-1 dozer (16 t) and the giant tractor
// (900 t, the game's one fanciful element: 0–200 km/h in five seconds).

export interface VehicleSpec {
  kind: VehicleKind;
  mass: number;
  /** Chassis half extents: x = half width, y = half height, z = half length (forward is +z). */
  chassis: Vec3Tuple;
  /** Blade half extents, mounted on the front face. */
  blade: Vec3Tuple;
  /** Blade centre height relative to the chassis centre. */
  bladeY: number;
  /** How far below the chassis centre the centre of mass sits. */
  comDrop: number;
  wheelRadius: number;
  wheelWidth: number;
  /** Wheel attach points in body space (the suspension hangs below each). */
  wheelPositions: Vec3Tuple[];
  /** Max steer per wheel (deg); negative steers opposite (rear-axle counter-steer). */
  wheelSteerDeg: number[];
  /** Driven axles as [leftWheel, rightWheel] index pairs. */
  axles: [number, number][];
  /** Speed (m/s) at which steering authority has faded to `minSteerFraction`. */
  steerFadeSpeed: number;
  minSteerFraction: number;
  suspensionMin: number;
  suspensionMax: number;
  suspensionHz: number;
  suspensionDamping: number;
  wheelInertia: number;
  /** Peak longitudinal tyre friction (1.2 is a road tyre; the tractor's are fanciful). */
  tyreGrip: number;
  engineTorque: number;
  maxRpm: number;
  gearRatio: number;
  differentialRatio: number;
  clutchStrength: number;
  brakeTorque: number;
  handbrakeTorque: number;
  /** Continuous collision detection (needed above ~20 m/s against thin parts). */
  ccd: boolean;
  /** Spawn height of the chassis centre above ground. */
  spawnHeight: number;
  /** Governor: throttle eases off over the last 10% to this speed (m/s). Jolt's
   *  engine rpm cap alone does not bound the speed of a heavy vehicle. */
  topSpeed: number;
}

export const DOZER: VehicleSpec = {
  kind: "dozer",
  // 16 t keeps the mass ratio to a 200 kg block at 80:1 (the solver's comfort
  // limit) while carrying enough momentum to break through a bonded wall rather
  // than stop dead against it — measured: 12 t at ~9 m/s stalled at 11% demolition.
  mass: 16000,
  chassis: [1.3, 0.6, 2.3],
  blade: [1.9, 1.0, 0.2],
  bladeY: -0.6,
  comDrop: 0.6,
  wheelRadius: 0.8,
  wheelWidth: 0.5,
  wheelPositions: [
    [-1.15, -0.5, 1.7],
    [1.15, -0.5, 1.7],
    [-1.15, -0.5, -1.7],
    [1.15, -0.5, -1.7],
  ],
  wheelSteerDeg: [35, 35, 0, 0],
  axles: [
    [0, 1],
    [2, 3],
  ],
  steerFadeSpeed: 1e9,
  minSteerFraction: 1,
  suspensionMin: 0.25,
  suspensionMax: 0.55,
  suspensionHz: 2.0,
  suspensionDamping: 0.6,
  wheelInertia: 60,
  tyreGrip: 1.2,
  // Top speed is set by maxRpm / (gear × diff) × wheel radius ≈ 18 m/s; torque sets
  // how fast it gets there (target: most of the way within ~3 s).
  engineTorque: 11000,
  maxRpm: 2600,
  gearRatio: 3.0,
  differentialRatio: 4.0,
  // Jolt's clutch transmits torque ∝ (engine − wheel speed) × strength; the
  // default 10 is sized for a car and slips a 16 t machine down to ~11 m/s.
  clutchStrength: 200,
  brakeTorque: 30000,
  handbrakeTorque: 50000,
  ccd: false,
  spawnHeight: 2.2,
  topSpeed: 18,
};

/**
 * The tractor: 9 m tall, 15 m wide, 22 m long, 900 t (a Cat D11 scaled by
 * volume). 0–55.6 m/s (200 km/h) in ~5 s needs ~1.1 g: 10 MN at the wheels,
 * 2.5 MN·m at the engine through a 12:1 drive, and tyres that grip at 2 g —
 * the one place the game is openly fanciful. Three axles; front and rear steer,
 * with authority fading from 35° at rest to 6° at top speed (r ≈ 76 m, ~0.8 g
 * lateral: it slides before it rolls — half-track 6 m over a 3.5 m centre of
 * mass needs ~1.7 g to tip).
 */
export const TRACTOR: VehicleSpec = {
  kind: "tractor",
  mass: 900000,
  chassis: [7.5, 2.0, 11.0],
  blade: [7.5, 2.6, 0.5],
  bladeY: -1.0,
  comDrop: 1.5,
  wheelRadius: 3.0,
  wheelWidth: 1.5,
  wheelPositions: [
    [-6.0, -1.0, 7.5],
    [6.0, -1.0, 7.5],
    [-6.0, -1.0, 0],
    [6.0, -1.0, 0],
    [-6.0, -1.0, -7.5],
    [6.0, -1.0, -7.5],
  ],
  wheelSteerDeg: [35, 35, 0, 0, -20, -20],
  axles: [
    [0, 1],
    [2, 3],
    [4, 5],
  ],
  steerFadeSpeed: 55,
  minSteerFraction: 6 / 35,
  suspensionMin: 0.6,
  suspensionMax: 1.4,
  suspensionHz: 1.2,
  suspensionDamping: 0.7,
  wheelInertia: 45000,
  tyreGrip: 2.4,
  // Measured in the browser at 2.5 MN·m / 2200 rpm: 0–200 km/h in ~8 s and a top
  // speed of 276 km/h (the rpm cap bites later than the gearing suggests).
  engineTorque: 4.0e6,
  maxRpm: 1600,
  gearRatio: 3.0,
  differentialRatio: 4.0,
  clutchStrength: 11000,
  brakeTorque: 4.5e6,
  handbrakeTorque: 6e6,
  ccd: true,
  spawnHeight: 5.6,
  topSpeed: 55.6, // 200 km/h
};

export const VEHICLE_SPECS: Record<VehicleKind, VehicleSpec> = { dozer: DOZER, tractor: TRACTOR };

/** Seconds upside down before the vehicle rights itself. */
export const AUTO_RIGHT_AFTER = 1.5;

export class Vehicle {
  readonly body: Jolt.Body;
  readonly spec: VehicleSpec;
  private readonly world: PhysicsWorld;
  private readonly constraint: Jolt.VehicleConstraint;
  private readonly controller: Jolt.WheeledVehicleController;
  private readonly right: Jolt.Vec3;
  private readonly up: Jolt.Vec3;
  private readonly scratch: Vec3Tuple = [0, 0, 0];
  private flippedFor = 0;

  constructor(world: PhysicsWorld, spawn: Vec3Tuple, yaw: number, spec: VehicleSpec = DOZER) {
    this.world = world;
    this.spec = spec;
    const J = world.J;

    // Chassis: body box + cab + blade, with the centre of mass pushed down.
    const compound = new J.StaticCompoundShapeSettings();
    const identity = new J.Quat(0, 0, 0, 1);
    const c = spec.chassis;
    compound.AddShape(
      new J.Vec3(0, 0, 0),
      identity,
      new J.BoxShapeSettings(new J.Vec3(c[0], c[1], c[2]), 0.05),
      0,
    );
    compound.AddShape(
      new J.Vec3(0, c[1] + c[1] * 0.8, -c[2] * 0.35),
      identity,
      new J.BoxShapeSettings(new J.Vec3(c[0] * 0.75, c[1] * 0.8, c[2] * 0.35), 0.05),
      0,
    );
    compound.AddShape(
      new J.Vec3(0, spec.bladeY, c[2] + spec.blade[2]),
      identity,
      new J.BoxShapeSettings(new J.Vec3(spec.blade[0], spec.blade[1], spec.blade[2]), 0.05),
      0,
    );
    const lowered = new J.OffsetCenterOfMassShapeSettings(
      new J.Vec3(0, -spec.comDrop, 0),
      compound,
    );
    const shapeResult = lowered.Create();
    if (shapeResult.HasError()) throw new Error(`vehicle shape: ${shapeResult.GetError().c_str()}`);
    const shape = shapeResult.Get();
    J.destroy(lowered);
    J.destroy(identity);

    this.body = world.createBody(shape, spawn, yawQuat(yaw), {
      motion: "dynamic",
      mass: spec.mass,
      friction: 0.6,
      ccd: spec.ccd,
    });

    const settings = new J.VehicleConstraintSettings();
    settings.mMaxPitchRollAngle = Math.PI; // never fight physics; auto-right handles flips
    spec.wheelPositions.forEach((pos, i) => {
      const w = new J.WheelSettingsWV();
      w.mPosition = new J.Vec3(pos[0], pos[1], pos[2]);
      w.mSuspensionDirection = new J.Vec3(0, -1, 0);
      w.mSteeringAxis = new J.Vec3(0, 1, 0);
      w.mWheelUp = new J.Vec3(0, 1, 0);
      w.mWheelForward = new J.Vec3(0, 0, 1);
      w.mSuspensionMinLength = spec.suspensionMin;
      w.mSuspensionMaxLength = spec.suspensionMax;
      w.mSuspensionSpring.mFrequency = spec.suspensionHz;
      w.mSuspensionSpring.mDamping = spec.suspensionDamping;
      w.mRadius = spec.wheelRadius;
      w.mWidth = spec.wheelWidth;
      w.mInertia = spec.wheelInertia;
      w.mMaxSteerAngle = (spec.wheelSteerDeg[i] * Math.PI) / 180;
      w.mMaxBrakeTorque = spec.brakeTorque;
      // Handbrake on the rearmost axle only.
      w.mMaxHandBrakeTorque = i >= spec.wheelPositions.length - 2 ? spec.handbrakeTorque : 0;
      if (spec.tyreGrip !== 1.2) {
        // Jolt's default curve peaks at 1.2 around 6% slip; scale it for fanciful tyres.
        const curve = w.mLongitudinalFriction;
        curve.Clear();
        curve.AddPoint(0, 0);
        curve.AddPoint(0.06, spec.tyreGrip);
        curve.AddPoint(0.2, spec.tyreGrip * 0.85);
        curve.Sort();
      }
      settings.mWheels.push_back(w);
    });

    const controllerSettings = new J.WheeledVehicleControllerSettings();
    controllerSettings.mEngine.mMaxTorque = spec.engineTorque;
    controllerSettings.mEngine.mMinRPM = 500;
    controllerSettings.mEngine.mMaxRPM = spec.maxRpm;
    controllerSettings.mTransmission.mMode = J.ETransmissionMode_Auto;
    controllerSettings.mTransmission.mGearRatios.clear();
    controllerSettings.mTransmission.mGearRatios.push_back(spec.gearRatio);
    controllerSettings.mTransmission.mReverseGearRatios.clear();
    controllerSettings.mTransmission.mReverseGearRatios.push_back(-spec.gearRatio);
    controllerSettings.mTransmission.mSwitchTime = 0.2;
    controllerSettings.mTransmission.mClutchReleaseTime = 0.2;
    controllerSettings.mTransmission.mClutchStrength = spec.clutchStrength;
    controllerSettings.mDifferentials.clear();
    for (const [left, right] of spec.axles) {
      const diff = new J.VehicleDifferentialSettings();
      diff.mLeftWheel = left;
      diff.mRightWheel = right;
      diff.mDifferentialRatio = spec.differentialRatio;
      diff.mEngineTorqueRatio = 1 / spec.axles.length;
      controllerSettings.mDifferentials.push_back(diff);
    }
    settings.mController = controllerSettings;

    this.constraint = new J.VehicleConstraint(this.body, settings);
    // Cylinder casts let the wheels ride up onto rubble instead of snagging on it.
    this.constraint.SetVehicleCollisionTester(
      new J.VehicleCollisionTesterCastCylinder(LAYER_MOVING, 0.05),
    );
    world.system.AddConstraint(this.constraint);
    world.system.AddStepListener(new J.VehicleConstraintStepListener(this.constraint));
    this.controller = J.castObject(this.constraint.GetController(), J.WheeledVehicleController);
    J.destroy(settings);

    this.right = new J.Vec3(1, 0, 0);
    this.up = new J.Vec3(0, 1, 0);
  }

  get wheelCount(): number {
    return this.spec.wheelPositions.length;
  }

  /** Feed the driver's input for this step. Steering authority fades with speed. */
  applyControls(c: DriveControls): void {
    const forward = this.forwardSpeed();
    const speed = Math.abs(forward);
    const fade = Math.max(
      this.spec.minSteerFraction,
      1 - (speed / this.spec.steerFadeSpeed) * (1 - this.spec.minSteerFraction),
    );
    // Governor: no drive in the direction we are already at top speed in.
    const headroom = Math.min(
      1,
      Math.max(0, (this.spec.topSpeed - speed) / (0.1 * this.spec.topSpeed)),
    );
    const sameDirection = Math.sign(c.throttle) === Math.sign(forward) || forward === 0;
    const throttle = sameDirection ? c.throttle * headroom : c.throttle;
    this.controller.SetDriverInput(throttle, c.steer * fade, c.brake, c.handbrake);
    if (c.throttle !== 0 || c.brake !== 0 || c.steer !== 0 || c.handbrake !== 0) {
      this.world.bodies.ActivateBody(this.body.GetID());
    }
  }

  /** Signed speed along the vehicle's forward axis (m/s). */
  forwardSpeed(): number {
    const v = this.world.readVec3(this.body.GetLinearVelocity(), this.scratch);
    const vx = v[0];
    const vy = v[1];
    const vz = v[2];
    const q = this.rotation();
    // Local +z rotated by q.
    const fx = 2 * (q[0] * q[2] + q[3] * q[1]);
    const fy = 2 * (q[1] * q[2] - q[3] * q[0]);
    const fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
    return vx * fx + vy * fy + vz * fz;
  }

  /** Current position (world). */
  position(): Vec3Tuple {
    return this.world.readVec3(this.body.GetPosition(), [0, 0, 0]);
  }

  /** Current rotation as xyzw. */
  rotation(): [number, number, number, number] {
    const heap = this.world.J.HEAPF32;
    const at = this.world.J.getPointer(this.body.GetRotation()) >> 2;
    return [heap[at], heap[at + 1], heap[at + 2], heap[at + 3]];
  }

  /** Heading angle about +y (radians). */
  yaw(): number {
    const [x, y, z, w] = this.rotation();
    return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
  }

  isFlipped(): boolean {
    const [x, y, z, w] = this.rotation();
    return upDotY(x, y, z, w) < 0;
  }

  /**
   * Call once per step. Tracks time spent upside down and, past the grace
   * period, drops the vehicle back on its wheels where it lies. Returns true
   * on the step it rights itself.
   */
  autoRight(dt: number): boolean {
    if (!this.isFlipped()) {
      this.flippedFor = 0;
      return false;
    }
    this.flippedFor += dt;
    if (this.flippedFor < AUTO_RIGHT_AFTER) return false;
    this.flippedFor = 0;
    const p = this.position();
    this.world.placeBody(this.body, [p[0], p[1] + this.spec.spawnHeight + 0.5, p[2]], this.yaw());
    this.stopWheels();
    return true;
  }

  /** Put the vehicle back at a spawn point, at rest. */
  reset(spawn: Vec3Tuple, yaw: number): void {
    this.controller.SetDriverInput(0, 0, 0, 0);
    this.world.placeBody(this.body, spawn, yaw);
    this.stopWheels();
    this.flippedFor = 0;
  }

  /** Write chassis pose then each wheel's world pose (POSE_FLOATS each, MAX_WHEELS slots). */
  writePoses(out: Float32Array, offset: number): void {
    this.world.readPose(this.body, out, offset);
    const J = this.world.J;
    const heap = J.HEAPF32;
    for (let i = 0; i < MAX_WHEELS; i++) {
      const o = offset + POSE_FLOATS * (1 + i);
      if (i >= this.wheelCount) {
        out.fill(0, o, o + POSE_FLOATS);
        continue;
      }
      const m = this.constraint.GetWheelWorldTransform(i, this.right, this.up);
      const t = J.getPointer(m.GetTranslation()) >> 2;
      out[o] = heap[t];
      out[o + 1] = heap[t + 1];
      out[o + 2] = heap[t + 2];
      const q = J.getPointer(m.GetQuaternion()) >> 2;
      out[o + 3] = heap[q];
      out[o + 4] = heap[q + 1];
      out[o + 5] = heap[q + 2];
      out[o + 6] = heap[q + 3];
    }
  }

  destroy(): void {
    const J = this.world.J;
    this.world.system.RemoveConstraint(this.constraint);
    this.world.removeBody(this.body);
    J.destroy(this.right);
    J.destroy(this.up);
  }

  private stopWheels(): void {
    for (let i = 0; i < this.wheelCount; i++) this.constraint.GetWheel(i).SetAngularVelocity(0);
  }
}

function yawQuat(yaw: number): [number, number, number, number] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}
