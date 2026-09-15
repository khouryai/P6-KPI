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

Double-click **`start.cmd`**. That is the whole procedure.

It serves the prebuilt application from `127.0.0.1` using PowerShell, which ships with
Windows, and opens it in Edge. If PowerShell is blocked it falls back to Python, and if
that is missing too it opens `standalone\index.html`, which is the entire application in
one self-contained file.

See [docs/INSTALL.md](docs/INSTALL.md) for installing it as a pinned desktop app, keeping
the server running at logon, choosing where the data lives, and troubleshooting.

## Everything is done in the app

The workbook never has to be opened again, and neither does Excel:

| Job | Where |
| --- | --- |
| Load a schedule | **Import**: drop an `.xer`, `.xlsx` or `.csv`, paste rows, or pick a file already in the folder. Columns are matched by header name and can be corrected by hand before importing. |
| Price activity types | **Activity Library**: inline editing, plus adding and consolidating keys. |
| Per-location complexity | **Locations** |
| Override one activity's hours | **Budget Master** |
| Test case counts | **Test Progress**: drop a spreadsheet or paste a block. |
| Status snapshots | **Snapshots** |
| Defaults, dates, storage, backups | **Settings** |
| Hand a spreadsheet to project controls | **Settings → Export workbook**, plus curve CSV and chart PNG on the Dashboard. |

## Development

```
npm install
npm test               # engine, storage and import-format suites
npm run dev            # dev server on http://localhost:47800
npm run build:all      # rebuild dist/ and standalone/ — commit the result
TC_WORKBOOK=path/to/TC_P6_Budget_SCurve.xlsx npm test   # parity against the real workbook
```

`dist/` and `standalone/` are committed deliberately: the laptop that runs this cannot
build them. Rebuild and commit both whenever `src/` changes.

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
