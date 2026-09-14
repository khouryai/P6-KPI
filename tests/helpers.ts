import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readWorkbook, parseWorkbookSheet } from '../src/engine/workbook';
import type { ModelInput, P6Activity, Settings, Location, LibraryEntry, ActivityOverride, TestProgress, Snapshot } from '../src/engine/types';

export const FIXTURE_DIR = resolve(process.cwd(), 'fixtures');

export type FixtureInputs = {
  settings: Settings;
  locations: Location[];
  library: LibraryEntry[];
  overrides: ActivityOverride[];
  testProgress: TestProgress[];
  snapshots: Snapshot[];
};

export function loadFixtureInputs(): FixtureInputs {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'fixture-inputs.json'), 'utf8')) as FixtureInputs;
}

export function loadFixtureWorkbook() {
  const buf = readFileSync(resolve(FIXTURE_DIR, 'tc-fixture.xlsx'));
  const wb = readWorkbook(new Uint8Array(buf));
  return {
    current: parseWorkbookSheet(wb, 'P6_Extract'),
    baseline: parseWorkbookSheet(wb, 'Baseline_Extract'),
  };
}

export function loadExpected() {
  return JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'expected.json'), 'utf8')) as {
    summary: Record<string, number>;
    activities: Record<string, Record<string, unknown>>;
    curve: { periodEnd: string; planned: number; forecast: number; earned: number | null }[];
    locationsDiscovered: string[];
    typesDiscovered: string[];
  };
}

export function fixtureModelInput(overrides: Partial<ModelInput> = {}): ModelInput {
  const inputs = loadFixtureInputs();
  const wb = loadFixtureWorkbook();
  return {
    settings: inputs.settings,
    locations: inputs.locations,
    library: inputs.library,
    overrides: inputs.overrides,
    testProgress: inputs.testProgress,
    current: wb.current.activities,
    baseline: wb.baseline.activities,
    snapshots: inputs.snapshots,
    ...overrides,
  };
}

export function makeActivity(partial: Partial<P6Activity> & { activityId: string }): P6Activity {
  const name = partial.activityName ?? `[T&C] X10 (Ph2) - Test Type`;
  return {
    rawActivityId: partial.rawActivityId ?? partial.activityId,
    activityName: name,
    originalDuration: 10,
    remainingDuration: 10,
    startRaw: '',
    finishRaw: '',
    startDate: null,
    finishDate: null,
    actualStart: false,
    actualFinish: false,
    rowType: 'ACTIVITY',
    location: 'X10',
    seqCode: 'FA-0010',
    activityType: 'Test Type',
    excludeReason: null,
    sortOrder: 0,
    ...partial,
  };
}
