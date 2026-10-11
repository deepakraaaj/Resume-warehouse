import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The whole site: Job Hunt and the resume desk. The API stays on the desk server (proxied in dev).
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: '../dashboard/public', emptyOutDir: true, chunkSizeWarningLimit: 900 },
  server: { port: 5173, fs: { allow: ['..'] }, proxy: { '/api': 'http://localhost:4000', '/HTML': 'http://localhost:4000', '/PDF': 'http://localhost:4000' } },
});
