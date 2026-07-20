import { LevelConfig, DEFAULT_LEVEL_CONFIG } from "./roboTronLogic";
import levelsCsv from "./assets/levels.csv?raw";

// Level population/tuning table. The numbers are authored by hand in the
// spreadsheet at assets/levels.csv — one row per level, one column per entity
// population (counts are PER GRID SQUARE) plus the electrode type and the
// per-frame enemy move chance. Edit the CSV to retune; this module just parses
// it. Vite bundles the file as a raw string via the `?raw` import.
//
// Columns (header row, order-independent — parsed by name):
//   Level, Moms, Dads, Mikeys, Sallys, Grunts, Hulks, Brains, Spheroids,
//   Enforcers, ElectrodeType, Electrodes, Tanks, EnemyMoveChance, Smartness

/** Parse the CSV text into an ordered list of per-level configs (index 0 = level 1). */
export function parseLevels(csv: string): LevelConfig[] {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const cols = {
    moms: idx("Moms"),
    dads: idx("Dads"),
    mikeys: idx("Mikeys"),
    sallys: idx("Sallys"),
    grunts: idx("Grunts"),
    hulks: idx("Hulks"),
    brains: idx("Brains"),
    spheroids: idx("Spheroids"),
    enforcers: idx("Enforcers"),
    electrodeType: idx("ElectrodeType"),
    electrodes: idx("Electrodes"),
    tanks: idx("Tanks"),
    enemyMoveChance: idx("EnemyMoveChance"),
    smartness: idx("Smartness"),
  };

  const num = (fields: string[], i: number): number => {
    if (i < 0) return 0;
    const v = Number(fields[i]);
    return Number.isFinite(v) ? v : 0;
  };

  const rows: LevelConfig[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",").map((s) => s.trim());
    rows.push({
      moms: num(f, cols.moms),
      dads: num(f, cols.dads),
      mikeys: num(f, cols.mikeys),
      sallys: num(f, cols.sallys),
      grunts: num(f, cols.grunts),
      hulks: num(f, cols.hulks),
      brains: num(f, cols.brains),
      spheroids: num(f, cols.spheroids),
      enforcers: num(f, cols.enforcers),
      electrodeType: num(f, cols.electrodeType),
      electrodes: num(f, cols.electrodes),
      tanks: num(f, cols.tanks),
      enemyMoveChance: num(f, cols.enemyMoveChance),
      // Missing/blank Smartness defaults to 1 (never uses teleports).
      smartness: num(f, cols.smartness) || 1,
    });
  }
  return rows;
}

const LEVELS = parseLevels(levelsCsv);

/**
 * The config for a given 1-based level. Levels past the end of the table reuse
 * the last row (so the game keeps going with the hardest defined wave); an empty
 * table falls back to DEFAULT_LEVEL_CONFIG.
 */
export function getLevelConfig(level: number): LevelConfig {
  if (LEVELS.length === 0) return DEFAULT_LEVEL_CONFIG;
  const i = Math.min(Math.max(1, Math.floor(level)), LEVELS.length) - 1;
  return LEVELS[i];
}
