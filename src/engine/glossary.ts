/**
 * What the abbreviations mean.
 *
 * This screen is full of shorthand that is obvious to whoever built it and opaque
 * to everyone else: OD, RD, EV, CPI, DUR. Every definition lives here
 * once, keyed by the exact column label, so a table header explains itself on hover
 * without each screen inventing its own wording.
 *
 * Definitions say what the number MEANS and where it comes from, not what it is
 * called. "Original Duration" is not an explanation of "OD".
 */
import { TERMS } from './vocab';

export const GLOSSARY: Record<string, string> = {
  // --- identity ------------------------------------------------------------
  'Activity ID': 'The P6 activity code, e.g. 0-P2-TC-W40-FA-0100. Everything joins on this. Segment 2 is the phase, 3 the work type, 4 the location.',
  Activity: 'The activity name exactly as P6 exported it.',
  Phase: 'Second segment of the Activity ID. P2 is Phase 2, P3 is Phase 3.',
  Location: 'Fourth segment of the Activity ID, e.g. W40. Each location can carry its own complexity factor.',
  'Work type': 'Third segment of the Activity ID. TC is test and commissioning, AC is acceptance.',
  Type: 'The activity type, stripped of the location and phase prefix. This is what the rate library is keyed on.',
  'Match key': 'The rate library entry this activity resolved to, by an exact match on its activity type. No match means REVIEW and no hours.',
  [TERMS.discipline]: 'A free-text grouping you set on the Activity Library entry, so a rollup can cut the budget by it. Not derived from P6.',

  // --- rating --------------------------------------------------------------
  Basis: 'How the budget is calculated. RATE = a fixed number of shifts you set, independent of P6. DUR = P6 original duration in days.',
  RATE: 'A fixed number of shifts you set. The budget does not change when the schedule does.',
  DUR: 'Driven by the P6 original duration. The budget changes when the schedule does.',
  Crew: 'How many people the activity takes. Split it by subsystem to see the workload each group carries.',
  [TERMS.subsystemPlural]: 'Who this activity is crewed with and how many of each, from the crew on its Activity Library key. One activity can call on several groups at once.',
  [TERMS.subsystem]: 'The group actually doing the work: ATS, IXL, COMMS and so on. An activity can need several at once, and its hours are split between them.',
  Shift: 'Hours in one shift for this activity type. A crew line can override it where one group works a shorter shift.',
  'Shift hours': 'Hours in one shift for this activity type.',
  Shifts: 'How many shifts one instance of this activity takes. Only used on the RATE basis.',
  OD: 'Original Duration: the activity length in days as P6 planned it. Drives the budget on the DUR basis.',
  RD: 'Remaining Duration: days P6 still expects the activity to take. (OD − RD) ÷ OD is the fallback percent complete.',
  'P6 days': 'Total original duration across every activity of this type, in days.',
  Complexity: 'The location factor the standard hours are multiplied by. 1.00 means no adjustment.',
  'Std hours': 'Standard hours before the location complexity factor: crew × shift hours × shifts (or × P6 days).',
  Override: 'A budget figure you typed by hand for this one activity. It replaces the calculated hours entirely.',

  // --- money ---------------------------------------------------------------
  Budget: 'Budgeted man-hours. Crew × shift hours × shifts (or P6 days), times the location complexity, rounded.',
  'Budget hours': 'Budgeted man-hours. Crew × shift hours × shifts (or P6 days), times the location complexity, rounded.',
  Earned: 'Budget hours × percent complete. What the work done so far was worth, NOT what it cost.',
  'Earned hours': 'Budget hours × percent complete. What the work done so far was worth, NOT what it cost.',
  [TERMS.built]: 'Hours the team actually spent, from timesheets. This is what the work cost, as opposed to what it was worth.',
  [TERMS.builtHours]: 'Hours the team actually spent, from timesheets. This is what the work cost, as opposed to what it was worth.',
  Remaining: 'Budget minus earned. The value of the work still to do.',
  Variance: 'Earned minus actual. Negative means the hours spent were worth less than they cost.',
  Factor: 'Earned ÷ actual. Above 1.00 the team is ahead of the budget; below 1.00 every hour spent earns less than an hour.',
  'To complete': 'Remaining budget ÷ factor. What finishing the job costs if the team keeps converting hours at the rate it has so far.',
  Forecast: 'Built so far plus the hours still to come at the current rate. The estimate of what the whole job will cost.',
  Overrun: 'Variance at completion as a share of that group\u2019s own budget. A 500 hour hole means something very different to a small group than to a large one.',
  'At completion': 'Budget minus forecast. Negative is the size of the overrun if nothing changes.',

  // --- what the user decided about one activity ----------------------------
  'P6 start': 'The start date in the current P6 schedule. An "A" beside it means P6 records it as an actual start rather than a plan.',
  'P6 finish': 'The finish date in the current P6 schedule. An "A" means P6 records it as actual, which is what closes the activity\u2019s earn window.',
  Share: 'How much of the budget shown sits in this row. Hours say how big it is; this says how big next to everything else.',
  Show: 'Whether this activity takes part at all. Your decision about this one activity, which beats what the Activity Library says about its type.',
  Auto: 'Leave it to the Activity Library and the P6 name to decide whether this activity is in the budget. The setting every activity starts on.',
  'Force in': 'Budget this activity even though the library excludes its type, or P6 marked the name (Deleted) or (Cancelled). It still needs a priced type to earn hours.',
  Exclude: 'Keep the activity listed and searchable but carrying no hours, for real work that belongs to somebody else\u2019s budget.',
  Hide: 'Take the activity out of every table, total, curve and export. Nothing is deleted: the P6 import keeps the row, and Budget Master\u2019s Hidden view brings it back.',
  'What it is': 'What the schedule says this keyed Activity ID actually is: a real activity in some state, a WBS summary header, or an ID no schedule has.',
  Keyed: 'What has been recorded against this activity: test case counts, a percent override, and test window dates. This is what deleting the row would lose.',
  Note: 'Your own words on why this activity was renamed, hidden, excluded or re-priced. It rides along into the export.',

  // --- fiscal years ---------------------------------------------------------
  'Fiscal year': 'The funding year this row covers, named for the calendar year it ends in. With a July start, Jul 26 to Jun 27 is FY27. Set the start month in Settings.',
  Months: 'How many months of this fiscal year have rows. A year part-way through the programme will have fewer than twelve.',

  // --- the two-week log ----------------------------------------------------
  'Planned h': 'Budget hours the baseline said would accrue inside this period, spread evenly across each activity by calendar day.',
  Achieved: 'Budget hours actually earned inside this period. Measured exactly as the S-curve measures them, so every period adds back to the same total.',
  'Achieved h': 'Budget hours this activity actually earned inside the period.',
  'Of plan': 'Achieved divided by planned for this period. Above 100% means more was earned than the baseline asked for.',
  Project: 'How complete the whole job is at the end of this period, not just the part of it that falls inside the period.',
  Outcome: 'What became of this activity inside the period, judged against the baseline dates: completed, started, continued, missed or not started.',
  'Project achieved': 'Budget hours this activity earned inside the period, as a share of the whole project budget. Phase achieved is the same figure taken against its phase.',
  'Project achieved h': 'Budget hours this activity actually earned inside the period.',
  'Actual start': 'When the activity really began: your test window start, or P6\u2019s actual start date. Never a planned date.',
  'Actual finish': 'When the activity really finished: your test window end, or P6\u2019s actual finish. Blank until it reaches 100%; once it is set the activity reads COMPLETED in every period, including ones its baseline ran on into.',
  'Days late': 'Actual finish minus baseline finish, in calendar days. Negative is early, blank until it finishes.',
  'Phase achieved': 'What this one activity put into its own phase in this period: its achieved hours over the phase\u2019s whole budget. The rows of a phase add up to how far that phase moved.',
  'Phase of plan': 'The achieved-against-planned figure for this activity\u2019s whole phase over this period. The same for every activity of the phase: it judges the phase, not the row.',
  'Phase complete': 'How complete this activity\u2019s phase is at the end of the period, measured against that phase\u2019s own budget rather than the whole job\u2019s.',
  'Why missed': 'Why this activity did not finish when the baseline said it would. It stays with the Activity ID, so moving the end date does not lose it; each answer is stamped with the period it was given for, and one shown from another period is marked as carried.',
  'Progress note': 'Anything about this activity worth saying at a review. Kept against the Activity ID and shared with Test Progress \u2014 write it in either place. Not the Budget Master note, which explains a pricing or visibility decision.',
  'Missed explained': 'How many of the period\u2019s missed activities have a reason recorded against them. The rest are the ones the review has not asked about yet.',
  Done: 'Test cases passed. Keyed here or on Test Progress \u2014 it is the same field, and it drives the activity\u2019s percent complete.',

  // --- progress ------------------------------------------------------------
  '%': 'Percent complete. Taken from your override first, then test case counts, then P6 duration.',
  '% complete': 'Percent complete. Taken from your override first, then test case counts, then P6 duration.',
  'Pct source': 'Where the percent complete came from. OVERRIDE = you typed it. TESTS = test case counts. P6 = (OD − RD) ÷ OD, the weakest of the three.',
  Tests: 'Test cases for this activity: how many there are and how many have passed.',
  'Tests done': 'How many of them have passed.',
  Status: 'IN BUDGET carries hours. EXCLUDED is priced at zero on purpose. REVIEW has no rate library entry yet. DELETED and CANCELLED came in that way from P6.',
  'Rate status': 'SET = you priced it. DEFAULT = still on the global defaults. NEEDS SHIFTS = RATE basis with no shift count, so it prices at zero. NO MATCH = no library entry.',
  'Earn window': 'The dates hours accrue between. TEST WINDOW = dates you typed. P6 ACTUAL = actual start to actual finish. IN PROGRESS = actual start to the data date. NOT STARTED earns nothing.',
  Baseline: 'The baseline import’s dates, which drive the planned curve. Falls back to current dates when the activity is not in the baseline.',
  'Baseline source': 'BASELINE = matched in the baseline import. CURRENT = not in it, so current dates were used. NONE = no usable dates at all.',
  Start: 'Activity start date from the current schedule.',
  Finish: 'Activity finish date from the current schedule.',

  // --- curves and dates ----------------------------------------------------
  Planned: 'Budget hours from the baseline, spread evenly between each activity’s baseline start and finish. Cumulative on the curve; inside the window on the two-week log.',
  'Data date': 'The date progress is reported up to. The earned curve stops here, because past it nothing has been reported yet.',
  'Status date': 'The date a snapshot is stamped with.',
  Snapshot: 'A frozen copy of every activity’s percent complete and earned hours on a given date. Never recalculated afterwards.',
  Month: 'Calendar month. Hours are credited to the month they accrue in, spread evenly across the activity’s dates.',

  // --- the exact short labels the tables use -------------------------------
  // Written out rather than aliased, because a definition that reads naturally
  // under the header it belongs to is worth more than one shared string.
  'Budget h': 'Budgeted man-hours. Crew × shift hours × shifts (or P6 days), times the location complexity, rounded.',
  'Earned h': 'Budget hours × percent complete. What the work done is worth, not what it cost.',
  'Remaining h': 'Budget hours not yet earned. The value of the work still to do.',
  'Built h': 'Hours the team actually spent, from timesheets.',
  'Std h': 'Standard hours before the location complexity factor is applied.',
  'Std h / instance': 'Standard hours for ONE activity of this type, before the location complexity factor.',
  'Override h': 'A budget figure typed by hand for this activity. It replaces the calculated hours entirely.',
  'Override note': 'Why the hours were overridden. Free text, for whoever reads this next.',
  'Shift h': 'Hours in one shift for this activity type.',
  'Duration shifts': 'How many shifts one instance takes. Only used on the RATE basis; without it a RATE type prices at zero.',
  Rate: 'How this activity type is priced: the basis, the crew and the shift length.',
  Cx: 'Complexity factor from the location. Standard hours are multiplied by it. 1.00 means no adjustment.',
  'Complexity factor': 'Multiplier applied to standard hours for work at this location. 1.00 means no adjustment.',
  Effective: 'The value actually in use, whether you set it or it fell back to the global default.',
  Include: 'Whether this activity type carries budget hours. Types marked (by BART), (by Others) or (Deleted) default to N.',
  Loc: 'Location: fourth segment of the Activity ID, e.g. W40.',
  '% override': 'A percent complete you typed by hand. It beats test case counts and P6.',
  '% src': 'Where the percent complete came from. OVERRIDE = you typed it. TESTS = test case counts. P6 = (OD − RD) ÷ OD, the weakest of the three.',
  Source: 'Where this figure came from, rather than what it is.',
  'BL start': 'Baseline start. Drives the planned curve.',
  'BL finish': 'Baseline finish. Drives the planned curve.',
  'BL src': 'BASELINE = matched in the baseline import. CURRENT = not in it, so current dates were used. NONE = no usable dates at all.',
  'Cur start': 'Start date in the current schedule. Drives the forecast curve.',
  'Cur finish': 'Finish date in the current schedule. Drives the forecast curve.',
  'Earn start': 'First day this activity accrues earned hours.',
  'Earn end': 'Last day this activity accrues earned hours. Hours spread evenly between the two.',
  Window: 'The dates hours accrue between. TEST WINDOW = dates you typed. P6 ACTUAL = actual start to actual finish. IN PROGRESS = actual start to the data date.',
  'Test start': 'The date testing actually began. Overrides the P6 dates for earning hours.',
  'Test end': 'The date testing finished. Overrides the P6 dates for earning hours.',
  'Test cases': 'How many test cases this activity contains, and how many have passed.',
  'Tests total': 'How many test cases this activity contains. Percent complete becomes passed ÷ total.',
  'Test coverage': 'How many in-budget activities have test case counts keyed, rather than falling back to P6 duration.',
  Coverage: 'How many in-budget activities have test case counts keyed, rather than falling back to P6 duration.',
  'Total P6 days': 'Original duration summed across every activity of this type, in days.',
  Count: 'How many activities of this type are in the current import.',
  Activities: 'How many activities fall in this group.',
  'In budget': 'Activities carrying hours. Excludes REVIEW, EXCLUDED, DELETED and CANCELLED.',
  Complete: 'Percent of this group’s budget hours that have been earned.',
  Subsystems: 'Resource groups: ATS, IXL, COMMS and so on. An activity can need several at once, so the activity counts overlap while the hours do not.',
  'Cum earned': 'Earned hours from the first month up to and including this one.',
  'Cum built': 'Hours the team has built from the first month up to and including this one.',
  'Cum variance': 'Earned minus built since the start of the job. This is the hole, or the cushion.',
  Person: 'Who the hours were charged by. Optional: the rollup works per group either way, but per person is how most timesheet exports come.',
  'Needing REVIEW': 'Activities whose type has no rate library entry yet, so they carry no hours. Price the type and they join the budget.',
  'Activities needing REVIEW': 'Activities whose type has no rate library entry yet, so they carry no hours. Price the type and they join the budget.',
};

/** The definition for a column label, if there is one. Case and spacing tolerant. */
export function define(term: string | undefined | null): string | undefined {
  if (!term) return undefined;
  const raw = term.trim();
  if (GLOSSARY[raw]) return GLOSSARY[raw];
  const hit = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === raw.toLowerCase());
  return hit ? GLOSSARY[hit] : undefined;
}
