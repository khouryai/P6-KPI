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

## Test progress is schedule-driven

The Test Progress screen lists **every budgeted activity**, always. There is no list
to build and no way for the worksheet to drift out of step with the schedule: the rows
*are* `model.rows` filtered to `IN BUDGET`, joined to whatever has been keyed.

`test-progress.json` still stores only the activities someone actually keyed something
against. One upsert path creates an entry when the first field is filled and deletes it
again when the last field is cleared, so the file never accumulates empty rows. Stored
entries whose Activity ID is no longer budgeted are shown separately as orphans and can
be removed in bulk, rather than silently inflating a count.

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

## Storage rules

- Plain JSON only, never a single binary file written on every change.
- Atomic writes: `name.json.tmp` then rename over `name.json`.
- Retry with backoff on every step; a persistent failure is reported, never swallowed.
- Conflict copies (`name-MACHINE.json`, `name (1).json`) are detected on load and
  reported, never merged.
- Advisory `.lock` with owner and timestamp, refreshed every minute, warned about if a
  recent foreign lock exists. Never enforced.
- Read once into memory; write only on explicit Save. Imports and snapshots are the
  exception: confirming an import or writing a snapshot is the explicit action.
- Imports and snapshots are append only.

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
