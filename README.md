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
| Price activity types | **Activity Library**: inline editing, plus adding and consolidating keys. |
| Per-location complexity | **Locations** |
| Edit one activity | **Budget Master**: rename it, set its discipline, override its hours, note why, or take it out of the budget or out of the program entirely. Everything you edit is keyed on the Activity ID and survives every import; everything P6 owns is read-only. |
| Get rid of REVIEW rows you will never price | **Budget Master**: filter to *Needing REVIEW*, then **Hide**. Hidden activities leave every total, curve and export, nothing is deleted, and the Hidden view brings them back. |
| Test case counts | **Test Progress**: every budgeted activity is already listed. Key counts inline, bulk-fill across a filter, or drop a spreadsheet. Keyed rows that earn nothing are listed with the name, the type and a sentence on why — and on whether deleting one costs you anything. |
| Progress per phase or location | **By Phase & Location**: rollups by phase, location, discipline or work type, with drill-through into a filtered Budget Master. |
| Status snapshots | **Snapshots** |
| Defaults, dates, storage, backups | **Settings** |
| Hand a spreadsheet to project controls | **Settings → Export workbook**, plus curve CSV and chart PNG on the Dashboard. |

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
