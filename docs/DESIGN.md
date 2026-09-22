# Design notes

## What the numbers mean

The engine (`src/engine`) is a module of pure functions with no storage or UI
dependency. `computeModel(input)` takes the settings, locations, library, overrides,
progress and both schedule imports, and returns every derived figure the screens
show. It reproduces the source workbook's numbers exactly; see
`tests/workbook-parity.test.ts`.

Order of resolution per activity:

1. Row type: blank Activity Name is a WBS row. Parsed, stored, never budgeted.
2. Location: 4th dash-delimited segment of the trimmed Activity ID, unless an
   Activity ID Rule overrules it.
3. Activity type: everything after the first `" - "` in the name.
4. Exclude reason: `(Deleted)` or `(Cancelled)` anywhere in the name, case-insensitive.
5. Match key: exact (case-insensitive) library key, else the type with its last
   parenthetical group dropped, else unresolved (`REVIEW`, zero hours).
6. Status: exclude reason, then `REVIEW`, then `EXCLUDED` (include is `N`), then `IN BUDGET`.
7. Hours: `RATE` = crew × shift hours × duration shifts; `DUR` = crew × shift hours ×
   max(0, original duration). Rounded after the location's complexity factor. An
   override replaces the rounded figure and bypasses the factor.
8. Percent complete: the percent somebody keyed, else P6 duration.
9. Earn window: from the actual start (your keyed test start, else P6's actual start)
   to the actual finish; failing that to `progressAsOf`, the date somebody said the
   progress was true as at; failing that to the data date. Missing actual start means
   `NOT STARTED`.
10. Curves: each activity's hours spread calendar-linearly across its window; earned
    hours (budget × pct) across the earn window, with `null` past the data date.

## Excel semantics that were kept on purpose

- **Case-insensitive keys.** Excel `MATCH`, `COUNTIF` and `SEARCH` ignore case. The
  workbook therefore treats `IXL Cutover (by BART)` and `IXL Cutover (By BART)` as one
  library key. Every join goes through `normKey`.
- **First match wins.** Duplicate Activity IDs in a baseline or progress list
  resolve to the first occurrence, as `MATCH` does.
- **Unparseable dates are no date.** A P6 constraint star (`01-Oct-26*`) defeats
  `DATEVALUE` in the workbook, so it is treated as no date here too, and flagged on import
  and on Budget Master. Stripping the star would be a one-line change in `parseP6Date`,
  but it would change the curves relative to the workbook, so it is left as a flag.
- **`ROUND` half away from zero.** Matters only for negative hours, which cannot occur.

## Deliberate deviation from the workbook

Same-day activities credit in full on that day. The workbook's `SUMPRODUCT` forces a
one-day denominator for a same-day window, so the fraction on the day itself is zero and
the credit lands in the next period. The build prompt specifies the same-day rule and a
test for it, and it is the right behaviour, so it is used. On the workbook's data this
moves 400 hours from January 2026 to December 2025 and changes nothing else.

## Matching is exact, and only exact

An activity is priced by an exact, case-insensitive match of its activity type against a
library key. There is no second attempt.

There used to be one. Tier 2 dropped the last bracketed phrase and retried, so a key
called `Sim Mode Test (Adjacent Location)` would price every `(DF: A10 -> B20)` variant
of it. It is gone deliberately. A key that widens itself prices work nobody looked at,
and the widening is invisible in every total it feeds — the badge on the row was the
only trace, and a badge is not a decision. An unmatched type is now simply REVIEW, and
the two answers are both explicit and both visible afterwards: price that type, or hide
the activity.

The cost is real and worth stating: each spelling needs its own library entry. A family
of four `(DF: ...)` variants is four entries, not one. That is the trade — four rows of
typing against a budget nobody can audit.

## The `retired` library flag

Import never deletes a library entry, because the type may return in a later schedule
revision. Without a marker, a key the user had deliberately dropped would be re-added by
the next import and start pricing again. A library entry with `retired: true` is
therefore excluded from matching and from the type count, and is never re-added by
discovery; its activities show as REVIEW until a key matches them exactly. Retire and
restore are on the Activity Library screen.

## What the user owns, and what P6 owns

`activity-overrides.json` is the answer to "the schedule says this, and the schedule is
wrong". It is keyed on the trimmed Activity ID and on nothing else, and a current
schedule import replaces the P6 rows wholesale without ever touching it. That division
is the whole contract:

| P6 owns, and an import rewrites | The user owns, and an import cannot touch |
| --- | --- |
| Activity ID, original and remaining duration | The displayed name (`nameOverride`) |
| Start and finish, planned and actual | Whether it takes part at all (`visibility`) |
| The exported activity name | Budget hours (`overrideHours`), discipline, note |

The Activity ID is therefore never editable anywhere in the UI. It is the only thing
carrying the user's work across a monthly import, and an editable join key is not a
join key.

A rename is display-only on purpose. The activity type — and so the library key and the
price — is derived from the **P6** name, which is kept alongside. Renaming an activity
can never re-price it, and both names go into the export.

### Forcing an activity in has to create a rate for it

`INCLUDED` used to be a half-promise. An activity is priced through its *type*, and
two kinds of type have no library key at all: one P6 marked `(Deleted)` or
`(Cancelled)`, which `discoverLibrary` skips on purpose so the library is not full of
dead work, and one whose key was retired by hand. Forcing such an activity in moved it
from DELETED to REVIEW and stopped there — no rate could reach it, it carried no hours,
and since both the Activity Library and the Progress screen are lists of *priced* things, it
appeared in neither. It had been included into nowhere.

So Budget Master creates the key, or un-retires it, in the same action, on the Settings
defaults exactly as a discovered type would arrive. The type is then visible and
editable like any other, and the activity reaches the Progress screen carrying real hours.
Other activities of that type are not dragged in with it: P6's marker still excludes
them on its own, and only the ones forced in individually cross over. The toast names
every key it had to add, because a per-activity action that edits the library is a side
effect that must not be silent.

The engine keeps the guard rather than trusting the screen: `INCLUDED` with no entry is
still REVIEW, never a silent zero. The only way to reach it now is to retire the key
again afterwards, and Budget Master calls that out in a notice.

`libraryRateStatus` takes a `forcedIn` flag for the same reason. A key containing
`(Deleted)` reads as exclude, so a forced-in row would otherwise report its rate as
EXCLUDED while sitting in the budget — answering a question nobody asked. Forced in, the
include flag is skipped and the rate is judged on its own.

### `visibility`

- **HIDDEN** — the row is dropped from `Model.rows` immediately after it is built, so
  every total, rollup, curve, library count and export sheet below that point is
  computed without it. Hiding is a single cut rather than a flag every consumer has to
  remember to test, which is what makes it trustworthy. The rows are kept, still
  priced, on `Model.hiddenRows`, so Budget Master's Hidden view can say what bringing
  one back would add. The import itself is never modified.
- **EXCLUDED** — listed and searchable, carrying no hours.
- **INCLUDED** — in the budget even though the library excludes its type or P6 marked
  the name `(Deleted)`. It cannot conjure a rate: an unpriced type stays REVIEW rather
  than silently budgeting zero.

This is what makes REVIEW resolvable. Before, an activity whose type nobody would ever
price sat on the dashboard as a permanent red count with no action that would clear it.
Now it is either work (price the type) or it is not (hide it).

An override whose Activity ID is in no import is *stale*, not deleted: it is reported
on `Model.staleOverrides` and starts working again if the activity comes back.

## Grouping: phase, location, work type

Three of the six Activity ID segments carry structure worth rolling up by, and all
three are **derived, never keyed and never stored**:

| Segment | Meaning | Example |
| --- | --- | --- |
| 2 | Phase | `P2` → Phase 2. The live schedule also has one `SW`. |
| 3 | Work type | `TC` for Testing and Commissioning, `AC` for ATC. |
| 4 | Location | `W40`, already used for the complexity factor. |

`phaseLabel` formats `P<n>` as `Phase n` and leaves anything else exactly as it
appears, so a segment that is not a phase code is never mislabelled as one. Because
these are computed from the Activity ID at model time rather than written into
`ScheduleImport`, an import saved by an earlier version of the app groups correctly
with no migration.

`groupRows(rows, dim)` rolls the budget up by any of those, or by the discipline set
on the library key. Every activity lands in exactly one group, including activities
whose ID does not carry the segment (they group under a named "no location in the ID"
bucket), so group totals always add back to the whole. That invariant is asserted on
every dimension in `tests/rollup.test.ts` and against the real workbook in the parity
suite.

The Dashboard can be cut down to one phase. `buildCurve(rows, dataDate)` takes the
rows rather than reading the model, so a phase curve is the same arithmetic over a
subset and cannot disagree with the programme curve it is part of, and the
percentages are of the subset's own budget, which is what "Phase 2 is 40 per cent
done" means. `rowTotals(rows)` does the same for
the four KPI cards, counting activities over budgeted rows only so the cards and the
phase tiles under them agree. Data quality and the summary stay whole-programme, and
the screen says so.

### A segment that names a phase by another word

The 2nd segment is normally `P<n>`, but the live schedule carries one T&C code that
is not: `SW`, the Training Facility work, which belongs to Phase 2. Left alone it
reported as a phase of its own — a one-activity "phase" beside the real ones,
carrying its own achievement figure on the two-week log that meant nothing. It is
mapped in `PHASE_ALIASES` in `src/engine/parse.ts`, inside `phaseOf`, and that
placement is the point: the phase an activity is in is one fact, decided once, and
the four screens that group by phase all read it from there. A segment nobody has
taught the app is still kept as it appears, so an unknown code groups with its own
kind rather than disappearing into a bucket.

## Progress is schedule-driven, and is one number

The Progress screen lists **every budgeted activity**, always. There is no list
to build and no way for the worksheet to drift out of step with the schedule: the rows
*are* `model.rows` filtered to `IN BUDGET`, joined to whatever has been keyed.

Percent complete is **keyed by hand, and nothing else**. It used to be derivable from
test case counts as well, which meant two ways of saying the same thing, a precedence
rule to remember, and a standing argument about which one a given activity was using
— and a count of test cases was never the figure anybody defended in a meeting
anyway. `PctSource` is now `OVERRIDE` or `P6`: the number somebody typed, or the one
P6's durations imply, `(OD − RD) ÷ OD`. A row carrying only a note or a date says
nothing about progress, so P6 still answers for it; a keyed **zero** is a statement
and beats P6's arithmetic, which is why `testPctEffective` tests for `undefined`
rather than for falsiness.

Stores written before this change still hold `testsTotal` / `testsComplete` on
disk. `migrateTestCounts()` in `src/storage/store.ts` converts them on the way in,
using the formula that produced the figure in the first place — passed ÷ total,
clamped — because reading them as "nothing keyed" would hand those activities back
to P6's durations and move the earned curve without saying so. A percent somebody
keyed always wins over a count, a keyed zero survives, and a total of zero converts
to nothing at all: it says how many tests there are, not how far along the work is.
The conversion is applied to what the app holds and is not written back on load, so
a store opened and closed without edits is left exactly as it was found.

### What P6's durations are allowed to claim

`(OD − RD) / OD` is the fallback for an activity nobody has keyed, and it has two
refusals in front of it because the bare arithmetic reports 100% for work nobody
has touched.

A **missing remaining duration is not zero remaining**. `rd ?? 0` divided
`(OD − 0) / OD` and called every activity in the file complete. An import whose
Remaining Duration column was absent or unmapped came back reading 99.9% done
across 675 activities, with 0 running, 140 not started, and an earned curve that
stopped at 40% — because the hours those rows "earned" had no actual dates to
spread over, so they counted in the total and landed on no curve point. Two
figures on one screen, disagreeing, both wrong. P6 has said nothing about progress
without an RD, so the answer is now nothing rather than everything, and
`Summary.noRemainingDuration` counts the rows it happened to so the cause is on the
dashboard instead of inferred from a number that looks plausible.

An **activity P6 has not started has not progressed**, whatever its durations say.
That check is applied only where the file marks actual dates at all, which
`marksActuals()` asks of the import once. In a file that marks none, "no actual
start" means the export dropped the flag rather than that the work has not begun,
and zeroing every row on the strength of a flag that was never written would be the
same class of mistake pointing the other way. The flag is the better witness only
where the flag exists.

## How often the curve reports

Month ends were the only cadence, and they are the wrong one for a fortnightly
review. A data date of Wed 23 Sep against month-end periods put the last earned
point at 31 Aug — three weeks of reported progress off the end of the line — and
the DATA DATE marker on 30 Sep, because the marker was matched on `YYYY-MM` and the
nearest period was the one the data date fell *inside*. Nothing was stale. The grid
was too coarse to land on the day being reported, and two symptoms that looked like
separate bugs were one.

`periodEndsBetween(from, to, cadence, anchor)` steps out from the **data date** in
both directions, so a period lands exactly on it and the earned line ends where it
was measured. With no anchor, or on `month`, it is `monthEndsBetween` unchanged. The
series is extended one step past the end of the span, because a fixed step rarely
lands on the last finish and a curve whose final period falls short never reaches
100% — which reads as a plan that does not complete rather than as a grid that
stopped early.

Two grids come out of `computeModel`, on purpose. The curve runs at the review's
cadence; `monthlyEarned` and `monthlyRemaining` stay on month ends, because
timesheets are monthly and a fortnightly grid would key two rows to the same month
and silently halve one. `CurveChart` keys on the full period end rather than the
month, and draws the marker at the last period at or before the data date — which
is the data date itself once the curve is anchored on it, and still the honest place
for the line when it is not.

## When the Activity ID is wrong

The ID is parsed positionally: location is the 4th dash-delimited segment, phase the
2nd. That holds until a schedule carries a family that does not follow the
convention — `HTT` naming a location that is not in the 4th segment, `LMA` standing
for a phase. The two obvious answers are both bad: live with the mis-grouping, or
hard-code the exception in `parse.ts`, which means a code change for every new one
and no way for the person who found it to see why an activity groups where it does.

So the exceptions are data. `IdRule` says "if the Activity ID contains this text,
set its location (or phase) to that", first match wins, edited on the **Activity ID
Rules** screen and stored in `id-rules.json`.

They are applied in `computeModel`, not at import, and that placement is the point:
a rule added now re-groups the schedule already loaded, with nothing re-imported.
The import is never touched — `row.activity.location` still says exactly what P6
said, and deleting the rule puts everything back. `BudgetRow` carries
`locationFromRule` / `phaseFromRule` so a screen can say the reading was overruled.

Two consequences worth stating, both of which a rule applied later would have got
wrong. The rule resolves at the **top** of the row loop, before the complexity
factor is looked up, so an activity moved to another location prices at that
location's factor. And a location a rule invents is appended to the location stats,
because `locations.json` only ever learns codes discovery found — without it a code
rows were grouped under would be missing from the Locations screen and unable to
carry a factor at all.

The screen counts what each rule actually catches against the live schedule, with
the rules above it applied first. A rule matching nothing is the common mistake, and
it is silent: it reads exactly like one that is working.

## What changed on import

`diffSchedules(before, after)` compares the incoming file against the schedule of
the same kind already in use, and the Import screen shows it **before** the confirm
button — while it is still a decision rather than a fact. It reports only what P6
owns: dates, durations, the name, and whether a date became actual. Nothing the
user keyed is involved, because an import cannot touch it.

WBS rows are excluded. They carry rolled-up durations that move whenever anything
underneath them does, and including them would bury every real change under a
hundred summary rows that say nothing on their own. Duplicate Activity IDs resolve
first-wins, as every other join in the application does.

The slip list sorts worst first, which is the order somebody reading a change report
actually wants. "Newly finished" and "newly started" are separate lists rather than
one: an activity is not both.

## Which baseline

`data.baseline` is the newest baseline import and remains the default. A programme
that re-baselines still has to report variance against the baseline it was approved
on, so `settings.baselineImportId` can pin an earlier import and the planned curve,
the two-week log and every variance follow it.

Only the baselines that might be needed are read into memory — the newest, plus the
pinned one when that is a different import. Every baseline ever imported stays in
`imports/` and in the index; reading forty full schedules to populate a dropdown
would be absurd. A pinned id that is no longer in the index falls back to the newest
and says so rather than silently reporting against nothing.

## Capacity is the one thing the app cannot derive

The forecast already says what each group still has to do and what it will cost at
the rate that group achieves. Turning that into a staffing answer needs one more
fact — how many people are in the group — and no schedule contains it. So headcount
is keyed, per group, optionally from a month, and everything in `capacity.ts` is
arithmetic on it.

Two decisions worth stating. Demand is the forecast **cost**, not the budget: a
group converting at 0.7 needs half again as many hours as its work is worth, and
staffing against the budget would under-staff it by that much. Where a group has no
rate yet the budget is used instead, which is the only figure available. And a group
nobody has keyed a headcount for reports demand and **no verdict** — null supply,
null gap, null load — because "nobody has said" and "nobody is available" are
different claims and only one of them is true.

## Trend is read, not stored

`trendFrom` takes the monthly earned-against-built rows, which are already history,
and reports the last N active months against the N before them. Nothing has to be
snapshotted for it to exist.

Two window means rather than a fitted slope, deliberately: a regression through four
noisy months invites more confidence than four noisy months deserve. Months where
nothing was earned and nothing was built are dropped **before** the windows are
taken — otherwise a programme with a shutdown December reports a collapsing rate
every January, which is a fact about the calendar presented as a fact about the
work. And a pace of zero yields a null projection rather than a division that would
produce a finish date out of nothing moving.

## The status report

One page, printed or saved as PDF, for somebody who was not at the review. What goes
on it is a choice — which phase curves, whether the two-week log is included and
which outcomes from it — because the audience changes: a phase lead wants their own
curve and the fortnight's misses, a programme meeting wants the whole job.

The page carries almost no prose, and that is the point. Everything else in this
application explains itself as you work, through hints, notes under figures and a
glossary on every abbreviated heading. A printed page is read at a glance by someone
who cannot hover anything and will not read a paragraph, so it states figures and
names and leaves the explaining to whoever is presenting it.

Printing is CSS rather than a second rendering path. `@media print` drops the
sidebar, the save strips, the toasts, the page hero and everything marked
`.no-print` — which is the report builder — and unwinds the flex-column-at-viewport
-height layout the application uses into ordinary block flow, because paper has no
viewport. Chart tooltips are hidden too: a tooltip is wherever the cursor happened
to be, and on paper it is a box of numbers obscuring the chart it belongs to.

## Bulk edits take the filter as the selection

Budget Master's bulk panel applies to whatever the filters are showing. There is no
checkbox column, on purpose: it would be a second way to say what the row of
dropdowns already says, and the two would disagree the moment a filter changed under
a set of ticks. What you can see is what it touches, the count is in the button, and
the confirm says the number back. An override left with nothing in it is deleted
rather than kept as an empty row.

## Phases read in their own order

Every other rollup sorts by hours, biggest first, because the question there is
where the money is. The dashboard's phase buttons sort **numerically** on the `P<n>`
code, with the whole project first and non-numeric codes last. A row of phase
buttons is a place in the programme, and somebody looking for Phase 5 should find it
between 4 and 6 rather than wherever its budget puts it. It is a string sort only in
the sense that `P10` must come after `P9`, which is exactly what a string sort gets
wrong.


`test-progress.json` still stores only the activities someone actually keyed something
against. One upsert path creates an entry when the first field is filled and deletes it
again when the last field is cleared, so the file never accumulates empty rows. Stored
entries whose Activity ID is no longer budgeted are shown separately as orphans and can
be removed in bulk, rather than silently inflating a count.

A bare Activity ID is not a finding anybody can act on, so `TestProgressCheck` carries
the name, the phase, the location, the activity type, the budget hours, everything that
was keyed, and a sentence saying why the row earns nothing. The five cases are not the
same problem and must not be offered the same remedy: a WBS header and an ID in no
schedule are junk and are offered as a one-click bulk delete; a REVIEW or EXCLUDED row
is real work being blocked by the library or by the Show column, and deleting it would
throw away good keying. `checkReason()` in `compute.ts` writes that sentence, so the
wording lives in one place and is testable.

### Progress and dates are separate facts

Keying a percent says *how much*; it says nothing about *when*, and only the earn window
puts hours into a month or onto a curve point. Marking a row **done** sets the percent and
stamps no date — `updatedAt` is an audit field no curve reads. An activity at 100% that
P6 has never actually started and that carries no test window earns its hours into the
project total and into no month at all; that is what Earned vs Actual reports as
unphased. The Progress screen names those rows in a warning and can filter to them, and the
collapsible explainer at the top of the screen sets out the window precedence (TEST
WINDOW → P6 ACTUAL → IN PROGRESS → NOT STARTED) and what the monthly import changes.

## Import paths

Three formats reach the same `P6Activity[]`, so everything downstream is identical.

- **`.xlsx` / `.csv` / pasted rows.** The header row is located by name across the first
  twelve rows, which skips the title rows a P6 "export to Excel" puts on top, and the six
  columns are matched by synonym rather than by position. The detected mapping is shown on
  the import screen and every column can be corrected by hand before confirming. With no
  recognisable header, columns fall back to their usual order.
- **`.xer`, P6's native export.** Two differences are surfaced rather than hidden. XER
  holds durations in *hours*, so they are divided by the hours per day of each activity's
  own calendar from the CALENDAR table, or by a value the user sets (default 8) when the
  file carries no calendar. And the TASK table holds activities only, so an XER import has
  no WBS summary rows to exclude; since WBS rows never contributed hours, no figure
  changes. A file holding several projects offers a project picker.

The XER path also reads dates the Excel path cannot: a P6 constraint star (`01-Oct-26*`)
defeats Excel's `DATEVALUE`, but the native format carries a real timestamp.

## Adding a library key by hand

Keys are normally discovered from the schedule. **Add a key by hand** on the Activity
Library screen creates an entry no import produced, for a type known to be coming before
the schedule carries it.

The **Consolidate variant families** action that used to sit beside it is gone with tier
2. It created a shortened key and retired the variants, which only ever worked because
something widened the match afterwards; without that, consolidating would have retired
four priced keys in favour of one that matches nothing, silently zeroing their hours. A
button whose whole effect depended on a removed feature had to go with it.

A retired entry is excluded from matching and from the type count, and is never re-added by
a later import.

## Visual design — shared with cx-portal

The look is not invented here. The canonical `:root` token sheet at the top of
`src/app/index.css` is a **verbatim copy** of the one in `khouryai/cx-portal`
(`styles.css`, documented in that repo's `DESIGN_TOKENS.md`). Values were not
adjusted: the two applications are meant to read as one product. Only tokens
this app has no use for were left out (Test Register skin slots, PDF markup pen
colors).

The same rules of engagement apply here:

- **New colors go through tokens, not raw hex.** If a value you need does not
  exist, add it to the token sheet in the right category and use `var(--name)`.
- **Never open a second bare `:root {}` block.**
- Dark mode was deliberately removed there; it is not reintroduced here.

What carries the family resemblance, beyond the palette:

- **Archivo** for UI and display, **IBM Plex Mono** for every eyebrow, KPI
  label, table header and identifier. Both are self-hosted in
  `src/assets/fonts/`, copied from cx-portal's vendored `@fontsource` files, so
  there is no network call and the standalone build inlines them as data URIs
  (~120 KB of the single file). Latin subsets only.
- **The mono uppercase micro-label** — 9.5 to 10.5px, 0.06 to 0.16em tracking.
  It is the most recognisable mark of the language.
- **The chip-stat** — mono micro-label plus a bold tabular number in a tinted
  pill, semantic tone per status. Used for the page hero rail
  (`Page stats={…}`), the import preview tiles (`.factlet`) and the data
  quality counts.
- **One button grammar** — 8px radius, `--dur-fast` transition, 1px press,
  0.45 disabled opacity, and two roles only: solid Hitachi red is the primary
  action, bordered surface is everything else.
- **Status badges carry a leading dot** and a complete triple (strong ink, pale
  background, soft border tint of the same ink).
- **The sidenav** is near-black with a red radial brand wash, mono section
  labels, and a glowing red rail on the active item.

Two departures, both deliberate:

- Row-level tints are low-alpha washes (`.row-warn`, `.row-bad`) rather than
  the full `--warn-light` background. A status color sized for a badge is far
  too heavy across an entire table row.
- Filter banks live in their own toolbar row under the hero, not inside it.
  This app has screens with five filters; putting them in the hero crushed the
  title column.

Chart colors stay literal hex rather than `var(--…)`, matching cx-portal's own
exception for Chart.js palettes. Here the reason is the PNG export: it
rasterises through a detached SVG where custom properties do not resolve.

## There are no snapshots

There used to be: a frozen copy of every activity's percent complete on a status
date, written to `snapshots/`, plotted as diamonds against the earned curve, and
carrying its own hide-but-keep and delete-for-good rules. It is gone, with the module,
the screen, the store directory, the `CurvePoint.snapshot` column and the markers.

The reason is that it never answered the question it looked like it answered. A
diamond far off the earned curve tells you the underlying data changed after the
snapshot was taken, not what changed or whether the change was right, and the
apparatus around it — a status date separate from the data date, a hidden flag, a
delete that could not be undone — was a standing source of "which of these numbers is
the real one". What people actually wanted from it is a copy of the figures as at a
date, and **Settings → Export workbook** already writes one.

## The two-week log

`src/engine/period.ts` answers the question a fortnightly review actually asks —
*what was planned, what got done* — which is not readable off the S-curve. A curve
3% short of plan says nothing about **which** activities slipped.

Hours inside a window are measured exactly as the curve measures them: the accrued
fraction at the end minus the fraction the day before it began. That is the whole
reason `accruedFraction` is reused rather than reimplemented, and it is pinned by a
test that sums every consecutive fortnight across eight years and expects the
project total back. Planned comes back exact; earned comes back to `phasedEarned`,
short by exactly `unphasedEarned` — the activities with progress but no usable dates,
which belong to no window at all and which Earned vs Actual already reports.

An activity is listed if it did something in the window **or was supposed to**. That
is what makes NOT STARTED and MISSED mean anything: they are the activities the plan
was counting on. Outcomes are tested in order and the first that fits wins, so
COMPLETED beats STARTED for something that did both, and MISSED beats CONTINUED —
an activity due to finish in the window and still running is late, whatever else it
also did, and burying that under "still going" would be the screen lying politely.

### Finished is finished

An outcome is read off the **actual** dates — the test window where one was keyed,
otherwise P6's dates but only where P6 flags them actual — and never off a planned
date. `BudgetRow.actualStart` / `actualFinish` carry exactly that pair and are
deliberately not `earnStart` / `earnEnd`: the earn window closes a running activity
off at the data date so its hours have somewhere to accrue, which makes `earnEnd` a
placeholder rather than a finish, and reading one as the other is how an activity
gets reported as done because the plan said it would be.

The case that forced the split: baseline 31 Aug to 10 Sep, actually run 24 Aug to
2 Sep. The fortnight to 9 Sep signs it off. The fortnight to 23 Sep lists it again —
correctly, its baseline hours accrue into that window — and the old test, *did it
finish inside this window*, sent it to CONTINUED. The log was telling a review that
an activity it had already signed off was still running.

That second row is **COMPLETED EARLY**, its own outcome rather than more COMPLETED,
because the two answer different questions. "What did we finish this fortnight" is
the review's headline and must not be inflated by work signed off a month ago; "is
this activity still open" is what the row has to answer. `finishedOnTime` counts
finishing **by** the end of the window rather than inside it, or beating the baseline
would have read as a miss.

`PeriodActivity.actualFinish` is the date as it stands, ungated by percent complete —
the dates are editable on the log, and one that vanished the instant it was typed
because the percent had not caught up would be unusable. The outcome keeps its own
`finishedOn`, which is that date once the activity reads 100%, falling back to the
end of the earn window for the activity at 100% that nothing has dated.

### Editing an actual date

`ActualDateCell` (in `components/ui.tsx`, shared by the Two-Week Log and Test
Progress) shows the effective actual date and writes `testStartOverride` /
`testEndOverride` — the same field, not a second copy — so a date corrected at a
review immediately moves the earn window, the month the hours land in, the S-curve
and the log's own outcome. Clearing hands the date back to P6; typing P6's own date
back in is read as that rather than stored as an override shadowing it. The marker
beside the box says which source is on screen, because "8 Sep" tells nobody whether
it came from the schedule or from somebody in a meeting.

The Progress screen used to show only what had been keyed, so an activity P6 had dated sat
blank there while the log showed its actual dates — the same fact, one screen
admitting it and one not. Both now show the effective date. `earnWindowSource` reads
TEST WINDOW when *either* end is yours: a keyed end closes the window on that date,
and IN PROGRESS means "running to the data date", which would name the wrong end.

### What a row put into its phase

`Phase achieved` used to repeat the phase's achieved-against-planned figure on every
row of that phase, which made it a heading pretending to be data: sorting by it
sorted nothing and a row could not say what it had personally contributed. It is now
`phaseContribution` — the row's earned hours over its phase's **whole** budget, read
as percentage points of the phase. The denominator is the entire phase budget rather
than the part falling in the window, which is what makes the rows of a phase sum to
exactly the movement the phase line reports (`pctAtEnd − pctAtStart`), pinned by a
test. The old phase-level figure is still available as the optional `Phase of plan`
column, and `Achieved` was renamed `Project achieved` so the pair reads as what it
is: the same calculation against two different budgets.

### The open window, and the progress that never happened

An activity with an actual start and no finish earns across `actualStart → dataDate`,
because its hours have to accrue somewhere and the only assumption available is that
the work is still going on. For work genuinely ticking along that is right. For one
that reached 50% in its first week and has not moved since, it manufactures progress
in every fortnight from then on — and because the window stretches as the data date
advances, the same 50% keeps re-spreading over more and more weeks. A review reading
"achieved" off that is reading arithmetic, not work.

The app cannot know when the progress happened, so it asks: `TestProgress.progressAsOf`
is the date the current percent was true as at, and it closes the earn window there
instead of at the data date. `earnWindowSource` reads `PROGRESS AS AT` when it does.
It is explicitly **not** a finish — the activity is still open, `actualFinish` stays
null, and an activity that blew its baseline finish is still MISSED — which is exactly
why it cannot be folded into `testEndOverride`.

Total earned never changes; only which weeks it lands in, which is pinned by a test
summing every fortnight either way. Until it is set, `PeriodActivity.spreadToDataDate`
marks the rows whose achieved figure is a share of an open-ended spread, and the log
says so at the top of the screen as well as on the row: the figure being inflated is
the headline one.

### Where the log's window lives

`src/app/periodWindow.ts`, not the screen's `useState`. A review is not one page —
stepping back three fortnights, opening Budget Master to check an activity and coming
back used to remount the log, re-run its initialiser and snap the end date forward to
the data date, leaving somebody reading a different period than the one they left with
nothing on screen saying so. `end` is null until somebody picks one, which is not the
same as defaulting to the data date: null means *follow* it, so an untouched log still
opens on the current review after the next import moves it. localStorage, like the
column layouts and the hours/percent mode, because it is about this person and this
machine and has no business in the shared OneDrive store.

### A reason belongs to the activity

Answers are still stored per period — three consecutive misses usually have three
different stories and the third must not overwrite the first — but they are now
*read* per activity: `effectiveReasonFor` takes the exact period's answer if there is
one, otherwise the nearest period that activity has, flagged `carried`. Before that,
nudging the window's end date by a day blanked every reason on the screen, because an
exact `periodEnd` match was the only lookup. Writing an answer always stamps the
period on screen, so a fortnight that gets its own story keeps it; a carried one is
marked, on the row and in the tally, so a reused story is never passed off as this
week's.

### One progress note, two screens

`TestProgress.note` is the reviewer's own words on an activity, keyed from the
Two-Week Log or from the Progress screen through the same upsert — one field, not a copy on
each screen. It is deliberately not `ActivityOverride.note`, which explains why an
activity was renamed, hidden or re-priced: a pricing justification and "waiting on the
CTC cutover" are different sentences and neither should overwrite the other.

The chart pair (violet planned, green achieved) was run through a colour-vision
check rather than chosen by eye. Green is what earned already means on the S-curve;
blue, the obvious partner, separates from it by ΔE 4 under tritanopia and was
rejected for it. The outcome tiles carry their own words, so colour is never the
only thing saying what a group is.

### By phase, in the same window

"97% of plan" across a programme routinely hides one phase stalling behind another
finishing early, and the phase is what the person holding the review actually runs.
So `periodLog` also cuts the window by phase: planned, achieved, achievement, and
the phase's own percent complete at each end of the window. Two rules keep it
honest. The phases come from every in-budget activity rather than from the rows in
the log, so a phase that planned nothing is still listed — "Phase 3 did nothing" is
an answer, and a phase vanishing would read as the log having lost it. And a phase's
completeness is measured against **that phase's** budget, never as a share of the
programme, which is what makes two phases of very different sizes both readable as
"half done". `tests/period-phases.test.ts` pins that the parts add back to the whole.

### Why an activity was missed

The log could always say what slipped, to the hour. It could never say why, which is
the only half anybody acts on: "eleven missed" is a number, "seven waiting on access"
is a decision. Each MISSED activity carries a reason, in `missed-reasons.json`, and
two decisions about that file look arbitrary until the second fortnight:

- **The catalogue is kept, not derived.** A reason typed into the dropdown joins a
  stored list, rather than the list being read back off the reasons in use — or it
  would shrink every time somebody fixed something. It is extended from the dropdown
  itself, because the person who needs a category that does not exist yet is holding
  it in their head right then, and a trip to a settings screen is how it ends up
  recorded as "other".
- **A reason belongs to a period as well as an activity.** The same activity missed
  three fortnights running usually has three different stories, and the third
  overwriting the first would leave the first review unable to explain itself. The
  entries are therefore keyed on Activity ID *and* the window's end date, which is
  also what lets the period's KPI count only this period's answers.

The KPI states the unexplained count rather than leaving it as the gap between two
other numbers: it is the one thing on the screen a person can still fix before the
report goes out.

The list is editable from the log itself (**Reasons**), and what may be deleted is
decided by use rather than by origin: a reason nothing is recorded against is
clutter and goes, a reason somebody has already answered with stays, because
deleting it would leave their answer with nothing to say it. Built-in reasons are
deletable on the same terms — a list nobody picked is worth cutting down to the
handful a job actually argues about — which is what `removed` is for: the built-in
list lives in the code, not in the file, so a deletion has to be remembered or the
reason returns on the next render. Typing one back, or answering with it, un-removes
it.

### Keying the percent complete from the log

The Progress screen owns the percent complete, but it is not where somebody is
holding it at four o'clock on a Friday — it is being read out activity by activity in
the review. So the log's **% complete** cell writes through
`src/app/testProgress.ts`, the same upsert both screens use: one file, one set of
rules about when a row is created and when it is dropped. There is no copy and
nothing to reconcile — the percent complete, the earned hours and the curve all move
on the next render.

## Forcing in has to allocate something

Creating the library key was only half of it. A forced-in activity can reach IN
BUDGET and still carry **zero hours**, which is the failure that looks like success:
the row says IN BUDGET, the Progress screen lists it, and it adds nothing to any total.
Three causes, none visible from the row:

- a P6 original duration of zero (a milestone);
- a duration P6 never supplied;
- a RATE-basis key with no shift count, since RATE hours are crew x shift x shifts.

The third was the nastiest, because `libraryRateStatus` checked `isOnDefaults`
*before* the missing-shifts case. An entry with nothing set at all reported DEFAULT
— a reassuring word for something pricing every one of its activities at zero. The
order is now reversed, and the key Budget Master creates names `basis: 'DUR'`
explicitly rather than inheriting a Settings default that might be RATE.

What is left is genuine: a duration of zero cannot be priced by any rate. So
`summary.forcedInUnpriced` counts them, Budget Master carries a filter and a notice
naming them, and the notice offers to write an hours override across the lot —
which is independent of the library and survives every import.

## The vocabulary

Two words changed after the app was in use: what was **Discipline** is now
**Subsystem**, and what was **Subsystem** is now **Resource**. The stored field
names did not change with them — `activity-library.json` has carried `discipline`
and `crew[].subsystem` since the first release, and renaming a key would orphan
every file in every OneDrive folder and every backup taken from one.

So `src/engine/vocab.ts` holds the mapping and every screen reads `TERMS` from it.
The indirection is worth it precisely because the mapping is confusing to read: one
file that says so beats sixty string literals that quietly disagree. The exported
workbook uses the new words too, since that is what goes to the client.

## Hours or percent

`src/app/units.ts` is one setting shared by the Dashboard and the Two-Week Log, not
a toggle on each. "I am presenting to the client now" is a mode the person is in,
not a property of a page — flipping one screen and finding the other still full of
hours would miss the point entirely. It lives in `localStorage` for the same reason
the column layouts do.

In percent mode **not one man-hour figure survives** on either screen, which is the
requirement: a stray "93,240 h" in the corner of a client pack invites the
conversation about rates that the mode exists to avoid. The cards change what they
measure rather than relabelling, and the curve divides every series by the same
total, so the shapes are identical and only the axis changes — a percent curve that
disagreed in shape with the hours curve would mean one of them was lying.

## Fiscal years

`src/engine/fiscal.ts`. The arithmetic is trivial; the convention is what has to be
right, because getting it silently wrong shifts every reported figure by twelve
months. A year is named for the calendar year it **ends** in, the US federal and
transit convention: with a July start, Jul 2026 to Jun 2027 is FY27. January makes
a fiscal year a calendar year and the labels say so. The start month is a Setting.

In-year figures are summed from the months; the cumulative figures are taken from
the **last month** of the year rather than summed, because they are already running
totals and adding them would produce a number meaning nothing at all.

## A control that removed itself

The "hide the quiet months" checkbox on Earned vs Actual vanished the moment it was
unticked, leaving no way to switch it back on. The cause was one line:

```js
const quiet = burn.months.length - shownMonths.length;   // 0 whenever hideQuiet is false
... quiet > 0 || hideQuiet ? <label/> : undefined
```

`quiet` was derived as *rows before minus rows after*, which is zero when the filter
is off — so unticking made the control fail its own render condition. The count is
now taken from the data (`months.filter(m => m.earned === 0 && m.built === 0)`)
rather than from the effect of the toggle, which is what it always meant. A control
whose visibility depends on its own state is worth a second look wherever it appears.

## A fiscal year is not a forecast

Selecting a year on Earned vs Actual now also breaks that year down by resource:
what each earned, what it actually spent, the variance and the ratio.

It deliberately does **not** show to-complete or at-completion. Those divide the
whole remaining budget by a rate, and a remaining budget is not something one
fiscal year has — quoting one per year would be inventing a number. The
whole-project forecast stays in its own panel underneath, labelled as such.

### One derivation, four tables and five sheets

`fiscalYearDetail(months, startMonth)` returns each fiscal year with its groups
broken out, and each of those groups with the months that made it up. Everything on
Earned vs Actual that is cut by year reads that one structure — the year table, the
by-group table under a selected year, the months under a selected group, and the
per-group detail under the forecast — and so does `earnedVsActualSheets()` in
`src/app/export.ts`, which writes `Earned_vs_Actual`, `Fiscal_Year`, `FY_By_Group`,
`FY_By_Group_Month` and `Forecast_By_Group`.

That sharing is the point rather than a tidiness. A workbook somebody takes into a
funding meeting and a screen somebody reads it off must not be able to disagree, and
two independent pivots of the same months is exactly how they come to.

The four figures every one of these tables reports — earned, built, variance, factor
— are also defined once, by `coreColumns()` in `TeamHours.tsx`. A month, a fiscal
year, a group inside a year and a group's own months are the same question asked at
different resolutions; giving each its own hand-written column list is how the
labels drift apart and a reader starts wondering whether "Variance" means the same
thing two tables down.

## A forecast is not a measurement, and must not look like one

`monthlyRemaining()` lays each activity's remaining budget across the part of its
current-schedule window that has not happened yet, and `forecastYears()` groups the
result into fiscal years broken down by group. That answers the question the actual
years cannot: what does each group still need, and in which funding year.

Three cases, because remaining work does not always have a future to sit in. Work
**still to come** has its window clipped at the data date, so a half-elapsed
activity carries all of its remaining budget over its remaining days rather than
half of it. Work the schedule says is **overdue** lands in the first month ahead,
because that is when it is actually owed and spreading it over a window that has
closed would put spending in the past; where the whole schedule ends before the
data date, one month is added past the data date so late work still has a "now" to
land in. **Undated** work is returned separately and reported as a gap, the same
way `unphasedEarned` is.

The forward tables are a separate type from the backward ones, and their columns are
built by `forecastColumnsFor()` rather than `coreColumns()`. A past year reports two
measurements and the ratio between them; a future year reports one measurement —
budget left, a fact about the schedule — and one projection: what earning it costs
at the rate the group has actually achieved. Letting those share the headings
"Earned" and "Built" would invite somebody to read arithmetic-on-an-assumption as a
figure somebody counted. For the same reason a group that has booked no hours gets a
dash rather than a cost: there is no rate to project with, and a number there would
look exactly as measured as the ones beside it. There is no cumulative column
anywhere in the forward tables, because a running total that crosses from measured
into projected is a number with two meanings.

The workbook keeps the split: `FY_By_Group` carries `Earned_Hours` and
`Built_Hours`, `FY_Forecast_By_Group` carries `Budget_Left_Hours` and
`Forecast_Cost_Hours`, and a test asserts neither sheet grows the other's columns.

## Locations nobody uses

Import discovers a location the moment one Activity ID mentions it and never removes
it: the code may return in a later schedule revision, and a complexity factor typed
against it should survive that. But a code carrying no activities has nothing to
price and nothing to roll up, and a list padded with them makes the real ones harder
to find.

They are dropped once in `computeModel`, so every screen, filter and count below is
computed without them, and kept on `Model.unusedLocations` so the Locations screen
can admit they exist rather than appearing to have lost them. Hiding every activity
in a location empties it the same way, which is the consistent reading.

## Choosing columns

`SortableTable` takes an optional `tableId`, and with one it grows a Columns
popover. The layout — which columns, in what order — lives in `localStorage` and
emphatically not in the OneDrive store: it is about this person on this machine, and
putting it in the store would make every colleague inherit it and make "which
columns I like" something you have to remember to save.

Three lists, and the third is not redundant:

- `order` — left-to-right, by key. Keys the table no longer has are ignored, which
  is why it stores keys and not indices.
- `off` — columns switched off by hand.
- `on` — **optional** columns switched on by hand.

`on` has to exist separately because "not in `off`" cannot mean visible for a column
that starts hidden, and `order` cannot stand in for "columns this layout knows
about": reordering or hiding anything writes every key into it. A version that tried
that had a real bug — hide one column, and five optional columns nobody asked for
appeared. `tests/column-layout.test.ts` holds that case specifically.

Drift is tolerated in both directions. A column the layout has never heard of is new
since it was saved: it keeps its declared position, and if it is optional it stays
off, so shipping a new column cannot rearrange a table somebody had set up. The
move buttons step *over* hidden columns, because swapping a visible column with one
that is not on screen moves nothing the person can see and reads as a broken button.

### Widths, wrapping, and seeing the whole cell

Three related things, because "I cannot read that" has three different causes:

- **Wrap text** shows every cell in full over as many lines as it takes. Off by
  default: a table of one-line rows is far quicker to scan.
- **Dragging a heading's right edge** sets a width, kept in the same layout.
  The grip has to swallow its own click, or every resize would also sort the column.
- **Fit columns** widens each column to its own content, and has to measure in two
  passes. A column that is cut off is cut off *because* it is holding a width, so
  measuring it where it stands reads that width back and pins the truncation in
  place — which is exactly what the first version did. The table is rendered once
  with every width dropped (`.tbl.is-measuring`), the widths are read off that, and
  then applied.

Screens must not bake a `max-width` into a cell's own markup: the column decides the
width, and a clamp inside the cell is one nothing on the toolbar can undo. Long text
uses `.cell-text`, which clips to whatever the column currently is and opens up in
wrap mode.

### Exporting what is on screen

Every table with a `tableId` has an **Excel** button, and the promise is that the
sheet matches the screen: the showing columns, in the showing order, carrying the
rows as filtered and sorted. Somebody who has picked columns and filtered to one
phase has already said what they want; an export that dumped every field would be a
different document they then have to edit down. Cells come from `value()` — the raw
figure the column sorts on — rather than the badge or input drawn over it, and a
column can override that with `exportValue`. This is not a replacement for
**Settings → Export workbook**, which is the whole model in one file for project
controls; it is the answer to "send me that table".

## Table headings sit over their own data

`.tbl th` sets `text-align: left` and scores (0,1,1); `.num` sets `text-align: right`
and scores (0,1,0). The more specific rule won, so for a long time every numeric
*heading* sat at the left of a column of right-aligned *figures* — measured at 592px
adrift on a wide table. `.tbl th.num` now sets the alignment explicitly, specific
enough to win. `.num` on its own is not sufficient inside `.tbl th`, and the same trap
applies to any Tailwind utility used against `.tbl th` or `.tbl td` (`whitespace-normal`
loses to `.tbl td`'s `nowrap` for exactly the same reason, which is why the one cell
that has to wrap says so inline).

The same ordering trap bites buttons. `.btn-mini` mutes its text colour and is declared
*after* `.btn-primary` at equal specificity, so a small primary button — the selected
phase chip on the Dashboard — rendered muted grey on the red fill at a contrast ratio of
1.02:1, which is to say invisible. `.btn-mini.btn-primary` and `.btn-mini.btn-danger`
now restore the white, measured at 4.8:1.

The sort caret is rendered in a fixed-width slot whether or not the column is the
sorted one, and on a numeric column it goes *before* the label, so sorting a table can
never shift its headings sideways and the label's last character stays flush with the
figures. `tests/table-alignment.test.ts` guards both facts at source level.

## Opening straight onto the dashboard

The folder is chosen once and the handle is kept in IndexedDB, so the app always knows
which folder it wants. What lapses between launches is Chromium's *permission* to touch
it, and a page cannot grant itself that: `requestPermission()` needs a user gesture.

So the boot path tries three things in order, and stops at the first that works:

1. `queryPermission()`. Where the person answered **Allow on every visit**, this returns
   `granted` and the app opens on the dashboard having asked nothing. This is the only
   route to a genuinely zero-click start, which is why both the first-run screen and the
   reconnect screen name that option explicitly.
2. `requestPermission()` immediately, with no gesture. Where the grant is dormant rather
   than revoked this revives it silently. Where it is not, it costs nothing:
   `requestPermission` is wrapped so it never throws, and a failure just means "not yet".
3. A one-shot `pointerdown`/`keydown` listener on the window. Any click or keypress is a
   gesture, so the reconnect rides on whatever the person was going to do anyway rather
   than making them find a button first.

Both the button and the listener call the same guarded action: two overlapping requests
would mean two permission prompts and two opens of the same store. A refusal leaves the
app on the reconnect screen rather than dropping to first-run setup — the folder is
still chosen, and offering "choose a folder" as the answer invites someone to re-link a
folder they never unlinked.

## Storage rules

- Plain JSON only, never a single binary file written on every change.
- Atomic writes: `name.json.tmp` then rename over `name.json`.
- Retry with backoff on every step; a persistent failure is reported, never swallowed.
- Conflict copies (`name-MACHINE.json`, `name (1).json`) are detected on load and
  reported, never merged.
- Advisory `.lock` with owner and timestamp, refreshed every minute, warned about if a
  recent foreign lock exists. Never enforced.
- Read once into memory; written back a second or so after the edits stop. Auto-save is
  on by default, is a per-machine preference in the browser rather than a stored setting,
  and backs off after a failed write until the next edit so a folder that has gone offline
  cannot produce an error every second. Save now stays on the bar, and turning auto-save
  off restores write-only-on-Save. Imports are written when confirmed, as before.
- Imports are append only, with one deliberate exception: `removeImport()` deletes a
  named import file and its index row. An import is a statement of what P6 said on a
  day, and a wrong one — the wrong file, the wrong kind, a mis-mapped column — is
  worth being able to take back rather than work around forever. What makes it safe
  to offer is that it cannot reach anything the user owns: every edit lives in its
  own file keyed on the Activity ID, and none of them is under `imports/`. The index
  row goes first and the file second, because a stray file on disk is harmless while
  an index pointing at a deleted file is a load error. `isImportFile()` refuses any
  path that is not a canonical import, `imports/index.json` included. Afterwards the
  newest surviving import of that kind takes over, or none does — a job with no
  baseline is a job nobody has baselined, not a fault to report.

## Where the data can live

Three adapters back the same `StorageAdapter` interface, so the rest of the application
cannot tell them apart.

- **A OneDrive folder** through the File System Access API. The primary mode, and the one
  the rules above are written for. Needs a secure context, which `http://localhost`
  provides; it also works from `file://` in current Chromium, though permission tends not
  to persist there.
- **The browser profile** through IndexedDB. Real persistence across restarts, but on one
  machine only, with no sync, no backup and no version history, so the UI says so in a
  standing banner and pushes the user toward backups. This is the fallback when the folder
  API is unavailable or declined.
- **Memory**, for tests and for looking around without saving.

A whole-store backup (settings, library, locations, overrides, progress and both
schedules) downloads as one JSON file and restores into any of them, which is also how
you move between machines. A restore replaces the edited files but *appends* the
schedules, so the append-only import history is never rewritten.

## Crews, and who the hours belong to

An ATSCTP test takes one ATS engineer and one IXL engineer. Priced as "a crew of
two" the budget is right and the staffing question is unanswerable: nothing says
whether it is the ATS team or the IXL team that runs out of people.

So a library entry can carry a **crew breakdown** instead of a headcount: a line per
subsystem, each with a count and optionally its own shift length. `crewSize` still
works and is still the quickest way to price a type; where a breakdown exists it
replaces the headcount, and the headcount becomes the sum of the lines. The hours
are identical either way — that is the point. `stdHoursFor` sums the lines rather
than multiplying crew by shift, which is the same arithmetic unless one group works
a shorter shift, and then it is the arithmetic you wanted.

**The split is of the final budget figure, not of the standard hours.** An override
or a location complexity factor therefore carries through to every group, and the
parts always add back to the number on the Budget Master. `allocate()` splits an
integer total into integers by largest remainder, so 24 hours across three equal
groups reads 8/8/8 rather than three copies of 7.999999. A rollup that disagrees
with the total it was cut from is worse than no rollup.

Most activity types are one group's work, so the Activity Library has a **Subsystem
column you type into**, and the split editor is for the genuine two-group cases only.
Naming a group carries the headcount across unchanged (`assignSubsystem`), so it never
moves a budget figure; clearing it puts the entry back to a plain headcount and keeps a
count only if one was ever set by hand, so an entry does not silently read as priced.

Subsystem codes are **never a list you have to maintain first**. They are whatever
you type on a crew line or in that column; the Subsystems screen discovers them and lets you put a
name against a code afterwards, exactly as locations work. Hours from a crew with no
breakdown land under `''`, shown as Unassigned, so they are never lost and the gap
is visible.

A subsystem rollup is **not a partition**: an activity needing two groups counts
under both, so the activity counts across groups exceed the number of activities.
The hours do not overlap, so the hour totals still add back. That is stated on the
screen rather than left to be discovered.

### One activity, several subsystems

The Subsystem box on an Activity Library key is free text, and people use it to name
more than one group: "ATS, IXL" is an activity both work. Rolled up as a single
string that produced a group called "ATS, IXL" which is neither of them, while both
real groups read smaller than they are. So `splitDisciplines` reads the box as a
list and `groupRows` shares the activity between the names.

Two decisions inside that:

- **Evenly.** The box says who is on it, not how much each does. An even split is
  the only reading of that which does not invent a number nobody gave. Where the
  proportions really are known, the crew breakdown on the same key is the tool for
  it — that splits by headcount and shift length, and it is what the Resources
  screen reports.
- **Hours share, counts do not.** The weights sum to 1, so every rollup still adds
  back to the budget exactly; but one activity is one whole activity to each group
  that works it, and reporting "1.5 activities" would be arithmetic nobody can act
  on. The counts therefore overlap, exactly as they do on the Resources screen, and
  `GroupStat.shared` says by how many — which is what the rollup screen states
  rather than leaving somebody to find two numbers that disagree.

Separators are comma, semicolon, slash, pipe and plus. `&` and "and" are
deliberately not separators: "Test & Commissioning" is one group with an ampersand
in its name, and cutting it in half would be the app overruling what somebody typed.
Because the split is what the rollups report, the Activity Library shows a `÷n`
badge on a key that names several, and the Budget Master subsystem filter matches
the parts — drilling into the ATS row of a rollup has to find the activity that is
half ATS.

## Earned against built

The budget says what finished work was **worth**. Timesheets say what it **cost**.
Tracking only the first tells you how the job is going and nothing about whether it
is making money. Earning 5,000 hours in a month the team built 6,000 is a 1,000-hour
hole, and if that rate holds the rest of the job costs more than it is worth.

`TeamActual` is one row per month per subsystem, optionally per person, because that
is how timesheet exports come. `burnSummary` puts earned and built side by side per
month, cumulatively, and per subsystem within each month. The `factor` is earned
divided by built: below 1.00, every hour spent earns less than an hour. The
reforecast divides the remaining budget by that factor to get the hours still to
come, which is the earned-value estimate at completion expressed in hours rather
than currency, and is the number that answers "do we need to re-forecast".

Two honesty rules:

- **`phasedEarned` can be less than `totalEarned`.** An activity with a percent
  complete but no usable dates earns hours that belong to no month. The monthly rows
  are then short of the project total. The gap is computed, stated in a note and
  shown on the screen, rather than being quietly absorbed into whichever month was
  nearest.
- **Hours built against a subsystem holding no budget are flagged.** Nothing can
  ever be earned there, so those hours are pure loss unless a crew is missing a
  group. Silence would make it look like efficiency.

The monthly table trims empty months off each end, because the curve runs to the
last date in the schedule and a five-year programme otherwise shows forty rows of
zeros carrying the same cumulative figure. A gap in the *middle* is kept — a month
where the team built nothing is worth seeing — and hidden behind a toggle that says
how many it is hiding.

Reading the hours in is deliberately forgiving: `parseTeamHours` reads both shapes
the data actually arrives in (months across the top, or one row per month), and
`parseMonth` takes `2026-08`, `Aug-26`, `August 2026`, `08/2026`, an Excel serial or
a full date. Nobody should have to reformat a working spreadsheet to get their
numbers in. Totals rows are dropped rather than double counted, and re-pasting a
month replaces it rather than adding the hours twice.

## Explaining the abbreviations

The screens are full of shorthand that is obvious to whoever built it and opaque to
everyone else: OD, RD, Cx, BL src, factor, DUR. `src/engine/glossary.ts`
defines every term once, keyed by the exact column label, and `SortableTable` looks
the label up automatically — so a column called `OD` explains itself on hover
without any screen repeating the text, and a definition cannot drift between two
tables that use the same header.

Definitions say what a number **means and where it comes from**, never what it is
short for: "Original Duration" is not an explanation of "OD". `tests/glossary.test.ts`
enforces both halves — that every short label the screens use is defined or
explicitly marked self-evident, and that no definition is too short to be one.

## Rules for the Windows launcher scripts

`start.cmd`, `Create Desktop App.cmd`, `Update.cmd` and the two `.ps1` files beside
them are the only things here that run outside a browser, so a mistake in one reaches
the user's disk. One did: a `del "%VAR%"` with an
unset variable, which cmd resolved to the current directory and offered to empty. The
variable was unset because an unescaped `)` inside an `echo` had closed the enclosing
`if` block early, so lines meant to be skipped ran anyway.

Three rules, enforced by `tests/scripts.test.ts`:

1. **Nothing is ever deleted.** No `del`, `erase`, `rd`, `rmdir` or `format` in any
   `.cmd`, and `serve.ps1` may not call `Remove-Item`. If a script needs a scratch
   file, redesign it so it does not.
2. **Every `(` and `)` inside an `echo` is written `^(` and `^)`.** Inside a
   parenthesised block an unescaped bracket closes the block early, even in the
   middle of a quoted string, silently changing control flow.
3. **No temporary script files**, and no writing into `%TEMP%`.

`Create Desktop App.cmd` and `Update.cmd` additionally branch only with `goto :label`
and `call :label`, never with `( )` blocks, which removes rule 2's failure mode
entirely. `%ProgramFiles(x86)%` carries a bracket in its own name, so it is copied into
a plain variable on one line and only that variable is used afterwards.

`update.ps1` is the one script that must delete something — the folder it downloads
into — so it is the one exception, and it is fenced in:

- The single `Remove-Item` lives in one function, `Remove-Staging`, and six guards must
  all agree before it runs: the path is non-empty, the temp base is non-empty, the path
  starts with the temp base, it is at least 20 characters longer than the temp base, it
  contains `tc-budget-update-`, and it exists. An unset variable cannot survive that.
- Nothing under the application folder is ever removed, only copied over. A file the
  new build no longer ships is left behind. Clutter is the cheaper mistake.

## Updating in place

Re-downloading a zip to see a code change is friction that makes a change not worth
making, so `Update.cmd` fetches the current build itself. The infrastructure did not
need to change for this: `dist/` and `standalone/` were already committed as the
delivered product, so there was already something fetchable. What was missing was the
fetch, and a way to tell which build you are looking at.

**Two routes, chosen automatically.** A git clone with git on the PATH gets
`git pull --ff-only`. Anything else — the normal case, a folder extracted from a zip —
downloads `https://codeload.github.com/<repo>/zip/refs/heads/<branch>`, which needs no
token and no API call. A folder that is a clone but has no git is refused rather than
copied over, because that would silently modify tracked files. The repo and branch live
in `server/update.json`, not in the script, so moving to another branch is a data change
the updater can deliver to itself.

**Verify, then copy.** The download is unpacked to a staging folder and checked for
`dist/index.html`, `standalone/index.html`, `server/serve.ps1` and `start.cmd` before a
single file is copied. A truncated download, a 404 or a wrong zip therefore leaves a
working application exactly as it was. Copies retry five times with a growing wait, the
same pattern the app uses for saves, because OneDrive and the running server both take
brief locks.

**`Update.cmd` replaces itself.** cmd reads a batch file by byte offset and would
resume at that offset inside the new file, running whatever text happened to land
there. So the line that invokes the updater is the last line cmd ever reads:
`powershell … & pause & exit /b`. The whole line is already in memory, and `exit /b`
ends the script without another read. `tests/scripts.test.ts` enforces that shape.
PowerShell parses a script fully before executing it, so `update.ps1` overwriting
itself mid-run is safe.

**Knowing which build you have.** Vite `define` compiles the commit and build time into
the bundle; they show at the foot of the nav and under Settings → Version. The same
stamp is written to `dist/build.json`, because the updater cannot read a value out of a
minified bundle and needs to report what it replaced.

The commit in the stamp is the one the build was made *from*, so it names the parent of
the commit that carries the build — `dist/` is rebuilt and committed together with the
source it came from, and a commit cannot contain its own hash. The build time is the
part that is unique per build, and it is what the updater compares.

**Noticing a new build without a network call.** The app still makes no request to the
internet at runtime; updating is always something the user starts. But a window left
open all day would otherwise keep running the old code. On the served build the service
worker now installs a new version and *waits* rather than calling `skipWaiting()`:
taking over immediately would serve new assets to a page running old code. The page
checks for a new `sw.js` when it regains focus, shows a green bar, and only calls
`SKIP_WAITING` when the user clicks Reload — and the button is disabled while there are
unsaved changes. `index.html` is never answered from cache, so a new build can always
announce itself. The `file://` single-file build needs none of this: no worker, no
cache, and every launch reads the file fresh.

## Delivery without Node

The laptop this runs on has no Node.js and cannot install one, so `dist/` and
`standalone/` are built here and committed; they are the product, not build artefacts.

`start.cmd` serves `dist/` with `server/serve.ps1`, a static file server written against
raw .NET APIs so it runs on the Windows PowerShell 5.1 that ships with Windows. It binds a
`TcpListener` to `127.0.0.1` rather than using `HttpListener`, because `HttpListener` goes
through HTTP.sys and can demand a `netsh` URL reservation, which needs admin. A loopback
TCP socket on a high port never does.

`standalone/index.html` is the same application inlined into one file for when no server
can start. It is built as an IIFE rather than ES modules, because `file://` blocks module
scripts under CORS, and its script tag is moved to the end of `<body>` because an inline
script cannot be deferred the way Vite's module tag is.

## Figures

The build prompt's Section 10 table (267 rows, 23,296 hours) does not match the attached
workbook, whose own data yields 334 rows, 87 WBS, 247 activities, 27 locations, 75 types,
216 in budget, 21 excluded, 10 deleted, 0 review, 19,354 hours. The workbook wins; the
parity suite asserts against the workbook's own cached values, not the prompt's table.
