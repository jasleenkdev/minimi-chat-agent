import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Read PORT from .env too, so the proxy always points at the same port the API listens on.
  const apiPort = loadEnv(mode, process.cwd(), '').PORT || '8787';
  return {
    root: 'client',
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true },
      },
    },
    build: { outDir: '../dist/client', emptyOutDir: true },
  };
});
