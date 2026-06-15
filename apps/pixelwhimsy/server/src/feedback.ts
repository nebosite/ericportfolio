import type { Express } from 'express';
import type { Database } from 'better-sqlite3';

// Standard per-entity feedback feature shared by the games/apps that opt in.
// "entity" is a game or app slug (e.g. "snake", "big-pac-tiny-man",
// "pixelwhimsy"). Per-browser vote dedupe lives in the client's localStorage;
// the server just stores feedback and counts upvotes.

const ENTITY_RE = /^[a-z0-9-]{1,64}$/;
const MAX_TEXT = 1000;

export function initFeedbackTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY,
      entity TEXT NOT NULL,
      text TEXT NOT NULL,
      votes INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_entity ON feedback(entity, active);
  `);
}

export function registerFeedbackRoutes(app: Express, db: Database): void {
  // Leave up to 1000 characters of feedback for an entity.
  app.post('/api/feedback', (req, res) => {
    const entity = typeof req.body?.entity === 'string' ? req.body.entity : '';
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!ENTITY_RE.test(entity)) {
      return res.status(400).json({ error: 'invalid entity' });
    }
    if (!text || text.length > MAX_TEXT) {
      return res.status(400).json({ error: `feedback must be 1-${MAX_TEXT} characters` });
    }
    const info = db.prepare('INSERT INTO feedback (entity, text) VALUES (?, ?)').run(entity, text);
    res.status(201).json({ id: Number(info.lastInsertRowid), entity, text, votes: 0 });
  });

  // Up to three random active items for the entity, to vote on.
  app.get('/api/feedback/random', (req, res) => {
    const entity = typeof req.query.entity === 'string' ? req.query.entity : '';
    if (!ENTITY_RE.test(entity)) {
      return res.status(400).json({ error: 'invalid entity' });
    }
    const rows = db
      .prepare(
        'SELECT id, text, votes FROM feedback WHERE entity = ? AND active = 1 ORDER BY RANDOM() LIMIT 3',
      )
      .all(entity);
    res.json(rows);
  });

  // Upvote a single item (no downvotes). Repeat-vote prevention is client-side.
  app.post('/api/feedback/:id/vote', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }
    const info = db
      .prepare('UPDATE feedback SET votes = votes + 1 WHERE id = ? AND active = 1')
      .run(id);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'feedback not found' });
    }
    const row = db.prepare('SELECT id, votes FROM feedback WHERE id = ?').get(id);
    res.json(row);
  });
}
