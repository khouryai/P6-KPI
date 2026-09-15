/**
 * Reading team hours out of a real spreadsheet.
 *
 * The point of these tests is that nobody should have to reformat a working sheet
 * to get their numbers in. Both shapes the data actually arrives in, and every way
 * a month gets written, are read without being asked about.
 */
import { describe, it, expect } from 'vitest';
import { parseMonth, parseHours, parseTeamHours } from '../src/engine/teamHours';
import { parseDelimitedText } from '../src/engine/parse';

describe('reading a month', () => {
  it('reads every way a month gets written', () => {
    for (const [input, want] of [
      ['2026-08', '2026-08'],
      ['2026-8', '2026-08'],
      ['2026/08', '2026-08'],
      ['Aug-26', '2026-08'],
      ['aug 26', '2026-08'],
      ['August 2026', '2026-08'],
      ['Sept-26', '2026-09'],
      ['08/2026', '2026-08'],
      ['8-2026', '2026-08'],
      ['2026-08-15', '2026-08'],
      ['15-Aug-26', '2026-08'],
    ] as const) {
      expect(parseMonth(input), `${input}`).toBe(want);
    }
  });

  it('pivots a two digit year the way the rest of the app does', () => {
    expect(parseMonth('Aug-30')).toBe('2030-08');
    expect(parseMonth('Aug-99')).toBe('1999-08');
  });

  it('takes an Excel date value, and a Date object', () => {
    expect(parseMonth(45870)).toBe('2025-08');
    expect(parseMonth(new Date(2026, 7, 15))).toBe('2026-08');
  });

  it('refuses a month that is not one', () => {
    for (const bad of ['', '  ', 'Total', '2026-13', '13/2026', 'ATS', '40', '2026']) {
      expect(parseMonth(bad), `${bad}`).toBeNull();
    }
  });
});

describe('reading hours', () => {
  it('copes with how spreadsheets write numbers', () => {
    expect(parseHours('1,234.5')).toBe(1234.5);
    expect(parseHours(' 40 h ')).toBe(40);
    expect(parseHours('160 hrs')).toBe(160);
    expect(parseHours(320)).toBe(320);
    expect(parseHours('(12)')).toBe(-12); // a credit, written the accounting way
  });
  it('gives nothing for what is not a number', () => {
    for (const bad of ['', 'n/a', '-', 'TBC', null, undefined]) expect(parseHours(bad)).toBeNull();
  });
});

describe('months across the top', () => {
  const grid = parseDelimitedText(
    [
      'Resource group\tJun-26\tJul-26\tAug-26',
      'ATS\t420\t500\t610',
      'IXL\t300\t310\t280',
      'COMMS\t\t120\t140',
      'Total\t720\t930\t1030',
    ].join('\n'),
  );

  it('reads a person-by-month grid without being told the shape', () => {
    const out = parseTeamHours(grid);
    expect(out.layout).toBe('wide');
    expect(out.labelHeader).toBe('Resource group');
    expect(out.months).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('drops the totals row instead of double counting it', () => {
    const out = parseTeamHours(grid);
    expect(out.rows.some((r) => /total/i.test(r.label))).toBe(false);
    expect(out.rows.reduce((s, r) => s + r.hours, 0)).toBe(420 + 500 + 610 + 300 + 310 + 280 + 120 + 140);
  });

  it('skips a blank cell rather than recording a zero month', () => {
    const out = parseTeamHours(grid);
    expect(out.rows.filter((r) => r.label === 'COMMS').map((r) => r.month)).toEqual(['2026-07', '2026-08']);
  });
});

describe('one row per month', () => {
  it('reads a long list and finds the label column', () => {
    const grid = parseDelimitedText(
      ['Month\tEngineer\tSubsystem\tHours charged', 'Aug-26\tA. Smith\tATS\t160', 'Aug-26\tB. Jones\tIXL\t140'].join('\n'),
    );
    const out = parseTeamHours(grid);
    expect(out.layout).toBe('long');
    expect(out.rows).toEqual([
      { month: '2026-08', label: 'A. Smith', hours: 160 },
      { month: '2026-08', label: 'B. Jones', hours: 140 },
    ]);
  });

  it('finds the month column even when the header does not say so', () => {
    const grid = parseDelimitedText(['Period ending\tTeam\tActual hours', '2026-08-31\tATS\t500'].join('\n'));
    const out = parseTeamHours(grid);
    expect(out.rows).toEqual([{ month: '2026-08', label: 'ATS', hours: 500 }]);
  });

  it('counts what it could not read rather than dropping it silently', () => {
    const grid = parseDelimitedText(
      ['Month\tGroup\tHours', 'Aug-26\tATS\t160', 'whenever\tIXL\tlots', 'Sep-26\tIXL\t100'].join('\n'),
    );
    const out = parseTeamHours(grid);
    expect(out.rows.length).toBe(2);
    expect(out.skipped).toBe(1);
  });
});

describe('when it cannot tell', () => {
  it('says so rather than guessing', () => {
    expect(parseTeamHours([]).layout).toBe('none');
    expect(parseTeamHours(parseDelimitedText('just\tsome\twords\nwith\tno\tnumbers')).layout).toBe('none');
  });

  it('does not mistake a single month column for a wide sheet', () => {
    const grid = parseDelimitedText(['Month\tGroup\tHours', 'Aug-26\tATS\t160'].join('\n'));
    expect(parseTeamHours(grid).layout).toBe('long');
  });
});
