/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { precachePlugin } from './server/precache-plugin';
import { inlineAllPlugin } from './server/inline-plugin';

// TC_STANDALONE=1 builds the single-file version that opens straight from disk.
const standalone = process.env.TC_STANDALONE === '1';

export default defineConfig({
  // The single-file build must emit exactly one file, so nothing is copied from public/.
  publicDir: standalone ? false : 'public',
  define: { __STANDALONE__: JSON.stringify(standalone) },
  plugins: [react(), tailwindcss(), standalone ? inlineAllPlugin() : precachePlugin()],
  // Fixed port so the installed desktop app keeps a stable origin. The storage folder
  // handle and the IndexedDB mirror are both bound to that origin.
  server: { port: 47800, strictPort: true },
  preview: { port: 47800, strictPort: true },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
    outDir: standalone ? 'standalone' : 'dist',
    // Everything must end up inside the one HTML file.
    assetsInlineLimit: standalone ? 100_000_000 : 4096,
    cssCodeSplit: !standalone,
    rollupOptions: standalone
      ? { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: '[name][extname]' } }
      : {},
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
