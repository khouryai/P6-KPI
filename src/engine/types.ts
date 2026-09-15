/**
 * Domain types. These are serialised as-is to the JSON files in the OneDrive store.
 * Dates are ISO calendar dates (YYYY-MM-DD) unless stated otherwise.
 */

export type Basis = 'RATE' | 'DUR';

export type Settings = {
  storageFolderName: string;
  defaultBasis: Basis; // 'DUR'
  defaultCrew: number; // 2
  defaultShiftHours: number; // 8
  defaultComplexity: number; // 1.00
  loeDurationDays: number; // 60
  dataDate: string; // ISO date, end of the earned curve
  statusDate: string; // ISO date, used when taking a snapshot
};

export type Location = {
  code: string; // W40, discovered from Activity IDs
  name?: string;
  complexityFactor?: number; // undefined means use defaultComplexity
};

export type LibraryEntry = {
  matchKey: string; // stripped activity type, first-seen spelling
  discipline?: string;
  includeOverride?: 'Y' | 'N'; // undefined means auto
  basis?: Basis; // undefined means defaultBasis
  crewSize?: number;
  shiftHours?: number;
  durationShifts?: number;
  notes?: string;
  /** A key the user consolidated away. Never re-added by import; resolves through tier 2 or REVIEW. */
  retired?: boolean;
};

export type RowType = 'WBS' | 'ACTIVITY';
export type ExcludeReason = 'DELETED' | 'CANCELLED' | null;

export type P6Activity = {
  rawActivityId: string; // EXACTLY as exported, leading spaces intact
  activityId: string; // trimmed, join on this
  activityName: string;
  originalDuration: number | null;
  remainingDuration: number | null;
  startRaw: string;
  finishRaw: string;
  startDate: string | null; // ISO
  finishDate: string | null; // ISO
  actualStart: boolean;
  actualFinish: boolean;
  rowType: RowType;
  location: string;
  seqCode: string;
  activityType: string;
  excludeReason: ExcludeReason;
  sortOrder: number; // preserve export order
};

export type ImportKind = 'current' | 'baseline';

export type ScheduleImport = {
  id: string;
  kind: ImportKind;
  importedAt: string; // ISO datetime
  sourceFilename: string;
  rowCount: number;
  activities: P6Activity[];
};

export type ImportIndexEntry = Omit<ScheduleImport, 'activities'> & { file: string };

export type ActivityOverride = { activityId: string; overrideHours: number; note?: string };

export type TestProgress = {
  activityId: string;
  testsTotal?: number;
  testsComplete?: number;
  pctOverride?: number; // 0 to 1
  testStartOverride?: string; // ISO
  testEndOverride?: string; // ISO
  updatedAt: string;
};

export type SnapshotLine = {
  activityId: string;
  pctComplete: number;
  budgetHours: number;
  earnedHours: number;
};

export type Snapshot = {
  statusDate: string;
  takenAt: string;
  note?: string;
  lines: SnapshotLine[];
};

// ---------------------------------------------------------------------------
// Computed model
// ---------------------------------------------------------------------------

export type ActivityStatus = 'IN BUDGET' | 'EXCLUDED' | 'REVIEW' | 'DELETED' | 'CANCELLED';
export type RateStatus = 'SET' | 'DEFAULT' | 'NEEDS SHIFTS' | 'EXCLUDED' | 'NO MATCH';
export type BaselineSource = 'BASELINE' | 'CURRENT' | 'NONE';
export type PctSource = 'OVERRIDE' | 'TESTS' | 'P6';
export type EarnWindowSource = 'TEST WINDOW' | 'P6 ACTUAL' | 'IN PROGRESS' | 'NOT STARTED';
export type MatchTier = 1 | 2 | null;

