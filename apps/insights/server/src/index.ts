import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { createApp } from "./app.js";

// Boots the insights MCP service. It reads the SHARED feedback database
// (owned/written by the feedback service) READ-ONLY, so both can run at once.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3006;
const FEEDBACK_DB =
  process.env.FEEDBACK_DB_PATH ?? path.resolve(__dirname, "../../../feedback/server/data.db");

if (!process.env.INSIGHTS_TOKEN) {
  console.warn("[insights] INSIGHTS_TOKEN is not set — the MCP endpoint is closed.");
}

const db = new Database(FEEDBACK_DB, { readonly: true, fileMustExist: true });
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`[insights] MCP listening on port ${PORT} (feedback db: ${FEEDBACK_DB}, read-only)`);
});
