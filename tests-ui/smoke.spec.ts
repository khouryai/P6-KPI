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

test('the dashboard orders phases numerically, whole project first', async ({ page }) => {
  await open(page);
  await importSchedule(page, 'current', schedule({ finished: 4, ahead: 4 }));
  await page.goto('/#/dashboard');
  const names = await page.locator('button').filter({ hasText: /^(Whole project|Phase \d+)$/ }).allTextContents();
  expect(names[0]).toBe('Whole project');
  const numbers = names.slice(1).map((n) => Number(n.replace('Phase ', '')));
  expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
});
