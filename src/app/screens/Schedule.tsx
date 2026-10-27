/**
 * The whole P6 project, the way P6 shows it: the activities under their WBS with
 * a Gantt chart beside them, the logic, the resources, the codes — read straight
 * from the .xer, nothing re-keyed.
 *
 * It opens the file kept with the schedule import in use, so it always shows the
 * same update the budget is reading. Any other .xer can be opened just to look at,
 * which writes nothing anywhere.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import type { Route } from '../router';
import { href, navigate } from '../router';
import { Page, Notice } from '../components/ui';
import { normKey } from '../../engine/keys';
import { isCritical, codeTypesInUse, udfTypesInUse, tasksOf } from '../../engine/xerProject';
import { projectRoles, proposeScope, scopeTest, describeScope } from '../../engine/xerScope';
import { loadStoredProject, readXerBytes, type LoadedProject } from '../xerFile';
import { fmtDate, fmtDateTime } from '../format';
import type { BudgetRow, ImportIndexEntry } from '../../engine/types';
import type { BaselineDates, ScheduleCtx } from '../schedule/context';
import { ActivitiesView, type ExternalList } from '../schedule/ActivitiesView';
import { ReadinessView } from '../schedule/ReadinessView';
import { ChecksView } from '../schedule/ChecksView';
import { ResourcesView } from '../schedule/ResourcesView';
import { FileView } from '../schedule/FileView';
import { fmtMs } from '../schedule/timeline';

type Tab = 'activities' | 'readiness' | 'checks' | 'resources' | 'file';

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'activities', label: 'Activities & Gantt', hint: 'Every activity under its WBS, with the bars, the logic and the details of whichever one you pick.' },
  { key: 'readiness', label: 'T&C lookahead', hint: 'What T&C work is due to start soon, and what it is still waiting on.' },
  { key: 'checks', label: 'Schedule checks', hint: 'Open ends, broken sequence, hard constraints, negative float.' },
  { key: 'resources', label: 'Resources', hint: 'Who P6 has assigned to what, by month, against the T&C budget.' },
  { key: 'file', label: 'About the file', hint: 'The project settings, calendars, codes and tables in the file.' },
];

/** A baseline import's ISO dates as bar ends: the start of the first day, the end of the last. */
const isoStart = (iso: string | null) => (iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 8) : null);
const isoFinish = (iso: string | null) => (iso ? Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 17) : null);

