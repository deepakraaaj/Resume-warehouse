import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served at /hunt/ by the Resume Desk; the API stays on the desk server (proxied in dev).
export default defineConfig({
  base: '/hunt/',
  plugins: [react()],
  build: { outDir: '../dashboard/public/hunt', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
});
