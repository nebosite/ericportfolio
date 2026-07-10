import { describe, expect, it } from "vitest";
import {
  BOUNCY_TIME,
  BULLET_LIFE,
  CASTLE_CORE_SCORE,
  CASTLE_FIRST,
  CASTLE_SEG_SCORE,
  FIRE_COOLDOWN,
  FRAG_COUNT,
  GameState,
  HIT_GRACE,
  InputState,
  MAX_SHIELD,
  MAX_SPEED,
  PUFF_RADIUS,
  RESPAWN_INVULN,
  RING_REGEN,
  ROID_SCORE,
  SHIELD_PICKUP,
  START_LIVES,
  START_SHIELD,
  SWEEP_CHARGE,
  SWEEP_DURATION,
  TURN_RATE,
  WEAPON_AMMO,
  breakRoid,
  castleHoleAt,
  collectPowerup,
  fireHitscan,
  firePuffball,
  hitShip,
  initialState,
  makeCastle,
  makeRoid,
  ringSegmentAt,
  step,
  torusDist,
} from "./roidsLogic";

const IDLE: InputState = { left: false, right: false, thrust: false, fire: false };
const FIRE: InputState = { ...IDLE, fire: true };

/** rng that replays a fixed sequence (repeating its last value). */
const seqRng = (seq: number[]) => {
  let i = 0;
  return () => seq[Math.min(i++, seq.length - 1)];
};

/** Small deterministic LCG for tests that need "random-looking" values. */
const lcg = (seed = 1) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

const half = () => 0.5;

/** An empty, quiet field with the ship parked mid-screen and fully in control. */
function freshState(w = 800, h = 600): GameState {
  const state = initialState(w, h, lcg(7));
  state.roids = [];
  state.ship.invuln = 0;
  state.castleTimer = 9999;
  return state;
}

/** A stationary rock, so collisions in tests are set up exactly. */
function parkedRoid(x: number, y: number, size: 1 | 2 | 3) {
  const roid = makeRoid({ x, y }, size, 1, half);
  roid.vel = { x: 0, y: 0 };
  roid.spin = 0;
  return roid;
}

/** Far-corner rock that keeps step() from spawning the next wave mid-test. */
function sentinel() {
  return parkedRoid(50, 50, 1);
}

describe("initialState", () => {
  it("starts with 3 lives, 1 shield, the pea shooter, and 2+wave big rocks", () => {
    const s = initialState(800, 600, lcg(3));
    expect(s.lives).toBe(START_LIVES);
    expect(s.ship.shield).toBe(START_SHIELD);
    expect(s.weapon).toBe("bullet");
    expect(s.ammo).toBe(Infinity);
    expect(s.wave).toBe(1);
    expect(s.roids).toHaveLength(3);
    expect(s.roids.every((r) => r.size === 3)).toBe(true);
  });

  it("spawns the opening rocks clear of the ship", () => {
    const s = initialState(800, 600, lcg(11));
    for (const r of s.roids) {
      expect(torusDist(r.pos, s.ship.pos, s.w, s.h)).toBeGreaterThan(170);
    }
  });
});

describe("ship physics", () => {
  it("turns at TURN_RATE and thrusts along its facing", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.angle = 0;
    step(s, { ...IDLE, left: true }, 0.5, half);
    expect(s.ship.angle).toBeCloseTo(-TURN_RATE * 0.5, 5);

    s.ship.angle = 0;
    step(s, { ...IDLE, thrust: true }, 0.1, half);
    expect(s.ship.vel.x).toBeGreaterThan(0);
    expect(Math.abs(s.ship.vel.y)).toBeLessThan(1e-9);
  });

  it("wraps around the field edges", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: s.w - 1, y: 300 };
    s.ship.vel = { x: 100, y: 0 };
    step(s, IDLE, 0.1, half);
    expect(s.ship.pos.x).toBeLessThan(20);
  });

  it("clamps speed to MAX_SPEED", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.vel = { x: 10000, y: 0 };
    step(s, IDLE, 0.016, half);
    expect(Math.hypot(s.ship.vel.x, s.ship.vel.y)).toBeLessThanOrEqual(MAX_SPEED + 1e-6);
  });
});

