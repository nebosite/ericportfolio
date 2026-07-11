import { describe, it, expect } from "vitest";
import { getVoice } from "./notes";
import {
  MIN_STROKE_SEC,
  FULL_STROKE_SEC,
  STROKE_GAP_SEC,
  LIGHT_PERIOD_SEC,
  LIGHT_MIN_X,
  LIGHT_MAX_X,
  MAX_ELEMENTS,
  lightX01,
  bandFor,
  zoneFor,
  wobble01,
  strokeSize01,
  elementKind,
  elementFromStroke,
  emptyGarden,
  addElement,
  gardenAgeDays,
  countByKind,
  migrateKind,
  OCCLUDE_LIMIT,
  GRASS_CROWD_RADIUS,
  EARTH_MAX,
  GREEN_MAX,
  earthDepth01,
  skyBand01,
  mushroomVariety,
  grassCrowdedAt,
  elementHalfWidth,
  occludes,
  applyOcclusion,
  StrokeTracker,
  gardenPrompt,
  Stroke,
  GardenElement,
} from "./voiceGarden";

const FRAME = 1 / 60;

describe("lightX01 (the rhythm light's sweep)", () => {
  it("sweeps edge to edge in one second, a triangle wave", () => {
    expect(LIGHT_PERIOD_SEC).toBe(2); // 1s per edge-to-edge leg
    expect(lightX01(0)).toBeCloseTo(LIGHT_MIN_X, 8);
    expect(lightX01(LIGHT_PERIOD_SEC / 2)).toBeCloseTo(LIGHT_MAX_X, 8);
    expect(lightX01(LIGHT_PERIOD_SEC)).toBeCloseTo(LIGHT_MIN_X, 8);
    // Constant speed: quarter period is halfway across.
    expect(lightX01(LIGHT_PERIOD_SEC / 4)).toBeCloseTo((LIGHT_MIN_X + LIGHT_MAX_X) / 2, 8);
  });
});

describe("bandFor / zoneFor", () => {
  it("maps the voice range onto 0..1 and bands onto zones", () => {
    const v = getVoice("baritone"); // A2–A4
    expect(bandFor(v.lo, "baritone")).toBe(0);
    expect(bandFor(v.hi, "baritone")).toBe(1);
    expect(bandFor(v.lo - 5, "baritone")).toBe(0); // clamped
    expect(bandFor(v.hi + 5, "baritone")).toBe(1);
    expect(zoneFor(0.1)).toBe("earth");
    expect(zoneFor(EARTH_MAX)).toBe("green");
    expect(zoneFor(0.5)).toBe("green");
    expect(zoneFor(GREEN_MAX - 0.01)).toBe("green"); // the wide grass belt
    expect(zoneFor(0.9)).toBe("sky");
  });

  it("grades depth within earth and height within sky", () => {
    expect(earthDepth01(0)).toBe(1);
    expect(earthDepth01(EARTH_MAX)).toBe(0);
    expect(skyBand01(GREEN_MAX)).toBe(0);
    expect(skyBand01(1)).toBe(1);
  });
});

describe("mushroomVariety", () => {
  it("walks the varieties from toadstool (lowest) to puffball (top of band)", () => {
    expect(mushroomVariety(0)).toBe("toadstool");
    expect(mushroomVariety(EARTH_MAX * 0.3)).toBe("morel");
    expect(mushroomVariety(EARTH_MAX * 0.5)).toBe("chanterelle");
    expect(mushroomVariety(EARTH_MAX * 0.7)).toBe("russula");
    expect(mushroomVariety(EARTH_MAX * 0.95)).toBe("puffball");
  });
});

