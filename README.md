# T&C P6 Budget and S-Curve

A local desktop application that replaces the `TC_P6_Budget_SCurve.xlsx` workbook used to
budget and track Testing and Commissioning man hours on the BART CBTC program.

- Ingests two Primavera P6 exports, the live schedule and the baseline, by file, paste or
  from the storage folder.
- Derives a man hour budget for every activity from a small reusable rate library.
- Tracks earned value from test case completion counts rather than P6 duration.
- Plots planned, forecast and earned cumulative curves with snapshot markers.
- Keeps all state as plain JSON in a OneDrive folder. No server, no database, no account,
  no network call at runtime.

The engine reproduces the workbook's figures exactly for the same inputs
(`tests/workbook-parity.test.ts`).

## Quick start (Windows)

Double-click `start.cmd`, then follow [docs/INSTALL.md](docs/INSTALL.md) to install it as
an Edge app and pin it.

## Development

```
npm install
npm test                      # engine and storage tests against the committed fixture
npm run dev                   # Vite dev server on http://localhost:47800
npm run build                 # typecheck + production build into dist/
npm run serve                 # serve dist/ on http://localhost:47800
TC_WORKBOOK=path/to/TC_P6_Budget_SCurve.xlsx npm test   # parity against the real workbook
```

Real P6 exports and the live workbook are commercially sensitive and are ignored by git
(`*.xlsx`, `*.csv`, the OneDrive folder). The only spreadsheet in the repo is the
anonymised fixture in `fixtures/`, rebuilt with `npx vite-node scripts/build-fixture.ts`.

## Layout

```
src/engine     pure calculation engine (no storage, no UI)
src/storage    StorageAdapter: File System Access, IndexedDB, memory; atomic writes, lock, conflicts
src/app        React screens: Dashboard, Import, Library, Locations, Budget Master,
               Test Progress, Snapshots, Settings
server/        static localhost server and the service worker precache plugin
fixtures/      anonymised fixture workbook, inputs and expected figures
tests/         vitest suites
docs/          INSTALL.md (desktop install, logon task), DESIGN.md (rules and deviations)
```

See [docs/DESIGN.md](docs/DESIGN.md) for the calculation rules, the Excel semantics that
were kept on purpose, and the known limitations that are surfaced in the UI rather than
fixed.
