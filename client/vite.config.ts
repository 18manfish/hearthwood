import { defineConfig } from 'vite';

// In development Vite serves the client on :5173 and proxies the API and the
// WebSocket to the game server on :8787.
export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 1500 },
});
