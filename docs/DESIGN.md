# Design notes

## What the numbers mean

The engine (`src/engine`) is a module of pure functions with no storage or UI
dependency. `computeModel(input)` takes the settings, locations, library, overrides, test
progress, both schedule imports and the snapshots, and returns every derived figure the
screens show. It reproduces the source workbook's numbers exactly; see
`tests/workbook-parity.test.ts`.

Order of resolution per activity:

1. Row type: blank Activity Name is a WBS row. Parsed, stored, never budgeted.
2. Location: 4th dash-delimited segment of the trimmed Activity ID.
3. Activity type: everything after the first `" - "` in the name.
4. Exclude reason: `(Deleted)` or `(Cancelled)` anywhere in the name, case-insensitive.
5. Match key: exact (case-insensitive) library key, else the type with its last
   parenthetical group dropped, else unresolved (`REVIEW`, zero hours).
6. Status: exclude reason, then `REVIEW`, then `EXCLUDED` (include is `N`), then `IN BUDGET`.
7. Hours: `RATE` = crew × shift hours × duration shifts; `DUR` = crew × shift hours ×
   max(0, original duration). Rounded after the location's complexity factor. An
   override replaces the rounded figure and bypasses the factor.
8. Percent complete: direct override, else tests complete / tests total, else P6 duration.
9. Earn window: test window override, else actual start to actual finish, else actual
   start to the data date. Missing actual start means `NOT STARTED`.
10. Curves: each activity's hours spread calendar-linearly across its window; earned
    hours (budget × pct) across the earn window, with `null` past the data date.

## Excel semantics that were kept on purpose

- **Case-insensitive keys.** Excel `MATCH`, `COUNTIF` and `SEARCH` ignore case. The
  workbook therefore treats `IXL Cutover (by BART)` and `IXL Cutover (By BART)` as one
  library key. Every join goes through `normKey`.
- **First match wins.** Duplicate Activity IDs in a baseline or test progress list
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

## The `retired` library flag

The prompt says tier 2 fires only once the user has consolidated the library by hand,
and that import never deletes a library entry. Without a marker, a consolidated variant
would be re-added by the next import and tier 1 would catch it again. A library entry
with `retired: true` is therefore excluded from matching and from the type count, and is
never re-added by discovery. Retire and restore are on the Activity Library screen.

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

The Dashboard can be cut down to one phase. `buildCurve(rows, snapshots, dataDate)`
takes the rows rather than reading the model, so a phase curve is the same arithmetic
over a subset and cannot disagree with the programme curve it is part of; the snapshot
diamonds are cut to the same rows, and the percentages are of the subset's own budget,
which is what "Phase 2 is 40 per cent done" means. `rowTotals(rows)` does the same for
the four KPI cards, counting activities over budgeted rows only so the cards and the
phase tiles under them agree. Data quality and the summary stay whole-programme, and
the screen says so.

## Test progress is schedule-driven

The Test Progress screen lists **every budgeted activity**, always. There is no list
to build and no way for the worksheet to drift out of step with the schedule: the rows
*are* `model.rows` filtered to `IN BUDGET`, joined to whatever has been keyed.

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
puts hours into a month or onto a curve point. Marking a row **done** sets the count and
stamps no date — `updatedAt` is an audit field no curve reads. An activity at 100% that
P6 has never actually started and that carries no test window earns its hours into the
project total and into no month at all; that is what Earned vs Built reports as
unphased. Test Progress names those rows in a warning and can filter to them, and the
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

## Consolidating the library

Tier 2 matching only fires when a shorter key exists to match against, and import never
invents one. Two actions on the Activity Library screen close that loop:

- **Add a key by hand** creates a library entry that no activity name produced.
- **Consolidate variant families** finds keys that differ only by their last parenthetical
  (the `(DF: W40 -> Y10)` families), creates the shortened key carrying the rates of an
  already-priced variant, and retires the variants. Their activities then resolve through
  tier 2 to the single consolidated entry, which Budget Master marks with a T2 badge.

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

## Hiding a snapshot

`computeModel` drops hidden snapshots once, at the top, before anything reads them.
That keeps them out of the markers, out of the curve's `snapshot` column, and out of
the date range the curve spans — a snapshot dated three years past the end of the work
must not be able to stretch the chart once it has been hidden. The record itself is
unchanged, and the exported `Status_History` sheet still carries every snapshot with an
`On_Curve` column, because a history that quietly dropped rows would not be a history.

Hide is the right move far more often than delete: a marker sitting well off the earned
curve usually means the rates, dates or test counts changed after it was taken, which
is worth explaining rather than erasing. Delete is for a snapshot that should never
have existed — a wrong status date, a duplicate.

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
  off restores write-only-on-Save. Imports and snapshots are written when confirmed,
  as before.
- Imports are append only.
- Snapshots are never *edited*: a correction is a new snapshot, not a rewrite. The two
  exceptions are deliberate and explicit, and both act on a named file rather than on a
  status date (two snapshots can share one). **Hiding** sets `hidden` and rewrites that
  one file; the lines, the status date and the taken-at are untouched. **Deleting**
  removes the file, and there is no other copy. Both go through `isSnapshotFile()`, so a
  path outside `snapshots/` is refused rather than obeyed.

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

A whole-store backup (settings, library, locations, overrides, test progress, both
schedules and every snapshot) downloads as one JSON file and restores into any of them,
which is also how you move between machines. A restore replaces the edited files but
*appends* the schedules and snapshots, so the append-only history is never rewritten.

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
everyone else: OD, RD, LOE, Cx, BL src, factor, tier 2. `src/engine/glossary.ts`
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
