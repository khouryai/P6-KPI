/**
 * Domain types. These are serialised as-is to the JSON files in the OneDrive store.
 * Dates are ISO calendar dates (YYYY-MM-DD) unless stated otherwise.
 */
import type { Cadence } from './dates';

export type { Cadence };

export type Basis = 'RATE' | 'DUR';

export type Settings = {
  storageFolderName: string;
  defaultBasis: Basis; // 'DUR'
  defaultCrew: number; // 2
  defaultShiftHours: number; // 8
  defaultComplexity: number; // 1.00
  dataDate: string; // ISO date, end of the earned curve
  /**
   * How often the S-curve reports: month ends, or every two weeks or every week
   * anchored on the data date. Optional, because every store written before the
   * curve could report fortnightly has no such key, and month ends are what it did.
   */
  curveCadence?: Cadence;
  /**
   * The calendar month a fiscal year starts in, 1-12. 7 (July) is the usual
   * transit-agency year; 1 makes a fiscal year a calendar year. Optional, because
   * every store written before fiscal years existed has no such key.
   */
  fiscalYearStartMonth?: number;
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
  /** A key the user retired. Never re-added by import; its activities show as REVIEW. */
  retired?: boolean;
};

/**
 * A rule that overrides what an Activity ID is read as.
 *
 * The ID is parsed positionally — location is the 4th dash-delimited segment, phase
 * the 2nd — which works until a schedule carries a family that does not follow the
 * convention. Then the choice is to mis-report it forever or to hard-code an
 * exception in the parser, and the second is worse: the next one needs a code
 * change, and nobody outside the repository can see why an activity groups where it
 * does.
 *
 * So the exceptions are data. A rule says "an ID containing HTT is at location HTT",
 * and it is listed, editable and removable by the person who found the discrepancy.
 */
export type IdRuleField = 'location' | 'phase';