describe("firing", () => {
  it("fires one bullet and enforces the cooldown", () => {
    const s = freshState();
    s.roids = [sentinel()];
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(1);
    expect(s.ship.cooldown).toBeGreaterThan(0);
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(1); // still cooling down
  });

  it("does not fire while the ship is waiting to respawn", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.respawn = 1;
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(0);
  });

  it("bullets expire after BULLET_LIFE", () => {
    const s = freshState();
    s.roids = [sentinel()];
    step(s, FIRE, 0.016, half);
    for (let t = 0; t < BULLET_LIFE + 0.2; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.bullets).toHaveLength(0);
  });

  it("weapon ammo runs dry and reverts to the pea shooter", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.weapon = "laser";
    s.ammo = 1;
    step(s, FIRE, 0.016, half);
    expect(s.weapon).toBe("bullet");
    expect(s.ammo).toBe(Infinity);
  });

  it("machine gun fires much faster than the pea shooter", () => {
    expect(FIRE_COOLDOWN.machine).toBeLessThan(FIRE_COOLDOWN.bullet / 2);
    const s = freshState();
    s.roids = [sentinel()];
    s.weapon = "machine";
    s.ammo = WEAPON_AMMO.machine;
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(1);
    expect(s.ship.cooldown).toBeCloseTo(FIRE_COOLDOWN.machine, 5);
    expect(s.ammo).toBe(WEAPON_AMMO.machine - 1);
  });
});

describe("rocks and bullets", () => {
  it("a big rock breaks into two mediums and scores", () => {
    const s = freshState();
    const rock = parkedRoid(500, 300, 3);
    s.roids = [rock];
    s.bullets.push({ pos: { x: 500, y: 300 }, vel: { x: 0, y: 0 }, life: 1, kind: "std" });
    step(s, IDLE, 0.016, half);
    expect(s.roids).not.toContain(rock);
    expect(s.roids.filter((r) => r.size === 2)).toHaveLength(2);
    expect(s.score).toBe(ROID_SCORE[3]);
    expect(s.bullets).toHaveLength(0);
  });

  it("a small rock vanishes for top score", () => {
    const s = freshState();
    s.roids = [sentinel(), parkedRoid(500, 300, 1)];
    s.bullets.push({ pos: { x: 500, y: 300 }, vel: { x: 0, y: 0 }, life: 1, kind: "std" });
    step(s, IDLE, 0.016, half);
    expect(s.roids).toHaveLength(1);
    expect(s.score).toBe(ROID_SCORE[1]);
  });

  it("a super bullet bursts into frag bullets on impact", () => {
    const s = freshState();
    s.roids = [sentinel(), parkedRoid(500, 300, 1)];
    s.bullets.push({ pos: { x: 500, y: 300 }, vel: { x: 0, y: 0 }, life: 1, kind: "super" });
    step(s, IDLE, 0.016, half);
    expect(s.bullets.filter((b) => b.kind === "frag")).toHaveLength(FRAG_COUNT);
  });
});

describe("lasers", () => {
  it("laser stops at the first rock in line", () => {
    const s = freshState();
    const near = parkedRoid(400, 300, 2);
    const far = parkedRoid(600, 300, 2);
    s.roids = [near, far];
    s.ship.pos = { x: 200, y: 300 };
    s.ship.angle = 0;
    fireHitscan(s, "laser", half);
    expect(s.roids).not.toContain(near);
    expect(s.roids).toContain(far);
    expect(s.score).toBe(ROID_SCORE[2]);
    expect(s.beams).toHaveLength(1);
  });

  it("super laser penetrates everything out to the screen edge", () => {
    const s = freshState();
    const near = parkedRoid(400, 300, 2);
    const far = parkedRoid(600, 300, 2);
    s.roids = [near, far];
    s.ship.pos = { x: 200, y: 300 };
    s.ship.angle = 0;
    fireHitscan(s, "superlaser", half);
    expect(s.roids).not.toContain(near);
    expect(s.roids).not.toContain(far);
    expect(s.score).toBe(ROID_SCORE[2] * 2);
  });

  it("ultra laser wraps around and hits a rock behind the ship", () => {
    const s = freshState(400, 400);
    const behind = parkedRoid(50, 200, 1); // in front only via the wrap
    s.roids = [behind];
    s.ship.pos = { x: 200, y: 200 };
    s.ship.angle = 0;
    fireHitscan(s, "superlaser", half);
    expect(s.roids).toContain(behind); // super laser stops at the edge…
    fireHitscan(s, "ultralaser", half);
    expect(s.roids).not.toContain(behind); // …the ultra wraps and lands it
    const ultra = s.beams.find((b) => b.kind === "ultralaser");
    expect(ultra && ultra.segs.length).toBeGreaterThan(1);
  });
});

describe("puffball", () => {
  it("vaporizes nearby rocks outright and spares distant ones", () => {
    const s = freshState();
    s.ship.pos = { x: 400, y: 300 };
    const near = parkedRoid(400 + PUFF_RADIUS - 30, 300, 3);
    const far = parkedRoid(400 + PUFF_RADIUS + 100, 300, 3);
    s.roids = [near, far];
    firePuffball(s, half);
    expect(s.roids).toContain(far);
    expect(s.roids).not.toContain(near);
    // Vaporized, not split: no children appear.
    expect(s.roids).toHaveLength(1);
    expect(s.blasts.some((b) => b.kind === "puff")).toBe(true);
  });
});

