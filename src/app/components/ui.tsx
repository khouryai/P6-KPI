import React, { useEffect, useMemo, useRef, useState } from 'react';
import { define } from '../../engine/glossary';
import { downloadBytes, stamp } from '../export';
import { fmtDate } from '../format';
import { isValidISO } from '../../engine/dates';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'purple' | 'muted';

export function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Map a domain status string to a semantic tone. One place, so no screen hand-maps. */
export function statusTone(s: string): Tone {
  switch (s) {
    case 'IN BUDGET':
    case 'SET':
    case 'BASELINE':
    case 'OVERRIDE':
    case 'P6 ACTUAL':
    case 'TEST WINDOW':
      return 'good';
    case 'DEFAULT':
    case 'CURRENT':
    case 'IN PROGRESS':
    case 'P6':
      return 'warn';
    case 'PROGRESS AS AT':
      return 'good';
    case 'REVIEW':
    case 'NEEDS SHIFTS':
    case 'NO MATCH':
    case 'NONE':
      return 'bad';
    case 'EXCLUDED':
    case 'DELETED':
    case 'CANCELLED':
    case 'NOT STARTED':
      return 'muted';
    default:
      return 'info';
  }
}

export type HeroStat = { label: string; value: React.ReactNode; tone?: 'red' | 'amber' | 'blue' | 'good' | 'muted' };

/**
 * The page header: mono eyebrow, display title, muted subtitle, and either a
 * chip-stat rail or a row of actions on the right.
 */