export type IdRule = {
  id: string;
  /** Text to find in the Activity ID. Case-insensitive, matched anywhere in it. */
  match: string;
  /** Which reading of the ID this rule replaces. */
  field: IdRuleField;
  /** The location code, or the phase code (`P1`; a bare number is read as one). */
  value: string;
  /** Off without being deleted, so a rule can be tried and put aside. */
  disabled?: boolean;
  /** Why this exception exists, for whoever reads the list next. */
  note?: string;
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

/**
 * What an activity is, regardless of what its library entry or its P6 name says.
 * Undefined means "whatever the library and the P6 name decide", which is the
 * behaviour every activity had before this existed.
 *
 * HIDDEN   The activity leaves the program. It is in no table, no total, no curve
 *          and no export, and the only screen that can still see it is the hidden
 *          list on Budget Master, where it can be brought back. Nothing is deleted:
 *          the schedule import stays exactly as P6 wrote it.
 * EXCLUDED Still listed, still searchable, but carries no hours. Use it for work
 *          that is real but belongs to someone else's budget.
 * INCLUDED In the budget even though the library entry says exclude, or the P6 name
 *          is marked (Deleted) or (Cancelled). It still needs a library entry to
 *          price it; without one it stays REVIEW, because there is no rate to use.
 */
export type ActivityVisibility = 'HIDDEN' | 'EXCLUDED' | 'INCLUDED';

/**
 * Everything the user decided about ONE activity, as opposed to about its type.
 *
 * Keyed on the trimmed Activity ID and nothing else. A current-schedule import
 * replaces the P6 rows wholesale and never touches this file, so every edit here
 * survives every import for as long as the Activity ID does. That is the contract:
 * P6 owns the durations, the dates and the original name; this file owns the rest.
 */
export type ActivityOverride = {
  activityId: string;
  /** Replaces the calculated budget hours. Optional: a row can carry only a name. */
  overrideHours?: number;
  /** Why. Free text, shown on the row and in the export. */
  note?: string;
  /**
   * The name to show instead of the one P6 exported. The P6 name is never
   * overwritten and still derives the activity type, so renaming an activity
   * cannot silently re-price it.
   */
  nameOverride?: string;
  /** Replaces the library entry's discipline for this one activity. */
  discipline?: string;
  /** Whether this activity is in the budget, out of it, or gone. */
  visibility?: ActivityVisibility;
  /** ISO datetime of the last edit, for the audit trail. */
  updatedAt?: string;
};

/**
 * Why an activity the baseline had finishing in a period did not finish.
 *
 * Keyed on the Activity ID AND the period it was written against, so a fortnightly
 * review keeps its own answer: an activity missed in three consecutive periods
 * usually has three different stories, and overwriting the first with the third
 * would leave the earlier review unable to explain itself.
 */
export type MissedReason = {
  activityId: string;
  /** The ISO end date of the window the log was showing when this was recorded. */
  periodEnd: string;
  /** One of the catalogue's reasons. Free text, because the catalogue is free text. */
  reason: string;
  /** Anything the reason itself cannot say. */
  note?: string;
  updatedAt: string;
};

/**
 * The reasons an activity can be missed for, and every reason given so far.
 *
 * The catalogue is a plain list of strings the user extends from the dropdown
 * itself — there is no fixed taxonomy, because every project argues about its own.
 * It is kept explicitly rather than derived from the entries so that a reason stays
 * on offer after the last activity carrying it is re-dated or completed.
 */
export type MissedReasonLog = {
  reasons: string[];
  entries: MissedReason[];
  /**
   * Reasons taken off the list, including ones that ship with the app. Without
   * this, deleting a built-in reason would be undeletable — it would come back on
   * the next render, since the built-in list is in the code rather than the file.
   * A reason recorded against an activity is never removable, so nothing here can
   * orphan an answer somebody gave; typing it again puts it straight back.
   */
  removed?: string[];
};

/** The reasons offered before anybody has typed one of their own. */
export const DEFAULT_MISSED_REASONS: string[] = [
  'Access not available',
  'Predecessor work not complete',
  'Design or documentation not issued',
  'Materials or equipment not delivered',
  'Resource not available',
  'Testing failed, retest required',
  'Client or third party hold',
  'Weather',
  'Re-sequenced by the plan',
];

/**
 * What somebody keyed against one activity: how far along it is, when that was
 * true, and anything worth saying about it.
 *
 * Percent complete is keyed by hand and nothing else. It used to be derivable from
 * test case counts as well, which meant two ways of saying the same thing and a
 * standing argument about which one a given activity was using. One number,
 * typed by the person who knows, is the whole contract now.
 */
export type TestProgress = {
  activityId: string;
  pctOverride?: number; // 0 to 1
  testStartOverride?: string; // ISO
  testEndOverride?: string; // ISO
  /**
   * The date this percent complete was true as at: when the progress actually
   * happened, for an activity that has started and not finished.
   *
   * Without it the app has to guess, and its guess is that the work is still going
   * on right now — so an unfinished activity's earned hours spread from its actual
   * start all the way to the data date, and every fortnightly window in between
   * gets a slice of them. For work that genuinely is ticking along that is the
   * right reading. For an activity that got to 50% in its first week and has not
   * moved since, it invents progress in every review from then on, and the further
   * the data date advances the more of it there is.
   *
   * One date fixes that: the earn window ends here instead of at the data date, so
   * the hours land in the weeks the work was really done and every window after it
   * correctly reports nothing. It is not a finish — the activity is still open, and
   * `actualFinish` stays empty — which is exactly why it cannot be the same field.
   */
  progressAsOf?: string; // ISO
  /**
   * What is going on with this activity, in the reviewer's own words. Keyed from
   * the Two-Week Log or from Test Progress; it is one field, not a copy on each
   * screen, so the note written at a review is the note the next one reads.
   *
   * Deliberately NOT the Budget Master note (`ActivityOverride.note`), which says
   * why an activity was renamed, hidden or re-priced and belongs to the decision
   * rather than to the progress. Keeping them apart is the point: a pricing
   * justification and "waiting on the CTC cutover" are not the same sentence and
   * must not overwrite each other.
   */
  note?: string;
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

// ---------------------------------------------------------------------------
// Computed model
// ---------------------------------------------------------------------------

export type ActivityStatus = 'IN BUDGET' | 'EXCLUDED' | 'REVIEW' | 'DELETED' | 'CANCELLED';
export type RateStatus = 'SET' | 'DEFAULT' | 'NEEDS SHIFTS' | 'EXCLUDED' | 'NO MATCH';
export type BaselineSource = 'BASELINE' | 'CURRENT' | 'NONE';
/** Where a percent complete came from: you typed it, or P6's durations implied it. */
export type PctSource = 'OVERRIDE' | 'P6';
export type EarnWindowSource = 'TEST WINDOW' | 'P6 ACTUAL' | 'PROGRESS AS AT' | 'IN PROGRESS' | 'NOT STARTED';

/**
 * One resource group on ONE activity: who works on it, how many of them, and what
 * share of the activity's hours they carry.
 *
 * The counts come from the crew on the activity's Activity Library key, so they
 * answer "how many ATS engineers does this activity ask for" without anybody
 * opening the library and reading a rate. The hours are the same figures
 * `subsystemHours` carries, so a resource's hours here and on the Resources screen
 * can never disagree.
 */
export type ResourceAllocation = {
  /** The resource code, '' when the type is priced as a plain headcount. */
  code: string;
  /** The code, or 'Unassigned' when there is none. For reading, never for joining. */
  label: string;
  /** Heads of this resource on the activity. */
  count: number;
  /** The shift length this line works, when it differs from the entry's. */
  shiftHours: number;
  budgetHours: number;
  earnedHours: number;
};

export type BudgetRow = {
  activity: P6Activity;
  activityId: string;
  /**
   * The name to show. The user's rename if there is one, otherwise exactly what P6
   * exported. Read this on every screen; `activity.activityName` is the P6 original
   * and is only worth showing next to a rename, as the thing being replaced.
   */
  activityName: string;
  /** True when activityName came from the user rather than from P6. */
  renamed: boolean;
  /** What the user decided this activity is. null when they left it to the library. */
  visibility: ActivityVisibility | null;
  /**
   * The user took this activity out of the program. Hidden rows are NOT in
   * `Model.rows` and so cannot reach a total, a curve or an export; they are in
   * `Model.hiddenRows` so they can be listed and brought back.
   */
  hidden: boolean;
  location: string;
  /** True when a rule decided the location rather than the ID's own 4th segment. */
  locationFromRule: boolean;
  /** Raw 2nd segment of the Activity ID, e.g. "P2". Derived, never stored. */
  phase: string;
  /** True when a rule decided the phase rather than the ID's own 2nd segment. */
  phaseFromRule: boolean;
  /** "P2" shown as "Phase 2". */
  phaseName: string;
  /** Raw 3rd segment, e.g. "TC" or "AC". */
  workType: string;
  seqCode: string;
  activityType: string;
  matchKey: string; // resolved key, library spelling when matched
  rateStatus: RateStatus;
  status: ActivityStatus;
  /** The Subsystem text as it was typed, which can name several at once. */
  discipline: string;
  /**
   * That text read as a list. "ATS, IXL" is two subsystems, and a rollup by
   * subsystem splits the activity's hours evenly between them rather than inventing
   * a group called "ATS, IXL" that is neither. Empty when nothing was set.
   */
  disciplines: string[];
  basis: Basis | null;
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
  earnedHours: number;
  remainingHours: number;
  /**
   * When the work really began, and when it really finished: the test window dates
   * where they were typed, otherwise P6's dates but only where P6 flags them actual.
   * A planned date never lands here — it is a forecast, and reading one as a fact is
   * how an activity gets reported as finished because the plan said it would be.
   * `actualFinish` is null while the activity is still running.
   */
  actualStart: string | null;
  actualFinish: string | null;
  /**
   * For an activity still running, the date its percent complete was true as at.
   * It closes the earn window where the progress really stopped, instead of leaving
   * it open to the data date and dribbling the same hours into every window since.
   */
  progressAsOf: string | null;
  /**
   * The same pair with the open end closed off at the data date, because hours have
   * to accrue somewhere for an activity that has started and not finished. `earnEnd`
   * on a running activity IS the data date, so it must never be read as a finish;
   * `actualFinish` is the field that answers that question.
   */
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
  /**
   * What this activity is crewed with, one line per resource group. Empty for an
   * activity carrying no budget, since an unpriced activity asks for nobody.
   */
  resources: ResourceAllocation[];
  /** Heads across every resource line. 0 when the activity is not in the budget. */
  crewSize: number;
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
  /** This key as a share of the whole budget, so the big ones are obvious. */
  shareOfBudget: number;
  entry: LibraryEntry;
};

export type LocationStat = {
  code: string;
  count: number;
  effectiveFactor: number;
  budgetHours: number;
  /** This location as a share of the whole budget. */
  shareOfBudget: number;
  earnedHours: number;
  pctComplete: number;
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
  /** The months still to come, on the current schedule's dates. */
  forecastMonths: ForecastRow[];
  /**
   * Remaining budget belonging to no future month, because those activities have no
   * usable current-schedule dates. Stated rather than folded in, for the same reason
   * `unphasedEarned` is: a monthly table quietly short of the total is worse than one
   * that admits the gap.
   */
  unphasedRemaining: number;
  /**
   * Remaining budget on activities the current schedule says should already have
   * finished. It is placed in the first month ahead, because that is when it is due;
   * the alternative is a forecast that spends it in the past.
   */
  overdueRemaining: number;
};

/**
 * One resource group's share of a future month.
 *
 * `earned` is budget: what the schedule says the work left in that month is worth.
 * `built` is what earning it will COST at the rate this group has actually achieved,
 * which is the number that decides whether the year is fundable. It is null where
 * the group has built no hours yet, because there is no rate to project with and a
 * guess would look exactly like a measurement.
 */
export type ForecastCell = {
  code: string;
  label: string;
  earned: number;
  built: number | null;
};

/** One month of work still to come, whole and split by resource group. */
export type ForecastRow = {
  month: string;
  periodEnd: string;
  earned: number;
  built: number | null;
  bySubsystem: ForecastCell[];
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
  /**
   * Activities in this group that are in other groups too, because their Subsystem
   * names more than one. Their hours are split evenly and so still add back to the
   * budget exactly; only the activity COUNTS overlap, which is why this is stated
   * rather than left for somebody to work out from two numbers that disagree.
   * Always 0 on a dimension an activity can only be in one of.
   */
  shared: number;
  inBudget: number;
  budgetHours: number;
  earnedHours: number;
  remainingHours: number;
  pctComplete: number;
  /** This group as a share of the whole budget: how much of the job it is. */
  shareOfBudget: number;
  notStarted: number;
  inProgress: number;
  finished: number;
  /** In-budget activities whose percent complete somebody keyed by hand. */
  withKeyedPct: number;
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
};

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
  /**
   * In-budget activities carrying an original duration but no remaining duration.
   * P6 can say nothing about their progress, so they read 0% until somebody keys
   * one. Counted because an export missing the column does this to every row at
   * once, and the only other symptom is a number that looks plausible.
   */
  noRemainingDuration: number;
  pctFromP6: number; // in budget only
  pctFromOverride: number;
  inProgress: number;
  p6Actual: number;
  testWindow: number;
  notStarted: number;
  testProgressKeyed: number;
  testProgressNotMatching: number;
  testProgressUsingOverride: number;
  rateNeedsShifts: number; // activities in budget whose library entry needs shifts
  onNoCurve: number; // in-budget activities with hours that appear on neither curve
  /** Library entries priced as a crew of named subsystems rather than a headcount. */
  typesWithCrewSplit: number;
  /** Budget hours not attributed to any subsystem. */
  unassignedHours: number;
  /** Activities the user hid. They are in no figure above. */
  hidden: number;
  /** Activities carrying a name the user typed. */
  renamed: number;
  /** Activities the user forced into the budget against the library. */
  forcedIn: number;
  /**
   * Forced in, in the budget, and still carrying no hours. "Included" with a zero
   * allocation is the one outcome of forcing something in that looks like nothing
   * happened, so it is counted rather than left for somebody to notice.
   */
  forcedInUnpriced: number;
  /** Activities the user forced out of the budget while leaving them listed. */
  forcedOut: number;
  /** Overrides keyed against an Activity ID that is not in the current schedule. */
  staleOverrides: number;
};

/**
 * One keyed Test Progress row, checked against the schedule.
 *
 * An Activity ID on its own is not a finding anybody can act on: the question is
 * always "what WAS this, and does losing it cost me anything". So this carries the
 * name, where it sat, what it is worth, what was keyed against it, and a sentence
 * of plain English saying why it matches nothing.
 */
export type TestProgressCheck = {
  activityId: string;
  /** An activity with this ID exists in the current schedule, whatever its status. */
  matched: boolean;
  /** It exists AND carries budget hours, so the keyed numbers actually do something. */
  inBudget: boolean;
  status: ActivityStatus | 'not budgeted' | 'not in extract' | 'hidden';
  /** The display name, or null when the ID is in no schedule at all. */
  activityName: string | null;
  /** The name P6 exported, when it differs from the display name. */
  p6Name: string | null;
  rowType: RowType | null;
  location: string;
  phaseName: string;
  activityType: string;
  /** The library key it priced through, when it is a budgeted activity. */
  matchKey: string | null;
  budgetHours: number | null;
  pctOverride: number | null;
  testStartOverride: string | null;
  testEndOverride: string | null;
  progressAsOf: string | null;
  /** The progress note keyed against it, which deleting the row would also lose. */
  note: string;
  updatedAt: string;
  pctEffective: number | null;
  /** Why it matches nothing, and what dropping it would cost. Empty when it matches. */
  reason: string;
};

/** An override whose Activity ID is in no imported schedule, so it does nothing. */
export type StaleOverride = { activityId: string; hasHours: boolean; renamed: boolean; visibility: ActivityVisibility | null; note: string };

export type Model = {
  rows: BudgetRow[];
  /**
   * Location codes the file carries that no activity uses. Kept out of `locations`
   * and out of every count, and listed only so the Locations screen can say they
   * are there rather than appearing to have lost them.
   */
  unusedLocations: LocationStat[];
  /**
   * The activities the user hid, priced as if they were still in, so the hidden list
   * can say what bringing one back would add. Nothing else reads these.
   */
  hiddenRows: BudgetRow[];
  /** Overrides pointing at an Activity ID the current schedule no longer has. */
  staleOverrides: StaleOverride[];
  subsystems: SubsystemStat[];
  burn: BurnSummary;
  /** Rollups by every dimension, so screens never group by hand. */
  groups: Record<GroupDim, GroupStat[]>;
  library: LibraryStat[];
  locations: LocationStat[];
  curve: CurvePoint[];
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
  /** Exceptions to how an Activity ID is read. Absent in every older store. */
  idRules?: IdRule[];
};

export const DEFAULT_SETTINGS: Settings = {
  storageFolderName: 'TC-Budget',
  defaultBasis: 'DUR',
  defaultCrew: 2,
  defaultShiftHours: 8,
  defaultComplexity: 1.0,
  dataDate: '',
  fiscalYearStartMonth: 7,
};
