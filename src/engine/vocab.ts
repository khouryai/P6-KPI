/**
 * What the program calls things on screen.
 *
 * Two of the words changed after the app had been in use, and the stored field
 * names could not change with them: `activity-library.json` has carried
 * `discipline` and `crew[].subsystem` since the first release, and renaming a key
 * would orphan every file in every OneDrive folder and every backup taken from
 * one. So the storage keeps its own names underneath and the words a person reads
 * live here, once.
 *
 * | stored key            | on screen   |
 * | --------------------- | ----------- |
 * | `discipline`          | Subsystem   |
 * | `crew[].subsystem`    | Resource    |
 *
 * That mapping is deliberately confusing to read, which is the whole reason it is
 * written down in one file rather than spelled out in sixty string literals. If
 * the vocabulary shifts again, this is the only place that changes.
 */
export const TERMS = {
  /** Stored as `discipline`: the grouping set on an Activity Library key. */
  discipline: 'Subsystem',
  disciplinePlural: 'Subsystems',
  disciplineLower: 'subsystem',
  disciplineLowerPlural: 'subsystems',

  /** Stored as `subsystem` on a crew line: who actually does the work. */
  subsystem: 'Resource',
  subsystemPlural: 'Resources',
  subsystemLower: 'resource',
  subsystemLowerPlural: 'resources',
} as const;
