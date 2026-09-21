# T&C P6 Budget and S-Curve

A local desktop application that replaces the `TC_P6_Budget_SCurve.xlsx` workbook used to
budget and track Testing and Commissioning man hours on the BART CBTC program.

- Reads Primavera P6 exports directly: **`.xer` (P6's own format), `.xlsx` or `.csv`**.
  Excel is never needed, and the column order does not have to match.
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
| Load a schedule | **Import**: drop an `.xer`, `.xlsx` or `.csv`, paste rows, or pick a file already in the folder. Columns are matched by header name and can be corrected by hand before importing. The history below can **remove** an import that should not have been made — the next newest of that kind takes over, or none does, and nothing you keyed is touched. |
| Price activity types | **Activity Library**: inline editing, plus adding keys by hand. An activity type is priced by an exact match on its library key; anything unmatched shows as REVIEW. Its **Subsystem** can name more than one — `ATS, IXL` — and every activity of that type then splits its hours evenly between them wherever the budget is rolled up by subsystem. |
| Per-location complexity | **Locations** |
| Edit one activity | **Budget Master**: rename it, set its discipline, override its hours, note why, or take it out of the budget or out of the program entirely. It also says which resources the activity is crewed with and how many of each. Everything you edit is keyed on the Activity ID and survives every import; everything P6 owns is read-only. |
| Get rid of REVIEW rows you will never price | **Budget Master**: filter to *Needing REVIEW*, then **Hide**. Hidden activities leave every total, curve and export, nothing is deleted, and the Hidden view brings them back. |
| Percent complete | **Progress**: every budgeted activity is already listed. Type a percent inline, apply one across a filter, or drop a spreadsheet. Anything left blank falls back to P6 duration. Each row also carries the **actual dates** and the **progress note** the Two-Week Log writes — the same fields, editable from either screen. Keyed rows that earn nothing are listed with the name, the type and a sentence on why — and on whether deleting one costs you anything. |
| Progress per phase or location | **By Phase & Location**: rollups by phase, location, subsystem or work type, with drill-through into a filtered Budget Master. An activity worked by two subsystems puts half its hours under each, so the groups still add back to the budget. |
| A fortnightly review | **Two-Week Log**: what the baseline planned for the period, what was actually achieved, and every activity behind it — completed, started, continued, missed or never started. Outcomes are read off the actual dates, so an activity that beat its baseline reads **COMPLETED** in the fortnight it finished and **COMPLETED EARLY** in a later one its baseline ran on into, instead of reappearing as still running. **Actual start** and **Actual finish** are editable on the row — they write the same dates the Progress screen holds, so a correction made at the review moves the earn window, the curve and the outcome with it. Each row says what it put into its own phase and into the job. Every missed activity gets a **why**, picked from a list you extend from the dropdown itself and prune under **Reasons** (anything nobody has used yet can be deleted, the app's own suggestions included); the answer stays with the Activity ID rather than the exact end date, and the reasons are totalled on the screen. Each row also takes a **progress note**, which is the same field the Progress screen shows and is separate from the Budget Master note. An activity that has started and not finished spreads its hours to the data date, so it shows movement in every period until somebody says when the work actually happened — those rows are flagged, and one **Progress as at** date on the row puts the hours in the weeks they were earned. The percent complete can be keyed straight from a row. Steps period by period and stays on the period you left it on, and copies as text for a report. |
| An Activity ID that parses wrong | **Activity ID Rules**: say that any ID containing `HTT` is at location HTT, or that `LMA` means Phase 1. First match wins, each rule reports how many activities it actually catches, and the import is never rewritten — delete the rule and everything goes back. |
| Defaults, dates, storage, backups | **Settings** |
| Hand a spreadsheet to project controls | **Settings → Export workbook**, plus curve CSV and chart PNG on the Dashboard. |

## Sharing with the client

The Dashboard and the Two-Week Log have a **Man hours / % complete** switch. In
percent mode every hours figure disappears — cards, curve, axis, tooltips, the
exported PNG and the copied text — and the screens report progress only. It is one
setting shared by both screens, remembered per machine.

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

## Development

```
npm install
npm test               # engine, storage and import-format suites
npm run dev            # dev server on http://localhost:47800
npm run build          # rebuilds BOTH dist/ and standalone/ — commit them together
TC_WORKBOOK=path/to/TC_P6_Budget_SCurve.xlsx npm test   # parity against the real workbook
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
src/engine     pure calculation engine (no storage, no UI)
src/storage    StorageAdapter: File System Access, IndexedDB, memory; atomic writes, lock, conflicts
src/app        React screens: Dashboard, Import, Library, Locations, Budget Master,
               Progress, Two-Week Log, Earned vs Actual, Settings
server/        serve.ps1 (no-install Windows server), serve.mjs (Node equivalent),
               build plugins for the service worker and the single-file bundle
dist/          built application, committed
standalone/    the whole application as one HTML file, committed
fixtures/      anonymised fixture schedules (.xlsx, .xer, .tsv) and expected figures
tests/         vitest suites
docs/          INSTALL.md, DESIGN.md
```

See [docs/DESIGN.md](docs/DESIGN.md) for the calculation rules, the Excel semantics kept on
purpose, and the known limitations that are surfaced in the UI rather than fixed.
