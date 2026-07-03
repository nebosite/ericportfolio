import { createApp } from "./app";

const PORT = Number(process.env.PORT) || 3003;

createApp().listen(PORT, () => {
  console.log(`[thejcrew] API listening on port ${PORT}`);
});
