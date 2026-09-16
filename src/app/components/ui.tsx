import React, { useMemo, useState } from 'react';
import { define } from '../../engine/glossary';

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
    case 'TESTS':
    case 'OVERRIDE':
    case 'P6 ACTUAL':
    case 'TEST WINDOW':
      return 'good';
    case 'DEFAULT':
    case 'CURRENT':
    case 'IN PROGRESS':
    case 'P6':
      return 'warn';
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
};

const LAYOUT_PREFIX = 'tc-cols-';

function readLayout(tableId: string): TableLayout | null {
  try {
    const raw = localStorage.getItem(LAYOUT_PREFIX + tableId);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TableLayout>;
    const arr = (x: unknown) => (Array.isArray(x) ? (x as string[]) : []);
    return { order: arr(v.order), off: arr(v.off), on: arr(v.on) };
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
  return l.order.length === 0 && l.off.length === 0 && l.on.length === 0;
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
          <button className="btn-link" onClick={() => onChange({ order: [], off: [], on: [] })}>reset</button>
        </div>
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
        <div className="col-pop-foot">Kept on this machine only. Order here is left-to-right in the table.</div>
      </div>
    </>
  );
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
}) {
  const [layout, setLayout] = useState<TableLayout | null>(() => (tableId ? readLayout(tableId) : null));
  const [picking, setPicking] = useState(false);
  const columns = useMemo(() => (tableId ? applyLayout(declared, layout) : declared), [declared, layout, tableId]);
  const changeLayout = (next: TableLayout) => {
    const stored = isEmptyLayout(next) ? null : next;
    setLayout(stored);
    if (tableId) writeLayout(tableId, stored);
  };
  const hiddenCount = tableId ? declared.length - columns.length : 0;

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
      <table className="tbl">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`cursor-pointer select-none${c.num ? ' num' : ''}`}
                style={c.width ? { width: c.width } : undefined}
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
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={rowClass?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? 'num' : ''}>
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
