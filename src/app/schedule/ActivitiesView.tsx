/**
 * The activity grid and Gantt chart, the way P6 shows a project.
 *
 * A whole programme is tens of thousands of rows, so only the rows on screen are
 * drawn: the list is one tall scroll area with the grid pinned to its left edge
 * and the bars beside it, and scrolling swaps which forty rows exist. Filtering,
 * grouping and sorting run over the whole project; the drawing never does.
 */
import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { normKey } from '../../engine/keys';
import { phaseOf, workTypeOf, locationOf, phaseLabel } from '../../engine/parse';
import { isCritical, wbsPathName, codeOf, type P6Rel, type P6Task } from '../../engine/xerProject';
import { buildOutline, groupKeys, makeTaskFilter, type FloatFilter, type GroupSpec, type OutlineRow, type ScopeFilter, type StatusFilter } from '../../engine/xerOutline';
import { linkState, trace, type TraceStep } from '../../engine/xerLogic';
import { applyLayout, ColumnPicker, isEmptyLayout, readLayout, writeLayout, Term, type TableLayout } from '../components/ui';
import { downloadBytes, stamp } from '../export';
import type { ScheduleCtx } from './context';
import { gridColumns, type GridColumn } from './columns';
import { fmtMs, makeScale, ticksFor, ZOOMS, type Scale, type Zoom } from './timeline';
import { Details } from './Details';

const ROW_H = 26;
const HEAD_H = 46;
const DAY = 86_400_000;
const OVERSCAN = 12;

// Bar colours: done work recedes, what is left is blue, what is critical is red.
// Literal hex for the same reason as the curve charts: these are drawn as plain
// styles and must match the legend exactly.
export const BAR = { done: '#54575f', remaining: '#1d4eaf', critical: '#c01017', baseline: '#9a9da4', summary: '#2a2c31' };

type ViewMode = 'both' | 'table' | 'gantt';
type GroupBy = string; // 'wbs' | 'none' | 'phase' | 'location' | 'workType' | 'status' | 'scope' | 'code:<uid>'

type Prefs = {
  view: ViewMode;
  zoom: Zoom;
  group: GroupBy;
  gridWidth: number;
  scope: ScopeFilter;
  status: StatusFilter;
  float: FloatFilter;
  nearDays: number;
  links: boolean;
  baseline: boolean;
  detailsH: number;
};

const PREFS_KEY = 'tc-schedule-prefs';
const LAYOUT_ID = 'schedule-grid';
const DEFAULT_PREFS: Prefs = { view: 'both', zoom: 'month', group: 'wbs', gridWidth: 844, scope: 'all', status: 'all', float: 'any', nearDays: 10, links: true, baseline: true, detailsH: 270 };

function readPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private window: the screen works, it just will not remember */
  }
}

export type ExternalList = { uids: Set<string>; label: string } | null;

