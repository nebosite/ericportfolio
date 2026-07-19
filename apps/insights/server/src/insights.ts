import type { Database } from "better-sqlite3";

// Pure query helpers over the shared feedback database (opened read-only by the
// caller). These are what the MCP tools call; keeping them framework-free makes
// them unit-testable without HTTP. "Interaction" data comes from feedback rows
// (submissions carry created_at; votes are a running counter with no per-vote
// timestamp — see recentActivity's note). Cross-app *usage* analytics (GA4) is
// a separate, later addition.

export interface RequestRow {
  id: number;
  entity: string;
  text: string;
  votes: number;
  status: string;
  created_at: string;
}

/** Open feature requests for an entity, most-voted first — "top priorities". */
export function topRequests(db: Database, entity: string, limit = 10): RequestRow[] {
  return db
    .prepare(
      `SELECT id, entity, text, votes, status, created_at
         FROM feedback
        WHERE entity = ? AND active = 1 AND status IN ('Submitted', 'Suggested')
        ORDER BY votes DESC, datetime(created_at) DESC
        LIMIT ?`,
    )
    .all(entity, limit) as RequestRow[];
}

/** Full list for an entity, optionally filtered by status. */
export function listRequests(
  db: Database,
  entity: string,
  status?: string,
  limit = 100,
): RequestRow[] {
  if (status) {
    return db
      .prepare(
        `SELECT id, entity, text, votes, status, created_at FROM feedback
          WHERE entity = ? AND active = 1 AND status = ?
          ORDER BY votes DESC, datetime(created_at) DESC LIMIT ?`,
      )
      .all(entity, status, limit) as RequestRow[];
  }
  return db
    .prepare(
      `SELECT id, entity, text, votes, status, created_at FROM feedback
        WHERE entity = ? AND active = 1
        ORDER BY votes DESC, datetime(created_at) DESC LIMIT ?`,
    )
    .all(entity, limit) as RequestRow[];
}

export interface ActivitySummary {
  sinceDays: number;
  newRequests: number;
  byEntity: Array<{ entity: string; newRequests: number; votesOnThose: number }>;
  note: string;
}

/**
 * Feature-request interaction in the last N days. Submissions are timestamped
 * (created_at), so new-request counts are exact; votes are only a per-row
 * running total (no per-vote timestamp), so we report the current votes on the
 * newly-submitted rows rather than votes-cast-this-week. Add a vote-events log
 * to the feedback service if true vote-over-time is needed.
 */
export function recentActivity(db: Database, days = 7): ActivitySummary {
  const cutoff = `-${Math.max(0, Math.floor(days))} days`;
  const byEntity = db
    .prepare(
      `SELECT entity, COUNT(*) AS newRequests, COALESCE(SUM(votes), 0) AS votesOnThose
         FROM feedback
        WHERE active = 1 AND datetime(created_at) >= datetime('now', ?)
        GROUP BY entity
        ORDER BY newRequests DESC`,
    )
    .all(cutoff) as Array<{ entity: string; newRequests: number; votesOnThose: number }>;
  const newRequests = byEntity.reduce((n, r) => n + r.newRequests, 0);
  return {
    sinceDays: days,
    newRequests,
    byEntity,
    note: "newRequests are exact (created_at). Votes have no per-vote timestamp, so votesOnThose is the current vote total on those recently-submitted requests, not votes cast this week.",
  };
}

export interface EntitySummary {
  entity: string;
  total: number;
  submitted: number;
  suggested: number;
  implemented: number;
  totalVotes: number;
  latest: string | null;
}

/**
 * Per-app feedback engagement: request counts by status + votes. A proxy for
 * "which apps people care about" until GA4 usage analytics is wired in.
 */
export function appSummary(db: Database): EntitySummary[] {
  return db
    .prepare(
      `SELECT entity,
              COUNT(*) AS total,
              SUM(status = 'Submitted') AS submitted,
              SUM(status = 'Suggested') AS suggested,
              SUM(status = 'Implemented') AS implemented,
              COALESCE(SUM(votes), 0) AS totalVotes,
              MAX(created_at) AS latest
         FROM feedback
        WHERE active = 1
        GROUP BY entity
        ORDER BY total DESC`,
    )
    .all() as EntitySummary[];
}

// --- duplicate detection (token-overlap similarity) ------------------------

const STOPWORDS = new Set(
  "a an and the to of for in on with it is be add can could would should make more less please want need game games app when i you my your this that".split(
    " ",
  ),
);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DuplicatePair {
  similarity: number;
  a: { id: number; text: string; votes: number };
  b: { id: number; text: string; votes: number };
}

/**
 * Candidate duplicate requests: pairs whose normalized word-sets overlap at or
 * above `threshold` (Jaccard). Scoped to one entity when given, else compared
 * within each entity. Returns pairs sorted most-similar first; the caller (a
 * model) can cluster/judge from there.
 */
export function findDuplicates(db: Database, entity?: string, threshold = 0.4): DuplicatePair[] {
  const rows = (
    entity
      ? db
          .prepare("SELECT id, entity, text, votes FROM feedback WHERE active = 1 AND entity = ?")
          .all(entity)
      : db.prepare("SELECT id, entity, text, votes FROM feedback WHERE active = 1").all()
  ) as Array<{ id: number; entity: string; text: string; votes: number }>;

  const toks = rows.map((r) => tokenize(r.text));
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      // Only compare within the same entity when scanning across all entities.
      if (!entity && rows[i].entity !== rows[j].entity) continue;
      const sim = jaccard(toks[i], toks[j]);
      if (sim >= threshold) {
        pairs.push({
          similarity: Math.round(sim * 100) / 100,
          a: { id: rows[i].id, text: rows[i].text, votes: rows[i].votes },
          b: { id: rows[j].id, text: rows[j].text, votes: rows[j].votes },
        });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
}
