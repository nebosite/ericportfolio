import type Jolt from "jolt-physics";
import type { BreakLog } from "./BreakLog";
import type { BuildingPlan, Joint } from "./buildingPlan";
import { DEFAULT_STRENGTH, jointLoad, mortarUtilisation, type MortarStrength } from "./mortar";
import type { PhysicsWorld, Vec3Tuple } from "./PhysicsWorld";
import { MaterialKind } from "./protocol";

// A planned structure instantiated into the physics world: one dynamic rigid body
// per part and one six-axis constraint (all axes locked) per shared face — the
// mortar (or weld, or bearing). Each step we read back the impulse every active
// joint needed to hold, and any joint loaded past its connection's strength is
// removed. Collapse, toppling and shattering are whatever the solver does once
// joints are gone.
//
// Parts carry their GLOBAL index (baseIndex + local) as Jolt user data, so the
// simulation's active-body scan can route poses into one city-wide array.

interface Glue {
  constraint: Jolt.SixDOFConstraint;
  joint: Joint;
  alive: boolean;
}

export class Building {
  readonly plan: BuildingPlan;
  /** Global index of this structure's first part. */
  readonly baseIndex: number;
  readonly parts: (Jolt.Body | null)[] = [];
  /** Rest centres, 3 floats per part — the reference for demolition scoring. */
  readonly rest: Float32Array;
  private readonly glue: Glue[] = [];
  private jointsAliveCount = 0;
  private readonly strength: MortarStrength;
  private readonly world: PhysicsWorld;
  /** Glued pairs don't collide (the glue carries them); broken pairs do. */
  private readonly filter: Jolt.GroupFilterTable;
  /** Highest utilisation seen since it was last read (1 = a joint failed). */
  private peak = 0;
  // Scratch tuples for the per-joint load read.
  private readonly lam: Vec3Tuple = [0, 0, 0];
  private readonly lamRot: Vec3Tuple = [0, 0, 0];

  /**
   * @param presettleSteps Steps simulated at build time with mortar rules off,
   *   before the structure is put to sleep. A cold-started iterative solver
   *   spreads a tall stack's load unevenly for a second or so (measured: a
   *   20-course tower peaks at 139% of mortar strength on a cold wake and
   *   breaks 26 joints; pre-settled it peaks at 83% and breaks none). A real
   *   building has been standing for years — so it starts in equilibrium.
   */
  constructor(
    world: PhysicsWorld,
    plan: BuildingPlan,
    strength: MortarStrength = DEFAULT_STRENGTH,
    presettleSteps = 90,
    baseIndex = 0,
  ) {
    this.world = world;
    this.plan = plan;
    this.strength = strength;
    this.baseIndex = baseIndex;
    this.rest = new Float32Array(plan.parts.length * 3);
    const J = world.J;
    // Ref-counted by the bodies' collision groups; freed with the last part.
    this.filter = new J.GroupFilterTable(plan.parts.length);
    for (const joint of plan.joints) this.filter.DisableCollision(joint.a, joint.b);
    plan.parts.forEach((p, i) => {
      this.rest.set(p.center, i * 3);
      this.parts.push(
        world.createBox(p.center, p.half, {
          motion: "dynamic",
          mass: p.mass,
          friction: 0.7,
          activate: false, // asleep until something touches it
          group: { filter: this.filter, subGroup: i },
          userData: baseIndex + i,
        }),
      );
    });
    const point = new J.RVec3(0, 0, 0);
    const axes = [
      J.SixDOFConstraintSettings_EAxis_TranslationX,
      J.SixDOFConstraintSettings_EAxis_TranslationY,
      J.SixDOFConstraintSettings_EAxis_TranslationZ,
      J.SixDOFConstraintSettings_EAxis_RotationX,
      J.SixDOFConstraintSettings_EAxis_RotationY,
      J.SixDOFConstraintSettings_EAxis_RotationZ,
    ];
    for (const joint of plan.joints) {
      const settings = new J.SixDOFConstraintSettings();
      // World space with world-aligned axes, so the reported impulse is in world axes.
      settings.mSpace = J.EConstraintSpace_WorldSpace;
      point.Set(joint.point[0], joint.point[1], joint.point[2]);
      settings.mPosition1 = point;
      settings.mPosition2 = point;
      for (const axis of axes) settings.MakeFixedAxis(axis);
      const a = this.parts[joint.a]!;
      const b = this.parts[joint.b]!;
      const constraint = J.castObject(settings.Create(a, b), J.SixDOFConstraint);
      J.destroy(settings);
      world.system.AddConstraint(constraint);
      this.glue.push({ constraint, joint, alive: true });
    }
    J.destroy(point);
    this.jointsAliveCount = this.glue.length;
    world.system.OptimizeBroadPhase();
    if (presettleSteps > 0) this.presettle(presettleSteps);
  }

