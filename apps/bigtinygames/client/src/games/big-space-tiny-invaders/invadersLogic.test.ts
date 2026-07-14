import { describe, expect, it } from "vitest";
import {
  AIR_MISSILE_BLAST_R,
  AIR_MISSILE_COUNT,
  AIR_MISSILE_SPEED,
  AIR_MISSILE_SPREAD,
  CHAIN_FANOUT,
  CHAIN_JUMPS,
  CHARGE_PER_SCRAP,
  CHARGE_REGEN,
  CHARGE_START,
  COST_BULLET,
  COST_CHAIN,
  COST_MISSILE,
  DROP,
  EDGE_POWERUP_GAP,
  INTRO_WARMUP,
  FLYER_FIRE_MAX,
  FLYER_FIRE_MIN,
  FLYER_LOW_BAND,
  GameState,
  InputState,
  LAVA_TTL,
  MISSILE_BLAST_R,
  NUKE_BLAST_R,
  NUKE_FUSE,
  SCRAP_GROUND_TTL,
  SCRAP_TTL_MAX,
  SCRAP_TTL_MIN,
  SPACING,
  SQUAD_MAX,
  SQUAD_MIN,
  START_LIVES,
  TYPE_SCORE,
  UFO_SCORE,
  applyPowerup,
  eBulletSpeed,
  eShotsPerSec,
  fillFormation,
  formationDims,
  groundY,
  hitSlotAt,
  initialState,
  marchSpeed,
  missileControlX,
  shieldCount,
  slotCenter,
  step,
  swoopFloorY,
  weaponCost,
} from "./invadersLogic";

