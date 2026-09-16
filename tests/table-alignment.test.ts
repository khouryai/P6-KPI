/**
 * Column headings have to sit over their own data.
 *
 * This was wrong for every numeric column in the app, and the cause was pure CSS
 * cascade: `.tbl th` sets `text-align: left` and scores (0,1,1), while `.num` sets
 * `text-align: right` and scores only (0,1,0). The more specific rule won, so a
 * heading like "Budget h" sat at the LEFT of a column of right-aligned figures —
 * the headings looking offset from the data on Earned vs Built, Snapshots and every
 * other numeric table.
 *
 * The fix is a rule specific enough to win. Nothing in a unit test can see a browser
 * lay the page out, so these guard the two source-level facts the fix rests on: the
 * rule exists, and both the heading and the cell are still given the same class.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(process.cwd(), 'src/app/index.css'), 'utf8');
const ui = readFileSync(resolve(process.cwd(), 'src/app/components/ui.tsx'), 'utf8');

/** Crude specificity of a single compound selector: [classes, elements]. */
function score(selector: string): [number, number] {
  return [(selector.match(/\./g) ?? []).length, (selector.match(/(^|\s|\.)([a-z]+)(?=[.\s]|$)/g) ?? []).filter((t) => !t.includes('.')).length];
}

describe('numeric table headings', () => {
  it('are right-aligned by a rule specific enough to beat `.tbl th`', () => {
    const rule = /\.tbl\s+th\.num\s*\{[^}]*text-align:\s*right/.exec(css);
    expect(rule, '.tbl th.num must set text-align: right explicitly; `.num` alone loses to `.tbl th`').not.toBeNull();

    // And it really is more specific than the rule it has to beat.
    const [headingClasses, headingElements] = score('.tbl th');
    const [numClasses, numElements] = score('.tbl th.num');
    expect(numClasses).toBeGreaterThan(headingClasses);
    expect(numElements).toBe(headingElements);
  });

  it('are reached at all: the heading and the cell carry the same `num` class', () => {
    // th
    expect(ui).toMatch(/<th[\s\S]{0,200}?c\.num \? ' num' : ''/);
    // td
    expect(ui).toMatch(/<td[\s\S]{0,120}?c\.num \? 'num' : ''/);
  });

  it('reserve a fixed slot for the sort caret, so sorting cannot shift the headings', () => {
    // The caret is rendered whether or not this is the sorted column ...
    expect(ui).toMatch(/className="th-sort"/);
    expect(ui.match(/className="th-sort"/g)!.length).toBe(2); // once before the label, once after
    // ... and the slot has a width, or "reserved" would mean nothing.
    expect(css).toMatch(/\.th-sort\s*\{[^}]*width:/);
  });
});
