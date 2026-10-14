// @vitest-environment node
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import initJolt from "jolt-physics";
import { Building } from "./Building";
import { groundedParts, planBuilding, planWall } from "./buildingPlan";
import { countDisplaced } from "./demolition";
import { PhysicsWorld, type JoltModule } from "./PhysicsWorld";
import { POSE_FLOATS } from "./protocol";
import { Vehicle } from "./Vehicle";

// Headless integration against the real Jolt wasm: the same classes the worker
// runs. Nothing is mocked — if a tower stands, falls or shatters here, it does
// so because the solver said so. Kept to the "small" tower so the whole file
// runs in a few seconds.

const DT = 1 / 60;
let J: JoltModule;
let world: PhysicsWorld | null = null;

beforeAll(async () => {
  J = await initJolt();
});

afterEach(() => {
  world?.destroy();
  world = null;
});

function makeWorld() {
  world = new PhysicsWorld(J);
  world.addGround();
  return world;
}

function run(w: PhysicsWorld, building: Building | null, seconds: number, each?: () => void) {
  let breaks = 0;
  let maxStepMs = 0;
  let totalMs = 0;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const t0 = performance.now();
    w.step(DT);
    if (building) breaks += building.applyMortar(DT);
    const ms = performance.now() - t0;
    totalMs += ms;
    maxStepMs = Math.max(maxStepMs, ms);
    each?.();
  }
  return { breaks, maxStepMs, avgStepMs: totalMs / steps };
}

function displacedFraction(building: Building): number {
  const poses = new Float32Array(building.partCount * POSE_FLOATS);
  building.writePoses(poses, 0);
  return countDisplaced(poses, 0, building.rest, building.partCount) / building.partCount;
}

describe("a small tower, left alone", () => {
  it("settles, breaks no mortar, displaces nothing and goes back to sleep", () => {
    const w = makeWorld();
    const building = new Building(w, planBuilding("small"));
    expect(building.partCount).toBeGreaterThan(100);
    building.wakeAll(); // prove it settles under its own weight, not that it never moved
    let peak = 0;
    const { breaks, avgStepMs } = run(w, building, 3, () => {
      peak = Math.max(peak, building.takePeakUtilisation());
    });
    // eslint-disable-next-line no-console
    console.log(
      `standing tower: peak mortar utilisation ${(peak * 100).toFixed(0)}%, avg ${avgStepMs.toFixed(2)} ms/step`,
    );
    expect(breaks).toBe(0);
    expect(displacedFraction(building)).toBe(0);
    expect(w.activeBodies()).toBe(0);
    expect(building.jointsAlive).toBe(building.plan.joints.length);
    // Waking a settled tower must leave a clear margin to failure (measured:
    // ~45% for this size), or the break rule is tuned to solver noise, not load.
    expect(peak).toBeLessThan(0.65);
    // Budget: a fully awake small tower must step well inside a 60 Hz frame.
    expect(avgStepMs).toBeLessThan(8);
  });
});

describe("a 32×8 wall with the footing pulled from under its left twelve columns", () => {
  it("drops the undermined end under gravity alone while the rest stands, still glued", () => {
    const w = makeWorld();
    const plan = planWall(32, 8);
    const building = new Building(w, plan);
    run(w, building, 0.5);
    // Deep-beam arithmetic: the 12-column overhang's moment (~1.1 MN·m) is ~1.4×
    // what 0.6 MPa mortar can carry across a 4 m section (~0.8 MN·m), while the
    // remaining 20 columns have ~2.8× the righting moment needed to stay put. So
    // the neck must fail and the rest must stand — if the solver agrees.
    const neck = -plan.halfWidth + 12;
    const removed = groundedParts(plan).filter((i) => plan.parts[i].center[0] < neck);
    expect(removed).toHaveLength(12);
    for (const i of removed) building.removePart(i);
    const { breaks, avgStepMs, maxStepMs } = run(w, building, 6);
    const poses = new Float32Array(plan.parts.length * POSE_FLOATS);
    building.writePoses(poses, 0);
    const meanHeight = (filter: (x: number) => boolean) => {
      let sum = 0;
      let n = 0;
      plan.parts.forEach((p, i) => {
        if (!filter(p.center[0]) || !building.parts[i]) return;
        sum += poses[i * POSE_FLOATS + 1] / p.center[1];
        n++;
      });
      return sum / n;
    };
    const leftHeight = meanHeight((x) => x < neck - 0.5);
    const rightHeight = meanHeight((x) => x > neck + 0.5);
    const rightJoints = plan.joints.filter(
      (j) => plan.parts[j.a].center[0] > neck + 0.5 && plan.parts[j.b].center[0] > neck + 0.5,
    );
    const rightAlive = rightJoints.filter((_, k) =>
      building.jointAlive(plan.joints.indexOf(rightJoints[k])),
    ).length;
    // eslint-disable-next-line no-console
    console.log(
      `wall undermined: broke ${breaks}/${plan.joints.length}, left height ${(leftHeight * 100).toFixed(0)}%, ` +
        `right height ${(rightHeight * 100).toFixed(0)}%, right joints alive ${rightAlive}/${rightJoints.length}, ` +
        `avg ${avgStepMs.toFixed(2)} ms/step (max ${maxStepMs.toFixed(1)})`,
    );
    expect(breaks).toBeGreaterThan(0);
    // The detached block can only fall the one course the footing occupied
    // (0.5 m of a 2.25 m mean height ≈ 78%) before it is on the ground.
    expect(leftHeight).toBeLessThan(0.88);
    expect(rightHeight).toBeGreaterThan(0.95);
    expect(rightAlive / rightJoints.length).toBeGreaterThan(0.9);
  });
});

