/**
 * The XER half of the Import screen: which project, which activities, and what else
 * the file can set.
 *
 * An Excel export arrived as the T&C list and nothing else. An XER is the whole
 * project, so before anything is imported this panel says which slice the budget
 * will read — and against the schedule already in use, whether that slice is the
 * same one the Excel export was. The scope it proposes is built to reproduce that
 * export exactly, so the first XER import is a like-for-like update rather than a
 * change of source anybody has to reconcile.
 */
import { useMemo, useState } from 'react';
import type { ImportKind, P6Activity, P6ImportInfo, ScopeRule } from '../../engine/types';
import type { LoadedProject } from '../xerFile';
import { fmtBytes } from '../xerFile';
import { compareScope, describeScope, normalizeScope, projectRoles, proposeScope, scopedActivities, segmentCounts, type ScopedImport } from '../../engine/xerScope';
import { msToDate } from '../../engine/xerText';
import type { P6ProjectInfo } from '../../engine/xerProject';
import { Badge, Notice } from '../components/ui';
import { fmtDate } from '../format';
import { isValidISO } from '../../engine/dates';

export type XerChoice = {
  projUid: string;
  /** A baseline project in the same file to import alongside, or ''. */
  baselineUid: string;
  scope: ScopeRule;
  /** Put P6's data date into Settings. */
  setDataDate: boolean;
  /** Keep the whole file for the Schedule screen. */
  keepFile: boolean;
  hoursPerDay: number;
};

/** The choices a freshly read file starts with. */
export function initialChoice(loaded: LoadedProject, kind: ImportKind, ctx: { savedScope?: ScopeRule; inUse: P6Activity[] | null; haveBaseline: boolean; dataDate: string }): XerChoice {
  const roles = projectRoles(loaded.model);
  const main = roles.mains[0];
  const fileBaselines = main ? (roles.baselinesOf.get(main.uid) ?? []) : [];
  // Importing as the baseline, a baseline the file carries is the obvious pick.
  const projUid = kind === 'baseline' && fileBaselines[0] ? fileBaselines[0].uid : (main?.uid ?? loaded.model.projects[0]?.uid ?? '');
  const project = loaded.model.projects.find((p) => p.uid === projUid);
  const p6Date = msToDate(project?.dataDate ?? null);
  return {
    projUid,
    // Only offered by default where there is no baseline yet: swapping the baseline
    // moves every planned figure, and that should be somebody's decision.
    baselineUid: kind === 'current' && !ctx.haveBaseline && fileBaselines[0] ? fileBaselines[0].uid : '',
    scope: normalizeScope(ctx.savedScope ?? proposeScope(ctx.inUse)),
    setDataDate: kind === 'current' && !!p6Date && p6Date !== ctx.dataDate,
    keepFile: true,
    hoursPerDay: 8,
  };
}

export type XerDerived = {
  project: P6ProjectInfo | undefined;
  scoped: ScopedImport;
  baseline: { project: P6ProjectInfo; scoped: ScopedImport } | null;
  info: P6ImportInfo;
  dataDate: string | null;
};

/** Everything the choices produce: the activities to import and how to describe them. */
export function useXerDerived(loaded: LoadedProject | null, choice: XerChoice | null, kind: ImportKind): XerDerived | null {
  return useMemo(() => {
    if (!loaded || !choice) return null;
    const model = loaded.model;
    const project = model.projects.find((p) => p.uid === choice.projUid);
    const scoped = scopedActivities(model, choice.projUid, choice.scope, { hoursPerDay: choice.hoursPerDay, extras: kind === 'current' });
    const blProject = choice.baselineUid ? model.projects.find((p) => p.uid === choice.baselineUid) : undefined;
    const baseline = blProject ? { project: blProject, scoped: scopedActivities(model, blProject.uid, choice.scope, { hoursPerDay: choice.hoursPerDay }) } : null;
    const dataDate = msToDate(project?.dataDate ?? null);
    const h = model.header;
    const info: P6ImportInfo = {
      format: 'xer',
      project: project?.shortName ?? '',
      projectName: project?.name ?? '',
      dataDate,
      totalActivities: scoped.total,
      scope: normalizeScope(choice.scope),
      bytes: loaded.bytes,
      ...(h?.version ? { version: h.version } : {}),
      ...(h?.exportDate ? { exportDate: h.exportDate } : {}),
      ...(h?.user ? { exportedBy: h.user } : {}),
    };
    return { project, scoped, baseline, info, dataDate };
  }, [loaded, choice, kind]);
}

