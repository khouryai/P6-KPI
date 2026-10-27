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
  ['schedule', 'Schedule'],
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
  ['staffing', 'Staffing Scenarios'],
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

/**
 * The whole P6 project in, the T&C slice of it to the budget, and the rest of it on
 * the Schedule screen. The fixture is the one file this suite reads from disk: an
 * XER is P6's own format, and building one here would be testing the builder.
 */
test('a whole-project XER feeds the budget its T&C activities and opens on the Schedule screen', async ({ page }) => {
  const errors = await open(page);
  await page.goto('/#/import');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'full-project.xer', mimeType: 'application/octet-stream', buffer: readFileSync('fixtures/full-project.xer') });
  await expect(page.getByText(/Which activities are the T&C budget/)).toBeVisible();
  await expect(page.getByText(/11 of 20 in the project/)).toBeVisible();
  await page.getByRole('button', { name: /^Confirm import/ }).click();
  await expect(page.getByText(/schedule imported: 11 activities from P6 project CBTC-PH2/i).first()).toBeVisible();

  await page.goto('/#/schedule');
  await expect(page.locator('.sched-row').first()).toBeVisible();
  await page.locator('.sched-row', { hasText: '0-P2-TC-B20-FA-0010' }).first().click();
  await expect(page.locator('.sched-details-head')).toContainText('Core Network Test');
  await page.getByRole('tab', { name: /Relationships/ }).click();
  await expect(page.locator('.sched-details-body')).toContainText('0-P2-IN-B20-FA-0010');
  await page.getByRole('button', { name: 'Trace driving path' }).click();
  await expect(page.getByText(/2 activities upstream of 0-P2-TC-B20-FA-0010/)).toBeVisible();

  await page.getByRole('tab', { name: 'T&C lookahead' }).click();
  await expect(page.getByText('Waiting on others').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Schedule checks' }).click();
  await expect(page.getByText('Out of sequence')).toBeVisible();

  // The budget's own screens carry what only the XER knows.
  await page.goto('/#/budget');
  await expect(page.getByText('Total float').first()).toBeVisible();
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
  await expect(page.locator('.report th', { hasText: 'Why behind' })).toHaveCount(1);
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
 * A P6 export can carry the same Activity ID on several rows. Each ID is imported
 * once, from its first row, and the table built from it still filters and sorts.
 */
test('a schedule with duplicate Activity IDs imports each once, and still filters and sorts', async ({ page }) => {
  await open(page);
  const rows: unknown[][] = [['Activity ID', 'Activity Name', 'Original Duration', 'Remaining Duration', 'Start', 'Finish']];
  for (let i = 0; i < 4; i++) rows.push(['0-P2-TC-A10-FA-0010', `[T&C] A10 - Core Network Test ${i}`, 10 + i, 0, '05-Jan-26 A', '16-Jan-26 A']);
  for (let i = 0; i < 4; i++) rows.push(['0-P5-TC-B20-FA-0010', `[T&C] B20 - Core Network Test ${i}`, 20 + i, 10, new Date(2027, 2, 1), new Date(2027, 2, 20)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'P6_Extract');
  await importSchedule(page, 'current', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer);

  await page.goto('/#/progress');
  const body = page.locator('.tbl tbody tr');
  await expect(body).toHaveCount(2);
  // Filtering to one phase must SHOW one phase, not leave the other phase's rows
  // stranded in the DOM.
  await page.locator('.page-toolbar select').first().selectOption('P2');
  await expect(body).toHaveCount(1);
  await page.locator('.page-toolbar select').first().selectOption('');
  await expect(body).toHaveCount(2);

  const th = page.locator('.tbl thead th').filter({ hasText: /budget h/i }).first();
  const col = async () => (await page.locator('.tbl tbody tr td:nth-child(4)').allInnerTexts()).map((t) => t.trim());
  await th.click();
  const asc = await col();
  await th.click();
  expect(await col()).toEqual([...asc].reverse());
});


/**
 * A location reported by its name, and an activity shared between two locations.
 * The name typed on the Locations screen replaces the code on the rollup, and a
 * split typed in Budget Master moves that share of the hours with it.
 */
test('a named location reports by its name, and a split activity puts its share there', async ({ page }) => {
  const errors = await open(page);
  await importSchedule(page, 'current', schedule({ finished: 2, ahead: 2 }));

  await page.goto('/#/locations');
  const a10 = page.locator('.tbl tbody tr').filter({ hasText: 'A10' });
  await a10.locator('input').first().fill('Millbury Station');
  await a10.locator('input').first().press('Enter');

  await page.goto('/#/budget');
  const first = page.locator('.tbl tbody tr').filter({ hasText: '0-P2-TC-A10-FA-0000' });
  const split = first.locator('input[placeholder="—"]').first();
  await split.fill('B20 50');
  await split.press('Enter');
  await expect(first.getByText('Millbury Station 50%, B20 50%').or(first.getByText('B20 50%, Millbury Station 50%'))).toBeVisible();

  await page.goto('/#/rollup');
  await page.getByRole('button', { name: 'Location', exact: true }).click();
  const groups = page.locator('.tbl tbody tr');
  await expect(groups.filter({ hasText: 'Millbury Station' })).toHaveCount(1);
  await expect(groups.filter({ hasText: /^A10/ })).toHaveCount(0);
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

/**
 * The scheduled Excel export. The folder picker is a native dialog no test can
 * click through, so it is stood in for by the browser's private file system, which
 * hands back a real directory handle the export writes into exactly as it would a
 * folder on disk. The clock is the browser's, moved on by the test.
 *
 * One thing that handle cannot do is go through IndexedDB. The app keeps the
 * chosen folder there — it has to, to remember it — and reads it back before every
 * export, and reading a private-file-system handle back out of IndexedDB kills
 * Chromium outright: the whole browser exits on a failed internal check (SIGTRAP),
 * headless shell and full build alike. That is why both export tests failed in CI
 * from the day they were added, as "session closed" right after the export click.
 * A real folder's handle round-trips fine, and that is all the app ever stores.
 *
 * So the stand-in goes into IndexedDB as a marker and comes back out as the live
 * handle. Every line of the app between the two — keeping the folder, reading it
 * back, asking for permission, writing the file — runs exactly as it does in use.
 */
async function standInFolder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const MARK = 'tc-test:picked-folder';
    const picked = navigator.storage.getDirectory().then((root) => root.getDirectoryHandle('picked', { create: true }));
    let live: FileSystemDirectoryHandle | null = null;
    void picked.then((h) => (live = h));
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = () => picked;

    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, ...key: [IDBValidKey?]) {
      return put.call(this, value instanceof FileSystemDirectoryHandle ? MARK : value, ...(key as [IDBValidKey]));
    };
    const result = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result')!;
    Object.defineProperty(IDBRequest.prototype, 'result', {
      ...result,
      get(this: IDBRequest) {
        const v = result.get!.call(this);
        return v === MARK ? live : v;
      },
    });
  });
}

