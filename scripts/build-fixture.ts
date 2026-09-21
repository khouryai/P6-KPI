/**
 * Builds the anonymised test fixture. Nothing here is real program data: the
 * locations, activity names, durations and dates are invented. The structure
 * mirrors a real P6 export pasted into Excel: indented Activity IDs, WBS rows with
 * rolled-up durations, mixed text and date cells, a two digit year in the 2030s,
 * (Deleted), (Cancelled), (by BART) rows, parenthetical variant families, a P6
 * constraint star on a date, and an activity missing from the baseline.
 *
 * Run: npx vite-node scripts/build-fixture.ts
 */
import * as XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const IND = ' '.repeat(20);
const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);
type Row = [string, string, number | null, number | null, unknown, unknown];

const current: Row[] = [
  ['Sample Program - Master Schedule', '', null, null, '31-Jan-25 A', D(2030, 8, 26)],
  ['  Phase 2', '', 1814, 1814, '31-Jan-25 A', D(2030, 8, 26)],
  ['    Phase 2 - A10', '', null, null, '03-Mar-25 A', D(2027, 1, 29)],
  [`${IND}0-P2-TC-A10-FA-0010`, '[T&C] A10 (Ph2) - Core Network Test', 12, 0, '03-Mar-25 A', '18-Mar-25 A'],
  [`${IND}0-P2-TC-A10-FA-0020`, '[T&C] A10 (Ph2) - Wayside SAT/SIT', 15, 0, '01-Apr-25 A', '21-Apr-25 A'],
  [`${IND}0-P2-TC-A10-FA-0030`, '[T&C] A10 (Ph2) - Pre-Simulation Test', 10, 4, '18-Aug-26 A', D(2026, 9, 4)],
  [`${IND}0-P2-TC-A10-FA-0040`, '[T&C] A10 (Ph2) - Sim Mode Test (Adjacent Location) (DF: A10 → B20)', 5, 5, D(2026, 10, 5), D(2026, 10, 9)],
  [`${IND}0-P2-TC-A10-FA-0050`, '[T&C] A10 (Ph2) - Cutover (by BART)', 20, 20, D(2027, 1, 4), D(2027, 1, 29)],
  [`${IND}0-P2-TC-A10-FA-0060`, '[T&C] A10 (Ph2) - Old Switch Test (Deleted)', 10, 0, '31-Jan-25 A', '31-Jan-25 A'],
  ['    Phase 2 - B20', '', null, null, D(2026, 10, 1), D(2027, 3, 12)],
  [`${IND}0-P2-TC-B20-FA-0010`, '[T&C] B20 (Ph2) - Core Network Test', 12, 12, D(2026, 11, 2), D(2026, 11, 17)],
  [`${IND}0-P2-TC-B20-FA-0020`, '[T&C] B20 (Ph2) - Wayside SAT/SIT', 15, 15, D(2027, 2, 1), D(2027, 2, 19)],
  [`${IND}0-P2-TC-B20-FA-0030`, '[T&C] B20 (Ph2) - Sim Mode Test (Adjacent Location) (DF: B20 → A10)', 5, 5, D(2026, 10, 12), D(2026, 10, 16)],
  [`${IND}0-P2-TC-B20-FA-0040`, '[T&C] B20 (Ph2) - Cutover (By BART)', 20, 20, D(2027, 3, 1), D(2027, 3, 26)],
  [`${IND}0-P2-TC-B20-FA-0050`, '[T&C] B20 (Ph2) - Wiring Prep (By Others)', 10, 10, D(2026, 10, 1), D(2026, 10, 14)],
  [`${IND}0-P2-TC-B20-FA-0060`, '[T&C] B20 (Ph2) - Long Hammock Support', 90, 90, D(2026, 10, 1), D(2027, 2, 5)],
  [`${IND}0-P2-TC-B20-FA-0070`, '[T&C] B20 (Ph2) - Regression Test', 10, 10, D(2027, 3, 1), D(2027, 3, 12)],
  ['    Phase 2 - C30', '', 600, 590, '31-Dec-25 A', D(2030, 8, 26)],
  [`${IND}0-P2-TC-C30-FA-0010`, '[T&C] C30 (Ph2) - Sim Mode Test (Adjacent Location) (DF: C30 → B20)', 5, 5, D(2027, 4, 5), D(2027, 4, 9)],
  [`${IND}0-P2-TC-C30-FA-0020`, '[T&C] C30 (Ph2) - Sim Mode Test (Adjacent Location) (DF: B20 → C30)', 5, 5, D(2027, 4, 12), D(2027, 4, 16)],
  [`${IND}0-P2-TC-C30-FA-0030`, '[T&C] C30 (Ph2) - Onboard Integration', 20, 20, D(2028, 6, 5), '26-Aug-30'],
  [`${IND}0-P2-TC-C30-FA-0040`, '[T&C] C30 (Ph2) - Database Survey', 15, 15, 46753, D(2028, 1, 21)],
  [`${IND}0-P2-TC-C30-FA-0050`, '[T&C] C30 (Ph2) - Milestone Release', 0, 0, '31-Dec-25 A', '31-Dec-25 A'],
  [`${IND}0-P2-TC-C30-FA-0060`, '[T&C] C30 (Ph2) - Core Network Test', 12, 12, '01-Oct-26*', D(2026, 10, 16)],
  [`${IND}0-P2-TC-C30-FA-0070`, '[T&C] C30 (Ph2) - Axle Test (Cancelled)', 10, 10, D(2027, 5, 3), D(2027, 5, 14)],
  ['    Phase 2 - D40', '', null, null, D(2029, 5, 1), D(2029, 5, 21)],
  [`${IND}0-P2-TC-D40-FA-0010`, '[T&C] D40 (Ph2) - Core Network Test', 12, 12, null, null],
  [`${IND}0-P2-TC-D40-FA-0020`, '[T&C] D40 (Ph2) - Wayside SAT/SIT', 15, 15, D(2029, 5, 1), D(2029, 5, 21)],
  [`${IND}0-P2-TC-D40-FA-0030`, '[T&C] D40 (Ph2) - Special Test (Ad hoc)', 5, 5, D(2029, 6, 4), D(2029, 6, 8)],
  ['    Phase 2 - E50', '', null, null, D(2028, 3, 6), D(2028, 3, 17)],
  [`${IND}0-P2-TC-E50-FA-0010`, '[T&C] E50 (Ph2) - Pre-Simulation Test', 10, 10, D(2028, 3, 6), D(2028, 3, 17)],
  [`${IND}0-P2-MS-0010`, '[MS] - Program Milestone', 0, 0, D(2030, 8, 26), D(2030, 8, 26)],
];

