# T&C P6 Budget and S-Curve

A local desktop application that replaces the `TC_P6_Budget_SCurve.xlsx` workbook used to
budget and track Testing and Commissioning man hours on the BART CBTC program.

- Reads Primavera P6 exports directly: **`.xer` (P6's own format), `.xlsx` or `.csv`**.
  Excel is never needed, and the column order does not have to match.
- Opens the **whole P6 project** from its `.xer` on the **Schedule** screen — WBS, Gantt,
  logic, float, resources, codes, notebooks — while the budget keeps reading only the T&C
  activities, exactly as it read the filtered Excel export.
- Derives a man hour budget for every activity from a small reusable rate library.
- Tracks earned value from a percent complete you key by hand, falling back to P6
  duration only where nobody has keyed one.
- Plots planned, forecast and earned cumulative curves.
- Keeps all state as plain JSON in a OneDrive folder. No server, no database, no account,
  no network call at runtime.
- **Runs on a laptop with no Node.js, no installer and no admin rights.**
- Shares its visual design system with `khouryai/cx-portal`, down to the token
  sheet and typefaces, so the two read as one product.

The engine reproduces the source workbook's figures exactly for the same inputs
(`tests/workbook-parity.test.ts`).

## Running it

Two ways, both needing nothing installed. Pick one:

- **`Create Desktop App.cmd`** — run once. Makes a desktop icon you can pin to the
  taskbar, which opens the app in its own window. No server, no background process,
  no PowerShell scripts. Use this if PowerShell is restricted on your machine.
- **`start.cmd`** — serves the app from `127.0.0.1` using the PowerShell that ships
  with Windows, so Edge can install it as a proper PWA. Falls back to Python, then to
  the single-file version, if it cannot start a server.

See [docs/INSTALL.md](docs/INSTALL.md) for the trade-off between the two, pinning to the
taskbar, keeping the server running at logon, where the data lives, and what to do about
the "Do you want to run this script" prompt.

## Everything is done in the app

The workbook never has to be opened again, and neither does Excel:

| Job | Where |
| --- | --- |
| See the whole P6 project | **Schedule (P6)**: every activity under its WBS with a Gantt chart beside it — actual, remaining, critical and baseline bars, the data date, and the relationship lines, driving ones dark. Group by WBS, phase, location, work type, status or any activity code; filter by status, float (critical, near critical, negative), the next two or six weeks, or *finishing after baseline*; find by ID or name; choose and size columns (dates, float, constraints, resources, codes, user fields, the T&C budget's own hours); zoom from weeks to years; Excel exports what is shown. Pick an activity for its details — dates, float, constraint, resources, codes and fields, notebook, its T&C budget — and its predecessors and successors with which one is **driving**; **Trace driving path** lists the chain that sets its date. **T&C lookahead** lists the T&C work due to start in the next 2–12 weeks and what each is still waiting on, inside T&C or outside it, and who that other work belongs to. **Schedule checks** runs a DCMA-style review (negative float, out of sequence, open ends, hard constraints, leads, long durations, forecasts before the data date). **Resources** shows P6's labour by resource and month, and P6's planned hours against the budget by activity type. **About the file** shows the project's dates, calendars (work week and holidays), codes and every table in the file. It opens the file kept with the schedule in use, or any `.xer` just to look at, which saves nothing. Up and down arrows step through the activities. |
| Load a schedule | **Import**: drop an `.xer`, `.xlsx` or `.csv`, paste rows, or pick a file already in the folder. A **whole-project `.xer`** is read in full and the budget takes the T&C activities out of it by a scope rule — work type `TC` in the Activity ID by default, **proposed from the schedule already in use** so the first XER import reads exactly what the last Excel import did. The preview says how the two compare before anything changes, with one click to keep any odd activity by ID. It also offers P6's **data date** and a **baseline in the same file**, and keeps a compressed copy of the whole file for the Schedule screen. Columns are matched by header name and can be corrected by hand before importing. The history below can **remove** an import that should not have been made — the next newest of that kind takes over, or none does, and nothing you keyed is touched. |
| Price activity types | **Activity Library**: inline editing, plus adding keys by hand. An activity type is priced by an exact match on its library key; anything unmatched shows as REVIEW. Its **Subsystem** can name more than one — `ATS, IXL` — and every activity of that type then splits its hours evenly between them wherever the budget is rolled up by subsystem. |
| Split the KPIs by Static / Dynamic | Every activity is **Static**, **Dynamic** or **Other**. Set it once for a whole activity type in the **Activity Library** (Static / Dynamic column), or for one activity in **Budget Master** (same column, or Bulk edit on a filter), which wins; unset is Other. **By Phase & Location → Static / Dynamic** rolls the budget up by it, Budget Master filters by it, and the Excel export carries it on every activity sheet plus a **KPI_By_Static_Dynamic** sheet: budget, earned, remaining and percent complete for each phase and the whole project, split three ways. |
| Per-location complexity, and what each code means | **Locations**: a complexity factor per location, and a **Reported as** name — W40 is *Millbury Station*, 2W is *Phase 2* — which every screen, report and export then shows in place of the code. The code is still what everything joins on. |
| What P6's logic says about the T&C work | After an XER import: **Budget Master** shows each activity's **Total float** and what it is **Waiting on** (a red dot when that predecessor is the one holding the date, the owner's work type when it is outside T&C, and a link to it on the Gantt), with P6 status, P6 %, P6 planned hours, WBS, constraint and late finish on the Columns button and *Critical*, *Negative float* and *Waiting on work outside T&C* quality filters. The **Two-Week Log** says what a missed activity is waiting on and records *Predecessor work not complete* in one click. **Progress** shows P6's own percent beside yours. The **Dashboard** has a *From the P6 file* panel. The import's change report adds float lost and activities newly critical. |
| Edit one activity | **Budget Master**: rename it, set its discipline, override its hours, note why, or take it out of the budget or out of the program entirely. **Move it to another phase or location** — type it in the Phase or Loc cell, or use Bulk edit on a filter — and it moves on every screen, ahead of any Activity ID Rule, with the new location's complexity; clear it and it goes back. **Split it across locations** when it serves more than one — type `W40 50` in the Split cell (or `W40 50, 2W 50`, or `W40, 2W` for an even split) and whatever the percentages leave stays at its own location. Its hours, earned hours and complexity factor are divided the same way on every rollup by location, the Locations screen counts it at each by its share, and Bulk edit can split a whole filter at once. **Key its start or finish over P6's** and those dates are used everywhere until the schedule is corrected: the *Dates changed — for the scheduler* filter lists them with P6's dates beside yours and a note on why, ready for the Excel button, and says which ones a later import now agrees with so they can be cleared. It also says which resources the activity is crewed with and how many of each. Everything you edit is keyed on the Activity ID and survives every import; everything P6 owns is read-only. |
| Answer the REVIEW rows | REVIEW means the activity's type has no live key in the Activity Library — never added (a schedule brought back from the import history, a library restored from a backup) or retired — so it has no rate, carries no hours, and is on neither the Activity Library list nor Progress. Every row's **Why / what to do** column says which and what it needs, and **Budget Master → Needing REVIEW** (also at the top of the **Activity Library**) groups them by type with what each would carry on the default rate and one-click answers: **Add to library** or **Restore key** if it is work in this budget, **Exclude** if it belongs to someone else's, **Hide** if it is not work at all. Nothing is deleted. |
| What is in the percent complete | **Dashboard → What the percent complete counts**: earned hours over budget hours across the activities in the budget — exactly Budget Master's *In the budget* view — and how many are left out and why: excluded by you, hidden by you, excluded by their library key, deleted in P6, in REVIEW. It also says when activities with a percent but no actual start make the earned curve read lower than the percent. |
| Take an activity in or out of the budget | **Budget Master → In budget?** on any row: Auto (the library decides), Include, Exclude (listed, no hours, out of the percent) or Hide (remove). The views list *All*, *In the budget*, *Excluded* and *Hidden*, each with buttons to change everything shown at once. |
| Percent complete | **Progress**: every budgeted activity is already listed. Type a percent inline, apply one across a filter, or drop a spreadsheet. Anything left blank falls back to P6 duration. Each row also carries the **actual dates** and the **progress note** the Two-Week Log writes — the same fields, editable from either screen. Keyed rows that earn nothing are listed with the name, the type and a sentence on why — and on whether deleting one costs you anything. |
| Progress per phase or location | **By Phase & Location**: rollups by phase, location, subsystem or work type, with drill-through into a filtered Budget Master. An activity worked by two subsystems puts half its hours under each, so the groups still add back to the budget. |
| A fortnightly review | **Two-Week Log**: each Activity ID is listed once — a row the export repeats exactly is dropped everywhere, and an ID carried on two different rows is one line here with their hours added, marked with how many rows it stands for. what the baseline planned for the period, what was actually achieved, and every activity behind it — completed, started, continued, missed or never started. Outcomes are read off the actual dates, so an activity that beat its baseline reads **COMPLETED** in the fortnight it finished and **COMPLETED EARLY** in a later one its baseline ran on into, instead of reappearing as still running. **Actual start** and **Actual finish** are editable on the row — they write the same dates the Progress screen holds, so a correction made at the review moves the earn window, the curve and the outcome with it. Each row says what it put into its own phase and into the job. Every missed or never-started activity that still has no actual start or finish gets a **why** — anything under way or done is never asked, and a reason given before it started stops showing, counting and exporting the moment an actual date is keyed — picked from a list you extend from the dropdown itself and prune under **Reasons** (anything nobody has used yet can be deleted, the app's own suggestions included); the answer belongs to the activity, not the reporting date — whatever date the log is set to, it shows the last answer given and can be changed or cleared from there (clearing clears it at every date), while each answer stays stamped with the review it was given at as history for the export — and the reasons are totalled on the screen. Each row also takes a **progress note**, which is the same field the Progress screen shows and is separate from the Budget Master note. An activity that has started and not finished spreads its hours to the data date, so it shows movement in every period until somebody says when the work actually happened — those rows are flagged, and one **Progress as at** date on the row puts the hours in the weeks they were earned. The percent complete can be keyed straight from a row. Steps period by period and stays on the period you left it on, and copies as text for a report. |
| An Activity ID that parses wrong | **Activity ID Rules**: say that any ID containing `HTT` is at location HTT, or that `LMA` means Phase 1. First match wins, each rule reports how many activities it actually catches, and the import is never rewritten — delete the rule and everything goes back. |
| What a new import changes | **Import**: before you confirm, the preview says which activities slipped and by how many days, which were pulled in, which completed, which are new and which are gone. |
| Staffing the work ahead | **Capacity**: what the forecast asks of each group in each fiscal year or month, against the headcount you key. Says which periods are short, and by how many hours. |
| What-if on people | **Staffing Scenarios**: pick a resource group (IXL by default) and up to four scenarios side by side — eight people, four people, four with two more from a date you choose. Each one says when the group's work finishes against the planned finish, when the **backlog** (work the current schedule says should already be done) is cleared, and which activities run late, with a week-by-week chart of the work left against what the schedule expects. Effort is the remaining budget divided by an **efficiency factor** you key (1.0 is to budget; the factor the group has achieved is one click away). The backlog is worked first, then each activity no earlier than its planned start and no faster than its own crew. Added support can carry an **until** date for a temporary assignment, or be left open-ended for a permanent one. Each scenario also says where its hours went to the finish: **supplied**, **idle** (paid for with nothing available to work on — what over-staffing costs), **lost to efficiency** (worked but earning nothing at an efficiency below 1.0), and the two together as **burned, not earned**. It also says the fewest people that hold the planned finish. **What is analysed** is yours to set: the group's own activities only (the ones whose Activity Library **Subsystem** names it), or also the hours it puts into other groups' activities as crew support; one or several phases, a work type (TC for the test activities) and a location; and a **Planned to finish by** date, so the analysis covers the work due by then rather than the whole schedule — backlog is always in, and slip and people needed are judged against that date. **By phase** stacks the group's hours each week by phase against the team's hours — as P6 plans them, or as a scenario actually works them — so phases that run side by side show where they overlap, with each phase's planned and forecast finish beneath. The activities analysed are listed **by type**, once per type however many locations it repeats at, with a tick to take a type out and a click to list its activities. Inside a type, each activity's planned start and finish, budget hours left and crew can be changed, or the activity unticked, **for the simulation only** — Budget Master and every other screen keep the schedule's figures; changed rows are marked and can be reset one at a time or all at once. Scenarios are kept in this browser only and never change the headcount on Capacity. |
| A page to hand over | **Status Report**: the fortnight first — its cards, its activities and why each was missed — then the phase curves you pick, then progress by phase. It reads as the Two-Week Log reads, because that is where the review happens. The whole job's position is off unless you ask for it. Print it, save it as a PDF, or save it as PNGs sized for a Word page — portrait or landscape, one image per page, stamped with their real size so Word places them without shrinking them. |
| Defaults, dates, storage, backups | **Settings** |
| Hand a spreadsheet to project controls | **Settings → Export everything**: the full data extract (below). **Original workbook layout** writes only the source workbook's sheets. Curve CSV and chart PNG are on the Dashboard. |
| An Excel extract on a schedule | **Settings → Scheduled Excel export**: every day, every weekday, a day of the week, every two weeks or a day of the month, at a time you set, into a folder you choose (or the data folder's `exports`). A new dated file each time, one `TC_Budget_Data_latest.xlsx` replaced each time, or both. |
| The S-curve as a picture, on a schedule | **Settings → Scheduled S-curve export**: `SCurve_Latest.png`, one curve for each phase ticked (and the whole project, if ticked), stacked one above the other in phase order. Each has its DATA DATE line and a red TODAY line, and its title says how complete it is against how complete the baseline expected it to be — at the data date and by today, with the gap in points. In % complete or man hours, on its own schedule, into the Excel export's folder, a folder of its own or the data folder's `exports`. **Download a copy** makes one there and then. |

## The full data extract

**Export everything** — and every scheduled export — writes one workbook nobody needs the
application to read:

- **Contents** lists every sheet and what it holds, with when and from which schedule it was made.
- **Data_Dictionary** defines every column on every sheet, and says how its values are written.
- **Status_Codes** says what every status value means: Status, Rate_Status, Basis,
  Baseline_Source, Pct_Source, Earn_Window, In_Budget_Setting, Review_Cause, the Two-Week Log outcomes, and where a phase
  or location came from.
- **All_Activities** is every activity with every field the screens show and every edit you
  made — names, statuses, location codes and names, splits, dates and P6's dates beside yours,
  progress, notes — hidden activities included and marked.
- **Activity_Locations** and **Activity_Resources** give one row per location share and per
  crew line, ready to pivot.
- After an XER import, `All_Activities` ends with P6's own fields — status, float, critical,
  late dates, constraint, P6 percent, WBS, predecessors and successors, what is still open
  — and **P6_Waiting_On** has one row per predecessor still open on an activity: whose work
  it is and whether it is the one holding the date.
- **Rollups**, **Resources** and **Resource_Cuts** are the By Phase & Location and Resources
  screens; **Two_Week_Log** and **Two_Week_Phases** are the fortnight to the data date against
  the baseline, with the reason recorded for every miss; **Capacity_By_Month**, **Headcount**,
  **Team_Hours**, **Library_Crew**, **ID_Rules**, **Import_History**, **Stale_Edits** and
  **Data_Notes** hold the rest.
- Then every sheet of the original workbook layout.

Hours, percentages and dates carry Excel number formats and every table has a filter on its
headings. A test holds every heading on every sheet to having a definition.

The **schedule** and the export folder are kept in this browser on this machine, so a
colleague opening the same data folder does not start exporting too. The app has to be open to
export; if it is closed at the scheduled time the export runs as soon as it is next opened,
once. If the browser asks for the folder again, a strip at the top says so and one click allows
it and exports. A file open in Excel cannot be replaced; the run says so and the next one tries
again.

## Sharing with the client

The Dashboard and the Two-Week Log have a **Man hours / % complete** switch. In
percent mode every hours figure disappears — cards, curve, axis, tooltips, the
exported PNG and the copied text — and the screens report progress only. It is one
setting shared by both screens, remembered per machine.

## Planned value

**Earned vs Actual** carries the planned value (PV) beside what was earned: each
month's **Planned (PV) h** — the budget hours the baseline planned to earn in it,
every activity's budget spread evenly over its baseline dates exactly as the planned
S-curve spreads it — with **Cum PV**, **SV** (cumulative earned minus cumulative
planned) and **SPI** (cumulative earned over cumulative planned) up to the data date.
Opening a month's groups gives the same per resource. **Planned value by resource**
is the grid: every resource down the side, every month of the plan across it —
including the months still to come — in the month or cumulative, with the Excel
button to take it away. The exported workbook carries it as `PV_By_Group_Month`.

## Fiscal years

**Earned vs Actual** rolls the months up by fiscal year, with earned, actual,
variance, factor and how complete the job was at each year end. Click a year to
narrow the screen to it and break it out **by resource group**; open a group to see
its own months inside that year. Under the forecast table, opening a group shows it
year by year and month by month across the whole project. The year is named for the
calendar year it ends in, so with a July start Jul-26 to Jun-27 reads as FY27; set
the start month in **Settings**.

**Fiscal years still ahead** does the same for the work that is left: what the
current schedule still plans to earn in each year, broken out by group, and what
earning it will cost at the rate each group has actually achieved. A group that has
booked no hours yet shows a dash rather than a cost, because there is no rate to
project with. Opening a group under **Forecast by resource** shows both directions
at once — the years it has been through and the years it still has ahead.

The exported workbook carries the same cuts, so the detail survives the trip to a
meeting: `Earned_vs_Actual` (every month), `Fiscal_Year` (the year totals),
`FY_By_Group` (each group inside each year), `FY_By_Group_Month` (the grid those
totals are made of), `Forecast_By_Group` (each group's estimate at completion), and
`FY_Forecast`, `FY_Forecast_By_Group` and `FY_Forecast_By_Month` for the years still
to come.

## Reporting fortnightly

The S-curve plots at month ends by default. **Settings → S-curve reports** switches
it to every two weeks or every week, anchored on the **data date** — so a data date
of Wed 23 Sep puts a period exactly there, the earned line runs to the day you
measured rather than to the month end before it, and the DATA DATE marker sits on
it. Changing the cadence changes where the line is sampled, never what it sums to.

## Which way it is moving

Every other figure reports a position. **Earned vs Actual** also carries the
direction: the factor and the progress-per-month over the last three active months
against the three before them, and how long the rest will take at that pace. Quiet
months are dropped before the comparison, so a shutdown December does not read as a
collapse every January.

## Percentages, not just hours

Hours answer "how big"; a percentage answers "how big next to everything else", and
most tables now carry both. Rollups, Locations and the Activity Library each show a
**Share** of the budget; Earned vs Actual shows percent complete per month and an
**Overrun** as a share of each group's own budget; the Dashboard cards say what
fraction of the budget is earned and what fraction is left.

## Choosing your columns

Most tables have a **Columns** button: tick what you want to see, move what matters
to the front. Some detail columns start switched off. The choice is remembered per
table, in this browser on this machine only — it is not written to the shared folder,
so it never becomes something a colleague inherits.

Beside it are three more, and they are remembered the same way. **Wrap text** shows
every cell in full instead of cutting it off at the column edge; **Fit columns**
widens each column to its own content; and dragging the right-hand edge of any
heading sets that column's width by hand (double-click the edge to put it back).

## Sending somebody one table

Every one of those tables also has an **Excel** button, and what it writes is what
you are looking at: the columns you have chosen, in the order you have put them,
with the rows as you have filtered and sorted them. It is the answer to "send me
that list". **Settings → Export workbook** is the other thing — the whole model in
one file, every sheet, for project controls.

## Getting the .xer out of P6

In P6 on the web (EPPM): **Projects → EPS**, select the project, then **Actions → Export**
and choose **XER**. In P6 Professional: **File → Export → Primavera PM (XER)**. Export the
whole project — not a filtered layout — and include its baseline if P6 offers it. Then drop
the file on **Import** as the current schedule. The menus move between P6 versions; the
format does not.

## Development

```
npm install
npm test               # engine, storage and import-format suites
npm run dev            # dev server on http://localhost:47800
npm run build          # rebuilds BOTH dist/ and standalone/ — commit them together
npm run test:ui        # playwright smoke tests; needs a build, serves it on 127.0.0.1:4173
TC_WORKBOOK=path/to/TC_P6_Budget_SCurve.xlsx npm test   # parity against the real workbook
node scripts/build-p6-fixture.mjs   # rebuilds fixtures/full-project.xer, the whole-project test file
```

`dist/` and `standalone/` are committed deliberately: the laptop that runs this cannot
build them. They are two builds of the same source — `dist/` is what `start.cmd` serves,
`standalone/index.html` is what the desktop icon opens from disk — so they are always
rebuilt and committed together. `npm run build` makes both, and `tests/shipped-build.test.ts`
fails if one is left stale.

Real P6 exports and the live workbook are commercially sensitive and are ignored by git.
The only schedule data in the repo is the anonymised fixture in `fixtures/`, rebuilt with
`npx vite-node scripts/build-fixture.ts`.

## Layout

```
src/engine     pure calculation engine (no storage, no UI): pricing, progress,
               curve, rollup, burn, capacity, staffing, trend,
               schedule diff; xer*.ts read a whole P6 project (calendars,
               logic, scope, outline)
src/storage    StorageAdapter: File System Access, IndexedDB, memory; atomic writes, lock, conflicts
src/app        React screens: Dashboard, Schedule, Import, Library, Locations,
               Budget Master, Progress, Two-Week Log, Earned vs Actual, Capacity,
               Staffing Scenarios, Settings; src/app/schedule is the Schedule
               screen's grid, Gantt, details and tabs
server/        serve.ps1 (no-install Windows server), serve.mjs (Node equivalent),
               build plugins for the service worker and the single-file bundle
dist/          built application, committed
standalone/    the whole application as one HTML file, committed
fixtures/      anonymised fixture schedules (.xlsx, .xer, .tsv) and expected figures;
               full-project.xer is a whole synthetic project, logic and all
tests/         vitest suites (the engine, in a second, with no browser)
tests-ui/      playwright smoke tests: every screen opens, the data paths work
docs/          INSTALL.md, DESIGN.md
```

See [docs/DESIGN.md](docs/DESIGN.md) for the calculation rules, the Excel semantics kept on
purpose, and the known limitations that are surfaced in the UI rather than fixed.
