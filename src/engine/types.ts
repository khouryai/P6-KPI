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

/**
 * One resource group on a crew: "1 ATS engineer". Subsystem is a free code the
 * user types (ATS, IXL, COMMS, ...); it is never a fixed list, so a new one can be
 * used the moment it is needed. shiftHours overrides the entry's for this line
 * only, for the case where one group works a shorter shift than the rest.
 */
export type CrewLine = { subsystem: string; count: number; shiftHours?: number };

/** An optional friendly name for a subsystem code. Codes work without one. */
export type Subsystem = { code: string; name?: string; notes?: string };

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
  /**
   * Total headcount, used when `crew` is not set. Kept for entries priced before
   * crews could be split by subsystem, and still the quickest way to price one.
   */
  crewSize?: number;
  /**
   * The crew broken down by subsystem. When present it REPLACES crewSize: the
   * headcount is the sum of the counts. This is what makes "one ATS and one IXL
   * engineer" different from "two people" when the question is workload per group.
   */
  crew?: CrewLine[];
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

/**
 * Hours a team actually built in a month, as reported by timesheets. One row per
 * month per subsystem, optionally per person. This is the "what it cost" side; the
 * budget is the "what it was worth" side.
 */
export type TeamActual = {
  id: string;
  month: string; // YYYY-MM
  subsystem: string; // '' when not attributed to one
  person?: string;
  hours: number;
  note?: string;
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
  /**
   * Budget hours split across the crew's subsystems. The parts always sum to
   * budgetHours exactly, including when budgetHours is a rounded or overridden
   * figure, so no rollup by subsystem can disagree with the total.
   * A crew with no breakdown lands entirely under '' (Unassigned).
   */
  subsystemHours: Record<string, number>;
  /** The same split applied to earned hours: each part times pctComplete. */
  subsystemEarned: Record<string, number>;
};

export type LibraryStat = {
  matchKey: string;
  count: number;
  totalP6Days: number;
  include: 'Y' | 'N';
  basisEff: Basis;
  /** Headcount: the sum of the crew lines when there is a breakdown. */
  crewEff: number;
  /** The crew breakdown in effect, empty when the entry is only a headcount. */
  crewEffLines: CrewLine[];
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

/**
 * Hours attributed to one subsystem. Unlike a GroupStat this is NOT a partition of
 * activities: one activity can feed several subsystems, so `activities` counts the
 * activities that draw on this group and the counts across groups will exceed the
 * number of activities. The HOURS still add back to the budget total exactly.
 */
export type SubsystemStat = {
  code: string;
  label: string;
  activities: number;
  budgetHours: number;
  earnedHours: number;
  remainingHours: number;
  pctComplete: number;
  /** Share of the whole budget. */
  shareOfBudget: number;
  /** The same hours cut by another dimension, for "ATS hours in Phase 2". */
  byPhase: SubsystemCell[];
  byLocation: SubsystemCell[];
};

export type SubsystemCell = {
  key: string;
  label: string;
  budgetHours: number;
  earnedHours: number;
  pctComplete: number;
};

/** Hours earned IN a month, not cumulative, split by subsystem. */
export type MonthlyEarned = {
  month: string; // YYYY-MM
  periodEnd: string; // ISO month end
  earned: number;
  bySubsystem: Record<string, number>;
};

/**
 * One month of earned against built. `built` is what the timesheets say the team
 * spent; `earned` is what the budget says that work was worth. Negative variance
 * means the month cost more hours than it earned.
 */
export type BurnRow = {
  month: string;
  earned: number;
  built: number;
  variance: number;
  cumEarned: number;
  cumBuilt: number;
  cumVariance: number;
  /** Earned per hour built for the month. null when nothing was built. */
  factor: number | null;
  bySubsystem: BurnCell[];
};

export type BurnCell = {
  code: string;
  label: string;
  earned: number;
  built: number;
  variance: number;
  factor: number | null;
};

/**
 * Earned against built, in full.
 *
 * `phasedEarned` is the earned hours the monthly rows account for. It can be less
 * than `totalEarned`, because an activity with a percent complete but no usable
 * dates earns hours that belong to no month. The gap is stated rather than hidden,
 * so the monthly table and the project totals can both be trusted.
 */
export type BurnSummary = {
  months: BurnRow[];
  totalEarned: number;
  phasedEarned: number;
  unphasedEarned: number;
  totalBuilt: number;
  /** The whole project. */
  project: Reforecast;
  bySubsystem: Reforecast[];
  /** Subsystems that built hours but hold no budget, so nothing can be earned there. */
  builtWithNoBudget: string[];
};

/**
 * Where the remaining work lands if the team keeps converting hours at the rate it
 * has so far. This is the earned-value estimate at completion, in hours.
 */
export type Reforecast = {
  code: string; // '' for the whole project, otherwise a subsystem code
  label: string;
  budgetHours: number;
  cumEarned: number;
  cumBuilt: number;
  /** Earned per hour built to date. Below 1.0 means hours cost more than they earn. */
  factor: number | null;
  remainingHours: number;
  /** Remaining budget at the rate achieved so far. */
  hoursToComplete: number | null;
  forecastTotalHours: number | null;
  /** Budget minus forecast. Negative means the job is forecast to overrun. */
  varianceAtCompletion: number | null;
};

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
  /** Library entries priced as a crew of named subsystems rather than a headcount. */
  typesWithCrewSplit: number;
  /** Budget hours not attributed to any subsystem. */
  unassignedHours: number;
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
  subsystems: SubsystemStat[];
  burn: BurnSummary;
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
  /**
   * Optional: every store written before subsystems existed has neither, and a
   * model without them is a perfectly valid model of a job nobody has split yet.
   */
  subsystems?: Subsystem[];
  teamActuals?: TeamActual[];
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
