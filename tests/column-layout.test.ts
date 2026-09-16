/**
 * Choosing which columns a table shows, and in what order.
 *
 * The rules are small but they interact badly if you get them wrong, and one of
 * those wrong versions shipped for about ten minutes: `order` was doing double duty
 * as "columns this layout knows about", so hiding a single column wrote every key
 * into it and switched on five optional columns nobody had asked for. Hence the
 * separate on/off lists, and hence these.
 */
import { describe, it, expect } from 'vitest';
import { applyLayout, isVisible, type Column, type TableLayout } from '../src/app/components/ui';

type Row = { a: string };
const col = (key: string, extra: Partial<Column<Row>> = {}): Column<Row> => ({
  key,
  label: key,
  value: (r: Row) => r.a,
  ...extra,
});

const columns: Column<Row>[] = [
  col('id', { locked: true }),
  col('name'),
  col('loc'),
  col('od', { optional: true }),
  col('bls', { optional: true }),
];
const keys = (cs: Column<Row>[]) => cs.map((c) => c.key);
const layout = (l: Partial<TableLayout> = {}): TableLayout => ({ order: [], off: [], on: [], ...l });

describe('with no layout saved', () => {
  it('shows the ordinary columns in the order the screen declared them', () => {
    expect(keys(applyLayout(columns, null))).toEqual(['id', 'name', 'loc']);
  });
  it('leaves optional columns off until they are asked for', () => {
    expect(isVisible(col('od', { optional: true }), null)).toBe(false);
    expect(isVisible(col('name'), null)).toBe(true);
  });
});

describe('turning columns on and off', () => {
  it('hides what was switched off', () => {
    expect(keys(applyLayout(columns, layout({ off: ['loc'] })))).toEqual(['id', 'name']);
  });

  it('hiding one column does NOT drag the optional ones into view', () => {
    // The bug this file exists for. An order list naming every key must not be
    // read as consent to show the optional columns in it.
    const l = layout({ off: ['name'], order: ['id', 'name', 'loc', 'od', 'bls'] });
    expect(keys(applyLayout(columns, l))).toEqual(['id', 'loc']);
  });

  it('shows an optional column once it is explicitly switched on', () => {
    expect(keys(applyLayout(columns, layout({ on: ['od'] })))).toEqual(['id', 'name', 'loc', 'od']);
  });

  it('never hides a locked column, whatever the layout says', () => {
    expect(keys(applyLayout(columns, layout({ off: ['id', 'name', 'loc'] })))).toEqual(['id']);
  });
});

describe('ordering', () => {
  it('reorders by the stored keys', () => {
    expect(keys(applyLayout(columns, layout({ order: ['loc', 'name', 'id'] })))).toEqual(['loc', 'name', 'id']);
  });

  it('ignores keys for columns the table no longer has', () => {
    const l = layout({ order: ['gone', 'loc', 'name', 'id'] });
    expect(keys(applyLayout(columns, l))).toEqual(['loc', 'name', 'id']);
  });

  it('keeps a column the layout has never heard of in its declared position', () => {
    // A column added by a later version of the app. It should appear where the
    // screen put it, not be flung to one end of somebody's saved layout.
    const withNew = [...columns.slice(0, 2), col('added'), ...columns.slice(2)];
    const l = layout({ order: ['id', 'name', 'loc'] });
    expect(keys(applyLayout(withNew, l))).toContain('added');
  });

  it('leaves an optional column added by a later version switched off', () => {
    const withNew = [...columns, col('brandNew', { optional: true })];
    const l = layout({ order: ['id', 'name', 'loc'], on: ['od'] });
    expect(keys(applyLayout(withNew, l))).not.toContain('brandNew');
    expect(keys(applyLayout(withNew, l))).toContain('od');
  });
});

describe('a reset', () => {
  it('goes back to exactly what a fresh table shows', () => {
    expect(keys(applyLayout(columns, layout()))).toEqual(keys(applyLayout(columns, null)));
  });
});
