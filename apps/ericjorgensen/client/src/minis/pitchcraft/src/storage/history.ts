// history.ts — IndexedDB persistence for sessions/stats + server high-score stub.

import { Garden, emptyGarden, migrateKind } from "../game/voiceGarden";

/** Per-note cents running sums stored on a session, for the recent pitch graph. */
export interface NoteCents {
  cN: number;
  cSum: number;
  cSqSum: number;
}

export interface SessionRecord {
  id?: number;
  ts: number; // Date.now()
  d: string; // YYYY-MM-DD
  score: number;
  accuracy: number; // 0..100
  voice: string;
  level: number;
  // Per-note cents sums for this session, keyed by MIDI (absent on old records).
  notes?: Record<string, NoteCents>;
}

export interface NoteStat {
  n: number;
  rSum: number;
  best: number;
  pts: number;
  // Cents-off running sums (count, Σcents, Σcents²) for the pitch graph's
  // per-note mean/std. Optional so older saved stats stay valid.
  cN?: number;
  cSum?: number;
  cSqSum?: number;
}

export interface Stats {
  sessions: number;
  best: number; // overall best (any voice/level), kept for back-compat
  bests: Record<string, number>; // best per `${voiceId}:${level}`
  streak: number;
  lastDate: string | null;
  notes: Record<string, NoteStat>; // keyed by MIDI number → mastery = rSum/n
  prefs: { voiceId: string; difficulty: number } | null;
}

export const DEFAULT_STATS: Stats = {
  sessions: 0,
  best: 0,
  bests: {},
  streak: 0,
  lastDate: null,
  notes: {},
  prefs: null,
};

/** Key for a high score scoped to a specific voice type and level. */
export function bestKey(voiceId: string, level: number): string {
  return `${voiceId}:${level}`;
}

/** Best score recorded for a given voice + level (0 if none yet). */
export function bestFor(stats: Stats, voiceId: string, level: number): number {
  return (stats.bests && stats.bests[bestKey(voiceId, level)]) || 0;
}

/** Aggregate per-note cents sums across the most recent `n` sessions for a given
 *  voice + level that carry note data — the source for the home-screen pitch graph. */
export function recentNoteStats(
  history: SessionRecord[],
  voice: string,
  level: number,
  n = 10,
): Record<string, NoteCents> {
  const out: Record<string, NoteCents> = {};
  const recent = history.filter((r) => r.notes && r.voice === voice && r.level === level).slice(-n);
  for (const rec of recent) {
    const notes = rec.notes!;
    for (const m in notes) {
      const s = notes[m];
      const o = out[m] || (out[m] = { cN: 0, cSum: 0, cSqSum: 0 });
      o.cN += s.cN || 0;
      o.cSum += s.cSum || 0;
      o.cSqSum += s.cSqSum || 0;
    }
  }
  return out;
}

/** Sessions for a given voice + level within the last `maxDays`, as {daysAgo,
 *  score} points sorted oldest → newest, for the "recent scores" chart. `now` is
 *  passed in for testability. */
export function recentScorePoints(
  history: SessionRecord[],
  voice: string,
  level: number,
  now: number,
  maxDays = 90,
): { daysAgo: number; score: number }[] {
  const DAY = 86400000;
  return history
    .filter((h) => h.voice === voice && h.level === level)
    .map((h) => ({ daysAgo: (now - h.ts) / DAY, score: h.score }))
    .filter((p) => p.daysAgo >= 0 && p.daysAgo <= maxDays)
    .sort((a, b) => b.daysAgo - a.daysAgo);
}

