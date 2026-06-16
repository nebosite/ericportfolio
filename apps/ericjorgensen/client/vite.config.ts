import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The admin feedback console talks to the shared feedback service (3005);
      // everything else on this site is served by the ericjorgensen API (3001).
      '/api/admin': 'http://localhost:3005',
      '/api': 'http://localhost:3001',
    },
  },
});
