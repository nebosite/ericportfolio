import crypto from "crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import type { Database } from "better-sqlite3";

// The single, app-agnostic feedback store for the whole portfolio. Every game
// or app posts here (tagged by `entity`), and the secret admin page manages it
// all from one place.

const APP = "feedback";
const ENTITY_RE = /^[a-z0-9-]{1,64}$/;
const MAX_TEXT = 1000;
export const STATUSES = ["Suggested", "Implemented"] as const;
type Status = (typeof STATUSES)[number];

const MAX_NOTES = 2000;

interface FeedbackRow {
  id: number;
  entity: string;
  text: string;
  votes: number;
  status: Status;
  notes: string;
  active: number;
  created_at: string;
}

export function initDb(db: Database): void {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      entity TEXT NOT NULL,
      text TEXT NOT NULL,
      votes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Suggested',
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_entity ON feedback(entity, active);
    CREATE TABLE IF NOT EXISTS admin_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_seen TEXT
    );
    INSERT OR IGNORE INTO admin_meta (id, last_seen) VALUES (1, NULL);
  `);
  // Migration: add the notes column to feedback tables created before it existed.
  const cols = db.prepare("PRAGMA table_info(feedback)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "notes")) {
    db.exec("ALTER TABLE feedback ADD COLUMN notes TEXT NOT NULL DEFAULT ''");
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Build the feedback service. `adminToken` (default: ADMIN_TOKEN env var) gates
 * the /api/admin routes; if it is unset, the admin API is closed entirely.
 */
export function createApp(
  db: Database,
  adminToken = process.env.ADMIN_TOKEN ?? "",
): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(morgan("tiny"));
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", app: APP, timestamp: new Date().toISOString() });
  });

  // ---- public API (called by every game/app's FeedbackPanel) ---------------

  app.post("/api/feedback", (req, res) => {
    const entity = typeof req.body?.entity === "string" ? req.body.entity : "";
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!ENTITY_RE.test(entity)) {
      return res.status(400).json({ error: "invalid entity" });
    }
    if (!text || text.length > MAX_TEXT) {
      return res.status(400).json({ error: `feedback must be 1-${MAX_TEXT} characters` });
    }
    const info = db.prepare("INSERT INTO feedback (entity, text) VALUES (?, ?)").run(entity, text);
    res.status(201).json({
      id: Number(info.lastInsertRowid),
      entity,
      text,
      votes: 0,
      status: "Suggested",
    });
  });

  app.get("/api/feedback/random", (req, res) => {
    const entity = typeof req.query.entity === "string" ? req.query.entity : "";
    if (!ENTITY_RE.test(entity)) {
      return res.status(400).json({ error: "invalid entity" });
    }
    // Only suggestions are up for voting — implemented requests are hidden.
    const rows = db
      .prepare(
        "SELECT id, text, votes FROM feedback WHERE entity = ? AND active = 1 AND status = 'Suggested' ORDER BY RANDOM() LIMIT 3",
      )
      .all(entity);
    res.json(rows);
  });

  app.post("/api/feedback/:id/vote", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const info = db
      .prepare("UPDATE feedback SET votes = votes + 1 WHERE id = ? AND active = 1")
      .run(id);
    if (info.changes === 0) {
      return res.status(404).json({ error: "feedback not found" });
    }
    const row = db.prepare("SELECT id, votes FROM feedback WHERE id = ?").get(id);
    res.json(row);
  });

  // ---- admin API (password-gated) ------------------------------------------

  const requireAdmin: express.RequestHandler = (req, res, next) => {
    if (!adminToken) {
      return res.status(401).json({ error: "admin access is not configured" });
    }
    const header = req.headers.authorization ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!provided || !constantTimeEqual(provided, adminToken)) {
      return res.status(401).json({ error: "unauthorized" });
    }
    next();
  };

  // Full list for the admin table. Marks items created since the previous visit
  // as new, then advances the last-seen marker to now.
  app.get("/api/admin/feedback", requireAdmin, (_req, res) => {
    const meta = db.prepare("SELECT last_seen FROM admin_meta WHERE id = 1").get() as {
      last_seen: string | null;
    };
    const prev = meta?.last_seen ?? null;
    const rows = db
      .prepare(
        "SELECT id, entity, text, votes, status, notes, active, created_at FROM feedback ORDER BY datetime(created_at) DESC, id DESC",
      )
      .all() as FeedbackRow[];
    const items = rows.map((r) => ({ ...r, isNew: prev !== null && r.created_at > prev }));
    db.prepare("UPDATE admin_meta SET last_seen = datetime('now') WHERE id = 1").run();
    res.json({ lastSeen: prev, items });
  });

  app.patch("/api/admin/feedback/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const updates: string[] = [];
    const params: Array<string> = [];
    if ("status" in (req.body ?? {})) {
      if (!STATUSES.includes(req.body.status)) {
        return res.status(400).json({ error: `status must be one of: ${STATUSES.join(", ")}` });
      }
      updates.push("status = ?");
      params.push(req.body.status);
    }
    if ("notes" in (req.body ?? {})) {
      if (typeof req.body.notes !== "string" || req.body.notes.length > MAX_NOTES) {
        return res.status(400).json({ error: `notes must be a string up to ${MAX_NOTES} chars` });
      }
      updates.push("notes = ?");
      params.push(req.body.notes);
    }
    if (updates.length === 0) {
      return res.status(400).json({ error: "nothing to update (send status and/or notes)" });
    }
    const info = db
      .prepare(`UPDATE feedback SET ${updates.join(", ")} WHERE id = ?`)
      .run(...params, id);
    if (info.changes === 0) {
      return res.status(404).json({ error: "feedback not found" });
    }
    const row = db.prepare("SELECT id, status, notes FROM feedback WHERE id = ?").get(id);
    res.json(row);
  });

  app.delete("/api/admin/feedback/:id", requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "invalid id" });
    }
    const info = db.prepare("DELETE FROM feedback WHERE id = ?").run(id);
    if (info.changes === 0) {
      return res.status(404).json({ error: "feedback not found" });
    }
    res.json({ id, deleted: true });
  });

  return app;
}
