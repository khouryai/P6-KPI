/**
 * Exporting a table.
 *
 * The promise is that the spreadsheet matches the screen. A person who has picked
 * columns, moved two to the front and filtered to one phase has already said what
 * they want out of the table; an export that ignored all of it and dumped every
 * field would be a different document they then have to edit down. So the sheet is
 * built from the SHOWING columns in their SHOWING order, and its cells come from
 * the same raw value the column sorts on rather than the badge drawn over it.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { applyLayout, tableToSheet, type Column, type TableLayout } from '../src/app/components/ui';

type Row = { id: string; name: string; hours: number; phase: string };

const rows: Row[] = [
  { id: 'A-1', name: 'Static test, W40 interlocking', hours: 24, phase: 'Phase 2' },
  { id: 'A-2', name: 'Dynamic test', hours: 8.5, phase: 'Phase 3' },
];

const columns: Column<Row>[] = [
  { key: 'id', label: 'Activity ID', locked: true, value: (r) => r.id },
  { key: 'name', label: 'Activity name', value: (r) => r.name },
  // Rendered as a badge on screen; the export must take the value underneath it.
  { key: 'phase', label: 'Phase', value: (r) => r.phase, render: () => null },
  { key: 'hours', label: 'Budget h', value: (r) => r.hours, num: true },
  { key: 'act', label: '', value: () => '', optional: true },
];

const grid = (ws: XLSX.WorkSheet) => XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

describe('the sheet a table exports', () => {
  it('carries the visible columns as its header, in order', () => {
    expect(grid(tableToSheet(rows, columns.slice(0, 4)))[0]).toEqual(['Activity ID', 'Activity name', 'Phase', 'Budget h']);
  });

  it('writes numbers as numbers, so the spreadsheet can add them up', () => {
    const body = grid(tableToSheet(rows, columns.slice(0, 4)))[1];
    expect(body[3]).toBe(24);
    expect(typeof body[3]).toBe('number');
  });

  it('takes the value under a rendered cell, not the rendering', () => {
    expect(grid(tableToSheet(rows, columns.slice(0, 4)))[1][2]).toBe('Phase 2');
  });

  it('prefers an explicit export value where the column gives one', () => {
    const col: Column<Row> = { key: 'pct', label: 'Done', value: (r) => r.hours, exportValue: (r) => `${r.hours} h` };
    expect(grid(tableToSheet(rows, [col]))[1][0]).toBe('24 h');
  });

  it('exports exactly what the layout shows, in the order it shows it', () => {
    // Hide the name, bring the hours to the front: what comes out is what is read.
    const layout: TableLayout = { order: ['hours', 'id', 'phase'], off: ['name'], on: [] };
    const showing = applyLayout(columns, layout);
    const out = grid(tableToSheet(rows, showing));
    expect(out[0]).toEqual(['Budget h', 'Activity ID', 'Phase']);
    expect(out[1]).toEqual([24, 'A-1', 'Phase 2']);
  });

  it('names an unlabelled column rather than writing an empty header', () => {
    expect(grid(tableToSheet(rows, [columns[4]]))[0]).toEqual(['Actions']);
  });

  it('gives every column a width, so nothing lands in Excel already cut off', () => {
    const ws = tableToSheet(rows, columns.slice(0, 4));
    const widths = (ws['!cols'] ?? []).map((c) => c?.wch ?? 0);
    expect(widths).toHaveLength(4);
    // The long activity name has to be given more room than the short ID.
    expect(widths[1]).toBeGreaterThan(widths[0]);
  });

  it('writes a header and nothing else when everything is filtered out', () => {
    expect(grid(tableToSheet([], columns.slice(0, 4)))).toHaveLength(1);
  });
});
