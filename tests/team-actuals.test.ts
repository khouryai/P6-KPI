/**
 * Hours are kept per group and per month, and that is the whole of it.
 *
 * The rows used to carry the person who charged them, and nothing on any screen
 * ever reported by it — so the field was personal data collected for no answer
 * anybody asked. These are the two things that had to stay true when it went: a
 * file written before the change still loads, and its hours still add up.
 */
import { describe, it, expect } from 'vitest';
import { stripPerson } from '../src/storage/store';
import type { TeamActual } from '../src/engine/types';

describe('a team-actuals file written before the person field went', () => {
  const stored = [
    { id: '1', month: '2026-06', subsystem: 'ATS', person: 'A. Engineer', hours: 100 },
    { id: '2', month: '2026-06', subsystem: 'ATS', person: 'B. Engineer', hours: 20 },
    { id: '3', month: '2026-07', subsystem: 'IXL', hours: 40 },
  ] as (TeamActual & { person?: string })[];

  it('loads, and leaves the name behind', () => {
    const rows = stripPerson(stored);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect('person' in r).toBe(false);
  });

  it('does not lose an hour on the way', () => {
    expect(stripPerson(stored).reduce((s, r) => s + r.hours, 0)).toBe(160);
  });

  it('keeps each row separate, so two people in one group still total correctly', () => {
    const rows = stripPerson(stored).filter((r) => r.subsystem === 'ATS' && r.month === '2026-06');
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.hours, 0)).toBe(120);
  });
});
