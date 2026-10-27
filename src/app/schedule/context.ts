import type { BudgetRow, ScopeRule } from '../../engine/types';
import type { P6CodeType, P6Project, P6ProjectInfo, P6Task, P6UdfType } from '../../engine/xerProject';

/** Baseline dates for one activity, from a baseline project in the file or the baseline import. */
export type BaselineDates = { start: number | null; finish: number | null };

/** What every part of the Schedule screen reads: one project, its scope, and the budget behind it. */
export type ScheduleCtx = {
  model: P6Project;
  project: P6ProjectInfo;
  /** The project's activities, in file order. */
  tasks: P6Task[];
  inScope: (t: P6Task) => boolean;
  scope: ScopeRule;
  /** By normalised Activity ID. */
  baseline: Map<string, BaselineDates>;
  /** Where the baseline came from, for saying so; null when there is none. */
  baselineLabel: string | null;
  dataDate: number | null;
  /** The budget's row for an in-scope activity, by normalised Activity ID. */
  budgetById: Map<string, BudgetRow>;
  codeTypes: P6CodeType[];
  udfTypes: P6UdfType[];
  selectedUid: string | null;
  select: (uid: string | null) => void;
  /** Open the Activities tab showing just these, with a label saying why. */
  showList: (uids: string[], label: string) => void;
  /** Open the Activities tab on one activity. */
  reveal: (uid: string) => void;
};
