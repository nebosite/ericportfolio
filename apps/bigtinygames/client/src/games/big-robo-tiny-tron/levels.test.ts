import { describe, it, expect } from "vitest";
import { parseLevels } from "./levels";

// The parser reads the hand-authored assets/levels.csv spreadsheet. These tests
// exercise it against inline CSV text so they don't depend on the shipped file.

const SAMPLE = [
  "Level,Moms,Dads,Mikeys,Sallys,Grunts,Hulks,Brains,Spheroids,Enforcers,ElectrodeType,Electrodes,Tanks,EnemyMoveChance",
  "1,1,1,0,0,10,0,0,0,0,0,4,0,0.05",
  "2,1,1,1,0,12,1,0,0,1,2,5,0,0.07",
].join("\n");

describe("parseLevels", () => {
  it("parses the level-1 row into the documented populations", () => {
    const rows = parseLevels(SAMPLE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      moms: 1,
      dads: 1,
      mikeys: 0,
      sallys: 0,
      grunts: 10,
      hulks: 0,
      brains: 0,
      spheroids: 0,
      enforcers: 0,
      electrodeType: 0,
      electrodes: 4,
      tanks: 0,
      enemyMoveChance: 0.05,
      smartness: 1, // absent Smartness column defaults to 1
    });
  });

  it("parses the Smartness column when present", () => {
    const withSmarts = [
      "Level,Grunts,EnemyMoveChance,Smartness",
      "1,10,0.05,1",
      "2,12,0.07,3",
    ].join("\n");
    const rows = parseLevels(withSmarts);
    expect(rows[0].smartness).toBe(1);
    expect(rows[1].smartness).toBe(3);
  });

  it("maps columns by header name, not position", () => {
    const reordered = [
      "EnemyMoveChance,Grunts,Moms,Dads,Mikeys,Sallys,Hulks,Brains,Spheroids,Enforcers,ElectrodeType,Electrodes,Tanks",
      "0.09,7,2,3,0,0,0,0,0,0,5,6,0",
    ].join("\n");
    const [row] = parseLevels(reordered);
    expect(row.grunts).toBe(7);
    expect(row.moms).toBe(2);
    expect(row.dads).toBe(3);
    expect(row.electrodes).toBe(6);
    expect(row.electrodeType).toBe(5);
    expect(row.enemyMoveChance).toBeCloseTo(0.09);
  });

  it("tolerates blank lines and returns empty for a header-only file", () => {
    expect(parseLevels("")).toHaveLength(0);
    expect(parseLevels("Level,Grunts\n")).toHaveLength(0);
    const withBlanks = parseLevels(`${SAMPLE}\n\n`);
    expect(withBlanks).toHaveLength(2);
  });
});
