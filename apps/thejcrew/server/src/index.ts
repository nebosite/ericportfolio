import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

const APP = 'thejcrew';
const PORT = Number(process.env.PORT) || 3003;

const app = express();
app.use(helmet());
app.use(cors());
app.use(morgan('tiny'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: APP, timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`[${APP}] API listening on port ${PORT}`);
});
