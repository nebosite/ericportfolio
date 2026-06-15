import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import type { Database } from 'better-sqlite3';
import { initFeedbackTable, registerFeedbackRoutes } from './feedback';

const APP = 'pixelwhimsy';

/** Create the tables this app relies on. Safe to call repeatedly. */
export function initDb(db: Database): void {
  db.pragma('journal_mode = WAL');
  initFeedbackTable(db);
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

  registerFeedbackRoutes(app, db);

  return app;
}
