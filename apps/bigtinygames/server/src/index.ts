import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import Database from 'better-sqlite3';

const APP = 'bigtinygames';
const PORT = Number(process.env.PORT) || 3004;
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data.db');

const MAX_SCORE = 1_000_000; // sanity cap — Snake scores have no business above this

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS leaderboard (
    id INTEGER PRIMARY KEY,
    initials TEXT,
    score INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

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

app.listen(PORT, () => {
  console.log(`[${APP}] API listening on port ${PORT} (db: ${DB_PATH})`);
});
