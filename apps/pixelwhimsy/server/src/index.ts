import { createApp } from './app';

const PORT = Number(process.env.PORT) || 3002;

createApp().listen(PORT, () => {
  console.log(`[pixelwhimsy] API listening on port ${PORT}`);
});