const DB_NAME = "pitchcraft";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB unavailable"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("history"))
        db.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadStats(): Promise<Stats> {
  try {
    const db = await openDB();
    const stats = await new Promise<Stats | undefined>((res) => {
      const rq = db.transaction("kv").objectStore("kv").get("stats");
      rq.onsuccess = () => res(rq.result as Stats | undefined);
      rq.onerror = () => res(undefined);
    });
    return stats ? { ...DEFAULT_STATS, ...stats } : { ...DEFAULT_STATS };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

export async function saveStats(stats: Stats): Promise<void> {
  try {
    const db = await openDB();
    db.transaction("kv", "readwrite").objectStore("kv").put(stats, "stats");
  } catch {
    /* ignore */
  }
}

/** Load the Voice Garden — the persistent living archive. An unreadable or
 *  absent garden comes back empty rather than failing. */
export async function loadGarden(): Promise<Garden> {
  try {
    const db = await openDB();
    const g = await new Promise<Garden | undefined>((res) => {
      const rq = db.transaction("kv").objectStore("kv").get("garden");
      rq.onsuccess = () => res(rq.result as Garden | undefined);
      rq.onerror = () => res(undefined);
    });
    if (!g || !Array.isArray(g.elements)) return emptyGarden();
    // Gardens saved before the flora changed carry old kinds — map them across.
    const migrated = {
      ...emptyGarden(),
      ...g,
      elements: g.elements.map((el) => ({ ...el, kind: migrateKind(el.kind) })),
    };
    return migrated;
  } catch {
    return emptyGarden();
  }
}

export async function saveGarden(garden: Garden): Promise<void> {
  try {
    const db = await openDB();
    db.transaction("kv", "readwrite").objectStore("kv").put(garden, "garden");
  } catch {
    /* ignore */
  }
}

export async function loadHistory(): Promise<SessionRecord[]> {
  try {
    const db = await openDB();
    return await new Promise<SessionRecord[]>((res) => {
      const rq = db.transaction("history").objectStore("history").getAll();
      rq.onsuccess = () => res((rq.result as SessionRecord[]) || []);
      rq.onerror = () => res([]);
    });
  } catch {
    return [];
  }
}

export async function addHistory(rec: SessionRecord): Promise<void> {
  try {
    const db = await openDB();
    db.transaction("history", "readwrite").objectStore("history").add(rec);
  } catch {
    /* ignore */
  }
}

/**
 * Submit a finished session to the leaderboard backend.
 * Configure VITE_PITCHCRAFT_API (e.g. "https://api.ericjorgensen.com"). No-ops when unset.
 * Implement POST <base>/highscores on the server; never put secrets in the client.
 */
export function submitHighScore(rec: SessionRecord): void {
  const base = (import.meta as any)?.env?.VITE_PITCHCRAFT_API as string | undefined;
  if (!base) return;
  fetch(base.replace(/\/$/, "") + "/highscores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(rec),
  }).catch(() => {
    /* offline / not implemented yet */
  });
}

/** Merge a finished session into stats: streak, best, counts, per-note mastery. */
export function applySession(
  stats: Stats,
  opts: {
    score: number;
    perNote: Record<
      string,
      { n: number; rSum: number; pts: number; cN?: number; cSum?: number; cSqSum?: number }
    >;
    voiceId: string;
    difficulty: number;
  },
): { stats: Stats; isBest: boolean; date: string } {
  const today = new Date();
  const dkey = today.toISOString().slice(0, 10);
  if (stats.lastDate !== dkey) {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    stats.streak = stats.lastDate === y.toISOString().slice(0, 10) ? (stats.streak || 0) + 1 : 1;
    stats.lastDate = dkey;
  }
  stats.sessions = (stats.sessions || 0) + 1;
  // High scores are tracked per voice type + level; isBest is scoped to that.
  if (!stats.bests) stats.bests = {};
  const key = bestKey(opts.voiceId, opts.difficulty);
  const isBest = opts.score > (stats.bests[key] || 0);
  if (isBest) stats.bests[key] = opts.score;
  stats.best = Math.max(stats.best || 0, opts.score);
  for (const m in opts.perNote) {
    const pn = opts.perNote[m];
    const ns = stats.notes[m] || (stats.notes[m] = { n: 0, rSum: 0, best: 0, pts: 0 });
    ns.n += pn.n;
    ns.rSum += pn.rSum;
    ns.pts += pn.pts;
    ns.best = Math.max(ns.best, pn.n ? pn.rSum / pn.n : 0);
    ns.cN = (ns.cN || 0) + (pn.cN || 0);
    ns.cSum = (ns.cSum || 0) + (pn.cSum || 0);
    ns.cSqSum = (ns.cSqSum || 0) + (pn.cSqSum || 0);
  }
  stats.prefs = { voiceId: opts.voiceId, difficulty: opts.difficulty };
  return { stats, isBest, date: dkey };
}