/** The names in the stand-in folder: cheap, and safe to poll while an export is still writing. */
async function exportedNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('picked', { create: true });
    const out: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const name of (dir as any).keys()) out.push(name);
    return out.sort();
  });
}

/**
 * Every file in the stand-in folder, bytes and all, for when no export is running.
 * The bytes cross as base64: as a list of numbers, one 270 KB workbook took two
 * seconds to come back, and a poll whose every look takes that long misses a
 * deadline it should have met with time to spare.
 */
async function exportedFiles(page: Page): Promise<{ name: string; bytes: Buffer }[]> {
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('picked', { create: true });
    const out: { name: string; base64: string }[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name, h] of (dir as any).entries()) {
      if (h.kind !== 'file') continue;
      const file: File = await h.getFile();
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      out.push({ name, base64: url.slice(url.indexOf(',') + 1) });
    }
    return out;
  });
  return files.map((f) => ({ name: f.name, bytes: Buffer.from(f.base64, 'base64') }));
}

test('exports everything to a chosen folder by hand, and on the schedule set', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 21, 6, 57) });
  await standInFolder(page);
  const errors = await open(page);
  await importSchedule(page, 'current', schedule({ finished: 2, ahead: 2 }));

  await page.goto('/#/settings');
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Scheduled Excel export' }) });
  await card.getByRole('button', { name: 'Choose folder…' }).click();
  await expect(page.getByText('Excel exports will be saved in picked.')).toBeVisible();
  await card.getByRole('button', { name: 'Export now to this folder' }).click();
  await expect(page.getByText(/Excel export written to picked\\TC_Budget_Data_2026-10-21_/)).toBeVisible();

  const first = await exportedFiles(page);
  expect(first).toHaveLength(1);
  const wb = XLSX.read(new Uint8Array(first[0].bytes), { type: 'array' });
  expect(wb.SheetNames.slice(0, 3)).toEqual(['Contents', 'Data_Dictionary', 'Status_Codes']);
  expect(wb.SheetNames).toContain('All_Activities');

  // Every day at 07:00, one file replaced each time.
  await card.getByLabel('Files').selectOption('latest');
  await card.getByLabel('How often').selectOption('daily');
  await card.getByLabel('Time of day').fill('07:00');
  await card.getByLabel('Export automatically').check();
  await expect(page.getByText(/Exports every day at 07:00/)).toBeVisible();
  // Setting it at 06:57 owes nothing yet: yesterday's 07:00 came before the schedule did.
  await page.clock.fastForward('01:00');
  expect(await exportedNames(page)).not.toContain('TC_Budget_Data_latest.xlsx');

  await page.clock.fastForward('03:00');
  await expect.poll(() => exportedNames(page)).toContain('TC_Budget_Data_latest.xlsx');
  await expect(page.getByText(/Last export .*TC_Budget_Data_latest\.xlsx/)).toBeVisible();
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

