// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import initJolt from "jolt-physics";
import type { JoltModule } from "./PhysicsWorld";
import { FIXED_DT, MAX_STEPS_PER_TICK, Simulation, violence } from "./Simulation";
import { Header, PARTS_OFFSET, POSE_FLOATS, VISUAL_FLOATS, snapshotLength } from "./protocol";

let J: JoltModule;

beforeAll(async () => {
  J = await initJolt();
});

function makeSim(build = true) {
  const posted: ArrayBuffer[] = [];
  const sim = new Simulation(J, { kind: "tower", size: "small" }, (b) => posted.push(b));
  if (build) sim.buildAll();
  return { sim, posted };
}

describe("Simulation", () => {
  it("steps a fixed clock from wall time and publishes one snapshot per tick", () => {
    const { sim, posted } = makeSim();
    expect(sim.tick(0)).toBe(0); // first call only anchors the clock
    expect(sim.tick(FIXED_DT * 1000 * 2.5)).toBe(2);
    expect(posted).toHaveLength(1);
    const snap = new Float32Array(posted[0]);
    expect(snap.length).toBe(snapshotLength(sim.partCount));
    expect(snap[Header.Step]).toBe(2);
    expect(snap[Header.JointsAlive]).toBe(sim.jointCount);
    expect(snap[Header.Displaced]).toBe(0);
    expect(snap[Header.Flipped]).toBe(0);
    expect(snap[Header.BuiltParts]).toBe(sim.partCount);
    expect(snap[Header.HeapTotalMb]).toBeGreaterThan(0);
    sim.destroy();
  });

  it("describes the scene before anything is built and streams structures in", () => {
    const { sim } = makeSim(false);
    const info = sim.describe();
    expect(info.partCount).toBeGreaterThan(100);
    expect(info.visuals.length).toBe(info.partCount * VISUAL_FLOATS);
    expect(info.structures).toHaveLength(1);
    expect(info.structures[0].mass).toBeGreaterThan(10000);
    expect(sim.progress()).toEqual({ built: 0, total: 1, builtParts: 0 });
    // Unbuilt parts already have plan poses and count as intact joints.
    expect(sim.poses[6]).toBe(1);
    expect(sim.jointsAlive).toBe(sim.jointCount);
    expect(sim.buildNext()).toBe(true);
    expect(sim.progress()).toEqual({ built: 1, total: 1, builtParts: info.partCount });
    expect(sim.buildNext()).toBe(false);
    sim.destroy();
  });

  it("caps catch-up steps and drops the backlog instead of spiralling", () => {
    const { sim } = makeSim();
    sim.tick(0);
    expect(sim.tick(5000)).toBe(MAX_STEPS_PER_TICK);
    // The backlog was dropped, so a normal frame later takes a normal step count.
    expect(sim.tick(5000 + FIXED_DT * 1000 * 1.01)).toBe(1);
    sim.destroy();
  });

  it("holds only two snapshots in flight until buffers are recycled", () => {
    const { sim, posted } = makeSim();
    sim.tick(0);
    for (let i = 1; i <= 5; i++) sim.tick(i * FIXED_DT * 1000 * 1.01);
    expect(posted).toHaveLength(2);
    sim.recycle(posted[0]);
    sim.tick(6 * FIXED_DT * 1000 * 1.01);
    expect(posted).toHaveLength(3);
    expect(posted[2]).toBe(posted[0]);
    // A foreign-sized buffer is ignored.
    sim.recycle(new ArrayBuffer(16));
    sim.tick(7 * FIXED_DT * 1000 * 1.01);
    expect(posted).toHaveLength(3);
    sim.destroy();
  });

  it("only rewrites poses of awake bodies, so a sleeping part keeps its pose", () => {
    const { sim, posted } = makeSim();
    const before = sim.poses.slice(0, POSE_FLOATS);
    sim.tick(0);
    sim.tick(FIXED_DT * 1000 * 1.01);
    const snap = new Float32Array(posted[0]);
    expect([...snap.subarray(PARTS_OFFSET, PARTS_OFFSET + POSE_FLOATS)]).toEqual([...before]);
    expect(snap[Header.Awake]).toBeLessThan(10); // only the dozer
    sim.destroy();
  });

  it("drives the dozer from controls and reports its speed", () => {
    const { sim, posted } = makeSim();
    sim.setControls({ throttle: 1, steer: 0, brake: 0, handbrake: 0 });
    for (let i = 0; i <= 240; i++) {
      sim.tick(i * FIXED_DT * 1000);
      if (posted.length) sim.recycle(posted.pop()!);
    }
    sim.tick(241 * FIXED_DT * 1000);
    const snap = new Float32Array(posted[posted.length - 1]);
    expect(snap[Header.SpeedMps]).toBeGreaterThan(7);
    sim.destroy();
  });

  it("resets to a fresh scene, optionally a different one", () => {
    const { sim, posted } = makeSim();
    const before = sim.partCount;
    sim.reset({ kind: "tower", size: "medium" });
    expect(sim.partCount).toBeGreaterThan(before);
    expect(sim.progress().built).toBe(0);
    sim.buildAll();
    sim.tick(0);
    sim.tick(FIXED_DT * 1000 * 1.01);
    expect(new Float32Array(posted[0]).length).toBe(snapshotLength(sim.partCount));
    expect(sim.world.activeBodies()).toBeLessThan(10); // only the dozer is awake
    sim.destroy();
  });
});

describe("violence", () => {
  it("counts breaks and adds an awake-fraction floor, clamped", () => {
    expect(violence(0, 0, 0)).toBe(0);
    expect(violence(10, 0, 100)).toBe(10);
    expect(violence(0, 50, 100)).toBeCloseTo(2);
    expect(violence(0, 500, 100)).toBeCloseTo(4);
  });
});
