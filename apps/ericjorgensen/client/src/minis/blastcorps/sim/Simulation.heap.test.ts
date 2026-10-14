// @vitest-environment node
import { describe, it, expect } from "vitest";
import initJolt from "jolt-physics";
import { Simulation } from "./Simulation";
import { FIXED_DT } from "./Simulation";

// The multithreaded Jolt build has a fixed 128 MiB heap (no growth). Node runs
// the single-threaded, growable build, but the allocations are identical, so
// the figure measured here — on a fresh module, so no earlier test's
// fragmentation counts — is what the biggest street the dials allow would need
// in a browser. Keep it under the ceiling with margin for contacts during a
// collapse (those come from the temp allocator, but the heap grows too).

describe("the largest street the dials allow", () => {
  it("fits the multithreaded build's 128 MiB heap", async () => {
    const J = await initJolt();
    const posted: ArrayBuffer[] = [];
    const sim = new Simulation(
      J,
      { kind: "street", towers: 10, maxStories: 50, glass: true, floors: "auto" },
      (b) => posted.push(b),
      { presettleSteps: 0 },
    );
    sim.buildAll();
    sim.tick(0);
    sim.tick(FIXED_DT * 1000 * 1.01);
    const [used] = sim.world.heapMb();
    // eslint-disable-next-line no-console
    console.log(
      `largest street: ${sim.partCount} parts, ${sim.jointCount} joints, wasm heap ${used.toFixed(0)} MB`,
    );
    expect(sim.partCount).toBeGreaterThan(15000);
    expect(used).toBeLessThan(110);
    sim.destroy();
  }, 120000);
});