export function XerPanel({
  loaded,
  choice,
  onChange,
  kind,
  inUse,
  settingsDataDate,
  derived,
}: {
  loaded: LoadedProject;
  choice: XerChoice;
  onChange: (c: XerChoice) => void;
  kind: ImportKind;
  inUse: P6Activity[] | null;
  settingsDataDate: string;
  derived: XerDerived;
}) {
  const model = loaded.model;
  const roles = useMemo(() => projectRoles(model), [model]);
  const set = (p: Partial<XerChoice>) => onChange({ ...choice, ...p });
  const setScope = (p: Partial<ScopeRule>) => set({ scope: normalizeScope({ ...choice.scope, ...p }) });
  const codes = useMemo(() => model.tasks.filter((t) => t.projUid === choice.projUid).map((t) => t.code), [model, choice.projUid]);
  const chips = useMemo(() => segmentCounts(codes, choice.scope.segment), [codes, choice.scope.segment]);
  const [allChips, setAllChips] = useState(false);
  const comparison = useMemo(() => compareScope(model, choice.projUid, choice.scope, inUse), [model, choice.projUid, choice.scope, inUse]);
  const fileBaselines = roles.baselinesOf.get(choice.projUid) ?? [];
  const otherProjects = model.projects.filter((p) => p.taskCount > 0);
  const values = new Set(choice.scope.values.map((v) => v.toUpperCase()));
  const shownChips = allChips ? chips : chips.slice(0, 14);
  const fallbackUsed = model.warnings.some((w) => w.includes('no calendar'));

  const toggleValue = (v: string) => {
    const next = values.has(v) ? choice.scope.values.filter((x) => x.toUpperCase() !== v) : [...choice.scope.values, v];
    setScope({ values: next });
  };

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-end gap-4 rounded bg-[var(--surface-2)] px-3 py-2 text-[12px]">
        <label>
          <div className="font-semibold">P6 project</div>
          <select className="input mt-1" value={choice.projUid} onChange={(e) => set({ projUid: e.target.value, baselineUid: '' })}>
            {roles.mains.map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.shortName} — {p.name} ({p.taskCount.toLocaleString()} activities)
              </option>
            ))}
            {otherProjects.filter((p) => !roles.mains.includes(p)).map((p) => (
              <option key={p.uid} value={p.uid}>
                {p.shortName} — {p.name} (baseline, {p.taskCount.toLocaleString()})
              </option>
            ))}
          </select>
        </label>
        <div className="text-[var(--text-muted)]">
          <div>
            Data date <b className="text-[var(--text)]">{derived.dataDate ? fmtDate(derived.dataDate) : 'not in the file'}</b>
            {model.header?.version ? <> · P6 {model.header.version}</> : null}
            {model.header?.exportDate ? <> · exported {isValidISO(model.header.exportDate.slice(0, 10)) ? fmtDate(model.header.exportDate.slice(0, 10)) : model.header.exportDate}</> : null}
            {model.header?.user ? <> by {model.header.user}</> : null}
          </div>
          <div>
            {model.tasks.length.toLocaleString()} activities, {model.rels.length.toLocaleString()} relationships, {model.resources.size} resources,{' '}
            {model.codeTypes.size} activity code types · {fmtBytes(loaded.bytes)} · read as {loaded.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252'}
          </div>
        </div>
      </div>

      <div className="rounded border border-[var(--line-soft)] px-3 py-2 text-[12px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="font-semibold">Which activities are the T&amp;C budget&rsquo;s</span>{' '}
            <span className="text-[var(--text-muted)]">
              — {derived.scoped.activities.length.toLocaleString()} of {derived.scoped.total.toLocaleString()} in the project: {describeScope(choice.scope)}.
            </span>
          </div>
          <label className="flex items-center gap-1 text-[var(--text-muted)]">
            Read part
            <select className="input" value={choice.scope.segment} onChange={(e) => setScope({ segment: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 3 ? ' (work type)' : n === 2 ? ' (phase)' : n === 4 ? ' (location)' : ''}
                </option>
              ))}
            </select>
            of the Activity ID
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {shownChips.map((c) => (
            <button
              key={c.value || '(none)'}
              type="button"
              className={`chip${values.has(c.value) ? ' is-on' : ''}`}
              disabled={!c.value}
              title={c.value ? `${values.has(c.value) ? 'Take' : 'Put'} every activity whose ID has ${c.value} here ${values.has(c.value) ? 'out of' : 'into'} the budget` : 'IDs too short to have this part'}
              onClick={() => toggleValue(c.value)}
            >
              <span className="mono">{c.value || '(none)'}</span> <span className="chip-n">{c.count.toLocaleString()}</span>
            </button>
          ))}
          {chips.length > 14 && (
            <button type="button" className="btn-link text-[11px]" onClick={() => setAllChips(!allChips)}>
              {allChips ? 'fewer' : `all ${chips.length}`}
            </button>
          )}
        </div>
        {(choice.scope.ids?.length ?? 0) > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[var(--text-muted)]">
              Also in scope by Activity ID: {choice.scope.ids!.length}{' '}
              <button type="button" className="btn-link danger ml-2" onClick={(e) => { e.preventDefault(); setScope({ ids: [] }); }}>clear</button>
            </summary>
            <div className="mono mt-1 max-h-28 overflow-auto text-[11px]">{choice.scope.ids!.join(', ')}</div>
          </details>
        )}
        {comparison && (
          <div className="mt-2">
            <Notice tone={comparison.outside.length + comparison.gone.length > 0 ? 'warn' : 'ok'}>
              <b>Against the {kind} schedule in use ({inUse?.filter((a) => a.rowType === 'ACTIVITY').length.toLocaleString()} activities):</b>{' '}
              {comparison.matched.toLocaleString()} are in this scope
              {comparison.added.length > 0 && <>, {comparison.added.length.toLocaleString()} more are new to it</>}
              {comparison.outside.length > 0 && <>, {comparison.outside.length.toLocaleString()} are in the file but outside the scope</>}
              {comparison.gone.length > 0 && <>, {comparison.gone.length.toLocaleString()} are not in this file at all</>}.
              {comparison.outside.length === 0 && comparison.gone.length === 0 && <> Everything you had is still here.</>}
              {comparison.outside.length > 0 && (
                <>
                  {' '}
                  <button type="button" className="btn btn-mini ml-1" onClick={() => setScope({ ids: [...(choice.scope.ids ?? []), ...comparison.outside.map((o) => o.activityId)] })}>
                    Keep those {comparison.outside.length} by ID
                  </button>
                </>
              )}
            </Notice>
            {(comparison.outside.length > 0 || comparison.gone.length > 0 || comparison.added.length > 0) && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[var(--text-muted)]">Which ones</summary>
                <div className="mt-1 grid gap-3 md:grid-cols-3">
                  <IdList title="Outside the scope" rows={comparison.outside.map((o) => ({ id: o.activityId, name: `${o.activityName}${o.segment ? ` (${o.segment})` : ''}` }))} />
                  <IdList title="Not in this file" rows={comparison.gone.map((o) => ({ id: o.activityId, name: o.activityName }))} />
                  <IdList title="New in the scope" rows={comparison.added.map((t) => ({ id: t.code, name: t.name }))} />
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12px]">
        {kind === 'current' && (
          <label className="flex items-center gap-1.5" title="The data date decides where earned value stops and what counts as late. P6 knows it; this saves keying it.">
            <input type="checkbox" checked={choice.setDataDate} disabled={!derived.dataDate} onChange={(e) => set({ setDataDate: e.target.checked })} />
            Set the data date to P6&rsquo;s{derived.dataDate ? ` (${fmtDate(derived.dataDate)})` : ''}
            <span className="text-[var(--text-muted)]">— Settings has {settingsDataDate ? fmtDate(settingsDataDate) : 'none'}</span>
          </label>
        )}
        {kind === 'current' && fileBaselines.length > 0 && (
          <label className="flex items-center gap-1.5" title="The file carries a baseline of this project. Importing it makes it the baseline the planned curve and every variance is measured against.">
            <input type="checkbox" checked={!!choice.baselineUid} onChange={(e) => set({ baselineUid: e.target.checked ? fileBaselines[0].uid : '' })} />
            Also import its baseline <b>{fileBaselines[0].shortName}</b> from this file
            {derived.baseline && <span className="text-[var(--text-muted)]">({derived.baseline.scoped.activities.length.toLocaleString()} activities in scope)</span>}
          </label>
        )}
        <label className="flex items-center gap-1.5" title="Keeps a compressed copy of the whole project in the data folder, so the Schedule screen can show all of it: WBS, Gantt, logic, resources, codes.">
          <input type="checkbox" checked={choice.keepFile} onChange={(e) => set({ keepFile: e.target.checked })} />
          Keep the whole file for the Schedule screen
        </label>
        {fallbackUsed && (
          <label className="flex items-center gap-1.5">
            Hours per day where an activity has no calendar
            <input className="input w-20" type="number" step="0.5" value={choice.hoursPerDay} onChange={(e) => set({ hoursPerDay: Number(e.target.value) || 8 })} />
          </label>
        )}
      </div>
      {model.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}
      {kind === 'current' && choice.baselineUid && (
        <div className="text-[12px] text-[var(--text-muted)]">
          <Badge tone="purple">baseline</Badge> The baseline is imported as its own entry in the history, so it can be removed on its own if it is not wanted.
        </div>
      )}
    </div>
  );
}

function IdList({ title, rows }: { title: string; rows: { id: string; name: string }[] }) {
  return (
    <div>
      <div className="font-semibold">
        {title} <span className="text-[var(--text-muted)]">({rows.length})</span>
      </div>
      <ul className="mt-1 max-h-40 overflow-auto text-[11.5px]">
        {rows.length === 0 && <li className="text-[var(--text-subtle)]">None.</li>}
        {rows.slice(0, 300).map((r) => (
          <li key={r.id} className="truncate" title={`${r.id} ${r.name}`}>
            <span className="mono">{r.id}</span> {r.name}
          </li>
        ))}
        {rows.length > 300 && <li className="text-[var(--text-subtle)]">and {rows.length - 300} more</li>}
      </ul>
    </div>
  );
}