describe("wobble01 / strokeSize01", () => {
  it("classifies clean → wild across the cents scale", () => {
    expect(wobble01(0)).toBe(0);
    expect(wobble01(15)).toBe(0);
    expect(wobble01(45)).toBeCloseTo(0.5, 5);
    expect(wobble01(75)).toBe(1);
    expect(wobble01(200)).toBe(1);
  });

  it("sizes an element by hold length, capped at the full-stroke bar", () => {
    expect(strokeSize01(FULL_STROKE_SEC)).toBe(1);
    expect(strokeSize01(FULL_STROKE_SEC * 2)).toBe(1);
    expect(strokeSize01(0.01)).toBeCloseTo(0.18, 5); // floor: everything visible
    expect(strokeSize01(1.5)).toBeCloseTo(0.5, 5);
  });
});

describe("elementKind", () => {
  it("grows mushrooms low, grass/flowers mid, trees/butterflies high", () => {
    expect(elementKind(0.1, 0, () => 0.9)).toBe("mushroom");
    expect(elementKind(0.5, 0, () => 0.3)).toBe("grass"); // grass grows readily
    expect(elementKind(0.75, 0, () => 0.8)).toBe("grass"); // grass belt is wide
    expect(elementKind(0.5, 0, () => 0.9)).toBe("flower");
    expect(elementKind(0.9, 0.2, () => 0.5)).toBe("tree"); // steady high
    expect(elementKind(0.9, 0.8, () => 0.5)).toBe("butterfly"); // wobbly high
  });

  it("crowded grass yields a wildflower instead", () => {
    expect(elementKind(0.5, 0, () => 0.1, true)).toBe("flower");
  });
});

describe("grassCrowdedAt", () => {
  it("is crowded only with enough grass close by", () => {
    const g = emptyGarden();
    const blade = (x01: number, kind: "grass" | "flower" = "grass") =>
      g.elements.push({
        id: g.nextId++,
        kind,
        x01,
        band01: 0.5,
        size: 0.5,
        wobble: 0,
        hue: 120,
        seed: 1,
        ts: 0,
      });
    expect(grassCrowdedAt(g, 0.5)).toBe(false);
    blade(0.5);
    blade(0.5 + GRASS_CROWD_RADIUS * 0.5);
    expect(grassCrowdedAt(g, 0.5)).toBe(false); // two blades: not yet
    blade(0.5 - GRASS_CROWD_RADIUS * 0.5);
    expect(grassCrowdedAt(g, 0.5)).toBe(true); // three: crowded
    expect(grassCrowdedAt(g, 0.5 + GRASS_CROWD_RADIUS * 3)).toBe(false); // elsewhere is open
    const g2 = emptyGarden();
    g2.elements = [];
    for (let i = 0; i < 5; i++) {
      const el = { ...g.elements[0], kind: "flower" as const, id: i + 1 };
      g2.elements.push(el);
    }
    expect(grassCrowdedAt(g2, 0.5)).toBe(false); // flowers don't crowd grass
  });
});

describe("migrateKind", () => {
  it("maps legacy kinds onto today's flora and keeps current ones", () => {
    expect(migrateKind("root")).toBe("mushroom");
    expect(migrateKind("stem")).toBe("grass");
    expect(migrateKind("blossom")).toBe("tree");
    expect(migrateKind("tree")).toBe("tree");
    expect(migrateKind("butterfly")).toBe("butterfly");
    expect(migrateKind("???")).toBe("grass");
  });
});

describe("elementFromStroke / addElement / garden bookkeeping", () => {
  const stroke: Stroke = { dur: 2, meanMidi: 57, wobbleCents: 10, x01: 0.4 }; // A3, mid-baritone

  it("grows a deterministic element from a stroke", () => {
    const g = emptyGarden();
    const el = elementFromStroke(g, stroke, "baritone", () => 0.5, 1000);
    expect(el.kind).toBe("grass"); // mid-range, uncrowded → grass grows readily
    expect(el.band01).toBeCloseTo(0.5, 5);
    expect(el.wobble).toBe(0);
    expect(el.size).toBeCloseTo(2 / FULL_STROKE_SEC, 5);
    expect(el.x01).toBe(0.4);
    expect(el.ts).toBe(1000);
  });

  it("sets the birthday on first growth and composts past the cap", () => {
    const g = emptyGarden();
    expect(gardenAgeDays(g, 5000)).toBe(0);
    for (let i = 0; i < MAX_ELEMENTS + 10; i++) {
      addElement(
        g,
        elementFromStroke(g, stroke, "baritone", () => 0.5, 1000 + i),
      );
    }
    expect(g.createdTs).toBe(1000);
    expect(g.elements.length).toBe(MAX_ELEMENTS);
    expect(g.elements[0].ts).toBe(1010); // the 10 oldest composted
    expect(g.nextId).toBe(MAX_ELEMENTS + 11);
  });

  it("counts kinds and reports age in whole days", () => {
    const g = emptyGarden();
    addElement(
      g,
      elementFromStroke(g, stroke, "baritone", () => 0.5, 0),
    );
    expect(countByKind(g.elements).grass).toBe(1);
    expect(gardenAgeDays(g, 0)).toBe(1); // same day → day 1
    expect(gardenAgeDays(g, 86400000 * 3 + 5)).toBe(4);
  });
});