/**
 * REVIEW says what it is and what to do, and one click answers it. Retiring the
 * only key in the library puts every activity in REVIEW, which is the situation
 * the panel exists for.
 */
test('REVIEW activities say why, and the panel answers them', async ({ page }) => {
  const errors = await open(page);
  await importSchedule(page, 'current', schedule({ finished: 2, ahead: 2 }));
  await page.goto('/#/library');
  await page.getByRole('button', { name: 'retire' }).first().click();

  await page.goto('/#/budget');
  await expect(page.getByText(/4 activities are in REVIEW: no rate/)).toBeVisible();
  await page.getByRole('link', { name: 'See what they are and what each needs' }).click();
  await expect(page.getByText('4 activities are in REVIEW — what they are and what to do')).toBeVisible();
  await expect(page.getByText('Its key was retired').first()).toBeVisible();
  await expect(page.locator('.tbl tbody tr').filter({ hasText: '0-P2-TC-A10-FA-000' }).first()).toContainText('has an Activity Library key that was retired');

  await page.goto('/#/dashboard');
  await expect(page.getByText(/What the percent complete counts/)).toBeVisible();
  await expect(page.getByRole('link', { name: '4 in REVIEW' })).toBeVisible();

  await page.goto('/#/budget?flag=review');
  await page.getByRole('button', { name: 'Restore key' }).click();
  await expect(page.getByText(/retired key restored/)).toBeVisible();
  await expect(page.getByText(/in REVIEW — what they are/)).toHaveCount(0);
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

/**
 * A missed reason is the activity's, whatever reporting date the log is set to:
 * given at one date, it shows at another, and can be changed and cleared there.
 */
test('the Two-Week Log changes and clears a reason from any reporting date', async ({ page }) => {
  const errors = await open(page);
  const rows: unknown[][] = [['Activity ID', 'Activity Name', 'Original Duration', 'Remaining Duration', 'Start', 'Finish']];
  rows.push(['0-P2-TC-A10-FA-0010', '[T&C] A10 - Core Network Test', 5, 5, new Date(2026, 8, 14), new Date(2026, 8, 18)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'P6_Extract');
  await importSchedule(page, 'current', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer);
  await page.goto('/#/settings');
  const dataDate = page.locator('input[type=date]').first();
  await dataDate.fill('2026-09-23');
  await dataDate.dispatchEvent('change');

  await page.goto('/#/period');
  const ending = page.getByLabel('Ending');
  const why = () =>
    page.locator('.tbl tbody tr').filter({ hasText: '0-P2-TC-A10-FA-0010' }).locator('select').filter({ has: page.locator('option', { hasText: '— why? —' }) });
  await ending.fill('2026-09-23');
  await why().selectOption('Weather');

  // Another reporting date: the same answer, editable, not greyed.
  await ending.fill('2026-09-25');
  await expect(why()).toHaveValue('Weather');
  await expect(why()).toBeEnabled();
  await expect(why()).not.toHaveClass(/is-carried/);
  await why().selectOption('Access not available');
  await ending.fill('2026-09-23');
  await expect(why()).toHaveValue('Access not available');

  // Cleared at one date is cleared at every date.
  await ending.fill('2026-09-25');
  page.once('dialog', (d) => void d.accept());
  await why().selectOption('');
  await expect(why()).toHaveValue('');
  await ending.fill('2026-09-23');
  await expect(why()).toHaveValue('');
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

/**
 * The S-curve picture: the phases ticked, stacked one above the other, written to
 * the Excel export's folder as SCurve_Latest.png.
 */
test('exports an S-curve per phase chosen, stacked, as SCurve_Latest.png', async ({ page }) => {
  await standInFolder(page);
  const errors = await open(page);
  await importSchedule(page, 'current', schedule({ finished: 2, ahead: 2 }));
  await page.goto('/#/settings');
  const dataDate = page.locator('input[type=date]').first();
  await dataDate.fill('2026-09-23');
  await dataDate.dispatchEvent('change');

  const excel = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Scheduled Excel export' }) });
  await excel.getByRole('button', { name: 'Choose folder…' }).click();
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Scheduled S-curve export' }) });
  await card.getByLabel('Whole project').uncheck();
  await card.getByLabel('Phase 2').check();
  await card.getByLabel('Phase 5').check();
  await card.getByRole('button', { name: 'Export now to this folder' }).click();
  await expect(page.getByText(/S-curve export written to picked\\SCurve_Latest\.png/)).toBeVisible();

  const files = await exportedFiles(page);
  const png = files.find((f) => f.name === 'SCurve_Latest.png');
  expect(png, 'SCurve_Latest.png was not written').toBeTruthy();
  const bytes = new Uint8Array(png!.bytes);
  expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  // Two charts stacked: well over twice the height of one 380 px chart, at 2x.
  expect(width).toBeGreaterThan(2000);
  expect(height).toBeGreaterThan(2 * 380 * 2);
  expect(errors, 'a screen threw while rendering').toEqual([]);
});

/** Static / Dynamic, set on a library key and overridden on one activity, splits the rollup. */
test('Static / Dynamic is set in the library, overridden in Budget Master, and splits the rollup', async ({ page }) => {
  const errors = await open(page);
  await importSchedule(page, 'current', schedule({ finished: 2, ahead: 2 }));
  await page.goto('/#/library');
  await page.locator('.tbl tbody tr').first().locator('select').first().selectOption('STATIC');
  await page.goto('/#/budget');
  const row = page.locator('.tbl tbody tr').filter({ hasText: '0-P5-TC-B20-FA-000' }).first();
  await row.locator('select').filter({ has: page.locator('option', { hasText: 'Auto (Static)' }) }).selectOption('DYNAMIC');
  await expect(row.getByText('yours')).toBeVisible();
  await page.goto('/#/rollup');
  await page.getByRole('button', { name: 'Static / Dynamic', exact: true }).click();
  const groups = page.locator('.tbl tbody tr');
  await expect(groups.filter({ hasText: 'Static' })).toHaveCount(1);
  await expect(groups.filter({ hasText: 'Dynamic' })).toHaveCount(1);
  expect(errors, 'a screen threw while rendering').toEqual([]);
});
