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
  Keyed: 'What has been recorded against this activity: the percent complete, the actual dates and the progress note. This is what deleting the row would lose.',
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
  Outcome: 'What became of this activity in the period: completed, completed early (it was finished before the period began), started, continued, missed or not started. Read off the actual dates, judged against the baseline ones.',
  'Project achieved': 'Budget hours this activity earned inside the period, as a share of the whole project budget. Phase achieved is the same figure taken against its phase.',
  'Project achieved h': 'Budget hours this activity actually earned inside the period.',
  'Actual start': 'When the activity really began: your keyed date, or P6\u2019s actual start. Never a planned date. Editable on the Two-Week Log and on Progress \u2014 typing overrides P6, clearing hands the date back to it.',
  'Actual finish': 'When the activity really finished: your keyed date, or P6\u2019s actual finish. Editable the same way. Blank means nothing has dated it, so its hours land on the data date; once it is set, the activity reads COMPLETED in the period it finished in and COMPLETED EARLY in any later one its baseline ran on into.',
  'Days late': 'Actual finish minus baseline finish, in calendar days. Negative is early, blank until something has dated the finish.',
  'Phase achieved': 'What this one activity put into its own phase in this period: its achieved hours over the phase\u2019s whole budget. The rows of a phase add up to how far that phase moved.',
  'Phase of plan': 'The achieved-against-planned figure for this activity\u2019s whole phase over this period. The same for every activity of the phase: it judges the phase, not the row.',
  'Phase complete': 'How complete this activity\u2019s phase is at the end of the period, measured against that phase\u2019s own budget rather than the whole job\u2019s.',
  'Why missed': 'Why this activity did not finish when the baseline said it would. It stays with the Activity ID, so moving the end date does not lose it; each answer is stamped with the period it was given for, and one shown from another period is marked as carried.',
  'Progress as at': 'The date an unfinished activity\u2019s percent complete was true as at. Until it is set the hours spread from its actual start to the data date, so a stale activity shows movement in every month and every review; setting it lands them in the weeks the work was really done. It is not a finish \u2014 the activity is still open.',
  'Progress note': 'Anything about this activity worth saying at a review. Kept against the Activity ID and shared with the Progress screen \u2014 write it in either place. Not the Budget Master note, which explains a pricing or visibility decision.',
  'Missed explained': 'How many of the period\u2019s missed activities have a reason recorded against them. The rest are the ones the review has not asked about yet.',

  // --- progress ------------------------------------------------------------
  '%': 'Percent complete. The percent you keyed, or P6 duration when nobody has keyed one.',
  '% complete': 'Percent complete. The percent you keyed, or P6 duration when nobody has keyed one.',
  'Pct source': 'Where the percent complete came from. OVERRIDE = you typed it. P6 = (OD − RD) ÷ OD, which is the weaker of the two.',
  Status: 'IN BUDGET carries hours. EXCLUDED is priced at zero on purpose. REVIEW has no rate library entry yet. DELETED and CANCELLED came in that way from P6.',
  'Rate status': 'SET = you priced it. DEFAULT = still on the global defaults. NEEDS SHIFTS = RATE basis with no shift count, so it prices at zero. NO MATCH = no library entry.',
  'Earn window': 'The dates hours accrue between. TEST WINDOW = dates you typed. P6 ACTUAL = actual start to actual finish. PROGRESS AS AT = actual start to the date you said the progress was true as at. IN PROGRESS = actual start to the data date, because nothing says when the progress happened. NOT STARTED earns nothing.',
  Baseline: 'The baseline import’s dates, which drive the planned curve. Falls back to current dates when the activity is not in the baseline.',
  'Baseline source': 'BASELINE = matched in the baseline import. CURRENT = not in it, so current dates were used. NONE = no usable dates at all.',
  Start: 'Activity start date from the current schedule.',
  Finish: 'Activity finish date from the current schedule.',

  // --- curves and dates ----------------------------------------------------
  Planned: 'Budget hours from the baseline, spread evenly between each activity’s baseline start and finish. Cumulative on the curve; inside the window on the two-week log.',
  'Data date': 'The date progress is reported up to. The earned curve stops here, because past it nothing has been reported yet.',
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
  '% override': 'A percent complete you typed by hand. It beats P6\u2019s durations.',
  '% src': 'Where the percent complete came from. OVERRIDE = you typed it. P6 = (OD − RD) ÷ OD, which is the weaker of the two.',
  Source: 'Where this figure came from, rather than what it is.',
  'BL start': 'Baseline start. Drives the planned curve.',
  'BL finish': 'Baseline finish. Drives the planned curve.',
  'BL src': 'BASELINE = matched in the baseline import. CURRENT = not in it, so current dates were used. NONE = no usable dates at all.',
  'Cur start': 'Start date in the current schedule. Drives the forecast curve.',
  'Cur finish': 'Finish date in the current schedule. Drives the forecast curve.',
  'Earn start': 'First day this activity accrues earned hours.',
  'Earn end': 'Last day this activity accrues earned hours. Hours spread evenly between the two.',
  Window: 'The dates hours accrue between. TEST WINDOW = dates you typed. P6 ACTUAL = actual start to actual finish. IN PROGRESS = actual start to the data date.',
  'Test start': 'A date you key for when testing actually began. It overrides P6 and is what the Actual start box writes.',
  'Test end': 'A date you key for when testing finished. It overrides P6 and is what the Actual finish box writes.',
  '% keyed': 'How many in-budget activities have a percent complete somebody typed, rather than falling back to P6 duration.',
  Coverage: 'How many in-budget activities have a percent complete somebody typed, rather than falling back to P6 duration.',
  'Budget left': 'Budget hours the current schedule still plans to earn in this period, spread calendar-linearly across each activity\u2019s remaining window. A fact about the plan, not a projection.',
  'Forecast cost': 'What earning that budget will cost at the rate this group has actually achieved so far. Blank where nothing has been built yet, because there is no rate to project with.',
  'Over / under': 'Budget left minus forecast cost. Negative is the overrun the period is heading for if the current rate holds.',
  // Activity ID rules. Short labels on a screen whose whole subject is one sentence
  // read across four columns, so each one says what its part of that sentence means.
  Rules: 'Exceptions to how an Activity ID is read. Each one says: if the ID contains this text, set its location or phase to that.',
  'Activities moved': 'Activities in the current schedule whose location or phase came from a rule rather than from their Activity ID.',
  'Catching nothing': 'Rules that match no activity in the current schedule. Usually a typo \u2014 a rule that matches nothing is silent, and reads exactly like one that is working.',
  'Then set its': 'Which reading of the Activity ID this rule replaces: the location, or the phase.',
  To: 'What the rule sets the field to. A location code, or a phase \u2014 typed as 1 or as P1, both meaning Phase 1.',
  Why: 'Why this exception exists, for whoever reads the list next.',
  On: 'Whether the rule applies. Turning it off leaves it in the list without changing any grouping.',
  'The ID says': 'Where the Activity ID alone would have put this activity.',
  'The rule says': 'Where the rule puts it instead.',
  // The import change report.
  'Finish moved later': 'Activities whose finish date is later in this file than in the schedule in use. The slip list.',
  'Finish pulled in': 'Activities whose finish date is earlier in this file than in the schedule in use.',
  'Newly finished': 'Activities that carry an actual finish in this file and did not in the schedule in use: what completed between the two.',
  'Newly started': 'Activities that carry an actual start in this file and did not in the schedule in use.',
  'New activities': 'Activity IDs in this file that are not in the schedule in use.',
  'Gone from the schedule': 'Activity IDs in the schedule in use that this file does not contain. Renumbered in P6, or removed.',
  'What changed': 'The fields that differ, old value to new. Only what P6 owns \u2014 dates, durations and the name. Nothing you keyed is involved.',
  'Measure against': 'Which baseline the planned curve and every variance are compared with. The newest import is the default.',
  // Capacity: what the work ahead asks for, against what there is to give.
  'Periods short': 'Fiscal years or months where the work the schedule puts in them needs more hours than the keyed headcount can give.',
  'Demand h': 'Hours the work ahead will take, at the rate each group actually achieves. Not the budget \u2014 a group converting at 0.7 needs half again as many hours as its budget is worth.',
  'Supply h': 'Hours the keyed headcount can give in the period, at the hours per person and utilisation set on the Capacity screen.',
  'Short / spare': 'Supply minus demand. Negative is short of people; positive is slack. Blank where no headcount has been keyed for the group.',
  Load: 'Demand as a share of supply. Over 100% is more work than the group can take in the period.',
  People: 'How many are in the resource group, as keyed. Fractional is allowed: half a person shared with another job is a real thing.',
  'People needed': 'The headcount the demand implies, at the hours per person set on the Capacity screen. What you would have to staff the period with to finish the work in it.',
  From: 'The month a headcount takes effect. Blank means it always has; a second row from a later month describes a ramp.',
  Groups: 'How many resource groups earned or spent anything inside that fiscal year.',
  'Share of year': 'This group as a share of everything earned in that fiscal year.',
  'Percent keyed': 'In-budget activities whose percent complete somebody typed, against the number of them there are.',
  'On P6 duration': 'In-budget activities with no keyed percent, so their progress is (OD \u2212 RD) \u00f7 OD \u2014 what P6\u2019s durations imply rather than what anybody checked.',
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
  Finished: 'Activities in this group that have reached 100%.',
  Running: 'Activities in this group that have started and not finished. Their hours accrue across the window they are working through.',
  'Not started': 'Activities in this group that carry hours and have not begun. Nothing of their budget has been earned.',
  Curves: 'How many S-curves are on the report: the whole project, a phase, or several of each, in the order they were picked.',
};

/** The definition for a column label, if there is one. Case and spacing tolerant. */
export function define(term: string | undefined | null): string | undefined {
  if (!term) return undefined;
  const raw = term.trim();
  if (GLOSSARY[raw]) return GLOSSARY[raw];
  const hit = Object.keys(GLOSSARY).find((k) => k.toLowerCase() === raw.toLowerCase());
  return hit ? GLOSSARY[hit] : undefined;
}