describe("a small tower undermined on one side", () => {
  it("topples under gravity alone and its mortar fails where it lands", () => {
    const w = makeWorld();
    const plan = planBuilding("small");
    const building = new Building(w, plan);
    run(w, building, 0.5);
    // Knock out the ground course under the half of the tower with x < 0; the
    // centre of mass ends up over the edge of what is left, so it tips as a unit.
    const removed = groundedParts(plan).filter((i) => plan.parts[i].center[0] < -1e-6);
    expect(removed.length).toBeGreaterThan(3);
    for (const i of removed) building.removePart(i);
    const { breaks, avgStepMs, maxStepMs } = run(w, building, 6);
    const fraction = displacedFraction(building);
    // eslint-disable-next-line no-console
    console.log(
      `tower undermined: broke ${breaks}/${plan.joints.length} joints, displaced ${(fraction * 100).toFixed(0)}%, ` +
        `avg ${avgStepMs.toFixed(2)} ms/step (max ${maxStepMs.toFixed(1)})`,
    );
    expect(breaks).toBeGreaterThan(0);
    expect(fraction).toBeGreaterThan(0.5);
  });
});

describe("ramming", () => {
  it("a 12 t block at 15 m/s breaks mortar and displaces part of the tower", () => {
    const w = makeWorld();
    const plan = planBuilding("small");
    const building = new Building(w, plan);
    const ram = w.createBox([-plan.halfWidth - 8, 1.0, 0], [1.0, 0.8, 1.5], {
      motion: "dynamic",
      mass: 12000,
      friction: 0.6,
    });
    ram.SetLinearVelocity(new J.Vec3(15, 0, 0));
    const { breaks, avgStepMs, maxStepMs } = run(w, building, 4);
    const fraction = displacedFraction(building);
    // eslint-disable-next-line no-console
    console.log(
      `ram: broke ${breaks}/${plan.joints.length}, displaced ${(fraction * 100).toFixed(0)}%, ` +
        `avg ${avgStepMs.toFixed(2)} ms/step (max ${maxStepMs.toFixed(1)})`,
    );
    expect(breaks).toBeGreaterThan(5);
    expect(fraction).toBeGreaterThan(0.05);
  });
});

describe("the dozer", () => {
  it("drives forward under throttle, steers right, and brakes", () => {
    const w = makeWorld();
    const dozer = new Vehicle(w, [0, 2.2, 0], 0);
    run(w, null, 1); // settle on its suspension
    expect(dozer.isFlipped()).toBe(false);
    const start = dozer.position();
    run(w, null, 4, () => dozer.applyControls({ throttle: 1, steer: 0, brake: 0, handbrake: 0 }));
    const speed = dozer.forwardSpeed();
    const after = dozer.position();
    // Feel target: most of the way to the ~18 m/s top speed within four seconds.
    expect(speed).toBeGreaterThan(13);
    expect(after[2] - start[2]).toBeGreaterThan(25);
    expect(Math.abs(after[0] - start[0])).toBeLessThan(1);

    run(w, null, 2, () => dozer.applyControls({ throttle: 1, steer: 1, brake: 0, handbrake: 0 }));
    // Facing +z with +y up, the driver's right is −x (right-handed frame).
    expect(dozer.position()[0]).toBeLessThan(after[0] - 1);
    expect(dozer.yaw()).toBeLessThan(-0.2);

    const beforeBrake = dozer.forwardSpeed();
    run(w, null, 2, () => dozer.applyControls({ throttle: 0, steer: 0, brake: 1, handbrake: 0 }));
    expect(dozer.forwardSpeed()).toBeLessThan(beforeBrake * 0.4);
    expect(dozer.isFlipped()).toBe(false);
    dozer.destroy();
  });

  it("rights itself after being upside down for the grace period", () => {
    const w = makeWorld();
    const dozer = new Vehicle(w, [0, 2.2, 0], 0);
    run(w, null, 1);
    // Flip it by hand: roll 180° about z.
    w.bodies.SetPositionAndRotation(
      dozer.body.GetID(),
      new J.RVec3(0, 3, 0),
      new J.Quat(0, 0, 1, 0),
      J.EActivation_Activate,
    );
    expect(dozer.isFlipped()).toBe(true);
    let righted = false;
    run(w, null, 2.5, () => {
      if (dozer.autoRight(DT)) righted = true;
    });
    expect(righted).toBe(true);
    run(w, null, 1, () => dozer.autoRight(DT));
    expect(dozer.isFlipped()).toBe(false);
    dozer.destroy();
  });
});
