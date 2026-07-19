import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { topRequests, listRequests, recentActivity, appSummary, findDuplicates } from "./insights";

// Build an in-memory DB with the feedback schema and seed rows. created_at is
// set explicitly where a test needs recent-vs-old separation.
function seed() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE feedback (
      id INTEGER PRIMARY KEY,
      entity TEXT NOT NULL,
      text TEXT NOT NULL,
      votes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Submitted',
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const ins = db.prepare(
    "INSERT INTO feedback (entity, text, votes, status, active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const recent = "datetime('now')";
  const old = "datetime('now','-30 days')";
  const rows: Array<[string, string, number, string, number, string]> = [
    ["big-space-tiny-invaders", "Add a boss battle level", 9, "Suggested", 1, recent],
    ["big-space-tiny-invaders", "Please add a pause button", 2, "Suggested", 1, recent],
    ["big-space-tiny-invaders", "Add a pause button", 5, "Suggested", 1, old],
    ["big-space-tiny-invaders", "Two player co-op mode", 7, "Implemented", 1, old],
    ["big-space-tiny-invaders", "New idea just came in", 0, "Submitted", 1, recent],
    ["snake", "Faster speed option", 3, "Suggested", 1, recent],
  ];
  // created_at expressions can't be bound as params, so build per-row.
  for (const [entity, text, votes, status, active, when] of rows) {
    db.prepare(
      `INSERT INTO feedback (entity, text, votes, status, active, created_at) VALUES (?, ?, ?, ?, ?, ${when})`,
    ).run(entity, text, votes, status, active);
  }
  void ins; // (schema/insert reference kept for clarity)
  return db;
}

describe("topRequests", () => {
  let db: Database.Database;
  beforeEach(() => (db = seed()));

  it("returns open requests for an entity, most-voted first, excluding Implemented", () => {
    const rows = topRequests(db, "big-space-tiny-invaders");
    expect(rows.map((r) => r.votes)).toEqual([9, 5, 2, 0]); // 4 open items, desc
    expect(rows.some((r) => r.status === "Implemented")).toBe(false);
    expect(rows[0].text).toBe("Add a boss battle level");
  });

  it("respects the limit", () => {
    expect(topRequests(db, "big-space-tiny-invaders", 2)).toHaveLength(2);
  });
});

describe("listRequests", () => {
  let db: Database.Database;
  beforeEach(() => (db = seed()));

  it("filters by status when given", () => {
    const submitted = listRequests(db, "big-space-tiny-invaders", "Submitted");
    expect(submitted).toHaveLength(1);
    expect(submitted[0].text).toBe("New idea just came in");
  });
});

describe("recentActivity", () => {
  let db: Database.Database;
  beforeEach(() => (db = seed()));

  it("counts only submissions within the window, per entity", () => {
    const a = recentActivity(db, 7);
    // recent rows: 2 invaders (boss battle, boss fight) + 1 invaders submitted + 1 snake
    expect(a.newRequests).toBe(4);
    const inv = a.byEntity.find((e) => e.entity === "big-space-tiny-invaders");
    expect(inv?.newRequests).toBe(3);
    expect(a.byEntity.find((e) => e.entity === "snake")?.newRequests).toBe(1);
  });
});

describe("appSummary", () => {
  let db: Database.Database;
  beforeEach(() => (db = seed()));

  it("summarizes per-entity counts by status and votes", () => {
    const s = appSummary(db);
    const inv = s.find((e) => e.entity === "big-space-tiny-invaders")!;
    expect(inv.total).toBe(5);
    expect(inv.suggested).toBe(3);
    expect(inv.submitted).toBe(1);
    expect(inv.implemented).toBe(1);
    expect(inv.totalVotes).toBe(9 + 2 + 5 + 7 + 0);
    // Ordered by total requests desc → invaders (5) before snake (1).
    expect(s[0].entity).toBe("big-space-tiny-invaders");
  });
});

describe("findDuplicates", () => {
  let db: Database.Database;
  beforeEach(() => (db = seed()));

  it("flags the two pause-button requests as similar and not unrelated ones", () => {
    const pairs = findDuplicates(db, "big-space-tiny-invaders", 0.3);
    expect(pairs.length).toBeGreaterThan(0);
    const top = pairs[0];
    const texts = [top.a.text, top.b.text].sort();
    expect(texts).toEqual(["Add a pause button", "Please add a pause button"]);
    // The boss-battle request shouldn't be flagged as a duplicate of anything.
    const hasBoss = pairs.some((p) => p.a.text.includes("boss") || p.b.text.includes("boss"));
    expect(hasBoss).toBe(false);
  });
});
