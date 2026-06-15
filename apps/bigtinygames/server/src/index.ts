import path from 'path';
import Database from 'better-sqlite3';
import { createApp, initDb } from './app';

const PORT = Number(process.env.PORT) || 3004;
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, '..', 'data.db');

const db = new Database(DB_PATH);
initDb(db);
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`[bigtinygames] API listening on port ${PORT} (db: ${DB_PATH})`);
});
