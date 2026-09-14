/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { precachePlugin } from './server/precache-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), precachePlugin()],
  // Fixed port so the installed desktop app keeps a stable origin. The storage folder
  // handle and the IndexedDB mirror are both bound to that origin.
  server: { port: 47800, strictPort: true },
  preview: { port: 47800, strictPort: true },
  build: { sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
