import path from 'path';
import Database from 'better-sqlite3';
import { createApp, initDb } from './app';

const PORT = Number(process.env.PORT) || 3005;
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data.db');

if (!process.env.ADMIN_TOKEN) {
  console.warn('[feedback] ADMIN_TOKEN is not set — the admin API will be closed.');
}

const db = new Database(DB_PATH);
initDb(db);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`[feedback] API listening on port ${PORT} (db: ${DB_PATH})`);
});
