import sheetUrl from "./assets/sprites/sprite sheet.png";
import type { Facing, FamilyType, EnemyKind } from "./roboTronLogic";

// Sprite sheet decoding for Big Robo Tiny Tron.
//
// The sheet (assets/sprites/sprite sheet.png) is a 16x24 grid of 16x16 sprites
// with built-in transparency. Layout (documented by the sheet's author):
//
//   Rows 0-7  — walking characters, 12 frames each in columns 0-11, grouped by
//               facing: left {still,step1,step2}, right {…}, down {…}, up {…}.
//               Row order: Robo(player), Mom, Dad, Mike, Sally, Grunt, Hulk, Brain.
//   Rows 13-14 — electrodes, four groups of three per row (types 0-3 on row 13,
//                types 4-7 on row 14). Each group: {normal, shrink1, shrink2}.
//
// Reskin by editing the PNG; nothing here is generated.

/** Native pixel size of one sprite cell on the sheet. */
export const SPRITE = 16;

/** Sheet row index for each walking character. */
export const CHARACTER_ROW = {
  robo: 0,
  mom: 1,
  dad: 2,
  mike: 3,
  sally: 4,
  grunt: 5,
  hulk: 6,
  brain: 7,
} as const;

/** Column offset of the first frame for each facing within a character's row. */
const FACING_BASE: Record<Facing, number> = {
  left: 0,
  right: 3,
  down: 6,
  up: 9,
};

/** Enemy kinds that have a walking sprite on the sheet (others fall back to shapes). */
const ENEMY_ROW: Partial<Record<EnemyKind, number>> = {
  grunt: CHARACTER_ROW.grunt,
  hulk: CHARACTER_ROW.hulk,
  brain: CHARACTER_ROW.brain,
};

export interface SrcRect {
  sx: number;
  sy: number;
  s: number;
}

/**
 * Pick the animation column for a walking character. Each facing has a 3-frame
 * cycle on the sheet ({still, step1, step2}); while moving we loop through all
 * three (phase % 3), and show the "still" frame when stopped.
 */
function walkColumn(facing: Facing, moving: boolean, phase: number): number {
  const base = FACING_BASE[facing];
  if (!moving) return base; // still
  return base + (((phase % 3) + 3) % 3); // loop still → step1 → step2
}

/** Source rect for a character row (walking) at the given facing/animation. */
export function characterRect(
  row: number,
  facing: Facing,
  moving: boolean,
  phase: number,
): SrcRect {
  return { sx: walkColumn(facing, moving, phase) * SPRITE, sy: row * SPRITE, s: SPRITE };
}

/** Source rect for the player (Robo). */
export function playerRect(facing: Facing, moving: boolean, phase: number): SrcRect {
  return characterRect(CHARACTER_ROW.robo, facing, moving, phase);
}

/** Source rect for a family member. */
export function familyRect(
  type: FamilyType,
  facing: Facing,
  moving: boolean,
  phase: number,
): SrcRect {
  return characterRect(CHARACTER_ROW[type], facing, moving, phase);
}

/** Source rect for an enemy that has a sprite, or null if it has no art yet. */
export function enemyRect(
  kind: EnemyKind,
  facing: Facing,
  moving: boolean,
  phase: number,
): SrcRect | null {
  const row = ENEMY_ROW[kind];
  if (row === undefined) return null;
  return characterRect(row, facing, moving, phase);
}

/**
 * Source rect for an electrode of the given type (0-7) at the given shrink
 * frame (0 = intact, 1/2 = shrinking). Types 0-3 live on row 13, 4-7 on row 14;
 * each occupies a 3-column group.
 */
export function electrodeRect(type: number, shrink: number): SrcRect {
  const t = ((type % 8) + 8) % 8;
  const row = 13 + Math.floor(t / 4);
  const groupCol = (t % 4) * 3;
  const frame = Math.max(0, Math.min(2, shrink));
  return { sx: (groupCol + frame) * SPRITE, sy: row * SPRITE, s: SPRITE };
}

/** Load the sprite sheet image; resolves once it has decoded. */
export function loadSpriteSheet(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = sheetUrl;
  });
}
