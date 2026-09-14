import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Emits sw.js at build time with the list of built assets to precache, so the
 * installed app opens instantly and works with no network at all. The template
 * lives in server/sw.template.js; __PRECACHE__ and __VERSION__ are substituted.
 */
export function precachePlugin(): Plugin {
  return {
    name: 'tc-precache-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const assets = Object.keys(bundle).map((f) => `/${f}`);
      const files = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...assets];
      const version = `${Date.now().toString(36)}`;
      const template = readFileSync(resolve(process.cwd(), 'server/sw.template.js'), 'utf8');
      const source = template.replace('__PRECACHE__', JSON.stringify(files)).replace('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
