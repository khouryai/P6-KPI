/**
 * The glossary has to keep up with the tables. A definition nobody can reach is
 * as useless as no definition, and a header that quietly stops explaining itself
 * is exactly the thing this feature exists to prevent.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { GLOSSARY, define } from '../src/engine/glossary';

const SCREENS = resolve(process.cwd(), 'src/app/screens');

/** Every `label: '...'` used as a table column or stat tile across the screens. */
function labelsInUse(): string[] {
  const out = new Set<string>();
  for (const f of readdirSync(SCREENS).filter((n) => n.endsWith('.tsx'))) {
    const text = readFileSync(join(SCREENS, f), 'utf8');
    for (const m of text.matchAll(/label: '([^']+)'/g)) out.add(m[1]);
  }
  return [...out];
}

// Labels that are their own explanation, or are not domain terms at all.
const SELF_EVIDENT = new Set([
  'Activity name', 'Name', 'Notes', 'Discipline', 'All', 'Y', 'N', '(auto)',
  'Locations', 'First start', 'Last finish', 'Needs attention', 'Status',
]);

describe('glossary', () => {
  it('defines every abbreviated column label the screens use', () => {
    const missing = labelsInUse()
      // A label that is a whole sentence is already an explanation.
      .filter((l) => l.split(' ').length <= 3)
      .filter((l) => !SELF_EVIDENT.has(l))
      .filter((l) => define(l) === undefined);
    expect(missing, 'add these to src/engine/glossary.ts, or to SELF_EVIDENT here').toEqual([]);
  });

  it('matches a label whatever its case or padding', () => {
    expect(define('  od  ')).toBe(GLOSSARY.OD);
    expect(define('Budget H')).toBe(GLOSSARY['Budget h']);
  });

  it('says nothing rather than something empty', () => {
    expect(define('')).toBeUndefined();
    expect(define(undefined)).toBeUndefined();
    expect(define('a column nobody has ever had')).toBeUndefined();
  });

  it('explains what a term means, not what it is short for', () => {
    // "OD = Original Duration" would be a restatement, not an explanation.
    for (const [term, text] of Object.entries(GLOSSARY)) {
      expect(text.length, `${term} is too short to be explaining anything`).toBeGreaterThan(24);
      expect(text.trim().endsWith('.'), `${term} should read as a sentence`).toBe(true);
    }
  });

  it('distinguishes earned from built, which is the whole point of tracking both', () => {
    expect(GLOSSARY.Earned).toMatch(/worth/i);
    expect(GLOSSARY.Earned).toMatch(/not what it cost/i);
    expect(GLOSSARY.Built).toMatch(/cost|spent/i);
  });
});
