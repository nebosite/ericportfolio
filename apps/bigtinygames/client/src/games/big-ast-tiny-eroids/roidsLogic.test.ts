import { describe, expect, it } from "vitest";
import {
  BOUNCY_TIME,
  CASTLE_CORE_SCORE,
  CASTLE_FIRST,
  CASTLE_GUN_SPEED,
  CASTLE_MAX_LAYERS,
  CASTLE_SEG_SCORE,
  DEBRIS_PER_ROID,
  FIRE_COOLDOWN,
  FLOATER_TTL,
  FRAG_COUNT,
  GameState,
  HIT_GRACE,
  InputState,
  MAX_SHIELD,
  MAX_SPEED,
  NOVA_CHARGE,
  NOVA_GROW_TIME,
  PUFF_RADIUS,
  RESPAWN_INVULN,
  RING_REGEN,
  ROID_SCORE,
  SHIELD_PICKUP,
  SHIP_R,
  SPAWN_CLEAR,
  START_LIVES,
  START_SHIELD,
  TURN_ACCEL,
  TURN_RATE,
  WEAPON_AMMO,
  breakRoid,
  castleHoleAt,
  castleInterval,
  castleLayers,
  collectPowerup,
  fireHitscan,
  firePuffball,
  hitShip,
  initialState,
  makeCastle,
  makeRoid,
  novaHitR,
  novaMaxR,
  novaSpeed,
  ringSegmentAt,
  step,
  torusDist,
  traceHitscan,
  waveRoidCount,
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

/** A parked wave-1 castle (2 rings) with frozen rings and silenced guns. */
function quietCastle(s: GameState) {
  const castle = makeCastle(s.w, s.h, half, 1);
  castle.pos = { x: 400, y: 300 };
  castle.vel = { x: 0, y: 0 };
  castle.gunCooldown = 9999;
  castle.novaCooldown = 9999;
  castle.coreSpin = 0;
  for (const ring of castle.rings) {
    ring.angle = 0;
    ring.spin = 0;
    ring.regen = RING_REGEN;
  }
  s.castles.push(castle);
  return castle;
}

describe("initialState & density", () => {
  it("starts with 3 lives, 1 shield, the pea shooter, and the density-formula rocks", () => {
    const s = initialState(800, 600, lcg(3));
    expect(s.lives).toBe(START_LIVES);
    expect(s.ship.shield).toBe(START_SHIELD);
    expect(s.weapon).toBe("bullet");
    expect(s.ammo).toBe(Infinity);
    expect(s.wave).toBe(1);
    // 10 + 5·1 = 15 rocks per Mpx on a 0.48 Mpx field → 7.
    expect(s.roids).toHaveLength(7);
    expect(s.roids.every((r) => r.size === 3)).toBe(true);
  });

  it("waveRoidCount follows 10 + 5·wave per million square pixels", () => {
    expect(waveRoidCount(1000, 1000, 1)).toBe(15);
    expect(waveRoidCount(1000, 1000, 4)).toBe(30);
    expect(waveRoidCount(2000, 1000, 1)).toBe(30);
    expect(waveRoidCount(200, 200, 1)).toBe(1); // floor: always at least one rock
    expect(waveRoidCount(4000, 4000, 10)).toBe(120); // perf ceiling
  });

  it("spawns the opening rocks clear of the ship", () => {
    const s = initialState(800, 600, lcg(11));
    for (const r of s.roids) {
      expect(torusDist(r.pos, s.ship.pos, s.w, s.h)).toBeGreaterThan(SPAWN_CLEAR);
    }
  });
});

describe("ship physics", () => {
  it("thrusts along its facing", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.angle = 0;
    step(s, { ...IDLE, thrust: true }, 0.1, half);
    expect(s.ship.vel.x).toBeGreaterThan(0);
    expect(Math.abs(s.ship.vel.y)).toBeLessThan(1e-9);
  });

  it("turning ramps up with inertia and coasts back down", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.angle = 0;
    // One short press barely turns — the spin is still winding up.
    step(s, { ...IDLE, left: true }, 0.02, half);
    expect(s.ship.turnVel).toBeCloseTo(-TURN_ACCEL * 0.02, 5);
    expect(Math.abs(s.ship.turnVel)).toBeLessThan(TURN_RATE);
    // Held: the turn saturates at TURN_RATE.
    for (let i = 0; i < 30; i++) step(s, { ...IDLE, left: true }, 0.02, half);
    expect(s.ship.turnVel).toBeCloseTo(-TURN_RATE, 5);
    const heading = s.ship.angle;
    // Released: it brakes back to zero and the heading settles.
    for (let i = 0; i < 30; i++) step(s, IDLE, 0.02, half);
    expect(s.ship.turnVel).toBe(0);
    expect(s.ship.angle).toBeLessThan(heading); // coasted a bit past release
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

describe("rock physics", () => {
  it("rocks drift at the halved speeds", () => {
    // base 20 + rng·20 + wave·2 → 20 + 10 + 2 = 32 px/s for a big wave-1 rock.
    const rock = makeRoid({ x: 0, y: 0 }, 3, 1, half);
    expect(Math.hypot(rock.vel.x, rock.vel.y)).toBeCloseTo(32, 5);
  });
});

describe("firing", () => {
  it("fires one bullet, emits a shoot sound, and enforces the cooldown", () => {
    const s = freshState();
    s.roids = [sentinel()];
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(1);
    expect(s.events).toContain("shoot");
    expect(s.ship.cooldown).toBeGreaterThan(0);
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(1); // still cooling down
    expect(s.events).not.toContain("shoot"); // events are per-step
  });

  it("does not fire while the ship is waiting to respawn", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.respawn = 1;
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(0);
  });

  it("player bullets fly all the way to the screen edge, then vanish", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: 10, y: 300 };
    s.ship.angle = 0; // facing the far edge, ~790 px away
    step(s, FIRE, 0.016, half);
    expect(s.bullets).toHaveLength(1);
    // A short-range bullet would die mid-screen; this one crosses the field…
    for (let t = 0; t < 1.2; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.bullets).toHaveLength(1);
    expect(s.bullets[0].pos.x).toBeGreaterThan(600);
    // …and disappears at the edge instead of wrapping.
    for (let t = 0; t < 0.6; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.bullets).toHaveLength(0);
  });

  it("weapon ammo runs dry, reverts to the pea shooter, and clicks empty", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.weapon = "laser";
    s.ammo = 1;
    step(s, FIRE, 0.016, half);
    expect(s.weapon).toBe("bullet");
    expect(s.ammo).toBe(Infinity);
    expect(s.events).toContain("empty");
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
  it("a big rock breaks into two mediums, scores, booms, and throws debris", () => {
    const s = freshState();
    const rock = parkedRoid(500, 300, 3);
    s.roids = [rock];
    s.bullets.push({ pos: { x: 500, y: 300 }, vel: { x: 0, y: 0 }, life: 1, kind: "std" });
    step(s, IDLE, 0.016, half);
    expect(s.roids).not.toContain(rock);
    expect(s.roids.filter((r) => r.size === 2)).toHaveLength(2);
    expect(s.score).toBe(ROID_SCORE[3]);
    expect(s.bullets).toHaveLength(0);
    expect(s.events).toContain("boom");
    expect(s.debris).toHaveLength(DEBRIS_PER_ROID);
    // The shards burn out on their own.
    for (let t = 0; t < 1; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.debris).toHaveLength(0);
  });

  it("a small rock vanishes for top score", () => {
    const s = freshState();
    s.roids = [sentinel(), parkedRoid(500, 300, 1)];
    s.bullets.push({ pos: { x: 500, y: 300 }, vel: { x: 0, y: 0 }, life: 1, kind: "std" });
    step(s, IDLE, 0.016, half);
    expect(s.roids).toHaveLength(1);
    expect(s.score).toBe(ROID_SCORE[1]);
  });

  it("a super bullet bursts into 20 regular bullets on impact", () => {
    const s = freshState();
    s.roids = [sentinel(), parkedRoid(500, 300, 1)];
    s.bullets.push({ pos: { x: 500, y: 300 }, vel: { x: 0, y: 0 }, life: 1, kind: "super" });
    step(s, IDLE, 0.016, half);
    expect(s.bullets.filter((b) => b.kind === "std")).toHaveLength(FRAG_COUNT);
    expect(FRAG_COUNT).toBe(20);
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
    expect(s.events).toContain("puff");
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

  it("scooping a powerup announces it with a rising floater", () => {
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
    expect(s.events).toContain("powerup");
    expect(s.floaters).toHaveLength(1);
    expect(s.floaters[0].kind).toBe("life");
    // The announcement rises briefly, then expires.
    for (let t = 0; t < FLOATER_TTL + 0.1; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.floaters).toHaveLength(0);
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

  it("losing the last life ends the game with the gameover sound", () => {
    const s = freshState();
    s.lives = 1;
    s.ship.shield = 0;
    hitShip(s);
    expect(s.over).toBe(true);
    expect(s.events).toContain("shipdown");
    expect(s.events).toContain("gameover");
  });
});

describe("the StarCastle", () => {
  it("layers grow with the wave: two at wave 1, one more per wave, capped", () => {
    expect(castleLayers(1)).toBe(2);
    expect(castleLayers(3)).toBe(4);
    expect(castleLayers(99)).toBe(CASTLE_MAX_LAYERS);
    const c1 = makeCastle(800, 600, lcg(2), 1);
    expect(c1.rings).toHaveLength(2);
    // Outer → inner, radii descending, more segments outward.
    expect(c1.rings[0].r).toBeGreaterThan(c1.rings[1].r);
    expect(c1.rings[0].segs.length).toBeGreaterThan(c1.rings[1].segs.length);
    const c3 = makeCastle(800, 600, lcg(2), 3);
    expect(c3.rings).toHaveLength(4);
  });

  it("castles come faster at higher waves", () => {
    expect(castleInterval(1)).toBe(CASTLE_FIRST + 8);
    expect(castleInterval(2)).toBeLessThan(castleInterval(1));
    expect(castleInterval(50)).toBe(8); // floor
  });

  it("warps in after the castle timer runs down, capped at one per wave number", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.invuln = 9999;
    s.castleTimer = CASTLE_FIRST;
    for (let t = 0; t < CASTLE_FIRST + 1; t += 0.5) step(s, IDLE, 0.5, lcg(5));
    expect(s.castles).toHaveLength(1);
    // Wave 1 allows exactly one castle at a time — the timer stops running.
    for (let t = 0; t < 40; t += 0.5) step(s, IDLE, 0.5, lcg(6));
    expect(s.castles).toHaveLength(1);
  });

  it("allows simultaneous castles up to the wave number", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.invuln = 9999;
    s.wave = 2;
    quietCastle(s);
    s.castleTimer = 0.01;
    step(s, IDLE, 0.05, lcg(4));
    expect(s.castles).toHaveLength(2); // slot was free → spawned
    expect(s.events).toContain("castlespawn"); // with the ominous fanfare
    s.castleTimer = 0.01;
    step(s, IDLE, 0.05, lcg(4));
    expect(s.castles).toHaveLength(2); // at the cap → timer frozen
    expect(s.castleTimer).toBeCloseTo(0.01, 5);
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

  it("the core gun fires along its own facing, at the slowed rate", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: 700, y: 100 }; // clear of the muzzle
    s.ship.invuln = 9999;
    const castle = quietCastle(s);
    castle.gunCooldown = 0.01;
    castle.coreAngle = Math.PI / 2; // pointing straight down
    step(s, IDLE, 0.02, half);
    const shot = s.bullets.find((b) => b.kind === "enemy");
    expect(shot).toBeDefined();
    expect(shot!.vel.x).toBeCloseTo(0, 5);
    expect(shot!.vel.y).toBeCloseTo(CASTLE_GUN_SPEED, 5);
    // 30% of the old cadence: (0.5 + 0.5·1.2) / 0.3 ≈ 3.67 s until the next shot.
    expect(castle.gunCooldown).toBeGreaterThan(3);
  });

  it("a bullet knocks out the shield segment it strikes", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: 700, y: 100 };
    s.ship.invuln = 9999;
    const castle = quietCastle(s);
    // Flying straight at the east face of the outer ring (r 52).
    s.bullets.push({ pos: { x: 470, y: 300 }, vel: { x: -520, y: 0 }, life: 1, kind: "std" });
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
    const castle = quietCastle(s);
    for (const ring of castle.rings) ring.segs.fill(false);
    s.bullets.push({ pos: { x: 470, y: 300 }, vel: { x: -520, y: 0 }, life: 1, kind: "std" });
    for (let i = 0; i < 10 && s.castles.length > 0; i++) step(s, IDLE, 0.05, half);
    expect(s.castles).toHaveLength(0);
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
    // A line offset 40px from the core: crosses the outer ring (r 52) twice,
    // misses the inner ring (r 36) and the core entirely.
    s.ship.pos = { x: 700, y: 340 };
    s.ship.angle = Math.PI;
    fireHitscan(s, "superlaser", half);
    expect(s.castles).toHaveLength(1);
    const holes = castle.rings.map((ring) => ring.segs.filter((a) => !a).length);
    expect(holes).toEqual([2, 0]);
    expect(s.score).toBe(CASTLE_SEG_SCORE * 2);
  });

  it("a super laser straight through the middle nukes the core", () => {
    const s = freshState();
    quietCastle(s);
    s.ship.pos = { x: 700, y: 300 };
    s.ship.angle = Math.PI;
    fireHitscan(s, "superlaser", half);
    expect(s.castles).toHaveLength(0);
    expect(s.score).toBe(CASTLE_SEG_SCORE * 4 + CASTLE_CORE_SCORE);
  });

  it("charges and looses a nova when a hole lines up with the ship", () => {
    const s = freshState();
    s.ship.pos = { x: 600, y: 300 }; // due east of the castle
    s.ship.shield = 1;
    s.ship.invuln = 0;
    const castle = quietCastle(s);
    castle.novaCooldown = 0;
    for (const ring of castle.rings) ring.segs[ringSegmentAt(ring, 0)] = false;
    const target = parkedRoid(700, 300, 3); // parked in the firing lane
    s.roids = [sentinel(), target];

    step(s, IDLE, 0.02, half);
    expect(castle.charge).not.toBeNull();
    expect(s.events).toContain("sweep");

    // Ride out the charge: the nova launches toward the ship (due east).
    for (let t = 0.02; t < NOVA_CHARGE + 0.06; t += 0.02) step(s, IDLE, 0.02, half);
    expect(castle.charge).toBeNull();
    castle.novaCooldown = 9999; // one nova only, for exact assertions below
    expect(s.novas).toHaveLength(1);
    const nova = s.novas[0];
    expect(nova.vel.x).toBeCloseTo(novaSpeed(1), 3);
    expect(nova.vel.y).toBeCloseTo(0, 3);
    expect(nova.r).toBeLessThan(novaMaxR(1)); // starts small…
    // Sidestep so only the radiation fringe clips the ship once — parking
    // dead-center on a nova's path is (correctly) fatal now.
    s.ship.pos = { x: 600, y: 355 };

    // …and swells to full size as it flies.
    for (let t = 0; t < NOVA_GROW_TIME + 0.1; t += 0.02) step(s, IDLE, 0.02, half);
    expect(nova.r).toBe(novaMaxR(1));

    // It carves the rock, its radiation fringe slams the shield, and it dies
    // off the east edge.
    for (let t = 0; t < 4.5; t += 0.02) step(s, IDLE, 0.02, half);
    expect(s.roids).not.toContain(target);
    expect(s.ship.shield).toBe(0);
    expect(s.lives).toBe(START_LIVES); // one shield hit, not a death
    expect(s.novas).toHaveLength(0); // gone at the screen edge — no wrap
  });

  it("novas scale up with the wave", () => {
    expect(novaSpeed(3)).toBeGreaterThan(novaSpeed(1));
    expect(novaMaxR(3)).toBeGreaterThan(novaMaxR(1));
    expect(novaSpeed(99)).toBe(260); // capped
    expect(novaMaxR(99)).toBe(80);
  });

  it("a nova is deadly exactly out to its outermost radiation line", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.shield = 1;
    s.ship.invuln = 0;
    const reach = novaHitR(20);
    s.novas.push({ pos: { x: 300, y: 300 }, vel: { x: 0, y: 0 }, r: 20, maxR: 20, age: 9 });
    // Just beyond the radiation fringe: safe.
    s.ship.pos = { x: 300 + reach + SHIP_R + 3, y: 300 };
    step(s, IDLE, 0.016, half);
    expect(s.ship.shield).toBe(1);
    // Just inside it: hit.
    s.ship.pos = { x: 300 + reach + SHIP_R - 3, y: 300 };
    step(s, IDLE, 0.016, half);
    expect(s.ship.shield).toBe(0);
  });

  it("bullets register on the wrapped-around part of an edge-straddling castle", () => {
    const s = freshState();
    s.roids = [sentinel()];
    s.ship.pos = { x: 400, y: 100 };
    s.ship.invuln = 9999;
    const castle = quietCastle(s);
    castle.pos = { x: 10, y: 300 }; // straddles the left edge; wrapped part shows at x≈810-52
    // A bullet at the right edge flying further right, into the wrapped inner ring.
    s.bullets.push({ pos: { x: 770, y: 300 }, vel: { x: 520, y: 0 }, life: 1, kind: "std" });
    step(s, IDLE, 0.05, half);
    // Inner ring (r 36) west face of the image at x=810: segment at angle π.
    const inner = castle.rings[1];
    expect(inner.segs[ringSegmentAt(inner, Math.PI)]).toBe(false);
    expect(s.score).toBe(CASTLE_SEG_SCORE);
  });

  it("traceHitscan previews hits without applying any damage", () => {
    const s = freshState();
    const near = parkedRoid(400, 300, 2);
    s.roids = [near];
    s.ship.pos = { x: 200, y: 300 };
    s.ship.angle = 0;
    const trace = traceHitscan(s, "laser");
    expect(trace.roids).toContain(near);
    expect(trace.segs.length).toBeGreaterThan(0);
    // Nothing actually happened to the world.
    expect(s.roids).toContain(near);
    expect(s.score).toBe(0);
    expect(s.beams).toHaveLength(0);
  });
});

describe("waves", () => {
  it("clearing the field starts the next, denser wave", () => {
    const s = freshState();
    s.ship.invuln = 9999;
    s.wave = 1;
    s.roids = [];
    step(s, IDLE, 0.016, lcg(9));
    expect(s.wave).toBe(2);
    // 10 + 5·2 = 20 per Mpx on a 0.48 Mpx field → 10.
    expect(s.roids).toHaveLength(10);
  });
});
