/**
 * Every screen opens, and the paths that carry data through the application work.
 *
 * Deliberately shallow. The engine is covered by 447 unit tests that run in a
 * second; what those cannot catch is a screen that throws on render, a route that
 * no longer resolves, or a lazily-loaded chunk that fails to arrive. That is what
 * this is for, and going deeper here would buy slow duplicates of tests that
 * already exist.
 */
import { test, expect, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

/** A small schedule, built in memory so the suite carries no fixture files. */
function schedule(opts: { finished: number; ahead: number }): Buffer {
  const rows: unknown[][] = [['Activity ID', 'Activity Name', 'Original Duration', 'Remaining Duration', 'Start', 'Finish']];
  for (let i = 0; i < opts.finished; i++) {
    rows.push([`0-P2-TC-A10-FA-00${i}0`, '[T&C] A10 - Core Network Test', 10, 0, '05-Jan-26 A', '16-Jan-26 A']);
  }
  for (let i = 0; i < opts.ahead; i++) {
    rows.push([`0-P5-TC-B20-FA-00${i}0`, '[T&C] B20 - Core Network Test', 10, 10, new Date(2027, 2, 1), new Date(2027, 2, 20)]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'P6_Extract');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer;
}

/** Open the app with nothing saved, which is the state a first run is in. */
async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Just look around' }).click();
  await expect(page.locator('.sidenav')).toBeVisible();
  return errors;
}

/** The as-of date of the export. Without one nothing in-progress can earn. */
async function setDataDate(page: Page, iso: string) {
  await page.goto('/#/settings');
  await page.getByRole('textbox', { name: 'Data date' }).fill(iso);
  await expect(page.getByText(/saved/i).first()).toBeVisible();
}

async function importSchedule(page: Page, kind: 'current' | 'baseline', bytes: Buffer, name = 'schedule.xlsx') {
  await page.goto('/#/import');
  await page.getByRole('button', { name: kind === 'baseline' ? 'Baseline schedule' : 'Current schedule' }).click();
  await page.locator('input[type=file]').first().setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes });
  await page.getByRole('button', { name: /^Confirm import/ }).click();
  await expect(page.getByText(/schedule imported/i).first()).toBeVisible();
}

const SCREENS = [
  ['dashboard', 'Dashboard'],
  ['import', 'Import'],
  ['library', 'Activity Library'],
  ['locations', 'Locations'],
  ['subsystems', 'Resources'],
  ['budget', 'Budget Master'],
  ['rollup', 'Progress by phase'],
  ['progress', 'Progress'],
  ['period', 'Two-Week Log'],
  ['team', 'Earned vs Actual'],
  ['capacity', 'Capacity'],
  ['report', 'Status Report'],
  ['idrules', 'Activity ID Rules'],
  ['settings', 'Settings'],
] as const;

test('every screen opens with no schedule at all', async ({ page }) => {
  const errors = await open(page);
  for (const [route, heading] of SCREENS) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('h1').first(), `${route} did not render`).toHaveText(heading);
  }
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

test('every screen opens with a schedule loaded', async ({ page }) => {
  const errors = await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  await page.goto('/#/settings');
  const dataDate = page.locator('input[type=date]').first();
  await dataDate.fill('2026-09-23');
  await dataDate.dispatchEvent('change');

  for (const [route, heading] of SCREENS) {
    await page.goto(`/#/${route}`);
    await expect(page.locator('h1').first(), `${route} did not render`).toHaveText(heading);
  }
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

test('an import says what it changes before it is confirmed', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  // The same schedule with one activity fewer and two more: three changes to report.
  await page.goto('/#/import');
  await page.getByRole('button', { name: 'Current schedule' }).click();
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'next.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: schedule({ finished: 3, ahead: 6 }),
  });
  await expect(page.getByText('What this changes')).toBeVisible();
  await expect(page.getByText('New activities')).toBeVisible();
  await expect(page.getByText('Gone from the schedule')).toBeVisible();
});

test('the status report prints without the application around it', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  await page.goto('/#/report');
  await expect(page.locator('.report')).toBeVisible();
  // On screen the builder is there; on paper only the report survives.
  await expect(page.locator('.no-print').first()).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidenav')).toBeHidden();
  await expect(page.locator('.no-print').first()).toBeHidden();
  await expect(page.locator('.report')).toBeVisible();
});

/**
 * The report is written for a phase and a fortnight. The whole job's position is
 * the one thing on the Dashboard already, so it is not what somebody gets handed
 * by accident — and a curve nobody asked for is the easiest thing to leave on.
 */
test('the status report starts with no whole-project curve, and draws one when asked', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  await setDataDate(page, '2026-09-23');
  await page.goto('/#/report');
  await expect(page.locator('.report .recharts-wrapper')).toHaveCount(0);
  await expect(page.getByText('No curve on the page yet')).toBeVisible();
  await expect(page.getByText('Where the job stands')).toBeHidden();

  await page.locator('.no-print').getByRole('button', { name: 'Whole project' }).click();
  await expect(page.locator('.report .recharts-wrapper')).toHaveCount(1);
  // The date, not just the words: on paper nobody can hover the line.
  await expect(page.locator('.report text', { hasText: /^DATA DATE / })).toHaveCount(1);
});

