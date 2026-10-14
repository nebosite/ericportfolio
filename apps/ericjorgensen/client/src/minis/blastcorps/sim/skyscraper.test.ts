import { describe, it, expect } from "vitest";
import { groundedParts, type Part } from "./buildingPlan";
import { MATERIALS } from "./materials";
import { MaterialKind } from "./protocol";
import {
  BAY,
  BEAM_DEPTH,
  BEAM_KG_PER_M,
  BEAM_WIDTH,
  COLUMN,
  GLASS_SILL_GAP,
  SLAB_THICKNESS,
  STORY_HEIGHT,
  isColumn,
  planMass,
  planSkyscraper,
} from "./skyscraper";

function overlaps(a: Part, b: Part): boolean {
  for (let k = 0; k < 3; k++) {
    if (Math.abs(a.center[k] - b.center[k]) < a.half[k] + b.half[k] - 1e-4) continue;
    return false;
  }
  return true;
}

describe("planSkyscraper", () => {
  const plan = planSkyscraper({ bays: 3, stories: 4, origin: [0, 0] });
  const kind = (k: MaterialKind) => plan.parts.filter((p) => p.kind === k);
  const partsOf = (j: { a: number; b: number }) => [plan.parts[j.a], plan.parts[j.b]];

  it("lays columns, beams, slabs and glass per story in the expected counts", () => {
    // Per story: (b+1)² columns + 2·b·(b+1) beams, b² slabs, 4b glass units.
    expect(kind(MaterialKind.Steel)).toHaveLength(4 * (16 + 24));
    expect(kind(MaterialKind.Concrete)).toHaveLength(4 * 9);
    expect(kind(MaterialKind.Glass)).toHaveLength(4 * 12);
    expect(plan.height).toBe(4 * STORY_HEIGHT);
    expect(plan.halfWidth).toBeCloseTo((3 * BAY) / 2 + COLUMN / 2);
  });

  it("never overlaps two parts", () => {
    for (let i = 0; i < plan.parts.length; i++) {
      for (let j = i + 1; j < plan.parts.length; j++) {
        expect(overlaps(plan.parts[i], plan.parts[j])).toBe(false);
      }
    }
  });

  it("grounds only the first-story columns; glass hangs with a sill gap", () => {
    expect(groundedParts(plan)).toHaveLength(16);
    const lowGlass = kind(MaterialKind.Glass).filter((p) => p.center[1] < STORY_HEIGHT);
    expect(lowGlass).toHaveLength(12);
    for (const g of lowGlass) expect(g.center[1] - g.half[1]).toBeCloseTo(GLASS_SILL_GAP);
  });

  it("rests slabs on beam ledges, clear of the columns, each pinned to one beam", () => {
    const slabs = kind(MaterialKind.Concrete);
    const beams = kind(MaterialKind.Steel).filter((p) => !isColumn(p));
    const columns = kind(MaterialKind.Steel).filter(isColumn);
    const beamTop = (b: Part) => b.center[1] + b.half[1];
    for (const slab of slabs) {
      const bottom = slab.center[1] - slab.half[1];
      // Sits exactly on a beam top of its own story.
      expect(beams.some((b) => Math.abs(beamTop(b) - bottom) < 1e-6)).toBe(true);
      // Never shares footprint with a column.
      for (const c of columns) {
        const dx = Math.abs(slab.center[0] - c.center[0]) - (slab.half[0] + c.half[0]);
        const dz = Math.abs(slab.center[2] - c.center[2]) - (slab.half[2] + c.half[2]);
        expect(Math.max(dx, dz)).toBeGreaterThanOrEqual(-1e-6);
      }
    }
    // Exactly one stud joint per slab, to a beam, rated as a composite deck.
    const slabJoints = plan.joints.filter((j) =>
      partsOf(j).some((p) => p.kind === MaterialKind.Concrete),
    );
    expect(slabJoints).toHaveLength(slabs.length);
    for (const j of slabJoints) {
      const other = partsOf(j).find((p) => p.kind !== MaterialKind.Concrete)!;
      expect(other.kind).toBe(MaterialKind.Steel);
      expect(isColumn(other)).toBe(false);
      expect(j.strength!.tensile).toBe(0.3e6);
      expect(j.kind).toBe(MaterialKind.Concrete);
    }
    // Ledge: the slab edge overlaps the beam top by (beam width − column) / 2.
    const slab = slabs[0];
    const under = beams.find(
      (b) =>
        Math.abs(beamTop(b) - (slab.center[1] - slab.half[1])) < 1e-6 &&
        Math.abs(b.center[2] - (slab.center[2] - slab.half[2])) < BEAM_WIDTH,
    )!;
    expect(under).toBeDefined();
    const overlap = under.center[2] + under.half[2] - (slab.center[2] - slab.half[2]);
    expect(overlap).toBeCloseTo((BEAM_WIDTH - COLUMN) / 2);
    // Resting slabs are an option for the probe.
    const resting = planSkyscraper({ bays: 3, stories: 4, origin: [0, 0], slabJoints: "none" });
    expect(
      resting.joints.some((j) =>
        [resting.parts[j.a], resting.parts[j.b]].some((p) => p.kind === MaterialKind.Concrete),
      ),
    ).toBe(false);
  });

  it("splices columns face to face, frames beams into columns, and hangs glass from one beam", () => {
    const splices = plan.joints.filter((j) => partsOf(j).every(isColumn));
    expect(splices).toHaveLength(16 * 3);
    expect(splices[0].strength!.moment).toBe(2.9e6);
    expect(splices[0].strength!.compressive).toBeDefined();
    const beamJoints = plan.joints.filter(
      (j) =>
        partsOf(j).some(isColumn) &&
        partsOf(j).some((p) => p.kind === MaterialKind.Steel && !isColumn(p)),
    );
    expect(beamJoints).toHaveLength(4 * 24 * 2); // every beam end
    expect(beamJoints[0].area).toBeCloseTo(BEAM_WIDTH * BEAM_DEPTH);
    expect(beamJoints[0].strength!.moment).toBe(800e3);
    const glassJoints = plan.joints.filter((j) =>
      partsOf(j).some((p) => p.kind === MaterialKind.Glass),
    );
    expect(glassJoints).toHaveLength(4 * 12); // one per unit, to the beam above
    for (const j of glassJoints) {
      expect(j.normal[1]).not.toBe(0);
      expect(j.strength!.tensile).toBe(0.3e6);
      expect(j.kind).toBe(MaterialKind.Glass);
    }
    const slabJoints = plan.joints.filter((j) =>
      partsOf(j).some((p) => p.kind === MaterialKind.Concrete),
    );
    expect(plan.joints.length).toBe(
      splices.length + beamJoints.length + glassJoints.length + slabJoints.length,
    );
  });

  it("connects everything into one structure", () => {
    const adj = new Map<number, number[]>();
    for (const j of plan.joints) {
      adj.set(j.a, [...(adj.get(j.a) ?? []), j.b]);
      adj.set(j.b, [...(adj.get(j.b) ?? []), j.a]);
    }
    const start = plan.parts.findIndex(isColumn);
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      for (const m of adj.get(n) ?? []) if (!seen.has(m)) (seen.add(m), stack.push(m));
    }
    expect(seen.size).toBe(plan.parts.length);
  });

  it("uses real section masses", () => {
    const column = kind(MaterialKind.Steel).find(isColumn)!;
    expect(column.mass).toBeCloseTo(
      MATERIALS[MaterialKind.Steel].density * COLUMN * COLUMN * STORY_HEIGHT,
      0,
    );
    const beam = kind(MaterialKind.Steel).find((p) => !isColumn(p))!;
    const span = Math.max(beam.half[0], beam.half[2]) * 2;
    expect(beam.mass).toBeCloseTo(BEAM_KG_PER_M * span, 3);
    expect(beam.mass).toBeLessThan(600);
    const slab = kind(MaterialKind.Concrete)[0];
    expect(slab.mass).toBeCloseTo(2400 * (BAY - COLUMN) ** 2 * SLAB_THICKNESS, 0); // ~11 t
    const glass = kind(MaterialKind.Glass)[0];
    const glassHeight = STORY_HEIGHT - SLAB_THICKNESS - BEAM_DEPTH - GLASS_SILL_GAP;
    expect(glass.mass).toBeCloseTo(30 * (BAY - COLUMN) * glassHeight, 0);
    expect(planMass(plan)).toBeGreaterThan(4 * 9 * 10000);
  });

  it("can be built without glass or slabs, for the LOD dial", () => {
    const bare = planSkyscraper({
      bays: 3,
      stories: 4,
      origin: [0, 0],
      glass: false,
      slabs: false,
    });
    expect(bare.parts.filter((p) => p.kind !== MaterialKind.Steel)).toHaveLength(0);
    expect(bare.parts.length).toBe(4 * (16 + 24));
    const quartered = planSkyscraper({ bays: 3, stories: 4, origin: [0, 0], slabSplit: 2 });
    expect(quartered.parts.filter((p) => p.kind === MaterialKind.Concrete)).toHaveLength(4 * 9 * 4);
  });
});