export function Schedule({ route }: { route: Route }) {
  const { state, model: budget, actions } = useApp();
  const d = state.data;

  // ---- which file -------------------------------------------------------------------
  const wantedId = route.params.get('import');
  const withFile = useMemo(() => d.importsIndex.filter((e) => e.p6?.file).sort((a, b) => b.importedAt.localeCompare(a.importedAt)), [d.importsIndex]);
  const entry: ImportIndexEntry | null = useMemo(() => {
    if (wantedId) return d.importsIndex.find((e) => e.id === wantedId) ?? null;
    const cur = d.current ? withFile.find((e) => e.id === d.current!.id) : undefined;
    return cur ?? withFile.find((e) => e.kind === 'current') ?? withFile[0] ?? null;
  }, [wantedId, d.importsIndex, d.current, withFile]);

  const [local, setLocal] = useState<{ name: string; loaded: LoadedProject } | null>(null);
  const [stored, setStored] = useState<{ path: string; loaded: LoadedProject } | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = entry?.p6?.file ?? null;

  useEffect(() => {
    if (local || !path || stored?.path === path) return;
    let cancelled = false;
    setProgress(0);
    setError(null);
    loadStoredProject(path, () => actions.readStoredXer(path), (p) => {
      if (!cancelled) setProgress(p);
    })
      .then((loaded) => {
        if (cancelled) return;
        setStored({ path, loaded });
        setProgress(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setProgress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [local, path, stored?.path, actions]);

  const openLocal = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      const loaded = await readXerBytes(new Uint8Array(await file.arrayBuffer()), setProgress);
      setLocal({ name: file.name, loaded });
      setProjUid(null);
      setSelectedUid(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const loaded = local?.loaded ?? (stored && stored.path === path ? stored.loaded : null);
  const fileName = local?.name ?? entry?.sourceFilename ?? '';
  const model = loaded?.model ?? null;

  // ---- which project in it -------------------------------------------------------------
  const [projUid, setProjUid] = useState<string | null>(null);
  const roles = useMemo(() => (model ? projectRoles(model) : null), [model]);
  const project = useMemo(() => {
    if (!model || !roles) return null;
    const byId = projUid ? model.projects.find((p) => p.uid === projUid) : null;
    if (byId) return byId;
    const named = !local && entry?.p6?.project ? model.projects.find((p) => p.shortName === entry.p6!.project) : null;
    return named ?? roles.mains[0] ?? model.projects[0] ?? null;
  }, [model, roles, projUid, entry, local]);
  const tasks = useMemo(() => (model && project ? tasksOf(model, project.uid) : []), [model, project]);

  // ---- the scope, the baseline and the budget behind it --------------------------------
  const scope = useMemo(() => d.settings.p6Scope ?? entry?.p6?.scope ?? proposeScope(d.current?.activities), [d.settings.p6Scope, entry, d.current]);
  const inScope = useMemo(() => {
    const test = scopeTest(scope);
    // Asked of every row on every redraw, so each activity is answered once. A new
    // file starts a new memo: activity keys are only unique within one file.
    const memo = new Map<string, boolean>();
    void model;
    return (t: { uid: string; code: string }) => {
      let v = memo.get(t.uid);
      if (v === undefined) memo.set(t.uid, (v = test(t.code)));
      return v;
    };
  }, [scope, model]);

  const chosenBaseline = useMemo(() => {
    const pinned = d.settings.baselineImportId;
    return (pinned ? d.baselines.find((b) => b.id === pinned) : null) ?? d.baseline;
  }, [d.settings.baselineImportId, d.baselines, d.baseline]);

  const { baseline, baselineLabel } = useMemo(() => {
    const out = new Map<string, BaselineDates>();
    if (!model || !project) return { baseline: out, baselineLabel: null };
    const inFile = roles?.baselinesOf.get(project.uid)?.[0];
    if (inFile) {
      for (const t of tasksOf(model, inFile.uid)) if (!out.has(normKey(t.code))) out.set(normKey(t.code), { start: t.start, finish: t.finish });
      return { baseline: out, baselineLabel: `${inFile.shortName}, the baseline in this file` };
    }
    if (chosenBaseline && !local) {
      for (const a of chosenBaseline.activities) {
        if (a.rowType !== 'ACTIVITY' || out.has(normKey(a.activityId))) continue;
        out.set(normKey(a.activityId), { start: isoStart(a.startDate), finish: isoFinish(a.finishDate) });
      }
      return { baseline: out, baselineLabel: `the baseline import (${chosenBaseline.sourceFilename}), T&C activities only` };
    }
    return { baseline: out, baselineLabel: null };
  }, [model, project, roles, chosenBaseline, local]);

  const budgetById = useMemo(() => {
    const m = new Map<string, BudgetRow>();
    if (local) return m;
    for (const r of budget.rows) if (!m.has(normKey(r.activityId))) m.set(normKey(r.activityId), r);
    return m;
  }, [budget.rows, local]);

  // ---- selection, tabs, and lists handed between them ------------------------------------
  const [tab, setTab] = useState<Tab>('activities');
  // A link can open a tab: #/schedule?tab=readiness. Read on every change, since
  // following one from this screen does not mount it again.
  const tabParam = route.params.get('tab');
  useEffect(() => {
    if (tabParam && TABS.some((t) => t.key === tabParam)) setTab(tabParam as Tab);
  }, [tabParam]);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [list, setList] = useState<ExternalList>(null);
  const showList = useCallback((uids: string[], label: string) => {
    setList({ uids: new Set(uids), label });
    setTab('activities');
  }, []);
  const reveal = useCallback((uid: string) => {
    setSelectedUid(uid);
    setTab('activities');
  }, []);

  // A link from another screen can name an activity: #/schedule?act=0-P2-TC-...
  const actParam = route.params.get('act');
  const handledAct = useRef<string | null>(null);
  useEffect(() => {
    if (!actParam || !tasks.length || handledAct.current === actParam) return;
    handledAct.current = actParam;
    const t = tasks.find((x) => normKey(x.code) === normKey(actParam));
    if (t) reveal(t.uid);
  }, [actParam, tasks, reveal]);

  // A selection in one file means nothing in another: activity keys are per file.
  useEffect(() => {
    setSelectedUid(null);
    setList(null);
  }, [model]);

  const codeTypes = useMemo(() => (model && project ? codeTypesInUse(model, project.uid) : []), [model, project]);
  const udfTypes = useMemo(() => (model && project ? udfTypesInUse(model, project.uid) : []), [model, project]);
  const ctx: ScheduleCtx | null = useMemo(() => {
    if (!model || !project) return null;
    return {
      model,
      project,
      tasks,
      inScope,
      scope,
      baseline,
      baselineLabel,
      dataDate: project.dataDate,
      budgetById,
      codeTypes,
      udfTypes,
      selectedUid,
      select: setSelectedUid,
      showList,
      reveal,
    };
  }, [model, project, tasks, inScope, scope, baseline, baselineLabel, budgetById, codeTypes, udfTypes, selectedUid, showList, reveal]);

  const stats = useMemo(() => {
    if (!ctx) return [];
    let scoped = 0;
    let critical = 0;
    let negative = 0;
    let open = 0;
    for (const t of tasks) {
      if (inScope(t)) scoped += 1;
      if (t.status !== 'COMPLETE') open += 1;
      if (isCritical(t, ctx.project)) critical += 1;
      if (t.status !== 'COMPLETE' && t.tfHrs !== null && t.tfHrs < 0) negative += 1;
    }
    return [
      { label: 'Activities', value: tasks.length.toLocaleString() },
      { label: 'Not complete', value: open.toLocaleString(), tone: 'blue' as const },
      { label: 'T&C scope', value: scoped.toLocaleString() },
      { label: 'Critical', value: critical.toLocaleString(), tone: critical ? ('red' as const) : undefined },
      { label: 'Negative float', value: negative.toLocaleString(), tone: negative ? ('red' as const) : ('muted' as const) },
    ];
  }, [ctx, tasks, inScope]);

  const fileInput = useRef<HTMLInputElement | null>(null);
  const openButton = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".xer"
        className="hidden"
        aria-label="Open a P6 .xer file to look at"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openLocal(f);
        }}
      />
      <button className="btn btn-mini" onClick={() => fileInput.current?.click()} title="Look at any .xer without importing it. Nothing is saved.">
        Open an .xer to look at…
      </button>
    </>
  );

  const subtitle = project ? (
    <>
      <b>{project.name}</b> ({project.shortName}) · data date <b>{fmtMs(project.dataDate) || 'not in the file'}</b> ·{' '}
      {local ? (
        <>
          <span className="tone-warn">viewing {local.name}, not imported</span>{' '}
          <button className="btn-link" onClick={() => setLocal(null)}>
            back to the imported schedule
          </button>
        </>
      ) : (
        <>from {fileName}, imported {entry ? fmtDateTime(entry.importedAt) : ''}</>
      )}
    </>
  ) : (
    'The whole P6 project: WBS, Gantt, logic, resources and codes, straight from the .xer.'
  );

  return (
    <Page
      eyebrow="P6 project"
      title="Schedule"
      subtitle={subtitle}
      stats={stats}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {!local && withFile.length > 1 && (
            <select
              className="input"
              value={entry?.id ?? ''}
              onChange={(e) => navigate('schedule', { import: e.target.value })}
              aria-label="Which imported schedule to view"
              title="Every import that kept its P6 file"
            >
              {withFile.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.kind === 'current' ? 'Current' : 'Baseline'} · {fmtDate(e.importedAt.slice(0, 10))} · {e.p6?.project} {d.current?.id === e.id ? '(in use)' : ''}
                </option>
              ))}
            </select>
          )}
          {model && roles && roles.mains.length > 1 && project && (
            <select className="input" value={project.uid} onChange={(e) => setProjUid(e.target.value)} aria-label="Project in the file">
              {model.projects.filter((p) => p.taskCount > 0).map((p) => (
                <option key={p.uid} value={p.uid}>
                  {p.shortName} ({p.taskCount.toLocaleString()})
                </option>
              ))}
            </select>
          )}
          {openButton}
        </div>
      }
    >
      {error && (
        <div className="mb-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      {progress !== null && (
        <div className="card mb-3">
          <div className="flex items-baseline justify-between">
            <h2 className="card-title">Reading the P6 file</h2>
            <span className="text-[12px] tabular-nums text-[var(--text-muted)]">{Math.round(progress * 100)}%</span>
          </div>
          <div className="bar bar-lg mt-2">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}

      {!loaded && progress === null && <NoFile hasImports={d.importsIndex.length > 0} entry={entry} open={() => fileInput.current?.click()} />}

      {ctx && loaded && (
        <div className={tab === 'activities' ? 'sched-screen is-full' : 'sched-screen'}>
          <div className="sched-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-on' : ''} onClick={() => setTab(t.key)} title={t.hint}>
                {t.label}
              </button>
            ))}
            <span className="sched-tabs-note" title={describeScope(scope)}>
              T&amp;C scope: {describeScope(scope)}.{' '}
              <a className="btn-link" href={href('import')}>
                change on Import
              </a>
            </span>
          </div>
          {/* Kept mounted behind the other tabs, so a search, a trace or a collapsed
              band is still there on coming back to it. */}
          <div className="sched-fill" style={tab === 'activities' ? undefined : { display: 'none' }}>
            <ActivitiesView ctx={ctx} list={list} onClearList={() => setList(null)} />
          </div>
          {tab === 'readiness' && <ReadinessView ctx={ctx} />}
          {tab === 'checks' && <ChecksView ctx={ctx} />}
          {tab === 'resources' && <ResourcesView ctx={ctx} />}
          {tab === 'file' && <FileView ctx={ctx} loaded={loaded} fileName={fileName} />}
        </div>
      )}
    </Page>
  );
}

