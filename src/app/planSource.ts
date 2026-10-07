/**
 * The plan a Two-Week Log window is measured against, read from the schedule update
 * in force when the window began. Which update that is, and how each one knows its
 * data date, is `updateDates.ts`; this only fetches it and turns it into a plan.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ImportIndexEntry, ScheduleImport } from '../engine/types';
import { planFromUpdate, type PeriodPlan } from '../engine/period';
import { useApp } from './state';
import { fmtDate } from './format';
import { updateFor, type UpdateDate } from './updateDates';

/** Imports never change once written, so a file read once is good for the session. */
const cache = new Map<string, ScheduleImport>();

export type PlanState =
  /** Measured against the baseline, because that was asked for. */
  | { kind: 'baseline' }
  /** An update was asked for and none is dated on or before the window's start. */
  | { kind: 'none' }
  | { kind: 'loading'; entry: ImportIndexEntry; date: UpdateDate }
  | { kind: 'missing'; entry: ImportIndexEntry; date: UpdateDate }
  | { kind: 'ready'; entry: ImportIndexEntry; date: UpdateDate; plan: PeriodPlan };

/**
 * The plan for a window starting on `from`. Reads the update's file the first time
 * it is needed; the update in use is already in memory and is never read again.
 */
export function usePeriodPlan(from: string, against: 'update' | 'baseline'): PlanState {
  const { state, actions } = useApp();
  const current = state.data.current;
  const pick = useMemo(
    () => (against === 'update' ? updateFor(state.data.importsIndex, current?.id ?? null, state.data.settings.dataDate, from) : null),
    [against, state.data.importsIndex, current?.id, state.data.settings.dataDate, from],
  );
  const file = pick?.entry.file ?? null;
  const inMemory = pick && current && pick.entry.id === current.id ? current : file ? cache.get(file) : undefined;
  const [, setTick] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!pick || inMemory) return;
    let live = true;
    actions
      .readImport(pick.entry)
      .then((imp) => {
        if (!live) return;
        if (imp) cache.set(pick.entry.file, imp);
        else setFailed(pick.entry.file);
        setTick((n) => n + 1);
      })
      .catch(() => live && setFailed(pick.entry.file));
    return () => {
      live = false;
    };
  }, [pick, inMemory, actions]);

  const plan = useMemo(
    () => (pick && inMemory ? planFromUpdate(inMemory.activities, pick.date.date, { id: pick.entry.id, label: `update of ${fmtDate(pick.date.date)}` }) : null),
    [pick, inMemory],
  );

  if (against === 'baseline') return { kind: 'baseline' };
  if (!pick) return { kind: 'none' };
  if (plan) return { kind: 'ready', entry: pick.entry, date: pick.date, plan };
  if (failed === pick.entry.file) return { kind: 'missing', entry: pick.entry, date: pick.date };
  return { kind: 'loading', entry: pick.entry, date: pick.date };
}