export function Page({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
  toolbar,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: React.ReactNode;
  stats?: HeroStat[];
  actions?: React.ReactNode;
  /** A filter bank. Rendered as its own full-width row so it never squeezes the title. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="page-hero">
        <div className="min-w-0">
          {eyebrow && <div className="ph-eyebrow">{eyebrow}</div>}
          <h1 className="ph-title">{title}</h1>
          {subtitle && <div className="ph-sub">{subtitle}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {stats && stats.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-[7px]">
              {stats.map((s) => (
                <span key={s.label} className={`ph-stat${s.tone ? ` tone-${s.tone}` : ''}`}>
                  <span className="ph-stat-lbl">{s.label}</span>
                  <span className="ph-stat-val">{s.value}</span>
                </span>
              ))}
            </div>
          )}
          {actions && <div className="ph-actions">{actions}</div>}
        </div>
      </div>
      {toolbar && <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--surface)] px-7 py-2.5">{toolbar}</div>}
      <div className="min-h-0 flex-1 overflow-auto px-7 py-6">{children}</div>
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'error' | 'ok'; children: React.ReactNode }) {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

/** A KPI card: mono label, large tabular number, muted supporting line. */
/**
 * A label that explains itself on hover. The definition comes from the glossary
 * unless one is passed, so the abbreviations stay defined in exactly one place.
 */
export function Term({ text, hint }: { text: string; hint?: string }) {
  const explain = hint === undefined ? define(text) : hint || undefined;
  if (!explain) return <>{text}</>;
  return (
    <span className="term" title={explain}>
      {text}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
  primary,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: 'good' | 'warn' | 'bad';
  primary?: boolean;
  hint?: string;
}) {
  return (
    <div className={`kpi-card${primary ? ' kpi-primary' : ''}`}>
      <div className="kpi-label"><Term text={label} hint={hint} /></div>
      <div className={`kpi-value${tone ? ` tone-${tone}` : ''}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

/** A card with a display-weight title and optional right-hand meta. */
export function Panel({
  title,
  meta,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || meta) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {typeof title === 'string' ? <h2 className="card-title">{title}</h2> : title}
          {meta && <div className="text-[11.5px] text-[var(--text-muted)]">{meta}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export type Column<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
  render?: (row: T) => React.ReactNode;
  num?: boolean;
  width?: string;
  /**
   * What this column is worth in a spreadsheet, when the figure on screen is not it.
   * Left out, the export writes `value(row)` — which is what the column sorts on and
   * so is nearly always the right answer.
   */
  exportValue?: (row: T) => string | number | null | undefined;
  /**
   * What the column means. Left out, the glossary is consulted for the label, so
   * a column called "OD" explains itself without every screen repeating the text.
   * Pass an empty string to say deliberately that there is nothing to explain.
   */
  hint?: string;
  /** Off until the person turns it on. For detail most people do not want by default. */
  optional?: boolean;
  /** Never hideable or movable: the column that says which row this is. */
  locked?: boolean;
};

/**
 * Which columns a table shows, and in what order, remembered per table per browser.
 *
 * This is about this person on this machine — which columns they care to look at —
 * so it belongs in localStorage and emphatically not in the OneDrive store, where
 * it would become something every colleague inherits and something you have to
 * "save". Only the keys are kept: a layout referring to a column that no longer
 * exists is filtered out on read, and a column added by a later version appears in
 * its natural place rather than vanishing because an old layout never mentioned it.
 */
export type TableLayout = {
  /** Left-to-right order, by column key. Keys the table no longer has are ignored. */
  order: string[];
  /** Columns switched OFF by hand, optional or not. */
  off: string[];
  /**
   * Optional columns switched ON by hand.
   *
   * This has to be its own list rather than "anything not in `off`". An optional
   * column is off until asked for, so absence cannot mean on — and the order list
   * cannot stand in for "columns this layout knows about" either, since reordering
   * or hiding one column writes every key into it and would switch every optional
   * column on at once. That was a real bug: hide Phase, and five columns nobody
   * asked for appeared.
   */
  on: string[];
  /**
   * Column widths in pixels, as set by dragging a heading's right-hand edge.
   * Optional: a layout saved before columns could be resized has none, and a
   * column with no entry sizes itself as it always did.
   */
  widths?: Record<string, number>;
  /**
   * Show every cell in full by wrapping it over as many lines as it takes, instead
   * of cutting it off at the column edge. Off by default: a table of one-line rows
   * is far quicker to scan, and the whole text is only sometimes the point.
   */
  wrap?: boolean;
};

const LAYOUT_PREFIX = 'tc-cols-';

function readLayout(tableId: string): TableLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_PREFIX + tableId);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TableLayout>;
    const arr = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
    const widths: Record<string, number> = {};
    if (v.widths && typeof v.widths === 'object') {
      for (const [k, w] of Object.entries(v.widths)) if (typeof w === 'number' && Number.isFinite(w) && w > 0) widths[k] = w;
    }
    return { order: arr(v.order), off: arr(v.off), on: arr(v.on), widths, wrap: !!v.wrap };
  } catch {
    return null;
  }
}

/** Is this column on screen, given the layout? The one place that decides. */
export function isVisible<T>(c: Column<T>, layout: TableLayout | null): boolean {
  if (c.locked) return true;
  if (layout?.off.includes(c.key)) return false;
  return c.optional ? !!layout?.on.includes(c.key) : true;
}

function isEmptyLayout(l: TableLayout): boolean {
  return l.order.length === 0 && l.off.length === 0 && l.on.length === 0 && Object.keys(l.widths ?? {}).length === 0 && !l.wrap;
}

function writeLayout(tableId: string, layout: TableLayout | null): void {
  try {
    if (layout === null) localStorage.removeItem(LAYOUT_PREFIX + tableId);
    else localStorage.setItem(LAYOUT_PREFIX + tableId, JSON.stringify(layout));
  } catch {
    /* private window: the table still works, it just will not remember */
  }
}

/**
 * Apply a stored layout to the columns a screen declared, tolerating drift both ways.
 *
 * Two kinds of drift, and they pull in opposite directions. A column the layout
 * mentions but the screen no longer declares simply never matches, which is why the
 * order is stored as keys rather than indices. A column the screen declares but the
 * layout has never heard of is NEW since the layout was saved: it keeps its declared
 * position, and if it is optional it stays off, so shipping a new optional column
 * cannot rearrange a table somebody had already set up the way they wanted.
 */
export function applyLayout<T>(columns: Column<T>[], layout: TableLayout | null): Column<T>[] {
  const visible = columns.filter((c) => isVisible(c, layout));
  if (!layout?.order.length) return visible;
  const rank = new Map(layout.order.map((k, i) => [k, i]));
  return [...visible].sort((a, b) => (rank.get(a.key) ?? columns.indexOf(a)) - (rank.get(b.key) ?? columns.indexOf(b)));
}

/** The Columns popover: tick what to show, move what matters to the front. */
function ColumnPicker<T>({
  columns,
  layout,
  onChange,
  onClose,
}: {
  columns: Column<T>[];
  layout: TableLayout;
  onChange: (next: TableLayout) => void;
  onClose: () => void;
}) {
  const rank = new Map(layout.order.map((k, i) => [k, i]));
  const order = [...columns].sort((a, b) => (rank.get(a.key) ?? columns.indexOf(a)) - (rank.get(b.key) ?? columns.indexOf(b)));
  const keys = order.map((c) => c.key);

  const byKey = new Map(order.map((c) => [c.key, c]));

  /**
   * Where this column lands if moved one step. Hidden columns are stepped over:
   * swapping a visible column with one that is not on screen moves nothing the
   * person can see, which reads as a broken button.
   */
  const target = (key: string, by: number): number => {
    const i = keys.indexOf(key);
    if (i < 0) return -1;
    const mover = byKey.get(key);
    let j = i + by;
    if (mover && isVisible(mover, layout)) {
      while (j >= 0 && j < keys.length && !isVisible(byKey.get(keys[j])!, layout)) j += by;
    }
    return j >= 0 && j < keys.length ? j : -1;
  };

  const move = (key: string, by: number) => {
    const i = keys.indexOf(key);
    const j = target(key, by);
    if (i < 0 || j < 0) return;
    // Lift and re-insert rather than swap, so the columns stepped over keep their
    // relative order instead of one of them being flung to the other end.
    const next = [...keys];
    next.splice(i, 1);
    next.splice(j, 0, key);
    onChange({ ...layout, order: next });
  };

  const toggle = (c: Column<T>) => {
    const showing = isVisible(c, layout);
    const off = new Set(layout.off);
    const on = new Set(layout.on);
    if (showing) {
      off.add(c.key);
      on.delete(c.key);
    } else {
      off.delete(c.key);
      if (c.optional) on.add(c.key);
    }
    // Reordering is the only thing that needs the order list, so it is only written
    // when it already carries a choice — a visibility toggle must not silently pin
    // today's column order into storage.
    onChange({ order: layout.order, off: [...off], on: [...on] });
  };

  return (
    <>
      <div className="col-scrim" onClick={onClose} />
      <div className="col-pop" role="dialog" aria-label="Choose columns">
        <div className="col-pop-head">
          <span>Columns</span>
          <button className="btn-link" onClick={() => onChange({ order: [], off: [], on: [], widths: {}, wrap: false })}>reset</button>
        </div>
        <label className="col-wrap-row" title="Show every cell in full, over as many lines as it takes. Off, a cell that does not fit is cut off at the column edge and its whole text is in the tooltip.">
          <input type="checkbox" checked={!!layout.wrap} onChange={() => onChange({ ...layout, wrap: !layout.wrap })} />
          <span>Wrap text — show whole cells</span>
        </label>
        <div className="col-pop-list">
          {order.map((c) => (
            <div key={c.key} className="col-row">
              <label className="col-row-label">
                <input type="checkbox" checked={isVisible(c, layout)} disabled={c.locked} onChange={() => toggle(c)} />
                <span className={isVisible(c, layout) ? '' : 'opacity-50'}>{c.label || <i>(actions)</i>}</span>
              </label>
              <span className="col-row-moves">
                <button className="col-move" disabled={target(c.key, -1) < 0} title="Move left" onClick={() => move(c.key, -1)}>↑</button>
                <button className="col-move" disabled={target(c.key, 1) < 0} title="Move right" onClick={() => move(c.key, 1)}>↓</button>
              </span>
            </div>
          ))}
        </div>
        <div className="col-pop-foot">
          Kept on this machine only. Order here is left-to-right in the table. Drag the edge of a heading to widen a column; double-click that edge to put it back.
        </div>
      </div>
    </>
  );
}

/**
 * Everything on screen, as a spreadsheet: the columns that are showing, in the
 * order they are showing, carrying the rows as filtered and sorted.
 *
 * The point is that it matches the screen. A person who has spent a minute picking
 * columns, moving two to the front and filtering to one phase has already said what
 * they want out of the table; an export that ignores all of that and dumps every
 * field is a different document they then have to edit down. So the cells come from
 * `value` — the same raw figure the column sorts on, not the badge or the input
 * drawn over it — and nothing that is switched off is written.
 */
export function tableToSheet<T>(xlsx: typeof import('xlsx'), rows: T[], columns: Column<T>[]): import('xlsx').WorkSheet {
  const header = columns.map((c) => c.label || 'Actions');
  const body = rows.map((r) => columns.map((c) => (c.exportValue ? c.exportValue(r) : c.value(r)) ?? ''));
  const ws = xlsx.utils.aoa_to_sheet([header, ...body]);
  // Column widths, so the text a person went to the trouble of widening on screen
  // is not cut off again the moment it lands in Excel.
  ws['!cols'] = columns.map((c, i) => ({
    wch: Math.min(60, Math.max(10, c.label.length + 2, ...body.slice(0, 400).map((r) => String(r[i] ?? '').length + 1))),
  }));
  return ws;
}

/** A sortable table. Sorting is by the column's raw value. */
export function SortableTable<T>({
  rows,
  columns: declared,
  rowKey,
  defaultSort,
  maxHeight = 'calc(100vh - 290px)',
  rowClass,
  tableId,
  exportName,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  defaultSort?: { key: string; dir: 'asc' | 'desc' };
  maxHeight?: string;
  rowClass?: (row: T) => string;
  /**
   * Give the table a stable id and it gains a Columns button: what to show and in
   * what order, remembered per browser. Without one it behaves exactly as before.
   */
  tableId?: string;
  /** What the exported workbook is called. Defaults to the table id. */
  exportName?: string;
}) {
  const [layout, setLayout] = useState<TableLayout | null>(() => (tableId ? readLayout(tableId) : null));
  const [picking, setPicking] = useState(false);
  /** The width being dragged right now, before it is committed to the layout. */
  const [dragging, setDragging] = useState<{ key: string; width: number } | null>(null);
  /** One render with every width dropped, so `Fit columns` can measure the content. */
  const [measuring, setMeasuring] = useState(false);
  const headRef = useRef<HTMLTableRowElement | null>(null);
  const columns = useMemo(() => (tableId ? applyLayout(declared, layout) : declared), [declared, layout, tableId]);
  const changeLayout = (next: TableLayout) => {
    const stored = isEmptyLayout(next) ? null : next;
    setLayout(stored);
    if (tableId) writeLayout(tableId, stored);
  };
  const hiddenCount = tableId ? declared.length - columns.length : 0;
  const wrap = !!layout?.wrap;

  /** The width in force for a column: the drag in progress, then the saved one. */
  const widthOf = (key: string): number | undefined => (dragging?.key === key ? dragging.width : layout?.widths?.[key]);

  /**
   * Widen a column by dragging the right-hand edge of its heading.
   *
   * The pointer is captured, so the drag survives leaving the 5px grip — without
   * that, a quick pull drops the column halfway. The width is held in state while
   * the pointer is down and written to the layout once on release, which keeps a
   * drag from putting a hundred entries through localStorage.
   */
  const startResize = (e: React.PointerEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th');
    const from = e.clientX;
    const startWidth = Math.round(th?.getBoundingClientRect().width ?? 120);
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      latest = Math.max(48, Math.round(startWidth + (ev.clientX - from)));
      setDragging({ key, width: latest });
    };
    const done = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', done);
      grip.removeEventListener('pointercancel', done);
      setDragging(null);
      const base = layout ?? { order: [], off: [], on: [] };
      changeLayout({ ...base, widths: { ...(base.widths ?? {}), [key]: latest } });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', done);
    grip.addEventListener('pointercancel', done);
  };

  /** Double-clicking the grip gives the column back to the browser to size. */
  const clearWidth = (key: string) => {
    if (!layout?.widths?.[key]) return;
    const widths = { ...layout.widths };
    delete widths[key];
    changeLayout({ ...layout, widths });
  };

  /**
   * Widen every column to the widest thing in it.
   *
   * This has to be measured in two passes, and the reason is the whole trick: a
   * column that is cut off is cut off BECAUSE it is holding a width, so measuring
   * it where it stands just reads that width back and pins the truncation in place
   * — which is exactly what the first version of this did. So the table is first
   * rendered with every width removed, where the browser lays each column out to
   * its content, and the widths are read off that and then applied.
   */
  const fitAll = () => setMeasuring(true);

  useEffect(() => {
    if (!measuring) return;
    const head = headRef.current;
    const widths: Record<string, number> = {};
    // Laid out unconstrained, a column IS its widest cell, so the headings carry
    // the answer for the whole column.
    [...(head?.children ?? [])].forEach((th, i) => {
      const key = columns[i]?.key;
      if (key) widths[key] = Math.min(640, Math.max(56, Math.ceil((th as HTMLElement).getBoundingClientRect().width)));
    });
    setMeasuring(false);
    if (Object.keys(widths).length) changeLayout({ ...(layout ?? { order: [], off: [], on: [] }), widths, wrap: false });
    // Deliberately only on the measuring flag: this runs once per Fit, against the
    // unconstrained table that flag just rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuring]);

  /** The width to render a column at. While measuring, none: that is the point. */
  const renderWidth = (c: Column<T>): string | number | undefined => (measuring ? undefined : widthOf(c.key) ?? c.width);
  const cellStyle = (c: Column<T>): React.CSSProperties | undefined => {
    const w = renderWidth(c);
    return w === undefined ? undefined : typeof w === 'number' ? { width: w, minWidth: w, maxWidth: w } : { width: w };
  };

  /**
   * The visible table, as a workbook.
   *
   * The spreadsheet library is loaded on the click rather than imported, because
   * this component is on every screen and the library is a third of the bundle.
   * Nobody should wait for it to open the dashboard.
   */
  const exportSheet = async () => {
    const name = exportName ?? tableId ?? 'table';
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, tableToSheet(XLSX, sorted, columns), name.slice(0, 28).replace(/[[\]:*?/\\]/g, '-'));
    const bytes = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    downloadBytes(`${name}-${stamp()}.xlsx`, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(defaultSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.value(a);
      const vb = col.value(b);
      if (va === vb) return 0;
      if (va === null || va === undefined || va === '') return 1;
      if (vb === null || vb === undefined || vb === '') return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * dir;
    });
  }, [rows, columns, sort]);
  const toggle = (key: string) => setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return (
    <div className="table-shell">
      {tableId && (
        <div className="table-tools">
          <button className={`btn btn-mini${wrap ? ' is-on' : ''}`} onClick={() => changeLayout({ ...(layout ?? { order: [], off: [], on: [] }), wrap: !wrap })} title="Show every cell in full, over as many lines as it takes">
            Wrap text
          </button>
          <button className="btn btn-mini" onClick={fitAll} title="Widen every column to fit the longest thing in it. Double-click the edge of one heading to put that column back.">
            Fit columns
          </button>
          <button className="btn btn-mini" onClick={() => void exportSheet()} title="Download what is on screen as an .xlsx: these columns, in this order, these rows.">
            Excel
          </button>
          <button className={`btn btn-mini${hiddenCount > 0 ? ' is-on' : ''}`} onClick={() => setPicking((v) => !v)} title="Choose which columns to show, and their order">
            Columns{hiddenCount > 0 ? ` (${columns.length}/${declared.length})` : ''}
          </button>
          {picking && (
            <ColumnPicker
              columns={declared}
              layout={layout ?? { order: [], off: [], on: [] }}
              onChange={changeLayout}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
    <div className="table-wrap" style={{ maxHeight }}>
      <table className={`tbl${wrap ? ' is-wrap' : ''}${measuring ? ' is-measuring' : ''}`}>
        <thead>
          <tr ref={headRef}>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`cursor-pointer select-none${c.num ? ' num' : ''}`}
                style={cellStyle(c)}
                onClick={() => toggle(c.key)}
              >
                {/*
                  * The caret is always rendered, in a fixed-width slot, so clicking a
                  * heading cannot nudge the whole row of headings sideways. On a numeric
                  * column it goes first, which leaves the label's last character sitting
                  * exactly over the figures underneath it.
                  */}
                {c.num && <span className="th-sort">{sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>}
                <Term text={c.label} hint={c.hint} />
                {!c.num && <span className="th-sort">{sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>}
                {tableId && (
                  /* The grip lives in the heading, so it has to swallow the click
                     that would otherwise sort the column out from under the drag. */
                  <span
                    className="col-grip"
                    title="Drag to set this column's width. Double-click to size it automatically again."
                    onPointerDown={(e) => startResize(e, c.key)}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      clearWidth(c.key);
                    }}
                  />
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={rowClass?.(r)}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={c.num ? 'num' : ''}
                  style={cellStyle(c)}
                >
                  {c.render ? c.render(r) : c.value(r) ?? ''}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-[var(--text-subtle)]">
                Nothing to show.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    </div>
  );
}

/** Text input that commits on blur or Enter, so typing does not re-render the whole table on every key. */
export function CellInput({
  value,
  onCommit,
  type = 'text',
  placeholder,
  className = 'cell-input',
  title,
  list,
}: {
  value: string;
  onCommit: (v: string) => void;
  type?: 'text' | 'number' | 'date';
  placeholder?: string;
  className?: string;
  title?: string;
  list?: string;
}) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  const shown = editing ? v : value;
  return (
    <input
      className={className}
      type={type}
      step={type === 'number' ? 'any' : undefined}
      value={shown}
      placeholder={placeholder}
      title={title}
      list={list}
      onFocus={() => {
        setV(value);
        setEditing(true);
      }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (v !== value) onCommit(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setV(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Select({
  value,
  options,
  onChange,
  className = 'cell-input',
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * An actual date, as it stands and as it can be changed.
 *
 * The date shown is the one the whole app works off: the test window date where one
 * was keyed, otherwise P6's, and only where P6 flags it actual. Typing here writes
 * the test window override on Progress — the same field, not a second copy —
 * so a date corrected at a review immediately moves the earn window, the percent
 * complete's month, the S-curve and this log's own outcome. Clearing it hands the
 * date back to P6, and typing P6's own date back in is read as exactly that rather
 * than stored as an override that shadows it.
 *
 * The marker says which of the two is being shown, because "8 Sep" tells nobody
 * whether it came from the schedule or from somebody in a meeting.
 */
export function ActualDateCell({
  shown,
  keyed,
  p6,
  what,
  onCommit,
}: {
  /** The effective date, which is what the log and the curve actually use. */
  shown: string | null;
  /** The override keyed against this activity, when there is one. */
  keyed?: string;
  /** What P6 alone says, when it flags the date actual. */
  p6: string | null;
  what: 'start' | 'finish';
  onCommit: (iso: string | undefined) => void;
}) {
  const source = keyed ? 'yours' : p6 ? 'P6' : null;
  const title = keyed
    ? `Keyed by you. It overrides P6, which ${p6 ? `has ${fmtDate(p6)}` : `has no actual ${what}`}. Clear the box to hand the date back to P6.`
    : p6
      ? `P6's actual ${what}. Type a date to override it; it is stored as the test ${what === 'start' ? 'start' : 'end'} on Progress, where the same field can be edited.`
      : `No actual ${what} yet. Type one to record it — it is stored as the test ${what === 'start' ? 'start' : 'end'} on Progress, and drives the earn window from then on.`;
  return (
    <span className="flex items-center gap-1" title={title}>
      <CellInput
        type="date"
        value={shown ?? ''}
        onCommit={(v) => onCommit(isValidISO(v) && v !== p6 ? v : undefined)}
      />
      {source && (
        <b className={`date-src${keyed ? ' is-yours' : ''}`} aria-label={keyed ? 'keyed by you' : 'from P6'}>
          {source === 'yours' ? '✎' : 'A'}
        </b>
      )}
    </span>
  );
}
