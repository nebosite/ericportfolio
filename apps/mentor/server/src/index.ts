import { createApp } from "./app.js";

// Boots the public Coding Mentor MCP service. No database, no secrets — it
// serves static knowledge (the Layered Development coaching prompt + portfolio
// examples) over Streamable HTTP.

const PORT = Number(process.env.PORT) || 3007;

const app = createApp();
app.listen(PORT, () => {
  console.log(`[mentor] Coding Mentor MCP listening on port ${PORT} (public, read-only) at /coach`);
});
