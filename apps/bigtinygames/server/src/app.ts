import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Database } from 'better-sqlite3';

const APP = 'bigtinygames';

const MAX_SCORE = 1_000_000; // sanity cap — Snake scores have no business above this

// Feedback is owned by the shared feedback service (apps/feedback); this server
// only handles the Snake leaderboard.

/** Create the tables this app relies on. Safe to call repeatedly. */
export function initDb(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id INTEGER PRIMARY KEY,
      initials TEXT,
      score INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Build the Express app around an already-initialized database. */
export function createApp(db: Database): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(morgan('tiny'));
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: APP, timestamp: new Date().toISOString() });
  });

  app.get('/api/leaderboard', (_req, res) => {
    const rows = db
      .prepare(
        'SELECT id, initials, score, created_at FROM leaderboard ORDER BY score DESC, id ASC LIMIT 10',
      )
      .all();
    res.json(rows);
  });

  app.post('/api/leaderboard', (req, res) => {
    const initials =
      typeof req.body?.initials === 'string' ? req.body.initials.trim().toUpperCase() : '';
    const score = req.body?.score;
    if (!/^[A-Z0-9]{1,3}$/.test(initials)) {
      return res.status(400).json({ error: 'initials must be 1-3 letters or digits' });
    }
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
      return res.status(400).json({ error: 'score must be a non-negative integer' });
    }
    const info = db
      .prepare('INSERT INTO leaderboard (initials, score) VALUES (?, ?)')
      .run(initials, score);
    res.status(201).json({ id: Number(info.lastInsertRowid), initials, score });
  });

  return app;
}
