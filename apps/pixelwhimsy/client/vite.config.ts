import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Feedback goes to the shared feedback service (3005); anything else to the
      // pixelwhimsy API (3002).
      "/api/feedback": "http://localhost:3005",
      "/api": "http://localhost:3002",
    },
  },
});
