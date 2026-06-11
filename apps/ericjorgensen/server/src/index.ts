import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import Database from 'better-sqlite3';

const APP = 'ericjorgensen';
const PORT = Number(process.env.PORT) || 3001;
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS guestbook (
    id INTEGER PRIMARY KEY,
    name TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY,
    count INTEGER DEFAULT 0
  );
`);
db.prepare('INSERT OR IGNORE INTO visits (id, count) VALUES (1, 0)').run();

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: APP, timestamp: new Date().toISOString() });
});

app.get('/api/guestbook', (_req, res) => {
  // Only surface the last 10 entries from the past hour. created_at is stored
  // in UTC (CURRENT_TIMESTAMP), so it compares directly against datetime('now').
  const entries = db
    .prepare(
      `SELECT id, name, message, created_at FROM guestbook
       WHERE created_at >= datetime('now', '-1 hour')
       ORDER BY id DESC LIMIT 10`,
    )
    .all();
  res.json(entries);
});

app.post('/api/guestbook', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!name || name.length > 50) {
    return res.status(400).json({ error: 'name is required (max 50 characters)' });
  }
  if (!message || message.length > 500) {
    return res.status(400).json({ error: 'message is required (max 500 characters)' });
  }
  const info = db.prepare('INSERT INTO guestbook (name, message) VALUES (?, ?)').run(name, message);
  const entry = db
    .prepare('SELECT id, name, message, created_at FROM guestbook WHERE id = ?')
    .get(info.lastInsertRowid);
  res.status(201).json(entry);
});

app.post('/api/visit', (_req, res) => {
  db.prepare('UPDATE visits SET count = count + 1 WHERE id = 1').run();
  const row = db.prepare('SELECT count FROM visits WHERE id = 1').get() as { count: number };
  res.json({ count: row.count });
});

app.listen(PORT, () => {
  console.log(`[${APP}] API listening on port ${PORT} (db: ${DB_PATH})`);
});