export function ActivitiesView({ ctx, list, onClearList }: { ctx: ScheduleCtx; list: ExternalList; onClearList: () => void }) {
  const { model, project, tasks, inScope, selectedUid, select } = ctx;
  const [prefs, setPrefsState] = useState<Prefs>(readPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const setPrefs = (p: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...p };
    prefsRef.current = next;
    writePrefs(next);
    setPrefsState(next);
  };
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [windowKey, setWindowKey] = useState<'all' | '2w' | '6w' | '3m' | 'late'>('all');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [traceState, setTraceState] = useState<{ origin: P6Task; dir: 'up' | 'down'; drivingOnly: boolean; steps: TraceStep[] } | null>(null);
  const [layout, setLayoutState] = useState<TableLayout | null>(() => readLayout(LAYOUT_ID));
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [picking, setPicking] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [vp, setVp] = useState({ top: 0, left: 0, height: 600, width: 1200 });
  /** The last activity scrolled to, so a selection is brought into view once. */
  const lastRevealed = useRef<string | null>(null);

  const setLayout = (next: TableLayout) => {
    const stored = isEmptyLayout(next) ? null : next;
    setLayoutState(stored);
    writeLayout(LAYOUT_ID, stored);
  };

  // An external list (from Readiness or Checks) replaces any trace in progress.
  useEffect(() => {
    if (list) setTraceState(null);
  }, [list]);

  // ---- what is shown ------------------------------------------------------------
  const dataDate = ctx.dataDate;
  const window = useMemo(() => {
    const from = dataDate ?? Date.now();
    if (windowKey === '2w') return { from, to: from + 14 * DAY };
    if (windowKey === '6w') return { from, to: from + 42 * DAY };
    if (windowKey === '3m') return { from, to: from + 91 * DAY };
    return null;
  }, [windowKey, dataDate]);

  const only = useMemo(() => {
    if (traceState) return new Set([traceState.origin.uid, ...traceState.steps.map((s) => s.task.uid)]);
    return list?.uids ?? null;
  }, [traceState, list]);

  const filterFn = useMemo(
    () =>
      makeTaskFilter(
        project,
        { text: query, scope: prefs.scope, status: windowKey === 'late' ? 'open' : prefs.status, float: prefs.float, nearDays: prefs.nearDays, window, only },
        inScope,
      ),
    [project, query, prefs.scope, prefs.status, prefs.float, prefs.nearDays, window, only, inScope, windowKey],
  );
  const lateFn = useCallback(
    (t: P6Task) => {
      if (windowKey !== 'late') return true;
      const b = ctx.baseline.get(normKey(t.code))?.finish ?? null;
      return b !== null && t.finish !== null && Math.floor(t.finish / DAY) > Math.floor(b / DAY);
    },
    [windowKey, ctx.baseline],
  );
  const filtered = useMemo(() => tasks.filter((t) => filterFn(t) && lateFn(t)), [tasks, filterFn, lateFn]);

  /*
   * What the rows need, without the selection: picking an activity must not rebuild
   * the columns, re-sort twenty thousand rows or redraw every row on screen.
   */
  const dataCtx = useMemo(
    () => ctx,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.model, ctx.project, ctx.tasks, ctx.inScope, ctx.baseline, ctx.budgetById, ctx.codeTypes, ctx.udfTypes, ctx.dataDate],
  );
  const allColumns = useMemo(() => gridColumns(dataCtx), [dataCtx]);
  /** A row clicked is already in view: say so, so selecting it does not scroll the chart away. */
  const clickSelect = useCallback(
    (uid: string) => {
      lastRevealed.current = uid;
      select(uid);
    },
    [select],
  );
  const columns = useMemo(() => {
    const shown = applyLayout(allColumns, layout);
    return prefs.view === 'gantt' ? shown.filter((c) => c.key === 'code' || c.key === 'name').slice(0, 2) : shown;
  }, [allColumns, layout, prefs.view]);
  const widthOf = useCallback((c: GridColumn) => layout?.widths?.[c.key] ?? c.px, [layout]);
  const columnsWidth = columns.reduce((s, c) => s + widthOf(c), 0);

  const traceLevel = useMemo(() => new Map(traceState?.steps.map((s) => [s.task.uid, s.level]) ?? []), [traceState]);
  const compare = useMemo(() => {
    const col = sort ? allColumns.find((c) => c.key === sort.key) : null;
    return (a: P6Task, b: P6Task) => {
      if (traceState) {
        const d = (traceLevel.get(a.uid) ?? 0) - (traceLevel.get(b.uid) ?? 0);
        if (d) return d;
      }
      if (col && sort) {
        const va = col.value(a);
        const vb = col.value(b);
        if (va !== vb) {
          if (va === null || va === undefined || va === '') return 1;
          if (vb === null || vb === undefined || vb === '') return -1;
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sort.dir;
          return String(va).localeCompare(String(vb), undefined, { numeric: true }) * sort.dir;
        }
      }
      return (a.start ?? Infinity) - (b.start ?? Infinity) || a.code.localeCompare(b.code, undefined, { numeric: true });
    };
  }, [sort, allColumns, traceState, traceLevel]);

  const groupSpec = useMemo<GroupSpec>(() => {
    const g = traceState || list ? 'none' : prefs.group;
    if (g === 'wbs') return { kind: 'wbs' };
    if (g === 'none') return { kind: 'none' };
    if (g === 'phase') return { kind: 'field', keyOf: (t) => phaseOf(t.code), labelOf: (k) => phaseLabel(k) };
    if (g === 'location') return { kind: 'field', keyOf: (t) => locationOf(t.code) };
    if (g === 'workType') return { kind: 'field', keyOf: (t) => workTypeOf(t.code) };
    if (g === 'status') {
      const order = ['IN PROGRESS', 'NOT STARTED', 'COMPLETE'];
      return { kind: 'field', keyOf: (t) => t.status, order: (a, b) => order.indexOf(a) - order.indexOf(b) };
    }
    if (g === 'scope') return { kind: 'field', keyOf: (t) => (inScope(t) ? 'T&C scope' : 'Rest of the project') };
    if (g.startsWith('code:')) {
      const typeUid = g.slice(5);
      return {
        kind: 'field',
        keyOf: (t) => codeOf(model, t.uid, typeUid)?.uid ?? '',
        labelOf: (k) => {
          const v = model.codeValues.get(k);
          return v ? `${v.short}${v.name && v.name !== v.short ? ` — ${v.name}` : ''}` : k;
        },
        order: (a, b) => (model.codeValues.get(a)?.seq ?? 0) - (model.codeValues.get(b)?.seq ?? 0) || (model.codeValues.get(a)?.short ?? '').localeCompare(model.codeValues.get(b)?.short ?? ''),
      };
    }
    return { kind: 'wbs' };
  }, [prefs.group, traceState, list, model, inScope]);

  const rows = useMemo(() => buildOutline(model, project, filtered, groupSpec, collapsed, compare), [model, project, filtered, groupSpec, collapsed, compare]);
  const rowIndex = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach((r, i) => {
      if (r.kind === 'task') m.set(r.task.uid, i);
    });
    return m;
  }, [rows]);

  // ---- the time axis --------------------------------------------------------------
  const bounds = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const t of tasks) {
      if (t.start !== null && t.start < lo) lo = t.start;
      if (t.finish !== null && t.finish > hi) hi = t.finish;
    }
    for (const b of ctx.baseline.values()) {
      if (b.start !== null && b.start < lo) lo = b.start;
      if (b.finish !== null && b.finish > hi) hi = b.finish;
    }
    if (!Number.isFinite(lo)) lo = hi = dataDate ?? Date.now();
    return { lo, hi };
  }, [tasks, ctx.baseline, dataDate]);
  const scale = useMemo(() => makeScale(bounds.lo, bounds.hi, prefs.zoom), [bounds, prefs.zoom]);
  const showBars = prefs.view !== 'table';
  const gridWidth = prefs.view === 'table' ? columnsWidth : prefs.view === 'gantt' ? Math.min(columnsWidth, 420) : Math.min(columnsWidth, prefs.gridWidth);
  const totalWidth = gridWidth + (showBars ? scale.width : 0);
  const totalHeight = HEAD_H + rows.length * ROW_H;

  // ---- the viewport ------------------------------------------------------------------
  const rafRef = useRef(0);
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setVp({ top: el.scrollTop, left: el.scrollLeft, height: el.clientHeight, width: el.clientWidth });
  }, []);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      measure();
    });
  }, [measure]);
  useLayoutEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  /** Bring a row into view, and the bar with it when the bars are showing. */
  const revealRow = useCallback(
    (index: number, task?: P6Task) => {
      const el = scroller.current;
      if (!el || index < 0) return;
      const y = HEAD_H + index * ROW_H;
      if (y < el.scrollTop + HEAD_H || y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, y - el.clientHeight / 2);
      if (task && showBars && task.start !== null) {
        const x = gridWidth + scale.x(task.start);
        if (x < el.scrollLeft + gridWidth || x > el.scrollLeft + el.clientWidth - 80) el.scrollLeft = Math.max(0, x - gridWidth - 120);
      }
    },
    [showBars, gridWidth, scale],
  );

  // Scroll to the data date the first time bars are on screen (not while hidden behind another tab).
  const scrolledToDate = useRef(false);
  useEffect(() => {
    const el = scroller.current;
    if (scrolledToDate.current || !showBars || !el || el.clientWidth === 0) return;
    scrolledToDate.current = true;
    el.scrollLeft = Math.max(0, scale.x(dataDate ?? Date.now()) - 160);
  }, [showBars, dataDate, scale, vp.width]);

  // A selection made elsewhere (another tab, a link in the panel) is brought into view.
  useEffect(() => {
    if (!selectedUid || lastRevealed.current === selectedUid) return;
    const i = rowIndex.get(selectedUid);
    if (i === undefined) {
      // Hidden by a filter or a collapsed band: open the bands above it.
      const t = model.taskByUid.get(selectedUid);
      if (t && filterFn(t) && prefs.group === 'wbs' && !traceState && !list) {
        const keys = new Set(collapsed);
        let w = model.wbs.get(t.wbsUid);
        let changed = false;
        while (w) {
          if (keys.delete(`wbs:${w.uid}`)) changed = true;
          w = model.wbs.get(w.parentUid);
        }
        if (changed) setCollapsed(keys);
      }
      return;
    }
    lastRevealed.current = selectedUid;
    revealRow(i, model.taskByUid.get(selectedUid));
  }, [selectedUid, rowIndex, revealRow, model, filterFn, collapsed, prefs.group, traceState, list]);

  // Opening the activity panel shortens the list; the row just picked must not end up under it.
  useEffect(() => {
    const el = scroller.current;
    const i = selectedUid ? rowIndex.get(selectedUid) : undefined;
    if (!el || i === undefined || el.clientHeight === 0) return;
    const y = HEAD_H + i * ROW_H;
    if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight + ROW_H;
    // Only the panel's resize and a new selection move it; scrolling away is the user's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid, vp.height]);

  const first = Math.max(0, Math.floor((vp.top - HEAD_H) / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length, Math.ceil((vp.top + vp.height) / ROW_H) + OVERSCAN);
  const visible = rows.slice(first, last);
  // The grid is pinned over the left of the scroll area, so the bars in view start
  // at the scroll position itself, in the timeline's own coordinates.
  const viewLeft = vp.left;
  const viewFrom = scale.at(viewLeft);
  const viewTo = scale.at(viewLeft + Math.max(0, vp.width - gridWidth));
  const ticks = useMemo(() => (showBars ? ticksFor(scale, prefs.zoom, viewFrom, viewTo) : { top: [], bottom: [] }), [showBars, scale, prefs.zoom, viewFrom, viewTo]);

  // ---- interaction --------------------------------------------------------------------
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const expandAll = () => setCollapsed(new Set());
  const collapseTo = (depth: number) => {
    // Every band at or below this depth, whether or not it is on screen right now.
    const all = groupKeys(buildOutline(model, project, filtered, groupSpec, new Set(), compare));
    setCollapsed(new Set(all.filter((g) => g.depth >= depth).map((g) => g.key)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const cur = selectedUid ? (rowIndex.get(selectedUid) ?? -1) : -1;
    const step = e.key === 'ArrowDown' ? 1 : -1;
    for (let i = cur + step; i >= 0 && i < rows.length; i += step) {
      const r = rows[i];
      if (r.kind === 'task') {
        lastRevealed.current = r.task.uid;
        select(r.task.uid);
        revealRow(i, r.task);
        return;
      }
    }
  };

  const startTrace = (dir: 'up' | 'down', drivingOnly: boolean) => {
    const origin = selectedUid ? model.taskByUid.get(selectedUid) : null;
    if (!origin) return;
    if (list) onClearList();
    setTraceState({ origin, dir, drivingOnly, steps: trace(model, origin.uid, dir, { drivingOnly }) });
    scroller.current?.scrollTo({ top: 0 });
  };

  const startResize = (e: React.PointerEvent, key: string, startWidth: number) => {
    e.preventDefault();
    e.stopPropagation();
    const from = e.clientX;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      latest = Math.max(40, Math.round(startWidth + (ev.clientX - from)));
      setLayoutState((l) => ({ ...(l ?? { order: [], off: [], on: [] }), widths: { ...(l?.widths ?? {}), [key]: latest } }));
    };
    const done = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', done);
      const base = layoutRef.current ?? { order: [], off: [], on: [] };
      setLayout({ ...base, widths: { ...(base.widths ?? {}), [key]: latest } });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', done);
  };

  const startSplit = (e: React.PointerEvent) => {
    e.preventDefault();
    const from = e.clientX;
    const start = gridWidth;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    let latest = start;
    const move = (ev: PointerEvent) => {
      latest = Math.max(220, Math.min(2400, Math.round(start + ev.clientX - from)));
      setPrefsState((p) => ({ ...p, gridWidth: latest }));
    };
    const done = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', done);
      setPrefs({ gridWidth: latest });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', done);
  };

  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const taskRows = rows.filter((r): r is Extract<OutlineRow, { kind: 'task' }> => r.kind === 'task').map((r) => r.task);
    const shown = applyLayout(allColumns, layout);
    const header = ['WBS', ...shown.map((c) => c.label)];
    const body = taskRows.map((t) => [wbsPathName(model, t.wbsUid), ...shown.map((c) => (c.exportValue ? c.exportValue(t) : c.value(t)) ?? '')]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    ws['!cols'] = header.map((h, i) => ({ wch: Math.min(60, Math.max(10, h.length + 2, ...body.slice(0, 300).map((r) => String(r[i] ?? '').length + 1))) }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: body.length, c: header.length - 1 } }) };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Activities');
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    downloadBytes(`Schedule-${project.shortName}-${stamp()}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  // Links drawn among the rows in view: the selected activity's always, the rest when switched on.
  const links = useMemo(() => {
    if (!showBars) return [];
    const out: { d: string; driving: boolean; done: boolean; sel: boolean }[] = [];
    const seen = new Set<string>();
    const yOf = (i: number) => (i - first) * ROW_H + ROW_H / 2;
    const draw = (rel: P6Rel) => {
      if (seen.has(rel.uid) || out.length >= 600) return;
      const pi = rowIndex.get(rel.predUid);
      const si = rowIndex.get(rel.succUid);
      if (pi === undefined || si === undefined) return;
      const sel = rel.predUid === selectedUid || rel.succUid === selectedUid;
      if (!sel && (pi < first || pi >= last) && (si < first || si >= last)) return;
      seen.add(rel.uid);
      const p = model.taskByUid.get(rel.predUid)!;
      const s2 = model.taskByUid.get(rel.succUid)!;
      const fromMs = rel.type === 'FS' || rel.type === 'FF' ? p.finish : p.start;
      const toMs = rel.type === 'FS' || rel.type === 'SS' ? s2.start : s2.finish;
      if (fromMs === null || toMs === null) return;
      const x1 = scale.x(fromMs);
      const x2 = scale.x(toMs);
      const y1 = yOf(pi);
      const y2 = yOf(si);
      // Out of the predecessor's end, down to the successor's row, into its end.
      const outX = rel.type === 'FS' || rel.type === 'FF' ? x1 + 6 : x1 - 6;
      const inX = rel.type === 'FS' || rel.type === 'SS' ? x2 - 6 : x2 + 6;
      const v = linkState(model, rel);
      out.push({ d: `M${x1},${y1} H${outX} V${y2} H${inX} L${x2},${y2}`, driving: v?.state === 'DRIVING' || v?.state === 'VIOLATED', done: v?.state === 'DONE', sel });
    };
    if (selectedUid) {
      for (const rel of model.predsOf.get(selectedUid) ?? []) draw(rel);
      for (const rel of model.succsOf.get(selectedUid) ?? []) draw(rel);
    }
    if (prefs.links) for (const r of visible) if (r.kind === 'task') for (const rel of model.predsOf.get(r.task.uid) ?? []) draw(rel);
    return out;
  }, [showBars, model, rowIndex, selectedUid, prefs.links, visible, first, last, scale]);

  const selectedTask = selectedUid ? (model.taskByUid.get(selectedUid) ?? null) : null;
  const shownCount = rows.reduce((n, r) => n + (r.kind === 'task' ? 1 : 0), 0);
  const banner = traceState
    ? `${traceState.steps.length} activit${traceState.steps.length === 1 ? 'y' : 'ies'} ${traceState.dir === 'up' ? 'upstream of' : 'downstream of'} ${traceState.origin.code}${traceState.drivingOnly ? ', driving links only' : ''}`
    : list
      ? list.label
      : null;

  return (
    <div className="sched">
      <div className="sched-toolbar">
        <input
          className="input sched-search"
          placeholder="Find by ID or name — Enter"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setQuery(text);
            if (e.key === 'Escape') {
              setText('');
              setQuery('');
            }
          }}
          onBlur={() => setQuery(text)}
          aria-label="Find activities"
        />
        <Seg value={prefs.scope} onChange={(v) => setPrefs({ scope: v as ScopeFilter })} options={[['all', 'Whole project'], ['in', 'T&C scope'], ['out', 'Not T&C']]} />
        <select className="input" value={prefs.status} onChange={(e) => setPrefs({ status: e.target.value as StatusFilter })} aria-label="Status">
          <option value="all">Any status</option>
          <option value="open">Not complete</option>
          <option value="not-started">Not started</option>
          <option value="in-progress">In progress</option>
          <option value="complete">Complete</option>
        </select>
        <select className="input" value={prefs.float} onChange={(e) => setPrefs({ float: e.target.value as FloatFilter })} aria-label="Float">
          <option value="any">Any float</option>
          <option value="critical">Critical</option>
          <option value="near">Near critical (≤ {prefs.nearDays} d)</option>
          <option value="negative">Negative float</option>
        </select>
        <select className="input" value={windowKey} onChange={(e) => setWindowKey(e.target.value as typeof windowKey)} aria-label="When">
          <option value="all">Any dates</option>
          <option value="2w">Next 2 weeks</option>
          <option value="6w">Next 6 weeks</option>
          <option value="3m">Next 3 months</option>
          {ctx.baseline.size > 0 && <option value="late">Finishing after baseline</option>}
        </select>
        <select className="input" value={traceState || list ? 'none' : prefs.group} disabled={!!traceState || !!list} onChange={(e) => setPrefs({ group: e.target.value })} aria-label="Group by">
          <option value="wbs">Group by WBS</option>
          <option value="none">No grouping</option>
          <option value="phase">Group by phase</option>
          <option value="location">Group by location</option>
          <option value="workType">Group by work type</option>
          <option value="status">Group by status</option>
          <option value="scope">T&amp;C scope / rest</option>
          {ctx.codeTypes.map((c) => (
            <option key={c.uid} value={`code:${c.uid}`}>
              Group by {c.name}
            </option>
          ))}
        </select>
        <span className="sched-toolbar-gap" />
        <Seg value={prefs.view} onChange={(v) => setPrefs({ view: v as ViewMode })} options={[['both', 'Table + Gantt'], ['table', 'Table'], ['gantt', 'Gantt']]} />
        {showBars && <Seg value={prefs.zoom} onChange={(v) => setPrefs({ zoom: v as Zoom })} options={ZOOMS.map((z) => [z.key, z.label] as [string, string])} />}
        {showBars && (
          <button className="btn btn-mini" onClick={() => scroller.current && (scroller.current.scrollLeft = Math.max(0, scale.x(dataDate ?? Date.now()) - 160))} title="Scroll the chart to the data date">
            Data date
          </button>
        )}
        <div className="relative">
          <button className="btn btn-mini" onClick={() => setPicking((v) => !v)} title="Choose which columns to show, and their order">
            Columns
          </button>
          {picking && <ColumnPicker columns={allColumns} layout={layout ?? { order: [], off: [], on: [] }} onChange={setLayout} onClose={() => setPicking(false)} />}
        </div>
        <button className="btn btn-mini" onClick={() => void exportExcel()} title="Download the activities shown, with the columns shown, as an .xlsx">
          Excel
        </button>
      </div>

      <div className="sched-subbar">
        <span>
          <b>{shownCount.toLocaleString()}</b> of {tasks.length.toLocaleString()} activities
          {query && (
            <>
              {' '}
              matching <b>“{query}”</b>
            </>
          )}
        </span>
        {groupSpec.kind !== 'none' && (
          <span className="sched-subbar-tools">
            <button className="btn-link" onClick={expandAll}>expand all</button>
            <button className="btn-link" onClick={() => collapseTo(0)}>collapse all</button>
            {groupSpec.kind === 'wbs' && (
              <>
                <button className="btn-link" onClick={() => collapseTo(1)}>level 1</button>
                <button className="btn-link" onClick={() => collapseTo(2)}>level 2</button>
              </>
            )}
          </span>
        )}
        {showBars && (
          <span className="sched-subbar-tools">
            <label className="inline-flex items-center gap-1" title="Draw the relationships between the activities in view. The selected activity's are always drawn.">
              <input type="checkbox" checked={prefs.links} onChange={(e) => setPrefs({ links: e.target.checked })} /> links
            </label>
            {ctx.baseline.size > 0 && (
              <label className="inline-flex items-center gap-1" title={`Baseline bars, from ${ctx.baselineLabel}`}>
                <input type="checkbox" checked={prefs.baseline} onChange={(e) => setPrefs({ baseline: e.target.checked })} /> baseline
              </label>
            )}
            <Legend hasBaseline={ctx.baseline.size > 0 && prefs.baseline} links={prefs.links || !!selectedUid} />
          </span>
        )}
        {banner && (
          <span className="sched-banner">
            {banner}
            <button className="btn-link ml-2" onClick={() => (traceState ? setTraceState(null) : onClearList())}>
              show everything
            </button>
          </span>
        )}
      </div>

      <div className="sched-scroll" ref={scroller} onScroll={onScroll} tabIndex={0} onKeyDown={onKey} aria-label="Activities">
        <div style={{ width: totalWidth, height: totalHeight, position: 'relative' }}>
          <div className="sched-head" style={{ width: totalWidth, height: HEAD_H }}>
            <div className={`sched-gridhead${showBars ? ' is-pinned' : ''}`} style={{ width: gridWidth }}>
              {columns.map((c) => (
                <div
                  key={c.key}
                  className={`sched-th${c.num ? ' num' : ''}`}
                  style={{ width: widthOf(c) }}
                  onClick={() => setSort((s) => (s && s.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}
                  title="Sort by this column (click again to reverse, a third time to put it back)"
                >
                  <Term text={c.label} hint={c.hint} />
                  <span className="th-sort">{sort?.key === c.key ? (sort.dir === 1 ? '▲' : '▼') : ''}</span>
                  <span className="col-grip" onPointerDown={(e) => startResize(e, c.key, widthOf(c))} onClick={(e) => e.stopPropagation()} />
                </div>
              ))}
              {prefs.view === 'both' && <span className="sched-split" onPointerDown={startSplit} title="Drag to widen or narrow the table" />}
            </div>
            {showBars && (
              <div className="sched-scale" style={{ width: scale.width }}>
                <div className="sched-scale-top">
                  {ticks.top.map((t) => (
                    // A year or month that starts off-screen keeps its label in view.
                    <span key={`t${t.x}`} style={{ left: t.x, width: t.w, paddingLeft: 5 + Math.max(0, Math.min(viewLeft - t.x, t.w - 90)) }}>
                      {t.w > 28 ? t.label : ''}
                    </span>
                  ))}
                </div>
                <div className="sched-scale-bot">
                  {ticks.bottom.map((t) => (
                    <span key={`b${t.x}`} style={{ left: t.x, width: t.w }}>
                      {t.w > 16 ? t.label : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {showBars && dataDate !== null && (
            <div className="gline gline-dd" style={{ left: gridWidth + scale.x(dataDate), top: HEAD_H, height: rows.length * ROW_H }} title={`Data date ${fmtMs(dataDate)}`} />
          )}
          {showBars && (
            <div className="gline gline-today" style={{ left: gridWidth + scale.x(Date.now()), top: HEAD_H, height: rows.length * ROW_H }} title="Today" />
          )}

          {/* Rows sit at their own place in the whole list, so scrolling adds and drops
              rows at the edges and leaves the ones still in view alone. */}
          <div style={{ position: 'absolute', top: HEAD_H, left: 0, width: totalWidth }}>
            {visible.map((r, i) => (
              <RowView
                key={r.key}
                row={r}
                top={(first + i) * ROW_H}
                columns={columns}
                widthOf={widthOf}
                gridWidth={gridWidth}
                scale={showBars ? scale : null}
                ctx={dataCtx}
                selected={r.kind === 'task' && r.task.uid === selectedUid}
                onSelect={clickSelect}
                onToggle={toggleGroup}
                showLabel={prefs.view === 'gantt'}
                showBaseline={prefs.baseline}
                level={r.kind === 'task' ? traceLevel.get(r.task.uid) : undefined}
                traceDir={traceState?.dir}
              />
            ))}
            {showBars && links.length > 0 && (
              // Only as big as the chart in view: an SVG the width of a ten-year
              // timeline is millions of pixels to repaint on every scroll.
              <svg
                className="sched-links"
                style={{ left: gridWidth + viewLeft, top: first * ROW_H, width: Math.max(0, vp.width - gridWidth), height: (last - first) * ROW_H }}
                aria-hidden="true"
              >
                <defs>
                  <marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L6,3 L0,6 z" fill="#54575f" />
                  </marker>
                  <marker id="arr-sel" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,0 L6,3 L0,6 z" fill="#1d4eaf" />
                  </marker>
                </defs>
                <g transform={`translate(${-viewLeft},0)`}>
                {links.map((l, i) => (
                  // Solid lines only: a dashed line is drawn dash by dash, and a few
                  // hundred long ones made scrolling crawl. Weight and tone carry
                  // driving against not instead.
                  <path
                    key={i}
                    d={l.d}
                    fill="none"
                    stroke={l.sel ? (l.driving ? '#1d4eaf' : '#7d9ad6') : l.driving ? '#3a3c43' : l.done ? '#dfe1e5' : '#b8bcc4'}
                    strokeWidth={l.driving ? 1.5 : 1}
                    markerEnd={l.sel ? 'url(#arr-sel)' : 'url(#arr)'}
                  />
                ))}
                </g>
              </svg>
            )}
          </div>
          {rows.length === 0 && (
            <div className="sched-empty" style={{ top: HEAD_H + 24 }}>
              Nothing matches. {query || prefs.float !== 'any' || prefs.status !== 'all' || prefs.scope !== 'all' || windowKey !== 'all' ? 'Loosen the filters above.' : ''}
            </div>
          )}
        </div>
      </div>

      {selectedTask && (
        <Details
          ctx={ctx}
          task={selectedTask}
          height={prefs.detailsH}
          onHeight={(h) => setPrefs({ detailsH: h })}
          onClose={() => select(null)}
          onTrace={startTrace}
          onGo={(uid) => {
            lastRevealed.current = null;
            select(uid);
          }}
        />
      )}
    </div>
  );
}

function Seg({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="seg" role="group">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Legend({ hasBaseline, links }: { hasBaseline: boolean; links: boolean }) {
  const item = (color: string, label: string, h = 8) => (
    <span className="sched-key">
      <i style={{ background: color, height: h }} />
      {label}
    </span>
  );
  return (
    <span className="sched-legend" aria-label="Bar colours">
      {item(BAR.done, 'Actual')}
      {item(BAR.remaining, 'Remaining')}
      {item(BAR.critical, 'Critical')}
      {hasBaseline && item(BAR.baseline, 'Baseline', 3)}
      {links && item('#3a3c43', 'Driving link', 2)}
      {links && item('#b8bcc4', 'Other link', 1)}
    </span>
  );
}

type RowProps = {
  row: OutlineRow;
  top: number;
  columns: GridColumn[];
  widthOf: (c: GridColumn) => number;
  gridWidth: number;
  scale: Scale | null;
  ctx: ScheduleCtx;
  selected: boolean;
  onSelect: (uid: string) => void;
  onToggle: (key: string) => void;
  showLabel: boolean;
  showBaseline: boolean;
  level?: number;
  traceDir?: 'up' | 'down';
};

const RowView = memo(function RowView({ row, top, columns, widthOf, gridWidth, scale, ctx, selected, onSelect, onToggle, showLabel, showBaseline, level, traceDir }: RowProps) {
  if (row.kind === 'group') {
    return (
      <div className="sched-row sched-group" style={{ top }} onClick={() => onToggle(row.key)}>
        <div className={`sched-cells${scale ? ' is-pinned' : ''}`} style={{ width: gridWidth }}>
          <div className="sched-td sched-band" style={{ paddingLeft: 6 + row.depth * 14, width: gridWidth }}>
            <span className="sched-caret">{row.collapsed ? '▸' : '▾'}</span>
            <span className="truncate">{row.label}</span>
            {row.code && <span className="sched-band-code">{row.code}</span>}
            <span className="sched-band-n">{row.count.toLocaleString()}</span>
            {row.critical > 0 && <span className="sched-band-crit" title={`${row.critical} critical`}>{row.critical} crit</span>}
            <span className="sched-band-dates">
              {fmtMs(row.start)} – {fmtMs(row.finish)}
            </span>
          </div>
        </div>
        {scale && (
          <div className="sched-bars" style={{ width: scale.width }}>
            {row.start !== null && row.finish !== null && (
              <span className="gbar-sum" style={{ left: scale.x(row.start), width: Math.max(2, scale.x(row.finish) - scale.x(row.start)) }} />
            )}
          </div>
        )}
      </div>
    );
  }
  const t = row.task;
  const crit = isCritical(t, ctx.project);
  return (
    <div className={`sched-row${selected ? ' is-sel' : ''}${ctx.inScope(t) ? ' is-scope' : ''}`} style={{ top }} onClick={() => onSelect(t.uid)}>
      <div className={`sched-cells${scale ? ' is-pinned' : ''}`} style={{ width: gridWidth }}>
        {columns.map((c, i) => (
          <div
            key={c.key}
            className={`sched-td${c.num ? ' num' : ''}`}
            style={{ width: widthOf(c), ...(i === 0 ? { paddingLeft: 6 + row.depth * 14 } : {}) }}
            title={i <= 1 ? String(c.value(t) ?? '') : undefined}
          >
            {i === 0 && level !== undefined && <span className="sched-level">{traceDir === 'down' ? '↓' : '↑'}{level}</span>}
            {i === 0 && <span className={`sched-dot st-${t.status === 'COMPLETE' ? 'done' : t.status === 'IN PROGRESS' ? 'active' : 'todo'}`} />}
            {c.render ? c.render(t) : (c.value(t) ?? '')}
          </div>
        ))}
      </div>
      {scale && <Bars t={t} scale={scale} ctx={ctx} critical={crit} showLabel={showLabel} showBaseline={showBaseline} />}
    </div>
  );
});

function Bars({ t, scale, ctx, critical, showLabel, showBaseline }: { t: P6Task; scale: Scale; ctx: ScheduleCtx; critical: boolean; showLabel: boolean; showBaseline: boolean }) {
  const remColor = critical ? BAR.critical : BAR.remaining;
  const parts: React.ReactNode[] = [];
  const isMs = t.type === 'START_MS' || t.type === 'FINISH_MS' || (t.odHrs === 0 && t.start !== null && t.finish !== null && t.finish - t.start < DAY);
  const tip = `${t.code} ${t.name}\n${fmtMs(t.start)}${t.actStart !== null ? ' A' : ''} – ${fmtMs(t.finish)}${t.actFinish !== null ? ' A' : ''}`;
  const span = (key: string, from: number, to: number, color: string, extra = '') => {
    const left = scale.x(from);
    parts.push(<span key={key} className={`gbar${extra}`} style={{ left, width: Math.max(2, scale.x(to) - left), background: color }} title={tip} />);
  };
  if (isMs) {
    const at = t.type === 'FINISH_MS' ? (t.finish ?? t.start) : (t.start ?? t.finish);
    if (at !== null) parts.push(<span key="ms" className="gms" style={{ left: scale.x(at), background: t.status === 'COMPLETE' ? BAR.done : remColor }} title={tip} />);
  } else if (t.start !== null && t.finish !== null) {
    const extra = t.type === 'LOE' ? ' gbar-loe' : '';
    if (t.status === 'COMPLETE') span('done', t.actStart ?? t.start, t.actFinish ?? t.finish, BAR.done, extra);
    else if (t.status === 'IN PROGRESS') {
      const dd = ctx.dataDate ?? t.remStart ?? t.start;
      const split = Math.min(Math.max(dd, t.actStart ?? t.start), t.finish);
      span('done', t.actStart ?? t.start, split, BAR.done, extra);
      span('rem', Math.max(split, t.remStart ?? split), t.finish, remColor, extra);
    } else span('rem', t.start, t.finish, remColor, extra);
  }
  const bl = showBaseline ? ctx.baseline.get(normKey(t.code)) : undefined;
  if (bl && bl.start !== null && bl.finish !== null) {
    const left = scale.x(bl.start);
    parts.push(<span key="bl" className="gbar-bl" style={{ left, width: Math.max(2, scale.x(bl.finish) - left) }} title={`Baseline ${fmtMs(bl.start)} – ${fmtMs(bl.finish)}`} />);
  }
  if (showLabel && t.finish !== null) parts.push(<span key="lbl" className="gbar-label" style={{ left: scale.x(t.finish) + 8 }}>{t.name}</span>);
  return (
    <div className="sched-bars" style={{ width: scale.width }}>
      {parts}
    </div>
  );
}
