import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The public feedback panel and the admin console both talk to the shared
      // feedback service (3005); everything else is the ericjorgensen API (3001).
      "/api/feedback": "http://localhost:3005",
      "/api/admin": "http://localhost:3005",
      "/api": "http://localhost:3001",
    },
  },
});