const IDLE: InputState = {
  left: false,
  right: false,
  fire: false,
  missile: null,
  air: false,
  nuke: false,
  selectWeapon: false,
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

/** A quiet battlefield: full horde deployed, all spawners/shooters muted. */
function freshState(w = 800, h = 600): GameState {
  const state = initialState(w, h);
  fillFormation(state);
  state.player.invuln = 0;
  state.eShotTimer = 9999;
  state.flyerTimer = 9999;
  state.ufoTimer = 9999;
  return state;
}

/** Instantly-complete blast, for testing kill zones without flight time. */
function fullBlast(state: GameState, x: number, y: number, maxR: number, kind: "missile" | "nuke") {
  state.blasts.push({ x, y, maxR, age: 0.99, ttl: 1, kind });
}

describe("scale & setup", () => {
  it("builds a horde of thousands scaled to the screen", () => {
    const d800 = formationDims(800, 600);
    expect(d800.cols * d800.rows).toBeGreaterThan(2000);
    const d1080 = formationDims(1920, 1080);
    expect(d1080.cols * d1080.rows).toBeGreaterThan(10000);
    const capped = formationDims(4000, 4000);
    expect(capped.cols * capped.rows).toBeLessThanOrEqual(60000);
  });

  it("the grid is deep enough to cover the top half of the screen", () => {
    for (const [w, h] of [
      [800, 600],
      [1920, 1080],
    ]) {
      const { rows } = formationDims(w, h);
      expect(rows * SPACING).toBeGreaterThanOrEqual(h * 0.45);
    }
  });

  it("plants about 5 shield walls per thousand pixels", () => {
    expect(shieldCount(1000)).toBe(5);
    expect(shieldCount(2000)).toBe(10);
    expect(shieldCount(300)).toBe(2); // floor: never fewer than two
  });

  it("starts with an EMPTY grid and every slot queued to fly in", () => {
    const s = initialState(800, 600, lcg(2));
    expect(s.form.aliveCount).toBe(0);
    expect(s.introQueue).toHaveLength(s.form.cols * s.form.rows);
    expect(s.introLaunched).toBe(0);
    // Lowest rows fill first: the queue starts with the bottom row's slots.
    const bottomRow = s.form.rows - 1;
    expect((s.introQueue[0] / s.form.cols) | 0).toBe(bottomRow);
    expect(s.lives).toBe(START_LIVES);
    expect(s.weapon).toBe("gun");
    expect(s.weapons).toEqual(["gun"]);
    expect(s.charge).toBe(CHARGE_START);
    expect(s.shields).toHaveLength(shieldCount(800));
    // You start armed with one of each ground/air special.
    expect(s.airAmmo).toBe(1);
    expect(s.nukeAmmo).toBe(1);
    expect(s.edgePowerupTimer).toBe(EDGE_POWERUP_GAP);
  });

  it("holds a warmup, then flies everyone in (grid full ~7s after warmup)", () => {
    const s = initialState(800, 600, lcg(3));
    s.player.invuln = 9999;
    s.lives = 99;
    s.ufoTimer = 9999;
    s.flyerTimer = 9999;
    const total = s.form.cols * s.form.rows;
    // During the warmup nothing launches.
    for (let t = 0; t < INTRO_WARMUP - 0.2; t += 0.05) step(s, IDLE, 0.05, lcg(3));
    expect(s.flyers).toHaveLength(0);
    expect(s.form.aliveCount).toBe(0);
    // Then everyone flies in and settles.
    let sawArrivals = false;
    let t = 0;
    for (; t < 10 && s.form.aliveCount < total; t += 0.05) {
      step(s, IDLE, 0.05, lcg(3));
      if (s.flyers.some((f) => f.mode === "arrive")) sawArrivals = true;
    }
    expect(sawArrivals).toBe(true);
    expect(s.form.aliveCount).toBe(total);
    expect(s.flyers).toHaveLength(0);
    expect(t).toBeLessThanOrEqual(8); // the doubled fly-in fills inside ~7 seconds
  });

  it("the fly-in fills the lowest rows first", () => {
    const s = initialState(800, 600, lcg(5));
    s.player.invuln = 9999;
    s.flyerTimer = 9999;
    s.ufoTimer = 9999;
    // Part-way past the warmup, the bottom rows are populated and the top
    // rows are still empty.
    for (let t = 0; t < INTRO_WARMUP + 1.5; t += 0.05) step(s, IDLE, 0.05, lcg(5));
    const rowAlive = (row: number) => s.form.rowCounts[row];
    expect(rowAlive(s.form.rows - 1)).toBeGreaterThan(rowAlive(0));
  });
});

describe("the horde marches", () => {
  it("reverses and drops when it reaches an edge", () => {
    const s = freshState();
    s.form.dir = 1;
    s.form.x = s.w - 6 - (s.form.maxCol + 1) * SPACING - 0.5;
    const y0 = s.form.y;
    step(s, IDLE, 0.1, half);
    expect(s.form.dir).toBe(-1);
    expect(s.form.y).toBe(y0 + DROP);
  });

  it("marches faster at higher levels and as the horde thins", () => {
    expect(marchSpeed(2, 1)).toBeGreaterThan(marchSpeed(1, 1));
    expect(marchSpeed(1, 0.1)).toBeGreaterThan(marchSpeed(1, 1));
    expect(marchSpeed(99, 0)).toBe(150); // capped
  });

  it("fires more bullets at higher levels", () => {
    expect(eShotsPerSec(3)).toBeGreaterThan(eShotsPerSec(1));
    expect(eShotsPerSec(99)).toBe(20); // capped
    expect(eBulletSpeed(99)).toBe(260); // capped
  });

  it("shoots from the bottom-most invader of a column", () => {
    const s = freshState();
    s.eShotTimer = 0.001;
    step(s, IDLE, 0.01, lcg(3));
    expect(s.ebullets).toHaveLength(1);
    expect(s.ebullets[0].y).toBeGreaterThan(s.form.y + (s.form.rows - 1) * SPACING);
  });

  it("invaders reaching the ground ends the game", () => {
    const s = freshState();
    s.form.y = groundY(s.h) - (s.form.maxRow + 1) * SPACING - 3;
    step(s, IDLE, 0.016, half);
    expect(s.over).toBe(true);
    expect(s.events).toContain("gameover");
  });
});

describe("bullets vs the horde", () => {
  it("a bullet kills exactly the invader in its grid cell and drops scrap", () => {
    const s = freshState();
    const idx = 15 * s.form.cols + 40;
    const at = slotCenter(s.form, idx);
    s.bullets.push({
      x: at.x,
      y: at.y + 2,
      vx: 0,
      vy: -540,
      chain: false,
      chainGen: 0,
      chainTarget: -1,
    });
    step(s, IDLE, 0.001, () => 0.01); // rng < SCRAP_DROP_CHANCE → this kill sheds scrap
    expect(s.form.alive[idx]).toBe(0);
    expect(s.form.aliveCount).toBe(s.form.cols * s.form.rows - 1);
    expect(s.deadSlots).toContain(idx);
    expect(s.score).toBe(TYPE_SCORE[1]); // row 15 of 33 is a mid-tier invader
    expect(s.scrap.count).toBeGreaterThan(0);
    expect(s.events).toContain("pop");
    expect(s.bullets).toHaveLength(0); // the bullet is spent
  });

  it("destroyed invaders are never replaced", () => {
    const s = freshState();
    s.lives = 99;
    s.player.invuln = 9999;
    s.flyerTimer = 9999; // keep even divers home: the hole must stay a hole
    const idx = 20 * s.form.cols + 30;
    const at = slotCenter(s.form, idx);
    s.bullets.push({
      x: at.x,
      y: at.y + 2,
      vx: 0,
      vy: -540,
      chain: false,
      chainGen: 0,
      chainTarget: -1,
    });
    for (let t = 0; t < 20; t += 0.1) step(s, IDLE, 0.1, lcg(7));
    expect(s.form.alive[idx]).toBe(0);
  });

  it("scrap grains live 10-15 seconds", () => {
    const s = freshState();
    const idx = 15 * s.form.cols + 40;
    const at = slotCenter(s.form, idx);
    s.bullets.push({
      x: at.x,
      y: at.y + 2,
      vx: 0,
      vy: -540,
      chain: false,
      chainGen: 0,
      chainTarget: -1,
    });
    step(s, IDLE, 0.001, () => 0.01); // force a scrap drop
    expect(s.scrap.count).toBeGreaterThan(0);
    for (let k = 0; k < s.scrap.count; k++) {
      expect(s.scrap.ttl[k]).toBeGreaterThanOrEqual(SCRAP_TTL_MIN);
      expect(s.scrap.ttl[k]).toBeLessThanOrEqual(SCRAP_TTL_MAX);
      expect(s.scrap.seed[k]).toBeGreaterThanOrEqual(0);
      expect(s.scrap.seed[k]).toBeLessThan(1);
    }
  });

  it("player rounds punch much bigger holes in shields than enemy fire", () => {
    const holesAfter = (friendly: boolean): number => {
      const s = freshState();
      const shield = s.shields[0];
      const sx = shield.x + 24;
      const before = shield.cells.reduce((n, c) => n + c, 0);
      if (friendly)
        s.bullets.push({
          x: sx,
          y: shield.y + 20,
          vx: 0,
          vy: -540,
          chain: false,
          chainGen: 0,
          chainTarget: -1,
        });
      else s.ebullets.push({ x: sx, y: shield.y - 6, vy: 200 });
      step(s, IDLE, 0.05, half);
      return before - shield.cells.reduce((n, c) => n + c, 0);
    };
    const playerHole = holesAfter(true);
    const enemyHole = holesAfter(false);
    expect(playerHole).toBeGreaterThanOrEqual(enemyHole * 3);
  });

  it("an enemy bullet on the ship costs a life — and your toys", () => {
    const s = freshState();
    s.weapons = ["gun", "sprinkler", "chain"];
    s.weapon = "chain";
    s.airAmmo = 2;
    s.nukeAmmo = 1;
    s.sprinklerStack = 2;
    s.chainStack = 3;
    s.ebullets.push({ x: s.player.x, y: groundY(s.h) - 10, vy: 100 });
    step(s, IDLE, 0.016, half);
    expect(s.lives).toBe(START_LIVES - 1);
    expect(s.respawn).toBeGreaterThan(0);
    expect(s.events).toContain("playerdown");
    expect(s.weapon).toBe("gun");
    expect(s.weapons).toEqual(["gun"]);
    expect(s.airAmmo).toBe(0);
    expect(s.nukeAmmo).toBe(0);
    expect(s.sprinklerStack).toBe(0);
    expect(s.chainStack).toBe(0);
    expect(s.fireworks.length).toBeGreaterThan(30); // goes out like a firework
  });

  it("losing the last life ends the game", () => {
    const s = freshState();
    s.lives = 1;
    s.ebullets.push({ x: s.player.x, y: groundY(s.h) - 10, vy: 100 });
    step(s, IDLE, 0.016, half);
    expect(s.over).toBe(true);
    expect(s.events).toContain("gameover");
  });
});

describe("missiles", () => {
  it("a click launches a missile toward the target and spends charge", () => {
    const s = freshState();
    s.charge = COST_MISSILE + 200;
    step(s, { ...IDLE, missile: { x: 200, y: 150 } }, 0.016, half);
    expect(s.missiles).toHaveLength(1);
    expect(s.charge).toBeLessThanOrEqual(200 + 1); // ~COST_MISSILE spent (+ tiny regen)
    expect(s.events).toContain("missile");
    expect(s.missiles[0].tx).toBe(200);
    expect(s.missiles[0].ty).toBe(150);
  });

  it("without enough charge the click does nothing", () => {
    const s = freshState();
    s.charge = COST_MISSILE - 10;
    step(s, { ...IDLE, missile: { x: 200, y: 150 } }, 0.016, half);
    expect(s.missiles).toHaveLength(0);
  });

  it("routes sideways through a shield gap instead of through a wall", () => {
    const s = freshState();
    const shield = s.shields[1];
    const overWall = shield.x + 24;
    const gapX = missileControlX(s, overWall);
    expect(Math.abs(gapX - overWall)).toBeGreaterThan(20); // bent toward a gap
    for (const other of s.shields) {
      expect(gapX < other.x - 4 || gapX > other.x + 48 + 4).toBe(true); // in open air
    }
    // Standing under open sky: no bend needed.
    const gapCenter = (s.shields[0].x + 48 + s.shields[1].x) / 2;
    expect(missileControlX(s, gapCenter)).toBe(gapCenter);
  });

  it("glides its spline and detonates at the target", () => {
    const s = freshState();
    s.form.y = -9999; // keep the horde clear of the flight path
    step(s, { ...IDLE, missile: { x: s.player.x + 60, y: 200 } }, 0.016, half);
    let boomed = false;
    for (let t = 0; t < 4 && !boomed; t += 0.02) {
      step(s, IDLE, 0.02, half);
      if (s.blasts.length > 0) boomed = true;
    }
    expect(boomed).toBe(true);
    expect(s.blasts[0].kind).toBe("missile");
    expect(s.blasts[0].x).toBe(s.player.x + 60);
    expect(s.blasts[0].y).toBe(200);
  });

  it("the blast kills invaders within a 5-invader radius and no further", () => {
    const s = freshState();
    const idx = 15 * s.form.cols + 40;
    const at = slotCenter(s.form, idx);
    fullBlast(s, at.x, at.y, MISSILE_BLAST_R, "missile");
    step(s, IDLE, 0.001, lcg(7));
    expect(s.form.alive[idx]).toBe(0);
    expect(s.form.alive[idx - 4]).toBe(0); // 4 invaders left: inside
    expect(s.form.alive[idx - 7]).toBe(1); // 7 invaders left: outside
    expect(s.form.alive[idx + 7 * s.form.cols]).toBe(1); // 7 below: outside
  });
});

describe("chain lightning", () => {
  it("a chain round forks through the horde: ~1 + 4 + 16 + 64 kills", () => {
    const s = freshState();
    const total = s.form.aliveCount;
    const idx = 16 * s.form.cols + 45;
    const at = slotCenter(s.form, idx);
    // Fire a chain bolt straight into the middle of the grid.
    s.bullets.push({
      x: at.x,
      y: at.y + 2,
      vx: 0,
      vy: -540,
      chain: true,
      chainGen: 0,
      chainTarget: -1,
    });
    // Let the whole cascade of forking bolts play out.
    let sawZap = false;
    for (let t = 0; t < 2 && s.bullets.length > 0; t += 0.02) {
      step(s, IDLE, 0.02, lcg(13));
      if (s.events.includes("zap")) sawZap = true;
    }
    expect(sawZap).toBe(true);
    const killed = total - s.form.aliveCount;
    // 1 + 4 + 16 + 64 = 85 is the ceiling; a few forks clip a closer ship than
    // their target in the dense grid, so accept "about 85" without runaway.
    expect(killed).toBeGreaterThanOrEqual(50);
    expect(killed).toBeLessThanOrEqual(1 + 4 + 16 + 64);
    expect(s.bullets).toHaveLength(0); // the cascade fully resolves
  });

  it("a chain fork dies when nothing is within 10 grid squares", () => {
    const s = freshState();
    // Leave a single lone invader with a wide empty moat around it.
    const idx = 16 * s.form.cols + 45;
    s.form.alive.fill(0);
    s.form.aliveCount = 0;
    s.form.colCounts.fill(0);
    s.form.rowCounts.fill(0);
    // Revive just the one.
    s.form.alive[idx] = 1;
    s.form.aliveCount = 1;
    s.form.colCounts[idx % s.form.cols] = 1;
    s.form.rowCounts[(idx / s.form.cols) | 0] = 1;
    const at = slotCenter(s.form, idx);
    s.bullets.push({
      x: at.x,
      y: at.y + 2,
      vx: 0,
      vy: -540,
      chain: true,
      chainGen: 0,
      chainTarget: -1,
    });
    for (let t = 0; t < 0.5; t += 0.02) step(s, IDLE, 0.02, half);
    expect(s.form.aliveCount).toBe(0); // the one it hit
    expect(s.bullets).toHaveLength(0); // no forks spawned — nothing in range
    expect(CHAIN_FANOUT).toBe(4);
    expect(CHAIN_JUMPS).toBe(3);
  });

  it("the chain weapon is unlocked by its pickup and a shot costs its price", () => {
    const s = freshState();
    s.form.y = -9999; // no invaders in the bolt's flight path
    applyPowerup(s, "chain");
    expect(s.weapon).toBe("chain");
    expect(s.weapons).toContain("chain");
    expect(weaponCost("chain")).toBe(COST_CHAIN);
    s.charge = COST_CHAIN + 30;
    step(s, { ...IDLE, fire: true }, 0.016, half);
    expect(s.charge).toBeLessThan(30 + 1); // ~COST_CHAIN drained
    expect(s.bullets.some((b) => b.chain)).toBe(true);
  });

  it("out of charge for the equipped weapon, firing falls back to gun/sprinkler", () => {
    const s = freshState();
    s.form.y = -9999;
    applyPowerup(s, "chain"); // weapons = [gun, chain], no sprinkler
    s.charge = COST_CHAIN - 1; // can't afford chain
    step(s, { ...IDLE, fire: true }, 0.016, half);
    expect(s.weapon).toBe("gun"); // fell back to the pea shooter
    expect(s.bullets.some((b) => !b.chain)).toBe(true);

    // With sprinkler owned it falls back to that instead.
    const s2 = freshState();
    s2.form.y = -9999;
    applyPowerup(s2, "sprinkler");
    applyPowerup(s2, "chain");
    s2.charge = COST_CHAIN - 1;
    step(s2, { ...IDLE, fire: true }, 0.016, half);
    expect(s2.weapon).toBe("sprinkler");
  });

  it("the select key cycles the equipped shooting weapon", () => {
    const s = freshState();
    applyPowerup(s, "sprinkler");
    applyPowerup(s, "chain");
    expect(s.weapons).toEqual(["gun", "sprinkler", "chain"]);
    expect(s.weapon).toBe("chain"); // last collected is equipped
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      seen.add(s.weapon);
      step(s, { ...IDLE, selectWeapon: true }, 0.016, half);
      s.player.cooldown = 0;
    }
    expect(seen).toEqual(new Set(["gun", "sprinkler", "chain"]));
  });
});

