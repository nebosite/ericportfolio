import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Game sprites/sounds are tiny; keep them as real files (not inlined data
    // URLs) so dev and prod load assets through the same path.
    assetsInlineLimit: 0,
  },
  server: {
    proxy: {
      // Feedback goes to the shared feedback service (3005); the leaderboard and
      // everything else to the bigtinygames API (3004).
      "/api/feedback": "http://localhost:3005",
      "/api": "http://localhost:3004",
    },
  },
});
