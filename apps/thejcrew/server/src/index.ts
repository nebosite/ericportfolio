import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import Database from 'better-sqlite3';

const APP = 'thejcrew';
const PORT = Number(process.env.PORT) || 3003;
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data.db');

const EMOJIS = ['👍', '❤️', '😂'] as const;
const MAX_MESSAGE = 280;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY,
    author TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reactions (
    id INTEGER PRIMARY KEY,
    post_id INTEGER,
    emoji TEXT,
    count INTEGER DEFAULT 0,
    UNIQUE (post_id, emoji)
  );
`);

interface PostRow {
  id: number;
  author: string;
  message: string;
  created_at: string;
}

function reactionsFor(postId: number): Record<string, number> {
  const rows = db
    .prepare('SELECT emoji, count FROM reactions WHERE post_id = ?')
    .all(postId) as Array<{ emoji: string; count: number }>;
  const counts: Record<string, number> = {};
  for (const emoji of EMOJIS) counts[emoji] = 0;
  for (const row of rows) counts[row.emoji] = row.count;
  return counts;
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: APP, timestamp: new Date().toISOString() });
});

app.get('/api/bulletin', (_req, res) => {
  const posts = db
    .prepare('SELECT id, author, message, created_at FROM posts ORDER BY id DESC LIMIT 20')
    .all() as PostRow[];
  res.json(posts.map((post) => ({ ...post, reactions: reactionsFor(post.id) })));
});

app.post('/api/bulletin', (req, res) => {
  const author = typeof req.body?.author === 'string' ? req.body.author.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!author || author.length > 50) {
    return res.status(400).json({ error: 'author is required (max 50 characters)' });
  }
  if (!message || message.length > MAX_MESSAGE) {
    return res.status(400).json({ error: `message is required (max ${MAX_MESSAGE} characters)` });
  }
  const info = db.prepare('INSERT INTO posts (author, message) VALUES (?, ?)').run(author, message);
  const post = db
    .prepare('SELECT id, author, message, created_at FROM posts WHERE id = ?')
    .get(info.lastInsertRowid) as PostRow;
  res.status(201).json({ ...post, reactions: reactionsFor(post.id) });
});

app.patch('/api/bulletin/:id/react', (req, res) => {
  const postId = Number(req.params.id);
  const emoji = req.body?.emoji as string;
  if (!Number.isInteger(postId)) {
    return res.status(400).json({ error: 'invalid post id' });
  }
  if (!EMOJIS.includes(emoji as (typeof EMOJIS)[number])) {
    return res.status(400).json({ error: `emoji must be one of: ${EMOJIS.join(' ')}` });
  }
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(postId);
  if (!post) {
    return res.status(404).json({ error: 'post not found' });
  }
  db.prepare(
    `INSERT INTO reactions (post_id, emoji, count) VALUES (?, ?, 1)
     ON CONFLICT (post_id, emoji) DO UPDATE SET count = count + 1`,
  ).run(postId, emoji);
  res.json({ id: postId, reactions: reactionsFor(postId) });
});

app.listen(PORT, () => {
  console.log(`[${APP}] API listening on port ${PORT} (db: ${DB_PATH})`);
});