  /** Let the solver converge under gravity, adopt the settled poses as "rest", sleep. */
  private presettle(steps: number): void {
    this.wakeAll();
    for (let i = 0; i < steps; i++) this.world.step(1 / 60);
    const pose = new Float32Array(7);
    this.parts.forEach((body, i) => {
      if (!body) return;
      this.world.readPose(body, pose, 0);
      this.rest[i * 3] = pose[0];
      this.rest[i * 3 + 1] = pose[1];
      this.rest[i * 3 + 2] = pose[2];
      this.world.bodies.DeactivateBody(body.GetID());
    });
  }

  get partCount(): number {
    return this.plan.parts.length;
  }

  get jointsAlive(): number {
    return this.jointsAliveCount;
  }

  /** Whether the joint at this index in the plan still holds. */
  jointAlive(index: number): boolean {
    return this.glue[index]?.alive ?? false;
  }

  /**
   * Read every active joint's accumulated impulse and remove the ones its
   * connection could not have carried. Returns how many broke this step; break
   * positions go to `log` when given.
   */
  applyMortar(dt: number, log?: BreakLog): number {
    let broke = 0;
    const world = this.world;
    for (const g of this.glue) {
      if (!g.alive || !g.constraint.IsActive()) continue;
      world.readVec3(g.constraint.GetTotalLambdaPosition(), this.lam);
      world.readVec3(g.constraint.GetTotalLambdaRotation(), this.lamRot);
      const load = jointLoad(this.lam, this.lamRot, g.joint.normal, dt);
      const utilisation = mortarUtilisation(
        load,
        g.joint.area,
        g.joint.lever,
        g.joint.strength ?? this.strength,
      );
      if (utilisation > this.peak) this.peak = utilisation;
      if (utilisation > 1) {
        this.breakGlue(g);
        broke++;
        log?.push(
          g.joint.point[0],
          g.joint.point[1],
          g.joint.point[2],
          g.joint.kind ?? MaterialKind.Masonry,
        );
      }
    }
    return broke;
  }

  /** Highest mortar utilisation since the last call (then reset). */
  takePeakUtilisation(): number {
    const peak = this.peak;
    this.peak = 0;
    return peak;
  }

  /** Remove a part from the world (and the mortar on it). Used to undermine in tests. */
  removePart(index: number): void {
    const body = this.parts[index];
    if (!body) return;
    for (const g of this.glue) {
      if (g.alive && (g.joint.a === index || g.joint.b === index)) this.breakGlue(g);
    }
    // Wake whatever it was holding up.
    for (const j of this.plan.joints) {
      if (j.a === index || j.b === index) {
        const other = this.parts[j.a === index ? j.b : j.a];
        if (other) this.world.bodies.ActivateBody(other.GetID());
      }
    }
    this.world.removeBody(body);
    this.parts[index] = null;
  }

  /** Wake every part (tests use this to prove the structure settles and re-sleeps). */
  wakeAll(): void {
    for (const body of this.parts) if (body) this.world.bodies.ActivateBody(body.GetID());
  }

  /** Write all part poses into `out` starting at `offset` (7 floats each). Removed parts keep their rest pose. */
  writePoses(out: Float32Array, offset: number): void {
    const stride = 7;
    for (let i = 0; i < this.parts.length; i++) {
      const body = this.parts[i];
      const o = offset + i * stride;
      if (body) {
        this.world.readPose(body, out, o);
      } else {
        out[o] = this.rest[i * 3];
        out[o + 1] = this.rest[i * 3 + 1];
        out[o + 2] = this.rest[i * 3 + 2];
        out.set([0, 0, 0, 1], o + 3);
      }
    }
  }

  destroy(): void {
    for (const g of this.glue) if (g.alive) this.breakGlue(g);
    for (const body of this.parts) if (body) this.world.removeBody(body);
    this.parts.length = 0;
  }

  private breakGlue(g: Glue): void {
    // RemoveConstraint drops the system's reference; Jolt frees the constraint
    // when its count hits zero, so there is nothing for us to destroy.
    this.world.system.RemoveConstraint(g.constraint);
    g.alive = false;
    this.jointsAliveCount--;
    // Now that nothing holds them together, the two parts must collide.
    this.filter.EnableCollision(g.joint.a, g.joint.b);
  }
}