test('the status report saves the whole page as a PNG, at the size it will be placed', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  await page.goto('/#/report');
  await page.locator('.no-print').getByRole('button', { name: 'Whole project' }).click();
  await expect(page.locator('.report .recharts-wrapper')).toHaveCount(1);
  await page.locator('.no-print select').filter({ hasText: 'Word page' }).selectOption('portrait');

  const files: import('@playwright/test').Download[] = [];
  page.on('download', (d) => files.push(d));
  await page.getByRole('button', { name: 'Save as PNG' }).click();
  await expect.poll(() => files.length, { timeout: 30_000 }).toBeGreaterThan(0);

  const bytes = readFileSync((await files[0].path())!);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // A picture of a chart alone would be a fraction of this.
  expect(bytes.length).toBeGreaterThan(60_000);

  /*
   * The whole point of the size work: a PNG with no pHYs chunk claims no physical
   * size, Word assumes 96 dpi, and a report two thousand pixels wide is shrunk by
   * four to fit the text column — which is what "the quality is very poor" was.
   */
  const width = bytes.readUInt32BE(16);
  const phys = bytes.indexOf(Buffer.from('pHYs'));
  expect(phys, 'the PNG must say how big it really is').toBeGreaterThan(0);
  const perMetre = bytes.readUInt32BE(phys + 4);
  expect(bytes[phys + 12]).toBe(1); // the unit is the metre
  const inches = width / (perMetre / 39.3701);
  expect(inches).toBeGreaterThan(6.3);
  expect(inches).toBeLessThan(6.7);
});

/**
 * The fortnight is the review, so it leads; the curves follow it; the phase table
 * is the closing position. Somebody handed the page reads it in that order.
 */
test('the status report puts the fortnight first and the phase table last', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'baseline', schedule({ finished: 3, ahead: 2 }));
  await importSchedule(page, 'current', schedule({ finished: 3, ahead: 2 }));
  await page.goto('/#/report');
  await page.locator('.no-print input[type=date]').fill('2026-01-16');
  await page.locator('.no-print').getByRole('button', { name: 'Whole project' }).click();
  await expect(page.locator('.report .recharts-wrapper')).toHaveCount(1);

  const order = await page.locator('.report').evaluate((el) => {
    const marks = [
      ['log', '[data-paint="activities"]'],
      ['curve', '.recharts-wrapper'],
      ['phases', '[data-paint="phases"]'],
    ] as const;
    return marks.map(([name, sel]) => [name, el.querySelector(sel)] as const)
      .filter(([, node]) => !!node)
      .sort((a, b) => (a[1]!.compareDocumentPosition(b[1]!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map(([name]) => name);
  });
  expect(order).toEqual(['log', 'curve', 'phases']);
});

/**
 * The complaint this rebuild came from: a tally of reasons under the period
 * heading cannot be read against the activity that slipped.
 */
test('the status report puts the reason an activity was missed on its own row', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'baseline', schedule({ finished: 3, ahead: 2 }));
  await importSchedule(page, 'current', schedule({ finished: 3, ahead: 2 }));
  await page.goto('/#/report');
  // Onto a period the fixture's activities actually fall in.
  await page.locator('.no-print input[type=date]').fill('2026-01-16');
  await expect(page.locator(String.raw`.report .tbl`).last()).toBeVisible();
  // The answer sits on the activity, not in a tally somewhere above it.
  await expect(page.locator('.report th', { hasText: 'Why missed' })).toHaveCount(1);
  await expect(page.locator('.report th', { hasText: 'Outcome' })).toHaveCount(1);
});

test('the dashboard orders phases numerically, whole project first', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  await page.goto('/#/dashboard');
  const names = await page.locator('button').filter({ hasText: /^(Whole project|Phase \d+)$/ }).allTextContents();
  expect(names[0]).toBe('Whole project');
  const numbers = names.slice(1).map((n) => Number(n.replace('Phase ', '')));
  expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
});

/**
 * A P6 export can carry the same Activity ID twice. That used to make every table
 * on every screen stop obeying: React reconciles rows by key, so duplicate keys
 * left stale <tr> elements behind — filter the table and the row count went UP,
 * sort it and ascending and descending drew the same thing.
 */
test('a schedule with duplicate Activity IDs still filters and sorts', async ({ page }) => {
  await open(page);
  const rows: unknown[][] = [['Activity ID', 'Activity Name', 'Original Duration', 'Remaining Duration', 'Start', 'Finish']];
  for (let i = 0; i < 4; i++) rows.push(['0-P2-TC-A10-FA-0010', `[T&C] A10 - Core Network Test ${i}`, 10 + i, 0, '05-Jan-26 A', '16-Jan-26 A']);
  for (let i = 0; i < 4; i++) rows.push(['0-P5-TC-B20-FA-0010', `[T&C] B20 - Core Network Test ${i}`, 20 + i, 10, new Date(2027, 2, 1), new Date(2027, 2, 20)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'P6_Extract');
  await importSchedule(page, 'current', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer);

  await page.goto('/#/progress');
  const body = page.locator('.tbl tbody tr');
  await expect(body).toHaveCount(8);
  // Filtering to one phase must SHOW one phase, not leave the other phase's rows
  // stranded in the DOM.
  await page.locator('.page-toolbar select').first().selectOption('P2');
  await expect(body).toHaveCount(4);
  await page.locator('.page-toolbar select').first().selectOption('');
  await expect(body).toHaveCount(8);

  const th = page.locator('.tbl thead th').filter({ hasText: /budget h/i }).first();
  const col = async () => (await page.locator('.tbl tbody tr td:nth-child(4)').allInnerTexts()).map((t) => t.trim());
  await th.click();
  const asc = await col();
  await th.click();
  expect(await col()).toEqual([...asc].reverse());
});