describe("powerups", () => {
  it("shield pickups add power up to the cap", () => {
    const s = freshState();
    collectPowerup(s, "shield");
    expect(s.ship.shield).toBe(START_SHIELD + SHIELD_PICKUP);
    s.ship.shield = MAX_SHIELD - 1;
    collectPowerup(s, "shield");
    expect(s.ship.shield).toBe(MAX_SHIELD);
  });

  it("bouncy armor and extra lives apply", () => {
    const s = freshState();
    collectPowerup(s, "bouncy");
    expect(s.ship.bouncy).toBe(BOUNCY_TIME);
    collectPowerup(s, "life");
    expect(s.lives).toBe(START_LIVES + 1);
  });

  it("weapon pickups arm the weapon; a repeat tops up the magazine", () => {
    const s = freshState();
    collectPowerup(s, "laser");
    expect(s.weapon).toBe("laser");
    expect(s.ammo).toBe(WEAPON_AMMO.laser);
    collectPowerup(s, "laser");
    expect(s.ammo).toBe(WEAPON_AMMO.laser * 2);
    collectPowerup(s, "puffball");
    expect(s.weapon).toBe("puffball");
    expect(s.ammo).toBe(WEAPON_AMMO.puffball);
  });

  it("a destroyed rock can drop a powerup (rare life included)", () => {
    const s = freshState();
    // rng: drop roll passes, weight roll lands on the last (rarest) entry.
    breakRoid(s, parkedRoid(300, 300, 1), seqRng([0, 0.99, 0.5]));
    expect(s.powerups).toHaveLength(1);
    expect(s.powerups[0].kind).toBe("life");
  });

  it("the ship scoops up a powerup it touches", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.powerups.push({
      pos: { x: s.ship.pos.x, y: s.ship.pos.y },
      vel: { x: 0, y: 0 },
      kind: "life",
      ttl: 5,
    });
    step(s, IDLE, 0.016, half);
    expect(s.powerups).toHaveLength(0);
    expect(s.lives).toBe(START_LIVES + 1);
  });
});

describe("ship damage", () => {
  it("a shield absorbs a rock hit and shatters the rock", () => {
    const s = freshState();
    s.ship.shield = 1;
    const rock = parkedRoid(s.ship.pos.x, s.ship.pos.y, 1);
    s.roids = [sentinel(), rock];
    step(s, IDLE, 0.016, half);
    expect(s.ship.shield).toBe(0);
    expect(s.lives).toBe(START_LIVES);
    expect(s.roids).not.toContain(rock);
    expect(s.ship.invuln).toBeGreaterThan(0);
    expect(s.ship.invuln).toBeLessThanOrEqual(HIT_GRACE);
  });

  it("with no shield a rock costs a life and queues a respawn", () => {
    const s = freshState();
    s.ship.shield = 0;
    s.roids = [sentinel(), parkedRoid(s.ship.pos.x, s.ship.pos.y, 1)];
    step(s, IDLE, 0.016, half);
    expect(s.lives).toBe(START_LIVES - 1);
    expect(s.respawn).toBeGreaterThan(0);
    // Ride out the respawn delay: the ship returns centered and invulnerable.
    for (let i = 0; i < 60; i++) step(s, IDLE, 0.05, half);
    expect(s.respawn).toBe(0);
    expect(s.ship.invuln).toBeGreaterThan(0);
    expect(s.ship.invuln).toBeLessThanOrEqual(RESPAWN_INVULN);
  });

  it("bouncy armor bounces off a rock instead of dying", () => {
    const s = freshState();
    s.ship.shield = 0;
    s.ship.bouncy = 5;
    s.ship.vel = { x: 120, y: 0 };
    const rock = parkedRoid(s.ship.pos.x + 10, s.ship.pos.y, 2);
    s.roids = [sentinel(), rock];
    step(s, IDLE, 0.016, half);
    expect(s.lives).toBe(START_LIVES);
    expect(s.roids).toContain(rock);
    expect(s.ship.vel.x).toBeLessThan(0); // deflected back
  });

  it("losing the last life ends the game", () => {
    const s = freshState();
    s.lives = 1;
    s.ship.shield = 0;
    hitShip(s);
    expect(s.over).toBe(true);
  });
});

