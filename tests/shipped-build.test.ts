import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * dist/ and standalone/ are both committed, because the laptop that runs this has no
 * Node and no npm: they are the delivered product, not build litter.
 *
 * They are also two separate builds of the same source, and rebuilding one without the
 * other ships a laptop where start.cmd runs the new code and the desktop icon runs the
 * old — silently, because both windows look identical. That happened. These tests are
 * the reason it cannot happen again: `npm run build` now produces both, and a stale
 * pair fails here before it can be committed.
 */

const root = resolve(process.cwd());
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

/** The build stamp vite inlines. Anything older than the project is a library's own date. */
function stampOf(bundle: string): Date {
  const all = [...bundle.matchAll(/"(20\d\d-[01]\d-[0-3]\dT[\d:.]+Z)"/g)].map((m) => new Date(m[1]));
  const mine = all.filter((d) => d.getTime() > Date.parse('2025-01-01'));
  expect(mine.length, 'exactly one build stamp should be inlined').toBe(1);
  return mine[0];
}

describe('the shipped build', () => {
  const stamp = JSON.parse(read('dist/build.json')) as { commit: string; builtAt: string };
  const standalone = read('standalone/index.html');

  it('ships the desktop single-file build from the same run as dist', () => {
    const served = new Date(stamp.builtAt);
    const desktop = stampOf(standalone);
    const apartMinutes = Math.abs(desktop.getTime() - served.getTime()) / 60_000;
    expect(
      apartMinutes,
      `dist/ was built ${stamp.builtAt} and standalone/index.html ${desktop.toISOString()}. ` +
        'One of them is stale: run `npm run build`, which makes both, and commit them together.',
    ).toBeLessThan(30);
  });

  it('keeps the desktop build to one self-contained file', () => {
    // It opens from file://, where a reference to ./assets/… resolves to nothing.
    expect(standalone).not.toMatch(/(src|href)="\.?\/?assets\//);
    expect(standalone.length).toBeGreaterThan(200_000);
  });

  it('serves dist from assets it actually ships', () => {
    const index = read('dist/index.html');
    for (const [, path] of index.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g)) {
      expect(() => read(`dist/${path}`), `dist/index.html references missing ${path}`).not.toThrow();
    }
  });
});
