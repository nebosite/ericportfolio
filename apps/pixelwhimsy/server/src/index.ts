import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import Database from 'better-sqlite3';

const APP = 'pixelwhimsy';
const PORT = Number(process.env.PORT) || 3002;
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data.db');

const GRID_CELLS = 32 * 32; // pixels column stores a JSON array of 1024 color values

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS drawings (
    id INTEGER PRIMARY KEY,
    pixels TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json({ limit: '256kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: APP, timestamp: new Date().toISOString() });
});

app.get('/api/drawings', (_req, res) => {
  const rows = db
    .prepare('SELECT id, pixels, created_at FROM drawings ORDER BY id DESC LIMIT 5')
    .all() as Array<{ id: number; pixels: string; created_at: string }>;
  res.json(
    rows.map((row) => ({
      id: row.id,
      pixels: JSON.parse(row.pixels) as string[],
      created_at: row.created_at,
    })),
  );
});

app.post('/api/drawings', (req, res) => {
  const pixels: unknown = req.body?.pixels;
  const isValid =
    Array.isArray(pixels) &&
    pixels.length === GRID_CELLS &&
    pixels.every((p) => typeof p === 'string' && /^#[0-9a-fA-F]{6}$/.test(p));
  if (!isValid) {
    return res
      .status(400)
      .json({ error: `pixels must be an array of ${GRID_CELLS} hex color strings` });
  }
  const info = db.prepare('INSERT INTO drawings (pixels) VALUES (?)').run(JSON.stringify(pixels));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.listen(PORT, () => {
  console.log(`[${APP}] API listening on port ${PORT} (db: ${DB_PATH})`);
});