describe("the StarCastle", () => {
  /** A parked castle with frozen rings and guns silenced, for exact setups. */
  function quietCastle(s: GameState) {
    const castle = makeCastle(s.w, s.h, half);
    castle.pos = { x: 400, y: 300 };
    castle.vel = { x: 0, y: 0 };
    castle.gunCooldown = 9999;
    castle.sweepCooldown = 9999;
    for (const ring of castle.rings) {
      ring.angle = 0;
      ring.spin = 0;
      ring.regen = RING_REGEN;
    }
    s.castle = castle;
    return castle;
  }

  it("warps in after the castle timer runs down", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.invuln = 9999;
    s.castleTimer = CASTLE_FIRST;
    for (let t = 0; t < CASTLE_FIRST + 1; t += 0.5) step(s, IDLE, 0.5, lcg(5));
    expect(s.castle).not.toBeNull();
  });

  it("segment lookup and hole detection line up", () => {
    const s = freshState();
    const castle = quietCastle(s);
    const outer = castle.rings[0];
    expect(ringSegmentAt(outer, 0.01)).toBe(0);
    expect(castleHoleAt(castle, 0)).toBe(false);
    for (const ring of castle.rings) ring.segs[ringSegmentAt(ring, 0)] = false;
    expect(castleHoleAt(castle, 0)).toBe(true);
    expect(castleHoleAt(castle, Math.PI)).toBe(false);
  });

  it("a bullet knocks out the shield segment it strikes", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: 700, y: 100 };
    s.ship.invuln = 9999;
    const castle = quietCastle(s);
    // Flying straight at the east face of the outer ring.
    s.bullets.push({ pos: { x: 480, y: 300 }, vel: { x: -520, y: 0 }, life: 1, kind: "std" });
    step(s, IDLE, 0.05, half);
    expect(castle.rings[0].segs[0]).toBe(false);
    expect(s.score).toBe(CASTLE_SEG_SCORE);
    expect(s.bullets).toHaveLength(0);
  });

  it("a bullet through an open corridor destroys the core", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: 700, y: 100 };
    s.ship.invuln = 9999;
    quietCastle(s);
    for (const ring of s.castle!.rings) ring.segs.fill(false);
    s.bullets.push({ pos: { x: 480, y: 300 }, vel: { x: -520, y: 0 }, life: 1, kind: "std" });
    for (let i = 0; i < 10 && s.castle; i++) step(s, IDLE, 0.05, half);
    expect(s.castle).toBeNull();
    expect(s.score).toBe(CASTLE_CORE_SCORE);
    expect(s.powerups).toHaveLength(2); // a slain castle coughs up two gifts
  });

  it("shield rings slowly regenerate destroyed segments", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.invuln = 9999;
    const castle = quietCastle(s);
    castle.rings[0].segs[3] = false;
    for (let t = 0; t < RING_REGEN + 0.5; t += 0.25) step(s, IDLE, 0.25, half);
    expect(castle.rings[0].segs[3]).toBe(true);
  });

  it("piercing lasers carve shield segments on the way through", () => {
    const s = freshState();
    const castle = quietCastle(s);
    // A line offset 40px from the core: crosses the two outer rings twice
    // each, misses the innermost (r 36) and the core entirely.
    s.ship.pos = { x: 700, y: 340 };
    s.ship.angle = Math.PI;
    fireHitscan(s, "superlaser", half);
    expect(s.castle).not.toBeNull();
    const holes = castle.rings.map((ring) => ring.segs.filter((a) => !a).length);
    expect(holes).toEqual([2, 2, 0]);
    expect(s.score).toBe(CASTLE_SEG_SCORE * 4);
  });

  it("a super laser straight through the middle nukes the core", () => {
    const s = freshState();
    quietCastle(s);
    s.ship.pos = { x: 700, y: 300 };
    s.ship.angle = Math.PI;
    fireHitscan(s, "superlaser", half);
    expect(s.castle).toBeNull();
    expect(s.score).toBe(CASTLE_SEG_SCORE * 6 + CASTLE_CORE_SCORE);
  });

  it("opens fire with the sweeping beam when a hole lines up with the ship", () => {
    const s = freshState();
    s.ship.pos = { x: 600, y: 300 }; // due east of the castle
    s.ship.shield = 1;
    s.ship.invuln = 0;
    const castle = quietCastle(s);
    castle.sweepCooldown = 0;
    for (const ring of castle.rings) ring.segs[ringSegmentAt(ring, 0)] = false;
    const target = parkedRoid(700, 300, 3); // parked in the blast lane
    s.roids = [sentinel(), target];

    step(s, IDLE, 0.02, half);
    expect(castle.sweep?.phase).toBe("charge");
    for (let t = 0; t < SWEEP_CHARGE + SWEEP_DURATION + 0.2; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.roids).not.toContain(target); // the sweep vaporized the rock…
    expect(s.ship.shield).toBe(0); // …and slammed the ship's shield
    expect(castle.sweep).toBeNull();
  });
});

describe("waves", () => {
  it("clearing the field starts the next, bigger wave", () => {
    const s = freshState();
    s.ship.invuln = 9999;
    s.wave = 1;
    s.roids = [];
    step(s, IDLE, 0.016, lcg(9));
    expect(s.wave).toBe(2);
    expect(s.roids).toHaveLength(4); // 2 + wave
  });
});
