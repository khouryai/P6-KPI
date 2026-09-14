import type { Plugin } from 'vite';
import type { OutputAsset, OutputChunk } from 'rollup';

/**
 * Folds the whole application into one self-contained index.html: the JS and CSS are
 * inlined, and the links to the manifest and icon files are dropped because nothing can
 * be fetched alongside a file that is opened directly from disk.
 *
 * This is the no-server fallback. It is loaded straight from the file system, which
 * rules out ES modules (blocked by CORS on file://), hence the IIFE build format and the
 * plain <script> tag that replaces Vite's module one.
 */
export function inlineAllPlugin(): Plugin {
  return {
    name: 'tc-inline-all',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const html = bundle['index.html'] as OutputAsset | undefined;
      if (!html) return;
      const used = new Set<string>();

      const lookup = (src: string): string | null => {
        const name = src.replace(/^https?:\/\/[^/]+/, '').replace(/^\.?\//, '');
        return name in bundle ? name : null;
      };

      let source = String(html.source);
      const scripts: string[] = [];

      source = source.replace(/<script\b[^>]*\ssrc="([^"]+)"[^>]*>\s*<\/script>/gi, (tag, src: string) => {
        const name = lookup(src);
        if (!name || !name.endsWith('.js')) return tag;
        used.add(name);
        // A literal </script> inside a string would close the tag early.
        scripts.push((bundle[name] as OutputChunk).code.replace(/<\/script/gi, '<\\/script'));
        // Vite's tag is a deferred module. An inline script cannot defer, so it is moved
        // to the end of the body instead, where #root already exists.
        return '';
      });

      source = source.replace(/<link\b[^>]*\shref="([^"]+)"[^>]*>/gi, (tag, href: string) => {
        if (/rel="(manifest|icon|apple-touch-icon)"/i.test(tag)) return '';
        const name = lookup(href);
        if (!name || !name.endsWith('.css')) return tag;
        used.add(name);
        return `<style>${String((bundle[name] as OutputAsset).source)}</style>`;
      });

      const tags = scripts.map((code) => `<script>${code}</script>`).join('\n');
      // A function replacer, never a string one: minified code is full of $& and $`
      // sequences that String.replace would treat as substitution patterns.
      source = source.includes('</body>') ? source.replace('</body>', () => `${tags}\n  </body>`) : source + tags;

      for (const name of used) delete bundle[name];
      html.source = source;

      // Nothing may remain that the page would try to fetch from disk.
      const leftover = Object.keys(bundle).filter((f) => f !== 'index.html');
      for (const f of leftover) delete bundle[f];

      if (/\ssrc="|\shref="/.test(source.replace(/<a\b[^>]*>/gi, ''))) {
        this.warn(`standalone build still references external files: ${source.match(/\s(?:src|href)="[^"]+"/g)?.join(', ')}`);
      }
    },
  };
}
