import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const APP = 'pixelwhimsy';

// Feedback is owned by the shared feedback service (apps/feedback); this server
// is health-only.

/** Build the (health-only) Express app for this site. */
export function createApp(): express.Express {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(morgan('tiny'));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', app: APP, timestamp: new Date().toISOString() });
  });

  return app;
}