describe("occlusion (crowding kills buried plants)", () => {
  let nextId = 1;
  function plant(kind: GardenElement["kind"], x01: number): GardenElement {
    return {
      id: nextId++,
      kind,
      x01,
      band01: 0.5,
      size: 0.5,
      wobble: 0,
      hue: 120,
      seed: 42,
      ts: nextId,
    };
  }

  it("kills a plant once OCCLUDE_LIMIT newer plants stand in front", () => {
    const g = emptyGarden();
    const victim = plant("flower", 0.5);
    g.elements = [victim];
    for (let i = 0; i < OCCLUDE_LIMIT - 1; i++) {
      g.elements.push(plant("flower", 0.5));
      expect(applyOcclusion(g)).toEqual([]); // not buried yet
    }
    g.elements.push(plant("flower", 0.5));
    const dead = applyOcclusion(g);
    expect(dead).toEqual([victim]);
    expect(g.elements).not.toContain(victim);
    expect(g.elements.length).toBe(OCCLUDE_LIMIT);
  });

  it("only newer growth buries — position matters", () => {
    const g = emptyGarden();
    const far = plant("flower", 0.1);
    g.elements = [far];
    // A full pile-up across the garden never touches the far-away plant.
    for (let i = 0; i < OCCLUDE_LIMIT; i++) g.elements.push(plant("flower", 0.8));
    expect(applyOcclusion(g)).toEqual([]);
    expect(g.elements).toContain(far);
  });

  it("butterflies neither occlude nor die", () => {
    const b = plant("butterfly", 0.5);
    const f = plant("flower", 0.5);
    expect(occludes(f, b)).toBe(false);
    expect(occludes(b, f)).toBe(false);
    expect(elementHalfWidth(b)).toBe(0);
    const g = emptyGarden();
    g.elements = [b];
    for (let i = 0; i < OCCLUDE_LIMIT; i++) g.elements.push(plant("tree", 0.5));
    expect(applyOcclusion(g)).toEqual([]); // OCCLUDE_LIMIT trees over it, still flying
    expect(g.elements).toContain(b);
  });

  it("trees have the widest footprint", () => {
    const tree = plant("tree", 0.5);
    const grass = plant("grass", 0.5);
    expect(elementHalfWidth(tree)).toBeGreaterThan(elementHalfWidth(grass));
  });
});

