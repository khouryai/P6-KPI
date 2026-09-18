# T&C P6 Budget and S-Curve

A local desktop application that replaces the `TC_P6_Budget_SCurve.xlsx` workbook used to
budget and track Testing and Commissioning man hours on the BART CBTC program.

- Reads Primavera P6 exports directly: **`.xer` (P6's own format), `.xlsx` or `.csv`**.
  Excel is never needed, and the column order does not have to match.
- Derives a man hour budget for every activity from a small reusable rate library.
- Tracks earned value from test case completion counts rather than P6 duration.
- Plots planned, forecast and earned cumulative curves with snapshot markers.
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
| Load a schedule | **Import**: drop an `.xer`, `.xlsx` or `.csv`, paste rows, or pick a file already in the folder. Columns are matched by header name and can be corrected by hand before importing. |
| Price activity types | **Activity Library**: inline editing, plus adding keys by hand. An activity type is priced by an exact match on its library key; anything unmatched shows as REVIEW. Its **Subsystem** can name more than one — `ATS, IXL` — and every activity of that type then splits its hours evenly between them wherever the budget is rolled up by subsystem. |
| Per-location complexity | **Locations** |
| Edit one activity | **Budget Master**: rename it, set its discipline, override its hours, note why, or take it out of the budget or out of the program entirely. It also says which resources the activity is crewed with and how many of each. Everything you edit is keyed on the Activity ID and survives every import; everything P6 owns is read-only. |
| Get rid of REVIEW rows you will never price | **Budget Master**: filter to *Needing REVIEW*, then **Hide**. Hidden activities leave every total, curve and export, nothing is deleted, and the Hidden view brings them back. |
| Test case counts | **Test Progress**: every budgeted activity is already listed. Key counts inline, bulk-fill across a filter, or drop a spreadsheet. Each row also carries the **progress note** the Two-Week Log writes — one field, editable from either screen. Keyed rows that earn nothing are listed with the name, the type and a sentence on why — and on whether deleting one costs you anything. |
| Progress per phase or location | **By Phase & Location**: rollups by phase, location, subsystem or work type, with drill-through into a filtered Budget Master. An activity worked by two subsystems puts half its hours under each, so the groups still add back to the budget. |
| A fortnightly review | **Two-Week Log**: what the baseline planned for the period, what was actually achieved, and every activity behind it — completed, started, continued, missed or never started. Outcomes are read off the actual dates, so an activity that beat its baseline stays **COMPLETED** in the next period instead of reappearing as still running. Each row says what it put into its own phase and into the job. Every missed activity gets a **why**, picked from a list you extend from the dropdown itself and prune under **Reasons** (anything nobody has used yet can be deleted, the app's own suggestions included); the answer stays with the Activity ID rather than the exact end date, and the reasons are totalled on the screen. Each row also takes a **progress note**, which is the same field Test Progress shows and is separate from the Budget Master note. Test counts can be keyed straight from a row. Steps period by period, and copies as text for a report. |
| Status snapshots | **Snapshots**: take one, take it off the S-curve while keeping the record, or delete one that should never have been written. |
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
narrow the monthly table to it and to break that year down by resource. The year is named for the calendar year it ends in,
so with a July start Jul-26 to Jun-27 reads as FY27; set the start month in
**Settings**.

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
               Test Progress, Snapshots, Settings
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