// Baseline: the same export taken earlier. Completed work keeps its dates; future
// work sits 14 days earlier so the forecast visibly lags the plan. One activity
// (D40-FA-0020) is absent from the baseline. Baseline IDs carry the same indent.
const shift = (v: unknown): unknown => (v instanceof Date ? new Date(v.getTime() - 14 * 86_400_000) : v);
const baseline: Row[] = current
  .filter((r) => !r[0].includes('D40-FA-0020'))
  .map((r) => [r[0], r[1], r[2], r[3], shift(r[4]), shift(r[5])] as Row);

const wb = XLSX.utils.book_new();
const header = ['Activity ID', 'Activity Name', 'Original Duration', 'Remaining Duration', 'Start', 'Finish'];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...current], { cellDates: true }), 'P6_Extract');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...baseline], { cellDates: true }), 'Baseline_Extract');
const outDir = resolve(process.cwd(), 'fixtures');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'tc-fixture.xlsx'), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer);

// A TSV version of the current sheet, as Excel would put it on the clipboard.
const tsvCell = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return `${v.getMonth() + 1}/${v.getDate()}/${v.getFullYear()}`;
  return String(v);
};
const tsv = [header, ...current].map((r) => r.map(tsvCell).join('\t')).join('\r\n') + '\r\n';
writeFileSync(resolve(outDir, 'tc-fixture-current.tsv'), tsv);

// A P6 .xer export of the same activities, so the native-format path has a fixture too.
// Durations are held in hours; two calendars exercise the per-calendar conversion.
const xerDate = (v: unknown): string => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')} 08:00`;
  if (typeof v === 'string' && v.trim() !== '') {
    const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2})( A)?\*?$/.exec(v.trim());
    if (m) {
      const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      let y = Number(m[3]) + 1900;
      if (y < 1950) y += 100;
      return `${y}-${String(months.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')} 08:00`;
    }
  }
  return '';
};
const isActual = (v: unknown): boolean => typeof v === 'string' && v.trim().endsWith(' A');
const TEN_HOUR = new Set(['0-P2-TC-C30-FA-0030']);
const xerLines: string[] = [
  'ERMHDR	19.12	2026-09-14	Project	admin	Sample	dbxDatabaseNoName	Project Management	USD',
  '%T	CALENDAR',
  '%F	clndr_id	clndr_name	day_hr_cnt',
  '%R	1	Standard 5 Day	8',
  '%R	2	Night Shift 10 Hour	10',
  '%T	PROJECT',
  '%F	proj_id	proj_short_name',
  '%R	100	SAMPLE-PH2',
  '%T	TASK',
  '%F	task_id	proj_id	clndr_id	task_code	task_name	target_drtn_hr_cnt	remain_drtn_hr_cnt	act_start_date	act_end_date	early_start_date	early_end_date',
];
let taskId = 1000;
for (const r of current) {
  if (r[1] === '') continue; // XER TASK holds activities only, never WBS summary rows
  const code = r[0].trim();
  const cal = TEN_HOUR.has(code) ? '2' : '1';
  const hpd = cal === '2' ? 10 : 8;
  const od = r[2] === null ? '' : String((r[2] as number) * hpd);
  const rd = r[3] === null ? '' : String((r[3] as number) * hpd);
  const s0 = xerDate(r[4]);
  const f0 = xerDate(r[5]);
  xerLines.push(
    ['%R', String(taskId++), '100', cal, code, r[1], od, rd, isActual(r[4]) ? s0 : '', isActual(r[5]) ? f0 : '', s0, f0].join('\t'),
  );
}
xerLines.push('%E');
writeFileSync(resolve(outDir, 'tc-fixture.xer'), xerLines.join('\r\n') + '\r\n');