describe("StrokeTracker", () => {
  /** Sing a steady midi for `sec` seconds starting at t0; returns end time. */
  function sing(tr: StrokeTracker, midi: number, sec: number, t0: number, x = 0.5): number {
    let t = t0;
    for (let i = 0; i <= Math.round(sec * 60); i++) {
      tr.push(t, midi, x);
      t += FRAME;
    }
    return t;
  }

  it("exposes the live stroke while it is being sung", () => {
    const tr = new StrokeTracker();
    expect(tr.isActive()).toBe(false);
    expect(tr.liveMean()).toBeNull();
    expect(tr.liveWobbleCents()).toBeNull();
    expect(tr.strokeX01()).toBeNull();
    sing(tr, 57, 0.5, 0, 0.42);
    expect(tr.isActive()).toBe(true);
    expect(tr.liveMean()).toBeCloseTo(57, 5);
    expect(tr.liveWobbleCents()).toBeLessThan(1);
    expect(tr.strokeX01()).toBe(0.42);
  });

  it("finishes a stroke after the silence gap, with mean/wobble/position", () => {
    const tr = new StrokeTracker();
    const tEnd = sing(tr, 57, 1.5, 0, 0.33);
    expect(tr.progress()).toBeGreaterThan(1.4);
    let stroke: Stroke | null = null;
    let t = tEnd;
    while (!stroke && t < tEnd + 1) {
      stroke = tr.push(t, null, 0.9); // silence; can has moved on
      t += FRAME;
    }
    expect(stroke).not.toBeNull();
    expect(stroke!.meanMidi).toBeCloseTo(57, 5);
    expect(stroke!.dur).toBeGreaterThan(1.4);
    expect(stroke!.wobbleCents).toBeLessThan(1);
    expect(stroke!.x01).toBe(0.33); // where the can was when singing began
    expect(t - tEnd).toBeGreaterThan(STROKE_GAP_SEC);
  });

  it("discards strokes shorter than the minimum", () => {
    const tr = new StrokeTracker();
    const tEnd = sing(tr, 57, MIN_STROKE_SEC * 0.5, 0);
    let got: Stroke | null = null;
    for (let t = tEnd; t < tEnd + 1; t += FRAME) got = got || tr.push(t, null, 0.5);
    expect(got).toBeNull();
  });

  it("splits on a large pitch jump, returning the first stroke", () => {
    const tr = new StrokeTracker();
    let t = sing(tr, 50, 1, 0, 0.2);
    const stroke = tr.push(t, 60, 0.8); // leap of 10 semitones
    expect(stroke).not.toBeNull();
    expect(stroke!.meanMidi).toBeCloseTo(50, 4);
    // The new stroke is already running at the new pitch and can position.
    t = sing(tr, 60, 1, t + FRAME, 0.8);
    const second = tr.flush();
    expect(second).not.toBeNull();
    expect(second!.meanMidi).toBeCloseTo(60, 3);
  });

  it("plants a wave: the light moving on splits the stroke, keeping short dabs", () => {
    const tr = new StrokeTracker();
    const strokes: Stroke[] = [];
    let t = 0;
    let x = 0.1;
    // Sing one steady note for 1.5s while the light sweeps across the garden.
    for (let i = 0; i < 90; i++) {
      const s = tr.push(t, 57, x);
      if (s) strokes.push(s);
      t += FRAME;
      x += 0.006; // ~0.36/s sweep
    }
    const last = tr.flush();
    if (last) strokes.push(last);
    expect(strokes.length).toBeGreaterThan(3); // a run of plants, not one
    // Each stroke planted where its segment began, marching rightward.
    for (let i = 1; i < strokes.length; i++) {
      expect(strokes[i].x01).toBeGreaterThan(strokes[i - 1].x01);
    }
  });

  it("measures wobble as cents deviation", () => {
    const tr = new StrokeTracker();
    let t = 0;
    for (let i = 0; i < 90; i++) {
      tr.push(t, 57 + Math.sin(i / 2) * 0.5, 0.5); // ±50¢ wobble
      t += FRAME;
    }
    const stroke = tr.flush()!;
    expect(stroke.wobbleCents).toBeGreaterThan(20);
  });
});

describe("gardenPrompt", () => {
  it("invites the first note, then rotates gentle guidance", () => {
    const empty = countByKind([]);
    expect(gardenPrompt(empty, 0)).toMatch(/Sing a soft, steady note/);
    const some = { grass: 3, flower: 0, mushroom: 0, tree: 0, butterfly: 0 };
    const seen = new Set<string>();
    for (let e = 0; e < 64; e += 16) seen.add(gardenPrompt(some, e));
    expect(seen.size).toBeGreaterThan(1); // it rotates
    for (const p of seen) expect(p.length).toBeGreaterThan(10);
  });
});
