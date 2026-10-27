/**
 * The columns the activity grid can show: every field of an activity a scheduler
 * looks at, plus each activity code and user field the project actually uses, plus
 * the T&C budget's own figures for activities in the scope.
 *
 * Most start switched off, the way a P6 layout starts with a handful — the Columns
 * button turns on the rest, and the choice is remembered on this machine.
 */
import type React from 'react';
import type { Column } from '../components/ui';
import { normKey } from '../../engine/keys';
import { phaseOf, workTypeOf, locationOf } from '../../engine/parse';
import {
  CONSTRAINT_LABEL,
  TASK_TYPE_LABEL,
  codeOf,
  freeFloatDays,
  hrsToDays,
  isCritical,
  p6Percent,
  totalFloatDays,
  wbsCode,
  wbsPathName,
  type P6Task,
} from '../../engine/xerProject';
import type { ScheduleCtx } from './context';
import { fmtMs } from './timeline';

/** A grid column: a table column with a width in pixels, since the grid is laid out by hand. */
export type GridColumn = Column<P6Task> & { px: number };

const DAY = 86_400_000;

const days = (n: number | null): string => (n === null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const msDay = (ms: number | null): number | null => (ms === null ? null : Math.floor(ms / DAY));
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString().slice(0, 10));

export function gridColumns(ctx: ScheduleCtx): GridColumn[] {
  const { model, project, baseline, budgetById } = ctx;
  const bl = (t: P6Task) => baseline.get(normKey(t.code));
  const budget = (t: P6Task) => budgetById.get(normKey(t.code));
  const hasBaseline = baseline.size > 0;
  const floatCell = (t: P6Task): React.ReactNode => {
    const tf = totalFloatDays(t);
    if (tf === null) return '';
    const crit = isCritical(t, project);
    return <span className={tf < 0 ? 'tone-bad font-semibold' : crit ? 'tone-bad' : ''}>{days(tf)}</span>;
  };
  const dateCol = (key: string, label: string, get: (t: P6Task) => number | null, opts: Partial<GridColumn> = {}): GridColumn => ({
    key,
    label,
    px: 92,
    value: (t) => msDay(get(t)),
    render: (t) => fmtMs(get(t)),
    exportValue: (t) => iso(get(t)),
    ...opts,
  });

  const cols: GridColumn[] = [
    { key: 'code', label: 'Activity ID', px: 186, locked: true, value: (t) => t.code },
    { key: 'name', label: 'Activity Name', px: 250, value: (t) => t.name },
    { key: 'status', label: 'Status', px: 96, optional: true, value: (t) => t.status, hint: 'P6’s activity status: not started, in progress or complete.' },
    { key: 'od', label: 'OD', px: 56, num: true, value: (t) => hrsToDays(t.odHrs, t.hpd), render: (t) => days(hrsToDays(t.odHrs, t.hpd)) },
    { key: 'rd', label: 'RD', px: 56, num: true, value: (t) => hrsToDays(t.rdHrs, t.hpd), render: (t) => days(hrsToDays(t.rdHrs, t.hpd)) },
    dateCol('start', 'Start', (t) => t.start, { render: (t) => `${fmtMs(t.start)}${t.actStart !== null ? ' A' : ''}` }),
    dateCol('finish', 'Finish', (t) => t.finish, { render: (t) => `${fmtMs(t.finish)}${t.actFinish !== null ? ' A' : ''}` }),
    { key: 'tf', label: 'Total float', px: 92, num: true, value: (t) => totalFloatDays(t), render: floatCell },
    { key: 'pct', label: 'P6 %', px: 58, num: true, value: (t) => p6Percent(t), render: (t) => pct(p6Percent(t)), exportValue: (t) => Math.round(p6Percent(t) * 1000) / 1000 },
    dateCol('blStart', 'BL Start', (t) => bl(t)?.start ?? null, { optional: true }),
    dateCol('blFinish', 'BL Finish', (t) => bl(t)?.finish ?? null, { optional: !hasBaseline }),
    {
      key: 'var',
      label: 'BL Finish var',
      px: 76,
      num: true,
      optional: !hasBaseline,
      value: (t) => {
        const b = bl(t)?.finish ?? null;
        return b === null || t.finish === null ? null : Math.round((msDay(b)! - msDay(t.finish)!) as number);
      },
      render: (t) => {
        const b = bl(t)?.finish ?? null;
        if (b === null || t.finish === null) return '';
        const v = msDay(b)! - msDay(t.finish)!;
        return <span className={v < 0 ? 'tone-bad' : v > 0 ? 'tone-good' : ''}>{v > 0 ? `+${v}` : v}</span>;
      },
    },
    { key: 'ff', label: 'Free float', px: 66, num: true, optional: true, value: (t) => freeFloatDays(t), render: (t) => days(freeFloatDays(t)) },
    { key: 'crit', label: 'Critical', px: 62, optional: true, value: (t) => (isCritical(t, project) ? 'Yes' : ''), render: (t) => (isCritical(t, project) ? <span className="tone-bad font-semibold">Yes</span> : '') },
    dateCol('es', 'Early start', (t) => t.earlyStart, { optional: true }),
    dateCol('ef', 'Early finish', (t) => t.earlyFinish, { optional: true }),
    dateCol('ls', 'Late start', (t) => t.lateStart, { optional: true }),
    dateCol('lf', 'Late finish', (t) => t.lateFinish, { optional: true }),
    dateCol('as', 'Actual start', (t) => t.actStart, { optional: true }),
    dateCol('af', 'Actual finish', (t) => t.actFinish, { optional: true }),
    dateCol('ps', 'Planned start', (t) => t.plannedStart, { optional: true, hint: 'P6’s planned start. Until an activity starts, P6 keeps it level with the early start; after that it stays where it was.' }),
    dateCol('pf', 'Planned finish', (t) => t.plannedFinish, { optional: true, hint: 'P6’s planned finish. Until an activity starts, P6 keeps it level with the early finish; after that it stays where it was.' }),
    { key: 'cstr', label: 'Constraint', px: 130, optional: true, value: (t) => (t.cstrType ? CONSTRAINT_LABEL[t.cstrType] ?? t.cstrType : '') },
    dateCol('cstrDate', 'Constraint date', (t) => t.cstrDate, { optional: true }),
    { key: 'type', label: 'Activity type', px: 120, optional: true, value: (t) => TASK_TYPE_LABEL[t.type] },
    { key: 'cal', label: 'Calendar', px: 140, optional: true, value: (t) => model.calendars.get(t.calUid)?.name ?? '' },
    { key: 'wbsCode', label: 'WBS', px: 140, optional: true, value: (t) => wbsCode(model, t.wbsUid) },
    { key: 'wbsName', label: 'WBS name', px: 200, optional: true, value: (t) => wbsPathName(model, t.wbsUid) },
    { key: 'phase', label: 'Phase', px: 60, optional: true, value: (t) => phaseOf(t.code) },
    { key: 'workType', label: 'Work type', px: 72, optional: true, value: (t) => workTypeOf(t.code) },
    { key: 'loc', label: 'Location', px: 72, optional: true, value: (t) => locationOf(t.code) },
    { key: 'preds', label: 'Preds', px: 54, num: true, optional: true, value: (t) => model.predsOf.get(t.uid)?.length ?? 0 },
    { key: 'succs', label: 'Succs', px: 54, num: true, optional: true, value: (t) => model.succsOf.get(t.uid)?.length ?? 0 },
    {
      key: 'rsrc',
      label: 'Resources',
      px: 160,
      optional: true,
      value: (t) =>
        (model.assignmentsOf.get(t.uid) ?? [])
          .map((a) => model.resources.get(a.rsrcUid)?.code ?? model.roles.get(a.roleUid)?.code ?? '')
          .filter(Boolean)
          .join(', '),
    },
    { key: 'units', label: 'Budgeted units', px: 80, num: true, optional: true, value: (t) => sumUnits(ctx, t, 'budgetQty'), render: (t) => fmtNum(sumUnits(ctx, t, 'budgetQty')) },
    { key: 'remUnits', label: 'Remaining units', px: 80, num: true, optional: true, value: (t) => sumUnits(ctx, t, 'remainQty'), render: (t) => fmtNum(sumUnits(ctx, t, 'remainQty')) },
    { key: 'scope', label: 'T&C', px: 48, optional: true, value: (t) => (ctx.inScope(t) ? 'Yes' : ''), hint: 'In the T&C scope: one of the activities the budget reads.' },
    { key: 'budget', label: 'Budget h', px: 72, num: true, optional: true, value: (t) => budget(t)?.budgetHours ?? null, render: (t) => fmtNum(budget(t)?.budgetHours ?? null) },
    { key: 'earnedPct', label: 'Budget %', px: 66, num: true, optional: true, value: (t) => budget(t)?.pctComplete ?? null, render: (t) => (budget(t) ? pct(budget(t)!.pctComplete) : ''), hint: 'Percent complete as the budget counts it: keyed on Progress, else from P6’s durations.' },
  ];

  for (const ct of ctx.codeTypes) {
    cols.push({ key: `code:${ct.uid}`, label: ct.name, px: 110, optional: true, value: (t) => codeOf(model, t.uid, ct.uid)?.short ?? '', hint: `Activity code: ${ct.name}.` });
  }
  for (const u of ctx.udfTypes) {
    cols.push({
      key: `udf:${u.uid}`,
      label: u.label,
      px: u.dataType === 'TEXT' ? 150 : 90,
      num: u.dataType === 'NUMBER' || u.dataType === 'COST',
      optional: true,
      value: (t) => model.taskUdfs.get(t.uid)?.get(u.uid) ?? null,
      hint: `User-defined field: ${u.label}.`,
    });
  }
  return cols;
}

function sumUnits(ctx: ScheduleCtx, t: P6Task, field: 'budgetQty' | 'remainQty'): number | null {
  const list = ctx.model.assignmentsOf.get(t.uid);
  if (!list || list.length === 0) return null;
  let n = 0;
  for (const a of list) {
    const type = a.rsrcType || ctx.model.resources.get(a.rsrcUid)?.type || 'Labor';
    if (type === 'Labor') n += a[field];
  }
  return Math.round(n * 10) / 10;
}

function fmtNum(n: number | null): string {
  return n === null ? '' : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
