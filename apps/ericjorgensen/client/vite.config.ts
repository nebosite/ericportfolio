import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cross-origin isolation lets the Blast Corps physics worker use SharedArrayBuffer
// and Jolt's multithreaded build. `credentialless` (not `require-corp`) keeps
// cross-origin no-cors resources (gtag, Google Fonts) loading. In production the
// same headers are added by nginx on the /blast-corps-reimagined document only.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "credentialless",
};

export default defineConfig({
  plugins: [react()],
  // The Blast Corps physics worker is a module worker; "es" keeps its chunking
  // (and the Jolt wasm bundle) identical between `vite dev` and `vite build`.
  worker: { format: "es" },
  // Jolt's multithreaded module uses top-level await, which the default es2020
  // target rejects; every browser that has SharedArrayBuffer has TLA. The Jolt
  // flavours are served as-is in dev so their import.meta.url (which Emscripten
  // uses to spawn pthread workers) points at the real module.
  build: { target: "es2022" },
  optimizeDeps: { exclude: ["jolt-physics", "jolt-physics/wasm-compat-multithread"] },
  preview: { headers: isolationHeaders },
  server: {
    headers: isolationHeaders,
    proxy: {
      // The public feedback panel and the admin console both talk to the shared
      // feedback service (3005); everything else is the ericjorgensen API (3001).
      "/api/feedback": "http://localhost:3005",
      "/api/admin": "http://localhost:3005",
      "/api": "http://localhost:3001",
    },
  },
});