describe("sprinkler", () => {
  it("sprays bullets across a sweeping arc no wider than 20 degrees", () => {
    const s = freshState();
    applyPowerup(s, "sprinkler");
    // Park the horde far away so spray bullets live long enough to sample.
    s.form.y = -9999;
    const angles: number[] = [];
    for (let i = 0; i < 40; i++) {
      step(s, { ...IDLE, fire: true }, 0.035, half);
      for (const b of s.bullets) angles.push(Math.atan2(b.vx, -b.vy));
      s.bullets.length = 0;
    }
    expect(angles.length).toBeGreaterThan(10);
    const maxDeg = Math.max(...angles.map((a) => Math.abs((a * 180) / Math.PI)));
    expect(maxDeg).toBeLessThanOrEqual(10.001); // ±10° = a 20° arc
    expect(maxDeg).toBeGreaterThan(4); // and it really does sweep outward
    expect(new Set(angles.map((a) => a.toFixed(3))).size).toBeGreaterThan(5);
  });
});

describe("special weapons", () => {
  it("air support rains a barrage of missiles from above the strike point", () => {
    const s = freshState();
    s.airAmmo = 1;
    s.player.x = 400;
    step(s, { ...IDLE, air: true }, 0.016, lcg(13));
    expect(s.airAmmo).toBe(0);
    expect(s.airMissiles).toHaveLength(AIR_MISSILE_COUNT);
    expect(s.events).toContain("beam");
    // Each falls from above, within ±spread of the strike x, heading down.
    for (const m of s.airMissiles) {
      expect(m.vy).toBeGreaterThan(0);
      expect(Math.abs(m.x - 400)).toBeLessThanOrEqual(AIR_MISSILE_SPREAD + 0.001);
    }
  });

  it("an air-support missile explodes on the invader it hits (half strength)", () => {
    const s = freshState();
    const idx = 20 * s.form.cols + 40;
    const at = slotCenter(s.form, idx);
    // Drop one missile right onto an invader.
    s.airMissiles.push({ x: at.x, y: at.y - 1, vy: AIR_MISSILE_SPEED });
    step(s, IDLE, 0.02, lcg(3));
    expect(s.airMissiles).toHaveLength(0);
    expect(s.blasts.some((b) => b.maxR === AIR_MISSILE_BLAST_R)).toBe(true);
    expect(s.events).toContain("boom");
  });

  it("an air-support missile that lands on the ship kills it", () => {
    const s = freshState();
    s.form.y = -9999; // no invaders in the way
    s.player.invuln = 0;
    const ground = groundY(s.h);
    s.airMissiles.push({ x: s.player.x, y: ground - 10, vy: AIR_MISSILE_SPEED });
    step(s, IDLE, 0.02, lcg(3));
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it("the ground nuke sits on the ground during countdown, then blasts at ground level and the visual rises", () => {
    const s = freshState();
    s.nukeAmmo = 1;
    s.player.invuln = 9999; // don't blow ourselves up in this check
    const ground = groundY(s.h);
    step(s, { ...IDLE, nuke: true }, 0.016, half);
    expect(s.nukeAmmo).toBe(0);
    expect(s.fuses).toHaveLength(1);
    const startY = s.fuses[0].y;
    step(s, IDLE, 0.1, half);
    expect(s.fuses[0].y).toBe(startY); // stays on the ground during countdown
    let sawNuke = false;
    for (let t = 0; t < NUKE_FUSE + 0.1; t += 0.05) {
      step(s, IDLE, 0.05, half);
      if (s.events.includes("nuke")) sawNuke = true;
    }
    // After detonation the blasted fuse visual rises; it's still on-screen briefly.
    expect(s.fuses.every((f) => f.blasted)).toBe(true);
    const nukeBlast = s.blasts.find((b) => b.kind === "nuke");
    expect(nukeBlast?.maxR).toBe(NUKE_BLAST_R);
    expect(nukeBlast!.y).toBeGreaterThanOrEqual(ground - 10); // detonated at ground level
    expect(sawNuke).toBe(true);
    expect(s.lavas.length).toBeGreaterThan(0); // molten ground left at the launch x
    void ground;
  });

  it("each nuke stack doubles the blast area (radius × √2)", () => {
    const nuke = (stack: number): number => {
      const s = freshState();
      s.player.invuln = 9999;
      s.nukeStack = stack;
      s.fuses.push({ x: s.player.x, y: groundY(s.h) - 4, fuse: 0.001 });
      step(s, IDLE, 0.05, half);
      return s.blasts[0].maxR;
    };
    expect(nuke(0)).toBeCloseTo(NUKE_BLAST_R, 2);
    expect(nuke(2)).toBeCloseTo(NUKE_BLAST_R * 2, 1);
  });

  it("a nuke razes shields and kills the player inside its plasma", () => {
    const s = freshState();
    const shield = s.shields[0];
    s.player.x = shield.x + 24; // stand right over a shield wall
    s.player.invuln = 0;
    const solidBefore = shield.cells.reduce((n, c) => n + c, 0);
    s.fuses.push({ x: s.player.x, y: groundY(s.h) - 4, fuse: 0.001 });
    for (let t = 0; t < 1; t += 0.05) step(s, IDLE, 0.05, half);
    const solidAfter = shield.cells.reduce((n, c) => n + c, 0);
    expect(solidAfter).toBeLessThan(solidBefore); // shield wall torn open
    expect(s.lives).toBe(START_LIVES - 1); // the ship caught the plasma
  });

  it("molten ground stays deadly to the ship while hot, then cools", () => {
    const s = freshState();
    const ground = groundY(s.h);
    s.player.x = 400;
    s.player.invuln = 0;
    s.lavas.push({ x: 400, halfW: 40, age: 0, ttl: LAVA_TTL });
    step(s, IDLE, 0.016, half);
    expect(s.lives).toBe(START_LIVES - 1); // stepped onto hot lava
    // After it cools away it is harmless.
    s.lavas.length = 0;
    s.player.invuln = 0;
    s.respawn = 0;
    s.lives = START_LIVES;
    s.player.x = 400;
    step(s, IDLE, 0.016, half);
    expect(s.lives).toBe(START_LIVES);
    void ground;
  });

  it("a nuke blast clears flyers and enemy fire inside its radius", () => {
    const s = freshState();
    const ground = groundY(s.h);
    const cx = s.player.x;
    s.flyers.push({
      mode: "dive",
      slot: 0,
      type: 0,
      x: cx,
      y: ground - 70,
      path: [cx, ground - 70, cx, ground - 70],
      offx: 0,
      offy: 0,
      t: 0,
      dur: 9999,
      fireCooldown: 9999,
      wob: 0,
      squad: -1,
    });
    s.player.invuln = 9999; // ignore the ship for this radius check
    s.ebullets.push({ x: cx + 50, y: ground - 60, vy: 0 });
    // Far outside the radius and clear of any shield wall.
    s.ebullets.push({ x: cx - NUKE_BLAST_R - 60, y: ground - 60, vy: 0 });
    fullBlast(s, cx, ground - 4, NUKE_BLAST_R, "nuke");
    step(s, IDLE, 0.001, lcg(17));
    expect(s.flyers).toHaveLength(0);
    expect(s.ebullets).toHaveLength(1); // only the far one survives
  });
});

describe("charge", () => {
  it("collected grains refill the shared charge pool", () => {
    const s = freshState();
    s.charge = 100;
    const sc = s.scrap;
    sc.x[0] = s.player.x;
    sc.y[0] = groundY(s.h) - 8;
    sc.vx[0] = 0;
    sc.vy[0] = 0;
    sc.ttl[0] = 5;
    sc.seed[0] = 0.5;
    sc.count = 1;
    step(s, IDLE, 0.016, half);
    expect(sc.count).toBe(0);
    expect(s.charge).toBeGreaterThanOrEqual(100 + CHARGE_PER_SCRAP);
    expect(s.events).toContain("pickup");
  });

  it("charge trickles up over time and each pea shot costs its price", () => {
    const s = freshState();
    s.charge = 500;
    step(s, IDLE, 1, half); // one second of idle regen
    expect(s.charge).toBeCloseTo(500 + CHARGE_REGEN, 5);
    const before = s.charge;
    step(s, { ...IDLE, fire: true }, 0.001, half);
    expect(s.bullets).toHaveLength(1);
    expect(before - s.charge).toBeCloseTo(COST_BULLET - CHARGE_REGEN * 0.001, 3);
  });

  it("a scrap grain lands and then lingers ~20s on the ground before fading", () => {
    const s = freshState();
    s.player.x = 50; // far from the grain so it's never collected
    const sc = s.scrap;
    sc.x[0] = 600;
    sc.y[0] = groundY(s.h) - 2;
    sc.vx[0] = 0;
    sc.vy[0] = 40; // falling; lands almost immediately
    sc.ttl[0] = 3; // little air-life left…
    sc.seed[0] = 0.5;
    sc.count = 1;
    step(s, IDLE, 0.05, half); // lands → gets a fresh SCRAP_GROUND_TTL to sit
    expect(sc.ttl[0]).toBeGreaterThan(3); // refreshed past its old air-life
    expect(sc.ttl[0]).toBeLessThanOrEqual(SCRAP_GROUND_TTL);
    // Still sitting there a good 15s later…
    for (let t = 0; t < 15; t += 0.05) step(s, IDLE, 0.05, half);
    expect(sc.count).toBe(1);
    // …and finally gone once the 20s ground life runs out.
    for (let t = 0; t < 6; t += 0.05) step(s, IDLE, 0.05, half);
    expect(sc.count).toBe(0);
  });
});

describe("powerups", () => {
  it("falling pickups are caught by the ship and applied", () => {
    const s = freshState();
    s.pickups.push({ x: s.player.x, y: groundY(s.h) - 10, vy: 0, groundTtl: 4, kind: "life" });
    step(s, IDLE, 0.016, half);
    expect(s.pickups).toHaveLength(0);
    expect(s.lives).toBe(START_LIVES + 1);
    expect(s.events).toContain("powerup");
    // The catch is announced with a rising floater near the player.
    expect(s.floaters).toHaveLength(1);
    expect(s.floaters[0].kind).toBe("life");
  });

  it("pickups fall under gravity, land, wait a few seconds, then fade", () => {
    const s = freshState();
    const ground = groundY(s.h);
    s.pickups.push({ x: 100, y: ground - 40, vy: 0, groundTtl: 4, kind: "nuke" });
    // Falls with accelerating speed…
    step(s, IDLE, 0.1, half);
    const v1 = s.pickups[0].vy;
    step(s, IDLE, 0.1, half);
    expect(s.pickups[0].vy).toBeGreaterThan(v1);
    // …lands and sits on the ground…
    for (let t = 0; t < 3; t += 0.1) step(s, IDLE, 0.1, half);
    expect(s.pickups[0].y).toBe(ground - 6);
    // …then fades away un-grabbed.
    for (let t = 0; t < 5; t += 0.1) step(s, IDLE, 0.1, half);
    expect(s.pickups).toHaveLength(0);
  });

  it("every ~20s a bonus powerup drifts in from a screen edge with a chime", () => {
    const s = freshState();
    expect(s.edgePowerupTimer).toBe(EDGE_POWERUP_GAP);
    s.edgePowerupTimer = 0.001; // about to fire
    step(s, IDLE, 0.016, lcg(5));
    expect(s.pickups).toHaveLength(1);
    // It enters hugging the left or right edge of the screen.
    const px = s.pickups[0].x;
    expect(px < 20 || px > s.w - 20).toBe(true);
    expect(s.events).toContain("reload"); // the little announcing chime
    // The timer rewinds to roughly another full gap.
    expect(s.edgePowerupTimer).toBeGreaterThan(EDGE_POWERUP_GAP * 0.8);
  });

  it("battered shield walls occasionally shake a powerup loose", () => {
    const s = freshState();
    const shield = s.shields[0];
    const alwaysDrop = () => 0; // rng 0 < SHIELD_DROP_CHANCE, and picks the first kind
    s.bullets.push({
      x: shield.x + 24,
      y: shield.y + 20,
      vx: 0,
      vy: -540,
      chain: false,
      chainGen: 0,
      chainTarget: -1,
    });
    step(s, IDLE, 0.016, alwaysDrop);
    expect(s.pickups.length).toBeGreaterThanOrEqual(1);
  });

  it("each powerup kind applies its effect", () => {
    const s = freshState();
    s.airAmmo = 0; // spend the starter ammo so the grant is unambiguous
    s.nukeAmmo = 0;
    applyPowerup(s, "air");
    expect(s.airAmmo).toBe(1);
    expect(s.airStack).toBe(1); // air stacks (wider beam)
    applyPowerup(s, "nuke");
    expect(s.nukeAmmo).toBe(1);
    applyPowerup(s, "sprinkler");
    expect(s.weapon).toBe("sprinkler");
    expect(s.weapons).toContain("sprinkler");
    applyPowerup(s, "sprinkler");
    expect(s.sprinklerStack).toBe(1); // second one stacks the fire rate
  });

  it("the missile pickup stacks blast area (missiles come from charge, not it)", () => {
    const s = freshState();
    applyPowerup(s, "missiles");
    expect(s.missileStack).toBe(1);
    expect(s.events).toContain("stackup");
  });

  it("the wall powerup rebuilds every shield to full", () => {
    const s = freshState();
    // Blow big holes in all the shields.
    for (const shield of s.shields) {
      shield.cells.fill(0);
      shield.dirty = false;
    }
    const solid = () => s.shields.reduce((n, sh) => n + sh.cells.reduce((a, c) => a + c, 0), 0);
    expect(solid()).toBe(0);
    applyPowerup(s, "wall");
    expect(solid()).toBeGreaterThan(0); // walls restored
    expect(s.shields.every((sh) => sh.dirty)).toBe(true); // renderer repaints them
    expect(s.events).toContain("powerup");
  });

  it("stackable powerups deepen/enlarge up to +3, then just top up", () => {
    for (const kind of ["chain", "missiles", "nuke"] as const) {
      const s = freshState();
      if (kind === "chain") applyPowerup(s, "chain"); // first arms the weapon
      const stackOf = () =>
        kind === "chain" ? s.chainStack : kind === "missiles" ? s.missileStack : s.nukeStack;
      for (let i = 1; i <= 3; i++) {
        s.events.length = 0;
        applyPowerup(s, kind);
        expect(stackOf()).toBe(i);
        expect(s.events).toContain("stackup");
      }
      // Capped at +3 — a 4th just chimes as an ordinary pickup.
      s.events.length = 0;
      applyPowerup(s, kind);
      expect(stackOf()).toBe(3);
      expect(s.events).toContain("powerup");
      expect(s.events).not.toContain("stackup");
    }
  });

  it("each missile stack doubles the blast area (radius × √2)", () => {
    const detonate = (stack: number): number => {
      const s = freshState();
      s.missileStack = stack;
      step(s, { ...IDLE, missile: { x: s.player.x + 40, y: 220 } }, 0.016, half);
      for (let t = 0; t < 4 && s.blasts.length === 0; t += 0.02) step(s, IDLE, 0.02, half);
      return s.blasts[0].maxR;
    };
    const r0 = detonate(0);
    const r2 = detonate(2);
    expect(r0).toBeCloseTo(MISSILE_BLAST_R, 3);
    // +2 stacks = ×4 area = ×2 radius.
    expect(r2).toBeCloseTo(MISSILE_BLAST_R * 2, 2);
  });

  it("a chain stack adds a generation, deepening the cascade", () => {
    const killsWith = (stack: number): number => {
      const s = freshState();
      s.chainStack = stack;
      const total = s.form.aliveCount;
      const idx = 16 * s.form.cols + 45;
      const at = slotCenter(s.form, idx);
      s.bullets.push({
        x: at.x,
        y: at.y + 2,
        vx: 0,
        vy: -540,
        chain: true,
        chainGen: 0,
        chainTarget: -1,
      });
      for (let t = 0; t < 3 && s.bullets.length > 0; t += 0.02) step(s, IDLE, 0.02, lcg(13));
      return total - s.form.aliveCount;
    };
    expect(killsWith(1)).toBeGreaterThan(killsWith(0));
  });
});

describe("UFOs", () => {
  it("appears on a timer and announces itself — but never two at once", () => {
    const s = freshState();
    s.ufoTimer = 0.001;
    step(s, IDLE, 0.01, lcg(19));
    expect(s.ufos).toHaveLength(1);
    expect(s.events).toContain("ufo");
    // The timer can't summon a second while one is still crossing.
    s.ufoTimer = 0.001;
    step(s, IDLE, 0.01, lcg(19));
    expect(s.ufos).toHaveLength(1);
  });

  it("fires its laser straight down, reaching the ground after ~2 seconds", () => {
    const s = freshState();
    s.ufos.push({ x: s.player.x, y: 24, vx: 0, charge: 0.01, laser: 0, gunCooldown: 9 });
    step(s, IDLE, 0.02, half);
    expect(s.ufos[0].laser).toBeGreaterThan(0);
    expect(s.events).toContain("laser");
    // A full second in, the beam is only partway down — the player is safe.
    for (let t = 0; t < 1; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.lives).toBe(START_LIVES);
    // Once it crawls the rest of the way to the ground it finally connects.
    for (let t = 0; t < 1.5; t += 0.05) step(s, IDLE, 0.05, half);
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it("shooting a UFO scores big and always drops a powerup", () => {
    const s = freshState();
    s.form.y = -9999; // horde out of the bullet's way
    s.ufos.push({ x: 400, y: 24, vx: 0, charge: 0, laser: 0, gunCooldown: 9 });
    s.bullets.push({ x: 400, y: 28, vx: 0, vy: -540, chain: false, chainGen: 0, chainTarget: -1 });
    step(s, IDLE, 0.001, lcg(23));
    expect(s.ufos).toHaveLength(0);
    expect(s.score).toBe(UFO_SCORE);
    expect(s.pickups).toHaveLength(1);
    expect(s.ufoDefeated).toBe(true);
  });

  it("a missile blast kills a UFO (blasts reach UFOs)", () => {
    const s = freshState();
    s.form.y = -9999;
    s.ufos.push({ x: 400, y: 24, vx: 0, charge: 0, laser: 0, gunCooldown: 9 });
    // A completed missile blast right on the UFO.
    fullBlast(s, 400, 24, MISSILE_BLAST_R, "missile");
    step(s, IDLE, 0.001, lcg(23));
    expect(s.ufos).toHaveLength(0);
    expect(s.score).toBe(UFO_SCORE);
    expect(s.ufoDefeated).toBe(true);
  });

  it("a destroyed UFO does not come back until the next level", () => {
    const s = freshState();
    s.form.y = -9999;
    s.ufos.push({ x: 400, y: 24, vx: 0, charge: 0, laser: 0, gunCooldown: 9 });
    s.bullets.push({ x: 400, y: 28, vx: 0, vy: -540, chain: false, chainGen: 0, chainTarget: -1 });
    step(s, IDLE, 0.001, lcg(23));
    expect(s.ufoDefeated).toBe(true);
    // The timer keeps trying, but no UFO returns this level.
    for (let t = 0; t < 60; t += 0.1) {
      s.ufoTimer = 0.001;
      step(s, IDLE, 0.1, lcg(24));
    }
    expect(s.ufos).toHaveLength(0);
    // Clearing the level resets it: the next level can field a UFO again.
    s.form.y = 42;
    s.form.alive.fill(0);
    s.form.aliveCount = 0;
    s.form.colCounts.fill(0);
    s.form.rowCounts.fill(0);
    step(s, IDLE, 0.016, lcg(25));
    expect(s.ufoDefeated).toBe(false);
  });
});

describe("dive squadrons", () => {
  it("detaches a squadron of 10-15 that swoops on a spline and fires every 2-5s", () => {
    const s = freshState();
    s.flyerTimer = 0.001;
    const before = s.form.aliveCount;
    step(s, IDLE, 0.01, lcg(29));
    const squad = s.flyers.filter((f) => f.mode === "dive");
    expect(squad.length).toBeGreaterThanOrEqual(SQUAD_MIN);
    expect(squad.length).toBeLessThanOrEqual(SQUAD_MAX);
    expect(s.form.aliveCount).toBe(before - squad.length);
    for (const f of squad) {
      expect(f.fireCooldown).toBeGreaterThanOrEqual(FLYER_FIRE_MIN);
      expect(f.fireCooldown).toBeLessThanOrEqual(FLYER_FIRE_MAX);
    }
  });

  it("never swoops below 10px above the shield tops, and shoots on the way", () => {
    const s = freshState();
    s.lives = 99;
    s.player.invuln = 9999;
    s.flyerTimer = 0.001;
    step(s, IDLE, 0.01, lcg(31));
    const floor = swoopFloorY(s.h);
    let maxY = -Infinity;
    let shots = 0;
    for (let t = 0; t < 6; t += 0.05) {
      step(s, IDLE, 0.05, lcg(37));
      for (const f of s.flyers) maxY = Math.max(maxY, f.y);
      shots = Math.max(shots, s.ebullets.length);
    }
    expect(maxY).toBeLessThanOrEqual(floor + 0.001);
    expect(shots).toBeGreaterThan(0);
  });

  it("swoopers hold their fire up high and only shoot once they're low", () => {
    const floor = swoopFloorY(600);
    const diver = (y: number) => ({
      mode: "dive" as const,
      slot: 0,
      type: 2,
      x: 400,
      y,
      path: [400, y, 400, y, 400, y], // a flat path pins it at height y
      offx: 0,
      offy: 0,
      t: 0.5, // airborne (u > 0) but nowhere near the end of the dive
      dur: 100,
      fireCooldown: -1, // trigger is ready
      wob: 0,
      squad: -1,
    });
    // Well above the low band: ready to fire, but holds.
    const high = freshState();
    high.flyers = [diver(floor - FLYER_LOW_BAND - 30)];
    step(high, IDLE, 0.016, half);
    expect(high.ebullets).toHaveLength(0);
    // Down at the swoop floor: now it opens up.
    const low = freshState();
    low.flyers = [diver(floor)];
    step(low, IDLE, 0.016, half);
    expect(low.ebullets).toHaveLength(1);
  });

  it("survivors glide back into their own slots", () => {
    const s = freshState();
    s.lives = 99;
    s.player.invuln = 9999;
    s.flyerTimer = 0.001;
    step(s, IDLE, 0.01, lcg(41));
    const slots = s.flyers.map((f) => f.slot);
    expect(slots.length).toBeGreaterThan(0);
    for (const idx of slots) expect(s.form.alive[idx]).toBe(0);
    // Ride out the full dive + return; nothing shoots them down here and no
    // fresh squadrons launch.
    s.flyerTimer = 9999;
    s.eShotTimer = 9999;
    for (let t = 0; t < 20 && s.flyers.length > 0; t += 0.05) step(s, IDLE, 0.05, lcg(43));
    expect(s.flyers).toHaveLength(0);
    for (const idx of slots) expect(s.form.alive[idx]).toBe(1);
  });
});

describe("tiers & squadrons", () => {
  /** Empty the grid and revive one invader in the given row/col. */
  function loneInvader(s: GameState, row: number, col: number): void {
    s.form.alive.fill(0);
    s.form.aliveCount = 0;
    s.form.colCounts.fill(0);
    s.form.rowCounts.fill(0);
    const idx = row * s.form.cols + col;
    s.form.alive[idx] = 1;
    s.form.aliveCount = 1;
    s.form.colCounts[col] = 1;
    s.form.rowCounts[row] = 1;
    s.form.minCol = col;
    s.form.maxCol = col;
    s.form.maxRow = row;
  }

  it("soldiers fire ~3× as often as other tiers (single bullets, no burst)", () => {
    // Two adjacent columns: a soldier-tier bottom in one, a grunt-tier in the
    // other. Over many fire ticks the soldier column should shoot ~3× more.
    const s = freshState();
    s.form.alive.fill(0);
    s.form.aliveCount = 0;
    s.form.colCounts.fill(0);
    s.form.rowCounts.fill(0);
    const soldierRow = Math.floor(s.form.rows * 0.35);
    const gruntRow = s.form.rows - 1;
    const soldierCol = 20;
    const gruntCol = 21;
    const revive = (row: number, col: number) => {
      s.form.alive[row * s.form.cols + col] = 1;
      s.form.aliveCount++;
      s.form.colCounts[col]++;
      s.form.rowCounts[row]++;
    };
    revive(soldierRow, soldierCol);
    revive(gruntRow, gruntCol);
    s.form.minCol = soldierCol;
    s.form.maxCol = gruntCol;
    s.form.maxRow = gruntRow;

    let soldierShots = 0;
    let gruntShots = 0;
    const rng = lcg(7);
    for (let i = 0; i < 900; i++) {
      s.eShotTimer = 0.0001;
      s.ebullets.length = 0;
      step(s, IDLE, 0.001, rng);
      expect(s.ebullets.length).toBeLessThanOrEqual(1); // one bullet per tick, never a burst
      for (const e of s.ebullets) {
        // Column from the live (marching) formation origin.
        const col = Math.round((e.x - SPACING / 2 - s.form.x) / SPACING);
        if (col === soldierCol) soldierShots++;
        else if (col === gruntCol) gruntShots++;
      }
    }
    expect(gruntShots).toBeGreaterThan(0);
    expect(soldierShots).toBeGreaterThan(gruntShots * 2); // ≈ 3× as often
  });

  it("only elite ships fly low in dive squadrons", () => {
    const s = freshState();
    s.flyerTimer = 0.001;
    step(s, IDLE, 0.01, lcg(29));
    const dives = s.flyers.filter((f) => f.mode === "dive");
    expect(dives.length).toBeGreaterThan(0);
    for (const f of dives) expect(f.type).toBe(2); // elite tier only
    // They share a squad id.
    expect(new Set(dives.map((f) => f.squad)).size).toBe(1);
    expect(dives[0].squad).toBeGreaterThanOrEqual(0);
  });

  it("wiping out an entire squadron pays a 1000 bonus with a banner", () => {
    const s = freshState();
    s.player.invuln = 9999;
    s.flyerTimer = 0.001;
    step(s, IDLE, 0.01, lcg(31));
    const squadSize = s.flyers.filter((f) => f.mode === "dive").length;
    expect(squadSize).toBeGreaterThan(0);
    const scoreBefore = s.score;
    // Vaporize the whole screen — every squad member dies before returning.
    fullBlast(s, s.w / 2, s.h / 2, s.w, "missile");
    step(s, IDLE, 0.001, lcg(31));
    expect(s.flyers.filter((f) => f.mode === "dive")).toHaveLength(0);
    expect(s.score).toBeGreaterThanOrEqual(scoreBefore + squadSize * 50 + 1000);
    expect(s.banners.some((b) => b.text.includes("1000"))).toBe(true);
  });
});

describe("levels", () => {
  it("clearing the horde starts the next level with a fresh fly-in", () => {
    const s = freshState();
    s.form.alive.fill(0);
    s.form.aliveCount = 0;
    s.form.colCounts.fill(0);
    s.form.rowCounts.fill(0);
    step(s, IDLE, 0.016, lcg(9));
    expect(s.level).toBe(2);
    expect(s.form.aliveCount).toBe(0); // the new horde flies in from scratch
    expect(s.introQueue.length).toBeGreaterThan(0);
    expect(s.introLaunched).toBe(0);
    expect(s.events).toContain("levelup");
  });

  it("bullet hit-testing lines up with slot centers", () => {
    const s = freshState();
    const idx = 10 * s.form.cols + 10;
    const at = slotCenter(s.form, idx);
    expect(hitSlotAt(s.form, at.x, at.y)).toBe(idx);
    expect(hitSlotAt(s.form, at.x, at.y - SPACING)).not.toBe(idx);
  });
});