// A sheet whose columns are in a different order, with two title rows above the header,
// to exercise header detection and the manual column mapping.
const shuffled: unknown[][] = [
  ['Sample Program - Progress Schedule (Master Live)', null, null, null, null, null],
  ['Data date 31-Aug-26', null, null, null, null, null],
  ['Activity Name', 'Start', 'Finish', 'Activity ID', 'Remaining Duration', 'Original Duration'],
  ...current.map((r) => [r[1], r[4], r[5], r[0], r[3], r[2]]),
];
const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, XLSX.utils.aoa_to_sheet(shuffled, { cellDates: true }), 'Export');
writeFileSync(resolve(outDir, 'tc-fixture-shuffled.xlsx'), XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx', cellDates: true }) as Buffer);

const inputs = {
  settings: {
    storageFolderName: 'TC-Budget',
    defaultBasis: 'DUR',
    defaultCrew: 2,
    defaultShiftHours: 8,
    defaultComplexity: 1.0,
    dataDate: '2026-08-31',
  },
  locations: [
    { code: 'A10', name: 'Alpha Interlocking' },
    { code: 'B20' },
    { code: 'C30', name: 'Charlie Yard', complexityFactor: 1.25 },
    { code: 'D40' },
    { code: 'E50' },
  ],
  library: [
    { matchKey: 'Core Network Test', discipline: 'DCS', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Wayside SAT/SIT', discipline: 'CBTC', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Pre-Simulation Test', discipline: 'IXL', basis: 'RATE', crewSize: 3, shiftHours: 10, durationShifts: 2 },
    { matchKey: 'Sim Mode Test (Adjacent Location)', discipline: 'IXL', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Cutover (by BART)' },
    { matchKey: 'Wiring Prep (By Others)' },
    { matchKey: 'Long Hammock Support' },
    { matchKey: 'Regression Test', basis: 'RATE', crewSize: 2, shiftHours: 10 },
    { matchKey: 'Onboard Integration', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 5 },
    { matchKey: 'Database Survey' },
    { matchKey: 'Milestone Release', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 2 },
    { matchKey: 'Program Milestone', basis: 'RATE', crewSize: 1, shiftHours: 8, durationShifts: 1 },
    // Each variant is priced in its own right. There is no tier 2 any more, so a key
    // that does not match an activity type exactly prices nothing: the four "(DF: ...)"
    // spellings each need their own entry, which is precisely the work the feature's
    // removal pushes onto whoever keeps the library.
    { matchKey: 'Sim Mode Test (Adjacent Location) (DF: A10 → B20)', discipline: 'IXL', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Sim Mode Test (Adjacent Location) (DF: B20 → A10)', discipline: 'IXL', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Sim Mode Test (Adjacent Location) (DF: C30 → B20)', discipline: 'IXL', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Sim Mode Test (Adjacent Location) (DF: B20 → C30)', discipline: 'IXL', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 },
    { matchKey: 'Special Test (Ad hoc)', retired: true },
  ],
  overrides: [{ activityId: '0-P2-TC-B20-FA-0060', overrideHours: 400, note: 'Hammock, agreed allowance' }],
  testProgress: [
    { activityId: '0-P2-TC-A10-FA-0010', pctOverride: 1, updatedAt: '2026-08-31T00:00:00Z' },
    { activityId: '0-P2-TC-A10-FA-0020', pctOverride: 1, testStartOverride: '2025-04-07', testEndOverride: '2025-04-25', updatedAt: '2026-08-31T00:00:00Z' },
    { activityId: '0-P2-TC-A10-FA-0030', pctOverride: 0.7, updatedAt: '2026-08-31T00:00:00Z' },
    { activityId: '0-P2-TC-C30-FA-0050', pctOverride: 1, updatedAt: '2026-08-31T00:00:00Z' },
    { activityId: '0-P2-TC-E50-FA-0010', pctOverride: 0.25, updatedAt: '2026-08-31T00:00:00Z' },
    // A WBS header and an Activity ID in no schedule: both keyed, both earning
    // nothing, and both there so the orphan checks have something to report.
    { activityId: '  Phase 2', pctOverride: 0.4, updatedAt: '2026-08-31T00:00:00Z' },
    { activityId: '0-P2-TC-Z99-FA-0010', pctOverride: 0.1, updatedAt: '2026-08-31T00:00:00Z' },
  ],
};
writeFileSync(resolve(outDir, 'fixture-inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
console.log(`fixture written: ${current.length} current rows, ${baseline.length} baseline rows, ${xerLines.length - 12} xer tasks`);