function NoFile({ hasImports, entry, open }: { hasImports: boolean; entry: ImportIndexEntry | null; open: () => void }) {
  return (
    <div className="card max-w-3xl">
      <h2 className="card-title">{entry && !entry.p6?.file ? 'This import did not keep its P6 file' : 'No P6 project file yet'}</h2>
      <div className="mt-2 space-y-2 text-[13px] text-[var(--text-muted)]">
        <p>
          The Schedule screen shows the whole project from P6&rsquo;s own <b>.xer</b> export: every activity under its WBS, the Gantt chart, the logic between
          activities, resources, activity codes and notebooks.
        </p>
        <p>
          <b>Get the file out of P6.</b> In P6 on the web: <i>Projects → EPS</i>, select the project, then <i>Actions → Export</i> and choose <b>XER</b>. In P6
          Professional: <i>File → Export → Primavera PM (XER)</i>. Export the whole project, not a filtered layout.
        </p>
        <p>
          <b>Then import it</b> on the{' '}
          <a className="btn-link" href={href('import')}>
            Import
          </a>{' '}
          screen as the current schedule, with <i>Keep the whole file for the Schedule screen</i> ticked. The budget reads only the T&amp;C activities out of it, exactly as it
          read the filtered Excel export{hasImports ? ', and the import screen checks that against the schedule you have now before anything changes' : ''}.
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <a className="btn btn-primary" href={href('import')}>
          Go to Import
        </a>
        <button className="btn" onClick={open}>
          Or just look at an .xer
        </button>
        <span className="text-[11.5px] text-[var(--text-subtle)]">Looking writes nothing anywhere. A big programme takes a few seconds to read.</span>
      </div>
    </div>
  );
}
