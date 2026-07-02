import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Database } from 'better-sqlite3';

const APP = 'bigtinygames';

const MAX_SCORE = 100_000_000; // sanity cap across games (Big Pac scales with levels)
const DEFAULT_GAME = 'snake'; // rows/queries without an explicit game are Snake's

// Feedback is owned by the shared feedback service (apps/feedback); this server
// holds a per-game leaderboard (Snake, Big Pac Tiny Man, …) in one table.

/** Create the tables this app relies on. Safe to call repeatedly. */
export function initDb(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS leaderboard (
      id INTEGER PRIMARY KEY,
      game TEXT NOT NULL DEFAULT '${DEFAULT_GAME}',
      initials TEXT,
      score INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // Migrate leaderboards created before the per-game column existed.
  const cols = db.prepare('PRAGMA table_info(leaderboard)').all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'game')) {
    db.exec(`ALTER TABLE leaderboard ADD COLUMN game TEXT NOT NULL DEFAULT '${DEFAULT_GAME}'`);
  }
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

  app.get('/api/leaderboard', (req, res) => {
    const game = typeof req.query.game === 'string' && req.query.game ? req.query.game : DEFAULT_GAME;
    const rows = db
      .prepare(
        'SELECT id, initials, score, created_at FROM leaderboard WHERE game = ? ORDER BY score DESC, id ASC LIMIT 10',
      )
      .all(game);
    res.json(rows);
  });

  app.post('/api/leaderboard', (req, res) => {
    const initials =
      typeof req.body?.initials === 'string' ? req.body.initials.trim().toUpperCase() : '';
    const score = req.body?.score;
    const game =
      typeof req.body?.game === 'string' && req.body.game ? req.body.game.trim() : DEFAULT_GAME;
    if (!/^[A-Z0-9]{1,3}$/.test(initials)) {
      return res.status(400).json({ error: 'initials must be 1-3 letters or digits' });
    }
    if (!/^[a-z0-9-]{1,40}$/.test(game)) {
      return res.status(400).json({ error: 'invalid game slug' });
    }
    if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
      return res.status(400).json({ error: 'score must be a non-negative integer' });
    }
    const info = db
      .prepare('INSERT INTO leaderboard (game, initials, score) VALUES (?, ?, ?)')
      .run(game, initials, score);
    res.status(201).json({ id: Number(info.lastInsertRowid), game, initials, score });
  });

  return app;
}
