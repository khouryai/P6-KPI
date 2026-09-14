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

## Figures

The build prompt's Section 10 table (267 rows, 23,296 hours) does not match the attached
workbook, whose own data yields 334 rows, 87 WBS, 247 activities, 27 locations, 75 types,
216 in budget, 21 excluded, 10 deleted, 0 review, 19,354 hours. The workbook wins; the
parity suite asserts against the workbook's own cached values, not the prompt's table.
