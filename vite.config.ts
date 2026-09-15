/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { precachePlugin } from './server/precache-plugin';
import { inlineAllPlugin } from './server/inline-plugin';

// TC_STANDALONE=1 builds the single-file version that opens straight from disk.
const standalone = process.env.TC_STANDALONE === '1';

// A build stamp, so "did my change actually reach the laptop?" is answerable by
// looking at the app instead of guessing. git may be absent on a build machine,
// so every part of this is allowed to fail.
function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}
const buildCommit = git('rev-parse --short HEAD') || 'unknown';
// Only source counts as "dirty". dist/ and standalone/ are committed build output,
// and the first half of `build:all` dirties them before the second half reads this.
const buildDirty = git('status --porcelain -- src server index.html vite.config.ts') !== '';
const buildTime = new Date().toISOString();

export default defineConfig({
  // The single-file build must emit exactly one file, so nothing is copied from public/.
  publicDir: standalone ? false : 'public',
  define: {
    __STANDALONE__: JSON.stringify(standalone),
    __BUILD_COMMIT__: JSON.stringify(buildDirty ? `${buildCommit}+` : buildCommit),
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [react(), tailwindcss(), standalone ? inlineAllPlugin() : precachePlugin({ commit: buildCommit, builtAt: buildTime })],
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