export type BudgetRow = {
  activity: P6Activity;
  activityId: string;
  location: string;
  /** Raw 2nd segment of the Activity ID, e.g. "P2". Derived, never stored. */
  phase: string;
  /** "P2" shown as "Phase 2". */
  phaseName: string;
  /** Raw 3rd segment, e.g. "TC" or "AC". */
  workType: string;
  seqCode: string;
  activityType: string;
  matchKey: string; // resolved key, library spelling when matched
  matchTier: MatchTier;
  rateStatus: RateStatus;
  status: ActivityStatus;
  discipline: string;
  basis: Basis | null;
  loeFlag: boolean;
  needsShifts: boolean;
  complexity: number | null;
  stdHours: number | null;
  overrideHours: number | null;
  budgetHours: number;
  baselineStart: string | null;
  baselineFinish: string | null;
  baselineSource: BaselineSource;
  currentStart: string | null;
  currentFinish: string | null;
  pctComplete: number;
  pctSource: PctSource;
  /** Test case counts as keyed on the Test Progress screen, when present. */
  testsTotal: number | null;
  testsComplete: number | null;
  hasTestCounts: boolean;
  earnedHours: number;
  remainingHours: number;
  earnStart: string | null;
  earnEnd: string | null;
  earnWindowSource: EarnWindowSource;
  onPlannedCurve: boolean;
  onForecastCurve: boolean;
};

export type LibraryStat = {
  matchKey: string;
  count: number;
  totalP6Days: number;
  include: 'Y' | 'N';
  basisEff: Basis;
  crewEff: number;
  shiftEff: number;
  rateStatus: RateStatus;
  stdHoursIfRate: number | null;
  budgetHours: number; // sum across activities resolved to this key
  entry: LibraryEntry;
};

export type LocationStat = {
  code: string;
  count: number;
  effectiveFactor: number;
  budgetHours: number;
  location: Location;
};

/** A dimension the budget can be rolled up by. */
export type GroupDim = 'phase' | 'location' | 'discipline' | 'workType';

export type GroupStat = {
  key: string;
  label: string;
  activities: number;
  inBudget: number;
  budgetHours: number;
  earnedHours: number;
  remainingHours: number;
  pctComplete: number;
  notStarted: number;
  inProgress: number;
  finished: number;
  /** In-budget activities that have test case counts keyed. */
  withCounts: number;
  testsTotal: number;
  testsComplete: number;
  earliestStart: string | null;
  latestFinish: string | null;
};

export type CurvePoint = {
  periodEnd: string; // ISO month end
  planned: number;
  forecast: number;
  earned: number | null; // null after the data date
  plannedPct: number;
  earnedPct: number | null;
  snapshot: number | null; // sum of snapshot earned hours at this date, if a snapshot exists
};

export type SnapshotMarker = { statusDate: string; earnedHours: number; budgetHours: number };

export type Summary = {
  extractRows: number;
  wbsRows: number;
  activities: number;
  locations: number;
  activityTypes: number;
  typesOnDefaults: number;
  typesNeedingShifts: number;
  inBudget: number;
  excluded: number;
  deletedOrCancelled: number;
  review: number;
  totalBudgetHours: number;
  earnedHours: number;
  remainingHours: number;
  pctComplete: number;
  baselineMatched: number;
  baselineFallback: number;
  noDates: number;
  pctFromTests: number;
  pctFromP6: number; // in budget only
  pctFromOverride: number;
  inProgress: number;
  p6Actual: number;
  testWindow: number;
  notStarted: number;
  testProgressKeyed: number;
  testProgressNotMatching: number;
  testProgressUsingOverride: number;
  loeFlags: number;
  rateNeedsShifts: number; // activities in budget whose library entry needs shifts
  tier2Resolved: number;
  onNoCurve: number; // in-budget activities with hours that appear on neither curve
  latestStatusDate: string | null;
};

export type TestProgressCheck = {
  activityId: string;
  matched: boolean;
  status: ActivityStatus | 'not budgeted' | 'not in extract';
  activityName: string | null;
  pctEffective: number | null;
};

export type Model = {
  rows: BudgetRow[];
  /** Rollups by every dimension, so screens never group by hand. */
  groups: Record<GroupDim, GroupStat[]>;
  library: LibraryStat[];
  locations: LocationStat[];
  curve: CurvePoint[];
  snapshotMarkers: SnapshotMarker[];
  summary: Summary;
  testProgressChecks: TestProgressCheck[];
  notes: string[];
};

export type ModelInput = {
  settings: Settings;
  locations: Location[];
  library: LibraryEntry[];
  overrides: ActivityOverride[];
  testProgress: TestProgress[];
  current: P6Activity[];
  baseline: P6Activity[] | null;
  snapshots: Snapshot[];
};

export const DEFAULT_SETTINGS: Settings = {
  storageFolderName: 'TC-Budget',
  defaultBasis: 'DUR',
  defaultCrew: 2,
  defaultShiftHours: 8,
  defaultComplexity: 1.0,
  loeDurationDays: 60,
  dataDate: '',
  statusDate: '',
};
